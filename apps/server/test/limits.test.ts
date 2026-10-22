// Tetos de salas (servidor e por IP) e cache com ETag das rotas consultadas em polling.

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { dataVersion, ResponseCache } from '../src/cache';
import { openDb } from '../src/db';
import type { Lobby, LobbyLimits } from '../src/online/lobby';
import type { Connection } from '../src/online/room';
import { seed } from '../src/seed';

const owner = (n: number) => ({ 'x-deck-owner': `browser-${n}-0123456789abcdef` });

function setup(limits: Partial<LobbyLimits> = {}) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true, onlineBotRooms: true }, onlineRateLimit: 1e9, botDelayMs: 0, onlineLimits: limits });
  return { db, app };
}

const createRoom = (app: ReturnType<typeof buildApp>, n: number, ip = '10.0.0.1') =>
  app.inject({ method: 'POST', url: '/api/online/rooms', headers: owner(n), payload: { deckId: 'st01-luffy', format: 'egb' }, remoteAddress: ip });

describe('tetos de salas', () => {
  it('cada IP abre no máximo perIpRooms salas ao mesmo tempo; outro IP não é afetado', async () => {
    const { app } = setup({ perIpRooms: 2 });
    expect((await createRoom(app, 1)).statusCode).toBe(201);
    expect((await createRoom(app, 2)).statusCode).toBe(201);
    const third = await createRoom(app, 3);
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatch(/sua rede/);
    expect(third.json().errorCode).toBe('tooManyRoomsFromIp');
    expect((await createRoom(app, 4, '10.0.0.2')).statusCode).toBe(201);
    // Entrar na fila também ocupa um lugar do IP.
    const q = await app.inject({ method: 'POST', url: '/api/online/queue', headers: owner(5), payload: { deckId: 'st01-luffy', format: 'egb', queue: 'casual' }, remoteAddress: '10.0.0.1' });
    expect(q.statusCode).toBe(429);
  });

  it('criações por IP numa janela de tempo são limitadas', async () => {
    const { app } = setup({ perIpCreates: 2, perIpRooms: 100 });
    expect((await createRoom(app, 1)).statusCode).toBe(201);
    expect((await createRoom(app, 2)).statusCode).toBe(201);
    const third = await createRoom(app, 3);
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatch(/pouco tempo/);
  });

  it('o servidor recusa salas novas acima de maxRooms, e o treino contra o bot acima de maxBotRooms', async () => {
    const { app, db } = setup({ maxRooms: 2, maxBotRooms: 1, perIpRooms: 100 });
    // Transmitir o treino exige login.
    const login = (n: number) => {
      const u = upsertGoogleUser(db, { sub: `bot-${n}`, email: `bot-${n}@example.com`, emailVerified: true, name: `bot-${n}`, picture: null });
      return { cookie: `gg_session=${createSession(db, u.id)}` };
    };
    const bot = (n: number) =>
      app.inject({ method: 'POST', url: '/api/online/bot', headers: { ...owner(n), ...login(n) }, payload: { deckId: 'st01-luffy', botDeckId: 'st02-kid', format: 'egb' }, remoteAddress: `10.0.0.${n}` });
    expect((await bot(1)).statusCode).toBe(201);
    const second = await bot(2);
    expect(second.statusCode).toBe(503);
    expect(second.json().error).toMatch(/lotado/);
    expect((await createRoom(app, 3, '10.0.0.3')).statusCode).toBe(201);
    const full = await createRoom(app, 4, '10.0.0.4');
    expect(full.statusCode).toBe(503);
    expect(full.json().error).toMatch(/cheio/);
    // Uma sala de espera cancelada libera a vaga.
    const mine = (await app.inject({ url: '/api/online/active', headers: owner(3) })).json()[0];
    await app.inject({ method: 'POST', url: `/api/online/rooms/${mine.roomId}/leave`, payload: { t: mine.token } });
    expect((await createRoom(app, 4, '10.0.0.4')).statusCode).toBe(201);
  });

  it('os padrões vêm das variáveis de ambiente (ONLINE_MAX_ROOMS)', async () => {
    const db = openDb(':memory:');
    seed(db);
    const app = buildApp(db, { server: { cardImages: true, onlineLimits: { maxRooms: 1 } }, onlineRateLimit: 1e9 });
    expect((await createRoom(app, 1)).statusCode).toBe(201);
    expect((await createRoom(app, 2, '10.0.0.2')).statusCode).toBe(503);
  });
});

