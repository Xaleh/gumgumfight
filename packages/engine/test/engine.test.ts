import { describe, expect, it } from 'vitest';
import { applyAction, getPower, IllegalActionError } from '../src/engine';
import { legalActions } from '../src/actions';
import { fetchToHand, newGame, putOnField, started, toTurn } from './helpers';

describe('preparação', () => {
  it('distribui 5 cartas, aguarda mulligan e depois coloca a Vida', () => {
    const s = newGame();
    expect(s.phase).toBe('mulligan');
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[1].hand).toHaveLength(5);
    expect(s.pending).toEqual({ kind: 'mulligan', player: 0 });

    const g = started();
    expect(g.phase).toBe('main');
    expect(g.turn).toBe(1);
    for (const p of g.players) {
      expect(p.life).toHaveLength(5);
      expect(p.deck.length).toBe(40);
    }
  });

  it('o mulligan troca a mão por 5 cartas novas', () => {
    let s = newGame(7);
    const before = [...s.players[0].hand];
    s = applyAction(s, { type: 'mulligan', player: 0, redraw: true });
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].hand).not.toEqual(before);
  });

  it('é determinístico para a mesma seed', () => {
    expect(started(42).players[0].hand).toEqual(started(42).players[0].hand);
  });
});

describe('fluxo de turno', () => {
  it('primeiro jogador não compra e recebe 1 DON!!; o segundo compra e recebe 2', () => {
    let s = started();
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].donActive).toBe(1);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.activePlayer).toBe(1);
    expect(s.players[1].hand).toHaveLength(6);
    expect(s.players[1].donActive).toBe(2);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.players[0].hand).toHaveLength(6);
    expect(s.players[0].donActive).toBe(3);
  });

  it('refresh devolve DON!! anexados e desvira tudo', () => {
    let s = toTurn(started(), 3);
    s = applyAction(s, { type: 'attachDon', player: 0, target: s.players[0].leader.uid });
    expect(s.players[0].leader.don).toBe(1);
    s = toTurn(s, 5);
    expect(s.players[0].leader.don).toBe(0);
    expect(s.players[0].donActive).toBe(5); // 1 + 2 + 2
  });

  it('ninguém ataca no primeiro turno', () => {
    let s = started();
    const atk = { type: 'attack' as const, player: 0 as const, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid };
    expect(() => applyAction(s, atk)).toThrow(IllegalActionError);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(() =>
      applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid }),
    ).toThrow(/primeiro turno/);
  });

  it('jogar personagem paga o custo virando DON!!', () => {
    let s = toTurn(started(), 3);
    const uid = fetchToHand(s, 0, 'ST01-013');
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.players[0].characters.map((c) => c.uid)).toContain(uid);
    expect(s.players[0].donActive).toBe(0);
    expect(s.players[0].donRested).toBe(3);
  });

  it('personagem sem [Rush] não ataca no turno em que entra; com [Rush] ataca', () => {
    let s = toTurn(started(), 5);
    const zoro = fetchToHand(s, 0, 'ST01-013');
    const luffy = fetchToHand(s, 0, 'ST01-012');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    s = applyAction(s, { type: 'endTurn', player: 1 });
    s = applyAction(s, { type: 'playCard', player: 0, uid: luffy });
    const opp = s.players[1].leader.uid;
    expect(legalActions(s, 0).some((a) => a.type === 'attack' && a.attacker === luffy && a.target === opp)).toBe(true);
    const zoro2 = fetchToHand(s, 0, 'ST01-013');
    s.players[0].donActive = 3;
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro2 });
    expect(() => applyAction(s, { type: 'attack', player: 0, attacker: zoro2, target: opp })).toThrow(/Rush/);
  });
});

