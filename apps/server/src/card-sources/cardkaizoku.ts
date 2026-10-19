// Cardkaizoku (www.cardkaizoku.com): o site carrega todas as cartas (lançadas, promocionais e
// spoilers) de um JSON só no CDN, cujo nome muda a cada atualização:
//   https://cdn.cardkaizoku.com/manifest.json -> { cardData: { current: "card_data_v<data>.json" } }
//   https://cdn.cardkaizoku.com/<current>     -> [{ cardNumber, cardName, cardType, cost, power, ... }]
//
// Cuidados (README, "Spoilers"):
// - já errou contador, cor e poder: esses campos são "fracos" e vêm da fonte seguinte quando ela tem a carta;
// - Líder sem Vida em "cost" (as mais novas vêm vazias): a Vida vem da fonte seguinte (ou fica a padrão 5);
// - as imagens só abrem no próprio site (o CDN recusa links de fora): a carta fica sem imagem, ou com a
//   da fonte seguinte;
// - mistura lançadas e anunciadas: como fonte oficial, só traz coleções que outra fonte já tem e as
//   promos já à venda (com produto no TCGplayer); as demais entram pela cadeia de spoilers.

import { type CardCategory, type CardData, type Color, normalizeTypeQuotes } from '@gumgum/engine';
import type { FetchJson } from '../card-import';
import { splitTrigger } from '../optcgapi';
import { normalizeLeaksText } from '../spoiler-feed';
import type { CardSource, SourceCards } from './chain';

export const CARDKAIZOKU = 'cardkaizoku.com';
const CDN = 'https://cdn.cardkaizoku.com';
export const cardkaizokuManifestUrl = `${CDN}/manifest.json`;

export interface KaizokuCard {
  cardNumber?: string;
  cardName?: string;
  cardType?: string;
  cost?: string | number | null;
  power?: string | number | null;
  counter?: string | number | null;
  color?: string | null;
  attribute?: string | null;
  feature?: string | null;
  text?: string | null;
  trigger?: string | null;
  rarity?: string | null;
  cardSet?: string | null;
  /** Produtos à venda no TCGplayer (vazio = ainda não lançada em inglês). */
  products?: unknown[] | null;
}

const COLORS: Color[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];
const CATEGORIES: CardCategory[] = ['leader', 'character', 'event', 'stage'];

const list = (v: unknown) =>
  String(v ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '?');

const num = (v: unknown): number | undefined => {
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
};

/** Custo de DON!! "➀" (símbolo do site) vira "①" (o das cartas impressas, que o leitor entende). */
const DINGBAT_DIGITS = /[➀-➉]/g;

/** Texto do site no padrão do motor: além do que vale para o optcgleaks, custo ➀ e "DON!! −1" com hífen. */
export function normalizeKaizokuText(raw: string): string {
  const text = normalizeLeaksText(
    raw
      .replace(DINGBAT_DIGITS, (d) => String.fromCharCode(0x2460 + d.charCodeAt(0) - 0x2780))
      .replace(/DON!! ?[−–]\s?(\d)/g, 'DON!! -$1')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'"),
  ).text;
  return normalizeTypeQuotes(text);
}

/** Uma carta do Cardkaizoku no formato CardData; null sem número, nome ou categoria. */
export function mapKaizokuCard(raw: KaizokuCard): CardData | null {
  const id = String(raw.cardNumber ?? '').trim().toUpperCase();
  const name = String(raw.cardName ?? '').trim();
  const category = String(raw.cardType ?? '').toLowerCase() as CardCategory;
  if (!/^[A-Z]+\d*-\d+$/.test(id) || !name || !CATEGORIES.includes(category)) return null;

  // Texto null = ainda não revelado (vazio ou "-" = carta sem efeito).
  const effect = typeof raw.text === 'string' ? normalizeKaizokuText(raw.text.trim() === '-' ? '' : raw.text) : undefined;
  // Líderes de evento (P-000: "can only be used in designated events") não valem em partida normal.
  if (/can only be used in designated events/i.test(effect ?? '')) return null;
  const trigger = normalizeKaizokuText(raw.trigger ?? '').replace(/^\s*\[?Trigger\]?\s*/i, '');
  const split = effect !== undefined && !trigger ? splitTrigger(effect) : { text: effect, trigger: undefined };
  const triggerText = trigger || split.trigger;
  const hasPower = category === 'leader' || category === 'character';
  const aliases = [...(split.text ?? '').matchAll(/[Aa]lso treat this card's name as \[([^\]]+)\](?: and \[([^\]]+)\])?/g)].flatMap((m) =>
    m.slice(1).filter(Boolean),
  );

  return {
    id,
    name,
    category,
    colors: list(raw.color)
      .map((c) => c.toLowerCase())
      .filter((c): c is Color => COLORS.includes(c as Color)),
    // Nos Líderes o site guarda a Vida no campo do custo.
    cost: category === 'leader' ? undefined : num(raw.cost),
    life: category === 'leader' ? num(raw.cost) : undefined,
    power: hasPower ? num(raw.power) : undefined,
    counter: category === 'character' ? num(raw.counter) || undefined : undefined,
    attributes: list(raw.attribute),
    types: list(raw.feature),
    text: split.text as string,
    ...(triggerText ? { trigger: triggerText } : {}),
    ...(aliases.length ? { aliases } : {}),
    set: id.split('-')[0],
    ...(raw.rarity && raw.rarity !== '?' ? { rarity: String(raw.rarity) } : {}),
  };
}

/** Todas as cartas do site (o arquivo atual do manifesto). */
export async function fetchKaizokuCards(fetchJson: FetchJson): Promise<Required<SourceCards>> {
  const manifest = (await fetchJson(cardkaizokuManifestUrl)) as { cardData?: { current?: string } };
  const current = manifest?.cardData?.current;
  if (!current || !/^[\w./-]+\.json$/.test(current)) throw new Error(`${cardkaizokuManifestUrl}: manifesto sem cardData.current`);
  const url = /^https?:\/\//.test(current) ? current : `${CDN}/${current.replace(/^\/+/, '')}`;
  const body = await fetchJson(url);
  if (!Array.isArray(body)) throw new Error(`${url}: resposta não é uma lista de cartas`);
  const cards: CardData[] = [];
  const raw = new Map<string, unknown>();
  const released = new Set<string>();
  for (const row of body as KaizokuCard[]) {
    const card = mapKaizokuCard(row);
    // O arquivo repete algumas cartas; vale a primeira.
    if (!card || raw.has(card.id)) continue;
    const { products, ...rest } = row;
    if (Array.isArray(products) && products.length) released.add(card.id);
    cards.push(card);
    raw.set(card.id, rest);
  }
  return { cards, raw, released };
}

export function cardkaizokuSource(fetchJson: FetchJson): CardSource {
  // Um arquivo só para todas as coleções: baixa uma vez por rodada.
  let all: ReturnType<typeof fetchKaizokuCards> | undefined;
  return {
    id: 'cardkaizoku',
    host: CARDKAIZOKU,
    pageUrl: () => 'https://www.cardkaizoku.com/spoilers',
    weakFields: ['cost', 'power', 'counter', 'life', 'colors'],
    mixesSpoilers: true,
    async fetch({ sets }) {
      all ??= fetchKaizokuCards(fetchJson).catch((err) => {
        all = undefined;
        throw err;
      });
      const { cards, raw, released } = await all;
      const wanted = sets && new Set(sets.map((s) => s.toUpperCase().replace('-', '')));
      return { cards: wanted ? cards.filter((c) => wanted.has(c.set!)) : cards, raw, released };
    },
  };
}
