// "Add … to the top of the owner's Life cards face-up": a carta de Vida virada para cima é pública
// (3-10-2-1). O passo `fieldToLife` põe a carta em `lifeFaceUp`, e os efeitos que tiram cartas da
// Vida deixam de considerá-la virada para cima (docs/rules/divergencias.md, DV-18).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/cards/parser';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList, EffectStep, GameState, PlayerId } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards as baseCards, toTurn } from './helpers';

const load = (set: string): CardData[] => JSON.parse(readFileSync(join(__dirname, `../../../data/cards/${set}.json`), 'utf8')).cards;
const card = (set: string, id: string) => (set === 'base' ? baseCards : load(set)).find((c) => c.id === id)!;

const char = (id: string, text: string): CardData => ({ id, name: id, category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text });
const event = (id: string, text: string): CardData => ({ id, name: id, category: 'event', colors: ['red'], cost: 0, types: [], text });

const extra: CardData[] = [
  char('FU-001', "If this Character would be removed from the field by your opponent's effect, you may trash 1 card from your hand instead."),
  event('FU-E01', "[Main] Add up to 1 of your opponent's Characters with a cost of 3 or less to the top of the owner's Life cards face-up."),
  event('FU-E02', "[Main] Add up to 1 of your opponent's Characters with a cost of 3 or less to the top or bottom of the owner's Life cards face-up."),
  event('FU-E03', "[Main] Add up to 1 of your opponent's Characters with a cost of 3 or less to the top of the owner's Life cards."),
  event('FU-E04', "[Main] Trash up to 1 card from the top of your opponent's Life cards."),
  event('FU-E05', '[Main] Trash 1 card from the top of your Life cards.'),
];
const cards = [...baseCards, ...extra];
const deck: DeckList = {
  id: 'fu',
  name: 'fu',
  leader: 'ST07-001',
  cards: [{ id: 'ST01-006', count: 50 - extra.length - 2 }, { id: 'ST07-017', count: 1 }, { id: 'ST07-014', count: 1 }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
};

/** Turno 3 (do jogador 0). */
function game(): GameState {
  let s = createGame({
    seed: 5,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck },
      { name: 'B', deck },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  return toTurn(s, 3);
}
/** Troca a primeira carta da mão por `cardId` (mutação direta, só para testes). */
const give = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].hand[0];
  s.cards[uid] = { ...s.cards[uid], cardId };
  return uid;
};
/** Põe `cardId` no campo, tirada do deck (mutação direta, só para testes). */
const field = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.players[player].characters.push({ uid, rested: false, don: 0, playedOnTurn: 0 });
  return uid;
};
const play = (s: GameState, uid: string) => applyAction(s, { type: 'playCard', player: 0, uid });
const choose = (s: GameState, player: PlayerId, uids: string[]) => applyAction(s, { type: 'choose', player, uids });
let seq = 0;
const aliases = (s: GameState) => createAliases(s, () => `k${(++seq * 7919).toString(36)}x`);
const top = (s: GameState, player: PlayerId) => s.players[player].life[s.players[player].life.length - 1];
/** Põe o Personagem `target` do jogador 1 virado para cima no topo da Vida dele (FU-E01). */
const faceUpOnTop = (s: GameState, target: string) => choose(play(s, give(s, 0, 'FU-E01')), 0, [target]);

const stepsOf = (c: CardData) => {
  const out: EffectStep[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if ((x as EffectStep).do === 'fieldToLife') out.push(x as EffectStep);
      Object.values(x).forEach(walk);
    }
  };
  walk(parseCard(c));
  return out;
};