describe('batalha', () => {
  function readyToAttack(seed = 1) {
    return toTurn(started(seed), 3);
  }

  it('ataque ao líder com poder igual causa 1 de dano', () => {
    let s = readyToAttack();
    s.players[1].hand = s.players[1].hand.filter(() => false); // sem Counters
    const lifeBefore = s.players[1].life.length;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    if (s.pending?.kind === 'trigger') s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(s.players[1].life.length).toBe(lifeBefore - 1);
    expect(s.players[1].hand.length).toBe(1);
    expect(s.players[0].leader.rested).toBe(true);
    expect(s.battle).toBeNull();
  });

  it('Counter de personagem impede o dano', () => {
    let s = readyToAttack();
    const counter = fetchToHand(s, 1, 'ST02-004'); // counter 1000
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending?.kind).toBe('counter');
    s = applyAction(s, { type: 'counter', player: 1, uid: counter });
    expect(getPower(s, s.players[1].leader.uid)).toBe(6000);
    s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.players[1].life).toHaveLength(5);
    expect(s.players[1].trash).toContain(counter);
    // Modificador de batalha expira.
    expect(getPower(s, s.players[1].leader.uid)).toBe(5000);
  });

  it('evento [Counter] paga custo e aplica +3000', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const repel = fetchToHand(s, 1, 'ST02-014');
    s.players[1].donActive = 1;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    s = applyAction(s, { type: 'counter', player: 1, uid: repel });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 1, uids: [s.players[1].leader.uid] });
    expect(s.pending).toBeNull(); // sem mais counters disponíveis, segue para o dano
    expect(s.players[1].life).toHaveLength(5);
    expect(s.players[1].donActive).toBe(0);
  });

  it('[Blocker] redireciona o ataque e o bloqueador é nocauteado', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const law = putOnField(s, 1, 'ST02-007');
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toEqual({ kind: 'block', player: 1, options: [law] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [law] });
    expect(s.players[1].characters).toHaveLength(0);
    expect(s.players[1].trash).toContain(law);
    expect(s.players[1].life).toHaveLength(5);
  });

  it('Usopp com DON!! x1 impede [Blocker] com 5000+ de poder', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const usopp = putOnField(s, 0, 'ST01-002');
    const chopperLike = putOnField(s, 1, 'ST02-009'); // Bepo 1000, pode bloquear
    s.modifiers.push({ uid: chopperLike, kind: 'power', amount: 4000, duration: 'turn' }); // agora 5000
    s = applyAction(s, { type: 'attachDon', player: 0, target: usopp });
    s = applyAction(s, { type: 'attack', player: 0, attacker: usopp, target: s.players[1].leader.uid });
    expect(s.pending?.kind).not.toBe('block');
  });

  it('[Trigger] da Vida pode ser ativado', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const gibson = fetchToHand(s, 1, 'ST02-013');
    s.players[1].hand = [];
    s.players[1].life.push(gibson); // topo da Vida
    const zoro = putOnField(s, 0, 'ST01-013', { rested: false });
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toEqual({ kind: 'trigger', player: 1, card: gibson });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 1, uids: [zoro] });
    expect(s.players[0].characters[0].rested).toBe(true);
    expect(s.players[1].trash).toContain(gibson);
  });

  it('dano com 0 de Vida encerra a partida', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    s.players[1].life = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
  });

  it('Double Attack causa 2 de dano', () => {
    let s = toTurn(started(), 4); // turno do Kid
    s.players[0].hand = [];
    const kidChar = putOnField(s, 1, 'ST02-012');
    s = applyAction(s, { type: 'attachDon', player: 1, target: kidChar });
    s.players[0].life = s.players[0].life.filter((u) => !s.defs[s.cards[u].cardId].abilities.some((a) => a.timing === 'trigger'));
    const before = s.players[0].life.length;
    s = applyAction(s, { type: 'attack', player: 1, attacker: kidChar, target: s.players[0].leader.uid });
    expect(s.players[0].life.length).toBe(before - 2);
  });

  it('Robin (When Attacking) nocauteia personagem com 2000 ou menos', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const robin = putOnField(s, 0, 'ST01-008');
    const apoo = putOnField(s, 1, 'ST02-006');
    s = applyAction(s, { type: 'attachDon', player: 0, target: robin });
    s = applyAction(s, { type: 'attack', player: 0, attacker: robin, target: s.players[1].leader.uid });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 0, uids: [apoo] });
    expect(s.players[1].trash).toContain(apoo);
  });
});

describe('efeitos', () => {
  it('Brook [On Play] dá 2 DON!! virados', () => {
    let s = toTurn(started(), 3);
    const brook = fetchToHand(s, 0, 'ST01-011');
    s = applyAction(s, { type: 'playCard', player: 0, uid: brook });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
    expect(s.players[0].leader.don).toBe(2);
    expect(s.players[0].donRested).toBe(0);
  });

  it('habilidade [Once Per Turn] do líder só pode ser usada uma vez', () => {
    let s = toTurn(started(), 3);
    const karoo = fetchToHand(s, 0, 'ST01-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: karoo });
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
    expect(() => applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 })).toThrow(
      /Já usada/,
    );
  });

  it('Kid ③ desvira o líder', () => {
    let s = toTurn(started(), 6);
    s.players[0].hand = [];
    const leader = s.players[1].leader.uid;
    s = applyAction(s, { type: 'attack', player: 1, attacker: leader, target: s.players[0].leader.uid });
    if (s.pending?.kind === 'trigger') s = applyAction(s, { type: 'answer', player: 0, yes: false });
    expect(s.players[1].leader.rested).toBe(true);
    s = applyAction(s, { type: 'activate', player: 1, uid: leader, ability: 0 });
    expect(s.players[1].leader.rested).toBe(false);
    expect(s.players[1].donRested).toBe(3);
  });

  it('com 5 personagens, jogar outro exige descartar um', () => {
    let s = toTurn(started(), 3);
    for (let i = 0; i < 5; i++) putOnField(s, 0, i < 4 ? 'ST01-002' : 'ST01-003');
    const nami = fetchToHand(s, 0, 'ST01-007');
    s = applyAction(s, { type: 'playCard', player: 0, uid: nami });
    expect(s.pending?.kind).toBe('selectTargets');
    const out = s.players[0].characters[0].uid;
    s = applyAction(s, { type: 'choose', player: 0, uids: [out] });
    expect(s.players[0].characters).toHaveLength(5);
    expect(s.players[0].trash).toContain(out);
  });
});
