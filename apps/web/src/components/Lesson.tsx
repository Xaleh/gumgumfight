// Tela de uma lição do tutorial: a mesa com o treinador ou, nas lições sem mesa, um painel
// (carta de exemplo, anatomia da carta, curva do deck) ao lado do treinador.

import { type CardData, type GameState } from '@gumgum/engine';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { lessonById, lessonNumber, ME, type Lesson as LessonDef, type LessonStep, type TutorialData } from '../game/tutorial/lessons';
import { useTutorialProgress } from '../game/tutorial/progress';
import { type LessonRun, useLesson, useTutorialData } from '../game/tutorial/useLesson';
import { api } from '../api';
import { useT } from '../i18n';
import { cardText, useSettings } from '../settings';
import { StaticCard } from './CardView';
import { Coach, Spotlight, useLessonText } from './Coach';
import { LessonTable, type TableGame } from './GameScreen';
import { Icon } from './Icons';

const noop = () => undefined;

/**
 * Eventos anônimos da lição (só lição, passo e evento, sem identificar ninguém), para a
 * Administração ver em que passo as pessoas desistem.
 */
function useLessonEvents(lessonId: string, run: LessonRun) {
  const stepId = run.step?.id ?? '';
  const state = useRef({ stepId, finished: run.finished });
  state.current = { stepId, finished: run.finished };
  useEffect(() => {
    void api.tutorial.event(lessonId, 'start');
    return () => {
      if (!state.current.finished) void api.tutorial.event(lessonId, 'exit', state.current.stepId);
    };
  }, [lessonId]);
  useEffect(() => {
    if (stepId && !run.finished) void api.tutorial.event(lessonId, 'step', stepId);
  }, [lessonId, stepId, run.finished]);
  useEffect(() => {
    if (run.failed) void api.tutorial.event(lessonId, 'fail', stepId);
  }, [run.failed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (run.finished) void api.tutorial.event(lessonId, 'complete');
  }, [run.finished, lessonId]);
}

