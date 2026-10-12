// Andamento de uma lição: a mesa (quando há), o passo atual, as jogadas permitidas e o oponente.

import {
  type Action,
  actingPlayer,
  actionFromView,
  applyAction,
  chooseBotAction,
  chooseSimpleBotAction,
  type GameState,
  identityAliases,
  viewFor,
} from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { t } from '../../i18n';
import { motionWait } from '../motion';
import { type Lesson, ME, OPP, TUTORIAL_DECKS, type TutorialData } from './lessons';
import { humanAllowed, opponentAction, opponentMayAct } from './runner';

let dataPromise: Promise<Omit<TutorialData, 'names'>> | null = null;

/** Cartas e decks do tutorial (carregados uma vez). */
export function loadTutorialData(): Promise<Omit<TutorialData, 'names'>> {
  if (!dataPromise) {
    dataPromise = Promise.all(TUTORIAL_DECKS.map((id) => api.deck(id)))
      .then(([a, b]) => {
        const cards = new Map([...a.cards, ...b.cards].map((c) => [c.id, c]));
        return { cards: [...cards.values()], decks: [a.deck, b.deck] as TutorialData['decks'] };
      })
      .catch((e: unknown) => {
        dataPromise = null;
        throw e;
      });
  }
  return dataPromise;
}

export function useTutorialData() {
  const [data, setData] = useState<Omit<TutorialData, 'names'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    loadTutorialData()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

function botAction(s: GameState): Action {
  const aliases = identityAliases(s);
  const real = actionFromView(s, aliases, chooseBotAction(viewFor(s, OPP, aliases), OPP, 'easy'));
  return typeof real === 'string' ? chooseSimpleBotAction(s, OPP) : real;
}

/** Tempo entre o fim de um passo de ação e o passo seguinte (para ver o resultado da jogada). */
const ADVANCE_MS = 900;

export function useLesson(lesson: Lesson, data: Omit<TutorialData, 'names'> | null) {
  const build = useCallback(
    () => (lesson.board && data ? lesson.board.build({ ...data, names: [t('tutorial.you'), t('tutorial.botName')] }) : null),
    [lesson, data],
  );
  const [index, setIndex] = useState(0);
  /** A mesa no começo de cada passo (voltar um passo restaura a mesa daquele momento). */
  const startsRef = useRef<Array<GameState | null>>([]);
  const [state, setState] = useState<GameState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef<Action[]>([]);
  const [nudge, setNudge] = useState(0);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  /** Resposta escolhida no quiz do passo atual (índice a partir de 1). */
  const [answer, setAnswer] = useState<number | null>(null);
  /**
   * O passo de ação foi cumprido: a mesa congela (o oponente espera e as jogadas ficam travadas)
   * até o treinador passar para o passo seguinte. Sem isso o oponente poderia jogar de novo
   * antes da troca e desfazer a condição do passo.
   */
  const [cleared, setCleared] = useState(false);

  // Monta a mesa quando os dados chegam (ou ao trocar de lição).
  useEffect(() => {
    const s = build();
    startsRef.current = [s];
    actionsRef.current = [];
    setState(s);
    setIndex(0);
    setFailed(false);
    setFinished(false);
    setAnswer(null);
    setCleared(false);
  }, [build]);

  const step = lesson.steps[index];
  const start = startsRef.current[index] ?? state;

  const apply = useCallback((a: Action) => {
    const cur = stateRef.current;
    if (!cur) return;
    try {
      const next = applyAction(cur, a);
      stateRef.current = next;
      actionsRef.current = [...actionsRef.current, a];
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Jogada do jogador: só as que o passo pede (as outras mostram o aviso do treinador). */
  const dispatch = useCallback(
    (a: Action) => {
      const cur = stateRef.current;
      if (!cur || finished) return;
      if (a.player === ME && (!humanAllowed(step, a, cur) || failed || cleared)) {
        setNudge((n) => n + 1);
        return;
      }
      apply(a);
    },
    [apply, step, failed, finished, cleared],
  );

  const goTo = useCallback(
    (i: number) => {
      if (i > index) {
        startsRef.current = [...startsRef.current.slice(0, i), stateRef.current];
      } else {
        const back = startsRef.current[i] ?? null;
        startsRef.current = startsRef.current.slice(0, i + 1);
        stateRef.current = back;
        setState(back);
      }
      setIndex(i);
      setFailed(false);
      setAnswer(null);
      setNudge(0);
      setCleared(false);
    },
    [index],
  );

  const next = useCallback(() => {
    if (index + 1 >= lesson.steps.length) setFinished(true);
    else goTo(index + 1);
  }, [index, lesson.steps.length, goTo]);
  const back = useCallback(() => {
    if (index > 0) goTo(index - 1);
  }, [index, goTo]);

  /** Recomeça o passo de ação (depois de uma jogada que não deu certo). */
  const retry = useCallback(() => {
    const s = startsRef.current[index] ?? null;
    stateRef.current = s;
    setState(s);
    setFailed(false);
    setNudge(0);
  }, [index]);

  // Passo de ação cumprido (ou que deu errado).
  useEffect(() => {
    if (!state || !step?.do || failed || finished || cleared || !start) return;
    if (step.do.done(state, start)) setCleared(true);
    else if (step.do.fail?.(state, start)) setFailed(true);
  }, [state, step, start, failed, finished, cleared]);
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(next, ADVANCE_MS + motionWait());
    return () => clearTimeout(timer);
  }, [cleared, next]);

  // O oponente joga sozinho, só durante os passos de ação.
  useEffect(() => {
    if (!state || !opponentMayAct(step) || failed || finished || cleared || actingPlayer(state) !== OPP) return;
    const plan = lesson.board?.opponent;
    const a = plan === 'bot' ? botAction(state) : opponentAction(lesson, state);
    if (!a) return;
    const delay = Math.max(state.pending ? 600 : 1000, motionWait() + 150);
    const timer = setTimeout(() => apply(a), delay);
    return () => clearTimeout(timer);
  }, [state, step, failed, finished, cleared, lesson, apply]);

  const quiz = step?.quiz;
  const canNext = !finished && !step?.do && (!quiz || answer === quiz.correct);

  return useMemo(
    () => ({
      index,
      step,
      state,
      dispatch,
      actions: () => actionsRef.current,
      error,
      setError,
      nudge,
      failed,
      retry,
      cleared,
      next,
      back,
      canNext,
      answer,
      setAnswer,
      finished,
      setFinished,
      start,
    }),
    [index, step, state, dispatch, error, nudge, failed, retry, cleared, next, back, canNext, answer, finished, start],
  );
}

export type LessonRun = ReturnType<typeof useLesson>;
