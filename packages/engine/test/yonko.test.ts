// Mesa com mais de dois jogadores (o formato Yonko, "Four Emperors": todos contra todos). O motor segue o
// manual do formato, resumido em docs/regras-yonko.md; os blocos abaixo acompanham as seções dele.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { isColorCompatible, validateYonkoDeck, yonkoDeckFrom } from '../src/deck';
import {
  applyAction,
  attackError,
  createGame,
  eachOpponent,
  getCost,
  getPower,
  hasKeyword,
  IllegalActionError,
  isIdle,
  locate,
  opponentsOf,
  YONKO_DECK_SIZE,
  YONKO_TABLE,
} from '../src/engine';
import type { CardData, DeckList, EffectStep, GameState, PlayerId, TableRules } from '../src/types';
import { cardStatuses } from '../src/status';
import { HIDDEN_REF, identityAliases, viewFor } from '../src/view';
import { countCards, countDon, crocodile, fetchToHand, kaido, kid, luffy, putOnField } from './helpers';

const DATA = join(__dirname, '../../../data/cards');
const base = new Map<string, CardData>();
for (const f of readdirSync(DATA).filter((n) => n.endsWith('.json')).sort()) {
  for (const c of (JSON.parse(readFileSync(join(DATA, f), 'utf8')).cards ?? []) as CardData[]) base.set(c.id, c);
}

// Líder e Personagem sem texto: a mesa fica previsível, e as cartas de teste entram pela lista do deck.
const LEADER: CardData = { id: 'YK-L', name: 'Capitão de Teste', category: 'leader', colors: ['red'], life: 5, power: 5000, types: ['Baroque Works', 'Big Mom Pirates'], text: '' };
const GRUNT: CardData = { id: 'YK-C', name: 'Recruta', category: 'character', colors: ['red'], cost: 1, power: 2000, counter: 1000, types: [], text: '' };
const BRUTE: CardData = { id: 'YK-B', name: 'Brutamontes', category: 'character', colors: ['red'], cost: 5, power: 6000, types: [], text: '' };

// Cartas dos exemplos do manual que não estão nas coleções do repositório.
const LINLIN_10: CardData = {
  id: 'OP03-114',
  name: 'Charlotte Linlin',
  category: 'character',
  colors: ['yellow'],
  cost: 10,
  power: 12000,
  types: ['The Four Emperors', 'Big Mom Pirates'],
  text: "[On Play] If your Leader has the {Big Mom Pirates} type, add up to 1 card from the top of your deck to the top of your Life cards. Then, trash up to 1 card from the top of your opponent's Life cards.",
};
const PUDDING: CardData = {
  id: 'OP06-047',
  name: 'Charlotte Pudding',
  category: 'character',
  colors: ['blue'],
  cost: 4,
  power: 4000,
  counter: 1000,
  types: ['Big Mom Pirates'],
  text: '[On Play] Your opponent returns all cards in their hand to their deck and shuffles their deck. Then, your opponent draws 5 cards.',
};
const REIJU: CardData = {
  id: 'OP06-069',
  name: 'Vinsmoke Reiju',
  category: 'character',
  colors: ['purple'],
  cost: 4,
  power: 5000,
  counter: 1000,
  types: ['The Vinsmoke Family', 'GERMA 66'],
  text: "[On Play] If the number of DON!! cards on your field is equal to or less than the number on your opponent's field and you have 5 or less cards in your hand, draw 2 cards.",
};
const ENEL: CardData = {
  id: 'OP05-098',
  name: 'Enel',
  category: 'leader',
  colors: ['yellow'],
  life: 4,
  power: 5000,
  types: ['Sky Island'],
  text: "[Opponent's Turn] [Once Per Turn] When your number of Life cards becomes 0, add 1 card from the top of your deck to the top of your Life cards. Then, trash 1 card from your hand.",
};
const AMAZON: CardData = {
  id: 'OP05-099',
  name: 'Amazon',
  category: 'character',
  colors: ['yellow'],
  cost: 1,
  power: 2000,
  counter: 1000,
  types: ['Sky Island'],
  text: "[On Your Opponent's Attack] You may rest this Character: Your opponent may trash 1 card from the top of their Life cards. If they do not, give up to 1 of your opponent's Leader or Character cards −2000 power during this turn.",
};
const all: CardData[] = [...new Map([...base, ...[LEADER, GRUNT, BRUTE, LINLIN_10, PUDDING, REIJU, ENEL, AMAZON].map((c) => [c.id, c] as const)]).values()];

const JET_PISTOL = 'ST01-015'; // [Main] K.O. up to 1 of your opponent's Characters with 6000 power or less.
const ACE = 'OP02-013'; // [On Play] Give up to 2 of your opponent's Characters −3000 power during this turn.
const ROBIN = 'OP01-017'; // [DON!! x1] [When Attacking] K.O. up to 1 of your opponent's Characters with 3000 power or less.
const KUZAN = 'OP02-121'; // [Your Turn] Give all of your opponent's Characters −5 cost.
const BARTOLOMEO = 'OP01-019'; // [Blocker] [DON!! x2] [Opponent's Turn] This Character gains +3000 power.
const NEWGATE = 'OP02-004'; // [On Play] Up to 1 of your Leader gains +2000 power until the start of your next turn.
const MR3 = 'OP01-085'; // [On Play] … The selected Character cannot attack until the end of your opponent's next turn.
const LINLIN_7 = 'ST07-010'; // [On Play] Your opponent chooses one: • Trash 1 … of your opponent's Life cards. • Add 1 … to your Life cards.
const LAW = 'ST10-010'; // [On Play] DON!! −1: If your opponent has 7 or more cards in their hand, trash 2 cards from your opponent's hand.
const SANJI = 'ST10-004'; // [On Play] If your opponent has a Character with 5000 or more power, this Character gains [Rush].
const PUNK_GIBSON = 'OP01-058'; // [Counter] Up to 1 of your Leader or Character cards gains +4000 … Then, rest up to 1 of your opponent's Characters with a cost of 4 or less.
const LUFFY_10 = 'ST10-006'; // [Once Per Turn] When your opponent activates a [Blocker], K.O. up to 1 of your opponent's Characters with 8000 power or less.
const BONNEY = 'OP07-019'; // Líder: [On Your Opponent's Attack] [Once Per Turn] ①: Rest up to 1 of your opponent's Leader or Character cards.

