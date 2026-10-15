// SQL da API para parceiros: tokens de acesso (pessoais e do OAuth), clientes OAuth e os
// codes do fluxo de autorização. Do token, do code e do client_secret só o sha256 fica no
// banco; o texto aparece uma vez, na resposta que o cria.

import { createHash, randomBytes } from 'node:crypto';
import { type DB, transaction } from '../db';

/** Scopes que um token pode ter; `profile` é sempre concedido. */
export const SCOPES = ['profile', 'decks:read', 'decks:write', 'matches:read', 'stats:read'] as const;
export type Scope = (typeof SCOPES)[number];
export const isScope = (v: unknown): v is Scope => SCOPES.includes(v as Scope);

export type TokenKind = 'personal' | 'access' | 'refresh';

/** Prefixo legível de cada tipo: deixa óbvio o que vazou num log e o GitHub detecta tokens publicados por engano. */
const PREFIX: Record<TokenKind, string> = { personal: 'ggf_pat_', access: 'ggf_at_', refresh: 'ggf_rt_' };

/** Tokens pessoais ativos por conta. */
export const MAX_PERSONAL_TOKENS = 10;
/** Validade do access token do OAuth (segundos) e do refresh (dias, renovada a cada uso). */
export const ACCESS_TOKEN_SECONDS = 3600;
export const REFRESH_TOKEN_DAYS = 90;
/** Validade do code do OAuth (minutos). */
export const CODE_MINUTES = 5;

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Scopes normalizados: só os conhecidos, sem repetição, sempre com `profile`. */
export function normalizeScopes(list: Iterable<string>): Scope[] {
  const out = new Set<Scope>(['profile']);
  for (const s of list) if (isScope(s)) out.add(s);
  return SCOPES.filter((s) => out.has(s));
}

export const parseScopes = (text: string): Scope[] => normalizeScopes(text.split(/[\s,]+/).filter(Boolean));

export interface ApiToken {
  id: string;
  userId: string;
  clientId: string | null;
  kind: TokenKind;
  name: string | null;
  scopes: Scope[];
  parentId: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type TokenRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  kind: TokenKind;
  name: string | null;
  scopes: string;
  parent_id: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};
const TOKEN_COLS = 'id, user_id, client_id, kind, name, scopes, parent_id, created_at, expires_at, last_used_at, revoked_at';
const toToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  userId: r.user_id,
  clientId: r.client_id,
  kind: r.kind,
  name: r.name,
  scopes: parseScopes(r.scopes),
  parentId: r.parent_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

/** Data do SQLite (`AAAA-MM-DD HH:MM:SS`, UTC) em ISO. */
export const sqliteToIso = (d: string) => (d.includes('T') ? d : `${d.replace(' ', 'T')}Z`);
/** ISO (ou data do SQLite) no formato do SQLite, para comparar no banco; null se inválida. */
export function isoToSqlite(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : null;
}

/**
 * Cria um token e devolve o texto (uma vez só) com a linha gravada. `expiresSeconds`
 * null = sem validade (pessoal).
 */
export function createToken(
  db: DB,
  t: { userId: string; kind: TokenKind; scopes: Scope[]; name?: string | null; clientId?: string | null; parentId?: string | null; expiresSeconds?: number | null },
): { token: string; row: ApiToken } {
  const token = `${PREFIX[t.kind]}${randomBytes(32).toString('base64url')}`;
  const id = `tk-${randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO api_tokens (id, token_hash, user_id, client_id, kind, name, scopes, parent_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${t.expiresSeconds ? "datetime('now', ?)" : 'NULL'})`,
  ).run(
    id,
    hashSecret(token),
    t.userId,
    t.clientId ?? null,
    t.kind,
    t.name ?? null,
    normalizeScopes(t.scopes).join(' '),
    t.parentId ?? null,
    ...(t.expiresSeconds ? [`+${t.expiresSeconds} seconds`] : []),
  );
  return { token, row: getToken(db, id)! };
}

export function getToken(db: DB, id: string): ApiToken | null {
  const r = db.prepare(`SELECT ${TOKEN_COLS} FROM api_tokens WHERE id = ?`).get(id) as TokenRow | undefined;
  return r ? toToken(r) : null;
}

/** A linha de um token pelo texto dele (qualquer estado: quem chama confere validade e revogação). */
export function findToken(db: DB, token: string): ApiToken | null {
  const r = db.prepare(`SELECT ${TOKEN_COLS} FROM api_tokens WHERE token_hash = ?`).get(hashSecret(token)) as TokenRow | undefined;
  return r ? toToken(r) : null;
}

