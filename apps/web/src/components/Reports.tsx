import { formatLabel } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type FormatId, type MatchReport, type MatchSummary, type RoomQueue } from '../api';
import { setupFromReplay } from '../game/setup';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useLocale, useT } from '../i18n';
import { fmtDateTime } from '../i18n/format';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Nome de cada fila na lista de relatos: chave do dicionário. */
const QUEUE_LABEL: Record<RoomQueue, MessageKey> = {
  private: 'reports.queue.private',
  casual: 'reports.queue.casual',
  ranked: 'reports.queue.ranked',
  bot: 'reports.queue.bot',
  tournament: 'reports.queue.tournament',
};

/** Abre o replay gravado de uma partida na mesa. */
export const openReplay = (statsMatchId: number, onReplay: (setup: GameSetup) => void) =>
  api.matches
    .replay(statsMatchId)
    .then((r) => setupFromReplay(r as never))
    .then(onReplay);

/** "Luffy (ST01-001) × Kid (ST02-001)", com o vencedor em negrito. */
export function MatchLine({ m }: { m: MatchSummary }) {
  return (
    <span className="report-match">
      {m.players.map((p, i) => (
        <span key={p.seat}>
          {i > 0 && <span className="muted"> × </span>}
          <span className={p.won ? 'tour-player won' : 'tour-player'}>
            {p.name} <span className="muted small">({p.leader})</span>
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Lista de relatos para quem audita (organizador, admin, dev): a partida, o replay e
 * a resolução com nota.
 */
export function ReportList({
  reports,
  onChanged,
  onReplay,
  setError,
}: {
  reports: MatchReport[];
  /** Um relato foi resolvido ou reaberto. */
  onChanged: (r: MatchReport) => void;
  onReplay: (setup: GameSetup) => void;
  setError: (e: string | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const dateTime = (iso: string) => fmtDateTime(iso, locale);
  const [busy, setBusy] = useState<number | null>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const run = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const resolve = (r: MatchReport, resolved: boolean) =>
    run(r.id, async () => {
      onChanged(await api.reports.resolve(r.id, resolved, resolved ? note : undefined));
      setNoteFor(null);
      setNote('');
    });

  if (!reports.length) return <p className="muted">{t('reports.none')}</p>;
  return (
    <div className="report-list">
      {reports.map((r) => {
        const m = r.match;
        const queueKey = m ? QUEUE_LABEL[m.queue as RoomQueue] : undefined;
        return (
          <article key={r.id} className={['report-card', r.resolvedAt ? 'resolved' : ''].join(' ')}>
            <header className="report-head">
              <span className={['tour-status', r.resolvedAt ? 'finished' : 'running'].join(' ')}>{r.resolvedAt ? t('reports.resolved') : t('reports.open')}</span>
              {m && (
                <span className="muted small">
                  {queueKey ? t(queueKey) : m.queue} · {formatLabel(m.format as FormatId)} · {dateTime(m.playedAt)}
                  {m.tournament &&
                    t('reports.tourInfo', { name: m.tournament.name, round: m.tournament.round, table: m.tournament.table, game: m.tournament.game })}
                </span>
              )}
            </header>
            {m ? (
              <p className="report-players">
                <MatchLine m={m} />
                {m.winner === null && <span className="muted small"> · {t('reports.noWinner')}</span>}
                {m.reason && <span className="muted small"> · {m.reason}</span>}
              </p>
            ) : (
              <p className="muted small">{t('reports.matchMissing', { id: r.matchId })}</p>
            )}
            <p className="report-text">
              <b>{r.reporterName}</b> <span className="muted small">({dateTime(r.createdAt)})</span>: {r.text}
            </p>
            {r.resolvedAt && (
              <p className="muted small">
                {r.note ? t('reports.resolvedAtNote', { date: dateTime(r.resolvedAt), note: r.note }) : t('reports.resolvedAt', { date: dateTime(r.resolvedAt) })}
              </p>
            )}
            <div className="btn-row">
              <button className="btn small" disabled={busy === r.id} onClick={() => run(r.id, () => openReplay(r.matchId, onReplay))}>
                {t('reports.watchReplay')}
              </button>
              {r.resolvedAt ? (
                <button className="btn small" disabled={busy === r.id} onClick={() => resolve(r, false)}>
                  {t('reports.reopen')}
                </button>
              ) : noteFor === r.id ? (
                <>
                  <input
                    className="admin-search report-note"
                    placeholder={t('reports.notePlaceholder')}
                    maxLength={2000}
                    value={note}
                    autoFocus
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="btn small primary" disabled={busy === r.id} onClick={() => resolve(r, true)}>
                    {t('reports.confirm')}
                  </button>
                  <button className="btn small" onClick={() => setNoteFor(null)}>
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button
                  className="btn small primary"
                  disabled={busy === r.id}
                  onClick={() => {
                    setNote('');
                    setNoteFor(r.id);
                  }}
                >
                  {t('reports.resolve')}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Relatos carregados do servidor (todos, para admin; de um torneio, para o organizador), com filtro por situação. */
export function ReportsPanel({ tournament, onReplay }: { tournament?: string; onReplay: (setup: GameSetup) => void }) {
  const t = useT();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [reports, setReports] = useState<MatchReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    setReports(null);
    api.reports
      .list({ tournament, status })
      .then((r) => !stop && (setReports(r.reports), setError(null)))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [tournament, status]);
  return (
    <section className="menu-card">
      <div className="seg small">
        {(
          [
            ['open', 'reports.filterOpen'],
            ['resolved', 'reports.filterResolved'],
            ['all', 'reports.filterAll'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {reports === null && !error ? (
        <p className="muted">{t('common.loading')}</p>
      ) : reports ? (
        <ReportList
          reports={reports}
          onReplay={onReplay}
          setError={setError}
          onChanged={(r) => setReports((list) => list?.map((x) => (x.id === r.id ? r : x)) ?? null)}
        />
      ) : null}
      <p className="muted small">{t('reports.panelHint')}</p>
    </section>
  );
}
