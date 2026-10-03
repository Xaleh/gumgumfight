// SQL das contas: usuários do Google, sessões e a passagem dos dados do navegador para a conta.

import { createHash, randomBytes } from 'node:crypto';
import { type DB, transaction } from '../db';
import type { GoogleIdentity } from './google';

export const SESSION_DAYS = 60;

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * Chave de dono de uma conta, gravada em decks.owner_hash e players.owner_hash no
 * lugar do hash do código do navegador. Nunca colide com um SHA-256 em hexadecimal.
 */
export const accountOwnerKey = (userId: string) => `user:${userId}`;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type UserRow = { id: string; email: string | null; name: string | null; picture: string | null };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, picture: r.picture });

/** Cria a conta no primeiro login; nos seguintes, atualiza nome, e-mail e foto. */
export function upsertGoogleUser(db: DB, g: GoogleIdentity): User {
  const found = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(g.sub) as { id: string } | undefined;
  const id = found?.id ?? `u-${randomBytes(6).toString('hex')}`;
  db.prepare(`
    INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
      picture = excluded.picture, last_login_at = datetime('now')
  `).run(id, g.sub, g.email, g.name, g.picture);
  return { id, email: g.email, name: g.name, picture: g.picture };
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
      `SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
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
