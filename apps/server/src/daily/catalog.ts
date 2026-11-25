// Catálogo do Desafio do dia: os cenários na ordem da fila. Cada dia publicado recebe o próximo desafio ainda não
// usado (depois de usar todos, recomeça pelo usado há mais tempo). Para incluir um desafio, acrescente no fim da lista
// com a solução e uma linha errada: o teste `daily.test.ts` joga as duas contra o servidor.
//
// A solução e a linha errada ficam só aqui (e nos testes): nenhuma rota manda isso para o navegador.

import type { ChallengeMove, ChallengeSpec } from '@gumgum/engine';

export interface CatalogChallenge extends ChallengeSpec {
  /** Jogadas que resolvem o desafio. */
  solution: ChallengeMove[];
  /** Uma tentativa plausível que não resolve (prova que o desafio não é trivial). */
  wrong: ChallengeMove[];
}

const LUFFY_X_CROCODILE: [string, string] = ['st01-luffy', 'st03-crocodile'];

export const DAILY_CATALOG: CatalogChallenge[] = [
  {
    // O Blocker do oponente só bloqueia o que acertaria: o ataque mais fraco precisa dos DON!! para atrair o bloqueio.
    id: 'isca',
    goal: 'lethal',
    level: 1,
    decks: LUFFY_X_CROCODILE,
    seed: 101,
    revealHand: true,
    scenario: {
      turn: 7,
      active: 0,
      sides: [
        { characters: ['ST01-013', 'ST01-003'], donActive: 2, life: 3, deckTop: ['ST01-002'] },
        { characters: ['ST03-008'], life: ['ST03-009'], donRested: 6 },
      ],
    },
    solution: [{ don: 'ST01-003', n: 2 }, { attack: 'ST01-003', target: 'leader' }, { attack: 'leader', target: 'leader' }, { attack: 'ST01-013', target: 'leader' }],
    wrong: [{ don: 'ST01-013', n: 2 }, { attack: 'ST01-013', target: 'leader' }, { attack: 'leader', target: 'leader' }, { attack: 'ST01-003', target: 'leader' }, 'end'],
  },
  {
    // Três ataques, um Blocker e Counter contado: bloqueie um dos de 6000 e divida o resto.
    id: 'muralha',
    goal: 'survive',
    level: 2,
    decks: LUFFY_X_CROCODILE,
    seed: 102,
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
    solution: [{ block: 'ST01-006' }, 'pass', { counter: 'ST01-011' }, 'pass', { counter: 'ST01-008' }, 'pass'],
    wrong: [{ block: null }, { counter: 'ST01-011' }, 'pass', { block: null }, { counter: 'ST01-008' }, 'pass'],
  },
  {
    // Usopp com DON!! x2 tira o Crocodile (6000) do bloqueio; com 3 DON!! ele ainda acerta o Líder.
    id: 'usopp',
    goal: 'lethal',
    level: 1,
    decks: LUFFY_X_CROCODILE,
    seed: 103,
    revealHand: true,
    scenario: {
      turn: 9,
      active: 0,
      sides: [
        { characters: ['ST01-002', 'ST01-013'], donActive: 3, life: 2, deckTop: ['ST01-003'] },
        { characters: ['ST03-003'], life: ['ST03-010'], donRested: 7 },
      ],
    },
    solution: [{ don: 'ST01-002', n: 3 }, { attack: 'ST01-002', target: 'leader' }, { attack: 'leader', target: 'leader' }, { attack: 'ST01-013', target: 'leader' }],
    wrong: [{ don: 'leader', n: 3 }, { attack: 'leader', target: 'leader' }, { attack: 'ST01-013', target: 'leader' }, { attack: 'ST01-002', target: 'leader' }, 'end'],
  },
  {
    // DON!! em espera: o Líder e a Nami dão DON!! descansados. A conta certa passa pelos 2000 de Counter na mão.
    id: 'reforco',
    goal: 'lethal',
    level: 2,
    decks: LUFFY_X_CROCODILE,
    seed: 104,
    revealHand: true,
    scenario: {
      turn: 9,
      active: 0,
      sides: [
        { characters: ['ST01-013', 'ST01-007'], donActive: 1, donRested: 2, life: 2, deckTop: ['ST01-009'] },
        { hand: ['ST03-006', 'ST03-011'], life: ['ST03-008'], donRested: 7 },
      ],
    },
    solution: [
      { don: 'ST01-013' },
      { activate: 'leader' },
      { choose: ['leader'] },
      { activate: 'ST01-007' },
      { choose: ['leader'] },
      { attack: 'ST01-013', target: 'leader' },
      { attack: 'leader', target: 'leader' },
    ],
    wrong: [
      { don: 'leader' },
      { activate: 'leader' },
      { choose: ['ST01-013'] },
      { activate: 'ST01-007' },
      { choose: ['ST01-013'] },
      { attack: 'ST01-013', target: 'leader' },
      { attack: 'leader', target: 'leader' },
      'end',
    ],
  },
  {
    // Guard Point custa 1 DON!! e vale +3000: guarde para o ataque que o Karoo não segura.
    id: 'guarda',
    goal: 'survive',
    level: 2,
    decks: LUFFY_X_CROCODILE,
    seed: 105,
    scenario: {
      turn: 10,
      active: 1,
      sides: [
        { hand: ['ST01-014', 'ST01-003', 'ST01-004'], characters: ['ST01-006'], life: 0, donActive: 1, donRested: 7 },
        { characters: ['ST03-012', 'ST03-002'], leader: { don: 2 }, life: 2, donRested: 6 },
      ],
    },
    attacks: [
      { attacker: 'ST03-012', target: 'leader' },
      { attacker: 'ST03-002', target: 'leader' },
      { attacker: 'leader', target: 'leader' },
    ],
    solution: [{ block: 'ST01-006' }, 'pass', { counter: 'ST01-003' }, 'pass', { counter: 'ST01-014' }, { choose: ['leader'] }, 'pass'],
    wrong: [{ block: 'ST01-006' }, 'pass', { counter: 'ST01-014' }, { choose: ['leader'] }, 'pass', { counter: 'ST01-003' }, 'pass'],
  },
  {
    // Dois Blockers e 2000 de Counter: Diable Jambe tira o bloqueio, e os DON!! que sobram passam do Counter.
    id: 'jambe',
    goal: 'lethal',
    level: 2,
    decks: LUFFY_X_CROCODILE,
    seed: 106,
    revealHand: true,
    scenario: {
      turn: 11,
      active: 0,
      sides: [
        { hand: ['ST01-016', 'ST01-004'], donActive: 3, life: 1, deckTop: ['ST01-005'] },
        { hand: ['ST03-005'], characters: ['ST03-008', 'ST03-013'], life: 0, donRested: 8 },
      ],
    },
    solution: [{ play: 'ST01-016' }, { choose: ['leader'] }, { don: 'leader', n: 2 }, { attack: 'leader', target: 'leader' }],
    wrong: [{ play: 'ST01-004' }, { don: 'leader' }, { attack: 'leader', target: 'leader' }, 'end'],
  },
  {
    // Evento de Counter na mão aberta: o oponente paga o Love-Love Mellow (+4000) no primeiro ataque que acertaria.
    // Gaste o Evento com um ataque fraco e guarde a força para os dois golpes que faltam.
    id: 'mellow',
    goal: 'lethal',
    level: 2,
    decks: LUFFY_X_CROCODILE,
    seed: 107,
    revealHand: true,
    defense: { eventCounters: true },
    scenario: {
      turn: 9,
      active: 0,
      sides: [
        { characters: ['ST01-013', 'ST01-003'], donActive: 3, life: 2, deckTop: ['ST01-004'] },
        { hand: ['ST03-017'], life: ['ST03-003'], deckTop: ['ST03-009'], donActive: 2, donRested: 6 },
      ],
    },
    solution: [
      { don: 'ST01-003', n: 2 },
      { attack: 'ST01-003', target: 'leader' },
      { don: 'leader' },
      { attack: 'leader', target: 'leader' },
      { attack: 'ST01-013', target: 'leader' },
    ],
    wrong: [{ don: 'ST01-013' }, { attack: 'ST01-013', target: 'leader' }, { don: 'leader', n: 2 }, { attack: 'leader', target: 'leader' }, { attack: 'ST01-003', target: 'leader' }, 'end'],
  },
];
