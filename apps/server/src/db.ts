// Banco local SQLite (arquivo único, sem custo de serviço externo).
// Toda a SQL fica aqui; se um dia for preciso migrar para Postgres, só este
// arquivo muda.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CardData, DeckList } from '@gumgum/engine';
import { DB_PATH } from './paths';

export type DB = Database.Database;

export function openDb(path = DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
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
  `);
}

// ------------------------------------------------------------------ cartas

export function upsertCards(
  db: DB,
  cards: CardData[],
  opts: { provisional: boolean; source: string },
): { written: number; skipped: number } {
  const existing = db.prepare('SELECT provisional FROM cards WHERE id = ?');
  const write = db.prepare(`
    INSERT INTO cards (id, set_code, name, category, data, provisional, source, updated_at)
    VALUES (@id, @set_code, @name, @category, @data, @provisional, @source, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      set_code = excluded.set_code, name = excluded.name, category = excluded.category,
      data = excluded.data, provisional = excluded.provisional, source = excluded.source,
      updated_at = excluded.updated_at
  `);
  let written = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
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
      });
      written++;
    }
  });
  tx();
  return { written, skipped };
}

type CardRow = { data: string; provisional: number };
const toCard = (r: CardRow) => ({ ...(JSON.parse(r.data) as CardData), provisional: Boolean(r.provisional) });

export function listCards(db: DB, set?: string) {
  const rows = set
    ? (db.prepare('SELECT data, provisional FROM cards WHERE set_code = ? ORDER BY id').all(set) as CardRow[])
    : (db.prepare('SELECT data, provisional FROM cards ORDER BY id').all() as CardRow[]);
  return rows.map(toCard);
}

export function getCards(db: DB, ids: string[]) {
  if (!ids.length) return [];
  const rows = db
    .prepare(`SELECT data, provisional FROM cards WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as CardRow[];
  return rows.map(toCard);
}

export function countCards(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
}

// ------------------------------------------------------------------ decks

export function upsertDeck(db: DB, deck: DeckList) {
  db.prepare(`
    INSERT INTO decks (id, name, leader, cards, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, leader = excluded.leader,
      cards = excluded.cards, updated_at = excluded.updated_at
  `).run(deck.id, deck.name, deck.leader, JSON.stringify(deck.cards));
}

type DeckRow = { id: string; name: string; leader: string; cards: string };
const toDeck = (r: DeckRow): DeckList => ({ id: r.id, name: r.name, leader: r.leader, cards: JSON.parse(r.cards) });

export function listDecks(db: DB): DeckList[] {
  return (db.prepare('SELECT id, name, leader, cards FROM decks ORDER BY id').all() as DeckRow[]).map(toDeck);
}

export function getDeck(db: DB, id: string): DeckList | null {
  const row = db.prepare('SELECT id, name, leader, cards FROM decks WHERE id = ?').get(id) as DeckRow | undefined;
  return row ? toDeck(row) : null;
}

// ------------------------------------------------------------------ partidas

export interface MatchRecord {
  seed: number;
  mode: string;
  deck0: string;
  deck1: string;
  winner: number | null;
  turns: number;
  reason: string | null;
}

export function insertMatch(db: DB, m: MatchRecord): number {
  const r = db
    .prepare(
      'INSERT INTO matches (seed, mode, deck0, deck1, winner, turns, reason) VALUES (@seed, @mode, @deck0, @deck1, @winner, @turns, @reason)',
    )
    .run(m);
  return Number(r.lastInsertRowid);
}

export function recentMatches(db: DB, limit = 20) {
  return db.prepare('SELECT * FROM matches ORDER BY id DESC LIMIT ?').all(limit);
}
