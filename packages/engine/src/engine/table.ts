// Os jogadores da mesa: a ordem dos turnos, quem está vivo e quem é "o oponente" (mesa de dois e de mais).

import type { EffectStep, GameState, PlayerId, PlayerState, TableRules } from '../types';
import type { EffectFrame } from './constants';

/** O outro jogador de uma partida de dois. Com o estado em mãos, prefira `opponentOf` (vale para qualquer mesa). */
export const opponent = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Mesa com mais de dois jogadores (todos contra todos: o formato Yonko, "Four Emperors")
//
// As cartas foram escritas para dois jogadores. O manual do formato (docs/regras-yonko.md) diz como
// ler "your opponent" com mais gente na mesa, e o motor aplica isso a qualquer carta:
//  1. Alvo ("up to 1 of your opponent's Characters"): qualquer alvo legal de qualquer oponente.
//  2. O que mexe na mão, na Vida, nos DON!! ou no deck "do oponente" vale para cada oponente
//     (`eachOpponent`): o passo roda uma vez contra cada um, com a condição dele conferida a cada vez.
//  3. Efeitos contínuos ("give all of your opponent's Characters…") e [Opponent's Turn] valem para
//     todos os oponentes e para o turno de qualquer um deles.
//  4. Condição sobre "your opponent" num efeito que não o atinge: basta um oponente cumprir.
// Com dois jogadores as quatro dão o resultado de sempre: nada aqui muda o jogo normal.
// ---------------------------------------------------------------------------

/** Máximo de jogadores numa mesa. */
export const MAX_PLAYERS = 4;

/** Regras da mesa de Yonko pelo manual do formato (docs/regras-yonko.md); cada sala pode mudar as suas. */
export const YONKO_TABLE: TableRules = { extraLife: 2, curveChoice: true };

/** Deck do Yonko: 60 cartas, uma cópia de cada (ver `validateYonkoDeck`). */
export const YONKO_DECK_SIZE = 60;

/** Mesa com mais de dois jogadores? */
export const isMultiplayer = (state: Pick<GameState, 'players'>): boolean => state.players.length > 2;

/** Os jogadores que continuam na partida, na ordem dos lugares. */
export function alivePlayers(state: GameState): PlayerState[] {
  return isMultiplayer(state) ? state.players.filter((ps) => !ps.out) : state.players;
}

/** Os jogadores vivos na ordem dos turnos, a partir de `from` (ele primeiro, se estiver vivo). */
export function turnOrder(state: GameState, from: PlayerId): PlayerId[] {
  const n = state.players.length;
  const out: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const id = (from + i) % n;
    if (!state.players[id].out) out.push(id);
  }
  return out;
}

/** Os oponentes vivos de `p`, na ordem dos turnos depois dele. */
export function opponentsOf(state: GameState, p: PlayerId): PlayerId[] {
  if (!isMultiplayer(state)) return [opponent(p)];
  return turnOrder(state, p).filter((id) => id !== p);
}

/** Quem joga depois de `p` (pula os eliminados). */
export function nextPlayer(state: GameState, p: PlayerId): PlayerId {
  if (!isMultiplayer(state)) return opponent(p);
  return opponentsOf(state, p)[0] ?? p;
}

/** Oponente fixado para um trecho de código (condições avaliadas contra cada oponente). */
const opponentOverride: Array<{ player: PlayerId; opp: PlayerId }> = [];

export function withOpponent<T>(player: PlayerId, opp: PlayerId, fn: () => T): T {
  opponentOverride.push({ player, opp });
  try {
    return fn();
  } finally {
    opponentOverride.pop();
  }
}

/**
 * Mesa com mais de dois: o oponente de `p` que o contexto fixa, ou undefined se não há um (aí vale
 * "todos os oponentes"). Pela ordem: o oponente contra o qual um passo `eachOpponent` está rodando; o
 * `focus` do efeito de `p` em resolução (os passos escolhidos por um oponente em "Your opponent chooses
 * one"; continua valendo se ele foi eliminado no meio: o resto não acha nada do lado dele); e o único
 * oponente vivo.
 */
export function fixedOpponent(state: GameState, p: PlayerId): PlayerId | undefined {
  for (let i = opponentOverride.length - 1; i >= 0; i--) if (opponentOverride[i].player === p) return opponentOverride[i].opp;
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const f = state.stack[i];
    if (f.kind === 'effect' && f.controller === p && f.focus !== undefined) return f.focus;
  }
  const others = opponentsOf(state, p);
  return others.length === 1 ? others[0] : undefined;
}

/**
 * "Your opponent" do ponto de vista de `p`, quando o código precisa de um só. Com dois jogadores, o
 * outro. Com mais, o que o contexto fixa (`fixedOpponent`); sem contexto, o próximo oponente vivo na
 * ordem dos turnos (os passos de efeito não chegam aqui sem contexto: ver `eachOpponent`).
 */
export function opponentOf(state: GameState, p: PlayerId): PlayerId {
  if (!isMultiplayer(state)) return opponent(p);
  const fixed = fixedOpponent(state, p);
  if (fixed !== undefined) return fixed;
  if (opponentProbe && probeStep) opponentProbe(probeStep.source, probeStep.step);
  return opponentsOf(state, p)[0] ?? (p + 1) % state.players.length;
}

/** O passo de efeito em execução (só para `setOpponentProbe`). */
let probeStep: { source: string; step: EffectStep } | null = null;
let opponentProbe: ((cardId: string, step: EffectStep) => void) | null = null;

/**
 * Diagnóstico da simulação de mesas (scripts/simulate-yonko.ts): avisa quando um passo de efeito
 * pergunta por "o oponente" sem que o contexto fixe um, isto é, um passo que `eachOpponent` deveria
 * rodar contra cada oponente e não conhece. O passo cai então só no próximo oponente da ordem. Cada
 * aviso é um tipo de passo a ensinar a `eachOpponent`.
 */
export function setOpponentProbe(probe: ((cardId: string, step: EffectStep) => void) | null) {
  opponentProbe = probe;
}

/** Com o diagnóstico ligado, guarda o passo de efeito que vai rodar (`null` quando ele termina). */
export function markProbeStep(state: GameState, frame: EffectFrame | null, step?: EffectStep) {
  probeStep = frame && step && opponentProbe ? { source: state.cards[frame.source].cardId, step } : null;
}

/** Os lados "do oponente" para alvos e contagens: o oponente que o contexto fixa, ou todos os oponentes vivos. */
export function opponentSides(state: GameState, p: PlayerId): PlayerId[] {
  if (!isMultiplayer(state)) return [opponent(p)];
  const fixed = fixedOpponent(state, p);
  return fixed !== undefined ? [fixed] : opponentsOf(state, p);
}

/**
 * Roda `test` do ponto de vista de `p` contra o oponente que o contexto fixa; sem um, contra cada
 * oponente vivo, e vale se algum passa ("if your opponent has a Character with 5000 or more power":
 * basta um oponente).
 */
export function anyOpponent(state: GameState, p: PlayerId, test: () => boolean): boolean {
  if (!isMultiplayer(state) || fixedOpponent(state, p) !== undefined) return test();
  const others = opponentsOf(state, p);
  if (!others.length) return test();
  return others.some((o) => withOpponent(p, o, test));
}
