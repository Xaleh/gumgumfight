import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { legalActions } from '../src/actions';
import { applyAction, cannotBeRested, costInHand, createGame, getPower } from '../src/engine';
import { createAliases, viewFor } from '../src/view';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, returnDonInOrder, toTurn } from './helpers';

// Bugs relatados no quadro do Trello, reproduzidos com as cartas reais da optcgapi.
const bugCards = (JSON.parse(readFileSync(join(__dirname, 'fixtures/bugs-op09-op17.json'), 'utf8')) as { cards: CardData[] }).cards;
const eb02Cards = (JSON.parse(readFileSync(join(__dirname, 'fixtures/bugs-eb02.json'), 'utf8')) as { cards: CardData[] }).cards;
const dataCards = (set: string) => (JSON.parse(readFileSync(join(__dirname, '../../../data/cards', `${set}.json`), 'utf8')) as { cards: CardData[] }).cards;
const st12Cards = dataCards('st12');
const st36Cards = dataCards('st36');
const op01Arlong = dataCards('op01').filter((c) => c.id === 'OP01-063');
const cards = [...baseCards, ...bugCards, ...st12Cards, ...st36Cards, ...op01Arlong, ...eb02Cards];

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['OP17-058', 'ST02-001'], seed = 7): GameState {
  let s = createGame({
    seed,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck(leaders[0]) },
      { name: 'B', deck: deck(leaders[1]) },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
/** Troca a carta do topo do deck por `cardId` e a põe na mão (mutação direta, só para testes). */
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
};
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
/** Põe `cardId` em campo (virada ou não), como se tivesse sido jogada num turno anterior. */
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
/** Deixa o jogador com exatamente `active` DON!! ativos e `rested` virados (o resto no deck de DON!!). */
const setDon = (s: GameState, player: PlayerId, active: number, rested = 0) => {
  const ps = s.players[player];
  ps.donDeck = 10 - active - rested;
  ps.donActive = active;
  ps.donRested = rested;
};

describe('Trello: custo "devolver 1 ou mais DON!!" (Zoro OP09-076)', () => {
  it('pergunta quantos DON!! devolver e paga a quantidade escolhida', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 5);
    const zoro = hand(s, 0, 'OP09-076');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    // Pagou 3 DON!! pelo Zoro: 2 ativos e 3 virados em campo. Então o [Ao Jogar] pergunta se paga o custo.
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    expect((s.pending as { options: string[] }).options).toEqual(['1 DON!!', '2 DON!!', '3 DON!!', '4 DON!!', '5 DON!!']);
    s = applyAction(s, { type: 'option', player: 0, index: 2 }); // 3 DON!!
    // Há DON!! virados e ativos: o jogador escolhe quais devolver.
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, don: ['rested', 'active'] });
    s = returnDonInOrder(s);
    // Devolveu 3 ao deck de DON!! (5 + 3 = 8) e o efeito pôs 1 ativo de volta (7 no deck).
    expect(s.pending).toBeNull();
    expect(s.players[0].donDeck).toBe(7);
    expect(s.players[0].donActive + s.players[0].donRested).toBe(3);
  });

  it('com só 1 DON!! em campo não pergunta: devolve 1 (Chopper OP09-068 no fim do turno)', () => {
    let s = toTurn(game(), 3);
    const chopper = field(s, 0, 'OP09-068', true);
    setDon(s, 0, 1);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toBeNull();
    expect(s.players[0].donDeck).toBe(10);
    expect(s.players[0].characters.find((c) => c.uid === chopper)?.rested).toBe(false);
  });

  it('recusar o custo não devolve DON!! nem ativa o efeito', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 5);
    const zoro = hand(s, 0, 'OP09-076');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    s = applyAction(s, { type: 'answer', player: 0, yes: false });
    expect(s.pending).toBeNull();
    expect(s.players[0].donDeck).toBe(5);
    expect(s.players[0].donActive).toBe(2);
    expect(s.players[0].donRested).toBe(3);
  });
});

