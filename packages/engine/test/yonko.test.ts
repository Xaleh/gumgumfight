// Mesa com mais de dois jogadores (o formato Yonko: todos contra todos). Fase 1 do plano
// (docs/plano-modos-de-jogo.md, seção 4): o motor com N jogadores, sem tela.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import {
  applyAction,
  attackError,
  createGame,
  getCost,
  getPower,
  IllegalActionError,
  isIdle,
  locate,
  mentionsOpponent,
  opponentOf,
  opponentsOf,
  YONKO_TABLE,
} from '../src/engine';
import type { CardData, DeckList, EffectStep, GameState, PlayerId, TableRules } from '../src/types';
import { HIDDEN_REF, identityAliases, viewFor } from '../src/view';
import { countCards, countDon, crocodile, fetchToHand, kaido, kid, luffy, putOnField } from './helpers';

const DATA = join(__dirname, '../../../data/cards');
const base = new Map<string, CardData>();
for (const f of readdirSync(DATA).filter((n) => n.endsWith('.json')).sort()) {
  for (const c of (JSON.parse(readFileSync(join(DATA, f), 'utf8')).cards ?? []) as CardData[]) base.set(c.id, c);
}

// Líder e Personagem sem texto: a mesa fica previsível, e as cartas de teste entram pela lista do deck.
const LEADER: CardData = { id: 'YK-L', name: 'Capitão de Teste', category: 'leader', colors: ['red'], life: 5, power: 5000, types: ['Baroque Works'], text: '' };
const GRUNT: CardData = { id: 'YK-C', name: 'Recruta', category: 'character', colors: ['red'], cost: 1, power: 2000, counter: 1000, types: [], text: '' };
const all: CardData[] = [...base.values(), LEADER, GRUNT];

const JET_PISTOL = 'ST01-015'; // [Main] K.O. up to 1 of your opponent's Characters with 6000 power or less.
const ROBIN = 'OP01-017'; // [DON!! x1] [When Attacking] K.O. up to 1 of your opponent's Characters with 3000 power or less.
const KUZAN = 'OP02-121'; // [Your Turn] Give all of your opponent's Characters −5 cost.
const BARTOLOMEO = 'OP01-019'; // [DON!! x2] [Opponent's Turn] This Character gains +3000 power.
const NEWGATE = 'OP02-004'; // [On Play] Up to 1 of your Leader gains +2000 power until the start of your next turn.
const MR3 = 'OP01-085'; // [On Play] … The selected Character cannot attack until the end of your opponent's next turn.
const YAMATO = 'OP06-022'; // [Activate: Main] If your opponent has 3 or less Life cards, give up to 2 rested DON!! cards to 1 of your Characters.

const mix = (leader = LEADER.id): DeckList => ({
  id: `mix-${leader}`,
  name: 'Mesa de teste',
  leader,
  cards: [
    { id: GRUNT.id, count: 30 },
    { id: JET_PISTOL, count: 4 },
    { id: ROBIN, count: 4 },
    { id: KUZAN, count: 2 },
    { id: BARTOLOMEO, count: 4 },
    { id: NEWGATE, count: 2 },
    { id: MR3, count: 4 },
  ],
});

