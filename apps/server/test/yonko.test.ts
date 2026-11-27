// Mesas online do Yonko (yonko/): sala com código, bots, regras, começar, a visão de cada lugar, relógio,
// abandono, reinício do servidor e saída; e quem assiste (espectador, mesa atrasada e modo transmissão).

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
import { createSession, getUser, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { DEFAULT_SETTINGS, yonkoBroadcastView } from '../src/online/broadcast';
import { type DB, getDeck, listCards, openDb, upsertDeck } from '../src/db';
import { HANDS_DELAY_MS, MIN_HANDS_DELAY_MS } from '../src/online/room';
import { seed } from '../src/seed';
import { YONKO_ABANDON_MS, YONKO_TIME_BANK_MS, type YonkoConnection, type YonkoTable, type YonkoWatch } from '../src/yonko/table';
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
function client(token: string | null, watch?: YonkoWatch) {
  const events: Array<{ event: string; data: any }> = [];
  let defs: Record<string, CardDef> = {};
  let log: LogEntry[] = [];
  let latest: any = null;
  const conn: YonkoConnection = {
    token,
    ...(watch ? { watch } : {}),
    sentDefs: new Set(),
    sentLog: 0,
    send: (event, data: any) => {
      events.push({ event, data });
      if (event !== 'state') return;
      // Partida nova (ou outra mesa atrasada): o servidor manda tudo de novo, com o registro a partir do 0.
      if (data.log.from === 0) defs = {};
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

/** Quem assiste (sem lugar na mesa): `watch` é o que a conexão pede para ver. */
const watcher = (watch: YonkoWatch = {}) => client(null, watch);

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

  it('o Luffy de 6 cores (SEALED-001) é proibido: nem deck de 60, nem deck de teste', async () => {
    const { app, db } = setup();
    const cards = listCards(db).filter((c) => c.category !== 'leader' && !c.id.startsWith('SEALED'));
    upsertDeck(db, { id: 'rb60', name: 'Arco-íris', leader: 'SEALED-001', cards: cards.slice(0, YONKO_DECK_SIZE).map((c) => ({ id: c.id, count: 1 })) }, 'user', 'x');
    upsertDeck(db, { id: 'rb50', name: 'Arco-íris 50', leader: 'SEALED-001', cards: [...cards.slice(0, 12).map((c) => ({ id: c.id, count: 4 })), { id: cards[12].id, count: 2 }] }, 'user', 'x');
    for (const deckId of ['rb60', 'rb50']) {
      const res = await post(app, '/api/yonko/tables', { deckId });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errorCode: 'yonkoBanned' });
    }
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

describe('Yonko online: espectador e transmissão', () => {
  const login = (db: DB, sub: string, role: Role = 'player') => {
    const u = upsertGoogleUser(db, { sub, email: `${sub}@example.com`, emailVerified: true, name: sub, picture: null });
    setUserRole(db, u.id, role);
    return { cookie: `gg_session=${createSession(db, u.id)}`, id: u.id };
  };
  /** As cartas da mão do lugar `p` que esta visão mostra de frente. */
  const shown = (v: GameState, p: number) => v.players[p].hand.filter((u) => v.cards[u].cardId !== HIDDEN_CARD);

  /**
   * Mesa de 3 pessoas (Alice, Bob e Carol), sem bots, com o relógio do servidor nas mãos do teste: nada anda
   * sozinho. `options`: o que Alice, que criou a mesa, marca antes de começar.
   */
  async function three(options?: { listed?: boolean; showHands?: boolean }, db: DB = freshDb()) {
    const clock = { t: 1_000_000 };
    const { app } = setup(db, () => clock.t);
    const t = await openTable(app);
    const carol = (await post(app, '/api/yonko/tables/join', { code: t.code, deckId: 'st03-crocodile' }, CAROL)).json().token as string;
    if (options) expect((await post(app, `/api/yonko/tables/${t.id}/options`, { t: t.alice, ...options })).statusCode).toBe(200);
    await post(app, `/api/yonko/tables/${t.id}/ready`, { t: t.bob, ready: true }, BOB);
    await post(app, `/api/yonko/tables/${t.id}/ready`, { t: carol, ready: true }, CAROL);
    expect((await post(app, `/api/yonko/tables/${t.id}/start`, { t: t.alice })).statusCode).toBe(200);
    const table = tableOf(app, t.id);
    const tokens = [t.alice, t.bob, carol];
    const seats = tokens.map((token) => client(token));
    for (const c of seats) table.attach(c.conn);
    /** Quem a mesa espera faz uma jogada (a do bot simples, sobre a visão do lugar dele). */
    const play = () => {
      const p = actingPlayer(table.state!)!;
      const v = seats[p].view!;
      const r = table.act(tokens[p], v.actionCount, chooseSimpleBotAction(v, p));
      expect(r.ok, JSON.stringify(r)).toBe(true);
    };
    /** O tempo passa (o relógio do servidor e os temporizadores juntos). */
    const step = (ms: number) => {
      clock.t += ms;
      vi.advanceTimersByTime(ms);
    };
    return { app, db, clock, table, tokens, seats, play, step, ...t, carol };
  }

  it('quem assiste vê a mesa sem a mão de ninguém, e a mesa sabe quantos assistem', async () => {
    const { app, table, seats, play, code } = await three();
    const w = watcher();
    table.attach(w.conn);
    // O resumo de quem assiste: sem lugar, sem o código da mesa e sem o nome dos decks.
    expect(w.room).toMatchObject({ you: null, player: null, code: '', spectators: 1, watch: { pov: null, hands: false, delay: 0 } });
    expect(w.room.seats.every((s: { deckName: string } | null) => !s || s.deckName === '')).toBe(true);
    expect(seats[0].room.code).toBe(code);
    // Os jogadores ficam sabendo por um aviso curto (a mesa não é reenviada).
    expect(seats[0].events.at(-1)).toEqual({ event: 'presence', data: { spectators: 1 } });
    expect([table.spectators, table.connections]).toEqual([1, 3]);

    for (let i = 0; i < 60 && table.state!.phase !== 'gameover'; i++) {
      play();
      const v = w.view!;
      expect(v.actionCount).toBe(table.state!.actionCount);
      // Só aparece de frente a carta da mão que um efeito revelou a todos.
      const known = new Set(table.state!.knownHand ?? []);
      for (const ps of table.state!.players) {
        expect(shown(v, ps.id).length, `mão do lugar ${ps.id} à vista de quem assiste`).toBeLessThanOrEqual(ps.hand.filter((u) => known.has(u)).length);
        expect(v.players[ps.id].unseen).toBeUndefined();
      }
      // As linhas secretas do registro (o que cada um comprou) ficam com o dono.
      expect(v.log.some((e) => 'secret' in e)).toBe(false);
    }
    expect(table.state!.turn).toBeGreaterThan(0);

    table.detach(w.conn);
    expect(table.spectators).toBe(0);
    expect(seats[0].events.at(-1)).toEqual({ event: 'presence', data: { spectators: 0 } });
    await app.close();
  });

  it('espectador não conta como presença do jogador nem segura a mesa aberta', async () => {
    const { app, clock, table, seats } = await three();
    const w = watcher();
    table.attach(w.conn);
    const p = actingPlayer(table.state!)!;
    // O jogador da vez fecha o navegador; só quem assiste continua ligado.
    table.detach(seats[p].conn);
    expect(w.room.players[p].connected).toBe(false);
    clock.t += YONKO_ABANDON_MS + 1;
    table.tick();
    expect(table.state!.players[p].out).toBe(true);
    // Sem nenhum jogador ligado, a faxina não espera por quem assiste.
    for (const c of seats) table.detach(c.conn);
    expect([table.connections, table.spectators]).toEqual([0, 1]);
    clock.t += 7 * 60 * 60_000;
    tablesOf(app).sweep();
    expect(tablesOf(app).get(table.id)).toBeNull();
    expect(w.events.at(-1)!.event).toBe('closed');
    await app.close();
  });

  it('assiste quem tem o código; a mesa só entra na lista se quem criou a abriu', async () => {
    const { app } = setup();
    const t = await openTable(app);
    const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
    // Na espera: o código acha a mesa, a lista não.
    const waiting = await get(`/api/yonko/watch/${t.code.toLowerCase()}`);
    expect(waiting.json()).toMatchObject({ id: t.id, status: 'waiting', listed: false, handsAllowed: false, mine: false });
    expect(waiting.json().players.map((p: { name: string }) => p.name)).toHaveLength(2);
    expect((await get(`/api/yonko/watch/${t.code}`, ALICE)).json().mine).toBe(true);
    expect((await get('/api/yonko/watch/ZZZZZZ')).statusCode).toBe(404);
    expect((await get('/api/yonko/tables/nope')).statusCode).toBe(404);

    // Só quem criou abre a mesa e libera as mãos; liberar as mãos pede o "pronto" de novo.
    await post(app, `/api/yonko/tables/${t.id}/ready`, { t: t.bob, ready: true }, BOB);
    expect((await post(app, `/api/yonko/tables/${t.id}/options`, { t: t.bob, listed: true }, BOB)).statusCode).toBe(403);
    expect((await post(app, `/api/yonko/tables/${t.id}/options`, { t: t.alice, listed: true })).statusCode).toBe(200);
    const table = tableOf(app, t.id);
    expect(table.data.seats[1]!.ready).toBe(true);
    expect((await post(app, `/api/yonko/tables/${t.id}/options`, { t: t.alice, showHands: true })).statusCode).toBe(200);
    expect(table.data.seats[1]!.ready).toBe(false);
    expect(table.data).toMatchObject({ listed: true, showHands: true });
    const a = client(t.alice);
    table.attach(a.conn);
    expect(a.room).toMatchObject({ listed: true, showHands: true });
    expect((await get('/api/yonko/live')).json()).toEqual({ tables: [], hands: false });

    await post(app, `/api/yonko/tables/${t.id}/bot`, { t: t.alice });
    await post(app, `/api/yonko/tables/${t.id}/ready`, { t: t.bob, ready: true }, BOB);
    expect((await post(app, `/api/yonko/tables/${t.id}/start`, { t: t.alice })).statusCode).toBe(200);
    // Com a partida em andamento não se mexe mais nisso: quem joga começou sabendo o que valia.
    expect((await post(app, `/api/yonko/tables/${t.id}/options`, { t: t.alice, showHands: false })).statusCode).toBe(409);
    const live = (await get('/api/yonko/live', BOB)).json();
    expect(live.tables).toHaveLength(1);
    expect(live.tables[0]).toMatchObject({ id: t.id, status: 'playing', listed: true, handsAllowed: true, mine: true, spectators: 0 });
    expect(live.tables[0].players).toHaveLength(3);
    expect(live.tables[0].players[2]).toMatchObject({ bot: true, out: false });
    expect(live.tables[0]).not.toHaveProperty('code');
    expect((await get(`/api/yonko/tables/${t.id}`)).json()).toMatchObject({ id: t.id, mine: false });
    await app.close();
  });

  it('as mãos de todos só onde a mesa liberou, e sempre na mesa atrasada', async () => {
    const { app, clock, table, play, step } = await three({ showHands: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const live = watcher();
    const hands = watcher({ hands: true });
    table.attach(live.conn);
    table.attach(hands.conn);
    expect(live.room.watch).toEqual({ pov: null, hands: false, delay: 0 });
    expect(hands.room.watch).toEqual({ pov: null, hands: true, delay: HANDS_DELAY_MS });

    step(10_000);
    const first = actingPlayer(table.state!)!;
    // Joga até todos terem a mão inicial (a largada e a mão de cada um).
    while (table.state!.phase === 'mulligan') play();
    const n = table.state!.actionCount;
    expect(table.state!.players.every((ps) => ps.hand.length > 0)).toBe(true);
    const actedAt = clock.t;
    // Ao vivo: na hora, sem mãos. Com as mãos: nada ainda.
    expect(live.view!.actionCount).toBe(n);
    expect(table.state!.players.every((ps) => shown(live.view!, ps.id).length === 0)).toBe(true);
    expect(hands.view!.actionCount).toBe(0);
    expect(hands.room.clock.remaining).toEqual([YONKO_TIME_BANK_MS, YONKO_TIME_BANK_MS, YONKO_TIME_BANK_MS]);
    // Quem chega agora pedindo as mãos também começa atrás; pedir menos que o mínimo dá o mínimo.
    const late = watcher({ hands: true });
    const quick = watcher({ hands: true, delay: 0 });
    table.attach(late.conn);
    table.attach(quick.conn);
    expect(late.view!.actionCount).toBe(0);
    expect(quick.room.watch.delay).toBe(MIN_HANDS_DELAY_MS);
    expect(quick.view!.actionCount).toBe(0);

    step(MIN_HANDS_DELAY_MS + 1_000);
    expect(quick.view!.actionCount).toBe(n);
    expect(hands.view!.actionCount).toBe(0);
    step(HANDS_DELAY_MS - MIN_HANDS_DELAY_MS - 2_000);
    expect(hands.view!.actionCount).toBe(0);
    step(2_000);
    expect(clock.t - HANDS_DELAY_MS).toBeGreaterThanOrEqual(actedAt);
    for (const c of [hands, late]) {
      const v = c.view!;
      expect(v.actionCount).toBe(n);
      // As mãos de todos, de frente; os decks continuam escondidos.
      for (const ps of table.state!.players) {
        expect(shown(v, ps.id)).toHaveLength(ps.hand.length);
        expect(v.players[ps.id].deck.every((u) => v.cards[u].cardId === HIDDEN_CARD)).toBe(true);
      }
      // Um estado por ação (as animações acompanham).
      expect(c.events.filter((e) => e.event === 'state').slice(-n).map((e) => e.data.view.actionCount)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
    // O relógio é o daquele momento: quem começou gastou 10 s antes da primeira jogada, e o tempo de quem a
    // mesa espera anda no ritmo da mesa atrasada.
    const running = actingPlayer(table.state!)!;
    const since = clock.t - HANDS_DELAY_MS - actedAt;
    expect(hands.room.clock.running).toBe(running);
    expect(hands.room.clock.remaining[first]).toBe(YONKO_TIME_BANK_MS - 10_000 - (running === first ? since : 0));
    for (const p of [0, 1, 2].filter((x) => x !== first)) expect(hands.room.clock.remaining[p]).toBe(YONKO_TIME_BANK_MS - (running === p ? since : 0));

    // O fim chega depois do atraso.
    for (const p of [0, 1, 2].filter((x) => x !== first).slice(0, 2)) table.act(table.data.players![p].token, null, { type: 'concede', player: p });
    expect(table.status).toBe('finished');
    expect(live.room.status).toBe('finished');
    expect(hands.room.status).toBe('playing');
    step(HANDS_DELAY_MS + 1_000);
    expect(hands.room.status).toBe('finished');
    expect(hands.view!.winner).toBe(first);
    await app.close();
  });

  it('mesa que não liberou as mãos: pedir as mãos não mostra nada a mais', async () => {
    const { app, table, play } = await three();
    while (table.state!.phase === 'mulligan') play();
    const w = watcher({ hands: true });
    table.attach(w.conn);
    expect(w.room.watch).toEqual({ pov: null, hands: false, delay: 0 });
    expect(table.state!.players.every((ps) => shown(w.view!, ps.id).length === 0)).toBe(true);
    await app.close();
  });

  it('o streamer que joga mostra só a própria mão, com o atraso que escolher, e a transmissão segue no "jogar de novo"', async () => {
    const { app, clock, table, tokens, seats, play, step, id, alice } = await three();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Bob transmite a própria partida: ao vivo numa tela, com 2 minutos de atraso na outra.
    const own = watcher({ as: tokens[1] });
    const delayed = watcher({ as: tokens[1], delay: 120_000 });
    // Um token que não é de ninguém da mesa não vira ponto de vista.
    const stranger = watcher({ as: 'nao-existe' });
    for (const c of [own, delayed, stranger]) table.attach(c.conn);
    expect(own.room.watch).toEqual({ pov: 1, hands: false, delay: 0 });
    expect(delayed.room.watch).toEqual({ pov: 1, hands: false, delay: 120_000 });
    expect(stranger.room.watch.pov).toBeNull();
    expect(own.room.player).toBeNull();

    step(5_000);
    while (table.state!.phase === 'mulligan') play();
    const n = table.state!.actionCount;
    const v = own.view!;
    expect(shown(v, 1)).toHaveLength(table.state!.players[1].hand.length);
    expect(shown(v, 0)).toHaveLength(0);
    expect(shown(v, 2)).toHaveLength(0);
    expect(delayed.view!.actionCount).toBe(0);
    step(121_000);
    expect(delayed.view!.actionCount).toBe(n);
    expect(shown(delayed.view!, 1)).toHaveLength(table.state!.players[1].hand.length);
    expect(shown(delayed.view!, 0)).toHaveLength(0);

    // A partida acaba e quem criou a reabre logo em seguida: a tela atrasada ainda mostra a partida até o fim.
    table.act(tokens[1], null, { type: 'concede', player: 1 });
    table.act(tokens[2], null, { type: 'concede', player: 2 });
    expect(table.status).toBe('finished');
    step(10_000);
    expect(table.reopen(alice).ok).toBe(true);
    expect(own.room.status).toBe('waiting');
    expect(own.view).toBeNull();
    expect(delayed.room.status).toBe('playing');
    expect(delayed.view!.actionCount).toBe(n);
    step(111_000);
    // Passou o atraso desde o fim: a tela atrasada vê o resultado, e ainda não a reabertura.
    expect(delayed.room.status).toBe('finished');
    expect(delayed.view!.winner).toBe(0);
    step(10_000);
    expect(delayed.room.status).toBe('waiting');
    expect(delayed.view).toBeNull();

    // A partida seguinte: os mesmos lugares, e cada tela volta a receber a mesa do zero.
    for (const p of [1, 2]) expect((await post(app, `/api/yonko/tables/${id}/ready`, { t: tokens[p], ready: true }, OWNERS[p])).statusCode).toBe(200);
    expect(table.start(alice).ok).toBe(true);
    expect(own.room.status).toBe('playing');
    expect(own.room.watch.pov).toBe(1);
    expect(own.view!.actionCount).toBe(0);
    expect(own.view!.log).toHaveLength(table.state!.log.length);
    expect(delayed.view!.actionCount).toBe(0);
    expect(seats[0].view!.actionCount).toBe(0);
    step(1_000);
    play();
    expect(own.view!.actionCount).toBe(1);
    expect(delayed.view!.actionCount).toBe(0);
    step(120_500);
    expect(delayed.view!.actionCount).toBe(1);

    // Bob sai da mesa na espera seguinte: o token dele deixa de valer como ponto de vista.
    for (const p of [0, 2]) table.act(tokens[p], null, { type: 'concede', player: p });
    table.reopen(alice);
    table.leaveWaiting(tokens[1]);
    expect(own.room.watch.pov).toBeNull();
    expect(clock.t).toBeGreaterThan(1_000_000);
    await app.close();
  });

  it('a mesa atrasada é refeita depois de reiniciar o servidor', async () => {
    const db = freshDb();
    const { app, clock, table, tokens, play, step, id } = await three(undefined, db);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    step(1_000);
    while (table.state!.phase === 'mulligan') play();
    const n = table.state!.actionCount;
    await app.close();
    const again = setup(db, () => clock.t).app;
    const restored = tableOf(again, id);
    expect(restored.data.timeline).toHaveLength(n);
    const w = watcher({ as: tokens[0], delay: 60_000 });
    restored.attach(w.conn);
    expect(w.view!.actionCount).toBe(0);
    step(61_000);
    expect(w.view!.actionCount).toBe(n);
    await again.close();
  });

  it('o canal de quem assiste: as mãos pedem o perfil e a mesa liberada; a chave da transmissão decide o que a tela vê', async () => {
    const { app, db } = setup();
    const nami = login(db, 'nami', 'streamer');
    const usopp = login(db, 'usopp');
    const send = (method: 'POST' | 'PUT', url: string, cookie: string, payload?: object) => app.inject({ method, url, headers: { cookie }, payload });
    // Nami cria a mesa com a conta dela; Bob entra e um bot completa.
    const created = await app.inject({ method: 'POST', url: '/api/yonko/tables', headers: { cookie: nami.cookie }, payload: { deckId: 'st01-luffy' } });
    expect(created.statusCode).toBe(201);
    const { id, code, token } = created.json();
    const bob = (await post(app, '/api/yonko/tables/join', { code, deckId: 'st02-kid' }, BOB)).json().token as string;
    const table = tableOf(app, id);
    // Outra mesa, de outra pessoa (cada um espera numa mesa por vez).
    const other = tableOf(app, (await post(app, '/api/yonko/tables', { deckId: 'st03-crocodile' }, CAROL)).json().id);

    // O que a transmissão pede a cada mesa sai das opções do streamer.
    const user = getUser(db, nami.id)!;
    const s = { ...DEFAULT_SETTINGS };
    expect(yonkoBroadcastView(s, table, user)).toEqual({});
    expect(yonkoBroadcastView({ ...s, handsOwn: true }, table, user)).toEqual({ as: token, delay: 180_000 });
    expect(yonkoBroadcastView({ ...s, handsOwn: true, delayS: 0 }, table, user)).toEqual({ as: token, delay: 0 });
    // Mesa de outros: as mãos só se quem criou liberou, e nunca com menos de 1 minuto de atraso.
    expect(yonkoBroadcastView(s, other, user)).toEqual({});
    other.data.showHands = true;
    expect(yonkoBroadcastView({ ...s, delayS: 10 }, other, user)).toEqual({ hands: true, delay: MIN_HANDS_DELAY_MS });
    expect(yonkoBroadcastView({ ...s, handsPlayers: false }, other, user)).toEqual({});

    // A mesa do Yonko vai para a transmissão, mesmo na sala de espera.
    const key = (await send('POST', '/api/broadcast/key', nami.cookie)).json().key as string;
    expect((await send('PUT', '/api/broadcast/room', nami.cookie, { roomId: 'yk-nope' })).statusCode).toBe(404);
    expect((await send('PUT', '/api/broadcast/room', nami.cookie, { roomId: id })).json()).toMatchObject({ key, roomId: id, kind: 'yonko' });
    expect((await app.inject({ url: `/api/broadcast/${key}` })).json()).toMatchObject({ roomId: id, kind: 'yonko' });
    await send('PUT', '/api/broadcast/settings', nami.cookie, { handsOwn: true, delayS: 0 });

    await post(app, `/api/yonko/tables/${id}/bot`, { t: token }, { cookie: nami.cookie } as never);
    await post(app, `/api/yonko/tables/${id}/ready`, { t: bob, ready: true }, BOB);
    expect((await post(app, `/api/yonko/tables/${id}/start`, { t: token }, { cookie: nami.cookie } as never)).statusCode).toBe(200);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    /** Abre o canal de quem assiste e devolve o status e, se abriu, o primeiro `state`. */
    const open = async (tableId: string, query = '', cookie?: string) => {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/yonko/tables/${tableId}/watch${query}`, { signal: ctrl.signal, headers: cookie ? { cookie } : {} });
      let data: any = null;
      if (res.status === 200) {
        const reader = res.body!.getReader();
        let text = '';
        while (!/event: state\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
        data = JSON.parse(/event: state\ndata: (.*)\n\n/.exec(text)![1]);
      }
      ctrl.abort();
      return { status: res.status, data };
    };
    // Sem nada: a visão pública, para qualquer um.
    const plain = await open(id);
    expect(plain.status).toBe(200);
    expect(plain.data.room.watch).toEqual({ pov: null, hands: false, delay: 0 });
    expect((await open('yk-nope')).status).toBe(404);
    // A chave da transmissão: a mesa como Nami a vê (a mão dela), ao vivo, como ela escolheu.
    const tv = await open(id, `?k=${key}`);
    expect(tv.status).toBe(200);
    expect(tv.data.room.watch).toEqual({ pov: 0, hands: false, delay: 0 });
    expect(tv.data.room.code).toBe('');
    expect((await open(id, '?k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(403);
    // "Ver mãos" no app: só o perfil, só na mesa liberada e nunca na própria.
    expect((await open(id, '?hands=1')).status).toBe(403);
    expect((await open(id, '?hands=1', usopp.cookie)).status).toBe(403);
    expect((await open(id, '?hands=1', nami.cookie)).status).toBe(403);
    table.data.showHands = true;
    expect((await open(id, '?hands=1', nami.cookie)).status).toBe(403);
    const seen = await open(other.id, '?hands=1', nami.cookie);
    expect(seen.status).toBe(200);
    // Mesa em espera: chega só a sala.
    expect(seen.data.view).toBeNull();
    expect(seen.data.room.status).toBe('waiting');
    await app.close();
  });
});

function tableDb(app: App): DB {
  return (app as unknown as { yonkoTables: { deps: { db: DB } } }).yonkoTables.deps.db;
}

export type { YonkoTable };