const mix = (leader = LEADER.id): DeckList => ({
  id: `mix-${leader}`,
  name: 'Mesa de teste',
  leader,
  cards: [
    { id: GRUNT.id, count: 18 },
    { id: AMAZON.id, count: 2 },
    { id: BRUTE.id, count: 2 },
    ...[JET_PISTOL, ACE, ROBIN, KUZAN, BARTOLOMEO, NEWGATE, MR3, LINLIN_7, LAW, SANJI, PUNK_GIBSON, LUFFY_10, LINLIN_10.id, PUDDING.id, REIJU.id].map((id) => ({ id, count: id === BARTOLOMEO || id === PUNK_GIBSON ? 1 : 2 })),
  ],
});

interface TableOpts {
  seed?: number;
  first?: PlayerId;
  seats?: number;
  rules?: TableRules;
  decks?: DeckList[];
  /** A largada de cada lugar (padrão: todos na ímpar, 1 DON!! e a compra). */
  curves?: Array<'odd' | 'even'>;
}

function newTable({ seed = 1, first = 0, seats = 4, rules = YONKO_TABLE, decks }: TableOpts = {}): GameState {
  return createGame({
    seed,
    firstPlayer: first,
    cards: all,
    table: rules,
    players: Array.from({ length: seats }, (_, i) => ({ name: `J${i}`, deck: decks?.[i] ?? mix() })),
  });
}

/** Mesa depois da preparação (cada um escolhe a largada e mantém a mão), no turno 1. */
function ready(opts: TableOpts = {}): GameState {
  let s = newTable(opts);
  while (s.phase === 'mulligan') {
    const p = s.pending!;
    s = applyAction(s, p.kind === 'mulligan' ? { type: 'mulligan', player: p.player, redraw: false } : { type: 'option', player: p.player, index: opts.curves?.[p.player] === 'even' ? 1 : 0 });
  }
  return s;
}

/** Encerra turnos sem fazer nada até o turno pedido. */
function toTurn(s: GameState, turn: number): GameState {
  while (s.turn < turn) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  return s;
}

/** Zera a Vida do jogador (as cartas vão para o descarte): mutação direta, só para testes. */
function drainLife(s: GameState, p: PlayerId, keep = 0) {
  const ps = s.players[p];
  while (ps.life.length > keep) ps.trash.push(ps.life.pop()!);
}

/** Deixa a mão do jogador com `n` cartas, tirando do deck ou devolvendo a ele (mutação direta, só para testes). */
function setHand(s: GameState, p: PlayerId, n: number) {
  const ps = s.players[p];
  while (ps.hand.length > n) ps.deck.push(ps.hand.pop()!);
  while (ps.hand.length < n) ps.hand.push(ps.deck.pop()!);
}

/** O defensor não reage: sem [Blocker], sem Counter, e a carta da Vida vai para a mão. */
function noDefense(s: GameState): GameState {
  for (let guard = 0; guard < 20; guard++) {
    const p = s.pending;
    if (p?.kind === 'block') s = applyAction(s, { type: 'choose', player: p.player, uids: [] });
    else if (p?.kind === 'counter') s = applyAction(s, { type: 'pass', player: p.player });
    else if (p?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: p.player, yes: false });
    else break;
  }
  return s;
}

/** Joga da mão uma carta do jogador da vez, com DON!! de sobra (mutação direta, só para testes). */
function play(s: GameState, cardId: string): GameState {
  const p = s.activePlayer;
  const uid = fetchToHand(s, p, cardId);
  s.players[p].donActive = 10;
  return applyAction(s, { type: 'playCard', player: p, uid });
}

/** Responde "sim" (ou a primeira opção) às perguntas de `player` até aparecer uma de outro tipo ou de outro jogador. */
function sayYes(s: GameState, player: PlayerId): GameState {
  for (let guard = 0; guard < 10; guard++) {
    const p = s.pending;
    if (p?.player !== player) break;
    if (p.kind === 'confirm') s = applyAction(s, { type: 'answer', player, yes: true });
    else if (p.kind === 'option') s = applyAction(s, { type: 'option', player, index: 0 });
    else break;
  }
  return s;
}

const leaderOf = (s: GameState, p: PlayerId) => s.players[p].leader.uid;

describe('Yonko: o deck (60 cartas, uma cópia de cada)', () => {
  const leader = base.get('ST01-001')!;
  const pool = [...base.values()].filter((c) => c.category !== 'leader' && isColorCompatible(leader, c)).map((c) => c.id);
  const deck = (ids: string[]): DeckList => ({ id: 'y', name: 'y', leader: leader.id, cards: ids.map((id) => ({ id, count: 1 })) });

  it('60 cartas diferentes da cor do Líder valem; mesmo nome com números diferentes também', () => {
    // Os dois Roronoa Zoro do exemplo do manual: OP01-025 e ST01-013.
    const ids = ['OP01-025', 'ST01-013', ...pool.filter((id) => id !== 'OP01-025' && id !== 'ST01-013')].slice(0, YONKO_DECK_SIZE);
    expect(base.get('OP01-025')!.name).toBe(base.get('ST01-013')!.name);
    expect(validateYonkoDeck(deck(ids), base)).toMatchObject({ valid: true, total: 60 });
  });

  it('recusa a segunda cópia, o tamanho errado e a carta de outra cor', () => {
    const ids = pool.slice(0, YONKO_DECK_SIZE);
    const twice: DeckList = { ...deck(ids.slice(0, 59)), cards: [...ids.slice(0, 58).map((id) => ({ id, count: 1 })), { id: ids[58], count: 2 }] };
    expect(validateYonkoDeck(twice, base).issues).toContainEqual(expect.objectContaining({ code: 'rules.maxCopies', params: expect.objectContaining({ n: 1 }), cardId: ids[58] }));
    expect(validateYonkoDeck(deck(ids.slice(0, 50)), base).issues).toContainEqual(expect.objectContaining({ code: 'rules.tooFewCards', params: { total: 50, missing: 10 } }));
    const offColor = [...base.values()].find((c) => c.category === 'character' && !isColorCompatible(leader, c))!.id;
    expect(validateYonkoDeck(deck([...ids.slice(0, 59), offColor]), base).issues).toContainEqual(expect.objectContaining({ code: 'rules.leaderColor', cardId: offColor }));
  });

  it('`yonkoDeckFrom`: um deck comum vira um deck de Yonko com as cartas dele e o resto sorteado', () => {
    const made = yonkoDeckFrom(luffy, base.values(), 7)!;
    expect(validateYonkoDeck(made, base)).toMatchObject({ valid: true, total: 60 });
    expect(made.leader).toBe(luffy.leader);
    const ids = new Set(made.cards.map((c) => c.id));
    for (const c of luffy.cards) expect(ids.has(c.id)).toBe(true);
    // Mesma seed, mesmo deck; outra seed, outro.
    expect(yonkoDeckFrom(luffy, base.values(), 7)).toEqual(made);
    expect(yonkoDeckFrom(luffy, base.values(), 8)).not.toEqual(made);
    // Sem cartas que cheguem para 60, não há deck.
    expect(yonkoDeckFrom(luffy, [base.get(luffy.leader)!, ...luffy.cards.map((c) => base.get(c.id)!)], 7)).toBeNull();
  });

  it('o motor aceita o deck de 60 na mesa, e não no jogo de dois', () => {
    const sixty = deck(pool.slice(0, YONKO_DECK_SIZE));
    const seat = { name: 'J', deck: sixty };
    const s = createGame({ seed: 1, cards: all, table: YONKO_TABLE, players: [seat, seat, seat, seat] });
    expect(s.players.every((ps) => ps.deck.length === 60)).toBe(true);
    expect(() => createGame({ seed: 1, cards: all, players: [seat, seat] })).toThrow(/60 cartas/);
  });
});

