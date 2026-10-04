import { actingPlayer, type Action, applyAction, type CardData, chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { googleKeyStore, verifyGoogleIdToken } from '../src/auth/google';
import { getCards, openDb } from '../src/db';
import { seed } from '../src/seed';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8'));

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const BROWSER = { 'x-deck-owner': 'browser-0123456789abcdef' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async (kid: string) => (kid === 'k1' ? publicKey : null);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown> = {}, opts: { kid?: string; key?: KeyObject } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
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
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

function setup(clientId: string | null = CLIENT_ID) {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true, googleClientId: clientId }, googleKeys: keys }) };
}
const app = (clientId?: string | null) => setup(clientId).app;

type App = ReturnType<typeof app>;
async function login(a: App, claims: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await a.inject({ method: 'POST', url: '/api/auth/google', headers, payload: { credential: idToken(claims) } });
  const cookie = /gg_session=([^;]*)/.exec(String(res.headers['set-cookie']))?.[1];
  return { res, cookie: { cookie: `gg_session=${cookie}` } };
}

describe('ID token do Google', () => {
  it('aceita um token válido', async () => {
    expect(await verifyGoogleIdToken(idToken(), CLIENT_ID, keys)).toEqual({
      sub: '1001',
      email: 'nami@example.com',
      emailVerified: true,
      name: 'Nami',
      picture: 'https://example.test/nami.png',
    });
  });

  it('recusa assinatura, emissor, público, validade e chave errados', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const bad = (t: string) => expect(verifyGoogleIdToken(t, CLIENT_ID, keys)).rejects.toThrow();
    await bad(idToken({}, { key: other }));
    await bad(idToken({ iss: 'https://evil.example' }));
    await bad(idToken({ aud: 'outro-site' }));
    await bad(idToken({ exp: Math.floor(Date.now() / 1000) - 600 }));
    await bad(idToken({}, { kid: 'k2' }));
    await bad(idToken({ sub: '' }));
    await bad('nao.e.jwt');
    const [h, p] = idToken().split('.');
    await bad(`${h}.${p}.`);
  });

  it('guarda as chaves do Google e busca de novo quando aparece um kid novo', async () => {
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=600' } });
    }) as typeof fetch;
    const store = googleKeyStore(fakeFetch, 'https://example.test/certs');
    expect(await store('k1')).not.toBeNull();
    expect(await store('k1')).not.toBeNull();
    expect(calls).toBe(1);
    expect(await verifyGoogleIdToken(idToken(), CLIENT_ID, store)).toMatchObject({ sub: '1001' });
  });
});

