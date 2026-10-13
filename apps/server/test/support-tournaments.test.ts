import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setSupporter, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import type { SupporterTier } from '../src/support/tiers';
import { monthStart } from '../src/tournaments/routes';

// 2026-10-20 12:00 em Brasília.
const T0 = Date.parse('2026-10-20T15:00:00Z');

function setup() {
  const db = openDb(':memory:');
  seed(db);
  let clock = T0;
  const app = buildApp(db, { server: { cardImages: true, support: { coffeeUrl: 'https://ko-fi.com/x' } }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => clock });
  return { db, app, setClock: (ms: number) => (clock = ms) };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, opts: { role?: Role; tier?: SupporterTier } = {}) {
  n++;
  const u = upsertGoogleUser(db, { sub: `st-${n}`, email: `st${n}@example.com`, emailVerified: true, name: `ST${n}`, picture: null });
  if (opts.role) setUserRole(db, u.id, opts.role);
  if (opts.tier) setSupporter(db, u.id, opts.tier, null);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-st${n}-0123456789abcdef` } };
}
const req = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who?: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });
const body = (name = 'Copa da Tripulação') => ({ name, format: 'egb', structure: 'swiss' });

describe('torneios: cota de apoiador', () => {
  it('mês civil em Brasília', () => {
    expect(monthStart(Date.parse('2026-10-20T15:00:00Z'))).toBe('2026-10-01T03:00:00.000Z');
    // 1º de novembro à 01:00 em Brasília: novembro.
    expect(monthStart(Date.parse('2026-11-01T04:00:00Z'))).toBe('2026-11-01T03:00:00.000Z');
    // 31/10 às 23:00 em Brasília (02:00 UTC de 1/11) ainda é outubro.
    expect(monthStart(Date.parse('2026-11-01T02:00:00Z'))).toBe('2026-10-01T03:00:00.000Z');
  });

  it('Tripulante não organiza; Capitão cria até 5 por mês, de até 64 jogadores; apagar antes de começar devolve a vaga', async () => {
    const { db, app, setClock } = setup();
    const trip = login(db, { tier: 'tripulante' });
    const cap = login(db, { tier: 'capitao' });
    const list = async (who: { headers: Record<string, string> }) => (await req(app, 'GET', '/api/tournaments', who)).json();
    expect((await list(trip)).organize).toBeNull();
    const denied = await req(app, 'POST', '/api/tournaments', trip, body());
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatch(/Capitão e Almirante/);

    expect((await list(cap)).organize).toEqual({ kind: 'supporter', perMonth: 5, used: 0, maxPlayers: 64 });
    expect((await req(app, 'POST', '/api/tournaments', cap, { ...body(), maxPlayers: 65 })).statusCode).toBe(400);
    const first = (await req(app, 'POST', '/api/tournaments', cap, body())).json();
    // Sem limite informado: fica no teto do plano.
    expect(first).toMatchObject({ maxPlayers: 64, canManage: true });
    expect((await req(app, 'PUT', `/api/tournaments/${first.id}`, cap, { ...body(), maxPlayers: 128 })).statusCode).toBe(400);
    const ids = [first.id];
    for (let i = 0; i < 4; i++) ids.push((await req(app, 'POST', '/api/tournaments', cap, body(`Copa ${i}`))).json().id);
    expect((await list(cap)).organize.used).toBe(5);
    expect((await list(cap)).canCreate).toBe(false);
    const full = await req(app, 'POST', '/api/tournaments', cap, body('Sexta'));
    expect(full.statusCode).toBe(403);
    expect(full.json().error).toMatch(/5 torneios este mês/);

    // Apagar um que não começou devolve a vaga.
    expect((await req(app, 'DELETE', `/api/tournaments/${ids[0]}`, cap)).statusCode).toBe(204);
    expect((await list(cap)).organize.used).toBe(4);
    expect((await req(app, 'POST', '/api/tournaments', cap, body('De novo'))).statusCode).toBe(201);

    // No mês seguinte a cota renova.
    setClock(Date.parse('2026-11-02T15:00:00Z'));
    expect((await list(cap)).organize.used).toBe(0);
  });

  it('o criador continua gerenciando o torneio da cota mesmo depois que o plano vence', async () => {
    const { db, app } = setup();
    const cap = login(db, { tier: 'capitao' });
    const t = (await req(app, 'POST', '/api/tournaments', cap, body())).json();
    setSupporter(db, cap.id, null, null);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, cap)).json().canManage).toBe(true);
    expect((await req(app, 'POST', '/api/tournaments', cap, body('Outro'))).statusCode).toBe(403);
  });

  it('Organizador e Admin seguem sem limite de cota', async () => {
    const { db, app } = setup();
    const org = login(db, { role: 'organizer' });
    expect((await req(app, 'GET', '/api/tournaments', org)).json().organize).toMatchObject({ kind: 'role', perMonth: null, maxPlayers: 256 });
    for (let i = 0; i < 6; i++) expect((await req(app, 'POST', '/api/tournaments', org, body(`Copa ${i}`))).statusCode).toBe(201);
    expect((await req(app, 'POST', '/api/tournaments', org, { ...body(), maxPlayers: 200 })).json().maxPlayers).toBe(200);
  });
});

describe('torneios do time e lojas patrocinadoras', () => {
  it('só admin marca o torneio do time, o prêmio e a loja; inscrição antecipada de 48 h só para Almirantes', async () => {
    const { db, app, setClock } = setup();
    const admin = login(db, { role: 'admin' });
    const org = login(db, { role: 'organizer' });
    const almirante = login(db, { tier: 'almirante' });
    const capitao = login(db, { tier: 'capitao' });
    const player = login(db);

    const shop = (await req(app, 'POST', '/api/admin/sponsors', admin, { name: 'Loja do Porto', url: 'https://loja.example', offer: '10% no booster' })).json();
    expect((await req(app, 'POST', '/api/admin/sponsors', org, { name: 'X' })).statusCode).toBe(403);

    // Organizador comum não consegue marcar como torneio do time.
    const plain = (await req(app, 'POST', '/api/tournaments', org, { ...body('Copa comum'), official: true, prize: 'Box', sponsorId: shop.id })).json();
    expect(plain).toMatchObject({ official: false, prize: null, sponsor: null, priorityUntil: null });

    expect((await req(app, 'POST', '/api/tournaments', admin, { ...body(), official: true, sponsorId: 'sp-nao-existe' })).statusCode).toBe(400);
    const t = (
      await req(app, 'POST', '/api/tournaments', admin, {
        ...body(),
        official: true,
        prize: '1 booster box, cortesia da Loja do Porto',
        sponsorId: shop.id,
        priority: true,
      })
    ).json();
    expect(t).toMatchObject({ official: true, prize: '1 booster box, cortesia da Loja do Porto', priorityOpen: true });
    expect(t.sponsor).toMatchObject({ id: shop.id, name: 'Loja do Porto', offer: '10% no booster' });
    expect(Date.parse(t.priorityUntil) - T0).toBe(48 * 3_600_000);

    const reg = (who: { headers: Record<string, string> }, deckId: string) => req(app, 'POST', `/api/tournaments/${t.id}/register`, who, { deckId });
    const early = await reg(capitao, 'st02-kid');
    expect(early.statusCode).toBe(403);
    expect(early.json().error).toMatch(/Almirante/);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, player)).json().canRegister).toBe(false);
    const ok = (await reg(almirante, 'st01-luffy')).json();
    // Selo do plano ao lado do nome.
    expect(ok.players.find((p: { userId: string }) => p.userId === almirante.id).supporter).toBe('almirante');

    // Passadas as 48 h, abre para todos.
    setClock(T0 + 49 * 3_600_000);
    expect((await reg(player, 'st03-crocodile')).statusCode).toBe(200);
    const list = (await req(app, 'GET', '/api/tournaments')).json().tournaments;
    expect(list.find((x: { id: string }) => x.id === t.id)).toMatchObject({ official: true, sponsor: { name: 'Loja do Porto' } });

    // Editar sem marcar a inscrição antecipada a desliga.
    const edited = (await req(app, 'PUT', `/api/tournaments/${t.id}`, admin, { ...body(), official: true, sponsorId: shop.id })).json();
    expect(edited.priorityUntil).toBeNull();
  });

  it('lojas: cadastro, período ativo, lugares do site e logo validado pelos bytes', async () => {
    const { db, app } = setup();
    const admin = login(db, { role: 'admin' });
    const make = (payload: object) => req(app, 'POST', '/api/admin/sponsors', admin, payload);
    expect((await make({ name: 'L' })).statusCode).toBe(400);
    expect((await make({ name: 'Loja', url: 'javascript:alert(1)' })).statusCode).toBe(400);
    const a = (await make({ name: 'Loja A', placements: ['tournaments', 'home'] })).json();
    await make({ name: 'Loja Futura', startsAt: '2099-01-01' });
    await make({ name: 'Loja Antiga', endsAt: '2020-01-01' });
    const pub = (await req(app, 'GET', '/api/sponsors')).json();
    expect(pub.sponsors.map((s: { name: string }) => s.name)).toEqual(['Loja A']);
    expect((await req(app, 'GET', '/api/sponsors?placement=home')).json().sponsors).toHaveLength(1);
    expect((await req(app, 'GET', '/api/admin/sponsors', admin)).json()).toHaveLength(3);

    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = (image: unknown) => req(app, 'PUT', `/api/admin/sponsors/${a.id}/logo`, admin, { image });
    expect((await up(Buffer.from('<svg onload="alert(1)"/>').toString('base64'))).statusCode).toBe(400);
    const withLogo = (await up(`data:image/png;base64,${png.toString('base64')}`)).json();
    expect(withLogo.logoUrl).toMatch(new RegExp(`^/api/sponsors/${a.id}/logo\\?v=1$`));
    const logo = await req(app, 'GET', withLogo.logoUrl);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
    expect(logo.rawPayload.equals(png)).toBe(true);
    expect((await up(null)).json().logoUrl).toBeNull();
    expect((await req(app, 'DELETE', `/api/admin/sponsors/${a.id}`, admin)).statusCode).toBe(204);
    expect((await req(app, 'GET', '/api/sponsors')).json().sponsors).toHaveLength(0);
  });
});
