import { describe, expect, it } from 'vitest';
import {
  canMulligan,
  cardsSeenBy,
  choose,
  copiesWhere,
  counterChances,
  deckCopies,
  drawTestCard,
  drawTestHand,
  hitChance,
  hitChanceWithMulligan,
  mulliganTestHand,
  testHandCards,
  testHandTurn,
  turnChances,
} from '../src/handtest';
import type { CardData, DeckList } from '../src/types';
import { cards, luffy } from './helpers';

const byId = new Map<string, CardData>(cards.map((c) => [c.id, c]));

/** Todas as mãos de `n` cartas de um deck pequeno (para conferir as contas na força bruta). */
function allHands<T>(deck: T[], n: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === n) return void out.push(acc);
    for (let i = start; i < deck.length; i++) pick(i + 1, [...acc, deck[i]]);
  };
  pick(0, []);
  return out;
}

describe('mão de teste: sorteio', () => {
  it('compra 5 cartas do deck, sempre as mesmas para a mesma seed', () => {
    const a = drawTestHand(luffy, 42);
    const b = drawTestHand(luffy, 42);
    expect(testHandCards(a)).toHaveLength(5);
    expect(testHandCards(a)).toEqual(testHandCards(b));
    expect([...a.order].sort()).toEqual(deckCopies(luffy).sort());
    expect(deckCopies(luffy)).toHaveLength(50);
    expect(testHandCards(drawTestHand(luffy, 43))).not.toEqual(testHandCards(a));
  });

  it('o mulligan troca a mão uma vez só, antes de comprar', () => {
    const hand = drawTestHand(luffy, 7);
    expect(canMulligan(hand)).toBe(true);
    const mull = mulliganTestHand(hand);
    expect(mull.mulliganed).toBe(true);
    expect(testHandCards(mull)).toHaveLength(5);
    expect([...mull.order].sort()).toEqual([...hand.order].sort());
    expect(mull.order).not.toEqual(hand.order);
    expect(mulliganTestHand(mull)).toBe(mull);
    // Depois de comprar, não há mais mulligan.
    const drew = drawTestCard(hand);
    expect(canMulligan(drew)).toBe(false);
    expect(mulliganTestHand(drew)).toBe(drew);
  });

  it('compra uma carta por vez e para no fim do deck', () => {
    let hand = drawTestHand({ cards: [{ id: 'ST01-002', count: 6 }] }, 1);
    hand = drawTestCard(hand);
    expect(testHandCards(hand)).toHaveLength(6);
    expect(drawTestCard(hand)).toBe(hand);
  });

  it('o turno da mão segue quem começa', () => {
    let hand = drawTestHand(luffy, 3);
    expect(testHandTurn(hand, true)).toBe(1);
    expect(testHandTurn(hand, false)).toBe(1);
    hand = drawTestCard(hand);
    expect(testHandTurn(hand, true)).toBe(2);
    expect(testHandTurn(hand, false)).toBe(1);
  });
});

