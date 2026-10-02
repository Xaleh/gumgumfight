import { describe, expect, it } from 'vitest';
import { applyAction, attackError, counterValue, createGame, getPower, isNegated } from '../src/engine';
import { parseCard } from '../src/cards';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Cartas sintéticas do lote final (mecanismos de uma carta só).
const extra: CardData[] = [
  { id: 'PZ-001', name: 'Shield', category: 'event', colors: ['red'], cost: 0, types: [], text: "[Main] If any of your Characters would be K.O.'d in battle during this turn, you may trash 1 card from your hand instead." },
  { id: 'PZ-002', name: 'Taunt', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[Opponent's Turn] If this Character is rested, your opponent cannot attack any card other than the Character [Taunt]." },
  { id: 'PZ-003', name: 'Coach', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: 'The counter of all of your Character cards with 2000 power in your hand becomes +2000.' },
  { id: 'PZ-004', name: 'Amazon', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Your opponent may trash 1 card from the top of their Life cards. If they do not, give up to 1 of your opponent's Leader or Character cards -2000 power during this turn." },
  { id: 'PZ-005', name: 'Again', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Take an extra turn after this one.' },
  { id: 'PZ-006', name: 'Freezer', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Up to 1 of your opponent's rested DON!! cards will not become active in your opponent's next Refresh Phase." },
  { id: 'PZ-007', name: 'Mimic', category: 'character', colors: ['red'], cost: 1, power: 1000, types: [], text: "[Activate: Main] Select up to 1 of your opponent's Characters. This Character's base power becomes the same as the selected Character's power during this turn." },
  { id: 'PZ-008', name: 'Avenger', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "When this Character is K.O.'d by your opponent's effect, draw 2 cards." },
  { id: 'PZ-009', name: 'Dodger', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[Opponent's Turn] If this Character would be rested by your opponent's Character's effect, you may rest 1 of your other Characters instead." },
  { id: 'PZ-010', name: 'Cage', category: 'stage', colors: ['red'], cost: 1, types: [], text: 'All Characters with a cost of 5 or less do not become active in your and your opponent\'s Refresh Phases.' },
  { id: 'PZ-011', name: 'Roger', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Roger Pirates'], text: 'Your Leader and all of your Characters that do not have a type including "Roger Pirates" have their effects negated.' },
  { id: 'PZ-012', name: 'Sleeper', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Rest up to 1 of your opponent's Characters." },
];
const cards = [...baseCards, ...extra];
const deck = (leader: string, fill: string): DeckList => ({
  id: leader,
  name: leader,
  leader,
  cards: [{ id: fill, count: 50 - extra.length }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
});

function game(): GameState {
  let s = createGame({
    seed: 11,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck('ST01-001', 'ST01-006') },
      { name: 'B', deck: deck('ST02-001', 'ST02-009') },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
const give = (s: GameState, player: 0 | 1, cardId: string) => {
  const uid = s.players[player].hand[0];
  s.cards[uid] = { ...s.cards[uid], cardId };
  return uid;
};
const field = (s: GameState, player: 0 | 1, cardId: string, rested = false) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};

describe('lote final: mecanismos de cartas únicas', () => {
  it('todas as cartas sintéticas são lidas por inteiro', () => {
    for (const c of extra) expect(parseCard(c).unparsed, c.id).toEqual([]);
  });

  it('substituição criada por efeito: descarta 1 carta em vez de perder o Personagem em batalha', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PZ-001') });
    expect(s.tempReplacements).toHaveLength(1);
    expect(s.tempReplacements![0]).toMatchObject({ player: 0, by: 'battle', cost: { trashFromHand: 1 } });
  });

  it('"cannot attack any card other than" obriga a atacar a carta virada', () => {
    const s = toTurn(game(), 4);
    const taunt = field(s, 0, 'PZ-002', true);
    const leader = s.players[0].leader.uid;
    const attacker = s.players[1].leader.uid;
    expect(attackError(s, 1, attacker, leader)).toMatch(/Só é possível atacar/);
    expect(attackError(s, 1, attacker, taunt)).toBeNull();
  });

  it('Counter das cartas na mão passa a ser +2000', () => {
    const s = toTurn(game(), 3);
    const inHand = give(s, 0, 'PZ-012'); // 2000 de poder, sem Counter
    expect(counterValue(s, inHand)).toBe(0);
    field(s, 0, 'PZ-003');
    expect(counterValue(s, inHand)).toBe(2000);
  });

  it('"Your opponent may … If they do not, …": o oponente escolhe', () => {
    let s = toTurn(game(), 3);
    const life = s.players[1].life.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PZ-004') });
    expect(s.pending).toMatchObject({ kind: 'option', player: 1 });
    s = applyAction(s, { type: 'option', player: 1, index: 0 });
    expect(s.players[1].life).toHaveLength(life - 1);
  });

  it('turno extra', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PZ-005') });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.activePlayer).toBe(0);
    expect(s.turn).toBe(4);
  });

  it('DON!! do oponente que não desvira na Renovação', () => {
    let s = toTurn(game(), 3);
    s.players[1].donRested += s.players[1].donActive;
    s.players[1].donActive = 0;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PZ-006') });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.players[1].donRested).toBe(1);
  });

  it('poder base igual ao do Personagem escolhido', () => {
    let s = toTurn(game(), 3);
    const mimic = field(s, 0, 'PZ-007');
    const big = field(s, 1, 'PZ-012');
    s = applyAction(s, { type: 'activate', player: 0, uid: mimic, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [big] });
    expect(getPower(s, mimic)).toBe(2000);
  });

  it('"When this Character is K.O.\'d by your opponent\'s effect" só dispara por efeito do oponente', () => {
    const s = toTurn(game(), 3);
    const def = parseCard(extra.find((c) => c.id === 'PZ-008')!);
    expect(def.abilities[0]).toMatchObject({ timing: 'onKO', koBy: 'opponentEffect' });
  });

  it('substituição ao ser virado pelo efeito de um Personagem do oponente', () => {
    let s = toTurn(game(), 4);
    const dodger = field(s, 0, 'PZ-009');
    const other = field(s, 0, 'ST01-006');
    s = applyAction(s, { type: 'playCard', player: 1, uid: give(s, 1, 'PZ-012') });
    s = applyAction(s, { type: 'choose', player: 1, uids: [dodger] });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [other] });
    expect(s.players[0].characters.find((c) => c.uid === dodger)?.rested).toBe(false);
    expect(s.players[0].characters.find((c) => c.uid === other)?.rested).toBe(true);
  });

  it('Stage: Personagens de custo baixo não desviram na Renovação', () => {
    let s = toTurn(game(), 3);
    const uid = s.players[0].deck.pop()!;
    s.cards[uid] = { ...s.cards[uid], cardId: 'PZ-010' };
    s.players[0].stage = { uid, rested: false, don: 0, playedOnTurn: 0 };
    const mine = field(s, 0, 'ST01-006', true);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.players[0].characters.find((c) => c.uid === mine)?.rested).toBe(true);
  });

  it('aura de anulação: Personagens sem o tipo têm os efeitos anulados', () => {
    const s = toTurn(game(), 3);
    field(s, 0, 'PZ-011');
    const plain = field(s, 0, 'ST01-006');
    expect(isNegated(s, plain)).toBe(true);
    expect(isNegated(s, s.players[0].leader.uid)).toBe(true);
  });
});
