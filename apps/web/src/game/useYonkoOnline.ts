// Mesa online do Yonko no navegador: o canal SSE da mesa (`/api/yonko/tables/:id/events`) e as jogadas por
// POST. Entrega a mesma interface de `useYonkoGame` (a partida local), para a mesa (`YonkoTable`) servir às
// duas, e mais o resumo da sala (lugares, regras, relógio).

import type { Action, CardDef, GameState, LogEntry } from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type YonkoRoomInfo, type YonkoSeatRef } from '../api';

interface Snapshot {
  room: YonkoRoomInfo;
  view: Omit<GameState, 'defs' | 'log'> | null;
  defs: Record<string, CardDef>;
  log: { from: number; entries: LogEntry[] };
}

/** Situação do canal: aberto, caiu (o navegador tenta de novo) ou fechado de vez (mesa encerrada ou saiu dela). */
export type YonkoLink = 'connecting' | 'open' | 'lost' | 'closed';

export function useYonkoOnline(ref: YonkoSeatRef) {
  const [room, setRoom] = useState<YonkoRoomInfo | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [link, setLink] = useState<YonkoLink>('connecting');
  const [error, setError] = useState<string | null>(null);
  /** Quando o último `state` chegou (para o relógio andar entre uma mensagem e outra). */
  const [clockAt, setClockAt] = useState(() => performance.now());
  const defs = useRef<Record<string, CardDef>>({});
  const log = useRef<LogEntry[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      es?.close();
      es = new EventSource(api.yonko.eventsUrl(ref.id, ref.token));
      es.onopen = () => setLink('open');
      es.addEventListener('state', (e) => {
        const s = JSON.parse((e as MessageEvent).data) as Snapshot;
        // Conexão nova, ou partida nova na mesma mesa: o servidor manda tudo de novo (registro a partir do 0).
        if (s.log.from === 0) defs.current = {};
        defs.current = { ...defs.current, ...s.defs };
        log.current = [...log.current.slice(0, s.log.from), ...s.log.entries];
        setRoom(s.room);
        setClockAt(performance.now());
        if (s.view) {
          seq.current = s.view.actionCount;
          setState({ ...(s.view as GameState), defs: defs.current, log: log.current });
        } else {
          log.current = [];
          setState(null);
        }
      });
      es.addEventListener('closed', () => {
        stopped = true;
        es?.close();
        setLink('closed');
      });
      es.onerror = () => {
        if (es && es.readyState !== EventSource.CLOSED) {
          setLink('lost');
          return;
        }
        // O servidor recusou o canal (mesa apagada, ou reiniciando): confere se a mesa ainda é nossa.
        setLink('lost');
        retry = setTimeout(async () => {
          try {
            const mine = await api.yonko.active();
            if (mine.some((m) => m.id === ref.id)) connect();
            else {
              stopped = true;
              setLink('closed');
            }
          } catch {
            connect();
          }
        }, 2000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [ref.id, ref.token]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      setError(null);
      api.yonko.action(ref.id, ref.token, seq.current, action).catch(fail);
    },
    [ref.id, ref.token, fail],
  );

  /** Pedidos da sala de espera (deck, pronto, regras, bots, começar…): o resultado chega pelo canal. */
  const request = useCallback(
    (p: Promise<unknown>) => {
      setError(null);
      return p.then(
        () => true,
        (e) => {
          fail(e);
          return false;
        },
      );
    },
    [fail],
  );

  return { room, state, link, error, setError, dispatch, request, clockAt };
}

export type YonkoOnline = ReturnType<typeof useYonkoOnline>;
