import { describe, expect, it } from 'vitest';
import { applyAction, attackError, createGame, getCost, koProtected } from '../src/engine';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Cartas sintéticas com textos no formato oficial, lidas pelo leitor automático.
const extra: CardData[] = [
  { id: 'PX-001', name: 'Mill', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Trash 2 cards from the top of your deck.' },
  { id: 'PX-002', name: 'Shrink', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Give up to 1 of your opponent's Characters −2 cost during this turn. Then, K.O. up to 1 of your opponent's Characters with a cost of 0." },
  { id: 'PX-003', name: 'Echo', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Add up to 1 card from the top of your deck to the top of your Life cards.', trigger: "Activate this card's [On Play] effect." },
  { id: 'PX-004', name: 'Wall', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "This Character cannot be K.O.'d by effects.\nThis Character cannot attack." },
  { id: 'PX-005', name: 'Charger', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Rush: Character] (This card can attack Characters on the turn in which it is played.)' },
  { id: 'PX-006', name: 'Big', category: 'character', colors: ['red'], cost: 2, power: 3000, types: [], text: 'This Character gains +3 cost.' },
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
    seed: 5,
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

describe('efeitos lidos automaticamente', () => {
  it('moer o deck', () => {
    let s = toTurn(game(), 3);
    const deck = s.players[0].deck.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-001') });
    expect(s.players[0].deck.length).toBe(deck - 2);
    expect(s.players[0].trash).toHaveLength(2);
  });

  it('−2 de custo e depois K.O. em custo 0', () => {
    let s = toTurn(game(), 3);
    const target = field(s, 1, 'PX-001'); // custo 1 → 0 (mínimo)
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-002') });
    s = applyAction(s, { type: 'choose', player: 0, uids: [target] });
    expect(getCost(s, target)).toBe(0);
    s = applyAction(s, { type: 'choose', player: 0, uids: [target] });
    expect(s.players[1].trash).toContain(target);
  });

  it('Vida a partir do deck; [Trigger] usa o efeito [On Play]', () => {
    let s = toTurn(game(), 3);
    const life = s.players[0].life.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-003') });
    expect(s.players[0].life.length).toBe(life + 1);

    let t = toTurn(game(), 4);
    const lifeTop = t.players[0].life[t.players[0].life.length - 1];
    t.cards[lifeTop] = { ...t.cards[lifeTop], cardId: 'PX-003' };
    t.players[0].hand = [];
    const before = t.players[0].life.length;
    t = applyAction(t, { type: 'attack', player: 1, attacker: t.players[1].leader.uid, target: t.players[0].leader.uid });
    expect(t.pending).toMatchObject({ kind: 'trigger', card: lifeTop });
    t = applyAction(t, { type: 'answer', player: 0, yes: true });
    expect(t.players[0].life.length).toBe(before); // perdeu 1, ganhou 1
  });

  it('"cannot attack" e "cannot be K.O.\'d by effects"', () => {
    const s = toTurn(game(), 3);
    const wall = field(s, 0, 'PX-004');
    expect(attackError(s, 0, wall, s.players[1].leader.uid)).toMatch(/não pode atacar/);
    expect(koProtected(s, wall, false)).toBe(true);
    expect(koProtected(s, wall, true)).toBe(false);
  });

  it('[Rush: Character] ataca Personagens (não o Líder) no turno em que entra', () => {
    let s = toTurn(game(), 3);
    const enemy = field(s, 1, 'ST02-009', true);
    const uid = give(s, 0, 'PX-005');
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(attackError(s, 0, uid, enemy)).toBeNull();
    expect(attackError(s, 0, uid, s.players[1].leader.uid)).toMatch(/Rush/);
  });

  it('custo contínuo (+3)', () => {
    const s = toTurn(game(), 3);
    expect(getCost(s, field(s, 0, 'PX-006'))).toBe(5);
  });
});
