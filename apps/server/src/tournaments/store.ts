// SQL dos torneios: o torneio, os inscritos (com o deck congelado) e as partidas de cada rodada.

import { randomBytes } from 'node:crypto';
import type { DeckList } from '@gumgum/engine';
import { dataVersion } from '../cache';
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
  /**
   * Torneio com hora marcada: check-in 30 min antes, começa sozinho em `startsAt` e,
   * em cada rodada, quem não entra na sala em 5 min perde por W.O. (ver clock.ts).
   */
  checkIn: boolean;
  status: TournamentStatus;
  round: number;
  /** Quando a rodada atual foi gerada (a tolerância do W.O. conta daqui). */
  roundAt: string | null;
  /** A varredura de ausentes da rodada atual já foi feita. */
  roundSwept: boolean;
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
  /** Check-in feito (torneios com hora marcada). */
  checkedInAt: string | null;
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
  /** Quando p1 e p2 entraram na sala da série (presença para o W.O. automático). */
  entered: [string | null, string | null];
}

export type TournamentInput = Pick<
  Tournament,
  | 'name'
  | 'description'
  | 'format'
  | 'structure'
  | 'rounds'
  | 'swissBestOf'
  | 'topCut'
  | 'bo3From'
  | 'bo5From'
  | 'maxPlayers'
  | 'startsAt'
  | 'checkIn'
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
  check_in: number;
  status: TournamentStatus;
  round: number;
  round_at: string | null;
  round_wo: number;
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
  checkIn: Boolean(r.check_in),
  status: r.status,
  round: r.round,
  roundAt: r.round_at,
  roundSwept: Boolean(r.round_wo),
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
  dataVersion.bump();
  const id = `t-${randomBytes(5).toString('hex')}`;
  db.prepare(
    `INSERT INTO tournaments (id, name, description, format, structure, rounds, swiss_best_of, top_cut, bo3_from, bo5_from,
       max_players, starts_at, check_in, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, ...inputValues(input), organizerId);
  return getTournament(db, id)!;
}

export function updateTournament(db: DB, id: string, input: TournamentInput) {
  dataVersion.bump();
  db.prepare(
    `UPDATE tournaments SET name = ?, description = ?, format = ?, structure = ?, rounds = ?, swiss_best_of = ?, top_cut = ?,
       bo3_from = ?, bo5_from = ?, max_players = ?, starts_at = ?, check_in = ?
     WHERE id = ?`,
  ).run(...inputValues(input), id);
}

const inputValues = (i: TournamentInput) =>
  [
    i.name,
    i.description,
    i.format,
    i.structure,
    i.rounds,
    i.swissBestOf,
    i.topCut,
    i.bo3From,
    i.bo5From,
    i.maxPlayers,
    i.startsAt,
    i.checkIn ? 1 : 0,
  ] as const;

export function deleteTournament(db: DB, id: string): boolean {
  dataVersion.bump();
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

/** Torneios ainda não encerrados em que a conta está inscrita (e não desistiu), com o check-in dela. */
export function myTournaments(db: DB, userId: string): Array<{ tournament: Tournament; checkedInAt: string | null }> {
  const rows = db
    .prepare(
      `SELECT ${TOURNAMENT_COLS}, tp.checked_in_at ${TOURNAMENT_FROM}
       JOIN tournament_players tp ON tp.tournament_id = t.id AND tp.user_id = ? AND tp.dropped = 0
       WHERE t.status <> 'finished'
       ORDER BY CASE t.status WHEN 'running' THEN 0 ELSE 1 END, COALESCE(t.starts_at, t.created_at)`,
    )
    .all(userId) as Array<TournamentRow & { checked_in_at: string | null }>;
  return rows.map((r) => ({ tournament: toTournament(r), checkedInAt: r.checked_in_at }));
}

/** Torneios com hora marcada e check-in que o relógio do servidor acompanha (ver clock.ts). */
export function listAutomatic(db: DB): Tournament[] {
  return (
    db.prepare(`SELECT ${TOURNAMENT_COLS} ${TOURNAMENT_FROM} WHERE t.check_in = 1 AND t.status <> 'finished'`).all() as TournamentRow[]
  ).map(toTournament);
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
  checked_in_at: string | null;
};

export function listPlayers(db: DB, tournamentId: string): TournamentPlayer[] {
  const rows = db
    .prepare(
      // O nome segue o perfil público (se a pessoa trocar de nome, a lista acompanha).
      `SELECT tp.user_id, COALESCE(p.name, tp.name) AS name, tp.deck_id, tp.deck, tp.seed, tp.dropped, tp.registered_at, tp.checked_in_at
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
    checkedInAt: r.checked_in_at,
  }));
}

/** Check-in do inscrito (torneios com hora marcada). */
export function checkInPlayer(db: DB, tournamentId: string, userId: string, at: string) {
  dataVersion.bump();
  db.prepare('UPDATE tournament_players SET checked_in_at = COALESCE(checked_in_at, ?) WHERE tournament_id = ? AND user_id = ?').run(
    at,
    tournamentId,
    userId,
  );
}

/** Inscreve (ou troca o deck de quem já está inscrito). */
export function registerPlayer(db: DB, tournamentId: string, userId: string, name: string, deckId: string | null, deck: DeckList) {
  dataVersion.bump();
  db.prepare(
    `INSERT INTO tournament_players (tournament_id, user_id, name, deck_id, deck) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tournament_id, user_id) DO UPDATE SET name = excluded.name, deck_id = excluded.deck_id, deck = excluded.deck`,
  ).run(tournamentId, userId, name, deckId, JSON.stringify(deck));
}

