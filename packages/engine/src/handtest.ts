// Mão de teste do construtor de decks: sorteia mãos iniciais, simula o mulligan e as compras dos
// primeiros turnos, e calcula as chances exatas (distribuição hipergeométrica, sem sorteio) de ter
// uma jogada de certo custo, Counter na mão ou a carta-chave até o turno N.
//
// Regras usadas (as mesmas do motor): mão inicial de 5 (`HAND_SIZE`); o mulligan devolve a mão
// inteira, embaralha e compra 5 de novo, uma vez só; quem começa não compra no primeiro turno e
// os outros turnos compram 1. Nada aqui decide partida: é só uma simulação para quem monta o deck.

import { HAND_SIZE } from './engine';
import { shuffleInPlace } from './rng';
import type { CardData, DeckList } from './types';

type Cards = Map<string, CardData> | Record<string, CardData>;
const cardOf = (cards: Cards, id: string): CardData | undefined => (cards instanceof Map ? cards.get(id) : cards[id]);

/** Turnos mostrados nas tabelas de chances (do 1º ao 5º turno do jogador). */
export const HAND_TEST_TURNS = 5;

// ------------------------------------------------------------------ mão sorteada

export interface TestHand {
  /** O deck na ordem embaralhada: a mão é o começo (`order.slice(0, drawn)`). */
  order: string[];
  /** Cartas já compradas: 5 na mão inicial, mais 1 a cada `drawTestCard`. */
  drawn: number;
  /** Já fez o mulligan (só dá uma vez, antes de comprar mais). */
  mulliganed: boolean;
  /** Estado do gerador (mulberry32): mesma seed, mesmas mãos. */
  rng: number;
}

/** As cartas do deck, uma entrada por cópia (sem o Líder). */
export function deckCopies(deck: Pick<DeckList, 'cards'>): string[] {
  const out: string[] = [];
  for (const c of deck.cards) for (let i = 0; i < c.count; i++) out.push(c.id);
  return out;
}

function shuffled(deck: string[], rng: number): { order: string[]; rng: number } {
  const holder = { rng };
  const order = [...deck];
  shuffleInPlace(holder, order);
  return { order, rng: holder.rng };
}

/** Embaralha o deck e compra a mão inicial. */
export function drawTestHand(deck: Pick<DeckList, 'cards'>, seed: number): TestHand {
  const { order, rng } = shuffled(deckCopies(deck), seed | 0);
  return { order, drawn: Math.min(HAND_SIZE, order.length), mulliganed: false, rng };
}

/** Pode fazer o mulligan: ainda não fez e não comprou além da mão inicial. */
export const canMulligan = (hand: TestHand): boolean => !hand.mulliganed && hand.drawn <= HAND_SIZE;

/** Mulligan: a mão volta para o deck, embaralha e compra 5 de novo. Sem mulligan disponível, nada muda. */
export function mulliganTestHand(hand: TestHand): TestHand {
  if (!canMulligan(hand)) return hand;
  const { order, rng } = shuffled(hand.order, hand.rng);
  return { order, drawn: Math.min(HAND_SIZE, order.length), mulliganed: true, rng };
}

/** Compra a próxima carta (a compra de um turno). Deck vazio: nada muda. */
export function drawTestCard(hand: TestHand): TestHand {
  return hand.drawn < hand.order.length ? { ...hand, drawn: hand.drawn + 1 } : hand;
}

/** As cartas na mão agora. */
export const testHandCards = (hand: TestHand): string[] => hand.order.slice(0, hand.drawn);

/** O turno do jogador a que a mão chegou (a mão inicial é o turno 1; quem começa só compra a partir do 2º). */
export function testHandTurn(hand: TestHand, first: boolean): number {
  const extra = Math.max(0, hand.drawn - HAND_SIZE);
  return first ? extra + 1 : Math.max(1, extra);
}

// ------------------------------------------------------------------ probabilidades

/** Combinações C(n, k) em ponto flutuante (exato até bem além de C(50, 25)). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Cartas vistas até o turno `turn` do jogador (mão inicial + compras). Quem começa não compra no turno 1. */
export function cardsSeenBy(turn: number, first: boolean): number {
  return HAND_SIZE + Math.max(0, turn - (first ? 1 : 0));
}

