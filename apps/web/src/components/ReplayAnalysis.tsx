// Análise da partida na barra do replay (roadmap B1): o botão que pede a análise, o progresso, o resumo por
// jogador (precisão, erros graves, erros, imprecisões) e, quando a mesa está numa decisão marcada, o cartão com o
// que foi jogado e a jogada sugerida. Os marcadores da linha do tempo ficam na própria barra (ReplayBar).

import type { DecisionReview, GameState } from '@gumgum/engine';
import { condenseLine, nearestMark } from '../game/analysis';
import { describeReplayAction } from '../game/replayCue';
import type { ReplayAnalysisState } from '../game/useReplayAnalysis';
import { type MessageKey, useLocale, useT } from '../i18n';
import { fmtNumber } from '../i18n/format';

/** Os marcadores da análise (os que já chegaram, enquanto ela roda). */
export function analysisMarks(s: ReplayAnalysisState): DecisionReview[] {
  return s.status === 'done' ? s.analysis.marks : s.status === 'running' ? s.marks : [];
}

const SEVERITY_ICON: Record<DecisionReview['severity'], string> = { good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };

export function ReplayAnalysis({
  analysis,
  state,
  pos,
  seek,
  onStart,
  onCancel,
}: {
  analysis: ReplayAnalysisState;
  /** O estado da mesa agora (posição `pos` do replay). */
  state: GameState;
  pos: number;
  /** Vai para a posição (pausa o automático). */
  seek: (n: number) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const marks = analysisMarks(analysis);
  const here = marks.find((m) => m.index === pos) ?? null;
  const prev = nearestMark(marks, pos, -1);
  const next = nearestMark(marks, pos, 1);
  const severity = (m: DecisionReview) => t(`analysis.severity.${m.severity}` as MessageKey);

  if (analysis.status === 'idle') {
    return (
      <div className="analysis-row">
        <button type="button" className="btn small analysis-run" onClick={onStart} title={t('analysis.runTitle')}>
          {t('analysis.run')}
        </button>
      </div>
    );
  }
  if (analysis.status === 'error') {
    const msg = analysis.code === 'notFinished' ? t('analysis.notFinished') : analysis.code === 'invalid' ? t('analysis.invalid') : t('analysis.failed', { message: analysis.message ?? '' });
    return (
      <div className="analysis-row">
        <span className="analysis-error">{msg}</span>
        {analysis.code === 'failed' && (
          <button type="button" className="btn small" onClick={onStart}>
            {t('analysis.retry')}
          </button>
        )}
      </div>
    );
  }

  const nav = (
    <span className="analysis-nav">
      <button type="button" className="btn small" disabled={!prev} onClick={() => prev && seek(prev.index)} title={t('analysis.prev')} aria-label={t('analysis.prev')}>
        ‹
      </button>
      <button type="button" className="btn small" disabled={!next} onClick={() => next && seek(next.index)} title={t('analysis.next')} aria-label={t('analysis.next')}>
        ›
      </button>
    </span>
  );

  return (
    <div className="analysis">
      {analysis.status === 'running' ? (
        <div className="analysis-row">
          <span className="analysis-progress" role="status">
            {analysis.total ? t('analysis.running', { done: analysis.done, total: analysis.total }) : t('analysis.preparing')}
            <progress max={analysis.total || 1} value={analysis.done} />
          </span>
          {marks.length > 0 && nav}
          <button type="button" className="btn small" onClick={onCancel}>
            {t('analysis.cancel')}
          </button>
        </div>
      ) : (
        <div className="analysis-row">
          <details className="analysis-summary">
            <summary>
              <b>{t('analysis.summary')}</b>
              {analysis.analysis.players.map((p, i) => (
                <span key={i} className={`analysis-player p${i}`}>
                  {state.players[i].name}: {p.accuracy === null ? t('analysis.noDecisions') : t('analysis.accuracy', { n: fmtNumber(p.accuracy, locale) })}
                </span>
              ))}
            </summary>
            <ul>
              {analysis.analysis.players.map((p, i) => (
                <li key={i}>
                  <b>{state.players[i].name}</b>: {t('analysis.blunders', { n: p.blunders })} · {t('analysis.mistakes', { n: p.mistakes })} ·{' '}
                  {t('analysis.inaccuracies', { n: p.inaccuracies })}
                  {p.lethalsMissed > 0 && <> · {t('analysis.lethals', { n: p.lethalsMissed })}</>}
                </li>
              ))}
            </ul>
            {!marks.length && <p className="muted small">{t('analysis.clean')}</p>}
            <ol className="analysis-list" aria-label={t('analysis.marksLabel')}>
              {marks.map((m) => (
                <li key={m.index}>
                  <button type="button" className={`analysis-jump sev-${m.severity}${m.index === pos ? ' on' : ''}`} onClick={() => seek(m.index)}>
                    <span className="analysis-sev">{SEVERITY_ICON[m.severity]}</span>
                    {t('analysis.markAt', { turn: m.turn, name: state.players[m.player].name, severity: severity(m) })}
                    <span className="analysis-loss">{t('analysis.loss', { n: fmtNumber(m.loss, locale) })}</span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="muted small">{t('analysis.knowledge')}</p>
          </details>
          {marks.length > 0 && nav}
        </div>
      )}
      {here && <MarkCard mark={here} state={state} />}
    </div>
  );
}

/** O cartão do marcador na posição atual: o tipo, o que foi jogado e a jogada sugerida (a mesa mostra a decisão). */
function MarkCard({ mark, state }: { mark: DecisionReview; state: GameState }) {
  const t = useT();
  const locale = useLocale();
  const title = (a: Parameters<typeof describeReplayAction>[1]) => describeReplayAction(state, a, locale).title;
  const name = (uid: string) => (state.cards[uid] ? state.defs[state.cards[uid].cardId]?.name ?? uid : uid);
  const attack = mark.best.find((a) => a.type === 'attack');
  const tag = mark.tag ?? 'better';
  const text =
    tag === 'attackCharacter' && attack?.type === 'attack'
      ? t('analysis.tag.attackCharacter', { target: name(attack.target) })
      : t(`analysis.tag.${tag}` as MessageKey);
  const line = condenseLine(mark);
  return (
    <div className={`analysis-mark sev-${mark.severity}`} role="note">
      <p className="analysis-mark-head">
        <span className="analysis-sev">{SEVERITY_ICON[mark.severity]}</span>
        <b>{t(`analysis.severity.${mark.severity}` as MessageKey)}</b> · {state.players[mark.player].name} · {text}
        <span className="analysis-loss" title={t('analysis.lossTitle')}>
          {t('analysis.loss', { n: fmtNumber(mark.loss, locale) })}
        </span>
      </p>
      <p>
        <span className="analysis-k">{t('analysis.played')}</span> {title(mark.played)}
      </p>
      <p>
        <span className="analysis-k">{t('analysis.suggested')}</span>{' '}
        {line.map(({ action, count }, i) => (
          <span key={i}>
            {i > 0 && ' → '}
            {title(action)}
            {count > 1 && ` ×${count}`}
          </span>
        ))}
      </p>
    </div>
  );
}
