import type { Action, CardDef, GameState, LogEntry, PlayerId } from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OnlineRoomInfo, type OnlineSeat } from '../api';

/** O que o servidor manda no evento "state" (online/room.ts: snapshot). */
interface Snapshot {
  room: OnlineRoomInfo;
  view: Omit<GameState, 'defs' | 'log'> | null;
  defs: Record<string, CardDef>;
  log: { from: number; entries: LogEntry[] };
  lastAction: Action | null;
  peek?: number;
}

export type Connection = 'connecting' | 'open' | 'lost' | 'gone';

export interface Emote {
  seat: PlayerId;
  emote: string;
  key: number;
}

/**
 * Partida online: o estado vem do servidor (só a visão deste jogador) pelo canal
 * SSE; as ações vão por POST, uma de cada vez, na ordem em que foram feitas.
 */
export function useOnlineGame(seat: OnlineSeat) {
  const [state, setState] = useState<GameState | null>(null);
  const [room, setRoom] = useState<OnlineRoomInfo | null>(null);
  /** performance.now() de quando o relógio da sala chegou. */
  const [clockAt, setClockAt] = useState(0);
  const [conn, setConn] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const [rematch, setRematch] = useState<OnlineSeat | null>(null);
  const [peek, setPeek] = useState(0);
  /** Ações vistas desde que a conexão abriu (para o resumo do fim de jogo). */
  const [actions, setActions] = useState<Action[]>([]);
  const defs = useRef<Record<string, CardDef>>({});
  const log = useRef<LogEntry[]>([]);
  const seq = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let lastMessage = Date.now();
    const seen = () => {
      lastMessage = Date.now();
    };
    const connect = () => {
      if (stopped) return;
      es?.close();
      seen();
      es = new EventSource(api.online.eventsUrl(seat.roomId, seat.token));
      es.onopen = () => {
        seen();
        setConn('open');
      };
      es.addEventListener('ping', seen);
      es.addEventListener('state', (e) => {
        seen();
        const s = JSON.parse((e as MessageEvent).data) as Snapshot;
        // Conexão nova: o servidor manda tudo de novo (log a partir do 0).
        defs.current = { ...defs.current, ...s.defs };
        log.current = [...log.current.slice(0, s.log.from), ...s.log.entries];
        setRoom(s.room);
        setClockAt(performance.now());
        setPeek(s.peek ?? 0);
        if (s.view) {
          if (s.lastAction && s.view.actionCount > seq.current) setActions((a) => [...a, s.lastAction!]);
          seq.current = s.view.actionCount;
          finished.current = s.view.phase === 'gameover';
          setState({ ...(s.view as GameState), defs: defs.current, log: log.current });
        }
      });
      es.addEventListener('presence', (e) => {
        const { connected } = JSON.parse((e as MessageEvent).data) as { connected: boolean[] };
        setRoom((r) => (r ? { ...r, players: r.players.map((p, i) => ({ ...p, connected: connected[i] ?? false })) } : r));
      });
      es.addEventListener('emote', (e) => {
        const m = JSON.parse((e as MessageEvent).data) as { seat: PlayerId; emote: string };
        const key = Date.now() + Math.random();
        setEmotes((list) => [...list.slice(-3), { ...m, key }]);
        setTimeout(() => setEmotes((list) => list.filter((x) => x.key !== key)), 3500);
      });
      es.addEventListener('rematch', (e) => setRematch(JSON.parse((e as MessageEvent).data) as OnlineSeat));
      es.addEventListener('closed', () => {
        stopped = true;
        es?.close();
        setConn('gone');
      });
      es.onerror = () => {
        if (!es || es.readyState !== EventSource.CLOSED) {
          // O navegador tenta de novo sozinho.
          setConn('lost');
          return;
        }
        // Resposta com erro (servidor reiniciando ou sala apagada): confere se a sala ainda existe.
        setConn(finished.current ? 'gone' : 'lost');
        if (finished.current) return;
        retry = setTimeout(async () => {
          try {
            const active = await api.online.active();
            if (active.some((r) => r.roomId === seat.roomId)) connect();
            else setConn('gone');
          } catch {
            connect();
          }
        }, 3000);
      };
    };
    connect();
    // O servidor manda um "ping" a cada 20 s: canal mudo há muito tempo está morto (proxy segurou a conexão).
    const watchdog = setInterval(() => {
      if (stopped || finished.current || Date.now() - lastMessage < 50_000) return;
      setConn('lost');
      connect();
    }, 10_000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      es?.close();
    };
  }, [seat.roomId, seat.token]);

  // Ações em fila: cada POST leva a versão da mesa em que a ação foi feita.
  const queue = useRef<Action[]>([]);
  const busy = useRef(false);
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const action = queue.current.shift()!;
      try {
        const r = await api.online.act(seat.roomId, seat.token, seq.current, action);
        seq.current = Math.max(seq.current, r.actionCount);
        setError(null);
      } catch (e) {
        queue.current = [];
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    busy.current = false;
  }, [seat.roomId, seat.token]);

  const dispatch = useCallback(
    (action: Action) => {
      queue.current.push(action);
      void pump();
    },
    [pump],
  );

  const sendEmote = useCallback(
    (emote: string) => api.online.emote(seat.roomId, seat.token, emote).catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [seat.roomId, seat.token],
  );
  const askRematch = useCallback(
    () => api.online.rematch(seat.roomId, seat.token).catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [seat.roomId, seat.token],
  );
  const leave = useCallback(() => api.online.leave(seat.roomId, seat.token).catch(() => undefined), [seat.roomId, seat.token]);
  const downloadReplay = useCallback(async () => {
    try {
      const replay = await api.online.replay(seat.roomId, seat.token);
      const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gumgumfight-online-${seat.roomId}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [seat.roomId, seat.token]);

  return {
    state,
    room,
    clockAt,
    conn,
    error,
    setError,
    dispatch,
    emotes,
    sendEmote,
    rematch,
    askRematch,
    leave,
    downloadReplay,
    peek,
    actions,
  };
}

export type OnlineGame = ReturnType<typeof useOnlineGame>;

/** Tempo restante de cada jogador agora (o relógio do jogador da vez continua correndo no navegador). */
export function remainingNow(room: OnlineRoomInfo, clockAt: number, now = performance.now()): [number, number] {
  const r = [...room.clock.remaining] as [number, number];
  if (room.clock.running !== null && room.status === 'playing') {
    r[room.clock.running] = Math.max(0, r[room.clock.running] - (now - clockAt));
  }
  return r;
}

export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
