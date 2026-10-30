// CDN própria das imagens das cartas (Cloudflare R2 num domínio nosso).
//
// As fontes de dados (optcgapi, optcgleaks...) continuam dizendo de onde vem cada imagem; aqui
// cada imagem é baixada uma vez, gravada no bucket e a carta passa a apontar para a CDN:
//
//   <CARD_CDN_URL>/<coleção>/<idioma>/<arte>.<ext>?v=<hash>     ex.: /OP01/en/OP01-016_p1.png?v=3f2a…
//   <CARD_CDN_URL>/index.json                                    todas as cartas -> imagens (para parceiros)
//   <CARD_CDN_URL>/cards/v1/manifest.json, cards/v1/sets/<coleção>.json   dados das cartas (data.ts)
//
// O objeto de uma arte fica sempre na mesma chave; o `?v=` (hash do conteúdo) muda quando a
// imagem muda, então o cache pode ser eterno. Imagens do Cardkaizoku nunca entram (termos de uso).
//
// Variáveis: CARD_CDN_URL (endereço público do bucket), R2_ACCOUNT_ID, R2_BUCKET,
// R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY (token do R2 com leitura e escrita só nesse bucket).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CARD_IMAGE_ORIGINS, type CardArt, type CardData } from '@gumgum/engine';
import { type DB, transaction } from '../db';
import { artId } from '../optcgapi';
import { type BandaiRegion, fillOfficialImages, type FetchText, imageLang, imageRegionsFromEnv } from './official';
import { publishCardData } from './data';
import { networkCause, type R2Config, R2Error, r2Client } from './r2';

export { CARD_DATA_PREFIX, CARD_DATA_SCHEMA, type CardDataManifest, type PartnerCard, publishCardData, toPartnerCard } from './data';

/** Onde as imagens ficam guardadas. */
export interface ImageStore {
  /** Endereço público, sem barra no fim. */
  publicBase: string;
  has(key: string): Promise<boolean>;
  put(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void>;
}

/** Cache das imagens: o endereço muda quando o conteúdo muda (`?v=`). */
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function r2Store(cfg: R2Config & { publicBase: string }, fetchImpl?: typeof fetch): ImageStore {
  const client = r2Client(cfg, fetchImpl);
  return { publicBase: cfg.publicBase.replace(/\/+$/, ''), has: client.has, put: client.put };
}

/** Pasta local no lugar do bucket (desenvolvimento e testes). */
export function dirStore(dir: string, publicBase: string): ImageStore {
  return {
    publicBase: publicBase.replace(/\/+$/, ''),
    has: async (key) => existsSync(join(dir, key)),
    put: async (key, body) => {
      mkdirSync(dirname(join(dir, key)), { recursive: true });
      writeFileSync(join(dir, key), body);
    },
  };
}

/** A CDN configurada no ambiente; null sem CARD_CDN_URL ou sem as credenciais do R2. */
export function cdnFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): ImageStore | null {
  const publicBase = env.CARD_CDN_URL?.trim();
  const cfg = {
    accountId: env.R2_ACCOUNT_ID?.trim() ?? '',
    bucket: env.R2_BUCKET?.trim() ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim() ?? '',
  };
  if (!publicBase || Object.values(cfg).some((v) => !v)) return null;
  return r2Store({ ...cfg, publicBase, ...(env.R2_ENDPOINT?.trim() ? { endpoint: env.R2_ENDPOINT.trim() } : {}) }, fetchImpl);
}

/** Endereço público da CDN (CARD_CDN_URL), para o navegador e o proxy /card-img/cdn/. */
export const cardCdnUrl = (env: NodeJS.ProcessEnv = process.env) => env.CARD_CDN_URL?.trim().replace(/\/+$/, '') || null;

const MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Tipo pelo conteúdo: a optcgapi manda PNG com `content-type: image/jpeg`. */
export function sniffImageType(body: Buffer): string | null {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Só copia de origens conhecidas (as mesmas do /card-img/), nunca da própria CDN. */
const allowedSource = (url: string) => Object.entries(CARD_IMAGE_ORIGINS).some(([k, base]) => k !== 'cdn' && url.startsWith(base));

interface Mirrored {
  object_key: string;
  hash: string;
}

export interface MirrorResult {
  /** Cartas que passaram a apontar (ou já apontavam) para a CDN. */
  cards: number;
  /** Imagens baixadas e gravadas no bucket nesta rodada. */
  uploaded: number;
  /** Imagens que já estavam no bucket (só a carta foi atualizada). */
  reused: number;
  /** Imagens de origem desconhecida (ficam com o endereço original). */
  skipped: number;
  failed: Array<{ url: string; error: string }>;
  /** O bucket não respondeu: nada foi copiado nesta rodada (motivo). */
  unavailable?: string;
}

/**
 * Copia para a CDN as imagens das cartas do banco que ainda apontam para fora e troca os
 * endereços nas cartas. `maxDownloads` limita as cópias novas por rodada (a sincronização
 * periódica não fica horas baixando); as que sobrarem vão na próxima.
 */
export async function mirrorCardImages(
  db: DB,
  store: ImageStore,
  opts: { fetchImpl?: typeof fetch; maxDownloads?: number; concurrency?: number; log?: (msg: string) => void } = {},
): Promise<MirrorResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: MirrorResult = { cards: 0, uploaded: 0, reused: 0, skipped: 0, failed: [] };
  const known = db.prepare('SELECT object_key, hash FROM card_images WHERE source_url = ?');
  const remember = db.prepare(
    'INSERT OR REPLACE INTO card_images (source_url, object_key, hash, lang, content_type, bytes) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const cdnUrl = (m: Mirrored) => `${store.publicBase}/${m.object_key}?v=${m.hash}`;
  const onCdn = (url: string) => url.startsWith(`${store.publicBase}/`);

  const rows = db.prepare('SELECT id, set_code, data FROM cards ORDER BY id').all() as Array<{ id: string; set_code: string; data: string }>;
  // Endereço de origem -> carta(s) que o usam; cada imagem é baixada uma vez só.
  const pending = new Map<string, { set: string }>();
  for (const r of rows) {
    const c = JSON.parse(r.data) as CardData;
    for (const url of [c.imageUrl, ...(c.arts ?? []).map((a) => a.imageUrl)]) {
      if (!url || onCdn(url) || pending.has(url)) continue;
      if (!allowedSource(url)) {
        result.skipped++;
        continue;
      }
      // Já copiada, ou recusada antes (não é imagem): não baixa de novo.
      if (!known.get(url)) pending.set(url, { set: r.set_code || r.id.split('-')[0] });
    }
  }

  // Antes de baixar milhares de imagens, confere se o bucket responde (Account ID, token, rede).
  if (pending.size) {
    try {
      await store.has('index.json');
    } catch (err) {
      result.unavailable = err instanceof Error ? err.message : String(err);
      return result;
    }
  }

  // Baixa e grava as que faltam, algumas por vez. Se o bucket parar de responder no meio, para.
  const queue = [...pending].slice(0, opts.maxDownloads ?? Infinity);
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [url, { set }] = item;
      try {
        const res = await fetchImpl(url, { headers: { 'user-agent': 'gumgumfight-importer' }, signal: AbortSignal.timeout(30_000) }).catch(
          (err: unknown) => {
            throw new Error(`download: ${networkCause(err)}`);
          },
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        if (!body.length || body.length > MAX_BYTES) throw new Error(`${body.length} bytes`);
        const type = sniffImageType(body);
        const lang = imageLang(url);
        if (!type) {
          // Desenho provisório (SVG da optcgapi): fica registrado para não baixar de novo, e a carta
          // passa a procurar a imagem nas listas oficiais.
          remember.run(url, '', 'rejected', lang, res.headers.get('content-type') ?? '', body.length);
          throw new Error(`não é PNG, JPEG nem WebP (${res.headers.get('content-type') ?? 'sem tipo'})`);
        }
        const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
        const key = `${set}/${lang}/${artId(url)}.${EXT[type]}`;
        await store.put(key, body, type, IMMUTABLE);
        remember.run(url, key, hash, lang, type, body.length);
        result.uploaded++;
      } catch (err) {
        if (err instanceof R2Error && err.status === 0) {
          result.unavailable = err.message;
          queue.length = 0;
          return;
        }
        result.failed.push({ url, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));

  // Troca os endereços nas cartas (as imagens que já estavam no bucket também entram aqui).
  const update = db.prepare('UPDATE cards SET data = ? WHERE id = ?');
  const swap = (url: string | undefined) => {
    if (!url || onCdn(url)) return url;
    const m = known.get(url) as Mirrored | undefined;
    if (!m?.object_key) return url;
    if (!pending.has(url)) result.reused++;
    return cdnUrl(m);
  };
  transaction(db, () => {
    for (const r of rows) {
      const c = JSON.parse(r.data) as CardData;
      const imageUrl = swap(c.imageUrl);
      const arts = c.arts?.map((a): CardArt => ({ ...a, imageUrl: swap(a.imageUrl)! }));
      const changed = imageUrl !== c.imageUrl || arts?.some((a, i) => a.imageUrl !== c.arts![i].imageUrl);
      if (changed) update.run(JSON.stringify({ ...c, imageUrl, ...(arts ? { arts } : {}) }), r.id);
      if (imageUrl && onCdn(imageUrl)) result.cards++;
    }
  });
  for (const f of result.failed.slice(0, 5)) opts.log?.(`Imagem não copiada para a CDN: ${f.url} (${f.error})`);
  return result;
}

/**
 * Índice público das imagens (`index.json` no bucket), para parceiros (SweetApp) usarem a mesma
 * CDN: número da carta -> imagem principal e artes, só das que já estão na CDN.
 */
export async function publishImageIndex(db: DB, store: ImageStore): Promise<number> {
  const onCdn = (url?: string) => Boolean(url?.startsWith(`${store.publicBase}/`));
  const cards: Record<string, { name: string; set: string; spoiler?: boolean; image: string; arts?: Array<{ id: string; image: string; label?: string }> }> = {};
  for (const r of db.prepare('SELECT data, provisional FROM cards ORDER BY id').all() as Array<{ data: string; provisional: number }>) {
    const c = JSON.parse(r.data) as CardData;
    if (!onCdn(c.imageUrl)) continue;
    const arts = (c.arts ?? []).filter((a) => onCdn(a.imageUrl)).map((a) => ({ id: a.id, image: a.imageUrl, ...(a.label ? { label: a.label } : {}) }));
    cards[c.id] = {
      name: c.name,
      set: c.set ?? c.id.split('-')[0],
      ...(c.spoiler ? { spoiler: true } : {}),
      image: c.imageUrl!,
      ...(arts.length ? { arts } : {}),
    };
  }
  const body = Buffer.from(JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), cards }));
  await store.put('index.json', body, 'application/json; charset=utf-8', 'public, max-age=300');
  return Object.keys(cards).length;
}

