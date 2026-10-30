// Dados das cartas na CDN (Cloudflare R2), para os parceiros (SweetApp) e para o próprio jogo:
// um lugar só, com a base já unificada pela cadeia de fontes (optcgapi, optcgleaks, Cardkaizoku,
// SweetApp…), as erratas aplicadas e as imagens na CDN. Quem lê não depende de nenhuma API externa
// nem do servidor do GumGum Fight.
//
//   <CARD_CDN_URL>/cards/v1/manifest.json         coleções, contagens, hash e endereço de cada arquivo
//   <CARD_CDN_URL>/cards/v1/sets/<coleção>.json   as cartas da coleção (PartnerCard[])
//   <CARD_CDN_URL>/index.json                      (já existia) número da carta -> imagens na CDN
//
// Cada arquivo fica sempre na mesma chave; o manifesto traz o hash e o `?v=` de cada coleção, então
// quem acompanha só baixa o que mudou. Os arquivos só são reenviados quando o conteúdo muda
// (tabela cdn_published). Roda no fim de toda rodada da CDN (importação, sincronização dos
// spoilers e `cards:import -- --images`).

import { createHash } from 'node:crypto';
import { type CardData, fixCard } from '@gumgum/engine';
import { type DB, getTranslations, type TranslationRow } from '../db';
import { ptTranslation } from '../present';
import type { ImageStore } from './index';

export const CARD_DATA_SCHEMA = 1;
export const CARD_DATA_PREFIX = 'cards/v1';
/** Os arquivos mudam de conteúdo na mesma chave: cache curto (o `?v=` do manifesto permite mais). */
const DATA_CACHE = 'public, max-age=300';

/** Uma carta como os parceiros a recebem: `CardData` com nomes estáveis e a origem explícita. */
export interface PartnerCard {
  id: string;
  name: string;
  category: CardData['category'];
  colors: CardData['colors'];
  cost?: number;
  life?: number;
  power?: number;
  counter?: number;
  attributes: string[];
  types: string[];
  /** Texto do efeito em inglês (o oficial); `trigger` é o texto do [Trigger], sem a etiqueta. */
  text: string;
  trigger?: string;
  set: string;
  rarity?: string;
  /** Imagem principal (na CDN quando já copiada; senão, na fonte) e idioma quando não é a inglesa. */
  image?: string;
  imageLang?: string;
  arts?: Array<{ id: string; image: string; label?: string }>;
  notes?: string[];
  aliases?: string[];
  /** Tradução para o português: `manual` (revisada), `auto` (regras completas) ou `partial` (sobrou inglês). */
  i18n: { pt: { text: string; trigger?: string; source: 'manual' | 'auto' | 'partial' } };
  /** official = publicada pela fonte oficial; spoiler = anunciada (sites de spoiler); provisional = escrita de memória. */
  status: 'official' | 'spoiler' | 'provisional';
  /** Fonte vencedora (`cards.source`, ex.: `api:optcgapi.com`). */
  source: string;
  spoiler?: CardData['spoiler'];
  /** Última gravação no banco (UTC, ISO 8601). */
  updatedAt: string;
}

export interface CardDataManifest {
  schemaVersion: number;
  generatedAt: string;
  /** Endereço do índice das imagens (`index.json`). */
  images: string;
  cards: number;
  sets: Record<
    string,
    {
      url: string;
      cards: number;
      /** Coleção que ainda só tem spoilers (nenhuma carta oficial). */
      spoiler: boolean;
      hash: string;
      /** Última mudança de alguma carta da coleção (UTC, ISO 8601). */
      updatedAt: string;
    }
  >;
}

export interface PublishResult {
  /** Coleções no manifesto. */
  sets: number;
  cards: number;
  /** Arquivos reenviados (conteúdo novo), manifesto incluído. */
  uploaded: number;
}

const toIso = (sqlite: string) => (sqlite.includes('T') ? sqlite : `${sqlite.replace(' ', 'T')}Z`);
const hashOf = (body: Buffer) => createHash('sha256').update(body).digest('hex').slice(0, 12);

