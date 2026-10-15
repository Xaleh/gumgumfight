// OAuth 2.0 (authorization code + PKCE S256) para apps parceiros: o botão "Vincular" no app
// leva o usuário a /oauth/authorize, que mostra a tela de consentimento (uma tela do React:
// o servidor responde o index.html e o App.tsx abre a tela ao ver esse caminho). "Permitir"
// gera um code; o backend do app troca o code por um par access/refresh em
// POST /api/oauth/token. O resultado é o mesmo dos tokens pessoais: linhas em api_tokens,
// agora com client_id; o middleware Bearer, os scopes e as rotas não mudam.
//
// Regras: redirect_uri comparada por igualdade exata; state obrigatório; só S256; code de
// uso único por 5 min (usar de novo revoga os tokens que ele gerou); refresh com rotação
// (usar um refresh já revogado revoga toda a cadeia daquele cliente para aquela conta).

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '../auth/store';
import { type DB, transaction } from '../db';
import { fail } from '../errors';
import {
  ACCESS_TOKEN_SECONDS,
  authenticateClient,
  createCode,
  createToken,
  findCode,
  findToken,
  getClient,
  hasAuthorized,
  isClientId,
  normalizeScopes,
  type OAuthClient,
  REFRESH_TOKEN_DAYS,
  revokeClientTokens,
  revokeToken,
  type Scope,
  sqliteToIso,
  tokenAlive,
  useCode,
} from './store';
import { TokenRateLimiter } from './tokens';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  /** Em produção: responde a tela do app (index.html). Sem ele (dev), o Vite serve a página. */
  sendIndex?: (reply: FastifyReply) => unknown;
  now?: () => number;
}

/** Tentativas de troca de code por minuto por cliente (freia quem tenta adivinhar codes). */
export const TOKEN_ENDPOINT_RATE_LIMIT = 10;

type Query = Record<string, string | undefined>;

export type AuthorizeCheck =
  | { ok: true; client: OAuthClient; scopes: Scope[]; redirectUri: string; state: string; codeChallenge: string }
  /** client_id ou redirect_uri errados: página de erro, sem redirecionar. */
  | { ok: false; fatal: true; error: string; message: string }
  /** Outros erros: voltar ao app com ?error=…&state=…. */
  | { ok: false; fatal: false; error: string; message: string; redirect: string };

const withParams = (base: string, params: Record<string, string>) => {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
};

/** Confere os parâmetros de /oauth/authorize (os mesmos da tela de consentimento). */
export function checkAuthorize(db: DB, q: Query): AuthorizeCheck {
  const client = isClientId(q.client_id) ? getClient(db, q.client_id) : null;
  if (!client) return { ok: false, fatal: true, error: 'invalid_client', message: 'App desconhecido (client_id).' };
  const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, fatal: true, error: 'invalid_redirect_uri', message: 'redirect_uri não cadastrada para este app.' };
  const state = typeof q.state === 'string' ? q.state : '';
  const back = (error: string, message: string): AuthorizeCheck => ({
    ok: false,
    fatal: false,
    error,
    message,
    redirect: withParams(redirectUri, { error, ...(state ? { state } : {}) }),
  });
  if (!state || state.length > 512) return back('invalid_request', 'state é obrigatório.');
  if (q.response_type !== 'code') return back('unsupported_response_type', 'response_type precisa ser "code".');
  if (q.code_challenge_method !== 'S256') return back('invalid_request', 'code_challenge_method precisa ser S256.');
  const codeChallenge = typeof q.code_challenge === 'string' ? q.code_challenge : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return back('invalid_request', 'code_challenge inválido.');
  const asked = typeof q.scope === 'string' ? q.scope.split(/[\s,]+/).filter(Boolean) : [];
  const allowed = new Set(client.scopes);
  if (asked.some((s) => !allowed.has(s as Scope))) return back('invalid_scope', 'O app pediu permissões que não pode pedir.');
  const scopes = normalizeScopes(asked);
  return { ok: true, client, scopes, redirectUri, state, codeChallenge };
}

