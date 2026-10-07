// Blocos de baixo da Home: partidas ao vivo, torneios e Líderes mais jogados da semana.

import { formatLabel } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  type LiveRoom,
  type RoomQueue,
  STRUCTURE_LABEL,
  TOURNAMENT_STATUS_LABEL,
  type TournamentSummary,
  type WatchTarget,
} from '../api';
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

export const QUEUE_LABEL: Record<RoomQueue, string> = {
  private: 'Sala privada',
  casual: 'Casual',
  ranked: 'Ranqueada',
  bot: 'Treino',
  tournament: 'Torneio',
};

function LiveRow({ room, onWatch }: { room: LiveRoom; onWatch: (t: WatchTarget) => void }) {
  const [a, b] = room.players;
  const name = (p: LiveRoom['players'][number]) => p.leaderName ?? p.name;
  const where = room.tournament ? `${room.tournament.name} · ${room.tournament.label}` : QUEUE_LABEL[room.queue];
  return (
    <div className="live-row">
      <div className="live-leaders">
        {room.players.map((p, i) => (
          <LeaderArt key={i} name={name(p)} image={p.leaderImage} colors={p.colors} size="tiny" />
        ))}
      </div>
      <div className="live-info">
        <strong>
          {name(a)} vs {name(b)}
        </strong>
        <span>
          {where} · Turno {room.turn}
        </span>
      </div>
      {room.spectators > 0 && (
        <span className="eyes" title={`${room.spectators} assistindo`}>
          <Icon name="eye" size={14} />
          {room.spectators}
        </span>
      )}
      <button type="button" className="small-btn" onClick={() => onWatch({ roomId: room.id, hands: false })}>
        Assistir
      </button>
    </div>
  );
}

export function LiveNow({ onWatch, onAll }: { onWatch: (t: WatchTarget) => void; onAll: () => void }) {
  const live = usePoll(() => api.online.live(), 15_000);
  const rooms = (live?.rooms ?? []).filter((r) => !r.mine && r.players.length === 2).slice(0, 3);
  return (
    <section className="home-block" aria-labelledby="home-live">
      <div className="block-head">
        <h2 id="home-live">
          <span className="rec-dot" />
          Ao vivo agora
        </h2>
        <button type="button" className="text-link" onClick={onAll}>
          Ver todas
        </button>
      </div>
      {live === null ? (
        <p className="block-empty">Carregando…</p>
      ) : rooms.length ? (
        rooms.map((r) => <LiveRow key={r.id} room={r} onWatch={onWatch} />)
      ) : (
        <p className="block-empty">Nenhuma partida pública agora. Que tal começar uma?</p>
      )}
    </section>
  );
}

function when(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function TournamentRow({ t, onOpen }: { t: TournamentSummary; onOpen: () => void }) {
  const side =
    t.status === 'running' ? `Rodada ${t.round}${t.totalRounds ? ` de ${t.totalRounds}` : ''}` : when(t.startsAt);
  return (
    <button type="button" className={['tour-item', t.status].join(' ')} onClick={onOpen}>
      <span className="tour-item-top">
        <span>{TOURNAMENT_STATUS_LABEL[t.status]}</span>
        {side && <span className="muted">{side}</span>}
      </span>
      <strong>{t.name}</strong>
      <span className="sub">
        {STRUCTURE_LABEL[t.structure]} · {formatLabel(t.format)} · {t.players}
        {t.maxPlayers ? `/${t.maxPlayers}` : ''} {t.status === 'registration' ? 'inscritos' : 'jogadores'}
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
  const open = (list?.tournaments ?? [])
    .filter((t) => t.status !== 'finished')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : 1))
    .slice(0, 3);
  return (
    <section className="home-block" aria-labelledby="home-tournaments">
      <div className="block-head">
        <h2 id="home-tournaments">Torneios</h2>
        <button type="button" className="text-link" onClick={() => onOpen()}>
          Ver todos
        </button>
      </div>
      {list === null ? (
        <p className="block-empty">Carregando…</p>
      ) : open.length ? (
        open.map((t) => <TournamentRow key={t.id} t={t} onOpen={() => onOpen(t.id)} />)
      ) : (
        <p className="block-empty">Nenhum torneio aberto agora.{list.canCreate ? ' Que tal organizar um?' : ''}</p>
      )}
    </section>
  );
}

export function MetaBlock({ onStats }: { onStats: () => void }) {
  const stats = usePoll(() => api.stats({ days: '7' }), 5 * 60_000);
  const total = stats?.leaders.reduce((n, l) => n + l.games, 0) ?? 0;
  const top = [...(stats?.leaders ?? [])].sort((a, b) => b.games - a.games).slice(0, 5);
  const max = top[0]?.games ?? 0;
  return (
    <section className="home-block" aria-labelledby="home-meta">
      <div className="block-head">
        <h2 id="home-meta">Meta da semana</h2>
        <button type="button" className="text-link" onClick={onStats}>
          Estatísticas
        </button>
      </div>
      <p className="block-sub">Líderes mais jogados nos últimos 7 dias</p>
      {stats === null ? (
        <p className="block-empty">Carregando…</p>
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
        <p className="block-empty">Ainda não há partidas nos últimos 7 dias.</p>
      )}
    </section>
  );
}
