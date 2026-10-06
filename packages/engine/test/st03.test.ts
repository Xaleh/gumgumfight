import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction, IllegalActionError } from '../src/engine';
import type { GameState, PlayerId } from '../src/types';
import { countCards, countDon, crocodile, fetchToHand, luffy, putOnField, started, toTurn } from './helpers';

// Jogador 0 = Crocodile (ST03), jogador 1 = Luffy (ST01).
const begin = (turn = 3, seed = 1) => toTurn(started(seed, [crocodile, luffy]), turn);
const idOf = (s: GameState, uid: string) => s.cards[uid].cardId;
const attack = (s: GameState, player: PlayerId, attacker: string, target: string) =>
  applyAction(s, { type: 'attack', player, attacker, target });

describe('ST03 — The Seven Warlords of the Sea', () => {
  it('Crocodile (líder): DON!! −4 devolve um personagem de custo 5 ou menos para a mão do dono', () => {
    let s = begin(3);
    const nami = putOnField(s, 1, 'ST01-007'); // custo 1
    s.players[0].donActive = 4;
    const leader = s.players[0].leader.uid;
    const deckBefore = s.players[0].donDeck;
    const totalBefore = countDon(s, 0);
    s = applyAction(s, { type: 'activate', player: 0, uid: leader, ability: 0 });
    expect(s.players[0].donDeck).toBe(deckBefore + 4);
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 0, uids: [nami] });
    expect(s.players[1].hand).toContain(nami);
    expect(s.players[1].characters).toHaveLength(0);
    expect(countDon(s, 0)).toBe(totalBefore);
    // [Once Per Turn]
    s.players[0].donActive = 4;
    expect(() => applyAction(s, { type: 'activate', player: 0, uid: leader, ability: 0 })).toThrow(IllegalActionError);
  });

  it('Crocodile (líder) não ativa sem 4 DON!! em campo', () => {
    const s = begin(1);
    expect(() =>
      applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 }),
    ).toThrow(/DON!! insuficientes/);
  });

  it('Crocodile (personagem) com DON!! x1 manda um personagem de custo 2 ou menos para o fundo do deck ao bloquear', () => {
    let s = begin(3);
    const croc = putOnField(s, 0, 'ST03-003');
    s = applyAction(s, { type: 'attachDon', player: 0, target: croc });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    // Turno do oponente: o DON!! continua anexado.
    const usopp = putOnField(s, 1, 'ST01-002'); // custo 2
    s.players[0].hand = [];
    s = attack(s, 1, s.players[1].leader.uid, s.players[0].leader.uid);
    expect(s.pending).toMatchObject({ kind: 'block', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [croc] });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect(s.pending?.kind === 'selectTargets' && s.pending.options).toEqual([usopp]);
    s = applyAction(s, { type: 'choose', player: 0, uids: [usopp] });
    const deck = s.players[1].deck;
    expect(deck[deck.length - 1]).toBe(usopp);
    expect(countCards(s, 1)).toBe(51);
  });

  it('Gecko Moria busca no descarte um {The Seven Warlords of the Sea} de custo 4 ou menos que não seja Gecko Moria', () => {
    let s = begin(5);
    const ps = s.players[0];
    const mihawk = fetchToHand(s, 0, 'ST03-005');
    const doffy = fetchToHand(s, 0, 'ST03-009'); // custo 7
    const otherMoria = fetchToHand(s, 0, 'ST03-004');
    for (const u of [mihawk, doffy, otherMoria]) ps.hand.splice(ps.hand.indexOf(u), 1);
    ps.trash.push(mihawk, doffy, otherMoria);
    const moria = fetchToHand(s, 0, 'ST03-004');
    s = applyAction(s, { type: 'playCard', player: 0, uid: moria });
    expect(s.pending?.kind === 'selectTargets' && s.pending.options).toEqual([mihawk]);
    s = applyAction(s, { type: 'choose', player: 0, uids: [mihawk] });
    expect(s.players[0].hand).toContain(mihawk);
    expect(s.players[0].trash).toEqual([doffy, otherMoria]);
  });

  it('Mihawk com DON!! x1 compra 2 e descarta 2 ao atacar', () => {
    let s = begin(3);
    const mihawk = putOnField(s, 0, 'ST03-005');
    s = applyAction(s, { type: 'attachDon', player: 0, target: mihawk });
    const handBefore = s.players[0].hand.length;
    s = attack(s, 0, mihawk, s.players[1].leader.uid);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', min: 2, max: 2, intent: 'discard' });
    expect(s.players[0].hand.length).toBe(handBefore + 2);
    const two = s.players[0].hand.slice(0, 2);
    s = applyAction(s, { type: 'choose', player: 0, uids: two });
    expect(s.players[0].hand.length).toBe(handBefore);
    expect(s.players[0].trash).toEqual(two);
  });

  it('Sentomaru: ② joga um [Pacifista] de custo 4 ou menos do deck e embaralha', () => {
    let s = begin(5);
    const sentomaru = putOnField(s, 0, 'ST03-007');
    const ps = s.players[0];
    ps.hand = ps.hand.filter((u) => idOf(s, u) !== 'ST03-012');
    ps.life = ps.life.filter((u) => idOf(s, u) !== 'ST03-012');
    s = applyAction(s, { type: 'attachDon', player: 0, target: sentomaru });
    s = applyAction(s, { type: 'activate', player: 0, uid: sentomaru, ability: 0 });
    expect(s.pending?.kind).toBe('selectTargets');
    const options = s.pending?.kind === 'selectTargets' ? s.pending.options : [];
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((u) => idOf(s, u) === 'ST03-012')).toBe(true);
    s = applyAction(s, { type: 'choose', player: 0, uids: [options[0]] });
    expect(s.players[0].characters.map((c) => c.uid)).toContain(options[0]);
    expect(s.players[0].donActive).toBe(5 - 1 - 2);
  });

  it('Sentomaru exige DON!! x1', () => {
    const s = begin(5);
    const sentomaru = putOnField(s, 0, 'ST03-007');
    expect(() => applyAction(s, { type: 'activate', player: 0, uid: sentomaru, ability: 0 })).toThrow(/Condições/);
  });

  it('Bartholomew Kuma olha 3 do topo: escolhe as do fundo e a ordem das que ficam', () => {
    let s = begin(3);
    const kuma = fetchToHand(s, 0, 'ST03-010');
    const [a, b, c] = s.players[0].deck.slice(0, 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: kuma });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', ordered: true, min: 0, max: 3 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [b] });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', ordered: true, min: 2, max: 2 });
    expect(s.players[0].deck.slice(0, 2)).toEqual([a, c]); // continuam visíveis no topo
    s = applyAction(s, { type: 'choose', player: 0, uids: [c, a] });
    const deck = s.players[0].deck;
    expect(deck.slice(0, 2)).toEqual([c, a]);
    expect(deck[deck.length - 1]).toBe(b);
    expect(s.pending).toBeNull();
    expect(countCards(s, 0)).toBe(51);
  });

  it('Sables [Trigger] usa o efeito [Main]: devolve um personagem de custo 7 ou menos', () => {
    let s = begin(4); // turno do jogador 1 (Luffy), que ataca o Crocodile
    const zoro = putOnField(s, 1, 'ST01-013');
    const sables = fetchToHand(s, 0, 'ST03-015');
    const ps = s.players[0];
    ps.hand.splice(ps.hand.indexOf(sables), 1);
    ps.life.push(sables);
    ps.hand = [];
    s = attack(s, 1, s.players[1].leader.uid, ps.leader.uid);
    s = applyAction(s, { type: 'pass', player: 0 });
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 0, card: sables });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending?.kind === 'selectTargets' && s.pending.options).toContain(zoro);
    s = applyAction(s, { type: 'choose', player: 0, uids: [zoro] });
    expect(s.players[1].hand).toContain(zoro);
  });

  it('Thrust Pad Cannon: [Counter] devolve o atacante; [Trigger] usa o efeito [Counter]', () => {
    let s = begin(4);
    const usopp = putOnField(s, 1, 'ST01-002', { turn: 1 }); // custo 2
    const ps = s.players[0];
    ps.hand = [];
    const cannon = fetchToHand(s, 0, 'ST03-016');
    ps.donActive = 2;
    s = attack(s, 1, usopp, ps.leader.uid);
    expect(s.pending).toMatchObject({ kind: 'counter', options: [cannon] });
    s = applyAction(s, { type: 'counter', player: 0, uid: cannon });
    s = applyAction(s, { type: 'choose', player: 0, uids: [usopp] });
    expect(s.players[1].hand).toContain(usopp);
    expect(s.battle).toBeNull();
    expect(s.players[0].life).toHaveLength(5);
  });

  it('Love-Love Mellow: +4000 e compra 1 se tiver 3 ou menos cartas na mão', () => {
    for (const [extra, draws] of [
      [0, 1],
      [4, 0],
    ] as const) {
      let s = begin(4);
      const ps = s.players[0];
      ps.hand = [];
      const mellow = fetchToHand(s, 0, 'ST03-017');
      for (let i = 0; i < extra; i++) ps.hand.push(ps.deck.shift()!);
      ps.donActive = 2;
      s = attack(s, 1, s.players[1].leader.uid, ps.leader.uid);
      s = applyAction(s, { type: 'counter', player: 0, uid: mellow });
      s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
      if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
      expect(s.players[0].life).toHaveLength(5);
      expect(s.players[0].hand.length).toBe(extra + draws);
    }
  });

  it('o bot só devolve personagens do oponente com efeitos de "qualquer personagem"', () => {
    let s = begin(3);
    const mine = putOnField(s, 0, 'ST03-011'); // Buggy, custo 1
    const theirs = putOnField(s, 1, 'ST01-007'); // Nami, custo 1
    const teach = fetchToHand(s, 0, 'ST03-014');
    s.players[0].donActive = 4;
    s = applyAction(s, { type: 'playCard', player: 0, uid: teach });
    expect(s.pending?.kind === 'selectTargets' && s.pending.options.sort()).toEqual([mine, theirs].sort());
    expect(chooseBotAction(s, 0)).toEqual({ type: 'choose', player: 0, uids: [theirs] });
  });
});
