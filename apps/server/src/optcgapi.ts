// Mapeamento das respostas da https://optcgapi.com para o formato CardData.
//
// Campos esperados (por carta): card_set_id, card_name, card_type, card_color,
// card_cost, card_power, counter_amount, life, attribute, sub_types, card_text,
// card_image, card_image_id, set_id, rarity. O mapeamento também aceita nomes
// alternativos comuns, para tolerar mudanças na API.

import type { CardCategory, CardData, Color } from '@gumgum/engine';

export const DEFAULT_API_BASE = 'https://optcgapi.com/api';

const COLORS: Color[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

type Raw = Record<string, unknown>;

const pick = (raw: Raw, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '' && v !== 'NULL' && v !== '-') return v;
  }
  return undefined;
};

const num = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  const digits = String(v).replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
};

const splitList = (v: unknown, sep: RegExp): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v !== 'string') return [];
  return v.split(sep).map((s) => s.trim()).filter(Boolean);
};

/** "ST01" | "st-01" | "ST-01" -> "ST-01" (formato de set_id da optcgapi). */
export function normalizeSetId(input: string): string {
  const m = input.trim().toUpperCase().match(/^([A-Z]+)-?(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : input.trim().toUpperCase();
}

/** URL do endpoint para uma coleção. Starter decks ficam em /decks, o resto em /sets. */
export function setEndpoint(base: string, setId: string): string {
  const id = normalizeSetId(setId);
  return id.startsWith('ST-') ? `${base}/decks/${id}/` : `${base}/sets/${id}/`;
}

export function allEndpoints(base: string): string[] {
  return [`${base}/allSetCards/`, `${base}/allSTCards/`];
}

/** Separa o texto do [Trigger], que às vezes vem junto do texto principal. */
function splitTrigger(text: string): { text: string; trigger?: string } {
  const i = text.search(/\[Trigger\]/i);
  if (i < 0) return { text };
  return {
    text: text.slice(0, i).trim(),
    trigger: text.slice(i).replace(/^\[Trigger\]\s*/i, '').trim() || undefined,
  };
}

const cleanText = (v: unknown) =>
  v === undefined
    ? ''
    : String(v)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .trim();

export function mapApiCard(raw: Raw): CardData | null {
  const id = pick(raw, 'card_set_id', 'id', 'card_id', 'code', 'number');
  const name = pick(raw, 'card_name', 'name');
  const typeRaw = String(pick(raw, 'card_type', 'category', 'type') ?? '').toLowerCase();
  if (!id || !name) return null;

  const category = (['leader', 'character', 'event', 'stage'] as CardCategory[]).find((c) => typeRaw.includes(c));
  if (!category) return null; // ignora DON!! e tipos desconhecidos

  const colors = splitList(pick(raw, 'card_color', 'colors', 'color'), /[\s/;,]+/)
    .map((c) => c.toLowerCase())
    .filter((c): c is Color => COLORS.includes(c as Color));

  // Tipos: separados por "/" quando possível; senão ficam como um item só
  // (o motor sabe procurar "Straw Hat Crew" dentro de "Supernovas Straw Hat Crew").
  const types = splitList(pick(raw, 'sub_types', 'types', 'traits', 'feature'), /\s*[/;,]\s*/);

  const explicitTrigger = pick(raw, 'trigger', 'trigger_text');
  const split = splitTrigger(cleanText(pick(raw, 'card_text', 'text', 'effect')));
  const cardId = String(id).trim();

  return {
    id: cardId,
    name: String(name).replace(/\s*\((?:Parallel|Alternate Art)\)\s*$/i, '').trim(),
    category,
    colors,
    cost: category === 'leader' ? undefined : num(pick(raw, 'card_cost', 'cost')),
    life: category === 'leader' ? num(pick(raw, 'life', 'card_life', 'card_cost', 'cost')) : undefined,
    power: num(pick(raw, 'card_power', 'power')),
    counter: category === 'character' ? num(pick(raw, 'counter_amount', 'counter')) : undefined,
    attributes: splitList(pick(raw, 'attribute', 'attributes'), /\s*[/;,]\s*/),
    types,
    text: split.text,
    trigger: explicitTrigger ? cleanText(explicitTrigger) : split.trigger,
    set: cardId.split('-')[0],
    rarity: pick(raw, 'rarity') ? String(pick(raw, 'rarity')) : undefined,
    imageUrl: pick(raw, 'card_image', 'image_url', 'imageUrl', 'image') as string | undefined,
  };
}

/**
 * Converte uma resposta da API em cartas únicas. Versões alternativas (arte
 * paralela) têm o mesmo card_set_id: fica a versão cujo card_image_id é o próprio ID.
 */
export function mapApiResponse(body: unknown): { cards: CardData[]; raw: Map<string, unknown>; ignored: number } {
  const rows = (
    Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? (body as { cards?: unknown[] })?.cards ?? [])
  ) as Raw[];
  const byId = new Map<string, { card: CardData; raw: Raw; primary: boolean }>();
  let ignored = 0;
  for (const raw of rows) {
    const card = mapApiCard(raw);
    if (!card) {
      ignored++;
      continue;
    }
    const imageId = String(raw.card_image_id ?? card.id);
    const primary = imageId === card.id;
    const prev = byId.get(card.id);
    if (!prev || (!prev.primary && primary)) byId.set(card.id, { card, raw, primary });
  }
  const list = [...byId.values()];
  return { cards: list.map((x) => x.card), raw: new Map(list.map((x) => [x.card.id, x.raw])), ignored };
}
