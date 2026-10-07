// Vazamento de informação (parte 2): perguntas "pagar X?" (custo que lê a mão), substituições
// com custo e escolhas na mão ou no deck abrem sempre para o dono, mesmo quando não há como
// pagar ou nada a escolher. Para o oponente e o espectador, "não podia" e "podia e recusou"
// são iguais, na decisão pendente e no log.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef } from '../src/cards';
import { applyAction } from '../src/engine';
import type { Action, CardData, GameState, PlayerId } from '../src/types';
import { createAliases, hiddenDecision, viewFor } from '../src/view';
import { cards as baseCards, fetchToHand, kaido, luffy, returnDonInOrder, started, toTurn } from './helpers';

const extra = ['st13', 'st22', 'st30', 'op01'].flatMap(
  (set) => (JSON.parse(readFileSync(join(__dirname, `../../../data/cards/${set}.json`), 'utf8')) as { cards: CardData[] }).cards,
);
const cards = [...baseCards, ...extra];

/** Apelidos determinísticos (os mesmos para dois estados com as mesmas cartas), para comparar visões. */
function aliasesFor(s: GameState) {
  let n = 0;
  return createAliases(s, () => `h${(++n * 7919).toString(36)}x`);
}

/** O que `viewer` vê da decisão pendente e do log a partir da linha `from`. */
function seenBy(s: GameState, viewer: PlayerId | null, from = 0) {
  const view = viewFor(s, viewer, aliasesFor(s));
  return { pending: view.pending, log: view.log.slice(from).map((e) => e.text) };
}

/** Os dois casos (a: não podia; b: podia e recusou) são iguais para o oponente e o espectador. */
function sameForOthers(a: GameState, b: GameState, from: [number, number], opponent: PlayerId) {
  for (const viewer of [opponent, null] as const) {
    const sa = seenBy(a, viewer, from[0]);
    const sb = seenBy(b, viewer, from[1]);
    expect(sb.pending).toEqual(sa.pending);
    expect(sb.log).toEqual(sa.log);
  }
}

/** Troca a carta do fundo do deck por `cardId` (de qualquer coleção) e devolve o uid (só para testes). */
function take(s: GameState, player: PlayerId, cardId: string): string {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
}
const toHand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
const giveDon = (s: GameState, player: PlayerId, count: number) => {
  const ps = s.players[player];
  ps.donDeck -= count - ps.donActive;
  ps.donActive = count;
};
const play = (s: GameState, player: PlayerId, uid: string) => applyAction(s, { type: 'playCard', player, uid });
const answer = (s: GameState, player: PlayerId, yes: boolean) => applyAction(s, { type: 'answer', player, yes });
const choose = (s: GameState, player: PlayerId, uids: string[]) => applyAction(s, { type: 'choose', player, uids });
const power = (s: GameState, uid: string) => s.defs[s.cards[uid].cardId].power ?? 0;

