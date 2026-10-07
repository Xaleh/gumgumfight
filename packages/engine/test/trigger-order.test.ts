// Ordem de resolução dos efeitos disparados (CR 8-6). Efeitos automáticos não entram na pilha
// na hora em que disparam: esperam o efeito (ou o dano) em resolução terminar e depois resolvem
// um de cada vez, primeiro os do jogador do turno (docs/rules/divergencias.md, DV-02 a DV-06).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef } from '../src/cards';
import { applyAction, locate } from '../src/engine';
import type { CardData, GameState, PlayerId } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards as baseCards, noDefense, started, toTurn } from './helpers';

const extra = ['op01', 'st16'].flatMap(
  (set) => (JSON.parse(readFileSync(join(__dirname, `../../../data/cards/${set}.json`), 'utf8')) as { cards: CardData[] }).cards,
);
const cards = [...baseCards, ...extra];

function defOf(s: GameState, cardId: string) {
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
}
/** Troca a carta do fundo do deck por `cardId` (de qualquer coleção) e devolve o uid (só para testes). */
function take(s: GameState, player: PlayerId, cardId: string): string {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  defOf(s, cardId);
  return uid;
}
function toHand(s: GameState, player: PlayerId, cardId: string) {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
}
function onField(s: GameState, player: PlayerId, cardId: string, opts: { rested?: boolean; don?: number } = {}) {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested: Boolean(opts.rested), don: opts.don ?? 0, playedOnTurn: 0 });
  return uid;
}
function setLeader(s: GameState, player: PlayerId, cardId: string, don = 0) {
  const leader = s.players[player].leader;
  s.cards[leader.uid] = { ...s.cards[leader.uid], cardId };
  defOf(s, cardId);
  leader.don = don;
}
function giveDon(s: GameState, player: PlayerId, count: number) {
  const ps = s.players[player];
  ps.donDeck -= count - ps.donActive;
  ps.donActive = count;
}
const play = (s: GameState, player: PlayerId, uid: string) => applyAction(s, { type: 'playCard', player, uid });
const choose = (s: GameState, player: PlayerId, uids: string[]) => applyAction(s, { type: 'choose', player, uids });

describe('efeito disparado espera o efeito que o disparou (8-6-3)', () => {
  it('Líder Crocodile (OP01-062) com 5 cartas: Great Eruption resolve primeiro, e o Crocodile já não compra', () => {
    const s0 = toTurn(started(), 3);
    setLeader(s0, 0, 'OP01-062', 1);
    giveDon(s0, 0, 3);
    const ps = s0.players[0];
    ps.deck.push(...ps.hand.splice(0)); // mão: Great Eruption + 4 cartas
    const eruption = toHand(s0, 0, 'ST06-015');
    ps.hand.push(...ps.deck.splice(0, 4));
    s0.players[1].characters = [];
    expect(ps.hand).toHaveLength(5);
    let s = play(s0, 0, eruption);
    for (let i = 0; i < 5 && s.pending; i++) {
      if (s.pending.kind === 'confirm') s = applyAction(s, { type: 'answer', player: 0, yes: !s.pending.cannot });
      else if (s.pending.kind === 'selectTargets') s = choose(s, 0, []);
      else break;
    }
    expect(s.pending).toBeNull();
    // Antes: o Crocodile comprava com 4 na mão antes do Evento resolver (mão final 6).
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('Brachio Bomber termina ("then add 1 DON!!") antes do [On K.O.] de Caribou', () => {
    const s0 = toTurn(started(), 3);
    giveDon(s0, 0, 6);
    const brachio = toHand(s0, 0, 'ST04-015');
    const mine = onField(s0, 0, 'ST02-011'); // Heat 4000: alvo do [On K.O.] de Caribou
    const caribou = onField(s0, 1, 'OP01-007');
    const deckBefore = s0.players[0].donDeck;
    let s = play(s0, 0, brachio);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = choose(s, 0, [caribou]);
    // Caribou (P1) pede o alvo do [On K.O.] só depois de o Brachio adicionar o DON!!.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [mine] });
    expect(s.players[0].donDeck).toBe(deckBefore - 1);
    expect(s.stack.filter((f) => f.kind === 'effect')).toHaveLength(1);
  });
});

describe('jogador do turno resolve os seus efeitos primeiro (8-6-1)', () => {
  it('Líder Kaido (OP01-061, turno) resolve antes do [On K.O.] de Caribou (oponente), independente do assento', () => {
    for (const turnPlayer of [0, 1] as const) {
      const other = (1 - turnPlayer) as PlayerId;
      const s0 = toTurn(started(), turnPlayer === 0 ? 3 : 4);
      expect(s0.activePlayer).toBe(turnPlayer);
      setLeader(s0, turnPlayer, 'OP01-061', 1);
      giveDon(s0, turnPlayer, 6);
      const brachio = toHand(s0, turnPlayer, 'ST04-015');
      onField(s0, turnPlayer, 'ST02-011');
      const caribou = onField(s0, other, 'OP01-007');
      const deckBefore = s0.players[turnPlayer].donDeck;
      let s = play(s0, turnPlayer, brachio);
      s = choose(s, turnPlayer, [caribou]);
      // Na vez do Caribou, o Brachio (+1) e o Kaido (+1) já resolveram.
      expect(s.pending).toMatchObject({ kind: 'selectTargets', player: other });
      expect(s.players[turnPlayer].donDeck).toBe(deckBefore - 2);
    }
  });
});

describe('efeito de carta que saiu do campo não ativa (8-1-3-1-3)', () => {
  it('Nico Robin nocauteia Gordon no [When Attacking]: o [On Your Opponent\'s Attack] de Gordon não ativa', () => {
    const s0 = toTurn(started(), 3);
    const robin = onField(s0, 0, 'OP01-017', { don: 1 });
    const gordon = onField(s0, 1, 'ST16-002');
    s0.players[1].hand = [];
    let s = applyAction(s0, { type: 'attack', player: 0, attacker: robin, target: s0.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = choose(s, 0, [gordon]);
    expect(locate(s, gordon)).toBeNull();
    // Antes: o efeito do Gordon (já no descarte) ainda abria a escolha para P1.
    expect(s.pending?.kind === 'block' || s.pending?.kind === 'counter').toBe(true);
    expect(s.log.some((e) => e.text.startsWith('Gordon') && e.text.includes('saiu do campo'))).toBe(true);
  });
});

describe('efeitos disparados durante o dano esperam o dano terminar (8-6-2)', () => {
  it('[Trigger] nocauteia Caribou no 1º dano do Double Attack: o [On K.O.] dele vem depois do 2º dano', () => {
    const s0 = toTurn(started(), 3);
    const oden = onField(s0, 0, 'ST09-005', { don: 1 }); // [DON!! x1] Double Attack, 7000 + 1000
    const caribou = onField(s0, 0, 'OP01-007');
    const theirs = onField(s0, 1, 'ST02-011'); // Heat 4000: alvo do [On K.O.] de Caribou
    s0.players[1].hand = [];
    const pistol = take(s0, 1, 'ST01-015'); // Trigger: K.O. ≤6000
    s0.players[1].life.push(pistol); // topo da Vida
    const lifeBefore = s0.players[1].life.length;
    let s = noDefenseUntilLife(applyAction(s0, { type: 'attack', player: 0, attacker: oden, target: s0.players[1].leader.uid }));
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 1, card: pistol });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    s = choose(s, 1, [caribou]);
    // O 2º dano vem antes do [On K.O.] de Caribou.
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(s.players[1].life).toHaveLength(lifeBefore - 2);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [theirs] });
  });
});

