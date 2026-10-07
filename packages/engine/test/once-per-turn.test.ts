// [Once Per Turn] por carta: a carta que sai do campo e volta é uma carta nova (3-1-6) e pode usar
// o [Once Per Turn] de novo no mesmo turno (10-2-13-4) (docs/rules/divergencias.md, DV-10).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { activateError, applyAction } from '../src/engine';
import type { CardData, GameState, PlayerId } from '../src/types';
import { cards as baseCards, noDefense, started, toTurn } from './helpers';

const st14 = (JSON.parse(readFileSync(join(__dirname, '../../../data/cards/st14.json'), 'utf8')) as { cards: CardData[] }).cards;
const card = (id: string, category: CardData['category'], text: string): CardData =>
  ({ id, name: `Teste ${id}`, category, colors: ['black'], cost: 1, power: 3000, counter: 0, attributes: [], types: [], text, set: 'OPT', rarity: 'C' }) as CardData;
const custom: CardData[] = [
  card('OPT-BOUNCE', 'character', '[Activate: Main] Return up to 1 of your Characters to the owner\'s hand.'),
  card('OPT-KO', 'character', '[Once Per Turn] [On K.O.] Draw 1 card.'),
  card('OPT-KILL', 'character', '[Activate: Main] K.O. up to 1 Character with a cost of 1 or less.'),
  card('OPT-STAGE', 'stage', '[Activate: Main] [Once Per Turn] Draw 1 card.'),
  card('OPT-STAGE2', 'stage', ''),
];
const cards = [...baseCards, ...st14, ...custom];

/** Troca a carta do fundo do deck por `cardId` e a devolve (só para testes). */
function fromDeck(s: GameState, player: PlayerId, cardId: string): string {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
}

function inHand(s: GameState, player: PlayerId, cardId: string): string {
  const uid = fromDeck(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
}

function onField(s: GameState, player: PlayerId, cardId: string, rested = false): string {
  const uid = fromDeck(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
}

/** Turno 3 do jogador 0, com DON!! de sobra. */
function turn3(): GameState {
  const s = toTurn(started(), 3);
  s.players[0].donActive = 10;
  s.players[0].donDeck = 0;
  return s;
}

/** Jinbe ST14-004 usa o [Activate: Main] (sem alvo: "up to 1"). */
function useJinbe(s: GameState, jinbe: string): GameState {
  s = applyAction(s, { type: 'activate', player: 0, uid: jinbe, ability: 0 });
  if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [] });
  expect(s.pending).toBeNull();
  return s;
}

/** Joga da mão e resolve o que vier sem escolher nada. */
function play(s: GameState, uid: string): GameState {
  s = applyAction(s, { type: 'playCard', player: 0, uid });
  expect(s.pending).toBeNull();
  return s;
}

describe('[Once Per Turn] reinicia quando a carta sai e volta ao campo (DV-10)', () => {
  it('Jinbe ST14-004 usa o [Activate: Main], volta para a mão por efeito, é jogado de novo e usa outra vez', () => {
    let s = turn3();
    const jinbe = onField(s, 0, 'ST14-004');
    const bounce = onField(s, 0, 'OPT-BOUNCE');
    s = useJinbe(s, jinbe);
    expect(activateError(s, 0, jinbe, 0)).toBe('Já usada neste turno.');
    s = applyAction(s, { type: 'activate', player: 0, uid: bounce, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [jinbe] });
    expect(s.players[0].hand).toContain(jinbe);
    s = play(s, jinbe);
    expect(s.players[0].characters.map((c) => c.uid)).toContain(jinbe);
    // Antes: "Já usada neste turno." (a marca `uid:índice` só era zerada no fim do turno).
    expect(activateError(s, 0, jinbe, 0)).toBeNull();
    s = useJinbe(s, jinbe);
    // A carta nova também só usa uma vez.
    expect(activateError(s, 0, jinbe, 0)).toBe('Já usada neste turno.');
  });

  it('a mesma carta que não saiu do campo continua sem poder usar de novo', () => {
    let s = turn3();
    const jinbe = onField(s, 0, 'ST14-004');
    const other = onField(s, 0, 'OPT-BOUNCE');
    s = useJinbe(s, jinbe);
    s = applyAction(s, { type: 'activate', player: 0, uid: other, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [other] });
    expect(activateError(s, 0, jinbe, 0)).toBe('Já usada neste turno.');
  });

  it('[On K.O.] [Once Per Turn]: o uso marcado no trash não passa para a carta que volta ao campo', () => {
    let s = turn3();
    const target = onField(s, 0, 'OPT-KO');
    const kill = onField(s, 0, 'OPT-KILL');
    const ko = (s: GameState): GameState => {
      s = applyAction(s, { type: 'activate', player: 0, uid: kill, ability: 0 });
      s = applyAction(s, { type: 'choose', player: 0, uids: [target] });
      expect(s.pending).toBeNull();
      expect(s.players[0].trash).toContain(target);
      return s;
    };
    const hand1 = s.players[0].hand.length;
    s = ko(s);
    expect(s.players[0].hand).toHaveLength(hand1 + 1);
    // O uso fica marcado para a carta no trash, que resolveu o [On K.O.] (DV-07).
    expect(s.usedThisTurn).toContain(`${target}:0`);
    // Volta para a mão e é jogada de novo no mesmo turno: é uma carta nova.
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: target, to: 'hand' } });
    s = play(s, target);
    expect(s.usedThisTurn).not.toContain(`${target}:0`);
    const hand2 = s.players[0].hand.length;
    s = ko(s);
    // Antes: o [On K.O.] continuava marcado e não ativava.
    expect(s.players[0].hand).toHaveLength(hand2 + 1);
  });

  it('Stage trocado por outro, devolvido à mão e jogado de novo usa o [Once Per Turn] outra vez', () => {
    let s = turn3();
    const stage = inHand(s, 0, 'OPT-STAGE');
    const other = inHand(s, 0, 'OPT-STAGE2');
    s = play(s, stage);
    s = applyAction(s, { type: 'activate', player: 0, uid: stage, ability: 0 });
    expect(activateError(s, 0, stage, 0)).toBe('Já usada neste turno.');
    s = play(s, other);
    expect(s.players[0].trash).toContain(stage);
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: stage, to: 'hand' } });
    s = play(s, stage);
    expect(s.players[0].stage?.uid).toBe(stage);
    expect(activateError(s, 0, stage, 0)).toBeNull();
  });

  it('"battled during this turn" também é esquecido quando a carta sai do campo', () => {
    let s = turn3();
    const attacker = onField(s, 0, 'ST14-004');
    const target = onField(s, 1, 'OPT-KO', true);
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker, target }));
    expect(s.battledCharacter).toContain(attacker);
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'move', uid: attacker, to: 'hand' } });
    expect(s.battledCharacter ?? []).not.toContain(attacker);
  });
});
