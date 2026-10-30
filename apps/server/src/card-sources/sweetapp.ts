// SweetApp como fonte da cadeia: a API de cartas que o parceiro disponibilizou para o GumGum Fight.
//
// A ideia não é o jogo consultar o SweetApp em tempo real: a API dele entra como MAIS UMA fonte
// da importação (CARD_SOURCES / SPOILER_SOURCES), a cadeia junta carta a carta com as outras, e o
// resultado unificado vai para a CDN (card-cdn/data.ts), de onde as duas plataformas leem.
//
// Variáveis (deploy.env):
//   SWEETAPP_CARDS_URL         endereço que devolve as cartas. Com "{set}" no caminho ou na query
//                              (ex.: https://api.sweetapp.com.br/optcg/cards?set={set}), uma
//                              requisição por coleção; sem ele, uma requisição com tudo.
//   SWEETAPP_API_KEY           chave enviada no header SWEETAPP_API_KEY_HEADER (padrão x-api-key);
//                              vazio = sem chave.
//
// Resposta aceita: uma lista de cartas, ou um objeto com a lista em `cards`, `data`, `items` ou
// `results`. Paginação: `next`, `nextPage`, `next_page` ou `links.next` com o endereço da próxima
// página (absoluto ou relativo). Os campos de cada carta aceitam os nomes em inglês e em português
// (ver FIELDS): o contrato combinado com o SweetApp está em docs/integracao-sweetapp.md.
//
// O texto do efeito usado pelo motor tem de ser o inglês (`text`/`effect`/`textEn`…). Texto só em
// português (`textPt`/`efeito`) não entra como `text`: fica para a etapa de traduções (ver o doc).

import { type CardCategory, type CardData, type Color, normalizeTypeQuotes } from '@gumgum/engine';
import { HttpError } from '../card-import';
import { splitTrigger } from '../optcgapi';
import { normalizeLeaksText } from '../spoiler-feed';
import type { CardSource, SourceCards } from './chain';

export const SWEETAPP = 'sweetapp.com.br';
const MAX_PAGES = 200;

/** Nomes aceitos para cada campo, em ordem de preferência. */
export const FIELDS = {
  id: ['id', 'number', 'code', 'cardNumber', 'card_number', 'numero', 'número', 'codigo', 'código'],
  name: ['name', 'cardName', 'card_name', 'nome'],
  category: ['category', 'cardType', 'card_type', 'type', 'tipo', 'categoria'],
  colors: ['colors', 'color', 'cores', 'cor'],
  cost: ['cost', 'custo'],
  life: ['life', 'vida'],
  power: ['power', 'poder'],
  counter: ['counter', 'contador'],
  attributes: ['attributes', 'attribute', 'atributos', 'atributo'],
  types: ['types', 'traits', 'feature', 'features', 'subtypes', 'tipos', 'tracos', 'traços'],
  text: ['textEn', 'text_en', 'effectEn', 'effect_en', 'text', 'effect', 'texto', 'efeitoEn'],
  trigger: ['triggerEn', 'trigger_en', 'trigger', 'gatilho'],
  rarity: ['rarity', 'raridade'],
  set: ['set', 'setCode', 'set_code', 'collection', 'colecao', 'coleção'],
  image: ['image', 'imageUrl', 'image_url', 'img', 'imagem', 'imagemUrl'],
  released: ['released', 'lancada', 'lançada', 'isReleased'],
} as const;

const COLORS: Record<string, Color> = {
  red: 'red',
  vermelho: 'red',
  vermelha: 'red',
  green: 'green',
  verde: 'green',
  blue: 'blue',
  azul: 'blue',
  purple: 'purple',
  roxo: 'purple',
  roxa: 'purple',
  black: 'black',
  preto: 'black',
  preta: 'black',
  yellow: 'yellow',
  amarelo: 'yellow',
  amarela: 'yellow',
};

const CATEGORIES: Record<string, CardCategory> = {
  leader: 'leader',
  lider: 'leader',
  líder: 'leader',
  character: 'character',
  personagem: 'character',
  event: 'event',
  evento: 'event',
  stage: 'stage',
  estagio: 'stage',
  estágio: 'stage',
  cenario: 'stage',
  cenário: 'stage',
};

