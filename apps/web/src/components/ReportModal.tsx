import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';

/**
 * Relatar um problema numa partida ranqueada ou de torneio que acabou de terminar. O
 * relato vai para o organizador do torneio e para os admins, com o replay da partida.
 */
export function ReportModal({ matchId, tournament, onClose }: { matchId: number; tournament: string | null; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.matches.report(matchId, text);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet report-sheet" role="dialog" aria-label={t('reports.dialogLabel')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('reports.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body report-body">
          {sent ? (
            <>
              <p>
                <b>{t('reports.sent')}</b> {tournament ? t('reports.sentTournament') : t('reports.sentAdmins')}
              </p>
              <div className="btn-row">
                <button className="btn primary" onClick={onClose}>
                  {t('common.close')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">{tournament ? t('reports.describeTournament', { tournament }) : t('reports.describeAdmins')}</p>
              <textarea
                className="admin-search"
                rows={5}
                maxLength={2000}
                autoFocus
                placeholder={t('reports.textPlaceholder')}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {error && <div className="error">{error}</div>}
              <div className="btn-row">
                <button className="btn" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button className="btn primary" disabled={busy || text.trim().length < 5} onClick={send}>
                  {busy ? t('reports.sending') : t('reports.send')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