describe('Yonko: preparação da mesa', () => {
  it('largada de cada um antes das mãos, mulligans na ordem, Vida +2 e o primeiro turno pela curva escolhida', () => {
    let s = newTable({ first: 1 });
    expect(s.table).toEqual(YONKO_TABLE);
    // Antes das mãos: cada um, na ordem dos turnos (1, 2, 3, 0), escolhe a largada.
    for (const [p, index] of [[1, 0], [2, 1], [3, 0], [0, 1]] as const) {
      expect(s.pending).toMatchObject({ kind: 'option', player: p, curve: true, promptKey: 'engine.startCurve', optionKeys: ['engine.optCurveOdd', 'engine.optCurveEven'] });
      expect(s.players.every((ps) => ps.hand.length === 0)).toBe(true);
      s = applyAction(s, { type: 'option', player: p, index });
    }
    expect(s.curve).toEqual(['even', 'odd', 'even', 'odd']);
    for (const ps of s.players) expect(ps.hand).toHaveLength(5);
    for (const p of [1, 2, 3, 0]) {
      expect(s.pending).toEqual({ kind: 'mulligan', player: p });
      s = applyAction(s, { type: 'mulligan', player: p, redraw: false });
    }
    expect(s).toMatchObject({ phase: 'main', turn: 1, activePlayer: 1, pending: null });
    for (const ps of s.players) expect(ps.life).toHaveLength(7);

    // Ímpar: 1 DON!! e a compra. Par: 2 DON!! sem comprar. Vale para todos, inclusive quem começa.
    const expected: Record<number, { hand: number; don: number }> = { 1: { hand: 6, don: 1 }, 2: { hand: 5, don: 2 }, 3: { hand: 6, don: 1 }, 0: { hand: 5, don: 2 } };
    for (const p of [1, 2, 3, 0]) {
      expect(s.activePlayer).toBe(p);
      expect(s.players[p].hand).toHaveLength(expected[p].hand);
      expect(s.players[p].donActive).toBe(expected[p].don);
      s = applyAction(s, { type: 'endTurn', player: p });
    }
    // Segundo turno: todos compram e recebem 2 (ímpar: 1, 3, 5…; par: 2, 4, 6…).
    for (const p of [1, 2, 3, 0]) {
      expect(s.players[p].hand).toHaveLength(expected[p].hand + 1);
      expect(s.players[p].donActive).toBe(expected[p].don + 2);
      s = applyAction(s, { type: 'endTurn', player: p });
    }
    for (const ps of s.players) {
      expect(countCards(s, ps.id)).toBe(51);
      expect(countDon(s, ps.id)).toBe(10);
    }
  });

  it('as regras da mesa são opções: sem elas, Vida impressa e a largada do jogo normal', () => {
    let s = ready({ rules: {} });
    expect(s).toMatchObject({ phase: 'main', turn: 1 });
    expect(s.curve).toBeUndefined();
    for (const ps of s.players) expect(ps.life).toHaveLength(5);
    // Quem começa não compra e recebe 1 DON!!; os outros compram e recebem 2.
    expect(s.players[0]).toMatchObject({ donActive: 1 });
    expect(s.players[0].hand).toHaveLength(5);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.players[1]).toMatchObject({ donActive: 2 });
    expect(s.players[1].hand).toHaveLength(6);
  });

  it('sem `firstPlayer`, o sorteio escolhe um dos lugares e não há "primeiro ou segundo"', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ seed, cards: all, chooseFirst: true, table: YONKO_TABLE, players: [0, 1, 2, 3].map((i) => ({ name: `J${i}`, deck: mix() })) });
      expect(s.pending).toMatchObject({ kind: 'option', curve: true, player: s.firstPlayer });
      firsts.add(s.firstPlayer);
    }
    expect([...firsts].sort()).toEqual([0, 1, 2, 3]);
  });

  it('mesa de 3 e limites de lugares', () => {
    const s = ready({ seats: 3 });
    expect(s).toMatchObject({ phase: 'main', turn: 1, activePlayer: 0 });
    expect(s.players).toHaveLength(3);
    const seat = { name: 'J', deck: mix() };
    expect(() => createGame({ seed: 1, cards: all, players: [seat] })).toThrow(/2 a 4/);
    expect(() => createGame({ seed: 1, cards: all, players: [seat, seat, seat, seat, seat] })).toThrow(/2 a 4/);
  });

  it('com dois jogadores as regras da mesa não valem: é o jogo normal', () => {
    let s = createGame({ seed: 1, firstPlayer: 0, cards: all, table: YONKO_TABLE, players: [0, 1].map((i) => ({ name: `J${i}`, deck: mix() })) });
    expect(s.table).toBeUndefined();
    expect(s.eliminated).toBeUndefined();
    s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
    expect(s).toMatchObject({ phase: 'main', turn: 1 });
    for (const ps of s.players) expect(ps.life).toHaveLength(5);
    s = applyAction(s, { type: 'concede', player: 0 });
    expect(s).toMatchObject({ phase: 'gameover', winner: 1, winReasonKey: 'log.winConcede' });
  });
});

