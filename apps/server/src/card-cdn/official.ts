// Imagens oficiais da Bandai para as cartas que nenhuma fonte de dados traz com imagem (promos
// japonesas, cartas que só o Cardkaizoku tem, desenhos provisórios da optcgapi).
//
// As listas oficiais de cada região usam o mesmo sistema:
//   <base>/cardlist/                  <select name="series"> com as coleções ("... [OP-17]", "Promotion card")
//   <base>/cardlist/?series=<id>      um <dl class="modalCol" id="P-135"> por impressão, com a imagem em
//                                     ../images/cardlist/card/P-135.png e o produto em <div class="getInfo">
//
// Ordem de busca (CARD_IMAGE_SOURCES): inglês, inglês da Ásia e japonês. A primeira região que tem a
// carta vence; a imagem vai para a CDN própria com o idioma na chave (/P/jp/P-152.png).
// Só as coleções das cartas que faltam são consultadas, e cada coleção no máximo uma vez por dia.

import { CARD_IMAGE_ORIGINS, type CardArt, type CardData } from '@gumgum/engine';
import { type DB, transaction } from '../db';
import { networkCause } from './r2';

export interface BandaiRegion {
  /** Nome em CARD_IMAGE_SOURCES e origem do /card-img/. */
  id: string;
  base: string;
  /** Idioma da impressão (vai na chave da CDN e em `imageLang`). */
  lang: string;
}

export const BANDAI_REGIONS: BandaiRegion[] = [
  { id: 'bandai-en', base: 'https://en.onepiece-cardgame.com', lang: 'en' },
  { id: 'bandai-asia', base: 'https://asia-en.onepiece-cardgame.com', lang: 'en' },
  { id: 'bandai-jp', base: 'https://www.onepiece-cardgame.com', lang: 'jp' },
];

// As imagens oficiais entram na lista de origens aceitas (cópia para a CDN e /card-img/).
for (const r of BANDAI_REGIONS) CARD_IMAGE_ORIGINS[r.id] ??= `${r.base}/images/cardlist/card/`;

/** Regiões em ordem de prioridade (CARD_IMAGE_SOURCES; padrão: todas; "off" desliga). */
export function imageRegionsFromEnv(env: NodeJS.ProcessEnv = process.env): BandaiRegion[] {
  const raw = env.CARD_IMAGE_SOURCES?.trim();
  if (!raw) return BANDAI_REGIONS;
  if (/^(off|0|false|no|nao|não)$/i.test(raw)) return [];
  return raw
    .toLowerCase()
    .split(/[\s,]+/)
    .map((id) => BANDAI_REGIONS.find((r) => r.id === id))
    .filter((r): r is BandaiRegion => Boolean(r));
}

/** Idioma de uma imagem pela origem (as fontes de dados são todas em inglês). */
export function imageLang(url: string): string {
  return BANDAI_REGIONS.find((r) => url.startsWith(`${r.base}/`))?.lang ?? 'en';
}

const decode = (s: string) =>
  s
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export interface BandaiSeries {
  id: string;
  label: string;
  /** Coleções da série ("OP15", "EB04"); sem código entre colchetes = promocionais ("P"), como "Family Deck Set". */
  sets: string[];
}

/** "OP-17" -> ["OP17"]; "OP15-EB04" -> ["OP15", "EB04"] (como os ids de coleção da optcgapi). */
const setCodes = (code: string) => [...code.toUpperCase().matchAll(/([A-Z]+)-?(\d+)/g)].map((m) => `${m[1]}${m[2]}`);

/** As coleções do <select name="series"> da lista oficial. */
export function parseSeriesList(html: string): BandaiSeries[] {
  const select = html.match(/<select[^>]*name="series"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? '';
  const out: BandaiSeries[] = [];
  for (const m of select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const label = decode(decode(m[2]));
    // Colchetes comuns no inglês ("[OP-17]") e japoneses no site do Japão ("【OP-17】").
    const codes = [...label.matchAll(/[[【]([A-Z]+-?\d+(?:-[A-Z]+-?\d+)*)[\]】]/g)].flatMap((c) => setCodes(c[1]));
    out.push({ id: m[1], label, sets: codes.length ? codes : ['P'] });
  }
  return out;
}

export interface BandaiPrint {
  /** Impressão como a Bandai numera ("P-135_p1"). */
  variant: string;
  cardId: string;
  imageUrl: string;
  /** Produto em que saiu (<div class="getInfo">). */
  label?: string;
}

/** As impressões de uma página de coleção. */
export function parseCardList(html: string, base: string): BandaiPrint[] {
  const out: BandaiPrint[] = [];
  for (const m of html.matchAll(/<dl class="modalCol" id="([^"]+)">([\s\S]*?)<\/dl>/g)) {
    const variant = m[1].trim();
    const cardId = variant.replace(/_[a-z]+\d*$/i, '').toUpperCase();
    if (!/^[A-Z]+\d*-\d+$/.test(cardId)) continue;
    const src = m[2].match(/data-src="([^"]*images\/cardlist\/card\/[^"]+)"/)?.[1];
    if (!src) continue;
    const imageUrl = new URL(src, `${base}/cardlist/`).href.replace(/\?.*$/, '');
    // No site japonês o produto vem seguido de um botão ("<div class="getInfoBtnCol">…"): para antes dele.
    const info = m[2].match(/<div class="getInfo">\s*<h3>[\s\S]*?<\/h3>([\s\S]*?)(?:<div|<\/div>)/)?.[1];
    const label = info ? decode(info) : '';
    out.push({ variant, cardId, imageUrl, ...(label && label !== '-' ? { label } : {}) });
  }
  return out;
}

export type FetchText = (url: string) => Promise<string>;

