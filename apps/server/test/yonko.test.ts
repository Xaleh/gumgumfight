// Mesas online do Yonko (yonko/): sala com código, bots, regras, começar, a visão de cada lugar, relógio,
// abandono, reinício do servidor e saída.

import {
  type Action,
  actingPlayer,
  type CardDef,
  chooseSimpleBotAction,
  type GameState,
  HIDDEN_CARD,
  type LogEntry,
  validateYonkoDeck,
  YONKO_DECK_SIZE,
} from '@gumgum/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { type DB, getDeck, listCards, openDb, upsertDeck } from '../src/db';
import { seed } from '../src/seed';
import { YONKO_ABANDON_MS, YONKO_TIME_BANK_MS, type YonkoConnection, type YonkoTable } from '../src/yonko/table';
import type { YonkoTables } from '../src/yonko/routes';

const OWNERS = ['alice', 'bob', 'carol', 'dave'].map((n) => ({ 'x-deck-owner': `${n}-0123456789abcdef`.padEnd(22, '0') }));
const [ALICE, BOB, CAROL] = OWNERS;

type App = ReturnType<typeof buildApp>;

function freshDb() {
  const db = openDb(':memory:');
  seed(db);
  return db;
}

function setup(db: DB = freshDb(), now?: () => number) {
  return { db, app: buildApp(db, { server: { cardImages: false }, onlineRateLimit: 1e9, botDelayMs: 0, ...(now ? { now } : {}) }) };
}

const tablesOf = (app: App) => (app as unknown as { yonkoTables: YonkoTables }).yonkoTables;
const tableOf = (app: App, id: string) => tablesOf(app).get(id)!;

/** Canal de teste: guarda a sala e a mesa como o navegador montaria (definições e registro acumulados). */
function client(token: string) {
  const events: Array<{ event: string; data: any }> = [];
  let defs: Record<string, CardDef> = {};
  let log: LogEntry[] = [];
  let latest: any = null;
  const conn: YonkoConnection = {
    token,
    sentDefs: new Set(),
    sentLog: 0,
    send: (event, data: any) => {
      events.push({ event, data });
      if (event !== 'state') return;
      defs = { ...defs, ...data.defs };
      log = [...log.slice(0, data.log.from), ...data.log.entries];
      latest = data;
    },
  };
  return {
    conn,
    events,
    get room() {
      return latest?.room;
    },
    get view(): GameState | null {
      return latest?.view ? { ...latest.view, defs, log } : null;
    },
  };
}

async function post(app: App, url: string, payload: unknown, headers = ALICE) {
  return app.inject({ method: 'POST', url, payload: payload as object, headers });
}

/** Alice cria a mesa e Bob entra; os dois com decks prontos de 50 (viram decks de teste de 60). */
async function openTable(app: App) {
  const created = await post(app, '/api/yonko/tables', { deckId: 'st01-luffy' });
  expect(created.statusCode).toBe(201);
  const { id, code, token: alice } = created.json();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  const joined = await post(app, '/api/yonko/tables/join', { code: code.toLowerCase(), deckId: 'st02-kid' }, BOB);
  expect(joined.statusCode).toBe(200);
  expect(joined.json().id).toBe(id);
  return { id, code, alice, bob: joined.json().token as string };
}

