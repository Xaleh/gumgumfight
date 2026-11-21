// Selado (Pré-release) no servidor: coleções disponíveis, abertura dos boosters, o deck de 40
// conferido contra o que saiu, e as partidas com ele (bot e sala privada).

import { autoBuildLimited, type CardData, LIMITED_DECK_SIZE, poolCounts, SEALED_LEADER_ID } from '@gumgum/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, upsertGoogleUser } from '../src/auth/store';
import { type DB, getCards, getDeck, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { forgetSealedSets, getPool, SEALED_MAX_POOLS } from '../src/sealed/store';
import { seed } from '../src/seed';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true, onlineBotRooms: true }, onlineRateLimit: 1e9, botDelayMs: 0 }) };
}
type App = ReturnType<typeof buildApp>;
type Headers = Record<string, string>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: Headers, payload?: unknown) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
function login(db: DB, name: string) {
  const user = upsertGoogleUser(db, { sub: `sub-${name}`, email: `${name}@example.com`, emailVerified: true, name, picture: null });
  return { cookie: `gg_session=${createSession(db, user.id)}` };
}

interface Pool {
  id: string;
  set: string;
  packs: string[][];
  packSets: string[];
  leader: string | null;
  deck: { leader: string; cards: Array<{ id: string; count: number }> } | null;
  size: number;
  ready: boolean;
  wins: number;
  losses: number;
  issues: Array<{ level: string; code: string }>;
}

/** Abre os boosters e salva o deck do "Montar sozinho" (o mesmo cálculo da tela). */
async function readyPool(app: App, db: DB, headers: Headers, set: string | string[] = 'OP01', leader?: string): Promise<Pool> {
  const opened = (await call(app, 'POST', '/api/sealed/pools', headers, Array.isArray(set) ? { sets: set } : { set })).json() as Pool;
  const pool = poolCounts(opened.packs);
  const catalog = new Map((getCards(db, [...pool.keys(), SEALED_LEADER_ID, ...(leader ? [leader] : [])]) as CardData[]).map((c) => [c.id, c]));
  const saved = await call(app, 'PUT', `/api/sealed/pools/${opened.id}/deck`, headers, autoBuildLimited(pool, catalog, leader));
  expect(saved.statusCode).toBe(200);
  return saved.json() as Pool;
}

beforeEach(() => forgetSealedSets());

