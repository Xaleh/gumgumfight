// Busca automática de spoilers no optcgleaks.com.
//
// O site carrega um JSON por coleção: https://images.optcgleaks.com/<set>/<set>.json
//   { data: {...}, cards: [...], sp_cards: [...], unknown_id_cards: [...] }
// `cards` são as cartas com número; `unknown_id_cards` ainda não têm número ("EB05-XXX") e ficam
// de fora. Cada carta traz as imagens em `images`: a "Base Art" é a imagem da carta e as outras
// ("Alt-Art", "Super Alt-Art", "Treasure Rare"…) viram artes alternativas. `sp_cards` são cartas
// (quase sempre de outras coleções) reimpressas na coleção com arte nova: delas só as artes
// interessam, e vão para a carta que já está no banco.
// As imagens (`/<set>/images/<id>.webp`) podem ser exibidas em outros sites.

import { type CardArt, type CardCategory, type CardData, type Color, normalizeTypeQuotes } from '@gumgum/engine';
import type { FetchJson } from './card-import';
import { splitTrigger } from './optcgapi';

export const OPTCGLEAKS = 'optcgleaks.com';
const DATA_BASE = 'https://images.optcgleaks.com';

export const optcgLeaksDataUrl = (set: string) => `${DATA_BASE}/${set.toLowerCase()}/${set.toLowerCase()}.json`;
export const optcgLeaksPageUrl = (set: string) => `https://optcgleaks.com/${set.toLowerCase()}`;

interface LeaksCard {
  id?: string;
  name?: string;
  category?: string;
  color?: string[] | string;
  attribute?: string[] | string;
  rarity?: string;
  type?: string[] | string;
  power?: number | string;
  effect?: string;
  trigger?: string;
  cost?: number | string;
  counter?: number | string;
  life?: number | string;
  images?: Array<{ name?: string; id?: string }>;
}

const ATTRIBUTES = ['Strike', 'Slash', 'Ranged', 'Special', 'Wisdom'];
const COLORS: Color[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('/') : []).map((x) => String(x).trim()).filter(Boolean);

const num = (v: unknown): number | undefined => {
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
};

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Avisos do tradutor no meio do efeito ("NOTE: This translation may be inaccurate…"). */
const NOTE = /\s*NOTE:[^\n]*/gi;

/**
 * Deixa o texto no padrão das cartas impressas usado pelo motor: atributo
 * "<Wisdom>" vira "Wisdom" (entre aspas), palavra-chave "<Blocker>" vira [Blocker].
 */
