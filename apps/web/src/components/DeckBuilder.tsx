import {
  type CardData,
  cardLegality,
  type Color,
  DECK_SIZE,
  FORMATS,
  formatIssues,
  formatDeckList,
  needsManual,
  isColorCompatible,
  leaderAllows,
  MAX_COPIES,
  anyNumberAllowed,
  parseDeckList,
  validateDeck,
} from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiCard, deckGroups, type DeckSummary } from '../api';
import { useAuth } from '../auth';
import { useLongPress } from '../hooks/useLongPress';
import { CardHoverPreview, StaticCardZoom } from './CardInfo';
import { StaticCard } from './CardView';
import { Icon } from './Icons';

interface Draft {
  id: string | null; // null = ainda não salvo
  name: string;
  leader: string;
  cards: Map<string, number>;
  /** user = meu (editável); builtin/community = somente leitura, editar cria uma cópia. */
  kind: 'builtin' | 'community' | 'user';
}

const emptyDraft = (): Draft => ({ id: null, name: 'Novo deck', leader: '', cards: new Map(), kind: 'user' });

const COLORS: Array<{ id: Color; label: string }> = [
  { id: 'red', label: 'Vermelho' },
  { id: 'green', label: 'Verde' },
  { id: 'blue', label: 'Azul' },
  { id: 'purple', label: 'Roxo' },
  { id: 'black', label: 'Preto' },
  { id: 'yellow', label: 'Amarelo' },
];

const CATEGORY_ORDER = { leader: 0, character: 1, event: 2, stage: 3 };
const CATEGORY_LABEL = { leader: 'Líderes', character: 'Personagens', event: 'Eventos', stage: 'Stages' };
const PAGE = 60;
/** Valor do filtro de coleção que mostra só as cartas de spoiler. */
const SPOILERS = '__spoilers';

