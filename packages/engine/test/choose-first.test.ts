import { describe, expect, it } from 'vitest';
import { applyAction, createGame, IllegalActionError } from '../src/engine';
import { legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { viewFor, createAliases } from '../src/view';
import type { GameState, PlayerId } from '../src/types';
import { cards, kid, luffy } from './helpers';

const game = (seed: number, chooseFirst = true, firstPlayer?: PlayerId): GameState =>
  createGame({
    seed,
    firstPlayer,
    chooseFirst,
    cards,
    players: [
      { name: 'Luffy', deck: luffy },
      { name: 'Kid', deck: kid },
    ],
  });

describe('vencedor do sorteio escolhe quem começa', () => {
  it('pergunta ao vencedor antes do mulligan', () => {
    const s = game(3);
    expect(s.rollWinner).toBe(s.firstPlayer);
    expect(s.pending).toEqual({ kind: 'chooseFirst', player: s.rollWinner });
    expect(legalActions(s, s.rollWinner!)).toEqual([
      { type: 'answer', player: s.rollWinner, yes: true },
      { type: 'answer', player: s.rollWinner, yes: false },
    ]);
    expect(legalActions(s, (1 - s.rollWinner!) as PlayerId)).toEqual([]);
  });

  it('jogar primeiro: o vencedor começa e faz o mulligan primeiro', () => {
    let s = game(3);
    const w = s.rollWinner!;
    s = applyAction(s, { type: 'answer', player: w, yes: true });
    expect(s.firstPlayer).toBe(w);
    expect(s.activePlayer).toBe(w);
    expect(s.pending).toEqual({ kind: 'mulligan', player: w });
  });

  it('jogar segundo: o oponente começa', () => {
    let s = game(3);
    const w = s.rollWinner!;
    const other = (1 - w) as PlayerId;
    s = applyAction(s, { type: 'answer', player: w, yes: false });
    expect(s.firstPlayer).toBe(other);
    expect(s.pending).toEqual({ kind: 'mulligan', player: other });
    s = applyAction(s, { type: 'mulligan', player: other, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: w, redraw: false });
    expect(s.phase).toBe('main');
    expect(s.turn).toBe(1);
    expect(s.activePlayer).toBe(other);
  });

  it('só o vencedor responde, e com sim/não', () => {
    const s = game(3);
    const w = s.rollWinner!;
    expect(() => applyAction(s, { type: 'answer', player: (1 - w) as PlayerId, yes: true })).toThrow(IllegalActionError);
    expect(() => applyAction(s, { type: 'mulligan', player: w, redraw: false })).toThrow(IllegalActionError);
  });

  it('o sorteio e as mãos são os mesmos de antes (só a escolha é nova)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = game(seed, false);
      const b = game(seed, true);
      expect(b.rollWinner).toBe(a.firstPlayer);
      expect(b.players[0].hand).toEqual(a.players[0].hand);
      expect(b.players[1].hand).toEqual(a.players[1].hand);
    }
  });

  it('sem a opção, ou com quem começa definido, não pergunta', () => {
    expect(game(3, false).pending?.kind).toBe('mulligan');
    expect(game(3, false).rollWinner).toBeUndefined();
    const forced = game(3, true, 1);
    expect(forced.pending).toEqual({ kind: 'mulligan', player: 1 });
    expect(forced.rollWinner).toBeUndefined();
  });

  it('o bot escolhe jogar primeiro', () => {
    const s = game(3);
    expect(chooseBotAction(s, s.rollWinner!)).toEqual({ type: 'answer', player: s.rollWinner, yes: true });
  });

  it('a escolha aparece na visão do oponente (online)', () => {
    const s = game(3);
    let i = 0;
    const aliases = createAliases(s, () => `a${i++}`);
    const other = (1 - s.rollWinner!) as PlayerId;
    expect(viewFor(s, other, aliases).pending).toEqual({ kind: 'chooseFirst', player: s.rollWinner });
  });
});