describe('ordem entre efeitos simultâneos do mesmo jogador (6-6-1-1-3)', () => {
  it('dois [End of Your Turn] de cartas diferentes: o dono escolhe qual resolve primeiro', () => {
    const s0 = toTurn(started(), 3);
    // Eustass"Captain"Kid (ST02-013): [DON!! x1] [End of Your Turn] Set this card as active.
    const a = onField(s0, 0, 'ST02-013', { don: 1, rested: true });
    const b = onField(s0, 0, 'ST02-013', { don: 1, rested: true });
    let s = applyAction(s0, { type: 'endTurn', player: 0 });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    const pending = s.pending as Extract<GameState['pending'], { kind: 'option' }>;
    expect(pending.order).toHaveLength(2);
    expect(pending.options).toHaveLength(2);
    // O oponente vê que há uma escolha, sem as opções; a fila não leva passos nem alvos.
    let n = 0;
    const view = viewFor(s, 1, createAliases(s, () => `a${++n}`));
    expect(view.pending).toMatchObject({ kind: 'option', prompt: '', options: [] });
    expect(view.triggered?.every((e) => e.steps.length === 0)).toBe(true);
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    expect(s.pending).toBeNull();
    expect(s.activePlayer).toBe(1);
    for (const uid of [a, b]) expect(s.players[0].characters.find((c) => c.uid === uid)?.rested).toBe(false);
  });

  it('o bot responde à escolha de ordem e a partida segue', () => {
    const s0 = toTurn(started(), 3);
    onField(s0, 0, 'ST02-013', { don: 1, rested: true });
    onField(s0, 0, 'ST02-013', { don: 1, rested: true });
    let s = applyAction(s0, { type: 'endTurn', player: 0 });
    const action = chooseBotAction(s, 0)!;
    expect(action.type).toBe('option');
    s = applyAction(s, action);
    expect(s.activePlayer).toBe(1);
  });
});

/** Passa Blocker e Counter até a carta da Vida aparecer. */
function noDefenseUntilLife(s: GameState): GameState {
  for (let i = 0; i < 5; i++) {
    const p = s.pending;
    if (p?.kind === 'block') s = applyAction(s, { type: 'choose', player: p.player, uids: [] });
    else if (p?.kind === 'counter') s = applyAction(s, { type: 'pass', player: p.player });
    else break;
  }
  return s;
}
void noDefense;
