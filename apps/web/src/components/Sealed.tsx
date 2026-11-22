// Selado (Pré-release): o jogador abre 6 boosters de uma coleção, monta um deck de 40 cartas com o
// que saiu e joga com ele, contra o bot (no navegador) ou numa sala privada.
//
// Três telas no mesmo componente: a entrada (coleções e os decks selados já abertos), a abertura
// dos boosters e a montagem do deck. Os boosters são sorteados e gravados no servidor
// (`/api/sealed`); aqui só se revela, booster a booster, o que já saiu. O deck é salvo sozinho
// enquanto o jogador monta, e o servidor o confere de novo antes de cada partida.

import {
  anyLeaderAllowed,
  autoBuildLimited,
  type CardData,
  type Color,
  type DeckList,
  isCube,
  isRush,
  LIMITED_DECK_SIZE,
  type LimitedRules,
  needsManual,
  poolCounts,
  rushSets,
  SEALED_LEADER_ID,
  sealedLeaders,
  validateLimitedDeck,
} from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCardQuery } from '../cardSearch';
import { api, type CubeInfo, type OnlineSeat, type SealedPool, type SealedPoolSummary, type SealedSetInfo } from '../api';
import { buildSetup } from '../game/setup';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, type Translate, useT, useTryT } from '../i18n';
import { useSettings } from '../settings';
import { Booster, BoosterOpening } from './BoosterPack';
import { activeFilterCount, CardFilterBar, type CardFilters, cardSetOf, matchesCardFilters, NO_FILTERS, useSearchAliases } from './CardFilterBar';
import { CardHoverPreview, StaticCardZoom } from './CardInfo';
import { CubeList } from './Cube';
import { StaticCard } from './CardView';
import { Icon } from './Icons';

const OPENED_KEY = 'gumgum.sealed.opened';
const SAVE_DELAY_MS = 700;

const COLORS: Array<{ id: Color; label: MessageKey }> = [
  { id: 'red', label: 'deck.color.red' },
  { id: 'green', label: 'deck.color.green' },
  { id: 'blue', label: 'deck.color.blue' },
  { id: 'purple', label: 'deck.color.purple' },
  { id: 'black', label: 'deck.color.black' },
  { id: 'yellow', label: 'deck.color.yellow' },
];

/** Faixas de custo da grade de cartas. */
const BANDS: Array<{ key: MessageKey; fits: (cost: number) => boolean }> = [
  { key: 'sealed.bandLow', fits: (c) => c <= 2 },
  { key: 'sealed.bandMid', fits: (c) => c >= 3 && c <= 4 },
  { key: 'sealed.bandHigh', fits: (c) => c >= 5 },
];

/**
 * Quais boosters de cada abertura o jogador já abriu, na ordem em que abriu (só deste navegador).
 * Versões antigas guardavam só a quantidade: valia "os N primeiros".
 */
