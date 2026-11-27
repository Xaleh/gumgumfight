// Cartão "enquanto você espera" (fila e sala privada): dicas de regra, quando há números, o meta da semana e o
// histórico do jogador com o Líder do deck, e os spoilers que chegaram nos últimos 7 dias, alternando com o resto
// (a carta abre ampliada ao toque). A escolha e a ordem são de `waitTips.ts`.
//
// Todo item tem imagem: a dica de regra, uma ilustração própria (`TipArt`); o meta e o histórico, a arte dos
// Líderes (`LeaderArt`, que cai na inicial quando o jogador desligou as imagens); o spoiler, a carta.
//
// Animações (a opção do jogador): em `full` e `soft` o cartão troca sozinho, com uma entrada curta; a barrinha do
// tempo, que se repete, só existe em `full`; em `off` nada troca sozinho, e o jogador avança pelo botão.

import type { CardData } from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ApiCard, api, type StatsOverview } from '../api';
import { type Translate, useT } from '../i18n';
import { useSettings } from '../settings';
import { deckTips, metaTip, nextTip, RULE_TIPS, shuffled, spoilerTips, TIP_START, type WaitTip } from '../waitTips';
import { StaticCardZoom } from './CardInfo';
import { StaticCard } from './CardView';
import { Icon } from './Icons';
import { LeaderArt } from './LeaderArt';
import { TipArt } from './TipArt';

/** Quanto tempo cada item fica na tela. */
export const TIP_MS = 9000;

function tipText(t: Translate, tip: WaitTip): { kicker: string; text: string } {
  switch (tip.kind) {
    case 'rule':
      return { kicker: t('wait.kickerRule'), text: t(tip.key) };
    case 'meta':
      return { kicker: t('wait.kickerMeta'), text: t('wait.metaTitle') };
    case 'deck':
      return { kicker: t('wait.kickerDeck'), text: t('wait.deckRecord', { name: tip.leader.name, wins: tip.wins, games: tip.games, pct: tip.pct }) };
    case 'matchup':
      return {
        kicker: t('wait.kickerDeck'),
        text: t(tip.best ? 'wait.matchupBest' : 'wait.matchupWorst', { name: tip.leader.name, opp: tip.opp.name, games: tip.games, pct: tip.pct }),
      };
    case 'spoiler': {
      const when = tip.daysAgo === 0 ? t('wait.spoilerToday') : tip.daysAgo === 1 ? t('wait.spoilerYesterday') : t('wait.spoilerDays', { n: tip.daysAgo });
      return { kicker: t('wait.kickerSpoiler'), text: `${when} ${t('wait.spoilerOpen')}` };
    }
  }
}

/** `leader`: o Líder do deck com que o jogador espera (id da carta), para o histórico dele; sem ele, só dicas e meta. */
export function WaitTips({ leader }: { leader?: string | null }) {
  const t = useT();
  const { animations } = useSettings();
  const [meta, setMeta] = useState<StatsOverview | null>(null);
  const [mine, setMine] = useState<StatsOverview | null>(null);
  const [recent, setRecent] = useState<{ cards: Array<ApiCard & { addedAt: string }> } | null>(null);
  useEffect(() => {
    let stop = false;
    // Sem rede ou sem estatísticas: o cartão fica só com as dicas.
    api.stats({ days: '7' }).then(
      (s) => !stop && setMeta(s),
      () => undefined,
    );
    api.recentSpoilers().then(
      (r) => !stop && setRecent(r),
      () => undefined,
    );
    return () => {
      stop = true;
    };
  }, []);
  useEffect(() => {
    setMine(null);
    if (!leader) return;
    let stop = false;
    api.stats({ mine: true, leader, opponent: 'human' }).then(
      (s) => !stop && setMine(s),
      () => undefined,
    );
    return () => {
      stop = true;
    };
  }, [leader]);

  const [rules] = useState<WaitTip[]>(() => shuffled(RULE_TIPS, Math.floor(Math.random() * 4294967296)).map((key) => ({ kind: 'rule', key })));
  const data = useMemo(() => {
    const top = metaTip(meta);
    return [...(leader ? deckTips(mine, leader) : []), ...(top ? [top] : [])];
  }, [meta, mine, leader]);
  const spoilers = useMemo(() => spoilerTips(recent), [recent]);
  // O avanço lê os dados mais novos sem recriar o temporizador a cada resposta do servidor.
  const latest = useRef({ data, spoilers });
  latest.current = { data, spoilers };

  const [shown, setShown] = useState(() => nextTip(TIP_START, rules, []));
  const advance = useCallback(() => setShown((s) => nextTip(s.cursor, rules, latest.current.data, latest.current.spoilers)), [rules]);
  const step = shown.cursor.step;
  /** Carta de spoiler aberta (ampliada): enquanto o jogador lê, o cartão não troca. */
  const [zoom, setZoom] = useState<CardData | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  const paused = animations === 'off' || zoom !== null;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(advance, TIP_MS);
    return () => clearTimeout(timer);
  }, [step, paused, advance]);

  const tip = shown.tip;
  if (!tip) return null;
  const { kicker, text } = tipText(t, tip);
  return (
    <section className={`wait-tips anim-${animations}`} aria-label={t('wait.tipsLabel')}>
      <div className={`wait-tip ${tip.kind}`} key={step}>
        {tip.kind === 'rule' && <TipArt tip={tip.key} />}
        {tip.kind === 'deck' && <LeaderArt name={tip.leader.name} image={tip.leader.image} colors={tip.leader.colors} />}
        {tip.kind === 'matchup' && (
          <div className="wait-tip-duo">
            <LeaderArt name={tip.leader.name} image={tip.leader.image} colors={tip.leader.colors} size="small" />
            <LeaderArt name={tip.opp.name} image={tip.opp.image} colors={tip.opp.colors} size="small" />
          </div>
        )}
        {tip.kind === 'spoiler' && (
          <button type="button" className="wait-tip-card" onClick={() => setZoom(tip.card)} aria-label={t('wait.spoilerView', { name: tip.card.name })}>
            <StaticCard card={tip.card} />
          </button>
        )}
        <div className="wait-tip-text">
          <span className="wait-tip-kicker">{kicker}</span>
          {tip.kind === 'spoiler' && (
            <strong className="wait-tip-name">
              {tip.card.name} <small>{tip.card.id}</small>
            </strong>
          )}
          <p>{text}</p>
          {tip.kind === 'meta' && (
            <ul className="wait-tip-leaders">
              {tip.leaders.map((l, i) => (
                <li key={i}>
                  <LeaderArt name={l.name} image={l.image} colors={l.colors} size="small" />
                  <b>{l.pct}%</b>
                  <span title={l.name}>{l.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <button type="button" className="wait-tip-next" onClick={advance} aria-label={t('wait.next')} title={t('wait.next')}>
        <Icon name="chevron" size={16} />
      </button>
      {animations === 'full' && !zoom && <i className="wait-tip-timer" key={`timer-${step}`} style={{ animationDuration: `${TIP_MS}ms` }} />}
      {zoom && <StaticCardZoom card={zoom} className="dk-zoom" onClose={closeZoom} />}
    </section>
  );
}
