// Decks de um Líder (aba "Por Líder", como o OPlay): cartas no deck, deck médio e decks populares,
// a partir das listas exatas usadas nas partidas que entram no filtro (`deck_lists` + `match_seats`).
//
// Cada lista pesa pelas partidas que jogou: uma lista de 300 partidas conta mais que uma testada
// uma vez. Assim "92% dos decks" quer dizer "92% das partidas com este Líder tinham a carta".

/** Uma lista jogada com o Líder: as cartas (sem o Líder) e o resultado no filtro. */
export interface ListRow {
  hash: string;
  cards: Array<{ id: string; count: number }>;
  games: number;
  wins: number;
  players: number;
}

export interface DeckCard {
  cardId: string;
  /** Partidas em que a lista tinha a carta. */
  games: number;
  /** Fração das partidas do Líder com a carta (0..1). */
  share: number;
  /** Partidas com 1, 2, 3 e 4 cópias (posições 0..3). */
  copies: [number, number, number, number];
  /** Cópias mais comuns entre as listas que usam a carta. */
  usual: number;
}

export interface PopularDeck {
  hash: string;
  games: number;
  wins: number;
  players: number;
  cards: Array<{ id: string; count: number }>;
}

export interface DeckSummary {
  /** Partidas e listas diferentes no filtro. */
  games: number;
  lists: number;
  cards: DeckCard[];
  /** Deck médio: as cartas mais usadas, com as cópias mais comuns de cada uma, até 50 cartas. */
  average: Array<{ id: string; count: number }>;
  popular: PopularDeck[];
}

/** Cartas no deck principal. */
export const DECK_SIZE = 50;
/** Decks populares mostrados. */
export const POPULAR = 5;

/** Junta cópias repetidas da mesma carta e limita a 1..4 (as listas gravadas já são válidas). */
function merged(cards: ListRow['cards']): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cards) if (c.count > 0) out.set(c.id, Math.min(4, (out.get(c.id) ?? 0) + c.count));
  return out;
}

export function summarizeDecks(rows: ListRow[]): DeckSummary {
  const games = rows.reduce((n, r) => n + r.games, 0);
  const byCard = new Map<string, DeckCard>();
  for (const r of rows) {
    for (const [id, count] of merged(r.cards)) {
      const c = byCard.get(id) ?? { cardId: id, games: 0, share: 0, copies: [0, 0, 0, 0], usual: 0 };
      c.games += r.games;
      c.copies[count - 1] += r.games;
      byCard.set(id, c);
    }
  }
  const cards = [...byCard.values()]
    .map((c) => {
      // Moda das cópias; no empate, mais cópias.
      let usual = 1;
      for (let i = 1; i < 4; i++) if (c.copies[i] >= c.copies[usual - 1]) usual = i + 1;
      return { ...c, share: games ? c.games / games : 0, usual };
    })
    .sort((a, b) => b.games - a.games || b.usual - a.usual || a.cardId.localeCompare(b.cardId));

  const average: DeckSummary['average'] = [];
  let total = 0;
  for (const c of cards) {
    if (total >= DECK_SIZE) break;
    const count = Math.min(c.usual, DECK_SIZE - total);
    average.push({ id: c.cardId, count });
    total += count;
  }

  const popular = [...rows]
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.hash.localeCompare(b.hash))
    .slice(0, POPULAR)
    .map((r) => ({ hash: r.hash, games: r.games, wins: r.wins, players: r.players, cards: [...merged(r.cards)].map(([id, count]) => ({ id, count })) }));

  return { games, lists: rows.length, cards, average, popular };
}
