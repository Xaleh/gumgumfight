// "When your number of Life cards becomes 0" (OP05-098 Enel): a Vida chega a 0 quando a carta sai,
// e o efeito dispara depois dos [Trigger], mesmo que um deles devolva Vida (OP06-115 etc.).
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

const extra: CardData[] = [
  {
    id: 'LZ-L01',
    name: 'LZ-L01',
    category: 'leader',
    colors: ['yellow'],
    life: 5,
    power: 5000,
    types: [],
    text: "[Opponent's Turn] [Once Per Turn] When your number of Life cards becomes 0, add up to 1 card from the top of your deck to the top of your Life cards. Then, trash 1 card from your hand.",
  },
  // Como OP06-115 "You're the One Who Should Disappear.".
  { id: 'LZ-E01', name: 'LZ-E01', category: 'event', colors: ['yellow'], cost: 0, types: [], text: '', trigger: 'Add up to 1 card from the top of your deck to the top of your Life cards.' },
];
const cards = [...baseCards, ...extra];
const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 - extra.length + 1 }, { id: 'LZ-E01', count: 1 }] });

/** Turno 3 (do jogador 0): o Líder dele ataca o Enel do jogador 1, que tem só 1 Vida. */
function game(): GameState {
  let s = createGame({
    seed: 7,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck('ST01-001') },
      { name: 'B', deck: deck('LZ-L01') },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  s = toTurn(s, 3);
  const ps = s.players[1];
  ps.deck.unshift(...ps.life.splice(0));
  return s;
}
const lifeOf = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.players[player].life.push(uid);
  return uid;
};
function attack(s: GameState): GameState {
  s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
  for (let guard = 0; guard < 5 && s.pending?.kind !== 'lifeCard'; guard++) {
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    else if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
  }
  expect(s.pending?.kind).toBe('lifeCard');
  return s;
}
/** Responde o que for pedido ao jogador 1 (sim / primeira opção / primeiras cartas) até acabar. */
function settle(s: GameState): GameState {
  for (let guard = 0; guard < 20 && s.pending; guard++) {
    const p = s.pending;
    if (p.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: p.player, yes: s.cards[p.card].cardId === 'LZ-E01' });
    else if (p.kind === 'confirm') s = applyAction(s, { type: 'answer', player: p.player, yes: true });
    else if (p.kind === 'option') s = applyAction(s, { type: 'option', player: p.player, index: 0 });
    else if (p.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: p.player, uids: p.options.slice(0, Math.max(1, p.min)) });
    else break;
  }
  return s;
}

describe('"When your number of Life cards becomes 0" com [Trigger] que cura', () => {
  it('sem [Trigger]: o Enel volta a 1 Vida', () => {
    const s0 = game();
    lifeOf(s0, 1, 'ST01-006');
    const s = settle(attack(s0));
    expect(s.players[1].life).toHaveLength(1);
  });

  it('o [Trigger] cura primeiro e o efeito do Enel ainda ativa depois (fica com 2 Vidas)', () => {
    const s0 = game();
    lifeOf(s0, 1, 'LZ-E01');
    const s = settle(attack(s0));
    expect(s.pending).toBeNull();
    expect(s.players[1].life).toHaveLength(2);
    expect(s.log.filter((e) => e.text.includes('LZ-L01')).length).toBeGreaterThan(0);
  });
});
