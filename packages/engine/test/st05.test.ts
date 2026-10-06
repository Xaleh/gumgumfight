import { describe, expect, it } from 'vitest';
import { applyAction, getPower, hasKeyword, koProtected } from '../src/engine';
import type { GameState, PlayerId } from '../src/types';
import { fetchToHand, luffy, putOnField, shanks, started, toTurn } from './helpers';

// Jogador 0 = Shanks (ST05), jogador 1 = Luffy (ST01).
const begin = (turn = 3, seed = 1) => toTurn(started(seed, [shanks, luffy]), turn);
const activate = (s: GameState, player: PlayerId, uid: string, ability = 0) =>
  applyAction(s, { type: 'activate', player, uid, ability });
const setDon = (s: GameState, player: PlayerId, active: number, rested = 0) => {
  const ps = s.players[player];
  const field = ps.donActive + ps.donRested;
  ps.donDeck += field - active - rested;
  ps.donActive = active;
  ps.donRested = rested;
};

describe('ST05 — ONE PIECE FILM edition', () => {
  it('Shanks (líder): DON!! −3 dá +2000 a todos os {FILM} sem escolher', () => {
    let s = begin(5);
    setDon(s, 0, 5);
    const a = putOnField(s, 0, 'ST05-007');
    const b = putOnField(s, 0, 'ST05-012');
    const opp = putOnField(s, 1, 'ST01-013');
    const before = [a, b, opp].map((u) => getPower(s, u));
    s = activate(s, 0, s.players[0].leader.uid);
    expect(s.pending).toBeNull();
    expect([a, b, opp].map((u) => getPower(s, u))).toEqual([before[0] + 2000, before[1] + 2000, before[2]]);
  });

  it('Uta: ao bloquear, DON!! −1 vira um personagem do oponente de custo 5 ou menos', () => {
    let s = begin(4);
    s.players[0].hand = [];
    const uta = putOnField(s, 0, 'ST05-004');
    const other = putOnField(s, 1, 'ST01-013', { turn: 1 });
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    s = applyAction(s, { type: 'choose', player: 0, uids: [uta] });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = applyAction(s, { type: 'choose', player: 0, uids: [other] });
    expect(s.players[1].characters.find((c) => c.uid === other)?.rested).toBe(true);
  });

  it('Carina: virar + descartar 1 {FILM} dá 2 DON!! virados se o oponente tiver mais DON!!', () => {
    let s = begin(5);
    setDon(s, 0, 1);
    setDon(s, 1, 4);
    const carina = putOnField(s, 0, 'ST05-005');
    const film = s.players[0].hand[0];
    s = activate(s, 0, carina);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', intent: 'discard' });
    s = applyAction(s, { type: 'choose', player: 0, uids: [film] });
    expect(s.players[0].donRested).toBe(2);
    expect(s.players[0].characters.find((c) => c.uid === carina)?.rested).toBe(true);
  });

  it('Carina não ativa sem carta {FILM} na mão', () => {
    const s = begin(5);
    const carina = putOnField(s, 0, 'ST05-005');
    const ps = s.players[0];
    ps.deck.push(...ps.hand);
    ps.hand = [];
    expect(() => activate(s, 0, carina)).toThrow(/insuficientes/);
  });

  it('Shiki não é nocauteado em batalha com 8+ DON!! em campo', () => {
    for (const [don, survives] of [
      [8, true],
      [7, false],
    ] as const) {
      let s = begin(4);
      setDon(s, 0, 0, don);
      const shiki = putOnField(s, 0, 'ST05-008', { rested: true });
      s.players[0].hand = [];
      s.modifiers.push({ uid: s.players[1].leader.uid, kind: 'power', amount: 5000, duration: 'turn' });
      s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: shiki });
      s = applyAction(s, { type: 'pass', player: 0 });
      expect(s.players[0].characters.some((c) => c.uid === shiki)).toBe(survives);
    }
  });

  it('Zephyr ganha +3000 ao batalhar com Personagem de atributo Strike', () => {
    let s = begin(4);
    s.players[0].hand = [fetchToHand(s, 0, 'ST05-007')]; // mantém a etapa de Counter aberta
    const zephyr = putOnField(s, 0, 'ST05-010', { rested: true });
    const strikeChar = s.players[1].deck.find(
      (u) => s.defs[s.cards[u].cardId].category === 'character' && s.defs[s.cards[u].cardId].attributes?.includes('Strike'),
    );
    expect(strikeChar).toBeDefined();
    const ps = s.players[1];
    ps.deck.splice(ps.deck.indexOf(strikeChar!), 1);
    ps.characters.push({ uid: strikeChar!, rested: false, don: 0, playedOnTurn: 1 });
    expect(getPower(s, zephyr)).toBe(8000);
    s = applyAction(s, { type: 'attack', player: 1, attacker: strikeChar!, target: zephyr });
    // O bônus vale enquanto a batalha acontece (aqui ela para esperando o Counter... ou já acabou).
    expect(s.battle).not.toBeNull();
    expect(getPower(s, zephyr)).toBe(11000);
  });

  it('Douglas Bullet: DON!! −4 vira até 2 personagens e ganha [Double Attack]', () => {
    let s = begin(9);
    setDon(s, 0, 9);
    const bullet = putOnField(s, 0, 'ST05-011');
    const a = putOnField(s, 1, 'ST01-013');
    const b = putOnField(s, 1, 'ST01-002');
    s = activate(s, 0, bullet);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', max: 2 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [a, b] });
    expect(s.players[1].characters.every((c) => c.rested)).toBe(true);
    expect(hasKeyword(s, bullet, 'doubleAttack')).toBe(true);
  });

  it('Buena Festa busca um {FILM} que não seja Buena Festa', () => {
    let s = begin(3);
    const festa = fetchToHand(s, 0, 'ST05-014');
    const ps = s.players[0];
    const other = ps.deck.find((u) => s.cards[u].cardId === 'ST05-014')!;
    ps.deck.splice(ps.deck.indexOf(other), 1);
    ps.deck.unshift(other);
    s = applyAction(s, { type: 'playCard', player: 0, uid: festa });
    expect(s.pending?.kind).toBe('selectTargets');
    const options = s.pending?.kind === 'selectTargets' ? s.pending.options : [];
    expect(options).not.toContain(other);
    expect(options.length).toBeGreaterThan(0);
  });

  it('Union Armada: +4000 e, se for Personagem, não pode ser nocauteado neste turno', () => {
    let s = begin(4);
    const ps = s.players[0];
    ps.hand = [];
    const armada = fetchToHand(s, 0, 'ST05-017');
    setDon(s, 0, 2);
    const gordon = putOnField(s, 0, 'ST05-007', { rested: true });
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: gordon });
    s = applyAction(s, { type: 'counter', player: 0, uid: armada });
    s = applyAction(s, { type: 'choose', player: 0, uids: [gordon] });
    expect(koProtected(s, gordon, false)).toBe(true);
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    expect(s.players[0].characters.some((c) => c.uid === gordon)).toBe(true);
    s = toTurn(s, 5);
    expect(koProtected(s, gordon, false)).toBe(false);
  });
});
