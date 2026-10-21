// Seletor de deck para jogar (menu, treino contra o robô, sala privada, torneio): abas
// (recentes, favoritos, meus, comunidade, prontos), busca, filtro por cor e ordenação; ao lado,
// a prévia do deck escolhido (Líder, formatos, curva, principais cartas). Os decks que não valem
// nas regras de quem pede ficam no fim, recolhidos, com o motivo escrito.

import { type CardData, DECK_SIZE, FORMATS, withArt } from '@gumgum/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type DeckSummary } from '../api';
import {
  DECK_COLORS,
  type DeckSort,
  type DeckTab,
  deckNumbers,
  inTab,
  initialTab,
  localRecent,
  matchesColors,
  matchesQuery,
  rememberDeck,
  sortDecks,
  topCards,
} from '../deckLibrary';
import { type MessageKey, useT } from '../i18n';
import { StaticCard } from './CardView';
import { CostCurve, DeckTile, LeaderBanner } from './DeckTile';
import { DeckViewer } from './DeckViewer';
import { Icon } from './Icons';

export const RANDOM_DECK = 'random';

export const DECK_TABS: DeckTab[] = ['recent', 'favorites', 'mine', 'community', 'builtin'];
const SORTS: DeckSort[] = ['recent', 'name', 'color', 'games'];
export const COLOR_LABEL: Record<string, MessageKey> = {
  red: 'deck.color.red',
  green: 'deck.color.green',
  blue: 'deck.color.blue',
  purple: 'deck.color.purple',
  black: 'deck.color.black',
  yellow: 'deck.color.yellow',
};

type Detail = { cards: Map<string, CardData>; list: Array<{ id: string; count: number }>; arts?: Record<string, string> };

