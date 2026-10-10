import {
  type Action,
  actingPlayer,
  applyAction,
  type CardData,
  type CardDef,
  chooseSimpleBotAction as chooseBotAction,
  type GameState,
  HIDDEN_CARD,
  legalActions,
  type LogEntry,
  type PlayerId,
  REPLAY_VERSION,
} from '@gumgum/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import type { ServerOptions } from '../src/config';
import { type DB, getCards, getDeck, openDb, upsertCards } from '../src/db';
import { Lobby, type SeatRequest } from '../src/online/lobby';
import { ABANDON_MS, type Connection, Room, TIME_BANK_MS } from '../src/online/room';
import { seed } from '../src/seed';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup(db: DB = freshDb(), server: Partial<ServerOptions> = {}) {
  // Os bots jogam muito mais rápido que uma pessoa: sem limite de ações por segundo.
  return { db, app: buildApp(db, { server: { cardImages: true, ...server }, onlineRateLimit: 1e9, botDelayMs: 0 }) };
}
function freshDb() {
  const db = openDb(':memory:');
  seed(db);
  return db;
}
type App = ReturnType<typeof buildApp>;

/** Conexão de teste: guarda o último estado como o navegador montaria (defs e log acumulados). */
function client(seat: PlayerId | null, hands = false) {
  const events: Array<{ event: string; data: any }> = [];
  let defs: Record<string, CardDef> = {};
  let log: LogEntry[] = [];
  let latest: any = null;
  const conn: Connection = {
    seat,
    hands,
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
  const created = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: ALICE, payload: { deckId: decks[0], format: 'egb' } });
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
    expect(c0.events.filter((e) => e.event === 'presence').pop()!.data).toEqual({ connected: [true, true], spectators: 0 });
    // Minha mão aparece; a do oponente e os decks, não.
    expect(v0.players[0].hand.every((u) => v0.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
    expect(v0.players[1].hand.every((u) => v0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v0.players[0].deck.every((u) => v0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v1.players[0].hand.every((u) => v1.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v0.seed).toBe(0);

    // O vencedor do sorteio escolhe quem começa (os dois veem a escolha pendente).
    const winner = actingPlayer(v0)!;
    expect(v0.pending).toEqual({ kind: 'chooseFirst', player: winner });
    expect(v1.pending).toEqual({ kind: 'chooseFirst', player: winner });
    expect((await act(app, roomId, tokens[winner], 0, { type: 'answer', player: winner, yes: false })).statusCode).toBe(200);
    const first = (1 - winner) as PlayerId;
    const other = winner;
    expect(c0.view!.firstPlayer).toBe(first);
    const n = c0.view!.actionCount;
    // Ação do jogador errado, versão velha e token inválido.
    expect((await act(app, roomId, tokens[other], n, { type: 'mulligan', player: other, redraw: false })).statusCode).toBe(422);
    expect((await act(app, roomId, tokens[first], n, { type: 'mulligan', player: other, redraw: false })).statusCode).toBe(403);
    expect((await act(app, roomId, tokens[first], 99, { type: 'mulligan', player: first, redraw: false })).statusCode).toBe(409);
    expect((await act(app, roomId, 'x', n, { type: 'mulligan', player: first, redraw: false })).statusCode).toBe(404);
    expect((await act(app, roomId, tokens[first], n, { type: 'timeout', player: first })).statusCode).toBe(400);

    const ok = await act(app, roomId, tokens[first], n, { type: 'mulligan', player: first, redraw: false });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, actionCount: 2 });
    expect(c1.view!.actionCount).toBe(2);
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

  it('o deck precisa valer no formato da fila ou da sala', async () => {
    const { app } = setup();
    const post = (url: string, headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers, payload });
    // ST-01 tem o bloco ①: rotacionou e não vale no Standard (o padrão quando o formato não vem).
    const std = await post('/api/online/queue', ALICE, { deckId: 'st01-luffy', queue: 'casual' });
    expect(std.statusCode).toBe(400);
    expect(std.json().error).toMatch(/não é permitido no formato Standard/);
    expect(std.json()).toMatchObject({ errorCode: 'deckNotAllowedInFormat', errorParams: { format: 'Standard' } });
    // O motivo também vai com a chave do motor, para o cliente traduzir o {issue}.
    expect(std.json().errorParams).toMatchObject({ issueCode: 'rules.rotated', issueParams: { format: 'Standard' } });
    expect((await post('/api/online/rooms', ALICE, { deckId: 'st01-luffy', format: 'standard' })).statusCode).toBe(400);
    // Carta banida: nem no Extra Grand Battle.
    const banned = await post('/api/online/rooms', ALICE, { deckId: 'st10-law', format: 'egb' });
    expect(banned.statusCode).toBe(400);
    expect(banned.json().error).toMatch(/banida/);

    // Quem entra numa sala joga no formato dela, não no que pediu.
    const room = (await post('/api/online/rooms', ALICE, { deckId: 'st13-ace', format: 'standard' })).json();
    const join = await post('/api/online/rooms/join', BOB, { code: room.code, deckId: 'st02-kid', format: 'egb' });
    expect(join.statusCode).toBe(400);
    expect(join.json().error).toMatch(/Standard/);
    expect((await post('/api/online/rooms/join', BOB, { code: room.code, deckId: 'st13-luffy' })).statusCode).toBe(200);
  });

  it('não dá para entrar na própria sala nem com código errado', async () => {
    const { app } = setup();
    const created = (await app.inject({ method: 'POST', url: '/api/online/rooms', headers: ALICE, payload: { deckId: 'st01-luffy', format: 'egb' } })).json();
    const self = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: ALICE, payload: { code: created.code, deckId: 'st02-kid' } });
    expect(self.statusCode).toBe(409);
    const wrong = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code: 'ZZZZZZ', deckId: 'st02-kid' } });
    expect(wrong.statusCode).toBe(404);
    const noDeck = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: BOB, payload: { deckId: 'nope', format: 'egb' } });
    expect(noDeck.statusCode).toBe(400);
    // "Partida em andamento" devolve a sala de espera com o token.
    const active = (await app.inject({ url: '/api/online/active', headers: ALICE })).json();
    expect(active).toEqual([{ roomId: created.roomId, token: created.token, status: 'waiting', queue: 'private', code: created.code }]);
  });

  it('o lançamento do dado do sorteio chega ao oponente e a quem entra depois', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const c1 = client(1);
    room.attach(c1.conn);
    const dice = (t: string, payload: object) => app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/dice`, payload: { t, ...payload } });
    expect((await dice(tokens[0], { vx: 'x', vy: 1 })).statusCode).toBe(400);
    expect((await dice('nada', { vx: 1, vy: 1 })).statusCode).toBe(404);
    expect((await dice(tokens[0], { vx: 0.5, vy: -99 })).statusCode).toBe(204);
    // Só o primeiro lançamento vale (e a velocidade é limitada).
    expect((await dice(tokens[0], { vx: 3, vy: 3 })).statusCode).toBe(204);
    expect(c1.events.filter((e) => e.event === 'dice').map((e) => e.data)).toEqual([{ seat: 0, vx: 0.5, vy: -12 }]);
    // Quem conecta durante o sorteio recebe os dados já jogados.
    const late = client(null);
    room.attach(late.conn);
    expect(late.events.filter((e) => e.event === 'dice').map((e) => e.data)).toEqual([{ seat: 0, vx: 0.5, vy: -12 }]);
    // Depois do sorteio (partida em andamento), não há mais dados.
    room.state!.phase = 'main';
    expect((await dice(tokens[1], { vx: 1, vy: 1 })).statusCode).toBe(409);
  });

  it('o chat chega censurado ao oponente e aos espectadores, com limites de tamanho e frequência', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const c1 = client(1);
    const watcher = client(null);
    room.attach(c1.conn);
    room.attach(watcher.conn);
    const chat = (t: string, text: unknown) => app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/chat`, payload: { t, text } });
    expect((await chat('nada', 'oi')).statusCode).toBe(404);
    expect((await chat(tokens[0], 42)).statusCode).toBe(400);
    expect((await chat(tokens[0], '   \n ')).statusCode).toBe(400);
    expect((await chat(tokens[0], 'x'.repeat(121))).statusCode).toBe(400);
    expect((await chat(tokens[0], '  Boa   sorte,\nque porra é essa? ')).statusCode).toBe(204);
    const seen = (c: ReturnType<typeof client>) => c.events.filter((e) => e.event === 'chat').map((e) => e.data);
    expect(seen(c1)).toEqual([{ seat: 0, text: 'Boa sorte, que ***** é essa?' }]);
    expect(seen(watcher)).toEqual([{ seat: 0, text: 'Boa sorte, que ***** é essa?' }]);
    // Duas mensagens seguidas rápido demais: a segunda espera.
    const fast = await chat(tokens[0], 'de novo');
    expect(fast.statusCode).toBe(429);
    expect(fast.json().error).toMatch(/Espere/);
    expect(fast.json().errorCode).toBe('chatTooFast');
    // O outro assento tem o próprio limite.
    expect((await chat(tokens[1], 'gg')).statusCode).toBe(204);
    expect(seen(c1)).toHaveLength(2);
  });

  it('a partida sobrevive a um reinício do servidor', async () => {
    const db = freshDb();
    const first = setup(db).app;
    const { roomId, tokens } = await privateMatch(first);
    const c = client(0);
    getRoom(first, roomId).attach(c.conn);
    const w = actingPlayer(c.view!)!;
    await act(first, roomId, tokens[w], 0, { type: 'answer', player: w, yes: true });
    const p = w;
    await act(first, roomId, tokens[p], 1, { type: 'mulligan', player: p, redraw: true });
    const mine = client(p);
    getRoom(first, roomId).attach(mine.conn);
    const hand = mine.view!.players[p].hand;
    expect(hand.some((u) => u.startsWith('~'))).toBe(false);
    await first.close();

    const second = setup(db).app;
    const again = client(p);
    getRoom(second, roomId).attach(again.conn);
    expect(again.view!.actionCount).toBe(2);
    expect(again.view!.firstPlayer).toBe(w);
    // Mesmos apelidos e mesma mão depois de refazer as ações.
    expect(again.view!.players[p].hand).toEqual(hand);
    await second.close();
  });

  it('sala começada antes da versão 9 dos replays é refeita com a preparação antiga', async () => {
    const { app, db } = setup();
    const { roomId } = await privateMatch(app);
    const room = getRoom(app, roomId);
    expect(room.data.replayVersion).toBe(REPLAY_VERSION);
    let s = room.state!;
    s = applyAction(s, { type: 'answer', player: s.rollWinner!, yes: true });
    s = applyAction(s, { type: 'mulligan', player: s.firstPlayer, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: (1 - s.firstPlayer) as PlayerId, redraw: false });
    // Gravada sem o campo (antes desta versão): a Vida sai na ordem antiga, e o replay diz versão 8.
    const data = structuredClone(room.data);
    delete data.replayVersion;
    data.actions = [
      { type: 'answer', player: s.rollWinner!, yes: true },
      { type: 'mulligan', player: s.firstPlayer, redraw: false },
      { type: 'mulligan', player: (1 - s.firstPlayer) as PlayerId, redraw: false },
    ];
    const old = new Room(data, { cards: (ids) => getCards(db, ids), botDelayMs: 0 });
    expect(old.state!.legacySetup).toBe(true);
    expect(old.state!.players[0].life).toEqual([...s.players[0].life].reverse());
    old.dispose();
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
    const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'casual', format: 'egb' } })).json();
    expect((await app.inject(`/api/online/queue/${a.ticket}`)).json().status).toBe('waiting');
    const b = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: BOB, payload: { deckId: 'st02-kid', queue: 'casual', format: 'egb' } })).json();
    const ma = (await app.inject(`/api/online/queue/${a.ticket}`)).json();
    const mb = (await app.inject(`/api/online/queue/${b.ticket}`)).json();
    expect(ma.status).toBe('matched');
    expect(mb.roomId).toBe(ma.roomId);
    expect(ma.token).not.toBe(mb.token);
    // Já está numa partida: não entra em outra fila.
    const again = await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'casual', format: 'egb' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().roomId).toBe(ma.roomId);
  });

  it('ranqueada: só com login e sem cartas com efeito ainda não automatizado', async () => {
    const { app, db } = setup();
    const anon = await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'ranked', format: 'egb' } });
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
    const manual = await app.inject({ method: 'POST', url: '/api/online/queue', headers: zoro, payload: { deckId: deck.id, queue: 'ranked', format: 'egb' } });
    expect(manual.statusCode).toBe(400);
    expect(manual.json().error).toContain('manual');
    // No casual, o mesmo deck pode.
    expect((await app.inject({ method: 'POST', url: '/api/online/rooms', headers: zoro, payload: { deckId: deck.id, format: 'egb' } })).statusCode).toBe(201);

    const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: zoro, payload: { deckId: 'st01-luffy', queue: 'ranked', format: 'egb' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: sanji, payload: { deckId: 'st02-kid', queue: 'ranked', format: 'egb' } })).json();
    const ma = (await app.inject(`/api/online/queue/${a.ticket}`)).json();
    const mb = (await app.inject(`/api/online/queue/${b.ticket}`)).json();
    expect(ma.status).toBe('matched');
    const room = getRoom(app, ma.roomId);
    const c = client(0);
    room.attach(c.conn);
    const p = actingPlayer(c.view!)!;
    const t = p === 0 ? ma.token : mb.token;
    // Desistência na ranqueada mexe na recompensa.
    await act(app, ma.roomId, t, 0, { type: 'concede', player: p });
    const diff = c.room.result.bounty.map((s: { before: number; after: number }) => s.after - s.before);
    expect(diff[1 - p]).toBe(1000);
    expect(diff[p]).toBe(0);
  });
});

