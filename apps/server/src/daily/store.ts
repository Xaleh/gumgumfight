// Desafio do dia: a fila publicada por data e os resultados de cada dono (conta ou navegador).

import type { DB } from '../db';
/** O que a fila precisa de um desafio. */
type Queued = { id: string };

/** O dia vira à meia-noite de Brasília (UTC−3, sem horário de verão). */
const DAY_OFFSET_MS = -3 * 3_600_000;
export const dayOf = (ms: number) => new Date(ms + DAY_OFFSET_MS).toISOString().slice(0, 10);
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
export const previousDay = (day: string) => shiftDay(day, -1);

export interface Published<T extends Queued> {
  day: string;
  number: number;
  challenge: T;
}

type ScheduleRow = { day: string; challenge_id: string; number: number };

export const nextDay = (day: string) => shiftDay(day, 1);

/** Data fixa e posição manual de cada desafio (`daily_queue`). */
export function queueMeta(db: DB): Map<string, { position: number | null; pinnedDay: string | null }> {
  const rows = db.prepare('SELECT challenge_id, position, pinned_day FROM daily_queue').all() as Array<{
    challenge_id: string;
    position: number | null;
    pinned_day: string | null;
  }>;
  return new Map(rows.map((r) => [r.challenge_id, { position: r.position, pinnedDay: r.pinned_day }]));
}

