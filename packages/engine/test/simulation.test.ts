import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction } from '../src/engine';
import type { GameState } from '../src/types';
import { countCards, countDon, newGame } from './helpers';

function playOut(seed: number): GameState {
  let s = newGame(seed, (seed % 2) as 0 | 1);
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
  it('200 partidas terminam com vencedor e sem violar invariantes', () => {
    const wins = [0, 0];
    let totalTurns = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = playOut(seed);
      expect(s.phase).toBe('gameover');
      wins[s.winner!]++;
      totalTurns += s.turn;
    }
    // Ambos os decks devem vencer de vez em quando.
    expect(wins[0]).toBeGreaterThan(10);
    expect(wins[1]).toBeGreaterThan(10);
    console.log(`Vitórias Luffy x Kid: ${wins[0]} x ${wins[1]} | média de turnos: ${(totalTurns / 200).toFixed(1)}`);
  }, 120_000);
});
