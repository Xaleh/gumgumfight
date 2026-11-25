// SQL do perfil público do jogador: o que ele escolheu mostrar (`player_profiles`) e o que a
// página aberta por link lê (cartaz, Líderes, partidas recentes e decks escolhidos).
//
// Privacidade (docs/documentacao-tecnica.md, seção 9):
// - partidas de torneio que ainda não terminou ficam de fora de tudo (as listas só se abrem no fim);
// - do oponente sai só o Líder e se era bot ou pessoa (nunca o nome nem o id);
// - o replay de uma partida mostra a mão e o deck dos dois lados: sai só com os replays ligados
//   no perfil do dono e, contra uma pessoa, também no perfil (visível) do oponente.

import { type DeckList } from '@gumgum/engine';
import { dataVersion } from '../cache';
import { type DB, getDeck } from '../db';
import { sqliteToIso } from '../partners/store';

/** Quantos decks o perfil mostra, no máximo. */
export const PROFILE_MAX_DECKS = 6;
/** Partidas recentes mostradas. */
export const PROFILE_RECENT = 10;
/** Líderes mais jogados mostrados. */
export const PROFILE_LEADERS = 5;

export interface ProfileSettings {
  /** false = o link responde 404 para os outros (o dono ainda vê). */
  visible: boolean;
  leaders: boolean;
  matches: boolean;
  /** Replays das partidas recentes (contra pessoas, só se o oponente também libera os dele). */
  replays: boolean;
  /** Ids dos decks mostrados, na ordem escolhida. */
  decks: string[];
}

export const DEFAULT_PROFILE: ProfileSettings = { visible: true, leaders: true, matches: true, replays: false, decks: [] };

type SettingsRow = { visible: number; leaders: number; matches: number; replays: number; decks: string };

export function profileSettings(db: DB, playerId: string): ProfileSettings {
  const r = db.prepare('SELECT visible, leaders, matches, replays, decks FROM player_profiles WHERE player_id = ?').get(playerId) as
    | SettingsRow
    | undefined;
  if (!r) return { ...DEFAULT_PROFILE, decks: [] };
  let decks: string[] = [];
  try {
    const parsed = JSON.parse(r.decks) as unknown;
    if (Array.isArray(parsed)) decks = parsed.filter((d): d is string => typeof d === 'string');
  } catch {
    /* lista ilegível: nenhum deck */
  }
  return { visible: Boolean(r.visible), leaders: Boolean(r.leaders), matches: Boolean(r.matches), replays: Boolean(r.replays), decks };
}

export function saveProfileSettings(db: DB, playerId: string, s: ProfileSettings) {
  db.prepare(
    `INSERT INTO player_profiles (player_id, visible, leaders, matches, replays, decks, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(player_id) DO UPDATE SET visible = excluded.visible, leaders = excluded.leaders, matches = excluded.matches,
       replays = excluded.replays, decks = excluded.decks, updated_at = excluded.updated_at`,
  ).run(playerId, s.visible ? 1 : 0, s.leaders ? 1 : 0, s.matches ? 1 : 0, s.replays ? 1 : 0, JSON.stringify(s.decks));
  dataVersion.bump();
}

// ------------------------------------------------------------------ leitura

export interface ProfilePlayer {
  id: string;
  ownerHash: string;
  name: string;
  bounty: number;
  rankedGames: number;
  createdAt: string;
}

export function playerById(db: DB, id: string): ProfilePlayer | null {
  const r = db.prepare('SELECT id, owner_hash, name, bounty, ranked_games, created_at FROM players WHERE id = ?').get(id) as
    | { id: string; owner_hash: string; name: string; bounty: number; ranked_games: number; created_at: string }
    | undefined;
  return r ? { id: r.id, ownerHash: r.owner_hash, name: r.name, bounty: r.bounty, rankedGames: r.ranked_games, createdAt: sqliteToIso(r.created_at) } : null;
}

/** Partida que não é de um torneio em andamento (alias `s` em match_seats). */
const NOT_LIVE_TOURNAMENT = `(s.queue <> 'tournament' OR s.match_id IN (
  SELECT g.stats_match_id FROM tournament_games g JOIN tournaments t ON t.id = g.tournament_id
  WHERE t.status = 'finished' AND g.stats_match_id IS NOT NULL))`;

export interface ProfileLeader {
  leader: string;
  games: number;
  wins: number;
}

/** Total de partidas e vitórias e os Líderes mais jogados (partidas de pessoa, fora torneios em andamento). */
export function profileRecord(db: DB, playerId: string): { games: number; wins: number; leaders: ProfileLeader[] } {
  const rows = db
    .prepare(
      `SELECT s.leader, COUNT(*) AS games, SUM(s.won) AS wins FROM match_seats s
       WHERE s.player_id = ? AND s.controller = 'human' AND ${NOT_LIVE_TOURNAMENT}
       GROUP BY s.leader ORDER BY games DESC, wins DESC, s.leader`,
    )
    .all(playerId) as Array<{ leader: string; games: number; wins: number | null }>;
  const leaders = rows.map((r) => ({ leader: r.leader, games: Number(r.games), wins: Number(r.wins ?? 0) }));
  return {
    games: leaders.reduce((n, l) => n + l.games, 0),
    wins: leaders.reduce((n, l) => n + l.wins, 0),
    leaders: leaders.slice(0, PROFILE_LEADERS),
  };
}

