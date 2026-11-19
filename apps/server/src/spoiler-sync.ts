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
// 6. Coleção que a API ainda não publicou e cuja data de lançamento (`release` do arquivo de
//    spoilers, no horário de Brasília) já chegou: a lista oficial da Bandai entra no lugar da
//    API (card-sources/bandai.ts) e a coleção vira oficial por ela. A coleção fica anotada
//    (set_releases): a cada rodada a lista é relida (artes e correções novas) e a API continua
//    sendo consultada; quando publica, a importação dela vale e a anotação sai.

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
import type { CardArt } from '@gumgum/engine';
import { brasiliaDate } from '@gumgum/engine';
import { bandaiSource } from './card-sources/bandai';
import { releaseFromOfficialList } from './config';
import {
  type DB,
  hasOfficialCards,
  listReleases,
  pendingSpoilers,
  pruneSpoilers,
  recordCardGaps,
  setListRelease,
  SPOILER_SOURCE,
  syncSpoilerArts,
  upsertCards,
} from './db';
import { DEFAULT_API_BASE, rowsOf } from './optcgapi';
import { readSpoilerFiles } from './seed';
import { OPTCGLEAKS } from './spoiler-feed';

export interface SpoilerFeedResult {
  /**
   * Por coleção: cartas gravadas e removidas (saíram do site) e, das cartas de outras coleções
   * reimpressas nela com arte nova, quantas artes entraram e saíram (`arts`, só quando mudou algo).
   */
  sets: Array<{ set: string; written: number; removed: number; arts?: { cards: number; added: number; removed: number } }>;
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
    // Cartas de outras coleções reimpressas nesta com arte nova: as artes vão para a carta já gravada.
    // Vale a primeira fonte que traz as artes da carta (como a imagem).
    const extraArts = new Map<string, CardArt[]>();
    for (const l of layers) for (const [id, arts] of l.extraArts ?? []) if (!extraArts.has(id)) extraArts.set(id, arts);
    o.onReport?.(set, report, chain);
    let written = 0;
    for (const source of new Set(cards.map((r) => r.source))) {
      const list = cards
        .filter((r) => r.source === source)
        .map((r) => ({ ...r.card, spoiler: { source: source.host, ...(source.pageUrl ? { url: source.pageUrl(set) } : {}) } }));
      written += upsertCards(db, list, { provisional: true, source: feedSource(source.host), feedArts: !errors.length }).written;
    }
    // Só apaga as cartas que sumiram quando todas as fontes responderam.
    const removed = errors.length ? 0 : pruneSpoilers(db, cards.map((r) => r.card.id), { source: feedSource('%'), set });
    // Sem nenhuma fonte de artes na rodada (fora do ar, ou a fonte não as tem), nada muda.
    const arts = layers.some((l) => l.extraArts) ? syncSpoilerArts(db, set, extraArts, { prune: !errors.length }) : { cards: 0, added: 0, removed: 0 };
    result.sets.push({ set, written, removed, ...(arts.cards ? { arts } : {}) });
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
  /** Coleções oficiais pela lista oficial nesta rodada (a API ainda não as publicou). */
  fromList: string[];
  errors: string[];
}

/** A lista oficial da Bandai no lugar da API para as coleções lançadas que ela ainda não publicou. */
export interface OfficialListOptions {
  source: CardSource;
  /** Data de lançamento de cada coleção (AAAA-MM-DD; `release` do arquivo de spoilers). */
  releases: ReadonlyMap<string, string>;
  /** A fonte traz imagens (com a CDN própria); sem elas, a carta fica com a imagem que já tinha. */
  images: boolean;
  now?: Date;
}

