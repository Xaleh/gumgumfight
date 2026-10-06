// Banco local SQLite (arquivo único, sem custo de serviço externo).
// Usa o SQLite embutido no Node (`node:sqlite`): nenhum módulo nativo para
// compilar ou baixar, então funciona igual no Windows, Linux e macOS.
// Toda a SQL fica aqui, em stats/store.ts (consultas das estatísticas), em
// auth/store.ts (contas e sessões) e em tournaments/store.ts (torneios); se um dia
// for preciso migrar para Postgres, só esses arquivos mudam.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CardData, DeckList } from '@gumgum/engine';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths';

export type DB = DatabaseSync;

export function openDb(path = DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id          TEXT PRIMARY KEY,
      set_code    TEXT,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      data        TEXT NOT NULL,          -- JSON no formato CardData
      provisional INTEGER NOT NULL DEFAULT 0,
      source      TEXT NOT NULL DEFAULT 'fixture',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS cards_set ON cards(set_code);

    CREATE TABLE IF NOT EXISTS decks (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      leader     TEXT NOT NULL,
      cards      TEXT NOT NULL,           -- JSON: [{ id, count }]
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      seed       INTEGER NOT NULL,
      mode       TEXT NOT NULL,
      deck0      TEXT NOT NULL,
      deck1      TEXT NOT NULL,
      winner     INTEGER,
      turns      INTEGER,
      reason     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Traduções revisadas manualmente (têm prioridade sobre a tradução automática).
    CREATE TABLE IF NOT EXISTS card_translations (
      card_id    TEXT NOT NULL,
      lang       TEXT NOT NULL,
      text       TEXT NOT NULL,
      trigger    TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (card_id, lang)
    );
  `);
  // Colunas adicionadas depois da primeira versão.
  const cols = (db.prepare('PRAGMA table_info(cards)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  // raw: resposta original da API, para poder remapear sem baixar de novo.
  if (!cols.includes('raw')) db.exec('ALTER TABLE cards ADD COLUMN raw TEXT');
  const deckCols = (db.prepare('PRAGMA table_info(decks)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!deckCols.includes('kind')) db.exec("ALTER TABLE decks ADD COLUMN kind TEXT NOT NULL DEFAULT 'builtin'");
  // Dono do deck: SHA-256 do código do navegador (nunca o código em si) ou
  // "user:<id>" quando o deck pertence a uma conta (ver auth/store.ts).
  if (!deckCols.includes('owner_hash')) db.exec('ALTER TABLE decks ADD COLUMN owner_hash TEXT');
  migrateStats(db);
  migrateAuth(db);
  migrateTournaments(db);
}

/**
 * Torneios criados pelos organizadores. A lista de cada inscrito fica congelada na
 * inscrição (mudar o deck salvo depois não muda o deck do torneio).
 */
function migrateTournaments(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      format       TEXT NOT NULL,
      structure    TEXT NOT NULL,             -- swiss | single (eliminação simples)
      rounds       INTEGER,                   -- suíço: escolhido pelo organizador ou calculado no início
      max_players  INTEGER,
      starts_at    TEXT,                      -- data e hora previstas (ISO), só informativo
      status       TEXT NOT NULL DEFAULT 'registration',  -- registration | running | finished
      round        INTEGER NOT NULL DEFAULT 0,  -- rodada atual (0 = não começou)
      organizer_id TEXT NOT NULL REFERENCES users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      started_at   TEXT,
      finished_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS tournament_players (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id),
      name          TEXT NOT NULL,             -- nome público (perfil de estatísticas) na inscrição
      deck_id       TEXT,
      deck          TEXT NOT NULL,             -- JSON DeckList congelado na inscrição
      seed          INTEGER,                   -- ordem sorteada no início (desempate e chave)
      dropped       INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tournament_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round         INTEGER NOT NULL,
      table_no      INTEGER NOT NULL,
      p1            TEXT NOT NULL,
      p2            TEXT,                      -- null = bye
      result        TEXT,                      -- p1 | p2 | draw | bye (null = pendente)
      room_id       TEXT,                      -- sala online da partida
      match_id      INTEGER,                   -- partida gravada nas estatísticas
      reported_by   TEXT,                      -- game (sala online), bye, drop (desistência) ou id de quem lançou
      updated_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS tournament_matches_round ON tournament_matches(tournament_id, round);
  `);
}

