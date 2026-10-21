// SQL dos torneios: o torneio, os inscritos (com o deck congelado) e as partidas de cada rodada.

import { randomBytes } from 'node:crypto';
import type { DeckList } from '@gumgum/engine';
import { isAdmin, type User } from '../auth/store';
import { dataVersion } from '../cache';
import { type DB, transaction } from '../db';
import type { FormatId, PlayFormat } from '../stats/catalog';
import { type MatchResult, type Pairing, type Stage, type Structure, type TMatch, type TPlayer, winsNeeded } from './pairing';

export type TournamentStatus = 'registration' | 'running' | 'finished';

export interface Tournament {
  id: string;
  name: string;
  description: string;
  format: PlayFormat;
  /**
   * Aceita cartas de spoiler (ainda não lançadas), no Standard ou no EGB; o Livre sempre
   * aceita. Sem isso, como na ranqueada, só valem cartas lançadas.
   */
  spoilers: boolean;
  /**
   * Com spoilers (fora do Livre), a coleção aceita: a próxima a ser lançada, gravada no início
   * do torneio (antes disso, null: vale a próxima de agora; ver `tournamentSpoilerSet`).
   */
  spoilerSet: string | null;
  /**
   * Quem transmite (Streamer e Admin) pode ver as mãos dos dois jogadores ao vivo, sem o atraso
   * mínimo de 1 min. Decisão do organizador: sem isso, as mãos chegam sempre atrasadas.
   */
  liveHands: boolean;
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
   * Torneio com hora marcada: check-in 30 min antes e, em cada rodada iniciada, quem não
   * entra na sala em `toleranceMin` minutos perde por W.O. (ver clock.ts).
   */
  checkIn: boolean;
  /** Com check-in: começa sozinho em `startsAt` (para quando o organizador não está presente). */
  autoStart: boolean;
  /** Warnings que um jogador pode receber antes de o organizador decidir eliminá-lo (null = sem regra). */
  maxWarnings: number | null;
  /** Minutos para entrar na sala em cada rodada (W.O. depois disso). */
  toleranceMin: number;
  status: TournamentStatus;
  round: number;
  /** Quando a rodada atual foi gerada (os pareamentos aparecem; as salas ainda não abrem). */
  roundAt: string | null;
  /** Quando o organizador iniciou a rodada atual: as salas abrem e a tolerância do W.O. conta daqui (null = à espera). */
  roundStartedAt: string | null;
  /** A varredura de ausentes da rodada atual já foi feita. */
  roundSwept: boolean;
  /** Hora de início (`startsAt`) cujo aviso de check-in já saiu por notificação. */
  checkInNotice: string | null;
  organizerId: string;
  organizerName: string | null;
  /** Torneio do time (Torneio da Tripulação). */
  official: boolean;
  /** Prêmio anunciado (null = sem prêmio). */
  prize: string | null;
  /** Loja patrocinadora. */
  sponsorId: string | null;
  /** Até quando só Almirantes se inscrevem (null = sem inscrição antecipada). */
  priorityUntil: string | null;
  /** Criado pela cota de apoiador. */
  quota: boolean;
  /**
   * Inscrição atrasada liberada pelo organizador (só no suíço, durante a rodada 1):
   * '*' = qualquer um; senão, o id da conta liberada; null = fechada.
   */
  lateEntry: string | null;
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
  /** O organizador decidiu manter o jogador depois do limite de warnings (warnings dados antes disto já foram vistos). */
  warningsReviewedAt: string | null;
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
  /** "Estou pronto" de p1 e p2 (sinal para o organizador iniciar a rodada). */
  ready: [boolean, boolean];
}

export type TournamentInput = Pick<
  Tournament,
  | 'name'
  | 'description'
  | 'format'
  | 'spoilers'
  | 'liveHands'
  | 'structure'
  | 'rounds'
  | 'swissBestOf'
  | 'topCut'
  | 'bo3From'
  | 'bo5From'
  | 'maxPlayers'
  | 'startsAt'
  | 'checkIn'
  | 'autoStart'
  | 'maxWarnings'
  | 'toleranceMin'
  | 'official'
  | 'prize'
  | 'sponsorId'
  | 'priorityUntil'