describe('Yonko: turnos e ataques', () => {
  it('ninguém ataca no próprio primeiro turno, nem o último da ordem', () => {
    const s = toTurn(ready(), 4);
    expect(s.activePlayer).toBe(3);
    expect(attackError(s, 3, leaderOf(s, 3), leaderOf(s, 0))).toMatch(/primeiro turno/);
    expect(legalActions(s, 3).some((a) => a.type === 'attack')).toBe(false);
  });

  it('o ataque escolhe o alvo em qualquer mesa; o valor de Counter e o [Blocker] são só do defensor', () => {
    let s = toTurn(ready(), 5);
    expect(s.activePlayer).toBe(0);
    const targets = legalActions(s, 0)
      .filter((a) => a.type === 'attack')
      .map((a) => (a.type === 'attack' ? a.target : ''));
    expect(targets.sort()).toEqual([1, 2, 3].map((p) => leaderOf(s, p)).sort());
    expect(attackError(s, 0, leaderOf(s, 0), leaderOf(s, 0))).toBe('Alvo inválido.');

    // [Blocker] de outro oponente não entra na batalha.
    putOnField(s, 1, BARTOLOMEO);
    const blocker = putOnField(s, 2, BARTOLOMEO);
    // Ninguém de fora tem Evento [Counter] na mão: a etapa de Counter vai direto ao defensor.
    for (const p of [1, 3]) s.players[p].hand = s.players[p].hand.filter((u) => s.cards[u].cardId !== PUNK_GIBSON);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) });
    expect(s.pending).toEqual({ kind: 'block', player: 2, options: [blocker] });
    s = applyAction(s, { type: 'choose', player: 2, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 2 });
    expect(s.pending).not.toHaveProperty('bystander');
    expect(legalActions(s, 1)).toEqual([]);
    expect(() => applyAction(s, { type: 'pass', player: 3 })).toThrow(IllegalActionError);
    s = applyAction(s, { type: 'pass', player: 2 });
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 2 });
    s = applyAction(s, { type: 'answer', player: 2, yes: false });
    expect(s.players[2].life).toHaveLength(6);
    expect(s.players[1].life).toHaveLength(7);
    expect(isIdle(s)).toBe(true);
    expect(s.activePlayer).toBe(0);
  });
});

describe('Yonko: alvos "do oponente" (qualquer alvo legal de qualquer oponente)', () => {
  it('"up to 1 of your opponent\'s Characters": escolhe entre os Personagens dos três, sem pergunta antes', () => {
    let s = toTurn(ready(), 5);
    const victims = [1, 2, 3].map((p) => putOnField(s, p, GRUNT.id));
    const own = putOnField(s, 0, GRUNT.id);
    s = play(s, JET_PISTOL);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: victims });
    expect(s.pending).not.toMatchObject({ options: expect.arrayContaining([own]) });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victims[2]] });
    expect(s.players[3].characters).toHaveLength(0);
    expect(s.players[1].characters).toHaveLength(1);
    expect(s.players[2].characters).toHaveLength(1);
    expect(isIdle(s)).toBe(true);
  });

  it('"up to 2": os dois alvos podem ser de oponentes diferentes', () => {
    let s = toTurn(ready(), 5);
    const victims = [1, 2, 3].map((p) => putOnField(s, p, BRUTE.id));
    s = play(s, ACE);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: victims, max: 2 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victims[0], victims[2]] });
    expect(victims.map((u) => getPower(s, u))).toEqual([3000, 6000, 3000]);
  });

  it('na batalha também: o [When Attacking] alcança os Personagens de quem não está sendo atacado', () => {
    let s = toTurn(ready(), 5);
    const robin = putOnField(s, 0, ROBIN);
    locate(s, robin)!.fc.don = 1;
    const bystander = putOnField(s, 1, GRUNT.id);
    const defending = putOnField(s, 3, GRUNT.id);
    s = applyAction(s, { type: 'attack', player: 0, attacker: robin, target: leaderOf(s, 3) });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, source: robin, options: [bystander, defending] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [bystander] });
    expect(s.players[1].characters).toHaveLength(0);
    expect(s.players[3].characters).toHaveLength(1);
  });

  it('efeito contínuo sobre "os Personagens do oponente" vale para todos os oponentes', () => {
    let s = toTurn(ready(), 5);
    putOnField(s, 0, KUZAN);
    const grunts = [1, 2, 3].map((p) => putOnField(s, p, GRUNT.id));
    const own = putOnField(s, 0, GRUNT.id);
    // [Your Turn]: −5 de custo em todos os Personagens dos três oponentes; os próprios não mudam.
    for (const u of grunts) expect(getCost(s, u)).toBe(0);
    expect(getCost(s, own)).toBe(1);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    for (const u of grunts) expect(getCost(s, u)).toBe(1);
  });

  it("[Opponent's Turn] vale no turno de qualquer oponente", () => {
    let s = toTurn(ready(), 5);
    const barto = putOnField(s, 0, BARTOLOMEO);
    locate(s, barto)!.fc.don = 2;
    const printed = s.defs[BARTOLOMEO].power!;
    expect(getPower(s, barto)).toBe(printed + 2000); // no próprio turno: só os DON!!
    for (const p of [1, 2, 3]) {
      s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
      expect(s.activePlayer).toBe(p);
      expect(getPower(s, barto)).toBe(printed + 3000);
    }
  });
});

