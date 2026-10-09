// Proteções e proibições (1-3-1, 1-3-3): "cannot be K.O.'d by your opponent's effects" só contra o
// oponente, o Personagem protegido não paga custo de K.O., "rest … DON!! or Characters" respeita as
// proteções de rest e o K.O. de Stage passa pelas proteções (DV-13 a DV-16).
import { describe, expect, it } from 'vitest';
import { applyAction, canPayCost, createGame } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

const char = (id: string, text: string): CardData => ({ id, name: id, category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text });
const event = (id: string, text: string): CardData => ({ id, name: id, category: 'event', colors: ['red'], cost: 0, types: [], text });
const stage = (id: string, text: string): CardData => ({ id, name: id, category: 'stage', colors: ['red'], cost: 1, types: [], text });

const extra: CardData[] = [
  char('PT-001', "This Character cannot be K.O.'d by your opponent's effects."),
  char('PT-002', "This Character cannot be K.O.'d by effects."),
  char('PT-003', '[Activate: Main] You may K.O. 1 of your Characters: Draw 1 card.'),
  char('PT-004', "This Character cannot be rested by your opponent's effects."),
  char('PT-005', '[Your Turn] [Once Per Turn] If a Character is rested by your effect, draw 1 card.'),
  char('PT-006', 'Vanilla.'),
  char('PT-007', "If you have 2 or more Characters, your Characters with a cost of 3 or less cannot be K.O.'d by your opponent's effects."),
  stage('PT-S01', "This Stage cannot be K.O.'d by your opponent's effects."),
  stage('PT-S02', 'Vanilla.'),
  event('PT-E01', '[Main] K.O. up to 1 of your Characters with a cost of 3 or less.'),
  event('PT-E02', "[Main] K.O. up to 1 of your opponent's Characters with a cost of 3 or less."),
  event('PT-E03', "[Main] Rest up to 1 of your opponent's DON!! cards or Characters with a cost of 4 or less."),
  event('PT-E04', "[Main] K.O. up to 1 of your opponent's Stages with a cost of 3 or less."),
  event('PT-E05', "[Main] Up to 1 of your Characters cannot be K.O.'d by your opponent's effects during this turn."),
];
const cards = [...baseCards, ...extra];
const inDeck = extra.filter((c) => c.category !== 'leader');
const deck: DeckList = {
  id: 'pt',
  name: 'pt',
  leader: 'ST01-001',
  cards: [{ id: 'ST01-006', count: 50 - inDeck.length }, ...inDeck.map((c) => ({ id: c.id, count: 1 }))],
};

