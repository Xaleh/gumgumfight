import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import { deriveMatch } from '../src/stats/derive';
import { findPlayer, recordMatch } from '../src/stats/store';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };
const CAROL = { 'x-deck-owner': 'carol-0123456789abcdef' };
const hashOf = (h: Record<string, string>) => createHash('sha256').update(h['x-deck-owner']).digest('hex');

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true } }) };
}

type App = ReturnType<typeof buildApp>;

async function decksAndCards(app: App) {
  const [a, b] = await Promise.all(['st01-luffy', 'st02-kid'].map(async (id) => (await app.inject(`/api/decks/${id}`)).json()));
  return { decks: [a.deck, b.deck] as [DeckList, DeckList], cards: [...a.cards, ...b.cards] as CardData[] };
}

function playOut(decks: [DeckList, DeckList], cards: CardData[], s: number) {
  let state = createGame({ seed: s, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
  const actions: Action[] = [];
  while (state.phase !== 'gameover' && actions.length < 3000) {
    const a = chooseBotAction(state, actingPlayer(state)!);
    actions.push(a);
    state = applyAction(state, a);
  }
  return { seed: s, decks, actions };
}

/** Grava uma partida: `opp` null = contra o bot. */
async function record(db: DB, app: App, me: Record<string, string>, opp: Record<string, string> | null, opts: { queue?: 'casual' | 'ranked' | 'tournament'; seed?: number } = {}) {
  const { decks, cards } = await decksAndCards(app);
  const r = playOut(decks, cards, opts.seed ?? 7);
  return recordMatch(
    db,
    {
      mode: opp ? 'online' : 'bot',
      format: 'standard',
      queue: opts.queue ?? (opp ? 'ranked' : 'casual'),
      replay: r,
      seats: [
        { controller: 'human', ownerHash: hashOf(me), deckId: null },
        opp ? { controller: 'human', ownerHash: hashOf(opp), deckId: null } : { controller: 'bot', ownerHash: null, deckId: null },
      ],
    },
    deriveMatch(r, cards),
  );
}

const idOf = (db: DB, h: Record<string, string>) => findPlayer(db, hashOf(h))!.id;
const profile = (app: App, id: string, headers: Record<string, string> = {}) => app.inject({ url: `/api/profiles/${id}`, headers });
const setProfile = (app: App, headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: '/api/players/me/profile', headers, payload });
const replay = (app: App, id: string, m: number, headers: Record<string, string> = {}) =>
  app.inject({ url: `/api/profiles/${id}/matches/${m}/replay`, headers });

describe('perfil público', () => {
  it('abre por link com o cartaz, os Líderes e as partidas; sem nome nem id do oponente', async () => {
    const { db, app } = setup();
    const m = await record(db, app, ALICE, BOB);
    await record(db, app, ALICE, null, { seed: 8 });
    const res = await profile(app, idOf(db, ALICE));
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ id: idOf(db, ALICE), tier: 'east-blue', rankedGames: 1, mine: false, record: { games: 2 } });
    expect(p.settings).toBeUndefined();
    expect(p.leaders[0]).toMatchObject({ leader: 'ST01-001', games: 2 });
    expect(p.matches).toHaveLength(2);
    expect(p.matches.map((x: { oppController: string }) => x.oppController)).toEqual(['bot', 'human']);
    const ranked = p.matches.find((x: { id: number }) => x.id === m);
    expect(ranked.bountyDelta).not.toBeNull();
    // Replays desligados por padrão.
    expect(p.matches.every((x: { replay: boolean }) => !x.replay)).toBe(true);
    const body = JSON.stringify(p);
    expect(body).not.toContain(idOf(db, BOB));
    expect(body).not.toContain(findPlayer(db, hashOf(BOB))!.name);
    expect(p.cards['ST01-001'].name).toBeTruthy();
  });

  it('id inválido, inexistente e perfil escondido respondem 404 (o dono ainda vê o dele)', async () => {
    const { db, app } = setup();
    await record(db, app, ALICE, null);
    const id = idOf(db, ALICE);
    expect((await profile(app, 'p-000000000000')).statusCode).toBe(404);
    expect((await profile(app, '../etc')).statusCode).toBe(404);
    expect((await setProfile(app, ALICE, { visible: false })).statusCode).toBe(200);
    expect((await profile(app, id)).json().errorCode).toBe('profileNotFound');
    const own = (await profile(app, id, ALICE)).json();
    expect(own).toMatchObject({ mine: true, settings: { visible: false, leaders: true, matches: true, replays: false, decks: [] } });
  });

  it('o jogador escolhe as seções e os decks (só os dele)', async () => {
    const { db, app } = setup();
    await record(db, app, ALICE, null);
    const { decks } = await decksAndCards(app);
    const created = await app.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Meu Luffy', leader: decks[0].leader, cards: decks[0].cards } });
    const deckId = created.json().id as string;
    const bobDeck = (await app.inject({ method: 'POST', url: '/api/decks', headers: BOB, payload: { name: 'Do Bob', leader: decks[1].leader, cards: decks[1].cards } })).json().id;
    expect((await setProfile(app, ALICE, { decks: [bobDeck] })).json().errorCode).toBe('deckNotMine');
    expect((await setProfile(app, ALICE, { decks: ['st01-luffy'] })).json().errorCode).toBe('deckNotMine');
    expect((await setProfile(app, ALICE, { decks: Array(7).fill(deckId) })).statusCode).toBe(400);
    const saved = await setProfile(app, ALICE, { decks: [deckId], leaders: false, matches: false });
    expect(saved.json().settings).toMatchObject({ visible: true, leaders: false, matches: false, decks: [deckId] });
    const p = (await profile(app, idOf(db, ALICE))).json();
    expect(p.leaders).toBeNull();
    expect(p.record).toBeNull();
    expect(p.matches).toBeNull();
    expect(p.decks).toHaveLength(1);
    expect(p.decks[0]).toMatchObject({ id: deckId, name: 'Meu Luffy', leader: decks[0].leader });
    expect(p.decks[0].cards.length).toBeGreaterThan(0);
    // Deck apagado some do perfil.
    await app.inject({ method: 'DELETE', url: `/api/decks/${deckId}`, headers: ALICE });
    expect((await profile(app, idOf(db, ALICE))).json().decks).toEqual([]);
    // Sem código do navegador não grava.
    expect((await setProfile(app, {}, { visible: false })).json().errorCode).toBe('noOwner');
  });

  it('replay: contra o bot basta o dono liberar; contra uma pessoa, ela também precisa liberar', async () => {
    const { db, app } = setup();
    const vsBot = await record(db, app, ALICE, null);
    const vsBob = await record(db, app, ALICE, BOB, { seed: 9 });
    const alice = idOf(db, ALICE);
    expect((await replay(app, alice, vsBot)).json().errorCode).toBe('profileReplayHidden');
    await setProfile(app, ALICE, { replays: true });
    const file = await replay(app, alice, vsBot);
    expect(file.statusCode).toBe(200);
    expect(file.json()).toMatchObject({ format: 'gumgumfight-replay' });
    expect((await replay(app, alice, vsBob)).statusCode).toBe(403);
    let p = (await profile(app, alice)).json();
    expect(p.matches.find((m: { id: number }) => m.id === vsBob).replay).toBe(false);
    await setProfile(app, BOB, { replays: true });
    expect((await replay(app, alice, vsBob)).statusCode).toBe(200);
    p = (await profile(app, alice)).json();
    expect(p.matches.every((m: { replay: boolean }) => m.replay)).toBe(true);
    // Com as partidas escondidas, nenhum replay sai do perfil.
    await setProfile(app, ALICE, { matches: false });
    expect((await replay(app, alice, vsBot)).statusCode).toBe(404);
    await setProfile(app, ALICE, { matches: true });
    // Oponente com o perfil escondido: o replay volta a ser fechado.
    await setProfile(app, BOB, { visible: false });
    expect((await replay(app, alice, vsBob)).statusCode).toBe(403);
    // Partida que não é do dono do perfil.
    await record(db, app, CAROL, null, { seed: 10 });
    const carolMatch = (await profile(app, idOf(db, CAROL))).json().matches[0].id;
    expect((await replay(app, alice, carolMatch)).json().errorCode).toBe('matchNotFound');
  });

  it('partida de torneio em andamento fica fora do perfil até o torneio terminar', async () => {
    const { db, app } = setup();
    const m = await record(db, app, ALICE, null, { queue: 'tournament' });
    const org = upsertGoogleUser(db, { sub: 'org-p', email: 'org@example.com', emailVerified: true, name: 'Org', picture: null });
    db.prepare("INSERT INTO tournaments (id, name, format, structure, organizer_id, status) VALUES ('t-p', 'Copa', 'standard', 'swiss', ?, 'running')").run(org.id);
    db.prepare("INSERT INTO tournament_games (tournament_id, match_id, game, stats_match_id, played_at) VALUES ('t-p', 1, 1, ?, datetime('now'))").run(m);
    await setProfile(app, ALICE, { replays: true });
    const alice = idOf(db, ALICE);
    let p = (await profile(app, alice)).json();
    expect(p.matches).toEqual([]);
    expect(p.leaders).toEqual([]);
    expect(p.record).toEqual({ games: 0, wins: 0 });
    expect((await replay(app, alice, m)).statusCode).toBe(404);
    db.prepare("UPDATE tournaments SET status = 'finished' WHERE id = 't-p'").run();
    p = (await profile(app, alice)).json();
    expect(p.matches).toHaveLength(1);
    expect((await replay(app, alice, m)).statusCode).toBe(200);
  });
});
