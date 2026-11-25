// Monitoramento em produção (A2): os erros do servidor e do navegador, agrupados, e o histórico por hora dos
// canais SSE. Toda a SQL do monitoramento fica aqui.
//
// Um erro é guardado pela impressão digital (`id`): a origem, o tipo, a mensagem sem números nem ids e as primeiras
// linhas da pilha sem linha/coluna nem o hash dos arquivos do build. O mesmo erro de novo só soma `count` e atualiza
// `last_seen` (e volta a ficar aberto, se tinha sido marcado como resolvido).
//
// Nada que identifique a pessoa ou a partida entra: as URLs perdem a query string (os tokens dos lugares vão em
// `?t=`), os tokens de parceiro (`ggf_…`) e sequências longas de hex/base64 viram `[…]`. Não há conta, IP nem
// navegador guardado, só o user-agent (cortado) para saber o aparelho.

import { createHash } from 'node:crypto';
import type { DB } from '../db';

export type ErrorSource = 'server' | 'web';

/** Linhas guardadas no máximo: acima disso, as mais antigas (por `last_seen`) saem. */
export const MAX_ERROR_ROWS = 500;
/** Dias de histórico dos canais SSE. */
export const SSE_HISTORY_DAYS = 30;

const LIMITS = { kind: 24, message: 500, stack: 4000, url: 300, release: 40, userAgent: 200 } as const;

