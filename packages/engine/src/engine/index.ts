// Motor de regras do One Piece Card Game.
//
// Modelo: `applyAction(estado, ação) -> novo estado`. O estado nunca é mutado:
// cada ação trabalha sobre uma cópia. Efeitos, batalhas e dano são "frames" em uma
// pilha (`state.stack`); quando um frame precisa de uma decisão de um jogador, o
// motor para e registra `state.pending` até a próxima ação.
//
// O motor fica dividido por etapa nesta pasta (ver docs/plano-divisao-motor-e-mesa.md):
//   setup       criação da partida e preparação (mulligans, largada, Vida)
//   apply       `applyAction`: a ação da Fase Principal e a resposta a uma pergunta
//   cancel      cancelar a ação em andamento (checkpoint)
//   turn        começo e fim do turno, Renovação, durações
//   stack       a pilha de resolução (`run`) e a entrada de uma carta em campo
//   triggers    efeitos disparados (CR 8-6) e eventos ("When …")
//   battle      batalha e dano
//   effects     um passo de efeito por vez: alvos, perguntas, "cada oponente"
//   exec-step   o que cada passo de efeito faz (`execStep`)
//   costs       custos de habilidade
//   removal     K.O., remoção e os efeitos de substituição
//   zones       mover cartas e DON!! entre as zonas, Vida, comprar
//   defeat      derrota, eliminação e fim de jogo
//   manual      ferramentas manuais (efeitos ainda não automatizados)
//   queries     consultas sobre as cartas: custo, poder, palavras-chave, filtros, auras
//   conditions  condições das habilidades
//   options     o que dá para fazer agora: atacar, jogar, ativar, bloquear, Counter, alvos
//   table       os jogadores da mesa e quem é "o oponente" (mesa de 2 e de mais)
//   messages    perguntas e linhas do histórico
//   constants   tamanhos, limites e tipos dos frames
//
// Quem usa o motor importa daqui (`./engine`); os módulos se importam entre si, e por isso nenhum
// deles roda código que dependa de outro na carga (só declarações).

export { DECK_SIZE, DON_DECK_SIZE, FAR_TURN, HAND_SIZE, IllegalActionError, LIMITED_DECK_SIZE, MAX_CHARACTERS } from './constants';
export {
  alivePlayers,
  isMultiplayer,
  MAX_PLAYERS,
  nextPlayer,
  opponent,
  opponentOf,
  opponentsOf,
  setOpponentProbe,
  turnOrder,
  YONKO_DECK_SIZE,
  YONKO_TABLE,
} from './table';
export {
  aurasOn,
  basePowerOf,
  cardDef,
  counterValue,
  eventCounterPower,
  getCost,
  getPower,
  hasKeyword,
  hasName,
  hasType,
  isNegated,
  leaderRule,
  locate,
  matchesAnyType,
  matchesFilter,
  nameIncludes,
  ownerOf,
  typeIncludes,
} from './queries';
export { conditionHolds } from './conditions';
export {
  activateError,
  attackError,
  blockerOptions,
  bystanderCounterOptions,
  costInHand,
  counterOptions,
  counterTargets,
  isIdle,
  playCost,
  playError,
  restricted,
  targetCandidates,
} from './options';
export { createGame } from './setup';
export { applyAction, cloneState } from './apply';
export { cancelAllowed, cancelError, detachDonError } from './cancel';
export { noRefreshByAura } from './turn';
export { eachOpponent } from './effects';
export { canPayCost, describeCost } from './costs';
export { manualAllowed } from './manual';
export { koProtected, removalBlocked } from './removal';
export { cannotBeRested, inLimbo, zoneOf } from './zones';