describe('login e sessão', () => {
  it('expõe o Client ID e desliga o login sem ele', async () => {
    expect((await app().inject('/api/config')).json().googleClientId).toBe(CLIENT_ID);
    const off = app(null);
    expect((await off.inject('/api/config')).json().googleClientId).toBeNull();
    expect((await login(off)).res.statusCode).toBe(503);
  });

  it('abre a sessão em cookie httpOnly e sai', async () => {
    const a = app();
    expect((await a.inject('/api/auth/me')).json()).toEqual({ user: null });
    const { res, cookie } = await login(a);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax/);
    const me = (await a.inject({ url: '/api/auth/me', headers: cookie })).json().user;
    expect(me).toMatchObject({ name: 'Nami', email: 'nami@example.com' });

    // Segundo login da mesma conta Google: mesmo usuário, dados atualizados.
    const again = await login(a, { name: 'Nami Navegadora' });
    expect(again.res.json().user).toMatchObject({ id: me.id, name: 'Nami Navegadora' });

    expect((await a.inject({ method: 'POST', url: '/api/auth/logout', headers: cookie })).statusCode).toBe(204);
    expect((await a.inject({ url: '/api/auth/me', headers: cookie })).json()).toEqual({ user: null });
    expect((await a.inject({ url: '/api/auth/me', headers: { cookie: 'gg_session=inventado' } })).json()).toEqual({ user: null });
  });

  it('recusa token inválido', async () => {
    const a = app();
    expect((await login(a, { aud: 'outro-site' })).res.statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/auth/google', payload: {} })).statusCode).toBe(400);
  });

  it('decks da conta valem em qualquer navegador', async () => {
    const a = app();
    const { cookie } = await login(a);
    const created = await a.inject({ method: 'POST', url: '/api/decks', headers: cookie, payload: { name: 'Conta', leader: 'ST01-001', cards: luffy.cards } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    // Outro navegador, mesma conta (novo login): continua dono.
    const other = await login(a, {}, { 'x-deck-owner': 'outro-navegador-0123456789' });
    const decks = (await a.inject({ url: '/api/decks', headers: other.cookie })).json();
    expect(decks.find((d: { id: string }) => d.id === id).mine).toBe(true);
    // Sem login, o deck é da comunidade.
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: BROWSER })).statusCode).toBe(403);
    // Outra conta Google também não pode.
    const zoro = await login(a, { sub: '2002', name: 'Zoro' });
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: zoro.cookie })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: other.cookie })).statusCode).toBe(204);
  });

  it('o login leva para a conta os decks e o perfil criados no navegador', async () => {
    const a = app();
    const deck = (
      await a.inject({ method: 'POST', url: '/api/decks', headers: BROWSER, payload: { name: 'Anônimo', leader: 'ST01-001', cards: luffy.cards } })
    ).json();
    await a.inject({ method: 'PUT', url: '/api/players/me', headers: BROWSER, payload: { name: 'Gata Ladra' } });

    const { res, cookie } = await login(a, {}, BROWSER);
    expect(res.json().claimedDecks).toBe(1);
    const decks = (await a.inject({ url: '/api/decks', headers: cookie })).json();
    expect(decks.find((d: { id: string }) => d.id === deck.id).mine).toBe(true);
    expect((await a.inject({ url: '/api/players/me', headers: cookie })).json()).toMatchObject({ name: 'Gata Ladra' });

    // Depois do login, o código do navegador sozinho não edita mais o deck.
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${deck.id}`, headers: BROWSER })).statusCode).toBe(403);
    expect((await a.inject({ url: '/api/players/me', headers: BROWSER })).json()).toBeNull();
  });

  it('se a conta já tem perfil, as partidas do navegador passam para ele', async () => {
    const { db, app: a } = setup();
    const { cookie } = await login(a);
    await a.inject({ method: 'PUT', url: '/api/players/me', headers: cookie, payload: { name: 'Nami' } });
    const before = (await a.inject({ url: '/api/players/me', headers: cookie })).json();

    // Uma partida contra o bot jogada sem login.
    const decks = [luffy, luffy] as [DeckList, DeckList];
    const cards = getCards(db, [luffy.leader, ...luffy.cards.map((c: { id: string }) => c.id)]) as CardData[];
    let state = createGame({ seed: 7, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
    const actions: Action[] = [];
    while (state.phase !== 'gameover' && actions.length < 3000) {
      const act = chooseBotAction(state, actingPlayer(state)!);
      actions.push(act);
      state = applyAction(state, act);
    }
    const saved = await a.inject({ method: 'POST', url: '/api/matches', headers: BROWSER, payload: { mode: 'bot', format: 'egb', seed: 7, decks, actions } });
    expect(saved.statusCode).toBe(200);
    expect((await a.inject({ url: '/api/stats?mine=1', headers: BROWSER })).json().summary.games).toBe(1);

    await login(a, {}, BROWSER);
    expect((await a.inject({ url: '/api/players/me', headers: cookie })).json()).toMatchObject({ id: before.id, name: 'Nami' });
    expect((await a.inject({ url: '/api/stats?mine=1', headers: cookie })).json().summary.games).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n).toBe(1);
  });
});
