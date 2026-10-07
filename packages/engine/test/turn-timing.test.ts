// Momentos do turno (DV-28 a DV-30): "at the start of your turn" resolve no Refresh Phase, antes de
// devolver DON!!, desvirar e comprar (6-2-2); "at the end of this turn" resolve depois de todos os
// [End of …], inclusive os criados na própria End Phase (6-6-1-2); e os momentos "at the start of
// your opponent's turn", "at the start of your Main Phase" e [End of Your Opponent's Turn].

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef } from '../src/cards';
import { parseCard } from '../src/cards/parser';
import { applyAction } from '../src/engine';
import type { CardData, GameState, PlayerId } from '../src/types';
import { cards as baseCards, kid, luffy, started, toTurn } from './helpers';

const st24 = (JSON.parse(readFileSync(join(__dirname, '../../../data/cards/st24.json'), 'utf8')) as { cards: CardData[] }).cards;

// OP11-040 não está na base: Líder sintético com o texto oficial (Q&A OP11-040).
const extra: CardData[] = [
  {
    id: 'OP11-040',
    name: 'Monkey.D.Luffy',
    category: 'leader',
    colors: ['blue', 'purple'],
    life: 3,
    power: 6000,
    types: ['Straw Hat Crew'],
    text: 'This effect can be activated at the start of your turn. If you have 8 or more DON!! cards on your field, look at 5 cards from the top of your deck; reveal up to 1 {Straw Hat Crew} type card and add it to your hand. Then, place the rest at the top or bottom of the deck in any order.',
  },
  // [End of Your Turn] que cria um efeito "at the end of this turn".
  { id: 'TT-001', name: 'Late Drake', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: "[End of Your Turn] Set up to 1 of your DON!! cards as active at the end of this turn." },
  { id: 'TT-002', name: 'Watcher', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: "[End of Your Opponent's Turn] Draw 1 card." },
  { id: 'TT-003', name: 'Closer', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: '[End of Your Turn] Draw 1 card.' },
  { id: 'TT-004', name: 'Early Bird', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: "This effect can be activated at the start of your opponent's turn. Draw 1 card." },
  { id: 'TT-005', name: 'Riser', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: 'This effect can be activated at the start of your turn. Draw 1 card.' },
  { id: 'TT-006', name: 'Main Man', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: 'This effect can be activated at the start of your Main Phase. If you have 3 or more DON!! cards on your field, draw 1 card.' },
  { id: 'TT-007', name: 'Too Early', category: 'character', colors: ['green'], cost: 1, power: 1000, types: [], text: 'This effect can be activated at the start of your turn. If you have 3 or more DON!! cards on your field, draw 1 card.' },
];
const cards = [...baseCards, ...st24, ...extra];

function defOf(s: GameState, cardId: string) {
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
}
/** Troca a carta do fundo do deck por `cardId` (de qualquer coleção) e devolve o uid (só para testes). */
function take(s: GameState, player: PlayerId, cardId: string): string {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  defOf(s, cardId);
  return uid;
}
function onField(s: GameState, player: PlayerId, cardId: string, opts: { rested?: boolean; don?: number } = {}) {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested: Boolean(opts.rested), don: opts.don ?? 0, playedOnTurn: 0 });
  return uid;
}
function setLeader(s: GameState, player: PlayerId, cardId: string, don = 0) {
  const leader = s.players[player].leader;
  s.cards[leader.uid] = { ...s.cards[leader.uid], cardId };
  defOf(s, cardId);
  leader.don = don;
}
const endTurn = (s: GameState) => applyAction(s, { type: 'endTurn', player: s.activePlayer });
/** Índice da primeira linha do log (a partir de `from`) que casa com `re`. */
const logAt = (s: GameState, re: RegExp, from = 0) => s.log.findIndex((l, i) => i >= from && re.test(l.text));

