import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { seed } from '../src/seed';
import { AUTO_START_GRACE_MS, CHECK_IN_MS, DEFAULT_TOLERANCE_MIN, type TickResult } from '../src/tournaments/clock';
import {
  bracketOrder,
  elimBestOf,
  elimLabel,
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
      pairs.forEach((p, i) => matches.push({ round, stage: 'swiss', table: i + 1, p1: p.p1, p2: p.p2, result: p.p2 ? 'p1' : 'bye' }));
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

  it('classificação: pontos, depois % de vitórias dos oponentes; o top cut fica acima', () => {
    const ps = players(4);
    const m = (round: number, p1: string, p2: string, result: TMatch['result'], stage: TMatch['stage'] = 'swiss'): TMatch => ({
      round,
      stage,
      table: 1,
      p1,
      p2,
      result,
    });
    const matches = [m(1, 'p1', 'p2', 'p1'), m(1, 'p3', 'p4', 'p1'), m(2, 'p1', 'p4', 'p2'), m(2, 'p2', 'p3', 'p1')];
    const s = standings(ps, matches);
    // Todos ficaram 1-1 (3 pontos): o desempate decide e é estável.
    expect(new Set(s.map((r) => r.rank))).toEqual(new Set([1, 2, 3, 4]));
    // Top cut: quem venceu a final é 1º, quem perdeu é 2º, mesmo com menos pontos no suíço.
    const last = s[3].userId;
    const other = s[2].userId;
    const withCut = standings(ps, [...matches, m(3, last, other, 'p1', 'elim')]);
    expect(withCut.slice(0, 2).map((r) => [r.userId, r.alive])).toEqual([
      [last, true],
      [other, false],
    ]);
    expect(withCut[0]).toMatchObject({ inElim: true, elimWins: 1, rank: 1 });
  });

  it('empate em pontos, OMW e OOMW: decide a ordem sorteada no início', () => {
    const ps: TPlayer[] = [
      { userId: 'a', seed: 3, dropped: false },
      { userId: 'b', seed: 1, dropped: false },
      { userId: 'c', seed: 2, dropped: false },
    ];
    expect(standings(ps, []).map((r) => r.userId)).toEqual(['b', 'c', 'a']);
    // Piso de 33%: quem perdeu tudo conta como 33% no OMW de quem o enfrentou.
    const m: TMatch = { round: 1, stage: 'swiss', table: 1, p1: 'a', p2: 'b', result: 'p1' };
    expect(standings(ps, [m]).find((r) => r.userId === 'a')!.omw).toBeCloseTo(1 / 3);
  });

  it('melhor de N por fase da eliminatória', () => {
    const cfg = { bo3From: 8, bo5From: 2 };
    expect([16, 8, 4, 2].map((n) => elimBestOf(n, cfg))).toEqual([1, 3, 3, 5]);
    expect(elimBestOf(2, { bo3From: null, bo5From: null })).toBe(1);
    expect([2, 4, 8, 16, 32].map(elimLabel)).toEqual(['Final', 'Semifinal', 'Quartas de final', 'Oitavas de final', 'Rodada de 32']);
  });

  it('eliminação simples: vencedores avançam; quem desistiu dá bye', () => {
    const ps = players(4);
    const r1: TMatch[] = singleFirstRound(ps).map((p, i) => ({ round: 1, stage: 'elim', table: i + 1, ...p, result: 'p1' }));
    expect(r1.map((m) => [m.p1, m.p2])).toEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
    ]);
    expect(singleNextRound(ps, r1)).toEqual([{ p1: 'p1', p2: 'p2' }]);
    ps[1].dropped = true;
    expect(singleNextRound(ps, r1)).toEqual([{ p1: 'p1', p2: null }]);
    const s = standings(ps, r1);
    expect(s[0]).toMatchObject({ userId: 'p1', alive: true });
    expect(s.find((r) => r.userId === 'p4')!.alive).toBe(false);
  });
});

// ------------------------------------------------------------------ rotas

