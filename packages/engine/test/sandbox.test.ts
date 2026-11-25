import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { applyAction } from '../src/engine';
import { createSandbox, parseSandboxSpec, sandboxConfig, sandboxDeck, sandboxIssues, type SandboxSpec } from '../src/sandbox';
import type { GameState, PlayerId } from '../src/types';
import { cards, countCards, countDon } from './helpers';

const names: [string, string] = ['Lado A', 'Lado B'];
const idOf = (s: GameState, uid: string) => s.cards[uid].cardId;

/** Luffy (ST01) com cartas de outras coleções e cores, contra Crocodile (ST03). */
const spec: SandboxSpec = {
  turn: 5,
  active: 0,
  sides: [
    {
      leader: { id: 'ST01-001', don: 1 },
      hand: ['ST01-015', 'ST02-004'],
      characters: ['ST01-013', { id: 'ST01-012', fresh: true }],
      stage: 'ST01-017',
      life: 2,
      donActive: 3,
      donRested: 1,
    },
    {
      leader: { id: 'ST03-001' },
      hand: ['ST03-017', 'ST03-017'],
      characters: [{ id: 'ST03-013', rested: true }],
      life: ['ST03-002', 'ST03-011'],
      trash: ['ST03-015'],
      deckTop: ['ST03-004'],
      donActive: 2,
    },
  ],
};

const build = (s: SandboxSpec) => createSandbox(s, sandboxConfig(s, cards, names));

