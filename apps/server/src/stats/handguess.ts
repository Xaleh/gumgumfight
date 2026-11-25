// O deck provável de um Líder para o bot deduzir a mão do oponente (D2; docs/bot-tempo.md, seção 13).
//
// O bot sabe o Líder do oponente, não a lista. Como um jogador que conhece o meta, ele parte do deck que esse Líder
// costuma jogar, nesta ordem:
//
// 1. `stats`: as listas das partidas de pessoas com o Líder nos últimos `DAYS` dias (as mesmas das estatísticas "Por
//    Líder", sem os torneios em andamento), com as cópias esperadas de cada carta. Só vale com partidas de pelo
//    menos `MIN_PLAYERS` jogadores e `MIN_GAMES` partidas, e **sem as partidas do próprio oponente**: o deck provável
//    nunca é a lista de quem está do outro lado.
// 2. `meta:<id>`: o deck do meta (data/decks/meta) com o mesmo Líder.
// 3. `deck:<id>`: um deck pronto (ou do All Blue) com o mesmo Líder.
//
// Sem nada disso, null: o bot joga com o modelo fixo do Counter, como antes.

import { type CardData, type DeckGuess, deckGuessFrom } from '@gumgum/engine';
import { builtinDeckForLeader, type DB, getCards } from '../db';
import { findPlayer, leaderLists, summary } from './store';
import { summarizeDecks } from './decks';

export const HAND_GUESS_DAYS = 60;
export const HAND_GUESS_MIN_PLAYERS = 3;
export const HAND_GUESS_MIN_GAMES = 20;
/** Por quanto tempo um deck provável fica guardado (ms). */
export const HAND_GUESS_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 500;

const LEADER_ID = /^[A-Za-z0-9-]{3,16}(_[a-z0-9]+)?$/;

/** As cópias esperadas de cada carta nas listas do Líder (cada lista pesa pelas partidas que jogou). */
export function expectedCopies(db: DB, leader: string, notPlayerId: string | undefined): Array<{ id: string; count: number }> | null {
  const filter = { by: 'human' as const, leader, days: HAND_GUESS_DAYS, hideLiveTournaments: true, ...(notPlayerId ? { notPlayerId } : {}) };
  const s = summary(db, filter);
  if (s.players < HAND_GUESS_MIN_PLAYERS || s.games < HAND_GUESS_MIN_GAMES) return null;
  const deck = summarizeDecks(leaderLists(db, filter));
  if (!deck.games) return null;
  return deck.cards.map((c) => ({ id: c.cardId, count: c.copies.reduce((n, g, i) => n + g * (i + 1), 0) / deck.games })).filter((c) => c.count >= 0.05);
}

export class HandGuesses {
  private cache = new Map<string, { at: number; value: DeckGuess | null }>();

  constructor(
    private db: DB,
    private now: () => number = Date.now,
  ) {}

  /**
   * O deck provável do Líder `leader` contra o oponente de `ownerHash` (as partidas dele ficam de fora das
   * estatísticas; sem dono, só os decks do meta e os prontos valem, para nunca usar as listas de quem está jogando).
   */
  forLeader(leader: string | null, ownerHash: string | null): DeckGuess | null {
    if (!leader || !LEADER_ID.test(leader)) return null;
    const key = `${leader}|${ownerHash ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < HAND_GUESS_TTL_MS) return hit.value;
    const value = this.build(leader, ownerHash);
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private build(leader: string, ownerHash: string | null): DeckGuess | null {
    let list: Array<{ id: string; count: number }> | null = null;
    let source = '';
    if (ownerHash) {
      list = expectedCopies(this.db, leader, findPlayer(this.db, ownerHash)?.id);
      source = 'stats';
    }
    if (!list) {
      const deck = builtinDeckForLeader(this.db, leader);
      if (!deck) return null;
      list = deck.cards;
      source = `${deck.group === 'meta' ? 'meta' : 'deck'}:${deck.id}`;
    }
    const cards = new Map<string, CardData>(getCards(this.db, list.map((c) => c.id)).map((c) => [c.id, c]));
    const guess = deckGuessFrom(leader, list, cards, source);
    return guess.cards.length ? guess : null;
  }
}