/** Carta sob o mouse e o elemento dela (âncora do popover ampliado). */
interface Hovered {
  card: CardData;
  anchor: HTMLElement;
}

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function DeckBuilder({ onExit }: { onExit: () => void }) {
  const [allCards, setAllCards] = useState<ApiCard[]>([]);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const auth = useAuth();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHoveredState] = useState<Hovered | null>(null);
  const [textModal, setTextModal] = useState<null | 'import' | 'export'>(null);
  /** Carta aberta em modal (toque longo). */
  const [zoom, setZoom] = useState<CardData | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  /** Com mouse, a carta sob o cursor aparece ampliada num popover; no toque, segurar o dedo abre o modal. */
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  /** Tela estreita: os filtros ficam escondidos atrás do botão "Filtros" para sobrar espaço para as cartas. */
  const narrow = useMediaQuery('(max-width: 1100px)');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Toque longo numa linha do deck atual: abre a carta dela (um só handler para a lista toda).
  const entryPress = useLongPress<HTMLDivElement>((e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.entry')?.dataset.card;
    const card = id ? byId.get(id) : undefined;
    if (card) setZoom(card);
  });
  const setHovered = useCallback((card: CardData | null, anchor?: HTMLElement) => {
    setHoveredState(card && anchor ? { card, anchor } : null);
  }, []);
  // Rolar a tela move a âncora: o popover fecha até a próxima carta sob o mouse.
  useEffect(() => {
    if (!hovered) return;
    const off = () => setHoveredState(null);
    window.addEventListener('scroll', off, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', off, { capture: true });
  }, [hovered]);
  // A carta saiu da tela (por exemplo, a última cópia foi removida do deck) sem disparar mouseleave.
  useEffect(() => {
    if (hovered && !hovered.anchor.isConnected) setHoveredState(null);
  });

  // filtros
  const [query, setQuery] = useState('');
  const [colors, setColors] = useState<Color[]>([]);
  const [category, setCategory] = useState<'' | 'leader' | 'character' | 'event' | 'stage'>('');
  const [cost, setCost] = useState('');
  const [set, setSet] = useState('');
  const [onlyCompatible, setOnlyCompatible] = useState(true);
  const [onlyAutomated, setOnlyAutomated] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const byId = useMemo(() => new Map(allCards.map((c) => [c.id, c])), [allCards]);
  const leader = draft.leader ? byId.get(draft.leader) : undefined;

  const refreshDecks = useCallback(() => api.decks().then(setDecks), []);

  useEffect(() => {
    Promise.all([api.cards(), api.decks()])
      .then(([cards, list]) => {
        setAllCards(cards);
        setDecks(list);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => setLimit(PAGE), [query, colors, category, cost, set, onlyCompatible, onlyAutomated, draft.leader]);

  // Avisa antes de sair com alterações não salvas.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirmDiscard = () => !dirty || window.confirm('Descartar as alterações não salvas deste deck?');

  const sets = useMemo(() => [...new Set(allCards.map((c) => c.set ?? c.id.split('-')[0]))].sort(), [allCards]);
  /** Quantos filtros estão fora do padrão (selo do botão "Filtros" no celular). */
  const activeFilters = [colors.length > 0, category !== '', cost !== '', set !== '', !onlyCompatible, onlyAutomated].filter(Boolean).length;
  /** Coleções que ainda têm cartas de spoiler (não lançadas na API oficial). */
  const spoilerSets = useMemo(() => new Set(allCards.filter((c) => c.spoiler).map((c) => c.set ?? c.id.split('-')[0])), [allCards]);

  /** Sem Líder escolhido, a lista mostra só Líderes. */
  const choosingLeader = !draft.leader;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allCards
      .filter((c) => {
        if (choosingLeader && c.category !== 'leader') return false;
        if (!choosingLeader && category && c.category !== category) return false;
        if (!choosingLeader && !category && c.category === 'leader') return false;
        if (colors.length && !c.colors.some((col) => colors.includes(col))) return false;
        if (cost !== '' && (cost === '10' ? (c.cost ?? -1) < 10 : c.cost !== Number(cost))) return false;
        if (set === SPOILERS ? !c.spoiler : set && (c.set ?? c.id.split('-')[0]) !== set) return false;
        if (onlyCompatible && leader && c.category !== 'leader' && (!isColorCompatible(leader, c) || !leaderAllows(leader, c))) return false;
        if (onlyAutomated && needsManual(c)) return false;
        if (q) {
          const hay = `${c.id} ${c.name} ${c.types.join(' ')} ${c.text} ${c.i18n?.pt?.text ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [allCards, query, colors, category, cost, set, onlyCompatible, onlyAutomated, leader, choosingLeader]);

  const deckList = useMemo(
    () => ({ id: draft.id ?? 'rascunho', name: draft.name, leader: draft.leader, cards: [...draft.cards].map(([id, count]) => ({ id, count })) }),
    [draft],
  );
  const report = useMemo(() => validateDeck(deckList, byId), [deckList, byId]);
  /** Em quais formatos o deck pode ser usado, e por que não nos outros. */
  const legality = useMemo(() => FORMATS.map((f) => ({ ...f, issues: formatIssues(deckList, f.id) })), [deckList]);
  const formatProblems = useMemo(() => [...new Set(legality.flatMap((f) => f.issues.map((i) => i.message)))], [legality]);

  // ------------------------------------------------------------------ edição

  /** Decks prontos são somente leitura: a primeira alteração cria uma cópia. */
  const edit = (fn: (d: Draft) => Draft) => {
    if (draft.kind !== 'user') {
      setNotice(
        draft.kind === 'builtin'
          ? 'Decks prontos não são alterados: você está editando uma cópia.'
          : 'Este deck é de outro jogador: você está editando uma cópia sua.',
      );
    }
    setDraft((d) => {
      const base = d.kind !== 'user' ? { ...d, id: null, kind: 'user' as const, name: `${d.name} (cópia)` } : d;
      return fn({ ...base, cards: new Map(base.cards) });
    });
    setDirty(true);
  };

  const add = (card: CardData) => {
    if (card.category === 'leader') {
      edit((d) => ({ ...d, leader: card.id }));
      return;
    }
    const current = draft.cards.get(card.id) ?? 0;
    if (current >= MAX_COPIES && !anyNumberAllowed(card)) {
      setNotice(`Máximo de ${MAX_COPIES} cópias de ${card.name}.`);
      return;
    }
    edit((d) => {
      d.cards.set(card.id, current + 1);
      return d;
    });
  };

  const remove = (id: string) => {
    if (!draft.cards.has(id)) return;
    edit((d) => {
      const n = (d.cards.get(id) ?? 0) - 1;
      if (n > 0) d.cards.set(id, n);
      else d.cards.delete(id);
      return d;
    });
  };

  const load = async (id: string) => {
    if (!confirmDiscard()) return;
    try {
      const { deck } = await api.deck(id);
      setDraft({
        id: deck.id,
        name: deck.name,
        leader: deck.leader,
        cards: new Map(deck.cards.map((c) => [c.id, c.count])),
        kind: deck.kind === 'builtin' ? 'builtin' : deck.mine ? 'user' : 'community',
      });
      setDirty(false);
      setNotice(
        deck.kind === 'builtin'
          ? 'Deck pronto: ao alterar, uma cópia será criada.'
          : deck.mine
            ? null
            : 'Deck de outro jogador: ao alterar, uma cópia sua será criada.',
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    const input = { name: draft.name.trim() || 'Sem nome', leader: draft.leader, cards: deckList.cards };
    try {
      const saved = draft.id && draft.kind === 'user' ? await api.updateDeck(draft.id, input) : await api.createDeck(input);
      setDraft((d) => ({ ...d, id: saved.id, kind: 'user', name: saved.name }));
      setDirty(false);
      setNotice(saved.valid ? 'Deck salvo e pronto para jogar!' : 'Rascunho salvo. Complete o deck para poder jogar.');
      setError(null);
      await refreshDecks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async () => {
    if (!draft.id || draft.kind !== 'user') return;
    if (!window.confirm(`Apagar o deck "${draft.name}"?`)) return;
    try {
      await api.deleteDeck(draft.id);
      setDraft(emptyDraft());
      setDirty(false);
      setNotice('Deck apagado.');
      await refreshDecks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const duplicate = () => {
    setDraft((d) => ({ ...d, id: null, kind: 'user', name: `${d.name} (cópia)`, cards: new Map(d.cards) }));
    setDirty(true);
    setNotice('Cópia criada. Salve para guardá-la.');
  };

  const newDeck = () => {
    if (!confirmDiscard()) return;
    setDraft(emptyDraft());
    setDirty(false);
    setNotice('Escolha um Líder para começar.');
  };

  // ------------------------------------------------------------------ resumo

  const entries = useMemo(
    () =>
      [...draft.cards]
        .map(([id, count]) => ({ id, count, card: byId.get(id) }))
        .sort((a, b) => {
          const ca = a.card ? CATEGORY_ORDER[a.card.category] : 9;
          const cb = b.card ? CATEGORY_ORDER[b.card.category] : 9;
          return ca - cb || (a.card?.cost ?? 0) - (b.card?.cost ?? 0) || a.id.localeCompare(b.id);
        }),
    [draft.cards, byId],
  );

  const curve = useMemo(() => {
    const buckets = Array.from({ length: 11 }, () => 0);
    for (const e of entries) if (e.card?.cost !== undefined) buckets[Math.min(e.card.cost, 10)] += e.count;
    return buckets;
  }, [entries]);
  const maxCurve = Math.max(1, ...curve);

  const counters = useMemo(() => {
    let c1 = 0;
    let c2 = 0;
    for (const e of entries) {
      if (e.card?.counter === 1000) c1 += e.count;
      if (e.card?.counter === 2000) c2 += e.count;
    }
    return { c1, c2 };
  }, [entries]);

  const errorIds = new Set(report.issues.filter((i) => i.level === 'error' && i.cardId).map((i) => i.cardId));

  // ------------------------------------------------------------------ render

  return (
    <div className="builder">
      <header className="builder-header">
        <button
          className="btn small"
          onClick={() => {
            if (confirmDiscard()) onExit();
          }}
        >
          ← Menu
        </button>
        <h2>Construtor de decks</h2>
        <div className="builder-decks">
          <button className="btn small primary" onClick={newDeck}>
            + Novo<span className="wide"> deck</span>
          </button>
          <DeckDropdown
            decks={decks}
            currentId={draft.id}
            onPick={load}
            hint={
              auth.user
                ? 'Seus decks ficam na sua conta Google: entre com ela em qualquer aparelho para editá-los.'
                : `Sem login, seus decks ficam ligados a este navegador: limpar os dados do site faz perder a edição deles (continuam visíveis e podem ser duplicados).${auth.clientId ? ' Entre com o Google no menu para guardá-los na sua conta.' : ''}`
            }
          />
        </div>
      </header>

      {error && (
        <div className="error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="builder-body">
        {/* ------------------------------------------------ catálogo */}
        <section className="builder-catalog">
          <div className="catalog-top">
          <div className="filters">
            <div className="search-row">
              <input
                className="search"
                placeholder="Buscar por nome, número, tipo ou texto…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {narrow && (
                <button
                  type="button"
                  className={['btn small filters-toggle', filtersOpen ? 'on' : ''].join(' ')}
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  Filtros
                  {activeFilters > 0 && <span className="filters-count">{activeFilters}</span>}
                </button>
              )}
            </div>
            <div className={['filters-more', narrow && !filtersOpen ? 'hidden' : ''].join(' ')}>
            <div className="color-chips">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  className={['chip', `c-${c.id}`, colors.includes(c.id) ? 'on' : ''].join(' ')}
                  title={c.label}
                  onClick={() => setColors((cs) => (cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id]))}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {!choosingLeader && (
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                <option value="">Todos os tipos</option>
                <option value="character">Personagens</option>
                <option value="event">Eventos</option>
                <option value="stage">Stages</option>
                <option value="leader">Líderes</option>
              </select>
            )}
            <select value={cost} onChange={(e) => setCost(e.target.value)}>
              <option value="">Qualquer custo</option>
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={String(i)}>
                  Custo {i === 10 ? '10+' : i}
                </option>
              ))}
            </select>
            <select value={set} onChange={(e) => setSet(e.target.value)}>
              <option value="">Todas as coleções</option>
              {spoilerSets.size > 0 && <option value={SPOILERS}>Só spoilers (não lançadas)</option>}
              {sets.map((s) => (
                <option key={s} value={s}>
                  {s}
                  {spoilerSets.has(s) ? ' (spoilers)' : ''}
                </option>
              ))}
            </select>
            {leader && (
              <label className="check">
                <input type="checkbox" checked={onlyCompatible} onChange={(e) => setOnlyCompatible(e.target.checked)} />
                Só cores do Líder
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={onlyAutomated} onChange={(e) => setOnlyAutomated(e.target.checked)} />
              Só efeitos automatizados
            </label>
            </div>
          </div>

          <div className="catalog-hint muted small">
            {choosingLeader
              ? canHover
                ? 'Escolha o Líder do deck: clique em um Líder.'
                : 'Toque em um Líder para escolhê-lo · segure: lê o efeito.'
              : canHover
                ? 'Clique para adicionar · botão direito para remover · passe o mouse para ler o efeito.'
                : 'Toque: adiciona · segure: lê o efeito.'}{' '}
            {filtered.length} carta(s).
          </div>
          </div>

          <div className="card-grid">
            {filtered.slice(0, limit).map((c) => {
              const n = draft.cards.get(c.id) ?? 0;
              const incompatible = leader && c.category !== 'leader' && (!isColorCompatible(leader, c) || !leaderAllows(leader, c));
              return (
                <div key={c.id} className="grid-cell">
                  <StaticCard
                    card={c}
                    highlight={c.id === draft.leader ? 'selected' : n > 0 ? 'playable' : null}
                    dimmed={Boolean(incompatible) || (n >= MAX_COPIES && c.category !== 'leader' && !anyNumberAllowed(c))}
                    onClick={() => add(c)}
                    onContextMenu={() => remove(c.id)}
                    onHover={setHovered}
                    onLongPress={setZoom}
                    badge={
                      <>
                        {n > 0 && <span className="copies">{n}/{MAX_COPIES}</span>}
                        {needsManual(c) && (
                          <span className="manual-badge" title="Efeito ainda não automatizado">
                            ⚙
                          </span>
                        )}
                        <LegalityBadge id={c.id} />
                      </>
                    }
                  />
                  <div className="grid-caption" title={c.name}>
                    {c.id}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > limit && (
            <button className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar mais ({filtered.length - limit})
            </button>
          )}
          {allCards.length === 0 && !error && <div className="muted">Carregando cartas…</div>}
        </section>

        {/* ------------------------------------------------ deck atual */}
        <aside className="builder-deck">
          <input
            className="deck-name"
            value={draft.name}
            maxLength={60}
            onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
            aria-label="Nome do deck"
          />
          {notice && <div className="notice">{notice}</div>}

          <div className="leader-slot">
            {leader ? (
              <>
                <StaticCard card={leader} onHover={setHovered} onLongPress={setZoom} />
                <div>
                  <div className="muted small">Líder</div>
                  <b>{leader.name}</b>
                  <div className="small">
                    {leader.colors.map((c) => COLORS.find((x) => x.id === c)?.label).join(' / ')} · Vida {leader.life}
                  </div>
                  <button className="btn small" onClick={() => edit((d) => ({ ...d, leader: '' }))}>
                    Trocar Líder
                  </button>
                </div>
              </>
            ) : (
              <div className="muted">Nenhum Líder escolhido.</div>
            )}
          </div>

          <div className="deck-stats">
            <div className={['deck-total', report.total === DECK_SIZE ? 'ok' : ''].join(' ')}>
              <b>{report.total}</b>/{DECK_SIZE}
            </div>
            <div className="curve" title="Curva de custo">
              {curve.map((n, i) => (
                <div key={i} className="curve-col">
                  <div className="curve-bar" style={{ height: `${(n / maxCurve) * 100}%` }} title={`${n} carta(s)`} />
                  <span>{i === 10 ? '10+' : i}</span>
                </div>
              ))}
            </div>
            <div className="small muted">
              Counter: {counters.c1}× +1000 · {counters.c2}× +2000
            </div>
          </div>

          <div
            className="deck-entries"
            {...entryPress.handlers}
            onClickCapture={(e) => {
              // O clique que o navegador manda depois do toque longo não mexe nas quantidades.
              if (entryPress.consume()) {
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            {entries.length === 0 && (
              <div className="muted small">{canHover ? 'Clique nas cartas do catálogo para adicioná-las.' : 'Toque nas cartas do catálogo para adicioná-las.'}</div>
            )}
            {entries.map((e, i) => {
              const prev = entries[i - 1]?.card?.category;
              return (
                <div key={e.id}>
                  {e.card && e.card.category !== prev && (
                    <div className="entry-group">{CATEGORY_LABEL[e.card.category]}</div>
                  )}
                  <div
                    className={['entry', errorIds.has(e.id) || cardLegality(e.id, 'egb') === 'banned' ? 'bad' : ''].join(' ')}
                    data-card={e.id}
                    onMouseEnter={(ev) => e.card && setHovered(e.card, ev.currentTarget)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span className={`entry-cost c-${e.card?.colors[0] ?? 'red'}`}>{e.card?.cost ?? '?'}</span>
                    <span className="entry-name">
                      {e.card?.name ?? e.id}
                      <small>
                        {e.id}
                        {e.card && needsManual(e.card) ? ' · ⚙ manual' : ''}
                        {LEGALITY_NOTE[cardLegality(e.id, 'standard')]}
                      </small>
                    </span>
                    <button className="qty" onClick={() => remove(e.id)} aria-label="Remover uma">
                      −
                    </button>
                    <b className="entry-count">{e.count}</b>
                    <button
                      className="qty"
                      onClick={() => e.card && add(e.card)}
                      disabled={e.count >= MAX_COPIES && !(e.card && anyNumberAllowed(e.card))}
                      aria-label="Adicionar uma"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {(draft.leader || entries.length > 0) && (
            <div className="format-legality">
              {legality.map((f) => (
                <span
                  key={f.id}
                  className={['format-chip', f.issues.length ? 'bad' : 'ok'].join(' ')}
                  title={f.issues.map((i) => i.message).join('\n') || `Permitido no ${f.label}`}
                >
                  {f.issues.length ? '🚫' : '✓'} {f.label}
                </span>
              ))}
            </div>
          )}
          {formatProblems.length > 0 && (
            <ul className="issues">
              {formatProblems.map((m) => (
                <li key={m} className="warning">
                  {m}
                </li>
              ))}
            </ul>
          )}

          {report.issues.length > 0 && (
            <ul className="issues">
              {report.issues.map((i, k) => (
                <li key={k} className={i.level}>
                  {i.message}
                </li>
              ))}
            </ul>
          )}

          <div className="deck-actions">
            <button className="btn primary" onClick={save} disabled={!dirty && draft.id !== null}>
              {draft.id && draft.kind === 'user' ? 'Salvar' : 'Salvar deck'}
            </button>
            {draft.id && (
              <button className="btn" onClick={duplicate}>
                Duplicar
              </button>
            )}
            {draft.id && draft.kind === 'user' && (
              <button className="btn danger" onClick={del}>
                Apagar
              </button>
            )}
            <button className="btn" onClick={() => setTextModal('export')} disabled={!draft.leader && !entries.length}>
              Exportar lista
            </button>
            <button className="btn" onClick={() => setTextModal('import')}>
              Importar lista
            </button>
          </div>
        </aside>
      </div>

      {canHover && hovered && !textModal && !zoom && <CardHoverPreview card={hovered.card} anchor={hovered.anchor} />}
      {zoom && <StaticCardZoom card={zoom} onClose={closeZoom} />}

      {textModal && (
        <TextModal
          mode={textModal}
          initial={textModal === 'export' ? formatDeckList(deckList) : ''}
          onClose={() => setTextModal(null)}
          onImport={(text) => {
            const parsed = parseDeckList(text, byId);
            const total = parsed.cards.reduce((s, c) => s + c.count, 0);
            if (!parsed.leader && !total) return parsed.errors.length ? parsed.errors : ['Nenhuma carta reconhecida.'];
            edit((d) => ({
              ...d,
              leader: parsed.leader ?? d.leader,
              cards: new Map(parsed.cards.map((c) => [c.id, c.count])),
            }));
            setNotice(
              `Lista importada: ${total} carta(s)${parsed.errors.length ? `, ${parsed.errors.length} linha(s) ignorada(s)` : ''}.`,
            );
            return parsed.errors.length ? parsed.errors : null;
          }}
        />
      )}
    </div>
  );
}

const LEGALITY_NOTE = { legal: '', rotated: ' · ① rotacionada (só EGB)', banned: ' · 🚫 banida' } as const;

function deckRowTitle(d: DeckSummary): string {
  return FORMATS.map((f) => `${f.label}: ${d.formats[f.id].length ? 'não permitido' : 'permitido'}`).join(' · ');
}

/** Cores do deck e o selo de estado: ✓ (Standard), EGB (só Extra Grand Battle), 🚫 ou o tamanho de um rascunho. */
function DeckRowInfo({ d }: { d: DeckSummary }) {
  return (
    <>
      <span className="deck-colors">
        {d.colors.map((c) => (
          <i key={c} className={`dot c-${c}`} />
        ))}
      </span>
      <span className="deck-row-name">{d.name}</span>
      <span
        className={['deck-row-size', d.valid && !d.formats.standard.length ? 'ok' : 'bad'].join(' ')}
        title={d.valid ? deckRowTitle(d) : undefined}
      >
        {!d.valid ? `${d.size}/${DECK_SIZE}` : !d.formats.standard.length ? '✓' : !d.formats.egb.length ? 'EGB' : '🚫'}
      </span>
    </>
  );
}

/**
 * Decks salvos num menu suspenso (meus, da comunidade e prontos), com busca por nome ou Líder.
 * Fecha ao escolher, ao clicar fora ou com Esc.
 */
function DeckDropdown({
  decks,
  currentId,
  onPick,
  hint,
}: {
  decks: DeckSummary[];
  currentId: string | null;
  onPick: (id: string) => void;
  /** Onde os decks ficam guardados (conta Google ou este navegador). */
  hint: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = decks.find((d) => d.id === currentId);
  const needle = query.trim().toLowerCase();
  const groups = deckGroups(decks).map(
    ([title, group]) =>
      [title, needle ? group.filter((d) => `${d.name} ${d.leaderName ?? ''} ${d.leader}`.toLowerCase().includes(needle)) : group] as const,
  );

  return (
    <div className="deck-dd" ref={ref}>
      <button
        type="button"
        className={['deck-dd-btn', open ? 'open' : ''].join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current ? `Deck aberto: ${current.name}` : 'Abrir um deck salvo'}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? <DeckRowInfo d={current} /> : <span className="deck-row-name muted">Abrir um deck salvo…</span>}
        <span className="deck-dd-count" title={`${decks.length} deck(s)`}>
          {decks.length}
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="deck-dd-pop">
          <input
            ref={inputRef}
            className="search deck-dd-search"
            placeholder="Buscar deck por nome ou Líder…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar deck"
          />
          <div className="deck-list" role="listbox" aria-label="Decks salvos">
            {groups.map(([title, group]) =>
              title === 'Decks da comunidade' && !group.length ? null : (
                <div key={title}>
                  <div className="deck-list-title">{title}</div>
                  {group.length === 0 && <div className="muted small">{needle ? 'Nenhum deck encontrado.' : 'Nenhum deck ainda.'}</div>}
                  {group.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={d.id === currentId}
                      className={['deck-row', d.id === currentId ? 'on' : ''].join(' ')}
                      onClick={() => {
                        setOpen(false);
                        onPick(d.id);
                      }}
                    >
                      <DeckRowInfo d={d} />
                    </button>
                  ))}
                </div>
              ),
            )}
          </div>
          <p className="muted small owner-hint">{hint}</p>
        </div>
      )}
    </div>
  );
}

/** Selo no catálogo para cartas banidas ou rotacionadas (bloco ①). */
function LegalityBadge({ id }: { id: string }) {
  const legality = cardLegality(id, 'standard');
  if (legality === 'legal') return null;
  return legality === 'banned' ? (
    <span className="legality-badge banned" title="Banida: não vale em nenhum formato">
      🚫
    </span>
  ) : (
    <span className="legality-badge rotated" title="Bloco ①: rotacionada, vale só no Extra Grand Battle">
      ①
    </span>
  );
}

function TextModal({
  mode,
  initial,
  onClose,
  onImport,
}: {
  mode: 'import' | 'export';
  initial: string;
  onClose: () => void;
  onImport: (text: string) => string[] | null;
}) {
  const [text, setText] = useState(initial);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-box modal" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'export' ? 'Exportar lista' : 'Importar lista'}</h3>
        <p className="muted small">
          Formato: uma carta por linha, como <code>4xOP01-016</code>. O Líder pode vir na lista (<code>1xST01-001</code>).
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} readOnly={mode === 'export'} />
        {problems && (
          <ul className="issues">
            {problems.map((p, i) => (
              <li key={i} className="warning">
                {p}
              </li>
            ))}
          </ul>
        )}
        <div className="btn-row">
          {mode === 'export' ? (
            <button
              className="btn primary"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(text)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => {
                const errs = onImport(text);
                if (errs) setProblems(errs);
                else onClose();
              }}
            >
              Importar
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