/** Abas em pílulas, com a contagem de cada uma. */
export function DeckTabs<T extends string>({ tabs, value, counts, label, onChange }: { tabs: Array<[T, string]>; value: T; counts: Record<string, number>; label: string; onChange: (t: T) => void }) {
  return (
    <div className="dk-tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          {text}
          <span className="dk-count">{counts[id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** Busca, ordenação e cores. */
export function DeckToolbar({
  query,
  onQuery,
  sort,
  sorts,
  onSort,
  colors,
  onColors,
}: {
  query: string;
  onQuery: (q: string) => void;
  sort: DeckSort;
  sorts: DeckSort[];
  onSort: (s: DeckSort) => void;
  colors: string[];
  onColors: (c: string[]) => void;
}) {
  const t = useT();
  return (
    <div className="dk-toolbar">
      <label className="dk-search">
        <Icon name="search" size={18} />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('decks.search')} aria-label={t('decks.searchLabel')} />
      </label>
      <label className="dk-sort">
        <span className="muted small">{t('decks.sort')}</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as DeckSort)}>
          {sorts.map((s) => (
            <option key={s} value={s}>
              {t(`decks.sort.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="dk-colors" role="group" aria-label={t('decks.colorsLabel')}>
        {DECK_COLORS.map((c) => {
          const on = colors.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={['dk-color', `c-${c}`, on ? 'on' : ''].join(' ')}
              aria-pressed={on}
              aria-label={t(COLOR_LABEL[c])}
              title={t(COLOR_LABEL[c])}
              onClick={() => onColors(on ? colors.filter((x) => x !== c) : [...colors, c])}
            />
          );
        })}
      </div>
    </div>
  );
}

export function DeckPicker({
  title,
  context,
  decks,
  value,
  canUse,
  whyNot,
  allowRandom,
  onPick,
  onClose,
  onFavorite,
  onEdit,
}: {
  title: string;
  /** Para que o deck vai ser usado ("Torneio · Standard"…). */
  context?: string;
  decks: DeckSummary[];
  value: string;
  /** O deck vale nas regras de quem pede. */
  canUse: (d: DeckSummary) => boolean;
  /** Por que não vale (texto mostrado na lista dos que não podem ser usados). */
  whyNot: (d: DeckSummary) => string | null;
  /** Oferece "Aleatório" (deck pronto sorteado; o oponente do treino). */
  allowRandom?: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
  onFavorite: (d: DeckSummary) => void;
  /** Abre o deck no construtor (editar o meu, ou abrir o de outro para duplicar). */
  onEdit?: (id: string) => void;
}) {
  const t = useT();
  const [local] = useState(() => new Map(localRecent()));
  const [tab, setTab] = useState<DeckTab>(() => initialTab(decks, local, value));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DeckSort>('recent');
  const [colors, setColors] = useState<string[]>([]);
  const [selected, setSelected] = useState(value || (allowRandom ? RANDOM_DECK : ''));
  const [showBlocked, setShowBlocked] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [details, setDetails] = useState<Map<string, Detail>>(new Map());
  const grid = useRef<HTMLDivElement>(null);

  // Esc fecha (o visualizador aberto por cima fecha antes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !viewing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewing]);

  const counts = useMemo(() => Object.fromEntries(DECK_TABS.map((tb) => [tb, decks.filter((d) => inTab(d, tb, local)).length])), [decks, local]);
  const visible = useMemo(
    () => sortDecks(decks.filter((d) => inTab(d, tab, local) && matchesQuery(d, query) && matchesColors(d, colors)), sort, local),
    [decks, tab, local, query, colors, sort],
  );
  const usable = visible.filter(canUse);
  const blocked = visible.filter((d) => !canUse(d));
  const current = selected === RANDOM_DECK ? undefined : decks.find((d) => d.id === selected);
  const currentOk = selected === RANDOM_DECK || (current ? canUse(current) : false);

  // Prévia: as cartas do deck escolhido (uma vez por deck).
  useEffect(() => {
    if (!current || details.has(current.id)) return;
    let stop = false;
    api.deck(current.id).then(
      (r) => {
        if (stop) return;
        const cards = new Map(r.cards.map((c) => [c.id, c as CardData]));
        setDetails((m) => new Map(m).set(current.id, { cards, list: r.deck.cards, arts: r.deck.arts }));
      },
      () => undefined,
    );
    return () => {
      stop = true;
    };
  }, [current, details]);

  // Ao abrir, a grade mostra o deck já escolhido.
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>('.dk-tile.on')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const use = (id: string) => {
    if (id !== RANDOM_DECK) rememberDeck(id);
    onPick(id);
  };
  const detail = current ? details.get(current.id) : undefined;
  const numbers = detail ? deckNumbers(detail.list, detail.cards) : null;
  const leader = current && detail ? detail.cards.get(current.leader) : undefined;
  const tabLabels = DECK_TABS.map((tb) => [tb, t(`decks.tab.${tb}`)] as [DeckTab, string]);

  return (
    <div className="modal-backdrop page-sheet dk-picker-backdrop" onClick={onClose}>
      <div className="dk-picker" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dk-picker-head">
          <div>
            <h3>{title}</h3>
            {context && <div className="muted small">{context}</div>}
          </div>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="dk-picker-cols">
          <div className="dk-picker-main">
            <div className="dk-picker-top">
              <DeckTabs tabs={tabLabels} value={tab} counts={counts} label={t('decks.tabsLabel')} onChange={setTab} />
              <DeckToolbar query={query} onQuery={setQuery} sort={sort} sorts={SORTS} onSort={setSort} colors={colors} onColors={setColors} />
            </div>

            <div className="dk-grid" ref={grid}>
              {allowRandom && (
                <article className={['dk-tile', 'random', selected === RANDOM_DECK ? 'on' : ''].join(' ')}>
                  <button
                    type="button"
                    className="dk-tile-main"
                    aria-pressed={selected === RANDOM_DECK}
                    onClick={() => setSelected(RANDOM_DECK)}
                    onDoubleClick={() => use(RANDOM_DECK)}
                  >
                    <span className="dk-banner random">
                      <span className="dk-banner-name">?</span>
                    </span>
                    <span className="dk-tile-body">
                      <b className="dk-tile-name">{t('decks.random')}</b>
                      <span className="dk-tile-meta muted">{t('decks.randomHint')}</span>
                    </span>
                  </button>
                </article>
              )}
              {usable.map((d) => (
                <DeckTile
                  key={d.id}
                  deck={d}
                  local={local}
                  selected={d.id === selected}
                  onSelect={() => setSelected(d.id)}
                  onActivate={() => use(d.id)}
                  onFavorite={onFavorite}
                />
              ))}
            </div>
            {!usable.length && !blocked.length && (
              <p className="dk-empty muted">{query || colors.length ? t('decks.empty.search') : t(`decks.empty.${tab}`)}</p>
            )}

            {blocked.length > 0 && (
              <div className="dk-blocked">
                <button type="button" className="dk-blocked-toggle" aria-expanded={showBlocked} onClick={() => setShowBlocked((v) => !v)}>
                  <Icon name="chevron" size={16} />
                  {t('decks.blocked', { n: blocked.length })}
                </button>
                {showBlocked && (
                  <ul>
                    {blocked.map((d) => (
                      <li key={d.id} className={d.id === selected ? 'on' : ''}>
                        <button type="button" className="dk-blocked-row" onClick={() => setSelected(d.id)}>
                          <LeaderBanner deck={d} />
                          <span>
                            <b>{d.name}</b>
                            <span className="dk-why">{whyNot(d)}</span>
                          </span>
                        </button>
                        {d.mine && onEdit && (
                          <button type="button" className="btn small" onClick={() => onEdit(d.id)}>
                            {t('decks.openInBuilder')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <aside className="dk-preview" aria-label={t('decks.preview')}>
            {selected === RANDOM_DECK ? (
              <>
                <span className="dk-banner big random">
                  <span className="dk-banner-name">?</span>
                </span>
                <b className="dk-preview-name">{t('decks.random')}</b>
                <p className="muted small">{t('decks.randomHint')}</p>
              </>
            ) : current ? (
              <>
                <LeaderBanner deck={current} big />
                <div>
                  <b className="dk-preview-name">{current.name}</b>
                  {leader && (
                    <div className="muted small">
                      {t('decks.leaderLine', { colors: leader.colors.map((c) => t(COLOR_LABEL[c] ?? 'deck.color.red')).join(' / '), life: leader.life ?? 0 })}
                    </div>
                  )}
                </div>
                <div className="dk-chips">
                  {!current.valid && <span className="dk-chip bad">{t('decks.state.draft', { size: current.size, max: DECK_SIZE })}</span>}
                  {FORMATS.map((f) => (
                    <span key={f.id} className={['dk-chip', current.formats[f.id].length ? 'bad' : 'ok'].join(' ')}>
                      {current.formats[f.id].length ? '🚫' : '✓'} {f.label}
                    </span>
                  ))}
                  {Boolean(current.spoilers?.length) && <span className="dk-chip spoiler">{t('decks.state.spoilers')}</span>}
                </div>
                {!currentOk && <p className="dk-why">{whyNot(current)}</p>}
                {numbers ? (
                  <>
                    <div>
                      <div className="dk-label">{t('decks.curve')}</div>
                      <CostCurve curve={numbers.curve} />
                      <div className="muted small">{t('decks.counters', { c1: numbers.counter1000, c2: numbers.counter2000 })}</div>
                    </div>
                    <div>
                      <div className="dk-label">{t('decks.topCards')}</div>
                      <div className="dk-top">
                        {topCards(detail!.list, detail!.cards).map((c) => {
                          const card = detail!.cards.get(c.id);
                          return card ? (
                            <StaticCard key={c.id} card={withArt(card, detail!.arts?.[c.id])} badge={<span className="copies">{c.count}×</span>} />
                          ) : null;
                        })}
                      </div>
                    </div>
                    <button type="button" className="dk-link" onClick={() => setViewing(true)}>
                      {t('decks.viewFullList', { n: numbers.total })}
                    </button>
                  </>
                ) : (
                  <p className="muted small">{t('decks.loading')}</p>
                )}
              </>
            ) : (
              <p className="muted small">{t('decks.pickHint')}</p>
            )}
            <div className="dk-preview-actions">
              <button type="button" className="btn primary big" disabled={!currentOk} onClick={() => use(selected)}>
                {t('decks.use')}
              </button>
              {current && onEdit && (
                <button type="button" className="btn" onClick={() => onEdit(current.id)}>
                  {current.mine ? t('decks.edit') : t('decks.openInBuilder')}
                </button>
              )}
            </div>
          </aside>
        </div>

        {/* No celular a prévia fica escondida: o rodapé mostra o escolhido, "Ver lista" e "Usar". */}
        <div className="dk-picker-foot">
          <span className="dk-foot-name">{selected === RANDOM_DECK ? t('decks.random') : (current?.name ?? '')}</span>
          {current && (
            <button type="button" className="btn small" onClick={() => setViewing(true)}>
              {t('decks.viewList')}
            </button>
          )}
          <button type="button" className="btn primary" disabled={!currentOk} onClick={() => use(selected)}>
            {t('decks.use')}
          </button>
        </div>
      </div>
      {viewing && current && (
        <div onClick={(e) => e.stopPropagation()}>
          <DeckViewer
            deckId={current.id}
            onClose={() => setViewing(false)}
            onPlay={() => use(current.id)}
            playDisabled={currentOk ? null : whyNot(current)}
            onEdit={onEdit ? () => onEdit(current.id) : undefined}
            editLabel={current.mine ? t('decks.edit') : t('decks.openInBuilder')}
          />
        </div>
      )}
    </div>
  );
}
