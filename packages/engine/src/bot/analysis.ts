// Análise da partida (roadmap B1, docs/plano-analise-partida.md): a revisão depois do jogo, como a do chess.com.
//
// O replay é refeito ação por ação e, em cada decisão de um jogador que tinha escolha de verdade, o planejador do
// bot (`scoreDecision`) compara a jogada feita com a melhor jogada que ele acha, os dois na escala da avaliação
// (`evaluate.ts`: 1000 ≈ +1000 de poder num ataque). A diferença é a perda da jogada; acima dos limites de
// `ANALYSIS_LIMITS` ela vira um marcador (imprecisão, erro, erro grave) com a jogada sugerida e um tipo ("o letal
// era outro", "Counter desperdiçado", "atacar o Líder era melhor"…). O resumo dá a precisão de cada jogador.
//
// A análise só usa o que o jogador sabia: cada decisão é avaliada sobre `viewFor(estado, jogador)`, a mesma
// visão com que o bot joga (a mão e o deck do oponente chegam como cartas escondidas). Ela só roda num replay
// terminado: numa partida em andamento, a jogada sugerida contaria a quem assiste o que há na mão de quem joga.

import { legalActions } from '../actions';
import { applyAction, opponent } from '../engine';
import type { Action, GameState, Pending, PlayerId } from '../types';
import { actionFromView, identityAliases, viewFor } from '../view';
import { DEFAULT_WEIGHTS } from './evaluate';
import { type PlannerOptions, plannerOptions, sameAction, scoreDecision } from './planner';

/** Versão do formato da análise (sobe quando a régua muda, para a análise guardada ser refeita). */
export const ANALYSIS_VERSION = 1;

/** Gravidade de uma decisão, pela perda (ver `ANALYSIS_LIMITS`). */
export type AnalysisSeverity = 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/**
 * O que a jogada sugerida fazia de diferente: `lethal` (a melhor linha vencia a partida e a feita não),
 * `wastedCounter` / `missedCounter` (usou Counter sem precisar / deixou de usar), `badBlock` / `missedBlock`,
 * `attackLeader` / `attackCharacter` (o mesmo atacante num alvo melhor), `endedEarly` (encerrou o turno com
 * jogada melhor por fazer), `trigger` (a carta de Vida), `better` (qualquer outra).
 */
export type AnalysisTag =
  | 'lethal'
  | 'wastedCounter'
  | 'missedCounter'
  | 'badBlock'
  | 'missedBlock'
  | 'attackLeader'
  | 'attackCharacter'
  | 'endedEarly'
  | 'trigger'
  | 'better';

/** Perda mínima (na escala da avaliação) de cada gravidade. Uma carta da mão vale perto de 3.000–4.000. */
export const ANALYSIS_LIMITS = { inaccuracy: 1500, mistake: 4000, blunder: 10000 } as const;

/** Teto da perda de uma decisão na precisão (um letal perdido vale até `winCap`, e engoliria o resto da partida). */
export const LOSS_CAP = 30000;

/** Escala da precisão: uma decisão com perda `ACCURACY_SCALE` vale ~37%. */
const ACCURACY_SCALE = 6000;

/** Uma decisão analisada. As ações estão nos uids reais do replay. */
export interface DecisionReview {
  /** Posição da ação no roteiro do replay (a ação feita é `actions[index]`; a mesa na posição `index` mostra a decisão). */
  index: number;
  player: PlayerId;
  turn: number;
  /** `turn`: jogada da fase principal; `pending`: resposta a uma escolha (bloquear, Counter, alvos…). */
  kind: 'turn' | 'pending';
  /** O tipo da escolha pendente, quando é uma. */
  pending?: Pending['kind'];
  played: Action;
  /** A jogada sugerida (a primeira ação) e o resto da linha que a busca previu. */
  best: Action[];
  bestScore: number;
  playedScore: number;
  /** Quanto a jogada feita perdeu (≥ 0). */
  loss: number;
  severity: AnalysisSeverity;
  /** Só nos marcadores (gravidade acima de `good`). */
  tag?: AnalysisTag;
  /** Precisão desta decisão (0 a 100). */
  accuracy: number;
}

export interface PlayerAnalysis {
  /** Decisões analisadas (as que tinham escolha). */
  decisions: number;
  /** Média da precisão das decisões (0 a 100; null sem decisão analisada). */
  accuracy: number | null;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  /** Letais perdidos (marcadores `lethal`). */
  lethalsMissed: number;
}

