// SQL das contas: usuários do Google, sessões e a passagem dos dados do navegador para a conta.

import { createHash, randomBytes } from 'node:crypto';
import { type DB, transaction } from '../db';
import { atLeast, isSupporterTier, PAYMENT_GRACE_DAYS, type SupporterTier, tierRank } from '../support/tiers';
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
  picture: string | null;
  role: Role;
  /** Plano de apoio ativo agora (null = sem plano ou vencido). */
  supporterTier: SupporterTier | null;
  /** Até quando o plano vale (null = sem prazo). */
  supporterUntil: string | null;
  /** De onde veio o plano: manual (admin) ou kofi (pagamento). */
  supporterSource: 'manual' | 'kofi' | null;
  /** Aceitou aparecer na lista pública de Apoiadores. */
  supporterPublic: boolean;
}

/** Benefícios de apoiador também valem para quem administra o site (para testar e moderar). */
export const hasSupporterPerk = (u: User | null | undefined, min: SupporterTier) => Boolean(u && (isAdmin(u.role) || atLeast(u.supporterTier, min)));
/** Estatísticas Pro: ranqueada, torneios e filtro por faixa de recompensa. */
export const seesProStats = (u: User | null | undefined) => hasSupporterPerk(u, 'tripulante');

/**
 * Chave de dono de uma conta, gravada em decks.owner_hash e players.owner_hash no
 * lugar do hash do código do navegador. Nunca colide com um SHA-256 em hexadecimal.
 */
export const accountOwnerKey = (userId: string) => `user:${userId}`;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type UserRow = {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: string;
  supporter_tier: string | null;
  supporter_until: string | null;
  supporter_source: string | null;
  supporter_public: number;
};
const USER_COLS = 'id, email, name, picture, role, supporter_tier, supporter_until, supporter_source, supporter_public';

/** Plano que vale agora: o gravado, se não venceu. */
const activeTier = (r: Pick<UserRow, 'supporter_tier' | 'supporter_until'>, now = Date.now()): SupporterTier | null =>
  isSupporterTier(r.supporter_tier) && (!r.supporter_until || Date.parse(r.supporter_until) > now) ? r.supporter_tier : null;

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  picture: r.picture,
  role: isRole(r.role) ? r.role : 'player',
  supporterTier: activeTier(r),
  supporterUntil: r.supporter_until,
  supporterSource: r.supporter_source === 'kofi' ? 'kofi' : r.supporter_source === 'manual' ? 'manual' : null,
  supporterPublic: Boolean(r.supporter_public),
});

/**
 * Cria a conta no primeiro login; nos seguintes, atualiza nome, e-mail e foto.
 * `adminEmails`: e-mails (verificados pelo Google) que viram admin ao entrar (um Dev
 * continua Dev, que já é admin).
 */
export function upsertGoogleUser(db: DB, g: GoogleIdentity, adminEmails: string[] = []): User {
  const found = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(g.sub) as { id: string } | undefined;
  const id = found?.id ?? `u-${randomBytes(6).toString('hex')}`;
  db.prepare(`
    INSERT INTO users (id, google_sub, email, name, picture, email_verified) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
      picture = excluded.picture, email_verified = excluded.email_verified, last_login_at = datetime('now')
  `).run(id, g.sub, g.email, g.name, g.picture, g.emailVerified ? 1 : 0);
  const user = getUser(db, id)!;
  if (g.emailVerified && g.email && adminEmails.includes(g.email.toLowerCase()) && !isAdmin(user.role)) {
    setUserRole(db, id, 'admin');
    user.role = 'admin';
  }
  // Quem pagou o apoio antes de criar a conta (ou com o e-mail que acabou de confirmar) recebe o plano agora.
  if (g.emailVerified && g.email && claimSupporterPayments(db, id, g.email)) return getUser(db, id)!;
  return user;
}

export function getUser(db: DB, id: string): User | null {
  const r = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function setUserRole(db: DB, id: string, role: Role): boolean {
  return Number(db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id).changes) > 0;
}

/**
 * Plano dado à mão pelo admin (Pix mensal, parceria, cortesia). `until` null = sem
 * prazo; `tier` null tira o plano.
 */
export function setSupporter(db: DB, id: string, tier: SupporterTier | null, until: string | null): boolean {
  return (
    Number(
      db
        .prepare('UPDATE users SET supporter_tier = ?, supporter_until = ?, supporter_source = ? WHERE id = ?')
        .run(tier, tier ? until : null, tier ? 'manual' : null, id).changes,
    ) > 0
  );
}

export function setSupporterPublic(db: DB, id: string, visible: boolean) {
  db.prepare('UPDATE users SET supporter_public = ? WHERE id = ?').run(visible ? 1 : 0, id);
}

/**
 * Aplica um pagamento mensal à conta: o plano pago vale por PAYMENT_GRACE_DAYS a partir
 * do pagamento. Um plano manual maior e ainda válido é mantido (o admin decide sobre ele).
 */
export function applySupporterPayment(db: DB, userId: string, tier: SupporterTier, paidAt: string): boolean {
  const user = getUser(db, userId);
  if (!user) return false;
  const until = new Date(Date.parse(paidAt) + PAYMENT_GRACE_DAYS * 86_400_000).toISOString();
  if (user.supporterSource === 'manual' && tierRank(user.supporterTier) > tierRank(tier)) return false;
  // Um pagamento antigo (reenvio do webhook) não encurta um plano mais novo do mesmo nível.
  if (user.supporterSource === 'kofi' && user.supporterTier === tier && user.supporterUntil && user.supporterUntil > until) return false;
  db.prepare("UPDATE users SET supporter_tier = ?, supporter_until = ?, supporter_source = 'kofi' WHERE id = ?").run(tier, until, userId);
  return true;
}

/** Conta com este e-mail confirmado pelo Google (para aplicar pagamentos e responder à homologação). */
export function userByVerifiedEmail(db: DB, email: string): User | null {
  const r = db
    .prepare(`SELECT ${USER_COLS} FROM users WHERE lower(email) = ? AND email_verified = 1 ORDER BY last_login_at DESC LIMIT 1`)
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

/** O Google confirmou o e-mail desta conta. */
export const emailVerified = (db: DB, id: string) =>
  Boolean((db.prepare('SELECT email_verified FROM users WHERE id = ?').get(id) as { email_verified: number } | undefined)?.email_verified);

/** Pagamentos recentes feitos com este e-mail antes de a conta existir: o mais novo vira o plano. */
export function claimSupporterPayments(db: DB, userId: string, email: string): boolean {
  const since = new Date(Date.now() - PAYMENT_GRACE_DAYS * 86_400_000).toISOString();
  const last = db
    .prepare('SELECT tier, paid_at FROM supporter_payments WHERE email = ? AND tier IS NOT NULL AND paid_at > ? ORDER BY paid_at DESC LIMIT 1')
    .get(email.toLowerCase(), since) as { tier: string; paid_at: string } | undefined;
  db.prepare('UPDATE supporter_payments SET user_id = ? WHERE email = ? AND user_id IS NULL').run(userId, email.toLowerCase());
  return Boolean(last && isSupporterTier(last.tier) && applySupporterPayment(db, userId, last.tier, last.paid_at));
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
       ORDER BY CASE role WHEN 'dev' THEN 0 WHEN 'admin' THEN 0 WHEN 'organizer' THEN 1 WHEN 'streamer' THEN 2 ELSE 3 END,
         supporter_tier IS NULL, last_login_at DESC
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
      `SELECT ${USER_COLS.split(', ').map((c) => `u.${c}`).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id
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
