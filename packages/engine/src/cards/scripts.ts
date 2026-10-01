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

/** "up to 1 Character" sem dono especificado: personagem de qualquer jogador. */
const anyChar = (extra: Partial<TargetSpec> = {}): TargetSpec => ({
  side: 'any',
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

  // ------------------------------------------------------------ ST03 The Seven Warlords of the Sea (azul)
  // Sem efeito: ST03-002 Edward Weevil, ST03-006 Jinbe, ST03-011 Buggy, ST03-012 Pacifista.
  // ST03-008 Trafalgar Law: só [Blocker].
  'ST03-001': {
    // [Activate: Main] [Once Per Turn] DON!! −4: Return up to 1 Character with a cost of 5 or less to the owner's hand.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { donMinus: 4 },
        label: 'DON!! −4: devolver personagem de custo até 5',
        steps: [{ do: 'returnToHand', target: anyChar({ maxCost: 5 }) }],
      },
    ],
  },
  'ST03-003': {
    // [Blocker] / [DON!! x1] [On Block] Place up to 1 Character with a cost of 2 or less at the bottom of the owner's deck.
    keywords: ['blocker'],
    abilities: [{ timing: 'onBlock', don: 1, steps: [{ do: 'toDeckBottom', target: anyChar({ maxCost: 2 }) }] }],
  },
  'ST03-004': {
    // [On Play] Add up to 1 {The Seven Warlords of the Sea} or {Thriller Bark Pirates} type Character with a cost of 4
    // or less other than [Gecko Moria] from your trash to your hand. (O texto da API diz "or less than [Gecko Moria]".)
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          {
            do: 'fromTrashToHand',
            upTo: 1,
            filter: {
              category: 'character',
              maxCost: 4,
              hasAnyType: ['The Seven Warlords of the Sea', 'Thriller Bark Pirates'],
              excludeName: 'Gecko Moria',
            },
          },
        ],
      },
    ],
  },
  'ST03-005': {
    // [DON!! x1] [When Attacking] Draw 2 cards and trash 2 cards from your hand.
    abilities: [
      {
        timing: 'whenAttacking',
        don: 1,
        steps: [
          { do: 'draw', count: 2 },
          { do: 'trashFromHand', count: 2 },
        ],
      },
    ],
  },
  'ST03-007': {
    // [DON!! x1] [Activate: Main] [Once Per Turn] ②: Play up to 1 [Pacifista] with a cost of 4 or less from your deck,
    // then shuffle your deck.
    abilities: [
      {
        timing: 'activateMain',
        don: 1,
        oncePerTurn: true,
        cost: { restDon: 2 },
        label: '②: jogar [Pacifista] do deck',
        steps: [
          { do: 'playFrom', from: 'deck', upTo: 1, filter: { name: 'Pacifista', maxCost: 4 } },
          { do: 'shuffleDeck' },
        ],
      },
    ],
  },
  'ST03-009': {
    // [On Play] Return up to 1 Character with a cost of 7 or less to the owner's hand.
    abilities: [{ timing: 'onPlay', steps: [{ do: 'returnToHand', target: anyChar({ maxCost: 7 }) }] }],
  },
  'ST03-010': {
    // [On Play] Look at 3 cards from the top of your deck and return them to the top or bottom of the deck in any order.
    // [Trigger] Play this card.
    abilities: [
      { timing: 'onPlay', steps: [{ do: 'arrangeTop', look: 3 }] },
      { timing: 'trigger', steps: [{ do: 'playThis' }] },
    ],
  },
  'ST03-013': {
    // [Blocker] / [Trigger] Play this card.
    keywords: ['blocker'],
    abilities: [{ timing: 'trigger', steps: [{ do: 'playThis' }] }],
  },
  'ST03-014': {
    // [On Play] Return up to 1 Character with a cost of 3 or less to the owner's hand.
    abilities: [{ timing: 'onPlay', steps: [{ do: 'returnToHand', target: anyChar({ maxCost: 3 }) }] }],
  },
  'ST03-015': {
    // [Main] Return up to 1 Character with a cost of 7 or less to the owner's hand. [Trigger] Activate this card's [Main] effect.
    abilities: [
      { timing: 'main', steps: [{ do: 'returnToHand', target: anyChar({ maxCost: 7 }) }] },
      { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
    ],
  },
  'ST03-016': {
    // [Counter] Return up to 1 Character with a cost of 3 or less to the owner's hand.
    // [Trigger] Activate this card's [Counter] effect.
    abilities: [
      { timing: 'counter', steps: [{ do: 'returnToHand', target: anyChar({ maxCost: 3 }) }] },
      { timing: 'trigger', steps: [{ do: 'useCounterEffect' }] },
    ],
  },
  'ST03-017': {
    // [Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle.
    // Then, draw 1 card if you have 3 or less cards in your hand.
    abilities: [
      {
        timing: 'counter',
        steps: [
          { do: 'power', target: ownLeaderOrChar(), amount: 4000, duration: 'battle' },
          { do: 'draw', count: 1, if: { handMax: 3 } },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ ST04 Animal Kingdom Pirates (roxo)
  // Sem efeito: ST04-007 Sheepshead, ST04-009 Ginrummy, ST04-012 Page One, ST04-013 X.Drake.
  // ST04-011 Black Maria: só [Blocker].
  'ST04-001': {
    // [Activate: Main] [Once Per Turn] DON!! −7: Trash up to 1 of your opponent's Life cards.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { donMinus: 7 },
        label: 'DON!! −7: descartar 1 Vida do oponente',
        steps: [{ do: 'trashLife', side: 'opponent', count: 1 }],
      },
    ],
  },
  'ST04-002': {
    // [On Play] DON!! −1: Play up to 1 [Page One] card with a cost of 4 or less from your hand.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'playFrom', from: 'hand', upTo: 1, filter: { name: 'Page One', maxCost: 4 } },
        ],
      },
    ],
  },
  'ST04-003': {
    // [On Play] DON!! −5: K.O. up to 1 of your opponent's Characters with a cost of 6 or less.
    // This Character gains [Rush] during this turn.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { donMinus: 5 } },
          { do: 'ko', target: oppChar({ maxCost: 6 }) },
          { do: 'gainKeyword', target: 'self', keyword: 'rush', duration: 'turn' },
        ],
      },
    ],
  },
  'ST04-004': {
    // [On Play] DON!! −1: K.O. up to 1 of your opponent's Characters with a cost of 4 or less.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'ko', target: oppChar({ maxCost: 4 }) },
        ],
      },
    ],
  },
  'ST04-005': {
    // [Blocker] / [On Play] DON!! −1: Draw 2 cards and trash 1 card from your hand.
    keywords: ['blocker'],
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'draw', count: 2 },
          { do: 'trashFromHand', count: 1 },
        ],
      },
    ],
  },
  'ST04-006': {
    // [On Play] DON!! −1: Draw 1 card.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'draw', count: 1 },
        ],
      },
    ],
  },
  'ST04-008': {
    // [On Play] You may trash 1 card from your hand: Add up to 1 DON!! card from your DON!! deck and set it as active.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { trashFromHand: 1 } },
          { do: 'addDonFromDeck', count: 1 },
        ],
      },
    ],
  },
  'ST04-010': {
    // [On Play] DON!! −1: K.O. up to 1 of your opponent's Characters with a cost of 3 or less. [Trigger] Play this card.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'ko', target: oppChar({ maxCost: 3 }) },
        ],
      },
      { timing: 'trigger', steps: [{ do: 'playThis' }] },
    ],
  },
  'ST04-014': {
    // [Main] Draw 1 card, then add up to 1 DON!! card from your DON!! deck and set it as active.
    // [Trigger] Activate this card's [Main] effect.
    abilities: [
      {
        timing: 'main',
        steps: [
          { do: 'draw', count: 1 },
          { do: 'addDonFromDeck', count: 1 },
        ],
      },
      { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
    ],
  },
  'ST04-015': {
    // [Main] K.O. up to 1 of your opponent's Characters with a cost of 6 or less, then add up to 1 DON!! card from your
    // DON!! deck and set it as active. [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active.
    abilities: [
      {
        timing: 'main',
        steps: [
          { do: 'ko', target: oppChar({ maxCost: 6 }) },
          { do: 'addDonFromDeck', count: 1 },
        ],
      },
      { timing: 'trigger', steps: [{ do: 'addDonFromDeck', count: 1 }] },
    ],
  },
  'ST04-016': {
    // [Counter] DON!! −1: Up to 1 of your Leader or Character cards gains +4000 power during this battle.
    abilities: [
      {
        timing: 'counter',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'power', target: ownLeaderOrChar(), amount: 4000, duration: 'battle' },
        ],
      },
    ],
  },
  'ST04-017': {
    // [Activate: Main] You may rest this Stage: If your Leader has the {Animal Kingdom Pirates} type, add up to 1 DON!!
    // card from your DON!! deck and rest it.
    abilities: [
      {
        timing: 'activateMain',
        cost: { restSelf: true },
        label: 'Virar: +1 DON!! virado',
        steps: [{ do: 'addDonFromDeck', count: 1, rested: true, if: { leaderHasType: 'Animal Kingdom Pirates' } }],
      },
    ],
  },

  // ------------------------------------------------------------ ST05 ONE PIECE FILM edition (roxo)
  // Sem efeito: ST05-007 Gordon, ST05-012 Baccarat, ST05-013 Bins, ST05-015 Dr. Indigo. ST05-003 Ann: só [Blocker].
  'ST05-001': {
    // [Activate: Main] [Once Per Turn] DON!! −3: All of your {FILM} type Characters gain +2000 power during this turn.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { donMinus: 3 },
        label: 'DON!! −3: +2000 a todos os {FILM}',
        steps: [
          {
            do: 'power',
            target: { side: 'own', kinds: ['character'], upTo: 99, hasAnyType: ['FILM'], all: true },
            amount: 2000,
            duration: 'turn',
          },
        ],
      },
    ],
  },
  'ST05-002': {
    // [On Play] Add up to 1 DON!! card from your DON!! deck and rest it.
    abilities: [{ timing: 'onPlay', steps: [{ do: 'addDonFromDeck', count: 1, rested: true }] }],
  },
  'ST05-004': {
    // [Blocker] / [On Block] DON!! −1: Rest up to 1 of your opponent's Characters with a cost of 5 or less.
    keywords: ['blocker'],
    abilities: [
      {
        timing: 'onBlock',
        steps: [
          { do: 'payCost', cost: { donMinus: 1 } },
          { do: 'rest', target: oppChar({ maxCost: 5 }) },
        ],
      },
    ],
  },
  'ST05-005': {
    // [Activate: Main] [Once Per Turn] You may rest this Character and trash 1 {FILM} type card from your hand: If your
    // opponent has more DON!! cards on their field than you, add 2 DON!! cards from your DON!! deck and rest them.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { restSelf: true, trashFromHand: 1, trashFilter: { hasAnyType: ['FILM'] } },
        label: 'Virar + descartar {FILM}: +2 DON!! virados',
        steps: [{ do: 'addDonFromDeck', count: 2, rested: true, if: { opponentMoreDon: true } }],
      },
    ],
  },
  'ST05-006': {
    // [When Attacking] DON!! −2: Draw 2 cards.
    abilities: [
      {
        timing: 'whenAttacking',
        steps: [
          { do: 'payCost', cost: { donMinus: 2 } },
          { do: 'draw', count: 2 },
        ],
      },
    ],
  },
  'ST05-008': {
    // If you have 8 or more DON!! cards on your field, this Character cannot be K.O.'d in battle.
    abilities: [{ timing: 'static', condition: { minDonOnField: 8 }, staticNoBattleKO: true, steps: [] }],
  },
  'ST05-009': {
    // [Trigger] Play this card.
    abilities: [{ timing: 'trigger', steps: [{ do: 'playThis' }] }],
  },
  'ST05-010': {
    // When this Character battles "Strike" attribute Characters, this Character gains +3000 power during this turn.
    // [Activate: Main] [Once Per Turn] DON!! −1: This Character gains +2000 power during this turn.
    // (O bônus contra Strike vale durante a batalha, que é quando o poder importa.)
    abilities: [
      { timing: 'static', battleVsAttribute: { attribute: 'Strike', power: 3000 }, steps: [] },
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { donMinus: 1 },
        label: 'DON!! −1: +2000 de poder',
        steps: [{ do: 'power', target: 'self', amount: 2000, duration: 'turn' }],
      },
    ],
  },
  'ST05-011': {
    // [Activate: Main] [Once Per Turn] DON!! −4: Rest up to 2 of your opponent's Characters with a cost of 6 or less.
    // Then, this Character gains [Double Attack] during this turn.
    abilities: [
      {
        timing: 'activateMain',
        oncePerTurn: true,
        cost: { donMinus: 4 },
        label: 'DON!! −4: virar 2 e ganhar [Double Attack]',
        steps: [
          { do: 'rest', target: oppChar({ maxCost: 6, upTo: 2 }) },
          { do: 'gainKeyword', target: 'self', keyword: 'doubleAttack', duration: 'turn' },
        ],
      },
    ],
  },
  'ST05-014': {
    // [On Play] Look at 5 cards from the top of your deck; reveal up to 1 {FILM} type card other than [Buena Festa] and
    // add it to your hand. Then, place the rest at the bottom of your deck in any order.
    abilities: [
      {
        timing: 'onPlay',
        steps: [
          { do: 'search', look: 5, upTo: 1, filter: { hasAnyType: ['FILM'], excludeName: 'Buena Festa' }, rest: 'bottom' },
        ],
      },
    ],
  },
  'ST05-016': {
    // [Main] DON!! −2: K.O. up to 1 of your opponent's Characters with a cost of 5 or less.
    // [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active.
    abilities: [
      {
        timing: 'main',
        steps: [
          { do: 'payCost', cost: { donMinus: 2 } },
          { do: 'ko', target: oppChar({ maxCost: 5 }) },
        ],
      },
      { timing: 'trigger', steps: [{ do: 'addDonFromDeck', count: 1 }] },
    ],
  },
  'ST05-017': {
    // [Counter] Up to 1 of your {FILM} type Leader or Character cards gains +4000 power during this battle. If that card
    // is a Character, that Character cannot be K.O.'d during this turn.
    // [Trigger] Add up to 1 DON!! card from your DON!! deck and set it as active.
    abilities: [
      {
        timing: 'counter',
        steps: [
          { do: 'power', target: ownLeaderOrChar({ hasAnyType: ['FILM'] }), amount: 4000, duration: 'battle' },
          { do: 'cannotBeKO', target: 'chosen', duration: 'turn' },
        ],
      },
      { timing: 'trigger', steps: [{ do: 'addDonFromDeck', count: 1 }] },
    ],
  },
};