export function unregisterPlayer(db: DB, tournamentId: string, userId: string): boolean {
  dataVersion.bump();
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
  dataVersion.bump();
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
  p1_in: string | null;
  p2_in: string | null;
};

const MATCH_COLS =
  'id, round, stage, table_no, p1, p2, best_of, wins1, wins2, result, next_first, room_id, match_id, reported_by, p1_in, p2_in';

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
  entered: [r.p1_in, r.p2_in],
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

/** Começa o torneio: grava a ordem sorteada, o número de rodadas e a primeira rodada (`at`: hora de início, ISO). */
export function startTournament(db: DB, id: string, seeds: string[], rounds: number, first: RoundSpec, at: string) {
  dataVersion.bump();
  transaction(db, () => {
    const seed = db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?');
    seeds.forEach((userId, i) => seed.run(i + 1, id, userId));
    db.prepare("UPDATE tournaments SET status = 'running', rounds = ?, started_at = ? WHERE id = ?").run(rounds, at, id);
    writeRound(db, id, first, at);
  });
}

/** Grava a rodada (byes já saem com resultado) e a torna a rodada atual (`at`: hora da rodada, ISO). */
export function insertRound(db: DB, id: string, spec: RoundSpec, at: string) {
  dataVersion.bump();
  transaction(db, () => writeRound(db, id, spec, at));
}

function writeRound(db: DB, id: string, { round, stage, bestOf, pairings }: RoundSpec, at: string) {
  const write = db.prepare(
    `INSERT INTO tournament_matches (tournament_id, round, stage, table_no, p1, p2, best_of, result, reported_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  pairings.forEach((p, i) => write.run(id, round, stage, i + 1, p.p1, p.p2, bestOf, p.p2 ? null : 'bye', p.p2 ? null : 'bye', at));
  db.prepare('UPDATE tournaments SET round = ?, round_at = ?, round_wo = 0 WHERE id = ?').run(round, at, id);
}

/** Marca que a varredura de ausentes da rodada atual foi feita. */
export function markRoundSwept(db: DB, id: string) {
  dataVersion.bump();
  db.prepare('UPDATE tournaments SET round_wo = 1 WHERE id = ?').run(id);
}

/** Jogador entrou na sala da série (a primeira vez conta). */
export function markEntered(db: DB, tournamentId: string, id: number, side: 'p1' | 'p2', at: string) {
  dataVersion.bump();
  const col = side === 'p1' ? 'p1_in' : 'p2_in';
  db.prepare(`UPDATE tournament_matches SET ${col} = COALESCE(${col}, ?) WHERE tournament_id = ? AND id = ?`).run(at, tournamentId, id);
}

/**
 * W.O. por ausência: quem não apareceu perde e sai do torneio. Com os dois ausentes,
 * a partida fica sem vencedor (`none`) e os dois saem.
 */
export function noShow(db: DB, tournamentId: string, m: TournamentMatch, absent: Array<'p1' | 'p2'>) {
  if (!absent.length || !m.p2) return;
  dataVersion.bump();
  const result: MatchResult = absent.length === 2 ? 'none' : absent[0] === 'p1' ? 'p2' : 'p1';
  const wins: [number, number] = result === 'p1' ? [winsNeeded(m.bestOf), 0] : result === 'p2' ? [0, winsNeeded(m.bestOf)] : [0, 0];
  transaction(db, () => {
    db.prepare(
      `UPDATE tournament_matches SET wins1 = ?, wins2 = ?, result = ?, reported_by = 'noshow', room_id = NULL, updated_at = datetime('now')
       WHERE tournament_id = ? AND id = ? AND result IS NULL`,
    ).run(wins[0], wins[1], result, tournamentId, m.id);
    const drop = db.prepare('UPDATE tournament_players SET dropped = 1 WHERE tournament_id = ? AND user_id = ?');
    for (const side of absent) drop.run(tournamentId, side === 'p1' ? m.p1 : m.p2);
  });
}

export function finishTournament(db: DB, id: string) {
  dataVersion.bump();
  db.prepare("UPDATE tournaments SET status = 'finished', finished_at = datetime('now') WHERE id = ?").run(id);
}

/** Resultado da série a partir do placar (null = ainda em andamento). */
export const seriesResult = (bestOf: number, wins: [number, number]): MatchResult | null =>
  wins[0] >= winsNeeded(bestOf) ? 'p1' : wins[1] >= winsNeeded(bestOf) ? 'p2' : null;

/** Placar lançado pelo organizador (0 x 0 apaga o resultado). */
export function setMatchScore(db: DB, tournamentId: string, id: number, bestOf: number, wins: [number, number], reportedBy: string) {
  dataVersion.bump();
  const result = seriesResult(bestOf, wins);
  db.prepare(
    `UPDATE tournament_matches SET wins1 = ?, wins2 = ?, result = ?, reported_by = ?, updated_at = datetime('now')
     WHERE tournament_id = ? AND id = ?`,
  ).run(wins[0], wins[1], result, wins[0] || wins[1] ? reportedBy : null, tournamentId, id);
}

/** Troca um jogador de uma partida ainda não jogada (correção de um resultado da rodada anterior da chave). */
export function replaceInMatch(db: DB, tournamentId: string, id: number, from: string, to: string) {
  dataVersion.bump();
  db.prepare(
    `UPDATE tournament_matches SET p1 = CASE WHEN p1 = ? THEN ? ELSE p1 END, p2 = CASE WHEN p2 = ? THEN ? ELSE p2 END,
       updated_at = datetime('now') WHERE tournament_id = ? AND id = ?`,
  ).run(from, to, from, to, tournamentId, id);
}

export function setMatchRoom(db: DB, tournamentId: string, id: number, roomId: string) {
  dataVersion.bump();
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
  dataVersion.bump();
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
