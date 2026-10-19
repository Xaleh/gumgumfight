// API para parceiros: tokens pessoais e o middleware Bearer, as rotas de partidas para apps,
// o fluxo OAuth (code + PKCE, refresh com rotação) e o webhook "partida terminada".

import { actingPlayer, type Action, applyAction, type CardData, chooseSimpleBotAction, createGame, type DeckList } from '@gumgum/engine';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { ServerOptions } from '../src/config';
import { type DB, getCards, openDb } from '../src/db';
import { checkReplayToken, REPLAY_LINK_TTL_S, replayLinkSecret, signReplayToken } from '../src/partners/replay-link';
import { createToken, getToken, setClientWebhook, upsertClient } from '../src/partners/store';
import { seed } from '../src/seed';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8')) as DeckList;

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const BROWSER = { 'x-deck-owner': 'browser-0123456789abcdef' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async (kid: string) => (kid === 'k1' ? publicKey : null);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1001',
    email: 'nami@example.com',
    email_verified: true,
    name: 'Nami',
    picture: 'https://example.test/nami.png',
    iat: now,
    exp: now + 3600,
    ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

interface SetupOpts {
  now?: () => number;
  adminEmails?: string[];
  fetchImpl?: typeof fetch;
  logStream?: Writable;
  webhookRetryMs?: number[];
  server?: Partial<ServerOptions>;
}
function setup(o: SetupOpts = {}) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, {
    server: { cardImages: true, googleClientId: CLIENT_ID, adminEmails: o.adminEmails ?? [], ...o.server },
    googleKeys: keys,
    now: o.now,
    fetchImpl: o.fetchImpl,
    logger: o.logStream ? { stream: o.logStream } : undefined,
    webhookRetryMs: o.webhookRetryMs,
  });
  return { db, app };
}
type App = ReturnType<typeof setup>['app'];

async function login(a: App, claims: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await a.inject({ method: 'POST', url: '/api/auth/google', headers, payload: { credential: idToken(claims) } });
  const cookie = /gg_session=([^;]*)/.exec(String(res.headers['set-cookie']))?.[1];
  return { res, user: res.json().user as { id: string; role: string }, cookie: { cookie: `gg_session=${cookie}` } };
}

const ZORO = { sub: '2002', email: 'zoro@example.com', name: 'Zoro' };

/** Cria um token pessoal pela API (cookie) e devolve o header Bearer. */
async function personalToken(a: App, cookie: Record<string, string>, scopes: string[], name = 'sweetapp') {
  const res = await a.inject({ method: 'POST', url: '/api/tokens', headers: cookie, payload: { name, scopes } });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { id: string; token: string; scopes: string[] };
  return { ...body, bearer: { authorization: `Bearer ${body.token}` } };
}

