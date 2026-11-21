// A lista do Cubo: todas as cartas da temporada, por cor, com o uso que pôs cada uma lá, e as
// regras do Draft Cubo. É a mesma lista de onde o servidor sorteia os boosters do pod.

import { boosterSize, type CardData, type Color, cubeCardsNeeded, cubeColor, DRAFT_ROUNDS, DRAFT_SEATS, LIMITED_DECK_SIZE } from '@gumgum/engine';
import { useMemo, useState } from 'react';
import type { CubeInfo } from '../api';
import { type MessageKey, useT } from '../i18n';
import { useSettings } from '../settings';
import { CardHoverPreview, StaticCardZoom } from './CardInfo';
import { StaticCard } from './CardView';

const COLORS: Array<{ id: Color; label: MessageKey }> = [
  { id: 'red', label: 'deck.color.red' },
  { id: 'green', label: 'deck.color.green' },
  { id: 'blue', label: 'deck.color.blue' },
  { id: 'purple', label: 'deck.color.purple' },
  { id: 'black', label: 'deck.color.black' },
  { id: 'yellow', label: 'deck.color.yellow' },
];
const TOP = 8;
const pct = (usage: number) => Math.max(1, Math.round(usage * 100));

export function CubeList({ cube, byId, action }: { cube: CubeInfo; byId: ReadonlyMap<string, CardData>; action: React.ReactNode }) {
  const t = useT();
  const { locale } = useSettings();
  const [color, setColor] = useState<Color | 'all'>('all');
  const canHover = useMemo(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const [hovered, setHovered] = useState<{ card: CardData; anchor: HTMLElement } | null>(null);
  const [zoom, setZoom] = useState<CardData | null>(null);

  const entries = useMemo(
    () =>
      cube.cards
        .map((c) => ({ ...c, card: byId.get(c.id) }))
        .filter((c): c is typeof c & { card: CardData } => Boolean(c.card))
        .sort((a, b) => b.usage - a.usage || a.id.localeCompare(b.id)),
    [cube, byId],
  );
  const shown = color === 'all' ? entries : entries.filter((e) => cubeColor(e.card) === color);
  const top = shown.slice(0, TOP);
  const max = top[0]?.usage || 1;
  const date = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale) : '');
  const rules: Array<[MessageKey, string]> = [
    ['cube.howPacks', t('cube.howPacksText', { rounds: DRAFT_ROUNDS, size: boosterSize(), seats: DRAFT_SEATS, used: cubeCardsNeeded(DRAFT_SEATS, DRAFT_ROUNDS), n: entries.length })],
    ['cube.howLeader', t('cube.howLeaderText')],
    ['cube.howBans', t('cube.howBansText')],
    ['cube.howDeck', t('cube.howDeckText', { n: LIMITED_DECK_SIZE })],
  ];

  return (
    <div className="sealed-wrap sealed-packs cube">
      <div className="sealed-main">
        <section className="sealed-hero">
          <div className="hero-kicker">{t('cube.kicker')}</div>
          <h1 className="hero-title">{t('cube.title')}</h1>
          <ul className="home-chips">
            <li className="home-chip gold">{cube.name}</li>
            <li className="home-chip">{t('cube.chipCards', { n: entries.length })}</li>
            <li className="home-chip">{t('cube.chipPerColor', { n: cube.perColor })}</li>
            <li className="home-chip">{t('cube.chipUpdated', { date: date(cube.publishedAt) })}</li>
          </ul>
        </section>

        <section className="sealed-panel">
          <div className="section-head">
            <h3 className="sealed-h3">{t('cube.listTitle')}</h3>
            <div className="cube-filter" role="group" aria-label={t('cube.filterLabel')}>
              <button type="button" className={color === 'all' ? 'on' : ''} aria-pressed={color === 'all'} onClick={() => setColor('all')}>
                {t('cube.all')} <small>{entries.length}</small>
              </button>
              {COLORS.map((c) => (
                <button key={c.id} type="button" className={[`c-${c.id}`, color === c.id ? 'on' : ''].join(' ')} aria-pressed={color === c.id} onClick={() => setColor(c.id)} title={t(c.label)}>
                  <i aria-hidden="true" />
                  <span className="cube-filter-name">{t(c.label)}</span> <small>{entries.filter((e) => cubeColor(e.card) === c.id).length}</small>
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">{t('cube.usageHint')}</p>

          <ol className="cube-top">
            {top.map((e) => (
              <li key={e.id} className={`c-${cubeColor(e.card)}`}>
                <span className="cube-cost">{e.card.cost ?? 0}</span>
                <button type="button" className="text-link" onClick={() => setZoom(e.card)}>
                  {e.card.name}
                </button>
                <span className="cube-bar" aria-hidden="true">
                  <i style={{ width: `${(e.usage / max) * 100}%` }} />
                </span>
                <b>{pct(e.usage)}%</b>
              </li>
            ))}
          </ol>

          <div className="card-grid sealed-grid">
            {shown.map((e) => (
              <div key={e.id} className="grid-cell">
                <StaticCard card={e.card} onHover={(c, a) => setHovered(c && a ? { card: c, anchor: a } : null)} onLongPress={setZoom} onClick={() => setZoom(e.card)} />
                <div className="grid-caption">{pct(e.usage)}%</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="sealed-side sealed-panel">
        <div>
          <h3 className="sealed-h3">{t('cube.howTitle')}</h3>
          <dl className="cube-rules">
            {rules.map(([title, text]) => (
              <div key={title}>
                <dt>{t(title)}</dt>
                <dd className="muted small">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3 className="sealed-h3">{t('cube.sourceTitle')}</h3>
          <p className="muted small">
            {t('cube.sourceText', { decks: cube.source.decks.toLocaleString(locale), tournaments: cube.source.tournaments, from: date(cube.source.from), to: date(cube.source.to) })}
          </p>
          <a className="text-link small" href={cube.source.url} target="_blank" rel="noreferrer">
            {cube.source.name}
          </a>
        </div>
        {action}
      </aside>
      {canHover && hovered && !zoom && <CardHoverPreview card={hovered.card} anchor={hovered.anchor} />}
      {zoom && <StaticCardZoom card={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