export interface MatchAnalysis {
  version: number;
  /** Todas as decisões analisadas, na ordem do replay. */
  reviews: DecisionReview[];
  /** Os marcadores: as decisões com gravidade acima de `good`. */
  marks: DecisionReview[];
  players: [PlayerAnalysis, PlayerAnalysis];
}

export interface AnalysisOptions {
  /** Só as decisões destes jogadores (padrão: os dois). */
  players?: PlayerId[];
  /** Opções do planejador (padrão: o `hard`, com 150 ms por busca e sorteios fixos por decisão). */
  planner?: Partial<PlannerOptions>;
  /** Progresso: decisões analisadas até aqui, o total e a análise da última (null se não deu para analisar). */
  onProgress?: (done: number, total: number, review: DecisionReview | null) => void;
}

/** O replay não termina com a partida decidida (ou o motor recusa uma ação): não dá para analisar. */
export class AnalysisError extends Error {
  constructor(readonly code: 'notFinished' | 'invalid') {
    super(code === 'notFinished' ? 'A análise só vale para replays terminados.' : 'O motor recusou uma ação do replay.');
  }
}

/** Ações que não são decisões de jogo (correções, desistência, relógio) e não se analisam. */
const SKIPPED = new Set<Action['type']>(['mulligan', 'cancel', 'detachDon', 'concede', 'timeout', 'manual', 'judge', 'manualDone']);

/** A decisão de `action` no estado `state` tinha escolha de verdade (mais de uma ação de jogo legal)? */
export function isDecision(state: GameState, action: Action): boolean {
  if (SKIPPED.has(action.type) || state.phase === 'gameover') return false;
  const p = state.pending;
  if (p && (p.player !== action.player || p.kind === 'mulligan' || p.kind === 'chooseFirst' || p.kind === 'manual')) return false;
  if (!p && (state.phase !== 'main' || state.activePlayer !== action.player)) return false;
  return legalActions(state, action.player).filter((a) => !SKIPPED.has(a.type)).length > 1;
}

/** Gravidade pela perda. */
export function severityOf(loss: number): AnalysisSeverity {
  if (loss >= ANALYSIS_LIMITS.blunder) return 'blunder';
  if (loss >= ANALYSIS_LIMITS.mistake) return 'mistake';
  if (loss >= ANALYSIS_LIMITS.inaccuracy) return 'inaccuracy';
  return 'good';
}

/** Precisão de uma decisão pela perda (100 = a melhor jogada). */
export function accuracyOf(loss: number): number {
  return Math.round(1000 * Math.exp(-Math.min(Math.max(0, loss), LOSS_CAP) / ACCURACY_SCALE)) / 10;
}

/** A linha vence a partida (pela simulação, ou com a vitória provável que a busca pontua com `winCap`)? */
const wins = (end: GameState, score: number, player: PlayerId) => (end.phase === 'gameover' && end.winner === player) || score >= DEFAULT_WEIGHTS.winCap / 2;

