// SQL dos amigos: o código de amigo de cada conta e as amizades (tabelas `friend_codes` e
// `friendships`, ver `migrateFriends` em db.ts). Amizade é entre contas Google: o navegador
// sem login não tem lista de amigos.

import { randomInt } from 'node:crypto';
import type { DB } from '../db';

/** Mesmo alfabeto dos códigos de sala (sem 0/O, 1/I): fácil de ditar e de digitar no celular. */
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const FRIEND_CODE_LENGTH = 8;
/** Teto de amigos (aceitos e pedidos enviados) por conta. */
export const MAX_FRIENDS = 200;

export const isFriendCode = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp(`^[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_LENGTH}}$`).test(v.trim().toUpperCase());

/** Código de amigo da conta; nasce na primeira vez que é pedido. */
export function friendCode(db: DB, userId: string): string {
  const row = db.prepare('SELECT code FROM friend_codes WHERE user_id = ?').get(userId) as { code: string } | undefined;
  if (row) return row.code;
  for (;;) {
    const code = Array.from({ length: FRIEND_CODE_LENGTH }, () => FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)]).join('');
    const taken = db.prepare('SELECT 1 FROM friend_codes WHERE code = ?').get(code);
    if (taken) continue;
    db.prepare('INSERT INTO friend_codes (user_id, code) VALUES (?, ?)').run(userId, code);
    return code;
  }
}

/** Conta dona do código (null se não existe). */
export function userByFriendCode(db: DB, code: string): string | null {
  const row = db.prepare('SELECT user_id FROM friend_codes WHERE code = ?').get(code.trim().toUpperCase()) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export type FriendStatus = 'pending' | 'accepted';

export interface Friendship {
  /** A outra conta. */
  other: string;
  status: FriendStatus;
  /** Quem pediu foi eu (pedido enviado) ou a outra conta (pedido recebido). */
  mine: boolean;
  createdAt: string;
  acceptedAt: string | null;
}

type Row = { user_low: string; user_high: string; requested_by: string; status: FriendStatus; created_at: string; accepted_at: string | null };

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

const toFriendship = (me: string, r: Row): Friendship => ({
  other: r.user_low === me ? r.user_high : r.user_low,
  status: r.status,
  mine: r.requested_by === me,
  createdAt: r.created_at,
  acceptedAt: r.accepted_at,
});

export function friendship(db: DB, me: string, other: string): Friendship | null {
  const [low, high] = pair(me, other);
  const row = db.prepare('SELECT * FROM friendships WHERE user_low = ? AND user_high = ?').get(low, high) as Row | undefined;
  return row ? toFriendship(me, row) : null;
}

export const areFriends = (db: DB, a: string, b: string) => friendship(db, a, b)?.status === 'accepted';

/** Amizades e pedidos (enviados e recebidos) da conta. */
export function listFriendships(db: DB, me: string): Friendship[] {
  return (db.prepare('SELECT * FROM friendships WHERE user_low = ? OR user_high = ? ORDER BY created_at').all(me, me) as Row[]).map((r) =>
    toFriendship(me, r),
  );
}

/** Amigos aceitos mais pedidos enviados: o que conta para o teto (pedidos recebidos não contam). */
export function friendSlots(db: DB, me: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM friendships WHERE (user_low = ? OR user_high = ?) AND (status = 'accepted' OR requested_by = ?)")
    .get(me, me, me) as { n: number };
  return Number(row.n);
}

/**
 * Pede amizade. Se a outra conta já tinha pedido, o pedido vira amizade (`accepted`).
 * Devolve o estado depois do pedido e se ele mudou alguma coisa.
 */
export function requestFriend(db: DB, me: string, other: string): { status: FriendStatus; changed: boolean } {
  const found = friendship(db, me, other);
  if (found?.status === 'accepted') return { status: 'accepted', changed: false };
  if (found && found.mine) return { status: 'pending', changed: false };
  if (found) {
    acceptFriend(db, me, other);
    return { status: 'accepted', changed: true };
  }
  const [low, high] = pair(me, other);
  db.prepare('INSERT INTO friendships (user_low, user_high, requested_by) VALUES (?, ?, ?)').run(low, high, me);
  return { status: 'pending', changed: true };
}

/** Aceita o pedido que a outra conta fez. false se não havia pedido dela. */
export function acceptFriend(db: DB, me: string, other: string): boolean {
  const [low, high] = pair(me, other);
  const r = db
    .prepare("UPDATE friendships SET status = 'accepted', accepted_at = datetime('now') WHERE user_low = ? AND user_high = ? AND status = 'pending' AND requested_by = ?")
    .run(low, high, other);
  return Number(r.changes) > 0;
}

/** Recusa, cancela ou desfaz: apaga a linha do par, qualquer que seja o estado. */
export function removeFriend(db: DB, me: string, other: string): boolean {
  const [low, high] = pair(me, other);
  return Number(db.prepare('DELETE FROM friendships WHERE user_low = ? AND user_high = ?').run(low, high).changes) > 0;
}