const errorPage = (title: string, message: string) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`;

/** Corpo de erro do endpoint de token, no formato do padrão OAuth (+ `errorCode` como o resto da API). */
const oauthError = (error: string, description: string) => ({ error, error_description: description, errorCode: error });

export function registerOAuthRoutes(app: FastifyInstance, { db, user, sendIndex, now = Date.now }: Deps) {
  // O padrão manda o corpo de /api/oauth/token como formulário (o webhook do Ko-fi já registra o mesmo parser).
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
  }
  const tokenLimiter = new TokenRateLimiter(TOKEN_ENDPOINT_RATE_LIMIT, now);
  const noFrame = (reply: FastifyReply) =>
    reply.header('x-frame-options', 'DENY').header('content-security-policy', "frame-ancestors 'none'").header('cache-control', 'no-store');

  /**
   * Início do fluxo. client_id/redirect_uri errados: página de erro (nunca redireciona para
   * um endereço não cadastrado). Outros erros: volta ao app com ?error=. Certo: a tela do app.
   */
  app.get<{ Querystring: Query }>('/oauth/authorize', async (req, reply) => {
    const r = checkAuthorize(db, req.query);
    noFrame(reply);
    if (!r.ok) return r.fatal ? reply.code(400).type('text/html').send(errorPage('Não foi possível vincular', r.message)) : reply.redirect(r.redirect, 302);
    if (sendIndex) return sendIndex(reply);
    return reply.type('text/html').send(errorPage('GumGum Fight', 'Abra esta página pelo site do GumGum Fight.'));
  });

  /** O que a tela de consentimento mostra (só com sessão de cookie). */
  app.get<{ Querystring: Query }>('/api/oauth/consent', async (req, reply) => {
    const r = checkAuthorize(db, req.query);
    noFrame(reply);
    if (!r.ok) return r.fatal ? reply.code(400).send({ ...fail(r.error, r.message), redirect: null }) : { ...fail(r.error, r.message), redirect: r.redirect };
    const me = user(req);
    return {
      client: { id: r.client.id, name: r.client.name },
      scopes: r.scopes,
      loggedIn: Boolean(me),
      /** A conta já autorizou este app com estes scopes: a tela pode pular direto para "Permitir". */
      already: me ? hasAuthorized(db, me.id, r.client.id, r.scopes) : false,
    };
  });

  /** Decisão do usuário: `allow` gera o code; `deny` volta com access_denied. */
  app.post<{ Body: Query & { decision?: unknown } }>('/api/oauth/consent', async (req, reply) => {
    const me = user(req);
    if (!me) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    const r = checkAuthorize(db, req.body ?? {});
    noFrame(reply);
    if (!r.ok) return r.fatal ? reply.code(400).send({ ...fail(r.error, r.message), redirect: null }) : { ...fail(r.error, r.message), redirect: r.redirect };
    if (req.body?.decision !== 'allow') return { redirect: withParams(r.redirectUri, { error: 'access_denied', state: r.state }) };
    const code = createCode(db, { clientId: r.client.id, userId: me.id, scopes: r.scopes, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge });
    return { redirect: withParams(r.redirectUri, { code, state: r.state }) };
  });

  /** Credenciais do cliente: no corpo (client_id/client_secret) ou em Authorization: Basic. */
  const clientOf = (req: FastifyRequest<{ Body: Query }>): OAuthClient | null => {
    let id = req.body?.client_id;
    let secret = req.body?.client_secret;
    const basic = /^Basic\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    if (basic) {
      const [u, ...p] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
      id = decodeURIComponent(u);
      secret = decodeURIComponent(p.join(':'));
    }
    if (!isClientId(id) || typeof secret !== 'string' || !secret) return null;
    return authenticateClient(db, id, secret);
  };

  const issuePair = (client: OAuthClient, userId: string, scopes: Scope[]) =>
    transaction(db, () => {
      const refresh = createToken(db, { userId, kind: 'refresh', scopes, clientId: client.id, name: client.name, expiresSeconds: REFRESH_TOKEN_DAYS * 86_400 });
      const access = createToken(db, {
        userId,
        kind: 'access',
        scopes,
        clientId: client.id,
        name: client.name,
        parentId: refresh.row.id,
        expiresSeconds: ACCESS_TOKEN_SECONDS,
      });
      return { refresh, access };
    });

  const pairBody = (pair: ReturnType<typeof issuePair>) => ({
    access_token: pair.access.token,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: pair.refresh.token,
    scope: pair.access.row.scopes.join(' '),
  });

  /** Troca do code (com PKCE) ou do refresh (com rotação) por tokens. */
  app.post<{ Body: Query }>('/api/oauth/token', async (req, reply) => {
    reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
    const b = req.body ?? {};
    const client = clientOf(req);
    if (!client) return reply.code(401).header('www-authenticate', 'Basic realm="oauth"').send(oauthError('invalid_client', 'client_id ou client_secret errados.'));
    const wait = tokenLimiter.hit(client.id);
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(oauthError('rate_limited', 'Muitas tentativas; espere um pouco.'));

    if (b.grant_type === 'authorization_code') {
      const code = typeof b.code === 'string' ? b.code : '';
      const stored = code.length <= 128 ? findCode(db, code) : null;
      if (!stored || stored.clientId !== client.id) return reply.code(400).send(oauthError('invalid_grant', 'code inválido.'));
      if (stored.usedAt) {
        // Reuso de code: sinal de vazamento. Os tokens do primeiro uso deixam de valer.
        if (stored.tokenId) revokeToken(db, stored.tokenId);
        return reply.code(400).send(oauthError('invalid_grant', 'code já usado.'));
      }
      if (Date.parse(sqliteToIso(stored.expiresAt)) <= now()) return reply.code(400).send(oauthError('invalid_grant', 'code expirado.'));
      if (stored.redirectUri !== b.redirect_uri) return reply.code(400).send(oauthError('invalid_grant', 'redirect_uri diferente da usada na autorização.'));
      const verifier = typeof b.code_verifier === 'string' ? b.code_verifier : '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== stored.codeChallenge) {
        return reply.code(400).send(oauthError('invalid_grant', 'code_verifier não confere.'));
      }
      const pair = issuePair(client, stored.userId, stored.scopes);
      useCode(db, code, pair.refresh.row.id);
      return pairBody(pair);
    }

    if (b.grant_type === 'refresh_token') {
      const raw = typeof b.refresh_token === 'string' ? b.refresh_token : '';
      const old = raw.length <= 256 ? findToken(db, raw) : null;
      if (!old || old.kind !== 'refresh' || old.clientId !== client.id) return reply.code(400).send(oauthError('invalid_grant', 'refresh_token inválido.'));
      if (old.revokedAt) {
        // Um refresh já trocado sendo usado de novo: alguém tem uma cópia. Cai tudo deste app nesta conta.
        revokeClientTokens(db, old.userId, client.id);
        return reply.code(400).send(oauthError('invalid_grant', 'refresh_token já usado; vincule o app de novo.'));
      }
      if (!tokenAlive(old, now())) return reply.code(400).send(oauthError('invalid_grant', 'refresh_token expirado.'));
      const pair = transaction(db, () => {
        revokeToken(db, old.id);
        return issuePair(client, old.userId, old.scopes);
      });
      return pairBody(pair);
    }

    return reply.code(400).send(oauthError('unsupported_grant_type', 'grant_type precisa ser authorization_code ou refresh_token.'));
  });

  /** O app desvincula: revoga o token (um refresh leva os access dele). 200 mesmo se o token não existir. */
  app.post<{ Body: Query }>('/api/oauth/revoke', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const client = clientOf(req);
    if (!client) return reply.code(401).send(oauthError('invalid_client', 'client_id ou client_secret errados.'));
    const raw = typeof req.body?.token === 'string' ? req.body.token : '';
    const t = raw.length <= 256 ? findToken(db, raw) : null;
    if (t && t.clientId === client.id) revokeToken(db, t.id);
    return {};
  });
}