/** O tipo do marcador: o que a jogada sugerida fazia de diferente. */
function tagOf(state: GameState, player: PlayerId, played: Action, best: Action[], bestWins: boolean, playedWins: boolean): AnalysisTag {
  if (bestWins && !playedWins) return 'lethal';
  const first = best[0];
  const kind = state.pending?.kind;
  if (kind === 'counter') {
    if (played.type === 'counter' && first?.type === 'pass') return 'wastedCounter';
    if (played.type === 'pass' && first?.type === 'counter') return 'missedCounter';
  }
  if (kind === 'block' && played.type === 'choose' && first?.type === 'choose') {
    if (!played.uids.length && first.uids.length) return 'missedBlock';
    if (played.uids.length && !first.uids.length) return 'badBlock';
  }
  if (kind === 'lifeCard') return 'trigger';
  if (played.type === 'attack') {
    const attack = best.find((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack' && a.attacker === played.attacker);
    if (attack && attack.target !== played.target) return attack.target === state.players[opponent(player)].leader.uid ? 'attackLeader' : 'attackCharacter';
  }
  if (played.type === 'endTurn' && first && first.type !== 'endTurn') return 'endedEarly';
  return 'better';
}

/** Gerador simples e determinístico (mulberry32): a mesma decisão sempre dá a mesma análise. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Analisa a decisão `action` (a ação `index` do replay) no estado completo `state`. Monta a visão de quem decide
 * e só ela entra no planejador. null quando a decisão não tinha escolha ou não é simulável.
 */
export function reviewDecision(state: GameState, index: number, action: Action, opts: Partial<PlannerOptions> = {}): DecisionReview | null {
  if (!isDecision(state, action)) return null;
  const player = action.player;
  const aliases = identityAliases(state);
  const view = viewFor(state, player, aliases);
  const planner = plannerOptions('hard', { timeBudgetMs: 150, random: seeded(index * 7919 + 17), ...opts });
  const scored = scoreDecision(view, player, action, planner);
  if (!scored) return null;
  const toReal = (a: Action): Action => {
    const r = actionFromView(state, aliases, a);
    return typeof r === 'string' ? a : r;
  };
  const same = sameAction(scored.best.actions[0] ?? action, action);
  const loss = same ? 0 : Math.max(0, scored.best.score - scored.played.score);
  const severity = severityOf(loss);
  const best = (same ? scored.played : scored.best).actions;
  const review: DecisionReview = {
    index,
    player,
    turn: state.turn,
    kind: scored.kind,
    ...(state.pending ? { pending: state.pending.kind } : {}),
    played: action,
    // Só a primeira ação da linha é traduzida com certeza (as seguintes podem citar cartas ainda escondidas).
    best: best.map((a, i) => (i === 0 ? toReal(a) : a)),
    bestScore: scored.best.score,
    playedScore: scored.played.score,
    loss: Math.round(loss),
    severity,
    accuracy: accuracyOf(loss),
  };
  if (severity !== 'good') {
    review.tag = tagOf(state, player, action, best, wins(scored.best.end, scored.best.score, player), wins(scored.played.end, scored.played.score, player));
  }
  return review;
}

/** O resumo da análise a partir das decisões analisadas. */
export function summarizeAnalysis(reviews: DecisionReview[]): MatchAnalysis {
  const players = ([0, 1] as PlayerId[]).map((p): PlayerAnalysis => {
    const mine = reviews.filter((r) => r.player === p);
    return {
      decisions: mine.length,
      accuracy: mine.length ? Math.round((mine.reduce((n, r) => n + r.accuracy, 0) / mine.length) * 10) / 10 : null,
      inaccuracies: mine.filter((r) => r.severity === 'inaccuracy').length,
      mistakes: mine.filter((r) => r.severity === 'mistake').length,
      blunders: mine.filter((r) => r.severity === 'blunder').length,
      lethalsMissed: mine.filter((r) => r.tag === 'lethal').length,
    };
  }) as [PlayerAnalysis, PlayerAnalysis];
  return { version: ANALYSIS_VERSION, reviews, marks: reviews.filter((r) => r.severity !== 'good'), players };
}

/**
 * As posições do replay que são decisões a analisar (ver `isDecision`). Refaz a partida inteira: lança
 * `AnalysisError` se o motor recusar uma ação ou se a partida não terminar decidida.
 */
export function decisionIndexes(initial: GameState, actions: readonly Action[], players: PlayerId[] = [0, 1]): number[] {
  let s = initial;
  const out: number[] = [];
  for (const [i, a] of actions.entries()) {
    if (players.includes(a.player) && isDecision(s, a)) out.push(i);
    try {
      s = applyAction(s, a);
    } catch {
      throw new AnalysisError('invalid');
    }
  }
  if (s.phase !== 'gameover') throw new AnalysisError('notFinished');
  return out;
}

/**
 * Analisa um replay terminado (o roteiro já convertido por `upgradeReplayActions`). Síncrono e pesado (uma ou
 * duas buscas do bot por decisão): no navegador roda num Web Worker, com o progresso em `onProgress`.
 */
export function analyzeReplay(initial: GameState, actions: readonly Action[], opts: AnalysisOptions = {}): MatchAnalysis {
  const indexes = new Set(decisionIndexes(initial, actions, opts.players));
  const reviews: DecisionReview[] = [];
  let s = initial;
  let done = 0;
  for (const [i, a] of actions.entries()) {
    if (indexes.has(i)) {
      const r = reviewDecision(s, i, a, opts.planner);
      if (r) reviews.push(r);
      opts.onProgress?.(++done, indexes.size, r);
    }
    s = applyAction(s, a);
  }
  return summarizeAnalysis(reviews);
}
