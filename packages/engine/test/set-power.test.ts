// «Set Power to 0» (4-12) é uma redução igual ao poder atual no momento da ativação, não um poder
// base 0: Counters e bônus posteriores somam, e o efeito some ao fim da duração (Q&A OP07-002 Ain).
// Vários efeitos que fixam o poder base: vale o MAIOR (4-9-2-1; Q&A ST34-004 Linlin, OP17-008 Jozu).
// docs/rules/divergencias.md, DV-19 e DV-20.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/cards/parser';
import { applyAction, basePowerOf, createGame, getPower } from '../src/engine';
import type { CardData, DeckList, EffectStep, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

const st34 = (): CardData[] => JSON.parse(readFileSync(join(__dirname, '../../../data/cards/st34.json'), 'utf8')).cards;

const char = (id: string, power: number, text = '', counter?: number): CardData => ({
  id,
  name: id,
  category: 'character',
  colors: ['red'],
  cost: 1,
  power,
  ...(counter ? { counter } : {}),
  types: [],
  text,
});
const event = (id: string, text: string): CardData => ({ id, name: id, category: 'event', colors: ['red'], cost: 0, types: [], text });

// OP07-002 Ain não está na base local: carta sintética com o texto oficial.
const AIN = { ...char('OP07-002', 2000, "[On Play] Set the power of up to 1 of your opponent's Characters to 0 during this turn."), name: 'Ain' };
const extra: CardData[] = [
  AIN,
  char('SP-HACK', 5000),
  char('SP-COUNTER', 1000, '', 1000),
  event('SP-E00', "[Main] Up to 1 of your opponent's Characters' base power becomes 0 during this turn."),
  event('SP-E06', "[Main] Up to 1 of your opponent's Characters' base power becomes 6000 during this turn."),
];
const cards = [...baseCards, ...extra];
const deck: DeckList = {
  id: 'sp',
  name: 'sp',
  leader: 'ST01-001',
  cards: [{ id: 'ST01-006', count: 50 - extra.length }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
};

/** Turno 3 (do jogador 0). */
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
const play = (s: GameState, uid: string) => applyAction(s, { type: 'playCard', player: 0, uid });
const choose = (s: GameState, player: PlayerId, uids: string[]) => applyAction(s, { type: 'choose', player, uids });
/** Joga o Ain e escolhe `target`. */
const ain = (s: GameState, target: string) => {
  s = play(s, give(s, 0, 'OP07-002'));
  expect(s.pending?.kind).toBe('selectTargets');
  return choose(s, 0, [target]);
};

const stepsOf = (c: CardData, kinds: EffectStep['do'][]) => {
  const out: EffectStep[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (kinds.includes((x as EffectStep).do)) out.push(x as EffectStep);
      Object.values(x).forEach(walk);
    }
  };
  walk(parseCard(c));
  return out;
};

describe('«Set Power to 0» (DV-19)', () => {
  it('o parser lê o OP07-002 como setPowerZero, não como poder base 0', () => {
    expect(stepsOf(AIN, ['setPowerZero', 'basePower'])).toEqual([
      { do: 'setPowerZero', target: { side: 'opponent', kinds: ['character'], upTo: 1 }, duration: 'turn' },
    ]);
  });

  it('OP07-002 + [Counter +1000]: o poder fica em 1000', () => {
    let s = game();
    const hack = field(s, 1, 'SP-HACK', true);
    // Com um bônus anterior (+1000 até o fim do próximo turno do oponente): antes, poder base 0 com o bônus
    // por cima dava 1000 já depois do Ain e 2000 depois do Counter.
    s.modifiers.push({ uid: hack, kind: 'power', amount: 1000, duration: 'nextOpponentTurn', untilTurn: 4 });
    s = ain(s, hack);
    expect(getPower(s, hack)).toBe(0);
    s.players[1].hand = [];
    s.players[1].hand.push(s.players[1].deck.pop()!);
    const counter = give(s, 1, 'SP-COUNTER');
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: hack });
    if (s.pending?.kind === 'block') s = choose(s, 1, []);
    expect(s.pending?.kind).toBe('counter');
    s = applyAction(s, { type: 'counter', player: 1, uid: counter });
    expect(getPower(s, hack)).toBe(1000);
  });

  it('bônus já aplicado também é anulado; o efeito some no turno seguinte (Hack 5000 +2000)', () => {
    let s = game();
    const hack = field(s, 1, 'SP-HACK');
    // +2000 "until the end of your opponent's next turn": dura até o fim do turno 4.
    s.modifiers.push({ uid: hack, kind: 'power', amount: 2000, duration: 'nextOpponentTurn', untilTurn: 4 });
    expect(getPower(s, hack)).toBe(7000);
    s = ain(s, hack);
    // Antes: poder base 0 com o +2000 por cima = 2000.
    expect(getPower(s, hack)).toBe(0);
    expect(basePowerOf(s, hack)).toBe(5000);
    s = toTurn(s, 4);
    expect(getPower(s, hack)).toBe(7000);
  });

  it('poder já negativo não muda', () => {
    let s = game();
    const hack = field(s, 1, 'SP-COUNTER'); // 1000
    s.modifiers.push({ uid: hack, kind: 'power', amount: -2000, duration: 'turn' });
    expect(getPower(s, hack)).toBe(-1000);
    s = ain(s, hack);
    // Antes: poder base 0 com o −2000 = −2000.
    expect(getPower(s, hack)).toBe(-1000);
    expect(s.modifiers.filter((m) => m.uid === hack)).toHaveLength(1);
  });
});

describe('vários "base power becomes X" (DV-20)', () => {
  it('ST34-004 Linlin: "base power becomes 0" é poder base', () => {
    const linlin = st34().find((c) => c.id === 'ST34-004')!;
    expect(stepsOf(linlin, ['basePower', 'setPowerZero'])).toEqual([
      expect.objectContaining({ do: 'basePower', amount: 0, duration: 'turn' }),
    ]);
  });

  for (const order of [
    ['SP-E06', 'SP-E00'],
    ['SP-E00', 'SP-E06'],
  ]) {
    it(`0 e 6000 (${order.join(' → ')}): vale o maior, 6000`, () => {
      let s = game();
      const hack = field(s, 1, 'SP-HACK');
      for (const id of order) s = choose(play(s, give(s, 0, id)), 0, [hack]);
      expect(basePowerOf(s, hack)).toBe(6000);
      expect(getPower(s, hack)).toBe(6000);
      // Bônus somam por cima do poder base.
      s.modifiers.push({ uid: hack, kind: 'power', amount: 1000, duration: 'turn' });
      expect(getPower(s, hack)).toBe(7000);
      s = toTurn(s, 4);
      expect(getPower(s, hack)).toBe(5000);
    });
  }

  it('o maior vale mesmo abaixo do impresso, se só um efeito fixa o poder base', () => {
    let s = game();
    const hack = field(s, 1, 'SP-HACK');
    s = choose(play(s, give(s, 0, 'SP-E00')), 0, [hack]);
    expect(getPower(s, hack)).toBe(0);
  });
});