export function normalizeLeaksText(raw: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const text = decodeEntities(raw)
    // Aspas tipográficas (ST38-001: ”Baroque Works”): o leitor e o tradutor esperam as retas.
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(NOTE, (m) => {
      notes.push(m.trim());
      return '';
    })
    .replace(/<([A-Za-z][A-Za-z ]*)>/g, (_m, word: string) => (ATTRIBUTES.includes(word) ? `"${word}"` : `[${word}]`))
    // Opções de "Choose one:" como nas cartas impressas ("• …").
    .replace(/^[ \t]*-[ \t]+/gm, '• ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return { text: normalizeTypeQuotes(text), notes };
}

const imageUrlOf = (set: string, imageId: string) => `${DATA_BASE}/${set.toLowerCase()}/images/${imageId}.webp`;

/** Rótulo da arte no vocabulário das outras fontes: "Alt-Art" -> "Alternate Art", "SP Alt-Art" -> "SP". */
const artLabel = (name: string) => {
  const label = name.trim().replace(/\bAlt-Art\b/gi, 'Alternate Art');
  return /^SP Alternate Art$/i.test(label) ? 'SP' : label;
};

/**
 * Imagens de uma carta do feed como artes alternativas, marcadas como vindas dos spoilers da
 * coleção `set` (`CardArt.spoiler`). `skip`: a imagem que já é a principal da carta.
 */
export function leaksArts(images: LeaksCard['images'], set: string, skip?: string): CardArt[] {
  const out: CardArt[] = [];
  const seen = new Set(skip ? [skip] : []);
  for (const i of images ?? []) {
    const id = String(i?.id ?? '').trim();
    // O id vira parte do endereço da imagem: só letras, números, "_" e "-".
    if (!/^[\w-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const label = artLabel(String(i.name ?? ''));
    out.push({ id, imageUrl: imageUrlOf(set, id), ...(label ? { label } : {}), spoiler: set.toUpperCase() });
  }
  return out;
}

/** Uma carta do optcgleaks no formato CardData; null se não tiver número ou categoria. */
export function mapOptcgLeaksCard(raw: LeaksCard, set: string): CardData | null {
  const id = String(raw.id ?? '').trim().toUpperCase();
  const category = String(raw.category ?? '').toLowerCase() as CardCategory;
  if (!/^[A-Z]+\d*-\d+$/.test(id) || !raw.name || !['leader', 'character', 'event', 'stage'].includes(category)) return null;

  const effect = normalizeLeaksText(raw.effect ?? '');
  const trigger = normalizeLeaksText(raw.trigger ?? '');
  // O [Trigger] às vezes vem no fim do efeito.
  const split = trigger.text ? { text: effect.text, trigger: undefined } : splitTrigger(effect.text);
  const triggerText = (trigger.text || split.trigger || '').replace(/^\s*\[?Trigger\]?\s*/i, '').trim();
  const notes = [...effect.notes, ...trigger.notes];
  const image = raw.images?.find((i) => i.name === 'Base Art') ?? raw.images?.[0];
  const arts = leaksArts(raw.images, set, image?.id);
  const hasPower = category === 'leader' || category === 'character';
  // "Also treat this card's name as [Sanji] according to the rules." (OP18-045), como nas outras fontes.
  const aliases = [...split.text.matchAll(/[Aa]lso treat this card's name as \[([^\]]+)\](?: and \[([^\]]+)\])?/g)].flatMap((m) => m.slice(1).filter(Boolean));

  return {
    id,
    name: String(raw.name).trim(),
    category,
    colors: list(raw.color)
      .map((c) => c.toLowerCase())
      .filter((c): c is Color => COLORS.includes(c as Color)),
    cost: category === 'leader' ? undefined : (num(raw.cost) ?? 0),
    life: category === 'leader' ? num(raw.life) : undefined,
    power: hasPower ? (num(raw.power) ?? 0) : undefined,
    counter: category === 'character' ? num(raw.counter) || undefined : undefined,
    attributes: list(raw.attribute),
    types: list(raw.type),
    text: split.text,
    ...(triggerText ? { trigger: triggerText } : {}),
    ...(notes.length ? { notes } : {}),
    ...(aliases.length ? { aliases } : {}),
    set: id.split('-')[0],
    ...(raw.rarity && raw.rarity !== '?' ? { rarity: raw.rarity } : {}),
    ...(image?.id ? { imageUrl: imageUrlOf(set, image.id) } : {}),
    // Sem imagem principal não há o que trocar: as outras imagens ficam de fora.
    ...(image?.id && arts.length ? { arts } : {}),
    spoiler: { source: OPTCGLEAKS, url: optcgLeaksPageUrl(set) },
  };
}

export interface LeaksSet {
  /** Cartas com número da própria coleção, com as artes alternativas (as de `sp_cards` incluídas). */
  cards: CardData[];
  /** Artes novas de cartas de outras coleções reimpressas nesta (`sp_cards`): número da carta -> artes. */
  extraArts: Map<string, CardArt[]>;
}

/** Uma coleção do optcgleaks: as cartas da própria coleção e as artes das reimpressas nela. */
export function mapOptcgLeaksSet(body: { cards?: LeaksCard[]; sp_cards?: LeaksCard[] }, set: string): LeaksSet {
  const prefix = set.toUpperCase();
  const cards = (body.cards ?? []).map((c) => mapOptcgLeaksCard(c, set)).filter((c): c is CardData => c !== null && c.set === prefix);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const extraArts = new Map<string, CardArt[]>();
  for (const sp of Array.isArray(body.sp_cards) ? body.sp_cards : []) {
    const id = String(sp?.id ?? '').trim().toUpperCase();
    if (!/^[A-Z]+\d*-\d+$/.test(id)) continue;
    const arts = leaksArts(sp.images, set);
    if (!arts.length) continue;
    const own = byId.get(id);
    if (own) {
      // SP de uma carta da própria coleção (OP18-084): mais uma arte dela.
      const have = new Set([own.imageUrl, ...(own.arts ?? []).map((a) => a.imageUrl)]);
      const fresh = arts.filter((a) => !have.has(a.imageUrl));
      if (own.imageUrl && fresh.length) own.arts = [...(own.arts ?? []), ...fresh];
    } else if (id.split('-')[0] !== prefix) {
      const list = extraArts.get(id) ?? [];
      extraArts.set(id, [...list, ...arts.filter((a) => !list.some((x) => x.id === a.id))]);
    }
  }
  return { cards, extraArts };
}

/** Baixa uma coleção do optcgleaks. */
export async function fetchOptcgLeaksSet(set: string, fetchJson: FetchJson): Promise<LeaksSet> {
  const body = (await fetchJson(optcgLeaksDataUrl(set))) as { cards?: LeaksCard[]; sp_cards?: LeaksCard[] };
  if (!Array.isArray(body?.cards)) throw new Error(`${optcgLeaksDataUrl(set)}: resposta sem "cards"`);
  return mapOptcgLeaksSet(body, set);
}
