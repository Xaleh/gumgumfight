import { type Action, actingPlayer, applyAction, type CardData, chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { getCards, openDb } from '../src/db';
import { seed } from '../src/seed';
import { bountyDelta, tierFor } from '../src/stats/catalog';
import { deckHash, deriveMatch } from '../src/stats/derive';
import { findPlayer, recordMatch } from '../src/stats/store';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true } }) };
}

async function decksAndCards(app: ReturnType<typeof buildApp>, ids: [string, string]) {
  const [a, b] = await Promise.all(ids.map(async (id) => (await app.inject(`/api/decks/${id}`)).json()));
  return { decks: [a.deck, b.deck] as [DeckList, DeckList], cards: [...a.cards, ...b.cards] as CardData[] };
}

/** Joga uma partida bot x bot e devolve o replay. */
function playOut(decks: [DeckList, DeckList], cards: CardData[], s: number) {
  let state = createGame({ seed: s, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
  const actions: Action[] = [];
  while (state.phase !== 'gameover' && actions.length < 3000) {
    const a = chooseBotAction(state, actingPlayer(state)!);
    actions.push(a);
    state = applyAction(state, a);
  }
  return { seed: s, decks, actions, winner: state.winner, turns: state.turn };
}

describe('recompensa e tiers', () => {
  it('faixas de recompensa', () => {
    expect(tierFor(0).id).toBe('east-blue');
    expect(tierFor(5_000).id).toBe('east-blue');
    expect(tierFor(5_001).id).toBe('paradise');
    expect(tierFor(20_000).id).toBe('paradise');
    expect(tierFor(10_000_000).id).toBe('emperor');
  });

  it('vencer quem vale mais rende mais; a recompensa nunca fica negativa', () => {
    expect(bountyDelta(10_000, 10_000, true)).toBe(1_000);
    expect(bountyDelta(10_000, 10_000, false)).toBe(-1_000);
    expect(bountyDelta(10_000, 30_000, true)).toBeGreaterThan(1_000);
    expect(bountyDelta(30_000, 10_000, true)).toBeLessThan(1_000);
    expect(bountyDelta(300, 0, false)).toBe(-300);
  });
});

describe('fatos da partida', () => {
  it('a simulação do replay reproduz a partida e conta as cartas', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 7);
    const facts = deriveMatch(r, getCards(db, cards.map((c) => c.id)));
    expect(facts.winner).toBe(r.winner);
    expect(facts.turns).toBe(r.turns);
    for (const p of [0, 1] as const) {
      const seat = facts.seats[p];
      const rows = [...seat.cards.values()];
      expect(rows.reduce((s, c) => s + c.copies, 0)).toBe(50);
      expect(rows.reduce((s, c) => s + c.opening, 0)).toBe(5);
      for (const c of rows) {
        expect(c.drawn).toBeGreaterThanOrEqual(c.opening);
        expect(c.drawn).toBeLessThanOrEqual(c.copies);
      }
      expect(seat.deckHash).toBe(deckHash(decks[p]));
    }
  });

  it('o hash da lista ignora ordem e nome', () => {
    const a = { leader: 'L', cards: [{ id: 'X', count: 2 }, { id: 'Y', count: 4 }] };
    const b = { leader: 'L', cards: [{ id: 'Y', count: 4 }, { id: 'X', count: 1 }, { id: 'X', count: 1 }] };
    expect(deckHash(a)).toBe(deckHash(b));
    expect(deckHash(a)).not.toBe(deckHash({ ...a, leader: 'M' }));
  });
});

