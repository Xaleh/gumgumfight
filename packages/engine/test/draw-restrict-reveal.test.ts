// Pequenas formas de efeito (DV-31 a DV-33): "draw up to X" compra uma por vez e pode parar (4-5-4);
// restrições a um jogador valem também para o oponente ("your opponent cannot …") e até o fim do
// próximo turno dele; a carta da mão posta na Vida por um efeito com exigência é revelada (11-2-1).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef } from '../src/cards';
import { parseCard } from '../src/cards/parser';
import { applyAction, createGame, playError, restricted } from '../src/engine';
import { upgradeReplayActions } from '../src/replay';
import type { Action, CardData, DeckList, GameConfig, GameState, PlayerId } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards as baseCards, luffy, noDefense, started, toTurn } from './helpers';

const load = (set: string) => (JSON.parse(readFileSync(join(__dirname, `../../../data/cards/${set}.json`), 'utf8')) as { cards: CardData[] }).cards;
const op02 = load('op02');
const st13 = load('st13');

const extra: CardData[] = [
  // P-097 Shanks (promo, fora da base): "Your opponent cannot activate [Blocker] during this turn."
  { id: 'DR-001', name: 'Shanks', category: 'character', colors: ['red'], cost: 1, power: 5000, types: [], text: '[On Play] Your opponent cannot activate [Blocker] during this turn.' },
  { id: 'DR-002', name: 'Jailer', category: 'character', colors: ['blue'], cost: 1, power: 2000, types: [], text: "[On Play] Your opponent cannot play Character cards until the end of your opponent's next turn." },
  { id: 'DR-003', name: 'Hider', category: 'character', colors: ['yellow'], cost: 1, power: 2000, types: [], text: '[On Play] Add up to 1 card from your hand to the top of your Life cards.' },
  { id: 'DR-004', name: 'Bon Clay', category: 'character', colors: ['yellow'], cost: 5, power: 6000, types: [], text: '' },
];
const cards = [...baseCards, ...op02, ...st13, ...extra];

let n = 0;
const aliases = (s: GameState) => createAliases(s, () => `a${++n}`);

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
function toHand(s: GameState, player: PlayerId, cardId: string): string {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
}
function setLeader(s: GameState, player: PlayerId, cardId: string) {
  const leader = s.players[player].leader;
  s.cards[leader.uid] = { ...s.cards[leader.uid], cardId };
  defOf(s, cardId);
}
const answer = (s: GameState, yes: boolean) => applyAction(s, { type: 'answer', player: s.pending!.player, yes });

/** Turno 3 (do jogador 0) com Magellan (Impel Down) de Líder; joga OP02-066 e paga descartando 2 cartas. */
function impelDown(): { s: GameState; hand: number } {
  let s = toTurn(started(), 3);
  setLeader(s, 0, 'OP02-071');
  const ev = toHand(s, 0, 'OP02-066');
  const hand = s.players[0].hand.length;
  s = applyAction(s, { type: 'playCard', player: 0, uid: ev });
  s = answer(s, true);
  expect(s.pending?.kind).toBe('selectTargets');
  const p = s.pending as Extract<GameState['pending'], { kind: 'selectTargets' }>;
  s = applyAction(s, { type: 'choose', player: 0, uids: p.options.slice(0, 2) });
  return { s, hand };
}

describe('"Draw up to X" compra uma por vez e pode parar (DV-31, 4-5-4)', () => {
  it('o leitor marca "draw up to" (OP02-066) e mantém "draw 2 cards" obrigatório', () => {
    const parsed = parseCard(op02.find((c) => c.id === 'OP02-066')!);
    expect(parsed.abilities[0].steps[1]).toMatchObject({ do: 'draw', count: 2, upTo: true });
    expect(parsed.abilities.find((a) => a.timing === 'trigger')!.steps[0]).toEqual({ do: 'draw', count: 2 });
  });

  it('OP02-066: o jogador compra 1, vê a carta e para', () => {
    let { s, hand } = impelDown();
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0, drawUpTo: true });
    const deck = s.players[0].deck.length;
    s = answer(s, true);
    expect(s.players[0].deck.length).toBe(deck - 1);
    expect(s.pending).toMatchObject({ kind: 'confirm', drawUpTo: true });
    s = answer(s, false);
    expect(s.pending).toBeNull();
    // −1 (o Evento) −2 (custo) +1.
    expect(s.players[0].hand.length).toBe(hand - 2);
  });

  it('pode não comprar nenhuma; o oponente vê só que há uma pergunta', () => {
    let { s } = impelDown();
    const a = aliases(s);
    const mine = viewFor(s, 0, a).pending as { prompt: string; drawUpTo?: true };
    const theirs = viewFor(s, 1, a).pending as { prompt: string; drawUpTo?: true };
    expect(mine.drawUpTo).toBe(true);
    expect(mine.prompt).toMatch(/comprar/);
    expect(theirs).toMatchObject({ kind: 'confirm', prompt: '' });
    expect(theirs.drawUpTo).toBeUndefined();
    const deck = s.players[0].deck.length;
    s = answer(s, false);
    expect(s.pending).toBeNull();
    expect(s.players[0].deck.length).toBe(deck);
  });

  it('o bot compra tudo com o deck folgado e para com o deck baixo', () => {
    let { s } = impelDown();
    expect(chooseBotAction(s, 0)).toEqual({ type: 'answer', player: 0, yes: true });
    s.players[0].deck.splice(3);
    expect(chooseBotAction(s, 0)).toEqual({ type: 'answer', player: 0, yes: false });
  });

  it('replays antigos (versão 9) compram as 2, como antes', () => {
    const impel: DeckList = { id: 'impel', name: 'Impel', leader: 'OP02-071', cards: [{ id: 'OP02-066', count: 50 }] };
    const config: GameConfig = { seed: 3, firstPlayer: 0, cards, players: [{ name: 'P0', deck: impel }, { name: 'P1', deck: luffy }] };
    let s = createGame(config);
    const old: Action[] = [];
    const step = (a: Action) => {
      old.push(a);
      s = applyAction(s, a);
    };
    step({ type: 'mulligan', player: 0, redraw: false });
    step({ type: 'mulligan', player: 1, redraw: false });
    while (s.turn < 3) step({ type: 'endTurn', player: s.activePlayer });
    const hand = s.players[0].hand.length;
    step({ type: 'playCard', player: 0, uid: s.players[0].hand[0] });
    step({ type: 'answer', player: 0, yes: true });
    old.push({ type: 'choose', player: 0, uids: s.players[0].hand.slice(0, 2) }, { type: 'endTurn', player: 0 });
    const modern = upgradeReplayActions(config, old);
    expect(modern.length).toBe(old.length + 2);
    s = createGame(config);
    for (const a of modern.slice(0, -1)) s = applyAction(s, a);
    expect(s.players[0].hand.length).toBe(hand - 1);
    expect(upgradeReplayActions(config, modern)).toEqual(modern);
  });
});

