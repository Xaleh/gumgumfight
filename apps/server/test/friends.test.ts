import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { INVITE_GAP_MS, INVITE_TTL_MS, REQUEST_LIMIT } from '../src/friends/routes';
import { isFriendCode } from '../src/friends/store';
import type { PushPayload } from '../src/push/routes';
import { seed } from '../src/seed';

type Sent = { endpoint: string; payload: PushPayload };

function setup() {
  let now = Date.parse('2026-11-25T19:00:00Z');
  const db = openDb(':memory:');
  seed(db);
  const sent: Sent[] = [];
  const app = buildApp(db, {
    server: { cardImages: true },
    onlineRateLimit: 1e9,
    botDelayMs: 0,
    now: () => now,
    pushSend: async (target, payload) => {
      sent.push({ endpoint: target.endpoint, payload });
      return 201;
    },
  });
  return { db, app, sent, advance: (ms: number) => (now += ms) };
}
type App = ReturnType<typeof buildApp>;
type Who = { id: string; headers: Record<string, string> };

let n = 0;
function login(db: DB): Who {
  const u = upsertGoogleUser(db, { sub: `friend-${++n}`, email: `f${n}@example.com`, emailVerified: true, name: `Conta Google ${n}`, picture: null });
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-friend-${n}-0123456789abcdef` } };
}

const call = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who.headers, ...(payload ? { payload } : {}) });

const list = async (app: App, who: Who) => (await call(app, 'GET', '/api/friends', who)).json();

async function subscribe(app: App, who: Who, name: string, extra: object = {}) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const subscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  expect((await call(app, 'PUT', '/api/push/subscription', who, { subscription, ...extra })).statusCode).toBe(204);
}
const to = (sent: Sent[], name: string) => sent.filter((s) => s.endpoint.endsWith(`/${name}`)).map((s) => s.payload);
const flush = () => new Promise((r) => setImmediate(r));

/** Dois amigos já aceitos. */
async function friends(app: App, db: DB) {
  const a = login(db);
  const b = login(db);
  const codeB = (await list(app, b)).code;
  expect((await call(app, 'POST', '/api/friends/requests', a, { code: codeB })).statusCode).toBe(201);
  expect((await call(app, 'POST', `/api/friends/${a.id}/accept`, b)).statusCode).toBe(200);
  return { a, b };
}

// Deck pronto que vale no Extra Grand Battle (o mesmo dos testes das salas online).
const deckId = async (_app: App) => 'st01-luffy';

async function privateRoom(app: App, who: Who) {
  const r = await call(app, 'POST', '/api/online/rooms', who, { deckId: await deckId(app), format: 'egb' });
  expect(r.statusCode).toBe(201);
  return r.json() as { roomId: string; code: string; token: string };
}

describe('Amigos: pedido, aceite e remoção', () => {
  it('exige login', async () => {
    const { app } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/friends', headers: { 'x-deck-owner': 'anon-0123456789abcdef' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().errorCode).toBe('friendsLoginRequired');
  });

  it('cada conta tem um código de amigo fixo', async () => {
    const { app, db } = setup();
    const a = login(db);
    const first = await list(app, a);
    expect(isFriendCode(first.code)).toBe(true);
    expect((await list(app, a)).code).toBe(first.code);
    expect(first).toMatchObject({ friends: [], incoming: [], outgoing: [], invites: [] });
  });

  it('pedir, aceitar e remover; a lista mostra só o nome público', async () => {
    const { app, db } = setup();
    const a = login(db);
    const b = login(db);
    const codeB = (await list(app, b)).code;

    expect((await call(app, 'POST', '/api/friends/requests', a, { code: 'ABC' })).json().errorCode).toBe('invalidFriendCode');
    expect((await call(app, 'POST', '/api/friends/requests', a, { code: 'ZZZZZZZZ' })).json().errorCode).toBe('friendNotFound');
    expect((await call(app, 'POST', '/api/friends/requests', b, { code: codeB })).json().errorCode).toBe('ownFriendCode');

    const sent = await call(app, 'POST', '/api/friends/requests', a, { code: codeB.toLowerCase() });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ id: b.id, status: 'pending' });
    // Repetir não duplica.
    expect((await call(app, 'POST', '/api/friends/requests', a, { code: codeB })).statusCode).toBe(200);

    const la = await list(app, a);
    const lb = await list(app, b);
    expect(la.outgoing.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect(lb.incoming.map((f: { id: string }) => f.id)).toEqual([a.id]);
    // Pedido pendente não mostra o status, e nunca o nome da conta Google.
    expect(lb.incoming[0].status).toBeUndefined();
    expect(JSON.stringify(lb)).not.toContain('Conta Google');
    expect(lb.incoming[0].name).toMatch(/^Pirata /);

    // Só quem recebeu aceita.
    expect((await call(app, 'POST', `/api/friends/${b.id}/accept`, a)).statusCode).toBe(404);
    expect((await call(app, 'POST', `/api/friends/${a.id}/accept`, b)).statusCode).toBe(200);
    expect((await list(app, a)).friends.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect((await list(app, b)).friends.map((f: { id: string }) => f.id)).toEqual([a.id]);

    expect((await call(app, 'DELETE', `/api/friends/${a.id}`, b)).statusCode).toBe(204);
    expect((await list(app, a)).friends).toEqual([]);
    expect((await call(app, 'DELETE', `/api/friends/${a.id}`, b)).statusCode).toBe(404);
  });

  it('pedir a quem já tinha pedido vira amizade; recusar apaga o pedido', async () => {
    const { app, db } = setup();
    const a = login(db);
    const b = login(db);
    const c = login(db);
    await call(app, 'POST', '/api/friends/requests', a, { code: (await list(app, b)).code });
    const back = await call(app, 'POST', '/api/friends/requests', b, { code: (await list(app, a)).code });
    expect(back.json().status).toBe('accepted');
    expect((await list(app, a)).friends).toHaveLength(1);

    await call(app, 'POST', '/api/friends/requests', c, { code: (await list(app, a)).code });
    expect((await call(app, 'DELETE', `/api/friends/${c.id}`, a)).statusCode).toBe(204);
    expect((await list(app, c)).outgoing).toEqual([]);
  });

  it('limita os pedidos por hora (ninguém varre códigos)', async () => {
    const { app, db, advance } = setup();
    const a = login(db);
    for (let i = 0; i < REQUEST_LIMIT; i++) await call(app, 'POST', '/api/friends/requests', a, { code: 'ZZZZZZZZ' });
    expect((await call(app, 'POST', '/api/friends/requests', a, { code: 'ZZZZZZZZ' })).statusCode).toBe(429);
    advance(60 * 60_000);
    expect((await call(app, 'POST', '/api/friends/requests', a, { code: 'ZZZZZZZZ' })).statusCode).toBe(404);
  });

  it('avisa por push o pedido e o aceite (categoria amigos)', async () => {
    const { app, db, sent } = setup();
    const a = login(db);
    const b = login(db);
    const off = login(db);
    await subscribe(app, a, 'a');
    await subscribe(app, b, 'b', { locale: 'en' });
    await subscribe(app, off, 'off', { friends: false });
    await call(app, 'POST', '/api/friends/requests', a, { code: (await list(app, b)).code });
    await flush();
    expect(to(sent, 'b')).toEqual([expect.objectContaining({ title: 'Friend request', url: '/?amigos=1' })]);
    await call(app, 'POST', `/api/friends/${a.id}/accept`, b);
    await flush();
    expect(to(sent, 'a')).toEqual([expect.objectContaining({ title: 'Amizade aceita!' })]);
    await call(app, 'POST', '/api/friends/requests', a, { code: (await list(app, off)).code });
    await flush();
    expect(to(sent, 'off')).toEqual([]);
  });
});

describe('Amigos: status online', () => {
  it('offline, online (menu aberto ou sala de espera) e jogando', async () => {
    const { app, db, advance } = setup();
    const { a, b } = await friends(app, db);
    advance(31_000);
    const status = async () => (await list(app, a)).friends[0].status;
    expect(await status()).toBe('offline');
    // Menu aberto: a consulta dos contadores é o sinal de presença.
    await call(app, 'GET', '/api/online/stats', b);
    expect(await status()).toBe('online');
    advance(31_000);
    expect(await status()).toBe('offline');

    const room = await privateRoom(app, b);
    expect(await status()).toBe('online');
    const c = login(db);
    expect((await call(app, 'POST', '/api/online/rooms/join', c, { code: room.code, deckId: await deckId(app) })).statusCode).toBe(200);
    expect(await status()).toBe('playing');
    // O status nunca leva a sala.
    expect(JSON.stringify(await list(app, a))).not.toContain(room.roomId);
  });
});

describe('Amigos: convite para partida', () => {
  it('convida um amigo para a sala privada; o convite leva o código e some quando a sala começa', async () => {
    const { app, db, sent } = setup();
    const { a, b } = await friends(app, db);
    await subscribe(app, b, 'b');
    const room = await privateRoom(app, a);

    const r = await call(app, 'POST', `/api/friends/${b.id}/invite`, a, { roomId: room.roomId, token: room.token });
    expect(r.statusCode).toBe(201);
    await flush();
    expect(to(sent, 'b')).toEqual([expect.objectContaining({ title: 'Convite para partida', url: `/?convite=${room.code}`, tag: `invite-${a.id}` })]);
    const invite = (await list(app, b)).invites;
    expect(invite).toEqual([expect.objectContaining({ code: room.code, format: 'Extra Grand Battle', from: { id: a.id, name: expect.stringMatching(/^Pirata /) } })]);
    // Quem não foi convidado não vê o convite.
    expect((await list(app, a)).invites).toEqual([]);

    // O convite abre a sala direto: quem foi convidado entra com o código.
    expect((await call(app, 'POST', '/api/online/rooms/join', b, { code: room.code, deckId: await deckId(app) })).statusCode).toBe(200);
    expect((await list(app, b)).invites).toEqual([]);
  });

  it('recusa convite para quem não é amigo, com token errado ou sala que já começou', async () => {
    const { app, db } = setup();
    const { a, b } = await friends(app, db);
    const stranger = login(db);
    const room = await privateRoom(app, a);
    expect((await call(app, 'POST', `/api/friends/${stranger.id}/invite`, a, { roomId: room.roomId, token: room.token })).json().errorCode).toBe('notFriends');
    expect((await call(app, 'POST', `/api/friends/${b.id}/invite`, a, { roomId: room.roomId, token: 'x' })).json().errorCode).toBe('roomNotFound');
    // A sala de outra pessoa não serve, mesmo com o id certo.
    expect((await call(app, 'POST', `/api/friends/${a.id}/invite`, b, { roomId: room.roomId, token: room.token })).statusCode).toBe(404);
    const c = login(db);
    await call(app, 'POST', '/api/online/rooms/join', c, { code: room.code, deckId: await deckId(app) });
    expect((await call(app, 'POST', `/api/friends/${b.id}/invite`, a, { roomId: room.roomId, token: room.token })).json().errorCode).toBe('roomNotFound');
  });

  it('espaça os convites, deixa recusar e apaga ao desfazer a amizade ou ao vencer o prazo', async () => {
    const { app, db, advance } = setup();
    const { a, b } = await friends(app, db);
    const room = await privateRoom(app, a);
    const invite = () => call(app, 'POST', `/api/friends/${b.id}/invite`, a, { roomId: room.roomId, token: room.token });
    expect((await invite()).statusCode).toBe(201);
    expect((await invite()).json().errorCode).toBe('inviteTooSoon');
    advance(INVITE_GAP_MS);
    expect((await invite()).statusCode).toBe(201);
    expect((await list(app, b)).invites).toHaveLength(1);

    expect((await call(app, 'DELETE', `/api/friends/invites/${room.code}`, b)).statusCode).toBe(204);
    expect((await list(app, b)).invites).toEqual([]);

    advance(INVITE_GAP_MS);
    await invite();
    advance(INVITE_TTL_MS);
    expect((await list(app, b)).invites).toEqual([]);

    advance(INVITE_GAP_MS);
    const fresh = await privateRoom(app, a);
    await call(app, 'POST', `/api/friends/${b.id}/invite`, a, { roomId: fresh.roomId, token: fresh.token });
    await call(app, 'DELETE', `/api/friends/${b.id}`, a);
    expect((await list(app, b)).invites).toEqual([]);
  });
});
