// Selado: os boosters que cada jogador abriu e o deck que montou com eles.
//
// O servidor é a autoridade: sorteia os boosters (seed do `crypto`), grava as cartas e confere o
// deck contra elas antes de cada partida. O navegador só revela o que já foi sorteado.

import { randomBytes, randomInt } from 'node:crypto';
import {
  autoBuildLimited,
  boosterCards,
  boosterReady,
  boosterStock,
  type CardData,
  type DeckList,
  isBoosterSet,
  needsManual,
  openBoosters,
  poolCounts,
  SEALED_LEADER_ID,
  validateLimitedDeck,
} from '@gumgum/engine';
import { type DB, getCards, listCards } from '../db';

/** Parte mínima de cartas com efeito automatizado para a coleção entrar no Selado. */
export const SEALED_MIN_AUTOMATED = 0.7;
/** Coleções abertas guardadas por jogador: ao passar disso, a mais antiga sai. */
export const SEALED_MAX_POOLS = 12;

export interface SealedPool {
  id: string;
  ownerHash: string;
  set: string;
  /** Os boosters, na ordem em que foram sorteados. */
  packs: string[][];
  /** O deck montado (pode estar incompleto: o jogador salva enquanto monta). */
  deck: Pick<DeckList, 'leader' | 'cards'> | null;
  wins: number;
  losses: number;
  createdAt: string;
  updatedAt: string;
}

