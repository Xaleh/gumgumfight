// SQL das contas: usuários do Google, sessões e a passagem dos dados do navegador para a conta.

import { createHash, randomBytes } from 'node:crypto';
import { type DB, transaction } from '../db';
import type { GoogleIdentity } from './google';

export const SESSION_DAYS = 60;

/**
 * Perfil da conta. player: joga e assiste às partidas sem ver as mãos; streamer:
 * pode assistir vendo as mãos dos dois jogadores; organizer: cria e gerencia
 * torneios; admin: tudo isso, gerencia qualquer torneio e muda os perfis; dev: tudo
 * do admin e as funções de desenvolvimento (ferramentas manuais, cobertura, testes).
 */
export const ROLES = ['player', 'streamer', 'organizer', 'admin', 'dev'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);
/** Poderes de administrador (o Dev é um Admin com as ferramentas de desenvolvimento). */
export const isAdmin = (role: Role | undefined) => role === 'admin' || role === 'dev';
/**
 * Funções de desenvolvimento: ferramentas manuais na partida, cobertura das cartas,
 * opções de teste. Escondidas do público em geral.
 */
export const isDev = (role: Role | undefined) => role === 'dev';
/** Pode assistir às partidas vendo as mãos. */
export const seesHands = (role: Role | undefined) => role === 'streamer' || isAdmin(role);
/** Pode criar torneios (e gerenciar os que criou; o admin gerencia todos). */
export const createsTournaments = (role: Role | undefined) => role === 'organizer' || isAdmin(role);

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  /** Foto mostrada: a enviada pelo usuário (URL do servidor) ou, sem ela, a do Google. */
  picture: string | null;
  /** O usuário enviou a própria foto (pode voltar para a do Google). */
  customPicture: boolean;
  role: Role;
}

/**
 * Chave de dono de uma conta, gravada em decks.owner_hash e players.owner_hash no
 * lugar do hash do código do navegador. Nunca colide com um SHA-256 em hexadecimal.
 */
export const accountOwnerKey = (userId: string) => `user:${userId}`;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type UserRow = { id: string; email: string | null; name: string | null; picture: string | null; custom_picture_at: number | null; role: string };
const USER_COLS = 'id, email, name, picture, custom_picture_at, role';
/** Endereço da foto enviada; a versão no endereço deixa o navegador guardar a imagem para sempre. */
const customPictureUrl = (id: string, version: number) => `/api/users/${encodeURIComponent(id)}/picture?v=${version}`;
const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  picture: r.custom_picture_at ? customPictureUrl(r.id, r.custom_picture_at) : r.picture,
  customPicture: r.custom_picture_at != null,
  role: isRole(r.role) ? r.role : 'player',
});

/**
 * Cria a conta no primeiro login; nos seguintes, atualiza nome, e-mail e foto do Google
 * (a foto enviada pelo usuário, se houver, continua valendo).
 * `adminEmails`: e-mails (verificados pelo Google) que viram admin ao entrar (um Dev
 * continua Dev, que já é admin).
 */
export function upsertGoogleUser(db: DB, g: GoogleIdentity, adminEmails: string[] = []): User {
  const found = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(g.sub) as { id: string } | undefined;
  const id = found?.id ?? `u-${randomBytes(6).toString('hex')}`;
  db.prepare(`
    INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
      picture = excluded.picture, last_login_at = datetime('now')
  `).run(id, g.sub, g.email, g.name, g.picture);
  const user = getUser(db, id)!;
  if (g.emailVerified && g.email && adminEmails.includes(g.email.toLowerCase()) && !isAdmin(user.role)) {
    setUserRole(db, id, 'admin');
    user.role = 'admin';
  }
  return user;
}