/** O token vale agora: não revogado e dentro da validade. */
export const tokenAlive = (t: ApiToken, now = Date.now()) => !t.revokedAt && (!t.expiresAt || Date.parse(sqliteToIso(t.expiresAt)) > now);

export function touchToken(db: DB, id: string) {
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(id);
}

/** Revoga um token e, se for um refresh, os access que ele gerou. */
export function revokeToken(db: DB, id: string): boolean {
  return transaction(db, () => {
    const n = Number(db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id).changes);
    db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE parent_id = ? AND revoked_at IS NULL").run(id);
    return n > 0;
  });
}

/** Revoga todos os tokens de um cliente para uma conta (desvincular; sinal de vazamento). */
export function revokeClientTokens(db: DB, userId: string, clientId: string): number {
  return Number(
    db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL").run(userId, clientId).changes,
  );
}

/** Tokens pessoais ativos de uma conta (sem o texto do token, que nunca é guardado). */
export function listPersonalTokens(db: DB, userId: string): ApiToken[] {
  return (
    db
      .prepare(`SELECT ${TOKEN_COLS} FROM api_tokens WHERE user_id = ? AND kind = 'personal' AND revoked_at IS NULL ORDER BY created_at DESC, id`)
      .all(userId) as TokenRow[]
  ).map(toToken);
}

