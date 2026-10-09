import { describe, expect, it } from 'vitest';
import { applyAction, getPower, IllegalActionError, locate } from '../src/engine';
import { legalActions } from '../src/actions';
import { fetchToHand, newGame, noDefense, passCounter, putOnField, started, toTurn } from './helpers';

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
    // Sem Counter na mão a etapa abre mesmo assim (o atacante não pode saber que a mão está vazia).
    expect(s.pending).toEqual({ kind: 'counter', player: 1, options: [] });
    s = applyAction(s, { type: 'pass', player: 1 });
    // A carta da Vida sempre passa pelo dono, tenha [Trigger] ou não.
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(s.players[1].life.length).toBe(lifeBefore - 1);
    expect(s.players[1].hand.length).toBe(1);
    expect(s.players[0].leader.rested).toBe(true);
    expect(s.battle).toBeNull();
  });

  it('Counter de personagem impede o dano', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const counter = fetchToHand(s, 1, 'ST02-005'); // Killer, counter +1000
    fetchToHand(s, 1, 'ST02-011'); // um segundo Counter mantém a etapa aberta
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending?.kind).toBe('counter');
    s = applyAction(s, { type: 'counter', player: 1, uid: counter });
    expect(getPower(s, s.players[1].leader.uid)).toBe(6000);
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.players[1].life).toHaveLength(5);
    expect(s.players[1].trash).toContain(counter);
    // Modificador de batalha expira.
    expect(getPower(s, s.players[1].leader.uid)).toBe(5000);
  });

  it('na etapa de Counter, a ferramenta manual não joga a carta da mão no campo (Killer não ativa o [Ao Jogar])', () => {
    let s = readyToAttack();
    const usopp = putOnField(s, 0, 'ST01-002');
    s.players[1].hand = [];
    const killer = fetchToHand(s, 1, 'ST02-005');
    s = applyAction(s, { type: 'attack', player: 0, attacker: usopp, target: s.players[1].leader.uid });
    expect(s.pending?.kind).toBe('counter');
    for (const to of ['character', 'stage'] as const) {
      expect(() => applyAction(s, { type: 'manual', player: 1, op: { op: 'move', uid: killer, to } })).toThrow(IllegalActionError);
    }
    s = applyAction(s, { type: 'counter', player: 1, uid: killer });
    expect(s.players[1].trash).toContain(killer);
    expect(s.players[1].characters.map((c) => c.uid)).not.toContain(killer);
    expect(locate(s, usopp)).toBeTruthy();
  });

  it('evento [Counter] (Repel) paga o custo, dá +4000 e desvira 1 DON!!', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const repel = fetchToHand(s, 1, 'ST02-016');
    s.players[1].donActive = 2;
    s.players[1].donRested = 0;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    s = applyAction(s, { type: 'counter', player: 1, uid: repel });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 1, uids: [s.players[1].leader.uid] });
    expect(s.players[1].life).toHaveLength(5);
    expect(s.players[1].donActive).toBe(1); // pagou 2, desvirou 1
    expect(s.players[1].donRested).toBe(1);
  });
  it('[Blocker] redireciona o ataque e o bloqueador é nocauteado', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const bege = putOnField(s, 1, 'ST02-004'); // Capone"Gang"Bege: [Blocker] detectado no texto
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toEqual({ kind: 'block', player: 1, options: [bege] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [bege] });
    s = passCounter(s);
    expect(s.players[1].characters).toHaveLength(0);
    expect(s.players[1].trash).toContain(bege);
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

  it('[Trigger] da Vida pode ser ativado (Scalpel desvira 2 DON!!)', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const scalpel = fetchToHand(s, 1, 'ST02-015');
    s.players[1].hand = [];
    s.players[1].life.push(scalpel); // topo da Vida
    s.players[1].donActive = 0;
    s.players[1].donRested = 2;
    s = passCounter(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid }));
    expect(s.pending).toEqual({ kind: 'lifeCard', player: 1, card: scalpel });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.players[1].donActive).toBe(2);
    expect(s.players[1].trash).toContain(scalpel);
  });

  it('[Trigger] "Play this card" coloca o Personagem em campo (Killer)', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    const killer = fetchToHand(s, 1, 'ST02-005');
    s.players[1].hand = [];
    s.players[1].life.push(killer);
    s = passCounter(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid }));
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    // [On Play] do Killer: sem alvos virados, nada a escolher.
    expect(s.players[1].characters.map((c) => c.uid)).toContain(killer);
    expect(s.players[1].trash).not.toContain(killer);
  });
  it('dano com 0 de Vida encerra a partida', () => {
    let s = readyToAttack();
    s.players[1].hand = [];
    s.players[1].life = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    // A etapa de Counter ainda abre (o defensor poderia se salvar com um Counter).
    expect(s.pending).toMatchObject({ kind: 'counter', player: 1 });
    s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
  });

  it('Double Attack causa 2 de dano', () => {
    let s = toTurn(started(), 4); // turno do Kid
    s.players[0].hand = [];
    const heat = putOnField(s, 1, 'ST02-011');
    s.defs['ST02-011'] = { ...s.defs['ST02-011'], keywords: ['doubleAttack'] }; // nenhuma carta do ST01/02 tem
    s.modifiers.push({ uid: heat, kind: 'power', amount: 2000, duration: 'turn' }); // 4000 → 6000
    s.players[0].life = s.players[0].life.filter((u) => !s.defs[s.cards[u].cardId].abilities.some((a) => a.timing === 'trigger'));
    const before = s.players[0].life.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: heat, target: s.players[0].leader.uid }));
    expect(s.players[0].life.length).toBe(before - 2);
  });

  // CR 7-1-4-1-1-1 + Q&A de regras: "If my opponent has 1 Life card, can I win the game by using a
  // [Double Attack] to deal 2 damage? — No, you cannot."
  describe('Double Attack contra 1 de Vida', () => {
    function doubleAttacker(keywords: Array<'doubleAttack' | 'banish'> = ['doubleAttack']) {
      const s = toTurn(started(), 4); // turno do Kid
      s.players[0].hand = [];
      const heat = putOnField(s, 1, 'ST02-011');
      s.defs['ST02-011'] = { ...s.defs['ST02-011'], keywords };
      s.modifiers.push({ uid: heat, kind: 'power', amount: 2000, duration: 'turn' }); // 4000 → 6000
      const noTrigger = s.players[0].life.filter((u) => !s.defs[s.cards[u].cardId].abilities.some((a) => a.timing === 'trigger'));
      s.players[0].deck.push(...s.players[0].life.filter((u) => u !== noTrigger[0]));
      s.players[0].life = [noTrigger[0]];
      return { s, heat };
    }

    it('não vence: o 1º dano tira a última Vida e o 2º não faz nada', () => {
      const { s: g, heat } = doubleAttacker();
      const last = g.players[0].life[0];
      const s = noDefense(applyAction(g, { type: 'attack', player: 1, attacker: heat, target: g.players[0].leader.uid }));
      expect(s.phase).not.toBe('gameover');
      expect(s.winner).toBeNull();
      expect(s.players[0].life).toEqual([]);
      expect(s.players[0].hand).toContain(last);
      expect(s.stack).toEqual([]);
    });

    it('com [Banish] também não vence', () => {
      const { s: g, heat } = doubleAttacker(['doubleAttack', 'banish']);
      const last = g.players[0].life[0];
      const s = noDefense(applyAction(g, { type: 'attack', player: 1, attacker: heat, target: g.players[0].leader.uid }));
      expect(s.phase).not.toBe('gameover');
      expect(s.players[0].life).toEqual([]);
      expect(s.players[0].trash).toContain(last);
    });

    it('o ataque seguinte, com 0 de Vida, vence', () => {
      const { s: g, heat } = doubleAttacker();
      let s = noDefense(applyAction(g, { type: 'attack', player: 1, attacker: heat, target: g.players[0].leader.uid }));
      s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid }));
      expect(s.phase).toBe('gameover');
      expect(s.winner).toBe(1);
    });

    it('se a Vida volta entre os danos (ex.: [Trigger] que adiciona Vida), o 2º dano a tira', () => {
      const { s: g, heat } = doubleAttacker();
      let s = passCounter(applyAction(g, { type: 'attack', player: 1, attacker: heat, target: g.players[0].leader.uid }));
      expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 0 });
      const added = s.players[0].deck.shift()!; // simula o efeito do [Trigger] (Q&A OP03-118)
      s.players[0].life.push(added);
      s = noDefense(applyAction(s, { type: 'answer', player: 0, yes: false }));
      expect(s.phase).not.toBe('gameover');
      expect(s.players[0].life).toEqual([]);
      expect(s.players[0].hand).toContain(added);
    });
  });
  it('Killer [On Play] nocauteia personagem virado de custo 3 ou menos', () => {
    let s = toTurn(started(), 4);
    const chopper = putOnField(s, 0, 'ST01-006', { rested: true });
    const killer = fetchToHand(s, 1, 'ST02-005');
    s.players[1].donActive = 3;
    s = applyAction(s, { type: 'playCard', player: 1, uid: killer });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [chopper] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [chopper] });
    expect(s.players[0].trash).toContain(chopper);
  });
});

