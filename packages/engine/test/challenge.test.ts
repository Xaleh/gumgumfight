import { describe, expect, it } from 'vitest';
import { buildChallenge, type ChallengeSpec, challengeRivalAction, playMoves, resolveMove, runChallenge } from '../src/challenge';
import type { GameConfig } from '../src/types';
import { cards, crocodile, luffy } from './helpers';

const config: GameConfig = {
  seed: 1,
  cards,
  players: [
    { name: 'Você', deck: luffy },
    { name: 'Oponente', deck: crocodile },
  ],
};

/** Letal: o Blocker do oponente tem que ser gasto com o ataque mais fraco. */
const bait: ChallengeSpec = {
  id: 'test-bait',
  goal: 'lethal',
  decks: ['st01-luffy', 'st03-crocodile'],
  seed: 11,
  revealHand: true,
  scenario: {
    turn: 7,
    active: 0,
    sides: [
      { characters: ['ST01-013', 'ST01-003'], donActive: 2, life: 3 },
      { characters: ['ST03-008'], life: ['ST03-009'], donRested: 6 },
    ],
  },
};

/** Sobreviva: três ataques, um Blocker e 3000 de Counter na mão. */
const wall: ChallengeSpec = {
  id: 'test-wall',
  goal: 'survive',
  decks: ['st01-luffy', 'st03-crocodile'],
  seed: 12,
  scenario: {
    turn: 8,
    active: 1,
    sides: [
      { hand: ['ST01-011', 'ST01-008', 'ST01-004'], characters: ['ST01-006'], life: 0, donRested: 6 },
      { characters: ['ST03-012', 'ST03-002'], leader: { don: 1 }, life: 3, donRested: 5 },
    ],
  },
  attacks: [
    { attacker: 'ST03-012', target: 'leader' },
    { attacker: 'leader', target: 'leader' },
    { attacker: 'ST03-002', target: 'leader' },
  ],
};

describe('desafio: letal', () => {
  it('a solução vence: Karoo com 2 DON!! atrai o bloqueio, Líder e Zoro acertam', () => {
    const start = buildChallenge(config, bait);
    const run = playMoves(start, bait, [
      { don: 'ST01-003', n: 2 },
      { attack: 'ST01-003', target: 'leader' },
      { attack: 'leader', target: 'leader' },
      { attack: 'ST01-013', target: 'leader' },
    ]);
    expect(run.error).toBeUndefined();
    expect(run.status).toBe('solved');
    expect(run.state.winner).toBe(0);
  });

  it('o oponente bloqueia o ataque que acertaria o Líder', () => {
    const start = buildChallenge(config, bait);
    const run = playMoves(start, bait, [{ attack: 'leader', target: 'leader' }]);
    expect(run.status).toBe('playing');
    // Law bloqueou e foi K.O.; a Vida continua intacta.
    expect(run.state.players[1].characters).toHaveLength(0);
    expect(run.state.players[1].life).toHaveLength(1);
  });

  it('DON!! no lugar errado falha, e passar a vez sem vencer também', () => {
    const start = buildChallenge(config, bait);
    const run = playMoves(start, bait, [
      { don: 'ST01-013', n: 2 },
      { attack: 'ST01-013', target: 'leader' },
      { attack: 'leader', target: 'leader' },
      { attack: 'ST01-003', target: 'leader' },
      'end',
    ]);
    expect(run.status).toBe('failed');
    expect(run.state.winner).toBeNull();
  });

  it('o oponente usa Counter só quando segura o ataque', () => {
    const spec: ChallengeSpec = {
      ...bait,
      id: 'test-counter',
      scenario: { turn: 7, active: 0, sides: [{ characters: ['ST01-013'], donActive: 2 }, { hand: ['ST03-006'], life: 2 }] },
    };
    // 5000 x 5000: o Counter de 1000 segura.
    let run = playMoves(buildChallenge(config, spec), spec, [{ attack: 'ST01-013', target: 'leader' }]);
    expect(run.state.players[1].life).toHaveLength(2);
    expect(run.state.players[1].hand).toHaveLength(0);
    // 7000 x 5000: não segura, então a carta fica na mão.
    run = playMoves(buildChallenge(config, spec), spec, [{ don: 'ST01-013' }, { attack: 'ST01-013', target: 'leader' }]);
    expect(run.state.players[1].life).toHaveLength(1);
    expect(run.state.players[1].hand.map((u) => run.state.cards[u].cardId)).toContain('ST03-006');
  });
});

describe('desafio: sobreviva', () => {
  it('bloquear o ataque certo e dividir o Counter chega vivo ao próprio turno', () => {
    const start = buildChallenge(config, wall);
    const run = playMoves(start, wall, [{ block: 'ST01-006' }, 'pass', { counter: 'ST01-011' }, 'pass', { counter: 'ST01-008' }, 'pass']);
    expect(run.error).toBeUndefined();
    expect(run.status).toBe('solved');
    expect(run.state.activePlayer).toBe(0);
  });

  it('bloquear o ataque mais fraco deixa um golpe passar', () => {
    const start = buildChallenge(config, wall);
    const run = playMoves(start, wall, [{ block: null }, { counter: 'ST01-011' }, 'pass', { block: null }, { counter: 'ST01-008' }, 'pass']);
    expect(run.status).toBe('failed');
    expect(run.state.winner).toBe(1);
  });

  it('o oponente ataca na ordem do roteiro', () => {
    const start = buildChallenge(config, wall);
    const first = runChallenge(start, wall, []);
    expect(first.status).toBe('playing');
    expect(first.state.pending).toMatchObject({ kind: 'block', player: 0 });
    expect(first.state.cards[first.state.battle!.attacker].cardId).toBe('ST03-012');
    expect(challengeRivalAction(first.state, wall)).toBeNull();
  });
});

describe('runChallenge', () => {
  it('recusa jogada de quem não é o jogador, ferramenta manual e uid inexistente', () => {
    const start = buildChallenge(config, bait);
    expect(runChallenge(start, bait, [{ type: 'endTurn', player: 1 }]).error?.index).toBe(0);
    expect(runChallenge(start, bait, [{ type: 'manual', player: 0, op: { op: 'shuffle' } }]).error).toBeDefined();
    const bad = runChallenge(start, bait, [{ type: 'attack', player: 0, attacker: 'nada', target: 'nada' }]);
    expect(bad.error).toBeDefined();
    expect(bad.status).toBe('playing');
  });

  it('é determinístico: as mesmas jogadas dão a mesma mesa', () => {
    const moves = resolveMove(buildChallenge(config, bait), { don: 'ST01-003', n: 2 });
    const a = runChallenge(buildChallenge(config, bait), bait, moves);
    const b = runChallenge(buildChallenge(config, bait), bait, moves);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('o lado ativo tem que combinar com o objetivo', () => {
    expect(() => buildChallenge(config, { ...bait, goal: 'survive', attacks: [{ attacker: 'leader', target: 'leader' }] })).toThrow();
    expect(() => buildChallenge(config, { ...wall, attacks: [] })).toThrow();
  });
});
