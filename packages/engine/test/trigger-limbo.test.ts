// A carta do [Trigger] fica fora de qualquer área enquanto ele resolve (10-1-5-3): não está na
// Vida nem no descarte, não conta para "cards in your trash" e não sai "from your trash"; vai
// para o descarte quando o efeito termina, se ele não a moveu (docs/rules/divergencias.md, DV-17).
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards as baseCards, countCards, toTurn } from './helpers';

const char = (id: string, text: string, trigger?: string): CardData => ({
  id,
  name: id,
  category: 'character',
  colors: ['red'],
  cost: 1,
  power: 1000,
  types: [],
  text,
  ...(trigger ? { trigger } : {}),
});
const event = (id: string, text: string, trigger?: string): CardData => ({
  id,
  name: id,
  category: 'event',
  colors: ['red'],
  cost: 0,
  types: [],
  text,
  ...(trigger ? { trigger } : {}),
});

const extra: CardData[] = [
  // Como OP15-097: conta o descarte no [Main] (o Evento já está lá) e no [Trigger] (não está).
  event('TL-E01', '[Main] If you have 10 or more cards in your trash, draw 2 cards.', 'If you have 10 or more cards in your trash, draw 2 cards.'),
  // Como OP15-079 Absalom: pelo [Trigger], a própria carta não está no descarte.
  event('TL-E02', '', 'Add up to 1 card from your trash to your hand.'),
  char('TL-C01', '', 'Play this card.'),
  // Como OP16-079: "when a Character is played from your trash".
  char('TL-C02', "[Opponent's Turn] When a Character is played from your trash, draw 1 card."),
  // Como OP14-082 Oinkchuck: pelo [Trigger], não se joga do descarte.
  char('TL-C03', '', 'Play up to 1 Character card with a cost of 3 or less from your trash.'),
  event('TL-E03', '', "K.O. up to 1 of your opponent's Characters with a cost of 3 or less."),
  char('TL-C04', "[On K.O.] K.O. up to 1 of your opponent's Characters with a cost of 3 or less."),
];
const cards = [...baseCards, ...extra];
const deck: DeckList = {
  id: 'tl',
  name: 'tl',
  leader: 'ST01-001',
  cards: [{ id: 'ST01-006', count: 49 - extra.length }, { id: 'ST09-002', count: 1 }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
};

/** Turno 3 (do jogador 0): o Líder dele pode atacar o Líder do jogador 1. */
function game(): GameState {
  let s = createGame({
    seed: 7,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck },
      { name: 'B', deck },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  return toTurn(s, 3);
}
/** Pega uma carta do deck e troca por `cardId` (mutação direta, só para testes). */
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  return uid;
};
/** `cardId` no topo da Vida do jogador 1. */
const topLife = (s: GameState, cardId: string) => {
  const uid = take(s, 1, cardId);
  s.players[1].life.push(uid);
  return uid;
};
/** Descarte do jogador com exatamente `n` cartas genéricas. */
const trashOf = (s: GameState, player: PlayerId, n: number, cardId = 'ST01-006') => {
  const ps = s.players[player];
  ps.deck.push(...ps.trash.splice(0));
  for (let i = 0; i < n; i++) ps.trash.push(take(s, player, cardId));
};
/** O Líder do jogador 0 ataca o Líder do jogador 1, sem bloqueio nem Counter, até a carta da Vida. */
function attack(s: GameState): GameState {
  s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
  for (let guard = 0; guard < 5 && s.pending?.kind !== 'lifeCard'; guard++) {
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    else if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
  }
  expect(s.pending?.kind).toBe('lifeCard');
  return s;
}
const yes = (s: GameState) => applyAction(s, { type: 'answer', player: 1, yes: true });
const onField = (s: GameState, uid: string) => s.players.some((p) => p.characters.some((c) => c.uid === uid));

describe('carta do [Trigger] fora do descarte enquanto resolve (DV-17)', () => {
  it('OP15-097: pelo [Trigger] com 9 no descarte não cumpre "10 ou mais"; depois a carta vai ao descarte', () => {
    const s0 = game();
    const card = topLife(s0, 'TL-E01');
    trashOf(s0, 1, 9);
    const hand = s0.players[1].hand.length;
    const s = yes(attack(s0));
    expect(s.players[1].hand).toHaveLength(hand); // não comprou
    expect(s.players[1].trash).toHaveLength(10);
    expect(s.players[1].trash[9]).toBe(card);
    expect(s.limbo).toBeUndefined();
  });

  it('OP15-097: pelo [Main] da mão o Evento já está no descarte e conta 10', () => {
    let s = game();
    const card = take(s, 0, 'TL-E01');
    s.players[0].hand.push(card);
    trashOf(s, 0, 9);
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: card });
    expect(s.players[0].hand).toHaveLength(hand - 1 + 2);
  });

  it('[Trigger] "Play this card" não sai do descarte: não dispara "played from your trash"', () => {
    const s0 = game();
    const card = topLife(s0, 'TL-C01');
    const watcher = take(s0, 1, 'TL-C02');
    s0.players[1].characters.push({ uid: watcher, rested: false, don: 0, playedOnTurn: 0 });
    const hand = s0.players[1].hand.length;
    const s = yes(attack(s0));
    expect(onField(s, card)).toBe(true);
    expect(s.players[1].trash).not.toContain(card);
    expect(s.players[1].hand).toHaveLength(hand); // o TL-C02 não comprou
    expect(s.log.some((e) => e.text.includes('TL-C02'))).toBe(false);
    expect(countCards(s, 1)).toBe(51);
  });

  it('OP14-082: o [Trigger] "play … from your trash" não joga a própria carta', () => {
    const s0 = game();
    const card = topLife(s0, 'TL-C03');
    trashOf(s0, 1, 1, 'TL-C01'); // um Personagem de custo 1 no descarte
    const other = s0.players[1].trash[0];
    let s = yes(attack(s0));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [other] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [other] });
    expect(onField(s, other)).toBe(true);
    expect(onField(s, card)).toBe(false);
    expect(s.players[1].trash).toEqual([card]);
  });

  it('OP15-079: "add … from your trash" pelo [Trigger] não alcança a própria carta; ela é pública enquanto resolve', () => {
    const s0 = game();
    const card = topLife(s0, 'TL-E02');
    trashOf(s0, 1, 2);
    const inTrash = [...s0.players[1].trash];
    let s = yes(attack(s0));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    expect((s.pending as { options: string[] }).options.sort()).toEqual([...inTrash].sort());
    // Fora de qualquer área: nem Vida nem descarte, mas ainda é carta do jogador.
    expect(s.limbo).toEqual([card]);
    expect(s.players[1].trash).not.toContain(card);
    expect(s.players[1].life).not.toContain(card);
    expect(countCards(s, 1)).toBe(51);
    // Foi revelada: o oponente (e o espectador) a veem, fora do descarte.
    for (const viewer of [0, null] as const) {
      let n = 0;
      const aliases = createAliases(s, () => `a${++n}`);
      const view = viewFor(s, viewer, aliases);
      const alias = aliases.toAlias[card];
      expect(view.limbo).toEqual([alias]);
      expect(view.cards[alias]?.cardId).toBe('TL-E02');
      expect(view.players[1].trash).not.toContain(alias);
    }
    s = applyAction(s, { type: 'choose', player: 1, uids: [inTrash[0]] });
    expect(s.players[1].hand).toContain(inTrash[0]);
    expect(s.players[1].trash).toEqual([inTrash[1], card]);
    expect(s.limbo).toBeUndefined();
  });

  it('ST09-002: "… and add this card to your hand" leva a carta de fora das áreas para a mão', () => {
    const s0 = game();
    const card = topLife(s0, 'ST09-002');
    let s = yes(attack(s0));
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.players[1].hand).toContain(card);
    expect(s.players[1].trash).not.toContain(card);
    expect(s.limbo).toBeUndefined();
  });

  it('8-6: o efeito disparado durante o [Trigger] espera o dano; a carta já está no descarte quando ele resolve', () => {
    const s0 = game();
    const card = topLife(s0, 'TL-E03');
    const victim = take(s0, 0, 'TL-C04');
    s0.players[0].characters.push({ uid: victim, rested: false, don: 0, playedOnTurn: 0 });
    const target = take(s0, 1, 'ST01-006');
    s0.players[1].characters.push({ uid: target, rested: false, don: 0, playedOnTurn: 0 });
    let s = yes(attack(s0));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [victim] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [victim] });
    // O [On K.O.] do TL-C04 resolve depois do [Trigger] e do dano, com a carta do [Trigger] no descarte.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [target] });
    expect(s.limbo).toBeUndefined();
    expect(s.players[1].trash).toContain(card);
    expect(s.stack.some((f) => f.kind === 'damage')).toBe(false);
  });
});
