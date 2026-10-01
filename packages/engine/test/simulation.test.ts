import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction, createGame } from '../src/engine';
import type { DeckList, GameState } from '../src/types';
import { cards, countCards, countDon, crocodile, kaido, kid, luffy, shanks } from './helpers';

function playOut(seed: number, decks: [DeckList, DeckList]): GameState {
  let s = createGame({
    seed,
    firstPlayer: (seed % 2) as 0 | 1,
    cards,
    players: [
      { name: decks[0].name, deck: decks[0] },
      { name: decks[1].name, deck: decks[1] },
    ],
  });
  for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
    const p = actingPlayer(s)!;
    const action = chooseBotAction(s, p);
    expect(legalActions(s, p).length).toBeGreaterThan(0);
    s = applyAction(s, action);
    for (const pl of [0, 1] as const) {
      expect(countCards(s, pl)).toBe(51);
      expect(countDon(s, pl)).toBe(10);
      expect(s.players[pl].characters.length).toBeLessThanOrEqual(5);
    }
  }
  return s;
}

describe('simulação bot x bot', () => {
  const pairs: Array<[DeckList, DeckList]> = [
    [luffy, kid],
    [crocodile, luffy],
    [kid, crocodile],
    [kaido, luffy],
    [crocodile, kaido],
    [shanks, kid],
    [kaido, shanks],
  ];
  for (const decks of pairs) {
    it(`${decks[0].name} x ${decks[1].name}: 100 partidas terminam com vencedor e sem violar invariantes`, () => {
      const wins = [0, 0];
      let totalTurns = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const s = playOut(seed, decks);
        expect(s.phase).toBe('gameover');
        wins[s.winner!]++;
        totalTurns += s.turn;
      }
      // Ambos os decks devem vencer de vez em quando.
      expect(wins[0]).toBeGreaterThan(5);
      expect(wins[1]).toBeGreaterThan(5);
      console.log(`Vitórias: ${wins[0]} x ${wins[1]} | média de turnos: ${(totalTurns / 100).toFixed(1)}`);
    }, 120_000);
  }
});