describe('Selado: coleções e abertura', () => {
  it('só entram coleções de booster completas no banco; starters e o Líder de 6 cores ficam de fora', async () => {
    const { app } = setup();
    const r = (await app.inject('/api/sealed/sets')).json();
    expect(r).toMatchObject({ packs: 6, deckSize: 40 });
    const sets = r.sets.map((s: { set: string }) => s.set);
    expect(sets).toContain('OP01');
    expect(sets).toContain('OP02');
    expect(sets.some((s: string) => s.startsWith('ST') || s === 'SEALED' || s === 'P')).toBe(false);
    const op01 = r.sets.find((s: { set: string }) => s.set === 'OP01');
    expect(op01.cards).toBeGreaterThan(100);
    expect(op01.leaders).toBeGreaterThan(0);
    expect(op01.automated).toBeGreaterThan(0.7);
    // O booster de cada coleção vai junto: a OP01 é das primeiras (8 comuns, 3 incomuns e uma vaga de destaque).
    expect(op01.pack).toMatchObject({ commons: 8, uncommons: 3, rares: 0 });
    expect(op01.pack.sr).toBeCloseTo(7.3 / 24, 2);
    expect(op01.pack.sec).toBeCloseTo(0.55 / 24, 2);
    expect(op01.pack.leader).toBeCloseTo(1 / 3, 2);
  });

  it('abre 6 boosters de 12 cartas da coleção e guarda para o dono', async () => {
    const { app } = setup();
    const res = await call(app, 'POST', '/api/sealed/pools', ALICE, { set: 'op01' });
    expect(res.statusCode).toBe(201);
    const pool = res.json() as Pool;
    expect(pool).toMatchObject({ set: 'OP01', deck: null, size: 0, ready: false, wins: 0, losses: 0 });
    expect(pool.packs).toHaveLength(6);
    expect(pool.packs.every((p) => p.length === 12 && p.every((id) => id.startsWith('OP01-')))).toBe(true);
    // Recarregar não muda o que saiu.
    expect((await call(app, 'GET', `/api/sealed/pools/${pool.id}`, ALICE)).json().packs).toEqual(pool.packs);
    expect((await call(app, 'GET', '/api/sealed/pools', ALICE)).json()).toMatchObject([{ id: pool.id, set: 'OP01', ready: false }]);
    // Outra pessoa não vê nem a lista nem os boosters.
    expect((await call(app, 'GET', '/api/sealed/pools', BOB)).json()).toEqual([]);
    expect((await call(app, 'GET', `/api/sealed/pools/${pool.id}`, BOB)).statusCode).toBe(404);
    // Cada abertura é um sorteio novo.
    const again = (await call(app, 'POST', '/api/sealed/pools', ALICE, { set: 'OP01' })).json() as Pool;
    expect(again.packs).not.toEqual(pool.packs);
  });

  it('recusa coleção que não é do Selado e pedido sem dono; guarda no máximo as 12 mais recentes', async () => {
    const { app } = setup();
    for (const set of ['ST01', 'OP99', 'SEALED', '']) {
      const r = await call(app, 'POST', '/api/sealed/pools', ALICE, { set });
      expect(r.statusCode).toBe(400);
      expect(r.json().errorCode).toBe('sealedSetUnavailable');
    }
    expect((await call(app, 'POST', '/api/sealed/pools', {}, { set: 'OP01' })).json().errorCode).toBe('noOwner');
    const ids: string[] = [];
    for (let i = 0; i < SEALED_MAX_POOLS + 2; i++) ids.push(((await call(app, 'POST', '/api/sealed/pools', ALICE, { set: 'OP01' })).json() as Pool).id);
    const mine = (await call(app, 'GET', '/api/sealed/pools', ALICE)).json() as Pool[];
    expect(mine).toHaveLength(SEALED_MAX_POOLS);
    expect(mine.map((p) => p.id)).not.toContain(ids[0]);
    await call(app, 'DELETE', `/api/sealed/pools/${ids.at(-1)}`, ALICE);
    expect((await call(app, 'GET', '/api/sealed/pools', ALICE)).json()).toHaveLength(SEALED_MAX_POOLS - 1);
  });
});

describe('Selado: o deck', () => {
  it('salva o deck em montagem; fica pronto com 40 cartas e Líder', async () => {
    const { app, db } = setup();
    const opened = (await call(app, 'POST', '/api/sealed/pools', ALICE, { set: 'OP01' })).json() as Pool;
    const some = [...poolCounts(opened.packs)].filter(([id]) => !getCards(db, [id])[0].category.startsWith('leader')).slice(0, 5);
    const draft = await call(app, 'PUT', `/api/sealed/pools/${opened.id}/deck`, ALICE, { leader: '', cards: some.map(([id, count]) => ({ id, count })) });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ ready: false });
    expect(draft.json().issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['rules.pickLeader', 'rules.tooFewCards']));

    const done = await readyPool(app, db, BOB);
    expect(done).toMatchObject({ ready: true, size: LIMITED_DECK_SIZE });
    expect(done.issues.filter((i) => i.level === 'error')).toEqual([]);
    // O Líder de 6 cores vale sempre, tenha saído Líder ou não.
    const rainbow = await readyPool(app, db, { 'x-deck-owner': 'carol-0123456789abcdef' }, 'OP02', SEALED_LEADER_ID);
    expect(rainbow).toMatchObject({ ready: true, leader: SEALED_LEADER_ID });
  });

  it('recusa carta que não saiu, cópias a mais e Líder que não saiu', async () => {
    const { app, db } = setup();
    const pool = await readyPool(app, db, ALICE);
    const put = (deck: unknown) => call(app, 'PUT', `/api/sealed/pools/${pool.id}/deck`, ALICE, deck);
    const [first, ...rest] = pool.deck!.cards;
    const outside = await put({ leader: pool.deck!.leader, cards: [{ id: 'OP02-004', count: first.count }, ...rest] });
    expect(outside.statusCode).toBe(400);
    expect(outside.json()).toMatchObject({ errorCode: 'sealedDeckNotFromPool', errorParams: { issueCode: 'rules.notInPool' } });
    const have = poolCounts(pool.packs).get(first.id)!;
    const copies = await put({ leader: pool.deck!.leader, cards: [{ id: first.id, count: have + 1 }, ...rest] });
    expect(copies.json().errorParams.issueCode).toBe('rules.poolCopies');
    const leader = await put({ leader: 'ST01-001', cards: pool.deck!.cards });
    expect(leader.json().errorParams.issueCode).toBe('rules.leaderNotInPool');
    expect((await put({ leader: 5 })).json().errorCode).toBe('sealedDeckInvalid');
    // O deck salvo antes continua o mesmo.
    expect(getPool(db, pool.id)!.deck).toEqual(pool.deck);
    // Ninguém salva no deck dos outros.
    expect((await call(app, 'PUT', `/api/sealed/pools/${pool.id}/deck`, BOB, pool.deck)).statusCode).toBe(404);
  });

  it('o deck do bot: ele abre os próprios boosters da mesma coleção e fecha 40', async () => {
    const { app, db } = setup();
    const pool = await readyPool(app, db, ALICE, 'OP02');
    const bot = (await call(app, 'POST', `/api/sealed/pools/${pool.id}/bot`, ALICE)).json();
    expect(bot.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(40);
    expect(bot.cards.every((c: { id: string }) => c.id.startsWith('OP02-'))).toBe(true);
    expect((await call(app, 'POST', `/api/sealed/pools/${pool.id}/bot`, BOB)).statusCode).toBe(404);
  });
});

