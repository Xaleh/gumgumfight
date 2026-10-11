import { type Action, actingPlayer, type CardDef, chooseSimpleBotAction as chooseBotAction, type GameState, type LogEntry, type PlayerId } from '@gumgum/engine';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import type { ServerOptions } from '../src/config';
import { type DB, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { type Connection, TURN_NOTICE_MS } from '../src/online/room';
import type { PushPayload } from '../src/push/routes';
import { allowedEndpoint, encryptPayload, generateVapidKeys, vapidAuthorization } from '../src/push/webpush';
import { seed } from '../src/seed';
import type { TickResult } from '../src/tournaments/clock';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

type Sent = { endpoint: string; payload: PushPayload; ttl: number };

function setup(server: Partial<ServerOptions> = {}, status: (endpoint: string) => number = () => 201) {
  let now = Date.parse('2026-10-10T19:00:00Z');
  const db = openDb(':memory:');
  seed(db);
  const sent: Sent[] = [];
  const app = buildApp(db, {
    server: { cardImages: true, ...server },
    onlineRateLimit: 1e9,
    botDelayMs: 0,
    now: () => now,
    pushSend: async (target, payload, opts) => {
      sent.push({ endpoint: target.endpoint, payload, ttl: opts.ttl });
      return status(target.endpoint);
    },
  });
  return {
    db,
    app,
    sent,
    clock: (iso: string) => (now = Date.parse(iso)),
    advance: (ms: number) => (now += ms),
  };
}
type App = ReturnType<typeof buildApp>;

/** Inscrição como a que o navegador gera (chave P-256 e segredo de 16 bytes de verdade). */
function subscription(name: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

const subscribe = (app: App, headers: Record<string, string>, name: string, extra: object = {}) =>
  app.inject({ method: 'PUT', url: '/api/push/subscription', headers, payload: { subscription: subscription(name), ...extra } });

const to = (sent: Sent[], name: string) => sent.filter((s) => s.endpoint.endsWith(`/${name}`)).map((s) => s.payload);
const flush = () => new Promise((r) => setImmediate(r));

describe('Web Push: criptografia e VAPID', () => {
  it('o navegador decifra a mensagem com a própria chave privada (RFC 8291)', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = randomBytes(16);
    const message = Buffer.from(JSON.stringify({ title: 'Sua vez!', body: 'Kaidou está esperando' }));
    const sealed = encryptPayload(message, { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
    // Lado do navegador: cabeçalho (salt, tamanho do registro, chave do servidor) e depois o registro.
    const salt = sealed.subarray(0, 16);
    expect(sealed.readUInt32BE(16)).toBe(4096);
    const keyLen = sealed[20];
    const asPublic = sealed.subarray(21, 21 + keyLen);
    const record = sealed.subarray(21 + keyLen);
    const secret = ua.computeSecret(asPublic);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(record.subarray(record.length - 16));
    const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
    expect(plain[plain.length - 1]).toBe(2);
    expect(plain.subarray(0, -1).equals(message)).toBe(true);
  });

  it('o JWT do VAPID leva a origem do serviço de push e a chave pública', () => {
    const keys = generateVapidKeys();
    expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65);
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:dev@example.com', Date.parse('2026-10-10T00:00:00Z'));
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Date.parse('2026-10-10T12:00:00Z') / 1000, sub: 'mailto:dev@example.com' });
  });

  it('só aceita endpoints dos serviços de push conhecidos', () => {
    expect(allowedEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(allowedEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(allowedEndpoint('https://wns2-bl2p.notify.windows.com/w/?token=x')).toBe(true);
    expect(allowedEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(allowedEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(allowedEndpoint('https://127.0.0.1/x')).toBe(false);
    expect(allowedEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
  });
});

describe('Web Push: inscrições', () => {
  it('a chave pública sai em /api/config; PUSH=off desliga tudo', async () => {
    const { app } = setup();
    const key = (await app.inject('/api/config')).json().pushKey;
    expect(Buffer.from(key, 'base64url')).toHaveLength(65);
    // A mesma chave depois de reiniciar (fica no banco).
    expect((await app.inject('/api/config')).json().pushKey).toBe(key);

    const off = setup({ push: false });
    expect((await off.app.inject('/api/config')).json().pushKey).toBeNull();
    expect((await subscribe(off.app, ALICE, 'a')).statusCode).toBe(503);
  });

  it('valida a inscrição e guarda idioma e avisos escolhidos; o DELETE descadastra', async () => {
    const { app, db } = setup();
    expect((await subscribe(app, {}, 'a')).statusCode).toBe(400);
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/push/subscription',
      headers: ALICE,
      payload: { subscription: { ...subscription('a'), endpoint: 'https://example.com/push' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errorCode).toBe('invalidPushSubscription');
    const shortKey = { ...subscription('a'), keys: { p256dh: 'abc', auth: 'abc' } };
    expect((await app.inject({ method: 'PUT', url: '/api/push/subscription', headers: ALICE, payload: { subscription: shortKey } })).statusCode).toBe(400);

    expect((await subscribe(app, ALICE, 'a', { locale: 'ja', matches: false })).statusCode).toBe(204);
    // Repetir atualiza a mesma linha (o app chama de novo ao trocar de idioma).
    expect((await subscribe(app, ALICE, 'a', { locale: 'xx', tournaments: false })).statusCode).toBe(204);
    expect(db.prepare('SELECT locale, matches, tournaments FROM push_subscriptions').all()).toEqual([{ locale: 'pt-BR', matches: 1, tournaments: 0 }]);

    const del = await app.inject({ method: 'DELETE', url: '/api/push/subscription', headers: ALICE, payload: { endpoint: subscription('a').endpoint } });
    expect(del.statusCode).toBe(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
  });
});

async function act(app: App, roomId: string, t: string, seq: number, action: Action) {
  const r = await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/action`, payload: { t, seq, action } });
  expect(r.statusCode, r.body).toBe(200);
}

/** Conexão SSE de teste: monta a visão do jogador como o navegador (defs e log acumulados). */
function viewer(seat: PlayerId) {
  let defs: Record<string, CardDef> = {};
  let log: LogEntry[] = [];
  let latest: { view: GameState } | null = null;
  const conn: Connection = {
    seat,
    sentDefs: new Set(),
    sentLog: 0,
    send: (event, data: any) => {
      if (event !== 'state') return;
      defs = { ...defs, ...data.defs };
      log = [...log.slice(0, data.log.from), ...data.log.entries];
      latest = data;
    },
  };
  return { conn, view: () => ({ ...latest!.view, defs, log }) as GameState };
}

describe('Web Push: partidas online', () => {
  it('avisa quem esperava quando a partida começa e cada um quando a vez passa para ele longe do app', async () => {
    const { app, sent, advance } = setup();
    await subscribe(app, ALICE, 'alice');
    await subscribe(app, BOB, 'bob', { locale: 'en' });
    await app.inject({ method: 'PUT', url: '/api/players/me', headers: ALICE, payload: { name: 'Nami' } });
    await app.inject({ method: 'PUT', url: '/api/players/me', headers: BOB, payload: { name: 'Usopp' } });

    const created = (await app.inject({ method: 'POST', url: '/api/online/rooms', headers: ALICE, payload: { deckId: 'st01-luffy', format: 'egb' } })).json();
    expect(sent).toEqual([]);
    const joined = (await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code: created.code, deckId: 'st02-kid' } })).json();
    const roomId = created.roomId;
    const tokens = [created.token, joined.token];
    // Quem criou a sala esperava (e é avisado); quem entrou agora está com o app na mão.
    expect(to(sent, 'alice')).toEqual([
      { title: 'Partida encontrada!', body: 'Usopp entrou. Toque para jogar.', tag: `room-${roomId}`, url: `/?partida=${roomId}` },
    ]);
    expect(to(sent, 'bob')).toEqual([]);
    sent.length = 0;

    const room = (app as unknown as { onlineLobby: Lobby }).onlineLobby.get(roomId)!;
    const winner = actingPlayer(room.state!)!;
    const loser = (1 - winner) as PlayerId;
    const name = (p: PlayerId) => (p === 0 ? 'alice' : 'bob');
    // O vencedor do sorteio deixa o outro começar: a vez (o mulligan) passa para o outro.
    await act(app, roomId, tokens[winner], 0, { type: 'answer', player: winner, yes: false });
    expect(to(sent, name(loser))).toHaveLength(1);
    expect(to(sent, name(loser))[0]).toMatchObject({ title: loser === 0 ? 'Sua vez!' : 'Your turn!', body: loser === 0 ? 'Usopp está esperando a sua jogada.' : 'Nami is waiting for your move.' });
    expect(to(sent, name(winner))).toEqual([]);
    // Mulligan do primeiro: a vez volta para o vencedor do sorteio (primeiro aviso dele).
    await act(app, roomId, tokens[loser], 1, { type: 'mulligan', player: loser, redraw: false });
    expect(to(sent, name(winner))).toHaveLength(1);
    // Mulligan do vencedor: começa o turno do outro, que foi avisado há pouco (sem repetir).
    await act(app, roomId, tokens[winner], 2, { type: 'mulligan', player: winner, redraw: false });
    expect(actingPlayer(room.state!)).toBe(loser);
    expect(to(sent, name(loser))).toHaveLength(1);

    // Passado o intervalo, a próxima troca de vez avisa de novo.
    advance(TURN_NOTICE_MS);
    sent.length = 0;
    const seen = viewer(loser);
    room.attach(seen.conn);
    for (let i = 0; i < 200 && actingPlayer(room.state!) === loser; i++) {
      const v = seen.view();
      await act(app, roomId, tokens[loser], v.actionCount, chooseBotAction(v, loser));
    }
    expect(actingPlayer(room.state!)).toBe(winner);
    expect(to(sent, name(winner))).toHaveLength(1);

    // Conectado e com o app na tela: a vez não vira notificação.
    const both = [loser === 0 ? seen : viewer(0), loser === 1 ? seen : viewer(1)];
    room.attach(both[winner].conn);
    const playTurn = async (p: PlayerId) => {
      for (let i = 0; i < 200 && actingPlayer(room.state!) === p; i++) {
        const v = both[p].view();
        await act(app, roomId, tokens[p], v.actionCount, chooseBotAction(v, p));
      }
    };
    advance(TURN_NOTICE_MS);
    sent.length = 0;
    await playTurn(winner);
    await playTurn(loser);
    expect(actingPlayer(room.state!)).toBe(winner);
    expect(sent).toEqual([]);
    // O app do vencedor sai da tela (outro app, tela bloqueada): volta a avisar.
    const focus = (p: PlayerId, visible: boolean) =>
      app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/focus`, payload: { t: tokens[p], visible } });
    expect((await focus(winner, false)).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: `/api/online/rooms/${roomId}/focus`, payload: { t: 'x', visible: false } })).statusCode).toBe(404);
    await playTurn(winner);
    await playTurn(loser);
    expect(to(sent, name(winner))).toHaveLength(1);
    // De volta à tela: silêncio de novo.
    await focus(winner, true);
    advance(TURN_NOTICE_MS);
    sent.length = 0;
    await playTurn(winner);
    await playTurn(loser);
    expect(sent).toEqual([]);
  });

  it('respeita quem desligou os avisos de partidas e apaga inscrições que não existem mais', async () => {
    const { app, db, sent } = setup({}, (endpoint) => (endpoint.endsWith('/gone') ? 410 : 201));
    const CAROL = { 'x-deck-owner': 'carol-0123456789abcdef' };
    const DAVE = { 'x-deck-owner': 'dave-0123456789abcdef0' };
    await subscribe(app, BOB, 'bob', { matches: false });
    await subscribe(app, ALICE, 'gone');
    const match = async (host: Record<string, string>, guest: Record<string, string>) => {
      const created = (await app.inject({ method: 'POST', url: '/api/online/rooms', headers: host, payload: { deckId: 'st01-luffy', format: 'egb' } })).json();
      const joined = await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: guest, payload: { code: created.code, deckId: 'st02-kid' } });
      expect(joined.statusCode).toBe(200);
    };
    // Bob esperava, mas desligou os avisos de partidas: nada sai.
    await match(BOB, CAROL);
    expect(sent).toEqual([]);
    // Alice esperava; o serviço de push responde 410 (inscrição cancelada no aparelho): a linha é apagada.
    await match(ALICE, DAVE);
    expect(sent.map((s) => s.endpoint.split('/').pop())).toEqual(['gone']);
    await flush();
    expect(db.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([{ endpoint: subscription('bob').endpoint }]);
  });

  it('treino contra o bot: sem aviso de início (a partida começa quando o jogador pede)', async () => {
    const { app, db, sent } = setup();
    const me = login(db);
    await subscribe(app, me.headers, 'me');
    const r = await req(app, 'POST', '/api/online/bot', me, { deckId: 'st01-luffy', botDeckId: 'st02-kid', format: 'egb', first: 0 });
    expect(r.statusCode, r.body).toBe(201);
    expect(sent.filter((s) => s.payload.title === 'Partida encontrada!')).toEqual([]);
  });
});

