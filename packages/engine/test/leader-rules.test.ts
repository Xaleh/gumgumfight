import { describe, expect, it } from 'vitest';
import { validateDeck } from '../src/deck';
import { applyAction, counterValue, createGame } from '../src/engine';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Líderes sintéticos com as regras especiais lidas do texto.
const leader = (id: string, text: string): CardData => ({
  id,
  name: id,
  category: 'leader',
  colors: ['red'],
  life: 5,
  power: 5000,
  types: [],
  text,
});
const extra: CardData[] = [
  leader('LR-001', 'Under the rules of this game, your DON!! deck consists of 6 cards.'),
  leader('LR-002', 'When your deck is reduced to 0, you win the game instead of losing, according to the rules.'),
  leader('LR-003', 'Your Character cards are played rested.'),
  leader('LR-004', 'All of your {Land of Wano} type Character cards without a Counter have a +1000 Counter, according to the rules.'),
  leader('LR-005', 'If you have any DON!! cards on your field, 1 DON!! card placed during your DON!! Phase is given to your Leader.'),
  leader('LR-006', 'Under the rules of this game, you cannot include cards with a cost of 5 or more in your deck.'),
  leader('LR-007', 'Your [On Play] effects are negated.'),
  leader('LR-008', '[Activate:Main][Once Per Turn]Give up to 2 total of your currently given DON!! cards to 1 of your Characters.'),
  leader('LR-009', "When a card is trashed from your hand by your {Navy} type card's effect, draw cards equal to the number of cards trashed."),
  leader('LR-010', '[Activate: Main] [Once Per Turn] You may trash 1 card from your hand or rest 1 of your DON!! cards: Draw 1 card.'),
  { id: 'LR-102', name: 'Drawer', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '[On Play] Draw 1 card.' },
  { id: 'LR-103', name: 'Marine', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Navy'], text: '[On Play] Trash 2 cards from your hand.' },
  { id: 'LR-101', name: 'Samurai', category: 'character', colors: ['red'], cost: 1, power: 2000, types: ['Land of Wano'], text: '' },
];
const cards = [...baseCards, ...extra];
const deck = (lead: string): DeckList => ({
  id: lead,
  name: lead,
  leader: lead,
  cards: [{ id: 'ST01-006', count: 42 }, { id: 'LR-101', count: 4 }, { id: 'LR-102', count: 2 }, { id: 'LR-103', count: 2 }],
});

function game(lead: string): GameState {
  let s = createGame({
    seed: 3,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck(lead) },
      { name: 'B', deck: deck('ST01-001') },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}

describe('regras especiais de Líder', () => {
  it('deck de DON!! com 6 cartas', () => {
    const s = game('LR-001');
    // Já começou o turno 1 do jogador A (1 DON!! saiu do deck).
    expect(s.players[0].donDeck).toBe(5);
    expect(s.players[1].donDeck).toBe(10);
  });

  it('vence quando o próprio deck chega a 0', () => {
    let s = toTurn(game('LR-002'), 2);
    s.players[0].deck = s.players[0].deck.slice(0, 1);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
  });

  it('Personagens entram virados', () => {
    let s = toTurn(game('LR-003'), 3);
    const uid = s.players[0].hand[0];
    s.cards[uid] = { ...s.cards[uid], cardId: 'LR-101' };
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.players[0].characters.find((c) => c.uid === uid)?.rested).toBe(true);
  });

  it('Counter de regra para o tipo do Líder', () => {
    const s = game('LR-004');
    const uid = s.players[0].hand[0];
    s.cards[uid] = { ...s.cards[uid], cardId: 'LR-101' };
    expect(counterValue(s, uid)).toBe(1000);
    const t = game('ST01-001');
    const u = t.players[0].hand[0];
    t.cards[u] = { ...t.cards[u], cardId: 'LR-101' };
    expect(counterValue(t, u)).toBe(0);
  });

  it('1 DON!! da Fase de DON!! vai para o Líder', () => {
    const s = toTurn(game('LR-005'), 3);
    // Turno 1: 1 DON!! (sem DON!! em campo antes). Turno 3: 2 novos, 1 deles no Líder.
    expect(s.players[0].leader.don).toBe(1);
    expect(s.players[0].donActive).toBe(2);
  });

  it('valida o custo máximo das cartas do deck', () => {
    const map = Object.fromEntries(cards.map((c) => [c.id, c]));
    const big = baseCards.find((c) => c.colors.includes('red') && c.category === 'character' && (c.cost ?? 0) >= 5)!;
    const d: DeckList = { id: 'x', name: 'x', leader: 'LR-006', cards: [{ id: 'ST01-006', count: 46 }, { id: big.id, count: 4 }] };
    const costIssue = (r: ReturnType<typeof validateDeck>) => r.issues.some((i) => /não permite/.test(i.message));
    expect(costIssue(validateDeck(d, map))).toBe(true);
    expect(costIssue(validateDeck(deck('LR-006'), map))).toBe(false);
  });

  const give = (s: GameState, cardId: string) => {
    const uid = s.players[0].hand[0];
    s.cards[uid] = { ...s.cards[uid], cardId };
    return uid;
  };

  it('[On Play] do próprio jogador anulado pelo Líder', () => {
    let s = toTurn(game('LR-007'), 3);
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: give(s, 'LR-102') });
    expect(s.players[0].hand).toHaveLength(hand - 1);
  });

  it('passa DON!! já anexados para um Personagem', () => {
    let s = toTurn(game('LR-008'), 3);
    const uid = s.players[0].deck.pop()!;
    s.cards[uid] = { ...s.cards[uid], cardId: 'LR-101' };
    s.players[0].characters.push({ uid, rested: false, don: 0, playedOnTurn: 0 });
    s.players[0].leader.don = 2;
    s.players[0].donActive -= 2;
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    if (s.pending?.kind === 'selectTargets' && s.pending.options.includes(uid)) s = applyAction(s, { type: 'choose', player: 0, uids: [uid] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
    expect(s.players[0].characters[0].don).toBe(2);
    expect(s.players[0].leader.don).toBe(0);
  });

  it('compra tantas cartas quanto as descartadas por efeito {Navy}', () => {
    let s = toTurn(game('LR-009'), 3);
    const marine = give(s, 'LR-103');
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: marine });
    const opts = s.pending?.kind === 'selectTargets' ? s.pending.options : [];
    s = applyAction(s, { type: 'choose', player: 0, uids: opts.slice(0, 2) });
    expect(s.players[0].hand).toHaveLength(hand - 1);
    expect(s.players[0].trash).toHaveLength(2);
  });

  it('custo com "ou": escolhe pagar virando 1 DON!!', () => {
    let s = toTurn(game('LR-010'), 3);
    const hand = s.players[0].hand.length;
    const don = s.players[0].donActive;
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    expect(s.players[0].donActive).toBe(don - 1);
    expect(s.players[0].hand).toHaveLength(hand + 1);
  });
});
