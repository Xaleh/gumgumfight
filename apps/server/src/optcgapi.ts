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

/** Observações que a API anexa ao texto e que não são efeito da carta. */
const NOTE_PATTERNS = [
  /\s*This card has been officially errata'd\.?/gi,
  /\s*DISCLAIMER:.*$/gims,
  /\s*While the original print is exclusively available.*$/gims,
  /\s*The main difference between this card and the original print.*$/gims,
];

/**
 * A API anexa ao nome a versão de impressão: "(Parallel)", "(Alternate Art)",
 * "(Reprint)", "(SP)", "(Manga)", "(025)"... Nenhuma faz parte do nome da carta.
 */
const VERSION_SUFFIX = new RegExp(
  '\\s*\\((?:' +
    [
      '\\d+', // (025)
      '[A-Z]+\\d*(?:-\\d+)?', // (OP01-060), (P-041), (OP08), (SP), (SPR), (TR)
      '[^()]*\\b(?:Art|Reprint|Parallel|Foil|Manga|Pack|Topper|Poster|Promo|Version|Gold|Silver|Gem|Signature)\\b[^()]*',
    ].join('|') +
    ')\\)\\s*$',
  // sem flag "i": "(SP)"/"(TR)" são siglas em maiúsculas; "(Zala)", "(Mikita)" fazem parte do nome
);

export function cleanName(name: string): string {
  let out = name.trim();
  for (;;) {
    const next = out.replace(VERSION_SUFFIX, '');
    if (next === out) return out;
    out = next.trim();
  }
}

/** Separa as observações da API do texto do efeito. */
export function extractNotes(text: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  let out = text;
  for (const re of NOTE_PATTERNS) {
    out = out.replace(re, (m) => {
      notes.push(m.trim());
      return '';
    });
  }
  return { text: out.trim(), notes };
}

const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/**
 * Normaliza o texto para a forma das cartas impressas:
 *  - "Straw Hat Crew" type -> {Straw Hat Crew} type, inclusive em listas
 *    ("Supernovas" or "Navy" type -> {Supernovas} or {Navy} type);
 *  - custo de DON!! "(3) (You may rest…)" -> "③ (You may rest…)".
 */
