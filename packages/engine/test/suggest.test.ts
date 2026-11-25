import { describe, expect, it } from 'vitest';
import { deckSuggestions, type LeaderNumbers, liftMargin, SUGGESTION_MIN_GAMES } from '../src/suggest';

const L = 'OP01-001';

/** Líder com 200 partidas e 50% de vitórias. */
function numbers(cards: LeaderNumbers['cards'], average: LeaderNumbers['average'] = [], games = 200, wins = 100): LeaderNumbers {
  return { leader: L, games, wins, cards, average };
}

describe('sugestões de cartas (C3)', () => {
  it('sem Líder, sem partidas ou com amostra pequena não sugere nada', () => {
    expect(deckSuggestions(null, { cards: [] }).status).toBe('noLeader');
    expect(deckSuggestions(null, { leader: L, cards: [] }).status).toBe('noData');
    expect(deckSuggestions({ ...numbers([]), leader: 'OP02-001' }, { leader: L, cards: [] }).status).toBe('noData');
    const small = deckSuggestions(numbers([{ cardId: 'A', games: 10, wins: 5, usual: 4 }], [], SUGGESTION_MIN_GAMES - 1, 9), { leader: L, cards: [] });
    expect(small).toMatchObject({ status: 'small', games: SUGGESTION_MIN_GAMES - 1, staples: [], hidden: 0 });
  });

  it('cartas que os decks do Líder usam e você não, com a fração e as partidas', () => {
    const s = deckSuggestions(
      numbers([
        { cardId: 'A', games: 180, wins: 90, usual: 4 },
        { cardId: 'B', games: 120, wins: 60, usual: 2 },
        { cardId: 'C', games: 60, wins: 30, usual: 1 },
      ]),
      { leader: L, cards: [{ id: 'C', count: 1 }] },
    );
    expect(s.status).toBe('ok');
    expect(s.staples.map((c) => [c.cardId, c.games, c.share, c.usual, c.yours])).toEqual([
      ['A', 180, 0.9, 4, 0],
      ['B', 120, 0.6, 2, 0],
    ]);
  });

  it('lift negativo das cartas do deck e lift positivo das que faltam, só acima da margem da amostra', () => {
    const s = deckSuggestions(
      numbers([
        { cardId: 'BAD', games: 80, wins: 28, usual: 4 }, // 35%: -15 pontos
        { cardId: 'NOISE', games: 25, wins: 11, usual: 2 }, // 44%: -6 pontos, mas a margem com 25 partidas é 10
        { cardId: 'GOOD', games: 60, wins: 42, usual: 3 }, // 70%: +20 pontos
        { cardId: 'TINY', games: 8, wins: 8, usual: 1 }, // 100%, mas só 8 partidas
      ]),
      { leader: L, cards: [{ id: 'BAD', count: 4 }, { id: 'NOISE', count: 2 }] },
    );
    expect(s.losers.map((c) => c.cardId)).toEqual(['BAD']);
    expect(s.losers[0].lift).toBeCloseTo(-0.15);
    expect(s.winners.map((c) => c.cardId)).toEqual(['GOOD']);
    expect(s.winners[0].lift).toBeCloseTo(0.2);
    expect(s.hidden).toBe(2);
  });

  it('compara com o Deck médio: cartas em comum e cópias diferentes', () => {
    const s = deckSuggestions(
      numbers(
        [
          { cardId: 'A', games: 180, wins: 90, usual: 4 },
          { cardId: 'B', games: 150, wins: 75, usual: 4 },
          { cardId: 'C', games: 10, wins: 5, usual: 2 },
        ],
        [
          { id: 'A', count: 4 },
          { id: 'B', count: 4 },
          { id: 'C', count: 2 },
        ],
      ),
      { leader: L, cards: [{ id: 'A', count: 4 }, { id: 'B', count: 2 }, { id: 'C', count: 1 }, { id: 'X', count: 4 }] },
    );
    expect(s.average).toEqual({ matching: 4 + 2 + 1, total: 10 });
    expect(s.copies.map((c) => [c.cardId, c.yours, c.usual, c.games])).toEqual([['B', 2, 4, 150]]);
    // C tem cópias diferentes, mas só 10 partidas: escondida.
    expect(s.hidden).toBe(1);
  });

  it('o Líder no deck e cópias repetidas da mesma carta não confundem a comparação', () => {
    const s = deckSuggestions(numbers([{ cardId: 'A', games: 180, wins: 90, usual: 4 }], [{ id: 'A', count: 4 }]), {
      leader: L,
      cards: [{ id: L, count: 1 }, { id: 'A', count: 2 }, { id: 'A', count: 2 }],
    });
    expect(s.staples).toEqual([]);
    expect(s.copies).toEqual([]);
    expect(s.average).toEqual({ matching: 4, total: 4 });
  });

  it('a margem encolhe com mais partidas', () => {
    expect(liftMargin(0.5, 25)).toBeCloseTo(0.1);
    expect(liftMargin(0.5, 400)).toBeCloseTo(0.025);
    expect(liftMargin(0.5, 0)).toBe(1);
  });
});
