// Scripts de efeito por ID de carta, escritos com a DSL de `types.ts`.
//
// Cada script segue o texto oficial da carta (optcgapi). Cartas sem script
// usam o modo manual (efeito aplicado pelo jogador); cartas sem texto não precisam de script.
// Palavras-chave no início do texto ([Blocker], [Rush]...) são detectadas sozinhas.

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
  // ------------------------------------------------------------ ST01 Straw Hat Crew (vermelho)
  // Sem efeito: ST01-003 Karoo, ST01-008 Nico Robin, ST01-009 Nefeltari Vivi, ST01-010 Franky.
  'ST01-001': {
    // [Activate: Main] [Once Per Turn] Give this Leader or 1 of your Characters up to 1 rested DON!! card.
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
    // [DON!! x2] [When Attacking] Your opponent cannot activate a [Blocker] Character that has 5000 or more power during this battle.
    // [Trigger] Play this card.
    abilities: [
      { timing: 'whenAttacking', don: 2, steps: [{ do: 'noBlockerThisBattle', minPower: 5000 }] },
      { timing: 'trigger', steps: [{ do: 'playThis' }] },
    ],
  },
  'ST01-004': {
    // [DON!! x2] This Character gains [Rush].
    abilities: [{ timing: 'static', don: 2, staticKeyword: 'rush', steps: [] }],
  },
  'ST01-005': {
    // [DON!! x1] [When Attacking] Up to 1 of your Leader or Character cards other than this card gains +1000 power during this turn.
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
    // [Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to your Leader or 1 of your Characters.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        label: 'Dar 1 DON!! virado',
        steps: [{ do: 'giveRestedDon', target: ownLeaderOrChar(), count: 1 }],
      },
    ],
  },
  'ST01-011': {
    // [On Play] Give up to 2 rested DON!! cards to your Leader or 1 of your Characters.
    abilities: [{ timing: 'onPlay', steps: [{ do: 'giveRestedDon', target: ownLeaderOrChar(), count: 2 }] }],
  },
  'ST01-012': {
    // [Rush] / [DON!! x2] [When Attacking] Your opponent cannot activate [Blocker] during this battle.
    keywords: ['rush'],
    abilities: [{ timing: 'whenAttacking', don: 2, steps: [{ do: 'noBlockerThisBattle' }] }],
  },
  'ST01-013': {
    // [DON!! x1] This Character gains +1000 power.
    abilities: [{ timing: 'static', don: 1, staticPower: 1000, steps: [] }],
  },
  'ST01-014': {
    // [Counter] Up to 1 of your Leader or Character cards gains +3000 power during this battle.
    // [Trigger] Up to 1 of your Leader or Character cards gains +1000 power during this turn.
    abilities: [
      { timing: 'counter', steps: [{ do: 'power', target: ownLeaderOrChar(), amount: 3000, duration: 'battle' }] },
      { timing: 'trigger', steps: [{ do: 'power', target: ownLeaderOrChar(), amount: 1000, duration: 'turn' }] },
    ],
  },
  'ST01-015': {
    // [Main] K.O. up to 1 of your opponent's Characters with 6000 power or less. [Trigger] Activate this card's [Main] effect.
    abilities: [
      { timing: 'main', steps: [{ do: 'ko', target: oppChar({ maxPower: 6000 }) }] },
      { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
    ],
  },
  'ST01-016': {
    // [Main] Select up to 1 of your {Straw Hat Crew} type Leader or Character cards. Your opponent cannot activate
    // [Blocker] if that Leader or Character attacks during this turn.
    // [Trigger] K.O. up to 1 of your opponent's [Blocker] Characters with a cost of 3 or less.
    abilities: [
      {
        timing: 'main',
        steps: [{ do: 'noBlockerWhenAttacking', target: ownLeaderOrChar({ hasType: 'Straw Hat Crew' }) }],
      },
      { timing: 'trigger', steps: [{ do: 'ko', target: oppChar({ maxCost: 3, keyword: 'blocker' }) }] },
    ],
  },
  'ST01-017': {
    // [Activate: Main] You may rest this Stage: Up to 1 {Straw Hat Crew} type Leader or Character card on your field
    // gains +1000 power during this turn.
    abilities: [
      {
        timing: 'activateMain',
        cost: { restSelf: true },
        label: 'Virar: +1000 de poder',
        steps: [
          { do: 'power', target: ownLeaderOrChar({ hasType: 'Straw Hat Crew' }), amount: 1000, duration: 'turn' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ ST02 Worst Generation (verde)
  // Sem efeito: ST02-002 Vito, ST02-006 Koby, ST02-011 Heat, ST02-012 Bepo. ST02-004 Capone"Gang"Bege: só [Blocker].
  'ST02-001': {
    // [Activate: Main] [Once Per Turn] ③ You may trash 1 card from your hand: Set this Leader as active.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { restDon: 3, trashFromHand: 1 },
        label: '③ + descartar 1: desvirar este Líder',
        steps: [{ do: 'setActive', target: 'self' }],
      },
    ],
  },
  'ST02-003': {
    // [DON!! x1] If you have 3 or more Characters, this card gains +2000 power.
    abilities: [{ timing: 'static', don: 1, condition: { minCharacters: 3 }, staticPower: 2000, steps: [] }],
  },
  'ST02-005': {
    // [On Play] K.O. up to 1 of your opponent's rested Characters with a cost of 3 or less. [Trigger] Play this card.
    abilities: [
      { timing: 'onPlay', steps: [{ do: 'ko', target: oppChar({ maxCost: 3, rested: true }) }] },
      { timing: 'trigger', steps: [{ do: 'playThis' }] },
    ],
  },
  'ST02-007': {
    // [Activate: Main] ① You may rest this card: Look at 5 cards from the top of your deck; reveal up to 1 {Supernovas}
    // type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.
    abilities: [
      {
        timing: 'activateMain',
        cost: { restDon: 1, restSelf: true },
        label: '① Virar: buscar {Supernovas} no topo',
        steps: [{ do: 'search', look: 5, upTo: 1, filter: { hasAnyType: ['Supernovas'] }, rest: 'bottom' }],
      },
    ],
  },
  'ST02-008': {
    // [DON!! x1] [When Attacking] Rest up to 1 of your opponent's DON!! cards.
    abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ do: 'restOpponentDon', count: 1 }] }],
  },
  'ST02-009': {
    // [On Play] Set up to 1 of your {Supernovas} or {Heart Pirates} type rested Characters with a cost of 5 or less as active.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          {
            do: 'setActive',
            target: {
              side: 'own',
              kinds: ['character'],
              upTo: 1,
              rested: true,
              maxCost: 5,
              hasAnyType: ['Supernovas', 'Heart Pirates'],
            },
          },
        ],
      },
    ],
  },
  'ST02-010': {
    // [DON!! x1] [Once Per Turn] [Your Turn] If this Character battles your opponent's Character, set this card as active.
    abilities: [
      {
        timing: 'battlesCharacter',
        don: 1,
        oncePerTurn: true,
        yourTurn: true,
        steps: [{ do: 'setActive', target: 'self' }],
      },
    ],
  },
  'ST02-013': {
    // [Blocker] / [DON!! x1] [End of Your Turn] Set this card as active.
    keywords: ['blocker'],
    abilities: [{ timing: 'endOfTurn', don: 1, steps: [{ do: 'setActive', target: 'self' }] }],
  },
  'ST02-014': {
    // [DON!! x1] [Your Turn] If this Character is rested, your {Supernovas} or {Navy} type Leaders and Characters gain +1000 power.
    abilities: [
      {
        timing: 'static',
        don: 1,
        yourTurn: true,
        condition: { selfRested: true },
        aura: { kinds: ['leader', 'character'], hasAnyType: ['Supernovas', 'Navy'], power: 1000 },
        steps: [],
      },
    ],
  },
  'ST02-015': {
    // [Counter] Up to 1 of your Leader or Character cards gains +2000 power during this battle. Then, set up to 1 of your
    // DON!! cards as active. [Trigger] Set up to 2 of your DON!! cards as active.
    abilities: [
      {
        timing: 'counter',
        steps: [
          { do: 'power', target: ownLeaderOrChar(), amount: 2000, duration: 'battle' },
          { do: 'setDonActive', count: 1 },
        ],
      },
      { timing: 'trigger', steps: [{ do: 'setDonActive', count: 2 }] },
    ],
  },
  'ST02-016': {
    // [Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, set up to 1 of your
    // DON!! cards as active.
    abilities: [
      {
        timing: 'counter',
        steps: [
          { do: 'power', target: ownLeaderOrChar(), amount: 4000, duration: 'battle' },
          { do: 'setDonActive', count: 1 },
        ],
      },
    ],
  },
  'ST02-017': {
    // [Main] Rest up to 1 of your opponent's Characters.
    abilities: [{ timing: 'main', steps: [{ do: 'rest', target: oppChar() }] }],
  },
};
