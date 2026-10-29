// Visualizador de deck: a lista completa só para ver (sem editar), em imagens ou em texto,
// com a curva, os counters e os formatos em que vale. Copia a lista, baixa a imagem da
// decklist e leva para o construtor ou para a partida.

import { type CardData, DECK_SIZE, type DeckList, FORMATS, formatDeckList, formatIssues, withArt } from '@gumgum/engine';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary, spoilerText } from '../api';
import { deckNumbers } from '../deckLibrary';
import { type MessageKey, useT, useTryT } from '../i18n';
import { savedDeckData } from '../recap/matchDeck';
import { useSettings } from '../settings';
import { StaticCardZoom } from './CardInfo';
import { StaticCard } from './CardView';
import { CostCurve, LeaderBanner } from './DeckTile';
import { Icon } from './Icons';

const MatchDeck = lazy(() => import('./MatchDeck'));

const CATEGORIES: Array<[CardData['category'], MessageKey]> = [
  ['character', 'deck.cat.character'],
  ['event', 'deck.cat.event'],
  ['stage', 'deck.cat.stage'],
];
const COLOR_LABEL: Record<string, MessageKey> = {
  red: 'deck.color.red',
  green: 'deck.color.green',
  blue: 'deck.color.blue',
  purple: 'deck.color.purple',
  black: 'deck.color.black',
  yellow: 'deck.color.yellow',
};

export interface ViewedDeck {
  deck: Pick<DeckList, 'name' | 'leader' | 'cards' | 'arts'> & { id?: string };
  cards: CardData[];
  /** Resumo do servidor (deck salvo): estado, spoilers. Sem ele (rascunho do construtor), os formatos vêm do motor. */
  summary?: DeckSummary;
}

/**
 * `deckId`: carrega o deck salvo; `data`: um deck já em mãos (o rascunho do construtor).
 * `onPlay`/`onEdit` aparecem só quando passados (o seletor e a biblioteca decidem).
 */