/** Contas (login com Google) e sessões abertas. Do token de sessão só o hash é guardado. */
function migrateAuth(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      google_sub    TEXT NOT NULL UNIQUE,       -- id permanente da conta Google
      email         TEXT,
      name          TEXT,                       -- nome da conta Google (só o próprio usuário vê)
      picture       TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  // Perfil da conta: player (padrão), streamer (assiste vendo as mãos), organizer (torneios) ou admin.
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!userCols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'");
}

/**
 * Estatísticas. `matches` guarda a partida e o replay; `match_seats` é a tabela de
 * fatos: uma linha por lado da partida, com todas as dimensões dos filtros
 * (formato, fila, tier, Líderes, quem começou), para que as consultas não
 * precisem de joins. `match_cards` detalha cada carta do deck daquele lado.
 */
function migrateStats(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(matches)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes('format')) db.exec('ALTER TABLE matches ADD COLUMN format TEXT');
  if (!cols.includes('queue')) db.exec('ALTER TABLE matches ADD COLUMN queue TEXT');
  if (!cols.includes('first_player')) db.exec('ALTER TABLE matches ADD COLUMN first_player INTEGER');
  // JSON { seed, firstPlayer, decks, actions }: permite recalcular as estatísticas.
  if (!cols.includes('replay')) db.exec('ALTER TABLE matches ADD COLUMN replay TEXT');
  db.exec(`
    -- Jogador = conta ("user:<id>") ou, sem login, o navegador (hash do código de dono).
    CREATE TABLE IF NOT EXISTS players (
      id           TEXT PRIMARY KEY,
      owner_hash   TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      bounty       INTEGER NOT NULL DEFAULT 0,  -- recompensa em Beries (ranqueada)
      ranked_games INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Listas exatas usadas em partidas (imutáveis; o deck salvo pode mudar depois).
    CREATE TABLE IF NOT EXISTS deck_lists (
      hash       TEXT PRIMARY KEY,
      leader     TEXT NOT NULL,
      cards      TEXT NOT NULL,                 -- JSON: [{ id, count }]
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS match_seats (
      match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      seat           INTEGER NOT NULL,
      controller     TEXT NOT NULL,             -- human | bot
      player_id      TEXT REFERENCES players(id),
      deck_id        TEXT,
      deck_hash      TEXT NOT NULL REFERENCES deck_lists(hash),
      leader         TEXT NOT NULL,
      opp_leader     TEXT NOT NULL,
      opp_controller TEXT NOT NULL,
      tier           TEXT,                      -- tier do jogador no momento da partida
      bounty_before  INTEGER,
      bounty_after   INTEGER,
      went_first     INTEGER NOT NULL,
      won            INTEGER NOT NULL,
      mulligan       INTEGER NOT NULL,
      format         TEXT NOT NULL,
      queue          TEXT NOT NULL,
      played_at      TEXT NOT NULL,
      PRIMARY KEY (match_id, seat)
    );
    CREATE INDEX IF NOT EXISTS seats_dims ON match_seats(format, queue, controller, leader);
    CREATE INDEX IF NOT EXISTS seats_matchup ON match_seats(leader, opp_leader);
    CREATE INDEX IF NOT EXISTS seats_player ON match_seats(player_id);

    CREATE TABLE IF NOT EXISTS match_cards (
      match_id INTEGER NOT NULL,
      seat     INTEGER NOT NULL,
      card_id  TEXT NOT NULL,
      copies   INTEGER NOT NULL,                -- cópias no deck
      opening  INTEGER NOT NULL,                -- cópias na mão mantida após o mulligan
      drawn    INTEGER NOT NULL,                -- cópias que passaram pela mão
      played   INTEGER NOT NULL,                -- vezes jogada da mão (inclui Counter)
      PRIMARY KEY (match_id, seat, card_id),
      FOREIGN KEY (match_id, seat) REFERENCES match_seats(match_id, seat) ON DELETE CASCADE
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS match_cards_card ON match_cards(card_id);

    -- Partidas online em andamento (seed, decks e ações): refeitas ao reiniciar o servidor.
    CREATE TABLE IF NOT EXISTS live_matches (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,                 -- JSON (online/room.ts: RoomData)
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ------------------------------------------------------------------ partidas online

export function saveLiveMatch(db: DB, id: string, data: unknown) {
  db.prepare(
    `INSERT INTO live_matches (id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, JSON.stringify(data));
}

