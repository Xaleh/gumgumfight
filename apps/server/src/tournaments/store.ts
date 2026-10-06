// SQL dos torneios: o torneio, os inscritos (com o deck congelado) e as partidas de cada rodada.

import { randomBytes } from 'node:crypto';
import type { DeckList } from '@gumgum/engine';
import { type DB, transaction } from '../db';
import type { FormatId } from '../stats/catalog';
import { type MatchResult, type Pairing, type Stage, type Structure, type TMatch, type TPlayer, winsNeeded } from './pairing';

export type TournamentStatus = 'registration' | 'running' | 'finished';

export interface Tournament {
  id: string;
  name: string;
  description: string;
  format: FormatId;
  structure: Structure;
  /** Rodadas do suíço (null = calculado no início). Eliminação simples: definido no início. */
  rounds: number | null;
  /** Partidas do suíço: melhor de 1 ou de 3. */
  swissBestOf: number;
  /** Suíço: quantos vão para a eliminatória no fim (null = sem top cut). */
  topCut: number | null;
  /** Eliminatória: melhor de 3 / de 5 a partir da fase com estas vagas (null = nunca). */
  bo3From: number | null;
  bo5From: number | null;
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
  bestOf: number;
  /** Jogos vencidos por p1 e p2 na série. */
  wins: [number, number];
  /** Quem começa o próximo jogo da série (quem perdeu o anterior). */
  nextFirst: string | null;
  roomId: string | null;
  matchId: number | null;
  reportedBy: string | null;
}

export type TournamentInput = Pick<
  Tournament,
  'name' | 'description' | 'format' | 'structure' | 'rounds' | 'swissBestOf' | 'topCut' | 'bo3From' | 'bo5From' | 'maxPlayers' | 'startsAt'
>;

