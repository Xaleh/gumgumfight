import { describe, expect, it } from 'vitest';
import { applyAction, createGame, IllegalActionError, manualAllowed, zoneOf } from '../src/engine';
import { legalActions } from '../src/actions';
import { manualAbilities } from '../src/cards';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, countCards, countDon, fetchToHand, putOnField, toTurn } from './helpers';

// Cartas sintéticas sem script (efeitos resolvidos à mão).
const extra: CardData[] = [
  { id: 'MAN-001', name: 'Manual OnPlay', category: 'character', colors: ['red'], cost: 1, power: 2000, counter: 1000, types: [], text: '[On Play] Look at 3 cards from the top of your deck and do something unusual.' },
  { id: 'MAN-002', name: 'Manual Main', category: 'event', colors: ['red'], cost: 1, types: [], text: '[Main] Swap something strange.', trigger: 'Do something unusual with this card.' },
  { id: 'MAN-003', name: 'Manual Counter', category: 'event', colors: ['green'], cost: 0, types: [], text: '[Counter] Something odd happens during this battle.' },
  { id: 'MAN-004', name: 'Manual EOT', category: 'character', colors: ['red'], cost: 1, power: 1000, types: [], text: '[End of Your Turn] Set up to 1 of your DON!! cards as active, weirdly.' },
  { id: 'MAN-005', name: 'Static only', category: 'character', colors: ['red'], cost: 1, power: 1000, types: [], text: '[DON!! x1] This Character gains +1000 power in a new way.\n[Blocker] (After your opponent declares an attack...)' },
];
const cards = [...baseCards, ...extra];
// As cartas sintéticas entram nos decks (o estado só guarda definições das cartas dos decks).
const deck = (leader: string, fill: string): DeckList => ({
  id: leader,
  name: leader,
  leader,
  cards: [{ id: fill, count: 50 - extra.length }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
});

function game(): GameState {
  let s = createGame({
    seed: 3,
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

/** Coloca na mão uma carta sintética (substitui uma da mão para manter a contagem). */
function give(s: GameState, player: 0 | 1, cardId: string): string {
  const uid = s.players[player].hand[0];
  s.cards[uid] = { ...s.cards[uid], cardId };
  return uid;
}

describe('habilidades manuais derivadas do texto', () => {
  it('reconhece os momentos e ignora linhas só de palavra-chave', () => {
    expect(manualAbilities(extra[0]).map((a) => a.timing)).toEqual(['onPlay']);
    expect(manualAbilities(extra[1]).map((a) => a.timing)).toEqual(['main', 'trigger']);
    expect(manualAbilities(extra[2]).map((a) => a.timing)).toEqual(['counter']);
    expect(manualAbilities(extra[3]).map((a) => a.timing)).toEqual(['endOfTurn']);
    const st = manualAbilities(extra[4]);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ timing: 'static', don: 1, steps: [] });
  });
});

describe('modo manual', () => {
  it('[On Play] sem script pausa para o jogador aplicar o efeito', () => {
    let s = toTurn(game(), 3);
    const uid = give(s, 0, 'MAN-001');
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.pending).toMatchObject({ kind: 'manual', player: 0, source: uid });
    // Nada foi revelado ainda: além de concluir, dá para cancelar a jogada.
    expect(legalActions(s, 0)).toEqual([
      { type: 'manualDone', player: 0 },
      { type: 'cancel', player: 0 },
    ]);
    expect(manualAllowed(s, 0)).toBe(true);
    expect(manualAllowed(s, 1)).toBe(false);
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'draw', count: 1 } });
    expect(s.players[0].hand.length).toBe(hand + 1);
    expect(() => applyAction(s, { type: 'manual', player: 1, op: { op: 'draw', count: 1 } })).toThrow(IllegalActionError);
    s = applyAction(s, { type: 'manualDone', player: 0 });
    expect(s.pending).toBeNull();
    expect(s.stack).toHaveLength(0);
  });

  it('evento [Main] sem script pode ser jogado e [Trigger] vira efeito manual', () => {
    let s = toTurn(game(), 3);
    const ev = give(s, 0, 'MAN-002');
    s = applyAction(s, { type: 'playCard', player: 0, uid: ev });
    expect(s.pending?.kind).toBe('manual');
    expect(s.players[0].trash).toContain(ev);
    s = applyAction(s, { type: 'manualDone', player: 0 });

    // [Trigger] revelado da Vida
    s.players[1].hand = s.players[1].hand.slice(0); // sem mudanças
    const lifeTop = s.players[1].life[s.players[1].life.length - 1];
    s.cards[lifeTop] = { ...s.cards[lifeTop], cardId: 'MAN-002' };
    s.players[1].hand = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.pending).toMatchObject({ kind: 'manual', player: 1 });
    // "Play this card": o defensor coloca a carta do descarte em campo... aqui é evento, então só confirma
    s = applyAction(s, { type: 'manualDone', player: 1 });
    expect(s.battle).toBeNull();
  });

  it('evento [Counter] sem script é usado no Counter e o defensor resolve à mão', () => {
    let s = toTurn(game(), 3);
    s.players[1].hand = [];
    const uid = fetchToHand(s, 1, 'ST02-009');
    s.cards[uid] = { ...s.cards[uid], cardId: 'MAN-003' };
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'counter', options: [uid] });
    s = applyAction(s, { type: 'counter', player: 1, uid });
    expect(s.pending).toMatchObject({ kind: 'manual', player: 1 });
    s = applyAction(s, { type: 'manual', player: 1, op: { op: 'power', uid: s.players[1].leader.uid, amount: 2000, duration: 'battle' } });
    s = applyAction(s, { type: 'manualDone', player: 1 });
    // Sem mais Counters na mão, a batalha segue sozinha para o dano.
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.battle).toBeNull();
    expect(s.players[1].life).toHaveLength(5); // 5000 contra 7000: ataque falhou
  });

  it('[End of Your Turn] resolve antes de passar o turno', () => {
    let s = toTurn(game(), 3);
    const uid = give(s, 0, 'MAN-004');
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.activePlayer).toBe(0);
    expect(s.pending).toMatchObject({ kind: 'manual', player: 0, source: uid });
    s = applyAction(s, { type: 'manualDone', player: 0 });
    expect(s.activePlayer).toBe(1);
    expect(s.turn).toBe(4);
  });
});