describe('partidas online: contadores do menu', () => {
  it('conta quem está no menu, na fila, jogando e assistindo, sem dados de quem joga', async () => {
    const { app } = setup();
    const empty = (await app.inject('/api/online/stats')).json();
    expect(empty).toEqual({
      online: 0,
      playing: { private: 0, casual: 0, ranked: 0, bot: 0, tournament: 0 },
      waiting: 0,
      queue: { casual: { standard: 0, egb: 0 }, ranked: { standard: 0, egb: 0 } },
      spectators: 0,
    });

    // A consulta do menu é o sinal de presença (o mesmo navegador conta uma vez só).
    await app.inject({ url: '/api/online/stats', headers: ALICE });
    expect((await app.inject({ url: '/api/online/stats', headers: ALICE })).json().online).toBe(1);

    const carol = { 'x-deck-owner': 'carol-0123456789abcdef' };
    const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: carol, payload: { deckId: 'st01-luffy', queue: 'casual', format: 'egb' } })).json();
    const s1 = (await app.inject('/api/online/stats')).json();
    expect(s1.queue.casual.egb).toBe(1);
    expect(s1.online).toBe(2);

    // Sala privada esperando o segundo jogador.
    await app.inject({ method: 'POST', url: '/api/online/rooms', headers: BOB, payload: { deckId: 'st02-kid', format: 'egb' } });
    expect((await app.inject('/api/online/stats')).json().waiting).toBe(1);

    const dave = { 'x-deck-owner': 'dave-0123456789abcdef00' };
    const b = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: dave, payload: { deckId: 'st02-kid', queue: 'casual', format: 'egb' } })).json();
    const m = (await app.inject(`/api/online/queue/${a.ticket}`)).json();
    await app.inject(`/api/online/queue/${b.ticket}`);
    const room = getRoom(app, m.roomId);
    room.attach(client(0).conn);
    room.attach(client(null).conn);
    const s2 = (await app.inject('/api/online/stats')).json();
    expect(s2.playing.casual).toBe(1);
    expect(s2.queue.casual.egb).toBe(0);
    expect(s2.spectators).toBe(1);
    // Alice (menu), Bob (sala esperando, sem canal aberto: não conta), Carol (conectada à partida) e o espectador.
    expect(s2.online).toBe(3);
    expect(JSON.stringify(s2)).not.toContain('carol');
  });

  it('quem fecha o menu some dos conectados depois de 30 s', () => {
    let t = 1_000_000;
    const db = freshDb();
    const l = new Lobby({ cards: (ids) => getCards(db, ids) as CardData[], now: () => t });
    l.touch('a');
    l.touch('b');
    expect(l.stats().online).toBe(2);
    t += 20_000;
    l.touch('b');
    t += 15_000;
    expect(l.stats().online).toBe(1);
    t += 30_000;
    expect(l.stats().online).toBe(0);
  });
});

