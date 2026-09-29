// Scripts de efeito por ID de carta, escritos com a DSL de `types.ts`.
//
// ATENÇÃO: os scripts abaixo foram escritos a partir de memória para os decks
// iniciais de teste (ST01 e ST02). Depois que os dados oficiais forem importados
// da API, cada script precisa ser conferido contra o texto real da carta.

import type { CardScript, TargetSpec } from '../types';

const ownLeaderOrChar = (extra: Partial<TargetSpec> = {}): TargetSpec => ({
  side: 'own',
  kinds: ['leader', 'character'],
  upTo: 1,
  ...extra,
});

const oppChar = (extra: Partial<TargetSpec> = {}): TargetSpec => ({
  side: 'opponent',
  kinds: ['character'],
  upTo: 1,
  ...extra,
});

export const CARD_SCRIPTS: Record<string, CardScript> = {
  // ------------------------------------------------------------ ST01 (vermelho)
  'ST01-001': {
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        label: 'Dar 1 DON!! virado',
        steps: [{ do: 'giveRestedDon', target: ownLeaderOrChar(), count: 1 }],
      },
    ],
  },
  'ST01-002': {
    abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ do: 'noBlockerThisBattle', minPower: 5000 }] }],
  },
  'ST01-003': {
    abilities: [
      {
        timing: 'activateMain',
        cost: { restSelf: true },
        label: 'Virar: dar 1 DON!! virado',
        steps: [{ do: 'giveRestedDon', target: ownLeaderOrChar(), count: 1 }],
      },
    ],
  },
  'ST01-004': { abilities: [{ timing: 'static', don: 2, staticKeyword: 'rush', steps: [] }] },
  'ST01-005': {
    abilities: [
      {
        timing: 'whenAttacking',
        don: 1,
        steps: [{ do: 'power', target: ownLeaderOrChar({ excludeSelf: true }), amount: 1000, duration: 'turn' }],
      },
    ],
  },
  'ST01-006': { keywords: ['blocker'], abilities: [] },
  'ST01-007': {
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        label: 'Dar 1 DON!! virado',
        steps: [{ do: 'giveRestedDon', target: ownLeaderOrChar(), count: 1 }],
      },
    ],
  },
  'ST01-008': {
    abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ do: 'ko', target: oppChar({ maxPower: 2000 }) }] }],
  },
  'ST01-009': { abilities: [] },
  'ST01-010': { abilities: [{ timing: 'static', don: 1, staticCanAttackActive: true, steps: [] }] },
  'ST01-011': {
    abilities: [{ timing: 'onPlay', steps: [{ do: 'giveRestedDon', target: ownLeaderOrChar(), count: 2 }] }],
  },
  'ST01-012': {
    keywords: ['rush'],
    abilities: [{ timing: 'whenAttacking', don: 2, steps: [{ do: 'noBlockerThisBattle' }] }],
  },
  'ST01-013': { abilities: [{ timing: 'static', don: 1, staticPower: 1000, steps: [] }] },
  'ST01-014': {
    abilities: [
      { timing: 'counter', steps: [{ do: 'power', target: ownLeaderOrChar(), amount: 3000, duration: 'battle' }] },
      { timing: 'trigger', steps: [{ do: 'power', target: ownLeaderOrChar(), amount: 1000, duration: 'turn' }] },
    ],
  },
  'ST01-015': {
    abilities: [
      { timing: 'main', steps: [{ do: 'ko', target: oppChar({ maxPower: 6000 }) }] },
      { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
    ],
  },
  'ST01-016': {
    abilities: [
      {
        timing: 'main',
        steps: [{ do: 'noBlockerWhenAttacking', target: ownLeaderOrChar({ hasType: 'Straw Hat Crew' }) }],
      },
      { timing: 'trigger', steps: [{ do: 'ko', target: oppChar({ maxCost: 3, keyword: 'blocker' }) }] },
    ],
  },
  'ST01-017': {
    abilities: [
      {
        timing: 'activateMain',
        cost: { restSelf: true },
        label: 'Virar: +1000 de poder',
        steps: [
          {
            do: 'power',
            target: ownLeaderOrChar({ hasType: 'Straw Hat Crew' }),
            amount: 1000,
            duration: 'turn',
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ ST02 (verde)
  'ST02-001': {
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { restDon: 3 },
        label: '③: Desvirar este Líder',
        steps: [{ do: 'setActive', target: 'self' }],
      },
    ],
  },
  'ST02-002': { abilities: [] },
  'ST02-003': {
    abilities: [{ timing: 'onPlay', steps: [{ do: 'rest', target: oppChar({ maxCost: 4 }) }] }],
  },
  'ST02-004': {
    abilities: [
      { timing: 'whenAttacking', don: 1, steps: [{ do: 'ko', target: oppChar({ maxCost: 3, rested: true }) }] },
    ],
  },
  'ST02-005': {
    abilities: [
      {
        timing: 'activateMain',
        cost: { restSelf: true, restDon: 1 },
        label: '① Virar: virar personagem (custo ≤2)',
        steps: [{ do: 'rest', target: oppChar({ maxCost: 2 }) }],
      },
    ],
  },
  'ST02-006': {
    abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ do: 'restOpponentDon', count: 1 }] }],
  },
  'ST02-007': { keywords: ['blocker'], abilities: [] },
  'ST02-008': { abilities: [] },
  'ST02-009': { keywords: ['blocker'], abilities: [] },
  'ST02-010': { abilities: [{ timing: 'static', don: 1, staticPower: 1000, steps: [] }] },
  'ST02-011': {
    abilities: [{ timing: 'onPlay', steps: [{ do: 'ko', target: oppChar({ maxCost: 3, rested: true }) }] }],
  },
  'ST02-012': { abilities: [{ timing: 'static', don: 1, staticKeyword: 'doubleAttack', steps: [] }] },
  'ST02-013': {
    abilities: [
      { timing: 'main', steps: [{ do: 'power', target: ownLeaderOrChar(), amount: 4000, duration: 'turn' }] },
      { timing: 'trigger', steps: [{ do: 'rest', target: oppChar({ maxCost: 4 }) }] },
    ],
  },
  'ST02-014': {
    abilities: [
      { timing: 'counter', steps: [{ do: 'power', target: ownLeaderOrChar(), amount: 3000, duration: 'battle' }] },
      { timing: 'trigger', steps: [{ do: 'rest', target: oppChar({ maxCost: 4 }) }] },
    ],
  },
  'ST02-015': {
    abilities: [
      { timing: 'main', steps: [{ do: 'rest', target: oppChar({ maxCost: 4 }) }] },
      { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
    ],
  },
};
