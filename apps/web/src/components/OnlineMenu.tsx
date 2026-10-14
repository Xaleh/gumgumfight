import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, type FormatId, type OnlineSeat, type QueueKind, type QueueLeader } from '../api';
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
  /** Deck e formato da fila (para voltar a ela sozinho, ver `useQueue`). */
  deckId: string;
  format: FormatId;
  waited: number;
  /** Espera de antes de voltar à fila (o servidor conta do zero a cada bilhete). */
  carried: number;
  players: number;
  /** Casual: Líder do oponente escolhido (só ele no primeiro minuto). */
  leader: QueueLeader | null;
  /** Quanto falta para a escolha do Líder expirar (0 = qualquer oponente). */
  leaderWait: number;
}

/** Intervalo entre as consultas à fila. */
const POLL_MS = 1500;

/** Falha que passa sozinha (sem rede, servidor reiniciando no deploy, limite de requisições): tenta de novo. */
const transient = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429;

/**
 * Fila casual/ranqueada: entra, consulta o servidor até formar a partida e chama
 * `onEnter` com o assento. A busca só termina com a partida, com "Cancelar" ou com uma
 * recusa do servidor (vai para `onError`): falhas de rede não a interrompem, e quem saiu
 * da fila porque a página ficou parada (celular em segundo plano) volta para ela sozinho.
 */
export function useQueue(onEnter: (seat: OnlineSeat) => void, onError: (e: unknown) => void) {
  const [queue, setQueue] = useState<QueueState | null>(null);
  // Quem chama recria os callbacks a cada render; isso não pode reiniciar a consulta.
  const enter = useRef(onEnter);
  enter.current = onEnter;
  const failed = useRef(onError);
  failed.current = onError;
  const current = useRef(queue);
  current.current = queue;

  const ticket = queue?.ticket;
  useEffect(() => {
    if (!ticket) return;
    let stop = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { seat: OnlineSeat } | { error: unknown }) => {
      stop = true;
      setQueue(null);
      if ('seat' in result) enter.current(result.seat);
      else failed.current(result.error);
    };
    /** O servidor tirou o bilhete da fila: entra na partida formada nesse meio-tempo ou volta para a fila. */
    const rejoin = async () => {
      const q = current.current;
      if (!q) return;
      const playing = (await api.online.active()).find((r) => r.status === 'playing' && r.queue === q.kind);
      if (stop) return;
      if (playing) return finish({ seat: { roomId: playing.roomId, token: playing.token } });
      // A escolha de Líder que já expirou não volta a valer.
      const pick = q.leaderWait > 0 ? q.leader : null;
      const r = await api.online.enqueue(q.deckId, q.format, q.kind, pick?.id);
      if (stop) return void api.online.cancel(r.ticket).catch(() => undefined);
      setQueue((s) => (s && s.ticket === ticket ? { ...s, ticket: r.ticket, carried: s.waited } : s));
    };
    const tick = async () => {
      if (stop || busy) return;
      busy = true;
      clearTimeout(timer);
      try {
        const r = await api.online.poll(ticket);
        if (stop) return;
        if (r.status === 'matched') return finish({ seat: { roomId: r.roomId, token: r.token } });
        setQueue((q) =>
          q && q.ticket === ticket ? { ...q, waited: q.carried + r.waited, players: r.players, leaderWait: r.leaderWait ?? 0 } : q,
        );
      } catch (e) {
        if (stop) return;
        try {
          if (e instanceof ApiError && e.status === 404) await rejoin();
          else if (!transient(e)) finish({ error: e });
        } catch (again) {
          if (!stop && !transient(again)) finish({ error: again });
        }
      } finally {
        busy = false;
        if (!stop) timer = setTimeout(tick, POLL_MS);
      }
    };
    // De volta ao app: consulta na hora, sem esperar o próximo ciclo.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    // Fechou a página: sai da fila para ninguém ser pareado com quem já foi embora.
    const onHide = () => api.online.leaveQueue(ticket);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
    };
  }, [ticket]);

  return {
    queue,
    enqueue: async (deckId: string, format: FormatId, kind: QueueKind, leader: QueueLeader | null = null) => {
      const pick = kind === 'casual' ? leader : null;
      const r = await api.online.enqueue(deckId, format, kind, pick?.id);
      setQueue({ ticket: r.ticket, kind, deckId, format, waited: 0, carried: 0, players: 1, leader: pick, leaderWait: pick ? LEADER_PICK_MS : 0 });
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
