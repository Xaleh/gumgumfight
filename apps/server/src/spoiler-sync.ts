// Spoilers: busca automática nos sites de spoiler e troca pelas cartas oficiais
// assim que a optcgapi as publica.
//
// Busca automática (refreshSpoilerFeeds): cada data/spoilers/<coleção>.json com
// "feed" baixa as cartas das fontes de SPOILER_SOURCES (padrão: optcgleaks), juntadas
// pela cadeia (card-sources/chain.ts); as escritas à mão no arquivo têm prioridade.
//
// Troca pelas oficiais (syncSpoilers):
// 1. Junta as coleções das cartas de spoiler pendentes (OP18, EB05...).
// 2. Procura essas coleções em /allSets/ e /allDecks/. A API às vezes junta duas
//    coleções num id só ("OP14-EB04"), por isso compara cada parte do id.
// 3. Coleção encontrada: importa a coleção inteira (as cartas oficiais substituem as de spoiler).
// 4. Coleção ainda não listada: testa uma carta em /sets/card/<id>/; se ela já existir,
//    busca as demais cartas de spoiler dessa coleção uma a uma. Promocionais anunciadas (P-)
//    são procuradas em /allPromos/.
// 5. As cartas que a API publicou passam pela cadeia de CARD_SOURCES (outras fontes oficiais
//    com prioridade maior completam ou corrigem os dados da API).

import { type FetchJson, fetchJson as defaultFetch, HttpError, mapApiBodies } from './card-import';
import {
  buildChain,
  type CardSource,
  type ChainReport,
  chainNames,
  formatReport,
  type Layer,
  resolveChain,
  saveDiffReport,
  type SourceKind,
  writeOfficial,
} from './card-sources';
import { type ImageStore, syncCardCdn } from './card-cdn';
import { type DB, hasOfficialCards, pendingSpoilers, pruneSpoilers, recordCardGaps, SPOILER_SOURCE, upsertCards } from './db';
import { DEFAULT_API_BASE, rowsOf } from './optcgapi';
import { readSpoilerFiles } from './seed';
import { OPTCGLEAKS } from './spoiler-feed';

export interface SpoilerFeedResult {
  /** Por coleção: cartas gravadas e removidas (saíram do site). */
  sets: Array<{ set: string; written: number; removed: number }>;
  errors: string[];
}

/** Origem das cartas baixadas automaticamente de um site ("spoiler:feed:optcgleaks.com"). */
export const feedSource = (host: string) => `${SPOILER_SOURCE}feed:${host}`;
export const FEED_SOURCE = feedSource(OPTCGLEAKS);

/** Coleção das promocionais (P-001...). */
const PROMO_SET = 'P';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Busca as coleções em cada fonte da cadeia; 404 = a fonte não tem a coleção (não é erro). */
async function fetchLayers(chain: CardSource[], sets: string[] | undefined, errors: string[]): Promise<Layer[]> {
  const layers: Layer[] = [];
  for (const source of chain) {
    try {
      layers.push({ source, ...(await source.fetch({ sets })) });
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) errors.push(`${source.id}: ${errorText(err)}`);
    }
  }
  return layers;
}

export interface FeedOptions {
  fetchJson?: FetchJson;
  /** Fontes de spoiler, em ordem de prioridade (padrão: SPOILER_SOURCES). */
  chain?: CardSource[];
  /** Relatório da cadeia de cada coleção (fontes por carta, divergências). */
  onReport?: (set: string, report: ChainReport, chain: CardSource[]) => void;
}

/** A cadeia de uma rodada, a partir do ambiente (CARD_SOURCES / SPOILER_SOURCES). */
export function chainFromEnv(kind: SourceKind, ctx: { base?: string; fetchJson?: FetchJson }, cache?: Map<string, CardSource>) {
  return buildChain(chainNames(kind).names, { base: ctx.base ?? DEFAULT_API_BASE, fetchJson: ctx.fetchJson ?? defaultFetch }, cache);
}