describe('"at the start of your turn" resolve antes do resto do Refresh (DV-28, 6-2-2)', () => {
  /** Turno 2 (do jogador 1) com o Líder OP11-040 no jogador 0, `don` DON!! no campo dele e um Personagem virado. */
  function luffyLeader(don: number) {
    const s = toTurn(started(), 2);
    setLeader(s, 0, 'OP11-040', 2);
    const ps = s.players[0];
    const rested = onField(s, 0, 'ST01-002', { rested: true });
    // Total no campo: 2 dados ao Líder + virados na área de custo.
    ps.donDeck += ps.donActive + ps.donRested - (don - 2);
    ps.donActive = 0;
    ps.donRested = don - 2;
    // Topo do deck: um {Straw Hat Crew} conhecido (antes seria comprado antes de olhar as 5).
    const top = ps.deck.find((u) => s.cards[u].cardId === 'ST01-004')!;
    ps.deck.splice(ps.deck.indexOf(top), 1);
    ps.deck.unshift(top);
    return { s, rested, top };
  }

  it('OP11-040 Luffy com 8 DON!!: olha as 5 do topo antes de devolver DON!!, desvirar e comprar (Q&A OP11-040)', () => {
    const { s: s0, rested, top } = luffyLeader(8);
    const ps0 = s0.players[0];
    const top5 = ps0.deck.slice(0, 5);
    const hand = ps0.hand.length;
    const donDeck = ps0.donDeck;
    let s = endTurn(s0);
    expect(s.turn).toBe(3);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const p = s.pending as Extract<GameState['pending'], { kind: 'selectTargets' }>;
    // As opções são as 5 do topo de antes da compra (antes: a do topo já tinha sido comprada).
    expect(p.options).toContain(top);
    expect(p.options.every((u) => top5.includes(u))).toBe(true);
    // Ainda no começo do Refresh: DON!! dados no Líder, Personagem virado, sem compra e sem DON!! Phase.
    const ps = s.players[0];
    expect(ps.leader.don).toBe(2);
    expect(ps.characters.find((c) => c.uid === rested)!.rested).toBe(true);
    expect(ps.hand).toHaveLength(hand);
    expect(ps.donDeck).toBe(donDeck);
    expect(s.stack.map((f) => f.kind)).toContain('refresh');
    // O oponente não age enquanto isso.
    expect(() => applyAction(s, { type: 'endTurn', player: 1 })).toThrow();
    s = applyAction(s, { type: 'choose', player: 0, uids: [top] });
    for (let i = 0; i < 10 && s.pending; i++) s = applyAction(s, chooseBotAction(s, s.pending.player));
    expect(s.pending).toBeNull();
    // Agora sim: DON!! voltam e ficam ativos, tudo desvira, compra 1 e recebe 2 DON!!.
    const after = s.players[0];
    expect(after.hand).toContain(top);
    expect(after.hand).toHaveLength(hand + 2);
    expect(after.leader.don).toBe(0);
    expect(after.characters.find((c) => c.uid === rested)!.rested).toBe(false);
    expect(after.donActive).toBe(10);
    expect(after.donDeck).toBe(donDeck - 2);
    expect(s.stack).toHaveLength(0);
  });

  it('OP11-040 com 7 DON!!: ativa, mas nada acontece; o turno segue normalmente', () => {
    const { s: s0, top } = luffyLeader(7);
    const hand = s0.players[0].hand.length;
    const s = endTurn(s0);
    expect(s.pending).toBeNull();
    expect(s.players[0].hand).toEqual([...s0.players[0].hand, top]);
    expect(s.players[0].hand).toHaveLength(hand + 1);
    expect(s.players[0].leader.don).toBe(0);
  });

  it('o bot resolve a escolha do início do turno numa partida bot x bot', () => {
    const { s: s0 } = luffyLeader(8);
    let s = s0;
    for (let i = 0; i < 400 && s.phase !== 'gameover' && s.turn < 8; i++) {
      const player = s.pending ? s.pending.player : s.activePlayer;
      s = applyAction(s, chooseBotAction(s, player));
    }
    expect(s.turn).toBeGreaterThanOrEqual(8);
  });
});

describe('"at the end of this turn" depois dos [End of Your Turn], na mesma End Phase (DV-29, 6-6-1-2)', () => {
  it('X.Drake (ST24-005) ativa o DON!! só depois do [End of Your Turn] de Kid (ST02-013) (Q&A ST24-005)', () => {
    const s0 = toTurn(started(1, [kid, luffy]), 3);
    const ps = s0.players[0];
    const kidChar = onField(s0, 0, 'ST02-013', { rested: true, don: 1 });
    ps.donDeck -= 5 - ps.donActive;
    ps.donActive = 5;
    const drake = take(s0, 0, 'ST24-005');
    ps.hand.push(drake);
    let s = applyAction(s0, { type: 'playCard', player: 0, uid: drake });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.pending).toBeNull();
    expect(s.players[0].donRested).toBe(5);
    expect(s.delayed).toHaveLength(1);
    const from = s.log.length;
    s = endTurn(s);
    expect(s.turn).toBe(4);
    expect(s.players[0].characters.find((c) => c.uid === kidChar)!.rested).toBe(false);
    // 1 DON!! ativo durante o turno do oponente (para o Counter, por exemplo).
    expect(s.players[0].donActive).toBe(1);
    const kidAt = logAt(s, /Eustass"Captain"Kid/, from);
    const donAt = logAt(s, /1 DON!! de .* fica\(m\) ativo/, from);
    expect(kidAt).toBeGreaterThanOrEqual(0);
    expect(donAt).toBeGreaterThan(kidAt);
    expect(logAt(s, /— Turno 4/, from)).toBeGreaterThan(donAt);
  });

  it('o efeito adiado criado por um [End of Your Turn] resolve na mesma End Phase, não no fim do turno seguinte', () => {
    const s0 = toTurn(started(), 3);
    const ps = s0.players[0];
    onField(s0, 0, 'TT-001');
    ps.donRested += ps.donActive;
    ps.donActive = 0;
    const s = endTurn(s0);
    expect(s.turn).toBe(4);
    // Antes: o DON!! só ficava ativo no fim do turno 4 (do oponente).
    expect(s.players[0].donActive).toBe(1);
    expect(s.delayed ?? []).toHaveLength(0);
    expect(logAt(s, /DON!! de .* fica\(m\) ativo/)).toBeLessThan(logAt(s, /— Turno 4/));
  });
});