export function DeckViewer({
  deckId,
  data,
  onClose,
  onPlay,
  playDisabled,
  onEdit,
  editLabel,
}: {
  deckId?: string;
  data?: ViewedDeck;
  onClose: () => void;
  onPlay?: () => void;
  /** Motivo de não poder jogar com o deck aqui (o botão fica desligado). */
  playDisabled?: string | null;
  onEdit?: () => void;
  editLabel?: string;
}) {
  const t = useT();
  const tryT = useTryT();
  const { showImages } = useSettings();
  const [loaded, setLoaded] = useState<ViewedDeck | null>(data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'images' | 'list'>('images');
  const [zoom, setZoom] = useState<CardData | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [image, setImage] = useState(false);
  const closeZoom = useCallback(() => setZoom(null), []);

  useEffect(() => {
    if (data || !deckId) return;
    let stop = false;
    api.deck(deckId).then(
      (r) => !stop && setLoaded({ deck: r.deck, cards: r.cards, summary: r.summary }),
      (e: unknown) => !stop && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      stop = true;
    };
  }, [deckId, data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !zoom && !image) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoom, image]);

  useEffect(() => {
    if (copied !== 'ok') return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const byId = useMemo(() => new Map((loaded?.cards ?? []).map((c) => [c.id, c])), [loaded]);
  const deck = loaded?.deck;
  const leader = deck ? byId.get(deck.leader) : undefined;
  const numbers = useMemo(() => deckNumbers(deck?.cards ?? [], byId), [deck, byId]);
  const groups = useMemo(
    () =>
      CATEGORIES.map(([cat, label]) => ({
        cat,
        label,
        entries: (deck?.cards ?? [])
          .map((c) => ({ ...c, card: byId.get(c.id) }))
          .filter((e) => (e.card?.category ?? 'character') === cat)
          .sort((a, b) => (a.card?.cost ?? 0) - (b.card?.cost ?? 0) || (a.card?.name ?? a.id).localeCompare(b.card?.name ?? b.id)),
      })).filter((g) => g.entries.length),
    [deck, byId],
  );
  const formats = useMemo(
    () =>
      deck
        ? FORMATS.map((f) => {
            const issues = loaded?.summary ? (loaded.summary.formatCodes?.[f.id] ?? []) : formatIssues(deck, f.id);
            const texts = loaded?.summary
              ? loaded.summary.formats[f.id].map((text, i) => tryT(issues[i]?.code, issues[i]?.params) ?? text)
              : formatIssues(deck, f.id).map((i) => tryT(i.code, i.params) ?? i.message);
            return { ...f, ok: !texts.length, texts };
          })
        : [],
    [deck, loaded, tryT],
  );
  const text = deck ? formatDeckList({ leader: deck.leader, cards: deck.cards }) : '';
  const shown = (card: CardData) => withArt(card, deck?.arts?.[card.id]);

  const copy = () => {
    const clip = navigator.clipboard;
    if (!clip) return setCopied('fail');
    clip.writeText(text).then(
      () => setCopied('ok'),
      () => setCopied('fail'),
    );
  };

  const title = deck?.name ?? t('decks.loading');
  return (
    <>
      <div className="modal-backdrop page-sheet dk-viewer-backdrop" onClick={onClose}>
        <div className="dk-viewer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <div className="dk-viewer-head">
            <h3>{title}</h3>
            <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
          {error && <div className="error">{error}</div>}
          {!deck && !error && <p className="muted dk-viewer-loading">{t('decks.loading')}</p>}
          {deck && (
            <div className="dk-viewer-body">
              <div className="dk-viewer-actions">
                <button className="btn small" onClick={copy}>
                  <Icon name="copy" size={16} /> {copied === 'ok' ? t('decks.viewer.copied') : t('decks.viewer.copy')}
                </button>
                <button className="btn small" onClick={() => setImage(true)}>
                  {t('decks.viewer.image')}
                </button>
                {onEdit && (
                  <button className="btn small" onClick={onEdit}>
                    {editLabel ?? t('decks.edit')}
                  </button>
                )}
                {onPlay && (
                  <button className="btn small primary" onClick={onPlay} disabled={Boolean(playDisabled)} title={playDisabled ?? undefined}>
                    <Icon name="play" size={14} /> {t('decks.viewer.play')}
                  </button>
                )}
              </div>
              {copied === 'fail' && <p className="small recap-warn">{t('decks.viewer.copyFailed')}</p>}

              <div className="dk-viewer-cols">
                <aside className="dk-viewer-side">
                  {leader && showImages ? (
                    <div className="dk-viewer-leader">
                      <StaticCard card={shown(leader)} onClick={() => setZoom(shown(leader))} />
                    </div>
                  ) : (
                    <LeaderBanner
                      big
                      deck={{ colors: leader?.colors ?? [], leaderImage: null, leaderName: leader?.name ?? deck.leader, name: deck.name }}
                    />
                  )}
                  {leader && (
                    <div className="muted small">
                      {leader.name} ·{' '}
                      {t('decks.leaderLine', { colors: leader.colors.map((c) => (COLOR_LABEL[c] ? t(COLOR_LABEL[c]) : c)).join(' / '), life: leader.life ?? 0 })}
                    </div>
                  )}
                  <div className="dk-chips">
                    {numbers.total < DECK_SIZE && <span className="dk-chip bad">{t('decks.state.draft', { size: numbers.total, max: DECK_SIZE })}</span>}
                    {formats.map((f) => (
                      <span key={f.id} className={['dk-chip', f.ok ? 'ok' : 'bad'].join(' ')} title={f.texts.join('\n') || undefined}>
                        {f.ok ? '✓' : '🚫'} {f.label}
                      </span>
                    ))}
                    {Boolean(loaded?.summary?.spoilers?.length) && (
                      <span className="dk-chip spoiler" title={spoilerText(loaded!.summary!.spoilers!)}>
                        {t('decks.state.spoilers')}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="dk-label">{t('decks.curve')}</div>
                    <CostCurve curve={numbers.curve} tall />
                  </div>
                  <div className="dk-stat-grid">
                    {CATEGORIES.map(([cat, label]) => (
                      <div key={cat} className="dk-stat">
                        <span>{t(label)}</span>
                        <b>{numbers.byCategory[cat as 'character' | 'event' | 'stage']}</b>
                      </div>
                    ))}
                    <div className="dk-stat">
                      <span>{t('decks.viewer.counter1000')}</span>
                      <b>{numbers.counter1000}</b>
                    </div>
                    <div className="dk-stat">
                      <span>{t('decks.viewer.counter2000')}</span>
                      <b>{numbers.counter2000}</b>
                    </div>
                  </div>
                </aside>

                <div className="dk-viewer-main">
                  <div className="dk-viewer-bar">
                    <b>{t('decks.viewer.cards', { n: numbers.total })}</b>
                    <div className="seg small" role="group" aria-label={t('decks.viewer.modeLabel')}>
                      <button className={mode === 'images' ? 'on' : ''} aria-pressed={mode === 'images'} onClick={() => setMode('images')}>
                        {t('decks.viewer.modeImages')}
                      </button>
                      <button className={mode === 'list' ? 'on' : ''} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
                        {t('decks.viewer.modeList')}
                      </button>
                    </div>
                  </div>
                  {groups.map((g) => (
                    <section key={g.cat} className="dk-viewer-group">
                      <h4>
                        {t(g.label)} · {g.entries.reduce((n, e) => n + e.count, 0)}
                      </h4>
                      {mode === 'images' ? (
                        <div className="card-grid dk-viewer-grid">
                          {g.entries.map((e) =>
                            e.card ? (
                              <div key={e.id} className="grid-cell">
                                <StaticCard card={shown(e.card)} onClick={() => setZoom(shown(e.card!))} badge={<span className="copies">{e.count}×</span>} />
                              </div>
                            ) : null,
                          )}
                        </div>
                      ) : (
                        <ul className="dk-viewer-list">
                          {g.entries.map((e) => (
                            <li key={e.id}>
                              <span className={`entry-cost c-${e.card?.colors[0] ?? 'red'}`}>{e.card?.cost ?? '?'}</span>
                              <button type="button" className="dk-link" onClick={() => e.card && setZoom(shown(e.card))}>
                                {e.card?.name ?? e.id}
                              </button>
                              <span className="muted small">{e.id}</span>
                              <b>{e.count}×</b>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                  <details className="deck-text" open={copied === 'fail'}>
                    <summary>{t('decks.viewer.text')}</summary>
                    <textarea value={text} readOnly rows={Math.min(20, deck.cards.length + 1)} onFocus={(e) => e.currentTarget.select()} />
                  </details>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {zoom && <StaticCardZoom card={zoom} className="dk-zoom" onClose={closeZoom} />}
      {image && deck && (
        <Suspense fallback={null}>
          <MatchDeck data={savedDeckData(deck, byId, { images: showImages })} onClose={() => setImage(false)} />
        </Suspense>
      )}
    </>
  );
}
