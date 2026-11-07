// Sala do Tempo: torneio simulado do Time com jogadores virtuais (docs/plano-sala-do-tempo.md).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, setUserTeam, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { seed } from '../src/seed';
import { matchupRate, parsePreset, simulateSeries, spawnVirtuals, winProbability } from '../src/tournaments/chamber';
import { getTournament, listVirtuals } from '../src/tournaments/store';

/** Evento de teste: 4 Líderes dos Starter Decks (válidos no EGB da semente), 16 jogadores, 3 rodadas e top 4. */
const PRESET = {
  name: 'Regional de teste',
  description: 'Evento simulado dos testes.',
  format: 'egb',
  players: 16,
  rounds: 3,
  topCut: 4,
  leaders: [
    { leader: 'ST01-001', share: 0.5 },
    { leader: 'ST02-001', share: 0.25, deck: 'st02-kid' },
    { leader: 'ST09-001', share: 0.0625 },
  ],
  matchups: { 'ST01-001': { 'ST02-001': 0.7 } },
};

function presetsDir(presets: Record<string, unknown> = { regional: PRESET }) {
  const dir = mkdtempSync(join(tmpdir(), 'gumgum-chamber-'));
  for (const [id, p] of Object.entries(presets)) writeFileSync(join(dir, `${id}.json`), JSON.stringify(p));
  return dir;
}

