// Bot do Time: o relatório da partida no fim (as jogadas marcadas como erradas no painel do treinador, a nota e um
// comentário opcionais). "Copiar" leva o texto; "Salvar e baixar o pacote" grava o relatório no servidor (ele aparece
// na tela "Bot do Time") e baixa o pacote para o Claude: o relatório, o guia e o perfil do deck e o replay.

import type { BotLevel } from '@gumgum/engine';
import { useState } from 'react';
import { api, type FeedbackMark } from '../api';
import { saveFile } from '../recap/export';
import { useT } from '../i18n';
import { copyText } from './CoachPanel';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BotReport({
  matchId,
  level,
  marks,
  build,
}: {
  /** A partida gravada no servidor (null enquanto grava: só dá para copiar). */
  matchId: number | null;
  level?: BotLevel;
  /** As marcações no formato do servidor. */
  marks: FeedbackMark[];
  /** Monta o relatório com a nota e o comentário escolhidos aqui. */
  build: (rating: number, comment: string) => string;
}) {
  const t = useT();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = build(rating, comment);
  const copy = async () => {
    if (await copyText(report)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const save = async () => {
    if (matchId === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.bot.feedback(matchId, { level, ...(rating ? { rating } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}), marks, report });
      if (r.reportId === null) throw new Error(t('botFeedback.notSaved'));
      setSaved(r.reportId);
      const pkg = await api.bot.reportPackage([r.reportId]);
      saveFile(new Blob([pkg.content], { type: 'text/markdown' }), pkg.filename);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bot-rating" role="group" aria-label={t('botFeedback.title')}>
      <b>{t('botFeedback.title')}</b>
      <span className="muted small">{marks.length ? t('botFeedback.marks', { n: marks.length }) : t('botFeedback.noMarks')}</span>
      <div className="bot-rating-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={n <= rating ? 'on' : ''}
            aria-pressed={n === rating}
            aria-label={t(`botFeedback.star${n}` as 'botFeedback.star1')}
            title={t(`botFeedback.star${n}` as 'botFeedback.star1')}
            onClick={() => setRating(n === rating ? 0 : n)}
          >
            ★
          </button>
        ))}
        {rating > 0 && <span className="muted small">{t(`botFeedback.star${rating}` as 'botFeedback.star1')}</span>}
      </div>
      <textarea value={comment} rows={2} maxLength={2000} placeholder={t('botFeedback.commentPlaceholder')} onChange={(e) => setComment(e.target.value)} />
      <details className="coach-report">
        <summary>{t('botFeedback.preview')}</summary>
        <pre>{report}</pre>
      </details>
      <div className="bot-rating-row">
        <button className="btn small" onClick={copy}>
          {copied ? t('coach.copied') : t('coach.copy')}
        </button>
        <button className="btn small primary" disabled={busy || matchId === null} onClick={save} title={t('botFeedback.saveTitle')}>
          {busy ? t('common.saving') : matchId === null ? t('botFeedback.waitingMatch') : saved ? t('botFeedback.saveAgain') : t('botFeedback.save')}
        </button>
      </div>
      {saved !== null && <span className="muted small">{t('botFeedback.saved')}</span>}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
