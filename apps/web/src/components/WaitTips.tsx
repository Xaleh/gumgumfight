// Cartão "enquanto você espera" (fila e sala privada): dicas de regra e, quando há números, o meta da semana e o
// histórico do jogador com o Líder do deck. A escolha e a ordem são de `waitTips.ts`.
//
// Animações (a opção do jogador): em `full` e `soft` o cartão troca sozinho, com uma entrada curta; a barrinha do
// tempo, que se repete, só existe em `full`; em `off` nada troca sozinho, e o jogador avança pelo botão.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type StatsOverview } from '../api';
import { type Translate, useT } from '../i18n';
import { useSettings } from '../settings';
import { deckTips, metaTip, nextTip, RULE_TIPS, shuffled, TIP_START, type WaitTip } from '../waitTips';
import { Icon } from './Icons';

/** Quanto tempo cada item fica na tela. */
export const TIP_MS = 9000;

function tipText(t: Translate, tip: WaitTip): { kicker: string; text: string } {
  switch (tip.kind) {
    case 'rule':
      return { kicker: t('wait.kickerRule'), text: t(tip.key) };
    case 'meta':
      return { kicker: t('wait.kickerMeta'), text: t('wait.metaTop', { list: tip.leaders.map((l) => `${l.name} ${l.pct}%`).join(' · ') }) };
    case 'deck':
      return { kicker: t('wait.kickerDeck'), text: t('wait.deckRecord', { name: tip.name, wins: tip.wins, games: tip.games, pct: tip.pct }) };
    case 'matchup':
      return {
        kicker: t('wait.kickerDeck'),
        text: t(tip.best ? 'wait.matchupBest' : 'wait.matchupWorst', { name: tip.name, opp: tip.opp, games: tip.games, pct: tip.pct }),
      };
  }
}

/** `leader`: o Líder do deck com que o jogador espera (id da carta), para o histórico dele; sem ele, só dicas e meta. */
export function WaitTips({ leader }: { leader?: string | null }) {
  const t = useT();
  const { animations } = useSettings();
  const [meta, setMeta] = useState<StatsOverview | null>(null);
  const [mine, setMine] = useState<StatsOverview | null>(null);
  useEffect(() => {
    let stop = false;
    // Sem rede ou sem estatísticas: o cartão fica só com as dicas.
    api.stats({ days: '7' }).then(
      (s) => !stop && setMeta(s),
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
  // O avanço lê os dados mais novos sem recriar o temporizador a cada resposta do servidor.
  const latest = useRef(data);
  latest.current = data;

  const [shown, setShown] = useState(() => nextTip(TIP_START, rules, []));
  const advance = useCallback(() => setShown((s) => nextTip(s.cursor, rules, latest.current)), [rules]);
  const step = shown.cursor.step;
  useEffect(() => {
    if (animations === 'off') return;
    const timer = setTimeout(advance, TIP_MS);
    return () => clearTimeout(timer);
  }, [step, animations, advance]);

  if (!shown.tip) return null;
  const { kicker, text } = tipText(t, shown.tip);
  return (
    <section className={`wait-tips anim-${animations}`} aria-label={t('wait.tipsLabel')}>
      <div className="wait-tip" key={step}>
        <span className="wait-tip-kicker">{kicker}</span>
        <p>{text}</p>
      </div>
      <button type="button" className="wait-tip-next" onClick={advance} aria-label={t('wait.next')} title={t('wait.next')}>
        <Icon name="chevron" size={16} />
      </button>
      {animations === 'full' && <i className="wait-tip-timer" key={`timer-${step}`} style={{ animationDuration: `${TIP_MS}ms` }} />}
    </section>
  );
}
