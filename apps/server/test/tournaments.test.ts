import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { seed } from '../src/seed';
import {
  bracketOrder,
  singleFirstRound,
  singleNextRound,
  standings,
  swissPairings,
  swissRounds,
  type TMatch,
  type TPlayer,
} from '../src/tournaments/pairing';

const players = (n: number): TPlayer[] => Array.from({ length: n }, (_, i) => ({ userId: `p${i + 1}`, seed: i + 1, dropped: false }));

describe('torneios: pareamentos e classificação', () => {
  it('rodadas sugeridas e chave da eliminação simples', () => {
    expect([2, 4, 5, 8, 9, 32].map(swissRounds)).toEqual([1, 2, 3, 3, 4, 5]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    // 5 jogadores: chave de 8, os 3 primeiros cabeças de chave ficam de bye.
    expect(singleFirstRound(players(5))).toEqual([
      { p1: 'p1', p2: null },
      { p1: 'p4', p2: 'p5' },
      { p1: 'p2', p2: null },
      { p1: 'p3', p2: null },
    ]);
  });

  it('suíço: bye para o último colocado sem bye, sem repetir confrontos', () => {
    const ps = players(5);
    const r1 = swissPairings(ps, []);
    expect(r1.find((p) => p.p2 === null)).toEqual({ p1: 'p5', p2: null });
    const matches: TMatch[] = [];
    const play = (round: number, pairs: typeof r1) =>
      pairs.forEach((p, i) => matches.push({ round, table: i + 1, p1: p.p1, p2: p.p2, result: p.p2 ? 'p1' : 'bye' }));
    play(1, r1);
    for (let round = 2; round <= 4; round++) {
      const pairs = swissPairings(ps, matches);
      const bye = pairs.find((p) => p.p2 === null)!;
      // Ninguém recebe dois byes enquanto houver quem não teve.
      expect(matches.filter((m) => m.p2 === null).map((m) => m.p1)).not.toContain(bye.p1);
      for (const p of pairs.filter((x) => x.p2)) {
        expect(matches.some((m) => (m.p1 === p.p1 && m.p2 === p.p2) || (m.p1 === p.p2 && m.p2 === p.p1))).toBe(false);
      }
      play(round, pairs);
    }
  });

  it('suíço: quem desistiu não é pareado', () => {
    const ps = players(4);
    ps[1].dropped = true;
    const pairs = swissPairings(ps, []);
    expect(pairs.flatMap((p) => [p.p1, p.p2])).not.toContain('p2');
    expect(pairs.filter((p) => p.p2 === null)).toHaveLength(1);
  });

  it('classificação: pontos, depois % de vitórias dos oponentes', () => {
    const ps = players(4);
    const m = (round: number, p1: string, p2: string, result: TMatch['result']): TMatch => ({ round, table: 1, p1, p2, result });
    const matches = [m(1, 'p1', 'p2', 'p1'), m(1, 'p3', 'p4', 'p1'), m(2, 'p1', 'p3', 'draw'), m(2, 'p2', 'p4', 'p1')];
    const s = standings(ps, matches, 'swiss');
    expect(s.map((r) => [r.userId, r.points])).toEqual([
      ['p1', 4],
      ['p3', 4],
      ['p2', 3],
      ['p4', 0],
    ]);
    // p1 enfrentou p2 (3 pts em 2) e p3 (4 em 2); p3 enfrentou p4 (33% mínimo) e p1.
    expect(s[0].omw).toBeGreaterThan(s[1].omw);
    expect(s[0]).toMatchObject({ wins: 1, draws: 1, losses: 0, rank: 1 });
  });

  it('eliminação simples: vencedores avançam; quem desistiu dá bye', () => {
    const ps = players(4);
    const r1: TMatch[] = singleFirstRound(ps).map((p, i) => ({ round: 1, table: i + 1, ...p, result: 'p1' }));
    expect(r1.map((m) => [m.p1, m.p2])).toEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
    ]);
    expect(singleNextRound(ps, r1)).toEqual([{ p1: 'p1', p2: 'p2' }]);
    ps[1].dropped = true;
    expect(singleNextRound(ps, r1)).toEqual([{ p1: 'p1', p2: null }]);
    const s = standings(ps, r1, 'single');
    expect(s[0]).toMatchObject({ userId: 'p1', alive: true });
    expect(s.find((r) => r.userId === 'p4')!.alive).toBe(false);
  });
});

