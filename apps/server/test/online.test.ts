import {
  type Action,
  actingPlayer,
  type CardData,
  type CardDef,
  chooseBotAction,
  type GameState,
  HIDDEN_CARD,
  type LogEntry,
  type PlayerId,
} from '@gumgum/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, upsertGoogleUser } from '../src/auth/store';
import { type DB, getDeck, openDb, upsertCards } from '../src/db';
import { Lobby, type SeatRequest } from '../src/online/lobby';
import { ABANDON_MS, type Connection, TIME_BANK_MS } from '../src/online/room';
import { seed } from '../src/seed';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup(db: DB = freshDb()) {
  // Os bots jogam muito mais rápido que uma pessoa: sem limite de ações por segundo.
  return { db, app: buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9 }) };
}
function freshDb() {
  const db = openDb(':memory:');
  seed(db);
  return db;
}
type App = ReturnType<typeof buildApp>;

/** Conexão de teste: guarda o último estado como o navegador montaria (defs e log acumulados). */
function client(seat: PlayerId) {
  const events: Array<{ event: string; data: any }> = [];
  let defs: Record<string, CardDef> = {};
  let log: LogEntry[] = [];
  let latest: any = null;
  const conn: Connection = {
    seat,
    sentDefs: new Set(),
    sentLog: 0,
    send: (event, data: any) => {
      events.push({ event, data });
      if (event === 'state') {
        defs = { ...defs, ...data.defs };
        log = [...log.slice(0, data.log.from), ...data.log.entries];
        latest = data;
      }
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

async function privateMatch(app: App, decks: [string, string] = ['st01-luffy', 'st02-kid']) {
  const created = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: ALICE, payload: { deckId: decks[0] } });
  expect(created.statusCode).toBe(201);
  const { roomId, code, token: t0 } = created.json();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  const joined = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code, deckId: decks[1] } });
  expect(joined.statusCode).toBe(200);
  expect(joined.json().roomId).toBe(roomId);
  return { roomId, tokens: [t0, joined.json().token] as [string, string] };
}