/** Uma rodada completa (importação ou sincronização): copia o que falta e atualiza o índice. */
export async function syncCardCdn(
  db: DB,
  store: ImageStore,
  opts: {
    fetchImpl?: typeof fetch;
    maxDownloads?: number;
    log: (msg: string) => void;
    /** Listas oficiais da Bandai para as cartas sem imagem (padrão: CARD_IMAGE_SOURCES). */
    officialRegions?: BandaiRegion[];
    fetchText?: FetchText;
  },
): Promise<MirrorResult> {
  // Primeiro as cartas sem imagem ganham a oficial (se houver); depois tudo vai para a CDN.
  // Imagens recusadas nesta rodada só procuram a oficial na próxima.
  await fillOfficialImages(db, opts.officialRegions ?? imageRegionsFromEnv(), { fetchText: opts.fetchText, log: opts.log }).catch((err) =>
    opts.log(`Imagens oficiais: falha (${err instanceof Error ? err.message : err})`),
  );
  const r = await mirrorCardImages(db, store, opts);
  if (r.unavailable) opts.log(`CDN das imagens: bucket inacessível, nada copiado: ${r.unavailable}. Confira R2_ACCOUNT_ID e o token.`);
  if (r.uploaded || r.failed.length) {
    opts.log(
      `CDN das imagens: ${r.uploaded} copiadas, ${r.reused} reaproveitadas, ${r.cards} cartas na CDN` +
        (r.failed.length ? `, ${r.failed.length} falharam` : '') +
        (r.skipped ? `, ${r.skipped} de origem desconhecida` : ''),
    );
  }
  if (r.uploaded || r.reused) opts.log(`CDN das imagens: índice com ${await publishImageIndex(db, store)} cartas.`);
  // Os dados das cartas (um arquivo por coleção + manifesto) acompanham toda rodada: só o que mudou é reenviado.
  if (!r.unavailable) {
    try {
      const d = await publishCardData(db, store);
      if (d.uploaded) opts.log(`CDN dos dados: ${d.uploaded} arquivo(s) reenviado(s), ${d.sets} coleções e ${d.cards} cartas no manifesto.`);
    } catch (err) {
      opts.log(`CDN dos dados: falha ao publicar (${err instanceof Error ? err.message : err})`);
    }
  }
  return r;
}
