// SQL da auditoria das partidas: o resumo e o replay de uma partida gravada
// (`matches` + `match_seats`) e os problemas relatados pelos jogadores (`match_reports`).

import { type DeckList, REPLAY_VERSION } from '@gumgum/engine';
import { dataVersion } from '../cache';
import type { DB } from '../db';

export interface MatchSeatSummary {
  seat: number;
  name: string;
  /** Conta do jogador (null = bot ou navegador sem login). */
  userId: string | null;
  leader: string;
  deckId: string | null;
  won: boolean;
}

export interface MatchSummary {
  id: number;
  queue: string;
  format: string;
  /** Assento vencedor (null = sem vencedor). */
  winner: number | null;
  turns: number | null;
  reason: string | null;
  playedAt: string;
  players: MatchSeatSummary[];
  /** Jogo de torneio: a série e o jogo. */
  tournament: { id: string; name: string; matchId: number; game: number; round: number; table: number } | null;
}

type MatchRow = { id: number; queue: string | null; format: string | null; winner: number | null; turns: number | null; reason: string | null; created_at: string };
type SeatRow = { seat: number; name: string | null; owner_hash: string | null; leader: string; deck_id: string | null; won: number };
type GameRow = { tournament_id: string; name: string; match_id: number; game: number; round: number; table_no: number };

const userOf = (ownerHash: string | null) => (ownerHash?.startsWith('user:') ? ownerHash.slice('user:'.length) : null);

function seats(db: DB, matchId: number): SeatRow[] {
  return db
    .prepare(
      `SELECT ms.seat, p.name, p.owner_hash, ms.leader, ms.deck_id, ms.won
       FROM match_seats ms LEFT JOIN players p ON p.id = ms.player_id WHERE ms.match_id = ? ORDER BY ms.seat`,
    )
    .all(matchId) as SeatRow[];
}

export function matchSummary(db: DB, matchId: number): MatchSummary | null {
  const m = db.prepare('SELECT id, queue, format, winner, turns, reason, created_at FROM matches WHERE id = ?').get(matchId) as MatchRow | undefined;
  if (!m) return null;
  const g = db
    .prepare(
      `SELECT g.tournament_id, t.name, g.match_id, g.game, tm.round, tm.table_no
       FROM tournament_games g JOIN tournaments t ON t.id = g.tournament_id JOIN tournament_matches tm ON tm.id = g.match_id
       WHERE g.stats_match_id = ?`,
    )
    .get(matchId) as GameRow | undefined;
  return {
    id: m.id,
    queue: m.queue ?? 'casual',
    format: m.format ?? 'standard',
    winner: m.winner,
    turns: m.turns,
    reason: m.reason,
    playedAt: m.created_at,
    players: seats(db, matchId).map((s) => ({
      seat: s.seat,
      name: s.name ?? (s.owner_hash ? 'Jogador' : 'Bot'),
      userId: userOf(s.owner_hash),
      leader: s.leader,
      deckId: s.deck_id,
      won: Boolean(s.won),
    })),
    tournament: g ? { id: g.tournament_id, name: g.name, matchId: g.match_id, game: g.game, round: g.round, table: g.table_no } : null,
  };
}

/** Contas que jogaram a partida. */
export function matchUsers(db: DB, matchId: number): string[] {
  return seats(db, matchId)
    .map((s) => userOf(s.owner_hash))
    .filter((id): id is string => Boolean(id));
}

/** Replay gravado, no formato do arquivo que a mesa abre ("Assistir replay"). */
export function matchReplay(db: DB, matchId: number): Record<string, unknown> | null {
  const r = db.prepare('SELECT replay FROM matches WHERE id = ?').get(matchId) as { replay: string | null } | undefined;
  if (!r?.replay) return null;
  const stored = JSON.parse(r.replay) as {
    seed: number;
    seed128?: number[];
    firstPlayer?: number;
    chooseFirst?: boolean;
    legacySetup?: boolean;
    decks: [DeckList, DeckList];
    actions: unknown[];
    version?: number;
    names?: string[];
    deckIds?: Array<string | null>;
  };
  const ss = seats(db, matchId);
  return {
    format: 'gumgumfight-replay',
    // Partidas gravadas antes de o replay guardar a versão: a preparação antiga marca as anteriores à 9.
    version: stored.version ?? (stored.legacySetup ? 8 : REPLAY_VERSION),
    seed: stored.seed,
    seed128: stored.seed128,
    firstPlayer: stored.firstPlayer,
    ...(stored.chooseFirst ? { chooseFirst: true } : {}),
    names: stored.names ?? ss.map((s) => s.name ?? (s.owner_hash ? 'Jogador' : 'Bot')),
    deckIds: stored.deckIds ?? ss.map((s) => s.deck_id),
    decks: stored.decks,
    actions: stored.actions,
  };
}

