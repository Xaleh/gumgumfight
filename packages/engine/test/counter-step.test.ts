// Counter Step e fim de batalha.
// - O valor de Counter de uma carta da mão vai para o Líder ou 1 Personagem do defensor, inclusive um
//   que não é o alvo do ataque; o bônus acaba no fim da batalha (7-1-3-1-1, Q&A de regras).
// - Reduções de custo da carta na mão valem para o Evento [Counter] (2-7-6).
// - No fim da batalha, primeiro resolvem os "at the end of this battle"; só depois expiram os
//   "during this battle" (7-1-5-2 → 7-1-5-3/4).
// docs/rules/divergencias.md, DV-21 a DV-23.
import { describe, expect, it } from 'vitest';
import { applyAction, counterOptions, createGame, getPower } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { actionFromView, aliasRefs, createAliases } from '../src/view';
import { cards as baseCards, toTurn } from './helpers';

const char = (id: string, power: number, text = '', counter?: number): CardData => ({
  id,
  name: id,
  category: 'character',
  colors: ['red'],
  cost: 1,
  power,
  ...(counter ? { counter } : {}),
  types: [],
  text,
});

const extra: CardData[] = [
  char('SP-C', 4000),
  char('SP-COUNTER', 1000, '', 1000),
  char('SP-D', 5000),
  // Personagem com efeito de fim de batalha que lê o poder do Personagem do oponente.
  char('SP-A', 5000, "At the end of a battle in which this Character battles your opponent's Character, K.O. up to 1 of your opponent's Characters with 6000 power or more."),
  char('SP-B', 5000, "[When Attacking] At the end of this battle, K.O. up to 1 of your opponent's Characters with 6000 power or more."),
  {
    id: 'SP-EV',
    name: 'SP-EV',
    category: 'event',
    colors: ['red'],
    cost: 3,
    types: [],
    text: 'If you have 5 or less Life cards, give this card in your hand -2 cost.\n[Counter] Your Leader gains +3000 power during this battle.',
  },
];
const cards = [...baseCards, ...extra];
const deck: DeckList = {
  id: 'sp',
  name: 'sp',
  leader: 'ST01-001',
  cards: [{ id: 'ST01-006', count: 50 - extra.length }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
};

/** Turno 3 (do jogador 0); o jogador 1 tem 2 DON!! ativos. */
function game(): GameState {
  let s = createGame({
    seed: 7,
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
  const uid = s.players[player].hand.find((u) => !extra.some((c) => c.id === s.cards[u].cardId))!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  return uid;
};
/** Põe `cardId` no campo, tirada do deck (mutação direta, só para testes). */
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
/** Ataca e chega à etapa de Counter do defensor (jogador 1). */
const attack = (s: GameState, attacker: string, target: string) => {
  s = applyAction(s, { type: 'attack', player: 0, attacker, target });
  if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
  expect(s.pending?.kind).toBe('counter');
  return s;
};

describe('Counter em quem não é o alvo do ataque (DV-21)', () => {
  it('o Counter vai para um Personagem que não é o atacado e acaba no fim da batalha', () => {
    let s = game();
    const c = field(s, 1, 'SP-C');
    const counter = give(s, 1, 'SP-COUNTER');
    const leader1 = s.players[1].leader.uid;
    const before = getPower(s, leader1);
    s = attack(s, s.players[0].leader.uid, leader1);
    s = applyAction(s, { type: 'counter', player: 1, uid: counter, target: c });
    expect(getPower(s, c)).toBe(5000);
    expect(getPower(s, leader1)).toBe(before);
    s = applyAction(s, { type: 'pass', player: 1 });
    if (s.pending?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(s.battle).toBeNull();
    expect(getPower(s, c)).toBe(4000);
  });

  it('sem alvo continua indo para o atacado; alvo do atacante ou com Evento é recusado', () => {
    let s = game();
    const c = field(s, 1, 'SP-C', true);
    const counter = give(s, 1, 'SP-COUNTER');
    const ev = give(s, 1, 'SP-EV');
    s = attack(s, s.players[0].leader.uid, c);
    expect(() => applyAction(s, { type: 'counter', player: 1, uid: counter, target: s.players[0].leader.uid })).toThrow();
    expect(() => applyAction(s, { type: 'counter', player: 1, uid: ev, target: c })).toThrow();
    s = applyAction(s, { type: 'counter', player: 1, uid: counter });
    expect(getPower(s, c)).toBe(5000);
  });

  it('o servidor traduz o alvo da visão do jogador (apelidos)', () => {
    let s = game();
    const c = field(s, 1, 'SP-C');
    const counter = give(s, 1, 'SP-COUNTER');
    s = attack(s, s.players[0].leader.uid, s.players[1].leader.uid);
    let n = 0;
    const aliases = createAliases(s, () => `a${++n}`);
    const viewAction = aliasRefs(s, 1, aliases, { type: 'counter', player: 1, uid: counter, target: c });
    expect(viewAction).toEqual({ type: 'counter', player: 1, uid: aliases.toAlias[counter], target: aliases.toAlias[c] });
    expect(actionFromView(s, aliases, viewAction)).toEqual({ type: 'counter', player: 1, uid: counter, target: c });
  });
});

describe('Evento [Counter] com redução de custo na mão (DV-22)', () => {
  it('custo 3 com −2 na mão: aparece com 2 DON!! ativos e paga 1', () => {
    let s = game();
    const ev = give(s, 1, 'SP-EV');
    expect(s.players[1].donActive).toBe(2);
    s = attack(s, s.players[0].leader.uid, s.players[1].leader.uid);
    expect(counterOptions(s, 1)).toContain(ev);
    const before = getPower(s, s.players[1].leader.uid);
    s = applyAction(s, { type: 'counter', player: 1, uid: ev });
    expect(s.players[1].donActive).toBe(1);
    expect(getPower(s, s.players[1].leader.uid)).toBe(before + 3000);
  });
});

describe('"During this battle" expira depois dos efeitos de fim de batalha (DV-23)', () => {
  /** SP-x (5000) ataca SP-D (5000, virado); o defensor dá +1000 a SP-D e o ataque falha. */
  const battle = (attackerId: string) => {
    let s = game();
    const a = field(s, 0, attackerId);
    const d = field(s, 1, 'SP-D', true);
    const counter = give(s, 1, 'SP-COUNTER');
    s = attack(s, a, d);
    s = applyAction(s, { type: 'counter', player: 1, uid: counter });
    expect(getPower(s, d)).toBe(6000);
    s = applyAction(s, { type: 'pass', player: 1 });
    return { s, d };
  };

  for (const [label, id] of [
    ['"At the end of a battle in which this Character battles …"', 'SP-A'],
    ['"[When Attacking] At the end of this battle, …"', 'SP-B'],
  ] as const) {
    it(`${label}: o Counter ainda vale quando o efeito resolve`, () => {
      let { s, d } = battle(id);
      // A batalha ainda está em curso: o +1000 do Counter vale e SP-D (6000) pode ser escolhido.
      expect(s.pending?.kind).toBe('selectTargets');
      expect(s.pending?.kind === 'selectTargets' && s.pending.options).toEqual([d]);
      expect(s.battle).not.toBeNull();
      expect(getPower(s, d)).toBe(6000);
      s = applyAction(s, { type: 'choose', player: 0, uids: [] });
      // Depois do efeito, a batalha termina e o "during this battle" expira.
      expect(s.battle).toBeNull();
      expect(getPower(s, d)).toBe(5000);
    });
  }
});