describe('efeitos', () => {
  it('Brook [On Play] dá 2 DON!! virados', () => {
    let s = toTurn(started(), 3);
    const brook = fetchToHand(s, 0, 'ST01-011');
    s = applyAction(s, { type: 'playCard', player: 0, uid: brook });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
    // "up to 2": quantos DON!! (2 ou 1).
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, options: ['2', '1'] });
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
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

  it('Kid: ③ + descartar 1 da mão desvira o líder', () => {
    let s = toTurn(started(), 6);
    s.players[0].hand = [];
    const leader = s.players[1].leader.uid;
    s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: leader, target: s.players[0].leader.uid }));
    expect(s.players[1].leader.rested).toBe(true);
    const handBefore = s.players[1].hand.length;
    s = applyAction(s, { type: 'activate', player: 1, uid: leader, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', intent: 'discard', min: 1, max: 1 });
    const discard = s.players[1].hand[0];
    s = applyAction(s, { type: 'choose', player: 1, uids: [discard] });
    expect(s.players[1].leader.rested).toBe(false);
    expect(s.players[1].donRested).toBe(3);
    expect(s.players[1].hand).toHaveLength(handBefore - 1);
    expect(s.players[1].trash).toContain(discard);
  });

  it('Kid não ativa sem carta na mão', () => {
    let s = toTurn(started(), 6);
    s.players[1].leader.rested = true;
    s.players[0].hand.push(...s.players[1].hand.splice(0)); // mantém a contagem total
    expect(() => applyAction(s, { type: 'activate', player: 1, uid: s.players[1].leader.uid, ability: 0 })).toThrow(/mão/);
  });

  it('Jewelry Bonney busca um {Supernovas} entre as 5 do topo e manda o resto para o fundo', () => {
    let s = toTurn(started(), 4);
    const bonney = putOnField(s, 1, 'ST02-007');
    const top5 = s.players[1].deck.slice(0, 5);
    s = applyAction(s, { type: 'activate', player: 1, uid: bonney, ability: 0 });
    const pend = s.pending;
    const supernovas = top5.filter((u) => s.defs[s.cards[u].cardId].types.includes('Supernovas'));
    // Todas as 5 aparecem (as que não são {Supernovas} ficam desabilitadas).
    expect(pend).toMatchObject({ kind: 'selectTargets', options: supernovas, shown: top5, max: Math.min(1, supernovas.length) });
    const picked = supernovas.slice(0, 1);
    s = applyAction(s, { type: 'choose', player: 1, uids: picked });
    // O jogador escolhe a ordem do fundo do deck (a primeira fica mais acima).
    const rest = top5.filter((u) => !picked.includes(u));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, ordered: true, min: rest.length });
    expect(s.pending?.kind === 'selectTargets' && [...s.pending.options].sort()).toEqual([...rest].sort());
    const order = [...rest].reverse();
    s = applyAction(s, { type: 'choose', player: 1, uids: order });
    expect(s.players[1].deck.slice(-rest.length)).toEqual(order);
    for (const u of picked) expect(s.players[1].hand).toContain(u);
    expect(locate(s, bonney)!.fc.rested).toBe(true);
  });

  it('busca sem nenhuma carta válida ainda mostra as cartas olhadas', () => {
    let s = toTurn(started(), 4);
    const bonney = putOnField(s, 1, 'ST02-007');
    // Nenhum {Supernovas} entre as 5 do topo.
    const deck = s.players[1].deck;
    const isSuper = (u: string) => s.defs[s.cards[u].cardId].types.includes('Supernovas');
    const others = deck.filter((u) => !isSuper(u));
    s.players[1].deck = [...others.slice(0, 5), ...deck.filter((u) => !others.slice(0, 5).includes(u))];
    const top5 = s.players[1].deck.slice(0, 5);
    s = applyAction(s, { type: 'activate', player: 1, uid: bonney, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [], shown: top5, max: 0 });
    s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', ordered: true, min: 5 });
    s = applyAction(s, { type: 'choose', player: 1, uids: top5 });
    expect(s.players[1].deck.slice(-5)).toEqual(top5);
  });

  it('Urouge ganha +2000 com DON!! x1 e 3 ou mais personagens', () => {
    const s = toTurn(started(), 4);
    const urouge = putOnField(s, 1, 'ST02-003');
    locate(s, urouge)!.fc.don = 1;
    expect(getPower(s, urouge)).toBe(3000 + 1000);
    putOnField(s, 1, 'ST02-011');
    putOnField(s, 1, 'ST02-012');
    expect(getPower(s, urouge)).toBe(3000 + 1000 + 2000);
  });

  it('X.Drake virado com DON!! dá +1000 aos {Supernovas}/{Navy} no seu turno', () => {
    const s = toTurn(started(), 4);
    const drake = putOnField(s, 1, 'ST02-014');
    const heat = putOnField(s, 1, 'ST02-011'); // {Kid Pirates}: não recebe
    const koby = putOnField(s, 1, 'ST02-006'); // {Navy}: recebe
    locate(s, drake)!.fc.don = 1;
    const leader = s.players[1].leader.uid; // Kid: {Supernovas}
    expect(getPower(s, koby)).toBe(6000);
    locate(s, drake)!.fc.rested = true;
    expect(getPower(s, koby)).toBe(7000);
    expect(getPower(s, leader)).toBe(6000);
    expect(getPower(s, heat)).toBe(4000);
    expect(getPower(s, drake)).toBe(5000 + 1000 + 1000); // DON!! + a própria aura
  });

  it('Basil Hawkins desvira depois de batalhar com um Personagem do oponente', () => {
    let s = toTurn(started(), 4);
    s.players[0].hand = [];
    const target = putOnField(s, 0, 'ST01-009', { rested: true });
    const hawkins = putOnField(s, 1, 'ST02-010');
    s = applyAction(s, { type: 'attachDon', player: 1, target: hawkins });
    s = applyAction(s, { type: 'attack', player: 1, attacker: hawkins, target });
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 0 });
    expect(s.players[0].trash).toContain(target);
    expect(locate(s, hawkins)!.fc.rested).toBe(false);
  });

  it('Kid (personagem) com DON!! x1 desvira no fim do turno', () => {
    let s = toTurn(started(), 4);
    s.players[0].hand = [];
    const kid = putOnField(s, 1, 'ST02-013');
    s = applyAction(s, { type: 'attachDon', player: 1, target: kid });
    s = applyAction(s, { type: 'attack', player: 1, attacker: kid, target: s.players[0].leader.uid });
    while (s.pending) {
      const p = s.pending;
      if (p.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: p.player, yes: false });
      else if (p.kind === 'counter') s = applyAction(s, { type: 'pass', player: p.player });
      else if (p.kind === 'block') s = applyAction(s, { type: 'choose', player: p.player, uids: [] });
      else break;
    }
    expect(locate(s, kid)!.fc.rested).toBe(true);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(locate(s, kid)!.fc.rested).toBe(false);
  });

  it('Law desvira um {Supernovas}/{Heart Pirates} virado de custo 5 ou menos', () => {
    let s = toTurn(started(), 4);
    const urouge = putOnField(s, 1, 'ST02-003', { rested: true }); // Supernovas
    putOnField(s, 1, 'ST02-011', { rested: true }); // Kid Pirates: não serve
    const law = fetchToHand(s, 1, 'ST02-009');
    s.players[1].donActive = 5;
    s = applyAction(s, { type: 'playCard', player: 1, uid: law });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [urouge] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [urouge] });
    expect(locate(s, urouge)!.fc.rested).toBe(false);
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
