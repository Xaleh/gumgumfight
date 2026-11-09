// "Look at N cards from the top of your deck and place them at the top or bottom of your deck in any order"
// (Streusen OP17-050, Doflamingo OP01-073): todas vão para o topo ou todas para o fundo (Q&A OP01-073;
// CR 1-3-7). Relato (11/2026): com a pergunta antiga ("escolha as que vão para o fundo") o jogador não
// conseguia mandar as cartas para o fundo e achou pouco intuitivo.

import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { parseCard } from '../src/cards/parser';
import { applyAction, createGame } from '../src/engine';
import { upgradeReplayActions } from '../src/replay';
import type { Action, CardData, DeckList, GameConfig, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Texto oficial em inglês (OP17 "The World's Strongest Warriors").
const streusen: CardData = {
  id: 'OP17-050',
  name: 'Streusen',
  category: 'character',
  colors: ['yellow'],
  cost: 1,
  power: 2000,
  counter: 1000,
  attributes: ['Special'],
  types: ['Rocks Pirates', 'Big Mom Pirates'],
  text: '[On Play] Look at 2 cards from the top of your deck, reorganize them in any order and place them at the top or bottom of your deck. Then, draw 1 card.',
};
const cards = [...baseCards, streusen];

const deck = (leader: string, filler = 'ST01-006'): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: filler, count: 50 }] });

function config(filler?: string): GameConfig {
  return {
    seed: 7,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck('ST01-001', filler) },
      { name: 'B', deck: deck('ST02-001') },
    ],
  };
}

function game(filler?: string): GameState {
  let s = createGame(config(filler));
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
/** Troca a carta do fundo do deck por `cardId` e a põe na mão (mutação direta, só para testes). */
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  s.players[player].hand.push(uid);
  return uid;
};
const setDon = (s: GameState, player: PlayerId, active: number) => {
  const ps = s.players[player];
  ps.donDeck = 10 - active;
  ps.donActive = active;
  ps.donRested = 0;
};

/** Turno 3 do jogador 0 com 5 DON!! e o Streusen na mão; devolve as 2 cartas do topo do deck. */
function ready() {
  const s = toTurn(game(), 3);
  setDon(s, 0, 5);
  const uid = hand(s, 0, 'OP17-050');
  const [first, second] = s.players[0].deck;
  return { s, uid, first, second };
}

describe('Streusen OP17-050: olhar 2 e colocar no topo ou no fundo', () => {
  it('o leitor entende o texto: olhar 2 (topo ou fundo, em qualquer ordem) e depois comprar 1', () => {
    const parsed = parseCard(streusen);
    const onPlay = parsed.abilities.find((a) => a.timing === 'onPlay');
    expect(onPlay?.steps[0]).toEqual({ do: 'arrangeTop', look: 2 });
    expect(onPlay?.steps.some((st) => st.do === 'draw')).toBe(true);
  });

  it('primeiro pergunta "topo ou fundo?" mostrando as 2 cartas; "fundo" leva as duas para o fundo na ordem escolhida', () => {
    let { s, uid, first, second } = ready();
    const handBefore = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.pending).toMatchObject({
      kind: 'option',
      player: 0,
      promptKey: 'engine.arrangeTopOrBottom',
      promptParams: { count: 2 },
      options: ['Topo do deck', 'Fundo do deck'],
      optionKeys: ['engine.optDeckTop', 'engine.optDeckBottom'],
      shown: [first, second],
    });
    // Olhou o deck: não dá mais para desfazer a jogada.
    expect(s.cancel?.blocked).toBe('revealed');
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, promptKey: 'engine.arrangeBottomOrder', ordered: true, min: 0, max: 2, options: [first, second] });
    // A última escolhida fica por baixo de tudo.
    s = applyAction(s, { type: 'choose', player: 0, uids: [second, first] });
    const d = s.players[0].deck;
    expect(d.slice(-2)).toEqual([second, first]);
    expect(d.slice(0, 2)).not.toContain(first);
    // Então compra 1 (a nova carta do topo), e o Streusen está em campo.
    expect(s.players[0].hand.length).toBe(handBefore); // −Streusen +1 compra
    expect(s.players[0].characters.map((c) => c.uid)).toContain(uid);
    expect(s.pending).toBeNull();
    expect(s.log.some((e) => e.key === 'log.placesAtBottom' && e.params?.n === 2)).toBe(true);
  });

  it('"topo" pede a ordem; a primeira escolhida fica por cima e é a carta comprada em seguida', () => {
    let { s, uid, first, second } = ready();
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', promptKey: 'engine.arrangeTopOrder', ordered: true, min: 0, max: 2 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [second] });
    // `second` foi para o topo (e foi comprada); `first` ficou logo abaixo e agora é o topo.
    expect(s.players[0].hand).toContain(second);
    expect(s.players[0].deck[0]).toBe(first);
    expect(s.pending).toBeNull();
  });

  it('"topo" sem escolher ordem ("Manter a ordem") deixa as cartas como estavam', () => {
    let { s, uid, first, second } = ready();
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.players[0].hand).toContain(first);
    expect(s.players[0].deck[0]).toBe(second);
  });

  it('com 1 carta no deck não pergunta a ordem', () => {
    let { s, uid } = ready();
    const ps = s.players[0];
    const only = ps.deck[0];
    ps.deck.splice(1);
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.pending).toMatchObject({ kind: 'option', shown: [only] });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    // Foi para o fundo (o deck só tem ela) e a compra em seguida a pega.
    expect(s.pending).toBeNull();
    expect(s.players[0].hand).toContain(only);
  });
});