/** O defensor não usa [Blocker] nem Counter. */
function noDefense(s: GameState): GameState {
  for (let guard = 0; guard < 10; guard++) {
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: s.pending.player, uids: [] });
    else if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: s.pending.player });
    else if (s.pending?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: s.pending.player, yes: false });
    else break;
  }
  return s;
}

describe('Trello: Kaido OP17-058 [On Your Opponent\'s Attack] [Once Per Turn] DON!! −1', () => {
  /** Turno 4 (do oponente, jogador 1) com dois Personagens prontos para atacar e Kaido com 3 DON!! em campo. */
  function opponentTurn() {
    const s = toTurn(game(), 4);
    setDon(s, 0, 3);
    setDon(s, 1, 4);
    const a = field(s, 1, 'ST01-003'); // dois Personagens quaisquer do ST01, já prontos para atacar
    const b = field(s, 1, 'ST01-004');
    return { s, a, b };
  }
  const attack = (s: GameState, attacker: string) =>
    applyAction(s, { type: 'attack', player: 1, attacker, target: s.players[0].leader.uid });

  it('recusar o custo no primeiro ataque não gasta o [Once Per Turn]: o segundo ataque pergunta de novo', () => {
    let { s, a, b } = opponentTurn();
    s = attack(s, a);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = noDefense(applyAction(s, { type: 'answer', player: 0, yes: false }));
    expect(s.battle).toBeNull();
    expect(s.players[0].donDeck).toBe(7);

    s = attack(s, b);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    // Pagou DON!! −1 e escolhe o alvo do −2000.
    expect(s.players[0].donDeck).toBe(8);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
  });

  it('depois de pagar uma vez, o ataque seguinte no mesmo turno não pergunta mais', () => {
    let { s, a, b } = opponentTurn();
    s = attack(s, a);
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = applyAction(s, { type: 'choose', player: 0, uids: [a] });
    s = noDefense(s);
    expect(s.battle).toBeNull();
    s = attack(s, b);
    expect(s.pending?.kind).not.toBe('confirm');
    s = noDefense(s);
    expect(s.players[0].donDeck).toBe(8);
  });
});

describe('Trello: o −2000 do Kaido OP17-058 vale até o fim do turno, não só na batalha', () => {
  it('[When Attacking] no próprio turno: o alvo fica com −2000 depois da batalha e volta no fim do turno', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 3);
    const victim = field(s, 1, 'ST01-004');
    const base = getPower(s, victim);
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victim] });
    expect(getPower(s, victim)).toBe(base - 2000);
    s = noDefense(s);
    expect(s.battle).toBeNull();
    expect(getPower(s, victim)).toBe(base - 2000); // ainda no turno
    // A visão do oponente (partida online) também mostra o poder reduzido.
    let n = 0;
    const aliases = createAliases(s, () => `k${n++}`);
    const v = viewFor(s, 1, aliases);
    expect(getPower(v, aliases.toAlias[victim])).toBe(base - 2000);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(getPower(s, victim)).toBe(base); // fim do turno: acabou
  });

  it("[On Your Opponent's Attack] no turno do oponente: o atacante fica com −2000 até o fim do turno dele", () => {
    let s = toTurn(game(), 4);
    setDon(s, 0, 3);
    setDon(s, 1, 4);
    const attacker = field(s, 1, 'ST01-004');
    const base = getPower(s, attacker);
    s = applyAction(s, { type: 'attack', player: 1, attacker, target: s.players[0].leader.uid });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = applyAction(s, { type: 'choose', player: 0, uids: [attacker] });
    s = noDefense(s);
    expect(s.battle).toBeNull();
    expect(getPower(s, attacker)).toBe(base - 2000);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(getPower(s, attacker)).toBe(base);
  });
});

