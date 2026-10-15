// Judge na mesa: a faixa de "partida pausada" (para todos) e o painel do Judge (quem entrou
// na sala como Judge do torneio ou organizador): pausar, retomar com o relato e dar warnings.

import type { PlayerId } from '@gumgum/engine';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '../api';
import type { OnlineGame } from '../game/useOnlineGame';
import { useT } from '../i18n';

const errorText = (e: unknown) => (e instanceof ApiError ? errorMessage(e.data, e.message) : e instanceof Error ? e.message : String(e));

/** Faixa sobre a mesa enquanto a partida está pausada por um chamado de Judge. */
export function PauseBanner({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  if (!room?.pause || room.status !== 'playing') return null;
  const by = room.pause.by === null ? null : room.players[room.pause.by]?.name;
  return (
    <div className="judge-pause" role="status">
      <span className="judge-pause-ico">⚖</span>
      <div>
        <strong>{t('judge.paused')}</strong>
        <span>{by ? t('judge.pausedBy', { name: by }) : t('judge.pausedByJudge')}</span>
        {!online.watching && <span className="muted">{t('judge.pausedHint')}</span>}
      </div>
    </div>
  );
}

/** Painel do Judge na sala: pausar/retomar (com o relato ao organizador) e warnings para cada jogador. */
export function JudgePanel({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  const [note, setNote] = useState('');
  const [warning, setWarning] = useState<{ seat: PlayerId; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  if (!room?.tournament) return null;
  const tour = room.tournament;
  const paused = Boolean(room.pause);
  const playing = room.status === 'playing';
  const run = async (fn: () => Promise<unknown>, after?: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      if (after) setDone(after);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={['judge-panel', open ? '' : 'closed', paused ? 'paused' : ''].join(' ')}>
      <button className="judge-panel-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>⚖ {t('judge.panelTitle')}</span>
        <span className="muted small">{paused ? t('judge.statusPaused') : playing ? t('judge.statusPlaying') : t('judge.statusOver')}</span>
      </button>
      {open && (
        <div className="judge-panel-body">
          {paused ? (
            <>
              <textarea
                className="admin-search"
                rows={2}
                maxLength={300}
                placeholder={t('judge.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn primary small"
                disabled={busy}
                onClick={() => run(() => api.tournaments.resume(tour.id, tour.matchId, note.trim() || undefined).then(() => setNote('')), t('judge.resumed'))}
              >
                {t('judge.resume')}
              </button>
            </>
          ) : (
            playing && (
              <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.call(tour.id, tour.matchId))}>
                {t('judge.pause')}
              </button>
            )
          )}
          <div className="judge-warn-row">
            {room.players.map((p, i) =>
              p.userId ? (
                <button
                  key={i}
                  className={['btn', 'small', warning?.seat === i ? 'on' : ''].join(' ')}
                  disabled={busy}
                  onClick={() => setWarning(warning?.seat === i ? null : { seat: i as PlayerId, reason: '' })}
                >
                  {t('judge.warnBtn', { name: p.name })}
                </button>
              ) : null,
            )}
          </div>
          {warning && (
            <form
              className="judge-warn-form"
              onSubmit={(e) => {
                e.preventDefault();
                const userId = room.players[warning.seat]?.userId;
                if (!userId || warning.reason.trim().length < 3) return;
                void run(() => api.tournaments.warn(tour.id, userId, warning.reason.trim(), tour.matchId), t('judge.warned', { name: room.players[warning.seat].name })).then(() =>
                  setWarning(null),
                );
              }}
            >
              <input
                className="admin-search"
                maxLength={300}
                placeholder={t('judge.reasonPlaceholder')}
                value={warning.reason}
                onChange={(e) => setWarning({ ...warning, reason: e.target.value })}
              />
              <button className="btn small danger" type="submit" disabled={busy || warning.reason.trim().length < 3}>
                {t('judge.warnConfirm', { name: room.players[warning.seat]?.name ?? '?' })}
              </button>
            </form>
          )}
          {error && <div className="error small">{error}</div>}
          {done && <div className="judge-done small">{done}</div>}
          <p className="muted small">{t('judge.panelHint')}</p>
        </div>
      )}
    </div>
  );
}
