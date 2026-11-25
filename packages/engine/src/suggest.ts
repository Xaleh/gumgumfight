// Sugestões de cartas para o construtor (roadmap C3), a partir das estatísticas de um Líder:
// "os decks deste Líder usam X e você não usa", "esta carta tem lift negativo" e a comparação com o
// Deck médio. Os números vêm do servidor (`GET /api/stats/suggestions`); a comparação com o deck
// que está sendo montado roda aqui, sem enviar o deck a ninguém. Nada aqui decide partida.
//
// O lift é o mesmo da tela de Estatísticas: a taxa de vitória das partidas com a carta no deck menos
// a do Líder em geral. Uma sugestão só aparece com pelo menos `SUGGESTION_MIN_GAMES` partidas por
// trás e, no caso do lift, quando a diferença passa da margem da amostra (um erro padrão): com 20
// partidas, um lift de 5 pontos é só ruído. As que ficam de fora contam em `hidden`.

/** Números de uma carta nas partidas do Líder (as que entram no filtro das estatísticas). */
export interface LeaderCardNumbers {
  cardId: string;
  /** Partidas com a carta no deck. */
  games: number;
  wins: number;
  /** Cópias mais comuns entre as listas que usam a carta (1..4). */
  usual: number;
}

export interface LeaderNumbers {
  leader: string;
  /** Partidas e vitórias do Líder no filtro. */
  games: number;
  wins: number;
  cards: LeaderCardNumbers[];
  /** Deck médio do Líder (`summarizeDecks` no servidor): as cartas mais usadas, até 50. */
  average: Array<{ id: string; count: number }>;
}

/** Mínimo de partidas por trás de uma sugestão (o mesmo "amostra pequena" das Estatísticas). */
export const SUGGESTION_MIN_GAMES = 20;
/** Fração das partidas do Líder a partir da qual uma carta é "o que os decks usam". */
export const STAPLE_SHARE = 0.5;
/** Lift mínimo (em fração: 0,05 = 5 pontos) para uma carta ganhar ou perder destaque. */
export const LIFT_MIN = 0.05;
/** Máximo de cartas em cada grupo. */
export const SUGGESTION_LIMIT = 8;

export type SuggestionKind = 'staple' | 'winner' | 'loser' | 'copies';

export interface CardSuggestion {
  kind: SuggestionKind;
  cardId: string;
  /** Partidas com a carta no deck (a amostra por trás da sugestão). */
  games: number;
  /** Fração das partidas do Líder com a carta (0..1). */
  share: number;
  /** Taxa de vitória com a carta menos a do Líder (fração; 0,08 = +8 pontos). */
  lift: number;
  /** Cópias mais comuns nos decks do Líder. */
  usual: number;
  /** Cópias no deck que está sendo montado (0 = não usa). */
  yours: number;
}

export interface DeckSuggestions {
  /** `noLeader`: deck sem Líder; `noData`: nenhuma partida; `small`: menos partidas que o mínimo. */
  status: 'noLeader' | 'noData' | 'small' | 'ok';
  /** Partidas e taxa de vitória do Líder (0..1). */
  games: number;
  winRate: number;
  /** Cartas do Deck médio que o deck também tem (contando cópias) e o total do Deck médio. */
  average: { matching: number; total: number };
  /** Os decks deste Líder usam e você não. */
  staples: CardSuggestion[];
  /** Ganham mais que o Líder em geral e você não usa. */
  winners: CardSuggestion[];
  /** Estão no seu deck e ganham menos que o Líder em geral. */
  losers: CardSuggestion[];
  /** Estão no seu deck e no Deck médio, com outro número de cópias. */
  copies: CardSuggestion[];
  /** Sugestões escondidas por amostra pequena. */
  hidden: number;
}

/** Margem da amostra: um erro padrão da taxa de vitória com `games` partidas. */
export function liftMargin(winRate: number, games: number): number {
  if (games <= 0) return 1;
  const p = Math.min(0.95, Math.max(0.05, winRate));
  return Math.sqrt((p * (1 - p)) / games);
}

const empty = (status: DeckSuggestions['status'], games = 0, winRate = 0): DeckSuggestions => ({
  status,
  games,
  winRate,
  average: { matching: 0, total: 0 },
  staples: [],
  winners: [],
  losers: [],
  copies: [],
  hidden: 0,
});

/** Compara o deck com os números do Líder e monta as sugestões. */
export function deckSuggestions(data: LeaderNumbers | null, deck: { leader?: string; cards: Array<{ id: string; count: number }> }): DeckSuggestions {
  if (!deck.leader) return empty('noLeader');
  if (!data || data.leader !== deck.leader || data.games <= 0) return empty('noData');
  const winRate = data.wins / data.games;
  if (data.games < SUGGESTION_MIN_GAMES) return empty('small', data.games, winRate);

  const yours = new Map<string, number>();
  for (const c of deck.cards) if (c.count > 0 && c.id !== deck.leader) yours.set(c.id, (yours.get(c.id) ?? 0) + c.count);
  const averageCount = new Map(data.average.map((c) => [c.id, c.count]));

  const out = empty('ok', data.games, winRate);
  for (const c of data.average) out.average.total += c.count;
  for (const [id, n] of yours) out.average.matching += Math.min(n, averageCount.get(id) ?? 0);

  for (const c of data.cards) {
    if (c.cardId === deck.leader || c.games <= 0) continue;
    const share = c.games / data.games;
    const lift = c.wins / c.games - winRate;
    const mine = yours.get(c.cardId) ?? 0;
    const s: Omit<CardSuggestion, 'kind'> = { cardId: c.cardId, games: c.games, share, lift, usual: c.usual, yours: mine };
    const enough = c.games >= SUGGESTION_MIN_GAMES;
    // O lift só conta quando passa da margem da própria amostra (e dos 5 pontos).
    const clearLift = enough && Math.abs(lift) >= Math.max(LIFT_MIN, liftMargin(winRate, c.games));

    if (mine === 0) {
      if (share >= STAPLE_SHARE) {
        if (enough) out.staples.push({ ...s, kind: 'staple' });
        else out.hidden++;
      } else if (lift >= LIFT_MIN) {
        if (clearLift) out.winners.push({ ...s, kind: 'winner' });
        else out.hidden++;
      }
      continue;
    }
    if (lift <= -LIFT_MIN) {
      if (clearLift) out.losers.push({ ...s, kind: 'loser' });
      else out.hidden++;
    }
    const usual = averageCount.get(c.cardId);
    if (usual !== undefined && usual !== mine) {
      if (enough) out.copies.push({ ...s, usual, kind: 'copies' });
      else out.hidden++;
    }
  }

  const byId = (a: CardSuggestion, b: CardSuggestion) => a.cardId.localeCompare(b.cardId);
  out.staples.sort((a, b) => b.share - a.share || b.games - a.games || byId(a, b));
  out.winners.sort((a, b) => b.lift - a.lift || b.games - a.games || byId(a, b));
  out.losers.sort((a, b) => a.lift - b.lift || b.games - a.games || byId(a, b));
  out.copies.sort((a, b) => b.games - a.games || byId(a, b));
  for (const k of ['staples', 'winners', 'losers', 'copies'] as const) out[k] = out[k].slice(0, SUGGESTION_LIMIT);
  return out;
}
