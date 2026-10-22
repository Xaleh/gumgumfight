// Extrator de decisões dos replays (docs/bot-tempo.md, seção 11): refaz a partida gravada e emite as decisões
// do lado humano, com a escolha do bot na mesma visão.

import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { extractMatch, formatSummary, selectMatches, summarize, topRankedPlayers } from '../src/decisions/extract';
import { seed } from '../src/seed';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };

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

describe('extrator de decisões', () => {
  it('refaz a partida gravada e emite as decisões do lado humano, com a escolha do bot', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 11);
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches',
      headers: ALICE,
      payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: ['st01-luffy', 'st02-kid'], decks, actions: r.actions },
    });
    expect(res.json()).toMatchObject({ winner: r.winner });
    const matchId = res.json().id as number;

    expect(selectMatches(db)).toEqual([matchId]);
    expect(selectMatches(db, { queue: 'ranked' })).toEqual([]);
    expect(topRankedPlayers(db, 5)).toEqual([]); // ninguém jogou ranqueada

    const { records, turns, error } = extractMatch(db, matchId, { bot: 'normal', budgetMs: 30 });
    expect(error).toBeUndefined();
    // Um turno inteiro por turno do lado humano (a partir do 3º), com o que ele fez e o que o bot faria.
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((t) => t.seat === 0 && t.turn > 2 && t.bot && t.human.donLeft >= 0)).toBe(true);
    expect(turns.map((t) => t.turn)).toEqual([...new Set(turns.map((t) => t.turn))]);
    const played = turns.flatMap((t) => t.human.played);
    expect(played.length).toBe(records.filter((d) => d.kind === 'main' && d.chosen.type === 'playCard' && d.turn > 2).length);
    // Só o lado humano (assento 0): cada ação dele no replay vira um registro.
    const humanActions = r.actions.filter((a) => a.player === 0);
    expect(records.length).toBe(humanActions.length);
    expect(records.every((d) => d.seat === 0 && d.player && d.won === (r.winner === 0))).toBe(true);
    expect(records.map((d) => d.index)).toEqual(r.actions.map((a, i) => (a.player === 0 ? i : -1)).filter((i) => i >= 0));
    const kinds = new Set(records.map((d) => d.kind));
    expect(kinds.has('main')).toBe(true);
    expect(kinds.has('mulligan')).toBe(true);
    // O bot decidiu em todas (e a descrição é por número de carta).
    expect(records.every((d) => d.bot && typeof d.agree === 'boolean')).toBe(true);
    const play = records.find((d) => d.chosen.type === 'playCard');
    expect(play?.chosen.card).toMatch(/^ST01-/);
    const counter = records.find((d) => d.kind === 'counter');
    if (counter) {
      expect(counter.battle).toMatchObject({ targetIsLeader: expect.any(Boolean), need: expect.any(Number) });
      expect(counter.counters).toBeGreaterThanOrEqual(0);
      if (counter.chosen.type === 'counter') expect(counter.chosenValue).toBeGreaterThan(0);
    }

    const s = summarize(records, 1, 0, turns);
    expect(s.decisions).toBe(records.length);
    expect(s.kinds.main.n).toBeGreaterThan(0);
    expect(s.turns?.n).toBe(turns.length);
    const text = formatSummary(s);
    expect(text).toContain('Partidas: 1 (0 não refizeram)');
    expect(text).toContain('Turnos inteiros');
  });

  it('o lado do bot não gera decisões, e uma partida sem replay é pulada', () => {
    const { db } = setup();
    expect(extractMatch(db, 999)).toMatchObject({ records: [], error: 'sem replay' });
  });
});
