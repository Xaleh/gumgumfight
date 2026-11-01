// Bot do Time: a nota da partida (1 a 5) e o envio das jogadas marcadas no fim de uma partida contra o bot.
// Só para quem faz parte do Time, com a partida já gravada no servidor.

import type { BotLevel } from '@gumgum/engine';
import { useState } from 'react';
import { api, type FeedbackMark } from '../api';
import { useT } from '../i18n';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BotRating({ matchId, level, marks }: { matchId: number; level?: BotLevel; marks: FeedbackMark[] }) {
  const t = useT();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.bot.feedback(matchId, { level, ...(rating ? { rating } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}), marks });
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (sent) return <p className="bot-rating sent">{t('botFeedback.sent')}</p>;
  return (
    <div className="bot-rating" role="group" aria-label={t('botFeedback.title')}>
      <b>{t('botFeedback.title')}</b>
      <div className="bot-rating-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={n <= rating ? 'on' : ''}
            aria-pressed={n === rating}
            aria-label={t(`botFeedback.star${n}` as 'botFeedback.star1')}
            title={t(`botFeedback.star${n}` as 'botFeedback.star1')}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
        {rating > 0 && <span className="muted small">{t(`botFeedback.star${rating}` as 'botFeedback.star1')}</span>}
      </div>
      <textarea value={comment} rows={2} maxLength={2000} placeholder={t('botFeedback.commentPlaceholder')} onChange={(e) => setComment(e.target.value)} />
      <div className="bot-rating-row">
        {marks.length > 0 && <span className="muted small">{t('botFeedback.marks', { n: marks.length })}</span>}
        <button className="btn small" disabled={busy || (!rating && !marks.length)} onClick={send}>
          {busy ? t('common.saving') : t('botFeedback.send')}
        </button>
      </div>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
