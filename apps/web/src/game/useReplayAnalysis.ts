// A análise da partida de um replay (roadmap B1): pedida pelo botão da barra do replay, roda no Web Worker
// (analysisWorker.ts) com o progresso a cada decisão; sem worker, na página (`runAnalysisInPage`).

import type { Action, DecisionReview, GameState, MatchAnalysis } from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalysisMessage, runAnalysisInPage } from './analysis';

export type ReplayAnalysisState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number; marks: DecisionReview[] }
  | { status: 'done'; analysis: MatchAnalysis }
  | { status: 'error'; code: 'notFinished' | 'invalid' | 'failed'; message?: string };

export function useReplayAnalysis(initial: GameState, script: readonly Action[]) {
  const [state, setState] = useState<ReplayAnalysisState>({ status: 'idle' });
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    setState({ status: 'running', done: 0, total: 0, marks: [] });
    const marks: DecisionReview[] = [];
    const onMessage = (m: AnalysisMessage) => {
      if (m.type === 'progress') {
        if (m.review && m.review.severity !== 'good') marks.push(m.review);
        setState({ status: 'running', done: m.done, total: m.total, marks: [...marks] });
      } else {
        stopRef.current?.();
        stopRef.current = null;
        setState(m.type === 'done' ? { status: 'done', analysis: m.analysis } : { status: 'error', code: m.code, message: m.message });
      }
    };
    const inPage = () => {
      stopRef.current = runAnalysisInPage({ initial, actions: script }, onMessage);
    };
    let worker: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) return inPage();
    const w = worker;
    w.onmessage = (e: MessageEvent<AnalysisMessage>) => onMessage(e.data);
    // O worker não abriu ou quebrou: recomeça na página.
    w.onerror = () => {
      w.terminate();
      marks.length = 0;
      inPage();
    };
    stopRef.current = () => w.terminate();
    w.postMessage({ initial, actions: script });
  }, [initial, script, stop]);

  const cancel = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  // Ao sair do replay, a conta para.
  useEffect(() => stop, [stop]);

  return { state, start, cancel };
}
