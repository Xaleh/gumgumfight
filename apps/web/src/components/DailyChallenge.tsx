// Desafio do dia: a mesa (só a visão do jogador, vinda do servidor) e o painel com o objetivo, o resultado, a sequência
// de dias e o botão de compartilhar. Cada jogada vai ao servidor, que refaz a tentativa, joga pelo oponente e confere.

import type { Action, GameState } from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type DailyPlay, type DailyResult, type DailyStatus, type DailyStreak, type DailyToday } from '../api';
import { dailyShareText, defenseLines, introFor, scriptName } from '../game/daily';
import { type MessageKey, useT } from '../i18n';
import { useSettings } from '../settings';
import { LessonTable, type TableGame } from './GameScreen';
import { Icon } from './Icons';

const noop = () => undefined;

type Goal = DailyToday['challenge']['goal'];
const LEVEL: Record<1 | 2 | 3, MessageKey> = { 1: 'daily.level1', 2: 'daily.level2', 3: 'daily.level3' };
const GOAL_TITLE: Record<Goal, MessageKey> = { lethal: 'daily.goal.lethal.title', survive: 'daily.goal.survive.title' };
const GOAL_BODY: Record<Goal, MessageKey> = { lethal: 'daily.goal.lethal.body', survive: 'daily.goal.survive.body' };
const FAILED: Record<Goal, MessageKey> = { lethal: 'daily.failed.lethal', survive: 'daily.failed.survive' };

