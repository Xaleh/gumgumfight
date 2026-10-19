// Cadeia de fontes das cartas: cada fonte devolve CardData já mapeado e a cadeia decide,
// carta por carta, de onde vem cada campo.
//
// - Vale a primeira fonte da cadeia que tem a carta ("vencedora", gravada em cards.source).
// - Campo vazio (atributo "", tipo cortado, número que a fonte não tem) é completado pela seguinte.
// - Valor diferente não é misturado: vale o da fonte de maior prioridade, com duas exceções:
//   - campos "fracos" da fonte (Cardkaizoku: números e cores) vêm da seguinte quando ela os tem;
//   - o texto da vencedora só vale se o leitor de efeitos entender pelo menos tanto quanto o da
//     seguinte (texto fora do padrão não pode derrubar a automação).
// - Imagem e artes vêm da primeira fonte que tem imagem (as do Cardkaizoku só abrem no site dele).
// - As divergências entre fontes vão para o relatório (log e var/card-source-diff.json).

import { type CardCategory, type CardData, parseCard } from '@gumgum/engine';

export type SourceKind = 'official' | 'spoiler';

export interface SourceCards {
  cards: CardData[];
  /** Resposta original de cada carta (coluna cards.raw). */
  raw?: Map<string, unknown>;
  /** Fontes que misturam spoilers: cartas que a fonte sabe que já foram lançadas (à venda). */
  released?: Set<string>;
}

/** Campos comparados e completados entre as fontes. */
export type ChainField = 'name' | 'category' | 'colors' | 'cost' | 'life' | 'power' | 'counter' | 'attributes' | 'types' | 'rarity' | 'text';

export interface CardSource {
  /** Nome na cadeia (CARD_SOURCES / SPOILER_SOURCES). */
  id: string;
  /** Domínio gravado em cards.source e em spoiler.source. */
  host: string;
  /** Página dos spoilers da coleção (spoiler.url). */
  pageUrl?: (set: string) => string;
  /** Campos em que a fonte erra com frequência: vale o da fonte seguinte que tiver a carta. */
  weakFields?: readonly ChainField[];
  /**
   * A fonte mistura cartas lançadas e anunciadas: como fonte oficial, só traz cartas de coleções
   * que outra fonte oficial (ou o banco) já tem. Promocionais (P-) uma a uma: as que outra fonte
   * oficial tem e as que a própria fonte marca como lançadas (`released`).
   */
  mixesSpoilers?: boolean;
  /** Cartas das coleções pedidas ("OP18", "P"); sem `sets`, tudo o que a fonte tem. */
  fetch(query: { sets?: string[] }): Promise<SourceCards>;
}

export interface Layer extends SourceCards {
  source: CardSource;
}

export interface ResolvedCard {
  card: CardData;
  /** Fonte vencedora. */
  source: CardSource;
  raw?: unknown;
}

export interface CardDiff {
  id: string;
  field: ChainField;
  /** Valor de cada fonte (id da fonte -> valor). */
  values: Record<string, unknown>;
  /** Fonte cujo valor ficou. */
  used: string;
}

export interface ChainReport {
  /** Por coleção: cartas por fonte vencedora. */
  bySet: Record<string, Record<string, number>>;
  /** Campos vazios completados por uma fonte seguinte. */
  filled: number;
  diffs: CardDiff[];
  /** Cartas deixadas de fora (coleção sem fonte oficial, dados incompletos). */
  skipped: Array<{ id: string; source: string; reason: string }>;
}

const NUMBERS = ['cost', 'life', 'power', 'counter'] as const;
const LISTS = ['colors', 'attributes', 'types'] as const;