export function Lesson({
  id,
  onHub,
  onLesson,
  onBuildDecks,
}: {
  id: string;
  onHub: () => void;
  onLesson: (id: string) => void;
  onBuildDecks: () => void;
}) {
  const t = useT();
  const lesson = lessonById(id);
  const { data, error, retry } = useTutorialData();
  if (!lesson) {
    return (
      <div className="lesson-page">
        <p className="error">{t('tutorial.notFound')}</p>
        <button className="btn" onClick={onHub}>
          {t('tutorial.backToHub')}
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="lesson-page lesson-loading">
        {error ? (
          <>
            <p className="error">{t('tutorial.loadFailed', { why: error })}</p>
            <div className="btn-row center">
              <button className="btn" onClick={onHub}>
                {t('tutorial.backToHub')}
              </button>
              <button className="btn primary" onClick={retry}>
                {t('tutorial.retry')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return <LessonRunner key={lesson.id} lesson={lesson} data={data} onHub={onHub} onLesson={onLesson} onBuildDecks={onBuildDecks} />;
}

function LessonRunner({
  lesson,
  data,
  onHub,
  onLesson,
  onBuildDecks,
}: {
  lesson: LessonDef;
  data: Omit<TutorialData, 'names'>;
  onHub: () => void;
  onLesson: (id: string) => void;
  onBuildDecks: () => void;
}) {
  const run = useLesson(lesson, data);
  // Chaves: em navegadores novos scrollTo devolve uma Promise, que o React tentaria chamar como limpeza.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { complete } = useTutorialProgress();
  useEffect(() => {
    if (run.finished) complete(lesson.id);
  }, [run.finished, complete, lesson.id]);
  useLessonEvents(lesson.id, run);
  const t = useT();
  // A lição de montar deck termina com o atalho para o construtor.
  const builderButton =
    lesson.id === 'deck' && run.step?.id === 'builder' ? (
      <button type="button" className="btn coach-extra" onClick={onBuildDecks}>
        <Icon name="deck" size={18} />
        {t('tutorial.openBuilder')}
      </button>
    ) : null;

  if (lesson.board) {
    if (!run.state) return null;
    return <BoardLesson lesson={lesson} run={run} state={run.state} onHub={onHub} onLesson={onLesson} />;
  }
  return <PanelLesson lesson={lesson} run={run} data={data} onHub={onHub} onLesson={onLesson} extra={builderButton} />;
}

function BoardLesson({
  lesson,
  run,
  state,
  onHub,
  onLesson,
}: {
  lesson: LessonDef;
  run: LessonRun;
  state: GameState;
  onHub: () => void;
  onLesson: (id: string) => void;
}) {
  const game: TableGame = {
    state,
    dispatch: run.dispatch,
    error: run.error,
    setError: run.setError,
    human: ME,
    paused: false,
    setPaused: noop,
    speed: 1,
    setSpeed: noop,
    auto: false,
    setAuto: noop,
    undo: noop,
    canUndo: false,
    actions: run.actions,
    downloadReplay: noop,
  };
  const spots = !run.finished && run.step?.spot ? run.step.spot : [];
  return (
    <LessonTable
      game={game}
      onExit={onHub}
      tutorial={{
        coach: <Coach lesson={lesson} run={run} onHub={onHub} onLesson={onLesson} />,
        overlay: <Spotlight spots={spots} state={state} />,
        hidePrompt: run.finished || !run.step?.do,
        floatAt: spots.length > 0 && spots.every((x) => x.startsWith('opp-')) ? 'bottom' : 'top',
      }}
    />
  );
}

// ------------------------------------------------------------------ lições sem mesa

function PanelLesson({
  lesson,
  run,
  data,
  onHub,
  onLesson,
  extra,
}: {
  lesson: LessonDef;
  run: LessonRun;
  data: Omit<TutorialData, 'names'>;
  onHub: () => void;
  onLesson: (id: string) => void;
  extra: ReactNode;
}) {
  const t = useT();
  const lt = useLessonText();
  const [found, setFound] = useState<string[]>([]);
  const step = run.step;
  const anatomy = lesson.view === 'anatomy';
  const visual = run.finished ? null : anatomy ? (
    <CardAnatomy cards={data.cards} found={found} onFound={(p) => setFound((f) => (f.includes(p) ? f : [...f, p]))} />
  ) : step ? (
    <StepVisual step={step} data={data} />
  ) : null;
  return (
    <div className="lesson-page">
      <header className="builder-header lesson-header">
        <button className="btn small" onClick={onHub}>
          {t('tutorial.exitLesson')}
        </button>
        <h2>{t('tutorial.lessonN', { n: lessonNumber(lesson.id), name: lt(`tutorial.${lesson.id}.name`) })}</h2>
        {anatomy && !run.finished && <span className="muted small">{t('tutorial.card.found', { n: found.length, total: ANATOMY_PARTS.length })}</span>}
      </header>
      <main className={['lesson-panel-main', visual ? '' : 'solo'].join(' ')}>
        {visual && <div className="lesson-visual">{visual}</div>}
        <Coach
          lesson={lesson}
          run={run}
          onHub={onHub}
          onLesson={onLesson}
          nextBlocked={anatomy && step?.id === 'discover' && found.length < ANATOMY_PARTS.length}
          extra={extra}
        />
      </main>
    </div>
  );
}

const cardSize = (w: number) => ({ ['--cw' as string]: `${w}px`, ['--ch' as string]: `${Math.round(w * 1.396)}px` }) as CSSProperties;

function StepVisual({ step, data }: { step: LessonStep; data: Omit<TutorialData, 'names'> }) {
  if (step.extra === 'curve') return <DeckCurve data={data} />;
  if (step.extra === 'deck-rules') return <DeckRules />;
  const card = step.card ? data.cards.find((c) => c.id === step.card) : null;
  if (!card) return null;
  return (
    <div className="lesson-card" style={cardSize(240)}>
      <StaticCard card={card} />
      <CardTextBox card={card} />
    </div>
  );
}

function CardTextBox({ card }: { card: CardData }) {
  const { locale } = useSettings();
  const text = cardText(card, locale);
  return (
    <div className="lesson-card-text">
      <strong>{card.name}</strong>
      {text.text && <p>{text.text}</p>}
      {text.trigger && (
        <p>
          <b>[Trigger]</b> {text.trigger}
        </p>
      )}
    </div>
  );
}

function DeckRules() {
  const t = useT();
  const rules: Array<[string, string]> = [
    ['50', t('tutorial.deckRules.cards')],
    ['1', t('tutorial.deckRules.leader')],
    ['10', t('tutorial.deckRules.don')],
    ['4', t('tutorial.deckRules.copies')],
  ];
  return (
    <ul className="deck-rules">
      {rules.map(([n, label]) => (
        <li key={label}>
          <b>{n}</b>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Curva de custo do deck inicial do Luffy (quantas cartas de cada custo). */
function DeckCurve({ data }: { data: Omit<TutorialData, 'names'> }) {
  const t = useT();
  const rows = useMemo(() => {
    const byId = new Map(data.cards.map((c) => [c.id, c]));
    const count = new Map<number, number>();
    for (const e of data.decks[0].cards) {
      const cost = byId.get(e.id)?.cost ?? 0;
      count.set(cost, (count.get(cost) ?? 0) + e.count);
    }
    const max = Math.max(...count.values());
    return [...count.entries()].sort((a, b) => a[0] - b[0]).map(([cost, n]) => ({ cost, n, pct: (n / max) * 100 }));
  }, [data]);
  return (
    <figure className="deck-curve">
      <figcaption>{t('tutorial.curveCaption')}</figcaption>
      <ol>
        {rows.map((r) => (
          <li key={r.cost}>
            <span className="curve-cost">{t('tutorial.curveCost', { n: r.cost })}</span>
            <span className="curve-bar">
              <span style={{ width: `${r.pct}%` }} />
            </span>
            <b>{r.n}</b>
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ------------------------------------------------------------------ anatomia da carta

const ANATOMY_PARTS = ['cost', 'power', 'counter', 'attribute', 'effect', 'trigger', 'name', 'type'] as const;
type Part = (typeof ANATOMY_PARTS)[number];
const ANATOMY_CARDS: Array<{ kind: 'character' | 'event' | 'stage' | 'leader'; id: string }> = [
  { kind: 'character', id: 'ST01-013' },
  { kind: 'event', id: 'ST01-015' },
  { kind: 'stage', id: 'ST01-017' },
  { kind: 'leader', id: 'ST01-001' },
];

function CardAnatomy({ cards, found, onFound }: { cards: CardData[]; found: string[]; onFound: (p: Part) => void }) {
  const t = useT();
  const lt = useLessonText();
  const { locale } = useSettings();
  const [kind, setKind] = useState<(typeof ANATOMY_CARDS)[number]['kind']>('character');
  const [sel, setSel] = useState<Part | null>(null);
  const card = cards.find((c) => c.id === ANATOMY_CARDS.find((k) => k.kind === kind)!.id);
  if (!card) return null;
  const text = cardText(card, locale);
  const pick = (p: Part) => {
    setSel(p);
    onFound(p);
  };
  const cls = (p: Part) => ['part', sel === p ? 'on' : found.includes(p) ? 'seen' : ''].join(' ');
  const color = card.colors[0] ?? 'red';
  return (
    <div className="anatomy">
      <div className="seg anatomy-tabs" role="group" aria-label={t('tutorial.card.kinds')}>
        {ANATOMY_CARDS.map((k) => (
          <button key={k.kind} type="button" className={kind === k.kind ? 'on' : ''} aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
            {lt(`tutorial.card.kind.${k.kind}`)}
          </button>
        ))}
      </div>
      <div className="anatomy-card" style={{ ['--frame' as string]: `var(--${color === 'blue' ? 'blue-card' : color})` }}>
        <div className="anatomy-row">
          <button type="button" className={cls('cost') + ' cost'} onClick={() => pick('cost')} aria-label={lt('tutorial.card.part.cost.title')}>
            {card.category === 'leader' ? '—' : (card.cost ?? 0)}
          </button>
          <button type="button" className={cls('power') + ' power'} onClick={() => pick('power')} aria-label={lt('tutorial.card.part.power.title')}>
            {card.power ?? '—'}
          </button>
        </div>
        <div className="anatomy-row mid">
          <button
            type="button"
            className={cls('counter') + ' counter' + (card.counter ? '' : ' none')}
            onClick={() => pick('counter')}
            aria-label={lt('tutorial.card.part.counter.title')}
          >
            {card.counter ? `+${card.counter}` : '—'}
          </button>
          <div className="anatomy-art" aria-hidden="true">
            {card.category === 'leader' ? t('tutorial.card.lifeN', { n: card.life ?? 0 }) : lt(`tutorial.card.kind.${card.category}`)}
          </div>
          <button type="button" className={cls('attribute') + ' attribute'} onClick={() => pick('attribute')} aria-label={lt('tutorial.card.part.attribute.title')}>
            {card.attributes?.[0] ?? '—'}
          </button>
        </div>
        <button type="button" className={cls('effect') + ' effect'} onClick={() => pick('effect')}>
          {text.text || t('tutorial.card.noEffect')}
        </button>
        <button type="button" className={cls('trigger') + ' trigger'} onClick={() => pick('trigger')}>
          {text.trigger ? `[Trigger] ${text.trigger}` : t('tutorial.card.noTrigger')}
        </button>
        <button type="button" className={cls('name') + ' name'} onClick={() => pick('name')}>
          {card.name}
        </button>
        <button type="button" className={cls('type') + ' type'} onClick={() => pick('type')}>
          {card.types.join(' / ')}
        </button>
      </div>
      <div className="anatomy-info" aria-live="polite">
        {sel ? (
          <>
            <strong>{lt(`tutorial.card.part.${sel}.title`)}</strong>
            <p>{lt(`tutorial.card.part.${sel}.body`)}</p>
          </>
        ) : (
          <p className="muted">{t('tutorial.card.tapHint')}</p>
        )}
      </div>
    </div>
  );
}
