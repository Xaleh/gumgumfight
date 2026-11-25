// Sugestões de cartas do construtor (roadmap C3): o que os decks do Líder usam e o deck não usa,
// as cartas com lift negativo, as que ganham mais e a comparação com o Deck médio. Os números do
// Líder vêm do servidor (`GET /api/stats/suggestions`, as mesmas estatísticas da tela de
// Estatísticas); a comparação com o deck roda aqui, com `deckSuggestions` do motor, e o deck não
// sai do navegador.

import { type CardData, type CardSuggestion, deckSuggestions, OFFICIAL_FORMATS } from '@gumgum/engine';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type LeaderSuggestionsResponse } from '../api';
import { useT } from '../i18n';
import { StaticCard } from './CardView';

const pct = (p: number) => `${Math.round(p * 100)}%`;
const points = (lift: number) => {
  const v = Math.round(lift * 100);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} pts`;
};

type Load = { key: string; data: LeaderSuggestionsResponse | null; error: boolean };

export function DeckSuggestionsPanel({
  leader,
  cards,
  byId,
  shown,
  defaultFormat,
  onHover,
  onLongPress,
  onAdd,
  onRemove,
  canAdd,
}: {
  leader: string | undefined;
  cards: Array<{ id: string; count: number }>;
  byId: Map<string, CardData>;
  shown: (card: CardData) => CardData;
  /** Formato em que o deck vale (Standard quando vale nos dois). */
  defaultFormat: string;
  onHover: (card: CardData | null, anchor?: HTMLElement) => void;
  onLongPress: (card: CardData) => void;
  onAdd: (card: CardData) => void;
  onRemove: (id: string) => void;
  canAdd: (card: CardData, current: number) => boolean;
}) {
  const t = useT();
  const [format, setFormat] = useState(defaultFormat);
  const [load, setLoad] = useState<Load | null>(null);
  const key = leader ? `${leader}|${format}` : '';

  useEffect(() => {
    if (!leader) return;
    let alive = true;
    api
      .leaderSuggestions({ leader, format })
      .then((data) => alive && setLoad({ key, data, error: false }))
      .catch(() => alive && setLoad({ key, data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = load?.key === key ? load : null;
  const s = useMemo(() => deckSuggestions(current?.data ?? null, { leader, cards }), [current, leader, cards]);

  const formats = (
    <div className="seg small" role="group" aria-label={t('decks.tips.format')}>
      {OFFICIAL_FORMATS.map((f) => (
        <button key={f.id} type="button" className={format === f.id ? 'on' : ''} aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
          {f.id === 'egb' ? 'EGB' : f.label}
        </button>
      ))}
    </div>
  );

  if (!leader) return <div className="muted small deck-tips">{t('decks.tips.noLeader')}</div>;

  let body: ReactNode;
  if (!current) body = <div className="muted small">{t('decks.tips.loading')}</div>;
  else if (current.error) body = <div className="muted small">{t('decks.tips.error')}</div>;
  else if (s.status === 'noData') body = <div className="muted small">{t('decks.tips.noData')}</div>;
  else if (s.status === 'small') body = <div className="muted small">{t('decks.tips.small', { n: s.games, min: current.data!.minGames })}</div>;
  else {
    const row = (c: CardSuggestion) => {
      const card = byId.get(c.cardId);
      const line =
        c.kind === 'staple'
          ? t('decks.tips.stapleLine', { share: pct(c.share), n: c.games, usual: c.usual })
          : c.kind === 'copies'
            ? t('decks.tips.copiesLine', { yours: c.yours, usual: c.usual, n: c.games })
            : t('decks.tips.liftLine', { lift: points(c.lift), n: c.games });
      const more = c.kind === 'staple' || c.kind === 'winner' || (c.kind === 'copies' && c.yours < c.usual);
      const less = c.kind === 'loser' || (c.kind === 'copies' && c.yours > c.usual);
      return (
        <li key={`${c.kind}-${c.cardId}`} className={`tip tip-${c.kind}`}>
          {card ? <StaticCard card={shown(card)} onHover={onHover} onLongPress={onLongPress} /> : <span className="tip-missing" />}
          <div className="tip-text">
            <b>{card?.name ?? c.cardId}</b>
            <small className="muted">{c.cardId}</small>
            <span className="small">{line}</span>
          </div>
          {more && card && (
            <button type="button" className="btn small" onClick={() => onAdd(card)} disabled={!canAdd(card, c.yours)} aria-label={t('decks.tips.add')} title={t('decks.tips.add')}>
              +
            </button>
          )}
          {less && (
            <button type="button" className="btn small" onClick={() => onRemove(c.cardId)} aria-label={t('decks.tips.remove')} title={t('decks.tips.remove')}>
              −
            </button>
          )}
        </li>
      );
    };
    const group = (title: string, list: CardSuggestion[]) =>
      list.length ? (
        <section className="ht-block">
          <div className="ht-head">{title}</div>
          <ul className="tip-list">{list.map(row)}</ul>
        </section>
      ) : null;
    const nothing = !s.staples.length && !s.winners.length && !s.losers.length && !s.copies.length;
    body = (
      <>
        <div className="small">
          {t('decks.tips.base', { n: s.games, rate: pct(s.winRate) })} <span className="muted">{t(current.data!.scope === 'all' ? 'decks.tips.scope.all' : 'decks.tips.scope.casual')}</span>
        </div>
        {s.average.total > 0 && <div className="small">{t('decks.tips.average', { n: s.average.matching, total: s.average.total })}</div>}
        {group(t('decks.tips.staples'), s.staples)}
        {group(t('decks.tips.losers'), s.losers)}
        {group(t('decks.tips.winners'), s.winners)}
        {group(t('decks.tips.copies'), s.copies)}
        {nothing && <div className="small">{t('decks.tips.none')}</div>}
        {s.hidden > 0 && <div className="small muted">{t('decks.tips.hidden', { n: s.hidden, min: current.data!.minGames })}</div>}
        <p className="small muted">{t('decks.tips.note')}</p>
      </>
    );
  }

  return (
    <div className="hand-test deck-tips">
      {formats}
      {body}
    </div>
  );
}
