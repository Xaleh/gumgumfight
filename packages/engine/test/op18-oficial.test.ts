// OP18 com o texto da carta impressa (lista oficial em inglês, 19/11/2026). As traduções de fã que
// o leitor já entendia (op18-automacao.test.ts) dizem o mesmo com outras palavras; aqui o texto é o
// que a optcgapi publica no lançamento.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { automationStatus, buildCardDef } from '../src/cards';
import { validateDeck } from '../src/deck';
import { applyAction, createGame, getCost, getPower, hasKeyword } from '../src/engine';
import { fixCard } from '../src/errata';
import { translateCardPt } from '../src/i18n/render';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/op18-oficial.json'), 'utf8')) as {
  cards: CardData[];
  optcgleaks: CardData[];
  starters: CardData[];
};
const support = (JSON.parse(readFileSync(join(__dirname, 'fixtures/op18-automacao.json'), 'utf8')) as { support: CardData[] }).support;
const teach = support.find((c) => c.id === 'OP09-081')!;

const char = (id: string, name: string, extra: Partial<CardData> = {}): CardData => ({ id, name, category: 'character', colors: ['black'], cost: 5, power: 6000, types: [], text: '', ...extra });
const extra: CardData[] = [
  teach,
  ...fixture.starters,
  // Vice-almirantes para o Buster Call (OP18-117).
  char('SPO-101', 'Garp', { types: ['Navy', 'Vice Admiral'] }),
  char('SPO-102', 'Onigumo', { types: ['Navy', 'Vice Admiral'] }),
  char('SPO-103', 'Momonga', { types: ['Navy', 'Vice Admiral'] }),
  char('SPO-104', 'Garp', { types: ['Navy', 'Vice Admiral'] }),
  // Para o Trebol (OP18-071): Líder [Sugar], um {Donquixote Pirates} e um Evento do oponente que remove.
  { id: 'SPO-L01', name: 'Sugar', category: 'leader', colors: ['purple'], life: 5, power: 5000, types: ['Donquixote Pirates'], text: '' },
  char('SPO-201', 'Buffalo', { cost: 2, power: 3000, types: ['Donquixote Pirates'] }),
  { id: 'SPO-E01', name: 'Remoção', category: 'event', colors: ['red'], cost: 0, types: [], text: "[Main] Return up to 1 of your opponent's Characters to the owner's hand." },
  char('SPO-301', 'Alabasta 1', { colors: ['red'], types: ['Alabasta'] }),
  char('SPO-302', 'Fora de Alabasta', { colors: ['red'], types: ['Navy'] }),
];
const cards = [...baseCards, ...fixture.cards.map(fixCard), ...extra];
const official = (id: string) => fixture.cards.find((c) => c.id === id)!;

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
const keywords = (s: GameState, uid: string) => (['rush', 'banish', 'unblockable', 'blocker'] as const).filter((k) => hasKeyword(s, uid, k));

