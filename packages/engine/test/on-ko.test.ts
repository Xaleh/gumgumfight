// [On K.O.]: as condições são checadas no campo, antes de a carta ir para o trash (10-2-17-1):
// [DON!! xX], condição, negação (8-2-1-1) e [Once Per Turn]. Se valem, o efeito ativa e resolve
// com a carta já no trash (docs/rules/divergencias.md, DV-07).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction } from '../src/engine';
import type { CardData, GameState, PlayerId } from '../src/types';
import { cards as baseCards, noDefense, started, toTurn } from './helpers';

const extra = (JSON.parse(readFileSync(join(__dirname, '../../../data/cards/st21.json'), 'utf8')) as { cards: CardData[] }).cards;
const custom: CardData[] = [
  {
    id: 'KO-OPT',
    name: 'Teste OPT',
    category: 'character',
    colors: ['red'],
    cost: 1,
    power: 3000,
    counter: 0,
    attributes: [],
    types: [],
    text: '[Once Per Turn] [On K.O.] Draw 1 card.',
    set: 'KO',
    rarity: 'C',
  } as CardData,
];
const cards = [...baseCards, ...extra, ...custom];

/** Troca a carta do fundo do deck por `cardId` e a põe no campo, virada (só para testes). */
function onField(s: GameState, player: PlayerId, cardId: string, don = 0): string {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  s.players[player].characters.push({ uid, rested: true, don, playedOnTurn: 0 });
  s.players[player].donDeck -= don;
  return uid;
}

/** O Líder do jogador 0 (5000) ataca o Personagem virado `target` do jogador 1, sem defesa. */
function koInBattle(s: GameState, target: string): GameState {
  s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target });
  return noDefense(s);
}

describe('[On K.O.] checa as condições no campo (DV-07)', () => {
  it('Jewelry Bonney ST21-004 "[DON!! x2] [On K.O.] Draw 1 card" sem DON!! não compra', () => {
    const s0 = toTurn(started(), 3);
    const bonney = onField(s0, 1, 'ST21-004');
    const hand = s0.players[1].hand.length;
    const s = koInBattle(s0, bonney);
    expect(s.players[1].trash).toContain(bonney);
    // Antes: a carta já estava fora do campo e o [DON!! x2] não era checado: comprava 1.
    expect(s.players[1].hand).toHaveLength(hand);
    expect(s.log.some((l) => /Jewelry Bonney .*não é ativado/.test(l.text))).toBe(true);
  });

  it('com 1 DON!! dado também não compra', () => {
    const s0 = toTurn(started(), 3);
    const bonney = onField(s0, 1, 'ST21-004', 1);
    const hand = s0.players[1].hand.length;
    const s = koInBattle(s0, bonney);
    expect(s.players[1].trash).toContain(bonney);
    expect(s.players[1].hand).toHaveLength(hand);
  });

  it('com 2 DON!! dados compra 1 (os DON!! voltam virados para a área de custo)', () => {
    const s0 = toTurn(started(), 3);
    const bonney = onField(s0, 1, 'ST21-004', 2);
    const hand = s0.players[1].hand.length;
    const rested = s0.players[1].donRested;
    const s = koInBattle(s0, bonney);
    expect(s.players[1].trash).toContain(bonney);
    expect(s.players[1].hand).toHaveLength(hand + 1);
    expect(s.players[1].donRested).toBe(rested + 2);
    expect(s.pending).toBeNull();
  });

  it('Personagem com os efeitos negados não ativa o [On K.O.] (8-2-1-1)', () => {
    const s0 = toTurn(started(), 3);
    const bonney = onField(s0, 1, 'ST21-004', 2);
    s0.modifiers.push({ uid: bonney, kind: 'negated', amount: 0, duration: 'turn' });
    const hand = s0.players[1].hand.length;
    const s = koInBattle(s0, bonney);
    expect(s.players[1].trash).toContain(bonney);
    // Antes: removeCharacter apagava o "negated" antes da checagem e o efeito ativava.
    expect(s.players[1].hand).toHaveLength(hand);
  });

  it('[Once Per Turn] [On K.O.]: ativar marca o uso do turno', () => {
    const s0 = toTurn(started(), 3);
    const card = onField(s0, 1, 'KO-OPT');
    const hand = s0.players[1].hand.length;
    const s = koInBattle(s0, card);
    expect(s.players[1].hand).toHaveLength(hand + 1);
    expect(s.usedThisTurn).toContain(`${card}:0`);
  });

  it('[Once Per Turn] [On K.O.] já usado neste turno não ativa', () => {
    const s0 = toTurn(started(), 3);
    const card = onField(s0, 1, 'KO-OPT');
    s0.usedThisTurn.push(`${card}:0`);
    const hand = s0.players[1].hand.length;
    const s = koInBattle(s0, card);
    expect(s.players[1].trash).toContain(card);
    expect(s.players[1].hand).toHaveLength(hand);
  });
});