/** Turno 3 (do jogador 0), com DON!! para pagar. */
function game(): GameState {
  let s = createGame({
    seed: 5,
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
const choose = (s: GameState, player: PlayerId, uids: string[]) => applyAction(s, { type: 'choose', player, uids });
const play = (s: GameState, player: PlayerId, cardId: string) => applyAction(s, { type: 'playCard', player, uid: give(s, player, cardId) });

describe('"cannot be K.O.\'d by your opponent\'s effects" só contra o oponente (DV-13)', () => {
  it('o próprio efeito nocauteia; o do oponente não', () => {
    let s = game();
    const mine = field(s, 0, 'PT-001');
    s = play(s, 0, 'PT-E01');
    s = choose(s, 0, [mine]);
    expect(s.players[0].trash).toContain(mine);

    // Do outro lado: o efeito do oponente continua sem nocautear.
    s = toTurn(s, 4);
    const theirs = field(s, 0, 'PT-001');
    s = play(s, 1, 'PT-E02');
    s = choose(s, 1, [theirs]);
    expect(onField(s, theirs)).toBe(true);
  });

  it('"cannot be K.O.\'d by effects" (sem "your opponent\'s") protege também do próprio efeito', () => {
    let s = game();
    const mine = field(s, 0, 'PT-002');
    s = play(s, 0, 'PT-E01');
    s = choose(s, 0, [mine]);
    expect(onField(s, mine)).toBe(true);
  });

  it('a aura e o efeito "during this turn" com "by your opponent\'s effects" também não protegem do próprio efeito', () => {
    let s = game();
    field(s, 0, 'PT-007');
    const a = field(s, 0, 'PT-006');
    s = play(s, 0, 'PT-E01');
    s = choose(s, 0, [a]);
    expect(s.players[0].trash).toContain(a);

    const b = field(s, 0, 'PT-006');
    s = play(s, 0, 'PT-E05');
    s = choose(s, 0, [b]);
    s = play(s, 0, 'PT-E01');
    s = choose(s, 0, [b]);
    expect(s.players[0].trash).toContain(b);
  });
});

describe('Personagem protegido não paga custo de K.O. (DV-14)', () => {
  it('não aparece entre as opções (a própria carta pode pagar: o texto não diz "other")', () => {
    let s = game();
    const src = field(s, 0, 'PT-003');
    const guarded = field(s, 0, 'PT-002');
    const ability = s.defs['PT-003'].abilities.findIndex((a) => a.cost?.koOwn);
    expect(ability).toBeGreaterThanOrEqual(0);
    expect(canPayCost(s, 0, src, s.defs['PT-003'].abilities[ability].cost!)).toBe(true);

    const plain = field(s, 0, 'PT-006');
    s = applyAction(s, { type: 'activate', player: 0, uid: src, ability });
    if (s.pending?.kind === 'confirm') s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect(s.pending?.kind === 'selectTargets' && [...s.pending.options].sort()).toEqual([src, plain].sort());
    s = choose(s, 0, [plain]);
    expect(s.players[0].trash).toContain(plain);
    expect(onField(s, guarded)).toBe(true);
  });
});

describe('"rest … DON!! cards or Characters" respeita as proteções de rest (DV-15)', () => {
  it('"cannot be rested by your opponent\'s effects" fica ativo; o virado emite "rested by your effect"', () => {
    let s = game();
    const guarded = field(s, 1, 'PT-004');
    const plain = field(s, 1, 'PT-006');
    field(s, 0, 'PT-005');
    const hand = s.players[0].hand.length;
    s = play(s, 0, 'PT-E03');
    const charOption = s.pending?.kind === 'option' ? s.pending.options.indexOf('Virar um Personagem do oponente') : -1;
    s = applyAction(s, { type: 'option', player: 0, index: charOption });
    s = choose(s, 0, [guarded]);
    expect(s.players[1].characters.find((c) => c.uid === guarded)?.rested).toBe(false);

    s = play(s, 0, 'PT-E03');
    s = applyAction(s, { type: 'option', player: 0, index: charOption });
    s = choose(s, 0, [plain]);
    expect(s.players[1].characters.find((c) => c.uid === plain)?.rested).toBe(true);
    // PT-005: "If a Character is rested by your effect, draw 1 card" (2 eventos jogados, 1 compra).
    expect(s.players[0].hand).toHaveLength(hand - 2 + 1);
  });
});

describe('K.O. de Stage passa pelas proteções (DV-16)', () => {
  /** Põe o Stage `cardId` no campo do jogador 1 (mutação direta, só para testes). */
  const putStage = (s: GameState, cardId: string) => {
    const st = s.players[1].deck.pop()!;
    s.cards[st] = { ...s.cards[st], cardId };
    s.players[1].stage = { uid: st, rested: false, don: 0, playedOnTurn: 0 };
    return st;
  };

  it('"This Stage cannot be K.O.\'d by your opponent\'s effects" fica no campo; o Stage sem proteção vai para o descarte', () => {
    let s = game();
    const guarded = putStage(s, 'PT-S01');
    s = play(s, 0, 'PT-E04');
    if (s.pending?.kind === 'selectTargets') s = choose(s, 0, [guarded]);
    expect(s.players[1].stage?.uid).toBe(guarded);
    expect(s.players[1].trash).not.toContain(guarded);

    s.players[1].stage = null;
    const plain = putStage(s, 'PT-S02');
    s = play(s, 0, 'PT-E04');
    if (s.pending?.kind === 'selectTargets') s = choose(s, 0, [plain]);
    expect(s.players[1].stage).toBeNull();
    expect(s.players[1].trash).toContain(plain);
  });
});
