// Tutorial: progresso por dono (conta ou navegador) e contagens anônimas dos eventos das lições.

import type { DB } from '../db';

export interface TutorialProgress {
  done: string[];
  dismissed: boolean;
  /** Concluiu a Rota do Aprendiz inteira: ganha o título "Aprendiz da Grand Line". */
  apprentice: boolean;
}

const EMPTY: TutorialProgress = { done: [], dismissed: false, apprentice: false };
/** Ids de lição e de passo: letras e números (os mesmos das lições do app). */
export const TUTORIAL_ID = /^[A-Za-z0-9]{1,32}$/;
const MAX_LESSONS = 64;

type Row = { done: string; dismissed: number; completed_at: string | null };

const parseDone = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && TUTORIAL_ID.test(x)) : [];
  } catch {
    return [];
  }
};

export function getProgress(db: DB, ownerHash: string): TutorialProgress {
  const r = db.prepare('SELECT done, dismissed, completed_at FROM tutorial_progress WHERE owner_hash = ?').get(ownerHash) as Row | undefined;
  return r ? { done: parseDone(r.done), dismissed: r.dismissed === 1, apprentice: r.completed_at !== null } : { ...EMPTY };
}

/** O dono concluiu a Rota inteira? (título ao lado do apelido) */
export const isApprentice = (db: DB, ownerHash: string) =>
  db.prepare('SELECT 1 FROM tutorial_progress WHERE owner_hash = ? AND completed_at IS NOT NULL').get(ownerHash) !== undefined;

/**
 * Junta o que o navegador mandou com o que já está gravado: lições concluídas nunca se perdem
 * (união, a não ser em `reset`), e o convite dispensado e o título, uma vez ligados, ficam ligados.
 */
export function mergeProgress(
  db: DB,
  ownerHash: string,
  input: { done: string[]; dismissed: boolean; completed: boolean; reset?: boolean },
): TutorialProgress {
  const cur = getProgress(db, ownerHash);
  // "Recomeçar do zero" troca as lições concluídas pelas enviadas; o título conquistado fica.
  const base = input.reset ? [] : cur.done;
  const done = [...new Set([...base, ...input.done.filter((x) => TUTORIAL_ID.test(x))])].slice(0, MAX_LESSONS);
  const dismissed = cur.dismissed || input.dismissed;
  const apprentice = cur.apprentice || input.completed;
  db.prepare(
    `INSERT INTO tutorial_progress (owner_hash, done, dismissed, completed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_hash) DO UPDATE SET done = excluded.done, dismissed = excluded.dismissed,
       completed_at = COALESCE(tutorial_progress.completed_at, excluded.completed_at), updated_at = datetime('now')`,
  ).run(ownerHash, JSON.stringify(done), dismissed ? 1 : 0, apprentice ? new Date().toISOString() : null);
  return { done, dismissed, apprentice };
}

// ------------------------------------------------------------------ eventos (anônimos)

export const TUTORIAL_EVENTS = ['start', 'step', 'fail', 'exit', 'complete'] as const;
export type TutorialEvent = (typeof TUTORIAL_EVENTS)[number];

export function recordEvent(db: DB, day: string, lesson: string, step: string, event: TutorialEvent) {
  db.prepare(
    `INSERT INTO tutorial_events (day, lesson, step, event, count) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(day, lesson, step, event) DO UPDATE SET count = count + 1`,
  ).run(day, lesson, step, event);
}

export interface LessonFunnel {
  lesson: string;
  starts: number;
  completes: number;
  exits: number;
  fails: number;
  /** Por passo: quantas vezes chegaram, saíram e falharam ali. */
  steps: Array<{ step: string; reached: number; exits: number; fails: number }>;
}

/** Funil por lição desde `since` (AAAA-MM-DD), para a Administração. */
export function tutorialFunnel(db: DB, since: string): LessonFunnel[] {
  const rows = db
    .prepare('SELECT lesson, step, event, SUM(count) AS n FROM tutorial_events WHERE day >= ? GROUP BY lesson, step, event')
    .all(since) as Array<{ lesson: string; step: string; event: TutorialEvent; n: number }>;
  const byLesson = new Map<string, LessonFunnel>();
  const stepOf = (f: LessonFunnel, step: string) => {
    let s = f.steps.find((x) => x.step === step);
    if (!s) f.steps.push((s = { step, reached: 0, exits: 0, fails: 0 }));
    return s;
  };
  for (const r of rows) {
    let f = byLesson.get(r.lesson);
    if (!f) byLesson.set(r.lesson, (f = { lesson: r.lesson, starts: 0, completes: 0, exits: 0, fails: 0, steps: [] }));
    if (r.event === 'start') f.starts += r.n;
    else if (r.event === 'complete') f.completes += r.n;
    else if (r.event === 'step' && r.step) stepOf(f, r.step).reached += r.n;
    else if (r.event === 'exit') {
      f.exits += r.n;
      if (r.step) stepOf(f, r.step).exits += r.n;
    } else if (r.event === 'fail') {
      f.fails += r.n;
      if (r.step) stepOf(f, r.step).fails += r.n;
    }
  }
  return [...byLesson.values()];
}