/** O campo existe nessa categoria de carta. */
function applies(field: ChainField, category: CardCategory): boolean {
  if (field === 'cost') return category !== 'leader';
  if (field === 'life') return category === 'leader';
  if (field === 'power') return category === 'leader' || category === 'character';
  if (field === 'counter') return category === 'character';
  return true;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Forma de comparação: espaços, aspas tipográficas e maiúsculas não contam como diferença. */
function comparable(field: ChainField, v: unknown): string {
  if (field === 'counter' && !v) return '0';
  // Ordem dos tipos, cores e atributos não conta.
  const s = Array.isArray(v) ? [...v].map(String).sort().join('/') : String(v ?? '');
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[−–]/g, '-')
    .replace(/\[Activate: ?Main\]/gi, '[Activate: Main]')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const textOf = (c: CardData) => (c.trigger ? `${c.text}\n[Trigger] ${c.trigger}` : c.text);
const unparsed = (c: CardData) => parseCard(c).unparsed.length;

/**
 * Junta as cartas das fontes (em ordem de prioridade) numa carta por número.
 * `kind` = 'official': cartas de fontes que misturam spoilers só entram se `officialSet` aceitar a coleção.
 */
export function resolveChain(
  layers: Layer[],
  opts: { kind: SourceKind; officialSet?: (set: string) => boolean },
): { cards: ResolvedCard[]; report: ChainReport } {
  const report: ChainReport = { bySet: {}, filled: 0, diffs: [], skipped: [] };
  // Coleções e cartas que uma fonte só de cartas lançadas confirma.
  const confirmedSets = new Set<string>();
  const confirmedIds = new Set<string>();
  if (opts.kind === 'official') {
    for (const l of layers) {
      if (l.source.mixesSpoilers) continue;
      for (const c of l.cards) {
        confirmedSets.add(c.set ?? c.id.split('-')[0]);
        confirmedIds.add(c.id);
      }
    }
  }
  const rejects = (layer: Layer, c: CardData): string | null => {
    if (opts.kind !== 'official' || !layer.source.mixesSpoilers) return null;
    const set = c.set ?? c.id.split('-')[0];
    if (set === 'P') return confirmedIds.has(c.id) || layer.released?.has(c.id) ? null : 'promo ainda não lançada (vai como spoiler)';
    return confirmedSets.has(set) || opts.officialSet?.(set) ? null : 'coleção sem fonte oficial (vai como spoiler)';
  };

  // Número -> versões da carta, na ordem da cadeia.
  const byId = new Map<string, Array<{ layer: Layer; card: CardData }>>();
  for (const layer of layers) {
    for (const card of layer.cards) {
      const reason = rejects(layer, card);
      if (reason) {
        report.skipped.push({ id: card.id, source: layer.source.id, reason });
        continue;
      }
      const list = byId.get(card.id);
      if (list) list.push({ layer, card });
      else byId.set(card.id, [{ layer, card }]);
    }
  }

  const cards: ResolvedCard[] = [];
  for (const [id, entries] of byId) {
    const winner = entries[0];
    const out: CardData = { ...winner.card };
    const category = winner.card.category;
    const diff = (field: ChainField, used: string, get: (c: CardData) => unknown) => {
      const values: Record<string, unknown> = {};
      for (const e of entries) {
        const v = get(e.card);
        if (!isEmpty(v) && applies(field, category)) values[e.layer.source.id] = v;
      }
      if (new Set(Object.entries(values).map(([, v]) => comparable(field, v))).size > 1) report.diffs.push({ id, field, values, used });
    };

    // Números e listas: primeiro valor preenchido de uma fonte que não é fraca no campo.
    for (const field of [...NUMBERS, ...LISTS, 'rarity'] as const) {
      if (!applies(field, category)) continue;
      const filled = entries.filter((e) => !isEmpty(e.card[field]));
      const pick = filled.find((e) => !e.layer.source.weakFields?.includes(field)) ?? filled[0];
      if (pick) {
        (out as unknown as Record<string, unknown>)[field] = pick.card[field];
        if (isEmpty(winner.card[field])) report.filled++;
      }
      diff(field, pick?.layer.source.id ?? winner.layer.source.id, (c) => c[field]);
    }
    diff('name', winner.layer.source.id, (c) => c.name);
    diff('category', winner.layer.source.id, (c) => c.category);

    // Texto (com [Trigger], observações e nomes alternativos): o da vencedora, salvo se o leitor entender menos.
    const withText = entries.filter((e) => typeof e.card.text === 'string');
    let text = withText[0];
    if (text) {
      const bad = unparsed(text.card);
      const better = bad ? withText.slice(1).find((e) => unparsed(e.card) < bad) : undefined;
      if (better) text = better;
      if (text !== winner) {
        out.text = text.card.text;
        for (const k of ['trigger', 'notes', 'aliases'] as const) {
          if (text.card[k]) (out as unknown as Record<string, unknown>)[k] = text.card[k];
          else delete out[k];
        }
      }
    }
    diff('text', text?.layer.source.id ?? winner.layer.source.id, (c) => (typeof c.text === 'string' ? textOf(c) : undefined));
    if (!text) {
      report.skipped.push({ id, source: winner.layer.source.id, reason: 'sem texto (carta ainda não revelada inteira)' });
      continue;
    }

    // Imagem e artes andam juntas.
    const image = entries.find((e) => e.card.imageUrl);
    delete out.arts;
    if (image) {
      out.imageUrl = image.card.imageUrl;
      if (image.card.arts) out.arts = image.card.arts;
    } else delete out.imageUrl;

    out.set ??= id.split('-')[0];
    const set = out.set;
    const bySource = (report.bySet[set] ??= {});
    bySource[winner.layer.source.id] = (bySource[winner.layer.source.id] ?? 0) + 1;
    cards.push({ card: out, source: winner.layer.source, raw: winner.layer.raw?.get(id) });
  }
  cards.sort((a, b) => (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0));
  return { cards, report };
}

/** Uma linha por coleção: "OP18: cardkaizoku 48 | optcgleaks 2". */
export function formatReport(report: ChainReport): string[] {
  const lines = Object.entries(report.bySet)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([set, by]) =>
        `${set}: ${Object.entries(by)
          .map(([s, n]) => `${s} ${n}`)
          .join(' | ')}`,
    );
  const byField = new Map<string, number>();
  for (const d of report.diffs) byField.set(d.field, (byField.get(d.field) ?? 0) + 1);
  if (report.filled) lines.push(`Campos vazios completados pela fonte seguinte: ${report.filled}`);
  if (report.diffs.length) {
    lines.push(
      `Divergências entre fontes: ${report.diffs.length} (${[...byField]
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${f} ${n}`)
        .join(', ')})`,
    );
  }
  const skipped = new Map<string, string[]>();
  for (const s of report.skipped) skipped.set(s.reason, [...(skipped.get(s.reason) ?? []), s.id]);
  for (const [reason, ids] of skipped) lines.push(`Fora (${reason}): ${ids.length}${ids.length <= 12 ? ` — ${ids.join(' ')}` : ''}`);
  return lines;
}