describe('OP18 com o texto da carta impressa', () => {
  it('as 119 cartas ficam automáticas e com tradução completa, com "−" (lista oficial) e com "-" (optcgapi)', () => {
    expect(fixture.cards).toHaveLength(119);
    const hyphen = (c: CardData): CardData => ({ ...c, text: c.text.replace(/−/g, '-'), ...(c.trigger ? { trigger: c.trigger.replace(/−/g, '-') } : {}) });
    const all = [...fixture.cards, ...fixture.cards.map(hyphen)].map(fixCard);
    const pending = all.filter((c) => ['partial', 'manual'].includes(automationStatus(c)) || !translateCardPt(c).complete);
    expect(pending.map((c) => c.id)).toEqual([]);
    // O sinal de menos não muda a leitura.
    for (const c of fixture.cards) expect(buildCardDef(fixCard(hyphen(c))).abilities, c.id).toEqual(buildCardDef(fixCard(c)).abilities);
  });

  it('o texto do optcgleaks corrigido (SOURCE_TEXT_FIXES) é lido como o da carta impressa', () => {
    expect(fixture.optcgleaks.map((c) => c.id)).toEqual(['OP18-030', 'OP18-049', 'OP18-071', 'OP18-072', 'OP18-074']);
    for (const leaks of fixture.optcgleaks) {
      const fixed = fixCard(leaks);
      expect(automationStatus(fixed), leaks.id).toBe('auto');
      expect(translateCardPt(fixed).complete, leaks.id).toBe(true);
      expect(buildCardDef(fixed).abilities, leaks.id).toEqual(buildCardDef(fixCard(official(leaks.id))).abilities);
      // Aplicar de novo não muda nada.
      expect(fixCard(fixed)).toEqual(fixed);
    }
  });

  it('Karoo (OP18-004): [Rush], [Banish] e [Unblockable] conforme o poder', () => {
    const s = toTurn(game(), 3);
    const karoo = field(s, 0, 'OP18-004');
    expect(keywords(s, karoo)).toEqual([]);
    fc(s, 0, karoo).don = 1;
    expect(getPower(s, karoo)).toBe(5000);
    expect(keywords(s, karoo)).toEqual(['rush']);
    fc(s, 0, karoo).don = 2;
    expect(keywords(s, karoo)).toEqual(['rush', 'banish']);
    fc(s, 0, karoo).don = 3;
    expect(keywords(s, karoo)).toEqual(['rush', 'banish', 'unblockable']);
  });

  it('Kung Fu Jugon (OP18-005): +1000 por [Kung Fu Jugon] seu (ele incluído), só no seu turno', () => {
    let s = toTurn(game(), 3);
    const a = field(s, 0, 'OP18-005');
    expect(getPower(s, a)).toBe(1000);
    field(s, 0, 'OP18-005');
    field(s, 0, 'ST01-006');
    // O do oponente não conta ("自分の", os seus).
    field(s, 1, 'OP18-005');
    expect(getPower(s, a)).toBe(2000);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(getPower(s, a)).toBe(0);
  });

  it('Zoro & Sogeking (OP18-027): Líder [Monkey.D.Luffy] ativo com 3 ou mais DON!! fica com 7000 de poder base no turno do oponente', () => {
    let s = toTurn(game(), 3);
    field(s, 0, 'OP18-027');
    const leader = s.players[0].leader;
    leader.don = 3;
    // No seu turno não vale (os DON!! dados só contam +1000 cada no seu turno).
    expect(getPower(s, leader.uid)).toBe(5000 + 3000);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    const l = s.players[0].leader;
    l.don = 3;
    expect(getPower(s, l.uid)).toBe(7000);
    l.don = 4;
    expect(getPower(s, l.uid)).toBe(7000);
    l.rested = true;
    expect(getPower(s, l.uid)).toBe(5000);
    l.rested = false;
    l.don = 2;
    expect(getPower(s, l.uid)).toBe(5000);
  });

  it('Zoro & Sogeking (OP18-027): com outro Líder não vale', () => {
    let s = toTurn(game(['ST02-001', 'ST01-001']), 3);
    field(s, 0, 'OP18-027');
    s = applyAction(s, { type: 'endTurn', player: 0 });
    s.players[0].leader.don = 3;
    expect(getPower(s, s.players[0].leader.uid)).toBe(5000);
  });

  it('Mr.0 & Ms. All Sunday (OP18-046): descartando 1 carta, o Líder "Baroque Works" passa a 7000 de poder base no ataque do oponente', () => {
    let s = toTurn(game(['OP18-041', 'ST02-001']), 4);
    field(s, 0, 'OP18-046');
    const leader = s.players[0].leader.uid;
    expect(getPower(s, leader)).toBe(5000);
    const before = s.players[0].hand.length;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: leader });
    expect(s.pending).toMatchObject({ player: 0 });
    if (s.pending?.kind === 'confirm') s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    expect(s.players[0].hand).toHaveLength(before - 1);
    expect(getPower(s, leader)).toBe(7000);
  });

  it('Mr.0 & Ms. All Sunday (OP18-046): com Líder sem "Baroque Works" o poder base não muda', () => {
    let s = toTurn(game(['ST01-001', 'ST02-001']), 4);
    field(s, 0, 'OP18-046');
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: leader });
    if (s.pending?.kind === 'confirm' && s.pending.player === 0) s = applyAction(s, { type: 'answer', player: 0, yes: true });
    if (s.pending?.kind === 'selectTargets' && s.pending.player === 0) s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    expect(getPower(s, leader)).toBe(5000);
  });

  it('Trebol (OP18-071): com o Líder [Sugar], [Blocker] e +2000 no turno do oponente', () => {
    let s = toTurn(game(['SPO-L01', 'ST02-001']), 3);
    const trebol = field(s, 0, 'OP18-071');
    const base = official('OP18-071').power!;
    expect(getPower(s, trebol)).toBe(base);
    expect(keywords(s, trebol)).toEqual([]);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(getPower(s, trebol)).toBe(base + 2000);
    expect(keywords(s, trebol)).toEqual(['blocker']);
    // Sem o Líder [Sugar], nada.
    let other = toTurn(game(), 3);
    const t2 = field(other, 0, 'OP18-071');
    other = applyAction(other, { type: 'endTurn', player: 0 });
    expect(getPower(other, t2)).toBe(base);
    expect(keywords(other, t2)).toEqual([]);
  });

  it('Trebol (OP18-071): DON!! −1 no lugar da remoção de um {Donquixote Pirates} seu por efeito do oponente, uma vez por turno', () => {
    let s = toTurn(game(['SPO-L01', 'ST02-001']), 4);
    field(s, 0, 'OP18-071');
    const a = field(s, 0, 'SPO-201');
    const b = field(s, 0, 'SPO-201');
    const don = () => s.players[0].donActive + s.players[0].donRested;
    const before = don();
    const remove = (target: string) => {
      const ev = hand(s, 1, 'SPO-E01');
      s = applyAction(s, { type: 'playCard', player: 1, uid: ev });
      expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
      s = applyAction(s, { type: 'choose', player: 1, uids: [target] });
    };
    remove(a);
    // A troca é oferecida ao dono do Personagem.
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    if (s.pending?.kind === 'option') s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.players[0].characters.some((c) => c.uid === a)).toBe(true);
    expect(don()).toBe(before - 1);
    // [Once Per Turn]: a segunda remoção do turno acontece.
    remove(b);
    expect(s.pending).toBeNull();
    expect(s.players[0].characters.some((c) => c.uid === b)).toBe(false);
    expect(don()).toBe(before - 1);
  });

  it('Van Augur (OP18-080): compra quando o Líder [Marshall.D.Teach] descarta da mão, se não houver outro [Van Augur]', () => {
    const run = (augurs: number) => {
      let s = toTurn(game(['OP09-081', 'ST02-001']), 3);
      for (let i = 0; i < augurs; i++) field(s, 0, 'OP18-080');
      hand(s, 0, 'ST01-006');
      const before = s.players[0].hand.length;
      s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 1 });
      if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
      return s.players[0].hand.length - before;
    };
    // −1 descartada, +1 do Van Augur.
    expect(run(1)).toBe(0);
    expect(run(2)).toBe(-1);
    expect(run(0)).toBe(-1);
  });

  it('Stansen (OP18-087): +12 de custo e +2000 se você só tiver Personagens com custo 12 ou mais', () => {
    const s = toTurn(game(), 3);
    const stansen = field(s, 0, 'OP18-087');
    const base = official('OP18-087');
    expect(getCost(s, stansen)).toBe(base.cost! + 12);
    expect(getPower(s, stansen)).toBe(base.power! + 2000);
    field(s, 0, 'ST01-006');
    expect(getPower(s, stansen)).toBe(base.power!);
  });

  it('Spandam (OP18-105): o [Trigger] revela uma carta "CP" da mão e ativa o [Trigger] dela, que fica na mão', () => {
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
    // [Trigger] do Kaku (carta impressa: "up to 1 Character", de qualquer lado): compra 1 e põe 1 Personagem no fundo do deck.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    s = applyAction(s, { type: 'choose', player: 1, uids: [enemy] });
    expect(s.players[1].hand).toContain(kaku);
    expect(s.players[1].hand).toHaveLength(handSize + 1);
    expect(s.players[0].characters.some((c) => c.uid === enemy)).toBe(false);
    expect(s.players[0].deck.at(-1)).toBe(enemy);
  });

  it('Buster Call (OP18-117): descarta a Vida e todos os Personagens e joga até 5 {Vice Admiral} de nomes diferentes do deck ou do descarte', () => {
    let s = toTurn(game(['OP18-079', 'ST02-001']), 3);
    const own = field(s, 0, 'ST01-006');
    const enemy = field(s, 1, 'ST01-006');
    const buster = hand(s, 0, 'OP18-117');
    const garp = take(s, 0, 'SPO-101');
    const garp2 = take(s, 0, 'SPO-104');
    const onigumo = take(s, 0, 'SPO-102');
    const momonga = take(s, 0, 'SPO-103');
    s.players[0].deck.push(garp, garp2, onigumo);
    s.players[0].trash.push(momonga);
    s.players[0].donActive = 10;
    s = applyAction(s, { type: 'playCard', player: 0, uid: buster });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].life).toHaveLength(0);
    expect(s.players[0].trash).toEqual(expect.arrayContaining([own]));
    expect(s.players[1].trash).toEqual(expect.arrayContaining([enemy]));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect((s.pending as { options: string[] }).options).toEqual(expect.arrayContaining([garp, garp2, onigumo, momonga]));
    // Dois [Garp]: só o primeiro entra.
    s = applyAction(s, { type: 'choose', player: 0, uids: [garp, garp2, onigumo, momonga] });
    while (s.pending?.kind === 'confirm') s = applyAction(s, { type: 'answer', player: 0, yes: false });
    expect(s.players[0].characters.map((c) => c.uid).sort()).toEqual([garp, onigumo, momonga].sort());
    expect(s.log.some((l) => l.key === 'log.shuffles')).toBe(true);
  });
});