describe('"você pode pagar X" com custo que lê a mão', () => {
  // Jinbe (ST30-006): [On Play] You may trash 1 Character card with 6000 power from your hand: draw 2 cards.
  function jinbe(seed: number, withPayable: boolean) {
    const s = toTurn(started(seed), 3);
    giveDon(s, 0, 6);
    const ps = s.players[0];
    // Mão só com cartas que não servem para o custo (e uma com 6000 de poder no caso B).
    ps.deck.push(...ps.hand.filter((u) => power(s, u) === 6000));
    ps.hand = ps.hand.filter((u) => power(s, u) !== 6000);
    const uid = toHand(s, 0, 'ST30-006');
    const payable = withPayable ? toHand(s, 0, 'ST30-006') : null;
    const log = s.log.length;
    return { s: play(s, 0, uid), log, payable };
  }

  it('sem carta que sirva, a pergunta abre só com "não"; com carta, abre normal', () => {
    const a = jinbe(1, false);
    expect(a.s.pending).toMatchObject({ kind: 'confirm', player: 0, cannot: true });
    // A pergunta só leu a própria mão: além de "não", dá para cancelar a jogada.
    expect(legalActions(a.s, 0)).toEqual([
      { type: 'answer', player: 0, yes: false },
      { type: 'cancel', player: 0 },
    ]);
    expect(() => answer(a.s, 0, true)).toThrow(/pagar o custo/);
    const hand = a.s.players[0].hand.length;
    const t = answer(a.s, 0, false);
    expect(t.pending).toBeNull();
    expect(t.players[0].hand).toHaveLength(hand);

    const b = jinbe(1, true);
    expect(b.s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    expect(b.s.pending).not.toHaveProperty('cannot');
    expect(legalActions(b.s, 0)).toHaveLength(3);
  });

  it('para o oponente e o espectador, "não podia pagar" e "podia e recusou" são iguais', () => {
    const a = jinbe(2, false);
    const b = jinbe(2, true);
    sameForOthers(a.s, b.s, [a.log, b.log], 1);
    const ta = answer(a.s, 0, false);
    const tb = answer(b.s, 0, false);
    sameForOthers(ta, tb, [a.log, b.log], 1);
    // O oponente não vê o prompt nem o `cannot`; o dono vê os dois.
    const theirs = viewFor(a.s, 1, aliasesFor(a.s)).pending;
    expect(theirs).toEqual({ kind: 'confirm', player: 0, source: expect.any(String), prompt: '' });
    const mine = viewFor(a.s, 0, aliasesFor(a.s)).pending;
    expect(mine).toMatchObject({ kind: 'confirm', cannot: true });
    expect((mine as { prompt: string }).prompt).toContain('Não dá para pagar o custo');
  });

  it('com a mão vazia (público) o efeito continua sendo pulado sem perguntar', () => {
    const s = toTurn(started(3), 3);
    giveDon(s, 0, 6);
    const ps = s.players[0];
    ps.deck.push(...ps.hand);
    ps.hand = [];
    const uid = toHand(s, 0, 'ST30-006');
    const t = play(s, 0, uid);
    expect(t.pending).toBeNull();
    expect(t.stack).toHaveLength(0);
  });

  it('o bot recusa quando não dá para pagar e paga quando dá', () => {
    expect(chooseBotAction(jinbe(4, false).s, 0)).toEqual({ type: 'answer', player: 0, yes: false });
    expect(chooseBotAction(jinbe(4, true).s, 0)).toEqual({ type: 'answer', player: 0, yes: true });
  });
});

describe('substituição com custo que lê a mão', () => {
  // Marco (ST22-012): [Once Per Turn] If this Character would be K.O.'d by your opponent's effect, you may
  // trash 1 card from your hand instead. (Aqui o custo ganha um filtro, para depender do conteúdo da mão.)
  // Garp (ST06-012): [Activate: Main] You may trash 1 card from your hand and rest this Character: K.O. up
  // to 1 of your opponent's Characters with a cost of 4 or less.
  function koMarco(seed: number, withPayable: boolean) {
    const s = toTurn(started(seed), 4);
    expect(s.activePlayer).toBe(1);
    const marco = take(s, 0, 'ST22-012');
    s.players[0].characters.push({ uid: marco, rested: false, don: 0, playedOnTurn: 0 });
    const ability = s.defs['ST22-012'].abilities.find((a) => a.timing === 'replace')!;
    ability.cost = { ...ability.cost, trashFromHand: 1, trashFilter: { category: 'character', maxPower: 6000, minPower: 6000 } };
    const p0 = s.players[0];
    p0.deck.push(...p0.hand.filter((u) => power(s, u) === 6000));
    p0.hand = p0.hand.filter((u) => power(s, u) !== 6000);
    const payable = withPayable ? toHand(s, 0, 'ST30-006') : null;
    const garp = take(s, 1, 'ST06-012');
    s.players[1].characters.push({ uid: garp, rested: false, don: 0, playedOnTurn: 0 });
    const log = s.log.length;
    let t = applyAction(s, { type: 'activate', player: 1, uid: garp, ability: 0 });
    // Custo do Garp: descartar 1 carta da mão.
    expect(t.pending).toMatchObject({ kind: 'selectTargets', player: 1, intent: 'discard' });
    t = choose(t, 1, [(t.pending as { options: string[] }).options[0]]);
    expect(t.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    t = choose(t, 1, [marco]);
    return { s: t, marco, payable, log };
  }

  it('sem carta que sirva, a pergunta "pagar para evitar?" abre só com "não" e o nocaute acontece', () => {
    const a = koMarco(1, false);
    expect(a.s.pending).toMatchObject({ kind: 'confirm', player: 0, cannot: true });
    expect(legalActions(a.s, 0)).toEqual([{ type: 'answer', player: 0, yes: false }]);
    const t = answer(a.s, 0, false);
    expect(t.pending).toBeNull();
    expect(t.players[0].characters.map((c) => c.uid)).not.toContain(a.marco);
    expect(t.players[0].trash).toContain(a.marco);
  });

  it('com carta que sirva, a pergunta é a mesma para o oponente; pagando, Marco fica em campo', () => {
    const a = koMarco(2, false);
    const b = koMarco(2, true);
    expect(b.s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    expect(b.s.pending).not.toHaveProperty('cannot');
    sameForOthers(a.s, b.s, [a.log, b.log], 1);
    sameForOthers(answer(a.s, 0, false), answer(b.s, 0, false), [a.log, b.log], 1);
    let t = answer(b.s, 0, true);
    if (t.pending?.kind === 'selectTargets') t = choose(t, 0, [b.payable!]);
    expect(t.pending).toBeNull();
    expect(t.players[0].characters.map((c) => c.uid)).toContain(b.marco);
    expect(t.players[0].trash).toContain(b.payable);
  });
});

describe('escolhas que leem a mão abrem sempre', () => {
  // Ulti (ST04-002): [On Play] DON!! −1: Play up to 1 [Page One] card with a cost of 4 or less from your hand.
  function ulti(seed: number, withPageOne: boolean) {
    const s = toTurn(started(seed, [kaido, luffy]), 5);
    giveDon(s, 0, 6);
    const ps = s.players[0];
    ps.deck.push(...ps.hand.filter((u) => s.cards[u].cardId === 'ST04-012'));
    ps.hand = ps.hand.filter((u) => s.cards[u].cardId !== 'ST04-012');
    const uid = fetchToHand(s, 0, 'ST04-002');
    const pageOne = withPageOne ? fetchToHand(s, 0, 'ST04-012') : null;
    const log = s.log.length;
    let t = play(s, 0, uid);
    expect(t.pending).toMatchObject({ kind: 'confirm', player: 0 }); // DON!! −1 (custo público)
    t = returnDonInOrder(answer(t, 0, true)); // devolve um DON!! virado (há virados e ativos)
    return { s: t, pageOne, log };
  }

  it('sem [Page One] na mão a escolha abre vazia (só "nada" é legal); com, abre com a carta', () => {
    const a = ulti(1, false);
    expect(a.s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [], min: 0, max: 0, hidden: true });
    expect((a.s.pending as { prompt: string }).prompt).toMatch(/nenhuma carta da mão/);
    // Leu só a própria mão (e o DON!! −1 é público): a jogada ainda pode ser cancelada.
    expect(legalActions(a.s, 0)).toEqual([
      { type: 'choose', player: 0, uids: [] },
      { type: 'cancel', player: 0 },
    ]);
    const t = choose(a.s, 0, []);
    expect(t.pending).toBeNull();
    expect(t.players[0].characters).toHaveLength(1);

    const b = ulti(1, true);
    expect(b.s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [b.pageOne], max: 1, hidden: true });
  });

  it('para o oponente e o espectador os dois casos são iguais, antes e depois de "nada"', () => {
    const a = ulti(2, false);
    const b = ulti(2, true);
    sameForOthers(a.s, b.s, [a.log, b.log], 1);
    sameForOthers(choose(a.s, 0, []), choose(b.s, 0, []), [a.log, b.log], 1);
    expect(viewFor(a.s, 1, aliasesFor(a.s)).pending).toMatchObject({ kind: 'selectTargets', options: [], prompt: '', hidden: true });
  });

  it('o bot responde "nada" quando não há opção', () => {
    expect(chooseBotAction(ulti(3, false).s, 0)).toEqual({ type: 'choose', player: 0, uids: [] });
  });

  // Ivankov (ST13-005): [On Play] You may trash 1 card from the top or bottom of your Life cards: Add up to 1
  // Character card with a cost of 5 from your hand to the top of your Life cards.
  it('"adicione da mão à Vida" sem carta que sirva também abre vazia', () => {
    const s = toTurn(started(1), 3);
    giveDon(s, 0, 6);
    const ps = s.players[0];
    const cost5 = (u: string) => (s.defs[s.cards[u].cardId].cost ?? 0) === 5 && s.defs[s.cards[u].cardId].category === 'character';
    ps.deck.push(...ps.hand.filter(cost5));
    ps.hand = ps.hand.filter((u) => !cost5(u));
    const uid = toHand(s, 0, 'ST13-005');
    let t = play(s, 0, uid);
    for (let guard = 0; guard < 5 && t.pending && t.pending.kind !== 'selectTargets'; guard++) {
      const p = t.pending;
      t = p.kind === 'confirm' ? answer(t, 0, true) : p.kind === 'option' ? applyAction(t, { type: 'option', player: 0, index: 0 }) : t;
    }
    expect(t.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [], hidden: true });
    expect(legalActions(t, 0)).toEqual([{ type: 'choose', player: 0, uids: [] }]);
    expect(choose(t, 0, []).pending).toBeNull();
  });
});

