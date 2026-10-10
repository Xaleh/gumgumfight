import { useEffect, useState } from 'react';
import { api, type FormatId, type OnlineSeat, type QueueKind } from '../api';
import { useT } from '../i18n';

/** Código de sala vindo do link (?sala=ABC123); lido uma vez e tirado da barra de endereço. */
export function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(location.search).get('sala');
  if (!code) return null;
  const url = new URL(location.href);
  url.searchParams.delete('sala');
  history.replaceState(null, '', url.toString());
  return /^[A-Za-z0-9]{6}$/.test(code) ? code.toUpperCase() : null;
}

const fmtWait = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface QueueState {
  ticket: string;
  kind: QueueKind;
  waited: number;
  players: number;
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
        setQueue((q) => (q && q.ticket === ticket ? { ...q, waited: r.waited, players: r.players } : q));
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
    enqueue: async (deckId: string, format: FormatId, kind: QueueKind) => {
      const r = await api.online.enqueue(deckId, format, kind);
      setQueue({ ticket: r.ticket, kind, waited: 0, players: 1 });
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