/** Uma partida contra o bot jogada até o fim, no formato de `POST /api/matches`. */
function botMatch(db: DB, seedN = 7) {
  const decks = [luffy, luffy] as [DeckList, DeckList];
  const cards = getCards(db, [luffy.leader, ...luffy.cards.map((c) => c.id)]) as CardData[];
  let state = createGame({ seed: seedN, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
  const actions: Action[] = [];
  while (state.phase !== 'gameover' && actions.length < 3000) {
    const act = chooseSimpleBotAction(state, actingPlayer(state)!);
    actions.push(act);
    state = applyAction(state, act);
  }
  return { mode: 'bot', format: 'egb', seed: seedN, decks, actions, deckIds: ['st01-luffy', 'st01-luffy'] };
}

describe('tokens pessoais e middleware Bearer', () => {
  it('sem Authorization, cookie e x-deck-owner continuam valendo', async () => {
    const { app: a } = setup();
    const { cookie } = await login(a);
    expect((await a.inject({ method: 'POST', url: '/api/decks', headers: cookie, payload: { name: 'Conta', leader: 'ST01-001', cards: [] } })).statusCode).toBe(201);
    expect((await a.inject({ method: 'POST', url: '/api/decks', headers: BROWSER, payload: { name: 'Navegador', leader: 'ST01-001', cards: [] } })).statusCode).toBe(201);
    expect((await a.inject({ url: '/api/auth/me', headers: cookie })).json().user.email).toBe('nami@example.com');
  });

  it('um token com decks:write cria decks da conta, que aparecem no mine=1 da sessão de cookie', async () => {
    const { app: a } = setup();
    const { cookie, user } = await login(a);
    const tk = await personalToken(a, cookie, ['decks:read', 'decks:write']);
    expect(tk.token).toMatch(/^ggf_pat_[A-Za-z0-9_-]{43}$/);
    expect(tk.scopes).toEqual(['profile', 'decks:read', 'decks:write']);

    const created = await a.inject({ method: 'POST', url: '/api/decks', headers: tk.bearer, payload: { name: 'Do app', leader: 'ST01-001', cards: luffy.cards } });
    expect(created.statusCode).toBe(201);
    const deck = created.json();
    expect(deck).toMatchObject({ mine: true, valid: true, size: 50 });
    expect(deck.deckHash).toMatch(/^[0-9a-f]{16}$/);
    expect(deck.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const mine = (await a.inject({ url: '/api/decks?mine=1', headers: cookie })).json();
    expect(mine.map((d: { id: string }) => d.id)).toEqual([deck.id]);
    const viaToken = (await a.inject({ url: '/api/decks?mine=1', headers: tk.bearer })).json();
    expect(viaToken.map((d: { id: string }) => d.id)).toEqual([deck.id]);
    // Cookie e navegador são ignorados na requisição com token: o dono é sempre a conta do token.
    const other = await login(a, ZORO);
    const mixed = await a.inject({ method: 'POST', url: '/api/decks', headers: { ...tk.bearer, ...other.cookie, ...BROWSER }, payload: { name: 'Misto', leader: 'ST01-001', cards: [] } });
    expect((await a.inject({ url: `/api/decks/${mixed.json().id}`, headers: cookie })).json().deck.mine).toBe(true);
    expect(user.id).toBeTruthy();

    // Via token: só os próprios decks e os prontos.
    const zoroDeck = (await a.inject({ method: 'POST', url: '/api/decks', headers: other.cookie, payload: { name: 'Do Zoro', leader: 'ST01-001', cards: [] } })).json();
    expect((await a.inject({ url: `/api/decks/${zoroDeck.id}`, headers: tk.bearer })).statusCode).toBe(403);
    expect((await a.inject({ url: '/api/decks/st01-luffy', headers: tk.bearer })).statusCode).toBe(200);
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${zoroDeck.id}`, headers: tk.bearer })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${deck.id}`, headers: tk.bearer })).statusCode).toBe(204);
  });

  it('sem o scope: 403 insufficient_scope com o scope que faltou', async () => {
    const { app: a } = setup();
    const { cookie } = await login(a);
    const tk = await personalToken(a, cookie, ['decks:read']);
    const res = await a.inject({ method: 'POST', url: '/api/decks', headers: tk.bearer, payload: { name: 'x', leader: 'ST01-001', cards: [] } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ errorCode: 'insufficient_scope', errorParams: { scope: 'decks:write' } });
    expect((await a.inject({ url: '/api/players/me/matches', headers: tk.bearer })).json().errorCode).toBe('insufficient_scope');
    // profile é sempre concedido.
    expect((await a.inject({ url: '/api/players/me', headers: tk.bearer })).statusCode).toBe(200);
  });

  it('token revogado, expirado, inexistente, malformado ou um refresh usado como Bearer: 401', async () => {
    let clock = Date.now();
    const { app: a, db } = setup({ now: () => clock });
    const { cookie, user } = await login(a);
    const tk = await personalToken(a, cookie, ['decks:read']);
    const bad = async (authorization: string) => {
      const res = await a.inject({ url: '/api/decks?mine=1', headers: { authorization } });
      expect(res.statusCode).toBe(401);
      expect(res.json().errorCode).toBe('invalid_token');
      expect(res.headers['www-authenticate']).toMatch(/invalid_token/);
    };
    await bad('Bearer ggf_pat_inventado');
    await bad('Bearer');
    await bad(`Bearer ${'x'.repeat(300)}`);
    const refresh = createToken(db, { userId: user.id, kind: 'refresh', scopes: ['decks:read'], clientId: null, expiresSeconds: 3600 });
    await bad(`Bearer ${refresh.token}`);
    const expiring = createToken(db, { userId: user.id, kind: 'access', scopes: ['decks:read'], expiresSeconds: 60 });
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${expiring.token}` } })).statusCode).toBe(200);
    clock += 61_000;
    await bad(`Bearer ${expiring.token}`);
    expect((await a.inject({ method: 'DELETE', url: `/api/tokens/${tk.id}`, headers: cookie })).statusCode).toBe(204);
    await bad(`Bearer ${tk.token}`);
    // Outro esquema não é token de parceiro: a rota segue como se não houvesse header.
    expect((await a.inject({ url: '/api/auth/me', headers: { authorization: 'Basic abc' } })).json()).toEqual({ user: null });
  });

  it('allowlist: rotas sem config.scope recusam o token, e um admin age como Player', async () => {
    const { app: a } = setup({ adminEmails: ['nami@example.com'] });
    const { cookie, user } = await login(a);
    expect(user.role).toBe('admin');
    const tk = await personalToken(a, cookie, ['profile', 'decks:read', 'decks:write', 'matches:read', 'stats:read']);
    const forbidden = async (method: 'GET' | 'POST' | 'PUT', url: string) => {
      const res = await a.inject({ method, url, headers: tk.bearer, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().errorCode, url).toBe('token_not_allowed');
    };
    await forbidden('GET', '/api/admin/users');
    await forbidden('PUT', '/api/players/me');
    await forbidden('POST', '/api/auth/logout');
    await forbidden('POST', '/api/online/rooms');
    await forbidden('POST', '/api/tournaments');
    await forbidden('POST', '/api/matches');
    await forbidden('GET', '/api/tokens');
    await forbidden('POST', '/api/tokens');
    await forbidden('PUT', '/api/push/subscription');
    // /api/auth/me devolve só o id (como Player) e o perfil público: nunca o e-mail.
    const me = await a.inject({ url: '/api/auth/me', headers: tk.bearer });
    expect(me.json()).toEqual({ user: { id: user.id, role: 'player' }, player: null });
    expect(me.body).not.toContain('nami@example.com');
    await a.inject({ method: 'PUT', url: '/api/players/me', headers: cookie, payload: { name: 'Gata Ladra' } });
    expect((await a.inject({ url: '/api/auth/me', headers: tk.bearer })).json().player).toMatchObject({ name: 'Gata Ladra', tier: expect.any(String) });
    // Rota que não existe: 404 de sempre.
    expect((await a.inject({ url: '/api/nada', headers: tk.bearer })).statusCode).toBe(404);
  });

  it('a tela "Apps conectados": lista, limite de 10 e revogação', async () => {
    const { app: a } = setup();
    expect((await a.inject({ url: '/api/tokens' })).statusCode).toBe(401);
    const { cookie } = await login(a);
    expect((await a.inject({ method: 'POST', url: '/api/tokens', headers: cookie, payload: { name: '', scopes: [] } })).json().errorCode).toBe('tokenNameRequired');
    expect((await a.inject({ method: 'POST', url: '/api/tokens', headers: cookie, payload: { name: 'x', scopes: ['admin'] } })).json().errorCode).toBe('tokenScopesInvalid');
    const first = await personalToken(a, cookie, ['decks:read']);
    await a.inject({ url: '/api/decks?mine=1', headers: first.bearer });
    const list = (await a.inject({ url: '/api/tokens', headers: cookie })).json();
    expect(list.scopes).toEqual(['profile', 'decks:read', 'decks:write', 'matches:read', 'stats:read']);
    expect(list.tokens).toEqual([
      { id: first.id, name: 'sweetapp', kind: 'personal', client: null, scopes: ['profile', 'decks:read'], createdAt: expect.stringMatching(/Z$/), lastUsedAt: expect.stringMatching(/Z$/) },
    ]);
    expect(JSON.stringify(list)).not.toContain(first.token);
    for (let i = 1; i < 10; i++) await personalToken(a, cookie, ['decks:read'], `t${i}`);
    const over = await a.inject({ method: 'POST', url: '/api/tokens', headers: cookie, payload: { name: 'demais', scopes: [] } });
    expect(over.statusCode).toBe(400);
    expect(over.json().errorCode).toBe('token_limit');
    // Só o dono revoga.
    const zoro = await login(a, ZORO);
    expect((await a.inject({ method: 'DELETE', url: `/api/tokens/${first.id}`, headers: zoro.cookie })).statusCode).toBe(404);
    expect((await a.inject({ method: 'DELETE', url: `/api/tokens/${first.id}`, headers: cookie })).statusCode).toBe(204);
    expect((await a.inject({ url: '/api/tokens', headers: cookie })).json().tokens).toHaveLength(9);
    // Sair não revoga os tokens.
    const second = await personalToken(a, cookie, ['decks:read'], 'fica');
    await a.inject({ method: 'POST', url: '/api/auth/logout', headers: cookie });
    expect((await a.inject({ url: '/api/decks?mine=1', headers: second.bearer })).statusCode).toBe(200);
  });

  it('PUT /api/decks/:id com expectedUpdatedAt antigo: 409 com a versão atual', async () => {
    const { app: a } = setup();
    const { cookie } = await login(a);
    const tk = await personalToken(a, cookie, ['decks:read', 'decks:write']);
    const deck = (await a.inject({ method: 'POST', url: '/api/decks', headers: tk.bearer, payload: { name: 'Sync', leader: 'ST01-001', cards: luffy.cards } })).json();
    const body = { name: 'Sync v2', leader: 'ST01-001', cards: luffy.cards.slice(1) };
    const stale = new Date(Date.parse(`${deck.updatedAt.replace(' ', 'T')}Z`) - 3600_000).toISOString();
    const conflict = await a.inject({ method: 'PUT', url: `/api/decks/${deck.id}`, headers: tk.bearer, payload: { ...body, expectedUpdatedAt: stale } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ errorCode: 'deck_conflict', current: { id: deck.id, name: 'Sync', cards: luffy.cards, summary: { size: 50 } } });
    expect(conflict.json().current.updatedAt).toMatch(/Z$/);
    expect(conflict.body).not.toContain('ownerHash');
    // A mesma data (no formato do SQLite ou em ISO): sem conflito.
    expect((await a.inject({ method: 'PUT', url: `/api/decks/${deck.id}`, headers: tk.bearer, payload: { ...body, expectedUpdatedAt: deck.updatedAt } })).statusCode).toBe(200);
    const iso = `${deck.updatedAt.replace(' ', 'T')}Z`;
    const header = await a.inject({ method: 'PUT', url: `/api/decks/${deck.id}`, headers: { ...tk.bearer, 'if-unmodified-since': iso }, payload: body });
    expect(header.statusCode).toBe(200);
    expect((await a.inject({ method: 'PUT', url: `/api/decks/${deck.id}`, headers: tk.bearer, payload: { ...body, expectedUpdatedAt: 'ontem' } })).statusCode).toBe(400);
  });

  it('o header Authorization não aparece no log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const { app: a } = setup({ logStream: stream });
    const secret = `ggf_pat_${randomBytes(32).toString('base64url')}`;
    await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${secret}` } });
    a.log.info({ req: { headers: { authorization: `Bearer ${secret}`, host: 'x' } } }, 'requisição');
    a.log.warn({ headers: { authorization: `Bearer ${secret}` } }, 'headers');
    const all = lines.join('');
    expect(all).toContain('[Redacted]');
    expect(all).not.toContain(secret);
  });

  it('rate limit por token: 120 por minuto, depois 429 com Retry-After', async () => {
    let clock = Date.now();
    const { app: a } = setup({ now: () => clock });
    const { cookie } = await login(a);
    const tk = await personalToken(a, cookie, ['profile']);
    for (let i = 0; i < 120; i++) expect((await a.inject({ url: '/api/players/me', headers: tk.bearer })).statusCode).toBe(200);
    const limited = await a.inject({ url: '/api/players/me', headers: tk.bearer });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().errorCode).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    clock += 61_000;
    expect((await a.inject({ url: '/api/players/me', headers: tk.bearer })).statusCode).toBe(200);
  });
});