describe('replays antigos (até a versão 13): "escolha as que vão para o fundo" vira "topo ou fundo?"', () => {
  /** Partida com o deck todo de Streusen: o da mão sai no turno 1 com o DON!! da fase de DON!!. */
  function opening() {
    const cfg = config('OP17-050');
    let s = createGame(cfg);
    const start: Action[] = [
      { type: 'mulligan', player: 0, redraw: false },
      { type: 'mulligan', player: 1, redraw: false },
    ];
    for (const a of start) s = applyAction(s, a);
    const uid = s.players[0].hand[0];
    const [first, second] = s.players[0].deck;
    return { cfg, start, uid, first, second };
  }

  it('todas as cartas escolhidas: responde "fundo" e a mesma escolha vale como a ordem', () => {
    const { cfg, start, uid, first, second } = opening();
    const old: Action[] = [...start, { type: 'playCard', player: 0, uid }, { type: 'choose', player: 0, uids: [second, first] }];
    const upgraded = upgradeReplayActions(cfg, old);
    expect(upgraded.slice(start.length)).toEqual([
      { type: 'playCard', player: 0, uid },
      { type: 'option', player: 0, index: 1 },
      { type: 'choose', player: 0, uids: [second, first] },
    ]);
    let s = createGame(cfg);
    for (const a of upgraded) s = applyAction(s, a);
    expect(s.players[0].deck.slice(-2)).toEqual([second, first]);
  });

  it('nenhuma escolhida: responde "topo", descarta a escolha vazia e a ordem gravada em seguida vale como hoje', () => {
    const { cfg, start, uid, first, second } = opening();
    const old: Action[] = [...start, { type: 'playCard', player: 0, uid }, { type: 'choose', player: 0, uids: [] }, { type: 'choose', player: 0, uids: [second, first] }];
    const upgraded = upgradeReplayActions(cfg, old);
    expect(upgraded.slice(start.length)).toEqual([
      { type: 'playCard', player: 0, uid },
      { type: 'option', player: 0, index: 0 },
      { type: 'choose', player: 0, uids: [second, first] },
    ]);
    let s = createGame(cfg);
    for (const a of upgraded) s = applyAction(s, a);
    // `second` ficou por cima e foi comprada; `first` é o topo.
    expect(s.players[0].hand).toContain(second);
    expect(s.players[0].deck[0]).toBe(first);
  });
});