/** Chance de ver ao menos uma das `copies` cartas entre as `seen` primeiras de um deck de `size`. */
export function hitChance(size: number, copies: number, seen: number): number {
  if (copies <= 0 || size <= 0) return 0;
  const n = Math.min(seen, size);
  return 1 - choose(size - copies, n) / choose(size, n);
}

/**
 * Como `hitChance`, fazendo o mulligan quando a mão inicial não tem a carta: o deck é embaralhado
 * de novo, então a segunda tentativa é independente da primeira.
 */
export function hitChanceWithMulligan(size: number, copies: number, seen: number): number {
  const opening = hitChance(size, copies, HAND_SIZE);
  return opening + (1 - opening) * hitChance(size, copies, seen);
}

/** Número de cópias no deck das cartas que cumprem `match`. */
export function copiesWhere(deck: Pick<DeckList, 'cards'>, cards: Cards, match: (card: CardData) => boolean): number {
  let n = 0;
  for (const c of deck.cards) {
    const card = cardOf(cards, c.id);
    if (card && match(card)) n += c.count;
  }
  return n;
}

export interface TurnChances {
  /** Chance por turno (índice 0 = turno 1), jogando em primeiro. */
  first: number[];
  /** Idem, jogando em segundo. */
  second: number[];
}

/** Chance de ter ao menos uma das `copies` cartas na mão em cada um dos primeiros turnos. */
export function turnChances(size: number, copies: number, options: { mulligan?: boolean; turns?: number } = {}): TurnChances {
  const turns = options.turns ?? HAND_TEST_TURNS;
  const chance = options.mulligan ? hitChanceWithMulligan : hitChance;
  const row = (first: boolean) => Array.from({ length: turns }, (_, i) => chance(size, copies, cardsSeenBy(i + 1, first)));
  return { first: row(true), second: row(false) };
}

export interface CounterChances {
  /** Soma média de Counter nas cartas vistas. */
  average: number;
  /** Chance de a soma de Counter chegar a cada valor (1000, 2000, ...). */
  atLeast: Array<{ value: number; chance: number }>;
}

/** Valores de soma de Counter mostrados no painel. */
export const COUNTER_STEPS = [1000, 2000, 3000, 4000] as const;

/**
 * Distribuição da soma de Counter (o valor impresso nos Personagens) nas `seen` primeiras cartas,
 * por padrão a mão inicial. Conta exata sobre os grupos de cartas com o mesmo Counter.
 */
export function counterChances(deck: Pick<DeckList, 'cards'>, cards: Cards, seen: number = HAND_SIZE, steps: readonly number[] = COUNTER_STEPS): CounterChances {
  const groups = new Map<number, number>();
  let size = 0;
  for (const c of deck.cards) {
    const value = cardOf(cards, c.id)?.counter ?? 0;
    groups.set(value, (groups.get(value) ?? 0) + c.count);
    size += c.count;
  }
  const n = Math.min(seen, size);
  const total = choose(size, n);
  const dist = new Map<number, number>(); // soma de Counter -> número de mãos
  if (total > 0) {
    // Convolução grupo a grupo: (cartas tiradas, soma) -> número de combinações.
    let ways = new Map<string, number>([['0:0', 1]]);
    for (const [value, count] of groups) {
      const next = new Map<string, number>();
      for (const [key, w] of ways) {
        const [taken, sum] = key.split(':').map(Number);
        for (let k = 0; k <= count && taken + k <= n; k++) {
          const nk = `${taken + k}:${sum + k * value}`;
          next.set(nk, (next.get(nk) ?? 0) + w * choose(count, k));
        }
      }
      ways = next;
    }
    for (const [key, w] of ways) {
      const [taken, sum] = key.split(':').map(Number);
      if (taken === n) dist.set(sum, (dist.get(sum) ?? 0) + w / total);
    }
  }
  let average = 0;
  for (const [sum, p] of dist) average += sum * p;
  const atLeast = steps.map((value) => {
    let chance = 0;
    for (const [sum, p] of dist) if (sum >= value) chance += p;
    return { value, chance: Math.min(1, chance) };
  });
  return { average, atLeast };
}
