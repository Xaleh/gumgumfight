// Modo transmissão: o streamer coloca a tela de transmissão do app como fonte no OBS
// (`/?transmissao=<chave>`) e escolhe no app qual partida vai para a live.
//
// A fonte do OBS é um navegador embutido, onde não dá para entrar com o Google: a chave do
// link faz as vezes do login, só para assistir (ver as mãos continua exigindo o perfil, que é
// conferido a cada pedido, e a mesa com as mãos chega atrasada). A chave fica guardada como
// está, para o streamer copiar o link de novo; gerar outra invalida o link antigo.

import { randomBytes } from 'node:crypto';
import { getUser, type User } from '../auth/store';
import type { DB } from '../db';

export interface Broadcast {
  key: string;
  /** Partida na transmissão (null = nenhuma). */
  roomId: string | null;
  /** Com as mãos dos jogadores (na mesa atrasada). */
  hands: boolean;
}

type Row = { key: string; room_id: string | null; hands: number };
const toBroadcast = (r: Row): Broadcast => ({ key: r.key, roomId: r.room_id, hands: r.hands === 1 });

/** Chaves têm 32 caracteres base64url. */
export const isBroadcastKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32}$/.test(v);

export function getBroadcast(db: DB, userId: string): Broadcast | null {
  const r = db.prepare('SELECT key, room_id, hands FROM broadcasts WHERE user_id = ?').get(userId) as Row | undefined;
  return r ? toBroadcast(r) : null;
}

/** Gera a chave da conta (ou uma nova, que invalida o link antigo); a partida escolhida continua. */
export function newBroadcastKey(db: DB, userId: string): Broadcast {
  const key = randomBytes(24).toString('base64url');
  db.prepare(
    `INSERT INTO broadcasts (user_id, key) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET key = excluded.key, updated_at = datetime('now')`,
  ).run(userId, key);
  return getBroadcast(db, userId)!;
}

/** Troca a partida da transmissão (só para quem já tem a chave). */
export function setBroadcastRoom(db: DB, userId: string, roomId: string | null, hands: boolean): Broadcast | null {
  db.prepare("UPDATE broadcasts SET room_id = ?, hands = ?, updated_at = datetime('now') WHERE user_id = ?").run(roomId, hands ? 1 : 0, userId);
  return getBroadcast(db, userId);
}

/** Dono da chave e a transmissão dele. */
export function broadcastByKey(db: DB, key: string): { user: User; broadcast: Broadcast } | null {
  if (!isBroadcastKey(key)) return null;
  const r = db.prepare('SELECT user_id, key, room_id, hands FROM broadcasts WHERE key = ?').get(key) as (Row & { user_id: string }) | undefined;
  const user = r ? getUser(db, r.user_id) : null;
  return r && user ? { user, broadcast: toBroadcast(r) } : null;
}
