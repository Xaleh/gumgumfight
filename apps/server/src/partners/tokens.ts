// Tokens de acesso para apps parceiros: o header `Authorization: Bearer <token>` vale como a
// conta Google de quem criou o token, limitado aos scopes dele.
//
// Allowlist: um token só entra nas rotas que declaram `config: { scope }`. Qualquer outra
// rota (admin, login, partidas online, torneios, os próprios tokens…) responde 403
// `token_not_allowed`, então uma rota nova fica fechada até alguém liberá-la de propósito.
// Através de token, qualquer conta age como Player: o perfil real (admin, organizador…) não
// vale. Cookie e `x-deck-owner` são ignorados na requisição com token.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getUser, type User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import {
  type ApiToken,
  createToken,
  findToken,
  getToken,
  isScope,
  listAuthorizedClients,
  listPersonalTokens,
  MAX_PERSONAL_TOKENS,
  normalizeScopes,
  revokeClientTokens,
  revokeToken,
  type Scope,
  SCOPES,
  sqliteToIso,
  tokenAlive,
  touchToken,
} from './store';

export interface ApiAuth {
  token: ApiToken;
  /** A conta dona do token, sempre com o perfil Player. */
  user: User;
  scopes: Set<Scope>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo middleware Bearer quando a requisição veio com um token válido. */
    apiAuth: ApiAuth | null;
  }
  interface FastifyContextConfig {
    /** Scope exigido para a rota aceitar um token de parceiro (sem ele, tokens não entram). */
    scope?: Scope;
  }
}

/** Requisições por minuto por token (acima disso, 429 com Retry-After). */
export const TOKEN_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
/** `last_used_at` é gravado no máximo uma vez por minuto por token. */
const TOUCH_MS = 60_000;

interface Deps {
  db: DB;
  now?: () => number;
}

/** Erro padrão dos tokens (o mesmo formato `{ error, errorCode }` das outras rotas). */
export const tokenErrors = {
  invalid: () => fail('invalid_token', 'Token de acesso inválido, expirado ou revogado.'),
  notAllowed: () => fail('token_not_allowed', 'Esta rota não aceita tokens de acesso; use o site.'),
  insufficient: (scope: Scope) => fail('insufficient_scope', `O token não tem a permissão ${scope}.`, { scope }),
  rateLimited: (retryAfter: number) => fail('rate_limited', 'Muitas requisições com este token; espere um pouco.', { retryAfter }),
};

/** Janela deslizante em memória: quantas chamadas um token fez no último minuto. */
export class TokenRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit = TOKEN_RATE_LIMIT,
    private readonly now: () => number = Date.now,
  ) {}
  /** null = pode; senão, segundos a esperar. */
  hit(id: string): number | null {
    const t = this.now();
    const list = (this.hits.get(id) ?? []).filter((h) => t - h < RATE_WINDOW_MS);
    if (list.length >= this.limit) {
      this.hits.set(id, list);
      return Math.max(1, Math.ceil((list[0] + RATE_WINDOW_MS - t) / 1000));
    }
    list.push(t);
    this.hits.set(id, list);
    // Tokens que pararam de chamar saem do mapa.
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((h) => t - h < RATE_WINDOW_MS)) this.hits.delete(k);
    return null;
  }
}