export type SweetAppCard = Record<string, unknown>;

const pick = (raw: SweetAppCard, names: readonly string[]): unknown => {
  for (const n of names) if (raw[n] !== undefined && raw[n] !== null) return raw[n];
  return undefined;
};

/** Lista a partir de um array ou de um texto com "/" ou ","; "?" e "-" não contam. */
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[/,]/)).map((s) => s.trim()).filter((s) => s && s !== '?' && s !== '-');

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
};

/** Texto no padrão do motor (entidades HTML, <br>, aspas tipográficas, "DON!! −1"). */
export function normalizeSweetAppText(raw: string): string {
  const text = normalizeLeaksText(
    raw
      .replace(/DON!! ?[−–]\s?(\d)/g, 'DON!! -$1')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'"),
  ).text;
  return normalizeTypeQuotes(text);
}

/** Uma carta do SweetApp no formato CardData; null sem número, nome ou categoria conhecida. */
export function mapSweetAppCard(raw: SweetAppCard): CardData | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(pick(raw, FIELDS.id) ?? '')
    .trim()
    .toUpperCase()
    .replace(/_(P|R)\d+$/i, '');
  const name = String(pick(raw, FIELDS.name) ?? '').trim();
  const category = CATEGORIES[String(pick(raw, FIELDS.category) ?? '').trim().toLowerCase()];
  if (!/^[A-Z]+\d*-\d+$/.test(id) || !name || !category) return null;

  const effectRaw = pick(raw, FIELDS.text);
  const effect = typeof effectRaw === 'string' ? normalizeSweetAppText(effectRaw.trim() === '-' ? '' : effectRaw) : '';
  const triggerRaw = String(pick(raw, FIELDS.trigger) ?? '');
  const trigger = normalizeSweetAppText(triggerRaw).replace(/^\s*\[?Trigger\]?\s*/i, '');
  const split = trigger ? { text: effect, trigger } : splitTrigger(effect);
  const hasPower = category === 'leader' || category === 'character';
  const aliases = [...(split.text ?? '').matchAll(/[Aa]lso treat this card's name as \[([^\]]+)\](?: and \[([^\]]+)\])?/g)].flatMap((m) =>
    m.slice(1).filter(Boolean),
  );
  const image = pick(raw, FIELDS.image);
  const set = String(pick(raw, FIELDS.set) ?? '')
    .trim()
    .toUpperCase()
    .replace('-', '');

  return {
    id,
    name,
    category,
    colors: [...new Set(list(pick(raw, FIELDS.colors)).map((c) => COLORS[c.toLowerCase()]).filter((c): c is Color => Boolean(c)))],
    ...(category !== 'leader' && num(pick(raw, FIELDS.cost)) !== undefined ? { cost: num(pick(raw, FIELDS.cost)) } : {}),
    ...(category === 'leader' && num(pick(raw, FIELDS.life)) !== undefined ? { life: num(pick(raw, FIELDS.life)) } : {}),
    ...(hasPower && num(pick(raw, FIELDS.power)) !== undefined ? { power: num(pick(raw, FIELDS.power)) } : {}),
    ...(category === 'character' && num(pick(raw, FIELDS.counter)) ? { counter: num(pick(raw, FIELDS.counter)) } : {}),
    attributes: list(pick(raw, FIELDS.attributes)),
    types: list(pick(raw, FIELDS.types)),
    text: split.text ?? '',
    ...(split.trigger ? { trigger: split.trigger } : {}),
    ...(aliases.length ? { aliases } : {}),
    set: /^[A-Z]+\d*$/.test(set) ? set : id.split('-')[0],
    ...(pick(raw, FIELDS.rarity) ? { rarity: String(pick(raw, FIELDS.rarity)) } : {}),
    ...(typeof image === 'string' && /^https?:\/\//.test(image) ? { imageUrl: image } : {}),
  };
}

/** A lista de cartas de uma resposta (lista pura ou dentro de `cards`/`data`/`items`/`results`). */
export function sweetAppRows(body: unknown): SweetAppCard[] | null {
  if (Array.isArray(body)) return body as SweetAppCard[];
  if (body && typeof body === 'object') {
    for (const k of ['cards', 'data', 'items', 'results']) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as SweetAppCard[];
    }
  }
  return null;
}

