import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import { ReplayCursor, upgradeReplayActions } from '../src/replay';
import type { Action, CardData, DeckList, GameConfig, GameState, PlayerId } from '../src/types';

// Player de replay (card 73 do Trello): avançar, voltar e pular para qualquer ação.
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures/replay-trello-70.json'), 'utf8')) as {
  decks: [DeckList, DeckList];
  cards: CardData[];
  replay: { seed: number; firstPlayer: PlayerId; chooseFirst?: boolean; actions: Action[] };
};
const { replay } = fx;
const config: GameConfig = {
  seed: replay.seed,
  firstPlayer: replay.chooseFirst ? undefined : replay.firstPlayer,
  chooseFirst: replay.chooseFirst,
  cards: fx.cards,
  players: [
    { name: 'Xaleh', deck: fx.decks[0], isBot: false },
    { name: 'Bot', deck: fx.decks[1], isBot: true },
  ],
};
const start = () => createGame(config);
// Gravado na versão 10 dos replays: o roteiro é convertido como a interface faz ao carregar.
const script = upgradeReplayActions(config, replay.actions);
/** Estados da partida ação por ação, refeitos do zero (a referência). */
const states: GameState[] = [start()];
for (const a of script) states.push(applyAction(states[states.length - 1], a));

describe('ReplayCursor', () => {
  it('passo a passo para frente dá os mesmos estados da partida refeita', () => {
    const c = new ReplayCursor(start(), script);
    for (let i = 1; i <= 25; i++) {
      expect(c.seek(i)).toEqual(states[i]);
      expect(c.previous).toEqual(states[i - 1]);
    }
    expect(c.pos).toBe(25);
  });

  it('volta, pula para frente e para trás e para no fim', () => {
    const c = new ReplayCursor(start(), script);
    const n = script.length;
    expect(c.seek(n)).toEqual(states[n]);
    expect(c.state.phase).toBe('gameover');
    for (const i of [n - 1, 37, 40, 0, 99, 21, 20, 19, 1, n]) {
      expect(c.seek(i)).toEqual(states[i]);
      expect(c.pos).toBe(i);
      // O estado antes da última ação (para destacar no histórico o que ela fez).
      if (i > 0) expect(c.previous).toEqual(states[i - 1]);
      else expect(c.previous).toBeNull();
    }
    expect(c.seek(n + 50)).toEqual(states[n]);
    expect(c.seek(-3)).toEqual(states[0]);
    expect(c.failed).toBeNull();
    expect(c.end).toBe(n);
  });

  it('uma ação recusada pelo motor encurta o replay e guarda o motivo', () => {
    const bad: Action = { type: 'endTurn', player: 1 };
    const actions = [...script.slice(0, 30), bad, ...script.slice(30)];
    // Garante que a ação inserida é mesmo ilegal naquela posição.
    expect(() => applyAction(states[30], bad)).toThrow();
    const c = new ReplayCursor(start(), actions);
    expect(c.seek(actions.length)).toEqual(states[30]);
    expect(c.failed?.index).toBe(30);
    expect(c.failed?.message).toBeTruthy();
    expect(c.end).toBe(30);
    expect(c.seek(10)).toEqual(states[10]);
  });
});
