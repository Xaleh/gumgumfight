import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setSupporter, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import type { SupporterTier } from '../src/support/tiers';

const PROD = 'https://prod.example';
const TOKEN = 'interno-123';

/** Produção de mentira: responde o plano pelo e-mail. */
function fakeProd(plans: Record<string, { tier: SupporterTier | null; admin?: boolean }>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if ((init?.headers as Record<string, string>)?.authorization !== `Bearer ${TOKEN}`) return new Response('{}', { status: 401 });
    const email = new URL(url).searchParams.get('email')!;
    return Response.json(plans[email] ?? { tier: null, admin: false });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(plans: Record<string, { tier: SupporterTier | null; admin?: boolean }> = {}) {
  const db = openDb(':memory:');
  seed(db);
  const prod = fakeProd(plans);
  const app = buildApp(db, {
    server: { cardImages: true, access: { mode: 'supporters', sourceUrl: PROD, token: TOKEN } },
    fetchImpl: prod.fetchImpl,
  });
  return { db, app, calls: prod.calls };
}

let n = 0;
function login(db: DB, opts: { role?: Role; tier?: SupporterTier; email?: string } = {}) {
  n++;
  const email = opts.email ?? `a${n}@example.com`;
  const u = upsertGoogleUser(db, { sub: `acc-${n}`, email, emailVerified: true, name: `A${n}`, picture: null });
  if (opts.role) setUserRole(db, u.id, opts.role);
  if (opts.tier) setSupporter(db, u.id, opts.tier, null);
  return { cookie: `gg_session=${createSession(db, u.id)}` };
}

describe('homologação só para apoiadores (ACCESS=supporters)', () => {
  it('sem login: só o necessário para a tela de bloqueio responde', async () => {
    const { app } = setup();
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/config')).json().access).toBe('supporters');
    expect((await app.inject('/api/auth/me')).statusCode).toBe(200);
    expect((await app.inject('/api/access')).json()).toMatchObject({ mode: 'supporters', allowed: false, reason: 'login', homeUrl: PROD });
    // Rotas registradas antes e depois do bloqueio ficam fechadas.
    for (const url of ['/api/cards', '/api/decks', '/api/tournaments', '/api/stats', '/api/coverage']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code).toBe('supporters-only');
    }
  });

  it('entra: admin, plano local Tripulante ou acima, ou plano consultado na produção (com cache)', async () => {
    const { db, app, calls } = setup({ 'fan@example.com': { tier: 'capitao' }, 'grumete@example.com': { tier: 'grumete' } });
    const as = (headers: Record<string, string>) => app.inject({ url: '/api/decks', headers });
    expect((await as(login(db, { role: 'admin' }))).statusCode).toBe(200);
    expect((await as(login(db, { tier: 'tripulante' }))).statusCode).toBe(200);
    expect((await as(login(db, { tier: 'grumete' }))).statusCode).toBe(403);
    expect(calls).toHaveLength(1);

    const fan = login(db, { email: 'fan@example.com' });
    expect((await app.inject({ url: '/api/access', headers: fan })).json()).toMatchObject({ allowed: true, reason: 'remote' });
    expect((await as(fan)).statusCode).toBe(200);
    // A resposta da produção fica em cache.
    expect(calls.filter((c) => c.includes('fan%40example.com'))).toHaveLength(1);

    const low = login(db, { email: 'grumete@example.com' });
    expect((await app.inject({ url: '/api/access', headers: low })).json()).toMatchObject({ allowed: false, reason: 'denied' });
  });

  it('servidor aberto (padrão): nada muda', async () => {
    const db = openDb(':memory:');
    seed(db);
    const app = buildApp(db, { server: { cardImages: true } });
    expect((await app.inject('/api/decks')).statusCode).toBe(200);
    expect((await app.inject('/api/access')).json()).toMatchObject({ mode: 'open', allowed: true });
  });
});
