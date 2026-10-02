import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getPower, koProtected } from '../src/engine';
import { parseCard } from '../src/cards';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Cartas sintéticas do lote seguinte da cauda longa (texto oficial, lido pelo leitor automático).
const extra: CardData[] = [
  { id: 'PY-001', name: 'Reset', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Return all cards in your hand to your deck and shuffle your deck. Then, draw cards equal to the number you returned to your deck.' },
  { id: 'PY-002', name: 'Bounce', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Your opponent returns 1 of their Characters to the owner's hand." },
  { id: 'PY-003', name: 'Either', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] K.O. or rest up to 1 of your opponent's Characters with a base power of 6000 or less." },
  { id: 'PY-004', name: 'Purge', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Trash cards from your hand until you have 2 cards in your hand.' },
  { id: 'PY-005', name: 'Ally', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Alabasta'], text: '[Your Turn] All of your {Alabasta} type Characters other than this Character gain +1000 power.' },
  { id: 'PY-006', name: 'Fortress', category: 'event', colors: ['red'], cost: 0, types: [], text: "[Main] None of your Characters can be K.O.'d by your opponent's effects until the end of your opponent's next turn." },
  { id: 'PY-007', name: 'Sleepy', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Activate: Main] Set this Character as active. Then, this Character will not become active in your next Refresh Phase.' },
  { id: 'PY-008', name: 'Pain', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] You take 1 damage.' },
  { id: 'PY-009', name: 'Guard', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "If your Leader is active, this Character gains +2000 power." },
  { id: 'PY-010', name: 'Rayleigh', category: 'event', colors: ['red'], cost: 0, types: [], text: "[Main] Draw 1 card. Then, you may rest 1 of your DON!! cards. If you do, give your opponent's Leader and all of their Characters 1000 power during this turn." },
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
    seed: 7,
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

describe('lote seguinte: efeitos lidos automaticamente', () => {
  it('todas as cartas sintéticas são lidas por inteiro', () => {
    for (const c of extra) expect(parseCard(c).unparsed, c.id).toEqual([]);
  });

  it('devolve a mão ao deck e compra a mesma quantidade', () => {
    let s = toTurn(game(), 3);
    const uid = give(s, 0, 'PY-001');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.players[0].hand).toHaveLength(hand - 1);
    expect(s.players[0].hand.every((u) => !s.players[0].trash.includes(u))).toBe(true);
  });

  it('o oponente escolhe o próprio Personagem para voltar à mão', () => {
    let s = toTurn(game(), 3);
    const a = field(s, 1, 'ST01-006');
    const b = field(s, 1, 'ST01-006');
    const oppHand = s.players[1].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PY-002') });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, min: 1, max: 1 });
    s = applyAction(s, { type: 'choose', player: 1, uids: [b] });
    expect(s.players[1].hand).toHaveLength(oppHand + 1);
    expect(s.players[1].characters.map((c) => c.uid)).toEqual([a]);
  });

  it('"K.O. or rest": escolhe a carta e depois o que fazer', () => {
    let s = toTurn(game(), 3);
    const target = field(s, 1, 'ST01-006');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PY-003') });
    s = applyAction(s, { type: 'choose', player: 0, uids: [target] });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    expect(s.players[1].characters.find((c) => c.uid === target)?.rested).toBe(true);
  });

  it('descarta até ficar com 2 cartas na mão', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PY-004') });
    const n = s.players[0].hand.length - 2;
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, min: n, max: n });
    s = applyAction(s, { type: 'choose', player: 0, uids: s.players[0].hand.slice(0, n) });
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('aura "other than this Character" não afeta a própria carta', () => {
    const s = toTurn(game(), 3);
    const ally = field(s, 0, 'PY-005');
    const other = field(s, 0, 'PY-005');
    expect(getPower(s, ally)).toBe(3000);
    expect(getPower(s, other)).toBe(3000);
    s.players[0].characters = s.players[0].characters.filter((c) => c.uid !== other);
    expect(getPower(s, ally)).toBe(2000);
  });

  it('nenhum Personagem pode ser nocauteado por efeitos até o próximo turno do oponente', () => {
    let s = toTurn(game(), 3);
    const mine = field(s, 0, 'ST01-006');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PY-006') });
    expect(koProtected(s, mine, false)).toBe(true);
    expect(koProtected(s, mine, true)).toBe(false);
  });

  it('a própria carta não desvira na sua próxima Renovação', () => {
    let s = toTurn(game(), 3);
    const sleepy = field(s, 0, 'PY-007', true);
    s = applyAction(s, { type: 'activate', player: 0, uid: sleepy, ability: 0 });
    expect(s.players[0].characters.find((c) => c.uid === sleepy)?.rested).toBe(false);
    s.players[0].characters.find((c) => c.uid === sleepy)!.rested = true;
    s = toTurn(s, 5);
    expect(s.players[0].characters.find((c) => c.uid === sleepy)?.rested).toBe(true);
  });

  it('"you take 1 damage" tira 1 Vida', () => {
    let s = toTurn(game(), 3);
    const life = s.players[0].life.length;
    const top = s.players[0].life[life - 1];
    s.cards[top] = { ...s.cards[top], cardId: 'ST01-006' }; // sem [Trigger]
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PY-008') });
    expect(s.players[0].life).toHaveLength(life - 1);
  });

  it('condição: o seu Líder está ativo', () => {
    const s = toTurn(game(), 3);
    const guard = field(s, 0, 'PY-009');
    expect(getPower(s, guard)).toBe(4000);
    s.players[0].leader.rested = true;
    expect(getPower(s, guard)).toBe(2000);
  });

  it('custo opcional no meio do efeito ("you may rest 1 DON!!. If you do, …")', () => {
    let s = toTurn(game(), 3);
    const don = s.players[0].donActive;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PY-010') });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].donActive).toBe(don - 1);
    expect(getPower(s, s.players[1].leader.uid)).toBe(4000);
  });
});
