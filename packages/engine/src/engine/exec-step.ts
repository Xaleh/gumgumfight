// `execStep`: o começo de todo passo de efeito (o "If X, …" e o "Then" que depende dele) e o despacho para o
// executor da família do passo, em ./steps (ver docs/plano-divisao-motor-e-mesa.md, fase 2).

import type { Condition, EffectStep, GameState } from '../types';
import type { EffectFrame } from './constants';
import { lg, log, msgOf } from './messages';
import { cardDef } from './queries';
import { conditionFailure } from './conditions';
import { stepConditionMet } from './effects';
import { execPowerStep } from './steps/power';
import { execFieldStep } from './steps/field';
import { execDonStep } from './steps/don';
import { execHandStep } from './steps/hand';
import { execDeckStep } from './steps/deck';
import { execLifeStep } from './steps/life';
import { execPlayStep } from './steps/play';
import { execChoiceStep } from './steps/choice';

/** Condições internas do leitor (dependem da escolha anterior), que não são "a condição da carta". */
const INTERNAL_CONDITIONS: Array<keyof Condition> = ['lastDone', 'lastKOd', 'chosenMatches', 'revealedHasChosenCost'];

export function execStep(state: GameState, frame: EffectFrame, step: EffectStep): boolean {
  const ps = state.players[frame.controller];
  const srcName = cardDef(state, frame.source).name;
  const fresh = !frame.choice && !frame.memo;
  // "If X, A. Then, B.": com o "if" falho, o "Then" também não acontece (CR 4-10-2, OP06-116).
  if (fresh && step.afterIf && frame.ifFailed) {
    if (step.do === 'payCost' && step.scope) frame.i += step.scope;
    return true;
  }
  const met = !fresh || stepConditionMet(state, frame, step);
  // Só um "If X, …" conta para o "Then" ("If you do" é outra regra).
  if (fresh && step.if && Object.keys(step.if).some((k) => k !== 'lastDone' && k !== 'lastKOd')) frame.ifFailed = !met;
  if (!met) {
    // "If you have 2 or less Characters, play…": a condição da carta não vale. O histórico diz
    // o motivo (o jogador costuma achar que o efeito falhou, ou que a carta que queria escolher
    // não servia). Condições internas (depende da escolha anterior) continuam silenciosas.
    const cond = step.if;
    if (cond && Object.keys(cond).some((k) => !INTERNAL_CONDITIONS.includes(k as keyof Condition))) {
      const why = conditionFailure(state, frame.controller, frame.source, cond);
      const text = `${srcName}: a condição não vale (${why.text}), o efeito não acontece.`;
      if (state.log[state.log.length - 1]?.text !== text) {
        log(state, frame.controller, lg('conditionFails', text, { source: srcName, reason: why.text }, { reason: { items: [msgOf(why)] } }), { cards: [frame.source] });
      }
    }
    // "If that card is a [Sabo] …, you may play that card. If you do, …" (ST13-007): sem a condição, o
    // "you may" não acontece, e o "If you do" (o trecho do `scope`) também não.
    if (step.do === 'payCost' && step.scope) frame.i += step.scope;
    return true;
  }
  // O que o passo faz fica no executor da família dele (./steps): um `case` por tipo de passo, aqui e lá. Um passo
  // novo sem `case` aqui, ou fora do tipo da família, não compila.
  switch (step.do) {
    case 'power':
    case 'noBlockerThisBattle':
    case 'noBlockerWhenAttacking':
    case 'gainKeyword':
    case 'cannotBeKO':
    case 'cost':
    case 'skipRefresh':
    case 'anyNumberForPower':
    case 'skipRefreshDon':
    case 'powerPerDon':
    case 'powerPerMatching':
    case 'powerPerRevealedCost':
    case 'gainAttribute':
    case 'attackTax':
    case 'negateOnPlay':
    case 'cannotAttackCharacters':
    case 'restDonForPower':
    case 'swapBasePower':
    case 'cannotBlock':
    case 'negate':
    case 'restrict':
    case 'nextPlayDiscount':
    case 'basePower':
    case 'setPowerZero':
    case 'trashAnyForPower':
    case 'redirectAttack':
    case 'cannotBeRested':
    case 'canAttackActive':
    case 'cannotAttack':
      return execPowerStep(state, frame, step, ps, srcName);
    case 'ko':
    case 'rest':
    case 'setActive':
    case 'returnToHand':
    case 'restOwn':
    case 'returnOwn':
    case 'koOwn':
    case 'trashOwn':
    case 'selfToDeckBottom':
    case 'trashTarget':
    case 'trashSelf':
    case 'returnSelfToHand':
    case 'ownToBottom':
    case 'replaceRest':
    case 'tempReplace':
    case 'opponentChoosesOwn':
    case 'koSelf':
    case 'replaceRemoval':
    case 'removeFromField':
    case 'replaceDamage':
    case 'restOwnCharacters':
    case 'addThisToHand':
    case 'toDeckBottom':
      return execFieldStep(state, frame, step, ps, srcName);
    case 'giveRestedDon':
    case 'addDonFromDeck':
    case 'restOpponentDon':
    case 'setDonActive':
    case 'returnDonChoice':
    case 'returnDon':
    case 'restDonOrCharacter':
    case 'giveActiveDon':
    case 'moveGivenDon':
    case 'opponentAddDon':
    case 'donMatchOpponent':
    case 'returnGivenDon':
    case 'opponentReturnsDon':
      return execDonStep(state, frame, step, ps, srcName);
    case 'draw':
    case 'trashFromHand':
    case 'opponentDiscards':
    case 'trashRandomFromOpponentHand':
    case 'revealFromHand':
    case 'drawPerMatching':
    case 'trashEventCount':
    case 'opponentPicksFromHand':
    case 'revealOpponentHand':
    case 'handAllToDeck':
    case 'opponentDraws':
    case 'trashHand':
    case 'trashHandUntil':
    case 'drawEventCount':
    case 'handToDeck':
    case 'opponentHandToBottom':
    case 'handToDeckBottom':
    case 'drawUntil':
      return execHandStep(state, frame, step, ps, srcName);
    case 'search':
    case 'tutor':
    case 'trashToDeckBottom':
    case 'revealTop':
    case 'revealedToHand':
    case 'opponentTrashToBottom':
    case 'revealOpponentTop':
    case 'revealedToTopOrBottom':
    case 'lastToDeckTop':
    case 'lookOpponentTop':
    case 'revealedToBottom':
    case 'millDeck':
    case 'fromTrashToHand':
    case 'shuffleDeck':
    case 'arrangeTop':
      return execDeckStep(state, frame, step, ps, srcName);
    case 'trashLife':
    case 'lifeToTrash':
    case 'lifeFace':
    case 'arrangeLife':
    case 'opponentLifeToBottom':
    case 'takeDamage':
    case 'lifeTrashUntil':
    case 'trashFaceUpLife':
    case 'lifeOneToDeckTop':
    case 'revealLifeTop':
    case 'opponentLifeToHand':
    case 'lifeToHand':
    case 'handToLife':
    case 'fieldToLife':
    case 'peekLife':
    case 'addLifeFromDeck':
      return execLifeStep(state, frame, step, ps, srcName);
    case 'playThis':
    case 'playRevealed':
    case 'handPlayOrLife':
    case 'winGame':
    case 'extraTurn':
    case 'opponentPlays':
    case 'activateEventFromTrash':
    case 'activateEventFromHand':
    case 'activateTriggerFromHand':
    case 'delayed':
    case 'useOwnEffect':
    case 'useMainEffect':
    case 'useCounterEffect':
    case 'playFrom':
      return execPlayStep(state, frame, step, ps, srcName);
    case 'manual':
    case 'payCost':
    case 'select':
    case 'chooseCost':
    case 'opponentMay':
    case 'payEither':
    case 'chooseOne':
      return execChoiceStep(state, frame, step, ps, srcName);
  }
}
