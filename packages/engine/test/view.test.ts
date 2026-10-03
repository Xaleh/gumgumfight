import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction, createGame } from '../src/engine';
import type { Action, DeckList, GameState, PlayerId } from '../src/types';
import { type Aliases, actionFromView, createAliases, HIDDEN_CARD, viewFor, visibleCards } from '../src/view';
import { bigMom, cards, crocodile, kaido, kid, luffy, sakazuki, shanks, yamato } from './helpers';

let n = 0;
const randomId = () => `k${(++n * 7919).toString(36)}x`;

function game(seed: number, decks: [DeckList, DeckList]) {
  return createGame({
    seed: 0,
    seed128: [seed, seed * 31, seed * 977, 12345],
    cards,
    players: [
      { name: 'A', deck: decks[0] },
      { name: 'B', deck: decks[1] },
    ],
  });
}

const key = (a: Action | string) => JSON.stringify(a);

/** Confere a visão de `viewer`: nada do que ele não vê pode aparecer nela. */
function checkView(state: GameState, viewer: PlayerId, aliases: Aliases) {
  const view = viewFor(state, viewer, aliases);
  const vis = visibleCards(state, viewer);
  const json = JSON.stringify(view);
  for (const uid of Object.keys(state.cards)) {
    if (!vis.has(uid)) expect(json.includes(`"${aliases.toAlias[uid]}"`), `apelido de ${uid} vazou`).toBe(false);
  }
  // Nenhum uid real do motor ("c12") aparece na visão.
  expect(/"c\d+"/.test(json)).toBe(false);
  expect(view.seed).toBe(0);
  expect(view.rng).toBe(0);
  expect(view.rng128).toBeUndefined();
  // Definições: só as das cartas visíveis.
  const visibleIds = new Set([...vis].map((u) => state.cards[u].cardId));
  for (const id of Object.keys(view.defs)) if (id !== HIDDEN_CARD) expect(visibleIds.has(id)).toBe(true);
  // Mesmas quantidades em todas as zonas.
  for (const p of [0, 1] as const) {
    for (const z of ['hand', 'deck', 'life', 'trash'] as const) expect(view.players[p][z].length).toBe(state.players[p][z].length);
    expect(view.players[p].characters.length).toBe(state.players[p].characters.length);
  }
  // A mão do oponente nunca aparece.
  if (state.phase !== 'gameover') {
    const opp = state.players[viewer === 0 ? 1 : 0];
    for (const u of opp.hand) if (!vis.has(u)) expect(view.cards[view.players[opp.id].hand[opp.hand.indexOf(u)]].cardId).toBe(HIDDEN_CARD);
  }
  return view;
}

function playOut(seed: number, decks: [DeckList, DeckList]) {
  let s = game(seed, decks);
  const aliases = createAliases(s, randomId);
  let compared = 0;
  for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
    const p = actingPlayer(s)!;
    const view = checkView(s, p, aliases);
    checkView(s, p === 0 ? 1 : 0, aliases);
    // As ações legais calculadas na visão são as mesmas do estado completo.
    const fromView = legalActions(view, p).map((a) => actionFromView(s, aliases, a));
    expect(fromView.every((a) => typeof a !== 'string')).toBe(true);
    expect(new Set(fromView.map(key))).toEqual(new Set(legalActions(s, p).map(key)));
    compared++;
    s = applyAction(s, chooseBotAction(s, p));
  }
  expect(s.phase).toBe('gameover');
  return compared;
}

describe('visão do jogador (online)', () => {
  it('seed de 128 bits: mesma seed, mesma partida; seeds diferentes, embaralhamentos diferentes', () => {
    const a = game(1, [luffy, kid]);
    const b = game(1, [luffy, kid]);
    const c = game(2, [luffy, kid]);
    expect(a.players[0].deck).toEqual(b.players[0].deck);
    expect(a.players[0].deck).not.toEqual(c.players[0].deck);
    expect(a.rng128).toHaveLength(4);
  });

  const pairs: Array<[DeckList, DeckList]> = [
    [luffy, kid],
    [crocodile, kaido],
    [shanks, sakazuki],
    [bigMom, yamato],
  ];
  for (const decks of pairs) {
    it(`${decks[0].name} x ${decks[1].name}: nenhuma carta escondida vaza e as ações legais batem`, () => {
      for (let seed = 1; seed <= 6; seed++) expect(playOut(seed, decks)).toBeGreaterThan(10);
    }, 120_000);
  }

  it('apelidos de cartas fora de vista e posições inválidas são recusados', () => {
    const s = game(3, [luffy, kid]);
    const aliases = createAliases(s, randomId);
    const oppHand = s.players[1].hand[0];
    expect(typeof actionFromView(s, aliases, { type: 'playCard', player: 0, uid: aliases.toAlias[oppHand] })).toBe('string');
    expect(typeof actionFromView(s, aliases, { type: 'playCard', player: 0, uid: 'c3' })).toBe('string');
    expect(typeof actionFromView(s, aliases, { type: 'choose', player: 0, uids: ['~0:deck:99'] })).toBe('string');
    const mine = s.players[0].hand[0];
    expect(actionFromView(s, aliases, { type: 'playCard', player: 0, uid: aliases.toAlias[mine] })).toEqual({
      type: 'playCard',
      player: 0,
      uid: mine,
    });
    expect(actionFromView(s, aliases, { type: 'manual', player: 0, op: { op: 'move', uid: '~0:deck:0', to: 'hand' } })).toEqual({
      type: 'manual',
      player: 0,
      op: { op: 'move', uid: s.players[0].deck[0], to: 'hand' },
    });
  });

  it('linhas secretas do log: o dono vê a carta, o oponente não', () => {
    let s = game(4, [luffy, kid]);
    const aliases = createAliases(s, randomId);
    s = applyAction(s, { type: 'mulligan', player: s.activePlayer, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: s.activePlayer === 0 ? 1 : 0, redraw: false });
    const p = s.activePlayer;
    const uid = s.players[p].hand[0];
    const name = s.defs[s.cards[uid].cardId].name;
    s = applyAction(s, { type: 'manual', player: p, op: { op: 'move', uid, to: 'deckTop' } });
    const last = (v: GameState) => v.log[v.log.length - 1].text;
    expect(last(viewFor(s, p, aliases))).toContain(name);
    expect(last(viewFor(s, p === 0 ? 1 : 0, aliases))).not.toContain(name);
    expect(viewFor(s, p === 0 ? 1 : 0, aliases).log.every((e) => e.secret === undefined)).toBe(true);
  });
});