function readOpened(): Record<string, number | number[]> {
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as Record<string, number | number[]>;
  } catch {
    return {};
  }
}
/** Os boosters abertos de uma abertura (`null`: este navegador não sabe). */
function openedOf(id: string, total: number): number[] | null {
  const saved = readOpened()[id];
  if (saved === undefined) return null;
  const list = typeof saved === 'number' ? Array.from({ length: Math.max(0, saved) }, (_, i) => i) : Array.isArray(saved) ? saved : [];
  return [...new Set(list)].filter((i) => Number.isInteger(i) && i >= 0 && i < total);
}
function writeOpened(id: string, list: number[] | null) {
  try {
    const all = readOpened();
    if (list === null) delete all[id];
    else all[id] = list;
    localStorage.setItem(OPENED_KEY, JSON.stringify(all));
  } catch {
    /* sem armazenamento: a abertura recomeça ao recarregar */
  }
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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** As coleções de um deck selado para mostrar: "OP01" ou, no Pack Rush, "OP01 + OP05". */
const setsText = (set: string) => rushSets(set).join(' + ');
/** Nome do deck selado: "Selado OP01", "Pack Rush OP01 + OP05" ou, vindo de um pod, "Draft OP01" ou "Draft Cubo". */
const poolTitle = (pool: { set: string; draft?: boolean }, t: Translate) =>
  isCube(pool.set) ? t('sealed.cubeName') : pool.draft ? t('sealed.draftName', { sets: setsText(pool.set) }) : isRush(pool.set) ? t('sealed.rushName', { sets: setsText(pool.set) }) : t('sealed.poolName', { set: pool.set });

export function Sealed({
  onExit,
  onStart,
  onOnline,
  onDraft,
  openId,
  hub: startHub = 'sealed',
}: {
  /** Qual entrada mostrar: a do Selado (abrir 6 boosters) ou a do Draft (pods). As duas têm cartão próprio no menu. */
  hub?: 'sealed' | 'draft';
  onExit: () => void;
  /** Abre a tela de um pod de Draft. */
  onDraft: (podId: string) => void;
  /** Treino contra o bot (roda no navegador); `poolId`: para voltar ao deck depois da partida. */
  onStart: (setup: GameSetup, poolId: string) => void;
  onOnline: (seat: OnlineSeat, poolId: string) => void;
  /** Coleção aberta para abrir direto (volta de uma partida). */
  openId?: string;
}) {
  const t = useT();
  const [sets, setSets] = useState<SealedSetInfo[] | null>(null);
  const [packsPerPool, setPacksPerPool] = useState(6);
  const [pools, setPools] = useState<SealedPoolSummary[] | null>(null);
  const [cards, setCards] = useState<CardData[] | null>(null);
  const [pool, setPool] = useState<SealedPool | null>(null);
  const [view, setView] = useState<'hub' | 'packs' | 'build' | 'cube'>('hub');
  const [hub, setHub] = useState(startHub);
  const isDraft = hub === 'draft';
  const [picked, setPicked] = useState<string>('');
  /** Pack Rush: várias coleções, e cada booster é sorteado entre elas. */
  const [source, setSource] = useState<'one' | 'rush' | 'cube'>('one');
  const rush = source === 'rush';
  /** Draft Cubo: os boosters saem do Cubo da temporada, não de uma coleção. */
  const cubeMode = source === 'cube' && hub === 'draft';
  const [cube, setCube] = useState<CubeInfo | null>(null);
  const [mix, setMix] = useState<string[]>([]);
  const [rushLimits, setRushLimits] = useState({ min: 2, max: 12 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Pod de Draft em que o jogador já está (esperando ou draftando). */
  const [activePod, setActivePod] = useState<{ id: string; code: string } | null>(null);
  const [podCode, setPodCode] = useState('');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const reload = useCallback(() => api.sealed.pools().then(setPools).catch((e: unknown) => setError(errorText(e))), []);
  useEffect(() => {
    api.sealed
      .sets()
      .then((r) => {
        setSets(r.sets);
        setPacksPerPool(r.packs);
        if (r.rush) setRushLimits(r.rush);
        setPicked((p) => p || r.sets[0]?.set || '');
      })
      .catch((e: unknown) => setError(errorText(e)));
    void reload();
    api.cards().then(setCards).catch((e: unknown) => setError(errorText(e)));
    api.draft
      .active()
      .then((r) => setActivePod(r.pod))
      .catch(() => undefined);
    api.draft
      .cube()
      .then((r) => setCube(r.cube))
      .catch(() => undefined);
  }, [reload]);

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards]);

  /** Abre uma coleção já sorteada: na abertura dos boosters, se ainda há o que revelar; senão, na montagem. */
  const openPool = useCallback((p: SealedPool) => {
    setPool(p);
    // Deck de Draft: as cartas já foram escolhidas uma a uma, não há booster para abrir.
    const opened = p.draft ? p.packs.length : (openedOf(p.id, p.packs.length)?.length ?? (p.deck ? p.packs.length : 0));
    setView(opened >= p.packs.length ? 'build' : 'packs');
  }, []);
  const resume = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        openPool(await api.sealed.pool(id));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [openPool],
  );
  useEffect(() => {
    if (openId) void resume(openId);
  }, [openId, resume]);

  const canOpen = rush ? mix.length >= rushLimits.min : Boolean(picked);
  const canDraft = cubeMode ? Boolean(cube) : canOpen;
  const toggleMix = (set: string) => setMix((m) => (m.includes(set) ? m.filter((x) => x !== set) : m.length < rushLimits.max ? [...m, set] : m));
  const openNew = async () => {
    if (!canOpen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.sealed.open(rush ? mix : [picked]);
      writeOpened(p.id, []);
      setPool(p);
      setView('packs');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  /** Cria um pod de Draft com as coleções escolhidas, ou entra num pelo código. */
  const draft = async (join?: string) => {
    if (busy || (!join && !canDraft)) return;
    setBusy(true);
    setError(null);
    try {
      const pod = join ? await api.draft.join(join) : await api.draft.create(rush ? mix : [picked], cubeMode);
      onDraft(pod.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm(t('sealed.deleteConfirm'))) return;
    await api.sealed.remove(id).catch(() => undefined);
    writeOpened(id, null);
    void reload();
  };
  const toHub = () => {
    // Saindo de um deck, a entrada é a do tipo dele: deck de Draft volta para o Draft.
    if (pool) setHub(pool.draft ? 'draft' : 'sealed');
    // O Cubo só existe no Draft: voltando para o Selado, a fonte marcada volta a ser uma coleção.
    if (pool && !pool.draft && source === 'cube') setSource('one');
    setPool(null);
    setView('hub');
    void reload();
  };

  const header = (title: string, back: () => void) => (
    <header className="builder-header">
      <button className="btn small" onClick={back}>
        {t('common.back')}
      </button>
      <h2>{title}</h2>
    </header>
  );

  if (pool && cards && view === 'packs') {
    return (
      <div className="sealed">
        {header(poolTitle(pool, t), toHub)}
        <Packs pool={pool} byId={byId} onBuild={() => setView('build')} />
      </div>
    );
  }
  if (pool && cards && view === 'build') {
    return (
      <div className="sealed">
        {header(poolTitle(pool, t), toHub)}
        <Build pool={pool} byId={byId} cards={cards} onPool={setPool} onPacks={() => setView('packs')} onStart={onStart} onOnline={onOnline} />
      </div>
    );
  }

  const chosen = sets?.find((s) => s.set === picked);
  if (cube && cards && view === 'cube') {
    return (
      <div className="sealed">
        {header(t('cube.title'), () => setView('hub'))}
        {error && <div className="error sealed-wrap">{error}</div>}
        <CubeList
          cube={cube}
          byId={byId}
          action={
            <button type="button" className="mode-btn sealed-cta" onClick={() => void draft()} disabled={busy || Boolean(activePod)}>
              {t('cube.create')}
            </button>
          }
        />
      </div>
    );
  }
  /** Os decks desta entrada: os de Draft no Draft, os de boosters abertos no Selado. */
  const myPools = pools?.filter((p) => Boolean(p.draft) === isDraft) ?? null;
  const setsGrid = sets && sets.length > 0 && (
    <div className="sealed-sets" role="group" aria-label={rush ? t('sealed.pickSets') : t('sealed.pickSet')}>
      {sets.map((s) => {
        const on = rush ? mix.includes(s.set) : picked === s.set;
        return (
          <button key={s.set} type="button" className={['sealed-set', on ? 'on' : ''].join(' ')} aria-pressed={on} onClick={() => (rush ? toggleMix(s.set) : setPicked(s.set))}>
            <Booster set={s.set} small />
            <span className="sealed-set-info">
              <b>{s.set}</b>
              <small>{t('sealed.setCards', { cards: s.cards, leaders: s.leaders })}</small>
              {s.spoiler && <span className="home-chip gold">{t('sealed.setSpoiler')}</span>}
            </span>
            {rush && on && <span className="sealed-set-check">✓</span>}
          </button>
        );
      })}
    </div>
  );
  /** Ao lado do botão principal: as coleções do Pack Rush, ou a parte automatizada da coleção marcada. */
  const pickedInfo = rush ? (
    <>
      <span className="muted small">{mix.length < rushLimits.min ? t('sealed.rushPickMore', { n: rushLimits.min }) : t('sealed.rushPicked', { sets: [...mix].sort().join(' + ') })}</span>
      <button type="button" className="text-link" onClick={() => setMix(mix.length ? [] : (sets ?? []).slice(0, rushLimits.max).map((x) => x.set))}>
        {mix.length ? t('sealed.rushNone') : t('sealed.rushAll')}
      </button>
    </>
  ) : (
    chosen && <span className="muted small">{t('sealed.setAutomated', { pct: Math.round(chosen.automated * 100) })}</span>
  );
  const odds = !rush && chosen?.pack && (
    <p className="muted small sealed-odds">
      {t(chosen.pack.uncommons ? 'sealed.packMix' : 'sealed.packMixNoUc', {
        n: chosen.pack.commons + chosen.pack.uncommons + chosen.pack.rares + 1,
        c: chosen.pack.commons,
        uc: chosen.pack.uncommons,
        r: chosen.pack.rares + 1,
      })}{' '}
      {t('sealed.packOdds', { sr: Math.round(chosen.pack.sr * 100), sec: Math.round(chosen.pack.sec * 100), leader: Math.round(chosen.pack.leader * 100) })}
    </p>
  );
  /** Draft: entrar no pod de um amigo pelo código. */
  const joinRow = (
    <div className="sealed-draft-row">
      <div>
        <div className="kicker">{t('draft.joinTitle')}</div>
        <p className="muted small">{t('draft.joinHint')}</p>
      </div>
      <div className="code-row">
        <input value={podCode} onChange={(e) => setPodCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} aria-label={t('sealed.draftCode')} />
        <button type="button" className="btn" onClick={() => void draft(podCode.trim())} disabled={busy || podCode.trim().length !== 6}>
          {t('sealed.draftJoin')}
        </button>
      </div>
    </div>
  );
  return (
    <div className="sealed">
      {header(isDraft ? t('draft.titlePlain') : t('sealed.title'), onExit)}
      <div className="sealed-wrap">
        <section className="sealed-hero">
          <div className="hero-kicker">{isDraft ? t('draft.hubKicker') : t('sealed.kicker')}</div>
          <h1 className="hero-title">{isDraft ? t('draft.titlePlain') : t('sealed.title')}</h1>
          <p className="hero-sub">{isDraft ? t('sealed.draftIntro') : t('sealed.intro', { n: packsPerPool, size: LIMITED_DECK_SIZE })}</p>
          <ul className="home-chips">
            <li className="home-chip">{t('sealed.ruleDeck', { n: LIMITED_DECK_SIZE })}</li>
            <li className="home-chip">{t('sealed.ruleColors')}</li>
            <li className="home-chip">{rush || cubeMode ? t('sealed.ruleLeaderAny') : t('sealed.ruleLeader')}</li>
            <li className="home-chip">{t('sealed.ruleBans')}</li>
          </ul>
        </section>

        {error && <div className="error">{error}</div>}

        {activePod && (
          <section className="sealed-panel sealed-active-pod">
            <span>{t('sealed.draftActive', { code: activePod.code })}</span>
            <button type="button" className="btn primary" onClick={() => onDraft(activePod.id)}>
              {t('sealed.draftBack')}
            </button>
          </section>
        )}

        <section className="sealed-panel">
          <div className="section-head">
            <h3 className="sealed-h3">{cubeMode ? t('cube.title') : rush ? t('sealed.pickSets') : t('sealed.pickSet')}</h3>
            <div className="seg format-seg" role="group" aria-label={t('sealed.sourceLabel')}>
              <button type="button" className={source === 'one' ? 'on' : ''} aria-pressed={source === 'one'} onClick={() => setSource('one')}>
                {t('sealed.sourceOne')}
              </button>
              <button type="button" className={rush ? 'on' : ''} aria-pressed={rush} onClick={() => setSource('rush')} disabled={(sets?.length ?? 0) < rushLimits.min}>
                {t('sealed.sourceRush')}
              </button>
              {isDraft && cube && (
                <button type="button" className={cubeMode ? 'on' : ''} aria-pressed={cubeMode} onClick={() => setSource('cube')}>
                  {t('sealed.sourceCube')}
                </button>
              )}
            </div>
          </div>
          {rush && <p className="muted small">{isDraft ? t('draft.rushIntro', { min: rushLimits.min, max: rushLimits.max }) : t('sealed.rushIntro', { n: packsPerPool, min: rushLimits.min, max: rushLimits.max })}</p>}
          {cubeMode && cube ? (
            <>
              <div className="sealed-cube">
                <Booster set={cube.key} />
                <div className="sealed-cube-info">
                  <b>{cube.name}</b>
                  <p className="muted small">{t('cube.intro', { n: cube.cards.length, perColor: cube.perColor })}</p>
                  <ul className="home-chips">
                    <li className="home-chip">{t('cube.chipCards', { n: cube.cards.length })}</li>
                    <li className="home-chip">{t('cube.chipPerColor', { n: cube.perColor })}</li>
                  </ul>
                </div>
                <button type="button" className="btn" onClick={() => setView('cube')} disabled={!cards}>
                  {t('cube.seeList')}
                </button>
              </div>
              <div className="sealed-open-row">
                <button type="button" className="mode-btn sealed-cta" onClick={() => void draft()} disabled={busy || Boolean(activePod)}>
                  {t('cube.create')}
                </button>
              </div>
              {joinRow}
            </>
          ) : sets === null ? (
            <p className="muted">{t('common.loading')}</p>
          ) : sets.length === 0 ? (
            <p className="muted">{t('sealed.noSets')}</p>
          ) : isDraft ? (
            <>
              {setsGrid}
              <div className="sealed-open-row">
                <button type="button" className="mode-btn sealed-cta" onClick={() => void draft()} disabled={!canOpen || busy || Boolean(activePod)}>
                  {t('sealed.draftCreate')}
                </button>
                {pickedInfo}
              </div>
              {odds}
              {joinRow}
            </>
          ) : (
            <>
              {setsGrid}
              <div className="sealed-open-row">
                <button type="button" className="mode-btn sealed-cta" onClick={() => void openNew()} disabled={!canOpen || busy}>
                  {busy ? t('sealed.opening') : t('sealed.open', { n: packsPerPool })}
                </button>
                {pickedInfo}
              </div>
              {odds}
            </>
          )}
        </section>

        <section className="sealed-panel">
          <div className="section-head">
            <h3 className="sealed-h3">{isDraft ? t('draft.myDecks') : t('sealed.myDecks')}</h3>
            <span className="muted small">{t('sealed.myDecksHint')}</span>
          </div>
          {myPools === null ? (
            <p className="muted">{t('common.loading')}</p>
          ) : myPools.length === 0 ? (
            <p className="muted">{isDraft ? t('draft.noDecks') : t('sealed.noDecks')}</p>
          ) : (
            <ul className="sealed-pools">
              {myPools.map((p) => {
                const opened = openedOf(p.id, packsPerPool)?.length ?? (p.size ? packsPerPool : 0);
                const status = p.ready ? t('sealed.statusReady') : opened < packsPerPool && !p.size ? t('sealed.statusOpening') : t('sealed.statusBuilding', { size: p.size, max: LIMITED_DECK_SIZE });
                return (
                  <li key={p.id} className="sealed-pool">
                    <Booster set={p.set} small draft={p.draft} />
                    <span className="sealed-pool-info">
                      <b>{poolTitle(p, t)}</b>
                      <small className="muted">
                        {p.leader && byId.get(p.leader) ? `${byId.get(p.leader)!.name} · ` : ''}
                        {status}
                        {p.wins + p.losses > 0 ? ` · ${t('sealed.record', { w: p.wins, l: p.losses })}` : ''}
                      </small>
                    </span>
                    <button type="button" className={['btn small', p.ready ? 'primary' : ''].join(' ')} onClick={() => void resume(p.id)} disabled={busy}>
                      {p.ready ? t('sealed.play') : t('sealed.continue')}
                    </button>
                    <button type="button" className="btn small icon" onClick={() => void remove(p.id)} title={t('sealed.delete')} aria-label={t('sealed.delete')}>
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Popover e zoom de carta, como no construtor de decks. */
function useCardPeek() {
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [hovered, setHoveredState] = useState<{ card: CardData; anchor: HTMLElement } | null>(null);
  const [zoom, setZoom] = useState<CardData | null>(null);
  const setHovered = useCallback((card: CardData | null, anchor?: HTMLElement) => setHoveredState(card && anchor ? { card, anchor } : null), []);
  useEffect(() => {
    if (!hovered) return;
    const off = () => setHoveredState(null);
    window.addEventListener('scroll', off, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', off, { capture: true });
  }, [hovered]);
  useEffect(() => {
    if (hovered && !hovered.anchor.isConnected) setHoveredState(null);
  });
  const layer = (
    <>
      {canHover && hovered && !zoom && <CardHoverPreview card={hovered.card} anchor={hovered.anchor} />}
      {zoom && <StaticCardZoom card={zoom} onClose={() => setZoom(null)} />}
    </>
  );
  return { canHover, setHovered, setZoom, layer };
}

// ---------------------------------------------------------------------------
// Abertura dos boosters
// ---------------------------------------------------------------------------

function Packs({ pool, byId, onBuild }: { pool: SealedPool; byId: ReadonlyMap<string, CardData>; onBuild: () => void }) {
  const t = useT();
  const total = pool.packs.length;
  /** Os boosters já abertos, na ordem em que foram abertos (qualquer ordem: o jogador escolhe). */
  const [opened, setOpened] = useState<number[]>(() => openedOf(pool.id, total) ?? (pool.deck ? pool.packs.map((_, i) => i) : []));
  const [shown, setShown] = useState(() => opened[opened.length - 1] ?? -1);
  /** Booster fechado selecionado: um clique seleciona, o segundo abre. */
  const [picked, setPicked] = useState<number | null>(null);
  const closed = pool.packs.map((_, i) => i).filter((i) => !opened.includes(i));
  const peek = useCardPeek();
  const { animations } = useSettings();
  // Com as animações ligadas, cada booster é aberto na tela antes de as cartas aparecerem (nas suaves,
  // na versão curta). Só a opção do app decide: muitos celulares ligam "reduzir movimento" sozinhos
  // (economia de bateria) e a abertura sumiria sem o jogador saber por quê, como na mesa (GameScreen).
  const showy = animations !== 'off';
  /** Boosters sendo abertos agora, um de cada vez: o primeiro da fila é o que está na tela. */
  const [opening, setOpening] = useState<{ queue: number[]; many: boolean } | null>(null);
  const reveal = (list: number[]) => {
    const next = [...opened, ...list.filter((i) => !opened.includes(i))];
    setOpened(next);
    setShown(next[next.length - 1] ?? -1);
    setPicked(null);
    writeOpened(pool.id, next);
  };
  const open = (list: number[]) => {
    const todo = list.filter((i) => !opened.includes(i));
    if (opening || !todo.length) return;
    if (showy) setOpening({ queue: todo, many: todo.length > 1 });
    else reveal(todo);
  };
  const openedOne = () => {
    if (!opening) return;
    const [first, ...rest] = opening.queue;
    reveal([first]);
    setOpening(rest.length ? { ...opening, queue: rest } : null);
  };
  const skipOpening = () => {
    if (!opening) return;
    reveal(opening.queue);
    setOpening(null);
  };
  const revealed = opened.flatMap((i) => pool.packs[i]);
  const leaders = [...new Set(revealed.filter((id) => byId.get(id)?.category === 'leader'))];
  const byColor = COLORS.map((c) => ({ ...c, n: revealed.filter((id) => byId.get(id)?.category !== 'leader' && byId.get(id)?.colors.includes(c.id)).length }));
  const pack = shown >= 0 ? pool.packs[shown] : [];
  /** No Pack Rush cada booster é de uma coleção: ela só aparece depois de aberto. */
  const mixed = isRush(pool.set);
  const packSet = (i: number) => pool.packSets?.[i] ?? pool.set;

  return (
    <div className="sealed-wrap sealed-packs">
      <div className="sealed-main">
        <div className="sealed-pack-row" role="group" aria-label={t('sealed.packOf', { n: Math.max(1, opened.length), total })}>
          {pool.packs.map((_, i) => {
            const isOpen = opened.includes(i);
            const isPicked = picked === i;
            return (
              <button
                key={i}
                type="button"
                className="sealed-pack-btn"
                disabled={Boolean(opening)}
                aria-pressed={isOpen ? i === shown : isPicked}
                // Aberto: mostra as cartas dele. Fechado: o primeiro clique seleciona, o segundo abre.
                onClick={() => {
                  if (isOpen) {
                    setShown(i);
                    setPicked(null);
                  } else if (isPicked) open([i]);
                  else setPicked(i);
                }}
                title={isOpen ? t('sealed.packN', { n: i + 1 }) : isPicked ? t('sealed.openPicked', { n: i + 1 }) : t('sealed.packSealed')}
              >
                <Booster set={isOpen ? packSet(i) : pool.set} state={isOpen ? (i === shown ? 'current' : 'open') : isPicked ? 'picked' : undefined} />
                <small>{isOpen ? t('sealed.packN', { n: i + 1 }) : isPicked ? t('sealed.packOpenIt') : t('sealed.packSealed')}</small>
              </button>
            );
          })}
        </div>
        {closed.length > 0 && <p className="muted small sealed-pick-hint">{peek.canHover ? t('sealed.packPickHintMouse') : t('sealed.packPickHintTouch')}</p>}

        <section className="sealed-panel sealed-reveal">
          {shown < 0 ? (
            <p className="sealed-empty">{mixed ? t('sealed.rushPacksReady', { n: total, sets: setsText(pool.set) }) : t('sealed.packsReady', { n: total, set: pool.set })}</p>
          ) : (
            <>
              <div className="section-head">
                <h3 className="sealed-h3">
                  {t('sealed.packOf', { n: shown + 1, total })}
                  {mixed ? ` · ${packSet(shown)}` : ''}
                </h3>
                <span className="muted small">{peek.canHover ? t('sealed.peekMouse') : t('sealed.peekTouch')}</span>
              </div>
              {/* Com as animações completas, as cartas já foram viradas na abertura; a virada aqui fica para as suaves. */}
              <div className={['card-grid sealed-grid', animations === 'soft' ? '' : 'still'].join(' ')} key={shown}>
                {pack.map((id, i) => {
                  const card = byId.get(id);
                  if (!card) return null;
                  const hit = card.category === 'leader' || ['SR', 'SEC'].includes(card.rarity ?? '');
                  return (
                    <div key={`${id}-${i}`} className={['grid-cell sealed-reveal-card', hit ? 'hit' : ''].join(' ')} style={{ ['--i' as string]: i }}>
                      <StaticCard card={card} highlight={hit ? 'selected' : null} onHover={peek.setHovered} onLongPress={peek.setZoom} onClick={() => peek.setZoom(card)} />
                      <div className="grid-caption">{card.category === 'leader' ? t('card.cat.leader') : (card.rarity ?? '')}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <div className="sealed-actions">
          {closed.length > 0 ? (
            <>
              {opened.length > 0 && closed.length > 1 && (
                <button type="button" className="btn" onClick={() => open(closed)} disabled={Boolean(opening)}>
                  {t('sealed.openAll', { n: closed.length })}
                </button>
              )}
              <button type="button" className="mode-btn sealed-cta" onClick={() => open([picked ?? closed[0]])} disabled={Boolean(opening)}>
                {picked !== null ? t('sealed.openPicked', { n: picked + 1 }) : opened.length === 0 ? t('sealed.openFirst') : t('sealed.openNext')}
              </button>
            </>
          ) : (
            <button type="button" className="mode-btn sealed-cta" onClick={onBuild}>
              {t('sealed.toBuild')}
            </button>
          )}
        </div>
      </div>

      <aside className="sealed-side sealed-panel">
        <div>
          <div className="kicker">{t('sealed.pool')}</div>
          <div className="sealed-count">
            <b>{revealed.length}</b>
            <span className="muted">{t('sealed.revealed', { total: pool.packs.flat().length })}</span>
          </div>
        </div>
        <div>
          <div className="kicker">{t('sealed.leadersFound')}</div>
          <div className="sealed-leaders">
            {[...leaders, SEALED_LEADER_ID].map((id) => {
              const card = byId.get(id);
              return card ? (
                <div key={id} className="grid-cell">
                  <StaticCard card={card} onHover={peek.setHovered} onLongPress={peek.setZoom} onClick={() => peek.setZoom(card)} />
                  {id === SEALED_LEADER_ID && <div className="grid-caption">{t('sealed.always')}</div>}
                </div>
              ) : null;
            })}
          </div>
          <p className="muted small">{mixed ? t('sealed.rushLeadersHint') : t('sealed.leadersHint')}</p>
        </div>
        <div>
          <div className="kicker">{t('sealed.byColor')}</div>
          <ul className="sealed-colors">
            {byColor.map((c) => (
              <li key={c.id}>
                <span className={`entry-cost c-${c.id}`} />
                <span>{t(c.label)}</span>
                <b>{c.n}</b>
              </li>
            ))}
          </ul>
        </div>
        <p className="sealed-note">{t('sealed.serverNote')}</p>
      </aside>
      {peek.layer}
      {opening && (
        <BoosterOpening
          key={opening.queue[0]}
          set={packSet(opening.queue[0])}
          cover={mixed ? pool.set : undefined}
          label={t('sealed.openingPack', { n: opening.queue[0] + 1, total })}
          cards={pool.packs[opening.queue[0]].map((id) => byId.get(id)).filter((c): c is CardData => Boolean(c))}
          mode={animations === 'soft' ? 'burst' : opening.many ? 'auto' : 'reveal'}
          quick={animations === 'soft'}
          onDone={openedOne}
          onSkip={skipOpening}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Montagem do deck
// ---------------------------------------------------------------------------

function Build({
  pool,
  byId,
  cards,
  onPool,
  onPacks,
  onStart,
  onOnline,
}: {
  pool: SealedPool;
  byId: ReadonlyMap<string, CardData>;
  cards: CardData[];
  onPool: (p: SealedPool) => void;
  onPacks: () => void;
  onStart: (setup: GameSetup, poolId: string) => void;
  onOnline: (seat: OnlineSeat, poolId: string) => void;
}) {
  const t = useT();
  const tryT = useTryT();
  const peek = useCardPeek();
  const have = useMemo(() => poolCounts(pool.packs), [pool.packs]);
  const [leader, setLeader] = useState(pool.deck?.leader ?? '');
  const [deck, setDeck] = useState(() => new Map((pool.deck?.cards ?? []).map((c) => [c.id, c.count])));
  /** A mesma busca e os mesmos filtros do construtor de decks, sobre as cartas que o jogador abriu. */
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS);
  const searchAliases = useSearchAliases();
  const narrow = useMediaQuery('(max-width: 1100px)');
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [pickingLeader, setPickingLeader] = useState(false);
  /** Pack Rush (várias coleções) e Draft Cubo: vale qualquer Líder do jogo. */
  const mixed = isRush(pool.set) || isCube(pool.set);
  const rules = useMemo<LimitedRules>(() => (mixed ? { leaders: 'any', sets: isCube(pool.set) ? [] : rushSets(pool.set) } : {}), [mixed, pool.set]);

  const total = [...deck.values()].reduce((n, c) => n + c, 0);
  const list = useMemo(() => ({ leader, cards: [...deck].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id)) }), [leader, deck]);
  const report = useMemo(
    () => validateLimitedDeck({ id: `sealed:${pool.id}`, name: pool.set, ...list }, byId, have, rules),
    [list, byId, have, pool.id, pool.set, rules],
  );

  // Salva sozinho, um pouco depois da última mudança. `pending` guarda a lista ainda não enviada.
  const dirty = useRef(false);
  const latest = useRef(list);
  latest.current = list;
  const flush = useCallback(async () => {
    if (!dirty.current) return true;
    dirty.current = false;
    setSave('saving');
    try {
      onPool(await api.sealed.saveDeck(pool.id, latest.current));
      setSave('saved');
      setError(null);
      return true;
    } catch (e) {
      dirty.current = true;
      setSave('error');
      setError(t('sealed.saveFailed', { why: errorText(e) }));
      return false;
    }
  }, [pool.id, onPool, t]);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) return;
    dirty.current = true;
    const timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [list, flush]);
  // Saiu da tela com mudança por salvar: tenta gravar mesmo assim.
  useEffect(() => () => void flush(), [flush]);

  const change = (fn: () => void) => {
    touched.current = true;
    fn();
  };
  const add = (id: string) =>
    change(() =>
      setDeck((d) => {
        const n = d.get(id) ?? 0;
        if (n >= (have.get(id) ?? 0) || [...d.values()].reduce((s, c) => s + c, 0) >= LIMITED_DECK_SIZE) return d;
        return new Map(d).set(id, n + 1);
      }),
    );
  const remove = (id: string) =>
    change(() =>
      setDeck((d) => {
        const n = d.get(id) ?? 0;
        if (!n) return d;
        const next = new Map(d);
        if (n === 1) next.delete(id);
        else next.set(id, n - 1);
        return next;
      }),
    );
  const auto = () =>
    change(() => {
      const built = autoBuildLimited(have, byId, leader || undefined);
      setLeader(built.leader);
      setDeck(new Map(built.cards.map((c) => [c.id, c.count])));
    });
  const clear = () => change(() => setDeck(new Map()));

  // Os Líderes à mão: os que saíram e o de 6 cores; no Pack Rush, também o escolhido de fora, na frente.
  const leaders = useMemo(() => {
    const own = sealedLeaders(have, byId);
    return mixed && leader && !own.includes(leader) ? [leader, ...own] : own;
  }, [have, byId, mixed, leader]);
  /** Todos os Líderes que valem no Pack Rush (os de spoiler, só das coleções escolhidas). */
  const allLeaders = useMemo(() => (mixed ? cards.filter((c) => anyLeaderAllowed(c, rules.sets)) : []), [mixed, cards, rules]);
  const owned = useMemo(
    () =>
      [...have.keys()]
        .map((id) => byId.get(id))
        .filter((c): c is CardData => Boolean(c) && c!.category !== 'leader')
        .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.id.localeCompare(b.id)),
    [have, byId],
  );
  const visible = useMemo(() => {
    const q = parseCardQuery(filters.query, searchAliases);
    const ctx = { inDeck: (id: string) => deck.has(id) };
    return owned.filter((c) => matchesCardFilters(c, filters, q, ctx));
  }, [owned, filters, searchAliases, deck]);
  const filtering = filters.query.trim() !== '' || activeFilterCount(filters) > 0;
  /** As coleções das cartas abertas: o seletor só aparece quando há mais de uma (Pack Rush, Cubo). */
  const poolSets = useMemo(() => [...new Set(owned.map(cardSetOf))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), [owned]);
  const poolSize = owned.reduce((n, c) => n + (have.get(c.id) ?? 0), 0);

  const entries = [...deck]
    .map(([id, count]) => ({ id, count, card: byId.get(id) }))
    .sort((a, b) => (a.card?.cost ?? 0) - (b.card?.cost ?? 0) || a.id.localeCompare(b.id));
  const curve = Array.from({ length: 8 }, (_, cost) => entries.filter((e) => Math.min(7, e.card?.cost ?? 0) === cost).reduce((n, e) => n + e.count, 0));
  const peak = Math.max(1, ...curve);
  const sum = (test: (c: CardData) => boolean) => entries.reduce((n, e) => n + (e.card && test(e.card) ? e.count : 0), 0);
  const ready = report.valid;
  const errors = report.issues.filter((i) => i.level === 'error');
  const missing = LIMITED_DECK_SIZE - total;

  /** Antes de jogar: o deck precisa estar gravado no servidor, que é quem o confere. */
  const play = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      touched.current = true;
      dirty.current = true;
      if (!(await flush())) return;
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const vsBot = () =>
    play(async () => {
      const bot = await api.sealed.botDeck(pool.id);
      const mine: DeckList = { id: `sealed:${pool.id}`, name: poolTitle(pool, t), ...latest.current };
      const opp: DeckList = { id: 'sealed:bot', name: bot.name, leader: bot.leader, cards: bot.cards };
      const seed = Math.floor(Math.random() * 1_000_000);
      const setup = await buildSetup('bot', [mine.id, opp.id], [t('menu.youName'), t('menu.botName')], seed, 'sealed', undefined, undefined, { decks: [mine, opp] }, true, undefined, cards);
      onStart(setup, pool.id);
    });
  const createRoom = () =>
    play(async () => {
      const r = await api.online.createRoom(pool.id, { format: 'sealed', spoilers: true });
      onOnline({ roomId: r.roomId, token: r.token }, pool.id);
    });
  const joinRoom = () => play(async () => onOnline(await api.online.joinRoom(code.trim(), pool.id), pool.id));

  return (
    <div className="sealed-wrap sealed-build">
      <div className="sealed-main">
        <div className="sealed-toolbar">
          <h3 className="sealed-h3">{t('sealed.pool')}</h3>
          <span className="muted small">{t('sealed.poolCount', { n: poolSize, out: poolSize - total })}</span>
          {filtering && (
            <>
              <span className="sealed-spacer" />
              <span className="muted small" role="status">
                {t('sealed.filterShowing', { n: visible.length, total: owned.length })}
              </span>
              <button type="button" className="text-link small" onClick={() => setFilters(NO_FILTERS)}>
                {t('sealed.filterClear')}
              </button>
            </>
          )}
        </div>
        <div className="sealed-filters">
          <CardFilterBar value={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} narrow={narrow} categories={['character', 'event', 'stage']} sets={poolSets} />
        </div>
        <p className="muted small">{peek.canHover ? t('sealed.hintMouse') : t('sealed.hintTouch')}</p>
        {filtering && visible.length === 0 && <p className="sealed-empty">{t('sealed.filterNone')}</p>}
        {BANDS.map((band) => {
          const inBand = visible.filter((c) => band.fits(c.cost ?? 0));
          if (!inBand.length) return null;
          return (
            <section key={band.key}>
              <div className="entry-group">{t(band.key)}</div>
              <div className="card-grid sealed-grid">
                {inBand.map((c) => {
                  const n = deck.get(c.id) ?? 0;
                  const copies = have.get(c.id) ?? 0;
                  return (
                    <div key={c.id} className="grid-cell">
                      <StaticCard
                        card={c}
                        highlight={n > 0 ? 'playable' : null}
                        dimmed={n >= copies}
                        onClick={() => (n >= copies ? remove(c.id) : add(c.id))}
                        onContextMenu={() => remove(c.id)}
                        onHover={peek.setHovered}
                        onLongPress={peek.setZoom}
                        badge={
                          <>
                            {(n > 0 || copies > 1) && <span className="copies">{n}/{copies}</span>}
                            {needsManual(c) && (
                              <span className="manual-badge" title={t('deck.manualTitle')}>
                                ⚙
                              </span>
                            )}
                          </>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!pool.draft && (
          <button type="button" className="text-link" onClick={onPacks}>
            {t('sealed.backToPacks')}
          </button>
        )}
      </div>

      <aside className="sealed-side sealed-panel">
        <div>
          <div className="kicker">{t('sealed.yourLeader')}</div>
          <div className="sealed-leaders">
            {leaders.map((id) => {
              const card = byId.get(id);
              return card ? (
                <div key={id} className="grid-cell">
                  <StaticCard card={card} highlight={leader === id ? 'selected' : null} onClick={() => change(() => setLeader(id))} onHover={peek.setHovered} onLongPress={peek.setZoom} />
                  {id === SEALED_LEADER_ID && <div className="grid-caption">{t('sealed.always')}</div>}
                </div>
              ) : null;
            })}
          </div>
          {mixed && (
            <button type="button" className="btn small" onClick={() => setPickingLeader(true)}>
              {t('sealed.anyLeader')}
            </button>
          )}
        </div>

        <div className="sealed-count">
          <b className={ready ? 'ok' : ''}>{total}</b>
          <span className="muted">{t('sealed.deckCount', { max: LIMITED_DECK_SIZE })}</span>
          <span className="sealed-spacer" />
          <span className={['sealed-save', save].join(' ')}>{save === 'saving' ? t('sealed.saving') : save === 'saved' ? t('sealed.saved') : ''}</span>
        </div>

        <div className="sealed-curve" aria-hidden="true">
          {curve.map((n, cost) => (
            <div key={cost}>
              <small>{n || ''}</small>
              <i style={{ height: `${(n / peak) * 100}%` }} />
              <span>{cost === 7 ? '7+' : cost}</span>
            </div>
          ))}
        </div>
        <ul className="home-chips">
          <li className="home-chip">{t('sealed.statCounter', { a: sum((c) => c.counter === 1000), b: sum((c) => c.counter === 2000) })}</li>
          <li className="home-chip">{t('sealed.statBlockers', { n: sum((c) => /\[Blocker\]/i.test(c.text ?? '')) })}</li>
          <li className="home-chip">{t('sealed.statEvents', { n: sum((c) => c.category === 'event') })}</li>
        </ul>

        <div className="btn-row">
          <button type="button" className="btn small" onClick={auto}>
            {t('sealed.auto')}
          </button>
          <button type="button" className="btn small" onClick={clear} disabled={!total}>
            {t('sealed.clear')}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="sealed-play">
          <div className="kicker">{t('sealed.playTitle')}</div>
          {!ready && (
            <p className="mode-note">
              {!leader ? t('sealed.pickLeader') : missing > 0 ? t('sealed.missing', { n: missing }) : (errors[0] && (tryT(errors[0].code, errors[0].params) ?? errors[0].message)) || ''}
            </p>
          )}
          <button type="button" className="mode-btn sealed-cta" onClick={() => void vsBot()} disabled={!ready || busy}>
            {t('sealed.vsBot')}
          </button>
          <p className="muted small">{pool.draft ? t('sealed.draftBotHint') : mixed ? t('sealed.rushBotHint', { sets: setsText(pool.set) }) : t('sealed.vsBotHint', { set: pool.set })}</p>
          <button type="button" className="btn" onClick={() => void createRoom()} disabled={!ready || busy}>
            {t('sealed.createRoom')}
          </button>
          <div className="code-row">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} aria-label={t('sealed.roomCode')} />
            <button type="button" className="btn" onClick={() => void joinRoom()} disabled={!ready || busy || code.trim().length !== 6}>
              {t('sealed.joinRoom')}
            </button>
          </div>
          <p className="muted small">{pool.draft ? t('sealed.roomHintDraft') : mixed ? t('sealed.roomHintRush', { sets: setsText(pool.set) }) : t('sealed.roomHint', { set: pool.set })}</p>
          {pool.wins + pool.losses > 0 && <p className="muted small">{t('sealed.record', { w: pool.wins, l: pool.losses })}</p>}
        </div>
        <div className="sealed-list">
          {entries.map((e) => (
            <div key={e.id} className="entry" onMouseEnter={(ev) => e.card && peek.setHovered(e.card, ev.currentTarget)} onMouseLeave={() => peek.setHovered(null)}>
              <span className={`entry-cost c-${e.card?.colors[0] ?? 'red'}`}>{e.card?.cost ?? '?'}</span>
              <span className="entry-name">
                {e.card?.name ?? e.id}
                <small>
                  {e.id}
                  {e.card?.rarity ? ` · ${e.card.rarity}` : ''}
                  {e.card && needsManual(e.card) ? ` · ${t('deck.entryManual')}` : ''}
                </small>
              </span>
              <button className="qty" onClick={() => remove(e.id)} aria-label={t('deck.removeOne')}>
                −
              </button>
              <b className="entry-count">{e.count}</b>
              <button className="qty" onClick={() => add(e.id)} disabled={e.count >= (have.get(e.id) ?? 0) || total >= LIMITED_DECK_SIZE} aria-label={t('deck.addOne')}>
                +
              </button>
            </div>
          ))}
          {!entries.length && <p className="muted small">{t('sealed.emptyDeck')}</p>}
        </div>

      </aside>
      {pickingLeader && (
        <LeaderSheet
          leaders={allLeaders}
          owned={owned}
          have={have}
          value={leader}
          onPick={(id) => {
            change(() => setLeader(id));
            setPickingLeader(false);
          }}
          onClose={() => setPickingLeader(false)}
        />
      )}
      {peek.layer}
    </div>
  );
}

/**
 * Pack Rush: a folha com todos os Líderes do jogo. São mais de cem, então os primeiros são os
 * sugeridos: os que mais combinam com o que o jogador abriu (tipos das cartas, e a cor como desempate).
 */
function LeaderSheet({
  leaders,
  owned,
  have,
  value,
  onPick,
  onClose,
}: {
  leaders: CardData[];
  /** As cartas abertas (sem os Líderes) e quantas cópias de cada. */
  owned: CardData[];
  have: ReadonlyMap<string, number>;
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const suggested = useMemo(() => {
    const types = new Map<string, number>();
    const colors = new Map<string, number>();
    for (const c of owned) {
      const n = have.get(c.id) ?? 0;
      for (const ty of c.types) types.set(ty, (types.get(ty) ?? 0) + n);
      for (const col of c.colors) colors.set(col, (colors.get(col) ?? 0) + n);
    }
    const score = (l: CardData) => l.types.reduce((n, ty) => n + (types.get(ty) ?? 0), 0) * 3 + l.colors.reduce((n, col) => n + (colors.get(col) ?? 0), 0) / l.colors.length;
    return leaders
      .filter((l) => l.id !== SEALED_LEADER_ID && !needsManual(l))
      .map((l) => ({ l, score: score(l) }))
      .sort((a, b) => b.score - a.score || a.l.id.localeCompare(b.l.id))
      .slice(0, 8)
      .map((x) => x.l);
  }, [leaders, owned, have]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leaders
      .filter((l) => (!color || l.colors.includes(color)) && (!q || l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q) || l.types.some((ty) => ty.toLowerCase().includes(q))))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [leaders, search, color]);
  const cell = (l: CardData) => (
    <div key={l.id} className="grid-cell">
      <StaticCard card={l} highlight={l.id === value ? 'selected' : null} onClick={() => onPick(l.id)} />
      <div className="grid-caption" title={l.name}>
        {l.name}
      </div>
    </div>
  );
  const filtering = Boolean(search.trim()) || color !== null;
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet" onClick={onClose}>
      <div className="sheet sealed-leader-sheet" role="dialog" aria-modal="true" aria-label={t('sealed.anyLeaderTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('sealed.anyLeaderTitle')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="muted small">{t('sealed.anyLeaderHint')}</p>
          <div className="sealed-toolbar">
            <input className="leader-search" type="search" value={search} placeholder={t('sealed.leaderSearch')} aria-label={t('sealed.leaderSearch')} onChange={(e) => setSearch(e.target.value)} />
            <div className="color-chips">
              {COLORS.map((c) => (
                <button key={c.id} type="button" className={['chip', `c-${c.id}`, color === c.id ? 'on' : ''].join(' ')} aria-pressed={color === c.id} onClick={() => setColor((v) => (v === c.id ? null : c.id))}>
                  {t(c.label)}
                </button>
              ))}
            </div>
          </div>
          {!filtering && suggested.length > 0 && (
            <>
              <div className="entry-group">{t('sealed.leaderSuggested')}</div>
              <div className="card-grid sealed-leader-grid">{suggested.map(cell)}</div>
            </>
          )}
          <div className="entry-group">{t('sealed.leaderAll', { n: shown.length })}</div>
          <div className="card-grid sealed-leader-grid">{shown.map(cell)}</div>
          {!shown.length && <p className="muted small">{t('sealed.leaderNone')}</p>}
        </div>
      </div>
    </div>
  );
}
