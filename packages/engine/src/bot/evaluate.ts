// Função de avaliação do bot: quanto a posição é boa para `player`, em "pontos de poder"
// (1000 ≈ o valor de +1000 de poder num ataque). Positivo = bom para `player`.
//
// Cada termo nasce de um conceito de tempo do jogo (ver docs/bot-tempo.md):
// - Vida como recurso: a tabela `life` é côncava — a primeira Vida perdida vale pouco (e ainda
//   dá uma carta), as últimas valem muito.
// - Vantagem de cartas: cada carta na mão vale `handCard`; a do oponente desconta.
// - Tabuleiro: custo, poder e palavras-chave dos Personagens em campo; o Personagem virado no
//   fim do turno fica exposto ao contra-ataque.
// - DON!!: cada DON!! em campo é tempo permanente (DON!! −X custa de verdade).
// - Deck: ficar sem cartas perde a partida.
//
// A função lê só a visão (`viewFor`): cartas escondidas aparecem como `?` e contam pelo número.

import { cardDef, counterValue, getPower, hasKeyword, opponent, playCost } from '../engine';
import { HIDDEN_CARD } from '../view';
import type { GameState, PlayerId, PlayerState } from '../types';

export interface Weights {
  /** Valor acumulado de ter N cartas de Vida (índice = N; além do fim, soma `lifeExtra` por carta). */
  life: number[];
  lifeExtra: number;
  /** Carta na própria mão que o bot não vê (ex.: a que acabou de sair da Vida) e carta na mão do oponente. */
  handCard: number;
  handCardOpp: number;
  /** Carta visível na própria mão: valor fixo mais o Counter impresso (por 1000) e o bônus de Evento [Counter] pagável. */
  handCardBase: number;
  handCounter: number;
  handCounterEvent: number;
  /** Acima deste tamanho, cada carta a mais na mão vale metade (não dá para jogar tudo). */
  handSoftCap: number;
  /** Personagem em campo: por ponto de custo, fixo por corpo e por 1000 de poder base. */
  charCost: number;
  charBase: number;
  charPower: number;
  /** Palavras-chave em campo. */
  blocker: number;
  rush: number;
  doubleAttack: number;
  /** Stage em campo. */
  stage: number;
  /** Personagem virado quando o turno passa para o oponente: fica exposto ao ataque dele. */
  exposed: number;
  /** DON!! em campo (área de custo + anexados), por unidade. */
  don: number;
  /**
   * No meio do próprio turno: DON!! anexado a uma carta que ainda pode atacar. Some no fim do turno
   * (os DON!! voltam na Renovação); serve só para a busca não descartar "anexar" antes de "atacar".
   */
  donReady: number;
  /** Deck quase vazio (≤ `deckLowAt` cartas). */
  deckLow: number;
  deckLowAt: number;
  /** Partida decidida. */
  win: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  life: [0, 14000, 22000, 27500, 31500, 34700],
  lifeExtra: 2800,
  handCard: 2500,
  handCardOpp: 2500,
  handCardBase: 1500,
  handCounter: 500,
  handCounterEvent: 900,
  handSoftCap: 7,
  charCost: 1000,
  charBase: 1000,
  charPower: 250,
  blocker: 1500,
  rush: 300,
  doubleAttack: 800,
  stage: 2000,
  exposed: 0.3,
  don: 1200,
  donReady: 300,
  deckLow: 25000,
  deckLowAt: 2,
  win: 10_000_000,
};

function lifeValue(w: Weights, n: number): number {
  if (n < w.life.length) return w.life[n];
  return w.life[w.life.length - 1] + (n - (w.life.length - 1)) * w.lifeExtra;
}

/**
 * Valor da mão. A do oponente conta pelo tamanho; a própria, carta a carta: um Counter impresso defende, um
 * Evento [Counter] só vale se sobrar DON!! ativo para pagá-lo no turno do oponente (guardar DON!! é tempo).
 */
function handValue(state: GameState, w: Weights, ps: PlayerState, hidden: number): number {
  let total = 0;
  const values = ps.hand.map((uid) => {
    const def = cardDef(state, uid);
    if (def.id === HIDDEN_CARD) return hidden;
    let v = w.handCardBase + (counterValue(state, uid) / 1000) * w.handCounter;
    if (def.category === 'event' && def.abilities.some((a) => a.timing === 'counter') && playCost(state, uid) <= ps.donActive) v += w.handCounterEvent;
    return v;
  });
  values.sort((a, b) => b - a);
  values.forEach((v, i) => (total += i < w.handSoftCap ? v : v * 0.5));
  return total;
}

/** Valor de um Personagem (ou Stage) em campo, pelos dados da carta e palavras-chave. */
export function fieldCardValue(state: GameState, w: Weights, uid: string): number {
  const def = cardDef(state, uid);
  if (def.category === 'stage') return w.stage;
  let v = w.charBase + (def.cost ?? 0) * w.charCost + ((def.power ?? 0) / 1000) * w.charPower;
  if (hasKeyword(state, uid, 'blocker')) v += w.blocker;
  if (hasKeyword(state, uid, 'rush')) v += w.rush;
  if (hasKeyword(state, uid, 'doubleAttack')) v += w.doubleAttack;
  return v;
}

function sideValue(state: GameState, w: Weights, ps: PlayerState, hidden: number, exposedToOpponent: boolean): number {
  let v = lifeValue(w, ps.life.length);
  const myTurn = state.activePlayer === ps.id;
  if (myTurn && state.turn > 2) {
    for (const c of [ps.leader, ...ps.characters]) {
      if (!c.rested && c.don && (c.playedOnTurn !== state.turn || hasKeyword(state, c.uid, 'rush'))) v += c.don * w.donReady;
    }
  }
  v += handValue(state, w, ps, hidden);
  for (const c of ps.characters) {
    const cv = fieldCardValue(state, w, c.uid);
    v += cv;
    // No turno do oponente, o Personagem virado pode ser atacado: só vale inteiro se sobreviver.
    if (exposedToOpponent && c.rested) {
      const threat = getPower(state, state.players[opponent(ps.id)].leader.uid) + 2000;
      if (getPower(state, c.uid) <= threat) v -= cv * w.exposed;
    }
  }
  if (ps.stage) v += fieldCardValue(state, w, ps.stage.uid);
  const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
  v += (ps.donActive + ps.donRested + attached) * w.don;
  if (ps.deck.length <= w.deckLowAt) v -= w.deckLow;
  return v;
}

/**
 * Avaliação da posição para `player`. Pode ser chamada em qualquer momento (meio do turno, meio
 * de uma batalha); compare só avaliações feitas no mesmo ponto da resolução.
 */
export function evaluate(state: GameState, player: PlayerId, w: Weights = DEFAULT_WEIGHTS): number {
  if (state.phase === 'gameover') {
    if (state.winner === null) return 0;
    return state.winner === player ? w.win : -w.win;
  }
  const me = state.players[player];
  const opp = state.players[opponent(player)];
  const oppTurn = state.activePlayer !== player;
  return sideValue(state, w, me, w.handCard, oppTurn) - sideValue(state, w, opp, w.handCardOpp, !oppTurn);
}