describe('partidas para apps', () => {
  it('GET /api/players/me/matches: só as do usuário, mais novas primeiro, com since e cursor', async () => {
    const { app: a, db } = setup();
    const { cookie } = await login(a);
    const zoro = await login(a, ZORO);
    const tk = await personalToken(a, cookie, ['matches:read']);
    expect((await a.inject({ url: '/api/players/me/matches' })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/players/me/matches', headers: tk.bearer })).json()).toEqual({ matches: [], nextCursor: null });

    const ids: number[] = [];
    for (const s of [7, 8, 9]) ids.push((await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, s) })).json().id);
    await a.inject({ method: 'POST', url: '/api/matches', headers: zoro.cookie, payload: botMatch(db, 10) });

    const all = (await a.inject({ url: '/api/players/me/matches', headers: tk.bearer })).json();
    expect(all.matches.map((m: { id: number }) => m.id)).toEqual([...ids].reverse());
    expect(all.nextCursor).toBeNull();
    expect(all.matches[0]).toMatchObject({
      mode: 'bot',
      queue: 'casual',
      format: 'egb',
      seat: 0,
      leader: 'ST01-001',
      oppLeader: 'ST01-001',
      oppController: 'bot',
      deckId: 'st01-luffy',
      deckHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      wentFirst: expect.any(Boolean),
      won: expect.any(Boolean),
      mulligan: expect.any(Boolean),
      turns: expect.any(Number),
      tournamentId: null,
      playedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });
    expect(JSON.stringify(all)).not.toContain('nami@example.com');
    expect(JSON.stringify(all)).not.toContain('p-');

    const page1 = (await a.inject({ url: '/api/players/me/matches?limit=2', headers: tk.bearer })).json();
    expect(page1.matches.map((m: { id: number }) => m.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).toBe(ids[1]);
    const page2 = (await a.inject({ url: `/api/players/me/matches?limit=2&cursor=${page1.nextCursor}`, headers: tk.bearer })).json();
    expect(page2.matches.map((m: { id: number }) => m.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await a.inject({ url: `/api/players/me/matches?since=${encodeURIComponent(future)}`, headers: tk.bearer })).json().matches).toEqual([]);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await a.inject({ url: `/api/players/me/matches?since=${encodeURIComponent(past)}`, headers: tk.bearer })).json().matches).toHaveLength(3);
    expect((await a.inject({ url: '/api/players/me/matches?since=ontem', headers: tk.bearer })).statusCode).toBe(400);
    expect((await a.inject({ url: '/api/players/me/matches?limit=0', headers: tk.bearer })).statusCode).toBe(400);
  });

  it('GET /api/matches/:id: resumo com as cartas do próprio lado; o oponente vem null; partida alheia 403', async () => {
    const { app: a, db } = setup();
    const { cookie } = await login(a);
    const zoro = await login(a, ZORO);
    const tk = await personalToken(a, cookie, ['matches:read']);
    const zoroTk = await personalToken(a, zoro.cookie, ['matches:read']);
    const saved = (await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 11) })).json();

    const res = await a.inject({ url: `/api/matches/${saved.id}`, headers: tk.bearer });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m).toMatchObject({ id: saved.id, mode: 'bot', queue: 'casual', format: 'egb', winner: saved.winner, turns: saved.turns, you: 0, replayVersion: expect.any(Number), reports: [] });
    expect(m.firstPlayer === 0 || m.firstPlayer === 1).toBe(true);
    expect(typeof m.reasonKey === 'string' || m.reasonKey === null).toBe(true);
    expect(m.seats).toHaveLength(2);
    expect(m.seats[0]).toMatchObject({ seat: 0, leader: 'ST01-001', deckHash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(m.seats[0].cards.length).toBeGreaterThan(5);
    expect(m.seats[0].cards[0]).toEqual({ id: expect.any(String), copies: expect.any(Number), opening: expect.any(Number), drawn: expect.any(Number), played: expect.any(Number) });
    expect(m.seats[1].cards).toBeNull();

    expect((await a.inject({ url: `/api/matches/${saved.id}`, headers: zoroTk.bearer })).statusCode).toBe(403);
    expect((await a.inject({ url: `/api/matches/${saved.id}/replay`, headers: zoroTk.bearer })).statusCode).toBe(403);
    const replay = (await a.inject({ url: `/api/matches/${saved.id}/replay`, headers: tk.bearer })).json();
    expect(replay).toMatchObject({ format: 'gumgumfight-replay', winner: saved.winner });
    expect(replay.actions.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ replay embutido

const SWEET_ORIGIN = 'https://sweet.example';

/** Põe a partida gravada num torneio (só as linhas que o resumo da partida lê). */
function inTournament(db: DB, matchId: number, organizerId: string, status: 'running' | 'finished') {
  db.prepare("INSERT INTO tournaments (id, name, format, structure, status, organizer_id) VALUES ('t-embed', 'Copa', 'standard', 'swiss', ?, ?)").run(status, organizerId);
  const tm = db.prepare("INSERT INTO tournament_matches (tournament_id, round, table_no, p1) VALUES ('t-embed', 1, 1, ?)").run(organizerId);
  db.prepare("INSERT INTO tournament_games (tournament_id, match_id, game, stats_match_id, played_at) VALUES ('t-embed', ?, 1, ?, datetime('now'))").run(
    Number(tm.lastInsertRowid),
    matchId,
  );
}

describe('replay embutido (iframe com link assinado)', () => {
  it('token: ligado à partida, com validade, e recusa assinatura mexida ou formato errado', () => {
    const secret = randomBytes(32);
    const now = 1_800_000_000;
    const token = signReplayToken(secret, 42, now + 60);
    expect(checkReplayToken(secret, 42, token, now)).toBe('ok');
    expect(checkReplayToken(secret, 43, token, now)).toBe('invalid');
    expect(checkReplayToken(secret, 42, token, now + 60)).toBe('expired');
    expect(checkReplayToken(randomBytes(32), 42, token, now)).toBe('invalid');
    const [exp, sig] = token.split('.');
    // Trocar a validade invalida a assinatura.
    expect(checkReplayToken(secret, 42, `${(now + 99_999).toString(36)}.${sig}`, now)).toBe('invalid');
    expect(checkReplayToken(secret, 42, `${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, now)).toBe('invalid');
    for (const bad of [undefined, '', 'abc', `${exp}.`, `.${sig}`, `${exp}.${sig}.x`, 'x'.repeat(500)]) expect(checkReplayToken(secret, 42, bad, now)).toBe('invalid');
  });

  it('o segredo nasce no banco na primeira vez e depois é o mesmo; REPLAY_LINK_SECRET fixa outro', () => {
    const db = openDb(':memory:');
    const a = replayLinkSecret(db);
    expect(a).toHaveLength(32);
    expect(replayLinkSecret(db).equals(a)).toBe(true);
    expect(replayLinkSecret(db, 'segredo-do-env').toString()).toBe('segredo-do-env');
  });

  it('POST /api/matches/:id/replay-link → GET /api/replay/:id sem sessão, com as cartas usadas; expira em 1 hora', async () => {
    let clock = Date.now();
    const { app: a, db } = setup({ now: () => clock, server: { replayEmbedOrigins: [SWEET_ORIGIN] } });
    const { cookie } = await login(a);
    const zoro = await login(a, ZORO);
    const tk = await personalToken(a, cookie, ['matches:read']);
    const decksOnly = await personalToken(a, cookie, ['decks:read'], 'só decks');
    const zoroTk = await personalToken(a, zoro.cookie, ['matches:read']);
    const saved = (await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 13) })).json();
    const linkUrl = `/api/matches/${saved.id}/replay-link`;

    // Quem não jogou, sem login, sem o scope ou partida inexistente: sem link.
    expect((await a.inject({ method: 'POST', url: linkUrl, headers: zoroTk.bearer })).json().errorCode).toBe('replayForbidden');
    expect((await a.inject({ method: 'POST', url: linkUrl })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: linkUrl, headers: decksOnly.bearer })).json().errorCode).toBe('insufficient_scope');
    expect((await a.inject({ method: 'POST', url: '/api/matches/99999/replay-link', headers: tk.bearer })).statusCode).toBe(404);

    const res = await a.inject({ method: 'POST', url: linkUrl, headers: tk.bearer, payload: { lang: 'pt-BR', layout: 'lateral' } });
    expect(res.statusCode).toBe(201);
    const link = res.json() as { url: string; token: string; matchId: number; expiresAt: string };
    expect(link.matchId).toBe(saved.id);
    expect(Date.parse(link.expiresAt) - clock).toBeGreaterThan((REPLAY_LINK_TTL_S - 2) * 1000);
    expect(Date.parse(link.expiresAt) - clock).toBeLessThanOrEqual(REPLAY_LINK_TTL_S * 1000);
    const url = new URL(link.url);
    expect(url.pathname).toBe(`/replay/${saved.id}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ t: link.token, embed: '1', lang: 'pt-BR', layout: 'lateral' });
    // Valores desconhecidos ficam de fora; embed: false tira o embed=1. O site (cookie) também pede o link.
    const plain = (await a.inject({ method: 'POST', url: linkUrl, headers: cookie, payload: { lang: '<script>', layout: 'x', embed: false } })).json();
    expect([...new URL(plain.url).searchParams.keys()]).toEqual(['t']);

    // Sem cookie nem Bearer: o token basta.
    const got = await a.inject({ url: `/api/replay/${saved.id}?t=${link.token}` });
    expect(got.statusCode).toBe(200);
    expect(got.headers['cache-control']).toBe('no-store');
    const body = got.json() as { replay: { format: string; actions: unknown[]; decks: DeckList[] }; cards: CardData[]; origins: string[] };
    expect(body.replay).toMatchObject({ format: 'gumgumfight-replay', winner: saved.winner });
    expect(body.replay.actions.length).toBeGreaterThan(0);
    expect(body.origins).toEqual([SWEET_ORIGIN]);
    const used = new Set([luffy.leader, ...luffy.cards.map((c) => c.id)]);
    expect(new Set(body.cards.map((c) => c.id))).toEqual(used);

    // De outra partida, mexido ou ausente: inválido.
    const other = (await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 17) })).json();
    expect((await a.inject({ url: `/api/replay/${other.id}?t=${link.token}` })).json().errorCode).toBe('replay_link_invalid');
    expect((await a.inject({ url: `/api/replay/${saved.id}?t=${link.token.slice(0, -2)}xx` })).statusCode).toBe(401);
    expect((await a.inject({ url: `/api/replay/${saved.id}` })).json().errorCode).toBe('replay_link_invalid');
    expect((await a.inject({ url: `/api/replay/abc?t=${link.token}` })).statusCode).toBe(401);

    // Um Bearer não abre esta rota (ela não declara scope).
    expect((await a.inject({ url: `/api/replay/${saved.id}?t=${link.token}`, headers: tk.bearer })).json().errorCode).toBe('token_not_allowed');

    clock += REPLAY_LINK_TTL_S * 1000 + 1000;
    const late = await a.inject({ url: `/api/replay/${saved.id}?t=${link.token}` });
    expect(late.statusCode).toBe(401);
    expect(late.json().errorCode).toBe('replay_link_expired');
  });

  it('partida de torneio: sem link nem replay até o torneio terminar', async () => {
    const { app: a, db } = setup();
    const { cookie, user } = await login(a);
    const tk = await personalToken(a, cookie, ['matches:read']);
    const saved = (await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 19) })).json();
    inTournament(db, saved.id, user.id, 'running');
    const linkUrl = `/api/matches/${saved.id}/replay-link`;
    expect((await a.inject({ method: 'POST', url: linkUrl, headers: tk.bearer })).json().errorCode).toBe('replayTournamentRunning');
    // Um link assinado antes (ou por fora) também não abre enquanto o torneio corre.
    const token = signReplayToken(replayLinkSecret(db), saved.id, Math.floor(Date.now() / 1000) + 600);
    const sealed = await a.inject({ url: `/api/replay/${saved.id}?t=${token}` });
    expect(sealed.statusCode).toBe(403);
    expect(sealed.json().errorCode).toBe('replayTournamentRunning');

    db.prepare("UPDATE tournaments SET status = 'finished' WHERE id = 't-embed'").run();
    expect((await a.inject({ method: 'POST', url: linkUrl, headers: tk.bearer })).statusCode).toBe(201);
    expect((await a.inject({ url: `/api/replay/${saved.id}?t=${token}` })).statusCode).toBe(200);
  });

  it('iframe: só /replay/<id> libera as origens dos parceiros; o resto do site responde frame-ancestors none', async () => {
    const { app: a } = setup({ server: { replayEmbedOrigins: [SWEET_ORIGIN, 'http://localhost:4000'] } });
    const page = await a.inject({ url: '/replay/1?t=x&embed=1' });
    expect(page.headers['content-security-policy']).toBe(`frame-ancestors 'self' ${SWEET_ORIGIN} http://localhost:4000`);
    expect(page.headers['x-frame-options']).toBeUndefined();
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    for (const url of ['/api/health', '/api/cards/ST01-001', '/api/replay/1?t=x', '/qualquer']) {
      const res = await a.inject({ url });
      expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'none'");
      expect(res.headers['x-frame-options'], url).toBe('DENY');
    }
    // Sem REPLAY_EMBED_ORIGINS, só o próprio site.
    const { app: closed } = setup();
    expect((await closed.inject({ url: '/replay/1' })).headers['content-security-policy']).toBe("frame-ancestors 'self'");
  });

  it('homologação só para apoiadores: o replay com link assinado continua abrindo', async () => {
    const db = openDb(':memory:');
    seed(db);
    const open = buildApp(db, { server: { cardImages: true } });
    const gated = buildApp(db, { server: { cardImages: true, access: { mode: 'supporters' } } });
    const saved = (await open.inject({ method: 'POST', url: '/api/matches', headers: BROWSER, payload: botMatch(db, 23) })).json();
    const token = signReplayToken(replayLinkSecret(db), saved.id, Math.floor(Date.now() / 1000) + 600);
    expect((await gated.inject({ url: `/api/replay/${saved.id}?t=${token}` })).statusCode).toBe(200);
    expect((await gated.inject({ url: '/api/cards' })).statusCode).toBe(403);
  });
});

