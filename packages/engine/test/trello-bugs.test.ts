import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

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