/** Registra o middleware Bearer (antes dos módulos) e devolve o que as rotas precisam. */
export function registerBearerAuth(app: FastifyInstance, { db, now = Date.now }: Deps) {
  app.decorateRequest('apiAuth', null);
  const limiter = new TokenRateLimiter(TOKEN_RATE_LIMIT, now);
  const touched = new Map<string, number>();

  app.addHook('onRequest', async (req, reply) => {
    const header = req.headers.authorization;
    // Outros esquemas (Basic, do cliente OAuth em /api/oauth/token) não são tokens de parceiro.
    if (typeof header !== 'string' || !/^Bearer\b/i.test(header)) return;
    const path = req.url.split('?')[0];
    // Só a API; a consulta interna de plano (homologação → produção) tem o próprio Bearer.
    if (!path.startsWith('/api/') || path.startsWith('/api/internal/')) return;
    // Rota inexistente: o 404 de sempre. Com o @fastify/static registrado, a rota coringa `/*` dele
    // é quem recebe um caminho de API desconhecido, e então chama o handler de 404.
    if (req.is404 || !req.routeOptions.url || req.routeOptions.url === '/*') return;
    const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
    const token = m && m[1].length <= 256 ? findToken(db, m[1]) : null;
    const t = now();
    if (!token || token.kind === 'refresh' || !tokenAlive(token, t)) return unauthorized(reply);
    const account = getUser(db, token.userId);
    if (!account) return unauthorized(reply);
    const scope = req.routeOptions.config?.scope;
    if (!scope) return reply.code(403).send(tokenErrors.notAllowed());
    if (!token.scopes.includes(scope)) return reply.code(403).send(tokenErrors.insufficient(scope));
    const wait = limiter.hit(token.id);
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(tokenErrors.rateLimited(wait));
    req.apiAuth = { token, user: { ...account, role: 'player' }, scopes: new Set(token.scopes) };
    if (t - (touched.get(token.id) ?? 0) >= TOUCH_MS) {
      touched.set(token.id, t);
      touchToken(db, token.id);
    }
  });
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).header('www-authenticate', 'Bearer error="invalid_token"').send(tokenErrors.invalid());
}

/** Um token na resposta (nunca o texto dele). */
export function presentToken(t: ApiToken) {
  return {
    id: t.id,
    name: t.name,
    kind: 'personal' as const,
    client: null,
    scopes: t.scopes,
    createdAt: sqliteToIso(t.createdAt),
    lastUsedAt: t.lastUsedAt ? sqliteToIso(t.lastUsedAt) : null,
  };
}

/** O que a tela "Apps conectados" lista: tokens pessoais e apps autorizados pelo OAuth. */
export function listConnected(db: DB, userId: string) {
  return [
    ...listPersonalTokens(db, userId).map(presentToken),
    ...listAuthorizedClients(db, userId).map((c) => ({
      id: c.tokenId,
      name: c.name,
      kind: 'app' as const,
      client: { id: c.clientId, name: c.name },
      scopes: c.scopes,
      createdAt: sqliteToIso(c.createdAt),
      lastUsedAt: c.lastUsedAt ? sqliteToIso(c.lastUsedAt) : null,
    })),
  ];
}

/**
 * Rotas da tela "Apps conectados" (só com sessão de cookie: sem `config.scope`, um token
 * recebe 403 antes de chegar aqui).
 */
export function registerTokenRoutes(app: FastifyInstance, { db, user }: { db: DB; user: (req: FastifyRequest) => User | null }) {
  const account = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    return u;
  };

  app.get('/api/tokens', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    return { scopes: SCOPES, tokens: listConnected(db, me.id) };
  });

  /** Cria um token pessoal: o texto aparece só nesta resposta. */
  app.post<{ Body: { name?: unknown; scopes?: unknown } }>('/api/tokens', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    if (!name) return reply.code(400).send(fail('tokenNameRequired', 'Dê um nome ao token (o app que vai usá-lo).'));
    const raw = req.body?.scopes;
    if (!Array.isArray(raw) || !raw.every(isScope)) return reply.code(400).send(fail('tokenScopesInvalid', 'Permissões inválidas.'));
    if (listPersonalTokens(db, me.id).length >= MAX_PERSONAL_TOKENS) {
      return reply.code(400).send(fail('token_limit', `Você já tem ${MAX_PERSONAL_TOKENS} tokens ativos; revogue um para criar outro.`, { max: MAX_PERSONAL_TOKENS }));
    }
    const { token, row } = createToken(db, { userId: me.id, kind: 'personal', scopes: normalizeScopes(raw), name });
    return reply.code(201).send({ ...presentToken(row), token });
  });

  /** Revoga um token pessoal ou, se o id for de um app, todos os tokens daquele app para a conta. */
  app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getToken(db, req.params.id);
    if (!t || t.userId !== me.id || t.revokedAt) return reply.code(404).send(fail('tokenNotFound', 'Token não encontrado.'));
    if (t.clientId) revokeClientTokens(db, me.id, t.clientId);
    else revokeToken(db, t.id);
    return reply.code(204).send();
  });
}
