import { formatLabel } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type FormatId, type MatchReport, type MatchSummary, type RoomQueue } from '../api';
import { setupFromReplay } from '../game/setup';
import type { GameSetup } from '../game/useGame';
import { QUEUE_LABEL } from './HomeBlocks';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

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

  if (!reports.length) return <p className="muted">Nenhum relato.</p>;
  return (
    <div className="report-list">
      {reports.map((r) => {
        const m = r.match;
        return (
          <article key={r.id} className={['report-card', r.resolvedAt ? 'resolved' : ''].join(' ')}>
            <header className="report-head">
              <span className={['tour-status', r.resolvedAt ? 'finished' : 'running'].join(' ')}>{r.resolvedAt ? 'Resolvido' : 'Aberto'}</span>
              {m && (
                <span className="muted small">
                  {QUEUE_LABEL[m.queue as RoomQueue] ?? m.queue} · {formatLabel(m.format as FormatId)} · {dateTime(m.playedAt)}
                  {m.tournament && ` · ${m.tournament.name} · Rodada ${m.tournament.round} · Mesa ${m.tournament.table} · Jogo ${m.tournament.game}`}
                </span>
              )}
            </header>
            {m ? (
              <p className="report-players">
                <MatchLine m={m} />
                {m.winner === null && <span className="muted small"> · sem vencedor</span>}
                {m.reason && <span className="muted small"> · {m.reason}</span>}
              </p>
            ) : (
              <p className="muted small">Partida #{r.matchId} (não encontrada).</p>
            )}
            <p className="report-text">
              <b>{r.reporterName}</b> <span className="muted small">({dateTime(r.createdAt)})</span>: {r.text}
            </p>
            {r.resolvedAt && (
              <p className="muted small">
                Resolvido em {dateTime(r.resolvedAt)}
                {r.note ? `: ${r.note}` : '.'}
              </p>
            )}
            <div className="btn-row">
              <button
                className="btn small"
                disabled={busy === r.id}
                onClick={() => run(r.id, () => openReplay(r.matchId, onReplay))}
              >
                ▶ Assistir replay
              </button>
              {r.resolvedAt ? (
                <button className="btn small" disabled={busy === r.id} onClick={() => resolve(r, false)}>
                  Reabrir
                </button>
              ) : noteFor === r.id ? (
                <>
                  <input
                    className="admin-search report-note"
                    placeholder="Nota (opcional): o que foi feito"
                    maxLength={2000}
                    value={note}
                    autoFocus
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="btn small primary" disabled={busy === r.id} onClick={() => resolve(r, true)}>
                    Confirmar
                  </button>
                  <button className="btn small" onClick={() => setNoteFor(null)}>
                    Cancelar
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
                  ✔ Resolver
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
            ['open', 'Abertos'],
            ['resolved', 'Resolvidos'],
            ['all', 'Todos'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>
            {label}
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {reports === null && !error ? (
        <p className="muted">Carregando…</p>
      ) : reports ? (
        <ReportList
          reports={reports}
          onReplay={onReplay}
          setError={setError}
          onChanged={(r) => setReports((list) => list?.map((x) => (x.id === r.id ? r : x)) ?? null)}
        />
      ) : null}
      <p className="muted small">
        Os jogadores relatam problemas ao fim das partidas ranqueadas e de torneio. Toda partida fica gravada: o replay mostra
        exatamente o que aconteceu.
      </p>
    </section>
  );
}