/**
 * Baixa os spoilers das coleções com "feed" nos arquivos. Coleções que já saíram na
 * API oficial não são mais consultadas. Uma resposta vazia não apaga nada (o site
 * pode estar fora do ar ou mudando), nem uma rodada em que alguma fonte falhou.
 */
export async function refreshSpoilerFeeds(db: DB, dir: string, opts: FetchJson | FeedOptions = {}): Promise<SpoilerFeedResult> {
  const o: FeedOptions = typeof opts === 'function' ? { fetchJson: opts } : opts;
  const chain = o.chain ?? chainFromEnv('spoiler', { fetchJson: o.fetchJson });
  const result: SpoilerFeedResult = { sets: [], errors: [] };
  for (const { file, cards: manual } of readSpoilerFiles(dir)) {
    if (!file.feed || !file.set) continue;
    const set = file.set.toUpperCase();
    // Promocionais saem uma a uma: a coleção "P" nunca fica toda oficial (as oficiais não são sobrescritas).
    if (set !== PROMO_SET && hasOfficialCards(db, set)) continue;
    const errors: string[] = [];
    const handWritten = new Set(manual.map((c) => c.id));
    const layers = (await fetchLayers(chain, [set], errors)).map((l) => ({
      ...l,
      cards: l.cards.filter((c) => c.set === set && !handWritten.has(c.id)),
    }));
    result.errors.push(...errors);
    const { cards, report } = resolveChain(layers, { kind: 'spoiler' });
    if (!cards.length) continue;
    o.onReport?.(set, report, chain);
    let written = 0;
    for (const source of new Set(cards.map((r) => r.source))) {
      const list = cards
        .filter((r) => r.source === source)
        .map((r) => ({ ...r.card, spoiler: { source: source.host, ...(source.pageUrl ? { url: source.pageUrl(set) } : {}) } }));
      written += upsertCards(db, list, { provisional: true, source: feedSource(source.host) }).written;
    }
    // Só apaga as cartas que sumiram quando todas as fontes responderam.
    const removed = errors.length ? 0 : pruneSpoilers(db, cards.map((r) => r.card.id), { source: feedSource('%'), set });
    result.sets.push({ set, written, removed });
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
  opts: {
    base: string;
    fetchJson?: FetchJson;
    /** Fontes oficiais, em ordem de prioridade (padrão: CARD_SOURCES); a optcgapi entra no lugar dela. */
    chain?: CardSource[];
    onReport?: (report: ChainReport, chain: CardSource[]) => void;
  },
): Promise<SpoilerSyncResult> {
  const get = opts.fetchJson ?? defaultFetch;
  const base = opts.base.replace(/\/$/, '');
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
  // Promocionais: a lista inteira (as novas aparecem nela, não em /allSets/).
  if (bySet.has(PROMO_SET)) {
    endpoints.push(`${base}/allPromos/`);
    covered.add(PROMO_SET);
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

  // A optcgapi é quem diz que a coleção saiu; as outras fontes oficiais da cadeia entram
  // só nas coleções que ela publicou, cada uma na sua posição (sem a optcgapi na cadeia, ela fica no fim).
  const mapped = mapApiBodies(bodies);
  const api: Layer = { source: { id: 'optcgapi', host: new URL(base).host, fetch: async () => mapped }, ...mapped };
  const sets = [...new Set(mapped.cards.map((c) => c.set ?? c.id.split('-')[0]))];
  const configured = opts.chain ?? chainFromEnv('official', { base, fetchJson: get });
  const layers: Layer[] = [];
  for (const source of configured) {
    if (source.id === 'optcgapi') layers.push(api);
    else if (sets.length) layers.push(...(await fetchLayers([source], sets, result.errors)));
  }
  if (!layers.includes(api)) layers.push(api);
  const { cards, report } = resolveChain(layers, { kind: 'official' });
  if (layers.length > 1 && cards.length) opts.onReport?.(report, layers.map((l) => l.source));
  result.imported = writeOfficial(db, cards);
  const still = new Set(pendingSpoilers(db));
  result.official = before.filter((id) => !still.has(id));
  return result;
}

/**
 * Uma rodada completa: baixa os spoilers e troca os que já saíram pelos oficiais, com as
 * cadeias do ambiente (uma fonte usada nas duas é baixada uma vez só). As divergências entre
 * fontes vão para o log e para var/card-source-diff.json.
 */
export async function spoilerRound(
  db: DB,
  opts: {
    base: string;
    dir: string;
    log: (msg: string) => void;
    fetchJson?: FetchJson;
    /** CDN própria: no fim da rodada copia as imagens novas (até `cdnMaxDownloads`). */
    cdn?: ImageStore | null;
    cdnMaxDownloads?: number;
  },
) {
  const cache = new Map<string, CardSource>();
  const ctx = { base: opts.base, fetchJson: opts.fetchJson };
  for (const kind of ['spoiler', 'official'] as const) for (const w of chainNames(kind).warnings) opts.log(`Fontes das cartas: ${w}`);
  const spoilerChain = chainFromEnv('spoiler', ctx, cache);
  // Com mais de uma fonte: resumo no log e detalhes (divergências por carta) no arquivo.
  const report = (label: string, key: string, r: ChainReport, chain: CardSource[]) => {
    if (chain.length < 2) return;
    for (const line of formatReport(r)) opts.log(`${label}: ${line}`);
    saveDiffReport(key, chain, r);
  };
  const feed = await refreshSpoilerFeeds(db, opts.dir, {
    chain: spoilerChain,
    onReport: (set, r, chain) => report(`Spoilers ${set}`, `spoiler:${set}`, r, chain),
  });
  if (feed.sets.length || feed.errors.length) {
    opts.log(
      `Spoilers (${spoilerChain.map((s) => s.host).join(' > ')}): ` +
        feed.sets.map((s) => `${s.set} ${s.written} cartas${s.removed ? `, ${s.removed} removidas` : ''}`).join(' | ') +
        (feed.errors.length ? ` | erros: ${feed.errors.join('; ')}` : ''),
    );
  }
  const sync = await syncSpoilers(db, {
    base: opts.base,
    fetchJson: opts.fetchJson,
    chain: chainFromEnv('official', ctx, cache),
    onReport: (r, chain) => report('Oficiais', 'official:sync', r, chain),
  });
  // Cartas que chegaram com efeito que o leitor não entende: aviso ao Dev (tela de Cobertura).
  const gaps = recordCardGaps(db);
  if (gaps.added) opts.log(`Cobertura: ${gaps.added} carta(s) nova(s) com efeito parcial ou manual (⚙)`);
  if (opts.cdn) await syncCardCdn(db, opts.cdn, { maxDownloads: opts.cdnMaxDownloads, log: opts.log });
  return { feed, sync, gaps };
}

/**
 * Busca os spoilers e troca pelos oficiais ao iniciar e depois a cada `hours` horas.
 * A primeira rodada espera alguns segundos para não atrasar a subida do servidor.
 */
export function scheduleSpoilerSync(
  db: DB,
  opts: { base: string; dir: string; hours: number; log: (msg: string) => void; cdn?: ImageStore | null },
) {
  let running = false;
  const run = async () => {
    // A primeira cópia das imagens para a CDN pode demorar mais que o intervalo.
    if (running) return;
    running = true;
    try {
      const { sync: r } = await spoilerRound(db, { ...opts, cdnMaxDownloads: 500 });
      if (!r.pending.length) return;
      opts.log(
        `Spoilers (${r.pending.join(', ')}): ${r.official.length} carta(s) agora oficiais` +
          (r.errors.length ? ` | erros: ${r.errors.join('; ')}` : ''),
      );
    } catch (err) {
      opts.log(`Spoilers: falha na sincronização: ${errorText(err)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 15_000).unref();
  setInterval(run, opts.hours * 3600_000).unref();
}