interface PoolRow {
  id: string;
  owner_hash: string;
  set_code: string;
  packs: string;
  deck: string | null;
  wins: number;
  losses: number;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, owner_hash, set_code, packs, deck, wins, losses, created_at, updated_at';
const toPool = (r: PoolRow): SealedPool => ({
  id: r.id,
  ownerHash: r.owner_hash,
  set: r.set_code,
  packs: JSON.parse(r.packs),
  deck: r.deck ? JSON.parse(r.deck) : null,
  wins: r.wins,
  losses: r.losses,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function migrateSealed(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sealed_pools (
      id         TEXT PRIMARY KEY,
      owner_hash TEXT NOT NULL,
      set_code   TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'sealed',  -- 'sealed' = Pré-release (6 boosters de uma coleção)
      seed       TEXT NOT NULL,                   -- JSON: as 4 palavras do sfc32 que abriram os boosters
      packs      TEXT NOT NULL,                   -- JSON: string[][], os boosters sorteados
      deck       TEXT,                            -- JSON { leader, cards }: o deck montado (ou em montagem)
      wins       INTEGER NOT NULL DEFAULT 0,
      losses     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sealed_pools_owner ON sealed_pools(owner_hash, created_at);
  `);
}

export interface SealedSet {
  set: string;
  /** Cartas que saem no booster (sem os Líderes) e Líderes da coleção. */
  cards: number;
  leaders: number;
  /** Parte das cartas com efeito automatizado (0 a 1). */
  automated: number;
  /** Coleção ainda não lançada (cartas de spoiler): o pré-release de verdade. */
  spoiler: boolean;
}

let setsMemo: { at: number; db: DB; sets: SealedSet[] } | null = null;
const SETS_TTL_MS = 60_000;

/**
 * Coleções em que dá para abrir boosters: de booster (OP, EB, PRB), completas no banco
 * (`boosterReady`) e com efeitos automatizados o bastante. A lista custa ler todas as cartas, então
 * fica um minuto em memória.
 */
export function sealedSets(db: DB, now = Date.now()): SealedSet[] {
  if (setsMemo && setsMemo.db === db && now - setsMemo.at < SETS_TTL_MS) return setsMemo.sets;
  const bySet = new Map<string, CardData[]>();
  for (const c of listCards(db) as CardData[]) {
    const set = (c.set ?? c.id.split('-')[0]).toUpperCase();
    if (!isBoosterSet(set) || c.id === SEALED_LEADER_ID) continue;
    let list = bySet.get(set);
    if (!list) bySet.set(set, (list = []));
    list.push(c);
  }
  const sets: SealedSet[] = [];
  for (const [set, cards] of bySet) {
    if (!boosterReady(cards)) continue;
    const stock = boosterStock(cards);
    const pack = cards.filter((c) => c.category !== 'leader');
    const automated = pack.filter((c) => !needsManual(c)).length / pack.length;
    if (automated < SEALED_MIN_AUTOMATED) continue;
    sets.push({ set, cards: pack.length, leaders: stock.leaders, automated: Math.round(automated * 100) / 100, spoiler: cards.some((c) => c.spoiler) });
  }
  // A mais nova primeiro: boosters principais (OP) pelo número, depois os extras.
  const rank = (s: string) => (s.startsWith('OP') ? 0 : s.startsWith('EB') ? 1 : 2);
  sets.sort((a, b) => rank(a.set) - rank(b.set) || b.set.localeCompare(a.set, 'en', { numeric: true }));
  setsMemo = { at: now, db, sets };
  return sets;
}

/** Esquece a lista de coleções (testes e depois de importar cartas). */
export const forgetSealedSets = () => {
  setsMemo = null;
};

const setCards = (db: DB, set: string) => boosterCards(listCards(db, set.toUpperCase()) as CardData[], set);

/** Abre 6 boosters da coleção para o jogador e grava. A coleção mais antiga sai se ele já tem o teto. */
export function createPool(db: DB, ownerHash: string, set: string): SealedPool | null {
  const code = set.toUpperCase();
  if (!sealedSets(db).some((s) => s.set === code)) return null;
  const seed = Array.from({ length: 4 }, () => randomInt(0, 0x1_0000_0000));
  const packs = openBoosters(setCards(db, code), seed);
  const id = randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO sealed_pools (id, owner_hash, set_code, seed, packs) VALUES (?, ?, ?, ?, ?)').run(id, ownerHash, code, JSON.stringify(seed), JSON.stringify(packs));
  const mine = db.prepare('SELECT id FROM sealed_pools WHERE owner_hash = ? ORDER BY created_at DESC, rowid DESC').all(ownerHash) as unknown as Array<{ id: string }>;
  for (const old of mine.slice(SEALED_MAX_POOLS)) db.prepare('DELETE FROM sealed_pools WHERE id = ?').run(old.id);
  return getPool(db, id);
}

export function getPool(db: DB, id: string): SealedPool | null {
  const row = db.prepare(`SELECT ${COLS} FROM sealed_pools WHERE id = ?`).get(id) as unknown as PoolRow | undefined;
  return row ? toPool(row) : null;
}

export function listPools(db: DB, ownerHash: string): SealedPool[] {
  const rows = db.prepare(`SELECT ${COLS} FROM sealed_pools WHERE owner_hash = ? ORDER BY created_at DESC, rowid DESC`).all(ownerHash) as unknown as PoolRow[];
  return rows.map(toPool);
}

export function deletePool(db: DB, id: string) {
  db.prepare('DELETE FROM sealed_pools WHERE id = ?').run(id);
}

/** As cartas do catálogo que aparecem na coleção aberta (e o Líder de 6 cores, que todo jogador tem). */
export function poolCatalog(db: DB, pool: SealedPool, extra: string[] = []): Map<string, CardData> {
  const ids = [...new Set([...pool.packs.flat(), SEALED_LEADER_ID, ...extra])];
  return new Map((getCards(db, ids) as CardData[]).map((c) => [c.id, c]));
}

/** Confere o deck contra a coleção aberta. */
export function checkDeck(db: DB, pool: SealedPool, deck: Pick<DeckList, 'leader' | 'cards'>) {
  const list: DeckList = { id: sealedDeckId(pool.id), name: `Selado ${pool.set}`, leader: deck.leader, cards: deck.cards };
  return validateLimitedDeck(list, poolCatalog(db, pool, [deck.leader, ...deck.cards.map((c) => c.id)].filter(Boolean)), poolCounts(pool.packs));
}

export function saveDeck(db: DB, id: string, deck: Pick<DeckList, 'leader' | 'cards'>) {
  db.prepare("UPDATE sealed_pools SET deck = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify({ leader: deck.leader, cards: deck.cards }), id);
}

/** Soma o resultado de uma partida ao placar da coleção. */
export function recordResult(db: DB, id: string, won: boolean) {
  db.prepare(`UPDATE sealed_pools SET ${won ? 'wins = wins + 1' : 'losses = losses + 1'} WHERE id = ?`).run(id);
}

/** Id do deck selado nas salas e nas partidas gravadas: "sealed:<id da coleção>". */
export const SEALED_DECK_PREFIX = 'sealed:';
export const sealedDeckId = (poolId: string) => `${SEALED_DECK_PREFIX}${poolId}`;
export const poolIdOf = (deckId: unknown): string | null =>
  typeof deckId === 'string' && deckId ? (deckId.startsWith(SEALED_DECK_PREFIX) ? deckId.slice(SEALED_DECK_PREFIX.length) : deckId) : null;

/** O deck do jogador como lista de partida (com o id "sealed:…" e o nome da coleção). */
export const poolDeck = (pool: SealedPool): DeckList | null =>
  pool.deck ? { id: sealedDeckId(pool.id), name: `Selado ${pool.set}`, leader: pool.deck.leader, cards: pool.deck.cards } : null;

/**
 * Deck do bot no Selado: ele abre os próprios 6 boosters da mesma coleção e monta sozinho, como o
 * "Montar sozinho" do jogador. Não fica gravado.
 */
export function botDeck(db: DB, set: string): DeckList | null {
  const cards = setCards(db, set);
  if (!boosterReady(cards)) return null;
  const seed = Array.from({ length: 4 }, () => randomInt(0, 0x1_0000_0000));
  const pool = poolCounts(openBoosters(cards, seed));
  const catalog = new Map((getCards(db, [...pool.keys(), SEALED_LEADER_ID]) as CardData[]).map((c) => [c.id, c]));
  const deck: DeckList = { id: `${SEALED_DECK_PREFIX}bot`, name: `Selado ${set.toUpperCase()}`, ...autoBuildLimited(pool, catalog) };
  return validateLimitedDeck(deck, catalog, pool).valid ? deck : null;
}