describe('Líderes dos starters ST37 e ST38 (spoilers)', () => {
  it('ficam automáticos e com tradução completa', () => {
    const pending = fixture.starters.map(fixCard).filter((c) => automationStatus(c) !== 'auto' || !translateCardPt(c).complete);
    expect(pending.map((c) => c.id)).toEqual([]);
  });

  it('Monkey.D.Luffy (ST37-001): a construção do deck só aceita cartas do tipo {Alabasta}', () => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const only = (id: string): DeckList => ({ id: 'l', name: 'Luffy', leader: 'ST37-001', cards: [{ id, count: 50 }] });
    const rule = (r: ReturnType<typeof validateDeck>) => r.issues.filter((i) => i.code === 'rules.leaderOnlyType');
    expect(rule(validateDeck(only('SPO-301'), byId))).toEqual([]);
    expect(rule(validateDeck(only('SPO-302'), byId))).toMatchObject([{ level: 'error', cardId: 'SPO-302', params: { type: 'Alabasta' } }]);
  });

  it('Monkey.D.Luffy (ST37-001): ao atacar compra 2 e, no fim do turno, descarta até ficar com 7 cartas na mão', () => {
    let s = toTurn(game(['ST37-001', 'ST02-001']), 3);
    while (s.players[0].hand.length < 8) hand(s, 0, 'ST01-006');
    const before = s.players[0].hand.length;
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.players[0].hand).toHaveLength(before + 2);
    while (s.pending && s.pending.player === 1) {
      if (s.pending.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
      else if (s.pending.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
      else if (s.pending.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: 1, yes: false });
      else break;
    }
    expect(s.pending).toBeNull();
    // Durante o turno a mão continua cheia.
    expect(s.players[0].hand).toHaveLength(before + 2);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    // O dono escolhe o que descartar.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const extraCards = before + 2 - 7;
    s = applyAction(s, { type: 'choose', player: 0, uids: s.players[0].hand.slice(0, extraCards) });
    expect(s.players[0].hand).toHaveLength(7);
    expect(s.activePlayer).toBe(1);
  });

  it('Monkey.D.Luffy (ST37-001): com 7 cartas ou menos na mão no fim do turno, não descarta nada', () => {
    let s = toTurn(game(['ST37-001', 'ST02-001']), 3);
    s.players[0].trash.push(...s.players[0].hand.splice(2));
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    while (s.pending && s.pending.player === 1) {
      if (s.pending.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
      else if (s.pending.kind === 'counter') s = applyAction(s, { type: 'pass', player: 1 });
      else if (s.pending.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: 1, yes: false });
      else break;
    }
    expect(s.players[0].hand).toHaveLength(4);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.pending).toBeNull();
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.activePlayer).toBe(1);
  });
});
