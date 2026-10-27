import { describe, expect, it } from 'vitest';
import { summarizeDecks } from '../src/stats/decks';

const list = (hash: string, games: number, wins: number, cards: Array<[string, number]>, players = 1) => ({
  hash,
  games,
  wins,
  players,
  cards: cards.map(([id, count]) => ({ id, count })),
});

describe('decks de um Líder (cartas no deck, deck médio, decks populares)', () => {
  it('cada lista pesa pelas partidas: participação, cópias e a cópia mais comum', () => {
    const s = summarizeDecks([
      list('a', 30, 18, [['X', 4], ['Y', 2], ['Z', 4]], 3),
      list('b', 10, 4, [['X', 4], ['Y', 4]]),
      list('c', 1, 1, [['X', 3], ['W', 1]]),
    ]);
    expect(s).toMatchObject({ games: 41, lists: 3 });
    const x = s.cards.find((c) => c.cardId === 'X')!;
    expect(x).toMatchObject({ games: 41, share: 1, copies: [0, 0, 1, 40], usual: 4 });
    const y = s.cards.find((c) => c.cardId === 'Y')!;
    // 30 partidas com 2 cópias, 10 com 4: vale a de mais partidas.
    expect(y).toMatchObject({ games: 40, copies: [0, 30, 0, 10], usual: 2 });
    expect(s.cards.map((c) => c.cardId)).toEqual(['X', 'Y', 'Z', 'W']);
    expect(s.average).toEqual([
      { id: 'X', count: 4 },
      { id: 'Y', count: 2 },
      { id: 'Z', count: 4 },
      { id: 'W', count: 1 },
    ]);
    expect(s.popular.map((p) => p.hash)).toEqual(['a', 'b', 'c']);
    expect(s.popular[0]).toMatchObject({ games: 30, wins: 18, players: 3 });
  });

  it('o deck médio para em 50 cartas e junta cópias repetidas da mesma carta', () => {
    const cards: Array<[string, number]> = Array.from({ length: 14 }, (_, i) => [`C${String(i).padStart(2, '0')}`, 4]);
    const s = summarizeDecks([list('a', 5, 2, [...cards, ['C00', 1]])]);
    // C00 aparece duas vezes na lista (4 + 1): conta como 4 (máximo).
    expect(s.cards.find((c) => c.cardId === 'C00')?.usual).toBe(4);
    expect(s.average.reduce((n, c) => n + c.count, 0)).toBe(50);
    expect(s.average.at(-1)).toEqual({ id: 'C12', count: 2 });
    expect(s.average).toHaveLength(13);
  });

  it('sem partidas, tudo vazio', () => {
    expect(summarizeDecks([])).toEqual({ games: 0, lists: 0, cards: [], average: [], popular: [] });
  });
});