export function toPartnerCard(c: CardData, row: { provisional: boolean; source: string; updatedAt: string }, manual?: TranslationRow): PartnerCard {
  const card = fixCard(c);
  const pt = ptTranslation(card, manual)!;
  return {
    id: card.id,
    name: card.name,
    category: card.category,
    colors: card.colors,
    ...(card.cost !== undefined ? { cost: card.cost } : {}),
    ...(card.life !== undefined ? { life: card.life } : {}),
    ...(card.power !== undefined ? { power: card.power } : {}),
    ...(card.counter !== undefined ? { counter: card.counter } : {}),
    attributes: card.attributes ?? [],
    types: card.types,
    text: card.text,
    ...(card.trigger ? { trigger: card.trigger } : {}),
    set: card.set ?? card.id.split('-')[0],
    ...(card.rarity ? { rarity: card.rarity } : {}),
    ...(card.imageUrl ? { image: card.imageUrl } : {}),
    ...(card.imageLang ? { imageLang: card.imageLang } : {}),
    ...(card.arts?.length ? { arts: card.arts.map((a) => ({ id: a.id, image: a.imageUrl, ...(a.label ? { label: a.label } : {}) })) } : {}),
    ...(card.notes?.length ? { notes: card.notes } : {}),
    ...(card.aliases?.length ? { aliases: card.aliases } : {}),
    i18n: { pt: { text: pt.text, ...(pt.trigger ? { trigger: pt.trigger } : {}), source: pt.source } },
    status: card.spoiler ? 'spoiler' : row.provisional ? 'provisional' : 'official',
    source: row.source,
    ...(card.spoiler ? { spoiler: card.spoiler } : {}),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Grava um arquivo só quando o conteúdo mudou desde a última publicação. */
async function putIfChanged(db: DB, store: ImageStore, key: string, body: Buffer): Promise<{ hash: string; uploaded: boolean }> {
  const hash = hashOf(body);
  const known = db.prepare('SELECT hash FROM cdn_published WHERE object_key = ?').get(key) as { hash: string } | undefined;
  if (known?.hash === hash) return { hash, uploaded: false };
  await store.put(key, body, 'application/json; charset=utf-8', DATA_CACHE);
  db.prepare("INSERT OR REPLACE INTO cdn_published (object_key, hash, published_at) VALUES (?, ?, datetime('now'))").run(key, hash);
  return { hash, uploaded: true };
}

/**
 * Publica as cartas do banco na CDN: um arquivo por coleção e o manifesto. Devolve quantas
 * coleções e cartas estão no manifesto e quantos arquivos foram reenviados nesta rodada.
 */
export async function publishCardData(db: DB, store: ImageStore, opts: { now?: () => Date } = {}): Promise<PublishResult> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const rows = db.prepare('SELECT id, set_code, data, provisional, source, updated_at FROM cards ORDER BY id').all() as Array<{
    id: string;
    set_code: string | null;
    data: string;
    provisional: number;
    source: string;
    updated_at: string;
  }>;
  const manual = getTranslations(db, 'pt');
  const bySet = new Map<string, PartnerCard[]>();
  for (const r of rows) {
    const card = toPartnerCard(JSON.parse(r.data) as CardData, { provisional: Boolean(r.provisional), source: r.source, updatedAt: r.updated_at }, manual.get(r.id));
    const set = r.set_code || card.set;
    bySet.set(set, [...(bySet.get(set) ?? []), card]);
  }

  const manifest: CardDataManifest = { schemaVersion: CARD_DATA_SCHEMA, generatedAt: now, images: `${store.publicBase}/index.json`, cards: rows.length, sets: {} };
  let uploaded = 0;
  for (const [set, cards] of [...bySet].sort(([a], [b]) => a.localeCompare(b))) {
    const key = `${CARD_DATA_PREFIX}/sets/${set}.json`;
    // `generatedAt` fica fora do hash: o arquivo só é reenviado quando alguma carta muda.
    const body = Buffer.from(JSON.stringify({ schemaVersion: CARD_DATA_SCHEMA, set, cards }));
    const { hash, uploaded: sent } = await putIfChanged(db, store, key, body);
    if (sent) uploaded++;
    manifest.sets[set] = {
      url: `${store.publicBase}/${key}?v=${hash}`,
      cards: cards.length,
      spoiler: cards.every((c) => c.status === 'spoiler'),
      hash,
      updatedAt: cards.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), cards[0].updatedAt),
    };
  }
  // O manifesto muda sempre que um arquivo muda (hash) ou o número de cartas muda; `generatedAt`
  // também fica fora do hash, para não reenviar um manifesto igual a cada rodada.
  const { generatedAt: _skip, ...stable } = manifest;
  const stableHash = hashOf(Buffer.from(JSON.stringify(stable)));
  const known = db.prepare('SELECT hash FROM cdn_published WHERE object_key = ?').get(`${CARD_DATA_PREFIX}/manifest.json`) as { hash: string } | undefined;
  if (known?.hash !== stableHash) {
    await store.put(`${CARD_DATA_PREFIX}/manifest.json`, Buffer.from(JSON.stringify(manifest)), 'application/json; charset=utf-8', DATA_CACHE);
    db.prepare("INSERT OR REPLACE INTO cdn_published (object_key, hash, published_at) VALUES (?, ?, datetime('now'))").run(`${CARD_DATA_PREFIX}/manifest.json`, stableHash);
    uploaded++;
  }
  return { sets: bySet.size, cards: rows.length, uploaded };
}