async function act(app: App, roomId: string, t: string, seq: number, action: Action) {
  return app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/action`, payload: { t, seq, action } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('partidas online: salas privadas', () => {
  it('cada jogador vê só as próprias cartas; as ações vão pelo servidor', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const c0 = client(0);
    const c1 = client(1);
    room.attach(c0.conn);
    room.attach(c1.conn);
    const v0 = c0.view!;
    const v1 = c1.view!;
    expect(c0.room.status).toBe('playing');
    expect(c1.room.players.map((p: { connected: boolean }) => p.connected)).toEqual([true, true]);
    expect(c0.events.filter((e) => e.event === 'presence').pop()!.data).toEqual({ connected: [true, true] });
    // Minha mão aparece; a do oponente e os decks, não.
    expect(v0.players[0].hand.every((u) => v0.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
    expect(v0.players[1].hand.every((u) => v0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v0.players[0].deck.every((u) => v0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v1.players[0].hand.every((u) => v1.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v0.seed).toBe(0);

    const first = actingPlayer(v0)!;
    const other = (1 - first) as PlayerId;
    // Ação do jogador errado, versão velha e token inválido.
    expect((await act(app, roomId, tokens[other], v0.actionCount, { type: 'mulligan', player: other, redraw: false })).statusCode).toBe(422);
    expect((await act(app, roomId, tokens[first], v0.actionCount, { type: 'mulligan', player: other, redraw: false })).statusCode).toBe(403);
    expect((await act(app, roomId, tokens[first], 99, { type: 'mulligan', player: first, redraw: false })).statusCode).toBe(409);
    expect((await act(app, roomId, 'x', v0.actionCount, { type: 'mulligan', player: first, redraw: false })).statusCode).toBe(404);
    expect((await act(app, roomId, tokens[first], v0.actionCount, { type: 'timeout', player: first })).statusCode).toBe(400);

    const ok = await act(app, roomId, tokens[first], v0.actionCount, { type: 'mulligan', player: first, redraw: false });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, actionCount: 1 });
    expect(c1.view!.actionCount).toBe(1);
    expect(c1.view!.pending).toEqual({ kind: 'mulligan', player: other });
  });

  it('partida inteira jogada pelas visões termina e entra nas estatísticas', async () => {
    const { app, db } = setup();
    const { roomId, tokens } = await privateMatch(app, ['st03-crocodile', 'st04-kaido']);
    const room = getRoom(app, roomId);
    const cs = [client(0), client(1)];
    for (const c of cs) room.attach(c.conn);
    for (let i = 0; i < 3000; i++) {
      const v = cs[0].view!;
      if (v.phase === 'gameover') break;
      const p = actingPlayer(v)!;
      // O bot decide olhando só a visão do jogador da vez (como faria o navegador).
      const mine = cs[p].view!;
      const r = await act(app, roomId, tokens[p], mine.actionCount, chooseBotAction(mine, p));
      expect(r.statusCode, r.body).toBe(200);
    }
    const end = cs[0].view!;
    expect(end.phase).toBe('gameover');
    // No fim, tudo fica visível (e o replay pode ser baixado).
    expect(end.players[1].hand.every((u) => end.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
    expect(cs[0].room.result.matchId).toBeGreaterThan(0);
    const replay = await app.inject(`/api/online/rooms/${roomId}/replay?t=${tokens[0]}`);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().seed128).toHaveLength(4);

    const seats = db.prepare("SELECT controller, opp_controller, queue FROM match_seats ORDER BY seat").all();
    expect(seats).toEqual([
      { controller: 'human', opp_controller: 'human', queue: 'casual' },
      { controller: 'human', opp_controller: 'human', queue: 'casual' },
    ]);
    expect((db.prepare('SELECT mode FROM matches').get() as { mode: string }).mode).toBe('online');
  }, 120_000);

  it('não dá para entrar na própria sala nem com código errado', async () => {
    const { app } = setup();
    const created = (await app.inject({ method: 'POST', url: '/api/online/rooms', headers: ALICE, payload: { deckId: 'st01-luffy' } })).json();
    const self = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: ALICE, payload: { code: created.code, deckId: 'st02-kid' } });
    expect(self.statusCode).toBe(409);
    const wrong = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code: 'ZZZZZZ', deckId: 'st02-kid' } });
    expect(wrong.statusCode).toBe(404);
    const noDeck = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: BOB, payload: { deckId: 'nope' } });
    expect(noDeck.statusCode).toBe(400);
    // "Partida em andamento" devolve a sala de espera com o token.
    const active = (await app.inject({ url: '/api/online/active', headers: ALICE })).json();
    expect(active).toEqual([{ roomId: created.roomId, token: created.token, status: 'waiting', queue: 'private', code: created.code }]);
  });

  it('a partida sobrevive a um reinício do servidor', async () => {
    const db = freshDb();
    const first = setup(db).app;
    const { roomId, tokens } = await privateMatch(first);
    const c = client(0);
    getRoom(first, roomId).attach(c.conn);
    const p = actingPlayer(c.view!)!;
    await act(first, roomId, tokens[p], 0, { type: 'mulligan', player: p, redraw: true });
    const mine = client(p);
    getRoom(first, roomId).attach(mine.conn);
    const hand = mine.view!.players[p].hand;
    expect(hand.some((u) => u.startsWith('~'))).toBe(false);
    await first.close();

    const second = setup(db).app;
    const again = client(p);
    getRoom(second, roomId).attach(again.conn);
    expect(again.view!.actionCount).toBe(1);
    // Mesmos apelidos e mesma mão depois de refazer as ações.
    expect(again.view!.players[p].hand).toEqual(hand);
    await second.close();
  });

  it('revanche: quando os dois pedem, começa outra sala', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const c0 = client(0);
    room.attach(c0.conn);
    await act(app, roomId, tokens[0], 0, { type: 'concede', player: 0 });
    expect(c0.view!.winner).toBe(1);
    for (const t of tokens) expect((await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/rematch`, payload: { t } })).statusCode).toBe(204);
    const msg = c0.events.find((e) => e.event === 'rematch')!.data;
    const next = getRoom(app, msg.roomId);
    expect(next.status).toBe('playing');
    expect(next.seatOf(msg.token)).toBe(1);
  });
});

