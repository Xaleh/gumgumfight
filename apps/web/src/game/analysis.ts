// Análise da partida no navegador (roadmap B1): a conta do motor (`analyzeReplay`, uma ou duas buscas do bot por
// decisão) roda no Web Worker (analysisWorker.ts); sem worker, na página, uma decisão por tarefa para a tela não
// travar. Aqui também ficam as contas da interface (marcador anterior/seguinte, a linha sugerida resumida).

import {
  type Action,
  AnalysisError,
  analyzeReplay,
  decisionIndexes,
  type DecisionReview,
  type GameState,
  type MatchAnalysis,
  applyAction,
  reviewDecision,
  summarizeAnalysis,
} from '@gumgum/engine';

/** O que a análise manda para a página enquanto roda. */
export type AnalysisMessage =
  | { type: 'progress'; done: number; total: number; review: DecisionReview | null }
  | { type: 'done'; analysis: MatchAnalysis }
  | { type: 'error'; code: 'notFinished' | 'invalid' | 'failed'; message?: string };

export interface AnalysisRequest {
  initial: GameState;
  actions: readonly Action[];
}

const failure = (e: unknown): AnalysisMessage =>
  e instanceof AnalysisError ? { type: 'error', code: e.code } : { type: 'error', code: 'failed', message: e instanceof Error ? e.message : String(e) };

/** A análise inteira de uma vez (no worker). */
export function runAnalysis({ initial, actions }: AnalysisRequest, post: (m: AnalysisMessage) => void): void {
  try {
    const analysis = analyzeReplay(initial, actions, { onProgress: (done, total, review) => post({ type: 'progress', done, total, review }) });
    post({ type: 'done', analysis });
  } catch (e) {
    post(failure(e));
  }
}

/** A análise na página, uma decisão por tarefa (sem worker). Devolve como cancelar. */
export function runAnalysisInPage({ initial, actions }: AnalysisRequest, post: (m: AnalysisMessage) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let indexes: number[];
  try {
    indexes = decisionIndexes(initial, actions);
  } catch (e) {
    post(failure(e));
    return () => {};
  }
  const reviews: DecisionReview[] = [];
  let state = initial;
  let i = 0;
  let k = 0;
  const step = () => {
    if (stopped) return;
    try {
      // Anda até a próxima decisão e a analisa.
      const target = indexes[k];
      while (i < target) state = applyAction(state, actions[i++]);
      const review = reviewDecision(state, i, actions[i]);
      if (review) reviews.push(review);
      k++;
      post({ type: 'progress', done: k, total: indexes.length, review });
    } catch (e) {
      post(failure(e));
      return;
    }
    if (k < indexes.length) timer = setTimeout(step, 0);
    else post({ type: 'done', analysis: summarizeAnalysis(reviews) });
  };
  if (indexes.length) timer = setTimeout(step, 0);
  else post({ type: 'done', analysis: summarizeAnalysis([]) });
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** O marcador mais perto de `pos` na direção `dir` (−1: o anterior, estritamente antes; 1: o seguinte, estritamente depois). */
export function nearestMark(marks: readonly DecisionReview[], pos: number, dir: -1 | 1): DecisionReview | null {
  let best: DecisionReview | null = null;
  for (const m of marks) {
    if (dir === 1 ? m.index > pos && (!best || m.index < best.index) : m.index < pos && (!best || m.index > best.index)) best = m;
  }
  return best;
}

/**
 * A linha sugerida como o jogador a faria na fase principal: as jogadas (jogar, ativar, anexar DON!!, atacar),
 * com os DON!! seguidos no mesmo alvo juntos (`count`). As respostas às perguntas do meio e o fim do turno saem.
 * Numa escolha pendente, a linha é só a resposta.
 */
export function condenseLine(review: Pick<DecisionReview, 'kind' | 'best'>): Array<{ action: Action; count: number }> {
  if (review.kind === 'pending') return review.best.slice(0, 1).map((action) => ({ action, count: 1 }));
  const out: Array<{ action: Action; count: number }> = [];
  for (const a of review.best) {
    if (a.type === 'endTurn') {
      if (!out.length) out.push({ action: a, count: 1 });
      break;
    }
    if (a.type !== 'playCard' && a.type !== 'activate' && a.type !== 'attachDon' && a.type !== 'attack') continue;
    const last = out[out.length - 1];
    if (last && a.type === 'attachDon' && last.action.type === 'attachDon' && last.action.target === a.target) last.count++;
    else out.push({ action: a, count: 1 });
  }
  return out;
}