describe('Trello: "Up to 1 of your [Shanks]" (OP17-036) também vale para o Líder Shanks', () => {
  /** Turno 4 (do oponente): o Líder Shanks OP17-020 é atacado, com o evento na mão e DON!! para pagá-lo. */
  function attacked(withShanksCharacter: boolean) {
    let s = toTurn(game(['OP17-020', 'ST02-001']), 4);
    setDon(s, 0, 3);
    setDon(s, 1, 4);
    const event = hand(s, 0, 'OP17-036');
    const shanks = withShanksCharacter ? field(s, 0, 'OP17-022') : null;
    const other = field(s, 0, 'ST01-004'); // Personagem com outro nome: não pode receber o bônus
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: leader });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 0 });
    expect((s.pending as { options: string[] }).options).toContain(event);
    s = applyAction(s, { type: 'counter', player: 0, uid: event });
    return { s, leader, shanks, other };
  }

  it('o [Counter] oferece o Líder e o Personagem [Shanks] (e não os outros Personagens)', () => {
    let { s, leader, shanks, other } = attacked(true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const options = (s.pending as { options: string[] }).options;
    expect(options).toContain(leader);
    expect(options).toContain(shanks);
    expect(options).not.toContain(other);
    s = applyAction(s, { type: 'choose', player: 0, uids: [leader] });
    expect(getPower(s, leader)).toBe(9000);
    expect(getPower(s, shanks!)).toBe(12000);
  });

  it('sem Personagem [Shanks], o Líder recebe os +4000 e o ataque de 5000 não tira Vida', () => {
    let { s, leader } = attacked(false);
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [leader] });
    expect(getPower(s, leader)).toBe(9000);
    s = noDefense(s);
    expect(s.battle).toBeNull();
    expect(s.players[0].life).toHaveLength(5);
    expect(getPower(s, leader)).toBe(5000); // o bônus era só durante a batalha
  });
});

describe('Trello: Mihawk ST12-003 joga um Personagem "Slash" (Arlong) da mão, virado', () => {
  /** Turno 3 do jogador 0 (Líder ST12-001), com `others` Personagens já em campo e Mihawk + 2 Arlong + Duval na mão. */
  function playMihawk(others: number) {
    let s = toTurn(game(['ST12-001', 'ST02-001']), 3);
    setDon(s, 0, 3);
    for (let i = 0; i < others; i++) field(s, 0, 'ST01-006');
    const mihawk = hand(s, 0, 'ST12-003');
    const arlongEb02 = hand(s, 0, 'EB02-011'); // verde, "Slash", custo 3
    const arlongOp01 = hand(s, 0, 'OP01-063'); // azul, "Slash", custo 4
    const duval = hand(s, 0, 'ST12-014'); // "Strike": não serve
    s = applyAction(s, { type: 'playCard', player: 0, uid: mihawk });
    return { s, mihawk, arlongEb02, arlongOp01, duval };
  }

  it('com 1 outro Personagem (2 contando o Mihawk), os dois Arlong são opções e o escolhido entra virado', () => {
    let { s, arlongEb02, arlongOp01, duval } = playMihawk(1);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, hidden: true, max: 1 });
    const options = (s.pending as { options: string[] }).options;
    expect(options).toContain(arlongEb02);
    expect(options).toContain(arlongOp01);
    expect(options).not.toContain(duval);
    s = applyAction(s, { type: 'choose', player: 0, uids: [arlongEb02] });
    expect(s.players[0].characters.find((c) => c.uid === arlongEb02)).toMatchObject({ rested: true });
    expect(s.players[0].hand).not.toContain(arlongEb02);
  });

  it('com 2 outros Personagens (3 contando o Mihawk, Q&A OP01-038 e EB02-022), o efeito não abre e o histórico diz o motivo', () => {
    const { s, arlongEb02 } = playMihawk(2);
    expect(s.pending).toBeNull();
    expect(s.players[0].characters).toHaveLength(3);
    expect(s.players[0].hand).toContain(arlongEb02);
    expect(s.log.map((l) => l.text)).toContain(
      'Dracule Mihawk: a condição não vale (A tem 3 Personagens, contando esta carta; precisa de 2 ou menos), o efeito não acontece.',
    );
  });
});