// ------------------------------------------------------------------ torneios

let n = 0;
function login(db: DB, role: Role = 'player') {
  const u = upsertGoogleUser(db, { sub: `push-${++n}`, email: `p${n}@example.com`, emailVerified: true, name: `P${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-push-${n}-0123456789abcdef` } };
}
const req = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, who: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who.headers, payload });
const tick = (app: App) => (app as unknown as { tournamentTick: () => TickResult | null }).tournamentTick();

describe('Web Push: torneios', () => {
  it('check-in aberto (uma vez), rodada nova com o oponente e o prazo, oponente esperando na sala', async () => {
    const { app, db, sent, clock } = setup();
    const org = login(db, 'organizer');
    const [a, b, c] = [login(db), login(db), login(db)];
    for (const [i, p] of [a, b, c].entries()) await req(app, 'PUT', '/api/players/me', p, { name: ['Zoro', 'Sanji', 'Robin'][i] });
    const t = (
      await req(app, 'POST', '/api/tournaments', org, {
        name: 'Copa Noturna',
        format: 'egb',
        structure: 'swiss',
        rounds: 2,
        startsAt: '2026-10-10T20:00:00.000Z',
        checkIn: true,
        toleranceMin: 10,
      })
    ).json();
    for (const [i, p] of [a, b].entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: ['st01-luffy', 'st02-kid'][i] });
    // A conta recebe os avisos em qualquer navegador onde tenha entrado; quem não está inscrito, nada.
    await subscribe(app, a.headers, 'zoro');
    await subscribe(app, b.headers, 'sanji', { locale: 'es' });
    await subscribe(app, c.headers, 'robin');

    tick(app);
    expect(sent).toEqual([]);
    clock('2026-10-10T19:31:00Z');
    await req(app, 'POST', `/api/tournaments/${t.id}/checkin`, a);
    expect(tick(app)!.checkIns).toEqual([t.id]);
    // Só quem ainda não fez check-in.
    expect(sent.map((s) => s.endpoint.split('/').pop())).toEqual(['sanji']);
    expect(sent[0].payload).toEqual({
      title: 'Copa Noturna',
      body: 'El check-in está abierto: confirma tu asistencia antes del inicio.',
      tag: `tour-${t.id}`,
      url: `/?torneio=${t.id}`,
    });
    expect(sent[0].ttl).toBe(29 * 60);
    expect(tick(app)!.checkIns).toEqual([]);
    expect(sent).toHaveLength(1);
    sent.length = 0;

    clock('2026-10-10T20:00:00Z');
    expect(tick(app)!.started).toEqual([t.id]);
    expect(to(sent, 'zoro').map((p) => p.body)).toEqual(['Rodada 1: entre na sala contra Sanji em até 10 min.']);
    expect(to(sent, 'sanji').map((p) => p.body)).toEqual(['Ronda 1: entra en la sala contra Zoro en un máximo de 10 min.']);
    expect(to(sent, 'robin')).toEqual([]);
    sent.length = 0;

    const match = (await req(app, 'GET', `/api/tournaments/${t.id}`, a)).json().rounds[0].matches[0];
    const play = (p: typeof a) => req(app, 'POST', `/api/tournaments/${t.id}/matches/${match.id}/play`, p);
    expect((await play(a)).statusCode).toBe(200);
    expect(to(sent, 'sanji').map((p) => p.body)).toEqual(['Zoro te está esperando en la sala.']);
    expect(to(sent, 'zoro')).toEqual([]);
    // Entrar de novo na mesma sala não repete o aviso.
    await play(a);
    expect(to(sent, 'sanji')).toHaveLength(1);
    sent.length = 0;
    // O oponente entra: a partida começa (aviso para quem esperava).
    expect((await play(b)).statusCode).toBe(200);
    expect(to(sent, 'zoro').map((p) => p.title)).toEqual(['Partida encontrada!']);
    expect(to(sent, 'sanji')).toEqual([]);
  });

  it('rodada gerada pelo organizador: bye e nome da fase na eliminatória', async () => {
    const { app, db, sent } = setup();
    const org = login(db, 'organizer');
    const ps = [login(db), login(db), login(db)];
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'single' })).json();
    for (const [i, p] of ps.entries()) {
      await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: ['st01-luffy', 'st02-kid', 'st03-crocodile'][i] });
      await subscribe(app, p.headers, `p${i}`, { locale: 'en' });
    }
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, org)).statusCode).toBe(200);
    const bodies = sent.map((s) => s.payload.body).sort();
    expect(bodies).toHaveLength(3);
    expect(bodies.filter((b) => b === 'Semifinal: you have a bye (automatic win).')).toHaveLength(1);
    expect(bodies.filter((b) => /^Semifinal: your match against .+ is ready\.$/.test(b))).toHaveLength(2);
  });
});
