// SQL das notificações: inscrições dos navegadores e o par de chaves VAPID do servidor.

import type { DB } from '../db';
import { generateVapidKeys, type PushTarget, type VapidKeys } from './webpush';

/** Tipos de aviso que a pessoa pode ligar ou desligar. */
export type PushCategory = 'matches' | 'tournaments';

export interface PushSubscriptionRow extends PushTarget {
  ownerHash: string;
  userId: string | null;
  locale: string;
  matches: boolean;
  tournaments: boolean;
}

type Row = {
  endpoint: string;
  p256dh: string;
  auth: string;
  owner_hash: string;
  user_id: string | null;
  locale: string;
  matches: number;
  tournaments: number;
};

const toSub = (r: Row): PushSubscriptionRow => ({
  endpoint: r.endpoint,
  p256dh: r.p256dh,
  auth: r.auth,
  ownerHash: r.owner_hash,
  userId: r.user_id,
  locale: r.locale,
  matches: Boolean(r.matches),
  tournaments: Boolean(r.tournaments),
});

/** Grava (ou atualiza) a inscrição de um navegador: dono, conta, idioma e avisos escolhidos. */
export function savePushSubscription(db: DB, s: PushSubscriptionRow) {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, owner_hash, user_id, locale, matches, tournaments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, owner_hash = excluded.owner_hash,
       user_id = excluded.user_id, locale = excluded.locale, matches = excluded.matches, tournaments = excluded.tournaments,
       updated_at = datetime('now')`,
  ).run(s.endpoint, s.p256dh, s.auth, s.ownerHash, s.userId, s.locale, s.matches ? 1 : 0, s.tournaments ? 1 : 0);
}

export function deletePushSubscription(db: DB, endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

/** Inscrições de um navegador ou de uma conta que querem este tipo de aviso. */
export function pushSubscriptionsFor(db: DB, who: { ownerHash?: string | null; userIds?: string[] }, category: PushCategory): PushSubscriptionRow[] {
  const users = [...new Set(who.userIds ?? [])];
  const where = [
    ...(who.ownerHash ? ['owner_hash = ?'] : []),
    ...(users.length ? [`user_id IN (${users.map(() => '?').join(', ')})`] : []),
  ];
  if (!where.length) return [];
  const params = [...(who.ownerHash ? [who.ownerHash] : []), ...users];
  return (
    db.prepare(`SELECT * FROM push_subscriptions WHERE (${where.join(' OR ')}) AND ${category} = 1`).all(...params) as Row[]
  ).map(toSub);
}

/** Par de chaves VAPID: o das variáveis de ambiente ou, sem elas, um gerado na primeira vez e guardado no banco. */
export function vapidKeys(db: DB, env: { publicKey?: string | null; privateKey?: string | null } = {}): VapidKeys {
  if (env.publicKey && env.privateKey) return { publicKey: env.publicKey, privateKey: env.privateKey };
  const row = db.prepare("SELECT value FROM server_keys WHERE name = 'vapid'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as VapidKeys;
  const keys = generateVapidKeys();
  db.prepare("INSERT INTO server_keys (name, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}
