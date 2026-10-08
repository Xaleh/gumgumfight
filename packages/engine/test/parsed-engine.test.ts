import { describe, expect, it } from 'vitest';
import { applyAction, attackError, blockerOptions, cannotBeRested, createGame, getCost, getPower, hasKeyword, koProtected, playCost, playError } from '../src/engine';
import { buildCardDef, parseCard } from '../src/cards';
import { chooseBotAction } from '../src/bot/simple';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Cartas sintéticas com textos no formato oficial, lidas pelo leitor automático.
const extra: CardData[] = [
  { id: 'PX-001', name: 'Mill', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Trash 2 cards from the top of your deck.' },
  { id: 'PX-002', name: 'Shrink', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Give up to 1 of your opponent's Characters −2 cost during this turn. Then, K.O. up to 1 of your opponent's Characters with a cost of 0." },
  { id: 'PX-003', name: 'Echo', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Add up to 1 card from the top of your deck to the top of your Life cards.', trigger: "Activate this card's [On Play] effect." },
  { id: 'PX-004', name: 'Wall', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "This Character cannot be K.O.'d by effects.\nThis Character cannot attack." },
  { id: 'PX-005', name: 'Charger', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Rush: Character] (This card can attack Characters on the turn in which it is played.)' },
  // Grafia da API (OP17-027 Benn.Beckman): "[Rush Character]" sem os dois-pontos e colado no [On Play].
  { id: 'PX-043', name: 'Beckman', category: 'character', colors: ['green'], cost: 1, power: 9000, types: ['Red-Haired Pirates'], text: "[Rush Character] (This card can attack Characters on the turn in which it is played.)[On Play] If your Leader has the {Red-Haired Pirates} type, draw 1 card and rest up to 2 of your opponent's Characters." },
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
  { id: 'PX-022', name: 'Heavy', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: 'All of your Characters gain +1 cost.' },
  { id: 'PX-023', name: 'Uta', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Reveal 1 card from the top of your deck and add up to 1 Character card to your hand. Then, place the rest at the bottom of your deck.' },
  { id: 'PX-025', name: 'Garp', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Your Turn] When this Leader or 1 of your Characters is given a DON!! card, draw 1 card.' },
  { id: 'PX-026', name: 'Doffy', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Your Turn] [Once Per Turn] This effect can be activated when a Character is removed from the field by your effect. Draw 1 card.' },
  { id: 'PX-027', name: 'Bouncer', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Return up to 1 of your opponent's Characters to the owner's hand." },
  { id: 'PX-028', name: 'Watcher', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Opponent\'s Turn] When your opponent plays a Character, draw 1 card.' },
  { id: 'PX-029', name: 'Guard2', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Your Opponent's Attack] Change the target of that attack to this Leader or to one of your Characters." },
  { id: 'PX-030', name: 'Thrower', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[When Attacking] You may trash any number of Event or Stage cards from your hand. This Character gains +1000 power during this battle for every card trashed.' },
  { id: 'PX-031', name: 'Caller', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Activate: Main] Activate up to 1 Event with a base cost of 3 or less from your hand.' },
  { id: 'PX-032', name: 'Early', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: 'This effect can be activated at the start of your turn. If you have 2 or less cards in your hand, draw 1 card.' },
  { id: 'PX-033', name: 'Negator', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Negate the effect of up to 1 of your opponent's Characters during this turn." },
  { id: 'PX-034', name: 'Sticky', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "This Character cannot be removed from the field by your opponent's effects." },
  { id: 'PX-035', name: 'Limiter', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Set up to 1 of your DON!! cards as active. Then, you cannot play Character cards during this turn.' },
  { id: 'PX-036', name: 'Cheap', category: 'character', colors: ['red'], cost: 3, power: 2000, types: [], text: 'If you have 1 or less Life cards, give this card in your hand -2 cost.' },
  { id: 'PX-037', name: 'Lifter', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Your Leader's base power becomes 7000 during this turn." },
  { id: 'PX-038', name: 'Ghost', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Unblockable] (This card cannot be blocked.)' },
  { id: 'PX-039', name: 'Payer', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Activate: Main] You may give your 1 active Leader -5000 power during this turn: Draw 1 card.' },
  { id: 'PX-040', name: 'Rester', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Rest up to 1 of your opponent's DON!! cards or Characters with a cost of 3 or less." },
  { id: 'PX-041', name: 'NoBlock', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "[On Play] Up to 1 of your opponent's Characters with 4000 power or less cannot activate [Blocker] during this turn." },
  { id: 'PX-042', name: 'Shield', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: "Your Characters with a cost of 3 or less other than [Shield] cannot be K.O.'d by your opponent's effects." },
  { id: 'PX-024', name: 'Law', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[Activate: Main] [Once Per Turn] If you have 0 DON!! cards on your field or 8 or more DON!! cards on your field, draw 1 card.' },
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

// ST32-002 Kouzuki Oden (texto da API).
const oden: CardData = {
  id: 'PX-044',
  name: 'Oden',
  category: 'character',
  colors: ['red'],
  cost: 1,
  power: 6000,
  types: [],
  text: "[On Play] Draw 1 card and up to 1 of your opponent's Characters with a base cost of 6 or less cannot be rested until the end of your opponent's next End Phase.",
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
    t = applyAction(t, { type: 'pass', player: 0 });
    expect(t.pending).toMatchObject({ kind: 'lifeCard', card: lifeTop });
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

  it('[Rush Character] sem dois-pontos (grafia da API) também vale', () => {
    let s = toTurn(game(), 3);
    const enemy = field(s, 1, 'ST02-009', true);
    const uid = give(s, 0, 'PX-043');
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(hasKeyword(s, uid, 'rushCharacter')).toBe(true);
    expect(attackError(s, 0, uid, enemy)).toBeNull();
    expect(attackError(s, 0, uid, s.players[1].leader.uid)).toMatch(/Rush/);
  });

  it('"cannot be rested" impede atacar e bloquear até o fim do próximo turno do oponente', () => {
    let s = toTurn(game(), 3);
    // Fora do deck de teste (para não mudar o embaralhamento dos outros testes): registra as definições.
    s.defs['ST02-004'] = buildCardDef(cards.find((c) => c.id === 'ST02-004')!); // Capone"Gang"Bege, [Blocker]
    s.defs['PX-044'] = buildCardDef(oden);
    const capone = field(s, 1, 'ST02-004');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-044') });
    expect(s.pending).toMatchObject({ kind: 'selectTargets' });
    s = applyAction(s, { type: 'choose', player: 0, uids: [capone] });
    expect(cannotBeRested(s, capone)).toBe(true);

    // Bloquear vira a carta: o [Blocker] travado não é opção.
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(blockerOptions(s, 1)).not.toContain(capone);
    while (s.pending) {
      const p = s.pending;
      s = applyAction(s, p.kind === 'block' ? { type: 'choose', player: p.player, uids: [] } : p.kind === 'lifeCard' ? { type: 'answer', player: p.player, yes: false } : { type: 'pass', player: p.player });
    }

    // No turno do oponente: atacar vira a carta, então não pode atacar.
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(attackError(s, 1, capone, s.players[0].leader.uid)).toMatch(/não pode ser virada/);

    // Depois da End Phase do oponente, volta ao normal.
    s = toTurn(s, 6);
    expect(cannotBeRested(s, capone)).toBe(false);
    expect(attackError(s, 1, capone, s.players[0].leader.uid)).toBeNull();
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
    // Garante exatamente uma cópia de [Big] no deck.
    for (const u of s.players[0].deck) if (s.cards[u].cardId === 'PX-006') s.cards[u] = { ...s.cards[u], cardId: 'PX-001' };
    const planted = s.players[0].deck[5];
    s.cards[planted] = { ...s.cards[planted], cardId: 'PX-006' };
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-011') });
    const big = s.pending?.kind === 'selectTargets' ? s.pending.options : [];
    expect(big).toEqual([planted]);
    s = applyAction(s, { type: 'choose', player: 0, uids: big });
    expect(s.players[0].hand).toContain(big[0]);

    let t = toTurn(game(), 3);
    const top = t.players[0].deck[0];
    t.cards[top] = { ...t.cards[top], cardId: 'PX-001' };
    t = applyAction(t, { type: 'playCard', player: 0, uid: give(t, 0, 'PX-012') });
    expect(t.pending?.kind === 'selectTargets' && t.pending.options).toContain(top);
    t = applyAction(t, { type: 'choose', player: 0, uids: [top] });
    // O resto vai para o fundo na ordem escolhida pelo jogador.
    if (t.pending?.kind === 'selectTargets' && t.pending.ordered) {
      t = applyAction(t, { type: 'choose', player: 0, uids: t.pending.options });
    }
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
    s = applyAction(s, { type: 'pass', player: 1 });
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

  it('aura de custo nos seus Personagens', () => {
    const s = toTurn(game(), 3);
    const other = field(s, 0, 'PX-001');
    expect(getCost(s, other)).toBe(1);
    field(s, 0, 'PX-022');
    expect(getCost(s, other)).toBe(2);
  });

  it('revela o topo e adiciona à mão se combinar com o filtro', () => {
    const s = toTurn(game(), 3);
    const top = s.players[0].deck[0];
    s.cards[top] = { ...s.cards[top], cardId: 'PX-001' };
    const t = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-023') });
    expect(t.players[0].hand).toContain(top);
    const u = toTurn(game(), 3);
    const top2 = u.players[0].deck[0];
    u.cards[top2] = { ...u.cards[top2], cardId: 'PX-015' }; // Evento: vai para o fundo
    const v = applyAction(u, { type: 'playCard', player: 0, uid: give(u, 0, 'PX-023') });
    expect(v.players[0].deck[v.players[0].deck.length - 1]).toBe(top2);
  });

  it('condição com "ou": 0 DON!! ou 8 ou mais', () => {
    const s = toTurn(game(), 3);
    const law = field(s, 0, 'PX-024');
    const hand = s.players[0].hand.length;
    const t = applyAction(s, { type: 'activate', player: 0, uid: law, ability: 0 });
    expect(t.players[0].hand).toHaveLength(hand);
    s.players[0].donActive = 0;
    s.players[0].donRested = 0;
    const u = applyAction(s, { type: 'activate', player: 0, uid: law, ability: 0 });
    expect(u.players[0].hand).toHaveLength(hand + 1);
  });

  it('gatilho: receber DON!!', () => {
    let s = toTurn(game(), 3);
    field(s, 0, 'PX-025');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'attachDon', player: 0, target: s.players[0].leader.uid });
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });

  it('gatilho: Personagem removido do campo por efeito seu', () => {
    let s = toTurn(game(), 3);
    field(s, 0, 'PX-026');
    const enemy = field(s, 1, 'PX-001');
    const bouncer = give(s, 0, 'PX-027');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: bouncer });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [enemy] });
    expect(s.players[1].hand).toContain(enemy);
    expect(s.players[0].hand).toHaveLength(hand); // −1 jogada, +1 compra
  });

  it('gatilho: oponente joga um Personagem', () => {
    let s = toTurn(game(), 4);
    field(s, 0, 'PX-028');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 1, uid: give(s, 1, 'PX-001') });
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });

  it('muda o alvo do ataque', () => {
    let s = toTurn(game(), 4);
    field(s, 0, 'PX-029');
    const decoy = field(s, 0, 'PX-001');
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const life = s.players[0].life.length;
    s = applyAction(s, { type: 'choose', player: 0, uids: [decoy] });
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    // O Personagem escolhido recebe o ataque (e é nocauteado); o Líder não perde Vida.
    expect(s.players[0].trash).toContain(decoy);
    expect(s.players[0].life).toHaveLength(life);
  });

  it('descarta quantas cartas quiser por +1000 cada', () => {
    let s = toTurn(game(), 3);
    const thrower = field(s, 0, 'PX-030');
    const [a, b] = s.players[0].hand;
    s.cards[a] = { ...s.cards[a], cardId: 'PX-008' };
    s.cards[b] = { ...s.cards[b], cardId: 'PX-013' };
    s = applyAction(s, { type: 'attack', player: 0, attacker: thrower, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [a, b] });
    expect(getPower(s, thrower)).toBe(4000);
    expect(s.players[0].trash).toEqual(expect.arrayContaining([a, b]));
  });

  it('ativa um Evento da mão sem pagar o custo', () => {
    let s = toTurn(game(), 3);
    const caller = field(s, 0, 'PX-031');
    const ev = s.players[0].hand[0];
    s.cards[ev] = { ...s.cards[ev], cardId: 'PX-013' }; // compra até ter 6 cartas
    s.players[0].hand = s.players[0].hand.slice(0, 2);
    const don = s.players[0].donActive;
    s = applyAction(s, { type: 'activate', player: 0, uid: caller, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [ev] });
    expect(s.players[0].trash).toContain(ev);
    expect(s.players[0].hand).toHaveLength(6);
    expect(s.players[0].donActive).toBe(don);
  });

  it('efeito no início do turno usa a situação antes da compra', () => {
    let s = toTurn(game(), 2);
    field(s, 0, 'PX-032');
    s.players[0].hand = s.players[0].hand.slice(0, 1);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.players[0].hand).toHaveLength(3);
  });

  it('as definições das cartas são compartilhadas entre estados e nunca mudam', () => {
    let s = toTurn(game(), 3);
    const before = JSON.stringify(s.defs);
    const defs = s.defs;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-016') }); // insere passos durante a resolução
    while (s.pending) s = applyAction(s, chooseBotAction(s, s.pending.player));
    s = toTurn(s, 6);
    expect(s.defs).toBe(defs);
    expect(JSON.stringify(s.defs)).toBe(before);
  });

  it('anula o efeito de um Personagem do oponente', () => {
    let s = toTurn(game(), 3);
    const big = field(s, 1, 'PX-006'); // +3 de custo
    expect(getCost(s, big)).toBe(5);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-033') });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [big] });
    expect(getCost(s, big)).toBe(2);
  });

  it('não pode ser removido do campo por efeitos do oponente', () => {
    let s = toTurn(game(), 3);
    const sticky = field(s, 1, 'PX-034');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-027') });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [sticky] });
    expect(s.players[1].characters.some((c) => c.uid === sticky)).toBe(true);
  });

  it('restrição: não pode jogar Personagens neste turno', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-035') });
    const other = s.players[0].hand[0];
    s.cards[other] = { ...s.cards[other], cardId: 'PX-001' };
    expect(playError(s, 0, other)).toMatch(/não pode jogar/);
    s = toTurn(s, 5);
    const again = s.players[0].hand[0];
    s.cards[again] = { ...s.cards[again], cardId: 'PX-001' };
    expect(playError(s, 0, again)).toBeNull();
  });

  it('custo menor na mão com a condição', () => {
    const s = toTurn(game(), 3);
    const cheap = give(s, 0, 'PX-036');
    expect(playCost(s, cheap)).toBe(3);
    s.players[0].life = s.players[0].life.slice(0, 1);
    expect(playCost(s, cheap)).toBe(1);
  });

  it('poder base do Líder passa a ser N', () => {
    let s = toTurn(game(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-037') });
    expect(getPower(s, s.players[0].leader.uid)).toBe(7000);
    s = toTurn(s, 4);
    expect(getPower(s, s.players[0].leader.uid)).toBe(5000);
  });

  it('[Unblockable] não pode ser bloqueado', () => {
    let s = toTurn(game(), 3);
    const ghost = field(s, 0, 'PX-038');
    field(s, 1, 'ST01-006'); // qualquer Personagem do oponente
    s.players[1].characters.forEach((c) => (s.cards[c.uid] = { ...s.cards[c.uid], cardId: 'ST02-009' }));
    expect(hasKeyword(s, ghost, 'unblockable')).toBe(true);
    s = applyAction(s, { type: 'attack', player: 0, attacker: ghost, target: s.players[1].leader.uid });
    expect(blockerOptions(s, 1)).toEqual([]);
  });

  it('custo: dar −5000 ao seu Líder ativo', () => {
    let s = toTurn(game(), 3);
    const payer = field(s, 0, 'PX-039');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'activate', player: 0, uid: payer, ability: 0 });
    expect(getPower(s, s.players[0].leader.uid)).toBe(0);
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });

  it('vira um DON!! ou um Personagem do oponente, à escolha', () => {
    let s = toTurn(game(), 4);
    s = toTurn(s, 5);
    const oppActive = s.players[1].donActive + s.players[1].donRested;
    s.players[1].donActive = oppActive;
    s.players[1].donRested = 0;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-040') });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.players[1].donRested).toBe(1);
  });

  it('Personagem do oponente não pode bloquear neste turno', () => {
    let s = toTurn(game(), 3);
    const blocker = field(s, 1, 'PX-001'); // 2000 de poder
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'PX-041') });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [blocker] });
    expect(s.modifiers.some((m) => m.uid === blocker && m.kind === 'cannotBlock')).toBe(true);
  });

  it('aura: seus Personagens de custo baixo não podem ser nocauteados por efeitos do oponente', () => {
    const s = toTurn(game(), 3);
    field(s, 0, 'PX-042');
    const small = field(s, 0, 'PX-001');
    expect(koProtected(s, small, false, undefined, 1)).toBe(true);
    // Só contra o oponente: o próprio efeito nocauteia (DV-13).
    expect(koProtected(s, small, false, undefined, 0)).toBe(false);
    expect(koProtected(s, small, true)).toBe(false);
  });
});
