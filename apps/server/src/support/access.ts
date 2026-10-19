// ACCESS=supporters: o site inteiro só abre para apoiadores Tripulante ou acima (e para
// admins). Usado na homologação, onde as novidades chegam antes: o plano é consultado
// na produção (SUPPORT_SOURCE_URL + INTERNAL_TOKEN), porque o banco da homologação é outro.
//
// Ficam abertos só o necessário para a tela de bloqueio: saúde, configuração, login e
// a própria consulta de acesso (e o replay embutido com link assinado).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { emailVerified, isAdmin, type User } from '../auth/store';
import type { AccessOptions } from '../config';
import type { DB } from '../db';
import { fail } from '../errors';
import { atLeast, isSupporterTier, type SupporterTier } from './tiers';

/** Plano mínimo para entrar. */
export const ACCESS_TIER: SupporterTier = 'tripulante';
/** Quanto tempo a resposta da produção vale (quem acabou de assinar espera no máximo isto). */
const CACHE_OK_MS = 10 * 60_000;
const CACHE_NO_MS = 2 * 60_000;

// /api/oauth: o backend do app parceiro troca code/refresh por tokens sem sessão (a credencial é o client_secret).
// /api/replay: o replay embutido no app parceiro, sem sessão (a credencial é o link assinado).
const OPEN_PREFIXES = ['/api/health', '/api/config', '/api/auth/', '/api/access', '/api/support', '/api/oauth/', '/api/replay/'];

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  access: AccessOptions;
  /** Testes: troca o fetch da consulta à produção. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type AccessReason = 'open' | 'login' | 'admin' | 'supporter' | 'remote' | 'denied' | 'unverified';

export function registerAccessGate(app: FastifyInstance, { db, user, access, fetchImpl = fetch, now = Date.now }: Deps) {
  const cache = new Map<string, { ok: boolean; at: number }>();

  /** Plano na produção (null = não deu para consultar). */
  const remote = async (email: string): Promise<boolean | null> => {
    if (!access.sourceUrl || !access.token) return null;
    const hit = cache.get(email);
    if (hit && now() - hit.at < (hit.ok ? CACHE_OK_MS : CACHE_NO_MS)) return hit.ok;
    try {
      const res = await fetchImpl(`${access.sourceUrl}/api/internal/supporter?email=${encodeURIComponent(email)}`, {
        headers: { authorization: `Bearer ${access.token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { tier?: unknown; admin?: unknown };
      const ok = body.admin === true || (isSupporterTier(body.tier) && atLeast(body.tier, ACCESS_TIER));
      cache.set(email, { ok, at: now() });
      return ok;
    } catch (e) {
      app.log.warn({ err: e }, 'acesso: não deu para consultar o plano na produção');
      // Falha de rede: vale a última resposta conhecida, se houver.
      return hit ? hit.ok : null;
    }
  };

  const check = async (req: FastifyRequest): Promise<{ allowed: boolean; reason: AccessReason }> => {
    if (access.mode !== 'supporters') return { allowed: true, reason: 'open' };
    const u = user(req);
    if (!u) return { allowed: false, reason: 'login' };
    if (isAdmin(u.role)) return { allowed: true, reason: 'admin' };
    if (atLeast(u.supporterTier, ACCESS_TIER)) return { allowed: true, reason: 'supporter' };
    if (!u.email || !emailVerified(db, u.id)) return { allowed: false, reason: 'unverified' };
    return (await remote(u.email.toLowerCase())) ? { allowed: true, reason: 'remote' } : { allowed: false, reason: 'denied' };
  };

  app.get('/api/access', async (req) => ({
    mode: access.mode,
    ...(await check(req)),
    /** Onde assinar (a produção). */
    homeUrl: access.sourceUrl ?? null,
  }));

  if (access.mode !== 'supporters') return;
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || OPEN_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))) return;
    const { allowed } = await check(req);
    if (!allowed) return reply.code(403).send({ ...fail('supportersOnly', 'Este ambiente é só para apoiadores Tripulante ou acima.'), code: 'supporters-only' });
  });
}
