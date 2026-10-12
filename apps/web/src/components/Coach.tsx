// O treinador das lições do tutorial (texto do passo, quiz e botões) e os destaques na mesa.

import { actingPlayer, type GameState } from '@gumgum/engine';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { battleTip, type Lesson, lessonNumber, LESSONS, ME, OPP, type Spot, uidsOf } from '../game/tutorial/lessons';
import type { LessonRun } from '../game/tutorial/useLesson';
import { hasKey, type Params, useT } from '../i18n';
import { Icon } from './Icons';

/** Tradução de uma chave montada em tempo de execução (as lições citam passos pelo id). */
export function useLessonText() {
  const t = useT();
  return (key: string, params?: Params) => (hasKey(key) ? t(key, params) : key);
}

export function Coach({
  lesson,
  run,
  onHub,
  onLesson,
  nextBlocked,
  extra,
}: {
  lesson: Lesson;
  run: LessonRun;
  onHub: () => void;
  onLesson: (id: string) => void;
  /** O passo ainda pede algo fora do treinador (ex.: descobrir todas as partes da carta). */
  nextBlocked?: boolean;
  /** Conteúdo a mais no fim do treinador (ex.: botão para o construtor de decks). */
  extra?: ReactNode;
}) {
  const t = useT();
  const lt = useLessonText();
  const { step, index, state, finished } = run;
  const base = `tutorial.${lesson.id}.${step?.id}`;
  const n = lessonNumber(lesson.id);
  const next = LESSONS[n] ?? null;
  const total = lesson.steps.length;
  const ref = useRef<HTMLDivElement>(null);
  // A cada passo, o foco vai para o treinador (leitor de tela e teclado acompanham).
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [index, finished]);
  // No celular o treinador flutua sobre a mesa: nos passos de ação ele começa recolhido (só o
  // título e o que fazer), para não cobrir as cartas; os de leitura começam abertos.
  const floating = !useWideScreen() && Boolean(lesson.board);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(floating && Boolean(step?.do));
  }, [index, floating, step]);
  useEffect(() => {
    if (run.failed) setCollapsed(false);
  }, [run.failed]);

  const head = (
    <div className="coach-head">
      <span className="coach-avatar" aria-hidden="true">
        <Icon name="learn" size={22} />
      </span>
      <div className="coach-head-text">
        <span className="coach-kicker">{t('tutorial.lessonN', { n, name: lt(`tutorial.${lesson.id}.name`) })}</span>
        {!finished && (
          <div className="coach-dots" aria-label={t('tutorial.stepOf', { n: index + 1, total })} role="img">
            {lesson.steps.map((s, i) => (
              <span key={s.id} className={i < index ? 'done' : i === index ? 'on' : ''} />
            ))}
          </div>
        )}
      </div>
      <button type="button" className="coach-collapse" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={t('tutorial.collapse')}>
        <Icon name="chevron" size={16} />
      </button>
    </div>
  );

  if (finished) {
    return (
      <div className={['coach', 'finished', collapsed ? 'collapsed' : ''].join(' ')} ref={ref} tabIndex={-1} role="region" aria-live="polite" aria-label={t('tutorial.coach')}>
        {head}
        <div className="coach-badge" aria-hidden="true">
          <Icon name="check" size={30} stroke={3} />
        </div>
        <h3 className="coach-title">{t('tutorial.doneTitle')}</h3>
        <p className="coach-body">{next ? t('tutorial.doneBody') : t('tutorial.doneAll')}</p>
        <div className="coach-actions">
          <button type="button" className="btn" onClick={onHub}>
            {t('tutorial.backToHub')}
          </button>
          {next && (
            <button type="button" className="btn primary" onClick={() => onLesson(next.id)}>
              {t('tutorial.nextLesson', { name: lt(`tutorial.${next.id}.name`) })}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!step) return null;

  const quiz = step.quiz;
  const body =
    lesson.id === 'battle' && step.id === 'play' && state
      ? t('tutorial.battle.tipLead') + ' ' + lt(`tutorial.battle.tip.${battleTip(state)}`)
      : lesson.id === 'battle' && step.id === 'over' && state
        ? lt(state.winner === ME ? 'tutorial.battle.won' : 'tutorial.battle.lost') + ' ' + lt(`${base}.body`)
        : lt(`${base}.body`);
  const waiting = Boolean(step.do && state && actingPlayer(state) === OPP);
  const last = index + 1 >= total;

  return (
    <div className={['coach', collapsed ? 'collapsed' : ''].join(' ')} ref={ref} tabIndex={-1} role="region" aria-live="polite" aria-label={t('tutorial.coach')}>
      {head}
      <h3 className="coach-title">{lt(`${base}.title`)}</h3>
      <p className="coach-body">{body}</p>

      {step.do && !run.failed && (
        <div className={['coach-do', waiting ? 'wait' : ''].join(' ')}>
          <Icon name={waiting ? 'history' : 'play'} size={18} />
          <span>{waiting ? t('tutorial.coach.wait') : t('tutorial.coach.yourMove')}</span>
        </div>
      )}
      {run.nudge > 0 && !run.failed && (
        <p key={run.nudge} className="coach-nudge" role="alert">
          {step.do ? t('tutorial.coach.notThis') : t('tutorial.coach.readFirst')}
        </p>
      )}
      {run.failed && (
        <div className="coach-fail" role="alert">
          <p>{lt(`${base}.fail`)}</p>
          <button type="button" className="btn primary" onClick={run.retry}>
            {t('tutorial.retry')}
          </button>
        </div>
      )}

      {quiz && (
        <div className="coach-quiz" role="group" aria-label={t('tutorial.quiz')}>
          {Array.from({ length: quiz.options }, (_, i) => i + 1).map((o) => {
            const chosen = run.answer === o;
            const state = chosen ? (o === quiz.correct ? 'right' : 'wrong') : run.answer === quiz.correct && o === quiz.correct ? 'right' : '';
            return (
              <button
                key={o}
                type="button"
                className={['quiz-option', state].join(' ')}
                aria-pressed={chosen}
                disabled={run.answer === quiz.correct}
                onClick={() => run.setAnswer(o)}
              >
                {lt(`${base}.o${o}`)}
              </button>
            );
          })}
          {run.answer !== null && (
            <p className={['quiz-feedback', run.answer === quiz.correct ? 'right' : 'wrong'].join(' ')}>
              <b>{run.answer === quiz.correct ? t('tutorial.coach.right') : t('tutorial.coach.wrong')}</b>{' '}
              {run.answer === quiz.correct ? lt(`${base}.why`) : t('tutorial.coach.tryAgain')}
            </p>
          )}
        </div>
      )}

      {extra}
      <div className="coach-actions">
        <button type="button" className="btn" onClick={run.back} disabled={index === 0}>
          {t('common.back')}
        </button>
        {!step.do && (
          <button type="button" className="btn primary" onClick={run.next} disabled={!run.canNext || nextBlocked}>
            {last ? t('tutorial.finish') : t('tutorial.next')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Mesma largura em que a mesa ganha o painel lateral (onde o treinador fica fixo). */
function useWideScreen() {
  const query = '(min-width: 1000px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// ------------------------------------------------------------------ destaques na mesa

const SELECTORS: Record<string, string> = {
  'my-leader': '.side.bottom .leader-zone',
  'my-characters': '.side.bottom .field-row',
  'my-stage': '.side.bottom .stage-zone',
  'my-life': '.side.bottom .life-zone',
  'my-cost': '[data-anchor="don-0"]',
  'my-don-deck': '[data-anchor="dondeck-0"]',
  'my-deck': '[data-anchor="deck-0"]',
  'my-trash': '[data-anchor="trash-0"]',
  'my-hand': '.hand.bottom',
  'opp-leader': '.side.top .leader-zone',
  'opp-characters': '.side.top .field-row',
  'opp-life': '.side.top .life-zone',
  'opp-hand': '.hand.top',
  'opp-trash': '[data-anchor="trash-1"]',
  'end-turn': '.center-band .end-turn:not(.placeholder)',
  decision: '.defense-slot, .modal-card, .prompt-pill',
};

function selectorsFor(spot: Spot, state: GameState): string[] {
  const card = /^(opp-)?card:(.+)$/.exec(spot);
  if (card) {
    const player = card[1] ? OPP : ME;
    return uidsOf(state, player, card[2]).map((uid) => `.mat .card[data-uid="${CSS.escape(uid)}"]`);
  }
  return SELECTORS[spot] ? [SELECTORS[spot]] : [];
}

interface Box {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Anéis piscando em volta das áreas do passo (por cima de tudo, sem pegar os toques). */
export function Spotlight({ spots, state }: { spots: Spot[]; state: GameState }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const key = spots.join('|');
  useEffect(() => {
    if (!spots.length) {
      setBoxes([]);
      return;
    }
    const measure = () => {
      const out: Box[] = [];
      // Com uma janela aberta na mesa (zoom da carta, mulligan, menu), só o que está dentro dela.
      const modal = document.querySelector<HTMLElement>('.game .modal-backdrop');
      for (const spot of spots) {
        for (const sel of selectorsFor(spot, stateRef.current)) {
          document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
            if (modal && !modal.contains(el)) return;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            out.push({ key: `${spot}${sel}${i}`, left: r.left, top: r.top, width: r.width, height: r.height });
          });
        }
      }
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    };
    measure();
    // As cartas se mexem (animações, mão em leque): mede de novo algumas vezes por segundo.
    const timer = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!boxes.length) return null;
  return createPortal(
    <div className="spotlight" aria-hidden="true">
      {boxes.map((b) => (
        <span key={b.key} className="spot-ring" style={{ left: b.left - 6, top: b.top - 6, width: b.width + 12, height: b.height + 12 }} />
      ))}
    </div>,
    document.body,
  );
}
