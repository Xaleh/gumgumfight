import { describe, expect, it } from 'vitest';
import { applyAction, attackError, hasKeyword, IllegalActionError } from '../src/engine';
import type { GameState, PlayerId } from '../src/types';
import { countDon, fetchToHand, kaido, luffy, putOnField, started, toTurn } from './helpers';

// Jogador 0 = Kaido (ST04), jogador 1 = Luffy (ST01).
const begin = (turn = 3, seed = 1) => toTurn(started(seed, [kaido, luffy]), turn);
const play = (s: GameState, player: PlayerId, uid: string) => applyAction(s, { type: 'playCard', player, uid });
const answer = (s: GameState, player: PlayerId, yes: boolean) => applyAction(s, { type: 'answer', player, yes });
const giveDon = (s: GameState, player: PlayerId, n: number) => {
  const ps = s.players[player];
  ps.donDeck -= n - ps.donActive;
  ps.donActive = n;
};

describe('ST04 — Animal Kingdom Pirates', () => {
  it('Kaido (líder): DON!! −7 descarta 1 Vida do oponente', () => {
    let s = begin(3);
    giveDon(s, 0, 7);
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'activate', player: 0, uid: leader, ability: 0 });
    expect(s.players[1].life).toHaveLength(4);
    expect(s.players[1].trash).toHaveLength(1);
    expect(s.players[0].donActive + s.players[0].donRested).toBe(0);
    expect(countDon(s, 0)).toBe(10);
  });

  it('Kaido (líder) não ativa com menos de 7 DON!! em campo', () => {
    const s = begin(3);
    expect(() =>
      applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 }),
    ).toThrow(IllegalActionError);
  });

  it('Ulti: pagar DON!! −1 é opcional e joga [Page One] da mão', () => {
    let s = begin(5);
    giveDon(s, 0, 6);
    const ulti = fetchToHand(s, 0, 'ST04-002');
    const pageOne = fetchToHand(s, 0, 'ST04-012');
    s = play(s, 0, ulti);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, 0, true);
    expect(s.players[0].donDeck).toBe(5); // devolveu 1
    expect(s.pending?.kind === 'selectTargets' && s.pending.options).toEqual([pageOne]);
    s = applyAction(s, { type: 'choose', player: 0, uids: [pageOne] });
    expect(s.players[0].characters.map((c) => c.uid)).toEqual([ulti, pageOne]);

    // Recusando o custo, nada acontece.
    let t = begin(5);
    giveDon(t, 0, 6);
    const ulti2 = fetchToHand(t, 0, 'ST04-002');
    fetchToHand(t, 0, 'ST04-012');
    t = play(t, 0, ulti2);
    t = answer(t, 0, false);
    expect(t.pending).toBeNull();
    expect(t.players[0].characters).toHaveLength(1);
    expect(t.players[0].donDeck).toBe(4);
  });

  it('sem como pagar o custo, o efeito é pulado sem perguntar (Jack sem cartas na mão)', () => {
    let s = begin(3);
    const jack = fetchToHand(s, 0, 'ST04-008');
    const ps = s.players[0];
    ps.deck.push(...ps.hand.filter((u) => u !== jack));
    ps.hand = [jack];
    const deckBefore = ps.donDeck;
    s = play(s, 0, jack);
    expect(s.pending).toBeNull();
    expect(s.stack).toHaveLength(0);
    expect(s.players[0].donDeck).toBe(deckBefore);
  });

  it('Kaido (personagem): DON!! −5 nocauteia custo 6 ou menos e ganha [Rush] neste turno', () => {
    let s = begin(9);
    giveDon(s, 0, 10);
    const target = putOnField(s, 1, 'ST01-013');
    const kaidoChar = fetchToHand(s, 0, 'ST04-003');
    s = play(s, 0, kaidoChar);
    s = answer(s, 0, true);
    s = applyAction(s, { type: 'choose', player: 0, uids: [target] });
    expect(s.players[1].trash).toContain(target);
    expect(hasKeyword(s, kaidoChar, 'rush')).toBe(true);
    expect(attackError(s, 0, kaidoChar, s.players[1].leader.uid)).toBeNull();
    s = toTurn(s, 10);
    expect(hasKeyword(s, kaidoChar, 'rush')).toBe(false);
  });

  it('Queen: DON!! −1, compra 2 e descarta 1', () => {
    let s = begin(5);
    giveDon(s, 0, 6);
    const queen = fetchToHand(s, 0, 'ST04-005');
    const hand = s.players[0].hand.length;
    s = play(s, 0, queen);
    s = answer(s, 0, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', min: 1, max: 1, intent: 'discard' });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    expect(s.players[0].hand.length).toBe(hand - 1 + 2 - 1);
  });

  it('Jack: descartar 1 da mão adiciona 1 DON!! ativo', () => {
    let s = begin(3);
    const jack = fetchToHand(s, 0, 'ST04-008');
    s = play(s, 0, jack);
    expect(s.pending).toMatchObject({ kind: 'confirm' });
    s = answer(s, 0, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', intent: 'discard', min: 1 });
    const out = s.players[0].hand[0];
    const deckBefore = s.players[0].donDeck;
    s = applyAction(s, { type: 'choose', player: 0, uids: [out] });
    expect(s.players[0].trash).toContain(out);
    expect(s.players[0].donDeck).toBe(deckBefore - 1);
    expect(s.players[0].donActive).toBe(1);
  });

  it('Blast Breath: [Counter] com DON!! −1 dá +4000', () => {
    let s = begin(4);
    const ps = s.players[0];
    ps.hand = [];
    const breath = fetchToHand(s, 0, 'ST04-016');
    ps.donActive = 2;
    ps.donDeck -= 2;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: ps.leader.uid });
    s = applyAction(s, { type: 'counter', player: 0, uid: breath });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, 0, true);
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    expect(s.players[0].life).toHaveLength(5);
  });

  it('Onigashima Island: virar o Stage adiciona 1 DON!! virado se o Líder for {Animal Kingdom Pirates}', () => {
    for (const [leader, gain] of [
      ['ST04-001', 1],
      ['ST01-001', 0], // Luffy (do deck do oponente): não é {Animal Kingdom Pirates}
    ] as const) {
      let s = toTurn(started(1, [kaido, luffy]), 3);
      s.cards[s.players[0].leader.uid].cardId = leader;
      const stage = fetchToHand(s, 0, 'ST04-017');
      const ps = s.players[0];
      ps.hand.splice(ps.hand.indexOf(stage), 1);
      ps.stage = { uid: stage, rested: false, don: 0, playedOnTurn: 0 };
      const before = ps.donRested;
      s = applyAction(s, { type: 'activate', player: 0, uid: stage, ability: 0 });
      expect(s.players[0].stage?.rested).toBe(true);
      expect(s.players[0].donRested).toBe(before + gain);
    }
  });

  it('Brachio Bomber [Trigger] adiciona 1 DON!! ativo', () => {
    let s = begin(4);
    const ps = s.players[0];
    const bomber = fetchToHand(s, 0, 'ST04-015');
    ps.hand.splice(ps.hand.indexOf(bomber), 1);
    ps.life.push(bomber);
    ps.hand = [];
    const deckBefore = ps.donDeck;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: ps.leader.uid });
    s = applyAction(s, { type: 'pass', player: 0 });
    expect(s.pending).toMatchObject({ kind: 'lifeCard', card: bomber });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].donDeck).toBe(deckBefore - 1);
  });
});
