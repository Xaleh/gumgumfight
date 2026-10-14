import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, setSupporter, upsertGoogleUser } from '../src/auth/store';
import type { SupportOptions } from '../src/config';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import { apoiasePaidUntil } from '../src/support/apoiase';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(sub: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'Fã', iat: now, exp: now + 3600 });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

// 2026-10-20 12:00 em Brasília.
const T0 = Date.parse('2026-10-20T15:00:00Z');
const SUPPORT: SupportOptions = {
  pixKey: 'chave-aleatoria',
  pixName: 'Fulano',
  pixCity: 'Rio',
  monthlyUrl: 'https://apoia.se/gumgumfight',
  apoiaseKey: 'key-1',
  apoiaseSecret: 'secret-1',
  apoiaseUrl: 'https://api.apoia.se',
};

type Charge = { isBacker: boolean; isPaidThisMonth: boolean; thisMonthPaidValue?: number } | 'error';

/** API da Apoia.se de mentira: responde por e-mail e confere os dois cabeçalhos. */
function fakeApoiase(charges: Record<string, Charge>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const h = init?.headers as Record<string, string>;
    if (h['x-api-key'] !== 'key-1' || h.authorization !== 'Bearer secret-1') return new Response('{}', { status: 401 });
    const email = decodeURIComponent(url.split('/backers/charges/')[1]);
    const c = charges[email];
    if (c === 'error') return new Response('erro', { status: 500 });
    return Response.json(c ?? { isBacker: false, isPaidThisMonth: false });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(charges: Record<string, Charge> = {}, support: SupportOptions = SUPPORT) {
  const db = openDb(':memory:');
  seed(db);
  const api = fakeApoiase(charges);
  let clock = T0;
  const app = buildApp(db, {
    server: { cardImages: true, googleClientId: CLIENT_ID, support },
    googleKeys: async (kid) => (kid === 'k1' ? publicKey : null),
    fetchImpl: api.fetchImpl,
    now: () => clock,
  });
  return { db, app, calls: api.calls, setClock: (ms: number) => (clock = ms) };
}

let n = 0;
function account(db: DB, email: string, verified = true) {
  const u = upsertGoogleUser(db, { sub: `ap-${++n}`, email, emailVerified: verified, name: 'Fã', picture: null });
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}` } };
}
const verify = (app: ReturnType<typeof buildApp>, who: { headers: Record<string, string> }) =>
  app.inject({ method: 'POST', url: '/api/support/apoiase/sync', headers: who.headers });

describe('Apoia.se: apoio mensal vira o plano da conta', () => {
  it('o plano vale até o dia 10 do mês seguinte (fim do dia em Brasília)', () => {
    expect(apoiasePaidUntil(T0)).toBe('2026-11-11T02:59:59.000Z');
    // Dezembro: vira o ano.
    expect(apoiasePaidUntil(Date.parse('2026-12-15T15:00:00Z'))).toBe('2027-01-11T02:59:59.000Z');
    // 31/10 às 23:00 em Brasília ainda é outubro.
    expect(apoiasePaidUntil(Date.parse('2026-11-01T02:00:00Z'))).toBe('2026-11-11T02:59:59.000Z');
  });

  it('no login, quem apoia com o mesmo e-mail já entra com o plano do valor pago', async () => {
    const { app, calls } = setup({ 'fa@example.com': { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 30 } });
    const res = await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: idToken('g-1', 'Fa@Example.com') } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.supporter).toMatchObject({ tier: 'capitao', source: 'apoiase', until: '2026-11-11T02:59:59.000Z' });
    expect(calls).toEqual(['https://api.apoia.se/backers/charges/fa%40example.com']);
  });

  it('API fora do ar não impede o login', async () => {
    const { app } = setup({ 'off@example.com': 'error' });
    const res = await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: idToken('g-2', 'off@example.com') } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.supporter).toBeNull();
  });

  it('"Já apoio: verificar": valor define o plano; pouco tempo entre cliques é recusado; erros claros', async () => {
    const charges: Record<string, Charge> = { 'b@example.com': { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 15 } };
    const { db, app, setClock } = setup(charges);
    const fan = account(db, 'b@example.com');
    const first = await verify(app, fan);
    expect(first.json()).toMatchObject({ isBacker: true, isPaidThisMonth: true, tier: 'tripulante' });
    expect((await verify(app, fan)).statusCode).toBe(429);

    // Subiu o apoio para R$ 50: vira Almirante.
    charges['b@example.com'] = { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 50 };
    setClock(T0 + 60_000);
    expect((await verify(app, fan)).json().tier).toBe('almirante');
    const admin = account(db, 'adm@example.com');
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
    const payments = (await app.inject({ url: '/api/admin/support/payments', headers: admin.headers })).json();
    expect(payments).toEqual([expect.objectContaining({ kind: 'Apoia.se', tier: 'almirante', amount: 50, userId: fan.id })]);

    // Valor abaixo do menor plano não dá plano.
    const small = account(db, 'c@example.com');
    charges['c@example.com'] = { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 3 };
    expect((await verify(app, small)).json()).toMatchObject({ isBacker: true, tier: null });

    // E-mail não confirmado pelo Google: não consulta.
    expect((await verify(app, account(db, 'd@example.com', false))).statusCode).toBe(409);
    // API fora do ar.
    charges['e@example.com'] = 'error';
    expect((await verify(app, account(db, 'e@example.com'))).statusCode).toBe(502);
    // Sem login / sem a Apoia.se configurada.
    expect((await app.inject({ method: 'POST', url: '/api/support/apoiase/sync' })).statusCode).toBe(401);
    const off = setup({}, { ...SUPPORT, apoiaseKey: null });
    expect((await verify(off.app, account(off.db, 'f@example.com'))).statusCode).toBe(404);
    expect((await off.app.inject('/api/support')).json().apoiase).toBe(false);
    expect((await app.inject('/api/support')).json().apoiase).toBe(true);
  });

  it('começo do mês sem a cobrança compensada não tira o plano; um plano manual maior fica', async () => {
    const charges: Record<string, Charge> = { 'g@example.com': { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 15 } };
    const { db, app, setClock } = setup(charges);
    const fan = account(db, 'g@example.com');
    await verify(app, fan);
    // 3 de novembro: cartão ainda não cobrado. O plano de outubro segue até o dia 10.
    setClock(Date.parse('2026-11-03T15:00:00Z'));
    charges['g@example.com'] = { isBacker: true, isPaidThisMonth: false };
    expect((await verify(app, fan)).json()).toMatchObject({ isPaidThisMonth: false, tier: 'tripulante', until: '2026-11-11T02:59:59.000Z' });

    const vip = account(db, 'h@example.com');
    setSupporter(db, vip.id, 'almirante', null);
    charges['h@example.com'] = { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 5 };
    expect((await verify(app, vip)).json().tier).toBe('almirante');
  });

  it('rodada periódica: renova quem continua pagando; quem parou vence sozinho no dia 10', async () => {
    const charges: Record<string, Charge> = {
      'i@example.com': { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 30 },
      'j@example.com': { isBacker: true, isPaidThisMonth: true, thisMonthPaidValue: 30 },
    };
    const { db, app, setClock } = setup(charges);
    const stays = account(db, 'i@example.com');
    const leaves = account(db, 'j@example.com');
    await verify(app, stays);
    await verify(app, leaves);
    const syncAll = (app as unknown as { apoiaseSyncAll: () => Promise<{ checked: number; applied: number }> }).apoiaseSyncAll;

    // Novembro: um pagou, o outro cancelou.
    setClock(Date.parse('2026-11-08T15:00:00Z'));
    charges['j@example.com'] = { isBacker: false, isPaidThisMonth: false };
    expect(await syncAll()).toEqual({ checked: 2, applied: 1 });
    const me = async (who: { headers: Record<string, string> }) => (await app.inject({ url: '/api/auth/me', headers: who.headers })).json().user.supporter;
    expect(await me(stays)).toMatchObject({ tier: 'capitao', until: '2026-12-11T02:59:59.000Z' });
    expect(await me(leaves)).toMatchObject({ tier: 'capitao', until: '2026-11-11T02:59:59.000Z' });
  });
});