const wait = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('Yonko online: sala de espera', () => {
  it('código, lugares, deck de teste, bots, pronto e só quem criou começa', async () => {
    const { app } = setup();
    const { id, alice, bob } = await openTable(app);
    const table = tableOf(app, id);
    const a = client(alice);
    const b = client(bob);
    table.attach(a.conn);
    table.attach(b.conn);
    expect(a.room).toMatchObject({ status: 'waiting', host: 0, you: 0, rules: { extraLife: 2, curveChoice: true } });
    expect(b.room.you).toBe(1);
    expect(a.room.seats[0]).toMatchObject({ name: expect.any(String), bot: false, ready: true, connected: true, leader: 'ST01-001', test: true, you: true });
    expect(a.room.seats[1]).toMatchObject({ bot: false, ready: false, leader: 'ST02-001', test: true });
    expect(a.room.seats.slice(2)).toEqual([null, null]);
    expect(a.room.problem).toMatchObject({ code: 'yonkoTooFew' });
    expect(a.view).toBeNull();

    // O deck de teste fecha as regras do Yonko.
    expect(validateYonkoDeck(table.data.seats[0]!.deck, new Map(listCards(tableDb(app)).map((c) => [c.id, c as never]))).valid).toBe(true);

    // Só quem criou mexe nos bots e nas regras, e começa.
    expect((await post(app, `/api/yonko/tables/${id}/bot`, { t: bob }, BOB)).statusCode).toBe(403);
    expect((await post(app, `/api/yonko/tables/${id}/bot`, { t: alice })).statusCode).toBe(200);
    expect(a.room.seats[2]).toMatchObject({ bot: true, ready: true, name: 'Bot 1' });
    expect((await post(app, `/api/yonko/tables/${id}/rules`, { t: alice, rules: { extraLife: 9, curveChoice: false, eliminationDraw: 1 } })).statusCode).toBe(200);
    expect(b.room.rules).toEqual({ extraLife: 4, eliminationDraw: 1 });

    // Bob ainda não está pronto.
    const early = await post(app, `/api/yonko/tables/${id}/start`, { t: alice });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ errorCode: 'yonkoNotReady' });
    expect((await post(app, `/api/yonko/tables/${id}/ready`, { t: bob, ready: true }, BOB)).statusCode).toBe(200);
    expect((await post(app, `/api/yonko/tables/${id}/start`, { t: bob }, BOB)).statusCode).toBe(403);
    expect((await post(app, `/api/yonko/tables/${id}/start`, { t: alice })).statusCode).toBe(200);
    expect(a.room.status).toBe('playing');
    expect(a.room.players.map((p: { seat: number }) => p.seat)).toEqual([0, 1, 2]);
    expect(a.view!.players).toHaveLength(3);
    expect(a.view!.table).toEqual({ extraLife: 4, eliminationDraw: 1 });
    // Mesa começada: ninguém mais entra.
    const late = await post(app, '/api/yonko/tables/join', { code: table.data.code, deckId: 'st03-crocodile' }, CAROL);
    expect(late.statusCode).toBe(409);
  });

  it('deck de 60 vai como está; deck incompleto é recusado', async () => {
    const { app, db } = setup();
    const cards = listCards(db).filter((c) => c.category !== 'leader' && c.colors.includes('red'));
    upsertDeck(db, { id: 'y60', name: 'Sessenta', leader: 'ST01-001', cards: cards.slice(0, YONKO_DECK_SIZE).map((c) => ({ id: c.id, count: 1 })) }, 'user', 'x');
    upsertDeck(db, { id: 'half', name: 'Metade', leader: 'ST01-001', cards: [{ id: cards[0].id, count: 4 }] }, 'user', 'x');
    const made = await post(app, '/api/yonko/tables', { deckId: 'y60' });
    expect(made.statusCode).toBe(201);
    const table = tableOf(app, made.json().id);
    expect(table.data.seats[0]).toMatchObject({ test: false, deckName: 'Sessenta' });
    expect(table.data.seats[0]!.deck.cards).toEqual(getDeck(db, 'y60')!.cards);
    const bad = await post(app, '/api/yonko/tables/join', { code: made.json().code, deckId: 'half' }, BOB);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ errorCode: 'yonkoDeckInvalid' });
    expect((await post(app, '/api/yonko/tables/join', { code: 'ZZZZZZ', deckId: 'st02-kid' }, BOB)).statusCode).toBe(404);
  });

  it('o resumo do deck diz se ele serve para o Yonko, e o rascunho de 60+ pode ser salvo', async () => {
    const { app, db } = setup();
    const ids = listCards(db)
      .filter((c) => c.category !== 'leader' && c.colors.includes('red'))
      .map((c) => c.id);
    const save = (cards: string[]) =>
      app.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Y', leader: 'ST01-001', cards: cards.map((id) => ({ id, count: 1 })) } });
    const ready = await save(ids.slice(0, YONKO_DECK_SIZE));
    expect(ready.statusCode).toBe(201);
    expect(ready.json()).toMatchObject({ valid: false, size: 60, yonko: [], yonkoCodes: [] });
    const over = await save(ids.slice(0, 64));
    expect(over.statusCode).toBe(201);
    expect(over.json().yonkoCodes).toContainEqual({ code: 'rules.tooManyCards', params: { total: 64, extra: 4 } });
    const fifty = (await app.inject({ method: 'GET', url: '/api/decks/st01-luffy' })).json().summary;
    expect(fifty.valid).toBe(true);
    expect(fifty.yonkoCodes[0]).toMatchObject({ code: 'rules.tooFewCards' });
  });

  it('quem sai libera o lugar; quem criou passa a mesa; sem ninguém ela fecha', async () => {
    const { app } = setup();
    const { id, alice, bob } = await openTable(app);
    expect((await post(app, `/api/yonko/tables/${id}/leave`, { t: alice })).statusCode).toBe(200);
    const table = tableOf(app, id);
    expect(table.data.host).toBe(1);
    expect(table.data.seats[0]).toBeNull();
    // Entrar de novo pelo código volta para um lugar livre; voltar com o mesmo navegador não ocupa dois lugares.
    const back = await post(app, '/api/yonko/tables/join', { code: table.data.code, deckId: 'st01-luffy' });
    const again = await post(app, '/api/yonko/tables/join', { code: table.data.code, deckId: 'st01-luffy' });
    expect(again.json().token).toBe(back.json().token);
    expect(table.data.seats.filter(Boolean)).toHaveLength(2);
    // Quem criou tira alguém da mesa.
    expect((await post(app, `/api/yonko/tables/${id}/clear`, { t: bob, seat: 0 }, BOB)).statusCode).toBe(200);
    expect(table.data.seats.filter(Boolean)).toHaveLength(1);
    expect((await post(app, `/api/yonko/tables/${id}/leave`, { t: bob }, BOB)).statusCode).toBe(200);
    expect(tablesOf(app).get(id)).toBeNull();
  });

  it('cada pessoa espera numa mesa por vez, e `/active` devolve as mesas com o token', async () => {
    const { app } = setup();
    const first = (await post(app, '/api/yonko/tables', { deckId: 'st01-luffy' })).json();
    const second = (await post(app, '/api/yonko/tables', { deckId: 'st01-luffy' })).json();
    // Criar outra mesa tira Alice da primeira (que, vazia, fecha).
    expect(tablesOf(app).get(first.id)).toBeNull();
    const active = (await app.inject({ method: 'GET', url: '/api/yonko/active', headers: ALICE })).json();
    expect(active).toEqual([{ id: second.id, code: second.code, status: 'waiting', token: second.token }]);
    expect((await app.inject({ method: 'GET', url: '/api/yonko/active', headers: BOB })).json()).toEqual([]);
  });
});

