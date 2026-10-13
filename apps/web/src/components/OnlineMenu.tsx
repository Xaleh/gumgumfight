import { useEffect, useMemo, useState } from 'react';
import { api, type FormatId, type OnlineSeat, type QueueKind, type QueueLeader } from '../api';
import { useT } from '../i18n';
import { LeaderArt } from './LeaderArt';

/** Código de sala vindo do link (?sala=ABC123); lido uma vez e tirado da barra de endereço. */
export function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(location.search).get('sala');
  if (!code) return null;
  const url = new URL(location.href);
  url.searchParams.delete('sala');
  history.replaceState(null, '', url.toString());
  return /^[A-Za-z0-9]{6}$/.test(code) ? code.toUpperCase() : null;
}

/** Por quanto tempo a fila casual procura só o Líder escolhido (igual ao servidor). */
export const LEADER_PICK_MS = 60_000;

const fmtWait = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface QueueState {
  ticket: string;
  kind: QueueKind;
  waited: number;
  players: number;
  /** Casual: Líder do oponente escolhido (só ele no primeiro minuto). */
  leader: QueueLeader | null;
  /** Quanto falta para a escolha do Líder expirar (0 = qualquer oponente). */
  leaderWait: number;
}

/**
 * Fila casual/ranqueada: entra, consulta o servidor até formar a partida e chama
 * `onEnter` com o assento. Erros da consulta tiram da fila e vão para `onError`.
 */
export function useQueue(onEnter: (seat: OnlineSeat) => void, onError: (e: unknown) => void) {
  const [queue, setQueue] = useState<QueueState | null>(null);

  const ticket = queue?.ticket;
  useEffect(() => {
    if (!ticket) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.online.poll(ticket);
        if (stop) return;
        if (r.status === 'matched') {
          setQueue(null);
          onEnter({ roomId: r.roomId, token: r.token });
          return;
        }
        setQueue((q) => (q && q.ticket === ticket ? { ...q, waited: r.waited, players: r.players, leaderWait: r.leaderWait ?? 0 } : q));
      } catch (e) {
        if (!stop) {
          setQueue(null);
          onError(e);
        }
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [ticket, onEnter, onError]);

  return {
    queue,
    enqueue: async (deckId: string, format: FormatId, kind: QueueKind, leader: QueueLeader | null = null) => {
      const pick = kind === 'casual' ? leader : null;
      const r = await api.online.enqueue(deckId, format, kind, pick?.id);
      setQueue({ ticket: r.ticket, kind, waited: 0, players: 1, leader: pick, leaderWait: pick ? LEADER_PICK_MS : 0 });
    },
    cancel: () => {
      if (queue) void api.online.cancel(queue.ticket).catch(() => undefined);
      setQueue(null);
    },
  };
}

/** Janela "Procurando oponente…" enquanto espera na fila. */
export function QueueWait({ queue, onCancel }: { queue: QueueState; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="modal-backdrop page-sheet">
      <div className="modal-card queue-wait" role="dialog" aria-modal="true" aria-labelledby="queue-wait-title">
        <div className="modal-kicker">{queue.kind === 'ranked' ? t('menu.onlineRanked') : t('menu.onlineCasual')}</div>
        <h2 id="queue-wait-title">
          {t('menu.onlineSearching')}<span className="dots" />
        </h2>
        <p className="queue-time">{fmtWait(queue.waited)}</p>
        {queue.leader && (
          <div className="queue-leader">
            <LeaderArt name={queue.leader.name} image={queue.leader.imageUrl} colors={queue.leader.colors} size="small" />
            <p className="small">
              {queue.leaderWait > 0
                ? t('menu.queueLeaderSearching', { name: queue.leader.name, time: fmtWait(queue.leaderWait + 999) })
                : t('menu.queueLeaderExpired', { name: queue.leader.name })}
            </p>
          </div>
        )}
        <p className="muted small">{queue.players > 1 ? t('menu.onlineQueuePlayers', { n: queue.players }) : t('menu.onlineQueueAlone')}</p>
        <div className="btn-row center">
          <button className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Folha "Contra qual Líder?" da fila casual: os Líderes permitidos no formato, com
 * quem está na fila agora primeiro. `null` = qualquer Líder.
 */
export function LeaderPicker({
  format,
  value,
  onPick,
  onClose,
}: {
  format: FormatId;
  value: string | null;
  onPick: (leader: QueueLeader | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [leaders, setLeaders] = useState<QueueLeader[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    let stop = false;
    api.online
      .leaders(format)
      .then((list) => !stop && setLeaders(list))
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, [format]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leaders ?? [])
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q))
      .sort((a, b) => b.queue - a.queue || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [leaders, search]);
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('menu.pickLeaderTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('menu.pickLeaderTitle')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="muted small leader-pick-hint">{t('menu.pickLeaderHint')}</p>
          <input
            className="leader-search"
            type="search"
            value={search}
            placeholder={t('menu.searchLeader')}
            aria-label={t('menu.searchLeader')}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="picker-grid">
            <button className={['deck-pick', value === null ? 'on' : ''].join(' ')} onClick={() => onPick(null)}>
              <LeaderArt size="small" />
              <span className="name">{t('menu.anyLeader')}</span>
            </button>
            {shown.map((l) => (
              <button key={l.id} className={['deck-pick', l.id === value ? 'on' : ''].join(' ')} onClick={() => onPick(l)} title={`${l.name} (${l.id})`}>
                <LeaderArt name={l.name} image={l.imageUrl} colors={l.colors} size="small" />
                <span className="name">{l.name}</span>
                <span className="muted small">{l.id}</span>
                {l.queue > 0 && <span className="leader-queue">{t('menu.leaderInQueue', { n: l.queue })}</span>}
              </button>
            ))}
          </div>
          {!leaders && !failed && <p className="muted small">{t('common.loading')}</p>}
          {failed && <p className="error">{t('menu.leadersFailed')}</p>}
          {leaders && !shown.length && <p className="muted small">{t('menu.noLeaderFound')}</p>}
        </div>
      </div>
    </div>
  );
}