export function getUser(db: DB, id: string): User | null {
  const r = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

/** Tipos aceitos na foto enviada (o tipo vem dos primeiros bytes, não do que o navegador diz). */
export type PictureType = 'image/jpeg' | 'image/png' | 'image/webp';

export function pictureType(data: Uint8Array): PictureType | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => data[i + k] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/** Grava a foto enviada pelo usuário (`data` = null volta para a foto do Google). */
export function setCustomPicture(db: DB, id: string, picture: { data: Uint8Array; type: PictureType } | null): boolean {
  const res = picture
    ? db
        .prepare('UPDATE users SET custom_picture = ?, custom_picture_type = ?, custom_picture_at = ? WHERE id = ?')
        // A versão sempre cresce, mesmo com duas trocas no mesmo milissegundo.
        .run(picture.data, picture.type, Math.max(Date.now(), lastPictureVersion(db, id) + 1), id)
    : db.prepare('UPDATE users SET custom_picture = NULL, custom_picture_type = NULL, custom_picture_at = NULL WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

const lastPictureVersion = (db: DB, id: string) =>
  (db.prepare('SELECT custom_picture_at AS v FROM users WHERE id = ?').get(id) as { v: number | null } | undefined)?.v ?? 0;

export function getCustomPicture(db: DB, id: string): { data: Uint8Array; type: string } | null {
  const r = db.prepare('SELECT custom_picture AS data, custom_picture_type AS type FROM users WHERE id = ? AND custom_picture IS NOT NULL').get(id) as
    | { data: Uint8Array; type: string }
    | undefined;
  return r ?? null;
}

export function setUserRole(db: DB, id: string, role: Role): boolean {
  return Number(db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id).changes) > 0;
}

export interface UserListItem extends User {
  createdAt: string;
  lastLoginAt: string;
}

/** Contas para a tela de perfis: busca por nome ou e-mail; quem tem perfil especial vem primeiro. */
export function listUsers(db: DB, query = '', limit = 50): UserListItem[] {
  const q = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `SELECT ${USER_COLS}, created_at, last_login_at FROM users
       WHERE COALESCE(name, '') LIKE ? ESCAPE '\\' OR COALESCE(email, '') LIKE ? ESCAPE '\\'
       ORDER BY CASE role WHEN 'dev' THEN 0 WHEN 'admin' THEN 0 WHEN 'organizer' THEN 1 WHEN 'streamer' THEN 2 ELSE 3 END, last_login_at DESC
       LIMIT ?`,
    )
    .all(q, q, limit) as Array<UserRow & { created_at: string; last_login_at: string }>;
  return rows.map((r) => ({ ...toUser(r), createdAt: r.created_at, lastLoginAt: r.last_login_at }));
}

/** Abre uma sessão e devolve o token (que só o cookie do navegador guarda). */
export function createSession(db: DB, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    hashToken(token),
    userId,
    `+${SESSION_DAYS} days`,
  );
  return token;
}

export function sessionUser(db: DB, token: string): User | null {
  const r = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture, u.custom_picture_at, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(hashToken(token)) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function deleteSession(db: DB, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/**
 * Leva para a conta o que foi criado neste navegador antes do login: os decks e o
 * perfil de estatísticas. Se a conta já tinha perfil, as partidas do navegador
 * passam para ele e o perfil do navegador é apagado (a recompensa da conta fica).
 */
export function claimBrowserData(db: DB, browserHash: string, userId: string): { decks: number } {
  const account = accountOwnerKey(userId);
  return transaction(db, () => {
    const decks = Number(
      db.prepare("UPDATE decks SET owner_hash = ? WHERE owner_hash = ? AND kind = 'user'").run(account, browserHash).changes,
    );
    const anon = db.prepare('SELECT id FROM players WHERE owner_hash = ?').get(browserHash) as { id: string } | undefined;
    if (anon) {
      const mine = db.prepare('SELECT id FROM players WHERE owner_hash = ?').get(account) as { id: string } | undefined;
      if (mine) {
        db.prepare('UPDATE match_seats SET player_id = ? WHERE player_id = ?').run(mine.id, anon.id);
        db.prepare('DELETE FROM players WHERE id = ?').run(anon.id);
      } else {
        db.prepare("UPDATE players SET owner_hash = ?, updated_at = datetime('now') WHERE id = ?").run(account, anon.id);
      }
    }
    return { decks };
  });
}
