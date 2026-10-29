import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { automationStatus, buildCardDef } from '../src/cards';
import { applyAction, createGame, getCost, getPower, hasKeyword } from '../src/engine';
import { fixCard } from '../src/errata';
import { translateCardPt } from '../src/i18n/render';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

// Cartas do OP18 que o leitor ainda não entendia (29/10/2026), com o texto das duas fontes de spoilers.
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/op18-automacao.json'), 'utf8')) as {
  cards: CardData[];
  optcgleaks: CardData[];
  support: CardData[];
};

// Vice-almirantes sintéticos para o Buster Call (OP18-117).
const vice = (id: string, name: string): CardData => ({ id, name, category: 'character', colors: ['black'], cost: 5, power: 6000, types: ['Navy', 'Vice Admiral'], text: '' });
const extra: CardData[] = [vice('SPX-101', 'Garp'), vice('SPX-102', 'Onigumo'), vice('SPX-103', 'Momonga'), vice('SPX-104', 'Garp'), vice('SPX-105', 'Doberman')];
const cards = [...baseCards, ...fixture.cards, ...fixture.support, ...extra];

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['ST01-001', 'ST02-001']): GameState {
  let s = createGame({
    seed: 7,
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
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
const fc = (s: GameState, player: PlayerId, uid: string) => s.players[player].characters.find((c) => c.uid === uid)!;

describe('OP18: cartas que faltavam automatizar', () => {
  it('todas ficam automáticas e com tradução completa, no texto das duas fontes', () => {
    // Como ficam no banco: com as correções de fonte (SOURCE_TEXT_FIXES) aplicadas.
    const all = [...fixture.cards, ...fixture.optcgleaks].map(fixCard);
    const pending = all.filter((c) => ['partial', 'manual'].includes(automationStatus(c)) || !translateCardPt(c).complete);
    expect(pending.map((c) => c.id)).toEqual([]);
  });

  it('Karoo (OP18-004): [Rush], [Banish] e [Unblockable] conforme o poder', () => {
    const s = toTurn(game(), 3);
    const karoo = field(s, 0, 'OP18-004');
    expect(['rush', 'banish', 'unblockable'].map((k) => hasKeyword(s, karoo, k as 'rush'))).toEqual([false, false, false]);
    fc(s, 0, karoo).don = 1;
    expect(getPower(s, karoo)).toBe(5000);
    expect(['rush', 'banish', 'unblockable'].map((k) => hasKeyword(s, karoo, k as 'rush'))).toEqual([true, false, false]);
    fc(s, 0, karoo).don = 3;
    expect(['rush', 'banish', 'unblockable'].map((k) => hasKeyword(s, karoo, k as 'rush'))).toEqual([true, true, true]);
  });

  it('Kung Fu Jugon (OP18-005): +1000 por Kung Fu Jugon seu, só no seu turno', () => {
    let s = toTurn(game(), 3);
    const a = field(s, 0, 'OP18-005');
    field(s, 0, 'OP18-005');
    field(s, 0, 'ST01-006');
    expect(getPower(s, a)).toBe(1000 + 2000);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(getPower(s, a)).toBe(1000);
  });

  it('Nami (OP18-030): −2000 virada no turno do oponente', () => {
    let s = toTurn(game(), 3);
    const nami = field(s, 0, 'OP18-030', true);
    expect(getPower(s, nami)).toBe(6000);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(getPower(s, nami)).toBe(4000);
    fc(s, 0, nami).rested = false;
    expect(getPower(s, nami)).toBe(6000);
  });

  it('Stansen (OP18-087): +2000 só se todos os seus Personagens tiverem custo 12 ou mais', () => {
    const s = toTurn(game(), 3);
    const stansen = field(s, 0, 'OP18-087');
    expect(getCost(s, stansen)).toBe(15);
    expect(getPower(s, stansen)).toBe(6000);
    field(s, 0, 'ST01-006');
    expect(getPower(s, stansen)).toBe(4000);
  });

  it('Zoro & Sogeking (OP18-027): Líder [Monkey.D.Luffy] ativo com 3 DON!! fica com 7000 de poder base no turno do oponente', () => {
    let s = toTurn(game(), 3);
    field(s, 0, 'OP18-027');
    s = applyAction(s, { type: 'endTurn', player: 0 });
    const leader = s.players[0].leader;
    leader.don = 3;
    expect(getPower(s, leader.uid)).toBe(7000);
    leader.rested = true;
    expect(getPower(s, leader.uid)).toBe(5000);
    leader.rested = false;
    leader.don = 2;
    expect(getPower(s, leader.uid)).toBe(5000);
  });

  it('Stop Fighting! (OP18-020): toda a Vida para a mão e −5000 no Líder e nos Personagens do oponente', () => {
    let s = toTurn(game(['ST01-001', 'OP04-001']), 3);
    const enemy = field(s, 0, 'ST01-006');
    const stop = hand(s, 1, 'OP18-020');
    const life = s.players[1].life.length;
    const handSize = s.players[1].hand.length;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 1 });
    s.players[1].donActive = 5;
    s = applyAction(s, { type: 'counter', player: 1, uid: stop });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.players[1].life).toHaveLength(0);
    expect(s.players[1].hand).toHaveLength(handSize - 1 + life);
    expect(getPower(s, s.players[0].leader.uid)).toBe(0);
    expect(getPower(s, enemy)).toBe(1000 - 5000);
  });

  it('Stop Fighting! (OP18-020): sem Vida, o custo não pode ser pago', () => {
    let s = toTurn(game(['ST01-001', 'OP04-001']), 3);
    const stop = hand(s, 1, 'OP18-020');
    s.players[1].deck.push(...s.players[1].life.splice(0));
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    s.players[1].donActive = 5;
    s = applyAction(s, { type: 'counter', player: 1, uid: stop });
    if (s.pending?.kind === 'confirm' && s.pending.player === 1) s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(getPower(s, s.players[0].leader.uid)).toBe(5000);
  });

  it('Van Augur (OP18-080): compra quando o Líder [Marshall D. Teach] descarta da mão', () => {
    let s = toTurn(game(['OP09-081', 'ST02-001']), 3);
    field(s, 0, 'OP18-080');
    hand(s, 0, 'ST01-006');
    const before = s.players[0].hand.length;
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 1 });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    // −1 descartada, +1 do Van Augur.
    expect(s.players[0].hand).toHaveLength(before);
    expect(s.log.some((l) => l.key === 'log.draws' || /compra/.test(l.text))).toBe(true);
  });

  it('Van Augur (OP18-080): com outro [Van Augur] não compra', () => {
    let s = toTurn(game(['OP09-081', 'ST02-001']), 3);
    field(s, 0, 'OP18-080');
    field(s, 0, 'OP18-080');
    hand(s, 0, 'ST01-006');
    const before = s.players[0].hand.length;
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 1 });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    expect(s.players[0].hand).toHaveLength(before - 1);
  });

  it('Spandam (OP18-105): o [Trigger] ativa o [Trigger] de uma carta "CP" da mão, que fica na mão', () => {
    let s = toTurn(game(['ST01-001', 'OP18-079']), 3);
    const enemy = field(s, 0, 'ST01-006');
    const kaku = hand(s, 1, 'OP18-099');
    const spandam = take(s, 1, 'OP18-105');
    s.players[1].life.push(spandam);
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 1 });
    s = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    expect((s.pending as { options: string[] }).options).toEqual([kaku]);
    const handSize = s.players[1].hand.length;
    s = applyAction(s, { type: 'choose', player: 1, uids: [kaku] });
    // [Trigger] do Kaku: compra 1 e põe 1 Personagem do oponente com custo 8 ou menos no fundo do deck.
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 1, uids: [enemy] });
    expect(s.players[1].hand).toContain(kaku);
    expect(s.players[1].hand).toHaveLength(handSize + 1);
    expect(s.players[0].characters.some((c) => c.uid === enemy)).toBe(false);
    expect(s.players[0].deck.at(-1)).toBe(enemy);
  });

  it('Buster Call (OP18-117): descarta a Vida, todos os Personagens e joga vice-almirantes de nomes diferentes do deck ou do descarte', () => {
    let s = toTurn(game(['OP18-079', 'ST02-001']), 3);
    const own = field(s, 0, 'ST01-006');
    const enemy = field(s, 1, 'ST01-006');
    const buster = hand(s, 0, 'OP18-117');
    const garp = take(s, 0, 'SPX-101');
    const garp2 = take(s, 0, 'SPX-104');
    const onigumo = take(s, 0, 'SPX-102');
    const momonga = take(s, 0, 'SPX-103');
    s.players[0].deck.push(garp, garp2, onigumo);
    s.players[0].trash.push(momonga);
    s.players[0].donActive = 10;
    const life = s.players[0].life.length;
    s = applyAction(s, { type: 'playCard', player: 0, uid: buster });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].life).toHaveLength(0);
    expect(s.players[0].trash).toEqual(expect.arrayContaining([own]));
    expect(s.players[1].trash).toEqual(expect.arrayContaining([enemy]));
    expect(s.players[0].trash.length).toBeGreaterThanOrEqual(life);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const options = (s.pending as { options: string[] }).options;
    expect(options).toEqual(expect.arrayContaining([garp, garp2, onigumo, momonga]));
    // Dois [Garp]: só o primeiro entra.
    s = applyAction(s, { type: 'choose', player: 0, uids: [garp, garp2, onigumo, momonga] });
    while (s.pending?.kind === 'confirm') s = applyAction(s, { type: 'answer', player: 0, yes: false });
    expect(s.players[0].characters.map((c) => c.uid).sort()).toEqual([garp, onigumo, momonga].sort());
    expect(s.log.some((l) => l.key === 'log.shuffles')).toBe(true);
  });

  it('Saint Killingham (OP18-064): DON!! −1 e dois Personagens que não podem atacar', () => {
    let s = toTurn(game(), 3);
    const big = field(s, 1, 'ST01-006');
    const small = field(s, 0, 'ST01-006');
    const saint = hand(s, 0, 'OP18-064');
    s.players[0].donActive = 6;
    s = applyAction(s, { type: 'playCard', player: 0, uid: saint });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    // DON!! −1: qual DON!! devolver (virado ou ativo).
    if (s.pending?.kind === 'option') s = applyAction(s, { type: 'option', player: 0, index: 0 });
    for (const uid of [big, small]) {
      expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
      s = applyAction(s, { type: 'choose', player: 0, uids: [uid] });
    }
    expect(s.modifiers.filter((m) => m.kind === 'cannotAttack').map((m) => m.uid).sort()).toEqual([big, small].sort());
  });
});