describe('busca no deck abre sempre', () => {
  // Orochi (OP01-098): [On Play] Look at your deck and add up to 1 [Artificial Devil Fruit SMILE] to your hand.
  function orochi(seed: number, withSmile: boolean) {
    const s = toTurn(started(seed), 3);
    giveDon(s, 0, 6);
    const uid = toHand(s, 0, 'OP01-098');
    const smile = withSmile ? take(s, 0, 'OP01-116') : null;
    if (smile) s.players[0].deck.splice(10, 0, smile);
    const log = s.log.length;
    return { s: play(s, 0, uid), smile, log };
  }

  it('sem a carta no deck a escolha abre vazia; com, abre com a carta', () => {
    const a = orochi(1, false);
    expect(a.s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [], hidden: true });
    expect((a.s.pending as { prompt: string }).prompt).toMatch(/nenhuma carta do deck/);
    // Olhou o deck (soube que não há a carta): a jogada não pode mais ser cancelada.
    expect(legalActions(a.s, 0)).toEqual([{ type: 'choose', player: 0, uids: [] }]);
    expect(a.s.cancel).toMatchObject({ player: 0, blocked: 'revealed' });
    const b = orochi(1, true);
    expect(b.s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [b.smile], hidden: true });
    sameForOthers(a.s, b.s, [a.log, b.log], 1);
    sameForOthers(choose(a.s, 0, []), choose(b.s, 0, []), [a.log, b.log], 1);
  });
});

