// Busca automática de spoilers no optcgleaks.com.
//
// O site carrega um JSON por coleção: https://images.optcgleaks.com/<set>/<set>.json
//   { data: {...}, cards: [...], sp_cards: [...], unknown_id_cards: [...] }
// `cards` são as cartas com número; `sp_cards` são reimpressões de outras coleções
// e `unknown_id_cards` ainda não têm número ("EB05-XXX"): as duas ficam de fora.
// As imagens (`/<set>/images/<id>.webp`) podem ser exibidas em outros sites.

import { type CardCategory, type CardData, type Color, normalizeTypeQuotes } from '@gumgum/engine';
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
  const hasPower = category === 'leader' || category === 'character';

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
    set: id.split('-')[0],
    ...(raw.rarity && raw.rarity !== '?' ? { rarity: raw.rarity } : {}),
    ...(image?.id ? { imageUrl: `${DATA_BASE}/${set.toLowerCase()}/images/${image.id}.webp` } : {}),
    spoiler: { source: OPTCGLEAKS, url: optcgLeaksPageUrl(set) },
  };
}

/** Cartas com número de uma coleção do optcgleaks (só as da própria coleção). */
export async function fetchOptcgLeaksSet(set: string, fetchJson: FetchJson): Promise<CardData[]> {
  const body = (await fetchJson(optcgLeaksDataUrl(set))) as { cards?: LeaksCard[] };
  if (!Array.isArray(body?.cards)) throw new Error(`${optcgLeaksDataUrl(set)}: resposta sem "cards"`);
  const prefix = set.toUpperCase();
  return body.cards
    .map((c) => mapOptcgLeaksCard(c, set))
    .filter((c): c is CardData => c !== null && c.set === prefix);
}