/** Datas fixas ainda por vir (a partir de `fromDay`, sem o dia já publicado): dia → desafio. */
function activePins(db: DB, fromDay: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT q.challenge_id, q.pinned_day FROM daily_queue q
       WHERE q.pinned_day IS NOT NULL AND q.pinned_day >= ?
         AND NOT EXISTS (SELECT 1 FROM daily_schedule s WHERE s.day = q.pinned_day)`,
    )
    .all(fromDay) as Array<{ challenge_id: string; pinned_day: string }>;
  return new Map(rows.map((r) => [r.pinned_day, r.challenge_id]));
}

/**
 * Ordem da fila a partir de `fromDay`: primeiro os desafios ainda não publicados (na ordem manual da Administração;
 * sem ela, na ordem da lista: o catálogo e depois os da Administração), depois os já publicados, do que saiu há mais
 * tempo para o mais recente. Desafio com data fixa por vir fica fora: ele sai no dia dele.
 */
export function queueOrder<T extends Queued>(db: DB, catalog: T[], fromDay = '0000-00-00'): T[] {
  const last = new Map(
    (db.prepare('SELECT challenge_id, MAX(day) AS day FROM daily_schedule GROUP BY challenge_id').all() as Array<{ challenge_id: string; day: string }>).map(
      (r) => [r.challenge_id, r.day],
    ),
  );
  const pinned = new Set(activePins(db, fromDay).values());
  const meta = queueMeta(db);
  const pos = (c: T, i: number) => [meta.get(c.id)?.position ?? Number.MAX_SAFE_INTEGER, i] as const;
  const open = catalog.map((c, i) => ({ c, i })).filter(({ c }) => !pinned.has(c.id));
  const fresh = open
    .filter(({ c }) => !last.has(c.id))
    .sort((a, b) => {
      const [pa, ia] = pos(a.c, a.i);
      const [pb, ib] = pos(b.c, b.i);
      return pa - pb || ia - ib;
    })
    .map(({ c }) => c);
  const used = open
    .filter(({ c }) => last.has(c.id))
    .map(({ c }) => c)
    .sort((a, b) => last.get(a.id)!.localeCompare(last.get(b.id)!));
  return [...fresh, ...used];
}

/** Desafios com data fixa por vir, na ordem das datas. */
export function pinnedQueue(db: DB, fromDay: string): Array<{ day: string; challengeId: string }> {
  return [...activePins(db, fromDay).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, challengeId]) => ({ day, challengeId }));
}

/** O desafio publicado no dia (null = nenhum). */
export function publishedOn<T extends Queued>(db: DB, day: string, catalog: T[]): Published<T> | null {
  const r = db.prepare('SELECT day, challenge_id, number FROM daily_schedule WHERE day = ?').get(day) as ScheduleRow | undefined;
  const challenge = r && catalog.find((c) => c.id === r.challenge_id);
  return r && challenge ? { day: r.day, number: r.number, challenge } : null;
}

/**
 * Publica o desafio do dia, se ainda não foi publicado: o que tem a data fixa deste dia ou, sem ele, o próximo da
 * fila. Depois de publicado, o dia não muda.
 */
export function publish<T extends Queued>(db: DB, day: string, catalog: T[]): Published<T> {
  const existing = publishedOn(db, day, catalog);
  if (existing) return existing;
  const pinnedId = activePins(db, day).get(day);
  const next = (pinnedId && catalog.find((c) => c.id === pinnedId)) || queueOrder(db, catalog, day)[0];
  if (!next) throw new Error('catálogo do desafio do dia vazio');
  const number = ((db.prepare('SELECT MAX(number) AS n FROM daily_schedule').get() as { n: number | null }).n ?? 0) + 1;
  db.prepare('INSERT OR IGNORE INTO daily_schedule (day, challenge_id, number) VALUES (?, ?, ?)').run(day, next.id, number);
  return publishedOn(db, day, catalog)!;
}

/** Ordem manual: os ids na ordem pedida (os outros ficam sem posição, depois deles). */
export function setQueueOrder(db: DB, ids: string[]) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE daily_queue SET position = NULL').run();
    const put = db.prepare(
      'INSERT INTO daily_queue (challenge_id, position) VALUES (?, ?) ON CONFLICT(challenge_id) DO UPDATE SET position = excluded.position',
    );
    ids.forEach((id, i) => put.run(id, i));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Fixa (ou solta, com `day` null) a data de um desafio. Só vale para um dia ainda não publicado, de hoje em diante, e
 * um desafio por dia.
 */
export function pinChallenge(db: DB, id: string, day: string | null, today: string): 'ok' | 'past' | 'published' | 'taken' {
  if (day !== null) {
    if (day < today) return 'past';
    if (db.prepare('SELECT 1 FROM daily_schedule WHERE day = ?').get(day)) return 'published';
    const other = db.prepare('SELECT challenge_id FROM daily_queue WHERE pinned_day = ?').get(day) as { challenge_id: string } | undefined;
    if (other && other.challenge_id !== id) return 'taken';
  }
  db.prepare(
    'INSERT INTO daily_queue (challenge_id, pinned_day) VALUES (?, ?) ON CONFLICT(challenge_id) DO UPDATE SET pinned_day = excluded.pinned_day',
  ).run(id, day);
  return 'ok';
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

/** Quem abriu a mesa do desafio do dia (sem tentativa ainda): entra nos números do dia como "abriu". */
export function recordOpen(db: DB, owner: string, day: string) {
  db.prepare('INSERT OR IGNORE INTO daily_results (owner_hash, day, attempts) VALUES (?, ?, 0)').run(owner, day);
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

export interface DayStats {
  /** Donos que abriram a mesa do desafio. */
  opened: number;
  /** Donos com pelo menos uma tentativa terminada. */
  players: number;
  solvers: number;
  /** Média de tentativas de quem resolveu (null = ninguém resolveu). */
  avgAttempts: number | null;
}

/** Números do dia: quantos abriram, tentaram e resolveram, e a média de tentativas de quem resolveu. */
export function dayStats(db: DB, day: string): DayStats {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS opened, SUM(attempts > 0) AS players, SUM(solved_at IS NOT NULL) AS solvers,
              AVG(CASE WHEN solved_at IS NOT NULL THEN attempts END) AS avg
       FROM daily_results WHERE day = ?`,
    )
    .get(day) as { opened: number; players: number | null; solvers: number | null; avg: number | null };
  return { opened: r.opened, players: r.players ?? 0, solvers: r.solvers ?? 0, avgAttempts: r.avg === null ? null : Math.round(r.avg * 10) / 10 };
}