// ------------------------------------------------------------------ OAuth

const REDIRECT = 'https://sweet.example/integrations/ggf/callback';
const SCOPE = 'decks:read decks:write matches:read stats:read';

function registerSweetapp(db: DB, extra: { webhookUrl?: string } = {}) {
  const { secret } = upsertClient(db, { id: 'sweetapp', name: 'sweetapp', redirectUris: [REDIRECT, 'http://localhost:4000/cb'], scopes: ['decks:read', 'decks:write', 'matches:read', 'stats:read'] });
  const webhookSecret = extra.webhookUrl ? setClientWebhook(db, 'sweetapp', extra.webhookUrl) : null;
  return { secret, webhookSecret };
}

const pkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const authorizeUrl = (challenge: string, over: Record<string, string> = {}) =>
  `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'sweetapp', redirect_uri: REDIRECT, scope: SCOPE, state: 'abc123', code_challenge: challenge, code_challenge_method: 'S256', ...over })}`;

const form = (fields: Record<string, string>) => ({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() });

/** Autoriza o app pela tela de consentimento e troca o code: devolve os tokens. */
async function link(a: App, cookie: Record<string, string>, secret: string, scope = SCOPE) {
  const { verifier, challenge } = pkce();
  const url = authorizeUrl(challenge, { scope });
  const consent = await a.inject({ method: 'POST', url: '/api/oauth/consent', headers: cookie, payload: { ...Object.fromEntries(new URL(url, 'http://x').searchParams), decision: 'allow' } });
  expect(consent.statusCode).toBe(200);
  const redirect = new URL(consent.json().redirect);
  const code = redirect.searchParams.get('code')!;
  const tok = await a.inject({
    method: 'POST',
    url: '/api/oauth/token',
    ...form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'sweetapp', client_secret: secret, code_verifier: verifier }),
  });
  expect(tok.statusCode).toBe(200);
  return { ...(tok.json() as { access_token: string; refresh_token: string; scope: string; expires_in: number }), code, verifier };
}

