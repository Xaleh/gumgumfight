// Efeitos de substituição ("… instead"), CR 8-1-3-4: todas as aplicáveis são oferecidas, em ordem
// (8-1-3-4-2), em toda remoção do campo, e uma só vale para os Personagens removidos juntos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import { chooseBotAction } from '../src/bot/simple';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, returnDonInOrder, toTurn } from './helpers';

const op01: CardData[] = JSON.parse(readFileSync(join(__dirname, '../../../data/cards/op01.json'), 'utf8')).cards;
const kaido = op01.find((c) => c.id === 'OP01-094')!; // [On Play] DON!! −6: … K.O. all Characters other than this Character.

const leader = (id: string, text: string, types: string[] = []): CardData => ({ id, name: id, category: 'leader', colors: ['red'], life: 5, power: 5000, types, text });
const char = (id: string, text: string, types: string[] = []): CardData => ({ id, name: id, category: 'character', colors: ['red'], cost: 1, power: 2000, types, text });
const event = (id: string, text: string): CardData => ({ id, name: id, category: 'event', colors: ['red'], cost: 0, types: [], text });

const extra: CardData[] = [
  kaido,
  leader('RP-L01', "If your Character would be K.O.'d, you may trash 1 card from your hand instead."),
  // Como o Líder OP11-001 Koby (Q&A: um pagamento salva os dois {Navy} do Kaido OP01-094).
  leader(
    'RP-L02',
    "[Once Per Turn] If your {Navy} type Character would be removed from the field by your opponent's effect, you may place 3 cards from your trash at the bottom of your deck in any order instead.",
    ['Navy'],
  ),
  char('RP-001', "[Once Per Turn] If this Character would be K.O.'d, you may trash 1 card from the top of your deck instead."),
  char('RP-002', 'Navy grunt.', ['Navy']),
  char('RP-003', "If this Character would be removed from the field by your opponent's effect, you may trash 1 card from your hand instead."),
  char('RP-004', '[Your Turn] [Once Per Turn] This effect can be activated when a Character is removed from the field by your effect. Draw 1 card.'),
  char('RP-005', 'If this Character would be removed from the field, you may trash 1 card from your hand instead.'),
  event('RP-E01', "[Main] Add up to 1 of your opponent's Characters with a cost of 3 or less to the top of the owner's Life cards."),
  event('RP-E02', "[Main] Return up to 1 of your Characters to the owner's hand."),
  event('RP-E03', "[Main] Your opponent returns 1 of their Characters to the owner's hand."),
];
const cards = [...baseCards, ...extra];
const inDeck = extra.filter((c) => c.category !== 'leader');
const deck = (lead: string): DeckList => ({
  id: lead,
  name: lead,
  leader: lead,
  cards: [{ id: 'ST01-006', count: 50 - inDeck.length }, ...inDeck.map((c) => ({ id: c.id, count: 1 }))],
});

function game(leaders: [string, string]): GameState {
  let s = createGame({
    seed: 3,
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
/** Troca a primeira carta da mão por `cardId` (mutação direta, só para testes). */
const give = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].hand[0];
  s.cards[uid] = { ...s.cards[uid], cardId };
  return uid;
};
/** Põe `cardId` no campo, tirada do deck (mutação direta, só para testes). */
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
const onField = (s: GameState, uid: string) => s.players.some((p) => p.characters.some((c) => c.uid === uid));
const answer = (s: GameState, player: PlayerId, yes: boolean) => applyAction(s, { type: 'answer', player, yes });
const choose = (s: GameState, player: PlayerId, uids: string[]) => applyAction(s, { type: 'choose', player, uids });

describe('substituições: todas são oferecidas, em ordem (DV-11)', () => {
  it('Líder + Personagem com substituição: a da própria carta vem primeiro; recusada, a do Líder é oferecida e salva', () => {
    let s = toTurn(game(['RP-L01', 'ST01-001']), 4); // turno do jogador 1
    const guard = field(s, 0, 'RP-001', true);
    const hand = s.players[0].hand.length;
    const deckSize = s.players[0].deck.length;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: guard });
    if (s.pending?.kind === 'block') s = choose(s, 0, []);
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    // 1º: a do Personagem afetado (8-1-3-4-2).
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0, source: guard });
    s = answer(s, 0, false);
    // Recusar não leva direto ao K.O.: oferece a do Líder.
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0, source: s.players[0].leader.uid });
    s = answer(s, 0, true);
    s = choose(s, 0, [s.players[0].hand[0]]);
    expect(onField(s, guard)).toBe(true);
    expect(s.players[0].hand).toHaveLength(hand - 1);
    expect(s.players[0].deck).toHaveLength(deckSize); // a recusada não foi paga
    // Recusar não gastou o [Once Per Turn] da do Personagem (Q&A OP05-001 Sabo).
    expect(s.usedThisTurn.some((k) => k.startsWith(`${guard}:`))).toBe(false);
  });

  it('recusando todas, o Personagem é nocauteado', () => {
    let s = toTurn(game(['RP-L01', 'ST01-001']), 4);
    const guard = field(s, 0, 'RP-001', true);
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: guard });
    if (s.pending?.kind === 'block') s = choose(s, 0, []);
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    s = answer(s, 0, false);
    s = answer(s, 0, false);
    expect(s.players[0].trash).toContain(guard);
    expect(s.pending?.kind).not.toBe('confirm');
  });
});

