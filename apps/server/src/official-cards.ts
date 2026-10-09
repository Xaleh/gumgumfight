// Lista oficial de cartas da Bandai (https://en.onepiece-cardgame.com/cardlist/): nome e tipos
// de cada carta, para conferir os dados que vêm da optcgapi (ver `cards:check-official`).

import type { CardData } from '@gumgum/engine';

export const OFFICIAL_CARDLIST = 'https://en.onepiece-cardgame.com/cardlist/';

/** Erros conhecidos da própria lista oficial (o tipo certo é o da carta impressa). */
const OFFICIAL_TYPE_ERRORS: Record<string, string> = { 音楽: 'Music' };

export interface OfficialCard {
  name: string;
  types: string[];
  /** Atributo (Personagens e Líderes); a API perde em algumas cartas. */
  attribute?: string;
  /** Veio de uma versão alternativa ou reimpressão ("_p1", "_r1"): a versão normal tem prioridade. */
  variant?: true;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

/** Códigos das coleções (parâmetro `series`) listados na página da lista de cartas. */
export function officialSeries(html: string): string[] {
  return [...new Set([...html.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]))];
}

/**
 * Cartas de uma página da lista oficial. Versões alternativas e reimpressões ("OP01-001_p1",
 * "ST23-004_r1") só entram se não houver a versão normal na página, e marcadas como `variant`.
 */
export function parseOfficialCardList(html: string): Map<string, OfficialCard> {
  const exact = new Map<string, OfficialCard>();
  const variants = new Map<string, OfficialCard>();
  for (const m of html.matchAll(/<dl class="modalCol" id="([^"]+)">([\s\S]*?)<\/dl>/g)) {
    const [id, body] = [m[1], m[2]];
    const name = body.match(/<div class="cardName">([\s\S]*?)<\/div>/);
    if (!name) continue;
    const feature = body.match(/<div class="feature"><h3>Type<\/h3>([\s\S]*?)<\/div>/);
    const types = feature
      ? decode(feature[1])
          .split('/')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => OFFICIAL_TYPE_ERRORS[t] ?? t)
      : [];
    const attribute = body.match(/<div class="attribute">[\s\S]*?<i>([^<]*)<\/i>/);
    const card: OfficialCard = { name: decode(name[1]), types, ...(attribute && decode(attribute[1]) ? { attribute: decode(attribute[1]) } : {}) };
    const base = id.split('_')[0];
    if (base === id) exact.set(id, card);
    else if (!variants.has(base)) variants.set(base, { ...card, variant: true });
  }
  for (const [id, card] of variants) if (!exact.has(id)) exact.set(id, card);
  return exact;
}

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export interface OfficialDiff {
  id: string;
  name?: { api: string; official: string };
  types?: { api: string[]; official: string[] };
  attributes?: { api: string[]; official: string[] };
}

/** Junta as páginas: a versão normal de uma carta vence as alternativas/reimpressões de outra página. */
export function mergeOfficial(pages: Array<Map<string, OfficialCard>>): Map<string, OfficialCard> {
  const out = new Map<string, OfficialCard>();
  for (const page of pages) {
    for (const [id, card] of page) {
      const have = out.get(id);
      if (!have || (have.variant && !card.variant)) out.set(id, card);
    }
  }
  return out;
}

/** Diferenças de nome, de tipos e de atributo entre as cartas (da API) e a lista oficial. */
export function diffWithOfficial(cards: CardData[], official: Map<string, OfficialCard>): OfficialDiff[] {
  const out: OfficialDiff[] = [];
  for (const c of cards) {
    const o = official.get(c.id);
    if (!o) continue;
    const d: OfficialDiff = { id: c.id };
    if (norm(c.name) !== norm(o.name)) d.name = { api: c.name, official: o.name };
    const sameTypes =
      c.types.length === o.types.length && [...c.types].map(norm).sort().join('|') === [...o.types].map(norm).sort().join('|');
    if (!sameTypes) d.types = { api: c.types, official: o.types };
    // Atributo: só Personagens e Líderes têm; a lista oficial traz um por carta.
    if (o.attribute && (c.category === 'character' || c.category === 'leader')) {
      const api = c.attributes ?? [];
      if (api.length !== 1 || norm(api[0]) !== norm(o.attribute)) d.attributes = { api, official: [o.attribute] };
    }
    if (d.name || d.types || d.attributes) out.push(d);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