export function deleteLiveMatch(db: DB, id: string) {
  db.prepare('DELETE FROM live_matches WHERE id = ?').run(id);
}

export function listLiveMatches(db: DB): Array<{ id: string; data: string }> {
  return db.prepare('SELECT id, data FROM live_matches').all() as Array<{ id: string; data: string }>;
}

// ------------------------------------------------------------------ cartas

export function upsertCards(
  db: DB,
  cards: CardData[],
  opts: { provisional: boolean; source: string; raw?: Map<string, unknown> },
): { written: number; skipped: number } {
  const existing = db.prepare('SELECT provisional FROM cards WHERE id = ?');
  const write = db.prepare(`
    INSERT INTO cards (id, set_code, name, category, data, provisional, source, raw, updated_at)
    VALUES (@id, @set_code, @name, @category, @data, @provisional, @source, @raw, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      set_code = excluded.set_code, name = excluded.name, category = excluded.category,
      data = excluded.data, provisional = excluded.provisional, source = excluded.source,
      raw = excluded.raw, updated_at = excluded.updated_at
  `);
  let written = 0;
  let skipped = 0;
  transaction(db, () => {
    for (const c of cards) {
      const row = existing.get(c.id) as { provisional: number } | undefined;
      // Dados provisórios nunca sobrescrevem dados vindos da API.
      if (opts.provisional && row && !row.provisional) {
        skipped++;
        continue;
      }
      write.run({
        id: c.id,
        set_code: c.set ?? c.id.split('-')[0],
        name: c.name,
        category: c.category,
        data: JSON.stringify(c),
        provisional: opts.provisional ? 1 : 0,
        source: opts.source,
        raw: opts.raw?.has(c.id) ? JSON.stringify(opts.raw.get(c.id)) : null,
      });
      written++;
    }
  });
  return { written, skipped };
}

/** Origem das cartas de spoiler (data/spoilers). Elas são provisórias: a API oficial as substitui. */
export const SPOILER_SOURCE = 'spoiler:';

/** Cartas de spoiler que ainda não chegaram na API oficial. */
export function pendingSpoilers(db: DB): string[] {
  return (
    db.prepare(`SELECT id FROM cards WHERE provisional = 1 AND source LIKE '${SPOILER_SOURCE}%' ORDER BY id`).all() as unknown as Array<{
      id: string;
    }>
  ).map((r) => r.id);
}

/**
 * Apaga as cartas de spoiler de uma origem que não estão mais nela (número corrigido,
 * carta desmentida). `source` é um padrão LIKE; `set` limita a uma coleção.
 */
export function pruneSpoilers(db: DB, keep: Iterable<string>, where: { source: string; set?: string }): number {
  const keepSet = new Set(keep);
  const rows = db
    .prepare(`SELECT id FROM cards WHERE provisional = 1 AND source LIKE ? ${where.set ? 'AND set_code = ?' : ''}`)
    .all(...[where.source, ...(where.set ? [where.set] : [])]) as unknown as Array<{ id: string }>;
  const gone = rows.map((r) => r.id).filter((id) => !keepSet.has(id));
  const del = db.prepare('DELETE FROM cards WHERE id = ? AND provisional = 1');
  transaction(db, () => gone.forEach((id) => del.run(id)));
  return gone.length;
}

/** A coleção já tem cartas vindas da API oficial. */
export function hasOfficialCards(db: DB, set: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM cards WHERE set_code = ? AND provisional = 0 LIMIT 1').get(set));
}

type CardRow = { data: string; provisional: number };
const toCard = (r: CardRow) => ({ ...(JSON.parse(r.data) as CardData), provisional: Boolean(r.provisional) });

