// Mesa online do Yonko no navegador: o canal SSE da mesa e as jogadas por POST. `useYonkoOnline` (quem senta à
// mesa: `/api/yonko/tables/:id/events`) entrega a mesma interface de `useYonkoGame` (a partida local), para a mesa
// (`YonkoTable`) servir às duas, e mais o resumo da sala (lugares, regras, relógio). `useYonkoWatch` (quem assiste:
// `/watch`) usa o mesmo canal, sem jogadas.

import type { Action, CardDef, GameState, LogEntry } from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type WatchTarget, type YonkoRoomInfo, type YonkoSeatRef } from '../api';

interface Snapshot {
  room: YonkoRoomInfo;
  view: Omit<GameState, 'defs' | 'log'> | null;
  defs: Record<string, CardDef>;
  log: { from: number; entries: LogEntry[] };
}

/** Situação do canal: aberto, caiu (o navegador tenta de novo) ou fechado de vez (mesa encerrada ou saiu dela). */
export type YonkoLink = 'connecting' | 'open' | 'lost' | 'closed';

/**
 * O canal de uma mesa: a sala e a mesa como o servidor as manda. `stillThere` responde, quando o servidor recusa
 * o canal, se vale tentar de novo (a mesa ainda existe e ainda é de quem pede).
 */
function useYonkoChannel(url: string, stillThere: () => Promise<boolean>) {
  const [room, setRoom] = useState<YonkoRoomInfo | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [link, setLink] = useState<YonkoLink>('connecting');
  /** Quando o último `state` chegou (para o relógio andar entre uma mensagem e outra). */
  const [clockAt, setClockAt] = useState(() => performance.now());
  const defs = useRef<Record<string, CardDef>>({});
  const log = useRef<LogEntry[]>([]);
  const seq = useRef(0);
  const check = useRef(stillThere);
  check.current = stillThere;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      es?.close();
      es = new EventSource(url);
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
      // Alguém começou ou parou de assistir: só o número muda.
      es.addEventListener('presence', (e) => {
        const { spectators } = JSON.parse((e as MessageEvent).data) as { spectators: number };
        setRoom((r) => (r ? { ...r, spectators } : r));
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
        // O servidor recusou o canal (mesa apagada, ou reiniciando): confere se a mesa ainda está lá.
        setLink('lost');
        retry = setTimeout(async () => {
          try {
            if (await check.current()) connect();
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
  }, [url]);

  return { room, state, link, clockAt, seq };
}

export function useYonkoOnline(ref: YonkoSeatRef) {
  const { seq, ...channel } = useYonkoChannel(api.yonko.eventsUrl(ref.id, ref.token), async () => (await api.yonko.active()).some((m) => m.id === ref.id));
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      setError(null);
      api.yonko.action(ref.id, ref.token, seq.current, action).catch(fail);
    },
    [ref.id, ref.token, fail, seq],
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

  return { ...channel, error, setError, dispatch, request };
}

export type YonkoOnline = ReturnType<typeof useYonkoOnline>;

/**
 * Quem assiste a uma mesa: o mesmo canal, sem lugar e sem jogadas. O que chega (a visão pública, a de um jogador
 * ou as mãos de todos, e com quanto atraso) é o servidor que decide, pelo pedido (`hands`, ou a chave da
 * transmissão): ver `room.watch`.
 */
export function useYonkoWatch(target: Pick<WatchTarget, 'roomId' | 'hands' | 'key'>) {
  // As mãos de todos são um pedido que a mesa pode deixar de aceitar (quem criou as fechou entre uma partida e
  // outra, ou quem assiste sentou nela): recusado o canal, a tela volta a pedir só a visão pública.
  const [hands, setHands] = useState(target.hands);
  const { seq: _, ...channel } = useYonkoChannel(api.yonko.watchUrl(target.roomId, hands, target.key), async () => {
    try {
      const table = await api.yonko.table(target.roomId);
      if (hands && (!table.handsAllowed || table.mine)) setHands(false);
      return true;
    } catch (e) {
      // 404: a mesa foi fechada. Qualquer outra falha (servidor reiniciando): tenta de novo.
      if (e instanceof ApiError && e.status === 404) return false;
      throw e;
    }
  });
  return channel;
}
