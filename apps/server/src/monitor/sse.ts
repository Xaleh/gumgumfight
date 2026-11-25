// Métricas dos canais SSE (partidas online, espectadores e mesas do Yonko): quantos estão abertos agora, quantos
// abriram, quantos caíram (o navegador ou a rede fechou), quantos o servidor encerrou, quantas reconexões e quanto
// tempo cada canal ficou aberto. Os números desde que o processo subiu ficam em memória; as contagens por hora vão
// para `monitor_sse_hours` a cada minuto (e ao fechar o app), somando, para sobreviver aos deploys.
//
// Reconexão: o mesmo lugar (sala + token, ou sala + IP no espectador) abre um canal de novo em até 2 min depois de
// o anterior fechar. As chaves ficam só em memória e saem depois desse prazo.

import type { DB } from '../db';
import { addSseHour, pruneSseHours, type SseChannel, type SseHour, sseHours } from './store';

export const RECONNECT_WINDOW_MS = 2 * 60_000;
const CHANNELS: SseChannel[] = ['online', 'yonko'];

export interface SseHandle {
  /** O servidor encerrou o canal (fim da sala, reinício): não conta como queda. */
  serverEnd(): void;
  /** O canal fechou (chamar uma vez; as chamadas seguintes não contam). */
  close(): void;
}

interface Totals {
  opened: number;
  clientClosed: number;
  serverClosed: number;
  reconnects: number;
  seconds: number;
}

const zero = (): Totals => ({ opened: 0, clientClosed: 0, serverClosed: 0, reconnects: 0, seconds: 0 });

export interface SseSnapshot {
  open: Record<SseChannel, number> & { total: number };
  /** Desde que o processo subiu. */
  sinceStart: Record<SseChannel, Totals & { avgSeconds: number }>;
  /** Horas mais antigas primeiro (UTC), os dois canais somados. */
  hours: Array<Omit<SseHour, 'channel'>>;
}

export class SseMetrics {
  private readonly now: () => number;
  private readonly reconnectMs: number;
  private readonly open: Record<SseChannel, number> = { online: 0, yonko: 0 };
  private readonly totals: Record<SseChannel, Totals> = { online: zero(), yonko: zero() };
  /** Chave do lugar → quando o último canal dele fechou. */
  private readonly recent = new Map<string, number>();
  /** Contagens ainda não gravadas, por hora e canal. */
  private pending = new Map<string, SseHour>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: { db?: DB; now?: () => number; reconnectMs?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.reconnectMs = opts.reconnectMs ?? RECONNECT_WINDOW_MS;
  }

  private bucket(channel: SseChannel): SseHour {
    const hour = new Date(this.now()).toISOString().slice(0, 13);
    const k = `${hour}|${channel}`;
    let b = this.pending.get(k);
    if (!b) {
      b = { hour, channel, opened: 0, clientClosed: 0, serverClosed: 0, reconnects: 0, peak: this.open[channel], seconds: 0 };
      this.pending.set(k, b);
    }
    return b;
  }

  /** Um canal abriu. `key` identifica o lugar (para contar reconexões). */
  track(channel: SseChannel, key: string): SseHandle {
    const start = this.now();
    this.pruneRecent(start);
    const b = this.bucket(channel);
    const last = this.recent.get(key);
    if (last !== undefined && start - last <= this.reconnectMs) {
      this.totals[channel].reconnects++;
      b.reconnects++;
    }
    this.recent.delete(key);
    this.open[channel]++;
    this.totals[channel].opened++;
    b.opened++;
    b.peak = Math.max(b.peak, this.open[channel]);

    let byServer = false;
    let closed = false;
    return {
      serverEnd: () => {
        byServer = true;
      },
      close: () => {
        if (closed) return;
        closed = true;
        const end = this.now();
        const seconds = Math.max(0, Math.round((end - start) / 1000));
        const t = this.totals[channel];
        const h = this.bucket(channel);
        this.open[channel] = Math.max(0, this.open[channel] - 1);
        t.seconds += seconds;
        h.seconds += seconds;
        if (byServer) {
          t.serverClosed++;
          h.serverClosed++;
        } else {
          t.clientClosed++;
          h.clientClosed++;
        }
        this.recent.set(key, end);
      },
    };
  }

  private pruneRecent(now: number) {
    if (this.recent.size < 2000) return;
    for (const [k, at] of this.recent) if (now - at > this.reconnectMs) this.recent.delete(k);
  }

  /** Grava as contagens pendentes (somando às do banco). */
  flush() {
    const { db } = this.opts;
    if (!db || !this.pending.size) return;
    const rows = [...this.pending.values()];
    this.pending = new Map();
    for (const r of rows) addSseHour(db, r);
    pruneSseHours(db, this.now());
  }

  /** Grava a cada `ms` (padrão 1 min). */
  start(ms = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), ms);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  snapshot(hours = 48): SseSnapshot {
    this.flush();
    const since = new Date(this.now() - (hours - 1) * 3_600_000).toISOString().slice(0, 13);
    const rows = this.opts.db ? sseHours(this.opts.db, since) : [...this.pending.values()].filter((h) => h.hour >= since);
    const byHour = new Map<string, Omit<SseHour, 'channel'>>();
    for (const r of rows) {
      const h = byHour.get(r.hour) ?? { hour: r.hour, opened: 0, clientClosed: 0, serverClosed: 0, reconnects: 0, peak: 0, seconds: 0 };
      h.opened += r.opened;
      h.clientClosed += r.clientClosed;
      h.serverClosed += r.serverClosed;
      h.reconnects += r.reconnects;
      h.peak += r.peak;
      h.seconds += r.seconds;
      byHour.set(r.hour, h);
    }
    const sinceStart = Object.fromEntries(
      CHANNELS.map((c) => {
        const t = this.totals[c];
        const closed = t.clientClosed + t.serverClosed;
        return [c, { ...t, avgSeconds: closed ? Math.round(t.seconds / closed) : 0 }];
      }),
    ) as SseSnapshot['sinceStart'];
    return {
      open: { ...this.open, total: this.open.online + this.open.yonko },
      sinceStart,
      hours: [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
    };
  }
}