describe('API de estatísticas', () => {
  it('grava a partida verificada e responde aos filtros', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 11);
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches',
      headers: ALICE,
      payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: ['st01-luffy', 'st02-kid'], decks, actions: r.actions },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ winner: r.winner, turns: r.turns });

    const get = async (qs: string, headers = ALICE) => (await app.inject({ url: `/api/stats?${qs}`, headers })).json();
    const all = await get('');
    expect(all.summary).toMatchObject({ games: 1, wins: r.winner === 0 ? 1 : 0, players: 1 });
    expect(all.leaders).toEqual([expect.objectContaining({ leader: 'ST01-001', games: 1 })]);
    expect(all.matchups).toEqual([expect.objectContaining({ leader: 'ST01-001', oppLeader: 'ST02-001', games: 1 })]);
    expect(all.cards['ST01-001'].name).toBe('Monkey.D.Luffy');

    // O lado do bot só aparece pedindo "jogado por bots".
    expect((await get('by=bot')).leaders).toEqual([expect.objectContaining({ leader: 'ST02-001', games: 1 })]);
    expect((await get('format=standard')).summary.games).toBe(0);
    expect((await get('format=egb')).summary.games).toBe(1);
    expect((await get('queue=ranked')).summary.games).toBe(0);
    expect((await get('opponent=human')).summary.games).toBe(0);
    expect((await get('opponent=bot&tiers=east-blue,paradise')).summary.games).toBe(1);
    expect((await get('tiers=paradise')).summary.games).toBe(0);
    expect((await get('mine=1')).summary.games).toBe(1);
    expect((await get('mine=1', BOB)).summary.games).toBe(0);
    expect((await get('days=7')).summary.games).toBe(1);

    const cardsRes = (await app.inject({ url: '/api/stats/cards?leader=ST01-001', headers: ALICE })).json();
    expect(cardsRes.rows.length).toBe(decks[0].cards.length);
    expect(cardsRes.rows.reduce((s: number, c: { openingGames: number }) => s + c.openingGames, 0)).toBeGreaterThan(0);
    expect((await app.inject('/api/stats/cards')).statusCode).toBe(400);

    const trend = (await app.inject('/api/stats/trend?weeks=4')).json();
    expect(trend.weeks).toHaveLength(4);
    expect(new Date(`${trend.weeks[3]}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(trend.rows).toEqual([expect.objectContaining({ week: trend.weeks[3], leader: 'ST01-001', games: 1 })]);
    expect(all.matchups[0]).toMatchObject({ firstGames: expect.any(Number), firstWins: expect.any(Number) });

    const meta = (await app.inject({ url: '/api/stats/meta', headers: ALICE })).json();
    expect(meta.tiers.length).toBeGreaterThan(2);
    expect(meta.me).toMatchObject({ bounty: 0, tier: 'east-blue' });
    expect(meta.myDecks).toEqual([expect.objectContaining({ leader: 'ST01-001', deckId: 'st01-luffy', games: 1 })]);
  });

  it('recusa replay adulterado ou deck inválido', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 3);
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { format: 'egb', ...payload } });
    const truncated = await post({ mode: 'bot', seed: r.seed, decks, actions: r.actions.slice(0, -1) });
    expect(truncated.statusCode).toBe(422);
    const otherSeed = await post({ mode: 'bot', seed: r.seed + 1, decks, actions: r.actions });
    expect(otherSeed.statusCode).toBe(422);
    const smallDeck = await post({ mode: 'bot', seed: r.seed, decks: [{ ...decks[0], cards: decks[0].cards.slice(1) }, decks[1]], actions: r.actions });
    expect(smallDeck.statusCode).toBe(400);
    // ST-01 e ST-02 têm o bloco ①: a partida não vale no Standard.
    const rotated = await post({ mode: 'bot', format: 'standard', seed: r.seed, decks, actions: r.actions });
    expect(rotated.statusCode).toBe(400);
    expect(rotated.json().error).toMatch(/Standard/);
    expect((await app.inject('/api/stats')).json().summary.games).toBe(0);
  });

  it('bot x bot fica fora das estatísticas de pessoas', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 5);
    await app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { mode: 'demo', format: 'egb', seed: r.seed, decks, actions: r.actions } });
    expect((await app.inject('/api/stats')).json().summary.games).toBe(0);
    expect((await app.inject('/api/stats?by=bot')).json().summary.games).toBe(2);
  });

  it('ranqueada atualiza a recompensa e grava o tier de antes da partida', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 9);
    const facts = deriveMatch(r, cards);
    const hashes = ['hash-alice', 'hash-bob'];
    recordMatch(
      db,
      {
        mode: 'online',
        format: 'standard',
        queue: 'ranked',
        replay: r,
        seats: [
          { controller: 'human', ownerHash: hashes[0], deckId: null },
          { controller: 'human', ownerHash: hashes[1], deckId: null },
        ],
      },
      facts,
    );
    const winner = findPlayer(db, hashes[facts.winner])!;
    const loser = findPlayer(db, hashes[1 - facts.winner])!;
    expect(winner).toMatchObject({ bounty: 1_000, rankedGames: 1 });
    expect(loser).toMatchObject({ bounty: 0, rankedGames: 1 });
    const stats = (await app.inject('/api/stats?queue=ranked&opponent=human&tiers=east-blue')).json();
    expect(stats.summary).toMatchObject({ games: 2, wins: 1, matches: 1, players: 2 });
  });
});
