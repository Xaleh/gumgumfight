// SQL das estatísticas: jogadores, gravação das partidas e consultas agregadas.

import { randomBytes } from 'node:crypto';
import type { DeckList, PlayerId } from '@gumgum/engine';
import { type DB, transaction } from '../db';
import { bountyDelta, type Controller, type FormatId, type QueueId, START_BOUNTY, tierFor } from './catalog';
import type { MatchFacts, ReplayInput } from './derive';

// ------------------------------------------------------------------ jogadores

export interface Player {
  id: string;
  name: string;
  bounty: number;
  rankedGames: number;
}

type PlayerRow = { id: string; name: string; bounty: number; ranked_games: number };
const toPlayer = (r: PlayerRow): Player => ({ id: r.id, name: r.name, bounty: r.bounty, rankedGames: r.ranked_games });

export function findPlayer(db: DB, ownerHash: string): Player | null {
  const r = db.prepare('SELECT id, name, bounty, ranked_games FROM players WHERE owner_hash = ?').get(ownerHash) as
    | PlayerRow
    | undefined;
  return r ? toPlayer(r) : null;
}

/** Perfil do navegador, criado na primeira partida (ou ao trocar o nome). */
export function ensurePlayer(db: DB, ownerHash: string): Player {
  const found = findPlayer(db, ownerHash);
  if (found) return found;
  const id = `p-${randomBytes(6).toString('hex')}`;
  const name = `Pirata ${id.slice(2, 6).toUpperCase()}`;
  db.prepare('INSERT INTO players (id, owner_hash, name, bounty) VALUES (?, ?, ?, ?)').run(id, ownerHash, name, START_BOUNTY);
  return findPlayer(db, ownerHash)!;
}