/** Endereço da próxima página, se a resposta indicar uma. */
export function sweetAppNext(body: unknown, current: string): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const links = o.links as Record<string, unknown> | undefined;
  const next = o.next ?? o.nextPage ?? o.next_page ?? links?.next;
  if (typeof next !== 'string' || !next.trim()) return null;
  try {
    const url = new URL(next, current).toString();
    return url === current ? null : url;
  } catch {
    return null;
  }
}

export interface SweetAppConfig {
  /** SWEETAPP_CARDS_URL (com "{set}" opcional). */
  url: string;
  apiKey?: string | null;
  /** Header da chave (padrão x-api-key). */
  apiKeyHeader?: string;
}

/** Configuração do ambiente; null sem SWEETAPP_CARDS_URL. */
export function sweetAppConfig(env: NodeJS.ProcessEnv = process.env): SweetAppConfig | null {
  const url = env.SWEETAPP_CARDS_URL?.trim();
  if (!url || !/^https?:\/\//.test(url)) return null;
  return { url, apiKey: env.SWEETAPP_API_KEY?.trim() || null, apiKeyHeader: env.SWEETAPP_API_KEY_HEADER?.trim() || 'x-api-key' };
}

const setUrl = (template: string, set: string) => template.replace(/\{set\}/g, encodeURIComponent(set));

/** Baixa todas as páginas de um endereço. */
async function fetchAll(cfg: SweetAppConfig, start: string, fetchImpl: typeof fetch): Promise<SweetAppCard[]> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'gumgumfight-importer' };
  if (cfg.apiKey) headers[cfg.apiKeyHeader ?? 'x-api-key'] = cfg.apiKey;
  const rows: SweetAppCard[] = [];
  let url: string | null = start;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new HttpError(url, res.status, res.statusText);
    const body: unknown = await res.json();
    const list = sweetAppRows(body);
    if (!list) throw new Error(`${url}: resposta não é uma lista de cartas`);
    rows.push(...list);
    url = sweetAppNext(body, url);
  }
  return rows;
}

export function sweetAppSource(cfg: SweetAppConfig, fetchImpl: typeof fetch = fetch): CardSource {
  const perSet = /\{set\}/.test(cfg.url);
  // Sem "{set}" no endereço, uma requisição só serve todas as coleções da rodada.
  let all: Promise<SweetAppCard[]> | undefined;
  const collect = (rows: SweetAppCard[], wanted?: Set<string>): SourceCards => {
    const cards: CardData[] = [];
    const raw = new Map<string, unknown>();
    const released = new Set<string>();
    for (const row of rows) {
      const card = mapSweetAppCard(row);
      if (!card || raw.has(card.id) || (wanted && !wanted.has(card.set!))) continue;
      const rel = pick(row, FIELDS.released);
      if (rel === true || rel === 1 || /^(true|1|sim|yes)$/i.test(String(rel ?? ''))) released.add(card.id);
      cards.push(card);
      raw.set(card.id, row);
    }
    return { cards, raw, released };
  };
  return {
    id: 'sweetapp',
    host: SWEETAPP,
    // A API pode trazer coleções anunciadas junto das lançadas: como fonte oficial, só entram as
    // coleções que outra fonte oficial (ou o banco) confirma e as promos marcadas como lançadas.
    mixesSpoilers: true,
    async fetch({ sets }) {
      const wanted = sets && new Set(sets.map((s) => s.toUpperCase().replace('-', '')));
      if (perSet) {
        if (!wanted) throw new Error('SWEETAPP_CARDS_URL com {set} exige as coleções (use --all só com um endereço que devolva tudo)');
        const rows: SweetAppCard[] = [];
        for (const set of wanted) {
          try {
            rows.push(...(await fetchAll(cfg, setUrl(cfg.url, set), fetchImpl)));
          } catch (err) {
            // Coleção que a API não tem (404) não conta como erro.
            if (err instanceof HttpError && err.status === 404) continue;
            throw err;
          }
        }
        return collect(rows, wanted);
      }
      all ??= fetchAll(cfg, cfg.url, fetchImpl).catch((err) => {
        all = undefined;
        throw err;
      });
      return collect(await all, wanted);
    },
  };
}