describe('OAuth (authorization code + PKCE)', () => {
  it('fluxo completo: authorize → consentimento → code → token → Bearer → refresh com rotação', async () => {
    const { app: a, db } = setup();
    const { secret } = registerSweetapp(db);
    const { cookie } = await login(a);
    const { verifier, challenge } = pkce();

    // A página: sem WEB_DIST, uma página mínima; sempre sem iframe e sem cache.
    const page = await a.inject({ url: authorizeUrl(challenge) });
    expect(page.statusCode).toBe(200);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    // O que a tela mostra.
    const info = await a.inject({ url: authorizeUrl(challenge).replace('/oauth/authorize', '/api/oauth/consent') });
    expect(info.json()).toEqual({ client: { id: 'sweetapp', name: 'sweetapp' }, scopes: ['profile', 'decks:read', 'decks:write', 'matches:read', 'stats:read'], loggedIn: false, already: false });
    expect((await a.inject({ url: authorizeUrl(challenge).replace('/oauth/authorize', '/api/oauth/consent'), headers: cookie })).json()).toMatchObject({ loggedIn: true, already: false });

    // Permitir exige login.
    const params = Object.fromEntries(new URL(authorizeUrl(challenge), 'http://x').searchParams);
    expect((await a.inject({ method: 'POST', url: '/api/oauth/consent', payload: { ...params, decision: 'allow' } })).statusCode).toBe(401);
    const consent = await a.inject({ method: 'POST', url: '/api/oauth/consent', headers: cookie, payload: { ...params, decision: 'allow' } });
    const redirect = new URL(consent.json().redirect);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('abc123');
    const code = redirect.searchParams.get('code')!;
    expect(code.length).toBeGreaterThan(20);

    const exchange = (fields: Record<string, string>) =>
      a.inject({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'sweetapp', client_secret: secret, code_verifier: verifier, ...fields }) });
    expect((await exchange({ client_secret: 'errado' })).statusCode).toBe(401);
    expect((await exchange({ code_verifier: `${verifier.slice(1)}x` })).json().error).toBe('invalid_grant');
    expect((await exchange({ redirect_uri: `${REDIRECT}/` })).json().error).toBe('invalid_grant');
    const tok = await exchange({});
    expect(tok.statusCode).toBe(200);
    expect(tok.headers['cache-control']).toBe('no-store');
    const pair = tok.json();
    expect(pair).toEqual({
      access_token: expect.stringMatching(/^ggf_at_/),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^ggf_rt_/),
      scope: 'profile decks:read decks:write matches:read stats:read',
    });

    // O access vale como a conta; o refresh não entra como Bearer.
    const bearer = { authorization: `Bearer ${pair.access_token}` };
    expect((await a.inject({ method: 'POST', url: '/api/decks', headers: bearer, payload: { name: 'Via OAuth', leader: 'ST01-001', cards: [] } })).statusCode).toBe(201);
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${pair.refresh_token}` } })).statusCode).toBe(401);
    // Já autorizado: a tela pode pular o consentimento.
    expect((await a.inject({ url: authorizeUrl(pkce().challenge).replace('/oauth/authorize', '/api/oauth/consent'), headers: cookie })).json().already).toBe(true);
    // Aparece em "Apps conectados" como app.
    const apps = (await a.inject({ url: '/api/tokens', headers: cookie })).json().tokens;
    expect(apps).toEqual([expect.objectContaining({ kind: 'app', name: 'sweetapp', client: { id: 'sweetapp', name: 'sweetapp' } })]);

    // Usar o code de novo: 400 e os tokens do primeiro uso caem.
    expect((await exchange({})).json().error).toBe('invalid_grant');
    expect((await a.inject({ url: '/api/decks?mine=1', headers: bearer })).statusCode).toBe(401);

    // Refresh: novo par; o refresh antigo não vale mais; usá-lo de novo derruba a cadeia inteira.
    const second = await link(a, cookie, secret);
    const refresh = (token: string) => a.inject({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: token, client_id: 'sweetapp', client_secret: secret }) });
    const rotated = (await refresh(second.refresh_token)).json();
    expect(rotated.access_token).toMatch(/^ggf_at_/);
    expect(rotated.refresh_token).not.toBe(second.refresh_token);
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${second.access_token}` } })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${rotated.access_token}` } })).statusCode).toBe(200);
    expect((await refresh(second.refresh_token)).json().error).toBe('invalid_grant');
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${rotated.access_token}` } })).statusCode).toBe(401);
    expect((await refresh(rotated.refresh_token)).json().error).toBe('invalid_grant');
    expect((await a.inject({ url: '/api/tokens', headers: cookie })).json().tokens).toEqual([]);
  });

  it('redirect_uri diferente (até uma barra a mais) e client_id errado: recusados sem redirecionar', async () => {
    const { app: a, db } = setup();
    registerSweetapp(db);
    const { challenge } = pkce();
    const cases: Array<Record<string, string>> = [{ redirect_uri: `${REDIRECT}/` }, { redirect_uri: 'https://evil.example/cb' }, { client_id: 'outro' }];
    for (const over of cases) {
      const res = await a.inject({ url: authorizeUrl(challenge, over) });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers.location).toBeUndefined();
      const api = await a.inject({ url: authorizeUrl(challenge, over).replace('/oauth/authorize', '/api/oauth/consent') });
      expect(api.statusCode).toBe(400);
      expect(api.json().redirect).toBeNull();
    }
    // Outros erros voltam ao app com ?error=…&state=….
    const noState = await a.inject({ url: authorizeUrl(challenge, { state: '' }) });
    expect(noState.statusCode).toBe(302);
    expect(noState.headers.location).toBe(`${REDIRECT}?error=invalid_request`);
    const plain = await a.inject({ url: authorizeUrl(challenge, { code_challenge_method: 'plain' }) });
    expect(plain.headers.location).toBe(`${REDIRECT}?error=invalid_request&state=abc123`);
    const scope = await a.inject({ url: authorizeUrl(challenge, { scope: 'decks:read admin' }) });
    expect(scope.headers.location).toBe(`${REDIRECT}?error=invalid_scope&state=abc123`);
    expect((await a.inject({ url: authorizeUrl(challenge, { response_type: 'token' }) })).headers.location).toContain('error=unsupported_response_type');
  });

  it('cancelar, code expirado, revogação pelo app e limite de tentativas', async () => {
    let clock = Date.now();
    const { app: a, db } = setup({ now: () => clock });
    const { secret } = registerSweetapp(db);
    const { cookie } = await login(a);
    const { verifier, challenge } = pkce();
    const params = Object.fromEntries(new URL(authorizeUrl(challenge), 'http://x').searchParams);
    const denied = await a.inject({ method: 'POST', url: '/api/oauth/consent', headers: cookie, payload: { ...params, decision: 'deny' } });
    expect(denied.json().redirect).toBe(`${REDIRECT}?error=access_denied&state=abc123`);

    const allowed = await a.inject({ method: 'POST', url: '/api/oauth/consent', headers: cookie, payload: { ...params, decision: 'allow' } });
    const code = new URL(allowed.json().redirect).searchParams.get('code')!;
    db.prepare("UPDATE oauth_codes SET expires_at = datetime('now', '-1 minute')").run();
    const late = await a.inject({ method: 'POST', url: '/api/oauth/token', ...form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'sweetapp', client_secret: secret, code_verifier: verifier }) });
    expect(late.json()).toMatchObject({ error: 'invalid_grant', error_description: expect.stringMatching(/expirado/) });

    // JSON também serve, e as credenciais podem ir em Basic.
    const basic = { authorization: `Basic ${Buffer.from(`sweetapp:${secret}`).toString('base64')}` };
    const pair = await link(a, cookie, secret);
    const revoke = await a.inject({ method: 'POST', url: '/api/oauth/revoke', headers: basic, payload: { token: pair.refresh_token } });
    expect(revoke.statusCode).toBe(200);
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${pair.access_token}` } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/oauth/revoke', headers: basic, payload: { token: 'nada' } })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/api/oauth/revoke', payload: { token: 'nada', client_id: 'sweetapp', client_secret: 'x' } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/oauth/token', headers: basic, payload: { grant_type: 'password' } })).json().error).toBe('unsupported_grant_type');

    // 10 tentativas por minuto por cliente.
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await a.inject({ method: 'POST', url: '/api/oauth/token', headers: basic, payload: { grant_type: 'authorization_code', code: 'x' } })).statusCode;
    expect(last).toBe(429);
    clock += 61_000;
    expect((await a.inject({ method: 'POST', url: '/api/oauth/token', headers: basic, payload: { grant_type: 'authorization_code', code: 'x' } })).statusCode).toBe(400);

    // Revogar o app pela tela "Apps conectados" apaga todos os tokens dele.
    const again = await link(a, cookie, secret);
    const app = (await a.inject({ url: '/api/tokens', headers: cookie })).json().tokens.find((t: { kind: string }) => t.kind === 'app');
    expect((await a.inject({ method: 'DELETE', url: `/api/tokens/${app.id}`, headers: cookie })).statusCode).toBe(204);
    expect((await a.inject({ url: '/api/decks?mine=1', headers: { authorization: `Bearer ${again.access_token}` } })).statusCode).toBe(401);
    expect(getToken(db, app.id)?.revokedAt).toBeTruthy();
  });
});

// ------------------------------------------------------------------ webhook

describe('webhook "partida terminada"', () => {
  type Call = { url: string; headers: Record<string, string>; body: string };
  const recorder = (statuses: number[] = []) => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url: String(input), headers, body: String(init?.body) });
      expect(init?.redirect).toBe('manual');
      return new Response('', { status: statuses.shift() ?? 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };

  it('assina o aviso com o segredo do cliente; quem não autorizou não gera envio', async () => {
    const rec = recorder();
    const { app: a, db } = setup({ fetchImpl: rec.fetchImpl, webhookRetryMs: [0, 0] });
    const { secret, webhookSecret } = registerSweetapp(db, { webhookUrl: 'http://sweet.example/integrations/ggf/webhook' });
    const { cookie, user } = await login(a);
    const zoro = await login(a, ZORO);
    await link(a, cookie, secret);

    const saved = await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 12) });
    expect(saved.statusCode).toBe(200);
    await a.webhooks.idle();
    expect(rec.calls).toHaveLength(1);
    const call = rec.calls[0];
    expect(call.url).toBe('http://sweet.example/integrations/ggf/webhook');
    expect(call.headers['content-type']).toBe('application/json');
    const ts = Number(call.headers['x-ggf-timestamp']);
    expect(Math.abs(Date.now() / 1000 - ts)).toBeLessThan(60);
    expect(call.headers['x-ggf-signature']).toBe(`sha256=${createHmac('sha256', webhookSecret!).update(`${ts}.${call.body}`).digest('hex')}`);
    expect(JSON.parse(call.body)).toEqual({
      event: 'match.finished',
      id: expect.stringMatching(/^evt-[0-9a-f]{10}$/),
      createdAt: expect.stringMatching(/Z$/),
      userId: user.id,
      matchId: saved.json().id,
      queue: 'casual',
      format: 'egb',
      won: expect.any(Boolean),
    });

    await a.inject({ method: 'POST', url: '/api/matches', headers: zoro.cookie, payload: botMatch(db, 13) });
    await a.webhooks.idle();
    expect(rec.calls).toHaveLength(1);
    // Token pessoal não recebe webhook; app revogado também não.
    await personalToken(a, zoro.cookie, ['matches:read']);
    const app = (await a.inject({ url: '/api/tokens', headers: cookie })).json().tokens.find((t: { kind: string }) => t.kind === 'app');
    await a.inject({ method: 'DELETE', url: `/api/tokens/${app.id}`, headers: cookie });
    await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 14) });
    await a.inject({ method: 'POST', url: '/api/matches', headers: zoro.cookie, payload: botMatch(db, 15) });
    await a.webhooks.idle();
    expect(rec.calls).toHaveLength(1);
  });

  it('falha do destino não impede a gravação e gera novas tentativas', async () => {
    const rec = recorder([500, 503, 200, 500, 500, 500]);
    const { app: a, db } = setup({ fetchImpl: rec.fetchImpl, webhookRetryMs: [0, 0] });
    const { secret } = registerSweetapp(db, { webhookUrl: 'http://sweet.example/hook' });
    const { cookie } = await login(a);
    await link(a, cookie, secret);
    const saved = await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 16) });
    expect(saved.statusCode).toBe(200);
    expect((await a.inject({ url: '/api/stats?mine=1', headers: cookie })).json().summary.games).toBe(1);
    await a.webhooks.idle();
    expect(rec.calls).toHaveLength(3);
    const ids = new Set(rec.calls.map((c) => JSON.parse(c.body).id));
    expect(ids.size).toBe(1);
    // Três falhas: desiste (e a partida continua gravada).
    await a.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: botMatch(db, 17) });
    await a.webhooks.idle();
    expect(rec.calls).toHaveLength(6);
    expect((await a.inject({ url: '/api/stats?mine=1', headers: cookie })).json().summary.games).toBe(2);
  });
});