export function renamePlayer(db: DB, ownerHash: string, name: string): Player {
  const p = ensurePlayer(db, ownerHash);
  db.prepare("UPDATE players SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, p.id);
  return { ...p, name };
}

// ------------------------------------------------------------------ gravação

export interface SeatInput {
  controller: Controller;
  /** Hash do código de dono; obrigatório para lados humanos. */
  ownerHash: string | null;
  deckId: string | null;
}

export interface MatchInput {
  mode: string;
  format: FormatId;
  queue: QueueId;
  replay: ReplayInput;
  seats: [SeatInput, SeatInput];
}

/**
 * Grava uma partida já verificada (fatos tirados da simulação). Na ranqueada
 * entre dois jogadores, atualiza as recompensas. O tier gravado é o de antes da
 * partida, para os filtros refletirem o nível em que ela foi jogada.
 */
export function recordMatch(db: DB, m: MatchInput, facts: MatchFacts): number {
  return transaction(db, () => {
    const { replay } = m;
    const matchId = Number(
      db
        .prepare(
          `INSERT INTO matches (seed, mode, deck0, deck1, winner, turns, reason, format, queue, first_player, replay)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          replay.seed,
          m.mode,
          m.seats[0].deckId ?? facts.seats[0].deckHash,
          m.seats[1].deckId ?? facts.seats[1].deckHash,
          facts.winner,
          facts.turns,
          facts.reason,
          m.format,
          m.queue,
          facts.firstPlayer,
          JSON.stringify(replay),
        ).lastInsertRowid,
    );
    const playedAt = (db.prepare('SELECT created_at FROM matches WHERE id = ?').get(matchId) as { created_at: string }).created_at;

    const players = m.seats.map((s) => (s.controller === 'human' && s.ownerHash ? ensurePlayer(db, s.ownerHash) : null));
    const rated = m.queue === 'ranked' && players[0] && players[1] && players[0].id !== players[1].id;
    const after = ([0, 1] as const).map((p) => {
      const me = players[p];
      if (!me) return null;
      if (!rated) return me.bounty;
      const them = players[(1 - p) as PlayerId]!;
      return me.bounty + bountyDelta(me.bounty, them.bounty, facts.winner === p);
    });

    const saveList = db.prepare('INSERT OR IGNORE INTO deck_lists (hash, leader, cards) VALUES (?, ?, ?)');
    const saveSeat = db.prepare(`
      INSERT INTO match_seats (match_id, seat, controller, player_id, deck_id, deck_hash, leader, opp_leader,
        opp_controller, tier, bounty_before, bounty_after, went_first, won, mulligan, format, queue, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const saveCard = db.prepare(
      'INSERT INTO match_cards (match_id, seat, card_id, copies, opening, drawn, played) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const updatePlayer = db.prepare(
      "UPDATE players SET bounty = ?, ranked_games = ranked_games + 1, updated_at = datetime('now') WHERE id = ?",
    );

    for (const p of [0, 1] as const) {
      const f = facts.seats[p];
      const o = facts.seats[(1 - p) as PlayerId];
      const deck: DeckList = replay.decks[p];
      saveList.run(f.deckHash, deck.leader, JSON.stringify(deck.cards));
      const player = players[p];
      saveSeat.run(
        matchId,
        p,
        m.seats[p].controller,
        player?.id ?? null,
        m.seats[p].deckId,
        f.deckHash,
        f.leader,
        o.leader,
        m.seats[(1 - p) as PlayerId].controller,
        player ? tierFor(player.bounty).id : null,
        player?.bounty ?? null,
        after[p],
        f.wentFirst ? 1 : 0,
        f.won ? 1 : 0,
        f.mulligan ? 1 : 0,
        m.format,
        m.queue,
        playedAt,
      );
      for (const [cardId, c] of f.cards) {
        if (c.copies > 0) saveCard.run(matchId, p, cardId, c.copies, c.opening, c.drawn, c.played);
      }
      if (rated && player) updatePlayer.run(after[p], player.id);
    }
    return matchId;
  });
}

// ------------------------------------------------------------------ consultas

export interface StatsFilter {
  format?: FormatId;
  queue?: QueueId;
  /** Quem jogou do lado analisado (padrão: pessoas). */
  by: Controller;
  /** Contra quem. */
  opponent?: Controller;
  /** Tiers do lado analisado no momento da partida. */
  tiers?: string[];
  leader?: string;
  oppLeader?: string;
  /** Começou jogando (true) ou como segundo (false). */
  first?: boolean;
  /** Últimos N dias. */
  days?: number;
  /** Só as partidas deste jogador. */
  playerId?: string;
  /** Uma lista exata. */
  deckHash?: string;
}

type Param = string | number;

/** WHERE sobre match_seats (alias s). */
function where(f: StatsFilter): { sql: string; params: Param[] } {
  const parts: string[] = ['s.controller = ?'];
  const params: Param[] = [f.by];
  const eq = (col: string, v: Param | undefined) => {
    if (v === undefined) return;
    parts.push(`${col} = ?`);
    params.push(v);
  };
  eq('s.format', f.format);
  eq('s.queue', f.queue);
  eq('s.opp_controller', f.opponent);
  eq('s.leader', f.leader);
  eq('s.opp_leader', f.oppLeader);
  eq('s.player_id', f.playerId);
  eq('s.deck_hash', f.deckHash);
  if (f.first !== undefined) eq('s.went_first', f.first ? 1 : 0);
  if (f.tiers?.length) {
    parts.push(`s.tier IN (${f.tiers.map(() => '?').join(',')})`);
    params.push(...f.tiers);
  }
  if (f.days) {
    parts.push("s.played_at >= datetime('now', ?)");
    params.push(`-${Math.floor(f.days)} days`);
  }
  return { sql: parts.join(' AND '), params };
}

export interface WinRow {
  games: number;
  wins: number;
}

export function summary(db: DB, f: StatsFilter) {
  const w = where(f);
  const r = db
    .prepare(
      `SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins,
              COALESCE(SUM(went_first), 0) AS firstGames, COALESCE(SUM(went_first * won), 0) AS firstWins,
              COALESCE(SUM(mulligan), 0) AS mulligans, COALESCE(SUM(mulligan * won), 0) AS mulliganWins,
              COUNT(DISTINCT match_id) AS matches, COUNT(DISTINCT player_id) AS players
       FROM match_seats s WHERE ${w.sql}`,
    )
    .get(...w.params) as Record<string, number>;
  return {
    games: r.games,
    wins: r.wins,
    matches: r.matches,
    players: r.players,
    first: { games: r.firstGames, wins: r.firstWins },
    second: { games: r.games - r.firstGames, wins: r.wins - r.firstWins },
    mulligan: { games: r.mulligans, wins: r.mulliganWins },
    keep: { games: r.games - r.mulligans, wins: r.wins - r.mulliganWins },
  };
}

/** Desempenho por Líder (uso, vitórias, e como primeiro/segundo). */
export function leaderStats(db: DB, f: StatsFilter) {
  const w = where(f);
  return db
    .prepare(
      `SELECT leader, COUNT(*) AS games, SUM(won) AS wins,
              SUM(went_first) AS firstGames, SUM(went_first * won) AS firstWins,
              COUNT(DISTINCT deck_hash) AS lists
       FROM match_seats s WHERE ${w.sql}
       GROUP BY leader ORDER BY games DESC, leader`,
    )
    .all(...w.params) as unknown as Array<{ leader: string; lists: number; firstGames: number; firstWins: number } & WinRow>;
}

/** Resultados Líder x Líder adversário. */
export function matchupStats(db: DB, f: StatsFilter) {
  const w = where(f);
  return db
    .prepare(
      `SELECT leader, opp_leader AS oppLeader, COUNT(*) AS games, SUM(won) AS wins,
              SUM(went_first) AS firstGames, SUM(went_first * won) AS firstWins
       FROM match_seats s WHERE ${w.sql}
       GROUP BY leader, opp_leader ORDER BY games DESC`,
    )
    .all(...w.params) as unknown as Array<{ leader: string; oppLeader: string; firstGames: number; firstWins: number } & WinRow>;
}

/** Semana (começando na segunda) de uma data do SQLite. */
const WEEK = "date(s.played_at, '-6 days', 'weekday 1')";

/**
 * Uso e vitórias por Líder em cada uma das últimas `weeks` semanas (a atual
 * incluída), para ver quem sobe e quem cai no meta. Ignora o filtro de dias.
 */
export function trendStats(db: DB, f: StatsFilter, weeks: number) {
  const w = where({ ...f, days: undefined });
  const since = `-${(weeks - 1) * 7} days`;
  const rows = db
    .prepare(
      `SELECT ${WEEK} AS week, leader, COUNT(*) AS games, SUM(won) AS wins
       FROM match_seats s
       WHERE ${w.sql} AND s.played_at >= date('now', '-6 days', 'weekday 1', ?)
       GROUP BY week, leader ORDER BY week, games DESC`,
    )
    .all(...w.params, since) as unknown as Array<{ week: string; leader: string } & WinRow>;
  const start = (db.prepare("SELECT date('now', '-6 days', 'weekday 1', ?) AS d").get(since) as { d: string }).d;
  const list: string[] = [];
  for (let i = 0; i < weeks; i++) {
    list.push((db.prepare('SELECT date(?, ?) AS d').get(start, `+${i * 7} days`) as { d: string }).d);
  }
  return { weeks: list, rows };
}

export interface CardStatRow {
  cardId: string;
  /** Partidas com a carta no deck. */
  games: number;
  wins: number;
  avgCopies: number;
  /** Na mão mantida após o mulligan. */
  openingGames: number;
  openingWins: number;
  /** Passou pela mão em algum momento. */
  drawnGames: number;
  drawnWins: number;
  /** No deck, mas nunca chegou à mão. */
  notDrawnGames: number;
  notDrawnWins: number;
  /** Jogada ao menos uma vez. */
  playedGames: number;
  playedWins: number;
  timesPlayed: number;
}

/** Desempenho de cada carta dos decks que entram no filtro (normalmente um Líder). */
export function cardStats(db: DB, f: StatsFilter): CardStatRow[] {
  const w = where(f);
  return db
    .prepare(
      `SELECT c.card_id AS cardId, COUNT(*) AS games, SUM(s.won) AS wins, AVG(c.copies) AS avgCopies,
              SUM(c.opening > 0) AS openingGames, SUM((c.opening > 0) * s.won) AS openingWins,
              SUM(c.drawn > 0) AS drawnGames, SUM((c.drawn > 0) * s.won) AS drawnWins,
              SUM(c.drawn = 0) AS notDrawnGames, SUM((c.drawn = 0) * s.won) AS notDrawnWins,
              SUM(c.played > 0) AS playedGames, SUM((c.played > 0) * s.won) AS playedWins,
              SUM(c.played) AS timesPlayed
       FROM match_seats s JOIN match_cards c ON c.match_id = s.match_id AND c.seat = s.seat
       WHERE ${w.sql}
       GROUP BY c.card_id ORDER BY games DESC, c.card_id`,
    )
    .all(...w.params) as unknown as CardStatRow[];
}

/** Líderes e listas presentes nas partidas (opções dos filtros). */
export function statsDimensions(db: DB) {
  const leaders = db
    .prepare('SELECT leader, COUNT(*) AS games FROM match_seats GROUP BY leader ORDER BY games DESC')
    .all() as unknown as Array<{ leader: string; games: number }>;
  return { leaders };
}

export function myDecks(db: DB, playerId: string) {
  return db
    .prepare(
      `SELECT s.deck_hash AS hash, s.leader, MAX(s.deck_id) AS deckId, COUNT(*) AS games, SUM(s.won) AS wins,
              MAX(s.played_at) AS lastPlayed
       FROM match_seats s WHERE s.player_id = ? GROUP BY s.deck_hash, s.leader ORDER BY lastPlayed DESC LIMIT 50`,
    )
    .all(playerId) as unknown as Array<{ hash: string; leader: string; deckId: string | null; lastPlayed: string } & WinRow>;
}

/** Recompensa antes e depois de cada lado de uma partida gravada. */
export function matchBounties(db: DB, matchId: number): Array<{ before: number | null; after: number | null }> {
  const rows = db
    .prepare('SELECT seat, bounty_before, bounty_after FROM match_seats WHERE match_id = ? ORDER BY seat')
    .all(matchId) as Array<{ seat: number; bounty_before: number | null; bounty_after: number | null }>;
  return rows.map((r) => ({ before: r.bounty_before, after: r.bounty_after }));
}