describe('Trello: [Blocker] vira ao bloquear; "cannot be rested" (Arlong EB02-011) impede bloquear e ser virado', () => {
  /** Turno 4 (do jogador 1), com Duval ativo no campo do jogador 0. */
  function defending() {
    const s = toTurn(game(['ST12-001', 'ST12-001']), 4);
    setDon(s, 1, 4);
    const duval = field(s, 0, 'ST12-014');
    return { s, duval };
  }
  const attackLeader = (s: GameState, attacker: PlayerId) =>
    applyAction(s, { type: 'attack', player: attacker, attacker: s.players[attacker].leader.uid, target: s.players[opponentOf(attacker)].leader.uid });
  const opponentOf = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

  it('Duval bloqueia o ataque, fica virado e passa a ser o alvo', () => {
    let { s, duval } = defending();
    s = attackLeader(s, 1);
    expect(s.pending).toMatchObject({ kind: 'block', player: 0, options: [duval] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [duval] });
    expect(s.players[0].characters.find((c) => c.uid === duval)).toMatchObject({ rested: true });
    expect(s.battle).toMatchObject({ target: duval, blocked: true });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 0 });
  });

  it('sob "cannot be rested", Duval não entra nas opções de Blocker (Q&A EB02-011), não ataca, e volta a bloquear quando o efeito acaba', () => {
    let { s, duval } = defending();
    const arlong = hand(s, 1, 'EB02-011');
    s = applyAction(s, { type: 'playCard', player: 1, uid: arlong });
    // O 1º passo (DON!! ao Líder) pede Líder {Fish-Man} ou {East Blue}: não vale, e o histórico explica; o 2º escolhe o alvo.
    expect(s.log.map((l) => l.text)).toContain('Arlong: a condição não vale (o Líder de B não tem o tipo {Fish-Man} nem {East Blue}), o efeito não acontece.');
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [duval] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [duval] });
    expect(cannotBeRested(s, duval)).toBe(true);

    s = attackLeader(s, 1);
    expect(s.pending).toMatchObject({ kind: 'counter', player: 0 }); // sem etapa de Blocker: Duval era o único
    expect(s.log.map((l) => l.text)).toContain('Duval não pode bloquear: não pode ser virada.');
    expect(s.players[0].characters.find((c) => c.uid === duval)).toMatchObject({ rested: false });
    s = noDefense(s);

    // Turno 5 (do jogador 0): o efeito dura até o fim deste turno; Duval não pode atacar.
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.turn).toBe(5);
    expect(legalActions(s, 0).some((a) => a.type === 'attack' && a.attacker === duval)).toBe(false);

    // Turno 6 (do jogador 1): o efeito acabou; Duval bloqueia de novo.
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(cannotBeRested(s, duval)).toBe(false);
    s = attackLeader(s, 1);
    expect(s.pending).toMatchObject({ kind: 'block', player: 0, options: [duval] });
  });

  it('um efeito que vira ("Rest up to 1…", Kuina ST12-002) não vira Duval sob "cannot be rested", e o histórico explica', () => {
    let { s, duval } = defending();
    const kuina = field(s, 1, 'ST12-002');
    const arlong = hand(s, 1, 'EB02-011');
    s = applyAction(s, { type: 'playCard', player: 1, uid: arlong });
    s = applyAction(s, { type: 'choose', player: 1, uids: [duval] });
    s = applyAction(s, { type: 'activate', player: 1, uid: kuina, ability: 0 });
    if (s.pending?.kind === 'selectTargets') {
      expect(s.pending.options).toContain(duval);
      s = applyAction(s, { type: 'choose', player: 1, uids: [duval] });
    }
    expect(s.players[0].characters.find((c) => c.uid === duval)).toMatchObject({ rested: false });
    expect(s.players[1].characters.find((c) => c.uid === kuina)).toMatchObject({ rested: true }); // o custo foi pago
    const log = s.log.map((l) => l.text);
    expect(log).toContain('Duval não pode ser virada (efeito "não vira" ativo).');
    expect(log).not.toContain('Duval é virado.');
  });
});