describe('cache com ETag', () => {
  it('GET /api/online/live: ETag e 304; a lista muda na hora com sala nova, espectador e fim, e as jogadas saem pelo TTL', async () => {
    let now = 1_000_000;
    const db = openDb(':memory:');
    seed(db);
    const app = buildApp(db, { server: { cardImages: true, onlineBotRooms: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => now });
    const live = (headers: Record<string, string> = {}) => app.inject({ url: '/api/online/live', headers });
    const empty = await live();
    expect(empty.statusCode).toBe(200);
    expect(empty.json().rooms).toEqual([]);
    const e0 = empty.headers.etag as string;
    expect(e0).toMatch(/^"/);
    expect(empty.headers['cache-control']).toContain('no-cache');
    expect((await live({ 'if-none-match': e0 })).statusCode).toBe(304);

    // Uma sala nova entra na lista na hora (sem esperar o TTL).
    const u = upsertGoogleUser(db, { sub: 'zoro', email: 'zoro@example.com', emailVerified: true, name: 'Zoro', picture: null });
    const zoro = { ...owner(1), cookie: `gg_session=${createSession(db, u.id)}` };
    const bot = await app.inject({ method: 'POST', url: '/api/online/bot', headers: zoro, payload: { deckId: 'st01-luffy', botDeckId: 'st02-kid', format: 'egb', first: 0 } });
    expect(bot.statusCode, bot.body).toBe(201);
    const { roomId, token } = bot.json();
    const one = await live({ 'if-none-match': e0 });
    expect(one.statusCode).toBe(200);
    expect(one.json().rooms.map((r: { id: string; mine: boolean }) => [r.id, r.mine])).toEqual([[roomId, false]]);
    const e1 = one.headers.etag as string;
    expect(e1).not.toBe(e0);
    // Quem joga a partida tem a própria resposta (`mine`), sem misturar com a dos outros.
    const mine = await live(zoro);
    expect(mine.json().rooms[0].mine).toBe(true);
    expect(mine.headers.etag).not.toBe(e1);
    expect((await live({ 'if-none-match': e1 })).statusCode).toBe(304);

    // Um espectador entrando muda o contador na hora.
    const room = (app as unknown as { onlineLobby: Lobby }).onlineLobby.get(roomId)!;
    const conn: Connection = { seat: null, sentDefs: new Set(), sentLog: 0, send: () => {} };
    room.attach(conn);
    const watched = await live({ 'if-none-match': e1 });
    expect(watched.statusCode).toBe(200);
    expect(watched.json().rooms[0].spectators).toBe(1);
    const e2 = watched.headers.etag as string;

    // Uma jogada não invalida o cache (seria a cada instante com muitas salas): a mão nova aparece depois do TTL.
    expect(room.state!.pending).toMatchObject({ kind: 'mulligan', player: 0 });
    expect(watched.json().rooms[0].turn).toBe(0);
    const played = await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/action`, payload: { t: token, seq: 0, action: { type: 'mulligan', player: 0, redraw: false } } });
    expect(played.statusCode, played.body).toBe(200);
    // O bot responde ao mulligan dele num timer; o turno 1 começa.
    await new Promise((r) => setTimeout(r, 20));
    expect(room.state!.turn).toBe(1);
    expect((await live({ 'if-none-match': e2 })).statusCode).toBe(304);
    now += 2001;
    const later = await live({ 'if-none-match': e2 });
    expect(later.statusCode).toBe(200);
    expect(later.json().rooms[0].turn).toBe(1);

    // O fim da partida tira a sala da lista na hora.
    room.detach(conn);
    expect((await live()).json().rooms[0].spectators).toBe(0);
    expect((await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/action`, payload: { t: token, seq: room.state!.actionCount, action: { type: 'concede', player: 0 } } })).statusCode).toBe(200);
    expect((await live()).json().rooms).toEqual([]);
  });


  it('reaproveita a resposta até a próxima gravação e responde 304 ao If-None-Match', () => {
    let calls = 0;
    let now = 0;
    const cache = new ResponseCache(dataVersion, 10, () => now);
    const compute = () => ({ n: ++calls });
    const a = cache.get('k', 1000, compute);
    expect(cache.get('k', 1000, compute)).toBe(a);
    expect(calls).toBe(1);
    dataVersion.bump();
    expect(cache.get('k', 1000, compute).body).toBe('{"n":2}');
    now = 5000;
    expect(cache.get('k', 1000, compute).body).toBe('{"n":3}');
  });

  it('GET /api/stats e /api/tournaments/:id mandam ETag, respondem 304 e refletem gravações na hora', async () => {
    const { app, db } = setup();
    const first = await app.inject({ url: '/api/stats?days=7', headers: owner(1) });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"/);
    expect(first.headers['cache-control']).toContain('no-cache');
    const again = await app.inject({ url: '/api/stats?days=7', headers: { ...owner(1), 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    // O ETag vem do conteúdo: uma query diferente com o mesmo resultado (base vazia) tem o mesmo ETag.
    expect((await app.inject({ url: '/api/stats?days=30', headers: owner(1) })).headers.etag).toBe(etag);

    // Torneio: o organizador cria, a página é cacheada por conta, e uma inscrição invalida.
    const org = upsertGoogleUser(db, { sub: 'org', email: 'org@example.com', emailVerified: true, name: 'Org', picture: null });
    setUserRole(db, org.id, 'organizer');
    const orgHeaders = { cookie: `gg_session=${createSession(db, org.id)}`, ...owner(9) };
    const created = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      headers: orgHeaders,
      payload: { name: 'Copa', description: '', format: 'egb', structure: 'swiss', rounds: null, swissBestOf: 1, topCut: null, bo3From: null, bo5From: null, maxPlayers: null, startsAt: null },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const d1 = await app.inject({ url: `/api/tournaments/${id}`, headers: orgHeaders });
    expect(d1.statusCode).toBe(200);
    expect(d1.json().players).toHaveLength(0);
    const tag = d1.headers.etag as string;
    expect((await app.inject({ url: `/api/tournaments/${id}`, headers: { ...orgHeaders, 'if-none-match': tag } })).statusCode).toBe(304);
    // Quem não está logado tem a própria entrada (canManage diferente).
    expect((await app.inject({ url: `/api/tournaments/${id}`, headers: owner(2) })).json().canManage).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/api/tournaments/${id}/register`, headers: orgHeaders, payload: { deckId: 'st01-luffy' } })).statusCode).toBe(200);
    const d2 = await app.inject({ url: `/api/tournaments/${id}`, headers: { ...orgHeaders, 'if-none-match': tag } });
    expect(d2.statusCode).toBe(200);
    expect(d2.json().players).toHaveLength(1);
    expect(d2.headers.etag).not.toBe(tag);
  });
});