describe('Selado: partidas', () => {
  const lobbyOf = (app: App) => (app as unknown as { onlineLobby: Lobby }).onlineLobby;

  it('sala privada: os dois jogam com o deck da própria coleção, da mesma coleção', async () => {
    const { app, db } = setup();
    const a = await readyPool(app, db, ALICE);
    const b = await readyPool(app, db, BOB);
    const created = await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: a.id, format: 'sealed' });
    expect(created.statusCode).toBe(201);
    const { code, roomId } = created.json();
    expect(lobbyOf(app).get(roomId)!.data).toMatchObject({ format: 'sealed', sealedSet: 'OP01', queue: 'private' });

    // Deck construído, deck de outra coleção, deck dos outros e deck incompleto não entram.
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: 'st02-kid' })).json()).toMatchObject({ errorCode: 'sealedRoomNeedsDeck', errorParams: { set: 'OP01' } });
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: a.id })).json().errorCode).toBe('sealedRoomNeedsDeck');
    const op02 = await readyPool(app, db, BOB, 'OP02');
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: op02.id })).json()).toMatchObject({ errorCode: 'sealedSetMismatch', errorParams: { set: 'OP01' } });
    const unfinished = (await call(app, 'POST', '/api/sealed/pools', BOB, { set: 'OP01' })).json() as Pool;
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: unfinished.id })).json().errorCode).toBe('sealedDeckIncomplete');

    const joined = await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: b.id });
    expect(joined.statusCode).toBe(200);
    const room = lobbyOf(app).get(roomId)!;
    expect(room.data.seats.map((s) => s.deckId)).toEqual([`sealed:${a.id}`, `sealed:${b.id}`]);
    expect(room.data.seats.map((s) => s.deck.cards.reduce((n, c) => n + c.count, 0))).toEqual([40, 40]);
    expect(room.state?.players.map((p) => p.deck.length + p.hand.length + p.life.length)).toEqual([40, 40]);
    // Quem assiste e quem joga veem que é Selado, e de qual coleção.
    expect(lobbyOf(app).summary(room)).toMatchObject({ format: 'sealed', sealedSet: 'OP01' });
  });

  it('o resultado da sala privada entra no placar de cada deck e fica fora das estatísticas', async () => {
    const { app, db } = setup();
    const a = await readyPool(app, db, ALICE);
    const b = await readyPool(app, db, BOB);
    const { code, roomId, token } = (await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: a.id, format: 'sealed' })).json();
    await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: b.id });
    const room = lobbyOf(app).get(roomId)!;
    // Alice desiste: Bob vence.
    const res = await call(app, 'POST', `/api/online/rooms/${roomId}/action`, ALICE, { t: token, seq: 0, action: { type: 'concede', player: 0 } });
    expect(res.statusCode).toBe(200);
    expect(room.status).toBe('finished');
    expect(getPool(db, a.id)).toMatchObject({ wins: 0, losses: 1 });
    expect(getPool(db, b.id)).toMatchObject({ wins: 1, losses: 0 });
    const row = db.prepare('SELECT m.format AS format, s.listed AS listed FROM matches m JOIN match_seats s ON s.match_id = m.id ORDER BY m.id DESC LIMIT 1').get() as { format: string; listed: number };
    expect(row).toMatchObject({ format: 'sealed', listed: 0 });
  });

  it('treino contra o bot no servidor: o bot joga com um deck de 40 da mesma coleção, sem contar no placar', async () => {
    const { app, db } = setup();
    const headers = { ...ALICE, ...login(db, 'alice') };
    const pool = await readyPool(app, db, headers, 'OP02');
    const res = await call(app, 'POST', '/api/online/bot', headers, { deckId: pool.id, format: 'sealed' });
    expect(res.statusCode).toBe(201);
    const room = lobbyOf(app).get(res.json().roomId)!;
    expect(room.data).toMatchObject({ format: 'sealed', sealedSet: 'OP02', queue: 'bot' });
    const bot = room.data.seats[1];
    expect(bot.bot).toBe(true);
    expect(bot.deck.cards.reduce((n, c) => n + c.count, 0)).toBe(40);
    expect(bot.deck.cards.every((c) => c.id.startsWith('OP02-'))).toBe(true);
  });

  it('o Selado não entra nas filas nem troca de formato numa sala de deck construído', async () => {
    const { app, db } = setup();
    const pool = await readyPool(app, db, ALICE);
    // A fila só conhece os formatos de deck construído: cai no Standard e o id não é um deck.
    const queue = await call(app, 'POST', '/api/online/queue', ALICE, { deckId: pool.id, queue: 'casual', format: 'sealed' });
    expect(queue.statusCode).toBe(400);
    // Sala de EGB: o deck selado não entra.
    const { code } = (await call(app, 'POST', '/api/online/rooms', BOB, { deckId: 'st01-luffy', format: 'egb' })).json();
    expect((await call(app, 'POST', '/api/online/rooms/join', ALICE, { code, deckId: pool.id })).statusCode).toBe(400);
  });

  it('o Líder de 6 cores não entra num deck construído (só no Livre)', async () => {
    const { app, db } = setup();
    const cards = getDeck(db, 'st01-luffy')!.cards;
    const made = await call(app, 'POST', '/api/decks', ALICE, { name: 'Arco-íris', leader: SEALED_LEADER_ID, cards });
    expect(made.statusCode).toBe(201);
    const deck = made.json();
    expect(deck.formatCodes.egb.map((c: { code: string }) => c.code)).toContain('rules.eventOnly');
    expect(deck.formatCodes.allblue.map((c: { code: string }) => c.code)).toContain('rules.eventOnly');
    expect((await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: deck.id, format: 'egb' })).json().errorCode).toBe('deckNotAllowedInFormat');
    expect((await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: deck.id, format: 'free' })).statusCode).toBe(201);
  });
});

