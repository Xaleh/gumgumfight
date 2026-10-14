import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import type { ServerOptions, SupportOptions } from '../src/config';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import { crc16, pixPayload } from '../src/support/pix';
import { tierFromPayment } from '../src/support/tiers';

const KOFI = 'kofi-token-123';
const INTERNAL = 'internal-token-456';
const SUPPORT: SupportOptions = {
  pixKey: '123e4567-e89b-12d3-a456-426614174000',
  pixName: 'Fulano de Tal',
  pixCity: 'São Paulo',
  coffeeUrl: 'https://ko-fi.com/gumgum',
  monthlyUrl: 'https://ko-fi.com/gumgum/tiers',
  goalBrl: 120,
  kofiToken: KOFI,
  internalToken: INTERNAL,
};

function setup(server: Partial<ServerOptions> = {}) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true, support: SUPPORT, ...server } });
  return { db, app };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, role: Role = 'player', opts: { email?: string; verified?: boolean } = {}) {
  n++;
  const email = opts.email ?? `s${n}@example.com`;
  const u = upsertGoogleUser(db, { sub: `support-${n}`, email, emailVerified: opts.verified ?? true, name: `S${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { id: u.id, email, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-s${n}-0123456789abcdef` } };
}
const get = (app: App, url: string, who?: { headers: Record<string, string> }) => app.inject({ method: 'GET', url, headers: who?.headers ?? {} });

/** Pagamento como o Ko-fi envia: formulário com o campo `data` em JSON. */
const kofi = (app: App, data: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/support/kofi',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      data: JSON.stringify({
        verification_token: KOFI,
        kofi_transaction_id: `tx-${++n}`,
        type: 'Subscription',
        is_subscription_payment: true,
        amount: '15.00',
        currency: 'BRL',
        timestamp: new Date().toISOString(),
        ...data,
      }),
    }).toString(),
  });

describe('Pix copia e cola (BR Code)', () => {
  it('CRC16-CCITT confere com o valor de referência', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('monta os campos na ordem do padrão, sem acentos, e termina com o CRC certo', () => {
    const code = pixPayload({ key: SUPPORT.pixKey!, name: 'Fulano de Tal da Silva Souza Junior', city: 'São Paulo', amount: 10 });
    expect(code.startsWith('000201')).toBe(true);
    expect(code).toContain('0014br.gov.bcb.pix');
    expect(code).toContain(`0136${SUPPORT.pixKey}`);
    expect(code).toContain('52040000530398654051' + '0.00');
    expect(code).toContain('5802BR');
    // Nome cortado em 25 caracteres, cidade sem acento.
    expect(code).toContain('5925FULANO DE TAL DA SILVA SO');
    expect(code).toContain('6009SAO PAULO');
    expect(code).toContain('62070503***');
    expect(code.slice(-8, -4)).toBe('6304');
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
    // Sem valor: quem paga digita (o campo 54 some).
    expect(pixPayload({ key: 'a@b.com', name: 'X', city: 'Rio' })).not.toMatch(/530398654/);
    expect(() => pixPayload({ key: '', name: 'X', city: 'Rio' })).toThrow();
    expect(() => pixPayload({ key: 'a@b.com', name: 'X', city: 'Rio', amount: -1 })).toThrow();
  });
});

describe('apoio: planos', () => {
  it('reconhece o plano pelo nome (com ou sem acento) ou pelo valor em reais', () => {
    expect(tierFromPayment('Capitão', 0, 'USD')).toBe('capitao');
    expect(tierFromPayment('ALMIRANTE da frota', 0, 'BRL')).toBe('almirante');
    expect(tierFromPayment('Apoio', 15, 'BRL')).toBe('tripulante');
    expect(tierFromPayment(null, 49.99, 'BRL')).toBe('capitao');
    expect(tierFromPayment(null, 3, 'BRL')).toBeNull();
    expect(tierFromPayment(null, 50, 'USD')).toBeNull();
  });

  it('/api/support mostra Pix, links, planos e a meta; sem nada configurado, o apoio fica desligado', async () => {
    const { app } = setup();
    const s = (await get(app, '/api/support')).json();
    expect(s).toMatchObject({ enabled: true, coffeeUrl: SUPPORT.coffeeUrl, goal: 120, covered: 0, supporters: 0, me: null });
    expect(s.pix.codes.map((c: { amount: number | null }) => c.amount)).toEqual([null, 5, 10, 25]);
    expect(s.tiers.map((t: { id: string; price: number }) => [t.id, t.price])).toEqual([
      ['grumete', 5],
      ['tripulante', 15],
      ['capitao', 30],
      ['almirante', 50],
    ]);
    expect((await get(app, '/api/config')).json()).toMatchObject({ support: true, access: 'open' });
    const off = setup({ support: {} }).app;
    expect((await get(off, '/api/config')).json().support).toBe(false);
    expect((await get(off, '/api/support')).json()).toMatchObject({ enabled: false, pix: null });
  });

  it('admin dá e tira o plano à mão; o plano vencido não vale', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const fan = login(db);
    const put = (who: { headers: Record<string, string> }, payload: object) =>
      app.inject({ method: 'PUT', url: `/api/admin/users/${fan.id}/supporter`, headers: who.headers, payload });
    expect((await put(fan, { tier: 'almirante' })).statusCode).toBe(403);
    expect((await put(admin, { tier: 'imperador' })).statusCode).toBe(400);
    expect((await put(admin, { tier: 'capitao', until: '2099-12-31' })).json()).toMatchObject({ supporterTier: 'capitao', supporterSource: 'manual' });
    expect((await get(app, '/api/auth/me', fan)).json().user.supporter).toMatchObject({ tier: 'capitao', source: 'manual' });
    const s = (await get(app, '/api/support', fan)).json();
    expect(s).toMatchObject({ covered: 30, supporters: 1, me: { tier: 'capitao' } });
    // Vencido ontem: sem plano.
    await put(admin, { tier: 'capitao', until: '2020-01-01' });
    expect((await get(app, '/api/auth/me', fan)).json().user.supporter).toBeNull();
    expect((await get(app, '/api/support')).json().covered).toBe(0);
    // Tirar o plano.
    await put(admin, { tier: 'tripulante' });
    await put(admin, { tier: null });
    expect((await get(app, '/api/auth/me', fan)).json().user.supporter).toBeNull();
  });

  it('lista de Apoiadores: só quem aceitou aparecer, com o nome público, Almirantes primeiro', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const [a, b, c] = [login(db), login(db), login(db)];
    for (const [who, tier] of [
      [a, 'grumete'],
      [b, 'almirante'],
      [c, 'tripulante'],
    ] as const) {
      await app.inject({ method: 'PUT', url: `/api/admin/users/${who.id}/supporter`, headers: admin.headers, payload: { tier } });
      // O nome público vem do perfil de estatísticas.
      await app.inject({ method: 'PUT', url: '/api/players/me', headers: who.headers, payload: { name: `Pirata ${tier}` } });
    }
    expect((await app.inject({ method: 'PUT', url: '/api/support/me', payload: { public: true } })).statusCode).toBe(401);
    for (const who of [a, b]) await app.inject({ method: 'PUT', url: '/api/support/me', headers: who.headers, payload: { public: true } });
    expect((await get(app, '/api/support/supporters')).json()).toEqual([
      { name: 'Pirata almirante', tier: 'almirante' },
      { name: 'Pirata grumete', tier: 'grumete' },
    ]);
  });
});

