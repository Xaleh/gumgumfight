// Partidas de uma conta para apps parceiros: a lista paginada (`GET /api/players/me/matches`)
// e as cartas de cada lado de uma partida (usadas no resumo de `GET /api/matches/:id`).
// Tudo já está calculado em match_seats/match_cards na gravação (stats/derive.ts): aqui só se lê.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { accountOwnerKey, type User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import { findPlayer } from '../stats/store';
import { isoToSqlite, sqliteToIso } from './store';

export const MATCHES_PAGE = 50;
export const MATCHES_PAGE_MAX = 100;

export interface PlayerMatch {
  id: number;
  playedAt: string;
  mode: string;
  queue: string;
  format: string;
  seat: number;
  won: boolean;
  wentFirst: boolean;
  mulligan: boolean;
  turns: number | null;
  leader: string;
  oppLeader: string;
  oppController: 'human' | 'bot';
  deckId: string | null;
  deckHash: string;
  tier: string | null;
  bountyBefore: number | null;
  bountyAfter: number | null;
  tournamentId: string | null;
}

type Row = {
  match_id: number;
  played_at: string;
  mode: string;
  queue: string;
  format: string;
  seat: number;
  won: number;
  went_first: number;
  mulligan: number;
  turns: number | null;
  leader: string;
  opp_leader: string;
  opp_controller: 'human' | 'bot';
  deck_id: string | null;
  deck_hash: string;
  tier: string | null;
  bounty_before: number | null;
  bounty_after: number | null;
  tournament_id: string | null;
};

/**
 * Partidas de um jogador, mais novas primeiro. `since`: só a partir desta data (SQLite);
 * `cursor`: só partidas com id menor (o último item da página anterior).
 */
export function playerMatches(db: DB, playerId: string, opts: { since?: string | null; cursor?: number | null; limit: number }): PlayerMatch[] {
  const parts = ['s.player_id = ?'];
  const params: Array<string | number> = [playerId];
  if (opts.since) {
    parts.push('s.played_at >= ?');
    params.push(opts.since);
  }
  if (opts.cursor) {
    parts.push('s.match_id < ?');
    params.push(opts.cursor);
  }
  const rows = db
    .prepare(
      `SELECT s.match_id, s.played_at, m.mode, s.queue, s.format, s.seat, s.won, s.went_first, s.mulligan, m.turns,
              s.leader, s.opp_leader, s.opp_controller, s.deck_id, s.deck_hash, s.tier, s.bounty_before, s.bounty_after,
              (SELECT g.tournament_id FROM tournament_games g WHERE g.stats_match_id = s.match_id LIMIT 1) AS tournament_id
       FROM match_seats s JOIN matches m ON m.id = s.match_id
       WHERE ${parts.join(' AND ')} ORDER BY s.match_id DESC LIMIT ?`,
    )
    .all(...params, opts.limit) as Row[];
  return rows.map((r) => ({
    id: r.match_id,
    playedAt: sqliteToIso(r.played_at),
    mode: r.mode,
    queue: r.queue,
    format: r.format,
    seat: r.seat,
    won: Boolean(r.won),
    wentFirst: Boolean(r.went_first),
    mulligan: Boolean(r.mulligan),
    turns: r.turns,
    leader: r.leader,
    oppLeader: r.opp_leader,
    oppController: r.opp_controller,
    deckId: r.deck_id,
    deckHash: r.deck_hash,
    tier: r.tier,
    bountyBefore: r.bounty_before,
    bountyAfter: r.bounty_after,
    tournamentId: r.tournament_id,
  }));
}

export interface SeatCard {
  id: string;
  copies: number;
  opening: number;
  drawn: number;
  played: number;
}

/** As cartas de um lado da partida (cópias no deck, na mão inicial, compradas e jogadas). */
export function seatCards(db: DB, matchId: number, seat: number): SeatCard[] {
  return (
    db
      .prepare('SELECT card_id AS id, copies, opening, drawn, played FROM match_cards WHERE match_id = ? AND seat = ? ORDER BY card_id')
      .all(matchId, seat) as unknown as SeatCard[]
  ).map((c) => ({ id: c.id, copies: c.copies, opening: c.opening, drawn: c.drawn, played: c.played }));
}

export function registerPartnerMatchRoutes(app: FastifyInstance, { db, user }: { db: DB; user: (req: FastifyRequest) => User | null }) {
  /**
   * Partidas do jogador logado (cookie ou token com matches:read), mais novas primeiro.
   * `since=<ISO>` traz só as novas; `limit` até 100; `cursor` é o id do último item da página anterior.
   */
  app.get<{ Querystring: { since?: string; limit?: string; cursor?: string } }>(
    '/api/players/me/matches',
    { config: { scope: 'matches:read' } },
    async (req, reply) => {
      const me = user(req);
      if (!me) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      const since = req.query.since !== undefined ? isoToSqlite(req.query.since) : null;
      if (req.query.since !== undefined && !since) return reply.code(400).send(fail('invalidSince', 'Data inválida em since (use ISO 8601).'));
      const limitRaw = req.query.limit === undefined ? MATCHES_PAGE : Number(req.query.limit);
      if (!Number.isInteger(limitRaw) || limitRaw < 1) return reply.code(400).send(fail('invalidLimit', 'limit inválido.'));
      const limit = Math.min(MATCHES_PAGE_MAX, limitRaw);
      const cursor = req.query.cursor === undefined ? null : Number(req.query.cursor);
      if (cursor !== null && (!Number.isInteger(cursor) || cursor < 1)) return reply.code(400).send(fail('invalidCursor', 'cursor inválido.'));
      const p = findPlayer(db, accountOwnerKey(me.id));
      if (!p) return { matches: [], nextCursor: null };
      const matches = playerMatches(db, p.id, { since, cursor, limit });
      return { matches, nextCursor: matches.length === limit ? matches[matches.length - 1].id : null };
    },
  );
}
