import { actingPlayer, type CardData, HIDDEN_CARD, legalActions, type PlayerId } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { proxiedImageUrl } from '../src/card-images';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, getCards, getDeck, openDb, upsertCards } from '../src/db';
import { listFinished, registerPlayer } from '../src/tournaments/store';
import type { Lobby } from '../src/online/lobby';
import type { Connection } from '../src/online/room';
import { seed } from '../src/seed';
import { renamePlayer } from '../src/stats/store';
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

  it('derrota sem oponente (inscrição atrasada): conta como jogada e perdida, não é bye nem mexe no OMW', () => {
    const ps = players(4);
    const late: TPlayer = { userId: 'late', seed: 5, dropped: false };
    const r1: TMatch[] = [
      { round: 1, stage: 'swiss', table: 1, p1: 'p1', p2: 'p2', result: 'p1' },
      { round: 1, stage: 'swiss', table: 2, p1: 'p3', p2: 'p4', result: 'p1' },
      { round: 1, stage: 'swiss', table: 3, p1: 'late', p2: null, result: 'loss' },
    ];
    const s = standings([...ps, late], r1);
    expect(s.find((r) => r.userId === 'late')).toMatchObject({ points: 0, wins: 0, losses: 1, byes: 0, omw: 0 });
    // O OMW de quem jogou não muda com a derrota do atrasado.
    expect(s.find((r) => r.userId === 'p1')!.omw).toBeCloseTo(1 / 3);
    // Com 5 jogadores, o bye da rodada 2 vai para o último colocado sem bye: o atrasado.
    expect(swissPairings([...ps, late], r1).find((p) => p.p2 === null)).toEqual({ p1: 'late', p2: null });
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

  it('spoilers: só nos torneios com spoilers (Standard ou EGB); nos outros, só cartas lançadas', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const a = login(db);
    // Deck com uma carta de spoiler (ainda não lançada).
    const luffy = getDeck(db, 'st01-luffy')!;
    const [base] = getCards(db, [luffy.cards[0].id]) as CardData[];
    upsertCards(db, [{ ...base, id: 'OP99-001', spoiler: { source: 'teste' } }], { provisional: true, source: 'spoiler:teste.json' });
    const cards = luffy.cards.map((c, i) => (i === 0 ? { id: 'OP99-001', count: c.count } : c));
    const deck = (await req(app, 'POST', '/api/decks', a, { name: 'Spoiler', leader: luffy.leader, cards })).json();

    // Standard + spoilers também é uma opção.
    const std = await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'standard', spoilers: true, structure: 'swiss' });
    expect(std.json()).toMatchObject({ format: 'standard', spoilers: true });

    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss' })).json();
    expect(t.spoilers).toBe(false);
    const url = `/api/tournaments/${t.id}/register`;
    const refused = await req(app, 'POST', url, a, { deckId: deck.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ errorCode: 'deckHasSpoilers', errorParams: { n: 1, ids: 'OP99-001' } });

    const edit = { name: 'Copa', format: 'egb', structure: 'swiss' };
    const open = (await req(app, 'PUT', `/api/tournaments/${t.id}`, org, { ...edit, spoilers: true })).json();
    expect(open).toMatchObject({ format: 'egb', spoilers: true });
    expect((await req(app, 'GET', '/api/tournaments', a)).json().tournaments[0].spoilers).toBe(true);
    expect((await req(app, 'POST', url, a, { deckId: deck.id })).statusCode).toBe(200);
    // Tirar os spoilers com um deck de spoiler inscrito é recusado.
    const back = await req(app, 'PUT', `/api/tournaments/${t.id}`, org, edit);
    expect(back.statusCode).toBe(400);
    expect(back.json()).toMatchObject({ errorCode: 'tourDecksNotAllowed', errorParams: { n: 1, format: 'Extra Grand Battle' } });
  });

  it('Livre (vale tudo): aceita carta banida e spoiler; fica fora do meta', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const a = login(db);
    // Deck com uma carta banida (OP06-047) no lugar da primeira.
    const luffy = getDeck(db, 'st01-luffy')!;
    const [base] = getCards(db, [luffy.cards[0].id]) as CardData[];
    upsertCards(db, [{ ...base, id: 'OP06-047' }], { provisional: false, source: 'teste' });
    const cards = luffy.cards.map((c, i) => (i === 0 ? { id: 'OP06-047', count: c.count } : c));
    const deck = (await req(app, 'POST', '/api/decks', a, { name: 'Banida', leader: luffy.leader, cards })).json();

    const egb = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss' })).json();
    const refused = await req(app, 'POST', `/api/tournaments/${egb.id}/register`, a, { deckId: deck.id });
    expect(refused.json()).toMatchObject({ errorCode: 'deckNotAllowedInFormat' });

    // O Livre sempre aceita spoilers, mesmo sem pedir.
    const free = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'free', structure: 'swiss' })).json();
    expect(free).toMatchObject({ format: 'free', spoilers: true });
    expect((await req(app, 'POST', `/api/tournaments/${free.id}/register`, a, { deckId: deck.id })).statusCode).toBe(200);
    // Voltar para o EGB com o deck da banida inscrito é recusado.
    const back = await req(app, 'PUT', `/api/tournaments/${free.id}`, org, { name: 'Copa', format: 'egb', structure: 'swiss' });
    expect(back.json()).toMatchObject({ errorCode: 'tourDecksNotAllowed', errorParams: { n: 1, format: 'Extra Grand Battle' } });

    expect((await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'vale-tudo', structure: 'swiss' })).json()).toMatchObject({
      errorCode: 'invalidFormat',
    });

    // O meta só olha Standard e EGB puros: o Livre e o EGB + spoilers ficam de fora.
    const spoilers = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', spoilers: true, structure: 'swiss' })).json();
    db.prepare("UPDATE tournaments SET status = 'finished', finished_at = datetime('now')").run();
    expect(listFinished(db).map((t) => t.id)).toEqual([egb.id]);
    expect(listFinished(db, { format: 'egb' }).map((t) => t.id)).not.toContain(spoilers.id);
  });

  it('suíço completo: partidas nas salas online, resultado automático, correção e desistência', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Liga', format: 'egb', structure: 'swiss' })).json();
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).statusCode).toBe(400);
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i % DECKS.length] });
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, ps[0], { begin: true })).statusCode).toBe(403);
    const started = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
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
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).statusCode).toBe(409);

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
    // Sem "mãos ao vivo" no torneio, quem vê as mãos assiste com o atraso mínimo.
    expect(live[0].handsLive).toBe(false);
    expect(room.handsLive).toBe(false);
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
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
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

    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.round).toBe(3);
    // Quem desistiu não é mais pareado.
    expect(view.rounds[2].matches.flatMap((x: any) => [x.p1.userId, x.p2?.userId])).not.toContain(pending.p1.userId);
    for (const x of view.rounds[2].matches.filter((x: any) => !x.result)) await result(org, x, 'p1');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
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
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, admin, { begin: true })).json();
    expect(view.totalRounds).toBe(2);
    const match = view.rounds[0].matches.find((m: any) => m.p2);
    const set = (m: { id: number }, result: unknown) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, admin, { result });
    expect((await set(match, 'draw')).statusCode).toBe(400);
    await set(match, 'p2');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
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
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
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
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    expect(view.totalRounds).toBe(4); // 2 do suíço + semifinal + final
    const result = (m: { id: number }, payload: object) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, org, payload);
    for (let r = 0; r < 2; r++) {
      expect(view.rounds[r].bestOf).toBe(1);
      for (const m of view.rounds[r].matches.filter((x: any) => x.p2)) await result(m, { result: 'p1' });
      view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
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
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    const final = view.rounds[3];
    expect(final).toMatchObject({ label: 'Final', bestOf: 5 });
    expect(final.matches[0].p1.userId).toBe(s1.p1.userId);
    expect(final.matches[0].p2.userId).toBe(s2.p2.userId);
    view = (await result(final.matches[0], { wins: [3, 2] })).json();
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.status).toBe('finished');
    expect(view.standings.slice(0, 2).map((s: any) => s.userId)).toEqual([s1.p1.userId, s2.p2.userId]);
    expect(view.standings.slice(0, 4).every((s: any) => s.inElim)).toBe(true);
  });

  it('banimento com data: o deck precisa valer no início do torneio; quem ficou com deck proibido é barrado', async () => {
    // Mihawk OP14-020 está banido a partir de 12/10/2026 (horário de Brasília).
    let now = Date.parse('2026-10-10T12:00:00Z');
    const { db, app } = setup(() => now);
    const org = login(db, 'organizer');
    const [a, b, c] = [login(db), login(db), login(db)];
    // Um Líder com o número do Mihawk (os dados não importam, só o número) e as cartas do ST-01.
    const [leader] = getCards(db, ['ST01-001']) as CardData[];
    upsertCards(db, [{ ...leader, id: 'OP14-020' }], { provisional: true, source: 'test' });
    const luffy = getDeck(db, 'st01-luffy')!;
    const mihawk = (await req(app, 'POST', '/api/decks', a, { name: 'Mihawk', leader: 'OP14-020', cards: luffy.cards })).json();

    // Torneio depois do banimento: a inscrição já é recusada, mesmo valendo hoje.
    const later = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss', startsAt: '2026-10-13T22:00:00Z' })).json();
    const refused = await req(app, 'POST', `/api/tournaments/${later.id}/register`, a, { deckId: mihawk.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ errorCode: 'tourDeckNotAllowedAtStart', errorParams: { date: '13/10/2026, 19:00', issueCode: 'rules.banned' } });

    // Sem data de início: vale hoje. Marcar o início para depois do banimento é recusado.
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss' })).json();
    const url = `/api/tournaments/${t.id}/register`;
    expect((await req(app, 'POST', url, a, { deckId: mihawk.id })).json().me.deckIssue).toBeNull();
    expect((await req(app, 'POST', url, b, { deckId: 'st02-kid' })).statusCode).toBe(200);
    const moved = await req(app, 'PUT', `/api/tournaments/${t.id}`, org, { name: 'Copa', format: 'egb', structure: 'swiss', startsAt: '2026-10-13T22:00:00Z' });
    expect(moved.json()).toMatchObject({ errorCode: 'tourDecksNotAllowed', errorParams: { n: 1 } });

    // Meia-noite do dia 12 em Brasília: o deck inscrito deixa de valer.
    now = Date.parse('2026-10-12T03:00:00Z');
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, a)).json().me.deckIssue).toMatchObject({ code: 'rules.banned', params: { id: 'OP14-020' } });
    const nameA = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().players.find((p: { userId: string }) => p.userId === a.id).name;
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().staleDecks).toEqual([nameA]);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, b)).json().staleDecks).toEqual([]);
    // Começar à mão: o organizador é avisado e decide.
    const start = await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true });
    expect(start.statusCode).toBe(409);
    expect(start.json()).toMatchObject({ errorCode: 'tourDecksNoLongerAllowed', errorParams: { n: 1, names: nameA } });
    // Trocando o deck, começa.
    expect((await req(app, 'POST', url, a, { deckId: 'st01-luffy' })).json().me.deckIssue).toBeNull();
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json().status).toBe('running');

    // Início automático: a inscrição com deck proibido é cancelada e o torneio começa com os outros.
    // (Um deck inscrito antes de a carta entrar na lista de banidas, simulado direto no banco.)
    const auto = (await req(app, 'POST', '/api/tournaments', org, { name: 'Auto', format: 'egb', structure: 'swiss', startsAt: '2026-10-12T20:00:00Z', checkIn: true, autoStart: true })).json();
    for (const [p, deckId] of [[b, 'st02-kid'], [c, 'st03-crocodile']] as const) await req(app, 'POST', `/api/tournaments/${auto.id}/register`, p, { deckId });
    registerPlayer(db, auto.id, a.id, nameA, mihawk.id, { id: mihawk.id, name: 'Mihawk', leader: 'OP14-020', cards: luffy.cards });
    now = Date.parse('2026-10-12T20:00:00Z');
    const r = tick(app)!;
    expect(r.removed).toEqual([{ tournamentId: auto.id, userIds: [a.id] }]);
    expect(r.started).toContain(auto.id);
    const view = (await req(app, 'GET', `/api/tournaments/${auto.id}`, org)).json();
    expect(view.players.map((p: { userId: string }) => p.userId).sort()).toEqual([b.id, c.id].sort());
  });

  it('check-in: abre 30 min antes, o torneio começa sozinho na hora e quem não aparece em 5 min perde por W.O.', async () => {
    let now = Date.parse('2026-10-10T19:00:00Z');
    const { db, app } = setup(() => now);
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db)];
    const startsAt = '2026-10-10T20:00:00.000Z';
    // Check-in exige data de início.
    expect((await req(app, 'POST', '/api/tournaments', org, { name: 'Noturno', format: 'egb', structure: 'swiss', checkIn: true })).statusCode).toBe(400);
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Noturno', format: 'egb', structure: 'swiss', rounds: 2, startsAt, checkIn: true, autoStart: true })).json();
    expect(t).toMatchObject({ checkIn: true, checkInOpensAt: '2026-10-10T19:30:00.000Z', checkInOpen: false, checkedIn: 0, deadline: null });
    expect(t.checkInMs).toBe(CHECK_IN_MS);
    expect(t.toleranceMs).toBe(TOLERANCE_MS_T);
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });

    // Antes da janela: nem o check-in nem o atalho da tela inicial.
    const checkin = (p: ReturnType<typeof login>) => req(app, 'POST', `/api/tournaments/${t.id}/checkin`, p);
    expect((await checkin(ps[0])).statusCode).toBe(409);
    expect((await req(app, 'GET', '/api/tournaments/me', ps[0])).json().entries).toEqual([]);
    expect(tick(app)).toEqual({ started: [], removed: [], checkIns: [], noShows: [] });
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
    const stale = (await req(app, 'POST', '/api/tournaments', org, { name: 'Velho', format: 'egb', structure: 'swiss', startsAt, checkIn: true, autoStart: true })).json();
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
    const t = (await req(app, 'POST', '/api/tournaments', admin, { name: 'Mata-mata', format: 'egb', structure: 'single', startsAt, checkIn: true, autoStart: true })).json();
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
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
    expect(view.rounds[1].matches).toEqual([expect.objectContaining({ p1: expect.objectContaining({ userId: s2.p1.userId }), p2: null, result: 'bye' })]);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
    expect(view.status).toBe('finished');
    expect(view.standings[0].userId).toBe(s2.p1.userId);
  });

  it('kit de divulgação: campeão, campanha com play/draw por jogo, top 4 e líderes', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = Array.from({ length: 5 }, () => login(db));
    const body = { name: 'Copa do Kit', format: 'egb', structure: 'swiss', rounds: 2, topCut: 2, bo3From: 2 };
    const t = (await req(app, 'POST', '/api/tournaments', org, body)).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i % DECKS.length] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const recap = (who?: { headers: Record<string, string> }) => req(app, 'GET', `/api/tournaments/${t.id}/recap`, who);
    // Só quem gerencia, e só no fim.
    expect((await recap()).statusCode).toBe(401);
    expect((await recap(ps[0])).statusCode).toBe(403);
    expect((await recap(org)).json()).toMatchObject({ errorCode: 'tourNotFinished' });

    const result = (m: { id: number }, payload: object) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, org, payload);
    for (let r = 0; r < 2; r++) {
      for (const m of view.rounds[r].matches.filter((x: any) => x.p2)) await result(m, { result: 'p1' });
      view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    }
    // Final em melhor de 3, jogada nas salas: p1 da final vence os dois jogos.
    const final = view.rounds[2].matches[0];
    expect(final.bestOf).toBe(3);
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    for (let g = 0; g < 2; g++) {
      const a = (await req(app, 'POST', `/api/tournaments/${t.id}/matches/${final.id}/play`, who(final.p1.userId))).json();
      const b = (await req(app, 'POST', `/api/tournaments/${t.id}/matches/${final.id}/play`, who(final.p2.userId))).json();
      const room = lobby.get(a.roomId)!;
      await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: b.token, seq: 0, action: { type: 'concede', player: room.seatOf(b.token)! } } });
    }
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.status).toBe('finished');

    const res = await recap(org);
    expect(res.statusCode).toBe(200);
    const kit = res.json();
    expect(kit.tournament).toMatchObject({ name: 'Copa do Kit', players: 5, swissRounds: 2, topCut: 2, earlyFinish: false });
    expect(kit.champion).toMatchObject({ rank: 1, userId: final.p1.userId, elim: { wins: 1, losses: 0, byes: 0 } });
    expect(kit.champion.swiss.wins + kit.champion.swiss.losses + kit.champion.swiss.byes).toBe(2);
    // Lista: líder à parte, cartas ordenadas por custo, com a quantidade e a imagem pelo mesmo domínio.
    expect(kit.champion.leader).toMatchObject({ category: 'leader', image: expect.stringMatching(/^\/card-img\/optcgapi\//) });
    const costs = kit.champion.cards.map((c: any) => c.cost ?? 99);
    expect(costs).toEqual([...costs].sort((x: number, y: number) => x - y));
    expect(kit.champion.cards.reduce((n: number, c: any) => n + c.count, 0)).toBe(50);
    expect(kit.top.map((p: any) => p.rank)).toEqual([1, 2, 3, 4]);
    expect(kit.top[1].userId).toBe(final.p2.userId);
    // Campanha: as 2 rodadas do suíço (lançadas ou bye) e a final jogada no site, com quem começou cada jogo.
    expect(kit.campaign).toHaveLength(3);
    const last = kit.campaign[2];
    expect(last).toMatchObject({ stage: 'elim', size: 2, bestOf: 3, outcome: 'win', score: [2, 0], how: 'game' });
    expect(last.opponent).toMatchObject({ name: expect.any(String), leader: { id: expect.any(String) } });
    expect(last.games.map((g: any) => [g.game, g.won])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(last.games.every((g: any) => typeof g.first === 'boolean')).toBe(true);
    // Quem perdeu o jogo 1 começa o jogo 2: o campeão estava na draw.
    expect(last.games[1].first).toBe(false);
    for (const r of kit.campaign.slice(0, 2)) {
      expect(['organizer', 'bye']).toContain(r.how);
      expect(r.games).toEqual([]);
    }
    // Líderes: todos os inscritos e o top 8 (aqui, os 5).
    expect(kit.leadersAll.reduce((n: number, l: any) => n + l.count, 0)).toBe(5);
    expect(kit.leadersAll[0].count).toBe(2);
    expect(kit.leadersAll[0].leader.set).toMatch(/^ST0/);
    expect(kit.leadersTop8).toEqual(kit.leadersAll);
  });

  it('kit de divulgação: torneio encerrado antes da hora avisa; sem imagens, sai sem arte', async () => {
    const db = openDb(':memory:');
    seed(db);
    const app = buildApp(db, { server: { cardImages: false }, onlineRateLimit: 1e9, botDelayMs: 0 });
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Curto', format: 'egb', structure: 'swiss', rounds: 3 })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    const view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    for (const m of view.rounds[0].matches.filter((x: any) => x.p2)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, org, { result: 'p2' });
    await req(app, 'POST', `/api/tournaments/${t.id}/finish`, org);
    const kit = (await req(app, 'GET', `/api/tournaments/${t.id}/recap`, org)).json();
    expect(kit).toMatchObject({ cardImages: false, tournament: { earlyFinish: true, players: 3, swissRounds: 1 } });
    expect(kit.top).toHaveLength(3);
    expect(kit.champion.leader.image).toBeNull();
    expect(kit.top.flatMap((p: any) => p.cards).every((c: any) => c.image === null)).toBe(true);
  });

  it('painel do meta: só torneios encerrados, Líderes por participação e vitórias, campeões e ranking', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = Array.from({ length: 4 }, () => login(db));
    const meta = async (q = '') => (await req(app, 'GET', `/api/tournaments/meta${q}`)).json();
    expect(await meta()).toMatchObject({ totals: { events: 0, players: 0, leaders: 0, matches: 0 }, latest: null, leaders: [], upcoming: [] });

    // Eliminação simples com 4 jogadores: dois com o mesmo deck (espelho não conta vitória de Líder).
    const decks = [DECKS[0], DECKS[0], DECKS[1], DECKS[2]];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa do Meta', format: 'egb', structure: 'single' })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: decks[i] });
    // Inscrições abertas: aparece nos próximos, sem entrar no meta.
    let m = await meta();
    expect(m.upcoming).toMatchObject([{ id: t.id, status: 'registration', players: 4 }]);
    expect(m.totals.events).toBe(0);

    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const set = (x: { id: number }, result: string) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, org, { result });
    for (const x of view.rounds[0].matches) await set(x, 'p1');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    // Em andamento: ainda fora do meta.
    expect((await meta()).totals.events).toBe(0);
    const final = view.rounds[1].matches[0];
    await set(final, 'p2');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.status).toBe('finished');

    const leaderOf = new Map(ps.map((p, i) => [p.id, getDeck(db, decks[i])!.leader]));
    const champ = final.p2.userId;
    m = await meta();
    expect(m.upcoming).toEqual([]);
    expect(m.totals).toEqual({ events: 1, players: 4, leaders: 3, matches: 3 });
    expect(m.latest).toMatchObject({ id: t.id, name: 'Copa do Meta', players: 4, champion: { leader: leaderOf.get(champ) } });
    expect(m.latest.finishedAt).toMatch(/Z$/);
    expect(m.recent).toHaveLength(1);
    // Participação: o Líder repetido primeiro, com 50% das inscrições.
    expect(m.leaders[0]).toMatchObject({ leader: getDeck(db, DECKS[0])!.leader, entries: 2, share: 0.5 });
    expect(m.leaders.reduce((n: number, l: any) => n + l.entries, 0)).toBe(4);
    expect(m.leaders.reduce((n: number, l: any) => n + l.titles, 0)).toBe(1);
    expect(m.leaders.find((l: any) => l.leader === leaderOf.get(champ)).titles).toBe(1);
    // Vitórias de Líder: as 3 séries menos os espelhos.
    const mirrors = [...view.rounds[0].matches, final].filter((x: any) => leaderOf.get(x.p1.userId) === leaderOf.get(x.p2.userId)).length;
    expect(m.leaders.reduce((n: number, l: any) => n + l.wins, 0)).toBe(3 - mirrors);
    expect(m.leaders.reduce((n: number, l: any) => n + l.wins - l.losses, 0)).toBe(0);
    // Ranking: o campeão em primeiro, com 2 vitórias; nomes e Líderes, sem id de conta.
    expect(m.players[0]).toEqual({ name: expect.any(String), events: 1, titles: 1, wins: 2, losses: 0, leader: leaderOf.get(champ) });
    expect(m.players).toHaveLength(4);
    expect(m.cards[leaderOf.get(champ)!]).toMatchObject({ category: 'leader' });

    // Filtros: outro formato e período.
    expect((await meta('?format=standard')).totals.events).toBe(0);
    expect((await meta('?format=egb&days=30')).totals.events).toBe(1);
  });

  it('imagens das cartas pelo mesmo domínio: só as origens conhecidas', async () => {
    expect(proxiedImageUrl('https://optcgapi.com/media/static/Card_Images/OP01-001.jpg')).toBe('/card-img/optcgapi/static/Card_Images/OP01-001.jpg');
    expect(proxiedImageUrl('https://images.optcgleaks.com/op18/images/abc.webp')).toBe('/card-img/optcgleaks/op18/images/abc.webp');
    expect(proxiedImageUrl('https://example.com/x.jpg')).toBeNull();
    expect(proxiedImageUrl('https://optcgapi.com/media/../etc/passwd.jpg')).toBeNull();
    expect(proxiedImageUrl(null)).toBeNull();

    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return url.endsWith('OP01-001.jpg')
        ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
        : new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const db = openDb(':memory:');
    const app = buildApp(db, { server: { cardImages: true }, fetchImpl });
    const ok = await app.inject({ method: 'GET', url: '/card-img/optcgapi/static/Card_Images/OP01-001.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    expect(asked).toEqual(['https://optcgapi.com/media/static/Card_Images/OP01-001.jpg']);
    expect((await app.inject({ method: 'GET', url: '/card-img/optcgapi/static/Card_Images/OP99-999.jpg' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/card-img/evil/x.jpg' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/card-img/optcgapi/static/a.html' })).statusCode).toBe(404);
    expect(asked).toHaveLength(2);
  });

  it('derrota dupla à mão: os dois perdem e seguem no torneio (ou saem); suíço trava depois do top cut', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Liga', format: 'egb', structure: 'swiss', rounds: 2, topCut: 2 })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const [m1, m2] = view.rounds[0].matches;
    const set = (m: { id: number }, payload: object, by = org) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, by, payload);
    expect((await set(m1, { result: 'double' }, ps[0])).statusCode).toBe(403);
    view = (await set(m1, { result: 'double' })).json();
    expect(view.rounds[0].matches[0]).toMatchObject({ result: 'none', winner: null, wins: [0, 0], reportedBy: 'organizer' });
    for (const id of [m1.p1.userId, m1.p2.userId]) {
      expect(view.players.find((p: any) => p.userId === id).dropped).toBe(false);
      expect(view.standings.find((s: any) => s.userId === id)).toMatchObject({ points: 0, losses: 1 });
    }
    // A outra mesa: derrota dupla e os dois saem.
    view = (await set(m2, { result: 'double', dropBoth: true })).json();
    for (const id of [m2.p1.userId, m2.p2.userId]) expect(view.players.find((p: any) => p.userId === id).dropped).toBe(true);
    expect(view.roundComplete).toBe(true);
    // Corrigir de volta para uma vitória continua possível.
    view = (await set(m2, { result: 'p1' })).json();
    expect(view.rounds[0].matches[1]).toMatchObject({ result: 'p1', winner: m2.p1.userId });
    // Rodada 2: quem levou a derrota dupla sem sair é pareado.
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    const r2 = view.rounds[1].matches.flatMap((m: any) => [m.p1.userId, m.p2?.userId]);
    expect(r2).toContain(m1.p1.userId);
    expect(r2).toContain(m1.p2.userId);
    // Rodada passada do suíço: derrota dupla vale até o top cut começar.
    view = (await set(m2, { result: 'double' })).json();
    expect(view.rounds[0].matches[1].result).toBe('none');
    for (const m of view.rounds[1].matches.filter((x: any) => x.p2)) await set(m, { result: 'p1' });
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.stage).toBe('elim');
    const blocked = await set(view.rounds[1].matches[0], { result: 'double' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().errorCode).toBe('topCutStartedSwissLocked');
  });

  it('derrota dupla na chave: rodada passada tira o vencedor antigo da partida seguinte (o oponente fica de bye)', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const ps = Array.from({ length: 8 }, () => login(db));
    const t = (await req(app, 'POST', '/api/tournaments', admin, { name: 'Mata-mata', format: 'egb', structure: 'single' })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i % DECKS.length] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, admin, { begin: true })).json();
    const set = (m: { id: number }, payload: object) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, admin, payload);
    for (const m of view.rounds[0].matches) await set(m, { result: 'p1' });
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
    const [q1] = view.rounds[0].matches;
    const semi = view.rounds[1].matches.find((m: any) => m.p1.userId === q1.p1.userId || m.p2.userId === q1.p1.userId);
    const opp = semi.p1.userId === q1.p1.userId ? semi.p2.userId : semi.p1.userId;
    view = (await set(q1, { result: 'double' })).json();
    expect(view.rounds[0].matches[0]).toMatchObject({ result: 'none', winner: null });
    expect(view.rounds[1].matches.find((m: any) => m.id === semi.id)).toMatchObject({ p1: expect.objectContaining({ userId: opp }), p2: null, result: 'bye' });
    expect(view.standings.find((s: any) => s.userId === q1.p1.userId).alive).toBe(false);
    // A semifinal decidida trava a derrota dupla na quarta de final dela.
    const other = view.rounds[1].matches.find((m: any) => m.p2);
    await set(other, { result: 'p1' });
    const q2 = view.rounds[0].matches.find((m: any) => m.p1.userId === other.p1.userId);
    const blocked = await set(q2, { result: 'double' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().errorCode).toBe('fixNextMatchFirst');
    // Rodada atual da chave: os dois saem e a mesa seguinte fica com bye.
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
    const final = view.rounds[2].matches[0];
    view = (await set(final, { result: 'double' })).json();
    expect(view.roundComplete).toBe(true);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, admin, { begin: true })).json();
    expect(view.status).toBe('finished');
  });

  it('desfazer desistência: volta na próxima rodada e, se a saída decidiu a partida, ela pode voltar a ficar pendente', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Liga', format: 'egb', structure: 'swiss', rounds: 3 })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    const [m1, m2] = view.rounds[0].matches;
    const reinstate = (userId: string, body: object = {}, by = org) => req(app, 'POST', `/api/tournaments/${t.id}/players/${userId}/reinstate`, by, body);
    // Quem não saiu não "volta".
    expect((await reinstate(m1.p1.userId)).json().errorCode).toBe('playerNotDropped');
    // O jogador desiste no meio da rodada: o oponente vence por desistência.
    view = (await req(app, 'DELETE', `/api/tournaments/${t.id}/register`, who(m1.p1.userId))).json();
    expect(view.rounds[0].matches[0]).toMatchObject({ result: 'p2', reportedBy: 'drop' });
    // Só quem gerencia vê se o jogador pode voltar.
    expect(view.players.find((p: any) => p.userId === m1.p1.userId).reinstate).toBeNull();
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    expect(view.players.find((p: any) => p.userId === m1.p1.userId).reinstate).toBe('optional');
    expect((await reinstate(m1.p1.userId, {}, who(m1.p2.userId))).statusCode).toBe(403);
    view = (await reinstate(m1.p1.userId, { restoreMatch: true })).json();
    expect(view.players.find((p: any) => p.userId === m1.p1.userId)).toMatchObject({ dropped: false, reinstate: null });
    expect(view.rounds[0].matches[0]).toMatchObject({ result: null, wins: [0, 0], reportedBy: null });
    expect(view.roundComplete).toBe(false);
    // Desiste de novo, e agora volta sem devolver a partida (o resultado fica).
    await req(app, 'POST', `/api/tournaments/${t.id}/players/${m1.p1.userId}/drop`, org);
    view = (await reinstate(m1.p1.userId)).json();
    expect(view.rounds[0].matches[0]).toMatchObject({ result: 'p2', reportedBy: 'drop' });
    await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m2.id}/result`, org, { result: 'p1' });
    // Saiu depois de a partida terminar: não há o que devolver.
    await req(app, 'POST', `/api/tournaments/${t.id}/players/${m2.p2.userId}/drop`, org);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().players.find((p: any) => p.userId === m2.p2.userId).reinstate).toBe('no');
    expect((await reinstate(m2.p2.userId, { restoreMatch: true })).json().errorCode).toBe('reinstateNothingToRestore');
    view = (await reinstate(m2.p2.userId)).json();
    // A rodada 2 pareia os quatro.
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.rounds[1].matches.filter((m: any) => m.p2)).toHaveLength(2);
    // Os outros jogadores não veem as opções de quem gerencia.
    await req(app, 'POST', `/api/tournaments/${t.id}/players/${m2.p2.userId}/drop`, org);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, ps[0])).json().players.every((p: any) => p.reinstate === null)).toBe(true);
  });

  it('desfazer desistência na chave: só devolvendo a partida da fase atual', async () => {
    const { db, app } = setup();
    const admin = login(db, 'admin');
    const ps = Array.from({ length: 4 }, () => login(db));
    const t = (await req(app, 'POST', '/api/tournaments', admin, { name: 'Mata-mata', format: 'egb', structure: 'single' })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, admin, { begin: true })).json();
    const [s1, s2] = view.rounds[0].matches;
    const reinstate = (userId: string, body: object = {}) => req(app, 'POST', `/api/tournaments/${t.id}/players/${userId}/reinstate`, admin, body);
    await req(app, 'POST', `/api/tournaments/${t.id}/players/${s1.p1.userId}/drop`, admin);
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, admin)).json();
    expect(view.players.find((p: any) => p.userId === s1.p1.userId).reinstate).toBe('required');
    expect((await reinstate(s1.p1.userId)).json().errorCode).toBe('reinstateNeedsRestore');
    view = (await reinstate(s1.p1.userId, { restoreMatch: true })).json();
    expect(view.rounds[0].matches[0].result).toBeNull();
    // Perdeu jogando: não volta.
    await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${s2.id}/result`, admin, { result: 'p1' });
    await req(app, 'POST', `/api/tournaments/${t.id}/players/${s2.p2.userId}/drop`, admin);
    expect((await reinstate(s2.p2.userId)).json().errorCode).toBe('reinstateLostInBracket');
  });

  it('inscrição atrasada: só no suíço com 2+ rodadas, durante a rodada 1; entra com uma derrota e é pareado na rodada 2', async () => {
    const { db, app } = setup();
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db), login(db)];
    const [late, zoro, other] = [login(db), login(db), login(db)];
    renamePlayer(db, `user:${zoro.id}`, 'Zoro');
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Liga', format: 'egb', structure: 'swiss', rounds: 3, maxPlayers: 6 })).json();
    const lateUrl = `/api/tournaments/${t.id}/late`;
    // Antes de começar não existe.
    expect((await req(app, 'PUT', lateUrl, org, { open: true })).json().errorCode).toBe('lateEntryUnavailable');
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    expect(view).toMatchObject({ lateWindow: true, lateEntry: null });
    const register = (p: ReturnType<typeof login>, deckId = 'st01-luffy') => req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId });
    // Fechada: ninguém entra.
    expect((await register(late)).json().errorCode).toBe('registrationClosed');
    expect((await req(app, 'PUT', lateUrl, ps[0], { open: true })).statusCode).toBe(403);
    // Liberada só para um jogador (pelo apelido): os outros não entram.
    expect((await req(app, 'PUT', lateUrl, org, { open: true, player: 'Ninguém' })).json().errorCode).toBe('lateEntryPlayerNotFound');
    view = (await req(app, 'PUT', lateUrl, org, { open: true, player: 'zoro' })).json();
    expect(view.lateEntry).toEqual({ all: false, name: 'Zoro' });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, zoro)).json()).toMatchObject({ canLateRegister: true, lateWindow: false, lateEntry: null });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, late)).json().canLateRegister).toBe(false);
    expect((await register(late)).statusCode).toBe(409);
    // O deck é validado no formato.
    expect((await register(zoro, 'st10-law')).statusCode).toBe(400);
    view = (await register(zoro)).json();
    expect(view.me).toMatchObject({ deckId: 'st01-luffy', dropped: false });
    const zr1 = view.rounds[0].matches.find((m: any) => m.p1.userId === zoro.id);
    expect(zr1).toMatchObject({ p2: null, result: 'loss', winner: null, reportedBy: 'late', table: 3 });
    expect(view.standings.find((s: any) => s.userId === zoro.id)).toMatchObject({ points: 0, losses: 1, wins: 0, byes: 0 });
    expect(view.players.find((p: any) => p.userId === zoro.id).seed).toBe(5);
    // A liberação individual foi usada; o deck não muda mais.
    expect(view.lateEntry).toBeNull();
    expect((await register(zoro, 'st02-kid')).statusCode).toBe(409);
    // Liberada para todos: entra mais um; o limite de jogadores continua valendo.
    await req(app, 'PUT', lateUrl, org, { open: true });
    expect((await register(late)).statusCode).toBe(200);
    expect((await register(other)).json().errorCode).toBe('tourFull');
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    expect(view.rounds[0].matches).toHaveLength(4);
    expect(view.roundComplete).toBe(false);
    for (const m of view.rounds[0].matches.filter((x: any) => x.p2)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, org, { result: 'p1' });
    // Rodada 2: os seis são pareados (sem bye) e a janela fecha sozinha.
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view).toMatchObject({ round: 2, totalRounds: 3, lateWindow: false, lateEntry: null });
    const r2 = view.rounds[1].matches;
    expect(r2.every((m: any) => m.p2)).toBe(true);
    expect(r2.flatMap((m: any) => [m.p1.userId, m.p2.userId])).toEqual(expect.arrayContaining([zoro.id, late.id]));
    expect((await register(other)).json().errorCode).toBe('registrationClosed');
    expect((await req(app, 'PUT', lateUrl, org, { open: true })).json().errorCode).toBe('lateEntryUnavailable');

    // Eliminação simples e suíço de 1 rodada não têm inscrição atrasada.
    for (const body of [{ structure: 'single' }, { structure: 'swiss', rounds: 1 }]) {
      const t2 = (await req(app, 'POST', '/api/tournaments', org, { name: 'Outro', format: 'egb', ...body })).json();
      for (const [i, p] of ps.slice(0, 2).entries()) await req(app, 'POST', `/api/tournaments/${t2.id}/register`, p, { deckId: DECKS[i] });
      expect((await req(app, 'POST', `/api/tournaments/${t2.id}/start`, org, { begin: true })).json().lateWindow).toBe(false);
      expect((await req(app, 'PUT', `/api/tournaments/${t2.id}/late`, org, { open: true })).statusCode).toBe(409);
    }
  });
});

