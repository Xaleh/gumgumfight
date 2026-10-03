// Troca as cartas de spoiler pelas oficiais assim que a optcgapi as publica.
//
// 1. Junta as coleções das cartas de spoiler pendentes (OP18, EB05...).
// 2. Procura essas coleções em /allSets/ e /allDecks/. A API às vezes junta duas
//    coleções num id só ("OP14-EB04"), por isso compara cada parte do id.
// 3. Coleção encontrada: importa a coleção inteira (as cartas oficiais substituem as de spoiler).
// 4. Coleção ainda não listada: testa uma carta em /sets/card/<id>/; se ela já existir,
//    busca as demais cartas de spoiler dessa coleção uma a uma.

import { importBodies, type FetchJson, fetchJson as defaultFetch, HttpError } from './card-import';
import { type DB, pendingSpoilers } from './db';
import { rowsOf } from './optcgapi';

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
 * Sincroniza ao iniciar e depois a cada `hours` horas. A primeira rodada espera
 * alguns segundos para não atrasar a subida do servidor.
 */
export function scheduleSpoilerSync(db: DB, opts: { base: string; hours: number; log: (msg: string) => void }) {
  const run = async () => {
    try {
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
