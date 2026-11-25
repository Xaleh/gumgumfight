// Desafio do dia: a fila publicada por data e os resultados de cada dono (conta ou navegador).

import type { DB } from '../db';
import { type CatalogChallenge, DAILY_CATALOG } from './catalog';

/** O dia vira à meia-noite de Brasília (UTC−3, sem horário de verão). */
const DAY_OFFSET_MS = -3 * 3_600_000;
export const dayOf = (ms: number) => new Date(ms + DAY_OFFSET_MS).toISOString().slice(0, 10);
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
export const previousDay = (day: string) => shiftDay(day, -1);

export interface Published {
  day: string;
  number: number;
  challenge: CatalogChallenge;
}

type ScheduleRow = { day: string; challenge_id: string; number: number };

/**
 * Ordem da fila: primeiro os desafios do catálogo ainda não publicados (na ordem do arquivo), depois os já
 * publicados, do que saiu há mais tempo para o mais recente.
 */
export function queueOrder(db: DB, catalog = DAILY_CATALOG): CatalogChallenge[] {
  const last = new Map(
    (db.prepare('SELECT challenge_id, MAX(day) AS day FROM daily_schedule GROUP BY challenge_id').all() as Array<{ challenge_id: string; day: string }>).map(
      (r) => [r.challenge_id, r.day],
    ),
  );
  const fresh = catalog.filter((c) => !last.has(c.id));
  const used = catalog.filter((c) => last.has(c.id)).sort((a, b) => last.get(a.id)!.localeCompare(last.get(b.id)!));
  return [...fresh, ...used];
}

/** O desafio publicado no dia (null = nenhum). */
export function publishedOn(db: DB, day: string, catalog = DAILY_CATALOG): Published | null {
  const r = db.prepare('SELECT day, challenge_id, number FROM daily_schedule WHERE day = ?').get(day) as ScheduleRow | undefined;
  const challenge = r && catalog.find((c) => c.id === r.challenge_id);
  return r && challenge ? { day: r.day, number: r.number, challenge } : null;
}

/** Publica o desafio do dia, se ainda não foi publicado: o próximo da fila. Depois de publicado, o dia não muda. */
export function publish(db: DB, day: string, catalog = DAILY_CATALOG): Published {
  const existing = publishedOn(db, day, catalog);
  if (existing) return existing;
  const next = queueOrder(db, catalog)[0];
  if (!next) throw new Error('catálogo do desafio do dia vazio');
  const number = ((db.prepare('SELECT MAX(number) AS n FROM daily_schedule').get() as { n: number | null }).n ?? 0) + 1;
  db.prepare('INSERT OR IGNORE INTO daily_schedule (day, challenge_id, number) VALUES (?, ?, ?)').run(day, next.id, number);
  return publishedOn(db, day, catalog)!;
}

export function recentSchedule(db: DB, limit: number): ScheduleRow[] {
  return db.prepare('SELECT day, challenge_id, number FROM daily_schedule ORDER BY day DESC LIMIT ?').all(limit) as ScheduleRow[];
}

// ------------------------------------------------------------------ resultados

export interface DailyResult {
  attempts: number;
  solved: boolean;
}

export function resultOf(db: DB, owner: string, day: string): DailyResult {
  const r = db.prepare('SELECT attempts, solved_at FROM daily_results WHERE owner_hash = ? AND day = ?').get(owner, day) as
    | { attempts: number; solved_at: string | null }
    | undefined;
  return { attempts: r?.attempts ?? 0, solved: Boolean(r?.solved_at) };
}

/** Conta uma tentativa terminada. Depois de resolver, o resultado do dia não muda mais. */
export function recordAttempt(db: DB, owner: string, day: string, solved: boolean): DailyResult {
  db.prepare(
    `INSERT INTO daily_results (owner_hash, day, attempts, solved_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(owner_hash, day) DO UPDATE SET
       attempts = CASE WHEN daily_results.solved_at IS NULL THEN daily_results.attempts + 1 ELSE daily_results.attempts END,
       solved_at = COALESCE(daily_results.solved_at, excluded.solved_at),
       updated_at = datetime('now')`,
  ).run(owner, day, solved ? new Date().toISOString() : null);
  return resultOf(db, owner, day);
}

export interface Streak {
  /** Dias seguidos resolvidos até hoje (ou até ontem, enquanto o de hoje não foi resolvido). */
  current: number;
  best: number;
  /** Dias resolvidos no total. */
  solved: number;
}

/** Sequência de dias seguidos resolvidos (`today` no fuso do desafio). */
export function streakOf(db: DB, owner: string, today: string): Streak {
  const days = (db.prepare('SELECT day FROM daily_results WHERE owner_hash = ? AND solved_at IS NOT NULL ORDER BY day').all(owner) as Array<{ day: string }>).map(
    (r) => r.day,
  );
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && shiftDay(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const set = new Set(days);
  let current = 0;
  for (let d = set.has(today) ? today : previousDay(today); set.has(d); d = previousDay(d)) current++;
  return { current, best, solved: days.length };
}

/** Os últimos `n` dias publicados até `today`, com o resultado do dono em cada um. */
export function historyOf(db: DB, owner: string | null, today: string, n: number) {
  const rows = db
    .prepare(
      `SELECT s.day, s.number, r.attempts, r.solved_at FROM daily_schedule s
       LEFT JOIN daily_results r ON r.day = s.day AND r.owner_hash = ?
       WHERE s.day <= ? ORDER BY s.day DESC LIMIT ?`,
    )
    .all(owner ?? '', today, n) as Array<{ day: string; number: number; attempts: number | null; solved_at: string | null }>;
  return rows.map((r) => ({ day: r.day, number: r.number, attempts: r.attempts ?? 0, solved: Boolean(r.solved_at) }));
}

/** Quantos donos tentaram e quantos resolveram no dia (para a Administração e o resultado). */
export function dayStats(db: DB, day: string) {
  const r = db.prepare('SELECT COUNT(*) AS players, SUM(solved_at IS NOT NULL) AS solvers FROM daily_results WHERE day = ?').get(day) as {
    players: number;
    solvers: number | null;
  };
  return { players: r.players, solvers: r.solvers ?? 0 };
}
