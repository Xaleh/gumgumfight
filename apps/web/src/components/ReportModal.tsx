import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { GoogleButton, useAuth } from '../auth';
import { useT } from '../i18n';
import { notificationPermission, pushSupport, syncPush } from '../pwa';
import { useSettings } from '../settings';

/** Carta da partida, para sugerir no campo "qual carta". */
export interface ReportCardOption {
  id: string;
  name: string;
}

/**
 * Relatar um bug na partida que acabou de terminar: a carta, a interação que deu
 * problema, o que deveria ter acontecido e se o jogador quer ser avisado da correção. O
 * relato vai para os admins (e, em torneio, para o organizador), com o replay da partida.
 */
export function ReportModal({
  matchId,
  tournament,
  cards = [],
  onClose,
}: {
  matchId: number;
  tournament: string | null;
  /** Cartas da partida (sugestões do campo da carta). */
  cards?: ReportCardOption[];
  onClose: () => void;
}) {
  const t = useT();
  const { user, clientId, signIn } = useAuth();
  const settings = useSettings();
  const ids = useId();
  const [card, setCard] = useState('');
  const [text, setText] = useState('');
  const [expected, setExpected] = useState('');
  const [notify, setNotify] = useState(false);
  const [pushProblem, setPushProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pediu o aviso com as notificações desligadas: liga agora (o pedido de permissão precisa ser num toque).
  const toggleNotify = async (on: boolean) => {
    setNotify(on);
    setPushProblem(false);
    if (!on || settings.notify) return;
    try {
      if (!settings.pushKey || pushSupport() !== 'ok' || notificationPermission() === 'denied') throw new Error('push');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('push');
      await syncPush(settings.pushKey, { locale: settings.locale, matches: settings.notifyMatches, tournaments: settings.notifyTournaments });
      settings.update({ notify: true });
    } catch {
      setPushProblem(true);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.matches.report(matchId, { text, card: card.trim() || undefined, expected, notify });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = text.trim().length >= 5 && expected.trim().length > 0;

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered report-backdrop" onClick={onClose}>
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
              {notify && <p className="muted small">{t('reports.sentNotify')}</p>}
              <div className="btn-row">
                <button className="btn primary" onClick={onClose}>
                  {t('common.close')}
                </button>
              </div>
            </>
          ) : !user ? (
            <>
              <p className="muted small">{t('reports.loginFirst')}</p>
              {clientId && <GoogleButton clientId={clientId} onCredential={(c) => void signIn(c)} />}
              <div className="btn-row">
                <button className="btn" onClick={onClose}>
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">{tournament ? t('reports.describeTournament', { tournament }) : t('reports.describeAdmins')}</p>
              <div className="field">
                <label htmlFor={`${ids}-card`}>
                  {t('reports.cardLabel')} {t('reports.optional')}
                </label>
                <input
                  id={`${ids}-card`}
                  className="admin-search"
                  list={`${ids}-cards`}
                  maxLength={120}
                  autoFocus
                  placeholder={t('reports.cardPlaceholder')}
                  value={card}
                  onChange={(e) => setCard(e.target.value)}
                />
                <datalist id={`${ids}-cards`}>
                  {cards.map((c) => (
                    <option key={c.id} value={`${c.name} (${c.id})`} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor={`${ids}-text`}>{t('reports.textLabel')}</label>
                <textarea
                  id={`${ids}-text`}
                  className="admin-search"
                  rows={4}
                  maxLength={2000}
                  placeholder={t('reports.textPlaceholder')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${ids}-expected`}>{t('reports.expectedLabel')}</label>
                <textarea
                  id={`${ids}-expected`}
                  className="admin-search"
                  rows={3}
                  maxLength={2000}
                  placeholder={t('reports.expectedPlaceholder')}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </div>
              <label className="check">
                <input type="checkbox" checked={notify} onChange={(e) => void toggleNotify(e.target.checked)} />
                {t('reports.notifyLabel')}
              </label>
              {notify && <p className="muted small">{pushProblem ? t('reports.notifyNoPush') : t('reports.notifyHint')}</p>}
              {error && <div className="error">{error}</div>}
              <div className="btn-row">
                <button className="btn" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button className="btn primary" disabled={busy || !ready} onClick={send}>
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
