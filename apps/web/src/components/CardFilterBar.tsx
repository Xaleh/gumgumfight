// A barra de busca e filtros de cartas, a mesma no construtor de decks e na montagem do Selado:
// a busca com atalhos (c3, c2000, blocker…; `cardSearch.ts`) e o painel "?" que os explica, as
// cores, a categoria, o custo e a coleção. Em tela estreita os filtros ficam atrás do botão
// "Filtros". Quem usa guarda o estado e decide o que mais filtra (`children`: caixas extras).

import type { CardData, Color } from '@gumgum/engine';
import { type ReactNode, useMemo, useState } from 'react';
import { type CardQuery, type CardSearchContext, matchesCardQuery } from '../cardSearch';
import { type MessageKey, useT } from '../i18n';
import { CardSearchHelp } from './CardSearchHelp';

export type CategoryFilter = '' | 'leader' | 'character' | 'event' | 'stage';

export interface CardFilters {
  query: string;
  /** Vazio: todas as cores. */
  colors: Color[];
  category: CategoryFilter;
  /** '' (qualquer), '0' a '9', ou '10' (10 ou mais). */
  cost: string;
  /** '' (todas), o código da coleção, ou `SPOILER_SET` (só cartas de spoiler). */
  set: string;
}

export const NO_FILTERS: CardFilters = { query: '', colors: [], category: '', cost: '', set: '' };
/** Valor do filtro de coleção que mostra só as cartas de spoiler. */
export const SPOILER_SET = '__spoilers';

export const FILTER_COLORS: Array<{ id: Color; label: MessageKey }> = [
  { id: 'red', label: 'deck.color.red' },
  { id: 'green', label: 'deck.color.green' },
  { id: 'blue', label: 'deck.color.blue' },
  { id: 'purple', label: 'deck.color.purple' },
  { id: 'black', label: 'deck.color.black' },
  { id: 'yellow', label: 'deck.color.yellow' },
];
export const CATEGORY_LABEL: Record<CardData['category'], MessageKey> = {
  leader: 'deck.cat.leader',
  character: 'deck.cat.character',
  event: 'deck.cat.event',
  stage: 'deck.cat.stage',
};

export const cardSetOf = (c: Pick<CardData, 'id' | 'set'>) => c.set ?? c.id.split('-')[0];

/** Nomes das cores e das categorias no idioma em vigor também valem como atalho da busca ("rouge", "eventos"). */
export function useSearchAliases(): Record<string, string> {
  const t = useT();
  return useMemo(() => {
    const aliases: Record<string, string> = {};
    for (const c of FILTER_COLORS) aliases[t(c.label)] = c.id;
    for (const cat of ['leader', 'character', 'event', 'stage'] as const) aliases[t(CATEGORY_LABEL[cat])] = cat;
    return aliases;
  }, [t]);
}

/** Quantos filtros da barra estão ligados (a busca não conta: ela está sempre à vista). */
export const activeFilterCount = (f: CardFilters) => [f.colors.length > 0, f.category !== '', f.cost !== '', f.set !== ''].filter(Boolean).length;

/** Se a carta passa por todos os filtros da barra e pela busca já interpretada (`parseCardQuery`). */
export function matchesCardFilters(card: CardData, f: CardFilters, q: CardQuery, ctx: CardSearchContext = {}): boolean {
  if (f.category && card.category !== f.category) return false;
  if (f.colors.length && !card.colors.some((c) => f.colors.includes(c))) return false;
  if (f.cost !== '' && (f.cost === '10' ? (card.cost ?? -1) < 10 : card.cost !== Number(f.cost))) return false;
  if (f.set === SPOILER_SET ? !card.spoiler : f.set && cardSetOf(card) !== f.set) return false;
  return matchesCardQuery(card, q, ctx);
}

export function CardFilterBar({
  value,
  onChange,
  narrow,
  categories = ['character', 'event', 'stage', 'leader'],
  sets = [],
  spoilerSets,
  extraActive = 0,
  children,
}: {
  value: CardFilters;
  onChange: (patch: Partial<CardFilters>) => void;
  /** Tela estreita: os filtros ficam escondidos atrás do botão "Filtros". */
  narrow: boolean;
  /** Categorias do seletor, na ordem; vazio esconde o seletor. */
  categories?: ReadonlyArray<Exclude<CategoryFilter, ''>>;
  /** Coleções do seletor; com menos de duas, ele não aparece. */
  sets?: readonly string[];
  /** Coleções que ainda têm cartas de spoiler (ganham a marca e a opção "só spoilers"). */
  spoilerSets?: ReadonlySet<string>;
  /** Filtros extras de quem usa a barra (`children`) que estão ligados, para o selo do botão "Filtros". */
  extraActive?: number;
  children?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const active = activeFilterCount(value) + extraActive;
  return (
    <>
      <div className="filters">
        <div className="search-row">
          <input className="search" placeholder={t('deck.searchPlaceholder')} aria-label={t('deck.searchPlaceholder')} value={value.query} onChange={(e) => onChange({ query: e.target.value })} />
          <button
            type="button"
            className={['btn small search-help-toggle', helpOpen ? 'on' : ''].join(' ')}
            aria-expanded={helpOpen}
            aria-label={t('deck.searchHelp')}
            title={t('deck.searchHelp')}
            onClick={() => setHelpOpen((v) => !v)}
          >
            ?
          </button>
          {narrow && (
            <button type="button" className={['btn small filters-toggle', open ? 'on' : ''].join(' ')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {t('deck.filters')}
              {active > 0 && <span className="filters-count">{active}</span>}
            </button>
          )}
        </div>
        <div className={['filters-more', narrow && !open ? 'hidden' : ''].join(' ')}>
          <div className="color-chips">
            {FILTER_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={['chip', `c-${c.id}`, value.colors.includes(c.id) ? 'on' : ''].join(' ')}
                aria-pressed={value.colors.includes(c.id)}
                title={t(c.label)}
                onClick={() => onChange({ colors: value.colors.includes(c.id) ? value.colors.filter((x) => x !== c.id) : [...value.colors, c.id] })}
              >
                {t(c.label)}
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <select value={value.category} aria-label={t('deck.allCategories')} onChange={(e) => onChange({ category: e.target.value as CategoryFilter })}>
              <option value="">{t('deck.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {t(CATEGORY_LABEL[cat])}
                </option>
              ))}
            </select>
          )}
          <select value={value.cost} aria-label={t('deck.anyCost')} onChange={(e) => onChange({ cost: e.target.value })}>
            <option value="">{t('deck.anyCost')}</option>
            {Array.from({ length: 11 }, (_, i) => (
              <option key={i} value={String(i)}>
                {t('deck.costOption', { n: i === 10 ? '10+' : i })}
              </option>
            ))}
          </select>
          {sets.length > 1 && (
            <select value={value.set} aria-label={t('deck.allSets')} onChange={(e) => onChange({ set: e.target.value })}>
              <option value="">{t('deck.allSets')}</option>
              {spoilerSets && spoilerSets.size > 0 && <option value={SPOILER_SET}>{t('deck.onlySpoilers')}</option>}
              {sets.map((s) => (
                <option key={s} value={s}>
                  {spoilerSets?.has(s) ? t('deck.setWithSpoilers', { set: s }) : s}
                </option>
              ))}
            </select>
          )}
          {children}
        </div>
      </div>
      {helpOpen && <CardSearchHelp query={value.query} onQuery={(query) => onChange({ query })} />}
    </>
  );
}