describe('partidas online: cancelar a ação e devolver DON!!', () => {
  it('o DON!! anexado volta pela visão e o cancelamento é refeito pelo servidor para os dois lados', async () => {
    const { app, db } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const cs = [client(0), client(1)];
    for (const c of cs) room.attach(c.conn);
    const view = (p: PlayerId) => cs[p].view!;
    const step = async (p: PlayerId, action: Action, code = 200) => {
      const r = await act(app, roomId, tokens[p], view(p).actionCount, action);
      expect(r.statusCode, r.body).toBe(code);
      return r;
    };
    /** O bot joga (pelas visões) até a vez voltar para a cadeira 0 com a mesa parada. */
    const untilMyTurn = async () => {
      for (let i = 0; i < 500; i++) {
        const v = view(0);
        if (v.phase === 'gameover') throw new Error('a partida acabou cedo demais');
        if (actingPlayer(v) === 0 && !v.pending) return;
        const p = actingPlayer(v)!;
        await step(p, chooseBotAction(view(p), p));
      }
    };
    // O Luffy (cadeira 0) começa: a habilidade do Líder dele pede um alvo na mesa.
    {
      const v = view(0);
      const w = actingPlayer(v)!;
      await step(w, { type: 'answer', player: w, yes: w === 0 });
    }
    for (let i = 0; i < 2; i++) {
      const p = actingPlayer(view(0))!;
      await step(p, { type: 'mulligan', player: p, redraw: false });
    }
    expect(view(0).activePlayer).toBe(0);
    const leader = () => view(0).players[0].leader;

    // Anexa o único DON!! ao Líder: as duas visões mostram que ele ainda pode voltar.
    await step(0, { type: 'attachDon', player: 0, target: leader().uid });
    expect(leader()).toMatchObject({ don: 1, donLoose: 1 });
    expect(view(1).players[0].leader.donLoose).toBe(1);
    // Devolve pelo apelido da visão; o oponente não pode devolver o DON!! dos outros.
    await step(1, { type: 'detachDon', player: 1, target: view(1).players[0].leader.uid }, 422);
    await step(0, { type: 'detachDon', player: 0, target: leader().uid });
    expect(leader().don).toBe(0);
    expect(view(0).players[0].donActive).toBe(1);
    expect(view(0).log[view(0).log.length - 1].text).toMatch(/devolve 1 DON!!/);
    await step(0, { type: 'attachDon', player: 0, target: leader().uid });
    await step(0, { type: 'endTurn', player: 0 });

    // A habilidade do Luffy dá 1 DON!! virado: precisa de um DON!! virado (jogar um Personagem vira DON!!).
    let ready = false;
    for (let turn = 0; turn < 8 && !ready; turn++) {
      await untilMyTurn();
      const v = view(0);
      const play = legalActions(v, 0).find((a) => a.type === 'playCard' && v.defs[v.cards[a.uid].cardId].category === 'character');
      if (play) {
        await step(0, play);
        await untilMyTurn();
        ready = view(0).players[0].donRested > 0;
      }
      if (!ready) await step(0, { type: 'endTurn', player: 0 });
    }
    expect(ready).toBe(true);

    // Ativa a habilidade do Líder (pede um alvo): os dois veem que a ação pode ser cancelada,
    // mas sem o estado guardado, e só o dono pode cancelar.
    const before = view(0);
    await step(0, { type: 'activate', player: 0, uid: leader().uid, ability: 0 });
    expect(view(0).pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect(view(0).cancel).toEqual({ player: 0, action: { type: 'activate', player: 0, uid: leader().uid, ability: 0 } });
    expect(view(1).cancel).toMatchObject({ player: 0, action: { type: 'activate', player: 0 } });
    expect(view(0).checkpoint).toBeUndefined();
    expect(view(1).checkpoint).toBeUndefined();
    expect(JSON.stringify(view(1))).not.toContain('snap');
    await step(1, { type: 'cancel', player: 1 }, 422);
    await step(0, { type: 'cancel', player: 0 });
    for (const p of [0, 1] as const) {
      const v = view(p);
      expect(v.actionCount).toBe(before.actionCount + 2);
      expect(v.pending).toBeNull();
      expect(v.cancel).toBeUndefined();
      expect(v.usedThisTurn).toEqual([]);
      expect(v.players[0].donRested).toBe(before.players[0].donRested);
      expect(v.log[v.log.length - 1].text).toMatch(/cancela a ativação/);
    }
    // Depois do cancelamento a habilidade pode ser ativada de novo; cancelar fora de hora é recusado.
    await step(0, { type: 'activate', player: 0, uid: leader().uid, ability: 0 });
    expect(view(0).pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    await step(0, { type: 'choose', player: 0, uids: [] });
    expect(view(0).pending).toBeNull();
    await step(0, { type: 'cancel', player: 0 }, 422);

    // O replay guarda as ações como foram feitas (cancel e detachDon inclusive): refazer a sala dá a mesma mesa.
    const types = room.data.actions.map((a) => a.type);
    expect(types).toContain('detachDon');
    expect(types).toContain('cancel');
    const again = new Room(structuredClone(room.data), { cards: (ids) => getCards(db, ids), botDelayMs: 0 });
    const strip = (st: GameState) => ({ ...st, defs: undefined, checkpoint: undefined });
    expect(strip(again.state!)).toEqual(strip(room.state!));
    again.dispose();
  }, 60_000);
});

describe('partidas online: ações manuais', () => {
  it('a ação `manual` (mexer na mesa à mão) é recusada para todos, inclusive Dev', async () => {
    const { app, db } = setup();
    const login = (sub: string) => {
      const u = upsertGoogleUser(db, { sub, email: `${sub}@example.com`, emailVerified: true, name: sub, picture: null });
      return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}` } };
    };
    const zoro = login('zoro');
    const sanji = login('sanji');
    const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: { ...ALICE, ...zoro.headers }, payload: { deckId: 'st01-luffy', queue: 'casual', format: 'egb' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: { ...BOB, ...sanji.headers }, payload: { deckId: 'st02-kid', queue: 'casual', format: 'egb' } })).json();
    const ma = (await app.inject(`/api/online/queue/${a.ticket}`)).json();
    const mb = (await app.inject(`/api/online/queue/${b.ticket}`)).json();
    expect(ma.status).toBe('matched');
    // Cadeira 0 = zoro, cadeira 1 = sanji.
    const seats = [{ ...zoro, token: ma.token }, { ...sanji, token: mb.token }];
    const room = getRoom(app, ma.roomId);
    const c = client(0);
    room.attach(c.conn);
    {
      const v = c.view!;
      const w = actingPlayer(v)!;
      expect((await act(app, ma.roomId, seats[w].token, v.actionCount, { type: 'answer', player: w, yes: true })).statusCode).toBe(200);
    }
    for (let i = 0; i < 2; i++) {
      const v = c.view!;
      const p = actingPlayer(v)!;
      expect((await act(app, ma.roomId, seats[p].token, v.actionCount, { type: 'mulligan', player: p, redraw: false })).statusCode).toBe(200);
    }
    expect(c.view!.phase).toBe('main');
    const p = actingPlayer(c.view!)!;
    setUserRole(db, seats[p].id, 'dev');
    const hand = c.view!.players[p].hand.length;
    const r = await app.inject({
      method: 'POST',
      url: `/api/online/rooms/${ma.roomId}/action`,
      headers: seats[p].headers,
      payload: { t: seats[p].token, seq: c.view!.actionCount, action: { type: 'manual', player: p, op: { op: 'draw', count: 1 } } },
    });
    expect(r.statusCode).toBe(400);
    expect(c.view!.players[p].hand.length).toBe(hand);
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

    // O vencedor do sorteio escolhe jogar primeiro (na hora: o relógio continua com ele).
    room.act(first, 0, { type: 'answer', player: first, yes: true });
    // Mulligan do primeiro: agora é a vez do outro, e o relógio do primeiro para.
    room.act(first, 1, { type: 'mulligan', player: first, redraw: false });
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

describe('modo espectador', () => {
  const login = (db: DB, sub: string, role: Role = 'player') => {
    const u = upsertGoogleUser(db, { sub, email: `${sub}@example.com`, emailVerified: true, name: sub, picture: null });
    setUserRole(db, u.id, role);
    return { cookie: `gg_session=${createSession(db, u.id)}`, id: u.id };
  };
  const hidden = (v: GameState, p: PlayerId) => v.players[p].hand.every((u) => v.cards[u].cardId === HIDDEN_CARD);

  it('espectador vê a mesa sem as mãos; com "ver mãos", vê as duas (mas não os decks)', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const player = client(0);
    const watcher = client(null);
    const streamer = client(null, true);
    for (const c of [player, watcher, streamer]) room.attach(c.conn);
    expect(watcher.room.you).toBeNull();
    expect(watcher.room.spectators).toBe(1);
    expect(watcher.events.filter((e) => e.event === 'presence').pop()!.data.spectators).toBe(2);
    expect(player.events.filter((e) => e.event === 'presence').pop()!.data.spectators).toBe(2);
    const w = watcher.view!;
    expect(hidden(w, 0) && hidden(w, 1)).toBe(true);
    const s = streamer.view!;
    expect(s.players[0].hand.length).toBeGreaterThan(0);
    expect(s.players.every((p) => p.hand.every((u) => s.cards[u].cardId !== HIDDEN_CARD))).toBe(true);
    expect(s.players.every((p) => p.deck.every((u) => s.cards[u].cardId === HIDDEN_CARD))).toBe(true);
    // O espectador acompanha as jogadas.
    const first = actingPlayer(w)!;
    await act(app, roomId, tokens[first], 0, { type: 'answer', player: first, yes: true });
    await act(app, roomId, tokens[first], 1, { type: 'mulligan', player: first, redraw: true });
    expect(watcher.view!.actionCount).toBe(2);
    expect(hidden(watcher.view!, first)).toBe(true);
    room.detach(watcher.conn);
    expect(room.spectators).toBe(1);
  });

  it('lista de partidas: filas e treino contra o bot aparecem; salas privadas só pelo código', async () => {
    const { app, db } = setup();
    const { roomId } = await privateMatch(app);
    const code = getRoom(app, roomId).data.code!;
    const carolLogin = { 'x-deck-owner': 'carol-0123456789abcdef', cookie: login(db, 'carol').cookie };
    const bot = await app.inject({ method: 'POST', url: '/api/online/bot', headers: carolLogin, payload: { deckId: 'st01-luffy', botDeckId: 'st02-kid', format: 'egb' } });
    expect(bot.statusCode, bot.body).toBe(201);
    const live = (await app.inject('/api/online/live')).json();
    expect(live.hands).toBe(false);
    expect(live.rooms.map((r: { id: string }) => r.id)).toEqual([bot.json().roomId]);
    expect(live.rooms[0].players.map((p: { name: string; bot: boolean }) => p.bot)).toEqual([false, true]);
    expect(live.rooms[0].mine).toBe(false);
    expect((await app.inject({ url: '/api/online/live', headers: carolLogin })).json().rooms[0].mine).toBe(true);
    expect((await app.inject(`/api/online/watch/${code}`)).json().id).toBe(roomId);
    expect((await app.inject('/api/online/watch/ZZZZZZ')).statusCode).toBe(404);
    const streamer = login(db, 'nami', 'streamer');
    expect((await app.inject({ url: '/api/online/live', headers: { cookie: streamer.cookie } })).json().hands).toBe(true);

    // Com o treino desligado, as salas contra o bot somem da lista e não podem ser criadas.
    const off = setup(freshDb(), { onlineBotRooms: false }).app;
    expect((await off.inject('/api/online/config')).json().botRooms).toBe(false);
    const refused = await off.inject({ method: 'POST', url: '/api/online/bot', headers: ALICE, payload: { deckId: 'st01-luffy', format: 'egb' } });
    expect(refused.statusCode).toBe(404);
  });

  it('transmitir o treino contra o bot: só com login; "Quem começa" vale na sala do servidor', async () => {
    const { app, db } = setup();
    const anon = await app.inject({ method: 'POST', url: '/api/online/bot', headers: ALICE, payload: { deckId: 'st01-luffy', botDeckId: 'st02-kid', format: 'egb' } });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error).toMatch(/conta Google/);
    expect((await app.inject('/api/online/live')).json().rooms).toEqual([]);

    const open = async (headers: Record<string, string>, first?: unknown) => {
      const r = await app.inject({ method: 'POST', url: '/api/online/bot', headers, payload: { deckId: 'st01-luffy', botDeckId: 'st02-kid', format: 'egb', first } });
      expect(r.statusCode, r.body).toBe(201);
      const room = getRoom(app, r.json().roomId);
      return { room, state: room.state! };
    };
    // O jogador começa: sem sorteio, direto no mulligan dele.
    const mine = await open({ ...ALICE, cookie: login(db, 'zoro').cookie }, 0);
    expect(mine.room.data.firstPlayer).toBe(0);
    expect(mine.state.firstPlayer).toBe(0);
    expect(mine.state.rollWinner).toBeUndefined();
    expect(mine.state.pending).toMatchObject({ kind: 'mulligan', player: 0 });
    // O bot começa.
    const theirs = await open({ ...BOB, cookie: login(db, 'sanji').cookie }, 1);
    expect(theirs.state.firstPlayer).toBe(1);
    expect(theirs.state.rollWinner).toBeUndefined();
    // Sorteio (ou valor inválido): o vencedor escolhe, como antes.
    const roll = await open({ 'x-deck-owner': 'carol-0123456789abcdef', cookie: login(db, 'carol').cookie }, 'random');
    expect(roll.room.data.firstPlayer).toBeUndefined();
    expect(roll.state.rollWinner).toBeDefined();
    expect(roll.state.pending?.kind).toBe('chooseFirst');
    expect((await app.inject('/api/online/live')).json().rooms).toHaveLength(3);
  });

  it('o bot do servidor joga a partida inteira e ela entra nas estatísticas como partida contra o bot', async () => {
    const { app, db } = setup();
    const r = await app.inject({ method: 'POST', url: '/api/online/bot', headers: { ...ALICE, cookie: login(db, 'zoro').cookie }, payload: { deckId: 'st03-crocodile', botDeckId: 'random', format: 'egb', first: 0 } });
    expect(r.statusCode, r.body).toBe(201);
    const { roomId, token } = r.json();
    const room = getRoom(app, roomId);
    const me = client(0);
    const watcher = client(null);
    room.attach(me.conn);
    room.attach(watcher.conn);
    expect(me.room.players[1]).toMatchObject({ bot: true, connected: true });
    for (let i = 0; i < 4000 && me.view!.phase !== 'gameover'; i++) {
      const v = me.view!;
      if (actingPlayer(v) === 0) {
        const res = await act(app, roomId, token, v.actionCount, chooseBotAction(v, 0));
        expect(res.statusCode, res.body).toBe(200);
      } else await new Promise((done) => setTimeout(done, 1));
    }
    expect(watcher.view!.phase).toBe('gameover');
    const seats = db.prepare('SELECT controller FROM match_seats ORDER BY seat').all();
    expect(seats).toEqual([{ controller: 'human' }, { controller: 'bot' }]);
    expect((db.prepare('SELECT mode FROM matches').get() as { mode: string }).mode).toBe('bot');
    // Depois do fim, o espectador também baixa o replay.
    expect((await app.inject(`/api/online/rooms/${roomId}/replay`)).statusCode).toBe(200);
  }, 120_000);

  it('ver mãos: só streamer ou admin, e nunca na própria partida', async () => {
    const { app, db } = setup();
    const nami = login(db, 'nami', 'streamer');
    const usopp = login(db, 'usopp');
    const created = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: { ...ALICE, cookie: nami.cookie }, payload: { deckId: 'st01-luffy', format: 'egb' } });
    const { roomId, code } = created.json();
    await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code, deckId: 'st02-kid' } });
    const admin = login(db, 'robin', 'admin');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const open = async (cookie?: string, hands = true) => {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${roomId}/watch${hands ? '?hands=1' : ''}`, {
        signal: ctrl.signal,
        headers: cookie ? { cookie } : {},
      });
      const status = res.status;
      ctrl.abort();
      return status;
    };
    expect(await open()).toBe(403);
    expect(await open(usopp.cookie)).toBe(403);
    expect(await open(nami.cookie)).toBe(403); // nami joga esta partida
    expect(await open(nami.cookie, false)).toBe(200);
    expect(await open(admin.cookie)).toBe(200);
    expect(await open(undefined, false)).toBe(200);
    // A lista avisa quem joga a partida, para assistir sem pedir as mãos.
    const byCode = async (cookie: string) => (await app.inject({ url: `/api/online/watch/${code}`, headers: { cookie } })).json().mine;
    expect(await byCode(nami.cookie)).toBe(true);
    expect(await byCode(admin.cookie)).toBe(false);
    await app.close();
  });

  it('revanche: os espectadores seguem para a sala nova', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    const watcher = client(null);
    room.attach(watcher.conn);
    await act(app, roomId, tokens[0], 0, { type: 'concede', player: 0 });
    for (const t of tokens) await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/rematch`, payload: { t } });
    const msg = watcher.events.find((e) => e.event === 'rematch')!.data;
    expect(msg.token).toBeUndefined();
    expect(getRoom(app, msg.roomId).status).toBe('playing');
  });
});

function getRoom(app: App, id: string) {
  const room = (app as unknown as { onlineLobby: Lobby }).onlineLobby.get(id);
  if (!room) throw new Error('sala não encontrada');
  return room;
}
