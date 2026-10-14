import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { actingPlayer } from '../src/actions';
import { applyAction, cloneState } from '../src/engine';
import type { GameState } from '../src/types';
import { started } from './helpers';

describe('cloneState', () => {
  it('copia como o structuredClone ao longo de uma partida inteira', () => {
    let s: GameState = started(5);
    for (let i = 0; i < 2000 && s.phase !== 'gameover'; i++) {
      const { defs: _defs, ...rest } = s;
      const copy = cloneState(rest);
      expect(copy).toEqual(structuredClone(rest));
      expect(copy.players).not.toBe(rest.players);
      s = applyAction(s, chooseBotAction(s, actingPlayer(s)!));
    }
    expect(s.phase).toBe('gameover');
  });

  it('um objeto em dois lugares continua sendo um só na cópia', () => {
    const shared = { options: ['a', 'b'] };
    const copy = cloneState({ x: shared, y: [shared], n: undefined as number | undefined });
    expect(copy.x).not.toBe(shared);
    expect(copy.y[0]).toBe(copy.x);
    expect('n' in copy).toBe(true);
  });
});