function setup(opts: { botRooms?: boolean; presets?: Record<string, unknown> } = {}) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, {
    server: { cardImages: true, onlineBotRooms: opts.botRooms ?? true },
    onlineRateLimit: 1e9,
    botDelayMs: 0,
    chamberDir: presetsDir(opts.presets),
  });
  return { db, app };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, role: Role = 'player', team = false) {
  const u = upsertGoogleUser(db, { sub: `ch-${++n}`, email: `ch${n}@example.com`, emailVerified: true, name: `C${n}`, picture: null });
  setUserRole(db, u.id, role);
  setUserTeam(db, u.id, team);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-ch-${n}-0123456789abcdef` } };
}
const req = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who?: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });
const lobbyOf = (app: App) => (app as unknown as { onlineLobby: Lobby }).onlineLobby;

describe('Sala do Tempo: preset e mesas estatísticas', () => {
  it('preset: confere os campos e recusa o que não serve', () => {
    const p = parsePreset('regional', PRESET);
    expect(typeof p).not.toBe('string');
    expect(p).toMatchObject({ id: 'regional', format: 'egb', spoilers: false, players: 16, rounds: 3, topCut: 4, bo3From: null, bo5From: null });
    expect(parsePreset('Bad Id', PRESET)).toMatch(/id/);
    expect(parsePreset('x', { ...PRESET, format: 'x' })).toMatch(/formato/);
    expect(parsePreset('x', { ...PRESET, players: 2 })).toMatch(/players/);
    expect(parsePreset('x', { ...PRESET, topCut: 3 })).toMatch(/topCut/);
    expect(parsePreset('x', { ...PRESET, leaders: [{ leader: 'A', share: 0.7 }, { leader: 'B', share: 0.7 }] })).toMatch(/soma/);
    expect(parsePreset('x', { ...PRESET, matchups: { A: { B: 1.2 } } })).toMatch(/matchup/);
    // O Livre sempre aceita spoilers.
    expect(parsePreset('x', { ...PRESET, format: 'free' })).toMatchObject({ spoilers: true });
  });

  it('confronto: o par inverso vale ao contrário; a força desloca a chance; a série termina na maioria', () => {
    const p = { matchups: { A: { B: 0.7 } } };
    expect(matchupRate(p, 'A', 'B')).toBe(0.7);
    expect(matchupRate(p, 'B', 'A')).toBeCloseTo(0.3);
    expect(matchupRate(p, 'A', 'C')).toBe(0.5);
    const even = winProbability(p, { leader: 'A', skill: 0 }, { leader: 'C', skill: 0 });
    expect(even).toBeCloseTo(0.5);
    expect(winProbability(p, { leader: 'A', skill: 1 }, { leader: 'C', skill: 0 })).toBeGreaterThan(even);
    expect(winProbability(p, { leader: 'A', skill: 0 }, { leader: 'B', skill: 0 })).toBeCloseTo(0.7);
    // Melhor de 3 com p = 1: 2 x 0; com p = 0: 0 x 2.
    expect(simulateSeries(3, 1, () => 0.5)).toEqual([2, 0]);
    expect(simulateSeries(3, 0, () => 0.5)).toEqual([0, 2]);
    expect(simulateSeries(1, 0.5, () => 0.9)).toEqual([0, 1]);
  });

  it('sorteio dos virtuais: as fatias viram contagens, o deck escolhido vale, o resto sorteia entre os decks prontos', () => {
    const { db } = setup();
    const p = parsePreset('regional', PRESET);
    if (typeof p === 'string') throw new Error(p);
    const t = { format: 'egb' as const, spoilers: false, chamberSize: 16 };
    const vs = spawnVirtuals(db, p, t as never, 16, new Date());
    expect(vs).toHaveLength(16);
    expect(new Set(vs.map((v) => v.id)).size).toBe(16);
    // As fatias viram contagens (8, 4 e 1); os 3 que sobram ("outros") sorteiam entre todos os decks prontos, inclusive
    // os destes Líderes, por isso "pelo menos".
    const by = (leader: string) => vs.filter((v) => v.leader === leader);
    expect(by('ST01-001').length).toBeGreaterThanOrEqual(8);
    expect(by('ST02-001').length).toBeGreaterThanOrEqual(4);
    expect(by('ST02-001').filter((v) => v.deckId === 'st02-kid').length).toBeGreaterThanOrEqual(4);
    expect(by('ST09-001').length).toBeGreaterThanOrEqual(1);
    expect(by('ST01-001').length + by('ST02-001').length + by('ST09-001').length).toBeLessThanOrEqual(16);
    expect(vs.every((v) => v.deckId)).toBe(true);

    expect(vs.some((v) => v.skill !== 0)).toBe(true);
  });
});

describe('Sala do Tempo: rotas', () => {
  it('só quem é do Time vê os eventos, abre a sala e se inscreve; a sala some da lista dos outros', async () => {
    const { db, app } = setup();
    const player = login(db);
    const team = login(db, 'player', true);
    expect((await req(app, 'GET', '/api/tournaments/chamber/presets')).statusCode).toBe(401);
    expect((await req(app, 'GET', '/api/tournaments/chamber/presets', player)).statusCode).toBe(403);
    const presets = (await req(app, 'GET', '/api/tournaments/chamber/presets', team)).json();
    expect(presets.botRooms).toBe(true);
    expect(presets.presets).toHaveLength(1);
    const [p] = presets.presets;
    expect(p).toMatchObject({ id: 'regional', players: 16, rounds: 3, topCut: 4 });
    // Por Líder, o deck que o bot joga: o escolhido no preset, senão um deck pronto com o Líder; sem nenhum, nulo.
    expect(p.leaders.map((l: { leader: string; deckId: string | null }) => [l.leader, l.deckId])).toEqual([
      ['ST01-001', 'st01-luffy'],
      ['ST02-001', 'st02-kid'],
      ['ST09-001', 'st09-yamato'],
    ]);
    expect(p.others).toBeGreaterThan(10);

    expect((await req(app, 'POST', '/api/tournaments/chamber', player, { preset: 'regional' })).statusCode).toBe(403);
    expect((await req(app, 'POST', '/api/tournaments/chamber', team, { preset: 'nope' })).statusCode).toBe(404);
    expect((await req(app, 'POST', '/api/tournaments/chamber', team, { preset: 'regional', players: 2 })).statusCode).toBe(400);
    const created = await req(app, 'POST', '/api/tournaments/chamber', team, { preset: 'regional', name: 'Sala do Tempo: Regional' });
    expect(created.statusCode, created.body).toBe(201);
    const t = created.json();
    // Quem abriu gerencia, mesmo sem ser Organizador; o evento vem com a distribuição e os decks dos virtuais.
    expect(t).toMatchObject({ name: 'Sala do Tempo: Regional', status: 'registration', canManage: true, structure: 'swiss', topCut: 4, maxPlayers: 16 });
    expect(t.chamber).toMatchObject({ preset: 'regional', presetName: 'Regional de teste', size: 16, virtuals: 0, botRooms: true, presetMissing: false });
    expect(t.chamber.leaders).toHaveLength(3);
    expect(t.chamber.leaders[1]).toMatchObject({ leader: 'ST02-001', share: 0.25, deckId: 'st02-kid', count: 0 });
    // A sala não se edita (segue o evento).
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}`, team, { name: 'Outro', format: 'egb', structure: 'swiss' })).statusCode).toBe(409);

    // Só o Time se inscreve; a lista mostra a sala só para o Time.
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/register`, player, { deckId: 'st01-luffy' })).statusCode).toBe(403);
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/register`, team, { deckId: 'st01-luffy' })).statusCode).toBe(200);
    const forPlayer = (await req(app, 'GET', '/api/tournaments', player)).json();
    expect(forPlayer.tournaments).toHaveLength(0);
    expect(forPlayer.canChamber).toBe(false);
    const forTeam = (await req(app, 'GET', '/api/tournaments', team)).json();
    expect(forTeam.tournaments.map((x: { id: string; chamber: boolean }) => [x.id, x.chamber])).toEqual([[t.id, true]]);
    expect(forTeam.canChamber).toBe(true);
  });

  it('sem o treino contra o bot do servidor, a sala não abre', async () => {
    const { db, app } = setup({ botRooms: false });
    const team = login(db, 'player', true);
    expect((await req(app, 'GET', '/api/tournaments/chamber/presets', team)).json().botRooms).toBe(false);
    expect((await req(app, 'POST', '/api/tournaments/chamber', team, { preset: 'regional' })).statusCode).toBe(409);
    expect((await req(app, 'GET', '/api/tournaments', team)).json().canChamber).toBe(false);
  });

  it('o evento inteiro: virtuais completam as vagas, mesas só de virtuais saem no sorteio, a mesa contra o virtual é contra o Bot do Time', async () => {
    const { db, app } = setup();
    const host = login(db, 'player', true);
    const t = (await req(app, 'POST', '/api/tournaments/chamber', host, { preset: 'regional' })).json();
    // Um humano já basta para começar: os virtuais completam o evento (e a mesa dele é sempre contra um virtual).
    await req(app, 'POST', `/api/tournaments/${t.id}/register`, host, { deckId: 'st01-luffy' });
    const started = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, host, {})).json();
    expect(started).toMatchObject({ status: 'running', round: 1, totalRounds: 5, swissRounds: 3, standingsTotal: 16 });
    expect(started.chamber.virtuals).toBe(15);
    expect(started.chamber.leaders.reduce((s: number, l: { count: number }) => s + l.count, 0) + started.chamber.others.reduce((s: number, l: { count: number }) => s + l.count, 0)).toBe(15);
    // Os virtuais entraram na ordem sorteada junto com os humanos.
    const virtuals = listVirtuals(db, t.id);
    expect(virtuals).toHaveLength(15);
    expect(new Set([...virtuals.map((v) => v.seed), ...started.players.map((p: { seed: number }) => p.seed)]).size).toBe(16);
    // Os inscritos continuam só os humanos; a rodada lista só as mesas com humano e diz quantas foram sorteadas.
    expect(started.players).toHaveLength(1);
    const r1 = started.rounds[0];
    expect(r1).toMatchObject({ tables: 8, virtualTables: 7 });
    expect(r1.matches).toHaveLength(1);
    for (const m of r1.matches) {
      expect(m.result).toBeNull();
      expect([m.p1.virtual, m.p2.virtual].filter(Boolean)).toHaveLength(1);
      expect(m.p1.leaderName ?? m.p1.leader).toBeTruthy();
    }
    // As mesas só de virtuais já têm resultado (lançado pelo sorteio).
    const sim = db.prepare("SELECT COUNT(*) AS n FROM tournament_matches WHERE tournament_id = ? AND round = 1 AND reported_by = 'sim'").get(t.id) as { n: number };
    expect(sim.n).toBe(7);
    expect(started.roundComplete).toBe(false);
    // A classificação apresentada é um recorte (os 32 primeiros aqui são todos) com o Líder de cada um.
    expect(started.standings).toHaveLength(16);
    expect(started.standings.filter((s: { virtual: boolean }) => s.virtual)).toHaveLength(15);
    // Antes de iniciar a rodada, o virtual já conta como pronto.
    expect(started.tables).toBe(1);
    const mine = r1.matches[0];
    expect(mine.ready.filter(Boolean)).toHaveLength(1);

    // Quem abriu inicia a rodada; a mesa contra o virtual abre uma sala do Bot do Time com o deck do virtual.
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/matches/${mine.id}/play`, host)).statusCode).toBe(409);
    await req(app, 'POST', `/api/tournaments/${t.id}/rounds/begin`, host);
    const play = await req(app, 'POST', `/api/tournaments/${t.id}/matches/${mine.id}/play`, host);
    expect(play.statusCode, play.body).toBe(200);
    const { roomId, token } = play.json();
    const room = lobbyOf(app).get(roomId)!;
    expect(room.data.queue).toBe('bot');
    expect(room.data.botLevel).toBe('team');
    expect(room.status).toBe('playing');
    const oppId = mine.p1.userId === host.id ? mine.p2.userId : mine.p1.userId;
    const virtual = virtuals.find((v) => v.id === oppId)!;
    expect(room.data.seats[1]).toMatchObject({ bot: true, name: virtual.name, deckId: virtual.deckId });
    expect(room.data.tournament).toMatchObject({ id: t.id, matchId: mine.id, game: 1, virtualId: virtual.id });
    // Voltar à mesa devolve o mesmo assento.
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/matches/${mine.id}/play`, host)).json()).toEqual({ roomId, token });
    // O humano desiste: o virtual vence a série, como num jogo de torneio.
    await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/action`, payload: { t: token, seq: 0, action: { type: 'concede', player: room.seatOf(token) } } });
    let view = (await req(app, 'GET', `/api/tournaments/${t.id}`, host)).json();
    let m = view.rounds[0].matches.find((x: { id: number }) => x.id === mine.id);
    expect(m).toMatchObject({ result: mine.p1.userId === host.id ? 'p2' : 'p1', winner: virtual.id, reportedBy: 'game', room: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tournament_games WHERE tournament_id = ?').get(t.id)).toEqual({ n: 1 });
    expect((db.prepare('SELECT mode FROM matches').get() as { mode: string }).mode).toBe('bot');

    // Com a única mesa humana decidida, a rodada fecha e a seguinte sai com as mesas virtuais já decididas.
    expect(view.roundComplete).toBe(true);

    const next = (round: number) =>
      req(app, 'POST', `/api/tournaments/${t.id}/next`, host, { begin: true }).then(async (r) => {
        expect(r.statusCode, r.body).toBe(200);
        const v = r.json();
        expect(v.round).toBe(round);
        return v;
      });
    view = await next(2);
    expect(view.rounds[1].virtualTables).toBeGreaterThanOrEqual(5);
    const pendingHuman = (v: { rounds: Array<{ matches: Array<{ id: number; result: string | null; p2: unknown }> }>; round: number }) =>
      v.rounds[v.round - 1].matches.filter((x) => !x.result && x.p2);
    for (const x of pendingHuman(view)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, host, { result: 'p1' });
    view = await next(3);
    for (const x of pendingHuman(view)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, host, { result: 'p1' });
    // Top 4 (com virtuais entre os classificados): as mesas sem humano saem no sorteio até a final.
    view = await next(4);
    expect(view.rounds[3]).toMatchObject({ stage: 'elim', tables: 2 });
    for (const x of pendingHuman(view)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, host, { result: 'p1' });
    view = await next(5);
    expect(view.rounds[4]).toMatchObject({ stage: 'elim', tables: 1 });
    for (const x of pendingHuman(view)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, host, { result: 'p1' });
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, host, {})).json();
    expect(view.status).toBe('finished');
    expect(view.standings[0].rank).toBe(1);
    expect(view.standingsTotal).toBe(16);
    expect(getTournament(db, t.id)!.status).toBe('finished');
    // O kit de divulgação sai com o campeão (humano ou virtual, com o deck); o painel do meta ignora a sala.
    const recap = await req(app, 'GET', `/api/tournaments/${t.id}/recap`, host);
    expect(recap.statusCode, recap.body).toBe(200);
    expect(recap.json().champion.leader.id).toBeTruthy();
    expect(recap.json().tournament.players).toBe(16);
    const meta = (await req(app, 'GET', '/api/tournaments/meta')).json();
    expect(meta.totals.events).toBe(0);
    expect(meta.upcoming).toHaveLength(0);

  }, 60_000);
});
