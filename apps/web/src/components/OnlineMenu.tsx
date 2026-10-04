import { useEffect, useState } from 'react';
import { type ActiveRoom, api, ApiError, type DeckSummary, type FormatId, type OnlineSeat, type QueueKind } from '../api';
import { useAuth } from '../auth';

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

/** Menu do modo online: filas, sala privada e a partida em andamento. */
export function OnlineMenu({
  deck,
  format,
  formatProblem,
  initialCode,
  onEnter,
}: {
  deck?: DeckSummary;
  format: FormatId;
  /** O deck não vale no formato escolhido: filas e criar sala ficam travados (entrar usa o formato da sala). */
  formatProblem?: string | null;
  initialCode: string | null;
  onEnter: (seat: OnlineSeat) => void;
}) {
  const { user } = useAuth();
  const [active, setActive] = useState<ActiveRoom[]>([]);
  const [code, setCode] = useState(initialCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<null | { ticket: string; kind: QueueKind; waited: number; players: number }>(null);

  useEffect(() => {
    api.online
      .active()
      .then(setActive)
      .catch(() => undefined);
  }, [user?.id]);

  // Na fila: consulta o servidor até formar a partida.
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
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [ticket, onEnter]);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    // Já está numa partida: mostra o atalho para voltar.
    if (e instanceof ApiError && e.data.roomId) void api.online.active().then(setActive).catch(() => undefined);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const playing = active.find((r) => r.status === 'playing');
  const waiting = active.find((r) => r.status === 'waiting');
  const manualCards = deck?.unscripted ?? 0;
  const canRanked = Boolean(user) && manualCards === 0;

  return (
    <div className="online-menu">
      {error && <div className="error">{error}</div>}

      {playing && (
        <div className="online-active">
          <span>Você tem uma partida online em andamento.</span>
          <button className="btn primary" onClick={() => onEnter(playing)}>
            Voltar à partida
          </button>
        </div>
      )}
      {!playing && waiting && (
        <div className="online-active">
          <span>
            Sua sala <b>{waiting.code}</b> está esperando um oponente.
          </span>
          <button className="btn" onClick={() => onEnter(waiting)}>
            Abrir sala
          </button>
        </div>
      )}

      <div className="field">
        <label>Partida rápida</label>
        <div className="btn-row">
          <button
            className="btn primary"
            disabled={!deck || busy || Boolean(formatProblem) || Boolean(playing)}
            onClick={() =>
              run(async () => {
                const r = await api.online.enqueue(deck!.id, format, 'casual');
                setQueue({ ticket: r.ticket, kind: 'casual', waited: 0, players: 1 });
              })
            }
          >
            Casual
          </button>
          <button
            className="btn primary"
            disabled={!deck || busy || !canRanked || Boolean(formatProblem) || Boolean(playing)}
            onClick={() =>
              run(async () => {
                const r = await api.online.enqueue(deck!.id, format, 'ranked');
                setQueue({ ticket: r.ticket, kind: 'ranked', waited: 0, players: 1 });
              })
            }
          >
            🏆 Ranqueada
          </button>
        </div>
        {formatProblem ? (
          <p className="muted small">{formatProblem}</p>
        ) : !user ? (
          <p className="muted small">A ranqueada é só para quem entrou com a conta Google.</p>
        ) : manualCards > 0 ? (
          <p className="muted small">
            Este deck tem {manualCards} carta(s) com efeito manual (⚙): na ranqueada o modo manual não é permitido.
          </p>
        ) : (
          <p className="muted small">Cada jogador tem 17:30 no total; o tempo só corre quando a ação ou a decisão é sua.</p>
        )}
      </div>

      <div className="field">
        <label>Sala privada</label>
        <div className="btn-row">
          <button
            className="btn"
            disabled={!deck || busy || Boolean(formatProblem) || Boolean(playing)}
            onClick={() =>
              run(async () => {
                const r = await api.online.createRoom(deck!.id, format);
                onEnter({ roomId: r.roomId, token: r.token });
              })
            }
          >
            Criar sala
          </button>
        </div>
        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={6}
            placeholder="Código"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button
            className="btn"
            disabled={!deck || busy || code.length !== 6 || Boolean(playing)}
            onClick={() =>
              run(async () => {
                const r = await api.online.joinRoom(code, deck!.id);
                onEnter(r);
              })
            }
          >
            Entrar
          </button>
        </div>
      </div>

      {queue && (
        <div className="modal-backdrop">
          <div className="modal-card queue-wait">
            <div className="modal-kicker">{queue.kind === 'ranked' ? 'Ranqueada' : 'Casual'}</div>
            <h2>
              Procurando oponente<span className="dots" />
            </h2>
            <p className="queue-time">{fmtWait(queue.waited)}</p>
            <p className="muted small">{queue.players > 1 ? `${queue.players} jogadores na fila` : 'Você é o único na fila agora.'}</p>
            <div className="btn-row center">
              <button
                className="btn"
                onClick={() => {
                  void api.online.cancel(queue.ticket).catch(() => undefined);
                  setQueue(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
