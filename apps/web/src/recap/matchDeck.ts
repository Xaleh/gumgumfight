// Decklist de um jogador de uma partida encerrada (a do oponente, no resumo do fim), a partir
// do estado: as cartas que ele tem na partida, por custo e número, com a arte escolhida e as
// URLs reescritas pelo mesmo domínio (o canvas só exporta assim). Sem canvas, para poder testar.

import { artImage, type CardData, cardImage, deckOfPlayer, type DeckList, formatDeckList, type GameState, type PlayerId, proxiedImageUrl } from '@gumgum/engine';
import type { RecapCard } from '../api';
import type { DeckCard, MatchDeck } from './draw';

export interface MatchDeckData extends MatchDeck {
  player: PlayerId;
  /** Quem jogou contra esse deck. */
  opponent: string;
  /** Cartas no deck principal (sem o Líder). */
  total: number;
  /** A lista no formato de texto do construtor ("1xST01-001", "4xST01-002"…). */
  text: string;
}

/**
 * A decklist de `player`, ou null enquanto alguma carta dele está escondida (a visão de cada
 * jogador só traz todas as cartas com a partida encerrada). `images` desligado = sem arte.
 */
export function matchDeck(state: GameState, player: PlayerId, { images = true } = {}): MatchDeckData | null {
  const list = deckOfPlayer(state, player);
  if (!list) return null;
  // A primeira instância de cada carta (a arte alternativa vale por número da carta, igual em todas as cópias).
  const uidOf = new Map<string, string>();
  for (const c of Object.values(state.cards)) if (c.owner === player && !uidOf.has(c.cardId)) uidOf.set(c.cardId, c.uid);
  const card = (id: string): RecapCard => {
    const def = state.defs[id];
    const uid = uidOf.get(id);
    return {
      id,
      name: def?.name ?? id,
      set: def?.set ?? id.split('-')[0] ?? null,
      cost: def?.cost ?? null,
      category: def?.category ?? 'character',
      colors: def?.colors ?? [],
      image: images && uid ? proxiedImageUrl(cardImage(state, uid)) : null,
    };
  };
  const cards: DeckCard[] = list.cards
    .map((c) => ({ ...card(c.id), count: c.count }))
    .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.id.localeCompare(b.id));
  const other = state.players[player === 0 ? 1 : 0];
  return {
    player,
    name: state.players[player].name,
    opponent: other.name,
    leader: card(list.leader),
    cards,
    total: cards.reduce((n, c) => n + c.count, 0),
    text: formatDeckList({ leader: list.leader, cards: cards.map((c) => ({ id: c.id, count: c.count })) }),
  };
}

/**
 * A mesma decklist a partir de um deck salvo (visualizador de decks): `name` é o nome do deck
 * e não há oponente. `cards` precisa trazer o Líder e todas as cartas da lista.
 */
export function savedDeckData(deck: Pick<DeckList, 'name' | 'leader' | 'cards' | 'arts'>, cards: ReadonlyMap<string, CardData>, { images = true } = {}): MatchDeckData {
  const card = (id: string): RecapCard => {
    const def = cards.get(id);
    return {
      id,
      name: def?.name ?? id,
      set: def?.set ?? id.split('-')[0] ?? null,
      cost: def?.cost ?? null,
      category: def?.category ?? 'character',
      colors: def?.colors ?? [],
      image: images && def ? proxiedImageUrl(artImage(def, deck.arts?.[id])) : null,
    };
  };
  const list: DeckCard[] = deck.cards
    .map((c) => ({ ...card(c.id), count: c.count }))
    .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.id.localeCompare(b.id));
  return {
    player: 0,
    name: deck.name,
    opponent: '',
    leader: card(deck.leader),
    cards: list,
    total: list.reduce((n, c) => n + c.count, 0),
    text: formatDeckList({ leader: deck.leader, cards: list.map((c) => ({ id: c.id, count: c.count })) }),
  };
}