describe('decisões que escondem informação (tempo do bot)', () => {
  it('Counter, carta da Vida, "pagar X?" e escolhas na mão ou no deck contam; alvos na mesa não', () => {
    expect(hiddenDecision(null)).toBe(false);
    expect(hiddenDecision({ kind: 'counter', player: 0, options: [] })).toBe(true);
    expect(hiddenDecision({ kind: 'lifeCard', player: 0, card: 'c1' })).toBe(true);
    expect(hiddenDecision({ kind: 'confirm', player: 0, source: 'c1', prompt: '' })).toBe(true);
    const select = { kind: 'selectTargets' as const, player: 0 as const, options: [], min: 0, max: 0, prompt: '', intent: 'help' as const, source: 'c1' };
    expect(hiddenDecision(select)).toBe(false);
    expect(hiddenDecision({ ...select, hidden: true })).toBe(true);
    expect(hiddenDecision({ kind: 'block', player: 0, options: [] })).toBe(false);
  });

  it('uma partida inteira bot x bot passa pelas decisões escondidas sem travar', () => {
    let s = started(5);
    const kinds = new Set<string>();
    for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
      const p = s.pending;
      if (p && hiddenDecision(p)) kinds.add(p.kind);
      const player = p ? p.player : s.activePlayer;
      const a: Action = chooseBotAction(s, player);
      s = applyAction(s, a);
    }
    expect(s.phase).toBe('gameover');
    expect(kinds.has('counter')).toBe(true);
    expect(kinds.has('lifeCard')).toBe(true);
  });
});
