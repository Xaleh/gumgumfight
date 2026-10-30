// Torneios para apps parceiros (SweetApp): lista e detalhe públicos, com CORS, ETag e só o
// que a página pública do torneio mostra (sem listas de deck, sem ids de conta).

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { PARTNER_TOURNAMENTS_SCHEMA } from '../src/partners/tournaments';
import { seed } from '../src/seed';

const DECKS = ['st01-luffy', 'st02-kid', 'st03-crocodile', 'st04-kaido'];

function setup() {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0 });
  return { db, app };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, role: Role = 'player') {
  const u = upsertGoogleUser(db, { sub: `pt-sub-${++n}`, email: `pt${n}@example.com`, emailVerified: true, name: `U${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-pt-${n}-0123456789abcdef` } };
}

const req = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who?: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });

/** Cria um torneio suíço com `players` inscritos. */
async function tournament(db: DB, app: App, org: ReturnType<typeof login>, players: number, extra: object = {}) {
  const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa Parceira', description: 'Aberta', format: 'egb', structure: 'swiss', ...extra })).json();
  const ps = Array.from({ length: players }, () => login(db));
  for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i % DECKS.length] });
  return { t, ps };
}

/** Lança p1 em toda partida pendente e avança até o fim. */
async function finish(app: App, org: ReturnType<typeof login>, id: string) {
  let view = (await req(app, 'POST', `/api/tournaments/${id}/start`, org, { begin: true })).json();
  for (let guard = 0; view.status !== 'finished' && guard < 20; guard++) {
    for (const m of view.rounds[view.round - 1].matches.filter((x: { result: unknown }) => !x.result)) {
      await req(app, 'PUT', `/api/tournaments/${id}/matches/${m.id}/result`, org, { result: 'p1' });
    }
    view = (await req(app, 'POST', `/api/tournaments/${id}/next`, org, { begin: true })).json();
  }
  expect(view.status).toBe('finished');
  return view;
}

describe('torneios para parceiros', () => {
  it('lista pública com CORS, filtros, link para o site e sem dados de conta', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    await tournament(db, app, org, 2);
    const { t: free } = await tournament(db, app, org, 0, { name: 'Livre', format: 'free', startsAt: '2030-01-01T20:00:00Z', checkIn: true, maxPlayers: 16 });

    const res = await req(app, 'GET', '/api/partners/tournaments', undefined);
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(res.headers.etag).toBeTruthy();
    const body = res.json();
    expect(body).toMatchObject({ schemaVersion: PARTNER_TOURNAMENTS_SCHEMA, site: 'http://localhost:80' });
    expect(body.tournaments).toHaveLength(2);
    const livre = body.tournaments.find((x: { id: string }) => x.id === free.id);
    expect(livre).toMatchObject({
      name: 'Livre',
      format: 'free',
      status: 'registration',
      players: 0,
      maxPlayers: 16,
      startsAt: '2030-01-01T20:00:00.000Z',
      checkIn: true,
      checkInOpensAt: '2030-01-01T19:30:00.000Z',
      prize: null,
      organizer: { name: expect.stringMatching(/^Pirata /) },
      champion: null,
      totalRounds: null,
      url: `http://localhost:80/?torneio=${free.id}`,
    });
    // Nada de ids de conta, e-mail nem listas de deck.
    const text = JSON.stringify(body);
    expect(text).not.toContain(org.id);
    expect(text).not.toContain('@example.com');
    expect(text).not.toContain('"cards"');

    // Filtros e validação.
    expect((await req(app, 'GET', '/api/partners/tournaments?format=free')).json().tournaments.map((x: { id: string }) => x.id)).toEqual([free.id]);
    expect((await req(app, 'GET', '/api/partners/tournaments?status=finished')).json().tournaments).toEqual([]);
    expect((await req(app, 'GET', '/api/partners/tournaments?status=running,registration&limit=1')).json().tournaments).toHaveLength(1);
    for (const q of ['status=x', 'format=x', 'limit=0', 'limit=abc']) {
      const bad = await req(app, 'GET', `/api/partners/tournaments?${q}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.headers['access-control-allow-origin']).toBe('*');
    }

    // ETag: o parceiro revalida sem corpo enquanto nada muda; uma gravação invalida.
    const again = await req(app, 'GET', '/api/partners/tournaments', { headers: { 'if-none-match': String(res.headers.etag) } });
    expect(again.statusCode).toBe(304);
    await req(app, 'PUT', `/api/tournaments/${free.id}`, org, { name: 'Livre 2', format: 'free', structure: 'swiss' });
    const changed = await req(app, 'GET', '/api/partners/tournaments', { headers: { 'if-none-match': String(res.headers.etag) } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().tournaments.find((x: { id: string }) => x.id === free.id).name).toBe('Livre 2');
  });

  it('detalhe: Líderes só depois do início, classificação, rodadas e o campeão no fim', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const { t, ps } = await tournament(db, app, org, 4);

    // Inscrições abertas: sem classificação e sem Líder de ninguém.
    let d = (await req(app, 'GET', `/api/partners/tournaments/${t.id}`)).json();
    expect(d).toMatchObject({ id: t.id, status: 'registration', players: 4, standings: [], rounds: [], champion: null });
    expect(d.url).toBe(`http://localhost:80/?torneio=${t.id}`);

    const view = await finish(app, org, t.id);
    d = (await req(app, 'GET', `/api/partners/tournaments/${t.id}`)).json();
    expect(d.status).toBe('finished');
    expect(d.totalRounds).toBe(2);
    expect(d.standings).toHaveLength(4);
    expect(d.standings[0]).toMatchObject({ rank: 1, points: 6, wins: 2, losses: 0, dropped: false, leader: { id: expect.stringMatching(/^ST0\d-001$/), name: expect.any(String) } });
    expect(d.standings[0].leader.image).toMatch(/^https?:\/\//);
    expect(d.champion).toEqual({ name: view.standings[0].name, leader: d.standings[0].leader });
    expect(d.rounds).toHaveLength(2);
    expect(d.rounds[0]).toMatchObject({ round: 1, stage: 'swiss', label: 'Rodada 1', bestOf: 1 });
    expect(d.rounds[0].matches[0]).toMatchObject({ table: 1, p1: { name: expect.any(String) }, p2: { name: expect.any(String) }, result: 'p1', wins: [1, 0] });
    // Os nomes são os apelidos públicos; ids de conta não saem.
    const text = JSON.stringify(d);
    for (const p of ps) expect(text).not.toContain(p.id);
    expect(text).not.toContain('"cards"');

    // Na lista, o torneio encerrado traz o campeão.
    const listed = (await req(app, 'GET', '/api/partners/tournaments?status=finished')).json().tournaments;
    expect(listed).toHaveLength(1);
    expect(listed[0].champion).toEqual(d.champion);

    const missing = await req(app, 'GET', '/api/partners/tournaments/nao-existe');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['access-control-allow-origin']).toBe('*');
  });

  it('sem imagens no servidor, o Líder vem sem imagem', async () => {
    const db = openDb(':memory:');
    seed(db);
    const app = buildApp(db, { server: { cardImages: false }, onlineRateLimit: 1e9, botDelayMs: 0 });
    const org = login(db, 'organizer');
    const { t } = await tournament(db, app, org, 2);
    await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true });
    const d = (await req(app, 'GET', `/api/partners/tournaments/${t.id}`)).json();
    expect(d.status).toBe('running');
    expect(d.standings.map((s: { leader: { image: unknown } }) => s.leader.image)).toEqual([null, null]);
  });
});