const DECKS = ['st01-luffy', 'st02-kid', 'st03-crocodile', 'st04-kaido'];

function setup(now?: () => number) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now });
  return { db, app };
}
type App = ReturnType<typeof buildApp>;
/** Relógio dos torneios (início automático e W.O.), exposto pelo app. */
const TOLERANCE_MS_T = DEFAULT_TOLERANCE_MIN * 60_000;
const tick = (app: App) => (app as unknown as { tournamentTick: () => TickResult | null }).tournamentTick();

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

    // Nas inscrições, os outros jogadores não veem nem o Líder nem a lista de cada um
    // (para ninguém escolher o deck olhando os dos outros); cada um vê o seu, e o
    // organizador vê tudo.
    const seen = (await req(app, 'GET', `/api/tournaments/${t.id}`, b)).json();
    const ofA = seen.players.find((p: { userId: string }) => p.userId === a.id);
    expect(ofA).toMatchObject({ deck: null, leader: null, leaderName: null, leaderImage: null, colors: [] });
    const ofB = seen.players.find((p: { userId: string }) => p.userId === b.id);
    expect(ofB.leader).toBe('ST03-001');
    expect(ofB.deck.cards.length).toBeGreaterThan(0);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`)).json().players.every((p: { leader: unknown }) => p.leader === null)).toBe(true);
    const byOrg = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    expect(byOrg.players.every((p: { deck: unknown; leader: unknown }) => p.deck && p.leader)).toBe(true);

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
    // Com o torneio em andamento ninguém troca de deck (nem de lista)...
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/register`, ps[0], { deckId: DECKS[0] })).statusCode).toBe(409);
    // ...e é aí que o Líder de cada um aparece para todos (a lista continua escondida até o fim).
    const running = (await req(app, 'GET', `/api/tournaments/${t.id}`, ps[1])).json();
    expect(running.players.every((p: { leader: unknown }) => typeof p.leader === 'string')).toBe(true);
    expect(running.players.filter((p: { deck: unknown }) => p.deck)).toHaveLength(1);
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
    expect(live[0].tournament).toEqual({ id: t.id, name: 'Liga', round: 1, label: 'Rodada 1', game: 1, bestOf: 1 });
    // O jogador do segundo assento desiste: o primeiro vence.
    const loserSeat = room.seatOf(second.token)!;
    await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: second.token, seq: 0, action: { type: 'concede', player: loserSeat } } });
    let view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    let m = view.rounds[0].matches.find((x: { id: number }) => x.id === m1.id);
    // O jogo contado libera a sala da partida.
    expect(m).toMatchObject({ result: 'p1', wins: [1, 0], winner: m1.p1.userId, reportedBy: 'game', room: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM match_seats WHERE queue = 'tournament'").get()).toEqual({ n: 2 });
    expect((await play(who(m1.p1.userId), m1)).statusCode).toBe(409);

    // Mesa 2: o organizador lança (só ele), corrige e o jogador de mesa não consegue.
    const result = (by: ReturnType<typeof login>, mm: { id: number }, value: unknown) =>
      req(app, 'PUT', `/api/tournaments/${t.id}/matches/${mm.id}/result`, by, { result: value });
    expect((await result(who(m2.p1.userId), m2, 'p1')).statusCode).toBe(403);
    expect((await result(org, m2, 'x')).statusCode).toBe(400);
    expect((await result(org, bye, 'p1')).statusCode).toBe(400);
    // Não há empate no One Piece TCG.
    expect((await result(org, m2, 'draw')).statusCode).toBe(400);
    await result(org, m2, 'p1');
    view = (await result(org, m2, 'p2')).json();
    expect(view.rounds[0].matches.find((x: { id: number }) => x.id === m2.id)).toMatchObject({ result: 'p2', reportedBy: 'organizer' });
    expect(view.roundComplete).toBe(true);

    // Rodada 2: sem repetir confrontos.
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    expect(view.round).toBe(2);
    const pairsBefore = new Set(view.rounds[0].matches.filter((x: any) => x.p2).map((x: any) => [x.p1.userId, x.p2.userId].sort().join()));
    for (const x of view.rounds[1].matches.filter((x: any) => x.p2)) expect(pairsBefore.has([x.p1.userId, x.p2.userId].sort().join())).toBe(false);
    // Resultado de rodada passada lançado errado: o organizador corrige (a classificação acompanha).
    const before = view.standings.find((x: any) => x.userId === m2.p1.userId).points;
    view = (await result(org, m2, 'p1')).json();
    expect(view.rounds[0].matches.find((x: { id: number }) => x.id === m2.id)).toMatchObject({ result: 'p1' });
    expect(view.standings.find((x: any) => x.userId === m2.p1.userId).points).toBe(before + 3);
    // Mas rodada passada não fica sem vencedor.
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m2.id}/result`, org, { result: null })).statusCode).toBe(409);

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
    let final = view.rounds[1].matches[0];
    expect(view.rounds[1].label).toBe('Final');
    expect([final.p1.userId, final.p2.userId]).toContain(match.p2.userId);
    // Resultado da semifinal lançado errado: corrigir troca quem está na final (que ainda não começou).
    view = (await set(match, 'p1')).json();
    final = view.rounds[1].matches[0];
    expect([final.p1.userId, final.p2.userId]).toContain(match.p1.userId);
    expect([final.p1.userId, final.p2.userId]).not.toContain(match.p2.userId);
    await set(final, 'p1');
    // Com a final decidida, a semifinal não muda mais.
    const blocked = await set(match, 'p2');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/partida seguinte/);
    expect(blocked.json()).toMatchObject({ errorCode: 'fixNextMatchFirst', errorParams: { table: expect.any(Number) } });
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin)).json();
    expect(view.status).toBe('finished');
    expect(view.standings[0]).toMatchObject({ userId: final.p1.userId, rank: 1, alive: true });
    expect(view.standings[1].userId).toBe(final.p2.userId);
  });

  it('suíço com top cut: melhor de 3 na semifinal, melhor de 5 na final, jogos nas salas online', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = Array.from({ length: 6 }, () => login(db));
    const body = { name: 'Regional', format: 'egb', structure: 'swiss', rounds: 2, topCut: 4, bo3From: 4, bo5From: 2 };
    expect((await req(app, 'POST', '/api/tournaments', org, { ...body, topCut: 5 })).statusCode).toBe(400);
    const t = (await req(app, 'POST', '/api/tournaments', org, body)).json();
    expect(t).toMatchObject({ topCut: 4, bo3From: 4, bo5From: 2, swissBestOf: 1 });
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i % DECKS.length] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org)).json();
    expect(view.totalRounds).toBe(4); // 2 do suíço + semifinal + final
    const result = (m: { id: number }, payload: object) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, org, payload);
    for (let r = 0; r < 2; r++) {
      expect(view.rounds[r].bestOf).toBe(1);
      for (const m of view.rounds[r].matches.filter((x: any) => x.p2)) await result(m, { result: 'p1' });
      view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    }
    // Top 4, semeado pela classificação do suíço: 1º x 4º e 2º x 3º.
    const semis = view.rounds[2];
    expect(semis).toMatchObject({ stage: 'elim', label: 'Semifinal', bestOf: 3 });
    expect(view.stage).toBe('elim');
    const swissTop = view.standings.slice(0, 4).map((s: any) => s.userId);
    expect(semis.matches.map((m: any) => [m.p1.userId, m.p2.userId])).toEqual([
      [swissTop[0], swissTop[3]],
      [swissTop[1], swissTop[2]],
    ]);
    // Corrigir o suíço depois do top cut é recusado.
    const swissMatch = view.rounds[0].matches.find((x: any) => x.p2);
    expect((await result(swissMatch, { result: 'p2' })).statusCode).toBe(409);

    // Semifinal 1 jogada no site: cada jogo é uma sala; quem perde começa o seguinte.
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    const s1 = semis.matches[0];
    const playGame = async (loser: string) => {
      const a = (await req(app, 'POST', `/api/tournaments/${t.id}/matches/${s1.id}/play`, who(s1.p1.userId))).json();
      const b = (await req(app, 'POST', `/api/tournaments/${t.id}/matches/${s1.id}/play`, who(s1.p2.userId))).json();
      expect(b.roomId).toBe(a.roomId);
      const room = lobby.get(a.roomId)!;
      const token = loser === s1.p1.userId ? a.token : b.token;
      await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: token, seq: 0, action: { type: 'concede', player: room.seatOf(token)! } } });
      return room;
    };
    const g1 = await playGame(s1.p2.userId);
    expect(g1.data.tournament).toMatchObject({ game: 1, bestOf: 3, label: 'Semifinal' });
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    expect(view.rounds[2].matches[0]).toMatchObject({ wins: [1, 0], result: null, game: 2 });
    const g2 = await playGame(s1.p1.userId);
    expect(g2.id).not.toBe(g1.id);
    expect(g2.data.tournament).toMatchObject({ game: 2 });
    // Quem perdeu o jogo 1 (p2) começa o jogo 2.
    expect(g2.data.seats[g2.state!.firstPlayer].userId).toBe(s1.p2.userId);
    expect(g2.info(0).tournament!.score.reduce((x: number, y: number) => x + y, 0)).toBe(1);
    await playGame(s1.p2.userId);
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    expect(view.rounds[2].matches[0]).toMatchObject({ wins: [2, 1], result: 'p1', winner: s1.p1.userId, reportedBy: 'game' });

    // Semifinal 2 lançada pelo organizador: placar parcial, impossível e final.
    const s2 = semis.matches[1];
    expect((await result(s2, { wins: [3, 0] })).statusCode).toBe(400);
    expect((await result(s2, { wins: [1, 1] })).json().roundComplete).toBe(false);
    view = (await result(s2, { wins: [0, 2] })).json();
    expect(view.roundComplete).toBe(true);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    const final = view.rounds[3];
    expect(final).toMatchObject({ label: 'Final', bestOf: 5 });
    expect(final.matches[0].p1.userId).toBe(s1.p1.userId);
    expect(final.matches[0].p2.userId).toBe(s2.p2.userId);
    view = (await result(final.matches[0], { wins: [3, 2] })).json();
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org)).json();
    expect(view.status).toBe('finished');
    expect(view.standings.slice(0, 2).map((s: any) => s.userId)).toEqual([s1.p1.userId, s2.p2.userId]);
    expect(view.standings.slice(0, 4).every((s: any) => s.inElim)).toBe(true);
  });

  it('check-in: abre 30 min antes, o torneio começa sozinho na hora e quem não aparece em 5 min perde por W.O.', async () => {
    let now = Date.parse('2026-10-10T19:00:00Z');
    const { db, app } = setup(() => now);
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db)];
    const startsAt = '2026-10-10T20:00:00.000Z';
    // Check-in exige data de início.
    expect((await req(app, 'POST', '/api/tournaments', org, { name: 'Noturno', format: 'egb', structure: 'swiss', checkIn: true })).statusCode).toBe(400);
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Noturno', format: 'egb', structure: 'swiss', rounds: 2, startsAt, checkIn: true })).json();
    expect(t).toMatchObject({ checkIn: true, checkInOpensAt: '2026-10-10T19:30:00.000Z', checkInOpen: false, checkedIn: 0, deadline: null });
    expect(t.checkInMs).toBe(CHECK_IN_MS);
    expect(t.toleranceMs).toBe(TOLERANCE_MS_T);
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });

    // Antes da janela: nem o check-in nem o atalho da tela inicial.
    const checkin = (p: ReturnType<typeof login>) => req(app, 'POST', `/api/tournaments/${t.id}/checkin`, p);
    expect((await checkin(ps[0])).statusCode).toBe(409);
    expect((await req(app, 'GET', '/api/tournaments/me', ps[0])).json().entries).toEqual([]);
    expect(tick(app)).toEqual({ started: [], noShows: [] });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`)).json().status).toBe('registration');

    // 19:30: check-in aberto para os inscritos (e só para eles).
    now = Date.parse('2026-10-10T19:30:00Z');
    expect((await req(app, 'GET', '/api/tournaments', ps[0])).json().tournaments[0]).toMatchObject({ checkIn: true, checkInOpensAt: '2026-10-10T19:30:00.000Z' });
    let mine = (await req(app, 'GET', '/api/tournaments/me', ps[0])).json().entries;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: t.id, status: 'registration', checkedIn: false, match: null });
    expect((await checkin(login(db))).statusCode).toBe(404);
    expect((await checkin(undefined as never)).statusCode).toBe(401);
    let view = (await checkin(ps[0])).json();
    expect(view).toMatchObject({ checkInOpen: true, checkedIn: 1 });
    expect(view.me.checkedInAt).toBe('2026-10-10T19:30:00.000Z');
    expect(view.players.find((p: any) => p.userId === ps[0].id).checkedIn).toBe(true);
    await checkin(ps[1]);
    expect((await req(app, 'GET', '/api/tournaments/me', ps[0])).json().entries[0].checkedIn).toBe(true);
    // Ainda não é a hora.
    expect(tick(app)!.started).toEqual([]);

    // 20:00: começa sozinho com todos os inscritos (quem não fez check-in também é pareado).
    now = Date.parse('2026-10-10T20:00:00Z');
    expect(tick(app)!.started).toEqual([t.id]);
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    expect(view).toMatchObject({ status: 'running', round: 1, roundAt: '2026-10-10T20:00:00.000Z', deadline: '2026-10-10T20:05:00.000Z' });
    expect(view.rounds[0].matches).toHaveLength(2);
    expect((await checkin(ps[2])).statusCode).toBe(409);
    // A rodada 1 conta o check-in como presença.
    const of = (userId: string) => view.rounds[0].matches.find((m: any) => m.p1.userId === userId || m.p2.userId === userId);
    const side = (m: any, userId: string) => (m.p1.userId === userId ? 0 : 1);
    expect(of(ps[0].id).present[side(of(ps[0].id), ps[0].id)]).toBe(true);
    expect(of(ps[2].id).present[side(of(ps[2].id), ps[2].id)]).toBe(false);
    // Atalho da tela inicial: a partida da rodada, com o prazo.
    mine = (await req(app, 'GET', '/api/tournaments/me', ps[2])).json().entries;
    expect(mine[0]).toMatchObject({ status: 'running', round: 1, label: 'Rodada 1', deadline: '2026-10-10T20:05:00.000Z' });
    expect(mine[0].match).toMatchObject({ id: of(ps[2].id).id, result: null, room: null });
    expect(typeof mine[0].match.opponent).toBe('string');

    // Quem entra na sala fica presente, mesmo sem check-in antes.
    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    const mA = of(ps[2].id); // mesa de ps[2], que não fez check-in e não vai entrar na sala
    const oppA = mA.p1.userId === ps[2].id ? mA.p2.userId : mA.p1.userId;
    const play = (p: ReturnType<typeof login>, m: { id: number }) => req(app, 'POST', `/api/tournaments/${t.id}/matches/${m.id}/play`, p);
    now = Date.parse('2026-10-10T20:03:00Z');
    const seat = (await play(who(oppA), mA)).json();
    expect(seat.roomId).toBeTruthy();
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    expect(lobby.get(seat.roomId)!.status).toBe('waiting');
    // Dentro da tolerância, nada acontece.
    expect(tick(app)!.noShows).toEqual([]);

    // 20:05: ps[2] não apareceu: o oponente vence por W.O., ps[2] sai do torneio e a sala em espera fecha.
    now = Date.parse('2026-10-10T20:05:00Z');
    const r = tick(app)!;
    expect(r.noShows.map((w) => w.matchId)).toContain(mA.id);
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    const decided = view.rounds[0].matches.find((m: any) => m.id === mA.id);
    expect(decided).toMatchObject({ result: mA.p1.userId === oppA ? 'p1' : 'p2', winner: oppA, reportedBy: 'noshow', room: null });
    expect(view.players.find((p: any) => p.userId === ps[2].id).dropped).toBe(true);
    expect(lobby.get(seat.roomId)).toBeNull();
    expect(view.deadline).toBeNull();
    // A outra mesa: quem fez check-in está presente; quem não fez (e não entrou na sala) perdeu por W.O.
    const mB = view.rounds[0].matches.find((m: any) => m.id !== mA.id);
    const absent = [mB.p1.userId, mB.p2.userId].filter((id: string) => ![ps[0].id, ps[1].id].includes(id));
    if (absent.length) expect(mB).toMatchObject({ reportedBy: 'noshow', result: absent.length === 2 ? 'none' : mB.p1.userId === absent[0] ? 'p2' : 'p1' });
    else expect(mB.result).toBeNull();
    // A varredura não se repete: zerar o placar depois não dá W.O. de novo.
    await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${mA.id}/result`, org, { wins: [0, 0] });
    expect(tick(app)!.noShows).toEqual([]);
    // Um torneio que ficou parado muito depois da hora não começa mais sozinho.
    const stale = (await req(app, 'POST', '/api/tournaments', org, { name: 'Velho', format: 'egb', structure: 'swiss', startsAt, checkIn: true })).json();
    for (const [i, p] of ps.slice(0, 2).entries()) await req(app, 'POST', `/api/tournaments/${stale.id}/register`, p, { deckId: DECKS[i] });
    now = Date.parse(startsAt) + AUTO_START_GRACE_MS + 1;
    expect(tick(app)!.started).toEqual([]);
  });

  it('W.O. duplo: os dois perdem; na chave, a mesa seguinte fica com bye', async () => {
    let now = Date.parse('2026-10-10T20:00:00Z');
    const { db, app } = setup(() => now);
    const admin = login(db, 'admin');
    const ps = [login(db), login(db), login(db), login(db)];
    const startsAt = '2026-10-10T20:00:00.000Z';
    const t = (await req(app, 'POST', '/api/tournaments', admin, { name: 'Mata-mata', format: 'egb', structure: 'single', startsAt, checkIn: true })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    expect(tick(app)!.started).toEqual([t.id]);
    let view = (await req(app, 'GET', `/api/tournaments/${t.id}`, admin)).json();
    const [s1, s2] = view.rounds[0].matches;
    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    // Semifinal 2: só p1 entra na sala. Semifinal 1: ninguém.
    await req(app, 'POST', `/api/tournaments/${t.id}/matches/${s2.id}/play`, who(s2.p1.userId));
    now += TOLERANCE_MS_T;
    expect(tick(app)!.noShows).toHaveLength(2);
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, admin)).json();
    expect(view.rounds[0].matches[0]).toMatchObject({ result: 'none', winner: null, reportedBy: 'noshow' });
    expect(view.rounds[0].matches[1]).toMatchObject({ result: 'p1', winner: s2.p1.userId, reportedBy: 'noshow' });
    expect(view.roundComplete).toBe(true);
    // Os dois da semifinal 1 perderam e saíram; o vencedor da 2 vai para a final de bye e é o campeão.
    for (const id of [s1.p1.userId, s1.p2.userId]) {
      expect(view.players.find((p: any) => p.userId === id).dropped).toBe(true);
      expect(view.standings.find((s: any) => s.userId === id)).toMatchObject({ losses: 1, wins: 0, alive: false });
    }
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin)).json();
    expect(view.rounds[1].matches).toEqual([expect.objectContaining({ p1: expect.objectContaining({ userId: s2.p1.userId }), p2: null, result: 'bye' })]);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin)).json();
    expect(view.status).toBe('finished');
    expect(view.standings[0].userId).toBe(s2.p1.userId);
  });
});