describe('Yonko: mão e Vida "do oponente" (vale para cada oponente)', () => {
  it('Linlin de custo 10: ganha 1 de Vida e tira 1 de Vida de cada oponente', () => {
    let s = toTurn(ready(), 5);
    s = play(s, LINLIN_10.id);
    for (let guard = 0; guard < 10 && s.pending; guard++) s = sayYes(s, 0);
    expect(isIdle(s)).toBe(true);
    expect(s.players.map((ps) => ps.life.length)).toEqual([8, 6, 6, 6]);
  });

  it('Linlin de custo 7: cada oponente escolhe entre perder 1 de Vida e dar 1 de Vida a quem a jogou', () => {
    let s = toTurn(ready(), 5);
    s = play(s, LINLIN_7);
    // Na ordem dos turnos: o 1 perde Vida, o 2 dá Vida, o 3 perde Vida.
    for (const [p, index] of [[1, 0], [2, 1], [3, 0]] as const) {
      expect(s.pending).toMatchObject({ kind: 'option', player: p, promptKey: 'engine.chooseAnEffect' });
      s = applyAction(s, { type: 'option', player: p, index });
    }
    expect(isIdle(s)).toBe(true);
    expect(s.players.map((ps) => ps.life.length)).toEqual([8, 6, 7, 6]);
  });

  it('Law de custo 4: só os oponentes com 7 ou mais cartas na mão descartam 2', () => {
    let s = toTurn(ready(), 5);
    setHand(s, 1, 5);
    setHand(s, 2, 8);
    setHand(s, 3, 7);
    s = play(s, LAW);
    for (let guard = 0; guard < 10 && s.pending; guard++) s = sayYes(s, 0);
    expect(isIdle(s)).toBe(true);
    expect([1, 2, 3].map((p) => s.players[p].hand.length)).toEqual([5, 6, 5]);
  });

  it('Pudding: todos os oponentes devolvem a mão ao deck, embaralham e compram 5', () => {
    let s = toTurn(ready(), 5);
    setHand(s, 1, 2);
    setHand(s, 2, 9);
    const before = [1, 2, 3].map((p) => [...s.players[p].hand]);
    fetchToHand(s, 0, PUDDING.id);
    const mine = s.players[0].hand.length;
    s = play(s, PUDDING.id);
    expect(isIdle(s)).toBe(true);
    for (const p of [1, 2, 3]) {
      expect(s.players[p].hand).toHaveLength(5);
      expect(s.players[p].hand).not.toEqual(before[p - 1].slice(0, 5));
      expect(countCards(s, p)).toBe(51);
    }
    expect(s.players[0].hand).toHaveLength(mine - 1);
  });

  it('"Your opponent may…; if they do not, …": cada oponente decide, e o "senão" mira só quem recusou', () => {
    let s = toTurn(ready(), 5);
    const amazon = putOnField(s, 3, AMAZON.id);
    const grunts = [0, 1, 2].map((p) => putOnField(s, p, GRUNT.id));
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 1) });
    // O lugar 3 nem está na batalha: o [On Your Opponent's Attack] dele dispara, e ele paga o custo.
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 3, source: amazon });
    s = applyAction(s, { type: 'answer', player: 3, yes: true });
    // Os oponentes dele, na ordem dos turnos depois dele: 0 (aceita perder 1 Vida), 1 e 2 (recusam).
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, promptKey: 'engine.opponentMayLifeTrash' });
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.players[0].life).toHaveLength(6);
    for (const p of [1, 2]) {
      expect(s.pending).toMatchObject({ kind: 'option', player: p, promptKey: 'engine.opponentMayLifeTrash' });
      s = applyAction(s, { type: 'option', player: p, index: 1 });
      // −2000 em 1 carta de quem recusou, e só dele.
      expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 3, options: [leaderOf(s, p), grunts[p]] });
      s = applyAction(s, { type: 'choose', player: 3, uids: [grunts[p]] });
    }
    expect(grunts.map((u) => getPower(s, u))).toEqual([2000, 0, 0]);
    expect(s.players.map((ps) => ps.life.length)).toEqual([6, 7, 7, 7]);
  });

  it('`eachOpponent`: o que vale para cada oponente e o que é um alvo só', () => {
    const step = (x: unknown) => x as EffectStep;
    expect(eachOpponent(step({ do: 'trashLife', side: 'opponent', count: 1 }))).toBe(true);
    expect(eachOpponent(step({ do: 'opponentDiscards', count: 1 }))).toBe(true);
    expect(eachOpponent(step({ do: 'takeDamage', count: 1, opponent: true }))).toBe(true);
    expect(eachOpponent(step({ do: 'handAllToDeck', who: 'opponent' }))).toBe(true);
    expect(eachOpponent(step({ do: 'chooseOne', chooser: 'opponent', labels: [], options: [] }))).toBe(true);
    // Alvo em campo: um só, de qualquer oponente. E o que só mexe com quem usa o efeito.
    expect(eachOpponent(step({ do: 'ko', target: { side: 'opponent', kinds: ['character'], upTo: 1 } }))).toBe(false);
    expect(eachOpponent(step({ do: 'trashLife', side: 'own', count: 1 }))).toBe(false);
    expect(eachOpponent(step({ do: 'chooseOne', chooser: 'self', labels: [], options: [] }))).toBe(false);
    expect(eachOpponent(step({ do: 'draw', count: 1, if: { opponentLifeMax: 3 } }))).toBe(false);
  });
});

describe('Yonko: condições sobre "o oponente" (basta um)', () => {
  it('Reiju: compra 2 se algum oponente tem tantos DON!! quanto ela ou mais', () => {
    const setup = (don: [number, number, number]) => {
      const s = toTurn(ready(), 5);
      setHand(s, 0, 4);
      [1, 2, 3].forEach((p, i) => {
        s.players[p].donActive = don[i];
        s.players[p].donRested = 0;
      });
      const uid = fetchToHand(s, 0, REIJU.id);
      // Seis DON!! em campo: quatro pagam a Reiju e ficam virados.
      s.players[0].donActive = 6;
      s.players[0].donRested = 0;
      return applyAction(s, { type: 'playCard', player: 0, uid });
    };
    // O exemplo do manual: 6 DON!!; dois oponentes com 5 e um com 7.
    expect(setup([5, 5, 7]).players[0].hand).toHaveLength(4 + 2);
    expect(setup([5, 5, 5]).players[0].hand).toHaveLength(4);
  });

  it('Sanji: ganha [Rush] se algum oponente tem um Personagem com 5000 de poder ou mais', () => {
    let s = toTurn(ready(), 5);
    putOnField(s, 1, GRUNT.id);
    putOnField(s, 3, BRUTE.id);
    s = play(s, SANJI);
    const sanji = s.players[0].characters.at(-1)!.uid;
    expect(hasKeyword(s, sanji, 'rush')).toBe(true);

    let t = toTurn(ready(), 5);
    putOnField(t, 1, GRUNT.id);
    t = play(t, SANJI);
    expect(hasKeyword(t, t.players[0].characters.at(-1)!.uid, 'rush')).toBe(false);
  });
});