interface TableOpts {
  seed?: number;
  first?: PlayerId;
  seats?: number;
  rules?: TableRules;
  decks?: DeckList[];
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

/** Mesa depois da preparação (todos mantêm a mão; quem tem bônus escolhe +1 carta), no turno 1. */
function ready(opts: TableOpts = {}): GameState {
  let s = newTable(opts);
  while (s.phase === 'mulligan') {
    const p = s.pending!;
    s = applyAction(s, p.kind === 'mulligan' ? { type: 'mulligan', player: p.player, redraw: false } : { type: 'option', player: p.player, index: 0 });
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

const leaderOf = (s: GameState, p: PlayerId) => s.players[p].leader.uid;

describe('Yonko: preparação da mesa', () => {
  it('mulligans na ordem dos turnos, bônus do 3º e do 4º, Vida +2 e a largada de cada um', () => {
    let s = newTable({ first: 1 });
    expect(s.table).toEqual(YONKO_TABLE);
    // Ordem: 1, 2, 3, 0 (os lugares a partir de quem começa).
    for (const p of [1, 2, 3, 0]) {
      expect(s.pending).toEqual({ kind: 'mulligan', player: p });
      s = applyAction(s, { type: 'mulligan', player: p, redraw: false });
    }
    // O 3º da ordem (lugar 3) escolhe +1 carta; o 4º (lugar 0), +1 DON!!.
    expect(s.pending).toMatchObject({ kind: 'option', player: 3, startBonus: true, promptKey: 'engine.startBonus', optionKeys: ['engine.optBonusCard', 'engine.optBonusDon'] });
    s = applyAction(s, { type: 'option', player: 3, index: 0 });
    expect(s.players[3].hand).toHaveLength(6);
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, startBonus: true });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });

    expect(s).toMatchObject({ phase: 'main', turn: 1, activePlayer: 1, pending: null });
    for (const ps of s.players) expect(ps.life).toHaveLength(7);
    // O 1º não compra e recebe 1 DON!!.
    expect(s.players[1]).toMatchObject({ donActive: 1 });
    expect(s.players[1].hand).toHaveLength(5);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s).toMatchObject({ turn: 2, activePlayer: 2 });
    expect(s.players[2].hand).toHaveLength(6);
    expect(s.players[2].donActive).toBe(2);
    s = applyAction(s, { type: 'endTurn', player: 2 });
    expect(s.activePlayer).toBe(3);
    expect(s.players[3].hand).toHaveLength(7); // 5 + bônus + compra
    expect(s.players[3].donActive).toBe(2);
    s = applyAction(s, { type: 'endTurn', player: 3 });
    expect(s.activePlayer).toBe(0);
    expect(s.players[0].hand).toHaveLength(6);
    expect(s.players[0].donActive).toBe(3); // 2 + bônus
    expect(s.log.some((e) => e.key === 'log.startBonusDonGiven')).toBe(true);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s).toMatchObject({ turn: 5, activePlayer: 1 });
    expect(s.players[1].donActive).toBe(3);
    for (const ps of s.players) {
      expect(countCards(s, ps.id)).toBe(51);
      expect(countDon(s, ps.id)).toBe(10);
    }
  });

  it('as regras da mesa são opções: sem elas, Vida impressa e nenhum bônus', () => {
    const s = ready({ rules: {} });
    expect(s).toMatchObject({ phase: 'main', turn: 1 });
    for (const ps of s.players) expect(ps.life).toHaveLength(5);
    expect(s.log.some((e) => e.key === 'log.startBonusCard')).toBe(false);
  });

  it('mesa de 3: só o 3º tem bônus', () => {
    let s = newTable({ seats: 3 });
    for (const p of [0, 1, 2]) s = applyAction(s, { type: 'mulligan', player: p, redraw: false });
    expect(s.pending).toMatchObject({ kind: 'option', player: 2, startBonus: true });
    s = applyAction(s, { type: 'option', player: 2, index: 0 });
    expect(s).toMatchObject({ phase: 'main', turn: 1, activePlayer: 0 });
  });

  it('sem `firstPlayer`, o sorteio escolhe um dos lugares e não há "primeiro ou segundo"', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ seed, cards: all, chooseFirst: true, table: YONKO_TABLE, players: [0, 1, 2, 3].map((i) => ({ name: `J${i}`, deck: mix() })) });
      expect(s.pending).toEqual({ kind: 'mulligan', player: s.firstPlayer });
      firsts.add(s.firstPlayer);
    }
    expect([...firsts].sort()).toEqual([0, 1, 2, 3]);
  });

  it('recusa mesas com menos de 2 ou mais de 4 jogadores', () => {
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

  it('o ataque escolhe o alvo em qualquer mesa, e só o defensor responde', () => {
    let s = toTurn(ready(), 5);
    expect(s.activePlayer).toBe(0);
    const targets = legalActions(s, 0)
      .filter((a) => a.type === 'attack')
      .map((a) => (a.type === 'attack' ? a.target : ''));
    expect(targets.sort()).toEqual([1, 2, 3].map((p) => leaderOf(s, p)).sort());
    expect(attackError(s, 0, leaderOf(s, 0), leaderOf(s, 0))).toBe('Alvo inválido.');

    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) });
    expect(s.pending).toMatchObject({ kind: 'counter', player: 2 });
    expect(opponentOf(s, 0)).toBe(2);
    expect(opponentOf(s, 2)).toBe(0);
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

  it('[Blocker] de outro oponente não entra na batalha', () => {
    let s = toTurn(ready(), 5);
    // Bartolomeo tem [Blocker]: o do lugar 1 não bloqueia um ataque ao lugar 2.
    putOnField(s, 1, BARTOLOMEO);
    const blocker = putOnField(s, 2, BARTOLOMEO);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) });
    expect(s.pending).toEqual({ kind: 'block', player: 2, options: [blocker] });
  });
});

