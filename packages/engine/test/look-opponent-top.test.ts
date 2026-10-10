// "Look at 1 card from the top of your opponent's deck" (Katakuri OP11-062): quem olha vê a carta
// inteira junto da pergunta (`shown`) e fica com o nome no histórico; o oponente e o espectador
// só veem que uma carta do topo foi olhada, nunca qual.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getPower } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { createAliases, HIDDEN_CARD, viewFor } from '../src/view';
import { cards as baseCards, luffy, noDefense, toTurn } from './helpers';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = [...baseCards, ...(load('cards/st34.json').cards as CardData[])];
const katakuri: DeckList = load('decks/st34-katakuri.json');

/** Turno 3: Katakuri (jogador 0) com 2 DON!! no Líder, atacando o Líder do oponente. */
function attack(): GameState {
  let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'Kata', deck: katakuri }, { name: 'Luffy', deck: luffy }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  s = toTurn(s, 3);
  const leader = s.players[0].leader.uid;
  s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
  s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
  s = applyAction(s, { type: 'attack', player: 0, attacker: leader, target: s.players[1].leader.uid });
  expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
  s = applyAction(s, { type: 'answer', player: 0, yes: true });
  // Com DON!! ativo e DON!! no Líder, escolhe qual devolver.
  if (s.pending?.kind === 'option' && s.pending.don) s = applyAction(s, { type: 'option', player: 0, index: 0 });
  return s;
}
const aliases = (s: GameState) => {
  let n = 0;
  return createAliases(s, () => `a${++n}x`);
};
const view = (s: GameState, viewer: PlayerId | null) => viewFor(s, viewer, aliases(s));

describe('Katakuri (OP11-062): olhar a carta do topo do deck do oponente', () => {
  it('a pergunta mostra a carta e o nome; o oponente e o espectador não veem qual é', () => {
    const s = attack();
    const top = s.players[1].deck[0];
    const name = s.defs[s.cards[top].cardId].name;
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, options: ['OK'], shown: [top] });
    expect(s.pending?.kind === 'option' && s.pending.prompt).toContain(name);

    const mine = view(s, 0);
    expect(mine.pending?.kind).toBe('option');
    const shown = mine.pending?.kind === 'option' ? mine.pending.shown : undefined;
    expect(shown).toHaveLength(1);
    expect(mine.cards[shown![0]].cardId).toBe(s.cards[top].cardId);
    expect(mine.defs[s.cards[top].cardId].name).toBe(name);
    expect(mine.players[1].deck[0]).toBe(shown![0]);

    for (const viewer of [1, null] as const) {
      const v = view(s, viewer);
      expect(v.pending).toEqual({ kind: 'option', player: 0, source: v.players[0].leader.uid, prompt: '', options: [] });
      expect(v.cards[v.players[1].deck[0]].cardId).toBe(HIDDEN_CARD);
    }
  });

  it('depois do OK: nome no histórico só para quem olhou, +1000 no Líder e a carta fica no topo', () => {
    let s = attack();
    const top = s.players[1].deck[0];
    const name = s.defs[s.cards[top].cardId].name;
    const before = s.log.length;
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.pending?.kind).not.toBe('option');
    expect(s.players[1].deck[0]).toBe(top);
    expect(s.log.slice(before).map((e) => e.text)).toContain('Kata olha a carta do topo do deck de Luffy.');
    expect(view(s, 0).log.slice(before).map((e) => e.text)).toContain(`Kata olha ${name} no topo do deck de Luffy.`);
    for (const viewer of [1, null] as const) {
      const texts = view(s, viewer).log.slice(before).map((e) => e.text);
      expect(texts).toContain('Kata olha a carta do topo do deck de Luffy.');
      expect(texts.join('\n')).not.toContain(name);
    }
    // 2 DON!! no Líder (7000) + 1000 durante a batalha (o DON!! devolvido foi o ativo).
    expect(getPower(s, s.players[0].leader.uid)).toBe(8000);
    s = noDefense(s);
    expect(s.pending).toBeNull();
  });
});