describe('mão de teste: chances', () => {
  it('cartas vistas por turno: quem começa não compra no turno 1', () => {
    expect(cardsSeenBy(1, true)).toBe(5);
    expect(cardsSeenBy(1, false)).toBe(6);
    expect(cardsSeenBy(2, true)).toBe(6);
    expect(cardsSeenBy(3, false)).toBe(8);
  });

  it('combinações e hipergeométrica com valores conhecidos', () => {
    expect(choose(50, 5)).toBe(2118760);
    expect(choose(46, 5)).toBe(1370754);
    expect(choose(5, 7)).toBe(0);
    // 4 cópias em 50, mão de 5: 1 - C(46,5)/C(50,5).
    expect(hitChance(50, 4, 5)).toBeCloseTo(1 - 1370754 / 2118760, 12);
    expect(hitChance(50, 4, 5)).toBeCloseTo(0.3530, 4);
    expect(hitChance(50, 0, 10)).toBe(0);
    expect(hitChance(50, 50, 1)).toBe(1);
    expect(hitChance(10, 1, 20)).toBe(1);
  });

  it('o mulligan só melhora a chance, e a conta bate com a força bruta', () => {
    const p5 = hitChance(50, 4, 5);
    const p6 = hitChance(50, 4, 6);
    expect(hitChanceWithMulligan(50, 4, 6)).toBeCloseTo(p5 + (1 - p5) * p6, 12);
    expect(hitChanceWithMulligan(50, 4, 6)).toBeGreaterThan(p6);
    // Deck de 8 com 2 alvos, 5 cartas vistas: troca quando a mão não tem o alvo.
    const deck = [1, 1, 0, 0, 0, 0, 0, 0];
    const hands = allHands(deck, 5);
    const hit = hands.filter((h) => h.includes(1)).length / hands.length;
    expect(hitChance(8, 2, 5)).toBeCloseTo(hit, 12);
    expect(hitChanceWithMulligan(8, 2, 5)).toBeCloseTo(hit + (1 - hit) * hit, 12);
  });

  it('tabela por turno cresce a cada compra e começa maior para quem joga em segundo', () => {
    const t = turnChances(50, 8, { turns: 5 });
    expect(t.first).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(t.first[i]).toBeGreaterThan(t.first[i - 1]);
    for (let i = 0; i < 5; i++) expect(t.second[i]).toBeGreaterThan(t.first[i]);
    expect(t.second[0]).toBeCloseTo(t.first[1], 12);
    const m = turnChances(50, 8, { mulligan: true });
    for (let i = 0; i < 5; i++) expect(m.first[i]).toBeGreaterThan(t.first[i]);
  });

  it('conta as cópias das cartas que cumprem a condição', () => {
    const twos = copiesWhere(luffy, byId, (c) => c.category === 'character' && c.cost === 2);
    const expected = luffy.cards.filter((c) => byId.get(c.id)?.category === 'character' && byId.get(c.id)?.cost === 2).reduce((s, c) => s + c.count, 0);
    expect(twos).toBe(expected);
    expect(twos).toBeGreaterThan(0);
  });

  it('Counter na mão inicial bate com a força bruta', () => {
    const fake = (id: string, counter?: number): CardData => ({ id, name: id, category: 'character', colors: ['red'], cost: 1, counter }) as CardData;
    const pool = new Map<string, CardData>([
      ['a', fake('a', 1000)],
      ['b', fake('b', 2000)],
      ['c', fake('c')],
    ]);
    const deck: Pick<DeckList, 'cards'> = { cards: [{ id: 'a', count: 3 }, { id: 'b', count: 2 }, { id: 'c', count: 4 }] };
    const r = counterChances(deck, pool);
    const hands = allHands(deckCopies(deck), 5).map((h) => h.reduce((s, id) => s + (pool.get(id)!.counter ?? 0), 0));
    const avg = hands.reduce((s, v) => s + v, 0) / hands.length;
    expect(r.average).toBeCloseTo(avg, 9);
    for (const { value, chance } of r.atLeast) expect(chance).toBeCloseTo(hands.filter((v) => v >= value).length / hands.length, 9);
    // Média = 5 × Counter médio por carta.
    expect(r.average).toBeCloseTo((5 * (3 * 1000 + 2 * 2000)) / 9, 9);
  });

  it('Counter de um deck inicial: chances decrescentes e média pelo Counter por carta', () => {
    const r = counterChances(luffy, byId);
    const total = luffy.cards.reduce((s, c) => s + c.count * (byId.get(c.id)?.counter ?? 0), 0);
    expect(r.average).toBeCloseTo((5 * total) / 50, 9);
    for (let i = 1; i < r.atLeast.length; i++) expect(r.atLeast[i].chance).toBeLessThanOrEqual(r.atLeast[i - 1].chance);
    expect(counterChances({ cards: [] }, byId).average).toBe(0);
  });
});
