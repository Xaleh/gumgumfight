// Rotas de login (Google) e a sessão em cookie.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db';
import { fail } from '../errors';
import { type GoogleKeys, LoginError, verifyGoogleIdToken } from './google';
import {
  claimBrowserData,
  createSession,
  deleteSession,
  getUser,
  isAdmin,
  isRole,
  listUsers,
  SESSION_DAYS,
  sessionUser,
  setUserRole,
  upsertGoogleUser,
  type User,
} from './store';

const COOKIE = 'gg_session';

interface Deps {
  db: DB;
  /** Client ID do OAuth do Google; sem ele, o login fica desligado. */
  clientId: string | null;
  keys: GoogleKeys;
  /** Hash do código do navegador (header x-deck-owner), para levar os dados dele para a conta. */
  browserHash: (req: FastifyRequest) => string | null;
  /** E-mails que viram admin ao entrar (ADMIN_EMAILS). */
  adminEmails?: string[];
}

function readCookie(req: FastifyRequest, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string, maxAge: number) {
  // Secure só em HTTPS (atrás do Nginx, req.protocol vem do X-Forwarded-Proto); em
  // http://localhost o navegador recusaria o cookie.
  const attrs = [`${COOKIE}=${token}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (req.protocol === 'https') attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, picture: u.picture, role: u.role });

export function registerAuth(app: FastifyInstance, { db, clientId, keys, browserHash, adminEmails = [] }: Deps) {
  const cache = new WeakMap<FastifyRequest, User | null>();
  /** Usuário logado nesta requisição (cookie de sessão válido), ou null. */
  const viewer = (req: FastifyRequest): User | null => {
    if (cache.has(req)) return cache.get(req)!;
    const token = readCookie(req, COOKIE);
    const user = token && token.length <= 128 ? sessionUser(db, token) : null;
    cache.set(req, user);
    return user;
  };

  app.get('/api/auth/me', async (req) => {
    const u = viewer(req);
    return { user: u ? publicUser(u) : null };
  });

  /**
   * Recebe o ID token entregue pelo botão do Google, confere e abre a sessão.
   * Os decks e o perfil criados neste navegador antes do login passam para a conta.
   */
  app.post<{ Body: { credential?: unknown } }>('/api/auth/google', async (req, reply) => {
    if (!clientId) return reply.code(503).send(fail('googleLoginOff', 'Login com Google não configurado neste servidor.'));
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || credential.length > 4096) {
      return reply.code(400).send(fail('googleCredentialMissing', 'Credencial do Google ausente.'));
    }
    let identity;
    try {
      identity = await verifyGoogleIdToken(credential, clientId, keys);
    } catch (e) {
      req.log.warn({ err: e }, 'login com Google recusado');
      // Erro inesperado (ex.: rede): vai o texto dele, sem chave de tradução.
      if (e instanceof LoginError) return reply.code(401).send(fail(e.errorCode, e.message, e.errorParams));
      return reply.code(401).send(e instanceof Error ? { error: e.message } : fail('loginInvalid', 'Login inválido.'));
    }
    const user = upsertGoogleUser(db, identity, adminEmails);
    const browser = browserHash(req);
    const claimed = browser ? claimBrowserData(db, browser, user.id) : { decks: 0 };
    const old = readCookie(req, COOKIE);
    if (old) deleteSession(db, old);
    setSessionCookie(req, reply, createSession(db, user.id), SESSION_DAYS * 86_400);
    return { user: publicUser(user), claimedDecks: claimed.decks };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readCookie(req, COOKIE);
    if (token) deleteSession(db, token);
    setSessionCookie(req, reply, '', 0);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- perfis (só admin)

  /** Admin logado, ou responde 401/403. */
  const admin = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = viewer(req);
    if (!u) {
      void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      return null;
    }
    if (!isAdmin(u.role)) {
      void reply.code(403).send(fail('adminOnlyRoles', 'Só administradores podem mudar perfis.'));
      return null;
    }
    return u;
  };

  app.get<{ Querystring: { q?: string } }>('/api/admin/users', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
    return listUsers(db, q);
  });

  app.put<{ Params: { id: string }; Body: { role?: unknown } }>('/api/admin/users/:id/role', async (req, reply) => {
    const me = admin(req, reply);
    if (!me) return reply;
    const role = req.body?.role;
    if (!isRole(role)) return reply.code(400).send(fail('invalidRole', 'Perfil inválido.'));
    // Evita que o último admin se tranque para fora: a si mesmo, só a promoção para Dev.
    if (req.params.id === me.id && role !== 'dev') {
      return reply.code(409).send(fail('selfRoleOnlyDev', 'Você só pode mudar o seu próprio perfil para Dev.'));
    }
    if (!setUserRole(db, req.params.id, role)) return reply.code(404).send(fail('accountNotFound', 'Conta não encontrada.'));
    return publicUser(getUser(db, req.params.id)!);
  });

  return { viewer };
}