// ------------------------------------------------------------------ rotas

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
  const u = upsertGoogleUser(db, { sub: `sub-${++n}`, email: `u${n}@example.com`, emailVerified: true, name: `U${n}`, picture: null });
  setUserRole(db, u.id, role);
  // O código do navegador identifica o dono dos decks antes do login; cada conta usa um.
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-${n}-0123456789abcdef` } };
}

const req = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who?: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });

describe('torneios: rotas', () => {
  it('só organizadores e admins criam; o organizador gerencia o próprio torneio', async () => {
    const { db, app } = setup();
    const player = login(db);
    const org = login(db, 'organizer');
    const other = login(db, 'organizer');
    const admin = login(db, 'admin');
    const body = { name: 'Copa Grand Line', format: 'egb', structure: 'swiss' };
    expect((await req(app, 'POST', '/api/tournaments', undefined, body)).statusCode).toBe(401);
    expect((await req(app, 'POST', '/api/tournaments', player, body)).statusCode).toBe(403);
    expect((await req(app, 'POST', '/api/tournaments', org, { ...body, name: 'x' })).statusCode).toBe(400);
    expect((await req(app, 'POST', '/api/tournaments', org, { ...body, maxPlayers: 1 })).statusCode).toBe(400);
    const created = await req(app, 'POST', '/api/tournaments', org, { ...body, description: 'Bo1, 2 rodadas', rounds: 2 });
    expect(created.statusCode).toBe(201);
    const t = created.json();
    expect(t).toMatchObject({ name: 'Copa Grand Line', status: 'registration', canManage: true, totalRounds: 2, roundsAuto: false });
    expect(t.organizerName).toMatch(/^Pirata /);

    const list = (await req(app, 'GET', '/api/tournaments', player)).json();
    expect(list.canCreate).toBe(false);
    expect(list.tournaments).toHaveLength(1);
    expect((await req(app, 'GET', '/api/tournaments', org)).json().canCreate).toBe(true);

    // Outro organizador não mexe; o admin mexe em qualquer um.
    const edit = { ...body, name: 'Copa East Blue', structure: 'single' };
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}`, other, edit)).statusCode).toBe(403);
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}`, admin, edit)).json()).toMatchObject({ name: 'Copa East Blue', structure: 'single' });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, player)).json().canManage).toBe(false);
    expect((await req(app, 'DELETE', `/api/tournaments/${t.id}`, player)).statusCode).toBe(403);
    expect((await req(app, 'DELETE', `/api/tournaments/${t.id}`, org)).statusCode).toBe(204);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`)).statusCode).toBe(404);
  });

  it('inscrição: conta Google, deck válido no formato e limite de vagas', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const [a, b, c] = [login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss', maxPlayers: 2 })).json();
    const url = `/api/tournaments/${t.id}/register`;
    expect((await req(app, 'POST', url, undefined, { deckId: 'st01-luffy' })).statusCode).toBe(401);
    // Carta banida: nem no Extra Grand Battle.
    const banned = await req(app, 'POST', url, a, { deckId: 'st10-law' });
    expect(banned.statusCode).toBe(400);
    expect(banned.json().error).toMatch(/banida/);
    const ok = await req(app, 'POST', url, a, { deckId: 'st01-luffy' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().me).toMatchObject({ deckId: 'st01-luffy', leader: 'ST01-001', dropped: false });
    // Trocar de deck não ocupa outra vaga.
    expect((await req(app, 'POST', url, a, { deckId: 'st02-kid' })).json().me.deckId).toBe('st02-kid');
    expect((await req(app, 'POST', url, b, { deckId: 'st03-crocodile' })).statusCode).toBe(200);
    expect((await req(app, 'POST', url, c, { deckId: 'st04-kaido' })).statusCode).toBe(409);

    // A lista de cada um fica escondida dos outros jogadores até o fim (o Líder aparece).
    const seen = (await req(app, 'GET', `/api/tournaments/${t.id}`, b)).json();
    const ofA = seen.players.find((p: { userId: string }) => p.userId === a.id);
    expect(ofA.deck).toBeNull();
    expect(ofA.leader).toBe('ST02-001');
    expect(seen.players.find((p: { userId: string }) => p.userId === b.id).deck.cards.length).toBeGreaterThan(0);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().players.every((p: { deck: unknown }) => p.deck)).toBe(true);

    // Mudar o formato para um em que os decks não valem é recusado.
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}`, org, { name: 'Copa', format: 'standard', structure: 'swiss' })).statusCode).toBe(400);
    // Sair libera a vaga.
    expect((await req(app, 'DELETE', url, a)).json().players).toHaveLength(1);
    expect((await req(app, 'POST', url, c, { deckId: 'st04-kaido' })).statusCode).toBe(200);
  });

  it('suíço completo: partidas nas salas online, resultado automático, correção e desistência', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Liga', format: 'egb', structure: 'swiss' })).json();
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, org)).statusCode).toBe(400);
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i % DECKS.length] });
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, ps[0])).statusCode).toBe(403);
    const started = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org)).json();
    expect(started).toMatchObject({ status: 'running', round: 1, totalRounds: 3 });
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/register`, ps[0], { deckId: DECKS[0] })).statusCode).toBe(409);
    const r1 = started.rounds[0].matches;
    expect(r1).toHaveLength(3);
    const bye = r1.find((m: { p2: unknown }) => m.p2 === null);
    expect(bye).toMatchObject({ result: 'bye', reportedBy: 'bye' });
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).statusCode).toBe(409);

    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    const [m1, m2] = r1.filter((m: { p2: unknown }) => m.p2);

    // Mesa 1 jogada no site: o primeiro abre a sala, o segundo começa a partida.
    const play = (p: ReturnType<typeof login>, m: { id: number }) => req(app, 'POST', `/api/tournaments/${t.id}/matches/${m.id}/play`, p);
    expect((await play(who(m2.p1.userId), m1)).statusCode).toBe(403);
    const first = (await play(who(m1.p1.userId), m1)).json();
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    expect(lobby.get(first.roomId)!.status).toBe('waiting');
    // Entrar de novo devolve o mesmo assento.
    expect((await play(who(m1.p1.userId), m1)).json()).toEqual(first);
    const second = (await play(who(m1.p2.userId), m1)).json();
    expect(second.roomId).toBe(first.roomId);
    const room = lobby.get(first.roomId)!;
    expect(room.status).toBe('playing');
    expect(room.data.queue).toBe('tournament');
    // A partida aparece em "Assistir" com o nome do torneio.
    const live = (await req(app, 'GET', '/api/online/live')).json().rooms;
    expect(live[0].tournament).toEqual({ id: t.id, name: 'Liga', round: 1 });
    // O jogador do segundo assento desiste: o primeiro vence.
    const loserSeat = room.seatOf(second.token)!;
    await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: second.token, seq: 0, action: { type: 'concede', player: loserSeat } } });
    let view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    let m = view.rounds[0].matches.find((x: { id: number }) => x.id === m1.id);
    expect(m).toMatchObject({ result: 'p1', winner: m1.p1.userId, reportedBy: 'game', room: 'finished' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM match_seats WHERE queue = 'tournament'").get()).toEqual({ n: 2 });
    expect((await play(who(m1.p1.userId), m1)).statusCode).toBe(409);

    // Mesa 2: o organizador lança (só ele), corrige e o jogador de mesa não consegue.
    const result = (by: ReturnType<typeof login>, mm: { id: number }, value: unknown) =>
      req(app, 'PUT', `/api/tournaments/${t.id}/matches/${mm.id}/result`, by, { result: value });
    expect((await result(who(m2.p1.userId), m2, 'p1')).statusCode).toBe(403);
    expect((await result(org, m2, 'x')).statusCode).toBe(400);
    expect((await result(org, bye, 'p1')).statusCode).toBe(400);
    await result(org, m2, 'p2');
    view = (await result(org, m2, 'draw')).json();
    expect(view.rounds[0].matches.find((x: { id: number }) => x.id === m2.id)).toMatchObject({ result: 'draw', reportedBy: 'organizer' });
    expect(view.roundComplete).toBe(true);

    // Rodada 2: sem repetir confrontos.
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    expect(view.round).toBe(2);
    const pairsBefore = new Set(view.rounds[0].matches.filter((x: any) => x.p2).map((x: any) => [x.p1.userId, x.p2.userId].sort().join()));
    for (const x of view.rounds[1].matches.filter((x: any) => x.p2)) expect(pairsBefore.has([x.p1.userId, x.p2.userId].sort().join())).toBe(false);
    // Resultados de rodadas passadas não mudam mais.
    expect((await result(org, m2, 'p1')).statusCode).toBe(409);

    // Um jogador desiste no meio da rodada: o oponente vence a partida pendente.
    const pending = view.rounds[1].matches.find((x: any) => x.p2);
    view = (await req(app, 'DELETE', `/api/tournaments/${t.id}/register`, who(pending.p1.userId))).json();
    expect(view.rounds[1].matches.find((x: any) => x.id === pending.id)).toMatchObject({ result: 'p2', reportedBy: 'drop' });
    expect(view.players.find((p: any) => p.userId === pending.p1.userId).dropped).toBe(true);
    for (const x of view.rounds[1].matches.filter((x: any) => !x.result)) await result(org, x, 'p1');

    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    expect(view.round).toBe(3);
    // Quem desistiu não é mais pareado.
    expect(view.rounds[2].matches.flatMap((x: any) => [x.p1.userId, x.p2?.userId])).not.toContain(pending.p1.userId);
    for (const x of view.rounds[2].matches.filter((x: any) => !x.result)) await result(org, x, 'p1');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    expect(view.status).toBe('finished');
    expect(view.standings).toHaveLength(5);
    expect(view.standings[0].rank).toBe(1);
    // No fim, as listas ficam públicas.
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`)).json().players.every((p: { deck: unknown }) => p.deck)).toBe(true);
  });

  it('eliminação simples: sem empate, termina na final', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const ps = [login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', admin, { name: 'Mata-mata', format: 'egb', structure: 'single' })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, admin)).json();
    expect(view.totalRounds).toBe(2);
    const match = view.rounds[0].matches.find((m: any) => m.p2);
    const set = (m: { id: number }, result: unknown) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, admin, { result });
    expect((await set(match, 'draw')).statusCode).toBe(400);
    await set(match, 'p2');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin)).json();
    expect(view.rounds[1].matches).toHaveLength(1);
    const final = view.rounds[1].matches[0];
    expect([final.p1.userId, final.p2.userId]).toContain(match.p2.userId);
    await set(final, 'p1');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin)).json();
    expect(view.status).toBe('finished');
    expect(view.standings[0]).toMatchObject({ userId: final.p1.userId, rank: 1, alive: true });
    expect(view.standings[1].userId).toBe(final.p2.userId);
  });
});
