// Spoilers: busca automática nos sites de spoiler e troca pelas cartas oficiais
// assim que a optcgapi as publica.
//
// Busca automática (refreshSpoilerFeeds): cada data/spoilers/<coleção>.json com
// "feed" baixa as cartas do site; as escritas à mão no arquivo têm prioridade.
//
// Troca pelas oficiais (syncSpoilers):
// 1. Junta as coleções das cartas de spoiler pendentes (OP18, EB05...).
// 2. Procura essas coleções em /allSets/ e /allDecks/. A API às vezes junta duas
//    coleções num id só ("OP14-EB04"), por isso compara cada parte do id.
// 3. Coleção encontrada: importa a coleção inteira (as cartas oficiais substituem as de spoiler).
// 4. Coleção ainda não listada: testa uma carta em /sets/card/<id>/; se ela já existir,
//    busca as demais cartas de spoiler dessa coleção uma a uma.

import { importBodies, type FetchJson, fetchJson as defaultFetch, HttpError } from './card-import';
import { type DB, hasOfficialCards, pendingSpoilers, pruneSpoilers, SPOILER_SOURCE, upsertCards } from './db';
import { rowsOf } from './optcgapi';
import { readSpoilerFiles } from './seed';
import { fetchOptcgLeaksSet, OPTCGLEAKS } from './spoiler-feed';

export interface SpoilerFeedResult {
  /** Por coleção: cartas gravadas e removidas (saíram do site). */
  sets: Array<{ set: string; written: number; removed: number }>;
  errors: string[];
}

/** Origem das cartas baixadas automaticamente. */
export const FEED_SOURCE = `${SPOILER_SOURCE}feed:${OPTCGLEAKS}`;

/**
 * Baixa os spoilers das coleções com "feed" nos arquivos. Coleções que já saíram na
 * API oficial não são mais consultadas. Uma resposta vazia não apaga nada (o site
 * pode estar fora do ar ou mudando).
 */
export async function refreshSpoilerFeeds(db: DB, dir: string, fetchJson: FetchJson = defaultFetch): Promise<SpoilerFeedResult> {
  const result: SpoilerFeedResult = { sets: [], errors: [] };
  for (const { file, cards: manual } of readSpoilerFiles(dir)) {
    if (file.feed !== 'optcgleaks' || !file.set) continue;
    const set = file.set.toUpperCase();
    if (hasOfficialCards(db, set)) continue;
    try {
      const handWritten = new Set(manual.map((c) => c.id));
      const cards = (await fetchOptcgLeaksSet(set, fetchJson)).filter((c) => !handWritten.has(c.id));
      if (!cards.length) continue;
      const { written } = upsertCards(db, cards, { provisional: true, source: FEED_SOURCE });
      const removed = pruneSpoilers(db, cards.map((c) => c.id), { source: FEED_SOURCE, set });
      result.sets.push({ set, written, removed });
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}

export interface SpoilerSyncResult {
  /** Coleções com spoilers pendentes antes da sincronização. */
  pending: string[];
  /** Cartas de spoiler que agora são oficiais. */
  official: string[];
  /** Total de cartas gravadas da API (inclui as que não tinham spoiler). */
  imported: number;
  errors: string[];
}

const setOf = (id: string) => id.split('-')[0];

/** "OP-18" -> ["OP18"]; "OP14-EB04" -> ["OP14", "EB04"]. */
export function setCodes(apiSetId: string): string[] {
  return [...apiSetId.toUpperCase().matchAll(/([A-Z]+)-?(\d+)/g)].map((m) => `${m[1]}${m[2]}`);
}

export async function syncSpoilers(
  db: DB,
  opts: { base: string; fetchJson?: FetchJson; source?: string },
): Promise<SpoilerSyncResult> {
  const get = opts.fetchJson ?? defaultFetch;
  const base = opts.base.replace(/\/$/, '');
  const source = opts.source ?? `api:${new URL(base).host}`;
  const before = pendingSpoilers(db);
  const bySet = new Map<string, string[]>();
  for (const id of before) bySet.set(setOf(id), [...(bySet.get(setOf(id)) ?? []), id]);
  const result: SpoilerSyncResult = { pending: [...bySet.keys()], official: [], imported: 0, errors: [] };
  if (!bySet.size) return result;

  const tryGet = async (url: string): Promise<unknown | null> => {
    try {
      return await get(url);
    } catch (err) {
      // 404 = ainda não publicado; o resto é registrado.
      if (!(err instanceof HttpError && err.status === 404)) result.errors.push(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  // Coleções e starter decks que a API já lista.
  const endpoints: string[] = [];
  const covered = new Set<string>();
  const lists: Array<[string, string, string]> = [
    ['allSets', 'set_id', 'sets'],
    ['allDecks', 'structure_deck_id', 'decks'],
  ];
  for (const [list, key, path] of lists) {
    for (const row of rowsOf(await tryGet(`${base}/${list}/`))) {
      const apiId = String(row[key] ?? '');
      const codes = setCodes(apiId).filter((c) => bySet.has(c));
      if (!codes.length) continue;
      endpoints.push(`${base}/${path}/${apiId}/`);
      codes.forEach((c) => covered.add(c));
    }
  }
  const bodies: unknown[] = [];
  for (const url of endpoints) {
    const body = await tryGet(url);
    if (body) bodies.push(body);
  }

  // Coleção ainda não listada: as cartas podem já existir uma a uma.
  for (const [set, ids] of bySet) {
    if (covered.has(set)) continue;
    const first = await tryGet(`${base}/sets/card/${ids[0]}/`);
    if (!rowsOf(first).length) continue;
    bodies.push(first);
    for (const id of ids.slice(1)) {
      const body = await tryGet(`${base}/sets/card/${id}/`);
      if (body) bodies.push(body);
    }
  }

  result.imported = importBodies(db, bodies, source).length;
  const still = new Set(pendingSpoilers(db));
  result.official = before.filter((id) => !still.has(id));
  return result;
}

/**
 * Busca os spoilers e troca pelos oficiais ao iniciar e depois a cada `hours` horas.
 * A primeira rodada espera alguns segundos para não atrasar a subida do servidor.
 */
export function scheduleSpoilerSync(db: DB, opts: { base: string; dir: string; hours: number; log: (msg: string) => void }) {
  const run = async () => {
    try {
      const feed = await refreshSpoilerFeeds(db, opts.dir);
      if (feed.sets.length || feed.errors.length) {
        opts.log(
          `Spoilers (${OPTCGLEAKS}): ` +
            feed.sets.map((s) => `${s.set} ${s.written} cartas${s.removed ? `, ${s.removed} removidas` : ''}`).join(' | ') +
            (feed.errors.length ? ` | erros: ${feed.errors.join('; ')}` : ''),
        );
      }
      const r = await syncSpoilers(db, { base: opts.base });
      if (!r.pending.length) return;
      opts.log(
        `Spoilers (${r.pending.join(', ')}): ${r.official.length} carta(s) agora oficiais` +
          (r.errors.length ? ` | erros: ${r.errors.join('; ')}` : ''),
      );
    } catch (err) {
      opts.log(`Spoilers: falha na sincronização: ${err instanceof Error ? err.message : err}`);
    }
  };
  setTimeout(run, 15_000).unref();
  setInterval(run, opts.hours * 3600_000).unref();
}