describe('Trello (replay): Mihawk ST12-003 + Arlong OP11-023 com "give this card in your hand −3 cost" (Q&A OP11-023)', () => {
  /** Turno 3 do jogador 0 com Líder Jinbe OP11-021 ({Fish-Man}); `holds` deixa a condição do Arlong valendo (≤ 3 Vidas, oponente com 5+ cartas viradas). */
  function playMihawk(holds: boolean) {
    let s = toTurn(game(['OP11-021', 'ST02-001']), 3);
    setDon(s, 0, 3);
    if (holds) {
      const ps = s.players[0];
      while (ps.life.length > 3) ps.deck.push(ps.life.pop()!);
      setDon(s, 1, 0, 5); // 5 DON!! virados do oponente
    }
    const mihawk = hand(s, 0, 'ST12-003');
    const arlong = hand(s, 0, 'OP11-023'); // custo impresso 7; na mão vale 4 quando a condição vale
    const before = costInHand(s, arlong);
    s = applyAction(s, { type: 'playCard', player: 0, uid: mihawk });
    return { s, arlong, before };
  }

  it('com a condição valendo, o Arlong custa 4 na mão e pode ser jogado pelo Mihawk', () => {
    let { s, arlong, before } = playMihawk(true);
    expect(before).toBe(4);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, hidden: true });
    expect((s.pending as { options: string[] }).options).toContain(arlong);
    s = applyAction(s, { type: 'choose', player: 0, uids: [arlong] });
    expect(s.players[0].characters.find((c) => c.uid === arlong)).toMatchObject({ rested: true });
  });

  it('sem a condição, o Arlong custa 7 e fica de fora', () => {
    const { s, arlong, before } = playMihawk(false);
    expect(before).toBe(7);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, hidden: true });
    expect((s.pending as { options: string[] }).options).not.toContain(arlong);
  });
});

describe('Trello (replay): Eustass Kid ST36-005 troca o alvo do ataque sem virar (não é [Blocker])', () => {
  it('o Kid vira o alvo, continua ativo, e o histórico diz que foi troca de alvo por efeito', () => {
    let s = game(['ST12-001', 'OP10-099']);
    // O Líder OP10-099 pergunta no fim do turno ("virar 1 Vida para cima?"): recusa até o turno 3.
    while (s.turn < 3) s = s.pending?.kind === 'confirm' ? applyAction(s, { type: 'answer', player: s.pending.player, yes: false }) : applyAction(s, { type: 'endTurn', player: s.activePlayer });
    setDon(s, 0, 3);
    const kid = field(s, 1, 'ST36-005');
    // O custo do Kid é virar 1 Vida para baixo: precisa de uma Vida virada para cima (no replay, o Líder OP10-099 vira no fim do turno).
    const life1 = s.players[1].life;
    s.players[1].lifeFaceUp = [life1[life1.length - 1]];
    const leader1 = s.players[1].leader.uid;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: leader1 });
    // [On Your Opponent's Attack]: "You may turn 1 Life face-down": pergunta, depois escolhe o novo alvo.
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [kid] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [kid] });
    expect(s.battle).toMatchObject({ target: kid, blocked: false });
    expect(s.players[1].characters.find((c) => c.uid === kid)).toMatchObject({ rested: false });
    expect(s.log.map((l) => l.text)).toContain(
      'Eustass"Captain"Kid: o ataque passa a mirar Eustass"Captain"Kid (troca de alvo por efeito, não é [Blocker]: a carta não vira).',
    );
    // Sem outro [Blocker], segue direto para o Counter.
    expect(s.pending).toMatchObject({ kind: 'counter', player: 1 });
  });
});
