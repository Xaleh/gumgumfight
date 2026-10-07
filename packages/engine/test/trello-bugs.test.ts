import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction, createGame, getPower } from '../src/engine';
import { createAliases, viewFor } from '../src/view';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, returnDonInOrder, toTurn } from './helpers';

// Bugs relatados no quadro do Trello, reproduzidos com as cartas reais da optcgapi.
const bugCards = (JSON.parse(readFileSync(join(__dirname, 'fixtures/bugs-op09-op17.json'), 'utf8')) as { cards: CardData[] }).cards;
const cards = [...baseCards, ...bugCards];

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