describe('Yonko: quem está fora da batalha', () => {
  it('pode usar Evento [Counter] (e os efeitos dele alcançam qualquer oponente), mas não o valor de Counter', () => {
    let s = toTurn(ready(), 5);
    const gibson = fetchToHand(s, 1, PUNK_GIBSON);
    s.players[1].donActive = 2;
    s.players[3].hand = s.players[3].hand.filter((u) => s.cards[u].cardId !== PUNK_GIBSON);
    const attackerGrunt = putOnField(s, 0, GRUNT.id);
    const defenderGrunt = putOnField(s, 2, GRUNT.id);
    const otherGrunt = putOnField(s, 3, GRUNT.id);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) });

    // O lugar 1 não é o defensor: a vez dele abre só com os Eventos [Counter] que pode pagar.
    expect(s.pending).toEqual({ kind: 'counter', player: 1, options: [gibson], bystander: true });
    const grunt = s.players[1].hand.find((u) => s.cards[u].cardId === GRUNT.id);
    if (grunt) expect(() => applyAction(s, { type: 'counter', player: 1, uid: grunt })).toThrow(/Counter inválida/);
    s = applyAction(s, { type: 'counter', player: 1, uid: gibson });
    // "+4000 a 1 das suas cartas" (as dele); depois vira 1 Personagem de qualquer oponente.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [leaderOf(s, 1)] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [defenderGrunt, otherGrunt, attackerGrunt] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [attackerGrunt] });
    expect(locate(s, attackerGrunt)!.fc.rested).toBe(true);
    // Sem mais Eventos na mão dele, a etapa segue; o defensor decide por último, com o valor de Counter.
    expect(s.pending).toMatchObject({ kind: 'counter', player: 2 });
    expect(s.pending).not.toHaveProperty('bystander');
    expect(s.battle).toMatchObject({ bystanders: [] });
  });

  it('pode passar: a vez vai para o próximo de fora e, por último, para o defensor', () => {
    let s = toTurn(ready(), 5);
    const first = fetchToHand(s, 1, PUNK_GIBSON);
    const second = fetchToHand(s, 3, PUNK_GIBSON);
    s.players[1].donActive = 2;
    s.players[3].donActive = 2;
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) });
    expect(s.pending).toEqual({ kind: 'counter', player: 1, options: [first], bystander: true });
    s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.pending).toEqual({ kind: 'counter', player: 3, options: [second], bystander: true });
    s = applyAction(s, { type: 'pass', player: 3 });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 2 });
    s = applyAction(s, { type: 'pass', player: 2 });
    expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 2 });
  });

  it('"When your opponent activates a [Blocker]" dispara para quem não ataca nem defende', () => {
    let s = toTurn(ready(), 5);
    const luffy10 = putOnField(s, 3, LUFFY_10);
    const blocker = putOnField(s, 1, BARTOLOMEO);
    const attackerGrunt = putOnField(s, 0, GRUNT.id);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 1) });
    expect(s.pending).toMatchObject({ kind: 'block', player: 1 });
    s = applyAction(s, { type: 'choose', player: 1, uids: [blocker] });
    // O Luffy do lugar 3 reage ao bloqueio do lugar 1, e nocauteia um Personagem de qualquer oponente dele.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 3, source: luffy10, options: [attackerGrunt, blocker] });
    s = applyAction(s, { type: 'choose', player: 3, uids: [attackerGrunt] });
    expect(s.players[0].characters).toHaveLength(0);
  });

  it("[On Your Opponent's Attack] dispara no ataque a outra mesa", () => {
    let s = toTurn(ready({ decks: [mix(), mix(), mix(), mix(BONNEY)] }), 5);
    s.players[3].donActive = 1;
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 1) });
    // A Bonney do lugar 3 (que não foi atacado) oferece o efeito dela.
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 3, source: leaderOf(s, 3) });
    s = applyAction(s, { type: 'answer', player: 3, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 3 });
    const options = s.pending?.kind === 'selectTargets' ? s.pending.options : [];
    expect(options).toEqual(expect.arrayContaining([leaderOf(s, 1), leaderOf(s, 2)]));
    expect(options).not.toContain(leaderOf(s, 3));
  });

  it('"once per turn" do turno do oponente se renova no turno de cada oponente (Enel)', () => {
    let s = toTurn(ready({ decks: [mix(ENEL.id)] }), 2);
    drainLife(s, 0, 1);
    const enel = leaderOf(s, 0);
    // Dois oponentes atacam em turnos seguidos; nos dois a Vida chega a 0 e o Enel repõe 1.
    for (const p of [1, 2]) {
      s = toTurn(s, s.turn + 4);
      while (s.activePlayer !== p) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
      const hand = s.players[0].hand.length;
      s = noDefense(applyAction(s, { type: 'attack', player: p, attacker: leaderOf(s, p), target: enel }));
      // "Then, trash 1 card from your hand."
      if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [s.pending.options[0]] });
      expect(s.players[0].life).toHaveLength(1);
      expect(s.players[0].hand).toHaveLength(hand + 1 - 1);
      expect(s.phase).toBe('main');
    }
  });
});

