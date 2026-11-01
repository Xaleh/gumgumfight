// SQL das correções do Bot do Time (`bot_feedback`): marcações de jogadas e notas das partidas.

import type { DB } from '../db';

export type FeedbackKind = 'mark' | 'rating';
export const FEEDBACK_STATUSES = ['open', 'test', 'fixed', 'dismissed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const isFeedbackStatus = (v: unknown): v is FeedbackStatus => FEEDBACK_STATUSES.includes(v as FeedbackStatus);

export interface FeedbackInput {
  matchId: number;
  userId: string;
  kind: FeedbackKind;
  botLevel: string | null;
  botSeat: number | null;
  botDeck: string | null;
  leader: string | null;
  oppLeader: string | null;
  actionIndex: number | null;
  turn: number | null;
  /** JSON da jogada do bot (por números de carta). */
  botAction: string | null;
  /** JSON da jogada esperada (ou texto livre). */
  expected: string | null;
  /** JSON da visão do bot na posição. */
  position: string | null;
  rating: number | null;
  comment: string | null;
}

/** Uma correção na lista (sem a posição, que é grande). */
export interface FeedbackItem {
  id: number;
  matchId: number;
  userId: string;
  userName: string | null;
  kind: FeedbackKind;
  botLevel: string | null;
  botSeat: number | null;
  botDeck: string | null;
  leader: string | null;
  oppLeader: string | null;
  actionIndex: number | null;
  turn: number | null;
  botAction: unknown;
  expected: unknown;
  rating: number | null;
  comment: string | null;
  status: FeedbackStatus;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

type Row = {
  id: number;
  match_id: number;
  user_id: string;
  user_name: string | null;
  kind: string;
  bot_level: string | null;
  bot_seat: number | null;
  bot_deck: string | null;
  leader: string | null;
  opp_leader: string | null;
  action_index: number | null;
  turn: number | null;
  bot_action: string | null;
  expected: string | null;
  rating: number | null;
  comment: string | null;
  status: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
};

const COLS = `f.id, f.match_id, f.user_id, u.name AS user_name, f.kind, f.bot_level, f.bot_seat, f.bot_deck, f.leader, f.opp_leader,
  f.action_index, f.turn, f.bot_action, f.expected, f.rating, f.comment, f.status, f.note, f.created_at, f.resolved_at`;

const parse = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const toItem = (r: Row): FeedbackItem => ({
  id: r.id,
  matchId: r.match_id,
  userId: r.user_id,
  userName: r.user_name,
  kind: r.kind === 'rating' ? 'rating' : 'mark',
  botLevel: r.bot_level,
  botSeat: r.bot_seat,
  botDeck: r.bot_deck,
  leader: r.leader,
  oppLeader: r.opp_leader,
  actionIndex: r.action_index,
  turn: r.turn,
  botAction: parse(r.bot_action),
  expected: parse(r.expected),
  rating: r.rating,
  comment: r.comment,
  status: isFeedbackStatus(r.status) ? r.status : 'open',
  note: r.note,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

export function createFeedback(db: DB, f: FeedbackInput): number {
  const r = db
    .prepare(
      `INSERT INTO bot_feedback (match_id, user_id, kind, bot_level, bot_seat, bot_deck, leader, opp_leader, action_index, turn,
         bot_action, expected, position, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(f.matchId, f.userId, f.kind, f.botLevel, f.botSeat, f.botDeck, f.leader, f.oppLeader, f.actionIndex, f.turn, f.botAction, f.expected, f.position, f.rating, f.comment);
  return Number(r.lastInsertRowid);
}

/** Correções, as mais novas primeiro; `status` filtra ('all' = todas). */
export function listFeedback(db: DB, status: FeedbackStatus | 'all' = 'open', limit = 200): FeedbackItem[] {
  const where = status === 'all' ? '' : 'WHERE f.status = ?';
  const rows = db
    .prepare(`SELECT ${COLS} FROM bot_feedback f LEFT JOIN users u ON u.id = f.user_id ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT ?`)
    .all(...(status === 'all' ? [limit] : [status, limit])) as Row[];
  return rows.map(toItem);
}

export function getFeedback(db: DB, id: number): (FeedbackItem & { position: unknown }) | null {
  const r = db.prepare(`SELECT ${COLS}, f.position FROM bot_feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`).get(id) as (Row & { position: string | null }) | undefined;
  return r ? { ...toItem(r), position: parse(r.position) } : null;
}

export function setFeedbackStatus(db: DB, id: number, status: FeedbackStatus, note: string | null, by: string): boolean {
  const res = db
    .prepare(`UPDATE bot_feedback SET status = ?, note = ?, resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END, resolved_by = ? WHERE id = ?`)
    .run(status, note, status, by, id);
  return Number(res.changes) > 0;
}

/** Resumo por deck do bot: partidas avaliadas, nota média e marcações abertas. */
export function feedbackByDeck(db: DB): Array<{ botDeck: string | null; leader: string | null; ratings: number; avgRating: number | null; openMarks: number; marks: number }> {
  return (
    db
      .prepare(
        `SELECT bot_deck, leader,
           SUM(kind = 'rating') AS ratings, AVG(CASE WHEN kind = 'rating' THEN rating END) AS avg_rating,
           SUM(kind = 'mark' AND status = 'open') AS open_marks, SUM(kind = 'mark') AS marks
         FROM bot_feedback GROUP BY bot_deck, leader ORDER BY marks DESC`,
      )
      .all() as Array<{ bot_deck: string | null; leader: string | null; ratings: number; avg_rating: number | null; open_marks: number; marks: number }>
  ).map((r) => ({ botDeck: r.bot_deck, leader: r.leader, ratings: r.ratings, avgRating: r.avg_rating, openMarks: r.open_marks, marks: r.marks }));
}