type TournamentRow = {
  id: string;
  name: string;
  description: string;
  format: FormatId;
  structure: Structure;
  rounds: number | null;
  swiss_best_of: number;
  top_cut: number | null;
  bo3_from: number | null;
  bo5_from: number | null;
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
  swissBestOf: r.swiss_best_of,
  topCut: r.top_cut,
  bo3From: r.bo3_from,
  bo5From: r.bo5_from,
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
    `INSERT INTO tournaments (id, name, description, format, structure, rounds, swiss_best_of, top_cut, bo3_from, bo5_from,
       max_players, starts_at, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, ...inputValues(input), organizerId);
  return getTournament(db, id)!;
}

export function updateTournament(db: DB, id: string, input: TournamentInput) {
  db.prepare(
    `UPDATE tournaments SET name = ?, description = ?, format = ?, structure = ?, rounds = ?, swiss_best_of = ?, top_cut = ?,
       bo3_from = ?, bo5_from = ?, max_players = ?, starts_at = ?
     WHERE id = ?`,
  ).run(...inputValues(input), id);
}

const inputValues = (i: TournamentInput) =>
  [i.name, i.description, i.format, i.structure, i.rounds, i.swissBestOf, i.topCut, i.bo3From, i.bo5From, i.maxPlayers, i.startsAt] as const;

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
  stage: Stage;
  table_no: number;
  p1: string;
  p2: string | null;
  best_of: number;
  wins1: number;
  wins2: number;
  result: MatchResult | null;
  next_first: string | null;
  room_id: string | null;
  match_id: number | null;
  reported_by: string | null;
};

const MATCH_COLS = 'id, round, stage, table_no, p1, p2, best_of, wins1, wins2, result, next_first, room_id, match_id, reported_by';

const toMatch = (r: MatchRow): TournamentMatch => ({
  id: r.id,
  round: r.round,
  stage: r.stage,
  table: r.table_no,
  p1: r.p1,
  p2: r.p2,
  bestOf: r.best_of,
  wins: [r.wins1, r.wins2],
  result: r.result,
  nextFirst: r.next_first,
  roomId: r.room_id,
  matchId: r.match_id,
  reportedBy: r.reported_by,
});

export function listMatches(db: DB, tournamentId: string): TournamentMatch[] {
  return (
    db.prepare(`SELECT ${MATCH_COLS} FROM tournament_matches WHERE tournament_id = ? ORDER BY round, table_no`).all(tournamentId) as MatchRow[]
  ).map(toMatch);
}

export function getMatch(db: DB, tournamentId: string, id: number): TournamentMatch | null {
  const r = db.prepare(`SELECT ${MATCH_COLS} FROM tournament_matches WHERE tournament_id = ? AND id = ?`).get(tournamentId, id) as
    | MatchRow
    | undefined;
  return r ? toMatch(r) : null;
}

/** Rodada nova: fase e melhor de quantos valem para todas as partidas dela. */
export interface RoundSpec {
  round: number;
  stage: Stage;
  bestOf: number;
  pairings: Pairing[];
}

/** Começa o torneio: grava a ordem sorteada, o número de rodadas e a primeira rodada. */
export function startTournament(db: DB, id: string, seeds: string[], rounds: number, first: RoundSpec) {
  transaction(db, () => {
    const seed = db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?');
    seeds.forEach((userId, i) => seed.run(i + 1, id, userId));
    db.prepare("UPDATE tournaments SET status = 'running', rounds = ?, started_at = datetime('now') WHERE id = ?").run(rounds, id);
    writeRound(db, id, first);
  });
}

/** Grava a rodada (byes já saem com resultado) e a torna a rodada atual. */
export function insertRound(db: DB, id: string, spec: RoundSpec) {
  transaction(db, () => writeRound(db, id, spec));
}

function writeRound(db: DB, id: string, { round, stage, bestOf, pairings }: RoundSpec) {
  const write = db.prepare(
    `INSERT INTO tournament_matches (tournament_id, round, stage, table_no, p1, p2, best_of, result, reported_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  pairings.forEach((p, i) => write.run(id, round, stage, i + 1, p.p1, p.p2, bestOf, p.p2 ? null : 'bye', p.p2 ? null : 'bye'));
  db.prepare('UPDATE tournaments SET round = ? WHERE id = ?').run(round, id);
}

export function finishTournament(db: DB, id: string) {
  db.prepare("UPDATE tournaments SET status = 'finished', finished_at = datetime('now') WHERE id = ?").run(id);
}

/** Resultado da série a partir do placar (null = ainda em andamento). */
export const seriesResult = (bestOf: number, wins: [number, number]): MatchResult | null =>
  wins[0] >= winsNeeded(bestOf) ? 'p1' : wins[1] >= winsNeeded(bestOf) ? 'p2' : null;

/** Placar lançado pelo organizador (0 x 0 apaga o resultado). */
export function setMatchScore(db: DB, tournamentId: string, id: number, bestOf: number, wins: [number, number], reportedBy: string) {
  const result = seriesResult(bestOf, wins);
  db.prepare(
    `UPDATE tournament_matches SET wins1 = ?, wins2 = ?, result = ?, reported_by = ?, updated_at = datetime('now')
     WHERE tournament_id = ? AND id = ?`,
  ).run(wins[0], wins[1], result, wins[0] || wins[1] ? reportedBy : null, tournamentId, id);
}

/** Troca um jogador de uma partida ainda não jogada (correção de um resultado da rodada anterior da chave). */
export function replaceInMatch(db: DB, tournamentId: string, id: number, from: string, to: string) {
  db.prepare(
    `UPDATE tournament_matches SET p1 = CASE WHEN p1 = ? THEN ? ELSE p1 END, p2 = CASE WHEN p2 = ? THEN ? ELSE p2 END,
       updated_at = datetime('now') WHERE tournament_id = ? AND id = ?`,
  ).run(from, to, from, to, tournamentId, id);
}

export function setMatchRoom(db: DB, tournamentId: string, id: number, roomId: string) {
  db.prepare('UPDATE tournament_matches SET room_id = ? WHERE tournament_id = ? AND id = ?').run(roomId, tournamentId, id);
}

/**
 * Fim de um jogo online da série: soma a vitória no placar e, se alguém chegou à
 * maioria, fecha a série. Ignora jogos de uma sala que não é a atual da partida
 * (o organizador já lançou outro placar, por exemplo). Quem perdeu começa o
 * próximo jogo. Jogo sem vencedor não conta: a série segue com um jogo novo.
 */
export function reportFromGame(
  db: DB,
  game: { tournamentId: string; matchId: number; roomId: string; winner: string | null; statsMatchId: number | null },
) {
  const t = getTournament(db, game.tournamentId);
  const m = t && getMatch(db, t.id, game.matchId);
  if (!t || !m || t.status !== 'running' || m.roomId !== game.roomId) return;
  const wins: [number, number] = [...m.wins];
  if (!m.result && game.winner === m.p1) wins[0]++;
  else if (!m.result && game.winner === m.p2) wins[1]++;
  const loser = game.winner === m.p1 ? m.p2 : game.winner === m.p2 ? m.p1 : m.nextFirst;
  const result = m.result ?? seriesResult(m.bestOf, wins);
  db.prepare(
    `UPDATE tournament_matches SET wins1 = ?, wins2 = ?, result = ?, next_first = ?, room_id = NULL, match_id = ?,
       reported_by = CASE WHEN ? THEN reported_by ELSE 'game' END, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(wins[0], wins[1], result, loser, game.statsMatchId, m.result ? 1 : 0, m.id);
}