export interface AuthorizedClient {
  clientId: string;
  name: string;
  scopes: Scope[];
  /** O refresh token ativo mais recente (serve de id para revogar o app todo). */
  tokenId: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Apps (clientes OAuth) que a conta autorizou e ainda têm um refresh token válido. */
export function listAuthorizedClients(db: DB, userId: string): AuthorizedClient[] {
  const rows = db
    .prepare(
      `SELECT t.client_id, c.name, t.scopes, t.id, MIN(t.created_at) AS created_at,
              (SELECT MAX(a.last_used_at) FROM api_tokens a WHERE a.user_id = t.user_id AND a.client_id = t.client_id) AS last_used_at
       FROM api_tokens t JOIN oauth_clients c ON c.id = t.client_id
       WHERE t.user_id = ? AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > datetime('now')
       GROUP BY t.client_id ORDER BY created_at DESC`,
    )
    .all(userId) as Array<{ client_id: string; name: string; scopes: string; id: string; created_at: string; last_used_at: string | null }>;
  return rows.map((r) => ({ clientId: r.client_id, name: r.name, scopes: parseScopes(r.scopes), tokenId: r.id, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** A conta já autorizou este cliente com (pelo menos) estes scopes: a tela de consentimento pode ser pulada. */
export function hasAuthorized(db: DB, userId: string, clientId: string, scopes: Scope[]): boolean {
  const rows = db
    .prepare(
      `SELECT scopes FROM api_tokens WHERE user_id = ? AND client_id = ? AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > datetime('now')`,
    )
    .all(userId, clientId) as Array<{ scopes: string }>;
  return rows.some((r) => {
    const have = new Set(parseScopes(r.scopes));
    return scopes.every((s) => have.has(s));
  });
}

/** Contas que autorizaram clientes com webhook e o scope pedido (para avisar "partida terminada"). */
export function webhookClientsOf(db: DB, userId: string, scope: Scope): Array<{ clientId: string; webhookUrl: string; webhookSecret: string }> {
  const rows = db
    .prepare(
      `SELECT DISTINCT c.id, c.webhook_url, c.webhook_secret, t.scopes FROM api_tokens t JOIN oauth_clients c ON c.id = t.client_id
       WHERE t.user_id = ? AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > datetime('now')
         AND c.webhook_url IS NOT NULL AND c.webhook_secret IS NOT NULL`,
    )
    .all(userId) as Array<{ id: string; webhook_url: string; webhook_secret: string; scopes: string }>;
  const out = new Map<string, { clientId: string; webhookUrl: string; webhookSecret: string }>();
  for (const r of rows) if (parseScopes(r.scopes).includes(scope)) out.set(r.id, { clientId: r.id, webhookUrl: r.webhook_url, webhookSecret: r.webhook_secret });
  return [...out.values()];
}

// ------------------------------------------------------------------ clientes OAuth

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: Scope[];
  webhookUrl: string | null;
  webhookSecret: string | null;
  createdAt: string;
}

type ClientRow = { id: string; name: string; secret_hash: string; redirect_uris: string; scopes: string; webhook_url: string | null; webhook_secret: string | null; created_at: string };
const toClient = (r: ClientRow): OAuthClient => ({
  id: r.id,
  name: r.name,
  redirectUris: JSON.parse(r.redirect_uris) as string[],
  scopes: parseScopes(r.scopes),
  webhookUrl: r.webhook_url,
  webhookSecret: r.webhook_secret,
  createdAt: r.created_at,
});

export const isClientId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(v);

/** Cadastra (ou atualiza) um cliente e devolve o client_secret novo (uma vez só). */
export function upsertClient(db: DB, c: { id: string; name: string; redirectUris: string[]; scopes: Scope[]; webhookUrl?: string | null }): { secret: string; client: OAuthClient } {
  const secret = `ggf_cs_${randomBytes(32).toString('base64url')}`;
  db.prepare(
    `INSERT INTO oauth_clients (id, name, secret_hash, redirect_uris, scopes, webhook_url)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, secret_hash = excluded.secret_hash,
       redirect_uris = excluded.redirect_uris, scopes = excluded.scopes, webhook_url = excluded.webhook_url`,
  ).run(c.id, c.name, hashSecret(secret), JSON.stringify(c.redirectUris), normalizeScopes(c.scopes).join(' '), c.webhookUrl ?? null);
  return { secret, client: getClient(db, c.id)! };
}

/** Troca só o client_secret. */
export function rotateClientSecret(db: DB, id: string): string | null {
  const secret = `ggf_cs_${randomBytes(32).toString('base64url')}`;
  const n = Number(db.prepare('UPDATE oauth_clients SET secret_hash = ? WHERE id = ?').run(hashSecret(secret), id).changes);
  return n ? secret : null;
}

/** Define o webhook (url null = desliga) e gera um segredo novo para assinar os avisos. */
export function setClientWebhook(db: DB, id: string, url: string | null): string | null {
  const secret = url ? `ggf_whs_${randomBytes(32).toString('base64url')}` : null;
  const n = Number(db.prepare('UPDATE oauth_clients SET webhook_url = ?, webhook_secret = ? WHERE id = ?').run(url, secret, id).changes);
  return n ? secret : null;
}

export function deleteClient(db: DB, id: string): boolean {
  return transaction(db, () => {
    db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE client_id = ? AND revoked_at IS NULL").run(id);
    return Number(db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id).changes) > 0;
  });
}

export function getClient(db: DB, id: string): OAuthClient | null {
  const r = db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as ClientRow | undefined;
  return r ? toClient(r) : null;
}

export function listClients(db: DB): OAuthClient[] {
  return (db.prepare('SELECT * FROM oauth_clients ORDER BY id').all() as ClientRow[]).map(toClient);
}

/** O cliente com este id e segredo (null = id desconhecido ou segredo errado). */
export function authenticateClient(db: DB, id: string, secret: string): OAuthClient | null {
  const r = db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as ClientRow | undefined;
  if (!r || r.secret_hash !== hashSecret(secret)) return null;
  return toClient(r);
}

// ------------------------------------------------------------------ codes

export interface OAuthCode {
  clientId: string;
  userId: string;
  scopes: Scope[];
  redirectUri: string;
  codeChallenge: string;
  expiresAt: string;
  usedAt: string | null;
  tokenId: string | null;
}

type CodeRow = { client_id: string; user_id: string; scopes: string; redirect_uri: string; code_challenge: string; expires_at: string; used_at: string | null; token_id: string | null };

/** Grava um code novo (válido por CODE_MINUTES) e devolve o texto dele. */
export function createCode(db: DB, c: { clientId: string; userId: string; scopes: Scope[]; redirectUri: string; codeChallenge: string }): string {
  const code = randomBytes(32).toString('base64url');
  db.prepare("DELETE FROM oauth_codes WHERE expires_at <= datetime('now', '-1 day')").run();
  db.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, scopes, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  ).run(hashSecret(code), c.clientId, c.userId, normalizeScopes(c.scopes).join(' '), c.redirectUri, c.codeChallenge, `+${CODE_MINUTES} minutes`);
  return code;
}

export function findCode(db: DB, code: string): OAuthCode | null {
  const r = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(hashSecret(code)) as CodeRow | undefined;
  return r
    ? { clientId: r.client_id, userId: r.user_id, scopes: parseScopes(r.scopes), redirectUri: r.redirect_uri, codeChallenge: r.code_challenge, expiresAt: r.expires_at, usedAt: r.used_at, tokenId: r.token_id }
    : null;
}

/** Marca o code como usado e guarda o refresh emitido com ele. */
export function useCode(db: DB, code: string, tokenId: string) {
  db.prepare("UPDATE oauth_codes SET used_at = datetime('now'), token_id = ? WHERE code_hash = ?").run(tokenId, hashSecret(code));
}