export interface ProfileMatch {
  id: number;
  playedAt: string;
  queue: string;
  format: string;
  leader: string;
  oppLeader: string;
  /** Só se o oponente era bot ou pessoa: nunca o nome. */
  oppController: 'human' | 'bot';
  won: boolean;
  /** Empate (partida sem vencedor). */
  draw: boolean;
  wentFirst: boolean;
  turns: number | null;
  /** Variação da recompensa (ranqueada); null fora dela. */
  bountyDelta: number | null;
  /** O replay pode ser aberto por quem vê o perfil. */
  replay: boolean;
}

type MatchRow = {
  match_id: number;
  played_at: string;
  queue: string;
  format: string;
  leader: string;
  opp_leader: string;
  opp_controller: 'human' | 'bot';
  won: number;
  winner: number | null;
  went_first: number;
  turns: number | null;
  bounty_before: number | null;
  bounty_after: number | null;
  has_replay: number;
  opp_player: string | null;
};

const MATCH_SQL = `
  SELECT s.match_id, s.played_at, s.queue, s.format, s.leader, s.opp_leader, s.opp_controller, s.won, m.winner, s.went_first,
         m.turns, s.bounty_before, s.bounty_after, (m.replay IS NOT NULL) AS has_replay, o.player_id AS opp_player
  FROM match_seats s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN match_seats o ON o.match_id = s.match_id AND o.seat <> s.seat
  WHERE s.player_id = ? AND s.controller = 'human' AND ${NOT_LIVE_TOURNAMENT}`;

/**
 * O replay sai para quem vê o perfil: o dono liga os replays e o oponente é um bot, é o próprio
 * dono ou também liga os replays num perfil visível (o replay mostra a mão e o deck dele).
 */
function replayAllowed(db: DB, owner: ProfileSettings, row: MatchRow, playerId: string): boolean {
  if (!owner.replays || !row.has_replay) return false;
  if (row.opp_controller === 'bot') return true;
  if (!row.opp_player) return false;
  if (row.opp_player === playerId) return true;
  const opp = profileSettings(db, row.opp_player);
  return opp.visible && opp.replays;
}

const toMatch = (db: DB, settings: ProfileSettings, playerId: string, r: MatchRow): ProfileMatch => ({
  id: r.match_id,
  playedAt: sqliteToIso(r.played_at),
  queue: r.queue,
  format: r.format,
  leader: r.leader,
  oppLeader: r.opp_leader,
  oppController: r.opp_controller,
  won: Boolean(r.won),
  draw: r.winner === null,
  wentFirst: Boolean(r.went_first),
  turns: r.turns,
  bountyDelta: r.queue === 'ranked' && r.bounty_before !== null && r.bounty_after !== null ? r.bounty_after - r.bounty_before : null,
  replay: replayAllowed(db, settings, r, playerId),
});

/** Partidas recentes do jogador, mais novas primeiro. */
export function profileMatches(db: DB, playerId: string, settings: ProfileSettings, limit = PROFILE_RECENT): ProfileMatch[] {
  const rows = db.prepare(`${MATCH_SQL} ORDER BY s.match_id DESC LIMIT ?`).all(playerId, limit) as MatchRow[];
  return rows.map((r) => toMatch(db, settings, playerId, r));
}

/** Uma partida do jogador, como o perfil a mostra (null = não é dele ou é de um torneio em andamento). */
export function profileMatch(db: DB, playerId: string, settings: ProfileSettings, matchId: number): ProfileMatch | null {
  const r = db.prepare(`${MATCH_SQL} AND s.match_id = ? LIMIT 1`).get(playerId, matchId) as MatchRow | undefined;
  return r ? toMatch(db, settings, playerId, r) : null;
}

export interface ProfileDeck extends DeckList {
  games: number;
  wins: number;
}

/** Os decks escolhidos que ainda existem e são do jogador, com as partidas dele com cada um. */
export function profileDecks(db: DB, player: ProfilePlayer, ids: string[]): ProfileDeck[] {
  const usage = db.prepare(
    `SELECT COUNT(*) AS games, COALESCE(SUM(s.won), 0) AS wins FROM match_seats s
     WHERE s.player_id = ? AND s.deck_id = ? AND s.controller = 'human' AND ${NOT_LIVE_TOURNAMENT}`,
  );
  const out: ProfileDeck[] = [];
  for (const id of ids) {
    const d = getDeck(db, id);
    if (!d || d.kind !== 'user' || d.ownerHash !== player.ownerHash) continue;
    const u = usage.get(player.id, id) as { games: number; wins: number };
    out.push({
      id: d.id,
      name: d.name,
      leader: d.leader,
      cards: d.cards,
      ...(d.arts ? { arts: d.arts } : {}),
      games: Number(u.games),
      wins: Number(u.wins),
    });
  }
  return out;
}