export function migrateMonitor(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_errors (
      id          TEXT PRIMARY KEY,               -- impressão digital (16 hex)
      source      TEXT NOT NULL,                  -- server | web
      kind        TEXT NOT NULL,                  -- route, uncaught, rejection, window, promise, render, test
      message     TEXT NOT NULL,
      stack       TEXT,
      url         TEXT,                           -- rota (servidor) ou caminho da página (navegador), sem query
      status      INTEGER,                        -- status HTTP (servidor)
      release     TEXT,                           -- versão do servidor ou arquivo do build do navegador
      user_agent  TEXT,
      count       INTEGER NOT NULL DEFAULT 1,
      first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT                            -- null = aberto
    );
    CREATE INDEX IF NOT EXISTS monitor_errors_last ON monitor_errors(last_seen);

    CREATE TABLE IF NOT EXISTS monitor_sse_hours (
      hour           TEXT NOT NULL,               -- AAAA-MM-DDTHH (UTC)
      channel        TEXT NOT NULL,               -- online | yonko
      opened         INTEGER NOT NULL DEFAULT 0,
      client_closed  INTEGER NOT NULL DEFAULT 0,  -- quedas: o navegador (ou a rede) fechou o canal
      server_closed  INTEGER NOT NULL DEFAULT 0,  -- o servidor encerrou (fim da sala, reinício)
      reconnects     INTEGER NOT NULL DEFAULT 0,  -- o mesmo lugar abriu de novo em até 2 min
      peak           INTEGER NOT NULL DEFAULT 0,  -- maior número de canais abertos ao mesmo tempo
      seconds        INTEGER NOT NULL DEFAULT 0,  -- soma da duração dos canais fechados
      PRIMARY KEY (hour, channel)
    ) WITHOUT ROWID;
  `);
}

export interface ErrorReport {
  source: ErrorSource;
  kind: string;
  message: string;
  stack?: string | null;
  url?: string | null;
  status?: number | null;
  release?: string | null;
  userAgent?: string | null;
}

export interface ErrorRow {
  id: string;
  source: ErrorSource;
  kind: string;
  message: string;
  stack: string | null;
  url: string | null;
  status: number | null;
  release: string | null;
  userAgent: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
}

/** Tira o que pode identificar alguém ou abrir uma partida: query strings, tokens e ids longos. */
export function scrub(text: string): string {
  return (
    text
      // Query string e fragmento de URLs e caminhos (`/api/online/rooms/x/events?t=…`).
      .replace(/((?:https?:\/\/|\/)[^\s?#'"()<>]*)[?#][^\s'"()<>]*/g, '$1')
      // Tokens de parceiro e qualquer sequência longa de hex ou base64url (tokens dos lugares, sessões).
      .replace(/\bggf_[A-Za-z0-9_-]+/g, '[…]')
      .replace(/\b[A-Fa-f0-9]{24,}\b/g, '[…]')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[…]')
      // E-mails.
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
  );
}

const cut = (v: string | null | undefined, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = scrub(v).trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};

/** O caminho sem query string nem fragmento (e sem o domínio). */
export function cleanPath(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  let path = url;
  try {
    path = new URL(url, 'http://x').pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  return cut(path, LIMITS.url);
}

/** Mensagem e pilha sem o que muda de uma ocorrência para outra (números, ids, linha/coluna, hash do build). */
function normalize(text: string): string {
  return text
    .replace(/-[A-Za-z0-9_]{6,}\.(m?js|css)\b/g, '.$1')
    .replace(/:\d+:\d+\b/g, '')
    .replace(/\b[0-9a-f]{6,}\b/gi, 'X')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(r: Pick<ErrorReport, 'source' | 'kind' | 'message' | 'stack'>): string {
  const frames = (r.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(r.message.slice(0, 40)))
    .slice(0, 3)
    .join('|');
  return createHash('sha256')
    .update([r.source, r.kind, normalize(r.message), normalize(frames)].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}

/** Grava (ou soma) um erro. Devolve a impressão digital. */
export function recordError(db: DB, report: ErrorReport): string {
  const kind = cut(report.kind, LIMITS.kind) ?? 'unknown';
  const message = cut(report.message, LIMITS.message) ?? '(sem mensagem)';
  const stack = cut(report.stack, LIMITS.stack);
  const id = fingerprint({ source: report.source, kind, message, stack });
  const status = typeof report.status === 'number' && Number.isInteger(report.status) ? report.status : null;
  db.prepare(
    `INSERT INTO monitor_errors (id, source, kind, message, stack, url, status, release, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       count = count + 1, last_seen = datetime('now'), resolved_at = NULL,
       message = excluded.message, stack = COALESCE(excluded.stack, stack), url = COALESCE(excluded.url, url),
       status = COALESCE(excluded.status, status), release = COALESCE(excluded.release, release),
       user_agent = COALESCE(excluded.user_agent, user_agent)`,
  ).run(
    id,
    report.source,
    kind,
    message,
    stack,
    report.source === 'web' ? cleanPath(report.url) : cut(report.url, LIMITS.url),
    status,
    cut(report.release, LIMITS.release),
    cut(report.userAgent, LIMITS.userAgent),
  );
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM monitor_errors').get() as { n: number };
  if (n > MAX_ERROR_ROWS) {
    db.prepare('DELETE FROM monitor_errors WHERE id IN (SELECT id FROM monitor_errors ORDER BY last_seen ASC, first_seen ASC LIMIT ?)').run(
      n - MAX_ERROR_ROWS,
    );
  }
  return id;
}

interface RawErrorRow {
  id: string;
  source: ErrorSource;
  kind: string;
  message: string;
  stack: string | null;
  url: string | null;
  status: number | null;
  release: string | null;
  user_agent: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

const toIso = (s: string) => `${s.replace(' ', 'T')}Z`;
const fromRaw = (r: RawErrorRow): ErrorRow => ({
  id: r.id,
  source: r.source,
  kind: r.kind,
  message: r.message,
  stack: r.stack,
  url: r.url,
  status: r.status,
  release: r.release,
  userAgent: r.user_agent,
  count: r.count,
  firstSeen: toIso(r.first_seen),
  lastSeen: toIso(r.last_seen),
  resolvedAt: r.resolved_at ? toIso(r.resolved_at) : null,
});

/** Os erros mais recentes primeiro; sem `resolved`, só os abertos. */
export function listErrors(db: DB, { resolved = false, limit = 100 }: { resolved?: boolean; limit?: number } = {}): ErrorRow[] {
  const rows = db
    .prepare(`SELECT * FROM monitor_errors ${resolved ? '' : 'WHERE resolved_at IS NULL'} ORDER BY last_seen DESC, id LIMIT ?`)
    .all(limit) as unknown as RawErrorRow[];
  return rows.map(fromRaw);
}

export function errorCounts(db: DB): { open: number; resolved: number; last24h: number } {
  const r = db
    .prepare(
      `SELECT SUM(resolved_at IS NULL) AS open, SUM(resolved_at IS NOT NULL) AS resolved,
              SUM(last_seen >= datetime('now', '-1 day')) AS last24h FROM monitor_errors`,
    )
    .get() as { open: number | null; resolved: number | null; last24h: number | null };
  return { open: r.open ?? 0, resolved: r.resolved ?? 0, last24h: r.last24h ?? 0 };
}

export function resolveError(db: DB, id: string): boolean {
  return db.prepare("UPDATE monitor_errors SET resolved_at = datetime('now') WHERE id = ? AND resolved_at IS NULL").run(id).changes > 0;
}

/** Apaga os resolvidos (ou todos, com `all`). */
export function clearErrors(db: DB, all = false): number {
  return Number(db.prepare(`DELETE FROM monitor_errors ${all ? '' : 'WHERE resolved_at IS NOT NULL'}`).run().changes);
}

// ---------------------------------------------------------------- canais SSE

export type SseChannel = 'online' | 'yonko';

export interface SseHour {
  hour: string;
  channel: SseChannel;
  opened: number;
  clientClosed: number;
  serverClosed: number;
  reconnects: number;
  peak: number;
  seconds: number;
}

/** Soma as contagens de uma hora (o pico fica com o maior). */
export function addSseHour(db: DB, h: SseHour) {
  db.prepare(
    `INSERT INTO monitor_sse_hours (hour, channel, opened, client_closed, server_closed, reconnects, peak, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hour, channel) DO UPDATE SET
       opened = opened + excluded.opened, client_closed = client_closed + excluded.client_closed,
       server_closed = server_closed + excluded.server_closed, reconnects = reconnects + excluded.reconnects,
       peak = MAX(peak, excluded.peak), seconds = seconds + excluded.seconds`,
  ).run(h.hour, h.channel, h.opened, h.clientClosed, h.serverClosed, h.reconnects, h.peak, h.seconds);
}

export function pruneSseHours(db: DB, now: number) {
  const oldest = new Date(now - SSE_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 13);
  db.prepare('DELETE FROM monitor_sse_hours WHERE hour < ?').run(oldest);
}

/** As horas a partir de `since` (AAAA-MM-DDTHH), mais antigas primeiro. */
export function sseHours(db: DB, since: string): SseHour[] {
  const rows = db
    .prepare(
      `SELECT hour, channel, opened, client_closed, server_closed, reconnects, peak, seconds
         FROM monitor_sse_hours WHERE hour >= ? ORDER BY hour, channel`,
    )
    .all(since) as Array<{
    hour: string;
    channel: SseChannel;
    opened: number;
    client_closed: number;
    server_closed: number;
    reconnects: number;
    peak: number;
    seconds: number;
  }>;
  return rows.map((r) => ({
    hour: r.hour,
    channel: r.channel,
    opened: r.opened,
    clientClosed: r.client_closed,
    serverClosed: r.server_closed,
    reconnects: r.reconnects,
    peak: r.peak,
    seconds: r.seconds,
  }));
}