describe('Yonko: duração dos efeitos', () => {
  it('"until the start of your next turn" atravessa o turno de todos os oponentes', () => {
    let s = toTurn(ready(), 5);
    s = play(s, NEWGATE);
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [leaderOf(s, 0)] });
    expect(isIdle(s)).toBe(true);
    const leader = leaderOf(s, 0);
    expect(getPower(s, leader)).toBe(7000);
    for (const p of [1, 2, 3]) {
      s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
      expect(s.activePlayer).toBe(p);
      expect(getPower(s, leader)).toBe(7000);
    }
    s = applyAction(s, { type: 'endTurn', player: 3 });
    expect(s.activePlayer).toBe(0);
    expect(getPower(s, leader)).toBe(5000);
    expect(s.modifiers.filter((m) => m.uid === leader)).toEqual([]);
  });

  it('a etiqueta do efeito na carta diz de quem é o turno que o encerra', () => {
    let s = toTurn(ready(), 5);
    s = play(s, NEWGATE);
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [leaderOf(s, 0)] });
    const power = () => cardStatuses(s, leaderOf(s, 0)).find((x) => x.kind === 'power');
    expect(power()).toMatchObject({ untilKey: 'status.untilStartOfNextTurn', untilParams: { name: 'J0' } });
    // No turno de qualquer oponente a etiqueta continua a mesma (e a carta não quebra a tela).
    s = applyAction(s, { type: 'endTurn', player: 0 });
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(power()).toMatchObject({ untilKey: 'status.untilStartOfNextTurn', untilParams: { name: 'J0' } });
    for (const ps of s.players) for (const fc of [ps.leader, ...ps.characters]) expect(() => cardStatuses(s, fc.uid)).not.toThrow();
  });

  it('"until the end of your opponent\'s next turn" vale até o começo do seu turno', () => {
    let s = toTurn(ready(), 5);
    const victim = putOnField(s, 2, GRUNT.id);
    s = play(s, MR3);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [victim] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victim] });
    const blocked = (st: GameState) => st.modifiers.some((m) => m.uid === victim && m.kind === 'cannotAttack');
    expect(blocked(s)).toBe(true);
    s = applyAction(s, { type: 'endTurn', player: 0 }); // turno do 1
    s = applyAction(s, { type: 'endTurn', player: 1 }); // turno do 2: o Personagem dele não ataca
    expect(s.activePlayer).toBe(2);
    expect(attackError(s, 2, victim, leaderOf(s, 0))).toBe('Esta carta não pode atacar.');
    s = applyAction(s, { type: 'endTurn', player: 2 });
    expect(blocked(s)).toBe(true); // ainda no turno do 3
    s = applyAction(s, { type: 'endTurn', player: 3 });
    expect(s.activePlayer).toBe(0);
    expect(blocked(s)).toBe(false);
  });
});

describe('Yonko: eliminação', () => {
  it('dano no Líder sem Vida elimina: as cartas saem do jogo e a mesa segue', () => {
    let s = toTurn(ready(), 5);
    putOnField(s, 2, GRUNT.id);
    drainLife(s, 2);
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) });
    s = noDefense(s);

    expect(s.phase).toBe('main');
    expect(s.players[2]).toMatchObject({ out: true, characters: [], hand: [], deck: [], trash: [], life: [], stage: null, donDeck: 0, donActive: 0, donRested: 0 });
    expect(s.eliminated).toEqual([2]);
    expect(locate(s, leaderOf(s, 2))).toBeNull();
    expect(s.battle).toBeNull();
    // O manual não dá recompensa por eliminação.
    expect(s.players[0].hand).toHaveLength(hand);
    expect(s.log.find((e) => e.key === 'log.eliminated')).toMatchObject({ player: 2, params: { player: 'J2' } });
    expect(s.log.some((e) => e.key === 'log.eliminationReward')).toBe(false);
    // O turno de quem atacou continua; o eliminado não é mais alvo nem oponente de ninguém.
    expect(isIdle(s)).toBe(true);
    expect(s.activePlayer).toBe(0);
    expect(opponentsOf(s, 0)).toEqual([1, 3]);
    expect(attackError(s, 0, leaderOf(s, 0), leaderOf(s, 2))).not.toBeNull();
    for (const p of [0, 1, 3]) expect(countCards(s, p)).toBe(51);

    // A ordem dos turnos pula o eliminado.
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.activePlayer).toBe(1);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.activePlayer).toBe(3);
    s = applyAction(s, { type: 'endTurn', player: 3 });
    expect(s.activePlayer).toBe(0);
    expect(() => applyAction(s, { type: 'concede', player: 2 })).toThrow(IllegalActionError);
  });

  it('regra da casa `eliminationDraw`: quem deu o golpe final compra', () => {
    let s = toTurn(ready({ rules: { ...YONKO_TABLE, eliminationDraw: 1 } }), 5);
    drainLife(s, 2);
    const hand = s.players[0].hand.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) }));
    expect(s.players[2].out).toBe(true);
    expect(s.players[0].hand).toHaveLength(hand + 1);
    expect(s.log.find((e) => e.key === 'log.eliminationReward')).toMatchObject({ player: 0, params: { player: 'J0', n: 1, target: 'J2' } });
  });

  it('o último de pé vence; os outros ficam na ordem de queda, e a mesa do final continua à vista', () => {
    let s = toTurn(ready(), 5);
    s = applyAction(s, { type: 'concede', player: 2 });
    expect(s.phase).toBe('main');
    s = applyAction(s, { type: 'concede', player: 1 });
    expect(s).toMatchObject({ phase: 'main', eliminated: [2, 1] });
    drainLife(s, 3);
    const trash = s.players[3].trash.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 3) }));
    expect(s).toMatchObject({ phase: 'gameover', winner: 0, winReasonKey: 'log.winLeaderDamage', eliminated: [2, 1, 3] });
    // O último a cair não sai da mesa: o fim da partida mostra o campo como ficou.
    expect(s.players[3].out).toBeUndefined();
    expect(s.players[3].trash).toHaveLength(trash);
    expect(s.log.at(-1)).toMatchObject({ key: 'log.gameOverWin', player: 0 });
  });

  it('deck vazio na própria compra: eliminado, sem recompensa, e o turno passa', () => {
    let s = toTurn(ready(), 5);
    const ps = s.players[1];
    ps.trash.push(...ps.deck.splice(0, ps.deck.length - 1));
    const hands = s.players.map((p) => p.hand.length);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.players[1].out).toBe(true);
    expect(s).toMatchObject({ phase: 'main', activePlayer: 2, eliminated: [1], pending: null });
    expect(isIdle(s)).toBe(true);
    expect(s.players[0].hand).toHaveLength(hands[0]);
    expect(s.players[2].hand).toHaveLength(hands[2] + 1); // a compra do turno dele
    // Depois dele, a ordem segue normalmente.
    s = applyAction(s, { type: 'endTurn', player: 2 });
    expect(s.activePlayer).toBe(3);
  });

  it('desistência de quem não está na vez: sai da mesa e o turno em curso continua', () => {
    let s = toTurn(ready(), 5);
    s = applyAction(s, { type: 'concede', player: 3 });
    expect(s).toMatchObject({ phase: 'main', activePlayer: 0, turn: 5, eliminated: [3] });
    expect(isIdle(s)).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ key: 'log.eliminated', player: 3 });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    s = applyAction(s, { type: 'endTurn', player: 1 });
    s = applyAction(s, { type: 'endTurn', player: 2 });
    expect(s.activePlayer).toBe(0);
  });

  it('desistência (ou tempo esgotado) na própria vez: o turno fecha e passa para o próximo', () => {
    let s = toTurn(ready(), 5);
    const hand = s.players[1].hand.length;
    s = applyAction(s, { type: 'timeout', player: 0 });
    expect(s).toMatchObject({ phase: 'main', activePlayer: 1, turn: 6, eliminated: [0] });
    expect(s.players[1].hand).toHaveLength(hand + 1);
    expect(isIdle(s)).toBe(true);
    expect(s.log.find((e) => e.key === 'log.eliminated')).toMatchObject({ params: { reason: 'J0 ficou sem tempo.' } });
  });

  it('o defensor desiste no meio da batalha: a batalha acaba e quem atacava segue no turno', () => {
    let s = toTurn(ready(), 5);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 1) });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 1 });
    s = applyAction(s, { type: 'concede', player: 1 });
    expect(s).toMatchObject({ phase: 'main', activePlayer: 0, battle: null, pending: null, stack: [] });
    expect(isIdle(s)).toBe(true);
    expect(s.players[0].leader.rested).toBe(true);
  });

  it('o atacante desiste no meio da batalha: o turno dele fecha', () => {
    let s = toTurn(ready(), 5);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 1) });
    s = applyAction(s, { type: 'concede', player: 0 });
    expect(s).toMatchObject({ phase: 'main', activePlayer: 1, battle: null, pending: null, eliminated: [0] });
    expect(isIdle(s)).toBe(true);
    expect(s.players[1].life).toHaveLength(7);
  });

  it('quem sai tinha cartas entre as opções de uma escolha de outro jogador: elas somem das opções', () => {
    let s = toTurn(ready(), 5);
    const kept = putOnField(s, 1, GRUNT.id);
    putOnField(s, 2, GRUNT.id);
    s = play(s, JET_PISTOL);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'concede', player: 2 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [kept] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(isIdle(s)).toBe(true);
    expect(s.activePlayer).toBe(0);
  });

  it('um efeito que vale para cada oponente pula quem saiu no meio dele', () => {
    let s = toTurn(ready(), 5);
    s = play(s, LINLIN_7);
    expect(s.pending).toMatchObject({ kind: 'option', player: 1 });
    // O lugar 2 desiste antes da vez dele; o 1 e o 3 ainda escolhem.
    s = applyAction(s, { type: 'concede', player: 2 });
    s = applyAction(s, { type: 'option', player: 1, index: 0 });
    expect(s.pending).toMatchObject({ kind: 'option', player: 3 });
    s = applyAction(s, { type: 'option', player: 3, index: 1 });
    expect(isIdle(s)).toBe(true);
    expect([0, 1, 3].map((p) => s.players[p].life.length)).toEqual([8, 6, 7]);
  });

  it('desistência durante a preparação: ela segue com os outros', () => {
    let s = newTable();
    expect(s.pending).toMatchObject({ kind: 'option', curve: true, player: 0 });
    s = applyAction(s, { type: 'concede', player: 0 });
    expect(s).toMatchObject({ phase: 'mulligan', eliminated: [0] });
    for (const p of [1, 2, 3]) {
      expect(s.pending).toMatchObject({ kind: 'option', curve: true, player: p });
      s = applyAction(s, { type: 'option', player: p, index: 0 });
    }
    expect(s.pending).toEqual({ kind: 'mulligan', player: 1 });
    s = applyAction(s, { type: 'concede', player: 2 });
    for (const p of [1, 3]) s = applyAction(s, { type: 'mulligan', player: p, redraw: false });
    expect(s).toMatchObject({ phase: 'main', turn: 1, activePlayer: 1, eliminated: [0, 2] });
  });
});