describe('apoio: webhook do Ko-fi', () => {
  it('assinatura liga o plano na conta do mesmo e-mail (confirmado) por 35 dias; reenvio não duplica', async () => {
    const { db, app } = setup();
    const fan = login(db, 'player', { email: 'Fan@Example.com' });
    const res = await kofi(app, { email: 'fan@example.com', tier_name: 'Tripulante', kofi_transaction_id: 'tx-fixo' });
    expect(res.json()).toMatchObject({ ok: true, tier: 'tripulante', applied: true });
    const me = (await get(app, '/api/auth/me', fan)).json().user.supporter;
    expect(me).toMatchObject({ tier: 'tripulante', source: 'kofi' });
    const days = (Date.parse(me.until) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(34);
    expect(days).toBeLessThan(36);
    expect((await kofi(app, { email: 'fan@example.com', kofi_transaction_id: 'tx-fixo' })).json()).toMatchObject({ duplicate: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM supporter_payments').get()).toEqual({ n: 1 });
  });

  it('recusa token errado; doação avulsa não dá plano; e-mail não confirmado não recebe plano', async () => {
    const { db, app } = setup();
    expect((await kofi(app, { verification_token: 'errado' })).statusCode).toBe(401);
    const unverified = login(db, 'player', { email: 'nao@confirmado.com', verified: false });
    expect((await kofi(app, { email: 'nao@confirmado.com' })).json()).toMatchObject({ applied: false });
    expect((await get(app, '/api/auth/me', unverified)).json().user.supporter).toBeNull();
    const donor = login(db);
    expect((await kofi(app, { email: donor.email, type: 'Donation', is_subscription_payment: false, amount: '50' })).json()).toMatchObject({
      tier: null,
      applied: false,
    });
    // Sem token configurado, o webhook nem existe.
    const off = setup({ support: { ...SUPPORT, kofiToken: null } }).app;
    expect((await kofi(off, {})).statusCode).toBe(404);
  });

  it('pagou antes de criar a conta: o plano entra no primeiro login', async () => {
    const { db, app } = setup();
    await kofi(app, { email: 'novo@example.com', tier_name: 'Almirante', amount: '50' });
    const fresh = login(db, 'player', { email: 'novo@example.com' });
    expect((await get(app, '/api/auth/me', fresh)).json().user.supporter.tier).toBe('almirante');
  });

  it('pagamento menor não derruba um plano manual maior', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const fan = login(db);
    await app.inject({ method: 'PUT', url: `/api/admin/users/${fan.id}/supporter`, headers: admin.headers, payload: { tier: 'almirante' } });
    expect((await kofi(app, { email: fan.email, tier_name: 'Grumete', amount: '5' })).json().applied).toBe(false);
    expect((await get(app, '/api/auth/me', fan)).json().user.supporter.tier).toBe('almirante');
  });
});

describe('apoio: consulta interna da homologação', () => {
  it('responde o plano pelo e-mail confirmado, só com o token', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const fan = login(db);
    await app.inject({ method: 'PUT', url: `/api/admin/users/${fan.id}/supporter`, headers: admin.headers, payload: { tier: 'tripulante' } });
    const ask = (email: string, token = INTERNAL) =>
      app.inject({ method: 'GET', url: `/api/internal/supporter?email=${encodeURIComponent(email)}`, headers: { authorization: `Bearer ${token}` } });
    expect((await ask(fan.email, 'errado')).statusCode).toBe(401);
    expect((await ask(fan.email)).json()).toEqual({ tier: 'tripulante', admin: false });
    expect((await ask(admin.email)).json()).toEqual({ tier: null, admin: true });
    expect((await ask('ninguem@example.com')).json()).toEqual({ tier: null, admin: false });
  });
});