describe('ferramentas manuais', () => {
  it('movem cartas entre zonas sem perder nem duplicar', () => {
    let s = toTurn(game(), 3);
    const mine = putOnField(s, 0, 'ST01-006');
    const theirs = putOnField(s, 1, 'ST02-009');
    const check = () => {
      expect(countCards(s, 0)).toBe(51);
      expect(countCards(s, 1)).toBe(51);
      expect(countDon(s, 0)).toBe(10);
      expect(countDon(s, 1)).toBe(10);
    };
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'donGive', uid: mine, from: 'active' } });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: mine, to: 'deckBottom' } });
    expect(zoneOf(s, mine)).toBe('deck');
    check();
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: theirs, to: 'hand' } });
    expect(s.players[1].hand).toContain(theirs);
    check();
    // mão do oponente não pode ser mexida
    expect(() => applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: theirs, to: 'trash' } })).toThrow(/oponente/);
    const fromTrash = s.players[0].hand[0];
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: fromTrash, to: 'trash' } });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: fromTrash, to: 'character', rested: true } });
    expect(s.players[0].characters.find((c) => c.uid === fromTrash)).toMatchObject({ rested: true, playedOnTurn: 3 });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'ko', uid: fromTrash } });
    expect(s.players[0].trash).toContain(fromTrash);
    const top = s.players[0].life[s.players[0].life.length - 1];
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: top, to: 'hand' } });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'donSetState', player: 1, rested: true, count: 1 } });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'donFromDeck', count: 1, rested: false } });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'donToDeck', count: 2 } });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'shuffle' } });
    check();
  });

  it('não pode ser usada no turno do oponente fora de um efeito', () => {
    const s = toTurn(game(), 4);
    expect(() => applyAction(s, { type: 'manual', player: 0, op: { op: 'draw', count: 1 } })).toThrow(/indisponíveis/);
  });

  it('respeita o limite de 5 personagens', () => {
    let s = toTurn(game(), 3);
    for (let i = 0; i < 5; i++) putOnField(s, 0, 'ST01-006');
    const uid = fetchToHand(s, 0, 'ST01-006');
    expect(() => applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid, to: 'character' } })).toThrow(/cheia/);
  });
});