describe('remoções simultâneas: um pagamento salva todos (Q&A OP11-001, OP15-009)', () => {
  function kaidoVsKoby(trash: number) {
    let s = toTurn(game(['ST04-001', 'RP-L02']), 3);
    const navy = [field(s, 1, 'RP-002'), field(s, 1, 'RP-002')];
    const other = field(s, 1, 'RP-004');
    const p1 = s.players[1];
    p1.trash.push(...p1.deck.splice(0, trash));
    const p0 = s.players[0];
    p0.donActive = 10;
    p0.donDeck = 0;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'OP01-094') });
    s = answer(s, 0, true); // DON!! −6
    s = returnDonInOrder(s);
    return { s, navy, other };
  }

  it('Kaido OP01-094 derruba 2 {Navy}: o Líder Koby paga 3 cartas uma vez e salva os dois', () => {
    let { s, navy, other } = kaidoVsKoby(3);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1, source: s.players[1].leader.uid });
    s = answer(s, 1, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, min: 3 });
    const paid = [...s.players[1].trash];
    s = choose(s, 1, paid);
    for (const u of navy) expect(onField(s, u)).toBe(true);
    // Só uma pergunta: o outro Personagem (sem substituição) é nocauteado junto.
    expect(s.pending?.kind).not.toBe('confirm');
    expect(s.players[1].trash).toEqual([other]);
    expect(s.players[1].deck.slice(-3).sort()).toEqual(paid.sort());
  });

  it('com 2 cartas no descarte não dá para usar, nem em parte: os dois são nocauteados', () => {
    const { s, navy } = kaidoVsKoby(2);
    expect(s.pending?.kind).not.toBe('confirm');
    for (const u of navy) expect(s.players[1].trash).toContain(u);
  });

  it('recusando, todos saem juntos', () => {
    let { s, navy, other } = kaidoVsKoby(3);
    s = answer(s, 1, false);
    for (const u of [...navy, other]) expect(s.players[1].trash).toContain(u);
  });
});

describe('toda remoção do campo oferece a substituição (DV-12)', () => {
  it('"Add … to the top of the owner\'s Life cards" (fieldToLife): pagando, o Personagem fica', () => {
    let s = toTurn(game(['ST01-001', 'ST01-001']), 3);
    const target = field(s, 1, 'RP-003');
    const hand = s.players[1].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'RP-E01') });
    s = choose(s, 0, [target]);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1, source: target });
    expect(chooseBotAction(s, 1)).toEqual({ type: 'answer', player: 1, yes: true });
    s = answer(s, 1, true);
    s = choose(s, 1, [s.players[1].hand[0]]);
    expect(onField(s, target)).toBe(true);
    expect(s.players[1].hand).toHaveLength(hand - 1);
  });

  it('fieldToLife recusada: vai para a Vida e conta como "removed from the field by your effect"', () => {
    let s = toTurn(game(['ST01-001', 'ST01-001']), 3);
    const target = field(s, 1, 'RP-003');
    field(s, 0, 'RP-004');
    const life = s.players[1].life.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'RP-E01') });
    const hand = s.players[0].hand.length;
    s = choose(s, 0, [target]);
    s = answer(s, 1, false);
    expect(s.players[1].life).toHaveLength(life + 1);
    expect(s.players[1].life[s.players[1].life.length - 1]).toBe(target);
    expect(s.players[0].hand).toHaveLength(hand + 1); // RP-004 comprou
  });

  it('"Your opponent returns 1 of their Characters" (opponentChoosesOwn) oferece a substituição', () => {
    let s = toTurn(game(['ST01-001', 'ST01-001']), 3);
    const target = field(s, 1, 'RP-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'RP-E03') });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    s = choose(s, 1, [target]);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1, source: target });
    s = answer(s, 1, true);
    s = choose(s, 1, [s.players[1].hand[0]]);
    expect(onField(s, target)).toBe(true);
  });

  it('"would be removed from the field" sem "by your opponent" vale contra efeito próprio', () => {
    let s = toTurn(game(['ST01-001', 'ST01-001']), 3);
    const mine = field(s, 0, 'RP-005');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'RP-E02') });
    s = choose(s, 0, [mine]);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0, source: mine });
    // O bot não paga para desfazer a remoção que ele mesmo escolheu.
    expect(chooseBotAction(s, 0)).toEqual({ type: 'answer', player: 0, yes: false });
    s = answer(s, 0, false);
    expect(s.players[0].hand).toContain(mine);
  });

  it('"by your opponent\'s effect" continua sem valer contra efeito próprio', () => {
    let s = toTurn(game(['ST01-001', 'ST01-001']), 3);
    const mine = field(s, 0, 'RP-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 0, 'RP-E02') });
    s = choose(s, 0, [mine]);
    expect(s.pending?.kind).not.toBe('confirm');
    expect(s.players[0].hand).toContain(mine);
  });
});