describe('Restrições ao oponente e até o fim do próximo turno dele (DV-32)', () => {
  it('o leitor lê "your opponent cannot …" e a duração', () => {
    const steps = (id: string) => parseCard(extra.find((c) => c.id === id)!).abilities[0].steps;
    expect(steps('DR-001')).toEqual([{ do: 'restrict', kind: 'noBlocker', opponent: true }]);
    expect(steps('DR-002')).toEqual([{ do: 'restrict', kind: 'noPlayCharacters', opponent: true, duration: 'nextOpponentTurn' }]);
  });

  it('P-097: o oponente não pode ativar [Blocker] neste turno; no seguinte, pode', () => {
    let s = toTurn(started(), 3);
    s.players[1].characters.push({ uid: take(s, 1, 'ST01-006'), rested: false, don: 0, playedOnTurn: 0 });
    s = applyAction(s, { type: 'playCard', player: 0, uid: toHand(s, 0, 'DR-001') });
    expect(restricted(s, 1, 'noBlocker')).toBeDefined();
    expect(restricted(s, 0, 'noBlocker')).toBeUndefined();
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    // Sem a etapa de bloqueio: direto para o Counter.
    expect(s.pending?.kind).toBe('counter');
    s = noDefense(s);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(restricted(s, 1, 'noBlocker')).toBeUndefined();
  });

  it('"until the end of your opponent\'s next turn": o oponente não joga Personagens no turno dele; depois, joga', () => {
    let s = toTurn(started(), 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: toHand(s, 0, 'DR-002') });
    // Quem jogou não fica restrito.
    expect(restricted(s, 0, 'noPlayCharacters')).toBeUndefined();
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.turn).toBe(4);
    const bege = toHand(s, 1, 'ST02-004');
    expect(playError(s, 1, bege)).toMatch(/não pode jogar/);
    s = toTurn(s, 6);
    expect(playError(s, 1, s.players[1].hand.includes(bege) ? bege : toHand(s, 1, 'ST02-004'))).toBeNull();
  });
});

describe('Mão → Vida com exigência revela a carta (DV-33, 11-2-1)', () => {
  it('Ivankov ST13-005: a carta de custo 5 aparece no log, também para o oponente', () => {
    let s = toTurn(started(), 5);
    const bon = toHand(s, 0, 'DR-004');
    s = applyAction(s, { type: 'playCard', player: 0, uid: toHand(s, 0, 'ST13-005') });
    s = answer(s, true);
    // Custo: topo ou fundo da Vida.
    if (s.pending?.kind === 'option') s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 0, uids: [bon] });
    expect(s.players[0].life.at(-1)).toBe(bon);
    const line = s.log.at(-1)!;
    expect(line.text).toMatch(/revela.*Bon Clay.*topo da Vida/);
    expect(line.secret).toBeUndefined();
    expect(viewFor(s, 1, aliases(s)).log.some((l) => /Bon Clay/.test(l.text))).toBe(true);
  });

  it('sem exigência (qualquer carta) a carta vai escondida', () => {
    let s = toTurn(started(), 3);
    const bon = toHand(s, 0, 'DR-004');
    s = applyAction(s, { type: 'playCard', player: 0, uid: toHand(s, 0, 'DR-003') });
    expect(s.pending?.kind).toBe('selectTargets');
    s = applyAction(s, { type: 'choose', player: 0, uids: [bon] });
    expect(s.players[0].life.at(-1)).toBe(bon);
    expect(s.log.at(-1)!.text).toMatch(/coloca 1 carta\(s\) da mão no topo da Vida/);
    expect(s.log.some((l) => /Bon Clay/.test(l.text))).toBe(false);
  });
});
