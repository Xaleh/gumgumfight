// SQL dos torneios: o torneio, os inscritos (com o deck congelado) e as partidas de cada rodada.

import { randomBytes } from 'node:crypto';
import type { DeckList } from '@gumgum/engine';
import { type DB, transaction } from '../db';
import type { FormatId } from '../stats/catalog';
import type { MatchResult, Pairing, Structure, TMatch, TPlayer } from './pairing';

export type TournamentStatus = 'registration' | 'running' | 'finished';

export interface Tournament {
  id: string;
  name: string;
  description: string;
  format: FormatId;
  structure: Structure;
  /** Suíço: número de rodadas (null = calculado no início). Eliminação simples: definido no início. */
  rounds: number | null;
  maxPlayers: number | null;
  startsAt: string | null;
  status: TournamentStatus;
  round: number;
  organizerId: string;
  organizerName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TournamentPlayer extends TPlayer {
  name: string;
  deckId: string | null;
  deck: DeckList;
  registeredAt: string;
}

export interface TournamentMatch extends TMatch {
  id: number;
  roomId: string | null;
  matchId: number | null;
  reportedBy: string | null;
}

export type TournamentInput = Pick<Tournament, 'name' | 'description' | 'format' | 'structure' | 'rounds' | 'maxPlayers' | 'startsAt'>;

type TournamentRow = {
  id: string;
  name: string;
  description: string;
  format: FormatId;
  structure: Structure;
  rounds: number | null;
  max_players: number | null;
  starts_at: string | null;
  status: TournamentStatus;
  round: number;
  organizer_id: string;
  organizer_name: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const toTournament = (r: TournamentRow): Tournament => ({
  id: r.id,
  name: r.name,
  description: r.description,
  format: r.format,
  structure: r.structure,
  rounds: r.rounds,
  maxPlayers: r.max_players,
  startsAt: r.starts_at,
  status: r.status,
  round: r.round,
  organizerId: r.organizer_id,
  organizerName: r.organizer_name,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

// Nome do organizador: o público (perfil de estatísticas), nunca o da conta Google.
const TOURNAMENT_COLS = 't.*, p.name AS organizer_name';
const TOURNAMENT_FROM = `FROM tournaments t LEFT JOIN players p ON p.owner_hash = 'user:' || t.organizer_id`;

export function createTournament(db: DB, input: TournamentInput, organizerId: string): Tournament {
  const id = `t-${randomBytes(5).toString('hex')}`;
  db.prepare(
    `INSERT INTO tournaments (id, name, description, format, structure, rounds, max_players, starts_at, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.description, input.format, input.structure, input.rounds, input.maxPlayers, input.startsAt, organizerId);
  return getTournament(db, id)!;
}

export function updateTournament(db: DB, id: string, input: TournamentInput) {
  db.prepare(
    `UPDATE tournaments SET name = ?, description = ?, format = ?, structure = ?, rounds = ?, max_players = ?, starts_at = ?
     WHERE id = ?`,
  ).run(input.name, input.description, input.format, input.structure, input.rounds, input.maxPlayers, input.startsAt, id);
}

export function deleteTournament(db: DB, id: string): boolean {
  return Number(db.prepare('DELETE FROM tournaments WHERE id = ?').run(id).changes) > 0;
}

export function getTournament(db: DB, id: string): Tournament | null {
  const r = db.prepare(`SELECT ${TOURNAMENT_COLS} ${TOURNAMENT_FROM} WHERE t.id = ?`).get(id) as TournamentRow | undefined;
  return r ? toTournament(r) : null;
}

/** Torneios para a lista: inscrições abertas e em andamento primeiro; depois os encerrados mais recentes. */
export function listTournaments(db: DB, limit = 100): Array<Tournament & { players: number }> {
  const rows = db
    .prepare(
      `SELECT ${TOURNAMENT_COLS}, (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS players
       ${TOURNAMENT_FROM}
       ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END,
         COALESCE(t.finished_at, t.starts_at, t.created_at) DESC
       LIMIT ?`,
    )
    .all(limit) as Array<TournamentRow & { players: number }>;
  return rows.map((r) => ({ ...toTournament(r), players: Number(r.players) }));
}

/** Ids dos torneios em que a conta está inscrita. */
export function tournamentsOf(db: DB, userId: string): Set<string> {
  const rows = db.prepare('SELECT tournament_id FROM tournament_players WHERE user_id = ?').all(userId) as Array<{ tournament_id: string }>;
  return new Set(rows.map((r) => r.tournament_id));
}

// ------------------------------------------------------------------ inscritos

type PlayerRow = {
  user_id: string;
  name: string;
  deck_id: string | null;
  deck: string;
  seed: number | null;
  dropped: number;
  registered_at: string;
};

export function listPlayers(db: DB, tournamentId: string): TournamentPlayer[] {
  const rows = db
    .prepare(
      // O nome segue o perfil público (se a pessoa trocar de nome, a lista acompanha).
      `SELECT tp.user_id, COALESCE(p.name, tp.name) AS name, tp.deck_id, tp.deck, tp.seed, tp.dropped, tp.registered_at
       FROM tournament_players tp LEFT JOIN players p ON p.owner_hash = 'user:' || tp.user_id
       WHERE tp.tournament_id = ? ORDER BY COALESCE(tp.seed, 1e9), tp.registered_at, tp.user_id`,
    )
    .all(tournamentId) as PlayerRow[];
  return rows.map((r, i) => ({
    userId: r.user_id,
    name: r.name,
    deckId: r.deck_id,
    deck: JSON.parse(r.deck) as DeckList,
    seed: r.seed ?? i + 1,
    dropped: Boolean(r.dropped),
    registeredAt: r.registered_at,
  }));
}

/** Inscreve (ou troca o deck de quem já está inscrito). */
export function registerPlayer(db: DB, tournamentId: string, userId: string, name: string, deckId: string | null, deck: DeckList) {
  db.prepare(
    `INSERT INTO tournament_players (tournament_id, user_id, name, deck_id, deck) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tournament_id, user_id) DO UPDATE SET name = excluded.name, deck_id = excluded.deck_id, deck = excluded.deck`,
  ).run(tournamentId, userId, name, deckId, JSON.stringify(deck));
}

export function unregisterPlayer(db: DB, tournamentId: string, userId: string): boolean {
  return Number(db.prepare('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?').run(tournamentId, userId).changes) > 0;
}

export function countPlayers(db: DB, tournamentId: string): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM tournament_players WHERE tournament_id = ?').get(tournamentId) as { n: number }).n);
}

/**
 * Desistência durante o torneio: o jogador sai das próximas rodadas e, se a partida
 * dele na rodada atual ainda não tem resultado, o oponente vence.
 */
export function dropPlayer(db: DB, t: Tournament, userId: string) {
  transaction(db, () => {
    db.prepare('UPDATE tournament_players SET dropped = 1 WHERE tournament_id = ? AND user_id = ?').run(t.id, userId);
    db.prepare(
      `UPDATE tournament_matches SET result = CASE WHEN p1 = ? THEN 'p2' ELSE 'p1' END, reported_by = 'drop', updated_at = datetime('now')
       WHERE tournament_id = ? AND round = ? AND result IS NULL AND p2 IS NOT NULL AND (p1 = ? OR p2 = ?)`,
    ).run(userId, t.id, t.round, userId, userId);
  });
}

// ------------------------------------------------------------------ rodadas

type MatchRow = {
  id: number;
  round: number;
  table_no: number;
  p1: string;
  p2: string | null;
  result: MatchResult | null;
  room_id: string | null;
  match_id: number | null;
  reported_by: string | null;
};

const toMatch = (r: MatchRow): TournamentMatch => ({
  id: r.id,
  round: r.round,
  table: r.table_no,
  p1: r.p1,
  p2: r.p2,
  result: r.result,
  roomId: r.room_id,
  matchId: r.match_id,
  reportedBy: r.reported_by,
});

export function listMatches(db: DB, tournamentId: string): TournamentMatch[] {
  return (
    db
      .prepare(
        `SELECT id, round, table_no, p1, p2, result, room_id, match_id, reported_by FROM tournament_matches
         WHERE tournament_id = ? ORDER BY round, table_no`,
      )
      .all(tournamentId) as MatchRow[]
  ).map(toMatch);
}

export function getMatch(db: DB, tournamentId: string, id: number): TournamentMatch | null {
  const r = db
    .prepare('SELECT id, round, table_no, p1, p2, result, room_id, match_id, reported_by FROM tournament_matches WHERE tournament_id = ? AND id = ?')
    .get(tournamentId, id) as MatchRow | undefined;
  return r ? toMatch(r) : null;
}

/** Começa o torneio: grava a ordem sorteada, o número de rodadas e a primeira rodada. */
export function startTournament(db: DB, id: string, seeds: string[], rounds: number, pairings: Pairing[]) {
  transaction(db, () => {
    const seed = db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?');
    seeds.forEach((userId, i) => seed.run(i + 1, id, userId));
    db.prepare("UPDATE tournaments SET status = 'running', rounds = ?, started_at = datetime('now') WHERE id = ?").run(rounds, id);
    writeRound(db, id, 1, pairings);
  });
}

/** Grava a rodada (byes já saem com resultado) e a torna a rodada atual. */
export function insertRound(db: DB, id: string, round: number, pairings: Pairing[]) {
  transaction(db, () => writeRound(db, id, round, pairings));
}

function writeRound(db: DB, id: string, round: number, pairings: Pairing[]) {
  const write = db.prepare(
    `INSERT INTO tournament_matches (tournament_id, round, table_no, p1, p2, result, reported_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  pairings.forEach((p, i) => write.run(id, round, i + 1, p.p1, p.p2, p.p2 ? null : 'bye', p.p2 ? null : 'bye'));
  db.prepare('UPDATE tournaments SET round = ? WHERE id = ?').run(round, id);
}

export function finishTournament(db: DB, id: string) {
  db.prepare("UPDATE tournaments SET status = 'finished', finished_at = datetime('now') WHERE id = ?").run(id);
}

/** Resultado lançado pelo organizador (null apaga). */
export function setMatchResult(db: DB, tournamentId: string, id: number, result: MatchResult | null, reportedBy: string) {
  db.prepare(
    `UPDATE tournament_matches SET result = ?, reported_by = ?, updated_at = datetime('now') WHERE tournament_id = ? AND id = ?`,
  ).run(result, result ? reportedBy : null, tournamentId, id);
}

export function setMatchRoom(db: DB, tournamentId: string, id: number, roomId: string) {
  db.prepare('UPDATE tournament_matches SET room_id = ? WHERE tournament_id = ? AND id = ?').run(roomId, tournamentId, id);
}

/**
 * Fim de uma partida online do torneio: grava o resultado, a menos que o
 * organizador já tenha lançado outro ou que a partida não seja mais da rodada atual.
 * Empate: no suíço vale empate; na eliminação simples fica para o organizador.
 */
export function reportFromGame(
  db: DB,
  game: { tournamentId: string; matchId: number; roomId: string; winner: string | null; statsMatchId: number | null },
) {
  const t = getTournament(db, game.tournamentId);
  const m = t && getMatch(db, t.id, game.matchId);
  if (!t || !m || t.status !== 'running' || m.round !== t.round || m.roomId !== game.roomId) return;
  db.prepare('UPDATE tournament_matches SET match_id = ? WHERE id = ?').run(game.statsMatchId, m.id);
  if (m.result) return;
  const result: MatchResult | null =
    game.winner === m.p1 ? 'p1' : game.winner === m.p2 ? 'p2' : game.winner === null && t.structure === 'swiss' ? 'draw' : null;
  if (result) {
    db.prepare(`UPDATE tournament_matches SET result = ?, reported_by = 'game', updated_at = datetime('now') WHERE id = ? AND result IS NULL`).run(
      result,
      m.id,
    );
  }
}
