import {
  type Action,
  actingPlayer,
  applyAction,
  type CardData,
  type CardDef,
  chooseSimpleBotAction as chooseBotAction,
  deckOfPlayer,
  type GameState,
  HIDDEN_CARD,
  legalActions,
  type LogEntry,
  type PlayerId,
  REPLAY_VERSION,
} from '@gumgum/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, getUser, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { broadcastView, DEFAULT_SETTINGS, handsDelayFor } from '../src/online/broadcast';
import type { ServerOptions } from '../src/config';
import { type DB, getCards, getDeck, openDb, upsertCards } from '../src/db';
import { LEADER_PICK_MS, Lobby, type SeatRequest } from '../src/online/lobby';
import { ABANDON_MS, type Connection, HANDS_DELAY_MS, Room, TIME_BANK_MS } from '../src/online/room';
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
    // Antes da escolha de quem começa, nem a própria mão aparece; os decks, nunca.
    expect(v0.players[0].hand.every((u) => v0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v0.players[0].deck.every((u) => v0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(v0.seed).toBe(0);

    // O vencedor do sorteio escolhe quem começa (os dois veem a escolha pendente).
    const winner = actingPlayer(v0)!;
    expect(v0.pending).toEqual({ kind: 'chooseFirst', player: winner });
    expect(v1.pending).toEqual({ kind: 'chooseFirst', player: winner });
    expect((await act(app, roomId, tokens[winner], 0, { type: 'answer', player: winner, yes: false })).statusCode).toBe(200);
    const first = (1 - winner) as PlayerId;
    const other = winner;
    expect(c0.view!.firstPlayer).toBe(first);
    // Depois dela, minha mão aparece; a do oponente, não.
    const w0 = c0.view!;
    const w1 = c1.view!;
    expect(w0.players[0].hand.every((u) => w0.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
    expect(w0.players[1].hand.every((u) => w0.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(w1.players[0].hand.every((u) => w1.cards[u].cardId === HIDDEN_CARD)).toBe(true);
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

  it('Livre (vale tudo) nas salas privadas: banidas e rotacionadas valem; a fila não tem Livre', async () => {
    const { app } = setup();
    const post = (url: string, headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers, payload });
    const room = await post('/api/online/rooms', ALICE, { deckId: 'st10-law', format: 'free', spoilers: false });
    expect(room.statusCode).toBe(201);
    expect((await post('/api/online/rooms/join', BOB, { code: room.json().code, deckId: 'st01-luffy' })).statusCode).toBe(200);
    const info = (await app.inject({ url: `/api/online/rooms/${room.json().roomId}` })).json();
    expect(info).toMatchObject({ format: 'free', spoilers: true });
    // Na fila, "free" não é formato: vale o Standard (o padrão).
    const queue = await post('/api/online/queue', ALICE, { deckId: 'st10-law', queue: 'casual', format: 'free' });
    expect(queue.json()).toMatchObject({ errorCode: 'deckNotAllowedInFormat', errorParams: { format: 'Standard' } });
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

  it('quem fica um tempo sem consultar (celular em segundo plano) continua na fila; o par se repete até ser entregue', () => {
    let t = 1_000_000;
    const db = freshDb();
    const l = new Lobby({ cards: (ids) => getCards(db, ids) as CardData[], now: () => t });
    const seat = (name: string, deckId: string): SeatRequest => ({ ownerHash: name, userId: null, name, bounty: 0, tier: 'east-blue', deckId, deck: getDeck(db, deckId)! });
    const join = (name: string, deckId: string) => {
      const r = l.enqueue(seat(name, deckId), 'egb', 'casual');
      if ('error' in r) throw new Error(r.error);
      return r.ticket;
    };
    const a = join('a', 'st01-luffy');
    // A página da Alice fica parada por 1 minuto; o Bob chega e forma par com ela.
    t += 60_000;
    expect(l.stats().queue.casual.egb).toBe(1);
    const b = join('b', 'st02-kid');
    const mb = l.poll(b);
    expect(mb?.status).toBe('matched');
    // A resposta se perdeu na rede: a próxima consulta recebe o mesmo par.
    expect(l.poll(b)).toEqual(mb);
    t += 30_000;
    const ma = l.poll(a);
    expect(ma?.status === 'matched' && mb?.status === 'matched' && ma.roomId === mb.roomId).toBe(true);

    // Sem consultar por mais de 2 minutos, sai da fila.
    t += 3 * 60_000;
    const c = join('c', 'st03-crocodile');
    t += 2 * 60_000 + 1;
    l.sweep();
    expect(l.poll(c)).toBeNull();
    expect(l.poll(a)).toBeNull();
    l.dispose();
  });

  describe('casual: escolher o Líder do oponente', () => {
    const seat = (name: string, deckId: string, db: DB): SeatRequest => {
      const d = getDeck(db, deckId)!;
      return { ownerHash: name, userId: null, name, bounty: 0, tier: 'east-blue', deckId, deck: d };
    };
    function queueLobby() {
      const clock = { t: 1_000_000 };
      const db = freshDb();
      const l = new Lobby({ cards: (ids) => getCards(db, ids) as CardData[], now: () => clock.t });
      const join = (name: string, deckId: string, leader: string | null = null) => {
        const r = l.enqueue(seat(name, deckId, db), 'egb', 'casual', null, leader);
        if ('error' in r) throw new Error(r.error);
        return r.ticket;
      };
      /** Passa o tempo com todos consultando a fila a cada 5 s, como o navegador faz. */
      const wait = (ms: number, tickets: string[]) => {
        for (let left = ms; left > 0; left -= 5_000) {
          clock.t += Math.min(5_000, left);
          for (const t of tickets) l.poll(t);
        }
      };
      return { l, clock, join, wait };
    }

    it('no primeiro minuto só forma par com o Líder escolhido', () => {
      const { l, join } = queueLobby();
      const a = join('a', 'st01-luffy', 'ST02-001');
      const c = join('c', 'st03-crocodile');
      expect(l.poll(a)).toMatchObject({ status: 'waiting', wantLeader: 'ST02-001', leaderWait: LEADER_PICK_MS });
      expect(l.poll(c)?.status).toBe('waiting');
      const b = join('b', 'st02-kid');
      const ma = l.poll(a);
      const mb = l.poll(b);
      expect(ma?.status).toBe('matched');
      expect(mb?.status === 'matched' && ma?.status === 'matched' && mb.roomId === ma.roomId).toBe(true);
      expect(l.poll(c)?.status).toBe('waiting');
      l.dispose();
    });

    it('quem escolheu tem prioridade sobre quem chegou antes sem escolher', () => {
      const { l, join } = queueLobby();
      // A Carol (sem escolha) chegou primeiro, mas o Kid fica com quem pediu por ele.
      const c = join('c', 'st03-crocodile');
      const a = join('a', 'st01-luffy', 'ST02-001');
      const b = join('b', 'st02-kid');
      const ma = l.poll(a);
      const mb = l.poll(b);
      expect(ma?.status === 'matched' && mb?.status === 'matched' && ma.roomId === mb.roomId).toBe(true);
      expect(l.poll(c)?.status).toBe('waiting');
      l.dispose();
    });

    it('depois de 1 minuto sem o Líder escolhido, joga contra quem estiver na fila', () => {
      const { l, join, wait } = queueLobby();
      const a = join('a', 'st01-luffy', 'ST02-001');
      const c = join('c', 'st03-crocodile');
      wait(45_000, [a, c]);
      expect(l.poll(a)).toMatchObject({ status: 'waiting', leaderWait: LEADER_PICK_MS - 45_000 });
      wait(10_000, [a, c]);
      expect(l.poll(a)?.status).toBe('waiting');
      wait(5_000, []);
      const ma = l.poll(a);
      const mc = l.poll(c);
      expect(ma?.status === 'matched' && mc?.status === 'matched' && ma.roomId === mc.roomId).toBe(true);
      l.dispose();
    });

    it('a escolha vale para os dois lados', () => {
      const { l, join, wait } = queueLobby();
      // A Alice quer o Kid, mas o Bob (Kid) quer o Crocodile: só formam par quando a escolha do Bob expira.
      const a = join('a', 'st01-luffy', 'ST02-001');
      wait(30_000, [a]);
      const b = join('b', 'st02-kid', 'ST03-001');
      expect(l.poll(a)?.status).toBe('waiting');
      expect(l.poll(b)?.status).toBe('waiting');
      // A escolha da Alice expira, mas o Bob ainda espera o Crocodile.
      wait(55_000, [a, b]);
      expect(l.poll(a)?.status).toBe('waiting');
      wait(5_000, []);
      expect(l.poll(a)?.status).toBe('matched');
      expect(l.poll(b)?.status).toBe('matched');
      l.dispose();
    });

    it('rotas: lista de Líderes por formato e recusa de Líder inválido', async () => {
      const { app } = setup();
      const egb = (await app.inject('/api/online/leaders?format=egb')).json() as Array<{ id: string; queue: number }>;
      expect(egb.map((c) => c.id)).toContain('ST01-001');
      expect(egb.every((c) => c.queue === 0)).toBe(true);
      // Bloco ①: o ST01-001 rotacionou no Standard.
      const std = (await app.inject('/api/online/leaders?format=standard')).json() as Array<{ id: string }>;
      expect(std.map((c) => c.id)).not.toContain('ST01-001');

      const notLeader = await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'casual', format: 'egb', leader: 'ST01-002' } });
      expect(notLeader.statusCode).toBe(400);
      expect(notLeader.json().errorCode).toBe('invalidLeaderPick');
      const rotated = await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st08-luffy', queue: 'casual', format: 'standard', leader: 'ST01-001' } });
      expect(rotated.statusCode).toBe(400);

      const a = (await app.inject({ method: 'POST', url: '/api/online/queue', headers: ALICE, payload: { deckId: 'st01-luffy', queue: 'casual', format: 'egb', leader: 'ST02-001' } })).json();
      expect((await app.inject(`/api/online/queue/${a.ticket}`)).json()).toMatchObject({ status: 'waiting', wantLeader: 'ST02-001' });
      const after = (await app.inject('/api/online/leaders?format=egb')).json() as Array<{ id: string; queue: number }>;
      expect(after.find((c) => c.id === 'ST01-001')?.queue).toBe(1);
    });
  });

  it('ranqueada: só cartas lançadas; spoilers valem no casual e, da próxima coleção, nas salas privadas', async () => {
    const { app, db } = setup();
    const u = upsertGoogleUser(db, { sub: 'nami', email: 'nami@example.com', emailVerified: true, name: 'nami', picture: null });
    const nami = { ...ALICE, cookie: `gg_session=${createSession(db, u.id)}` };
    // Uma carta do deck, com outro número e marcada como spoiler (ainda não lançada).
    const luffy = getDeck(db, 'st01-luffy')!;
    const [base] = getCards(db, [luffy.cards[0].id]) as CardData[];
    upsertCards(db, [{ ...base, id: 'OP99-001', spoiler: { source: 'teste' } }], { provisional: true, source: 'spoiler:teste.json' });
    const cards = luffy.cards.map((c, i) => (i === 0 ? { id: 'OP99-001', count: c.count } : c));
    const deck = (await app.inject({ method: 'POST', url: '/api/decks', headers: nami, payload: { name: 'Spoiler', leader: luffy.leader, cards } })).json();
    const summary = (await app.inject({ url: '/api/decks', headers: nami })).json().find((d: { id: string }) => d.id === deck.id);
    expect(summary).toMatchObject({ valid: true, spoilers: ['OP99-001'] });
    expect(summary.formats.egb).toEqual([]);

    const ranked = await app.inject({ method: 'POST', url: '/api/online/queue', headers: nami, payload: { deckId: deck.id, queue: 'ranked', format: 'egb' } });
    expect(ranked.statusCode).toBe(400);
    expect(ranked.json()).toMatchObject({ errorCode: 'deckHasSpoilers', errorParams: { n: 1, ids: 'OP99-001' } });
    expect(ranked.json().error).toMatch(/ainda não foram lançadas/);
    // Casual e sala privada aceitam o mesmo deck.
    const casual = await app.inject({ method: 'POST', url: '/api/online/queue', headers: nami, payload: { deckId: deck.id, queue: 'casual', format: 'egb' } });
    expect(casual.statusCode).toBe(201);
    await app.inject({ method: 'DELETE', url: `/api/online/queue/${casual.json().ticket}` });
    // Sala privada "+ spoilers": só a próxima coleção a ser lançada (EB05, pela data do arquivo data/spoilers).
    upsertCards(db, [{ ...base, id: 'EB05-001', spoiler: { source: 'teste' } }], { provisional: true, source: 'spoiler:teste.json' });
    expect((await app.inject({ url: '/api/config' })).json().spoilerSet).toBe('EB05');
    const other = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: BOB, payload: { deckId: deck.id, format: 'egb' } });
    expect(other.json()).toMatchObject({ errorCode: 'deckHasOtherSetSpoilers', errorParams: { n: 1, ids: 'OP99-001', set: 'EB05' } });
    const eb05 = luffy.cards.map((c, i) => (i === 0 ? { id: 'EB05-001', count: c.count } : c));
    const next = (await app.inject({ method: 'POST', url: '/api/decks', headers: BOB, payload: { name: 'EB05', leader: luffy.leader, cards: eb05 } })).json();
    const room = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: BOB, payload: { deckId: next.id, format: 'egb' } });
    expect(room.statusCode).toBe(201);
    // Quem entra segue a coleção gravada na sala.
    const joinOther = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: nami, payload: { code: room.json().code, deckId: deck.id } });
    expect(joinOther.json()).toMatchObject({ errorCode: 'deckHasOtherSetSpoilers', errorParams: { set: 'EB05' } });
    expect((await app.inject({ url: `/api/online/rooms/${room.json().roomId}` })).json()).toMatchObject({ spoilers: true, spoilerSet: 'EB05' });
    // No Livre, qualquer coleção (a sala nova substitui a que esperava oponente).
    expect((await app.inject({ method: 'POST', url: '/api/online/rooms', headers: BOB, payload: { deckId: deck.id, format: 'free' } })).statusCode).toBe(201);
    // Sala privada sem spoilers (EGB puro): quem cria escolhe; quem entra segue a escolha.
    const pure = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: nami, payload: { deckId: deck.id, format: 'egb', spoilers: false } });
    expect(pure.json()).toMatchObject({ errorCode: 'deckHasSpoilers' });
    const kid = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: nami, payload: { deckId: 'st02-kid', format: 'egb', spoilers: false } });
    expect(kid.statusCode).toBe(201);
    const join = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code: kid.json().code, deckId: deck.id } });
    expect(join.json()).toMatchObject({ errorCode: 'deckHasSpoilers' });
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
    const r = l.createPrivate(seat('a', 'st01-luffy', db), { format: 'standard', spoilers: true });
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

  it('partida de torneio: o fim não revela a lista do oponente e o replay não sai da sala', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    room.data.queue = 'tournament';
    const cs = [client(0), client(1)];
    const watcher = client(null);
    for (const c of [...cs, watcher]) room.attach(c.conn);
    const loser = actingPlayer(cs[0].view!)!;
    expect((await act(app, roomId, tokens[loser], cs[loser].view!.actionCount, { type: 'concede', player: loser })).statusCode).toBe(200);
    for (const c of [...cs, watcher]) expect(c.view!.phase).toBe('gameover');
    // Cada um vê o que via em jogo: a própria mão, nunca a mão e o deck do oponente (nem quem assiste).
    for (const p of [0, 1] as const) {
      const v = cs[p].view!;
      const opp = (1 - p) as PlayerId;
      expect(v.players[p].hand.every((u) => v.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
      expect(v.players[opp].hand.every((u) => v.cards[u].cardId === HIDDEN_CARD)).toBe(true);
      expect(v.players[opp].deck.every((u) => v.cards[u].cardId === HIDDEN_CARD)).toBe(true);
      expect(deckOfPlayer(v, opp)).toBeNull();
    }
    const w = watcher.view!;
    expect(w.players.every((ps) => ps.hand.every((u) => w.cards[u].cardId === HIDDEN_CARD))).toBe(true);
    // O replay (com as duas listas) fica na página do torneio, não na sala.
    const replay = await app.inject(`/api/online/rooms/${roomId}/replay?t=${tokens[0]}`);
    expect(replay.statusCode).toBe(403);
    expect(replay.json().errorCode).toBe('replayTournament');
  });

  it('jogador da vez desconectado por muito tempo perde por abandono', () => {
    vi.useFakeTimers();
    let t = 0;
    const db = freshDb();
    const l = lobby(db, () => t);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), { format: 'standard', spoilers: true });
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

  it('quem vê as mãos assiste à mesa atrasada: ações, chat e resultado chegam depois do atraso', () => {
    vi.useFakeTimers();
    let t = 1_000_000;
    const step = (ms: number) => {
      t += ms;
      vi.advanceTimersByTime(ms);
    };
    const db = freshDb();
    const l = lobby(db, () => t);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), { format: 'standard', spoilers: true });
    if ('error' in r) throw new Error(r.error);
    l.joinPrivate(r.room.data.code!, seat('b', 'st02-kid', db));
    const room = r.room;
    // As mãos dos jogadores só aparecem nas partidas de torneio.
    room.data.queue = 'tournament';
    const players = [client(0), client(1)];
    const watcher = client(null);
    const streamer = client(null, true);
    for (const c of [...players, watcher, streamer]) room.attach(c.conn);
    expect(streamer.room.delay).toBe(HANDS_DELAY_MS);
    expect(watcher.room.delay).toBe(0);
    const s0 = streamer.view!;
    expect(s0.players.every((p) => p.hand.every((u) => s0.cards[u].cardId !== HIDDEN_CARD))).toBe(true);
    const first = actingPlayer(room.state!)!;
    const other = (1 - first) as PlayerId;

    step(10_000);
    const actedAt = t;
    room.act(first, 0, { type: 'answer', player: first, yes: true });
    room.act(first, 1, { type: 'mulligan', player: first, redraw: false });
    room.chat(first, 'boa sorte');
    // Ao vivo: na hora. Com as mãos: nada ainda.
    expect(watcher.view!.actionCount).toBe(2);
    expect(watcher.events.some((e) => e.event === 'chat')).toBe(true);
    expect(streamer.view!.actionCount).toBe(0);
    expect(streamer.events.some((e) => e.event === 'chat')).toBe(false);
    expect(streamer.room.clock.remaining).toEqual([TIME_BANK_MS, TIME_BANK_MS]);
    // Quem chega agora para ver as mãos também começa atrás.
    const late = client(null, true);
    room.attach(late.conn);
    expect(late.view!.actionCount).toBe(0);

    step(HANDS_DELAY_MS - 1_000);
    expect(streamer.view!.actionCount).toBe(0);
    step(2_000);
    expect(t - HANDS_DELAY_MS).toBeGreaterThanOrEqual(actedAt);
    for (const c of [streamer, late]) {
      expect(c.view!.actionCount).toBe(2);
      // Um estado por ação (as animações acompanham), e o chat depois das ações que vieram antes dele.
      const kinds = c.events.filter((e) => e.event === 'state' || e.event === 'chat').map((e) => (e.event === 'chat' ? 'chat' : e.data.view.actionCount));
      expect(kinds.slice(-3)).toEqual([1, 2, 'chat']);
    }
    // O relógio é o daquele momento: o primeiro gastou 10 s antes de jogar.
    expect(streamer.room.clock.remaining[first]).toBe(TIME_BANK_MS - 10_000);
    expect(streamer.room.clock.running).toBe(other);

    room.act(other, 2, { type: 'concede', player: other });
    expect(watcher.room.status).toBe('finished');
    expect(streamer.room.status).toBe('playing');
    expect(streamer.room.result).toBeNull();
    step(HANDS_DELAY_MS + 1_000);
    expect(streamer.room.status).toBe('finished');
    expect(streamer.room.result).not.toBeNull();
    expect(streamer.view!.winner).toBe(first);
    l.dispose();
  });

  it('sala refeita sem o instante das ações: a mesa atrasada não mostra o presente antes da hora', () => {
    vi.useFakeTimers();
    let t = 5_000_000;
    const db = freshDb();
    const l = lobby(db, () => t);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), { format: 'standard', spoilers: true });
    if ('error' in r) throw new Error(r.error);
    l.joinPrivate(r.room.data.code!, seat('b', 'st02-kid', db));
    r.room.data.queue = 'tournament';
    const first = actingPlayer(r.room.state!)!;
    r.room.act(first, 0, { type: 'answer', player: first, yes: true });
    r.room.act(first, 1, { type: 'mulligan', player: first, redraw: false });
    t += 10 * 60_000;
    // Gravada antes do campo `timeline` (ou refeita por uma versão nova do motor).
    const { timeline: _, ...old } = JSON.parse(JSON.stringify(r.room.data));
    const restored = new Room(old, { cards: (ids) => getCards(db, ids) as CardData[], now: () => t });
    const streamer = client(null, true);
    restored.attach(streamer.conn);
    expect(restored.state!.actionCount).toBe(2);
    expect(streamer.view!.actionCount).toBe(0);
    t += HANDS_DELAY_MS + 1;
    vi.advanceTimersByTime(HANDS_DELAY_MS + 1);
    expect(streamer.view!.actionCount).toBe(2);
    restored.dispose();
    l.dispose();
  });

  it('atrasos diferentes ao mesmo tempo, e a mesa vista pelo streamer que joga (só a mão dele)', () => {
    vi.useFakeTimers();
    let t = 2_000_000;
    const step = (ms: number) => {
      t += ms;
      vi.advanceTimersByTime(ms);
    };
    const db = freshDb();
    const l = lobby(db, () => t);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), { format: 'standard', spoilers: true });
    if ('error' in r) throw new Error(r.error);
    l.joinPrivate(r.room.data.code!, seat('b', 'st02-kid', db));
    const room = r.room;
    // As mãos dos jogadores só aparecem nas partidas de torneio.
    room.data.queue = 'tournament';
    const players = [client(0), client(1)];
    const one = client(null, true);
    one.conn.delay = 60_000;
    const three = client(null, true);
    const mine = client(null);
    mine.conn.as = 1;
    mine.conn.delay = 60_000;
    // Ver as mãos ao vivo não existe: o mínimo vale mesmo pedindo 0.
    const live = client(null, true);
    live.conn.delay = 0;
    for (const c of [...players, one, three, mine, live]) room.attach(c.conn);
    expect([one, three, mine, live].map((c) => c.room.delay)).toEqual([60_000, HANDS_DELAY_MS, 60_000, 60_000]);
    expect(mine.room.pov).toBe(1);
    expect(mine.room.you).toBeNull();

    const first = actingPlayer(room.state!)!;
    room.act(first, 0, { type: 'answer', player: first, yes: true });
    step(61_000);
    // A visão do streamer que joga: a mão dele à mostra (já decidido quem começa), a do oponente escondida.
    const v = mine.view!;
    expect(v.players[1].hand.every((u) => v.cards[u].cardId !== HIDDEN_CARD)).toBe(true);
    expect(v.players[0].hand.every((u) => v.cards[u].cardId === HIDDEN_CARD)).toBe(true);
    expect(one.view!.actionCount).toBe(1);
    expect(mine.view!.actionCount).toBe(1);
    expect(live.view!.actionCount).toBe(1);
    expect(three.view!.actionCount).toBe(0);
    step(120_000);
    expect(three.view!.actionCount).toBe(1);
    // Sem ninguém com 1 min de atraso, aquela mesa some; as outras seguem.
    for (const c of [one, mine, live]) room.detach(c.conn);
    room.act(first, 1, { type: 'mulligan', player: first, redraw: false });
    step(HANDS_DELAY_MS + 1_000);
    expect(three.view!.actionCount).toBe(2);
    l.dispose();
  });
  it('torneio com mãos ao vivo: quem vê as mãos assiste em tempo real, com as duas mãos à vista', () => {
    const db = freshDb();
    const l = lobby(db, () => 1_000_000);
    const r = l.createPrivate(seat('a', 'st01-luffy', db), { format: 'standard', spoilers: true });
    if ('error' in r) throw new Error(r.error);
    l.joinPrivate(r.room.data.code!, seat('b', 'st02-kid', db));
    const room = r.room;
    room.data.queue = 'tournament';
    room.data.tournament = { id: 't-1', name: 'Liga', round: 1, label: 'Rodada 1', matchId: 1, game: 1, bestOf: 1, wins: {}, liveHands: true };
    const live = client(null, true);
    live.conn.delay = 0;
    const late = client(null, true);
    late.conn.delay = 120_000;
    const dflt = client(null, true);
    for (const c of [live, late, dflt]) room.attach(c.conn);
    // Sem atraso: mesa ao vivo e as duas mãos à vista; quem pediu atraso continua atrasado; sem escolha, o padrão.
    expect([live, late, dflt].map((c) => c.room.delay)).toEqual([0, 120_000, HANDS_DELAY_MS]);
    expect(live.room.handsLive).toBe(true);
    const v = live.view!;
    expect(v.players.every((p) => p.hand.every((u) => v.cards[u].cardId !== HIDDEN_CARD))).toBe(true);
    // A lista de quem assiste informa a liberação.
    expect(l.live({ bots: true })[0]!.handsLive).toBe(true);
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

  it('espectador vê a mesa sem as mãos; com "ver mãos", vê as duas (mas não os decks), só em partida de torneio', async () => {
    const { app } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const room = getRoom(app, roomId);
    // Fora do torneio, pedir as mãos não mostra nada a mais.
    const outside = client(null, true);
    room.attach(outside.conn);
    expect(outside.room.delay).toBe(0);
    expect(hidden(outside.view!, 0) && hidden(outside.view!, 1)).toBe(true);
    room.detach(outside.conn);
    room.data.queue = 'tournament';
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

  it('decks da sala para o painel de decklist: só streamer/admin, só com as mãos liberadas', async () => {
    const { app, db } = setup();
    const { roomId } = await privateMatch(app);
    const streamer = { cookie: login(db, 'nami', 'streamer').cookie };
    // Sala privada sem as mãos liberadas: nem o streamer vê os decks.
    expect((await app.inject(`/api/online/rooms/${roomId}/decks`)).statusCode).toBe(403);
    const closed = await app.inject({ url: `/api/online/rooms/${roomId}/decks`, headers: streamer });
    expect(closed.statusCode).toBe(403);
    expect(closed.json().errorCode).toBe('handsTournamentOnly');

    // Sala privada que liberou as mãos: os dois decks inteiros e as cartas usadas.
    const EVE = { 'x-deck-owner': 'eve-0123456789abcdef000' };
    const DAVE = { 'x-deck-owner': 'dave-0123456789abcdef00' };
    const created = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: EVE, payload: { deckId: 'st01-luffy', format: 'egb', showHands: true } });
    expect(created.statusCode, created.body).toBe(201);
    const joined = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: DAVE, payload: { code: created.json().code, deckId: 'st02-kid' } });
    expect(joined.statusCode).toBe(200);
    const open = created.json().roomId as string;
    expect((await app.inject(`/api/online/rooms/${open}/decks`)).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/online/rooms/${open}/decks`, headers: { cookie: login(db, 'carol').cookie } })).statusCode).toBe(403);
    const res = await app.inject({ url: `/api/online/rooms/${open}/decks`, headers: streamer });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.players.map((p: { deck: { leader: string } }) => p.deck.leader)).toEqual([getDeck(db, 'st01-luffy')!.leader, getDeck(db, 'st02-kid')!.leader]);
    expect(body.players[0].deck.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(50);
    const ids = new Set(body.cards.map((c: { id: string }) => c.id));
    for (const p of body.players) for (const c of [{ id: p.deck.leader }, ...p.deck.cards]) expect(ids.has(c.id)).toBe(true);
    expect((await app.inject({ url: '/api/online/rooms/nope/decks', headers: streamer })).statusCode).toBe(404);
  });

  it('deck do próprio jogador (painel de decklist da mesa): só o do assento do token', async () => {
    const { app, db } = setup();
    const { roomId, tokens } = await privateMatch(app);
    const res = await app.inject(`/api/online/rooms/${roomId}/my-deck?t=${tokens[1]}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.players).toHaveLength(1);
    expect(body.players[0].deck.leader).toBe(getDeck(db, 'st02-kid')!.leader);
    expect(body.players[0].deck.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(50);
    const ids = new Set(body.cards.map((c: { id: string }) => c.id));
    for (const c of [{ id: body.players[0].deck.leader }, ...body.players[0].deck.cards]) expect(ids.has(c.id)).toBe(true);
    expect((await app.inject(`/api/online/rooms/${roomId}/my-deck?t=${tokens[0]}`)).json().players[0].deck.leader).toBe(getDeck(db, 'st01-luffy')!.leader);
    // Sem token (quem assiste) ou com token errado: nada.
    expect((await app.inject(`/api/online/rooms/${roomId}/my-deck`)).statusCode).toBe(404);
    expect((await app.inject(`/api/online/rooms/${roomId}/my-deck?t=nope`)).statusCode).toBe(404);
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

  it('ver mãos: só streamer ou admin, só em partida de torneio e nunca na própria partida', async () => {
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
    // Fora do torneio, ninguém vê as mãos.
    expect(await open(admin.cookie)).toBe(403);
    getRoom(app, roomId).data.queue = 'tournament';
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

  it('modo transmissão: link do OBS, partida escolhida no app, opções e as mãos pela chave', async () => {
    const { app, db } = setup();
    const nami = login(db, 'nami', 'streamer');
    const usopp = login(db, 'usopp');
    const get = (url: string, cookie?: string) => app.inject({ url, headers: cookie ? { cookie } : {} });
    const send = (method: 'POST' | 'PUT', url: string, cookie: string, payload?: object) => app.inject({ method, url, headers: { cookie }, payload });
    expect((await get('/api/broadcast')).statusCode).toBe(401);
    expect((await get('/api/broadcast', usopp.cookie)).statusCode).toBe(403);
    expect((await get('/api/broadcast', nami.cookie)).json()).toEqual({
      key: null,
      roomId: null,
      delayS: 180,
      handsPlayers: true,
      handsOwn: false,
      delayTournaments: false,
      chat: true,
      minHandsDelayS: 60,
    });
    expect((await send('PUT', '/api/broadcast/room', nami.cookie, { roomId: null })).statusCode).toBe(409);
    expect((await send('PUT', '/api/broadcast/settings', nami.cookie, { chat: false })).statusCode).toBe(409);

    const key = (await send('POST', '/api/broadcast/key', nami.cookie)).json().key as string;
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const byKey = async (k = key) => (await get(`/api/broadcast/${k}`)).json();
    const first = await byKey();
    expect(first).toMatchObject({ roomId: null, chat: true });
    expect((await get('/api/broadcast/nao-existe')).statusCode).toBe(404);

    const { roomId } = await privateMatch(app);
    expect((await send('PUT', '/api/broadcast/room', nami.cookie, { roomId: 'nope' })).statusCode).toBe(404);
    expect((await send('PUT', '/api/broadcast/room', nami.cookie, { roomId })).json()).toMatchObject({ key, roomId });
    const chosen = await byKey();
    expect(chosen.roomId).toBe(roomId);
    expect(chosen.rev).toBeGreaterThan(first.rev);

    // Opções: campos inválidos ficam como estavam; o atraso vai de 0 a 10 min.
    const settings = (await send('PUT', '/api/broadcast/settings', nami.cookie, { delayS: 9999, chat: false, handsOwn: 'sim' })).json();
    expect(settings).toMatchObject({ delayS: 600, chat: false, handsOwn: false, handsPlayers: true });
    expect((await byKey()).chat).toBe(false);
    expect((await byKey()).rev).toBeGreaterThan(chosen.rev);

    // A fonte do OBS não tem o login: a chave decide o que a conexão vê.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const open = async (query: string) => {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${roomId}/watch?${query}`, { signal: ctrl.signal });
      ctrl.abort();
      return res.status;
    };
    expect(await open('hands=1')).toBe(403);
    expect(await open(`k=${key}`)).toBe(200);
    expect(await open('k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(403);

    // Link novo: o antigo para de funcionar; a partida escolhida e as opções continuam.
    const fresh = (await send('POST', '/api/broadcast/key', nami.cookie)).json();
    expect(fresh).toMatchObject({ roomId, chat: false });
    expect((await get(`/api/broadcast/${key}`)).statusCode).toBe(404);
    expect(await open(`k=${key}`)).toBe(403);
    expect((await send('PUT', '/api/broadcast/room', nami.cookie, { roomId: null })).json()).toMatchObject({ roomId: null });

    // Sem o perfil, o link some.
    setUserRole(db, nami.id, 'player');
    expect((await get(`/api/broadcast/${fresh.key}`)).statusCode).toBe(404);
    expect(await open(`k=${fresh.key}`)).toBe(403);
    await app.close();
  });

  it('modo transmissão: o que a live mostra sai das opções do streamer', async () => {
    const { app, db } = setup();
    const nami = login(db, 'nami', 'streamer');
    const user = getUser(db, nami.id)!;
    const other = getRoom(app, (await privateMatch(app)).roomId);
    const created = await app.inject({
      method: 'POST',
      url: '/api/online/rooms',
      headers: { 'x-deck-owner': 'nami-0123456789abcdef', cookie: nami.cookie },
      payload: { deckId: 'st01-luffy', format: 'egb' },
    });
    const { roomId, code } = created.json();
    await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: { 'x-deck-owner': 'carol-0123456789abcdef' }, payload: { code, deckId: 'st02-kid' } });
    const own = getRoom(app, roomId);
    const s = { ...DEFAULT_SETTINGS };
    // Partida de outros fora do torneio: a mão do oponente nunca aparece.
    expect(broadcastView(s, other, user)).toEqual({ delay: 0 });
    // Partida que ele joga: a mão dele, com o atraso que escolher (até ao vivo), ou a visão pública.
    expect(broadcastView(s, own, user)).toEqual({ delay: 0 });
    expect(broadcastView({ ...s, handsOwn: true }, own, user)).toEqual({ as: 0, delay: 180_000 });
    expect(broadcastView({ ...s, handsOwn: true, delayS: 0 }, own, user)).toEqual({ as: 0, delay: 0 });
    // Partida de torneio de outros: as mãos dos dois, nunca com menos de 1 min de atraso.
    other.data.queue = 'tournament';
    expect(broadcastView(s, other, user)).toEqual({ hands: true, delay: 180_000 });
    expect(broadcastView({ ...s, delayS: 0 }, other, user)).toEqual({ hands: true, delay: 60_000 });
    // Sem as mãos: atraso só se ele quiser.
    expect(broadcastView({ ...s, handsPlayers: false }, other, user)).toEqual({ delay: 0 });
    expect(broadcastView({ ...s, handsPlayers: false, delayTournaments: true, delayS: 120 }, other, user)).toEqual({ delay: 120_000 });

    // "Ver mãos" no app segue o atraso escolhido (com o mesmo mínimo).
    expect(handsDelayFor(db, nami.id, other)).toBe(180_000);
    await app.inject({ method: 'POST', url: '/api/broadcast/key', headers: { cookie: nami.cookie } });
    await app.inject({ method: 'PUT', url: '/api/broadcast/settings', headers: { cookie: nami.cookie }, payload: { delayS: 30 } });
    expect(handsDelayFor(db, nami.id, other)).toBe(60_000);
    await app.inject({ method: 'PUT', url: '/api/broadcast/settings', headers: { cookie: nami.cookie }, payload: { delayS: 300 } });
    expect(handsDelayFor(db, nami.id, other)).toBe(300_000);
    // A própria partida pode ir para a transmissão.
    expect((await app.inject({ method: 'PUT', url: '/api/broadcast/room', headers: { cookie: nami.cookie }, payload: { roomId } })).statusCode).toBe(200);

    // Torneio em que o organizador liberou as mãos ao vivo: vale o atraso escolhido, até nenhum.
    other.data.tournament = { id: 't-1', name: 'Liga', round: 1, label: 'Rodada 1', matchId: 1, game: 1, bestOf: 1, wins: {}, liveHands: true };
    expect(other.handsLive).toBe(true);
    expect(other.minHandsDelay).toBe(0);
    expect(broadcastView({ ...s, delayS: 0 }, other, user)).toEqual({ hands: true, delay: 0 });
    expect(broadcastView({ ...s, delayS: 120 }, other, user)).toEqual({ hands: true, delay: 120_000 });
    expect(handsDelayFor(db, nami.id, other)).toBe(300_000);
    await app.inject({ method: 'PUT', url: '/api/broadcast/settings', headers: { cookie: nami.cookie }, payload: { delayS: 0 } });
    expect(handsDelayFor(db, nami.id, other)).toBe(0);
    // Sem a liberação (ou fora do torneio), o mínimo de 1 min continua.
    other.data.tournament.liveHands = false;
    expect(other.handsLive).toBe(false);
    expect(handsDelayFor(db, nami.id, other)).toBe(60_000);
    other.data.tournament.liveHands = true;
    other.data.queue = 'private';
    other.data.showHands = true;
    expect(other.handsLive).toBe(false);
    expect(broadcastView({ ...s, delayS: 0 }, other, user)).toEqual({ hands: true, delay: 60_000 });
  });

  it('sala privada: quem cria pode liberar as mãos para quem transmite (e a revanche mantém)', async () => {
    const { app, db } = setup();
    const nami = login(db, 'nami', 'streamer');
    const make = async (showHands?: boolean, owners = ['alice-0123456789abcdef', 'bob-0123456789abcdef00']) => {
      const created = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: { 'x-deck-owner': owners[0] }, payload: { deckId: 'st01-luffy', format: 'egb', showHands } });
      const { roomId, code } = created.json();
      await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: { 'x-deck-owner': owners[1] }, payload: { code, deckId: 'st02-kid' } });
      return getRoom(app, roomId);
    };
    const open = await make(true);
    const closed = await make(undefined, ['carol-0123456789abcdef', 'dave-0123456789abcdef00']);
    expect(open.handsAllowed).toBe(true);
    expect(closed.handsAllowed).toBe(false);
    // A informação vai para os jogadores (aviso na mesa) e para a lista de quem assiste.
    const player = client(1);
    open.attach(player.conn);
    expect(player.room.handsAllowed).toBe(true);
    expect((await app.inject(`/api/online/watch/${open.data.code}`)).json().handsAllowed).toBe(true);

    // Quem vê as mãos na sala liberada: as duas, na mesa atrasada.
    const streamer = client(null, true);
    open.attach(streamer.conn);
    expect(streamer.room.delay).toBe(HANDS_DELAY_MS);
    const v = streamer.view!;
    expect(v.players.every((p) => p.hand.every((u) => v.cards[u].cardId !== HIDDEN_CARD))).toBe(true);
    const other = client(null, true);
    closed.attach(other.conn);
    expect(other.view!.players.every((p) => p.hand.every((u) => other.view!.cards[u].cardId === HIDDEN_CARD))).toBe(true);

    // Modo transmissão segue a mesma regra.
    const user = getUser(db, nami.id)!;
    expect(broadcastView(DEFAULT_SETTINGS, open, user)).toEqual({ hands: true, delay: HANDS_DELAY_MS });
    expect(broadcastView(DEFAULT_SETTINGS, closed, user)).toEqual({ delay: 0 });

    // Canal: com o perfil, só na sala liberada.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const watch = async (id: string) => {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${id}/watch?hands=1`, { signal: ctrl.signal, headers: { cookie: nami.cookie } });
      ctrl.abort();
      return res.status;
    };
    expect(await watch(open.id)).toBe(200);
    expect(await watch(closed.id)).toBe(403);

    // Revanche: a sala nova continua liberada.
    const l = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    expect(open.act(0, null, { type: 'concede', player: 0 }).ok).toBe(true);
    expect(l.rematch(open, 0)).toBeNull();
    expect(l.rematch(open, 1)).toBeNull();
    expect(l.get(open.data.rematchRoom!)!.handsAllowed).toBe(true);
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
