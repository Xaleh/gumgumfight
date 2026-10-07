import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import { chooseBotAction } from '../src/bot/simple';
import { replayConfig, REPLAY_VERSION, upgradeReplayActions } from '../src/replay';
import { createAliases, viewFor } from '../src/view';
import type { Action, CardData, DeckList, GameConfig, GameState, PlayerId } from '../src/types';
import { cards as baseCards, kid, luffy, newGame, started } from './helpers';

// Preparação e fim de partida (DV-24 a DV-27).

// Líder sintético com o texto do OP13-079 Imu e Stages do tipo pedido (e um de outro tipo).
const extra: CardData[] = [
  {
    id: 'IM-001',
    name: 'Imu',
    category: 'leader',
    colors: ['black'],
    life: 5,
    power: 5000,
    types: ['Celestial Dragons'],
    text: 'Under the rules of this game, you cannot include Events with a cost of 2 or more in your deck and at the start of the game, play up to 1 {Mary Geoise} type Stage card from your deck.',
  },
  {
    id: 'DO-001',
    name: 'Deck Out',
    category: 'leader',
    colors: ['red'],
    life: 5,
    power: 5000,
    types: [],
    text: 'Under the rules of this game, you do not lose when your deck has 0 cards. You lose at the end of the turn in which your deck becomes 0 cards.',
  },
  { id: 'IM-101', name: 'Mary Geoise', category: 'stage', colors: ['black'], cost: 1, types: ['Mary Geoise'], text: '' },
  { id: 'IM-102', name: 'Pangaea Castle', category: 'stage', colors: ['black'], cost: 2, types: ['Mary Geoise'], text: '' },
  { id: 'IM-103', name: 'Navy HQ', category: 'stage', colors: ['black'], cost: 1, types: ['Navy'], text: '' },
  { id: 'IM-201', name: 'Soldier', category: 'character', colors: ['black'], cost: 1, power: 2000, types: [], text: '' },
];
const cards = [...baseCards, ...extra];
const luffyKid: GameConfig['players'] = [
  { name: 'Luffy', deck: luffy },
  { name: 'Kid', deck: kid },
];
const imu: DeckList = {
  id: 'imu',
  name: 'Imu',
  leader: 'IM-001',
  cards: [
    { id: 'IM-201', count: 42 },
    { id: 'IM-101', count: 4 },
    { id: 'IM-102', count: 2 },
    { id: 'IM-103', count: 2 },
  ],
};

function config(decks: [DeckList, DeckList], opts: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: 7,
    cards,
    players: [
      { name: 'A', deck: decks[0] },
      { name: 'B', deck: decks[1] },
    ],
    ...opts,
  };
}

const idOf = (s: GameState, uid: string) => s.cards[uid].cardId;

describe('DV-24: ordem da Vida na preparação (5-2-1-7)', () => {
  it('a carta do topo do deck fica no fundo da Vida', () => {
    let s = newGame(1, 0);
    s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
    const tops = s.players.map((p) => p.deck.slice(0, 5));
    s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
    // O topo da Vida é o fim do array: a 1ª carta do deck fica em life[0] (o fundo).
    expect(s.players[0].life).toEqual(tops[0]);
    expect(s.players[1].life).toEqual(tops[1]);
    expect(s.players[0].life[0]).toBe(tops[0][0]);
    expect(s.players[0].life[4]).toBe(tops[0][4]);
  });

  it('replays até a versão 8 mantêm a ordem antiga (legacySetup)', () => {
    const cfg: GameConfig = { seed: 1, firstPlayer: 0, cards: baseCards, players: luffyKid };
    const play = (c: GameConfig) => {
      let s = createGame(c);
      s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
      return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
    };
    const now = play(cfg);
    const old = play(replayConfig(cfg, 8));
    expect(old.legacySetup).toBe(true);
    expect(old.players[0].life).toEqual([...now.players[0].life].reverse());
    expect(old.players[0].hand).toEqual(now.players[0].hand);
    expect(replayConfig(cfg, REPLAY_VERSION)).toBe(cfg);
    expect(replayConfig(cfg, undefined).legacySetup).toBe(true);
  });

  it('um replay antigo continua carregando e se reproduz igual', () => {
    // Partida bot x bot gravada com a preparação antiga (como faziam as versões até a 8).
    const cfg = replayConfig({ seed: 11, firstPlayer: 0 as PlayerId, cards: baseCards, players: luffyKid }, 8);
    let s = createGame(cfg);
    const actions: Action[] = [];
    while (s.phase !== 'gameover' && actions.length < 3000) {
      const p = s.pending ? s.pending.player : s.activePlayer;
      const a = chooseBotAction(s, p);
      actions.push(a);
      s = applyAction(s, a);
    }
    expect(s.phase).toBe('gameover');
    const script = upgradeReplayActions(cfg, actions);
    let r = createGame(cfg);
    for (const a of script) r = applyAction(r, a);
    expect(r.winner).toBe(s.winner);
    expect(r.turn).toBe(s.turn);
    expect(r.players.map((p) => p.life)).toEqual(s.players.map((p) => p.life));
  });
});

