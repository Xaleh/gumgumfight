// Artes alternativas: a escolha do deck vai para as instâncias da partida, só como aparência,
// e a visão do oponente não revela a arte (nem a carta) do que ele não vê.

import { describe, expect, it } from 'vitest';
import { applyFirstArts, artImage, cardImage, cardsWithArts, cleanArts, parseArts, withArt } from '../src/art';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList, GameState } from '../src/types';
import { createAliases, HIDDEN_CARD, viewFor } from '../src/view';
import { cards as baseCards, kid, luffy } from './helpers';

const IMG = (id: string) => `https://example.test/${id}.jpg`;
const ARTS: Record<string, CardData['arts']> = {
  'ST01-001': [
    { id: 'ST01-001_p1', imageUrl: IMG('ST01-001_p1'), label: 'Parallel' },
    { id: 'ST01-001_p2', imageUrl: IMG('ST01-001_p2'), label: 'Manga' },
  ],
  'ST01-012': [{ id: 'ST01-012_p1', imageUrl: IMG('ST01-012_p1'), label: 'Wanted Poster' }],
};
const cards: CardData[] = baseCards.map((c) => ({ ...c, imageUrl: IMG(c.id), ...(ARTS[c.id] ? { arts: ARTS[c.id] } : {}) }));
const byId = new Map(cards.map((c) => [c.id, c]));

function game(deck: DeckList): GameState {
  let s = createGame({ seed: 3, firstPlayer: 0, cards, players: [{ name: 'Luffy', deck }, { name: 'Kid', deck: kid }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}

describe('escolha de artes no deck', () => {
  it('aplica a primeira arte de cada carta que tem alguma, sem trocar as escolhas já feitas', () => {
    expect(cardsWithArts(luffy, byId).sort()).toEqual(['ST01-001', 'ST01-012']);
    expect(applyFirstArts(luffy, byId)).toEqual({ 'ST01-001': 'ST01-001_p1', 'ST01-012': 'ST01-012_p1' });
    expect(applyFirstArts({ ...luffy, arts: { 'ST01-001': 'ST01-001_p2' } }, byId)).toEqual({ 'ST01-001': 'ST01-001_p2', 'ST01-012': 'ST01-012_p1' });
  });

  it('descarta arte inexistente e carta fora do deck', () => {
    const arts = { 'ST01-001': 'nao-existe', 'ST01-012': 'ST01-012_p1', 'ST02-001': 'ST01-001_p1' };
    expect(cleanArts({ ...luffy, arts }, byId)).toEqual({ 'ST01-012': 'ST01-012_p1' });
    expect(cleanArts({ ...luffy, arts: { 'ST01-001': 'x' } }, byId)).toBeUndefined();
  });

  it('aceita de fora só pares de texto', () => {
    expect(parseArts({ a: 'b', c: 3, d: '' })).toEqual({ a: 'b' });
    expect(parseArts(['a'])).toBeUndefined();
    expect(parseArts('x')).toBeUndefined();
  });

  it('a imagem da arte respeita as imagens desligadas (carta sem imagem)', () => {
    const leader = byId.get('ST01-001')!;
    expect(artImage(leader, 'ST01-001_p2')).toBe(IMG('ST01-001_p2'));
    expect(artImage(leader, 'outra')).toBe(IMG('ST01-001'));
    expect(artImage({ ...leader, imageUrl: undefined }, 'ST01-001_p2')).toBeUndefined();
    expect(withArt(leader, undefined)).toBe(leader);
    expect(withArt(leader, 'ST01-001_p1').imageUrl).toBe(IMG('ST01-001_p1'));
  });
});

describe('artes na partida', () => {
  const deck: DeckList = { ...luffy, arts: { 'ST01-001': 'ST01-001_p2', 'ST01-012': 'ST01-012_p1' } };

  it('cada instância leva a imagem escolhida e as definições não carregam a lista de artes', () => {
    const s = game(deck);
    expect(cardImage(s, s.players[0].leader.uid)).toBe(IMG('ST01-001_p2'));
    const luffys = Object.values(s.cards).filter((c) => c.cardId === 'ST01-012');
    expect(luffys).toHaveLength(luffy.cards.find((c) => c.id === 'ST01-012')!.count);
    expect(luffys.every((c) => c.art === IMG('ST01-012_p1'))).toBe(true);
    // Sem escolha: a imagem normal, e nada na instância.
    const other = Object.values(s.cards).find((c) => c.cardId === 'ST01-002')!;
    expect(other.art).toBeUndefined();
    expect(cardImage(s, other.uid)).toBe(IMG('ST01-002'));
    expect(Object.values(s.defs).some((d) => d.arts)).toBe(false);
  });

  it('a mesma partida sem artes continua igual (as regras ignoram a arte)', () => {
    const a = game(deck);
    const b = game(luffy);
    const strip = (s: GameState) => ({ ...s, cards: Object.fromEntries(Object.entries(s.cards).map(([k, { art: _art, ...c }]) => [k, c])) });
    expect(strip(a)).toEqual(strip(b));
  });

  it('o oponente vê a arte das cartas visíveis, e nada das escondidas', () => {
    const s = game(deck);
    let n = 0;
    const view = viewFor(s, 1, createAliases(s, () => `k${++n}x`));
    const leader = view.players[0].leader.uid;
    expect(view.cards[leader].art).toBe(IMG('ST01-001_p2'));
    for (const uid of [...view.players[0].hand, ...view.players[0].deck, ...view.players[0].life]) {
      expect(view.cards[uid]).toMatchObject({ cardId: HIDDEN_CARD });
      expect(view.cards[uid].art).toBeUndefined();
    }
    // O próprio jogador vê a arte na mão.
    const own = viewFor(s, 0, createAliases(s, () => `m${++n}x`));
    const inHand = own.players[0].hand.map((u) => own.cards[u]).filter((c) => c.cardId === 'ST01-012');
    for (const c of inHand) expect(c.art).toBe(IMG('ST01-012_p1'));
  });
});