/** Datas de lançamento dos arquivos de spoilers (coleção -> AAAA-MM-DD). */
export function releaseDates(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const { file } of readSpoilerFiles(dir)) if (file.set && file.release) out.set(file.set.toUpperCase(), file.release);
  return out;
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
    /** Lista oficial para as coleções lançadas que a API ainda não tem (sem isto, só a API torna oficial). */
    officialList?: OfficialListOptions | null;
  },
): Promise<SpoilerSyncResult> {
  const get = opts.fetchJson ?? defaultFetch;
  const base = opts.base.replace(/\/$/, '');
  const before = pendingSpoilers(db);
  const pendingBySet = new Map<string, string[]>();
  for (const id of before) pendingBySet.set(setOf(id), [...(pendingBySet.get(setOf(id)) ?? []), id]);
  const result: SpoilerSyncResult = { pending: [...pendingBySet.keys()], official: [], imported: 0, fromList: [], errors: [] };
  // Coleções já oficiais pela lista também são procuradas na API, pelas cartas que o banco tem delas
  // (as oficiais primeiro: a que sobrou em spoiler pode nem existir).
  const awaiting = listReleases(db);
  const bySet = new Map(pendingBySet);
  const idsOfSet = db.prepare('SELECT id FROM cards WHERE set_code = ? ORDER BY provisional, id');
  for (const set of awaiting.keys()) bySet.set(set, (idsOfSet.all(set) as unknown as Array<{ id: string }>).map((r) => r.id));
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
    if (covered.has(set) || !ids.length) continue;
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
  // Só as coleções que a API trouxe inteiras: uma carta antiga reimpressa na coleção nova (SP) vem só
  // pelas artes, e buscar a coleção dela nas outras fontes regravaria a coleção toda sem a optcgapi.
  const apiSets = new Set(mapped.cards.filter((c) => !mapped.artOnly.has(c.id)).map((c) => c.set ?? c.id.split('-')[0]));

  // Lançadas que a API ainda não tem: a lista oficial entra no lugar dela. A que já virou oficial
  // pela lista é relida a cada rodada (as paralelas e as correções chegam depois do lançamento).
  const official = opts.officialList;
  const today = brasiliaDate(official?.now);
  // Coleção que já tem cartas oficiais sem ter vindo da lista (a API já a publicou e sobrou um spoiler
  // que ela não tem) fica de fora: a lista não passa por cima da API.
  const released = (set: string) => (official!.releases.get(set) ?? '9999') <= today && !hasOfficialCards(db, set);
  const due = official ? [...bySet.keys()].filter((set) => set !== PROMO_SET && !apiSets.has(set) && (awaiting.has(set) || released(set))) : [];
  let list: Layer | undefined;
  const listSets = new Set<string>();
  if (official && due.length) {
    try {
      const got = await official.source.fetch({ sets: due });
      for (const c of got.cards) {
        const set = c.set ?? c.id.split('-')[0];
        if (due.includes(set) && !got.artOnly?.has(c.id)) listSets.add(set);
      }
      if (listSets.size) list = { source: official.source, ...got };
    } catch (err) {
      result.errors.push(`${official.source.id}: ${errorText(err)}`);
    }
  }

  const sets = [...apiSets, ...listSets];
  const configured = opts.chain ?? chainFromEnv('official', { base, fetchJson: get });
  const stand = list ? [api, list] : [api];
  const layers: Layer[] = [];
  for (const source of configured) {
    if (source.id === 'optcgapi') layers.push(...stand);
    else if (sets.length) layers.push(...(await fetchLayers([source], sets, result.errors)));
  }
  if (!layers.includes(api)) layers.push(...stand);
  const { cards, report } = resolveChain(layers, { kind: 'official' });
  if (layers.length > 1 && cards.length) opts.onReport?.(report, layers.map((l) => l.source));
  result.imported = writeOfficial(db, cards, { keepImage: Boolean(list) && !official?.images });
  // A API publicou: a coleção deixa de esperar por ela. A lista tornou oficial: fica esperando.
  for (const set of awaiting.keys()) if (apiSets.has(set)) setListRelease(db, set, null);
  for (const set of listSets) setListRelease(db, set, list!.source.host);
  result.fromList = [...listSets].sort();
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
    /** Lista oficial para as coleções já lançadas (padrão: a da Bandai, conforme CARD_RELEASE_SOURCE); null desliga. */
    officialList?: Pick<OfficialListOptions, 'source' | 'now'> | null;
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
        feed.sets
          .map((s) => `${s.set} ${s.written} cartas${s.removed ? `, ${s.removed} removidas` : ''}${s.arts?.added ? `, ${s.arts.added} artes em ${s.arts.cards} cartas de outras coleções` : ''}`)
          .join(' | ') +
        (feed.errors.length ? ` | erros: ${feed.errors.join('; ')}` : ''),
    );
  }
  // As imagens da lista oficial só abrem pela CDN própria: sem ela, a lista só traz os dados.
  const images = Boolean(opts.cdn);
  const list = opts.officialList === undefined ? (releaseFromOfficialList() ? { source: bandaiSource({ images }) } : null) : opts.officialList;
  const sync = await syncSpoilers(db, {
    base: opts.base,
    fetchJson: opts.fetchJson,
    chain: chainFromEnv('official', ctx, cache),
    onReport: (r, chain) => report('Oficiais', 'official:sync', r, chain),
    officialList: list && { ...list, images, releases: releaseDates(opts.dir) },
  });
  if (sync.fromList.length) opts.log(`Oficiais pela lista da Bandai (a optcgapi ainda não publicou): ${sync.fromList.join(', ')}`);
  // Cartas que chegaram com efeito que o leitor não entende: aviso ao Dev (tela de Cobertura).
  const gaps = recordCardGaps(db);
  if (gaps.added) opts.log(`Cobertura: ${gaps.added} carta(s) nova(s) com efeito parcial ou manual (⚙)`);
  if (opts.cdn) await syncCardCdn(db, opts.cdn, { maxDownloads: opts.cdnMaxDownloads, log: opts.log });
  return { feed, sync, gaps };
}

/**
 * Quanto falta (ms) para o primeiro minuto de cada dia de lançamento que ainda não chegou, no
 * horário de Brasília (UTC−3): 00:01 de 20/11 = 03:01 UTC. Datas além do limite do `setTimeout`
 * (~24 dias) ficam para depois de um reinício.
 */
export function releaseRoundDelays(releases: ReadonlyMap<string, string>, now: Date = new Date()): number[] {
  const out: number[] = [];
  for (const date of new Set(releases.values())) {
    const wait = Date.parse(`${date}T03:01:00Z`) - now.getTime();
    if (wait > 0 && wait < 2 ** 31) out.push(wait);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Busca os spoilers e troca pelos oficiais ao iniciar e depois a cada `hours` horas.
 * A primeira rodada espera alguns segundos para não atrasar a subida do servidor.
 * Com a lista oficial ligada (CARD_RELEASE_SOURCE), há também uma rodada logo depois da
 * meia-noite de cada dia de lançamento: a coleção vira oficial sem esperar o intervalo.
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
  if (releaseFromOfficialList()) for (const wait of releaseRoundDelays(releaseDates(opts.dir))) setTimeout(run, wait).unref();
}