export const fetchText: FetchText = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'gumgumfight-importer' }, signal: AbortSignal.timeout(30_000) }).catch(
    (err: unknown) => {
      throw new Error(`${new URL(url).host}: ${networkCause(err)}`);
    },
  );
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  return res.text();
};

export interface OfficialImagesResult {
  /** Cartas que ganharam imagem oficial nesta rodada. */
  filled: number;
  /** Cartas ainda sem imagem (nenhuma região tem). */
  missing: string[];
  /** Páginas de coleção consultadas nas listas oficiais. */
  pages: number;
  errors: string[];
}

/** Imagem que já se sabe que não serve (desenho provisório em SVG da optcgapi, por exemplo). */
const isRejected = (db: DB, url: string) =>
  Boolean(db.prepare("SELECT 1 FROM card_images WHERE source_url = ? AND object_key = ''").get(url));

/**
 * Dá a imagem oficial às cartas sem imagem (ou com uma imagem recusada). O que as listas oficiais
 * mostram fica guardado (card_official_images), então reimportar a carta não consulta a Bandai de novo.
 */
export async function fillOfficialImages(
  db: DB,
  regions: BandaiRegion[],
  opts: { fetchText?: FetchText; now?: Date; recheckHours?: number; delayMs?: number; log?: (msg: string) => void } = {},
): Promise<OfficialImagesResult> {
  const get = opts.fetchText ?? fetchText;
  const now = opts.now ?? new Date();
  const result: OfficialImagesResult = { filled: 0, missing: [], pages: 0, errors: [] };
  const rows = db.prepare('SELECT id, set_code, data FROM cards ORDER BY id').all() as Array<{ id: string; set_code: string; data: string }>;
  const missing = new Map<string, CardData>();
  for (const r of rows) {
    const c = JSON.parse(r.data) as CardData;
    if (!c.imageUrl || isRejected(db, c.imageUrl)) missing.set(c.id, c);
  }
  if (!missing.size || !regions.length) return { ...result, missing: [...missing.keys()] };

  const known = db.prepare('SELECT variant, region, image_url, label FROM card_official_images WHERE card_id = ?');
  const found = (id: string) => known.all(id) as Array<{ variant: string; region: string; image_url: string; label: string | null }>;

  // Consulta as listas oficiais só para as coleções que ainda têm carta sem imagem conhecida.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const save = db.prepare(
    'INSERT OR REPLACE INTO card_official_images (card_id, variant, region, lang, image_url, label) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const checked = db.prepare('SELECT checked_at FROM card_official_checks WHERE region = ? AND series = ?');
  const markChecked = db.prepare('INSERT OR REPLACE INTO card_official_checks (region, series, checked_at) VALUES (?, ?, ?)');
  const recheckMs = (opts.recheckHours ?? 24) * 3600_000;
  for (const region of regions) {
    const sets = new Set([...missing.values()].filter((c) => !found(c.id).length).map((c) => c.set ?? c.id.split('-')[0]));
    if (!sets.size) break;
    let series: BandaiSeries[];
    try {
      series = parseSeriesList(await get(`${region.base}/cardlist/`));
      result.pages++;
    } catch (err) {
      result.errors.push(`${region.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const s of series.filter((x) => x.sets.some((set) => sets.has(set)))) {
      const last = checked.get(region.id, s.id) as { checked_at: string } | undefined;
      if (last && now.getTime() - Date.parse(last.checked_at) < recheckMs) continue;
      try {
        if (result.pages && opts.delayMs !== 0) await sleep(opts.delayMs ?? 1000);
        const prints = parseCardList(await get(`${region.base}/cardlist/?series=${s.id}`), region.base);
        result.pages++;
        transaction(db, () => {
          for (const p of prints) save.run(p.cardId, p.variant, region.id, region.lang, p.imageUrl, p.label ?? null);
          markChecked.run(region.id, s.id, now.toISOString());
        });
      } catch (err) {
        result.errors.push(`${region.id} ${s.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Aplica: a região de maior prioridade que tem a carta; a impressão base vira a imagem e as outras, artes.
  const order = new Map(regions.map((r, i) => [r.id, i]));
  const update = db.prepare('UPDATE cards SET data = ? WHERE id = ?');
  transaction(db, () => {
    for (const [id, c] of missing) {
      const prints = found(id)
        .filter((p) => order.has(p.region))
        .sort((a, b) => order.get(a.region)! - order.get(b.region)!);
      if (!prints.length) {
        result.missing.push(id);
        continue;
      }
      const region = prints[0].region;
      const same = prints.filter((p) => p.region === region);
      const main = same.find((p) => p.variant.toUpperCase() === id) ?? same[0];
      const lang = BANDAI_REGIONS.find((r) => r.id === region)?.lang ?? 'en';
      const arts: CardArt[] = c.arts?.length
        ? c.arts
        : same.filter((p) => p !== main).map((p) => ({ id: p.variant, imageUrl: p.image_url, ...(p.label ? { label: p.label } : {}) }));
      const card: CardData = {
        ...c,
        imageUrl: main.image_url,
        ...(arts.length ? { arts } : {}),
        ...(lang !== 'en' ? { imageLang: lang } : {}),
      };
      update.run(JSON.stringify(card), id);
      result.filled++;
    }
  });
  if (result.filled || result.errors.length) {
    opts.log?.(
      `Imagens oficiais: ${result.filled} cartas ganharam imagem, ${result.missing.length} ainda sem` +
        (result.pages ? `, ${result.pages} páginas consultadas` : '') +
        (result.errors.length ? ` | erros: ${result.errors.slice(0, 3).join('; ')}` : ''),
    );
  }
  return result;
}