describe('partidas online: filas', () => {
  it('casual: dois jogadores na fila formam uma partida', async () => {
    const { app } = setup();
    const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'casual' } })).json();
    expect((await app.inject(`/api/online/queue/${a.ticket}`)).json().status).toBe('waiting');
    const b = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: BOB, payload: { deckId: 'st02-kid', queue: 'casual' } })).json();
    const ma = (await app.inject(`/api/online/queue/${a.ticket}`)).json();
    const mb = (await app.inject(`/api/online/queue/${b.ticket}`)).json();
    expect(ma.status).toBe('matched');
    expect(mb.roomId).toBe(ma.roomId);
    expect(ma.token).not.toBe(mb.token);
    // Já está numa partida: não entra em outra fila.
    const again = await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'casual' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().roomId).toBe(ma.roomId);
  });

  it('ranqueada: só com login, sem cartas manuais e sem ferramentas manuais', async () => {
    const { app, db } = setup();
    const anon = await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'ranked' } });
    expect(anon.statusCode).toBe(401);

    const login = (sub: string) => {
      const u = upsertGoogleUser(db, { sub, email: `${sub}@example.com`, emailVerified: true, name: sub, picture: null });
      return { cookie: `gg_session=${createSession(db, u.id)}` };
    };
    const zoro = { ...ALICE, ...login('zoro') };
    const sanji = { ...BOB, ...login('sanji') };

    // Deck com uma carta de efeito manual (⚙) não entra na ranqueada.
    upsertCards(
      db,
      [{ id: 'TEST-001', name: 'Carta Manual', category: 'character', colors: ['red'], cost: 1, power: 1000, types: ['Test'], text: '[On Play] Do something strange with the moon.' } as CardData],
      { provisional: true, source: 'test' },
    );
    const luffy = getDeck(db, 'st01-luffy')!;
    const cards = luffy.cards.map((c, i) => (i === 0 ? { ...c, count: c.count - 1 } : c)).concat({ id: 'TEST-001', count: 1 });
    const deck = (await app.inject({ method: 'POST', url: '/api/decks', headers: zoro, payload: { name: 'Manual', leader: luffy.leader, cards } })).json();
    const manual = await app.inject({ method: 'POST', url: '/api/online/queue', headers: zoro, payload: { deckId: deck.id, queue: 'ranked' } });
    expect(manual.statusCode).toBe(400);
    expect(manual.json().error).toContain('manual');
    // No casual, o mesmo deck pode.
    expect((await app.inject({ method: 'POST', url: '/api/online/rooms', headers: zoro, payload: { deckId: deck.id } })).statusCode).toBe(201);

    const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: zoro, payload: { deckId: 'st01-luffy', queue: 'ranked' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: sanji, payload: { deckId: 'st02-kid', queue: 'ranked' } })).json();
    const ma = (await app.inject(`/api/online/queue/${a.ticket}`)).json();
    const mb = (await app.inject(`/api/online/queue/${b.ticket}`)).json();
    expect(ma.status).toBe('matched');
    const room = getRoom(app, ma.roomId);
    const c = client(0);
    room.attach(c.conn);
    const p = actingPlayer(c.view!)!;
    const t = p === 0 ? ma.token : mb.token;
    const tools = await act(app, ma.roomId, t, 0, { type: 'manual', player: p, op: { op: 'draw', count: 1 } });
    expect(tools.statusCode).toBe(403);
    // Desistência na ranqueada mexe na recompensa.
    await act(app, ma.roomId, t, 0, { type: 'concede', player: p });
    const diff = c.room.result.bounty.map((s: { before: number; after: number }) => s.after - s.before);
    expect(diff[1 - p]).toBe(1000);
    expect(diff[p]).toBe(0);
  });
});

