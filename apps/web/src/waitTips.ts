// O que o cartão de dicas mostra enquanto o jogador espera um oponente (fila ou sala privada): dicas de regra
// e, quando há números, o meta da semana e o histórico do jogador com o Líder do deck. Só a escolha e a ordem
// ficam aqui (sem React), para os testes; a tela é `components/WaitTips.tsx`.

import type { StatsOverview } from './api';
import type { MessageKey } from './i18n';

/** Dicas de regra (chaves do dicionário `i18n/wait`). */
export const RULE_TIPS = [
  'wait.tip.firstTurn',
  'wait.tip.noFirstAttack',
  'wait.tip.rush',
  'wait.tip.rested',
  'wait.tip.tie',
  'wait.tip.blockThenCounter',
  'wait.tip.don',
  'wait.tip.mulligan',
  'wait.tip.zeroLife',
  'wait.tip.deckOut',
  'wait.tip.trigger',
  'wait.tip.doubleBanish',
  'wait.tip.fiveCharacters',
] as const satisfies readonly MessageKey[];

export type WaitTip =
  | { kind: 'rule'; key: MessageKey }
  /** Líderes mais jogados na semana, com a fatia (0..100) de cada um. */
  | { kind: 'meta'; leaders: Array<{ name: string; pct: number }> }
  /** Vitórias do jogador com o Líder do deck, contra outras pessoas. */
  | { kind: 'deck'; name: string; games: number; wins: number; pct: number }
  /** Melhor (`best`) ou pior confronto do jogador com o Líder do deck. */
  | { kind: 'matchup'; best: boolean; name: string; opp: string; games: number; pct: number };

/** Líderes mostrados no meta da semana. */
const META_TOP = 3;
/** Partidas a partir das quais o histórico com o Líder diz alguma coisa. */
export const DECK_MIN_GAMES = 5;
/** Partidas a partir das quais um confronto entra na conta do melhor e do pior. */
export const MATCHUP_MIN_GAMES = 3;

const pct = (wins: number, games: number) => Math.round((wins / games) * 100);

/** O meta da semana: os Líderes mais jogados e a fatia de cada um (null: sem partidas). */
export function metaTip(stats: Pick<StatsOverview, 'leaders' | 'cards'> | null): WaitTip | null {
  const total = stats?.leaders.reduce((n, l) => n + l.games, 0) ?? 0;
  if (!stats || !total) return null;
  const top = [...stats.leaders].sort((a, b) => b.games - a.games).slice(0, META_TOP);
  return { kind: 'meta', leaders: top.map((l) => ({ name: stats.cards[l.leader]?.name ?? l.leader, pct: pct(l.games, total) })) };
}

/**
 * O histórico do jogador com o Líder do deck (`stats`: as partidas dele com esse Líder): o total e, quando há
 * confrontos com partidas suficientes, o melhor e o pior (o pior só quando é outro confronto).
 */
export function deckTips(stats: Pick<StatsOverview, 'summary' | 'matchups' | 'cards'> | null, leader: string): WaitTip[] {
  if (!stats) return [];
  const name = stats.cards[leader]?.name ?? leader;
  const out: WaitTip[] = [];
  const { games, wins } = stats.summary;
  if (games >= DECK_MIN_GAMES) out.push({ kind: 'deck', name, games, wins, pct: pct(wins, games) });
  const rows = stats.matchups
    .filter((m) => m.leader === leader && m.games >= MATCHUP_MIN_GAMES)
    // Da maior para a menor taxa de vitória; no empate, o confronto com mais partidas.
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games);
  const tip = (m: (typeof rows)[number], best: boolean): WaitTip => ({
    kind: 'matchup',
    best,
    name,
    opp: stats.cards[m.oppLeader]?.name ?? m.oppLeader,
    games: m.games,
    pct: pct(m.wins, m.games),
  });
  if (rows.length) out.push(tip(rows[0], true));
  const worst = rows[rows.length - 1];
  if (rows.length > 1 && worst.wins / worst.games < rows[0].wins / rows[0].games) out.push(tip(worst, false));
  return out;
}

/** Embaralha com semente (mulberry32 + Fisher-Yates): a ordem das dicas muda a cada espera. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Onde a rotação está: quantos itens já saíram de cada lista. */
export interface TipCursor {
  step: number;
  rule: number;
  data: number;
}

export const TIP_START: TipCursor = { step: 0, rule: 0, data: 0 };

/** A cada quantos itens entra um de dados (meta, histórico), quando há algum. */
const DATA_EVERY = 3;

/**
 * O próximo item da rotação: duas dicas de regra e um item de dados, em ciclo. Sem dados (ainda carregando, ou
 * o jogador não tem histórico), só dicas. Cada lista anda no seu contador, então os dados que chegam no meio
 * da espera entram sem repetir nem pular dica.
 */
export function nextTip(cursor: TipCursor, rules: readonly WaitTip[], data: readonly WaitTip[]): { tip: WaitTip | null; cursor: TipCursor } {
  const step = cursor.step + 1;
  const wantsData = step % DATA_EVERY === 0;
  if (data.length && (wantsData || !rules.length)) {
    return { tip: data[cursor.data % data.length], cursor: { step, rule: cursor.rule, data: cursor.data + 1 } };
  }
  if (!rules.length) return { tip: null, cursor: { ...cursor, step } };
  return { tip: rules[cursor.rule % rules.length], cursor: { step, rule: cursor.rule + 1, data: cursor.data } };
}