describe('sandbox de regras', () => {
  it('monta a mesa com cartas fora de qualquer deck pronto, 51 cartas e 10 DON!! por lado', () => {
    const s = build(spec);
    expect(s.phase).toBe('main');
    expect(s.turn).toBe(5);
    expect(s.activePlayer).toBe(0);
    expect(s.players.map((p) => p.isBot)).toEqual([false, false]);
    const a = s.players[0];
    expect(idOf(s, a.leader.uid)).toBe('ST01-001');
    expect(a.leader.don).toBe(1);
    expect(a.hand.map((u) => idOf(s, u))).toEqual(['ST01-015', 'ST02-004']);
    expect(a.characters.map((c) => idOf(s, c.uid))).toEqual(['ST01-013', 'ST01-012']);
    expect(a.characters[1].playedOnTurn).toBe(5);
    expect(idOf(s, a.stage!.uid)).toBe('ST01-017');
    expect(a.life).toHaveLength(2);
    expect(a).toMatchObject({ donActive: 3, donRested: 1, donDeck: 5 });
    const b = s.players[1];
    expect(b.life.map((u) => idOf(s, u))).toEqual(['ST03-002', 'ST03-011']);
    expect(b.characters[0].rested).toBe(true);
    expect(idOf(s, b.deck[0])).toBe('ST03-004');
    expect(b.trash.map((u) => idOf(s, u))).toEqual(['ST03-015']);
    for (const p of [0, 1] as PlayerId[]) {
      expect(countCards(s, p)).toBe(51);
      expect(countDon(s, p)).toBe(10);
    }
  });

  it('o deck montado completa 50 com cópias das cartas citadas e a configuração leva só as cartas usadas', () => {
    const deck = sandboxDeck(spec.sides[0], cards);
    expect(deck.leader).toBe('ST01-001');
    expect(deck.cards.reduce((n, c) => n + c.count, 0)).toBe(50);
    expect(new Set(deck.cards.map((c) => c.id))).toEqual(new Set(['ST01-015', 'ST02-004', 'ST01-013', 'ST01-012', 'ST01-017']));
    const empty = sandboxDeck({ leader: { id: 'ST03-001' } }, cards);
    expect(empty.cards).toHaveLength(1);
    expect(cards.find((c) => c.id === empty.cards[0].id)?.colors).toContain('blue');
    const config = sandboxConfig(spec, cards, names);
    expect(config.cards.length).toBeLessThan(20);
  });

  it('os dois lados jogam: o lado B responde ao ataque com Counter da mão e depois joga o próprio turno', () => {
    let s = build(spec);
    const zoro = s.players[0].characters[0].uid;
    s = applyAction(s, { type: 'attack', player: 0, attacker: zoro, target: s.players[1].leader.uid });
    // Sem Blocker ativo (Hancock está virada), o lado B chega à etapa de Counter.
    for (let i = 0; i < 5 && actingPlayer(s) === 1 && s.pending?.kind !== 'counter'; i++) {
      const pass = legalActions(s, 1).find((a) => a.type === 'pass');
      if (!pass) break;
      s = applyAction(s, pass);
    }
    expect(actingPlayer(s)).toBe(1);
    const counter = legalActions(s, 1).find((a) => a.type === 'counter');
    expect(counter).toBeDefined();
    s = applyAction(s, counter!);
    // "Up to 1 of your Leader or Character cards gains +4000": o alvo é o Líder atacado.
    const leaderB = s.players[1].leader.uid;
    for (let i = 0; i < 10 && s.battle; i++) {
      const p = actingPlayer(s)!;
      const legal = legalActions(s, p);
      const pick =
        legal.find((a) => a.type === 'choose' && a.uids.includes(leaderB)) ??
        legal.find((a) => a.type === 'answer' && a.yes) ??
        legal.find((a) => a.type === 'pass') ??
        legal[0];
      s = applyAction(s, pick);
    }
    // Love-Love Mellow (+4000): o ataque de 5000 não passa e a Vida fica.
    expect(s.players[1].life).toHaveLength(2);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.activePlayer).toBe(1);
    expect(s.turn).toBe(6);
    expect(legalActions(s, 1).some((a) => a.type === 'endTurn')).toBe(true);
  });

  it('aponta o que impede a mesa de ser montada', () => {
    const bad: SandboxSpec = {
      turn: 0,
      active: 0,
      sides: [
        {
          leader: { id: 'ST01-012' },
          hand: ['XX99-999', 'ST03-001'],
          characters: ['ST01-015', 'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013'],
          stage: 'ST01-013',
          donActive: 10,
          donRested: 1,
        },
        { leader: { id: 'ST03-001' }, hand: Array(49).fill('ST03-002'), life: 2 },
      ],
    };
    const codes = sandboxIssues(bad, cards).map((i) => `${i.code}:${i.side ?? '-'}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'turn:-',
        'leader:0',
        'unknownCard:0',
        'leaderOutOfPlace:0',
        'notCharacter:0',
        'notStage:0',
        'tooManyCharacters:0',
        'tooManyDon:0',
        'tooManyCards:1',
      ]),
    );
    expect(sandboxIssues(spec, cards)).toEqual([]);
    expect(() => createSandbox(bad, sandboxConfig({ ...spec, turn: 0 }, cards, names))).toThrow(/turn/);
  });

  it('lê a mesa do link: ida e volta pelo JSON, padrões omitidos e lixo recusado', () => {
    const back = parseSandboxSpec(JSON.parse(JSON.stringify(spec)));
    expect(back).toEqual(spec);
    expect(build(back!).players[0].hand).toHaveLength(2);
    // Valores padrão não viajam no link.
    expect(parseSandboxSpec({ turn: 3, active: 1, sides: [{ leader: { id: 'ST01-001', rested: false, don: 0 }, hand: [], characters: [{ id: 'ST01-013', rested: false, don: 0 }] }, { leader: { id: 'ST03-001' } }] })).toEqual({
      turn: 3,
      active: 1,
      sides: [{ leader: { id: 'ST01-001' }, characters: [{ id: 'ST01-013' }] }, { leader: { id: 'ST03-001' } }],
    });
    for (const raw of [
      null,
      'texto',
      { turn: 3, active: 0, sides: [] },
      { turn: 3, active: 2, sides: [{ leader: { id: 'ST01-001' } }, { leader: { id: 'ST03-001' } }] },
      { turn: 3.5, active: 0, sides: [{ leader: { id: 'ST01-001' } }, { leader: { id: 'ST03-001' } }] },
      { turn: 3, active: 0, sides: [{ leader: { id: '<script>' } }, { leader: { id: 'ST03-001' } }] },
      { turn: 3, active: 0, sides: [{ leader: { id: 'ST01-001' }, hand: 'ST01-013' }, { leader: { id: 'ST03-001' } }] },
      { turn: 3, active: 0, sides: [{ leader: { id: 'ST01-001' }, characters: Array(6).fill('ST01-013') }, { leader: { id: 'ST03-001' } }] },
      { turn: 3, active: 0, sides: [{ leader: { id: 'ST01-001' }, donActive: 11 }, { leader: { id: 'ST03-001' } }] },
      { turn: 3, active: 0, sides: [{ leader: { id: 'ST01-001' }, life: 11 }, { leader: { id: 'ST03-001' } }] },
    ]) {
      expect(parseSandboxSpec(raw)).toBeNull();
    }
  });
});
