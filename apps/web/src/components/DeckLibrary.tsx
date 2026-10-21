// Biblioteca de decks: a entrada do construtor. Galeria com os meus decks, os favoritos, os da
// comunidade e os prontos, com busca, cores e ordenação. Os meus abrem no editor; os dos
// outros abrem no visualizador (para mudar as cartas, duplica-se). Admin e Dev apagam decks
// de outros jogadores daqui.

import { useMemo, useState } from 'react';
import type { DeckSummary } from '../api';
import { type DeckSort, type DeckTab, inTab, localRecent, matchesColors, matchesQuery, sortDecks } from '../deckLibrary';
import { useT } from '../i18n';
import { DeckTabs, DeckToolbar } from './DeckPicker';
import { DeckTile } from './DeckTile';
import { Icon } from './Icons';

const TABS: DeckTab[] = ['mine', 'favorites', 'community', 'builtin'];
const SORTS: DeckSort[] = ['updated', 'recent', 'name', 'color', 'leader', 'games'];

export function DeckLibrary({
  decks,
  staff,
  hint,
  error,
  onMenu,
  onNew,
  onImport,
  onOpen,
  onView,
  onDuplicate,
  onDelete,
  onFavorite,
}: {
  decks: DeckSummary[];
  /** Admin/Dev: apaga decks de outros jogadores. */
  staff: boolean;
  /** Onde os decks ficam guardados (conta ou navegador). */
  hint: string;
  error: string | null;
  onMenu: () => void;
  onNew: () => void;
  onImport: () => void;
  /** Abre um deck meu no editor (ou, para Admin/Dev, o de outro jogador, para corrigir o nome). */
  onOpen: (id: string) => void;
  /** Abre o deck de outro (ou pronto) no visualizador. */
  onView: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (d: DeckSummary) => void;
  onFavorite: (d: DeckSummary) => void;
}) {
  const t = useT();
  const [local] = useState(() => new Map(localRecent()));
  /** Aba escolhida; até a pessoa escolher, os meus decks (ou os prontos, se ainda não há nenhum meu). */
  const [picked, setTab] = useState<DeckTab | null>(null);
  const tab = picked ?? (decks.some((d) => d.kind === 'user' && d.mine) ? 'mine' : 'builtin');
  const [query, setQuery] = useState('');
  /** Ordem escolhida; até a pessoa escolher, a Comunidade junta os decks do mesmo Líder. */
  const [pickedSort, setSort] = useState<DeckSort | null>(null);
  const sort = pickedSort ?? (tab === 'community' ? 'leader' : 'updated');
  const [colors, setColors] = useState<string[]>([]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((tb) => [tb, decks.filter((d) => inTab(d, tb, local)).length])), [decks, local]);
  const visible = useMemo(
    () => sortDecks(decks.filter((d) => inTab(d, tab, local) && matchesQuery(d, query) && matchesColors(d, colors)), sort, local),
    [decks, tab, local, query, colors, sort],
  );
  /** Listas que aparecem em mais de um deck (cópias sem mudança). */
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const d of decks) if (d.deckHash && d.size) seen.set(d.deckHash, (seen.get(d.deckHash) ?? 0) + 1);
    return seen;
  }, [decks]);

  return (
    <div className="dk-library">
      <header className="dk-library-head">
        <button className="btn small" onClick={onMenu}>
          {t('deck.backMenu')}
        </button>
        <h2>{t('decks.library.title')}</h2>
        <button className="btn" onClick={onImport}>
          {t('decks.library.import')}
        </button>
        <button className="btn primary" onClick={onNew}>
          <Icon name="plus" size={16} stroke={3} /> {t('decks.library.new')}
        </button>
      </header>
      {error && <div className="error">{error}</div>}

      <div className="dk-library-filters">
        <DeckTabs tabs={TABS.map((tb) => [tb, t(`decks.tab.${tb}`)] as [DeckTab, string])} value={tab} counts={counts} label={t('decks.tabsLabel')} onChange={setTab} />
        <DeckToolbar query={query} onQuery={setQuery} sort={sort} sorts={SORTS} onSort={setSort} colors={colors} onColors={setColors} />
      </div>

      {tab === 'community' && (
        <p className="dk-note">
          {t('decks.library.communityNote')}
          {staff && <b> {t('decks.library.adminNote')}</b>}
        </p>
      )}

      <div className="dk-grid wide">
        {visible.map((d) => {
          const mine = d.kind === 'user' && d.mine;
          const canDelete = d.kind === 'user' && (mine || staff);
          // Admin/Dev corrige o nome de decks de outros jogadores no editor (as cartas continuam deles).
          const canRename = d.kind === 'user' && !mine && staff;
          const dupe = d.kind === 'user' && Boolean(d.deckHash && (repeated.get(d.deckHash) ?? 0) > 1);
          return (
            <DeckTile
              key={d.id}
              deck={d}
              local={local}
              onSelect={() => (mine ? onOpen(d.id) : onView(d.id))}
              onFavorite={onFavorite}
              badge={
                dupe ? (
                  <span className="dk-badge" title={t('decks.library.dupeTitle')}>
                    {t('decks.library.dupeBadge')}
                  </span>
                ) : undefined
              }
              actions={
                <>
                  <button type="button" className="btn small primary" onClick={() => (mine ? onOpen(d.id) : onView(d.id))}>
                    {mine ? t('decks.edit') : t('decks.viewList')}
                  </button>
                  {canRename && (
                    <button type="button" className="btn small" onClick={() => onOpen(d.id)}>
                      {t('decks.editName')}
                    </button>
                  )}
                  <button type="button" className="btn small icon" onClick={() => onDuplicate(d.id)} aria-label={t('decks.duplicate')} title={t('decks.duplicate')}>
                    <Icon name="copy" size={16} />
                  </button>
                  {canDelete && (
                    <button type="button" className="btn small danger icon" onClick={() => onDelete(d)} aria-label={t('deck.delete')} title={t('deck.delete')}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </div>
      {!visible.length && <p className="dk-empty muted">{query || colors.length ? t('decks.empty.search') : t(`decks.empty.${tab}`)}</p>}
      <p className="muted small dk-library-hint">{hint}</p>
    </div>
  );
}
