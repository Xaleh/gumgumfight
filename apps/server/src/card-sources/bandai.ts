// Lista oficial da Bandai em inglês (en.onepiece-cardgame.com/cardlist) como fonte de dados.
//
// A lista publica a coleção inteira antes do lançamento (OP18: as 119 cartas uma semana antes), com
// o texto das cartas impressas; a optcgapi, que copia essa lista, costuma publicar dias depois. No
// dia do lançamento, a sincronização dos spoilers usa esta fonte no lugar da optcgapi para as
// coleções que a API ainda não tem (spoiler-sync.ts).
//
//   <base>/cardlist/               <select name="series"> com as coleções ("… [OP-18]")
//   <base>/cardlist/?series=<id>   um <dl class="modalCol" id="OP18-021_p1"> por impressão
//
// Cada <dl> vira uma linha no formato da optcgapi e passa pelo mesmo mapeamento (optcgapi.ts):
// nomes, tipos, [Trigger], escolha entre as impressões, artes e as cartas de outras coleções
// reimpressas na página (`artOnly`) saem iguais às da API.
//
// As imagens da lista só abrem no próprio site (Cross-Origin-Resource-Policy: same-site): só valem
// com a CDN própria, que as copia. Sem ela (`images: false`), a fonte não traz imagem nem artes.

import type { CardData } from '@gumgum/engine';
import { BANDAI_REGIONS, type BandaiRegion, type BandaiSeries, type FetchText, fetchText as defaultFetchText, parseSeriesList } from '../card-cdn/official';
import { mapApiBodies } from '../card-import';
import type { CardSource, SourceCards } from './chain';

/** A lista em inglês: a única com o texto das cartas no idioma do leitor de efeitos. */
export const BANDAI_LIST: BandaiRegion = BANDAI_REGIONS[0];

/** Erros conhecidos da própria lista (o tipo certo é o da carta impressa). */
const TYPE_ERRORS: Record<string, string> = { 音楽: 'Music' };

const decode = (s: string) =>
  s
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

/** "OP-18" de "BOOSTER PACK -THE DOMINANCE OF GOD- [OP-18]" (o `set_id` da optcgapi). */
const seriesCode = (label: string) => label.match(/[[【]([A-Z]+-?\d+(?:-[A-Z]+-?\d+)*)[\]】]/)?.[1] ?? '';

/** Versão da impressão no nome, como a optcgapi escreve (vira o rótulo da arte). */
function variantSuffix(variant: string, rarity: string): string {
  if (/_r\d+$/i.test(variant)) return ' (Reprint)';
  if (!/_p\d+$/i.test(variant)) return '';
  if (/^SP\b/i.test(rarity)) return ' (SP)';
  if (/^TR$/i.test(rarity)) return ' (TR)';
  return ' (Alternate Art)';
}

/** As impressões de uma página de coleção, como linhas da optcgapi. */
export function parseListRows(html: string, series: Pick<BandaiSeries, 'label'>, base: string = BANDAI_LIST.base): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const setId = seriesCode(series.label);
  for (const m of html.matchAll(/<dl class="modalCol" id="([^"]+)">([\s\S]*?)<\/dl>/g)) {
    const variant = m[1].trim();
    const body = m[2];
    const info = body.match(/<div class="infoCol">\s*<span>([^<]*)<\/span>\s*\|\s*<span>([^<]*)<\/span>\s*\|\s*<span>([^<]*)<\/span>/);
    const name = body.match(/<div class="cardName">([\s\S]*?)<\/div>/);
    if (!info || !name) continue;
    const field = (cls: string) => {
      const f = body.match(new RegExp(`<div class="${cls}">\\s*<h3>[\\s\\S]*?</h3>([\\s\\S]*?)</div>`));
      const v = f ? decode(f[1]) : '';
      return v === '-' ? '' : v;
    };
    const category = decode(info[3]);
    const rarity = decode(info[2]);
    const leader = /leader/i.test(category);
    const hasPower = leader || /character/i.test(category);
    const src = body.match(/data-src="([^"]*images\/cardlist\/card\/[^"]+)"/)?.[1];
    // O [Trigger] vem num campo à parte, já com "[Trigger]" na frente: vai para o fim do texto, como na API.
    const text = [field('text'), field('trigger')].filter(Boolean).join('\n');
    out.push({
      card_set_id: decode(info[1]),
      card_image_id: variant,
      card_name: decode(name[1]) + variantSuffix(variant, rarity),
      card_type: category,
      rarity: /^SP\b/i.test(rarity) ? undefined : rarity,
      card_color: field('color'),
      life: leader ? field('cost') : null,
      card_cost: leader ? null : field('cost'),
      // A lista mostra "-" no poder 0 de um Personagem; a API manda 0.
      card_power: field('power') || (hasPower ? '0' : null),
      counter_amount: field('counter'),
      // "?" = a lista ainda não tem o atributo (OP18-065).
      attribute: decode(body.match(/<div class="attribute">[\s\S]*?<i>([^<]*)<\/i>/)?.[1] ?? '').replace(/^\?$/, ''),
      sub_types: field('feature')
        .split('/')
        .map((t) => TYPE_ERRORS[t.trim()] ?? t.trim())
        .filter(Boolean)
        .join('/'),
      // A API publica o sinal de menos da lista ("−") como hífen.
      card_text: text.replace(/−/g, '-'),
      set_id: setId,
      set_name: series.label,
      card_image: src ? new URL(src, `${base}/cardlist/`).href.replace(/\?.*$/, '') : null,
    });
  }
  return out;
}

/** "OP-18" | "op18" -> "OP18". */
const setCode = (s: string) => s.trim().toUpperCase().replace('-', '');

export function bandaiSource(
  opts: {
    fetchText?: FetchText;
    /** Com a CDN própria, que copia as imagens; sem ela a fonte só traz os dados (padrão). */
    images?: boolean;
    /** Intervalo entre as páginas (padrão 1 s). */
    delayMs?: number;
    region?: BandaiRegion;
  } = {},
): CardSource {
  const get = opts.fetchText ?? defaultFetchText;
  const region = opts.region ?? BANDAI_LIST;
  return {
    id: 'bandai',
    host: new URL(region.base).host,
    async fetch({ sets }): Promise<SourceCards> {
      // Só coleções pedidas, uma página cada: a lista inteira são dezenas de páginas.
      const wanted = new Set((sets ?? []).map(setCode).filter((s) => s !== 'P'));
      if (!wanted.size) return { cards: [] };
      const series = parseSeriesList(await get(`${region.base}/cardlist/`)).filter((s) => s.sets.some((set) => wanted.has(set)));
      const rows: Array<Record<string, unknown>> = [];
      for (const s of series) {
        if (opts.delayMs !== 0) await new Promise((r) => setTimeout(r, opts.delayMs ?? 1000));
        rows.push(...parseListRows(await get(`${region.base}/cardlist/?series=${s.id}`), s, region.base));
      }
      const mapped = mapApiBodies([rows]);
      // As da coleção pedida e as de outras coleções reimpressas na página (só pelas artes).
      const keep = (c: CardData) => wanted.has(c.set ?? c.id.split('-')[0]) || mapped.artOnly.has(c.id);
      if (opts.images) return { cards: mapped.cards.filter(keep), raw: mapped.raw, artOnly: mapped.artOnly };
      const cards = mapped.cards
        .filter((c) => keep(c) && !mapped.artOnly.has(c.id))
        .map((c) => {
          const { imageUrl: _image, arts: _arts, ...rest } = c;
          return rest as CardData;
        });
      return { cards, raw: mapped.raw };
    },
  };
}