describe('Yonko: "seu oponente" nos efeitos', () => {
  it('regra 2: fora de batalha, quem usa o efeito escolhe o oponente, e os alvos são só dele', () => {
    let s = toTurn(ready(), 5);
    const pistol = fetchToHand(s, 0, JET_PISTOL);
    s.players[0].donActive = 10;
    const victims = [1, 2, 3].map((p) => putOnField(s, p, GRUNT.id));
    expect(opponentsOf(s, 0)).toEqual([1, 2, 3]);

    s = applyAction(s, { type: 'playCard', player: 0, uid: pistol });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, source: pistol, promptKey: 'engine.chooseOpponent', options: ['J1', 'J2', 'J3'], opponents: [1, 2, 3] });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    expect(s.log.at(-1)).toMatchObject({ key: 'log.choosesOpponent', params: { player: 'J0', target: 'J2' } });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [victims[1]] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victims[1]] });
    expect(s.players[2].characters).toHaveLength(0);
    expect(s.players[2].trash).toContain(victims[1]);
    expect(s.players[1].characters).toHaveLength(1);
    expect(s.players[3].characters).toHaveLength(1);
    expect(isIdle(s)).toBe(true);
  });

  it('regra 2: a escolha de oponente pode ser cancelada como qualquer escolha da própria ação', () => {
    let s = toTurn(ready(), 5);
    const pistol = fetchToHand(s, 0, JET_PISTOL);
    s.players[0].donActive = 10;
    putOnField(s, 1, GRUNT.id);
    s = applyAction(s, { type: 'playCard', player: 0, uid: pistol });
    expect(s.pending).toMatchObject({ kind: 'option', opponents: [1, 2, 3] });
    s = applyAction(s, { type: 'cancel', player: 0 });
    expect(s.players[0].hand).toContain(pistol);
    expect(s.players[0].donActive).toBe(10);
    expect(isIdle(s)).toBe(true);
  });

  it('regra 1: em batalha o oponente é o outro jogador da batalha, sem pergunta', () => {
    let s = toTurn(ready(), 5);
    const robin = putOnField(s, 0, ROBIN);
    locate(s, robin)!.fc.don = 1;
    putOnField(s, 1, GRUNT.id);
    const victim = putOnField(s, 3, GRUNT.id);
    s = applyAction(s, { type: 'attack', player: 0, attacker: robin, target: leaderOf(s, 3) });
    // [When Attacking]: os alvos são só os Personagens do defensor.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, source: robin, options: [victim] });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victim] });
    expect(s.players[3].characters).toHaveLength(0);
    expect(s.players[1].characters).toHaveLength(1);
    expect(s.pending).toMatchObject({ kind: 'counter', player: 3 });
  });

  it('regra 3: efeito contínuo sobre "os Personagens do oponente" vale para todos os oponentes', () => {
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

  it("regra 3: [Opponent's Turn] vale no turno de qualquer oponente", () => {
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

  it('regra 3: condição sobre "seu oponente" vale se algum oponente a cumpre, e não abre escolha', () => {
    const setup = () => {
      const s = toTurn(ready({ decks: [mix(YAMATO)] }), 5);
      const grunt = putOnField(s, 0, GRUNT.id);
      s.players[0].donRested = 2;
      s.players[0].donActive -= 2;
      return { s, grunt, leader: leaderOf(s, 0), index: s.defs[YAMATO].abilities.findIndex((a) => a.timing === 'activateMain') };
    };
    // Todos com 7 de Vida: "If your opponent has 3 or less Life cards" não vale para ninguém, e o efeito não faz nada.
    {
      const { s, leader, index } = setup();
      const after = applyAction(s, { type: 'activate', player: 0, uid: leader, ability: index });
      expect(after.pending).toBeNull();
      expect(after.players[0].donRested).toBe(2);
    }
    // Um dos três com 3 de Vida basta. O efeito só mexe nas cartas de quem o usa: vai direto ao alvo,
    // sem escolher oponente.
    {
      const { s, grunt, leader, index } = setup();
      drainLife(s, 2, 3);
      const after = applyAction(s, { type: 'activate', player: 0, uid: leader, ability: index });
      expect(after.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [grunt] });
    }
  });

  it('com um só oponente vivo, nada de escolha', () => {
    let s = toTurn(ready(), 5);
    s = applyAction(s, { type: 'concede', player: 1 });
    s = applyAction(s, { type: 'concede', player: 3 });
    expect(opponentsOf(s, 0)).toEqual([2]);
    const pistol = fetchToHand(s, 0, JET_PISTOL);
    s.players[0].donActive = 10;
    const victim = putOnField(s, 2, GRUNT.id);
    s = applyAction(s, { type: 'playCard', player: 0, uid: pistol });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [victim] });
  });

  it('`mentionsOpponent`: o que pede a escolha de um oponente e o que não pede', () => {
    const step = (x: unknown) => x as EffectStep;
    expect(mentionsOpponent(step({ do: 'ko', target: { side: 'opponent', kinds: ['character'], upTo: 1 } }))).toBe(true);
    expect(mentionsOpponent(step({ do: 'opponentDiscards', count: 1 }))).toBe(true);
    expect(mentionsOpponent(step({ do: 'takeDamage', count: 1, opponent: true }))).toBe(true);
    expect(mentionsOpponent(step({ do: 'trashHandUntil', count: 5, both: true }))).toBe(true);
    expect(mentionsOpponent(step({ do: 'chooseOne', chooser: 'self', labels: ['a', 'b'], options: [[{ do: 'draw', count: 1 }], [{ do: 'trashLife', side: 'opponent', count: 1 }]] }))).toBe(true);
    // Só as próprias cartas; cartas de toda a mesa; condição e duração que citam o oponente.
    expect(mentionsOpponent(step({ do: 'draw', count: 2 }))).toBe(false);
    expect(mentionsOpponent(step({ do: 'power', target: { side: 'any', kinds: ['leader', 'character'], upTo: 1 }, amount: 1000, duration: 'turn' }))).toBe(false);
    expect(mentionsOpponent(step({ do: 'draw', count: 1, if: { opponentLifeMax: 3 } }))).toBe(false);
    expect(mentionsOpponent(step({ do: 'gainKeyword', target: 'self', keyword: 'blocker', duration: 'nextOpponentTurn' }))).toBe(false);
  });
});

