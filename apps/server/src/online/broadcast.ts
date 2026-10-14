// Modo transmissão: o streamer coloca a tela de transmissão do app como fonte no OBS
// (`/?transmissao=<chave>`) e escolhe no app qual partida vai para a live e o que ela mostra.
//
// A fonte do OBS é um navegador embutido, onde não dá para entrar com o Google: a chave do
// link faz as vezes do login, só para assistir (o perfil é conferido a cada pedido). A chave
// fica guardada como está, para o streamer copiar o link de novo; gerar outra invalida a antiga.
//
// O que a live mostra (`broadcastView`) sai das opções do streamer:
// - partida de outros: as mãos dos dois jogadores (`handsPlayers`), sempre com atraso de pelo
//   menos MIN_HANDS_DELAY_MS, ou só a visão pública;
// - partida que ele joga: a mão dele (`handsOwn`, com o atraso que escolher, até 0) ou a pública;
// - sem mãos, a mesa é ao vivo, exceto nas partidas de torneio com `delayTournaments`.

import { randomBytes } from 'node:crypto';
import type { PlayerId } from '@gumgum/engine';
import { accountOwnerKey, getUser, type User } from '../auth/store';
import type { DB } from '../db';
import { type Connection, HANDS_DELAY_MS, MAX_DELAY_MS, MIN_HANDS_DELAY_MS, type Room } from './room';

/** Opções da transmissão que o streamer escolhe. */
export interface BroadcastSettings {
  /** Atraso escolhido, em segundos (0 a MAX_DELAY_MS). */
  delayS: number;
  handsPlayers: boolean;
  handsOwn: boolean;
  delayTournaments: boolean;
  /** Chat dos jogadores na tela de transmissão. */
  chat: boolean;
}

export interface Broadcast extends BroadcastSettings {
  key: string;
  /** Partida na transmissão (null = nenhuma). */
  roomId: string | null;
  /** Versão: muda a cada troca de partida ou de opção (a tela de transmissão reconecta). */
  rev: number;
}

export const DEFAULT_SETTINGS: BroadcastSettings = {
  delayS: HANDS_DELAY_MS / 1000,
  handsPlayers: true,
  handsOwn: false,
  delayTournaments: false,
  chat: true,
};

type Row = {
  key: string;
  room_id: string | null;
  delay_s: number;
  hands_players: number;
  hands_own: number;
  delay_tournaments: number;
  chat: number;
  rev: number;
};
const COLS = 'key, room_id, delay_s, hands_players, hands_own, delay_tournaments, chat, rev';
const toBroadcast = (r: Row): Broadcast => ({
  key: r.key,
  roomId: r.room_id,
  delayS: r.delay_s,
  handsPlayers: r.hands_players === 1,
  handsOwn: r.hands_own === 1,
  delayTournaments: r.delay_tournaments === 1,
  chat: r.chat === 1,
  rev: r.rev,
});

/** Chaves têm 32 caracteres base64url. */
export const isBroadcastKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32}$/.test(v);

export function getBroadcast(db: DB, userId: string): Broadcast | null {
  const r = db.prepare(`SELECT ${COLS} FROM broadcasts WHERE user_id = ?`).get(userId) as Row | undefined;
  return r ? toBroadcast(r) : null;
}

/** Gera a chave da conta (ou uma nova, que invalida o link antigo); partida e opções continuam. */
export function newBroadcastKey(db: DB, userId: string): Broadcast {
  const key = randomBytes(24).toString('base64url');
  db.prepare(
    `INSERT INTO broadcasts (user_id, key) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET key = excluded.key, rev = rev + 1, updated_at = datetime('now')`,
  ).run(userId, key);
  return getBroadcast(db, userId)!;
}

/** Troca a partida da transmissão (só para quem já tem a chave). */
export function setBroadcastRoom(db: DB, userId: string, roomId: string | null): Broadcast | null {
  db.prepare("UPDATE broadcasts SET room_id = ?, rev = rev + 1, updated_at = datetime('now') WHERE user_id = ?").run(roomId, userId);
  return getBroadcast(db, userId);
}

/** Opções válidas a partir do corpo do pedido (campos ausentes ou inválidos ficam como estavam). */
export function parseSettings(body: Record<string, unknown> | undefined, current: BroadcastSettings): BroadcastSettings {
  const flag = (v: unknown, old: boolean) => (typeof v === 'boolean' ? v : old);
  const delay = body?.delayS;
  return {
    delayS: typeof delay === 'number' && Number.isFinite(delay) ? Math.round(Math.min(MAX_DELAY_MS / 1000, Math.max(0, delay))) : current.delayS,
    handsPlayers: flag(body?.handsPlayers, current.handsPlayers),
    handsOwn: flag(body?.handsOwn, current.handsOwn),
    delayTournaments: flag(body?.delayTournaments, current.delayTournaments),
    chat: flag(body?.chat, current.chat),
  };
}

export function setBroadcastSettings(db: DB, userId: string, s: BroadcastSettings): Broadcast | null {
  db.prepare(
    `UPDATE broadcasts SET delay_s = ?, hands_players = ?, hands_own = ?, delay_tournaments = ?, chat = ?, rev = rev + 1,
       updated_at = datetime('now') WHERE user_id = ?`,
  ).run(s.delayS, s.handsPlayers ? 1 : 0, s.handsOwn ? 1 : 0, s.delayTournaments ? 1 : 0, s.chat ? 1 : 0, userId);
  return getBroadcast(db, userId);
}

/** Dono da chave e a transmissão dele. */
export function broadcastByKey(db: DB, key: string): { user: User; broadcast: Broadcast } | null {
  if (!isBroadcastKey(key)) return null;
  const r = db.prepare(`SELECT user_id, ${COLS} FROM broadcasts WHERE key = ?`).get(key) as (Row & { user_id: string }) | undefined;
  const user = r ? getUser(db, r.user_id) : null;
  return r && user ? { user, broadcast: toBroadcast(r) } : null;
}

/** Assento que a conta joga na sala (null = só assiste). */
export function seatOfUser(room: Room, user: User): PlayerId | null {
  const i = room.data.seats.findIndex((s) => !s.bot && (s.userId === user.id || s.ownerHash === accountOwnerKey(user.id)));
  return i === 0 || i === 1 ? i : null;
}

/** O que a conexão da tela de transmissão recebe nesta sala (ver o começo do arquivo). */
export function broadcastView(s: BroadcastSettings, room: Room, user: User): Pick<Connection, 'hands' | 'as' | 'delay'> {
  const delay = s.delayS * 1000;
  const plain = room.data.queue === 'tournament' && s.delayTournaments ? delay : 0;
  const seat = seatOfUser(room, user);
  if (seat !== null) return s.handsOwn ? { as: seat, delay } : { delay: plain };
  if (s.handsPlayers) return { hands: true, delay: Math.max(MIN_HANDS_DELAY_MS, delay) };
  return { delay: plain };
}

/** Atraso de quem vê as mãos no app (o escolhido nas opções da transmissão, nunca abaixo do mínimo). */
export function handsDelayFor(db: DB, userId: string): number {
  const s = getBroadcast(db, userId) ?? DEFAULT_SETTINGS;
  return Math.max(MIN_HANDS_DELAY_MS, s.delayS * 1000);
}
