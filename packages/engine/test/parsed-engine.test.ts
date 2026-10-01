import { describe, expect, it } from 'vitest';
import { applyAction, attackError, createGame, getCost, getPower, hasKeyword, koProtected } from '../src/engine';
import { parseCard } from '../src/cards';
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
  { id: 'PX-007', name: 'Cavendish', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] You may add 1 card from your Life area to your hand: This Character gains [Rush] during this turn.' },
  { id: 'PX-008', name: 'Samurai', category: 'event', colors: ['red'], cost: 0, types: [], text: '[Main] You may rest 2 of your Characters: Draw 2 cards.' },
  { id: 'PX-009', name: 'Galdino', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Select up to 1 of your opponent's Characters with a cost of 4 or less. The selected Character cannot attack until the end of your opponent's next turn." },
  { id: 'PX-010', name: 'Luffy', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: 'This Character cannot be K.O.\'d in battle by "Strike" attribute Characters.' },
  { id: 'PX-011', name: 'Orochi', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Reveal up to 1 [Big] from your deck and add it to your hand. Then, shuffle your deck.' },
  { id: 'PX-012', name: 'Smile', category: 'event', colors: ['red'], cost: 0, types: [], text: '[Main] Look at 5 cards from the top of your deck; play up to 1 Character card with a cost of 2 or less. Then, place the rest at the bottom of your deck in any order.' },
  { id: 'PX-013', name: 'DeathWink', category: 'event', colors: ['red'], cost: 0, types: [], text: '[Main] Draw cards so that you have 6 cards in your hand.' },
  { id: 'PX-014', name: 'Magellan', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Your opponent returns 1 DON!! card from their field to their DON!! deck.' },
  { id: 'PX-015', name: 'StageBreaker', category: 'event', colors: ['red'], cost: 0, types: [], text: "[Main] K.O. up to 1 of your opponent's Stages with a cost of 3 or less." },
  { id: 'PX-016', name: 'Kuma', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Look at 2 cards from the top of your deck; reveal up to 1 Character card and add it to your hand. Then, place the rest at the top or bottom of the deck in any order.' },
  { id: 'PX-017', name: 'Rakuyo', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Whitebeard Pirates'], text: '[Your Turn] All of your Characters with a type including "Whitebeard" gain +1000 power.' },
  { id: 'PX-018', name: 'Isuka', category: 'character', colors: ['red'], cost: 1, power: 9000, types: [], text: "[Once Per Turn] When this Character battles and K.O.'s your opponent's Character, set this Character as active." },
  { id: 'PX-019', name: 'StageX', category: 'stage', colors: ['red'], cost: 1, types: [], text: '' },
  { id: 'PX-020', name: 'Guard', category: 'character', colors: ['red'], cost: 1, power: 1000, types: [], text: "[Once Per Turn] If this Character would be K.O.'d, you may trash 1 card from your hand instead." },
  { id: 'PX-021', name: 'Koala', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Play up to 1 Character card with a cost of 1 or less from your hand. If you do, draw 1 card.' },
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

  it('custo de tirar 1 carta da Vida para a mão', () => {
    let s = toTurn(game(), 3);
    const life = s.players[0].life.length;
    const hand = s.players[0].hand.length;
    const uid = give(s, 0, 'PX-007');
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.pending).toMatchObject({ kind: 'confirm' });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].life.length).toBe(life - 1);
    expect(s.players[0].hand.length).toBe(hand); // jogou 1, recebeu 1 da Vida
    expect(hasKeyword(s, uid, 'rush')).toBe(true);
  });

  it('custo de virar 2 Personagens seus', () => {
    let s = toTurn(game(), 3);
    const a = field(s, 0, 'PX-001');
    const b = field(s, 0, 'PX-006');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-008') });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', min: 2, max: 2 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [a, b] });
    expect(s.players[0].characters.filter((c) => c.rested)).toHaveLength(2);
    expect(s.players[0].hand.length).toBe(hand - 1 + 2);
  });

  it('"cannot attack until the end of your opponent\'s next turn" vale no turno do oponente e depois acaba', () => {
    let s = toTurn(game(), 3);
    const enemy = field(s, 1, 'PX-001');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-009') });
    s = applyAction(s, { type: 'choose', player: 0, uids: [enemy] });
    s = toTurn(s, 4);
    expect(attackError(s, 1, enemy, s.players[0].leader.uid)).toMatch(/não pode atacar/);
    s = toTurn(s, 6);
    expect(attackError(s, 1, enemy, s.players[0].leader.uid)).toBeNull();
  });

  it('não é nocauteado em batalha por atacante Strike', () => {
    const s = toTurn(game(), 3);
    const luffy = field(s, 0, 'PX-010');
    const strike = s.players[1].leader.uid; // Kid: Special... troca o atributo para o teste
    s.defs[s.cards[strike].cardId] = { ...s.defs[s.cards[strike].cardId], attributes: ['Strike'] };
    expect(koProtected(s, luffy, true, strike)).toBe(true);
    expect(koProtected(s, luffy, true)).toBe(false);
  });

  it('busca no deck inteiro e embaralha; olhar o topo e jogar', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-011') });
    const big = s.pending?.kind === 'selectTargets' ? s.pending.options : [];
    expect(big.length).toBe(1);
    s = applyAction(s, { type: 'choose', player: 0, uids: big });
    expect(s.players[0].hand).toContain(big[0]);

    let t = toTurn(game(), 3);
    const top = t.players[0].deck[0];
    t.cards[top] = { ...t.cards[top], cardId: 'PX-001' };
    t = applyAction(t, { type: 'playCard', player: 0, uid: give(t, 0, 'PX-012') });
    expect(t.pending?.kind === 'selectTargets' && t.pending.options).toContain(top);
    t = applyAction(t, { type: 'choose', player: 0, uids: [top] });
    expect(t.players[0].characters.map((c) => c.uid)).toContain(top);
  });

  it('[Blocker] com 2000 de poder ou menos não pode bloquear', () => {
    const p = parseCard({
      category: 'character',
      text: '[When Attacking] Your opponent cannot activate a [Blocker] Character that has 2000 or less power during this battle.',
    });
    expect(p.abilities[0].steps).toEqual([{ do: 'noBlockerThisBattle', maxPower: 2000 }]);
  });

  it('comprar até ter N cartas; o oponente devolve DON!! (e dispara reações dele)', () => {
    let s = toTurn(game(), 3);
    s.players[0].hand = s.players[0].hand.slice(0, 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-013') });
    expect(s.players[0].hand).toHaveLength(6);

    let t = toTurn(game(), 5);
    const oppDon = t.players[1].donActive + t.players[1].donRested;
    t = applyAction(t, { type: 'playCard', player: 0, uid: give(t, 0, 'PX-014') });
    expect(t.players[1].donActive + t.players[1].donRested).toBe(oppDon - 1);
  });

  it('K.O. de Stage do oponente', () => {
    let s = toTurn(game(), 3);
    const st = s.players[1].deck.pop()!;
    s.cards[st] = { ...s.cards[st], cardId: 'PX-019' };
    s.players[1].stage = { uid: st, rested: false, don: 0, playedOnTurn: 0 };
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-015') });
    s = applyAction(s, { type: 'choose', player: 0, uids: [st] });
    expect(s.players[1].stage).toBeNull();
    expect(s.players[1].trash).toContain(st);
  });

  it('busca com o resto "no topo ou no fundo": em seguida o jogador ordena', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-016') });
    if (s.pending?.kind === 'selectTargets' && s.pending.ordered !== true) s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', ordered: true });
  });

  it('aura por "type including"', () => {
    const s = toTurn(game(), 3);
    const rak = field(s, 0, 'PX-017');
    const other = field(s, 0, 'PX-001');
    expect(getPower(s, rak)).toBe(3000);
    expect(getPower(s, other)).toBe(2000);
  });

  it('"battles and K.O.\'s": desvira depois de nocautear em batalha', () => {
    let s = toTurn(game(), 3);
    const isuka = field(s, 0, 'PX-018');
    const victim = field(s, 1, 'PX-001', true);
    s.players[1].hand = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: isuka, target: victim });
    expect(s.players[1].trash).toContain(victim);
    expect(s.players[0].characters.find((c) => c.uid === isuka)?.rested).toBe(false);
  });

  it('substituição: "If this Character would be K.O.\'d, you may trash 1 card from your hand instead"', () => {
    let s = toTurn(game(), 4);
    const guard = field(s, 0, 'PX-020', true);
    s.players[0].hand = s.players[0].hand.slice(0, 2);
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: guard });
    // Etapa de Counter do defensor (tem cartas na mão): passa.
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    expect(s.players[0].characters.some((c) => c.uid === guard)).toBe(true);
    expect(s.players[0].hand).toHaveLength(hand - 1);
    // Recusando, é nocauteado.
    let t = toTurn(game(), 4);
    const g2 = field(t, 0, 'PX-020', true);
    t = applyAction(t, { type: 'attack', player: 1, attacker: t.players[1].leader.uid, target: g2 });
    if (t.pending?.kind === 'counter') t = applyAction(t, { type: 'pass', player: 0 });
    t = applyAction(t, { type: 'answer', player: 0, yes: false });
    expect(t.players[0].trash).toContain(g2);
  });

  it('"If you do" depois de jogar: só compra se jogou alguém', () => {
    let s = toTurn(game(), 3);
    const koala = give(s, 0, 'PX-021');
    const other = s.players[0].hand[1];
    s.cards[other] = { ...s.cards[other], cardId: 'PX-001' };
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: koala });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    let t = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(t.players[0].hand).toHaveLength(hand - 1);
    t = applyAction(s, { type: 'choose', player: 0, uids: [other] });
    expect(t.players[0].characters.some((c) => c.uid === other)).toBe(true);
    expect(t.players[0].hand).toHaveLength(hand - 1);
  });
});