describe('partidas online: relógio', () => {
  const seat = (name: string, deckId: string, db: DB): SeatRequest => {
    const d = getDeck(db, deckId)!;
    return { ownerHash: name, userId: null, name, bounty: 0, tier: 'east-blue', deckId, deck: d };
  };
  function lobby(db: DB, now: () => number) {
    return new Lobby({ cards: (ids) => (db.prepare(`SELECT data FROM cards WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ data: string }>).map((r) => JSON.parse(r.data)), now });
  }

  it('o tempo só corre para quem tem a ação; sem tempo, perde', () => {
    vi.useFakeTimers();
    let t = 1_000_000;
    const db = freshDb();
    const l = lobby(db, () => t);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), 'standard');
    if ('error' in r) throw new Error(r.error);
    const j = l.joinPrivate(r.room.data.code!, seat('b', 'st02-kid', db));
    if ('error' in j) throw new Error(j.error);
    const room = r.room;
    const c0 = client(0);
    const c1 = client(1);
    room.attach(c0.conn);
    room.attach(c1.conn);
    const first = actingPlayer(c0.view!)!;
    const other = (1 - first) as PlayerId;

    t += 60_000;
    vi.advanceTimersByTime(60_000);
    const clock = room.clock();
    expect(clock.running).toBe(first);
    expect(clock.remaining[first]).toBe(TIME_BANK_MS - 60_000);
    expect(clock.remaining[other]).toBe(TIME_BANK_MS);

    // Mulligan do primeiro: agora é a vez do outro, e o relógio do primeiro para.
    room.act(first, 0, { type: 'mulligan', player: first, redraw: false });
    t += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(room.clock().remaining).toEqual(
      first === 0 ? [TIME_BANK_MS - 60_000, TIME_BANK_MS - 30_000] : [TIME_BANK_MS - 30_000, TIME_BANK_MS - 60_000],
    );

    // O outro não joga mais: o tempo dele acaba e ele perde.
    t += TIME_BANK_MS;
    vi.advanceTimersByTime(TIME_BANK_MS);
    expect(room.state!.phase).toBe('gameover');
    expect(room.state!.winner).toBe(first);
    expect(room.state!.winReason).toContain('sem tempo');
    l.dispose();
  });

  it('jogador da vez desconectado por muito tempo perde por abandono', () => {
    vi.useFakeTimers();
    let t = 0;
    const db = freshDb();
    const l = lobby(db, () => t);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), 'standard');
    if ('error' in r) throw new Error(r.error);
    l.joinPrivate(r.room.data.code!, seat('b', 'st02-kid', db));
    const room = r.room;
    const first = actingPlayer(room.state!)!;
    const watcher = client((1 - first) as PlayerId);
    room.attach(watcher.conn);
    t += ABANDON_MS + 10;
    vi.advanceTimersByTime(ABANDON_MS + 10);
    expect(room.state!.phase).toBe('gameover');
    expect(room.state!.winReason).toContain('abandonou');
    l.dispose();
  });
});

describe('partidas online: canal SSE', () => {
  it('envia o estado pelo event-stream', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${roomId}/events?t=${tokens[1]}`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('event: state')) text += new TextDecoder().decode((await reader.read()).value);
    while (!/event: state\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    const data = JSON.parse(/event: state\ndata: (.*)\n\n/.exec(text)![1]);
    expect(data.room.you).toBe(1);
    expect(data.view.players[0].hand.every((u: string) => data.view.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    ctrl.abort();
    const bad = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${roomId}/events?t=nope`, { headers: { connection: 'close' } });
    expect(bad.status).toBe(404);
    await app.close();
  });
});

function getRoom(app: App, id: string) {
  const room = (app as unknown as { onlineLobby: Lobby }).onlineLobby.get(id);
  if (!room) throw new Error('sala não encontrada');
  return room;
}