describe('Yonko: duração dos efeitos', () => {
  it('"until the start of your next turn" atravessa o turno de todos os oponentes', () => {
    let s = toTurn(ready(), 5);
    const newgate = fetchToHand(s, 0, NEWGATE);
    s.players[0].donActive = 10;
    s = applyAction(s, { type: 'playCard', player: 0, uid: newgate });
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

  it('"until the end of your opponent\'s next turn", usado no próprio turno, vale até o seu turno recomeçar', () => {
    let s = toTurn(ready(), 5);
    const mr3 = fetchToHand(s, 0, MR3);
    s.players[0].donActive = 10;
    const victim = putOnField(s, 2, GRUNT.id);
    s = applyAction(s, { type: 'playCard', player: 0, uid: mr3 });
    expect(s.pending).toMatchObject({ kind: 'option', opponents: [1, 2, 3] });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
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
  it('dano no Líder sem Vida elimina: as cartas saem do jogo, quem deu o golpe compra 1 e a mesa segue', () => {
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
    expect(s.players[0].hand).toHaveLength(hand + 1);
    expect(s.log.find((e) => e.key === 'log.eliminated')).toMatchObject({ player: 2, params: { player: 'J2' } });
    expect(s.log.find((e) => e.key === 'log.eliminationReward')).toMatchObject({ player: 0, params: { player: 'J0', n: 1, target: 'J2' } });
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

  it('sem recompensa na mesa, ninguém compra', () => {
    let s = toTurn(ready({ rules: { extraLife: 2 } }), 5);
    drainLife(s, 2);
    const hand = s.players[0].hand.length;
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 2) }));
    expect(s.players[2].out).toBe(true);
    expect(s.players[0].hand).toHaveLength(hand);
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
    expect(s.log.some((e) => e.key === 'log.eliminationReward')).toBe(false);
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
    // Uma desistência não é golpe de ninguém: sem recompensa.
    expect(s.log.some((e) => e.key === 'log.eliminationReward')).toBe(false);
  });

  it('o atacante desiste no meio da batalha: o turno dele fecha', () => {
    let s = toTurn(ready(), 5);
    s = applyAction(s, { type: 'attack', player: 0, attacker: leaderOf(s, 0), target: leaderOf(s, 1) });
    s = applyAction(s, { type: 'concede', player: 0 });
    expect(s).toMatchObject({ phase: 'main', activePlayer: 1, battle: null, pending: null, eliminated: [0] });
    expect(isIdle(s)).toBe(true);
    expect(s.players[1].life).toHaveLength(7);
  });

  it('quem sai tinha uma escolha de outro jogador apontada para ele: as cartas dele somem das opções', () => {
    let s = toTurn(ready(), 5);
    const pistol = fetchToHand(s, 0, JET_PISTOL);
    s.players[0].donActive = 10;
    putOnField(s, 2, GRUNT.id);
    s = applyAction(s, { type: 'playCard', player: 0, uid: pistol });
    s = applyAction(s, { type: 'option', player: 0, index: 1 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'concede', player: 2 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [], min: 0, max: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(isIdle(s)).toBe(true);
    expect(s.activePlayer).toBe(0);
  });

  it('desistência durante a preparação: os mulligans seguem com os outros', () => {
    let s = newTable();
    s = applyAction(s, { type: 'concede', player: 0 });
    expect(s).toMatchObject({ phase: 'mulligan', eliminated: [0] });
    expect(s.pending).toEqual({ kind: 'mulligan', player: 1 });
    for (const p of [1, 2, 3]) s = applyAction(s, { type: 'mulligan', player: p, redraw: false });
    // Só o 3º e o 4º da ordem sorteada (lugares 2 e 3) têm bônus.
    expect(s.pending).toMatchObject({ kind: 'option', player: 2, startBonus: true });
    s = applyAction(s, { type: 'option', player: 2, index: 0 });
    s = applyAction(s, { type: 'option', player: 3, index: 0 });
    expect(s).toMatchObject({ phase: 'main', turn: 1, activePlayer: 1 });
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
