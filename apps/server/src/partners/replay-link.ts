// Replay embutido em apps parceiros (SweetApp): a página `/replay/<id>?t=<token>&embed=1` abre a mesa
// em modo replay dentro de um iframe, sem sessão.
//
// - O token é assinado (HMAC-SHA256), vale 1 hora e serve só para aquela partida. Quem pode ver o
//   replay pede o link em `POST /api/matches/:id/replay-link` (cookie ou token com matches:read).
// - A página lê o replay em `GET /api/replay/:id?t=`, que devolve também as cartas usadas (o iframe
//   não baixa a base inteira) e as origens que podem mandar comandos por postMessage.
// - Só `/replay/*` pode ir para um iframe, e só nas origens de REPLAY_EMBED_ORIGINS
//   (`frame-ancestors`); o resto do site responde `frame-ancestors 'none'` (ver `app.ts`).

import type { CardData } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '../auth/store';
import { type DB, getCards } from '../db';
import { fail } from '../errors';
import type { ApiCard } from '../present';
import { replayDenied } from '../reports/routes';
import { matchReplay, matchSummary } from '../reports/store';
import { getTournament } from '../tournaments/store';

/** Validade do link (segundos). */
export const REPLAY_LINK_TTL_S = 3600;
/** Caminho da página do replay embutido. */
export const REPLAY_PAGE = '/replay/';
/** Parâmetros aceitos no link, além do token (`lang` e `layout` passam adiante como vieram, se válidos). */
const LAYOUTS = ['tablet', 'lateral'] as const;
const LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Segredo das assinaturas: REPLAY_LINK_SECRET ou, sem ele, um gerado na primeira vez e guardado no banco. */
export function replayLinkSecret(db: DB, env?: string | null): Buffer {
  if (env) return Buffer.from(env, 'utf8');
  const row = db.prepare("SELECT value FROM server_keys WHERE name = 'replay_link'").get() as { value: string } | undefined;
  if (row) return Buffer.from(row.value, 'base64url');
  const secret = randomBytes(32);
  db.prepare("INSERT INTO server_keys (name, value) VALUES ('replay_link', ?)").run(secret.toString('base64url'));
  return secret;
}

const signature = (secret: Buffer, matchId: number, exp: number) =>
  createHmac('sha256', secret).update(`replay:${matchId}:${exp}`).digest('base64url');

/** Token `<expiração em segundos, base 36>.<assinatura>`, ligado ao id da partida. */
export function signReplayToken(secret: Buffer, matchId: number, exp: number): string {
  return `${exp.toString(36)}.${signature(secret, matchId, exp)}`;
}

/** Confere o token: `ok`, `expired` ou `invalid` (malformado, de outra partida ou assinatura errada). */
export function checkReplayToken(secret: Buffer, matchId: number, token: unknown, nowS: number): 'ok' | 'expired' | 'invalid' {
  if (typeof token !== 'string' || token.length > 128) return 'invalid';
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return 'invalid';
  const exp = parseInt(m[1], 36);
  const expected = Buffer.from(signature(secret, matchId, exp));
  const got = Buffer.from(m[2]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return 'invalid';
  return exp > nowS ? 'ok' : 'expired';
}

/** Valor de `frame-ancestors` para a página do replay: o próprio site e as origens dos parceiros. */
export const frameAncestors = (origins: string[]) => ["'self'", ...origins].join(' ');

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  /** REPLAY_EMBED_ORIGINS: sites que podem pôr o replay num iframe (e mandar comandos por postMessage). */
  origins: string[];
  secret: Buffer;
  now?: () => number;
  /** Entrega o index.html (só com a interface compilada; em desenvolvimento quem serve a página é o Vite). */
  sendIndex?: (reply: FastifyReply) => FastifyReply;
}

export function registerReplayLinkRoutes(app: FastifyInstance, { db, user, present, origins, secret, now = Date.now, sendIndex }: Deps) {
  const nowS = () => Math.floor(now() / 1000);

  /**
   * Link assinado para o replay embutido (1 hora, só esta partida, sem sessão). Mesmas regras de
   * acesso de `GET /api/matches/:id/replay`. Corpo opcional: `lang` (ex.: pt-BR), `layout`
   * (tablet | lateral) e `embed` (padrão true: sem os botões de sair e de baixar).
   */
  app.post<{ Params: { id: string }; Body: { lang?: unknown; layout?: unknown; embed?: unknown } | null }>(
    '/api/matches/:id/replay-link',
    { config: { scope: 'matches:read' } },
    async (req, reply) => {
      const me = user(req);
      if (!me) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
      const denied = replayDenied(db, me, id);
      if (denied) return reply.code(denied.status).send(denied.body);
      if (!matchReplay(db, id)) return reply.code(404).send(fail('noReplay', 'Esta partida não tem replay gravado.'));
      const exp = nowS() + REPLAY_LINK_TTL_S;
      const token = signReplayToken(secret, id, exp);
      const body = req.body ?? {};
      const params = new URLSearchParams({ t: token });
      if (body.embed !== false) params.set('embed', '1');
      if (typeof body.lang === 'string' && LANG_RE.test(body.lang)) params.set('lang', body.lang);
      if (typeof body.layout === 'string' && (LAYOUTS as readonly string[]).includes(body.layout)) params.set('layout', body.layout);
      const url = `${req.protocol}://${req.host}${REPLAY_PAGE}${id}?${params}`;
      return reply.code(201).header('cache-control', 'no-store').send({ url, token, matchId: id, expiresAt: new Date(exp * 1000).toISOString() });
    },
  );

  /**
   * O replay para a página embutida: o arquivo de replay, as definições das cartas usadas e as
   * origens dos parceiros. A credencial é o token (`?t=`); não usa cookie nem Bearer.
   */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/replay/:id', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const id = Number(req.params.id);
    const check = Number.isInteger(id) && id > 0 ? checkReplayToken(secret, id, req.query.t, nowS()) : 'invalid';
    if (check === 'expired') return reply.code(401).send(fail('replay_link_expired', 'Este link de replay expirou; peça um novo.'));
    if (check !== 'ok') return reply.code(401).send(fail('replay_link_invalid', 'Link de replay inválido.'));
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    // Torneio em andamento: as listas continuam fechadas, mesmo com um link assinado.
    if (m.tournament && getTournament(db, m.tournament.id)?.status !== 'finished') {
      return reply.code(403).send(fail('replayTournamentRunning', 'O replay desta partida fica disponível quando o torneio terminar (as listas dos decks só se abrem no fim).'));
    }
    const replay = matchReplay(db, id) as { decks?: Array<{ leader: string; cards: Array<{ id: string }> }> } | null;
    if (!replay) return reply.code(404).send(fail('noReplay', 'Esta partida não tem replay gravado.'));
    const used = [...new Set((replay.decks ?? []).flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
    const cards: CardData[] = present(getCards(db, used));
    return { replay, cards, origins };
  });

  // A página: o mesmo index.html do site, mas que pode ir para um iframe nas origens dos parceiros.
  app.get('/replay/:id', async (_req, reply) => {
    reply
      .header('content-security-policy', `frame-ancestors ${frameAncestors(origins)}`)
      // O token está no endereço: não vai no Referer para ninguém.
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'no-store');
    return sendIndex ? sendIndex(reply) : reply.code(404).send(fail('notFound', 'Não encontrado'));
  });
}