// ------------------------------------------------------------------ Judge, chamados, warnings e início das rodadas

/** Conexão de teste da sala (como o navegador monta a visão). */
function spectator(judge: boolean) {
  const events: Array<{ event: string; data: any }> = [];
  let latest: any = null;
  const conn: Connection = {
    seat: null,
    judge,
    sentDefs: new Set(),
    sentLog: 0,
    send: (event, data: any) => {
      events.push({ event, data });
      if (event === 'state') latest = data;
    },
  };
  return {
    conn,
    events,
    get snapshot() {
      return latest;
    },
  };
}

describe('torneios: Judge, chamados, warnings e início das rodadas', () => {
  /** Organizador, 4 inscritos (com nome público) e um torneio suíço de 2 rodadas. */
  async function arena(app: App, db: DB, extra: Record<string, unknown> = {}) {
    const org = login(db, 'organizer');
    await req(app, 'PUT', '/api/players/me', org, { name: 'Shanks' });
    const ps = [login(db), login(db), login(db), login(db)];
    for (const [i, p] of ps.entries()) await req(app, 'PUT', '/api/players/me', p, { name: ['Luffy', 'Zoro', 'Nami', 'Usopp'][i] });
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss', rounds: 2, ...extra })).json();
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: DECKS[i] });
    const who = (userId: string) => ps.find((p) => p.id === userId)!;
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    return { org, ps, t, who, lobby };
  }
  const play = (app: App, tId: string, p: ReturnType<typeof login>, m: { id: number }) => req(app, 'POST', `/api/tournaments/${tId}/matches/${m.id}/play`, p);

  it('Judge: escolhido pelo organizador pelo apelido, só deste torneio; um inscrito não é Judge e um Judge não se inscreve', async () => {
    const { db, app } = setup();
    const { org, ps, t } = await arena(app, db);
    const nami = ps[2];
    const judge = login(db);
    await req(app, 'PUT', '/api/players/me', judge, { name: 'Robin' });
    // Sem Judge escolhido, o organizador faz o papel; outra conta não.
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json()).toMatchObject({ isJudge: true, judges: [] });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, judge)).json().isJudge).toBe(false);
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, nami, { player: 'Robin' })).statusCode).toBe(403);
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: '' })).statusCode).toBe(400);
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Ninguém' })).statusCode).toBe(404);
    // Inscrito não pode ser Judge.
    expect((await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Nami' })).json()).toMatchObject({ errorCode: 'judgeIsPlayer' });
    const view = (await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'robin' })).json();
    expect(view.judges).toEqual([{ userId: judge.id, name: 'Robin' }]);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, judge)).json()).toMatchObject({ isJudge: true, canManage: false });
    // Judge não joga o torneio.
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/register`, judge, { deckId: DECKS[0] })).json()).toMatchObject({ errorCode: 'judgeCannotRegister' });
    // O papel vale só neste torneio.
    const other = (await req(app, 'POST', '/api/tournaments', org, { name: 'Outra', format: 'egb', structure: 'swiss' })).json();
    expect((await req(app, 'GET', `/api/tournaments/${other.id}`, judge)).json().isJudge).toBe(false);
    expect((await req(app, 'DELETE', `/api/tournaments/${t.id}/judges/${judge.id}`, org)).json().judges).toEqual([]);
    expect((await req(app, 'DELETE', `/api/tournaments/${t.id}/judges/${judge.id}`, org)).statusCode).toBe(404);
  });

  it('rodada em duas etapas: gerar (Estou pronto) e iniciar (as salas abrem; a tolerância conta do início); hora marcada sem início automático espera o organizador', async () => {
    let now = Date.parse('2026-10-10T19:50:00Z');
    const { db, app } = setup(() => now);
    const startsAt = '2026-10-10T20:00:00.000Z';
    const { org, ps, t, who } = await arena(app, db, { startsAt, checkIn: true });
    expect(t).toMatchObject({ checkIn: true, autoStart: false });
    // Hora atingida: nada acontece sozinho.
    now = Date.parse('2026-10-10T20:01:00Z');
    expect(tick(app)!.started).toEqual([]);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().status).toBe('registration');
    // O organizador gera a rodada 1: pareamentos à vista, salas fechadas.
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org)).json();
    expect(view).toMatchObject({ status: 'running', round: 1, roundStartedAt: null, deadline: null, tables: 2, readyTables: 0 });
    const [m1, m2] = view.rounds[0].matches;
    expect((await play(app, t.id, who(m1.p1.userId), m1)).json()).toMatchObject({ errorCode: 'roundNotStarted' });
    // Sem a rodada iniciada, ninguém leva W.O.
    now = Date.parse('2026-10-10T20:30:00Z');
    expect(tick(app)!.noShows).toEqual([]);
    // "Estou pronto": só os jogadores da partida; aparece para o organizador.
    const ready = (p: ReturnType<typeof login>, m: { id: number }, on = true) => req(app, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/ready`, p, { ready: on });
    expect((await ready(who(m2.p1.userId), m1)).statusCode).toBe(403);
    view = (await ready(who(m1.p1.userId), m1)).json();
    expect(view.me.ready).toBe(true);
    expect(view.readyTables).toBe(0);
    view = (await ready(who(m1.p2.userId), m1)).json();
    expect(view.readyTables).toBe(1);
    expect(view.rounds[0].matches.find((m: any) => m.id === m1.id).ready).toEqual([true, true]);
    expect((await ready(who(m1.p2.userId), m1, false)).json().readyTables).toBe(0);
    // O lobby mostra as mesas prontas e, antes do início, quem fez check-in.
    let lob = (await req(app, 'GET', `/api/tournaments/${t.id}/lobby`, who(m1.p1.userId))).json();
    expect(lob).toMatchObject({ round: 1, roundStartedAt: null, pendingTables: 2, readyTables: 0, viewer: { judge: false, manage: false } });
    expect(lob.tables.find((x: any) => x.id === m1.id).p1).toMatchObject({ ready: true, remaining: null, connected: null });
    // Iniciar a rodada: só quem gerencia, uma vez; a tolerância conta daqui.
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/rounds/begin`, who(m1.p1.userId))).statusCode).toBe(403);
    now = Date.parse('2026-10-10T20:40:00Z');
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/rounds/begin`, org)).json();
    expect(view).toMatchObject({ roundStartedAt: '2026-10-10T20:40:00.000Z', deadline: '2026-10-10T20:45:00.000Z' });
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/rounds/begin`, org)).statusCode).toBe(409);
    expect((await play(app, t.id, who(m1.p1.userId), m1)).statusCode).toBe(200);
    await play(app, t.id, who(m2.p1.userId), m2);
    await play(app, t.id, who(m2.p2.userId), m2);
    now = Date.parse('2026-10-10T20:45:00Z');
    // Só quem não entrou na sala leva W.O. (a mesa 2 está jogando).
    expect(tick(app)!.noShows).toMatchObject([{ matchId: m1.id, absent: ['p2'] }]);
    // Atalho da tela inicial: a rodada já iniciada.
    lob = (await req(app, 'GET', '/api/tournaments/me', who(m1.p1.userId))).json();
    expect(lob.entries[0]).toMatchObject({ roundStarted: true });
    // A próxima rodada gerada e iniciada de uma vez.
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    for (const x of view.rounds[0].matches.filter((x: any) => !x.result)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, org, { result: 'p1' });
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view).toMatchObject({ round: 2, roundStartedAt: '2026-10-10T20:45:00.000Z' });
  });

  it('Chamar o Judge: a sala pausa (relógio parado, jogadas recusadas, chat aberto, abandono não conta); só o Judge ou o organizador retoma; sobrevive a reinício', async () => {
    let now = Date.parse('2026-10-10T20:00:00Z');
    const db = openDb(':memory:');
    seed(db);
    const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => now });
    const { org, ps, t, who, lobby } = await arena(app, db);
    const judge = login(db);
    await req(app, 'PUT', '/api/players/me', judge, { name: 'Robin' });
    await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Robin' });
    const view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const m = view.rounds[0].matches[0];
    const a = who(m.p1.userId);
    const b = who(m.p2.userId);
    const call = (p: ReturnType<typeof login>) => req(app, 'POST', `/api/tournaments/${t.id}/matches/${m.id}/call`, p);
    // Sem sala em jogo, não há o que pausar.
    expect((await call(a)).json()).toMatchObject({ errorCode: 'matchNotPlaying' });
    const seatA = (await play(app, t.id, a, m)).json();
    const seatB = (await play(app, t.id, b, m)).json();
    const room = lobby.get(seatA.roomId)!;
    expect(room.status).toBe('playing');
    const sideA = room.seatOf(seatA.token)!;
    const act = (token: string, action: object) => app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: token, seq: room.state!.actionCount, action } });
    // Quem não é da partida (nem Judge) não chama.
    expect((await call(ps.find((p) => p.id !== a.id && p.id !== b.id)!)).statusCode).toBe(403);
    now += 10_000;
    const running = room.clock().running!;
    const before = room.clock().remaining[running];
    expect((await call(a)).json().callId).toBeTypeOf('number');
    expect(room.isPaused).toBe(true);
    expect((await call(b)).json()).toMatchObject({ errorCode: 'roomAlreadyPaused' });
    // O relógio não anda e a jogada é recusada; o chat continua.
    now += 60_000;
    expect(room.clock()).toMatchObject({ paused: true, remaining: expect.arrayContaining([before]) });
    const first = room.clock().running!;
    const token = first === sideA ? seatA.token : seatB.token;
    expect((await act(token, { type: 'answer', player: first, yes: true })).json()).toMatchObject({ errorCode: 'roomPaused' });
    expect((await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/chat`, payload: { t: seatA.token, text: 'juiz, por favor' } })).statusCode).toBe(204);
    // Jogador da vez sem conexão por muito tempo: não perde por abandono enquanto pausado.
    now += 5 * 60_000;
    expect(room.status).toBe('playing');
    // O Judge e o organizador veem o chamado (detalhe e lobby); os jogadores só veem a sala pausada.
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, judge)).json().openCalls).toMatchObject([{ matchId: m.id, table: m.table }]);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, a)).json().openCalls).toEqual([]);
    const lob = (await req(app, 'GET', `/api/tournaments/${t.id}/lobby`, org)).json();
    expect(lob.calls).toMatchObject([{ matchId: m.id, roomId: room.id }]);
    const table = lob.tables.find((x: any) => x.id === m.id);
    expect(table).toMatchObject({ paused: true, room: 'playing' });
    expect(table.p1.remaining).toBeTypeOf('number');
    const aName = (await req(app, 'GET', `/api/tournaments/${t.id}`, a)).json().players.find((p: any) => p.userId === a.id).name;
    expect(table.call.byName).toBe(aName);
    const mine = (await req(app, 'GET', `/api/tournaments/${t.id}/lobby`, b)).json().tables.find((x: any) => x.id === m.id);
    expect(mine).toMatchObject({ paused: true });
    expect(mine.p1.remaining).toBeNull();
    expect(mine.call.byName).toBeNull();
    // A pausa sobrevive a um reinício do servidor.
    await app.close();
    const app2 = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => now });
    const room2 = (app2 as unknown as { onlineLobby: Lobby }).onlineLobby.get(room.id)!;
    expect(room2.isPaused).toBe(true);
    expect(room2.clock().remaining[running]).toBe(before);
    // Jogador não retoma; o Judge sim, com a nota (relato ao organizador).
    const resume = (p: ReturnType<typeof login>, note?: string) => req(app2, 'POST', `/api/tournaments/${t.id}/matches/${m.id}/resume`, p, { note });
    expect((await resume(a)).statusCode).toBe(403);
    expect((await resume(judge, 'Carta virada por engano, desfeito à mão.')).statusCode).toBe(204);
    expect(room2.isPaused).toBe(false);
    expect((await resume(org)).json()).toMatchObject({ errorCode: 'roomNotPaused' });
    now += 10_000;
    expect(room2.clock().remaining[room2.clock().running!]).toBeLessThan(before);
    const incidents = (await req(app2, 'GET', `/api/tournaments/${t.id}/incidents`, judge)).json();
    expect(incidents.calls).toHaveLength(1);
    expect(incidents.calls[0]).toMatchObject({ matchId: m.id, note: 'Carta virada por engano, desfeito à mão.', openedByName: aName, resolvedByName: 'Robin' });
    expect((await req(app2, 'GET', `/api/tournaments/${t.id}/incidents`, a)).statusCode).toBe(403);
    // O Judge também pausa por conta própria.
    expect((await req(app2, 'POST', `/api/tournaments/${t.id}/matches/${m.id}/call`, judge)).statusCode).toBe(200);
    expect(room2.isPaused).toBe(true);
    // Resultado lançado pelo organizador: a sala volta a correr e o chamado fecha.
    await req(app2, 'PUT', `/api/tournaments/${t.id}/matches/${m.id}/result`, org, { result: 'p1' });
    expect(room2.isPaused).toBe(false);
    expect((await req(app2, 'GET', `/api/tournaments/${t.id}`, judge)).json().openCalls).toEqual([]);
    await app2.close();
  });

  it('o Judge entra em qualquer sala do torneio vendo as duas mãos ao vivo; os outros não', async () => {
    const { db, app } = setup();
    const { org, ps, t, who, lobby } = await arena(app, db);
    const judge = login(db);
    await req(app, 'PUT', '/api/players/me', judge, { name: 'Robin' });
    await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Robin' });
    const view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const m = view.rounds[0].matches[0];
    const seatA = (await play(app, t.id, who(m.p1.userId), m)).json();
    await play(app, t.id, who(m.p2.userId), m);
    const room = lobby.get(seatA.roomId)!;
    const asJudge = spectator(true);
    const plain = spectator(false);
    room.attach(asJudge.conn);
    room.attach(plain.conn);
    const shown = (s: any, i: number) => s.view.players[i].hand.every((u: string) => s.view.cards[u].cardId !== HIDDEN_CARD);
    expect(asJudge.snapshot.room.delay).toBe(0);
    expect(shown(asJudge.snapshot, 0) && shown(asJudge.snapshot, 1)).toBe(true);
    expect(shown(plain.snapshot, 0) || shown(plain.snapshot, 1)).toBe(false);
    // O log inteiro chega na conexão (histórico da partida).
    expect(asJudge.snapshot.log.from).toBe(0);
    expect(asJudge.snapshot.room.players[0].userId).toBe(m.p1.userId);
    // O canal: só Judge/organizador do torneio (403 para os demais, 401 sem login).
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const open = async (who?: { headers: Record<string, string> }) => {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${room.id}/watch?judge=1`, { signal: ctrl.signal, headers: who?.headers ?? {} });
      ctrl.abort();
      return res.status;
    };
    expect(await open()).toBe(401);
    expect(await open(ps[3])).toBe(403);
    expect(await open(judge)).toBe(200);
    expect(await open(org)).toBe(200);
    const admin = login(db, 'admin');
    expect(await open(admin)).toBe(200);
    await app.close();
  });

  it('modo manual: Judge da lista, organizador e admin desfazem e corrigem a mesa, sem os jogadores decidirem; tudo vai para a auditoria', async () => {
    const { db, app } = setup();
    const { org, t, who, lobby } = await arena(app, db);
    const judge = login(db);
    await req(app, 'PUT', '/api/players/me', judge, { name: 'Robin' });
    await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Robin' });
    const otherOrg = login(db, 'organizer');
    const admin = login(db, 'admin');
    const view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const m = view.rounds[0].matches[0];
    const a = who(m.p1.userId);
    const seatA = (await play(app, t.id, a, m)).json();
    await play(app, t.id, who(m.p2.userId), m);
    const room = lobby.get(seatA.roomId)!;
    // Sorteio e mulligans: a partida chega ao primeiro turno.
    while (room.state!.phase !== 'main') {
      const p = actingPlayer(room.state!)!;
      expect(room.act(p, room.state!.actionCount, legalActions(room.state!, p)[0]).ok).toBe(true);
    }
    const base = `/api/tournaments/${t.id}/matches/${m.id}`;
    type Who = ReturnType<typeof login>;
    const manual = (w: Who, body: object) => req(app, 'POST', `${base}/manual`, w, body);
    const fix = (w: Who, body: object) => req(app, 'POST', `${base}/judge-action`, w, body);
    const undo = (w: Who, body: object) => req(app, 'POST', `${base}/undo`, w, body);
    const seq = () => room.state!.actionCount;
    // Jogador e organizador de outro torneio não entram no modo manual.
    expect((await manual(a, { on: true })).statusCode).toBe(403);
    expect((await manual(otherOrg, { on: true })).statusCode).toBe(403);
    // Fora do modo manual não há desfazer nem correção.
    expect((await undo(judge, { seq: seq(), to: 0, note: 'teste' })).json()).toMatchObject({ errorCode: 'roomNotManual' });
    expect((await req(app, 'GET', `${base}/manual`, judge)).json()).toMatchObject({ errorCode: 'roomNotManual' });
    // O Judge da lista entra: a partida pausa (com chamado aberto) e todos veem quem está corrigindo.
    const watcher = spectator(false);
    room.attach(watcher.conn);
    expect((await manual(judge, { on: true, note: 'Efeito da carta não resolveu' })).json()).toMatchObject({ manual: { name: 'Robin' } });
    expect(room.isPaused).toBe(true);
    expect(watcher.snapshot.room.manual).toMatchObject({ name: 'Robin' });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, judge)).json().openCalls).toMatchObject([{ matchId: m.id }]);
    expect((await manual(org, { on: true })).json()).toMatchObject({ errorCode: 'roomAlreadyManual' });
    // Os jogadores não jogam enquanto isso.
    const p = actingPlayer(room.state!)!;
    const other = (1 - p) as PlayerId;
    expect(room.act(p, seq(), { type: 'endTurn', player: p })).toMatchObject({ ok: false, errorCode: 'roomPaused' });
    // Correção pelo lado de quem não é da vez: nota obrigatória e a mesa na versão que o Judge viu.
    const start = seq();
    const hand = room.state!.players[other].hand.length;
    expect((await fix(judge, { seq: seq(), player: other, op: { op: 'draw', count: 1 } })).json()).toMatchObject({ errorCode: 'manualNoteRequired' });
    expect((await fix(judge, { seq: seq() - 1, player: other, op: { op: 'draw', count: 1 }, note: 'compra do efeito' })).json()).toMatchObject({
      errorCode: 'boardChanged',
    });
    expect((await fix(judge, { seq: seq(), player: other, op: { op: 'draw', count: 1 }, note: 'compra do efeito' })).json()).toEqual({ actionCount: start + 1 });
    expect(room.state!.players[other].hand.length).toBe(hand + 1);
    expect(room.state!.log.at(-2)).toMatchObject({ key: 'log.judgeIntervention', params: { name: 'Robin' } });
    expect(room.isPaused).toBe(true);
    // Cartas pelos apelidos da visão do Judge (que vê as duas mãos).
    const judgeView = spectator(true);
    room.attach(judgeView.conn);
    const alias = judgeView.snapshot.view.players[other].hand[0];
    const trash = room.state!.players[other].trash.length;
    expect((await fix(judge, { seq: seq(), player: other, op: { op: 'move', uid: alias, to: 'trash' }, note: 'descarte do efeito' })).statusCode).toBe(200);
    expect(room.state!.players[other].trash.length).toBe(trash + 1);
    // O admin responde no lugar do jogador da vez (só concluir, passar ou encerrar o turno).
    expect((await fix(admin, { seq: seq(), player: p, action: { type: 'attack' }, note: 'ataque' })).json()).toMatchObject({ errorCode: 'invalidAction' });
    expect((await fix(admin, { seq: seq(), player: p, action: { type: 'endTurn' }, note: 'turno travado' })).statusCode).toBe(200);
    expect(room.state!.activePlayer).toBe(other);
    // As últimas jogadas, da mais recente para a mais antiga.
    const hist = (await req(app, 'GET', `${base}/manual`, judge)).json();
    expect(hist.actionCount).toBe(seq());
    expect(hist.history.slice(0, 3)).toMatchObject([
      { type: 'endTurn', player: p, count: start + 2 },
      { type: 'judge', player: other, count: start + 1 },
      { type: 'judge', player: other, count: start },
    ]);
    expect(hist.history[2].logTo).toBeGreaterThan(hist.history[2].logFrom);
    // O organizador desfaz até antes da primeira correção: a mesa volta como estava, e o log encolhe para quem assiste.
    expect((await undo(org, { seq: seq(), to: start, note: '' })).json()).toMatchObject({ errorCode: 'manualNoteRequired' });
    expect((await undo(org, { seq: seq(), to: seq(), note: 'nada' })).json()).toMatchObject({ errorCode: 'invalidUndo' });
    expect((await undo(org, { seq: seq(), to: start, note: 'voltar antes das correções' })).json()).toEqual({ actionCount: start });
    expect(room.state!.players[other].hand.length).toBe(hand);
    expect(room.state!.activePlayer).toBe(p);
    expect(watcher.snapshot.view.actionCount).toBe(start);
    expect(watcher.snapshot.log).toEqual({ from: room.state!.log.length, entries: [] });
    expect(room.isPaused).toBe(true);
    // Sair do modo manual deixa a partida pausada; retomar libera.
    expect((await manual(judge, { on: false })).json()).toMatchObject({ manual: null });
    expect(room.isPaused).toBe(true);
    expect((await req(app, 'POST', `${base}/resume`, judge, { note: 'corrigido' })).statusCode).toBe(204);
    expect(room.isPaused).toBe(false);
    // A mesa refeita continua jogável.
    expect(room.act(p, seq(), { type: 'endTurn', player: p }).ok).toBe(true);
    // Auditoria: quem, com que papel, o quê.
    const inc = (await req(app, 'GET', `/api/tournaments/${t.id}/incidents`, org)).json();
    expect(inc.interventions.map((i: any) => [i.kind, i.role, i.byName])).toEqual([
      ['manual_off', 'judge', 'Robin'],
      ['undo', 'organizer', 'Shanks'],
      ['judge_action', 'admin', expect.any(String)],
      ['judge_action', 'judge', 'Robin'],
      ['judge_action', 'judge', 'Robin'],
      ['manual_on', 'judge', 'Robin'],
    ]);
    expect(inc.interventions[1]).toMatchObject({ removedCount: 3, note: 'voltar antes das correções', payload: { to: start }, match: { table: m.table } });
    expect(inc.interventions[3].payload).toMatchObject({ type: 'judge', op: { op: 'move', to: 'trash' } });
    // O Judge tirado da lista perde o modo manual; com o torneio encerrado, ninguém mais corrige.
    await req(app, 'DELETE', `/api/tournaments/${t.id}/judges/${judge.id}`, org);
    expect((await manual(judge, { on: true })).statusCode).toBe(403);
    await req(app, 'POST', `/api/tournaments/${t.id}/finish`, org);
    expect((await manual(org, { on: true })).json()).toMatchObject({ errorCode: 'matchNotCurrentRound' });
    expect((await manual(admin, { on: true })).statusCode).toBe(409);
    await app.close();
  });

  it('warnings: Judge e organizador dão (com motivo); ao atingir o limite, a próxima rodada trava até o organizador manter ou eliminar', async () => {
    const { db, app } = setup();
    const { org, ps, t, who } = await arena(app, db, { maxWarnings: 2 });
    expect(t.maxWarnings).toBe(2);
    expect((await req(app, 'POST', '/api/tournaments', org, { name: 'X', format: 'egb', structure: 'swiss', maxWarnings: 99 })).statusCode).toBe(400);
    const judge = login(db);
    await req(app, 'PUT', '/api/players/me', judge, { name: 'Robin' });
    await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Robin' });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).json();
    const m = view.rounds[0].matches[0];
    const luffy = ps[0];
    const warn = (by: ReturnType<typeof login>, userId: string, reason: unknown, matchId?: number) =>
      req(app, 'POST', `/api/tournaments/${t.id}/players/${userId}/warnings`, by, { reason, matchId });
    expect((await warn(ps[1], luffy.id, 'bla bla')).statusCode).toBe(403);
    expect((await warn(judge, luffy.id, '')).statusCode).toBe(400);
    expect((await warn(judge, judge.id, 'auto')).statusCode).toBe(400);
    expect((await warn(judge, 'nobody', 'x y z')).statusCode).toBe(404);
    view = (await warn(judge, luffy.id, 'Demora excessiva', m.id)).json();
    let p = view.players.find((x: any) => x.userId === luffy.id);
    expect(p.warnings).toMatchObject({ count: 1, max: 2, limitReached: false, pending: false });
    expect(p.warnings.list).toMatchObject([{ reason: 'Demora excessiva', byName: 'Robin', round: 1, revoked: false }]);
    // Os motivos são do Judge, do organizador e do próprio jogador; para os outros, só a contagem.
    const others = (await req(app, 'GET', `/api/tournaments/${t.id}`, ps[1])).json().players.find((x: any) => x.userId === luffy.id);
    expect(others.warnings).toMatchObject({ count: 1, list: null, pending: false });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, luffy)).json().me.warnings.list).toHaveLength(1);
    // Segundo warning: limite atingido, decisão pendente (para quem gerencia), a próxima rodada trava.
    view = (await warn(org, luffy.id, 'Linguagem imprópria')).json();
    p = view.players.find((x: any) => x.userId === luffy.id);
    expect(p.warnings).toMatchObject({ count: 2, limitReached: true, pending: true });
    expect(view.warningsPending).toEqual([{ userId: luffy.id, name: 'Luffy' }]);
    for (const x of view.rounds[0].matches.filter((x: any) => !x.result)) await req(app, 'PUT', `/api/tournaments/${t.id}/matches/${x.id}/result`, org, { result: 'p1' });
    const next = await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true });
    expect(next.statusCode).toBe(409);
    expect(next.json()).toMatchObject({ errorCode: 'warningsPending', errorParams: { names: 'Luffy' } });
    // O Judge não decide (nem anula); o organizador anula um warning e o limite deixa de valer.
    const w = p.warnings.list[1].id;
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/players/${luffy.id}/warnings/keep`, judge)).statusCode).toBe(403);
    expect((await req(app, 'DELETE', `/api/tournaments/${t.id}/warnings/${w}`, judge)).statusCode).toBe(403);
    view = (await req(app, 'DELETE', `/api/tournaments/${t.id}/warnings/${w}`, org)).json();
    p = view.players.find((x: any) => x.userId === luffy.id);
    expect(p.warnings).toMatchObject({ count: 1, pending: false });
    expect(p.warnings.list[1].revoked).toBe(true);
    // Atinge de novo: o organizador decide manter; um warning novo volta a pedir decisão; eliminar também resolve.
    view = (await warn(judge, luffy.id, 'Reincidência')).json();
    expect(view.warningsPending).toHaveLength(1);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/players/${luffy.id}/warnings/keep`, org)).json();
    expect(view.warningsPending).toEqual([]);
    view = (await warn(judge, luffy.id, 'De novo')).json();
    expect(view.warningsPending).toHaveLength(1);
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).statusCode).toBe(409);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/players/${luffy.id}/drop`, org)).json();
    expect(view.warningsPending).toEqual([]);
    expect(view.players.find((x: any) => x.userId === luffy.id).dropped).toBe(true);
    view = (await req(app, 'POST', `/api/tournaments/${t.id}/next`, org, { begin: true })).json();
    expect(view.round).toBe(2);
    const incidents = (await req(app, 'GET', `/api/tournaments/${t.id}/incidents`, org)).json();
    expect(incidents.warnings.map((x: any) => x.reason)).toEqual(['De novo', 'Reincidência', 'Linguagem imprópria', 'Demora excessiva']);
    expect(incidents.warnings[0]).toMatchObject({ name: 'Luffy', byName: 'Robin' });
    void who;
  });

  it('início automático (opção): na hora marcada o torneio começa e a rodada 1 já sai iniciada', async () => {
    let now = Date.parse('2026-10-10T19:50:00Z');
    const { db, app } = setup(() => now);
    const startsAt = '2026-10-10T20:00:00.000Z';
    const { t, who } = await arena(app, db, { startsAt, checkIn: true, autoStart: true });
    expect(t.autoStart).toBe(true);
    now = Date.parse('2026-10-10T20:00:00Z');
    expect(tick(app)!.started).toEqual([t.id]);
    const view = (await req(app, 'GET', `/api/tournaments/${t.id}`)).json();
    expect(view).toMatchObject({ status: 'running', roundStartedAt: startsAt, deadline: '2026-10-10T20:05:00.000Z' });
    const m = view.rounds[0].matches[0];
    expect((await play(app, t.id, who(m.p1.userId), m)).statusCode).toBe(200);
  });
});