describe('Pack Rush: Selado com várias coleções', () => {
  const lobbyOf = (app: App) => (app as unknown as { onlineLobby: Lobby }).onlineLobby;
  const CAROL = { 'x-deck-owner': 'carol-0123456789abcdef' };

  it('abre 6 boosters sorteados entre as coleções escolhidas e diz de qual é cada um', async () => {
    const { app } = setup();
    expect((await app.inject('/api/sealed/sets')).json().rush).toEqual({ min: 2, max: 12 });
    const res = await call(app, 'POST', '/api/sealed/pools', ALICE, { sets: ['op02', 'OP01'] });
    expect(res.statusCode).toBe(201);
    const pool = res.json() as Pool;
    // A chave não depende da ordem em que as coleções foram escolhidas.
    expect(pool.set).toBe('OP01+OP02');
    expect(pool.packs).toHaveLength(6);
    expect(pool.packSets).toHaveLength(6);
    pool.packs.forEach((pack, i) => {
      expect(['OP01', 'OP02']).toContain(pool.packSets[i]);
      expect(pack).toHaveLength(12);
      expect(pack.every((id) => id.startsWith(`${pool.packSets[i]}-`))).toBe(true);
    });
    expect((await call(app, 'GET', `/api/sealed/pools/${pool.id}`, ALICE)).json()).toMatchObject({ set: 'OP01+OP02', packSets: pool.packSets });
    // O Selado de uma coleção continua dizendo a coleção de cada booster (todas iguais).
    const single = (await call(app, 'POST', '/api/sealed/pools', ALICE, { set: 'OP01' })).json() as Pool;
    expect(single.packSets).toEqual(Array(6).fill('OP01'));
  });

  it('precisa de 2 a 12 coleções, todas disponíveis no Selado', async () => {
    const { app } = setup();
    const post = (sets: unknown) => call(app, 'POST', '/api/sealed/pools', ALICE, { sets });
    expect((await post(['OP01'])).json()).toMatchObject({ errorCode: 'sealedRushFewSets', errorParams: { n: 2 } });
    expect((await post(['OP01', 'op01'])).json().errorCode).toBe('sealedRushFewSets');
    expect((await post([])).json().errorCode).toBe('sealedRushFewSets');
    expect((await post(['OP01', 'ST01'])).json()).toMatchObject({ errorCode: 'sealedSetUnavailable' });
    expect((await post(Array.from({ length: 13 }, (_, i) => `OP${String(i + 1).padStart(2, '0')}`))).json().errorCode).toBe('sealedRushManySets');
  });

  it('vale qualquer Líder do jogo; no Selado de uma coleção, não', async () => {
    const { app, db } = setup();
    // Law ST10-001: Líder de starter (fora dos boosters) e banido nos formatos oficiais.
    const rush = await readyPool(app, db, ALICE, ['OP01', 'OP02'], 'ST10-001');
    expect(rush).toMatchObject({ ready: true, leader: 'ST10-001', size: 40 });
    const single = (await call(app, 'POST', '/api/sealed/pools', BOB, { set: 'OP01' })).json() as Pool;
    const cards = autoBuildLimited(poolCounts(single.packs), new Map((getCards(db, [...new Set(single.packs.flat()), SEALED_LEADER_ID]) as CardData[]).map((c) => [c.id, c]))).cards;
    const refused = await call(app, 'PUT', `/api/sealed/pools/${single.id}/deck`, BOB, { leader: 'ST10-001', cards });
    expect(refused.json().errorParams.issueCode).toBe('rules.leaderNotInPool');
    // Mesmo no Pack Rush, as cartas do deck só saem dos boosters.
    const [first, ...rest] = rush.deck!.cards;
    const outside = await call(app, 'PUT', `/api/sealed/pools/${rush.id}/deck`, ALICE, { leader: 'ST10-001', cards: [{ id: 'ST01-002', count: first.count }, ...rest] });
    expect(outside.json().errorParams.issueCode).toBe('rules.notInPool');
  });

  it('sala privada: os dois precisam ter aberto as mesmas coleções', async () => {
    const { app, db } = setup();
    const a = await readyPool(app, db, ALICE, ['OP01', 'OP02']);
    const created = await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: a.id, format: 'sealed' });
    expect(created.statusCode).toBe(201);
    const { code, roomId } = created.json();
    expect(lobbyOf(app).get(roomId)!.data).toMatchObject({ format: 'sealed', sealedSet: 'OP01+OP02' });
    // Deck de uma coleção só não entra, mesmo sendo uma das duas.
    const single = await readyPool(app, db, BOB, 'OP01');
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: single.id })).json()).toMatchObject({
      errorCode: 'sealedSetMismatch',
      errorParams: { set: 'OP01 + OP02' },
    });
    // Mesmas coleções, escolhidas em outra ordem: entra.
    const b = await readyPool(app, db, BOB, ['OP02', 'OP01']);
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: b.id })).statusCode).toBe(200);
    const room = lobbyOf(app).get(roomId)!;
    expect(room.data.seats.map((s) => s.deck.name)).toEqual(['Pack Rush OP01 + OP02', 'Pack Rush OP01 + OP02']);
    expect(lobbyOf(app).summary(room)).toMatchObject({ format: 'sealed', sealedSet: 'OP01+OP02' });
  });

  it('o bot abre os próprios boosters entre as mesmas coleções', async () => {
    const { app, db } = setup();
    const pool = await readyPool(app, db, CAROL, ['OP01', 'OP02']);
    const sets = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const bot = (await call(app, 'POST', `/api/sealed/pools/${pool.id}/bot`, CAROL)).json();
      expect(bot.name).toBe('Pack Rush OP01 + OP02');
      expect(bot.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(40);
      for (const c of bot.cards as Array<{ id: string }>) sets.add(c.id.split('-')[0]);
    }
    expect([...sets].sort()).toEqual(['OP01', 'OP02']);
  });
});
