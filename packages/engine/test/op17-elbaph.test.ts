import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction, blockerOptions, createGame, getCost, hasKeyword } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Bugs relatados pelo grupo de testes (07/10/2026), com as cartas reais da optcgapi:
// Líder OP17-079 Luffy ("Characters with a cost of 12 or more gain [Blocker]") e os Elbaph com "+12 cost",
// Thousand Sunny ST14-017 e Pirates Docking Six OP15-088.
const fixture = (JSON.parse(readFileSync(join(__dirname, 'fixtures/op17-elbaph.json'), 'utf8')) as { cards: CardData[] }).cards;
const cards = [...baseCards, ...fixture];

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['OP17-079', 'ST02-001'], seed = 7): GameState {
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
/** Troca a carta do topo do deck por `cardId` (mutação direta, só para testes). */
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
const field = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested: false, don: 0, playedOnTurn: 0 });
  return uid;
};
const trash = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].trash.push(uid);
  return uid;
};
const setDon = (s: GameState, player: PlayerId, active: number) => {
  const ps = s.players[player];
  ps.donDeck = 10 - active;
  ps.donActive = active;
  ps.donRested = 0;
};

describe('OP17-079 Luffy: [Blocker] para Personagens com custo 12 ou mais', () => {
  it('Rodo (custo 1, +12 com Líder {Elbaph}) vale 13 e ganha [Blocker]', () => {
    const s = game();
    const rodo = field(s, 0, 'OP17-094');
    expect(getCost(s, rodo)).toBe(13);
    expect(hasKeyword(s, rodo, 'blocker')).toBe(true);
  });

  it('Saul (custo 4, +12 sem condição) e Gerd (custo 2, +12 com Líder {Elbaph}) também bloqueiam', () => {
    const s = game();
    const saul = field(s, 0, 'OP17-089');
    const gerd = field(s, 0, 'OP17-081');
    expect(getCost(s, saul)).toBe(16);
    expect(getCost(s, gerd)).toBe(14);
    expect(hasKeyword(s, saul, 'blocker')).toBe(true);
    expect(hasKeyword(s, gerd, 'blocker')).toBe(true);
  });

  it('sem o Líder {Elbaph}, o Rodo fica com custo 1 e sem [Blocker]; o Saul (+12 próprio) bloqueia mesmo assim', () => {
    const s = game(['ST02-001', 'OP17-079']);
    const rodo = field(s, 0, 'OP17-094');
    const saul = field(s, 0, 'OP17-089');
    expect(getCost(s, rodo)).toBe(1);
    expect(hasKeyword(s, rodo, 'blocker')).toBe(false);
    // O Líder do oponente não dá [Blocker] aos meus Personagens.
    expect(hasKeyword(s, saul, 'blocker')).toBe(false);
  });

  it('no ataque do oponente, o Rodo aparece como opção de Blocker', () => {
    // Turno 4: o segundo turno do oponente (no primeiro turno de cada um não há ataque).
    let s = toTurn(game(), 4);
    const rodo = field(s, 0, 'OP17-094');
    const sanji = field(s, 0, 'OP17-082'); // custo 2: não bloqueia
    expect(blockerOptions(s, 0)).toEqual([]);
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'block', player: 0, options: [rodo] });
    expect(s.pending && 'options' in s.pending ? s.pending.options : []).not.toContain(sanji);
    s = applyAction(s, { type: 'choose', player: 0, uids: [rodo] });
    expect(s.battle?.target).toBe(rodo);
  });
});

describe('ST14-017 Thousand Sunny com o Líder OP17-079 (tipos Straw Hat Crew / The Four Emperors / Elbaph)', () => {
  it('[On Play] compra 1 carta quando o Líder tem o tipo {Straw Hat Crew}', () => {
    let s = game();
    setDon(s, 0, 3);
    const sunny = hand(s, 0, 'ST14-017');
    const before = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: sunny });
    expect(s.pending).toBeNull();
    expect(s.players[0].stage?.uid).toBe(sunny);
    // Saiu da mão (−1) e comprou 1.
    expect(s.players[0].hand.length).toBe(before);
    expect(s.log.at(-1)?.text).toMatch(/compra 1/);
  });

  it('não compra se o Líder não tem o tipo', () => {
    let s = game(['ST02-001', 'OP17-079']);
    setDon(s, 0, 3);
    const sunny = hand(s, 0, 'ST14-017');
    const before = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: sunny });
    expect(s.players[0].hand.length).toBe(before - 1);
  });

  it('dá +1 custo aos Personagens pretos {Straw Hat Crew} (Sanji 2 → 3; Rodo não)', () => {
    let s = game();
    setDon(s, 0, 3);
    const sanji = field(s, 0, 'OP17-082');
    const rodo = field(s, 0, 'OP17-094');
    const sunny = hand(s, 0, 'ST14-017');
    s = applyAction(s, { type: 'playCard', player: 0, uid: sunny });
    expect(getCost(s, sanji)).toBe(3);
    expect(getCost(s, rodo)).toBe(13);
  });
});

describe('OP15-088 Pirates Docking Six: jogar do descarte 1 {Straw Hat Crew} com custo 2 ou menos', () => {
  it('oferece as cartas de custo 1 e 2 (não só custo 2) e espera a escolha do jogador', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 6);
    const chopper = trash(s, 0, 'OP17-084'); // custo 1
    const sanji = trash(s, 0, 'OP17-082'); // custo 2
    const luffy = trash(s, 0, 'OP17-093'); // custo 8: fora
    const rodo = trash(s, 0, 'OP17-094'); // custo 1, mas não é {Straw Hat Crew}
    const pd6 = hand(s, 0, 'OP15-088');
    s = applyAction(s, { type: 'playCard', player: 0, uid: pd6 });
    expect(getCost(s, pd6)).toBe(11);
    expect(s.pending?.kind).toBe('confirm');
    const deckBefore = s.players[0].deck.length;
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].deck.length).toBe(deckBefore - 3);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, min: 0, max: 1 });
    const options = s.pending && 'options' in s.pending ? s.pending.options : [];
    expect(options).toContain(chopper);
    expect(options).toContain(sanji);
    expect(options).not.toContain(luffy);
    expect(options).not.toContain(rodo);
    // Nada foi jogado sozinho; a escolha é do jogador.
    expect(s.players[0].characters.map((c) => c.uid)).toEqual([pd6]);
    s = applyAction(s, { type: 'choose', player: 0, uids: [chopper] });
    expect(s.players[0].characters.map((c) => c.uid)).toEqual([pd6, chopper]);
    expect(s.players[0].trash).toContain(sanji);
  });

  it('"Não escolher" deixa o descarte como está', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 6);
    const sanji = trash(s, 0, 'OP17-082');
    const pd6 = hand(s, 0, 'OP15-088');
    s = applyAction(s, { type: 'playCard', player: 0, uid: pd6 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.pending).toBeNull();
    expect(s.players[0].trash).toContain(sanji);
    expect(s.players[0].characters.map((c) => c.uid)).toEqual([pd6]);
  });
});
