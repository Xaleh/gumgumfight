// Versões do deck (roadmap C2): cada lista que um deck salvo já teve, com o que entrou e saiu de uma para a
// outra e as partidas e a taxa de vitória de cada uma. A versão é identificada pelo hash da lista exata
// (`deckHash`, o mesmo de `deck_lists` e `match_seats.deck_hash`), então as partidas antigas já caem na
// versão certa sem gravar nada a mais nelas.

import { type DeckDiff, type DeckList, deckListDiff } from '@gumgum/engine';
import type { DB } from '../db';
import { deckHash } from '../stats/derive';

/** Quantas versões a rota devolve (as mais novas); o número de cada uma continua contando desde a primeira. */
export const DECK_VERSIONS_LIMIT = 50;

/** Tabela das versões salvas. Chamada pela migração do `db.ts`; preenche a lista atual dos decks que já existem. */
export function migrateDeckVersions(db: DB) {
  db.exec(`
    -- Listas que cada deck já teve (versões). saved_at = última vez que a lista passou a ser a do deck.
    CREATE TABLE IF NOT EXISTS deck_versions (
      deck_id  TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      hash     TEXT NOT NULL REFERENCES deck_lists(hash),
      seq      INTEGER NOT NULL,                 -- ordem das gravações do deck (desempata o mesmo segundo)
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (deck_id, hash)
    ) WITHOUT ROWID;
  `);
  const missing = db
    .prepare('SELECT d.id, d.leader, d.cards, d.updated_at FROM decks d WHERE NOT EXISTS (SELECT 1 FROM deck_versions v WHERE v.deck_id = d.id)')
    .all() as Array<{ id: string; leader: string; cards: string; updated_at: string }>;
  for (const d of missing) recordDeckVersion(db, { id: d.id, leader: d.leader, cards: JSON.parse(d.cards) }, d.updated_at);
}

/**
 * Grava a lista atual do deck como versão, se ela não for a última gravada. Voltar a uma lista antiga
 * leva essa versão para o fim da linha do tempo (com as partidas que ela já tinha).
 */
export function recordDeckVersion(db: DB, deck: Pick<DeckList, 'id' | 'leader' | 'cards'>, at?: string) {
  const hash = deckHash(deck);
  const last = db.prepare('SELECT hash, seq FROM deck_versions WHERE deck_id = ? ORDER BY seq DESC LIMIT 1').get(deck.id) as
    | { hash: string; seq: number }
    | undefined;
  if (last?.hash === hash) return;
  db.prepare('INSERT OR IGNORE INTO deck_lists (hash, leader, cards) VALUES (?, ?, ?)').run(hash, deck.leader, JSON.stringify(deck.cards));
  db.prepare(
    `INSERT INTO deck_versions (deck_id, hash, seq, saved_at) VALUES (?, ?, ?, COALESCE(?, datetime('now')))
     ON CONFLICT(deck_id, hash) DO UPDATE SET seq = excluded.seq, saved_at = excluded.saved_at`,
  ).run(deck.id, hash, (last?.seq ?? 0) + 1, at ?? null);
}

export interface DeckVersion {
  hash: string;
  /** 1 = a primeira lista conhecida do deck. */
  number: number;
  leader: string;
  cards: DeckList['cards'];
  /** Última vez que a lista passou a ser a do deck (null = só conhecida pelas partidas, de antes das versões). */
  savedAt: string | null;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  /** Partidas de pessoas com esta lista (o lado do robô não conta, como em `games` dos decks). */
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Vitórias / partidas (null = nenhuma partida). */
  winRate: number | null;
  /** É a lista salva agora. */
  current: boolean;
  /** O que mudou desde a versão anterior (na primeira, tudo entra). */
  diff: DeckDiff;
}

export interface DeckVersions {
  deckId: string;
  /** Total de versões conhecidas (a lista pode trazer só as mais novas). */
  total: number;
  /** Da mais nova para a mais antiga. */
  versions: DeckVersion[];
}

/** Linha do tempo das listas do deck: as salvas e as que só aparecem nas partidas, com os números de cada uma. */
export function deckVersions(db: DB, deck: Pick<DeckList, 'id' | 'leader' | 'cards'>, limit = DECK_VERSIONS_LIMIT): DeckVersions {
  const saved = db
    .prepare('SELECT v.hash, v.seq, v.saved_at, l.leader, l.cards FROM deck_versions v JOIN deck_lists l ON l.hash = v.hash WHERE v.deck_id = ?')
    .all(deck.id) as Array<{ hash: string; seq: number; saved_at: string; leader: string; cards: string }>;
  const played = db
    .prepare(
      `SELECT s.deck_hash AS hash, l.leader, l.cards, COUNT(*) AS games, SUM(s.won) AS wins, SUM(m.winner IS NULL) AS draws,
              MIN(s.played_at) AS first_at, MAX(s.played_at) AS last_at
         FROM match_seats s JOIN matches m ON m.id = s.match_id JOIN deck_lists l ON l.hash = s.deck_hash
        WHERE s.deck_id = ? AND s.controller = 'human'
        GROUP BY s.deck_hash`,
    )
    .all(deck.id) as Array<{ hash: string; leader: string; cards: string; games: number; wins: number; draws: number; first_at: string; last_at: string }>;

  type Row = { hash: string; leader: string; cards: DeckList['cards']; at: string; seq: number; savedAt: string | null };
  const rows = new Map<string, Row>();
  for (const s of saved) rows.set(s.hash, { hash: s.hash, leader: s.leader, cards: JSON.parse(s.cards), at: s.saved_at, seq: s.seq, savedAt: s.saved_at });
  for (const p of played) {
    if (!rows.has(p.hash)) rows.set(p.hash, { hash: p.hash, leader: p.leader, cards: JSON.parse(p.cards), at: p.first_at, seq: 0, savedAt: null });
  }
  const stats = new Map(played.map((p) => [p.hash, p]));
  const timeline = [...rows.values()].sort((a, b) => (a.at === b.at ? a.seq - b.seq : a.at < b.at ? -1 : 1));
  const current = deckHash(deck);

  const versions = timeline.map((r, i): DeckVersion => {
    const s = stats.get(r.hash);
    const games = Number(s?.games ?? 0);
    const wins = Number(s?.wins ?? 0);
    const draws = Number(s?.draws ?? 0);
    return {
      hash: r.hash,
      number: i + 1,
      leader: r.leader,
      cards: r.cards,
      savedAt: r.savedAt,
      firstPlayedAt: s?.first_at ?? null,
      lastPlayedAt: s?.last_at ?? null,
      games,
      wins,
      losses: games - wins - draws,
      draws,
      winRate: games ? wins / games : null,
      current: r.hash === current,
      diff: deckListDiff(i ? timeline[i - 1] : null, r),
    };
  });
  return { deckId: deck.id, total: versions.length, versions: versions.reverse().slice(0, limit) };
}
