// Mapeamento das respostas da https://optcgapi.com para o formato CardData.
//
// Campos esperados (por carta): card_set_id, card_name, card_type, card_color,
// card_cost, card_power, counter_amount, life, attribute, sub_types, card_text,
// card_image, card_image_id, set_id, rarity. O mapeamento também aceita nomes
// alternativos comuns, para tolerar mudanças na API.

import { type CardCategory, type CardData, type Color, normalizeTypeQuotes, parseCard } from '@gumgum/engine';

export const DEFAULT_API_BASE = 'https://optcgapi.com/api';

const COLORS: Color[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

type Raw = Record<string, unknown>;

const pick = (raw: Raw, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '' && v !== 'NULL' && v !== 'N/A' && v !== '-') return v;
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

/**
 * A API perde o nome do atributo em algumas cartas verdes ("If your Leader has the attribute",
 * "your attribute Character"): são todas do atributo "Slash" (decks do Zoro).
 */
/** Cartas de outras cores em que a API também perde o atributo (confirmado à mão). */
const MISSING_ATTRIBUTE: Record<string, string> = { 'OP08-114': 'Slash' };

export function repairMissingAttribute(text: string, colors: string[], id?: string): string {
  const attr = (id && MISSING_ATTRIBUTE[id]) ?? (colors.includes('green') ? 'Slash' : null);
  if (!attr) return text;
  return text.replace(/\b(the|your|by|\d+) attribute\b/g, `$1 "${attr}" attribute`);
}

/**
 * Separa o texto do [Trigger], que às vezes vem junto do texto principal. Só conta o
 * [Trigger] que abre uma linha ou vem depois do fim de uma frase: "trash 1 card with
 * a [Trigger] from your hand" fala de cartas com Trigger e continua no texto principal.
 */
export function splitTrigger(text: string): { text: string; trigger?: string } {
  let i = -1;
  for (const m of text.matchAll(/\[Trigger\]/gi)) {
    if (/(?:^|\n|[.)!])\s*$/.test(text.slice(0, m.index))) {
      i = m.index!;
      break;
    }
  }
  // Sem colchetes numa linha própria: "…\nTrigger Play this card."
  if (i < 0) i = text.search(/\n\s*Trigger\s+(?=[A-Z])/);
  if (i < 0) return { text };
  return {
    text: text.slice(0, i).trim(),
    trigger: text.slice(i).replace(/^\s*\[?Trigger\]?\s*/i, '').trim() || undefined,
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
    // "Boa Hancock - OP14-041", "Brook - ST01-011 (Reprint)": o código da carta também não é nome.
    const next = out.replace(VERSION_SUFFIX, '').replace(/\s+-\s+[A-Z]+\d*-\d+$/, '');
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

// A normalização de texto (tipos entre aspas, custo "(3)") fica no motor, compartilhada com o tradutor.
export { normalizeTypeQuotes };

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
  const aliases = [...split.text.matchAll(/[Aa]lso treat this card's name as \[([^\]]+)\](?: and \[([^\]]+)\])?/g)].flatMap((m) => m.slice(1).filter(Boolean));
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
    text: repairMissingAttribute(split.text, colors, cardId),
    trigger: explicitTrigger ? normalizeTypeQuotes(cleanText(explicitTrigger)) : split.trigger,
    ...(notes.length ? { notes } : {}),
    ...(aliases.length ? { aliases } : {}),
    set: cardId.split('-')[0],
    rarity: pick(raw, 'rarity') ? String(pick(raw, 'rarity')) : undefined,
    imageUrl: pick(raw, 'card_image', 'image_url', 'imageUrl', 'image') as string | undefined,
  };
}

export function rowsOf(body: unknown): Raw[] {
  return (
    Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? (body as { cards?: unknown[] })?.cards ?? [])
  ) as Raw[];
}

type Entry = { card: CardData; raw: Raw; primary: boolean; ownSet: boolean };

/** Quantas habilidades do texto o leitor de efeitos não entende (menor é melhor). */
const unparsedCount = (c: CardData) => parseCard(c).unparsed.length;

/**
 * Junta as linhas da API que têm o mesmo card_set_id (arte paralela, reimpressão em
 * starter deck, foil…) numa carta só. A linha primária é a impressão original
 * (card_image_id igual ao id, de preferência na própria coleção): dela vêm nome, tipos e
 * imagem. Os números e as listas são decididos por maioria entre as linhas, com empate
 * para a primária: as linhas "(Reprint)" costumam vir com Counter 0 ou poder vazio, e a
 * original também erra às vezes (OP08-001 Chopper com poder "4" e Vida "1"). O texto é o
 * da versão que o leitor de efeitos entende melhor (a original de OP02-093 Smoker tem
 * "1o of your opponent's Characters"), com empate pela mais repetida e depois pela primária.
 */
function mergeEntries(group: Entry[]): Entry {
  const primary =
    group.find((e) => e.primary && e.ownSet) ?? group.find((e) => e.primary) ?? group.find((e) => e.ownSet) ?? group[0];
  if (group.length === 1) return primary;
  const out: CardData = { ...primary.card };

  const vote = <T>(get: (c: CardData) => T | undefined, key: (v: T) => string): T | undefined => {
    const votes = new Map<string, { value: T; n: number }>();
    for (const e of group) {
      const v = get(e.card);
      if (v === undefined) continue;
      const k = key(v);
      const cur = votes.get(k);
      if (cur) cur.n++;
      else votes.set(k, { value: v, n: 1 });
    }
    const own = get(primary.card);
    let best = own === undefined ? undefined : votes.get(key(own));
    for (const v of votes.values()) if (!best || v.n > best.n) best = v;
    return best?.value;
  };
  const numKey = (v: number) => String(v);
  const listKey = (v: string[]) => v.join('/');
  const nonEmpty = <T extends string[]>(v: T | undefined): T | undefined => (v?.length ? v : undefined);
  out.counter = vote((c) => c.counter, numKey);
  out.power = vote((c) => c.power, numKey);
  out.cost = vote((c) => c.cost, numKey);
  out.life = vote((c) => c.life, numKey);
  out.colors = vote((c) => nonEmpty(c.colors), listKey) ?? [];
  out.attributes = vote((c) => nonEmpty(c.attributes), listKey) ?? [];
  if (!out.types.length) out.types = group.find((e) => e.card.types.length)?.card.types ?? [];

  const textKey = (c: CardData) => `${c.text}\n${c.trigger ?? ''}`;
  // Uma versão sem o [Trigger] que outra tem está incompleta (OP03-110 Smoothie só o traz na reimpressão).
  const anyTrigger = group.some((e) => e.card.trigger);
  const texts = new Map<string, { card: CardData; n: number; bad: number }>();
  for (const e of group) {
    const k = textKey(e.card);
    const cur = texts.get(k);
    if (cur) cur.n++;
    else texts.set(k, { card: e.card, n: 1, bad: unparsedCount(e.card) + (anyTrigger && !e.card.trigger ? 1 : 0) });
  }
  let bestText = texts.get(textKey(primary.card))!;
  for (const t of texts.values()) if (t.bad < bestText.bad || (t.bad === bestText.bad && t.n > bestText.n)) bestText = t;
  out.text = bestText.card.text;
  out.trigger = bestText.card.trigger;
  if (bestText.card.notes) out.notes = bestText.card.notes;
  else delete out.notes;
  if (bestText.card.aliases) out.aliases = bestText.card.aliases;
  else delete out.aliases;
  return { ...primary, card: out };
}

/**
 * Converte uma resposta da API (ou várias juntas) em cartas únicas: as linhas da mesma
 * carta são combinadas por `mergeEntries` antes de sair.
 */
export function mapApiResponse(
  body: unknown,
  vocab?: Set<string>,
): { cards: CardData[]; raw: Map<string, unknown>; ignored: number } {
  const rows = rowsOf(body);
  const types = vocab ?? typeVocabulary(rows);
  const groups = new Map<string, Entry[]>();
  let ignored = 0;
  for (const raw of rows) {
    const card = mapApiCard(raw, types);
    if (!card) {
      ignored++;
      continue;
    }
    const entry: Entry = {
      card,
      raw,
      primary: String(raw.card_image_id ?? card.id) === card.id,
      ownSet: normalizeSetId(String(raw.set_id ?? '')).replace('-', '').startsWith(card.set ?? ''),
    };
    const g = groups.get(card.id);
    if (g) g.push(entry);
    else groups.set(card.id, [entry]);
  }
  const cards: CardData[] = [];
  const raw = new Map<string, unknown>();
  for (const group of groups.values()) {
    const e = mergeEntries(group);
    cards.push(e.card);
    raw.set(e.card.id, e.raw);
  }
  return { cards, raw, ignored };
}
