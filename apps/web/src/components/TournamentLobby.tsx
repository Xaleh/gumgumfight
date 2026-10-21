// Lobby do torneio: as mesas da rodada em cartões. Jogadores veem quem joga, quem venceu (W) e
// quem perdeu (L, escurecido). O Judge e o organizador veem também o relógio de cada jogador,
// quem está conectado, a aura vermelha piscando nas salas que chamaram o Judge (com o banner no
// topo) e a aura verde nas mesas com os dois jogadores prontos. Antes do início, os inscritos
// aparecem em cinza e ganham cor ao fazer check-in.

import { useEffect, useState } from 'react';
import { api, type LobbyPlayer, type LobbySide, type LobbyTable, type OnlineSeat, type TournamentDetail, type TournamentLobby as Lobby, type WatchTarget } from '../api';
import { useAuth } from '../auth';
import { type Locale, useLocale, useT } from '../i18n';
import { fmtTime } from '../i18n/format';
import { useNow } from './HomeBlocks';
import { LeaderArt } from './LeaderArt';
import { WarningDots } from './Tournaments';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clockTime = (iso: string | null, locale: Locale) => (iso ? fmtTime(iso, locale) : '');

/** mm:ss de um tempo em ms. */
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TournamentLobby({
  id,
  onClose,
  onPlay,
  onWatch,
  run,
  busy,
}: {
  id: string;
  onClose: () => void;
  onPlay: (seat: OnlineSeat) => void;
  onWatch: (t: WatchTarget) => void;
  run: (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => Promise<void>;
  busy: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** performance.now() de quando os relógios chegaram (correm localmente até a próxima consulta). */
  const [at, setAt] = useState(0);
  const now = useNow(1000);
  void now;

  // O Judge e o organizador consultam a cada 2 s (relógios e chamados); os jogadores, a cada 5 s.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api.tournaments
        .lobby(id)
        .then((d) => {
          if (stop) return;
          setLobby(d);
          setAt(performance.now());
          setError(null);
          timer = setTimeout(load, d.viewer.judge ? 2000 : 5000);
        })
        .catch((e) => {
          if (stop) return;
          setError(errorText(e));
          timer = setTimeout(load, 5000);
        });
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, user?.id]);

  const judge = lobby?.viewer.judge ?? false;
  const manage = lobby?.viewer.manage ?? false;
  const me = lobby?.viewer.userId ?? null;
  const elapsed = performance.now() - at;
  const remaining = (side: LobbySide) => (side.remaining === null ? null : side.running ? Math.max(0, side.remaining - elapsed) : side.remaining);

  return (
    <div className="coverage tournaments tour-lobby">
      <header className="builder-header">
        <button className="btn small" onClick={onClose}>
          {tr('lobby.back')}
        </button>
        <h2>{lobby ? tr('lobby.title', { name: lobby.name }) : tr('lobby.titlePlain')}</h2>
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}
        {!lobby && !error && <p className="muted">{tr('common.loading')}</p>}
        {lobby && judge && lobby.calls.length > 0 && (
          <div className="lobby-calls" role="alert">
            {lobby.calls.map((c) => (
              <div key={c.matchId} className="lobby-call">
                <span className="lobby-call-ico">⚖</span>
                <div className="lobby-call-text">
                  <strong>{tr('lobby.callBanner', { table: c.table, a: c.names[0], b: c.names[1] })}</strong>
                  {c.reason && <span className="small">{tr(`judge.reason.${c.reason}`)}</span>}
                  <span className="small">{tr('lobby.callSince', { time: clockTime(c.openedAt, locale) })}</span>
                </div>
                {c.roomId && (
                  <button className="btn primary small" onClick={() => onWatch({ roomId: c.roomId!, hands: false, judge: true })}>
                    {tr('lobby.enterRoom')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {lobby && judge && lobby.warningsPending.length > 0 && (
          <div className="error small">{tr('lobby.warningsPending', { names: lobby.warningsPending.map((p) => p.name).join(', ') })}</div>
        )}
        {lobby && (
          <section className="menu-card lobby-head">
            <div className="tour-card-head">
              <strong>
                {lobby.status === 'registration'
                  ? lobby.checkIn
                    ? tr('lobby.checkInPhase', { n: lobby.checkedIn, total: lobby.players.length })
                    : tr('lobby.registrationPhase', { n: lobby.players.length })
                  : lobby.status === 'finished'
                    ? tr('lobby.finished')
                    : lobby.roundStartedAt
                      ? tr('lobby.roundRunning', { label: lobby.label })
                      : tr('lobby.roundWaiting', { label: lobby.label })}
              </strong>
              {lobby.status === 'running' && (
                <span className="muted small">
                  {lobby.roundStartedAt
                    ? lobby.deadline
                      ? tr('lobby.deadline', { time: clockTime(lobby.deadline, locale) })
                      : tr('lobby.startedAt', { time: clockTime(lobby.roundStartedAt, locale) })
                    : tr('lobby.readyTables', { ready: lobby.readyTables, total: lobby.pendingTables })}
                </span>
              )}
            </div>
            {lobby.status === 'registration' && lobby.startsAt && (
              <p className="muted small">
                {lobby.autoStart ? tr('lobby.autoStartAt', { time: clockTime(lobby.startsAt, locale) }) : tr('lobby.manualStartAt', { time: clockTime(lobby.startsAt, locale) })}
              </p>
            )}
            {manage && lobby.status === 'running' && !lobby.roundStartedAt && (
              <div className="btn-row">
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => run(() => api.tournaments.beginRound(id), tr('tour.confirmBeginRound', { ready: lobby.readyTables, tables: lobby.pendingTables }))}
                >
                  {tr('tour.beginRound', { ready: lobby.readyTables, tables: lobby.pendingTables })}
                </button>
              </div>
            )}
            {manage && lobby.status === 'registration' && (
              <div className="btn-row">
                <button
                  className="btn primary"
                  disabled={busy || lobby.players.length < 2}
                  onClick={() => run(() => api.tournaments.start(id), tr('tour.confirmStart', { n: lobby.players.length }))}
                >
                  {tr('tour.start')}
                </button>
              </div>
            )}
            {judge && lobby.judges.length > 0 && (
              <p className="muted small">
                {tr('tour.judgesLabel')} {lobby.judges.map((j) => j.name).join(', ')}
              </p>
            )}
            <p className="muted small">{tr(judge ? 'lobby.legendJudge' : 'lobby.legend')}</p>
          </section>
        )}

        {lobby && lobby.status === 'registration' && (
          <div className="lobby-grid players">
            {lobby.players.map((p) => (
              <PlayerCard key={p.userId} p={p} apt={!lobby.checkIn || p.checkedIn} me={p.userId === me} judge={judge} />
            ))}
            {lobby.players.length === 0 && <p className="muted">{tr('tour.noPlayers')}</p>}
          </div>
        )}

        {lobby && lobby.status !== 'registration' && (
          <div className="lobby-grid">
            {lobby.tables.map((m) => (
              <TableCard
                key={m.id}
                m={m}
                lobby={lobby}
                me={me}
                judge={judge}
                remaining={remaining}
                busy={busy}
                onReady={(ready) => run(() => api.tournaments.ready(id, m.id, ready))}
                onPlay={() =>
                  run(async () => {
                    onPlay(await api.tournaments.play(id, m.id));
                  })
                }
                onWatch={() => m.roomId && onWatch({ roomId: m.roomId, hands: false, ...(judge ? { judge: true } : {}) })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inscrito antes do início: cinza até fazer o check-in. */
function PlayerCard({ p, apt, me, judge }: { p: LobbyPlayer; apt: boolean; me: boolean; judge: boolean }) {
  const tr = useT();
  return (
    <div className={['lobby-card', 'player', apt ? 'apt' : 'waiting', me ? 'me' : '', p.dropped ? 'dropped' : ''].join(' ')}>
      <LeaderArt name={p.leaderName ?? undefined} image={p.leaderImage} colors={p.colors} size="small" />
      <span className="watch-name">
        <b>{p.name}</b>
        <span className="muted small">{apt ? tr('lobby.checkedIn') : tr('lobby.notCheckedIn')}</span>
      </span>
      {judge && p.warnings && p.warnings.count > 0 && <WarningDots w={{ ...p.warnings, limitReached: p.warnings.max !== null && p.warnings.count >= p.warnings.max }} />}
    </div>
  );
}

function TableCard({
  m,
  lobby,
  me,
  judge,
  remaining,
  busy,
  onReady,
  onPlay,
  onWatch,
}: {
  m: LobbyTable;
  lobby: Lobby;
  me: string | null;
  judge: boolean;
  remaining: (side: LobbySide) => number | null;
  busy: boolean;
  onReady: (ready: boolean) => void;
  onPlay: () => void;
  onWatch: () => void;
}) {
  const tr = useT();
  const started = Boolean(lobby.roundStartedAt);
  const mine = m.p1.userId === me ? 0 : m.p2?.userId === me ? 1 : null;
  const bothReady = Boolean(m.p2 && m.p1.ready && m.p2.ready);
  const calling = Boolean(m.call);
  const state = m.result
    ? 'done'
    : calling
      ? 'calling'
      : m.room === 'playing'
        ? m.paused
          ? 'paused'
          : 'playing'
        : !started && bothReady
          ? 'ready'
          : m.room === 'waiting'
            ? 'waiting'
            : 'idle';
  const side = (p: (LobbyPlayer & LobbySide) | null, i: 0 | 1) => {
    if (!p) return <div className="lobby-side bye muted">{tr(m.result === 'loss' ? 'tour.lateLoss' : 'tour.bye')}</div>;
    const won = m.result && m.winner === p.userId;
    const lost = m.result && m.result !== 'none' && m.winner !== p.userId;
    const left = judge ? remaining(p) : null;
    return (
      <div className={['lobby-side', won ? 'won' : '', lost || m.result === 'none' ? 'lost' : '', p.userId === me ? 'me' : ''].join(' ')}>
        {m.result && m.result !== 'none' && <span className={['wl', won ? 'w' : 'l'].join(' ')}>{won ? 'W' : 'L'}</span>}
        <LeaderArt name={p.leaderName ?? undefined} image={p.leaderImage} colors={p.colors} size="small" />
        <span className="watch-name">
          <b>
            {p.name}
            {judge && p.connected !== null && (
              <span className={['presence', p.connected ? 'on' : 'off'].join(' ')} title={p.connected ? tr('online.connected') : tr('online.disconnected')} />
            )}
          </b>
          <span className="muted small">
            {!m.result && !started && (p.ready ? tr('lobby.ready') : tr('lobby.notReady'))}
            {!m.result && started && m.room !== 'playing' && (p.present ? tr('lobby.present') : tr('lobby.absent'))}
            {m.bestOf > 1 && (m.wins[0] + m.wins[1] > 0 || m.result) && ` · ${m.wins[i]}`}
          </span>
          {judge && p.warnings && (p.warnings.count > 0 || p.warnings.pending) && (
            <WarningDots w={{ ...p.warnings, limitReached: p.warnings.max !== null && p.warnings.count >= p.warnings.max }} />
          )}
        </span>
        {left !== null && !m.result && (
          <span className={['clock', p.running && !m.paused ? 'running' : '', left < 60_000 ? 'low' : ''].join(' ')}>⏱ {clock(left)}</span>
        )}
      </div>
    );
  };
  return (
    <div className={['lobby-card', 'table', state, mine !== null ? 'mine' : ''].join(' ')}>
      <div className="lobby-card-head">
        <span className="muted small">{tr('tour.tableN', { n: m.table })}</span>
        <span className="small lobby-state">
          {state === 'done'
            ? m.result === 'none'
              ? tr(m.reportedBy === 'noshow' ? 'tour.doubleNoShow' : 'tour.doubleLoss')
              : tr('lobby.stateDone')
            : state === 'calling'
              ? judge && m.call?.byName
                ? tr('lobby.stateCallingBy', { name: m.call.byName })
                : tr('lobby.stateCalling')
              : state === 'paused'
                ? tr('lobby.statePaused')
                : state === 'playing'
                  ? m.bestOf > 1
                    ? tr('lobby.statePlayingGame', { n: m.game })
                    : tr('lobby.statePlaying')
                  : state === 'ready'
                    ? tr('lobby.stateReady')
                    : state === 'waiting'
                      ? tr('lobby.stateWaiting')
                      : started
                        ? tr('lobby.stateNotStarted')
                        : tr('lobby.stateIdle')}
        </span>
      </div>
      {side(m.p1, 0)}
      {m.p2 && <span className="lobby-vs muted small">{tr('tour.vs')}</span>}
      {side(m.p2, 1)}
      <div className="btn-row lobby-actions">
        {mine !== null && !m.result && !started && (
          <button className={['btn', 'small', (mine === 0 ? m.p1 : m.p2!).ready ? '' : 'primary'].join(' ')} disabled={busy} onClick={() => onReady(!(mine === 0 ? m.p1 : m.p2!).ready)}>
            {(mine === 0 ? m.p1 : m.p2!).ready ? tr('tour.readyOn') : tr('tour.readyBtn')}
          </button>
        )}
        {mine !== null && !m.result && started && (
          <button className="btn small primary" disabled={busy} onClick={onPlay}>
            {m.room === 'playing' ? tr('tour.backToGame') : tr('tour.playMatch')}
          </button>
        )}
        {mine === null && !m.result && m.room === 'playing' && (
          <button className={['btn', 'small', calling ? 'danger' : ''].join(' ')} onClick={onWatch}>
            {judge ? tr('tour.watchAsJudge') : tr('tour.watch')}
          </button>
        )}
      </div>
    </div>
  );
}
