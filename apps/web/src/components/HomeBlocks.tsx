// Blocos de baixo da Home: partidas ao vivo, torneios e Líderes mais jogados da semana.

import { formatLabel } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  type LiveRoom,
  type OnlineSeat,
  type RoomQueue,
  STRUCTURE_LABEL,
  TOURNAMENT_STATUS_LABEL,
  type TournamentMine,
  type TournamentSummary,
  type WatchTarget,
} from '../api';
import { type Locale, type MessageKey, type Translate, useLocale, useT } from '../i18n';
import { fmtTime, fmtWeekdayTime } from '../i18n/format';
import { Icon } from './Icons';
import { LeaderArt } from './LeaderArt';

/**
 * Busca `load` agora e a cada `ms` enquanto a aba está visível (e de novo ao voltar
 * para ela). `null` = ainda sem resposta.
 */
export function usePoll<T>(load: () => Promise<T>, ms: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (document.hidden) return;
      loader
        .current()
        .then((v) => !stop && setValue(v))
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
  return value;
}

/** Hora atual, atualizada a cada `ms` (contagens regressivas). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * Nome de cada tipo de sala, em português (ainda usado por Reports.tsx).
 * Para mostrar no idioma em vigor, use `t(QUEUE_KEY[queue])`.
 */
export const QUEUE_LABEL: Record<RoomQueue, string> = {
  private: 'Sala privada',
  casual: 'Casual',
  ranked: 'Ranqueada',
  bot: 'Treino',
  tournament: 'Torneio',
};

/** Chave do dicionário de cada tipo de sala (mostrar com `t(QUEUE_KEY[queue])`). */
export const QUEUE_KEY: Record<RoomQueue, MessageKey> = {
  private: 'home.queue.private',
  casual: 'home.queue.casual',
  ranked: 'home.queue.ranked',
  bot: 'home.queue.bot',
  tournament: 'home.queue.tournament',
};

function LiveRow({ room, onWatch }: { room: LiveRoom; onWatch: (t: WatchTarget) => void }) {
  const t = useT();
  const [a, b] = room.players;
  const name = (p: LiveRoom['players'][number]) => p.leaderName ?? p.name;
  const where = room.tournament ? `${room.tournament.name} · ${room.tournament.label}` : t(QUEUE_KEY[room.queue]);
  return (
    <div className="live-row">
      <div className="live-leaders">
        {room.players.map((p, i) => (
          <LeaderArt key={i} name={name(p)} image={p.leaderImage} colors={p.colors} size="tiny" />
        ))}
      </div>
      <div className="live-info">
        <strong>{t('home.versus', { a: name(a), b: name(b) })}</strong>
        <span>{t('home.whereTurn', { where, turn: room.turn })}</span>
      </div>
      {room.spectators > 0 && (
        <span className="eyes" title={t('home.watching', { n: room.spectators })}>
          <Icon name="eye" size={14} />
          {room.spectators}
        </span>
      )}
      <button type="button" className="small-btn" onClick={() => onWatch({ roomId: room.id, hands: false })}>
        {t('home.watch')}
      </button>
    </div>
  );
}

export function LiveNow({ onWatch, onAll }: { onWatch: (t: WatchTarget) => void; onAll: () => void }) {
  const t = useT();
  const live = usePoll(() => api.online.live(), 15_000);
  const rooms = (live?.rooms ?? []).filter((r) => !r.mine && r.players.length === 2).slice(0, 3);
  return (
    <section className="home-block" aria-labelledby="home-live">
      <div className="block-head">
        <h2 id="home-live">
          <span className="rec-dot" />
          {t('home.liveNow')}
        </h2>
        <button type="button" className="text-link" onClick={onAll}>
          {t('home.seeAllMatches')}
        </button>
      </div>
      {live === null ? (
        <p className="block-empty">{t('common.loading')}</p>
      ) : rooms.length ? (
        rooms.map((r) => <LiveRow key={r.id} room={r} onWatch={onWatch} />)
      ) : (
        <p className="block-empty">{t('home.noLive')}</p>
      )}
    </section>
  );
}

const clockTime = (iso: string | null, locale: Locale) => (iso ? fmtTime(iso, locale) : '');