describe('fieldToLife "face-up" (DV-18)', () => {
  it('parser: as cartas da base com "face-up" levam faceUp; sem "face-up", não', () => {
    expect(stepsOf(card('st07', 'ST07-017'))).toEqual([expect.objectContaining({ faceUp: true })]);
    expect(stepsOf(card('st07', 'ST07-017'))[0]).not.toHaveProperty('choose');
    for (const [set, id] of [
      ['st09', 'ST09-015'],
      ['st28', 'OP06-103'],
      ['st36', 'P-085'],
    ]) {
      expect(stepsOf(card(set, id)), id).toEqual([expect.objectContaining({ choose: true, faceUp: true })]);
    }
    expect(stepsOf(extra.find((c) => c.id === 'FU-E03')!)[0]).not.toHaveProperty('faceUp');
  });

  it('ST07-017 Queen Mama Chanter: o Personagem vai virado para cima e o oponente o vê', () => {
    let s = game();
    const stage = s.players[0].deck.pop()!;
    s.cards[stage] = { ...s.cards[stage], cardId: 'ST07-017' };
    s.players[0].stage = { uid: stage, rested: false, don: 0, playedOnTurn: 0 };
    const pekoms = field(s, 0, 'ST07-014'); // custo 3
    const hidden = top(s, 0);
    s = applyAction(s, { type: 'activate', player: 0, uid: stage, ability: 0 });
    // Custo: topo ou fundo da Vida para a mão.
    for (let guard = 0; guard < 5 && s.pending && s.pending.kind !== 'selectTargets'; guard++) {
      s = s.pending.kind === 'confirm' ? applyAction(s, { type: 'answer', player: 0, yes: true }) : applyAction(s, { type: 'option', player: 0, index: 0 });
    }
    expect(s.players[0].hand).toContain(hidden);
    s = choose(s, 0, [pekoms]);
    expect(top(s, 0)).toBe(pekoms);
    expect(s.players[0].lifeFaceUp).toContain(pekoms);

    const al = aliases(s);
    for (const viewer of [1, null] as const) {
      const v = viewFor(s, viewer, al);
      const life = v.players[0].life;
      const shown = life[life.length - 1];
      expect(v.cards[shown].cardId).toBe('ST07-014');
      expect(v.players[0].lifeFaceUp).toEqual([shown]);
      // As outras cartas da Vida seguem escondidas.
      expect(life.slice(0, -1).every((u) => v.cards[u].cardId !== 'ST07-014' && !(v.players[0].lifeFaceUp ?? []).includes(u))).toBe(true);
    }
  });

  it('"top or bottom … face-up": no fundo da Vida, também virada para cima', () => {
    let s = game();
    const target = field(s, 1, 'ST01-006');
    s = choose(play(s, give(s, 0, 'FU-E02')), 0, [target]);
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    s = applyAction(s, { type: 'option', player: 0, index: 1 }); // fundo
    expect(s.players[1].life[0]).toBe(target);
    expect(s.players[1].lifeFaceUp).toEqual([target]);
    const v = viewFor(s, 0, aliases(s));
    expect(v.cards[v.players[1].life[0]].cardId).toBe('ST01-006');
  });

  it('sem "face-up", a carta vai virada para baixo e fica escondida', () => {
    let s = game();
    const target = field(s, 1, 'ST01-006');
    s = choose(play(s, give(s, 0, 'FU-E03')), 0, [target]);
    expect(top(s, 1)).toBe(target);
    expect(s.players[1].lifeFaceUp ?? []).not.toContain(target);
    const v = viewFor(s, 0, aliases(s));
    expect(v.cards[v.players[1].life[v.players[1].life.length - 1]].cardId).not.toBe('ST01-006');
  });

  it('substituição recusada: a carta vai para a Vida virada para cima', () => {
    let s = game();
    const target = field(s, 1, 'FU-001');
    s = faceUpOnTop(s, target);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1, source: target });
    s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(top(s, 1)).toBe(target);
    expect(s.players[1].lifeFaceUp).toEqual([target]);
  });

  it('a carta que sai da Vida deixa de estar virada para cima (trashLife, lifeToTrash)', () => {
    let s = game();
    const a = field(s, 1, 'ST01-006');
    s = faceUpOnTop(s, a);
    s = play(s, give(s, 0, 'FU-E04'));
    s = applyAction(s, { type: 'option', player: 0, index: 0 }); // "up to 1": descarta 1
    expect(s.players[1].trash).toContain(a);
    expect(s.players[1].lifeFaceUp).toEqual([]);

    // A própria Vida: o jogador 0 põe o Personagem dele virado para cima (ST07-017) e descarta.
    const own = field(s, 0, 'ST01-006');
    s.players[0].life.push(own);
    s.players[0].characters = s.players[0].characters.filter((c) => c.uid !== own);
    (s.players[0].lifeFaceUp ??= []).push(own);
    s = play(s, give(s, 0, 'FU-E05'));
    expect(s.players[0].trash).toContain(own);
    expect(s.players[0].lifeFaceUp).toEqual([]);
  });
});
