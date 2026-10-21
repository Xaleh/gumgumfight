// Peças comuns das listas de decks: o cartão de um deck (arte do Líder, nome, estado e a
// estrela de favorito), o selo de estado, a curva de custo e a marcação de favoritos.

import { DECK_SIZE } from '@gumgum/engine';
import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useState } from 'react';
import { api, type DeckSummary } from '../api';
import { deckState, deckTime, lastUsed } from '../deckLibrary';
import { type Translate, useLocale, useT } from '../i18n';
import { fmtAgo } from '../i18n/format';
import { useSettings } from '../settings';
import { Icon } from './Icons';

/** Variável de cor da carta (o azul das cartas tem nome próprio no tema). */
export const cardColorVar = (c: string | undefined) => `var(--${c === 'blue' ? 'blue-card' : (c ?? 'red')})`;

/** Faixa com as cores do Líder e a arte dele (sem imagens, só as cores e o nome). */
export function LeaderBanner({ deck, big, children }: { deck: Pick<DeckSummary, 'colors' | 'leaderImage' | 'leaderName' | 'name'>; big?: boolean; children?: ReactNode }) {
  const { showImages } = useSettings();
  const [failed, setFailed] = useState(false);
  const colors = deck.colors.length ? deck.colors : ['red'];
  return (
    <span className={['dk-banner', big ? 'big' : ''].join(' ')}>
      <span className="dk-banner-colors" aria-hidden="true">
        {colors.map((c) => (
          <span key={c} style={{ background: cardColorVar(c) }} />
        ))}
      </span>
      {showImages && deck.leaderImage && !failed && (
        <img src={deck.leaderImage} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
      )}
      <span className="dk-banner-name">{deck.leaderName ?? deck.name}</span>
      {children}
    </span>
  );
}

/** Selo: Standard, só EGB, proibido ou rascunho com o tamanho. */
export function DeckStateChip({ deck }: { deck: DeckSummary }) {
  const t = useT();
  const state = deckState(deck);
  return (
    <span className={['dk-chip', state === 'standard' ? 'ok' : state === 'egb' ? 'warn' : 'bad'].join(' ')}>
      {state === 'draft' ? t('decks.state.draft', { size: deck.size, max: DECK_SIZE }) : t(`decks.state.${state}`)}
    </span>
  );
}

/** Linha de apoio do cartão: quando foi usado, editado, quantas partidas ou "deck pronto". */
export function deckMeta(d: DeckSummary, t: Translate, locale: Parameters<typeof fmtAgo>[1], local: ReadonlyMap<string, number>): string {
  const used = lastUsed(d, local);
  if (used) return t('decks.meta.used', { ago: fmtAgo(used, locale) });
  if (d.kind === 'builtin') return t('decks.meta.builtin');
  if (!d.mine) return t('decks.meta.games', { n: d.games ?? 0 });
  return t('decks.meta.edited', { ago: fmtAgo(deckTime(d.updatedAt), locale) });
}

export function FavoriteButton({ deck, onToggle }: { deck: DeckSummary; onToggle: (d: DeckSummary) => void }) {
  const t = useT();
  const label = deck.favorite ? t('decks.favoriteRemove') : t('decks.favoriteAdd');
  return (
    <button
      type="button"
      className={['dk-star', deck.favorite ? 'on' : ''].join(' ')}
      aria-pressed={Boolean(deck.favorite)}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(deck);
      }}
    >
      <Icon name="star" size={20} fill={deck.favorite ? 'currentColor' : undefined} />
    </button>
  );
}

/**
 * Cartão de um deck. `onSelect` no clique (prévia) e `onActivate` no duplo clique (usar);
 * `actions`, botões no pé do cartão (biblioteca); `badge`, um selo sobre a arte.
 */
export function DeckTile({
  deck,
  selected,
  local,
  onSelect,
  onActivate,
  onFavorite,
  actions,
  badge,
}: {
  deck: DeckSummary;
  selected?: boolean;
  local: ReadonlyMap<string, number>;
  onSelect?: () => void;
  onActivate?: () => void;
  onFavorite?: (d: DeckSummary) => void;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const body = (
    <>
      <LeaderBanner deck={deck}>{badge}</LeaderBanner>
      <span className="dk-tile-body">
        <b className="dk-tile-name">{deck.name}</b>
        <span className="dk-tile-meta">
          <DeckStateChip deck={deck} />
          {Boolean(deck.spoilers?.length) && <span className="dk-chip spoiler">{t('decks.state.spoilers')}</span>}
          <span className="muted">{deckMeta(deck, t, locale, local)}</span>
        </span>
      </span>
    </>
  );
  return (
    <article className={['dk-tile', selected ? 'on' : ''].join(' ')}>
      {onSelect ? (
        <button type="button" className="dk-tile-main" aria-pressed={Boolean(selected)} onClick={onSelect} onDoubleClick={onActivate}>
          {body}
        </button>
      ) : (
        <div className="dk-tile-main">{body}</div>
      )}
      {onFavorite && <FavoriteButton deck={deck} onToggle={onFavorite} />}
      {actions && <div className="dk-tile-actions">{actions}</div>}
    </article>
  );
}

/** Curva de custo (0 a 10+), com a quantidade sobre cada barra. */
export function CostCurve({ curve, tall }: { curve: number[]; tall?: boolean }) {
  const t = useT();
  const max = Math.max(1, ...curve);
  return (
    <div className={['dk-curve', tall ? 'tall' : ''].join(' ')} role="img" aria-label={t('decks.curve')}>
      {curve.map((n, i) => (
        <div key={i} className="dk-curve-col" title={t('decks.curveCards', { n })}>
          <span className="dk-curve-n">{n || ''}</span>
          <span className="dk-curve-bar" style={{ height: `${(n / max) * 100}%` }} />
          <span className="dk-curve-cost">{i === 10 ? '10+' : i}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Marca e desmarca favoritos: atualiza a lista na hora e volta atrás se o servidor recusar.
 * `onError` recebe a mensagem.
 */
export function useFavoriteToggle(setDecks: Dispatch<SetStateAction<DeckSummary[]>>, onError?: (msg: string) => void) {
  return useCallback(
    (deck: DeckSummary) => {
      const favorite = !deck.favorite;
      const set = (on: boolean) => setDecks((ds) => ds.map((d) => (d.id === deck.id ? { ...d, favorite: on } : d)));
      set(favorite);
      api.favoriteDeck(deck.id, favorite).catch((e: unknown) => {
        set(!favorite);
        onError?.(e instanceof Error ? e.message : String(e));
      });
    },
    [setDecks, onError],
  );
}
