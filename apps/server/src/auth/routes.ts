// Rotas de login (Google) e a sessão em cookie.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db';
import { fail } from '../errors';
import { tierFor } from '../stats/catalog';
import { findPlayer } from '../stats/store';
import { type GoogleKeys, LoginError, verifyGoogleIdToken } from './google';
import {
  accountOwnerKey,
  claimBrowserData,
  createSession,
  deleteSession,
  getCustomPicture,
  getUser,
  isAdmin,
  isRole,
  listUsers,
  pictureType,
  SESSION_DAYS,
  sessionUser,
  setCustomPicture,
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
  /**
   * Tarefas rodadas depois de cada login, antes da resposta (ex.: consultar o apoio na
   * Apoia.se). Um erro numa delas não impede o login.
   */
  afterLogin?: Array<(user: User) => Promise<void>>;
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

const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  picture: u.picture,
  customPicture: u.customPicture,
  role: u.role,
  supporter: u.supporterTier ? { tier: u.supporterTier, until: u.supporterUntil, source: u.supporterSource, public: u.supporterPublic } : null,
});

/** Maior foto aceita (o navegador já manda a imagem reduzida, com poucas dezenas de KB). */
export const MAX_PICTURE_BYTES = 256 * 1024;

export function registerAuth(app: FastifyInstance, { db, clientId, keys, browserHash, adminEmails = [], afterLogin = [] }: Deps) {
  const cache = new WeakMap<FastifyRequest, User | null>();
  /**
   * Usuário logado nesta requisição: a conta do token de parceiro (`Authorization: Bearer`,
   * ver partners/tokens.ts) ou a do cookie de sessão válido; null sem nenhum dos dois.
   */
  const viewer = (req: FastifyRequest): User | null => {
    if (req.apiAuth) return req.apiAuth.user;
    if (cache.has(req)) return cache.get(req)!;
    const token = readCookie(req, COOKIE);
    const user = token && token.length <= 128 ? sessionUser(db, token) : null;
    cache.set(req, user);
    return user;
  };

  /**
   * Com token de parceiro: só o id da conta (sempre Player) e o perfil público de jogador;
   * nunca e-mail, nome ou foto do Google.
   */
  app.get('/api/auth/me', { config: { scope: 'profile' } }, async (req) => {
    const u = viewer(req);
    if (req.apiAuth && u) {
      const p = findPlayer(db, accountOwnerKey(u.id));
      return { user: { id: u.id, role: 'player' }, player: p ? { id: p.id, name: p.name, bounty: p.bounty, tier: tierFor(p.bounty).id } : null };
    }
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
    for (const task of afterLogin) {
      try {
        await task(user);
      } catch (e) {
        req.log.warn({ err: e }, 'tarefa depois do login falhou');
      }
    }
    return { user: publicUser(getUser(db, user.id) ?? user), claimedDecks: claimed.decks };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readCookie(req, COOKIE);
    if (token) deleteSession(db, token);
    setSessionCookie(req, reply, '', 0);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- foto da conta

  /**
   * Troca a foto da conta. `image`: data URL (JPEG, PNG ou WebP) que o navegador já
   * recortou e reduziu; a foto do Google deixa de aparecer até o usuário removê-la.
   */
  app.put<{ Body: { image?: unknown } }>('/api/auth/me/picture', async (req, reply) => {
    const u = viewer(req);
    if (!u) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    const image = req.body?.image;
    const m = typeof image === 'string' ? /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image) : null;
    if (!m) return reply.code(400).send(fail('pictureInvalid', 'Imagem inválida. Use JPG, PNG ou WebP.'));
    if (m[1].length > Math.ceil(MAX_PICTURE_BYTES / 3) * 4) {
      return reply.code(413).send(fail('pictureTooBig', 'Imagem grande demais.'));
    }
    const data = Buffer.from(m[1], 'base64');
    const type = pictureType(data);
    if (!type) return reply.code(400).send(fail('pictureInvalid', 'Imagem inválida. Use JPG, PNG ou WebP.'));
    setCustomPicture(db, u.id, { data, type });
    return { user: publicUser(getUser(db, u.id)!) };
  });

  /** Remove a foto enviada: volta a valer a foto do Google. */
  app.delete('/api/auth/me/picture', async (req, reply) => {
    const u = viewer(req);
    if (!u) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    setCustomPicture(db, u.id, null);
    return { user: publicUser(getUser(db, u.id)!) };
  });

  /** A foto enviada; só o próprio usuário e os admins (tela de perfis) a veem. */
  app.get<{ Params: { id: string } }>('/api/users/:id/picture', async (req, reply) => {
    const u = viewer(req);
    const pic = u && (u.id === req.params.id || isAdmin(u.role)) ? getCustomPicture(db, req.params.id) : null;
    if (!pic) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    // O endereço muda a cada troca (?v=), então a imagem pode ficar no cache do navegador.
    return reply
      .header('content-type', pic.type)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(pic.data));
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