export function listCards(db: DB, set?: string) {
  const rows = (
    set
      ? db.prepare('SELECT data, provisional FROM cards WHERE set_code = ? ORDER BY id').all(set)
      : db.prepare('SELECT data, provisional FROM cards ORDER BY id').all()
  ) as unknown as CardRow[];
  return rows.map(toCard);
}

export function getCards(db: DB, ids: string[]) {
  if (!ids.length) return [];
  const rows = db
    .prepare(`SELECT data, provisional FROM cards WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as CardRow[];
  return rows.map(toCard);
}

export function countCards(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as unknown as { n: number }).n;
}

// ------------------------------------------------------------------ traduções

export interface TranslationRow {
  card_id: string;
  text: string;
  trigger: string | null;
}

export function upsertTranslations(db: DB, lang: string, rows: Array<{ id: string; text: string; trigger?: string }>) {
  const write = db.prepare(`
    INSERT INTO card_translations (card_id, lang, text, trigger, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(card_id, lang) DO UPDATE SET text = excluded.text, trigger = excluded.trigger,
      updated_at = excluded.updated_at
  `);
  transaction(db, () => {
    for (const r of rows) write.run(r.id, lang, r.text, r.trigger ?? null);
  });
}

export function getTranslations(db: DB, lang: string, ids?: string[]): Map<string, TranslationRow> {
  const rows = (
    ids
      ? ids.length
        ? db
            .prepare(`SELECT card_id, text, trigger FROM card_translations WHERE lang = ? AND card_id IN (${ids.map(() => '?').join(',')})`)
            .all(lang, ...ids)
        : []
      : db.prepare('SELECT card_id, text, trigger FROM card_translations WHERE lang = ?').all(lang)
  ) as unknown as TranslationRow[];
  return new Map(rows.map((r) => [r.card_id, r]));
}

// ------------------------------------------------------------------ decks

/** builtin = vem de data/decks (recriado a cada início); user = montado pelo jogador. */
export type DeckKind = 'builtin' | 'user';
export type StoredDeck = DeckList & { kind: DeckKind; updatedAt: string; ownerHash: string | null };

/** Grava um deck. O dono só é definido na criação (um update nunca troca o dono). */
export function upsertDeck(db: DB, deck: DeckList, kind: DeckKind = 'builtin', ownerHash: string | null = null) {
  db.prepare(`
    INSERT INTO decks (id, name, leader, cards, kind, owner_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, leader = excluded.leader,
      cards = excluded.cards, kind = excluded.kind, updated_at = excluded.updated_at
  `).run(deck.id, deck.name, deck.leader, JSON.stringify(deck.cards), kind, ownerHash);
}

type DeckRow = {
  id: string;
  name: string;
  leader: string;
  cards: string;
  kind: DeckKind;
  updated_at: string;
  owner_hash: string | null;
};
const DECK_COLS = 'id, name, leader, cards, kind, updated_at, owner_hash';
const toDeck = (r: DeckRow): StoredDeck => ({
  id: r.id,
  name: r.name,
  leader: r.leader,
  cards: JSON.parse(r.cards),
  kind: r.kind,
  updatedAt: r.updated_at,
  ownerHash: r.owner_hash,
});

export function listDecks(db: DB): StoredDeck[] {
  return (
    db.prepare(`SELECT ${DECK_COLS} FROM decks ORDER BY kind = 'builtin', updated_at DESC, id`).all() as unknown as DeckRow[]
  ).map(toDeck);
}

export function getDeck(db: DB, id: string): StoredDeck | null {
  const row = db.prepare(`SELECT ${DECK_COLS} FROM decks WHERE id = ?`).get(id) as unknown as DeckRow | undefined;
  return row ? toDeck(row) : null;
}

export function deleteDeck(db: DB, id: string): boolean {
  return Number(db.prepare(`DELETE FROM decks WHERE id = ? AND kind = 'user'`).run(id).changes) > 0;
}

// ------------------------------------------------------------------ partidas

export function recentMatches(db: DB, limit = 20) {
  return db
    .prepare(
      `SELECT id, seed, mode, deck0, deck1, winner, turns, reason, format, queue, first_player, created_at
       FROM matches ORDER BY id DESC LIMIT ?`,
    )
    .all(limit);
}
