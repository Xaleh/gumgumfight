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

describe('desafio: defensor configurável', () => {
  const lethal = (opp: ChallengeSpec['scenario']['sides'][1], me: ChallengeSpec['scenario']['sides'][0], defense?: ChallengeSpec['defense']): ChallengeSpec => ({
    id: 'test-defense',
    goal: 'lethal',
    decks: ['st01-luffy', 'st03-crocodile'],
    seed: 21,
    scenario: { turn: 7, active: 0, sides: [me, opp] },
    ...(defense ? { defense } : {}),
  });
  const ids = (s: ReturnType<typeof buildChallenge>, uids: string[]) => uids.map((u) => s.cards[u].cardId);

  it('com Eventos de Counter ligados, paga o Love-Love Mellow e põe os +4000 no Líder atacado', () => {
    const me = { characters: [{ id: 'ST01-013', don: 1 }] };
    const opp = { hand: ['ST03-017'], life: 2, donActive: 2 };
    // 7000 contra 5000: sem Evento, acerta.
    const off = lethal(opp, me);
    let run = playMoves(buildChallenge(config, off), off, [{ attack: 'ST01-013', target: 'leader' }]);
    expect(run.state.players[1].life).toHaveLength(1);
    expect(ids(run.state, run.state.players[1].trash)).not.toContain('ST03-017');
    // Ligado: segura, o Evento vai para o descarte e os 2 DON!! são pagos.
    const on = lethal(opp, me, { eventCounters: true });
    run = playMoves(buildChallenge(config, on), on, [{ attack: 'ST01-013', target: 'leader' }]);
    expect(run.error).toBeUndefined();
    expect(run.state.players[1].life).toHaveLength(2);
    expect(ids(run.state, run.state.players[1].trash)).toContain('ST03-017');
    expect(run.state.players[1].donActive).toBe(0);
  });

  it('sem DON!! para pagar, o Evento não entra', () => {
    const spec = lethal({ hand: ['ST03-017'], life: 2, donActive: 1 }, { characters: [{ id: 'ST01-013', don: 1 }] }, { eventCounters: true });
    const run = playMoves(buildChallenge(config, spec), spec, [{ attack: 'ST01-013', target: 'leader' }]);
    expect(run.state.players[1].life).toHaveLength(1);
  });

  it('Evento só entra se o total segura o ataque, e o Counter de Personagem vem antes no empate', () => {
    // 9000 contra 5000: falta 4001; Love-Love (+4000) sozinho não segura, com o Jinbe (1000) segura.
    const spec = lethal({ hand: ['ST03-017', 'ST03-006'], life: 2, donActive: 2 }, { characters: [{ id: 'ST01-013', don: 3 }] }, { eventCounters: true });
    const run = playMoves(buildChallenge(config, spec), spec, [{ attack: 'ST01-013', target: 'leader' }]);
    expect(run.state.players[1].life).toHaveLength(2);
    expect(ids(run.state, run.state.players[1].trash).sort()).toEqual(['ST03-006', 'ST03-017']);
  });

  it('com Trigger ligado, a Hancock da Vida entra em campo e bloqueia o ataque seguinte', () => {
    const me = { characters: ['ST01-013'], leader: { don: 1 } };
    const opp = { life: ['ST03-013'] };
    const moves = [{ attack: 'ST01-013', target: 'leader' }, { attack: 'leader', target: 'leader' }] as const;
    const off = lethal(opp, me);
    expect(playMoves(buildChallenge(config, off), off, [...moves]).status).toBe('solved');
    const on = lethal(opp, me, { triggers: true });
    const run = playMoves(buildChallenge(config, on), on, [...moves]);
    expect(run.status).toBe('playing');
    expect(run.state.winner).toBeNull();
    expect(ids(run.state, run.state.players[1].trash)).toContain('ST03-013');
  });

  it('Trigger de dano (Sables) devolve o atacante à mão de quem resolve', () => {
    const spec = lethal({ life: ['ST03-002', 'ST03-015'] }, { characters: ['ST01-013', 'ST01-008'] }, { triggers: true });
    const run = playMoves(buildChallenge(config, spec), spec, [{ attack: 'ST01-013', target: 'leader' }]);
    expect(run.error).toBeUndefined();
    expect(ids(run.state, run.state.players[0].hand)).toContain('ST01-013');
    expect(ids(run.state, run.state.players[0].characters.map((c) => c.uid))).toEqual(['ST01-008']);
  });
});
