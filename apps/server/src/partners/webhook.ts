// Webhook "partida terminada": quando uma partida de uma conta vinculada a um app (OAuth) é
// gravada, o servidor avisa o app. O aviso é só um sinal: os dados vêm pelas rotas da API,
// com o token do usuário. Tokens pessoais (sem cliente) não recebem webhook.
//
// Entrega: depois da resposta, com fetch e timeout de 5 s, sem seguir redirecionamentos.
// 2xx = entregue; senão, mais duas tentativas (1 min e 10 min depois), em memória, e um
// log ao desistir. O app cobre o que se perder num reinício consultando /players/me/matches.

import { createHmac, randomBytes } from 'node:crypto';
import type { DB } from '../db';
import { webhookClientsOf } from './store';

export interface MatchFinishedEvent {
  event: 'match.finished';
  id: string;
  createdAt: string;
  userId: string;
  matchId: number;
  queue: string;
  format: string;
  won: boolean;
}

interface Deps {
  db: DB;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Esperas entre tentativas (ms); padrão 1 min e 10 min. */
  retryMs?: number[];
  timeoutMs?: number;
  /** Só https:// (padrão em produção). */
  requireHttps?: boolean;
}

export const WEBHOOK_TIMEOUT_MS = 5_000;
export const WEBHOOK_RETRY_MS = [60_000, 600_000];

/** Assinatura de um aviso: `sha256=` + HMAC-SHA256(segredo, `<timestamp>.<corpo>`). */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

export class WebhookDispatcher {
  private readonly inflight = new Set<Promise<void>>();
  private readonly fetchImpl: typeof fetch;
  private readonly log: (msg: string) => void;
  private readonly retryMs: number[];
  private readonly timeoutMs: number;
  private readonly requireHttps: boolean;

  constructor(private readonly deps: Deps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.log = deps.log ?? (() => undefined);
    this.retryMs = deps.retryMs ?? WEBHOOK_RETRY_MS;
    this.timeoutMs = deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
    this.requireHttps = deps.requireHttps ?? process.env.NODE_ENV === 'production';
  }

  /** Avisa os apps vinculados aos jogadores (com conta) de uma partida recém-gravada. Nunca lança. */
  matchFinished(matchId: number) {
    try {
      const rows = this.deps.db
        .prepare(
          `SELECT p.owner_hash, s.won, s.queue, s.format FROM match_seats s JOIN players p ON p.id = s.player_id
           WHERE s.match_id = ? AND s.controller = 'human' AND p.owner_hash LIKE 'user:%'`,
        )
        .all(matchId) as Array<{ owner_hash: string; won: number; queue: string; format: string }>;
      for (const r of rows) {
        const userId = r.owner_hash.slice('user:'.length);
        for (const client of webhookClientsOf(this.deps.db, userId, 'matches:read')) {
          const event: MatchFinishedEvent = {
            event: 'match.finished',
            id: `evt-${randomBytes(5).toString('hex')}`,
            createdAt: new Date().toISOString(),
            userId,
            matchId,
            queue: r.queue,
            format: r.format,
            won: Boolean(r.won),
          };
          this.track(this.deliver(client.clientId, client.webhookUrl, client.webhookSecret, event));
        }
      }
    } catch (e) {
      this.log(`webhook: falha ao preparar o aviso da partida ${matchId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Testes: espera todas as entregas (e novas tentativas) terminarem. */
  async idle() {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  private track(p: Promise<void>) {
    const wrapped = p.catch(() => undefined).finally(() => this.inflight.delete(wrapped));
    this.inflight.add(wrapped);
  }

  private async deliver(clientId: string, url: string, secret: string, event: MatchFinishedEvent) {
    if (this.requireHttps && !/^https:\/\//i.test(url)) {
      this.log(`webhook ${clientId}: ${url} não é https; aviso ${event.id} descartado`);
      return;
    }
    // Depois da resposta da requisição que gravou a partida.
    await sleep(0);
    const body = JSON.stringify(event);
    for (let attempt = 0; ; attempt++) {
      const ok = await this.post(url, secret, body, event.event);
      if (ok) return;
      if (attempt >= this.retryMs.length) {
        this.log(`webhook ${clientId}: desistindo do aviso ${event.id} (partida ${event.matchId}) após ${attempt + 1} tentativas`);
        return;
      }
      await sleep(this.retryMs[attempt]);
    }
  }

  private async post(url: string, secret: string, body: string, kind: string): Promise<boolean> {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'GumGumFight-Webhook/1',
          'x-ggf-event': kind,
          'x-ggf-timestamp': String(timestamp),
          'x-ggf-signature': signWebhook(secret, timestamp, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Avisos aos apps parceiros (exposto para os testes esperarem as entregas). */
    webhooks: WebhookDispatcher;
  }
}
