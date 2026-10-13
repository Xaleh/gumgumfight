// Notificações: o navegador se inscreve (PUT /api/push/subscription) quando a pessoa liga
// os avisos nas configurações e se descadastra (DELETE) quando desliga. Os avisos saem
// das salas online (oponente chegou, sua vez) e dos torneios (check-in, rodada nova,
// oponente esperando na sala); `Notifier` é o que essas partes chamam.
//
// O service worker do app não mostra o aviso quando o app está aberto na tela: a
// notificação só aparece para quem está com o app em segundo plano ou fechado.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import { pushLocale } from './messages';
import { deletePushSubscription, type PushCategory, type PushSubscriptionRow, pushSubscriptionsFor, savePushSubscription } from './store';
import { allowedEndpoint, type PushOptions, type PushTarget, sendPush, validKeys, type VapidKeys } from './webpush';

/** O que o service worker recebe (ver apps/web/src/service-worker.js). */
export interface PushPayload {
  title: string;
  body: string;
  /** Avisos com a mesma etiqueta se substituem no aparelho (ex.: um por sala). */
  tag: string;
  /** Endereço aberto ao tocar no aviso. */
  url: string;
}

export interface PushNote {
  category: PushCategory;
  /** Título e texto no idioma de cada inscrição. */
  text: (locale: string) => { title: string; body: string };
  tag: string;
  url: string;
  ttl: number;
  urgency?: PushOptions['urgency'];
}

export interface Notifier {
  /** Avisa um navegador (`ownerHash`) e/ou contas (`userIds`). Nunca falha: erros só vão para o log. */
  notify(who: { ownerHash?: string | null; userIds?: Array<string | null | undefined> }, note: PushNote): Promise<void>;
}

/** Envio de uma mensagem: devolve o status HTTP do serviço de push. Os testes trocam por uma função que só anota. */
export type PushSender = (target: PushTarget, payload: PushPayload, opts: PushOptions) => Promise<number>;

/** Notificações desligadas: ninguém é avisado. */
export const noNotifier: Notifier = { notify: async () => undefined };

interface Deps {
  db: DB;
  /** Navegador que pede (hash do código de dono), ou null sem o header. */
  browserHash: (req: FastifyRequest) => string | null;
  user: (req: FastifyRequest) => User | null;
  /** Chaves VAPID (null = notificações desligadas: `pushKey` volta null em /api/config). */
  keys: VapidKeys | null;
  /** Contato do servidor para os serviços de push (mailto: ou https:). */
  subject: string;
  send?: PushSender;
  log?: (msg: string) => void;
}

type SubscriptionBody = {
  subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  locale?: unknown;
  matches?: unknown;
  tournaments?: unknown;
};

export function registerPushRoutes(app: FastifyInstance, { db, browserHash, user, keys, subject, send, log = () => undefined }: Deps): Notifier {
  /** Grava ou atualiza a inscrição deste navegador (o app repete a chamada ao trocar de idioma, de conta ou de avisos). */
  app.put<{ Body: SubscriptionBody }>('/api/push/subscription', async (req, reply) => {
    if (!keys) return reply.code(503).send(fail('pushDisabled', 'As notificações estão desligadas neste servidor.'));
    const owner = browserHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    const sub = req.body?.subscription;
    if (!allowedEndpoint(sub?.endpoint) || !validKeys(sub?.keys?.p256dh, sub?.keys?.auth)) {
      return reply.code(400).send(fail('invalidPushSubscription', 'Inscrição de notificações inválida.'));
    }
    savePushSubscription(db, {
      endpoint: sub.endpoint,
      p256dh: sub.keys!.p256dh as string,
      auth: sub.keys!.auth as string,
      ownerHash: owner,
      userId: user(req)?.id ?? null,
      locale: pushLocale(req.body?.locale),
      matches: req.body?.matches !== false,
      tournaments: req.body?.tournaments !== false,
    });
    return reply.code(204).send();
  });

  app.delete<{ Body: { endpoint?: unknown } }>('/api/push/subscription', async (req, reply) => {
    if (typeof req.body?.endpoint === 'string') deletePushSubscription(db, req.body.endpoint);
    return reply.code(204).send();
  });

  if (!keys) return noNotifier;
  const deliver: PushSender = send ?? ((target, payload, opts) => sendPush(target, payload, keys, subject, opts));

  const one = async (s: PushSubscriptionRow, note: PushNote) => {
    try {
      const status = await deliver(s, { ...note.text(s.locale), tag: note.tag, url: note.url }, { ttl: note.ttl, urgency: note.urgency });
      // A pessoa desinstalou o app, limpou os dados ou revogou a permissão: a inscrição não vale mais.
      if (status === 404 || status === 410) deletePushSubscription(db, s.endpoint);
      else if (status >= 400) log(`Notificação recusada pelo serviço de push (${status}): ${new URL(s.endpoint).host}`);
    } catch (e) {
      log(`Falha ao enviar notificação: ${e instanceof Error ? e.message : e}`);
    }
  };

  return {
    async notify(who, note) {
      try {
        const userIds = (who.userIds ?? []).filter((u): u is string => typeof u === 'string');
        await Promise.all(pushSubscriptionsFor(db, { ownerHash: who.ownerHash, userIds }, note.category).map((s) => one(s, note)));
      } catch (e) {
        log(`Falha ao preparar notificação: ${e instanceof Error ? e.message : e}`);
      }
    },
  };
}