describe('Yonko online: partida', () => {
  /** Mesa de 4 (Alice, Bob e dois bots) já começada. */
  async function running(app: App) {
    const t = await openTable(app);
    await post(app, `/api/yonko/tables/${t.id}/bot`, { t: t.alice });
    await post(app, `/api/yonko/tables/${t.id}/bot`, { t: t.alice });
    await post(app, `/api/yonko/tables/${t.id}/ready`, { t: t.bob, ready: true }, BOB);
    expect((await post(app, `/api/yonko/tables/${t.id}/start`, { t: t.alice })).statusCode).toBe(200);
    return t;
  }

  /** Joga pela pessoa do `token` com o bot simples, sobre a visão que o canal recebeu. */
  async function playFor(app: App, id: string, token: string, c: ReturnType<typeof client>, headers: object) {
    const v = c.view!;
    const me = c.room.player;
    const action: Action = chooseSimpleBotAction(v, me);
    return post(app, `/api/yonko/tables/${id}/action`, { t: token, seq: v.actionCount, action }, headers as typeof ALICE);
  }

  it('cada lugar vê só a própria mão; a partida vai até o fim com pessoas e bots', async () => {
    const { app } = setup();
    const { id, alice, bob } = await running(app);
    const table = tableOf(app, id);
    const a = client(alice);
    const b = client(bob);
    table.attach(a.conn);
    table.attach(b.conn);
    expect(a.room.player).toBe(0);
    expect(b.room.player).toBe(1);

    let guard = 0;
    while (table.state!.phase !== 'gameover' && guard++ < 6000) {
      const p = actingPlayer(table.state!);
      if (p === 0 || p === 1) {
        const c = p === 0 ? a : b;
        // Na vez de cada pessoa, a mão dela aparece e a dos outros três não.
        const v = c.view!;
        if (v.phase === 'main') {
          expect(v.players[p].hand.every((u) => v.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
          // (Uma carta revelada por efeito fica à vista enquanto estiver na mão: `knownHand`.)
          const known = new Set(table.state!.knownHand ?? []);
          for (const o of [0, 1, 2, 3].filter((x) => x !== p)) {
            const leaked = v.players[o].hand.filter((u) => v.cards[u].cardId !== HIDDEN_CARD);
            const real = table.state!.players[o].hand;
            expect(leaked.length, `mão do lugar ${o} visível para ${p}: ${leaked.join(',')} | conhecidas ${[...known].length} | ${real.length}`).toBeLessThanOrEqual(real.filter((u) => known.has(u)).length);
          }
        }
        const r = await playFor(app, id, p === 0 ? alice : bob, c, p === 0 ? ALICE : BOB);
        expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      } else await wait();
    }
    expect(table.state!.phase).toBe('gameover');
    expect(a.room.status).toBe('finished');
    // No fim, cada um vê o registro inteiro, com a mesma última linha.
    expect(a.view!.log.at(-1)?.key).toMatch(/^log\.gameOver/);
    expect(b.view!.log.at(-1)?.key).toBe(a.view!.log.at(-1)?.key);

    // Jogar de novo: a mesa volta para a espera com os mesmos lugares.
    expect((await post(app, `/api/yonko/tables/${id}/reopen`, { t: bob }, BOB)).statusCode).toBe(403);
    expect((await post(app, `/api/yonko/tables/${id}/reopen`, { t: alice })).statusCode).toBe(200);
    expect(a.room).toMatchObject({ status: 'waiting', players: null });
    expect(a.room.seats.filter(Boolean)).toHaveLength(4);
    expect(a.view).toBeNull();
  }, 120_000);

  it('ação de outro lugar, versão velha e token errado são recusados', async () => {
    const { app } = setup();
    const { id, alice, bob } = await running(app);
    const table = tableOf(app, id);
    while (table.state!.pending && table.data.players![actingPlayer(table.state!)!].bot) await wait();
    const p = actingPlayer(table.state!)!;
    const [mine, other] = p === 0 ? [alice, bob] : [bob, alice];
    const n = table.state!.actionCount;
    const url = `/api/yonko/tables/${id}/action`;
    expect((await post(app, url, { t: other, seq: n, action: { type: 'endTurn', player: p } })).statusCode).toBe(400);
    expect((await post(app, url, { t: mine, seq: n + 5, action: { type: 'endTurn', player: p } })).statusCode).toBe(409);
    expect((await post(app, url, { t: 'x', seq: n, action: { type: 'endTurn', player: p } })).statusCode).toBe(404);
    expect((await post(app, url, { t: mine, seq: n, action: { type: 'timeout', player: p } })).statusCode).toBe(400);
  });

  it('desistir (sair no meio) elimina só quem saiu', async () => {
    const { app } = setup();
    const { id, bob } = await running(app);
    const table = tableOf(app, id);
    expect((await post(app, `/api/yonko/tables/${id}/leave`, { t: bob }, BOB)).statusCode).toBe(200);
    expect(table.state!.players[1].out).toBe(true);
    expect(table.state!.phase).not.toBe('gameover');
    // De novo: nada a fazer.
    expect((await post(app, `/api/yonko/tables/${id}/leave`, { t: bob }, BOB)).statusCode).toBe(200);
  });

  it('a mesa é refeita depois de reiniciar o servidor', async () => {
    const db = freshDb();
    const { app } = setup(db);
    const { id, alice } = await running(app);
    const table = tableOf(app, id);
    const before = table.state!;
    const count = before.actionCount;
    await app.close();
    const { app: again } = setup(db);
    const restored = tableOf(again, id);
    expect(restored.status).toBe('playing');
    expect(restored.state!.actionCount).toBe(count);
    expect(restored.state!.players.map((p) => p.hand)).toEqual(before.players.map((p) => p.hand));
    const a = client(alice);
    restored.attach(a.conn);
    expect(a.room.player).toBe(0);
    await again.close();
  });
});

describe('Yonko online: relógio e abandono', () => {
  /** Mesa de 3 (Alice, Bob e um bot) com o relógio do servidor nas mãos do teste. */
  async function timed() {
    const clock = { t: 1_000_000 };
    const { app } = setup(freshDb(), () => clock.t);
    const t = await openTable(app);
    await post(app, `/api/yonko/tables/${t.id}/bot`, { t: t.alice });
    await post(app, `/api/yonko/tables/${t.id}/ready`, { t: t.bob, ready: true }, BOB);
    await post(app, `/api/yonko/tables/${t.id}/start`, { t: t.alice });
    return { app, clock, table: tableOf(app, t.id), ...t };
  }

  /** Deixa os bots jogarem até a vez ser de uma pessoa. */
  async function untilHuman(table: YonkoTable) {
    for (let guard = 0; guard < 400 && table.state!.phase !== 'gameover'; guard++) {
      const p = actingPlayer(table.state!)!;
      if (!table.data.players![p].bot) return p;
      await wait();
    }
    return null;
  }

  it('o relógio só corre na decisão de quem está jogando', async () => {
    const { app, clock, table, alice, bob } = await timed();
    table.attach(client(alice).conn);
    table.attach(client(bob).conn);
    const p = (await untilHuman(table))!;
    const other = p === 0 ? 1 : 0;
    clock.t += 30_000;
    const c = table.clock();
    expect(c.running).toBe(p);
    expect(YONKO_TIME_BANK_MS - c.remaining[p]).toBe(30_000);
    expect(c.remaining[other]).toBe(YONKO_TIME_BANK_MS);
    // Com tempo, conectado: nada acontece.
    table.tick();
    expect(table.state!.players[p].out).toBeUndefined();
    // Sem tempo: sai da mesa (e a mesa segue).
    clock.t += YONKO_TIME_BANK_MS;
    table.tick();
    expect(table.state!.players[p].out).toBe(true);
    expect(table.state!.log.find((e) => e.key === 'log.eliminated' && e.player === p)?.text).toContain('sem tempo');
    await app.close();
  });

  it('quem fica sem conexão na própria decisão sai da mesa depois de 2 minutos', async () => {
    const { app, clock, table, alice, bob } = await timed();
    // Só Alice tem um navegador ligado na mesa.
    table.attach(client(alice).conn);
    for (let guard = 0; guard < 300 && !table.state!.players[1].out; guard++) {
      const p = await untilHuman(table);
      if (p === null) break;
      if (p === 0) {
        const v = table.state!;
        expect(table.act(alice, v.actionCount, chooseSimpleBotAction(v, 0)).ok).toBe(true);
        continue;
      }
      // Vez de Bob, desconectado: 1 minuto não basta; 2 minutos, sim.
      clock.t += 60_000;
      table.tick();
      expect(table.state!.players[1].out).toBeUndefined();
      // Bob volta e sai de novo: o abandono recomeça a contar.
      const b = client(bob);
      table.attach(b.conn);
      table.detach(b.conn);
      clock.t += 60_000;
      table.tick();
      expect(table.state!.players[1].out).toBeUndefined();
      clock.t += YONKO_ABANDON_MS;
      table.tick();
    }
    expect(table.state!.players[1].out).toBe(true);
    expect(table.state!.log.find((e) => e.key === 'log.eliminated' && e.player === 1)?.text).toContain('abandonou');
    await app.close();
  });
});

function tableDb(app: App): DB {
  return (app as unknown as { yonkoTables: { deps: { db: DB } } }).yonkoTables.deps.db;
}

export type { YonkoTable };
