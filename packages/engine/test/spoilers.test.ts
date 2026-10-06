import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { automationStatus, buildCardDef } from '../src/cards';
import { applyAction, counterOptions, counterValue, createGame, getPower, hasKeyword } from '../src/engine';
import { translateCardPt } from '../src/i18n/render';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Cartas de EB05 e OP18 como saem do feed de spoilers (traduções de fãs, com erros de digitação).
const spoilers = (JSON.parse(readFileSync(join(__dirname, 'fixtures/spoilers-eb05-op18.json'), 'utf8')) as { cards: CardData[] }).cards;

// Personagens sintéticos para os filtros novos.
const extra: CardData[] = [
  { id: 'SPX-001', name: 'Duck', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Animal', 'Alabasta'], text: '' },
  { id: 'SPX-002', name: 'Guard', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Alabasta'], text: '' },
  { id: 'SPX-003', name: 'Scholar', category: 'character', colors: ['green'], cost: 1, power: 1000, attributes: ['Wisdom'], types: [], text: '' },
  { id: 'SPX-004', name: 'Wall', category: 'character', colors: ['green'], cost: 1, power: 1000, attributes: ['Wisdom'], types: [], text: '[Blocker]' },
];
const cards = [...baseCards, ...spoilers, ...extra];

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['ST01-001', 'ST02-001']): GameState {
  let s = createGame({
    seed: 7,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck(leaders[0]) },
      { name: 'B', deck: deck(leaders[1]) },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
/** Troca a carta do topo do deck por `cardId` e a põe na zona pedida (mutação direta, só para testes). */
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
};
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
/** O defensor não usa [Blocker] nem Counter. */
function noDefense(s: GameState): GameState {
  for (let guard = 0; guard < 10; guard++) {
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: s.pending.player, uids: [] });
    else if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: s.pending.player });
    else break;
  }
  return s;
}

describe('spoilers de EB05 e OP18', () => {
  it('todas as cartas têm efeito automatizado e tradução completa', () => {
    expect(spoilers).toHaveLength(71);
    const pending = spoilers.filter((c) => ['partial', 'manual'].includes(automationStatus(c)) || !translateCardPt(c).complete);
    expect(pending.map((c) => c.id)).toEqual([]);
  });

  it('Gloriosa: descartar o Personagem em vez de sofrer dano', () => {
    let s = toTurn(game(), 3);
    const gloriosa = field(s, 1, 'EB05-052');
    const life = s.players[1].life.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid }));
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.players[1].life).toHaveLength(life);
    expect(s.players[1].trash).toContain(gloriosa);
    expect(s.players[1].characters.some((c) => c.uid === gloriosa)).toBe(false);
  });

  it('Gloriosa: recusar a substituição perde a Vida normalmente', () => {
    let s = toTurn(game(), 3);
    const gloriosa = field(s, 1, 'EB05-052');
    const life = s.players[1].life.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid }));
    s = applyAction(s, { type: 'answer', player: 1, yes: false });
    if (s.pending?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(s.players[1].life).toHaveLength(life - 1);
    expect(s.players[1].characters.some((c) => c.uid === gloriosa)).toBe(true);
  });

  it('Gloriosa também evita o dano que derrotaria o jogador sem Vida', () => {
    let s = toTurn(game(), 3);
    field(s, 1, 'EB05-052');
    s.players[1].deck.push(...s.players[1].life.splice(0));
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid }));
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.winner ?? null).toBeNull();
  });

  it('Franky: Stages na mão viram Counter +3000', () => {
    let s = toTurn(game(['ST01-001', 'OP18-021']), 3);
    const merry = hand(s, 1, 'OP18-078');
    expect(counterValue(s, merry)).toBe(3000);
    expect(counterOptions(s, 1)).toContain(merry);
    const target = s.players[1].leader.uid;
    const life = s.players[1].life.length;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 1 });
    s = applyAction(s, { type: 'counter', player: 1, uid: merry });
    expect(s.players[1].trash).toContain(merry);
    // 5000 contra 5000 + 3000: o ataque falha e o Franky não perde Vida.
    expect(s.log.some((l) => /Mini-Merry dá \+3000/.test(l.text))).toBe(true);
    expect(s.players[1].life).toHaveLength(life);
  });

  it('sem o Franky, Stage não é Counter', () => {
    const s = toTurn(game(), 3);
    const merry = hand(s, 1, 'OP18-078');
    expect(counterValue(s, merry)).toBe(0);
    expect(counterOptions(s, 1)).not.toContain(merry);
  });

  it('Luffy (OP18-022): fica ativo ao atacar e não desvira na Renovação seguinte', () => {
    let s = toTurn(game(['OP18-022', 'ST02-001']), 3);
    const leader = s.players[0].leader;
    leader.don = 3;
    s = applyAction(s, { type: 'attack', player: 0, attacker: leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = noDefense(s);
    if (s.pending?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(s.players[0].leader.rested).toBe(false);
    // Usa o Líder de novo (fica virado) e passa a vez: na Renovação ele continua virado.
    s.players[0].leader.rested = true;
    s = applyAction(s, { type: 'endTurn', player: 0 });
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.activePlayer).toBe(0);
    expect(s.players[0].leader.rested).toBe(true);
  });

  it('Karoo: só Personagens com os dois tipos ganham [Rush] e +1000', () => {
    const s = toTurn(game(['OP18-001', 'ST02-001']), 3);
    const both = field(s, 0, 'SPX-001');
    const one = field(s, 0, 'SPX-002');
    expect(hasKeyword(s, both, 'rush')).toBe(true);
    expect(getPower(s, both)).toBe(3000);
    expect(hasKeyword(s, one, 'rush')).toBe(false);
    expect(getPower(s, one)).toBe(2000);
  });

  it('Nico Robin (EB05-010): Vida extra quando um Personagem "Wisdom" sem [Blocker] é nocauteado', () => {
    let s = toTurn(game(['EB05-010', 'ST02-001']), 4);
    const scholar = field(s, 0, 'SPX-003', true);
    const wall = field(s, 0, 'SPX-004', true);
    const life = s.players[0].life.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: wall }));
    expect(s.players[0].characters.some((c) => c.uid === wall)).toBe(false);
    expect(s.players[0].life).toHaveLength(life);
    s.players[1].leader.rested = false;
    s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: scholar }));
    expect(s.players[0].characters.some((c) => c.uid === scholar)).toBe(false);
    expect(s.players[0].life).toHaveLength(life + 1);
  });

  it('Mini-Merry: 1 DON!! virado para cada um de até 4 alvos', () => {
    let s = toTurn(game(), 3);
    const merry = take(s, 0, 'OP18-078');
    s.players[0].stage = { uid: merry, rested: false, don: 0, playedOnTurn: 0 };
    const a = field(s, 0, 'ST01-006');
    const b = field(s, 0, 'ST01-006');
    s.players[0].donRested = 4;
    const ability = 1; // [Activate: Main]
    s = applyAction(s, { type: 'activate', player: 0, uid: merry, ability });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid, a, b] });
    expect(s.players[0].leader.don).toBe(1);
    expect(s.players[0].characters.find((c) => c.uid === a)?.don).toBe(1);
    expect(s.players[0].characters.find((c) => c.uid === b)?.don).toBe(1);
    expect(s.players[0].donRested).toBe(1);
  });
});