describe('Yonko: visão de cada jogador', () => {
  it('cada um vê a própria mão e não vê a dos outros três', () => {
    const s = toTurn(ready(), 2);
    const v = viewFor(s, 2, identityAliases(s));
    expect(v.players).toHaveLength(4);
    expect(v.players[2].hand).toEqual(s.players[2].hand);
    for (const p of [0, 1, 3]) {
      expect(v.players[p].hand).toHaveLength(s.players[p].hand.length);
      expect(v.players[p].hand.every((u) => u.startsWith(HIDDEN_REF))).toBe(true);
    }
    const spectator = viewFor(s, null, identityAliases(s));
    for (const ps of spectator.players) expect(ps.hand.every((u) => u.startsWith(HIDDEN_REF))).toBe(true);
  });
});

describe('Yonko: partidas entre bots', () => {
  const decks = [luffy, kid, crocodile, kaido];

  function playOut(seed: number, seats: number): GameState {
    let s = createGame({ seed, cards: all, table: YONKO_TABLE, players: decks.slice(0, seats).map((d) => ({ name: d.name, deck: d, isBot: true })) });
    for (let i = 0; i < 8000 && s.phase !== 'gameover'; i++) {
      const p = actingPlayer(s)!;
      expect(s.players[p].out).toBeUndefined();
      expect(legalActions(s, p).length).toBeGreaterThan(0);
      s = applyAction(s, chooseBotAction(s, p));
      // O que a mesa consulta para desenhar cada carta não pode quebrar com mais de dois jogadores.
      if (i % 4 === 0) for (const ps of s.players) for (const fc of [ps.leader, ...ps.characters]) cardStatuses(s, fc.uid);
      for (const ps of s.players) {
        if (ps.out) {
          expect(countCards(s, ps.id)).toBe(1);
          expect(countDon(s, ps.id)).toBe(0);
          continue;
        }
        expect(countCards(s, ps.id)).toBe(51);
        expect(countDon(s, ps.id)).toBe(10);
        expect(ps.characters.length).toBeLessThanOrEqual(5);
      }
    }
    return s;
  }

  it('40 mesas de 4 terminam com um vencedor, a classificação completa e sem violar invariantes', () => {
    const wins = [0, 0, 0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      const s = playOut(seed, 4);
      expect(s.phase).toBe('gameover');
      expect(s.winner).not.toBeNull();
      wins[s.winner!]++;
      expect([...s.eliminated!, s.winner!].sort()).toEqual([0, 1, 2, 3]);
    }
    expect(wins.filter((n) => n > 0).length).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('15 mesas de 3 terminam com um vencedor', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const s = playOut(seed, 3);
      expect(s.phase).toBe('gameover');
      expect([...s.eliminated!, s.winner!].sort()).toEqual([0, 1, 2]);
    }
  }, 120_000);
});
