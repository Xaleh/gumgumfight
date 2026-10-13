import { describe, expect, it } from 'vitest';
import { applyAction, attackError, getPower } from '../src/engine';
import { createScenario, passiveAction } from '../src/scenario';
import type { GameConfig, GameState, PlayerId } from '../src/types';
import { cards, countCards, countDon, crocodile, luffy } from './helpers';

const config: GameConfig = {
  seed: 7,
  cards,
  players: [
    { name: 'Você', deck: luffy },
    { name: 'Bot', deck: crocodile, isBot: true },
  ],
};

const idOf = (s: GameState, uid: string) => s.cards[uid].cardId;

describe('createScenario', () => {
  it('monta as áreas pedidas mantendo 51 cartas e 10 DON!! por jogador', () => {
    const s = createScenario(config, {
      turn: 5,
      active: 0,
      sides: [
        {
          hand: ['ST01-013', 'ST01-007'],
          characters: ['ST01-008', { id: 'ST01-006', rested: true, don: 1 }],
          stage: 'ST01-017',
          life: 3,
          deckTop: ['ST01-010'],
          trash: ['ST01-014'],
          donActive: 4,
          donRested: 2,
        },
        { characters: [{ id: 'ST03-011', rested: true }], life: ['ST03-002', 'ST03-015'] },
      ],
    });
    expect(s.phase).toBe('main');
    expect(s.pending).toBeNull();
    expect(s.turn).toBe(5);
    expect(s.activePlayer).toBe(0);
    expect(s.firstPlayer).toBe(0);
    const me = s.players[0];
    expect(me.hand.map((u) => idOf(s, u))).toEqual(['ST01-013', 'ST01-007']);
    expect(me.characters.map((c) => idOf(s, c.uid))).toEqual(['ST01-008', 'ST01-006']);
    expect(me.characters[1]).toMatchObject({ rested: true, don: 1 });
    expect(idOf(s, me.stage!.uid)).toBe('ST01-017');
    expect(me.life).toHaveLength(3);
    expect(idOf(s, me.deck[0])).toBe('ST01-010');
    expect(me.trash.map((u) => idOf(s, u))).toEqual(['ST01-014']);
    expect(me).toMatchObject({ donActive: 4, donRested: 2, donDeck: 3 });
    const bot = s.players[1];
    expect(bot.hand).toHaveLength(0);
    expect(bot.life.map((u) => idOf(s, u))).toEqual(['ST03-002', 'ST03-015']);
    for (const p of [0, 1] as PlayerId[]) {
      expect(countCards(s, p)).toBe(51);
      expect(countDon(s, p)).toBe(10);
      const all = [...s.players[p].hand, ...s.players[p].deck, ...s.players[p].life, ...s.players[p].trash];
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('Personagem antigo ataca; recém-jogado não', () => {
    const s = createScenario(config, {
      turn: 3,
      active: 0,
      sides: [{ characters: ['ST01-013', { id: 'ST01-008', fresh: true }] }, {}],
    });
    const [zoro, robin] = s.players[0].characters.map((c) => c.uid);
    const leader = s.players[1].leader.uid;
    expect(attackError(s, 0, zoro, leader)).toBeNull();
    expect(attackError(s, 0, robin, leader)).not.toBeNull();
  });

  it('o jogo segue normalmente a partir do cenário (jogar carta, atacar, passar o turno)', () => {
    let s = createScenario(config, {
      turn: 3,
      active: 0,
      sides: [{ hand: ['ST01-013'], characters: ['ST01-008'], donActive: 3 }, { life: 2 }],
    });
    const zoro = s.players[0].hand[0];
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    expect(s.players[0].donActive).toBe(0);
    expect(s.players[0].donRested).toBe(3);
    const robin = s.players[0].characters[0].uid;
    s = applyAction(s, { type: 'attack', player: 0, attacker: robin, target: s.players[1].leader.uid });
    for (let i = 0; i < 10 && s.pending?.player === 1; i++) s = applyAction(s, passiveAction(s, 1)!);
    expect(s.players[1].life).toHaveLength(1);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    for (let i = 0; i < 10 && s.activePlayer === 1; i++) s = applyAction(s, passiveAction(s, 1)!);
    expect(s.activePlayer).toBe(0);
    expect(s.turn).toBe(5);
    // Refresh: os DON!! voltam ativos e chegam mais 2.
    expect(s.players[0].donActive).toBe(5);
    expect(getPower(s, robin)).toBe(5000);
  });

  it('recusa cartas que o deck não tem', () => {
    expect(() => createScenario(config, { turn: 3, active: 0, sides: [{ hand: ['ST03-002'] }, {}] })).toThrow(/ST03-002/);
    expect(() => createScenario(config, { turn: 3, active: 0, sides: [{ donActive: 11 }, {}] })).toThrow(/DON/);
  });
});