// ------------------------------------------------------------------ relatos

export interface MatchReport {
  id: number;
  matchId: number;
  tournamentId: string | null;
  reporterId: string;
  reporterName: string;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
}

type ReportRow = {
  id: number;
  match_id: number;
  tournament_id: string | null;
  reporter_id: string;
  reporter_name: string | null;
  text: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
};

const REPORT_COLS = `r.id, r.match_id, r.tournament_id, r.reporter_id, p.name AS reporter_name, r.text, r.created_at, r.resolved_at, r.resolved_by, r.note`;
const REPORT_FROM = `FROM match_reports r LEFT JOIN players p ON p.owner_hash = 'user:' || r.reporter_id`;

const toReport = (r: ReportRow): MatchReport => ({
  id: r.id,
  matchId: r.match_id,
  tournamentId: r.tournament_id,
  reporterId: r.reporter_id,
  reporterName: r.reporter_name ?? 'Jogador',
  text: r.text,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  resolvedBy: r.resolved_by,
  note: r.note,
});

/** Relato de um jogador sobre a partida (um por jogador e partida: relatar de novo troca o texto e reabre). */
export function createReport(db: DB, matchId: number, tournamentId: string | null, reporterId: string, text: string): MatchReport {
  dataVersion.bump();
  db.prepare(
    `INSERT INTO match_reports (match_id, tournament_id, reporter_id, text) VALUES (?, ?, ?, ?)
     ON CONFLICT(match_id, reporter_id) DO UPDATE SET text = excluded.text, created_at = datetime('now'), resolved_at = NULL, resolved_by = NULL, note = NULL`,
  ).run(matchId, tournamentId, reporterId, text);
  const r = db.prepare(`SELECT ${REPORT_COLS} ${REPORT_FROM} WHERE r.match_id = ? AND r.reporter_id = ?`).get(matchId, reporterId) as ReportRow;
  return toReport(r);
}

export function getReport(db: DB, id: number): MatchReport | null {
  const r = db.prepare(`SELECT ${REPORT_COLS} ${REPORT_FROM} WHERE r.id = ?`).get(id) as ReportRow | undefined;
  return r ? toReport(r) : null;
}

export interface ReportFilter {
  /** Só os relatos deste torneio. */
  tournamentId?: string;
  /** Só os relatos dos torneios deste organizador. */
  organizerId?: string;
  status?: 'open' | 'resolved' | 'all';
  limit?: number;
}

/** Relatos, abertos primeiro e os mais novos antes. */
export function listReports(db: DB, f: ReportFilter): MatchReport[] {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (f.tournamentId) {
    where.push('r.tournament_id = ?');
    args.push(f.tournamentId);
  }
  if (f.organizerId) {
    where.push('r.tournament_id IN (SELECT id FROM tournaments WHERE organizer_id = ?)');
    args.push(f.organizerId);
  }
  if (f.status === 'open') where.push('r.resolved_at IS NULL');
  if (f.status === 'resolved') where.push('r.resolved_at IS NOT NULL');
  const rows = db
    .prepare(
      `SELECT ${REPORT_COLS} ${REPORT_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (r.resolved_at IS NOT NULL), r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(...args, f.limit ?? 200) as ReportRow[];
  return rows.map(toReport);
}

/** Marca o relato como resolvido (com uma nota opcional) ou o reabre. */
export function resolveReport(db: DB, id: number, by: string, resolved: boolean, note: string | null): MatchReport | null {
  dataVersion.bump();
  db.prepare(
    `UPDATE match_reports SET resolved_at = CASE WHEN ? THEN datetime('now') ELSE NULL END, resolved_by = CASE WHEN ? THEN ? ELSE NULL END, note = ?
     WHERE id = ?`,
  ).run(resolved ? 1 : 0, resolved ? 1 : 0, by, note, id);
  return getReport(db, id);
}

/** Quantos relatos abertos há (admin: todos; organizador: dos torneios dele). */
export function countOpenReports(db: DB, organizerId?: string): number {
  const r = organizerId
    ? (db
        .prepare(
          'SELECT COUNT(*) AS n FROM match_reports WHERE resolved_at IS NULL AND tournament_id IN (SELECT id FROM tournaments WHERE organizer_id = ?)',
        )
        .get(organizerId) as { n: number })
    : (db.prepare('SELECT COUNT(*) AS n FROM match_reports WHERE resolved_at IS NULL').get() as { n: number });
  return Number(r.n);
}