describe('DV-25: "at the start of the game" do Líder (5-2-1-5, Q&A OP13-079 Imu)', () => {
  it('resolve depois da escolha de quem começa, com escolha do Stage, e embaralha o deck', () => {
    let s = createGame(config([imu, luffy], { chooseFirst: true }));
    // Antes da escolha: nenhum Stage em campo e o dono do Imu ainda sem mão.
    expect(s.pending?.kind).toBe('chooseFirst');
    expect(s.players[0].stage).toBeNull();
    expect(s.players[0].hand).toEqual([]);
    expect(s.players[1].hand).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(50);

    s = applyAction(s, { type: 'answer', player: s.rollWinner!, yes: s.rollWinner === 1 });
    expect(s.firstPlayer).toBe(1);
    const p = s.pending;
    expect(p?.kind).toBe('selectTargets');
    if (p?.kind !== 'selectTargets') throw new Error('sem escolha');
    expect(p.player).toBe(0);
    expect(p.hidden).toBe(true);
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    // Só os Stages do tipo {Mary Geoise} (4 + 2), não o {Navy}.
    expect(p.options).toHaveLength(6);
    expect(new Set(p.options.map((u) => idOf(s, u)))).toEqual(new Set(['IM-101', 'IM-102']));

    // O oponente não vê as opções (o deck é secreto).
    let i = 0;
    const view = viewFor(s, 1, createAliases(s, () => `a${i++}`));
    expect(view.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [] });

    const castle = p.options.find((u) => idOf(s, u) === 'IM-102')!;
    const before = s.players[0].deck.filter((u) => u !== castle);
    s = applyAction(s, { type: 'choose', player: 0, uids: [castle] });
    expect(s.players[0].stage?.uid).toBe(castle);
    // O deck foi embaralhado depois da busca e só então a mão foi comprada.
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(44);
    expect([...s.players[0].hand, ...s.players[0].deck]).not.toEqual(before);
    expect(new Set([...s.players[0].hand, ...s.players[0].deck])).toEqual(new Set(before));
    expect(s.pending).toEqual({ kind: 'mulligan', player: 1 });
  });

  it('"up to 1": pode recusar; com dois Imus, quem joga primeiro resolve primeiro', () => {
    let s = createGame(config([imu, imu], { firstPlayer: 1 }));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.players[1].stage).toBeNull();
    expect(s.players[1].hand).toEqual([]);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const opts = (s.pending as { options: string[] }).options;
    s = applyAction(s, { type: 'choose', player: 0, uids: [opts[0]] });
    expect(s.players[0].stage?.uid).toBe(opts[0]);
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[1].hand).toHaveLength(5);
    expect(s.players[1].deck).toHaveLength(45);
    expect(s.pending).toEqual({ kind: 'mulligan', player: 1 });
    s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
    expect(s.phase).toBe('main');
    expect(s.activePlayer).toBe(1);
  });

  it('o bot escolhe um Stage', () => {
    const s = createGame(config([imu, luffy], { firstPlayer: 0 }));
    const p = s.pending as { kind: string; options: string[] };
    const a = chooseBotAction(s, 0);
    expect(a.type).toBe('choose');
    if (a.type !== 'choose') return;
    expect(a.uids).toHaveLength(1);
    expect(p.options).toContain(a.uids[0]);
  });

  it('partida bot x bot com dois Imus e escolha de quem começa vai até o fim', () => {
    let s = createGame(config([imu, imu], { chooseFirst: true }));
    for (let i = 0; i < 4000 && s.phase !== 'gameover'; i++) {
      const p = s.pending ? s.pending.player : s.activePlayer;
      s = applyAction(s, chooseBotAction(s, p));
    }
    expect(s.phase).toBe('gameover');
    expect(s.players.every((p) => p.mulliganDone)).toBe(true);
  });

  it('replays antigos: resolve na criação, com o primeiro Stage elegível', () => {
    const s = createGame(config([imu, luffy], { firstPlayer: 0, legacySetup: true }));
    expect(s.pending).toEqual({ kind: 'mulligan', player: 0 });
    expect(['IM-101', 'IM-102']).toContain(idOf(s, s.players[0].stage!.uid));
    expect(s.players[0].hand).toHaveLength(5);
  });
});

describe('DV-26: derrota simultânea empata (9-2-1)', () => {
  it('os dois sem cartas no deck: empate', () => {
    let s = started();
    for (const ps of s.players) ps.trash.push(...ps.deck.splice(0));
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBeNull();
    expect(s.log[s.log.length - 1].text).toMatch(/empate/);
  });

  it('só um sem cartas no deck: o outro vence', () => {
    let s = started();
    s.players[1].trash.push(...s.players[1].deck.splice(0));
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
  });

  it('dois Líderes que perdem no fim do turno com o deck vazio: empate', () => {
    const deckOut: DeckList = { ...imu, leader: 'DO-001', cards: [{ id: 'IM-201', count: 50 }] };
    let s = createGame(config([deckOut, deckOut], { firstPlayer: 0 }));
    s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
    for (const ps of s.players) ps.trash.push(...ps.deck.splice(0));
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBeNull();
    expect(s.winReason).toBe('Os dois terminaram o turno sem cartas no deck.');
  });
});

describe('DV-27: laço infinito empata (11-1)', () => {
  it('a partida termina empatada em vez de travar', () => {
    let s = started();
    const leader = s.players[0].leader.uid;
    const id = idOf(s, leader);
    // [Activate: Main] que ativa o próprio [On Play], que ativa a si mesmo para sempre.
    s.defs = {
      ...s.defs,
      [id]: {
        ...s.defs[id],
        abilities: [
          { timing: 'activateMain', steps: [{ do: 'useOwnEffect', timing: 'onPlay' }] },
          { timing: 'onPlay', steps: [{ do: 'useOwnEffect', timing: 'onPlay' }] },
        ],
      },
    };
    s = applyAction(s, { type: 'activate', player: 0, uid: leader, ability: 0 });
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBeNull();
    expect(s.stack).toEqual([]);
    expect(s.log[s.log.length - 1].text).toMatch(/empate.*Laço infinito/);
  });
});
