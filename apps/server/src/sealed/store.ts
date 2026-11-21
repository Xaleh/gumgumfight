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
  isRush,
  type LimitedRules,
  needsManual,
  openBoosters,
  openMixedBoosters,
  playModeLabel,
  poolCounts,
  RUSH_MAX_SETS,
  rushKey,
  rushSets,
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
  /** A coleção; no Pack Rush, a chave das coleções escolhidas ("OP01+OP05", `rushKey`). */
  set: string;
  /** Os boosters, na ordem em que foram sorteados. */
  packs: string[][];
  /** A coleção de cada booster (no Selado de uma coleção, todas iguais). */
  packSets: string[];
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
  pack_sets: string | null;
  deck: string | null;
  wins: number;
  losses: number;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, owner_hash, set_code, packs, pack_sets, deck, wins, losses, created_at, updated_at';
const toPool = (r: PoolRow): SealedPool => {
  const packs = JSON.parse(r.packs) as string[][];
  return { ...poolBase(r, packs), packSets: r.pack_sets ? (JSON.parse(r.pack_sets) as string[]) : packs.map(() => r.set_code) };
};
const poolBase = (r: PoolRow, packs: string[][]) => ({
  id: r.id,
  ownerHash: r.owner_hash,
  set: r.set_code,
  packs,
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
      kind       TEXT NOT NULL DEFAULT 'sealed',  -- 'sealed' = Pré-release (6 boosters de uma coleção); 'rush' = Pack Rush (várias)
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
  // Pack Rush: a coleção de cada booster (JSON string[]); no Selado de uma coleção fica nulo.
  const cols = (db.prepare('PRAGMA table_info(sealed_pools)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes('pack_sets')) db.exec('ALTER TABLE sealed_pools ADD COLUMN pack_sets TEXT');
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

/** Sorteia os 6 boosters da coleção, ou do Pack Rush (cada booster de uma das coleções da chave). */
function drawPacks(db: DB, key: string, seed: number[]): { sets: string[]; packs: string[][] } {
  const sets = rushSets(key);
  if (sets.length === 1) {
    const packs = openBoosters(setCards(db, key), seed);
    return { sets: packs.map(() => key), packs };
  }
  return openMixedBoosters(sets.map((set) => ({ set, cards: setCards(db, set) })), seed);
}

/**
 * Abre 6 boosters para o jogador e grava: de uma coleção (Selado) ou, com várias, um Pack Rush
 * (cada booster sorteado entre elas). Todas precisam estar disponíveis no Selado. O deck selado
 * mais antigo sai se o jogador já tem o teto.
 */
export function createPool(db: DB, ownerHash: string, sets: readonly string[]): SealedPool | null {
  const key = rushKey(sets);
  const chosen = rushSets(key);
  const available = new Set(sealedSets(db).map((s) => s.set));
  if (!chosen.length || chosen.length > RUSH_MAX_SETS || chosen.some((s) => !available.has(s))) return null;
  const seed = Array.from({ length: 4 }, () => randomInt(0, 0x1_0000_0000));
  const drawn = drawPacks(db, key, seed);
  const id = randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO sealed_pools (id, owner_hash, set_code, kind, seed, packs, pack_sets) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    ownerHash,
    key,
    isRush(key) ? 'rush' : 'sealed',
    JSON.stringify(seed),
    JSON.stringify(drawn.packs),
    isRush(key) ? JSON.stringify(drawn.sets) : null,
  );
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

/** As cartas do catálogo que aparecem na coleção aberta (e o Líder de 6 cores, que todo jogador tem); `extra`: o Líder de fora, no Pack Rush. */
export function poolCatalog(db: DB, pool: SealedPool, extra: string[] = []): Map<string, CardData> {
  const ids = [...new Set([...pool.packs.flat(), SEALED_LEADER_ID, ...extra])];
  return new Map((getCards(db, ids) as CardData[]).map((c) => [c.id, c]));
}

/** Regras do Líder: no Pack Rush (várias coleções), qualquer Líder do jogo; numa coleção só, os que saíram. */
export const poolRules = (pool: Pick<SealedPool, 'set'>): LimitedRules => (isRush(pool.set) ? { leaders: 'any', sets: rushSets(pool.set) } : {});

/** Nome do deck nas partidas: "Selado OP01" ou "Pack Rush OP01 + OP05". */
export const poolName = (pool: Pick<SealedPool, 'set'>) => playModeLabel({ format: 'sealed', sealedSet: pool.set });

/** Confere o deck contra a coleção aberta. */
export function checkDeck(db: DB, pool: SealedPool, deck: Pick<DeckList, 'leader' | 'cards'>) {
  const list: DeckList = { id: sealedDeckId(pool.id), name: poolName(pool), leader: deck.leader, cards: deck.cards };
  return validateLimitedDeck(list, poolCatalog(db, pool, [deck.leader, ...deck.cards.map((c) => c.id)].filter(Boolean)), poolCounts(pool.packs), poolRules(pool));
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
  pool.deck ? { id: sealedDeckId(pool.id), name: poolName(pool), leader: pool.deck.leader, cards: pool.deck.cards } : null;

/**
 * Deck do bot no Selado: ele abre os próprios 6 boosters da mesma coleção e monta sozinho, como o
 * "Montar sozinho" do jogador. Não fica gravado.
 */
export function botDeck(db: DB, set: string): DeckList | null {
  const key = rushKey(rushSets(set));
  if (rushSets(key).some((s) => !boosterReady(setCards(db, s)))) return null;
  const seed = Array.from({ length: 4 }, () => randomInt(0, 0x1_0000_0000));
  const pool = poolCounts(drawPacks(db, key, seed).packs);
  const catalog = new Map((getCards(db, [...pool.keys(), SEALED_LEADER_ID]) as CardData[]).map((c) => [c.id, c]));
  const deck: DeckList = { id: `${SEALED_DECK_PREFIX}bot`, name: poolName({ set: key }), ...autoBuildLimited(pool, catalog) };
  return validateLimitedDeck(deck, catalog, pool, poolRules({ set: key })).valid ? deck : null;
}