export function DailyChallenge({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [data, setData] = useState<DailyToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    api.daily
      .today()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [attempt]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  if (!data?.view) {
    return (
      <div className="lesson-page lesson-loading">
        {error ? (
          <>
            <p className="error">{t('daily.loadFailed', { why: error })}</p>
            <div className="btn-row center">
              <button className="btn" onClick={onExit}>
                {t('daily.exit')}
              </button>
              <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
                {t('daily.retry')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </div>
    );
  }
  return <DailyRun key={data.day} data={data} start={data.view} onExit={onExit} onReload={() => setAttempt((n) => n + 1)} />;
}

function DailyRun({ data, start, onExit, onReload }: { data: DailyToday; start: GameState; onExit: () => void; onReload: () => void }) {
  const t = useT();
  const [view, setView] = useState(start);
  const [status, setStatus] = useState<DailyStatus>('playing');
  const [result, setResult] = useState<DailyResult>(data.result);
  const [streak, setStreak] = useState<DailyStreak>(data.streak);
  const [error, setError] = useState<string | null>(null);
  const [dayOver, setDayOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = useRef<Action[]>([]);
  const busyRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  /** Manda a lista inteira de jogadas; o servidor devolve a mesa depois delas (e das respostas do oponente). */
  const send = useCallback(
    async (next: Action[]) => {
      busyRef.current = true;
      setBusy(true);
      try {
        const r: DailyPlay = await api.daily.play(data.day, next);
        actions.current = r.error ? next.slice(0, r.applied) : next;
        setView(r.view);
        statusRef.current = r.status;
        setStatus(r.status);
        setResult(r.result);
        setStreak(r.streak);
        setError(r.error ? r.error.message : null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setDayOver(true);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [data.day],
  );

  /** Jogadas esperando o pedido em andamento (a mesa manda várias de uma vez, como os DON!! arrastados juntos). */
  const queued = useRef<Action[]>([]);
  const flush = useCallback(async () => {
    while (queued.current.length && !busyRef.current && statusRef.current === 'playing') {
      const batch = queued.current.splice(0);
      await send([...actions.current, ...batch]);
    }
    queued.current = [];
  }, [send]);
  const dispatch = useCallback(
    (a: Action) => {
      if (a.type === 'concede') return onExit();
      if (statusRef.current !== 'playing') return;
      queued.current.push(a);
      if (queued.current.length === 1 && !busyRef.current) queueMicrotask(() => void flush());
    },
    [flush, onExit],
  );
  const undo = useCallback(() => {
    if (busyRef.current || !actions.current.length) return;
    void send(actions.current.slice(0, -1));
  }, [send]);
  const retry = () => {
    actions.current = [];
    queued.current = [];
    statusRef.current = 'playing';
    setView(start);
    setStatus('playing');
    setError(null);
  };

  const game: TableGame = {
    state: view,
    dispatch,
    error,
    setError,
    human: 0,
    paused: false,
    setPaused: noop,
    speed: 1,
    setSpeed: noop,
    auto: false,
    setAuto: noop,
    undo,
    canUndo: status === 'playing' && actions.current.length > 0 && !busy,
    actions: () => actions.current,
    downloadReplay: noop,
    // A mão do oponente que o enunciado abre aparece de frente (as cartas que ele compra depois continuam de verso).
    openOpponentHand: data.challenge.revealHand,
  };
  const panel = (
    <DailyPanel
      data={data}
      view={view}
      status={status}
      result={result}
      streak={streak}
      busy={busy}
      dayOver={dayOver}
      onRetry={retry}
      onReload={onReload}
      onExit={onExit}
    />
  );
  return <LessonTable game={game} onExit={onExit} tutorial={{ coach: panel, hidePrompt: status !== 'playing', floatAt: 'top', exitLabel: t('daily.exit') }} />;
}

function DailyPanel({
  data,
  view,
  status,
  result,
  streak,
  busy,
  dayOver,
  onRetry,
  onReload,
  onExit,
}: {
  data: DailyToday;
  view: GameState;
  status: DailyStatus;
  result: DailyResult;
  streak: DailyStreak;
  busy: boolean;
  dayOver: boolean;
  onRetry: () => void;
  onReload: () => void;
  onExit: () => void;
}) {
  const t = useT();
  // No celular o painel flutua sobre a mesa: começa recolhido (o objetivo e de quem é a vez) para não cobrir as cartas.
  const [collapsed, setCollapsed] = useState(() => !window.matchMedia('(min-width: 1000px)').matches);
  const [shared, setShared] = useState(false);
  const { goal } = data.challenge;
  const { locale } = useSettings();
  const intro = introFor(data.challenge.intro, locale);
  const yourTurn = view.phase !== 'gameover' && (view.pending ? view.pending.player === 0 : view.activePlayer === 0);
  useEffect(() => {
    if (status !== 'playing') setCollapsed(false);
  }, [status]);

  const share = async () => {
    const text = dailyShareText(t, data, result, streak, location.origin);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setShared(true);
      }
    } catch {
      /* compartilhamento cancelado */
    }
  };

  const head = (
    <div className="coach-head">
      <span className="coach-avatar" aria-hidden="true">
        <Icon name="star" size={22} />
      </span>
      <div className="coach-head-text">
        <span className="coach-kicker">
          {t('daily.kicker', { n: data.number })} · {t(LEVEL[data.challenge.level] ?? LEVEL[1])}
        </span>
        {streak.current > 0 && <span className="daily-streak">🔥 {t('daily.streak', { n: streak.current })}</span>}
      </div>
      <button type="button" className="coach-collapse" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={t('tutorial.collapse')}>
        <Icon name="chevron" size={16} />
      </button>
    </div>
  );

  return (
    <div className={['coach', 'daily-panel', collapsed ? 'collapsed' : ''].join(' ')} role="region" aria-live="polite" aria-label={t('daily.title')}>
      {head}
      <h3 className="coach-title">{t(GOAL_TITLE[goal])}</h3>
      {status === 'playing' && (
        <>
          {intro && <p className="coach-body daily-intro">{intro}</p>}
          <p className="coach-body">{t(GOAL_BODY[goal])}</p>
          {goal === 'lethal' && (
            <div className="daily-defense">
              <span className="daily-defense-title">{t('daily.defense.title')}</span>
              <ul>
                {defenseLines(data.challenge.defense).map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ul>
            </div>
          )}
          {goal === 'survive' && (
            <ol className="daily-attacks">
              {data.challenge.attacks.map((a, i) => (
                <li key={i}>{t('daily.attack', { attacker: scriptName(t, view, a.attacker, 'attacker'), target: scriptName(t, view, a.target, 'target') })}</li>
              ))}
            </ol>
          )}
          {data.challenge.revealHand && (
            <p className="coach-body muted small">{view.players[1].hand.length ? t('daily.revealHand') : t('daily.emptyHand')}</p>
          )}
          <div className={['coach-do', yourTurn && !busy ? '' : 'wait'].join(' ')}>
            <Icon name={yourTurn && !busy ? 'play' : 'history'} size={18} />
            <span>{yourTurn && !busy ? t('daily.yourMove') : t('daily.wait')}</span>
          </div>
          {result.solved && <p className="coach-body muted small">{t('daily.alreadySolved')}</p>}
        </>
      )}
      {status === 'solved' && (
        <div className="daily-outcome ok" role="status">
          <Icon name="check" size={26} stroke={3} />
          <div>
            <strong>{t('daily.solvedTitle')}</strong>
            <span>{t('daily.attempts', { n: result.attempts })}</span>
          </div>
        </div>
      )}
      {status === 'failed' && (
        <div className="coach-fail" role="alert">
          <p>{t(FAILED[goal])}</p>
          <button type="button" className="btn primary" onClick={onRetry}>
            {t('daily.retry')}
          </button>
        </div>
      )}
      {dayOver && (
        <div className="coach-fail" role="alert">
          <p>{t('daily.dayOver')}</p>
          <button type="button" className="btn primary" onClick={onReload}>
            {t('daily.openToday')}
          </button>
        </div>
      )}
      {status !== 'playing' && (
        <>
          <DailyHistory data={data} result={result} />
          <p className="coach-body small">
            {t('daily.best', { n: streak.best })} · {t('daily.solvedTotal', { n: streak.solved })}
          </p>
          <p className="coach-body muted small">{t('daily.tomorrow')}</p>
        </>
      )}
      <div className="coach-actions">
        <button type="button" className="btn" onClick={onExit}>
          {t('daily.exit')}
        </button>
        {status === 'solved' && (
          <button type="button" className="btn" onClick={onRetry}>
            {t('daily.playAgain')}
          </button>
        )}
        {(status !== 'playing' || result.attempts > 0) && (
          <button type="button" className="btn primary" onClick={() => void share()}>
            <Icon name="share" size={16} />
            {shared ? t('daily.copied') : t('daily.share')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Os últimos dias publicados: ✅ resolvido, ⬛ não (o de hoje com o resultado de agora). */
function DailyHistory({ data, result }: { data: DailyToday; result: DailyResult }) {
  const t = useT();
  const days = data.history
    .filter((h) => h.day < data.day)
    .slice(0, 6)
    .reverse();
  return (
    <div className="daily-history" aria-label={t('daily.history')}>
      {days.map((h) => (
        <span key={h.day} className={h.solved ? 'ok' : ''} title={`#${h.number}`}>
          {h.solved ? '✅' : '⬛'}
        </span>
      ))}
      <span className={result.solved ? 'ok today' : 'today'} title={`#${data.number}`}>
        {result.solved ? '✅' : '⬛'}
      </span>
    </div>
  );
}

/** Cartão da home: o desafio de hoje, a sequência e o botão para jogar. */
export function DailyBanner({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const [data, setData] = useState<DailyToday | null>(null);
  useEffect(() => {
    let alive = true;
    api.daily
      .today(true)
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return null;
  return (
    <section className="learn-banner daily-banner" aria-labelledby="daily-banner-title">
      <span className="learn-banner-ico" aria-hidden="true">
        <Icon name="star" size={30} />
      </span>
      <div className="learn-banner-text">
        <span className="kicker">
          {t('daily.kicker', { n: data.number })}
          {data.streak.current > 0 ? ` · 🔥 ${t('daily.streak', { n: data.streak.current })}` : ''}
        </span>
        <h2 id="daily-banner-title">{t(GOAL_TITLE[data.challenge.goal])}</h2>
        <p>{data.result.solved ? t('daily.homeSolved', { n: data.result.attempts }) : t('daily.homeSub', { n: data.stats.solvers })}</p>
      </div>
      <div className="learn-banner-actions">
        <button type="button" className="learn-cta" onClick={onOpen}>
          {data.result.solved ? t('daily.homeAgain') : t('daily.homeCta')}
        </button>
      </div>
    </section>
  );
}