/** "restam 4min30s". */
function countdown(deadline: string, now: number, t: Translate) {
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  return left ? t('home.timeLeft', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') }) : t('home.deadlinePassed');
}

/**
 * Atalho da tela inicial para o torneio em jogo: check-in aberto, a partida da rodada
 * (entrar na sala) ou a espera pela próxima rodada.
 */
export function TournamentBanner({
  entry,
  onOpen,
  onPlay,
  onCheckIn,
}: {
  entry: TournamentMine;
  onOpen: () => void;
  /** Entra na sala da partida (devolve o assento). */
  onPlay: () => Promise<OnlineSeat>;
  onCheckIn: () => Promise<unknown>;
}) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    fn()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const m = entry.match;
  const pending = entry.status === 'running' && m && m.opponent && !m.result;
  let title: string;
  let sub: string;
  let action: { label: string; run: () => void };
  if (entry.status === 'registration') {
    title = t('home.checkInOpenFor', { name: entry.name });
    sub = entry.checkedIn
      ? t('home.checkedInStarts', { time: clockTime(entry.startsAt, locale) })
      : t('home.confirmPresence', { time: clockTime(entry.startsAt, locale) });
    action = entry.checkedIn ? { label: t('home.openTournament'), run: onOpen } : { label: t('home.doCheckIn'), run: () => act(onCheckIn) };
  } else if (pending) {
    const params = { name: entry.name, label: entry.label, table: m.table, opponent: m.opponent, game: m.game };
    title = m.bestOf > 1 ? t('home.matchTitleGame', params) : t('home.matchTitle', params);
    sub =
      m.room === 'playing'
        ? t('home.matchRunning')
        : entry.deadline
          ? t('home.enterUntil', { time: clockTime(entry.deadline, locale), left: countdown(entry.deadline, now, t) })
          : m.room === 'waiting'
            ? t('home.oneWaiting')
            : t('home.firstWaits');
    action = { label: m.room === 'playing' ? t('home.backToGame') : t('home.enterRoom'), run: () => act(onPlay) };
  } else {
    title = t('home.tournamentRunning', { name: entry.name });
    sub = m && !m.opponent ? t('home.bye') : t('home.roundDone');
    action = { label: t('home.openTournament'), run: onOpen };
  }
  return (
    <div className="home-banner tournament" role="status">
      <span className="play-ico">
        <Icon name="crown" size={16} />
      </span>
      <div className="home-banner-text">
        <strong>{title}</strong>
        <span>{error ?? sub}</span>
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={action.run}>
        {action.label}
      </button>
      {action.run !== onOpen && (
        <button type="button" className="btn" onClick={onOpen}>
          {t('home.openTournament')}
        </button>
      )}
    </div>
  );
}

function when(iso: string | null, locale: Locale) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmtWeekdayTime(d, locale);
}

function TournamentRow({ t: tour, onOpen }: { t: TournamentSummary; onOpen: () => void }) {
  const t = useT();
  const locale = useLocale();
  const side =
    tour.status === 'running'
      ? tour.totalRounds
        ? t('home.roundOf', { n: tour.round, total: tour.totalRounds })
        : t('home.round', { n: tour.round })
      : when(tour.startsAt, locale);
  const checkInOpen = tour.status === 'registration' && tour.checkInOpensAt && new Date(tour.checkInOpensAt).getTime() <= Date.now();
  const count = `${tour.players}${tour.maxPlayers ? `/${tour.maxPlayers}` : ''}`;
  return (
    <button type="button" className={['tour-item', tour.status].join(' ')} onClick={onOpen}>
      <span className="tour-item-top">
        <span>{checkInOpen ? t('home.checkInOpen') : t(TOURNAMENT_STATUS_LABEL[tour.status])}</span>
        {side && <span className="muted">{side}</span>}
      </span>
      <strong>{tour.name}</strong>
      <span className="sub">
        {t(STRUCTURE_LABEL[tour.structure])} · {formatLabel(tour.format)} ·{' '}
        {tour.status === 'registration' ? t('home.registered', { count }) : t('home.playersCount', { count })}
      </span>
    </button>
  );
}

export function TournamentsBlock({
  list,
  onOpen,
}: {
  list: { tournaments: TournamentSummary[]; canCreate: boolean } | null;
  onOpen: (id?: string) => void;
}) {
  const t = useT();
  const open = (list?.tournaments ?? [])
    .filter((t) => t.status !== 'finished')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : 1))
    .slice(0, 3);
  return (
    <section className="home-block" aria-labelledby="home-tournaments">
      <div className="block-head">
        <h2 id="home-tournaments">{t('home.tournaments')}</h2>
        <button type="button" className="text-link" onClick={() => onOpen()}>
          {t('home.seeAllTournaments')}
        </button>
      </div>
      {list === null ? (
        <p className="block-empty">{t('common.loading')}</p>
      ) : open.length ? (
        open.map((tour) => <TournamentRow key={tour.id} t={tour} onOpen={() => onOpen(tour.id)} />)
      ) : (
        <p className="block-empty">{list.canCreate ? t('home.noTournamentsCreate') : t('home.noTournaments')}</p>
      )}
    </section>
  );
}

export function MetaBlock({ onStats }: { onStats: () => void }) {
  const t = useT();
  const stats = usePoll(() => api.stats({ days: '7' }), 5 * 60_000);
  const total = stats?.leaders.reduce((n, l) => n + l.games, 0) ?? 0;
  const top = [...(stats?.leaders ?? [])].sort((a, b) => b.games - a.games).slice(0, 5);
  const max = top[0]?.games ?? 0;
  return (
    <section className="home-block" aria-labelledby="home-meta">
      <div className="block-head">
        <h2 id="home-meta">{t('home.meta')}</h2>
        <button type="button" className="text-link" onClick={onStats}>
          {t('home.stats')}
        </button>
      </div>
      <p className="block-sub">{t('home.metaSub')}</p>
      {stats === null ? (
        <p className="block-empty">{t('common.loading')}</p>
      ) : top.length ? (
        top.map((l, i) => {
          const info = stats.cards[l.leader];
          const color = info?.colors[0] === 'blue' ? 'blue-card' : (info?.colors[0] ?? 'red');
          return (
            <div key={l.leader} className="meta-row" style={{ ['--card-color' as string]: `var(--${color})` }}>
              <span className="meta-rank">{i + 1}</span>
              <div className="meta-name">
                <span>{info?.name ?? l.leader}</span>
                <div className="meta-bar">
                  <i style={{ width: `${Math.max(4, Math.round((l.games / max) * 100))}%` }} />
                </div>
              </div>
              <span className="meta-pct">{Math.round((l.games / total) * 100)}%</span>
            </div>
          );
        })
      ) : (
        <p className="block-empty">{t('home.noMeta')}</p>
      )}
    </section>
  );
}