>;

type TournamentRow = {
  id: string;
  name: string;
  description: string;
  format: PlayFormat;
  spoilers: number;
  spoiler_set: string | null;
  live_hands: number;
  structure: Structure;
  rounds: number | null;
  swiss_best_of: number;
  top_cut: number | null;
  bo3_from: number | null;
  bo5_from: number | null;
  max_players: number | null;
  starts_at: string | null;
  check_in: number;
  auto_start: number;
  max_warnings: number | null;
  tolerance_min: number;
  status: TournamentStatus;
  round: number;
  round_at: string | null;
  round_started_at: string | null;
  round_wo: number;
  checkin_notice: string | null;
  organizer_id: string;
  organizer_name: string | null;
  official: number;
  prize: string | null;
  sponsor_id: string | null;
  priority_until: string | null;
  quota: number;
  late_entry: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const toTournament = (r: TournamentRow): Tournament => ({
  id: r.id,
  name: r.name,
  description: r.description,
  format: r.format,
  spoilers: Boolean(r.spoilers),
  spoilerSet: r.spoiler_set ?? null,
  liveHands: Boolean(r.live_hands),
  structure: r.structure,
  rounds: r.rounds,
  swissBestOf: r.swiss_best_of,
  topCut: r.top_cut,
  bo3From: r.bo3_from,
  bo5From: r.bo5_from,
  maxPlayers: r.max_players,
  startsAt: r.starts_at,
  checkIn: Boolean(r.check_in),
  autoStart: Boolean(r.auto_start),
  maxWarnings: r.max_warnings ?? null,
  toleranceMin: r.tolerance_min,
  status: r.status,
  round: r.round,
  roundAt: r.round_at,
  roundStartedAt: r.round_started_at ?? null,
  roundSwept: Boolean(r.round_wo),
  checkInNotice: r.checkin_notice ?? null,
  organizerId: r.organizer_id,
  organizerName: r.organizer_name,
  official: Boolean(r.official),
  prize: r.prize,
  sponsorId: r.sponsor_id,
  priorityUntil: r.priority_until,
  quota: Boolean(r.quota),
  lateEntry: r.late_entry ?? null,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

// Nome do organizador: o público (perfil de estatísticas), nunca o da conta Google.
const TOURNAMENT_COLS = 't.*, p.name AS organizer_name';
const TOURNAMENT_FROM = `FROM tournaments t LEFT JOIN players p ON p.owner_hash = 'user:' || t.organizer_id`;

/**
 * `quota`: criado pela cota mensal de apoiador (`at` = quando, para contar o mês).
 */
export function createTournament(db: DB, input: TournamentInput, organizerId: string, quota: { at: string } | null = null): Tournament {
  dataVersion.bump();
  const id = `t-${randomBytes(5).toString('hex')}`;
  db.prepare(
    `INSERT INTO tournaments (id, name, description, format, structure, rounds, swiss_best_of, top_cut, bo3_from, bo5_from,
       max_players, starts_at, check_in, tolerance_min, official, prize, sponsor_id, priority_until, spoilers, auto_start, max_warnings,
       live_hands, organizer_id, quota)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, ...inputValues(input), organizerId, quota ? 1 : 0);
  if (quota) db.prepare('INSERT INTO tournament_quota (tournament_id, organizer_id, created_at) VALUES (?, ?, ?)').run(id, organizerId, quota.at);
  return getTournament(db, id)!;
}

/** Torneios criados pela cota de apoiador desde `since` (ISO). */
export function quotaUsed(db: DB, organizerId: string, since: string): number {
  return Number(
    (db.prepare('SELECT COUNT(*) AS n FROM tournament_quota WHERE organizer_id = ? AND created_at >= ?').get(organizerId, since) as { n: number }).n,
  );
}

/** Devolve a vaga da cota (torneio apagado antes de começar). */
export function releaseQuota(db: DB, tournamentId: string) {
  db.prepare('DELETE FROM tournament_quota WHERE tournament_id = ?').run(tournamentId);
}

export function updateTournament(db: DB, id: string, input: TournamentInput) {
  dataVersion.bump();
  db.prepare(
    `UPDATE tournaments SET name = ?, description = ?, format = ?, structure = ?, rounds = ?, swiss_best_of = ?, top_cut = ?,
       bo3_from = ?, bo5_from = ?, max_players = ?, starts_at = ?, check_in = ?, tolerance_min = ?,
       official = ?, prize = ?, sponsor_id = ?, priority_until = ?, spoilers = ?, auto_start = ?, max_warnings = ?,
       live_hands = ?
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
    i.toleranceMin,
    i.official ? 1 : 0,
    i.prize,
    i.sponsorId,
    i.priorityUntil,
    i.spoilers ? 1 : 0,
    i.autoStart ? 1 : 0,
    i.maxWarnings,
    i.liveHands ? 1 : 0,
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

/**
 * Torneios encerrados (painel do meta), do mais recente ao mais antigo. `since`: encerrados a partir desta data do SQLite.
 * Só Standard e EGB puros: o Livre e os torneios com spoilers ficam fora do meta, como das estatísticas.
 */
export function listFinished(db: DB, opts: { format?: FormatId; since?: string } = {}): Tournament[] {
  const rows = db
    .prepare(
      `SELECT ${TOURNAMENT_COLS} ${TOURNAMENT_FROM}
       WHERE t.status = 'finished' AND t.format IN ('standard', 'egb') AND t.spoilers = 0
         AND (? IS NULL OR t.format = ?) AND (? IS NULL OR t.finished_at >= ?)
       ORDER BY t.finished_at DESC, t.rowid DESC`,
    )
    .all(opts.format ?? null, opts.format ?? null, opts.since ?? null, opts.since ?? null) as TournamentRow[];
  return rows.map(toTournament);
}

/** Torneios em andamento e com inscrições abertas (painel do meta): os em andamento primeiro, depois pela hora marcada. */
export function listOpen(db: DB, opts: { format?: FormatId; limit: number }): Array<Tournament & { players: number }> {
  const rows = db
    .prepare(
      `SELECT ${TOURNAMENT_COLS}, (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS players
       ${TOURNAMENT_FROM}
       WHERE t.status <> 'finished' AND (? IS NULL OR t.format = ?)
       ORDER BY CASE t.status WHEN 'running' THEN 0 ELSE 1 END, t.starts_at IS NULL, t.starts_at, t.created_at
       LIMIT ?`,
    )
    .all(opts.format ?? null, opts.format ?? null, opts.limit) as Array<TournamentRow & { players: number }>;
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
  warnings_reviewed_at: string | null;
};

export function listPlayers(db: DB, tournamentId: string): TournamentPlayer[] {
  const rows = db
    .prepare(
      // O nome segue o perfil público (se a pessoa trocar de nome, a lista acompanha).
      `SELECT tp.user_id, COALESCE(p.name, tp.name) AS name, tp.deck_id, tp.deck, tp.seed, tp.dropped, tp.registered_at, tp.checked_in_at,
         tp.warnings_reviewed_at
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
    warningsReviewedAt: r.warnings_reviewed_at ?? null,
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

/** Conta (com perfil público) pelo apelido, sem diferenciar maiúsculas: todas as que usam o nome. */
export function accountsByName(db: DB, name: string): Array<{ userId: string; name: string }> {
  const rows = db
    .prepare("SELECT substr(owner_hash, 6) AS user_id, name FROM players WHERE owner_hash LIKE 'user:%' AND lower(name) = lower(?) LIMIT 5")
    .all(name.trim()) as Array<{ user_id: string; name: string }>;
  return rows.map((r) => ({ userId: r.user_id, name: r.name }));
}

/** Libera (`'*'` ou o id de uma conta) ou fecha (null) a inscrição atrasada. */
export function setLateEntry(db: DB, id: string, value: string | null) {
  dataVersion.bump();
  db.prepare('UPDATE tournaments SET late_entry = ? WHERE id = ?').run(value, id);
}

/**
 * Inscrição atrasada (suíço, durante a rodada 1): o jogador entra com a derrota da
 * rodada 1 (partida sem oponente, `loss`) e é o último na ordem sorteada. A liberação
 * para uma conta específica é usada uma vez.
 */
export function lateRegister(db: DB, t: Tournament, userId: string, name: string, deckId: string | null, deck: DeckList, at: string) {
  dataVersion.bump();
  transaction(db, () => {
    const { seed } = db.prepare('SELECT COALESCE(MAX(seed), 0) + 1 AS seed FROM tournament_players WHERE tournament_id = ?').get(t.id) as {
      seed: number;
    };
    db.prepare('INSERT INTO tournament_players (tournament_id, user_id, name, deck_id, deck, seed) VALUES (?, ?, ?, ?, ?, ?)').run(
      t.id,
      userId,
      name,
      deckId,
      JSON.stringify(deck),
      seed,
    );
    const { table } = db
      .prepare('SELECT COALESCE(MAX(table_no), 0) + 1 AS "table" FROM tournament_matches WHERE tournament_id = ? AND round = 1')
      .get(t.id) as { table: number };
    db.prepare(
      `INSERT INTO tournament_matches (tournament_id, round, stage, table_no, p1, p2, best_of, result, reported_by, updated_at)
       VALUES (?, 1, 'swiss', ?, ?, NULL, ?, 'loss', 'late', ?)`,
    ).run(t.id, table, userId, t.swissBestOf, at);
    if (t.lateEntry === userId) db.prepare('UPDATE tournaments SET late_entry = NULL WHERE id = ?').run(t.id);
  });
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

/**
 * Desfaz a desistência (ou a saída por W.O.): o jogador volta a ser pareado a partir da
 * próxima rodada. `restoreMatchId`: a partida da rodada atual que a saída decidiu volta
 * a ficar pendente (0 x 0), para ser jogada.
 */
export function reinstatePlayer(db: DB, tournamentId: string, userId: string, restoreMatchId: number | null) {
  dataVersion.bump();
  transaction(db, () => {
    db.prepare('UPDATE tournament_players SET dropped = 0 WHERE tournament_id = ? AND user_id = ?').run(tournamentId, userId);
    if (restoreMatchId !== null) {
      db.prepare(
        `UPDATE tournament_matches SET wins1 = 0, wins2 = 0, result = NULL, reported_by = NULL, room_id = NULL, next_first = NULL,
           updated_at = datetime('now') WHERE tournament_id = ? AND id = ?`,
      ).run(tournamentId, restoreMatchId);
    }
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
  p1_ready: number;
  p2_ready: number;
};

const MATCH_COLS =
  'id, round, stage, table_no, p1, p2, best_of, wins1, wins2, result, next_first, room_id, match_id, reported_by, p1_in, p2_in, p1_ready, p2_ready';

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
  ready: [Boolean(r.p1_ready), Boolean(r.p2_ready)],
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

/**
 * Começa o torneio: grava a ordem sorteada, o número de rodadas, a coleção de spoiler aceita
 * (`spoilerSet`) e a primeira rodada (`at`: hora de início, ISO).
 */
export function startTournament(db: DB, id: string, seeds: string[], rounds: number, first: RoundSpec, at: string, spoilerSet: string | null = null) {
  dataVersion.bump();
  transaction(db, () => {
    const seed = db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?');
    seeds.forEach((userId, i) => seed.run(i + 1, id, userId));
    db.prepare("UPDATE tournaments SET status = 'running', rounds = ?, started_at = ?, spoiler_set = ? WHERE id = ?").run(rounds, at, spoilerSet, id);
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
  db.prepare('UPDATE tournaments SET round = ?, round_at = ?, round_started_at = NULL, round_wo = 0 WHERE id = ?').run(round, at, id);
}

/** O organizador iniciou a rodada atual: as salas abrem e a tolerância do W.O. conta de `at`. */
export function startRound(db: DB, id: string, at: string) {
  dataVersion.bump();
  db.prepare('UPDATE tournaments SET round_started_at = ? WHERE id = ? AND round_started_at IS NULL').run(at, id);
}

/** "Estou pronto" de um lado da partida (sinal para o organizador; zera a cada rodada, porque cada rodada tem partidas novas). */
export function setReady(db: DB, tournamentId: string, id: number, side: 'p1' | 'p2', ready: boolean) {
  dataVersion.bump();
  const col = side === 'p1' ? 'p1_ready' : 'p2_ready';
  db.prepare(`UPDATE tournament_matches SET ${col} = ? WHERE tournament_id = ? AND id = ?`).run(ready ? 1 : 0, tournamentId, id);
}

/** Marca que o aviso de check-in para a hora de início `startsAt` já foi enviado. */
export function markCheckInNotice(db: DB, id: string, startsAt: string) {
  db.prepare('UPDATE tournaments SET checkin_notice = ? WHERE id = ?').run(startsAt, id);
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

/** Derrota dupla lançada pelo organizador: os dois perdem (0 x 0) e a sala da série é liberada. */
export function setDoubleLoss(db: DB, tournamentId: string, id: number, reportedBy: string) {
  dataVersion.bump();
  db.prepare(
    `UPDATE tournament_matches SET wins1 = 0, wins2 = 0, result = 'none', reported_by = ?, room_id = NULL, updated_at = datetime('now')
     WHERE tournament_id = ? AND id = ?`,
  ).run(reportedBy, tournamentId, id);
}

/**
 * Tira um jogador de uma partida da chave ainda não jogada (a partida anterior virou
 * derrota dupla): quem sobra fica de bye.
 */
export function vacateInMatch(db: DB, tournamentId: string, id: number, userId: string) {
  dataVersion.bump();
  db.prepare(
    `UPDATE tournament_matches SET p1 = CASE WHEN p1 = ? THEN p2 ELSE p1 END, p2 = NULL, wins1 = 0, wins2 = 0, result = 'bye',
       reported_by = 'bye', room_id = NULL, next_first = NULL, updated_at = datetime('now')
     WHERE tournament_id = ? AND id = ? AND p2 IS NOT NULL AND (p1 = ? OR p2 = ?)`,
  ).run(userId, tournamentId, id, userId, userId);
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

// ------------------------------------------------------------------ jogos (auditoria)

export interface TournamentGame {
  id: number;
  matchId: number;
  game: number;
  statsMatchId: number | null;
  roomId: string | null;
  winner: string | null;
  counted: boolean;
  playedAt: string;
}

type GameRow = {
  id: number;
  match_id: number;
  game: number;
  stats_match_id: number | null;
  room_id: string | null;
  winner: string | null;
  counted: number;
  played_at: string;
};

/** Todos os jogos disputados nas salas do torneio (inclusive os que não contaram no placar). */
export function listGames(db: DB, tournamentId: string): TournamentGame[] {
  return (
    db
      .prepare(
        `SELECT id, match_id, game, stats_match_id, room_id, winner, counted, played_at FROM tournament_games
         WHERE tournament_id = ? ORDER BY match_id, played_at, id`,
      )
      .all(tournamentId) as GameRow[]
  ).map((r) => ({
    id: r.id,
    matchId: r.match_id,
    game: r.game,
    statsMatchId: r.stats_match_id,
    roomId: r.room_id,
    winner: r.winner,
    counted: Boolean(r.counted),
    playedAt: r.played_at,
  }));
}

/** Torneio (e partida) de uma partida gravada nas estatísticas, se foi um jogo de torneio. */
export function tournamentOfStatsMatch(db: DB, statsMatchId: number): { tournamentId: string; matchId: number; game: number } | null {
  const r = db.prepare('SELECT tournament_id, match_id, game FROM tournament_games WHERE stats_match_id = ?').get(statsMatchId) as
    | { tournament_id: string; match_id: number; game: number }
    | undefined;
  return r ? { tournamentId: r.tournament_id, matchId: r.match_id, game: r.game } : null;
}

/**
 * Fim de um jogo online da série: grava o jogo (para a auditoria) e soma a vitória no
 * placar; se alguém chegou à maioria, fecha a série. Um jogo de uma sala que não é a
 * atual da partida (o organizador já lançou outro placar, por exemplo) fica gravado
 * mas não conta. Quem perdeu começa o próximo jogo. Jogo sem vencedor não conta: a
 * série segue com um jogo novo.
 */
export function reportFromGame(
  db: DB,
  game: { tournamentId: string; matchId: number; roomId: string; winner: string | null; statsMatchId: number | null },
) {
  dataVersion.bump();
  const t = getTournament(db, game.tournamentId);
  const m = t && getMatch(db, t.id, game.matchId);
  if (!t || !m) return;
  const counted = t.status === 'running' && m.roomId === game.roomId && !m.result;
  db.prepare(
    `INSERT INTO tournament_games (tournament_id, match_id, game, stats_match_id, room_id, winner, counted, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(t.id, m.id, m.wins[0] + m.wins[1] + 1, game.statsMatchId, game.roomId, game.winner, counted ? 1 : 0);
  if (t.status !== 'running' || m.roomId !== game.roomId) return;
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

// ------------------------------------------------------------------ Judges

export interface TournamentJudge {
  userId: string;
  name: string;
  addedAt: string;
}

export function listJudges(db: DB, tournamentId: string): TournamentJudge[] {
  const rows = db
    .prepare(
      `SELECT j.user_id, COALESCE(p.name, '?') AS name, j.added_at FROM tournament_judges j
       LEFT JOIN players p ON p.owner_hash = 'user:' || j.user_id WHERE j.tournament_id = ? ORDER BY j.added_at, j.user_id`,
    )
    .all(tournamentId) as Array<{ user_id: string; name: string; added_at: string }>;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, addedAt: r.added_at }));
}

export function addJudge(db: DB, tournamentId: string, userId: string, addedBy: string, at: string) {
  dataVersion.bump();
  db.prepare('INSERT OR IGNORE INTO tournament_judges (tournament_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)').run(
    tournamentId,
    userId,
    addedBy,
    at,
  );
}

export function removeJudge(db: DB, tournamentId: string, userId: string): boolean {
  dataVersion.bump();
  return Number(db.prepare('DELETE FROM tournament_judges WHERE tournament_id = ? AND user_id = ?').run(tournamentId, userId).changes) > 0;
}

/** A conta é Judge deste torneio (está na lista do organizador). */
export function isListedJudge(db: DB, tournamentId: string, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM tournament_judges WHERE tournament_id = ? AND user_id = ?').get(tournamentId, userId));
}

/**
 * Quem faz o papel de Judge num torneio: os Judges da lista, o organizador (com ou sem
 * lista: sem nenhum Judge escolhido, ele é o Judge) e quem administra o site.
 */
export function actsAsJudge(db: DB, t: Pick<Tournament, 'id' | 'organizerId'>, user: Pick<User, 'id' | 'role'> | null | undefined): boolean {
  if (!user) return false;
  if (isAdmin(user.role) || user.id === t.organizerId) return true;
  return isListedJudge(db, t.id, user.id);
}

// ------------------------------------------------------------------ chamados de Judge

export interface TournamentCall {
  id: number;
  matchId: number;
  roomId: string | null;
  game: number;
  openedBy: string;
  openedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  note: string | null;
}

type CallRow = {
  id: number;
  match_id: number;
  room_id: string | null;
  game: number;
  opened_by: string;
  opened_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  note: string | null;
};

const toCall = (r: CallRow): TournamentCall => ({
  id: r.id,
  matchId: r.match_id,
  roomId: r.room_id,
  game: r.game,
  openedBy: r.opened_by,
  openedAt: r.opened_at,
  resolvedBy: r.resolved_by,
  resolvedAt: r.resolved_at,
  note: r.note,
});

const CALL_COLS = 'id, match_id, room_id, game, opened_by, opened_at, resolved_by, resolved_at, note';

export function listCalls(db: DB, tournamentId: string): TournamentCall[] {
  return (db.prepare(`SELECT ${CALL_COLS} FROM tournament_calls WHERE tournament_id = ? ORDER BY opened_at DESC, id DESC`).all(tournamentId) as CallRow[]).map(
    toCall,
  );
}

/** Chamado ainda aberto da partida (a sala está pausada à espera do Judge). */
export function openCall(db: DB, tournamentId: string, matchId: number): TournamentCall | null {
  const r = db
    .prepare(`SELECT ${CALL_COLS} FROM tournament_calls WHERE tournament_id = ? AND match_id = ? AND resolved_at IS NULL ORDER BY id DESC`)
    .get(tournamentId, matchId) as CallRow | undefined;
  return r ? toCall(r) : null;
}

export function createCall(db: DB, tournamentId: string, c: { matchId: number; roomId: string | null; game: number; openedBy: string; at: string }): TournamentCall {
  dataVersion.bump();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO tournament_calls (tournament_id, match_id, room_id, game, opened_by, opened_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tournamentId, c.matchId, c.roomId, c.game, c.openedBy, c.at);
  return toCall(db.prepare(`SELECT ${CALL_COLS} FROM tournament_calls WHERE id = ?`).get(Number(lastInsertRowid)) as CallRow);
}

/** Fecha os chamados abertos da partida (a sala voltou a correr), com o relato do Judge. */
export function resolveCalls(db: DB, tournamentId: string, matchId: number, by: string, at: string, note: string | null) {
  dataVersion.bump();
  db.prepare(
    'UPDATE tournament_calls SET resolved_by = ?, resolved_at = ?, note = ? WHERE tournament_id = ? AND match_id = ? AND resolved_at IS NULL',
  ).run(by, at, note, tournamentId, matchId);
}

// ------------------------------------------------------------------ modo manual do Judge (auditoria)

export type InterventionKind = 'manual_on' | 'manual_off' | 'undo' | 'judge_action';
/** Papel de quem interveio naquele momento (o Judge da lista perde o modo manual quando o torneio termina). */
export type InterventionRole = 'admin' | 'dev' | 'organizer' | 'judge';

export interface TournamentIntervention {
  id: number;
  matchId: number;
  roomId: string | null;
  game: number;
  userId: string;
  role: InterventionRole;
  kind: InterventionKind;
  /** A correção (ação do motor) ou `{ to }` no desfazer. */
  payload: unknown;
  /** As ações desfeitas. */
  removed: unknown[] | null;
  note: string | null;
  at: string;
}

type InterventionRow = {
  id: number;
  match_id: number;
  room_id: string | null;
  game: number;
  user_id: string;
  role: InterventionRole;
  kind: InterventionKind;
  payload: string | null;
  removed: string | null;
  note: string | null;
  at: string;
};

const INTERVENTION_COLS = 'id, match_id, room_id, game, user_id, role, kind, payload, removed, note, at';

const toIntervention = (r: InterventionRow): TournamentIntervention => ({
  id: r.id,
  matchId: r.match_id,
  roomId: r.room_id,
  game: r.game,
  userId: r.user_id,
  role: r.role,
  kind: r.kind,
  payload: r.payload ? JSON.parse(r.payload) : null,
  removed: r.removed ? (JSON.parse(r.removed) as unknown[]) : null,
  note: r.note,
  at: r.at,
});

/** Intervenções do torneio, as mais recentes primeiro. */
export function listInterventions(db: DB, tournamentId: string): TournamentIntervention[] {
  return (
    db.prepare(`SELECT ${INTERVENTION_COLS} FROM tournament_interventions WHERE tournament_id = ? ORDER BY at DESC, id DESC`).all(tournamentId) as InterventionRow[]
  ).map(toIntervention);
}

export function addIntervention(
  db: DB,
  tournamentId: string,
  i: { matchId: number; roomId: string | null; game: number; userId: string; role: InterventionRole; kind: InterventionKind; payload?: unknown; removed?: unknown[]; note: string | null; at: string },
): TournamentIntervention {
  dataVersion.bump();
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO tournament_interventions (tournament_id, match_id, room_id, game, user_id, role, kind, payload, removed, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      tournamentId,
      i.matchId,
      i.roomId,
      i.game,
      i.userId,
      i.role,
      i.kind,
      i.payload === undefined ? null : JSON.stringify(i.payload),
      i.removed ? JSON.stringify(i.removed) : null,
      i.note,
      i.at,
    );
  return toIntervention(db.prepare(`SELECT ${INTERVENTION_COLS} FROM tournament_interventions WHERE id = ?`).get(Number(lastInsertRowid)) as InterventionRow);
}

// ------------------------------------------------------------------ warnings

export interface TournamentWarning {
  id: number;
  userId: string;
  givenBy: string;
  givenAt: string;
  round: number;
  matchId: number | null;
  callId: number | null;
  reason: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

type WarningRow = {
  id: number;
  user_id: string;
  given_by: string;
  given_at: string;
  round: number;
  match_id: number | null;
  call_id: number | null;
  reason: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

const toWarning = (r: WarningRow): TournamentWarning => ({
  id: r.id,
  userId: r.user_id,
  givenBy: r.given_by,
  givenAt: r.given_at,
  round: r.round,
  matchId: r.match_id,
  callId: r.call_id,
  reason: r.reason,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by,
});

const WARNING_COLS = 'id, user_id, given_by, given_at, round, match_id, call_id, reason, revoked_at, revoked_by';

export function listWarnings(db: DB, tournamentId: string): TournamentWarning[] {
  return (db.prepare(`SELECT ${WARNING_COLS} FROM tournament_warnings WHERE tournament_id = ? ORDER BY given_at, id`).all(tournamentId) as WarningRow[]).map(
    toWarning,
  );
}

export function addWarning(
  db: DB,
  tournamentId: string,
  w: { userId: string; givenBy: string; at: string; round: number; matchId: number | null; callId: number | null; reason: string },
): TournamentWarning {
  dataVersion.bump();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO tournament_warnings (tournament_id, user_id, given_by, given_at, round, match_id, call_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(tournamentId, w.userId, w.givenBy, w.at, w.round, w.matchId, w.callId, w.reason);
  return toWarning(db.prepare(`SELECT ${WARNING_COLS} FROM tournament_warnings WHERE id = ?`).get(Number(lastInsertRowid)) as WarningRow);
}

/** O organizador anula um warning (ele continua no histórico, sem contar). */
export function revokeWarning(db: DB, tournamentId: string, id: number, by: string, at: string): boolean {
  dataVersion.bump();
  return (
    Number(
      db.prepare('UPDATE tournament_warnings SET revoked_at = ?, revoked_by = ? WHERE tournament_id = ? AND id = ? AND revoked_at IS NULL').run(at, by, tournamentId, id)
        .changes,
    ) > 0
  );
}

/** O organizador viu os warnings do jogador e decidiu mantê-lo (a decisão pendente some até o próximo warning). */
export function reviewWarnings(db: DB, tournamentId: string, userId: string, at: string) {
  dataVersion.bump();
  db.prepare('UPDATE tournament_players SET warnings_reviewed_at = ? WHERE tournament_id = ? AND user_id = ?').run(at, tournamentId, userId);
}

/** Situação dos warnings de um jogador: quantos valem e se o organizador precisa decidir (limite atingido sem decisão). */
export function warningStatus(
  t: Pick<Tournament, 'maxWarnings'>,
  p: Pick<TournamentPlayer, 'dropped' | 'warningsReviewedAt'>,
  warnings: TournamentWarning[],
): { count: number; limitReached: boolean; pending: boolean } {
  const active = warnings.filter((w) => !w.revokedAt);
  const limitReached = t.maxWarnings !== null && active.length >= t.maxWarnings;
  const last = active[active.length - 1];
  const pending = limitReached && !p.dropped && Boolean(last) && (!p.warningsReviewedAt || last.givenAt > p.warningsReviewedAt);
  return { count: active.length, limitReached, pending };
}