export const normalizeTypeQuotes = (text: string) =>
  text
    .replace(/"([^"\n]+)"((?:\s*(?:,|or|and)\s*(?:"[^"\n]+"|\{[^}\n]+\}))*\s+type)/g, (_m, first: string, rest: string) =>
      `{${first}}${rest.replace(/"([^"\n]+)"/g, '{$1}')}`,
    )
    .replace(/\((\d{1,2})\)(?=\s*\(You may rest the specified)/g, (m, n: string) => CIRCLED[Number(n)] ?? m);

/**
 * Vocabulário de tipos para separar o campo sub_types: tipos citados nos textos
 * ({X} type / "X" type) + a lista curada (data/card-types.json).
 */
export function typeVocabulary(rows: Raw[], known: Iterable<string> = []): Set<string> {
  const vocab = new Set(known);
  for (const r of rows) {
    const text = String(r.card_text ?? r.text ?? '');
    for (const m of text.matchAll(/[{"]([^}"\n]+)[}"]\s+type/g)) vocab.add(m[1].trim());
  }
  return vocab;
}

/**
 * A API junta os tipos com espaço ("Heart Pirates Supernovas"). Separa pelo maior
 * tipo conhecido em cada posição; palavras desconhecidas ficam agrupadas.
 */
export function splitTypes(raw: string, vocab: Set<string>): string[] {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  // Valores sem sentido vindos da API ("5000", "?", "NULL") não são tipos.
  if (!trimmed || trimmed === 'NULL' || /^[\d?\s-]+$/.test(trimmed)) return [];
  if (/[/;,]/.test(trimmed)) return trimmed.split(/\s*[/;,]\s*/).filter(Boolean);
  if (vocab.has(trimmed)) return [trimmed];
  const words = trimmed.split(/\s+/);
  const out: string[] = [];
  let unknown: string[] = [];
  for (let i = 0; i < words.length; ) {
    let end = 0;
    for (let j = words.length; j > i; j--) {
      if (vocab.has(words.slice(i, j).join(' '))) {
        end = j;
        break;
      }
    }
    if (end) {
      if (unknown.length) out.push(unknown.join(' '));
      unknown = [];
      out.push(words.slice(i, end).join(' '));
      i = end;
    } else {
      unknown.push(words[i]);
      i++;
    }
  }
  if (unknown.length) out.push(unknown.join(' '));
  return out;
}

export function mapApiCard(raw: Raw, vocab: Set<string> = new Set()): CardData | null {
  const id = pick(raw, 'card_set_id', 'id', 'card_id', 'code', 'number');
  const name = pick(raw, 'card_name', 'name');
  const typeRaw = String(pick(raw, 'card_type', 'category', 'type') ?? '').toLowerCase();
  if (!id || !name) return null;

  const category = (['leader', 'character', 'event', 'stage'] as CardCategory[]).find((c) => typeRaw.includes(c));
  if (!category) return null; // ignora DON!! e tipos desconhecidos

  const colors = splitList(pick(raw, 'card_color', 'colors', 'color'), /[\s/;,]+/)
    .map((c) => c.toLowerCase())
    .filter((c): c is Color => COLORS.includes(c as Color));

  // Tipos: a API junta vários tipos com espaço; o vocabulário vindo dos textos separa.
  // (Mesmo se sobrar algo junto, o motor procura "Straw Hat Crew" dentro de "Supernovas Straw Hat Crew".)
  const typesRaw = pick(raw, 'sub_types', 'types', 'traits', 'feature');
  const types = Array.isArray(typesRaw) ? splitList(typesRaw, /,/) : splitTypes(String(typesRaw ?? ''), vocab);

  const explicitTrigger = pick(raw, 'trigger', 'trigger_text');
  const { text: effectText, notes } = extractNotes(cleanText(pick(raw, 'card_text', 'text', 'effect')));
  const split = splitTrigger(normalizeTypeQuotes(effectText));
  const aliases = [...split.text.matchAll(/Also treat this card's name as \[([^\]]+)\]/g)].map((m) => m[1]);
  const cardId = String(id).trim();

  return {
    id: cardId,
    name: cleanName(String(name)),
    category,
    colors,
    cost: category === 'leader' ? undefined : num(pick(raw, 'card_cost', 'cost')),
    life: category === 'leader' ? num(pick(raw, 'life', 'card_life', 'card_cost', 'cost')) : undefined,
    power: num(pick(raw, 'card_power', 'power')),
    counter: category === 'character' ? num(pick(raw, 'counter_amount', 'counter')) : undefined,
    attributes: splitList(pick(raw, 'attribute', 'attributes'), /\s*[/;,]\s*/),
    types,
    text: split.text,
    trigger: explicitTrigger ? normalizeTypeQuotes(cleanText(explicitTrigger)) : split.trigger,
    ...(notes.length ? { notes } : {}),
    ...(aliases.length ? { aliases } : {}),
    set: cardId.split('-')[0],
    rarity: pick(raw, 'rarity') ? String(pick(raw, 'rarity')) : undefined,
    imageUrl: pick(raw, 'card_image', 'image_url', 'imageUrl', 'image') as string | undefined,
  };
}

/**
 * Converte uma resposta da API em cartas únicas. Versões alternativas (arte
 * paralela) têm o mesmo card_set_id: fica a versão cujo card_image_id é o próprio ID.
 */
export function rowsOf(body: unknown): Raw[] {
  return (
    Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? (body as { cards?: unknown[] })?.cards ?? [])
  ) as Raw[];
}

export function mapApiResponse(
  body: unknown,
  vocab?: Set<string>,
): { cards: CardData[]; raw: Map<string, unknown>; ignored: number } {
  const rows = (
    Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? (body as { cards?: unknown[] })?.cards ?? [])
  ) as Raw[];
  const byId = new Map<string, { card: CardData; raw: Raw; primary: boolean }>();
  const types = vocab ?? typeVocabulary(rows);
  let ignored = 0;
  for (const raw of rows) {
    const card = mapApiCard(raw, types);
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