describe('momentos que faltavam (DV-30)', () => {
  it('o parser lê os três momentos novos', () => {
    const parse = (text: string) => parseCard({ category: 'character', text });
    expect(parse("[End of Your Opponent's Turn] Draw 1 card.")).toMatchObject({ abilities: [{ timing: 'endOfOpponentTurn' }], unparsed: [] });
    expect(parse("[DON!! x1] [End of Your Opponent's Turn] Set this Character as active.")).toMatchObject({
      abilities: [{ timing: 'endOfOpponentTurn', don: 1, steps: [{ do: 'setActive', target: 'self' }] }],
      unparsed: [],
    });
    expect(parse("This effect can be activated at the start of your opponent's turn. Draw 1 card.")).toMatchObject({
      abilities: [{ timing: 'startOfOpponentTurn', steps: [{ do: 'draw', count: 1 }] }],
      unparsed: [],
    });
    expect(parse("At the start of your opponent's turn, draw 1 card.")).toMatchObject({ abilities: [{ timing: 'startOfOpponentTurn' }], unparsed: [] });
    expect(parse('This effect can be activated at the start of your Main Phase. Draw 1 card.')).toMatchObject({
      abilities: [{ timing: 'startOfMainPhase', steps: [{ do: 'draw', count: 1 }] }],
      unparsed: [],
    });
    expect(parse('At the start of the Main Phase, draw 1 card.')).toMatchObject({ abilities: [{ timing: 'startOfMainPhase' }], unparsed: [] });
  });

  it('[End of Your Opponent\'s Turn] ativa no fim do turno do oponente, depois dos [End of Your Turn] do jogador do turno (6-6-1-1)', () => {
    const s0 = toTurn(started(), 3);
    onField(s0, 0, 'TT-003');
    onField(s0, 1, 'TT-002');
    const hands = s0.players.map((pl) => pl.hand.length);
    const from = s0.log.length;
    const s = endTurn(s0);
    expect(s.turn).toBe(4);
    expect(s.players[0].hand).toHaveLength(hands[0] + 1);
    // 1 do [End of Your Opponent's Turn] + 1 do Draw do turno 4.
    expect(s.players[1].hand).toHaveLength(hands[1] + 2);
    const closer = logAt(s, new RegExp(`^${s.players[0].name} compra`), from);
    const watcher = logAt(s, new RegExp(`^${s.players[1].name} compra`), from);
    expect(closer).toBeGreaterThanOrEqual(0);
    expect(watcher).toBeGreaterThan(closer);
    expect(logAt(s, /— Turno 4/, from)).toBeGreaterThan(watcher);
    // No fim do próprio turno, não ativa.
    const hand1 = s.players[1].hand.length;
    const s2 = endTurn(s);
    expect(s2.players[1].hand).toHaveLength(hand1);
  });

  it('"at the start of your opponent\'s turn" ativa no Refresh do oponente, depois do "at the start of your turn" dele (6-2-2)', () => {
    const s0 = toTurn(started(), 2);
    onField(s0, 0, 'TT-005');
    onField(s0, 1, 'TT-004');
    const hands = s0.players.map((pl) => pl.hand.length);
    const from = s0.log.length;
    const s = endTurn(s0);
    expect(s.turn).toBe(3);
    expect(s.players[0].hand).toHaveLength(hands[0] + 2); // efeito + Draw
    expect(s.players[1].hand).toHaveLength(hands[1] + 1);
    const turn = logAt(s, /— Turno 3/, from);
    const riser = logAt(s, new RegExp(`^${s.players[0].name} compra`), turn);
    const bird = logAt(s, new RegExp(`^${s.players[1].name} compra`), turn);
    expect(riser).toBeGreaterThan(turn);
    expect(bird).toBeGreaterThan(riser);
    // No início do próprio turno, não ativa.
    const s2 = endTurn(s);
    expect(s2.players[1].hand).toHaveLength(s.players[1].hand.length + 1); // só o Draw
  });

  it('"at the start of your Main Phase" vê os DON!! do DON!! Phase; "at the start of your turn" não (6-5-1)', () => {
    // Turno 3 do jogador 0: 1 DON!! (turno 1) antes do DON!! Phase, 3 depois.
    for (const [id, drew] of [
      ['TT-006', 1],
      ['TT-007', 0],
    ] as const) {
      const s0 = toTurn(started(), 2);
      onField(s0, 0, id);
      const hand = s0.players[0].hand.length;
      const s = endTurn(s0);
      expect(s.turn).toBe(3);
      expect(s.pending).toBeNull();
      expect(s.players[0].hand).toHaveLength(hand + 1 + drew);
    }
  });
});
