// Contas de layout do kit de divulgação (sem canvas, para poder testar): grade das
// decklists, fatias da pizza dos líderes e a legenda.

import type { LeaderCount, RecapCard } from '../api';

/** Altura / largura de uma carta (600 × 838 nas imagens oficiais). */
export const CARD_RATIO = 838 / 600;

export interface Grid {
  cols: number;
  rows: number;
  /** Largura de cada carta (e da coluna). */
  tileW: number;
  /** Altura da carta + espaço do código embaixo. */
  tileH: number;
  cardH: number;
  gridW: number;
  gridH: number;
}

/**
 * Grade das cartas: a menor quantidade de colunas (de `minCols` a `maxCols`) em que
 * tudo cabe na área; se nem com `maxCols` couber, as cartas encolhem para caber na altura.
 */
export function gridLayout(n: number, width: number, height: number, { gap = 14, labelH = 30, minCols = 4, maxCols = 8 } = {}): Grid {
  const fit = (cols: number, tileW: number): Grid => {
    const rows = Math.max(1, Math.ceil(n / cols));
    const cardH = tileW * CARD_RATIO;
    const tileH = cardH + labelH;
    return { cols, rows, tileW, tileH, cardH, gridW: cols * tileW + (cols - 1) * gap, gridH: rows * tileH + (rows - 1) * gap };
  };
  for (let cols = minCols; cols <= maxCols; cols++) {
    const g = fit(cols, (width - (cols - 1) * gap) / cols);
    if (g.gridH <= height) return g;
  }
  const rows = Math.max(1, Math.ceil(n / maxCols));
  const tileW = Math.max(10, ((height - (rows - 1) * gap) / rows - labelH) / CARD_RATIO);
  return fit(maxCols, Math.min(tileW, (width - (maxCols - 1) * gap) / maxCols));
}

export interface Slice {
  count: number;
  /** Ângulos em radianos (começa no topo, sentido horário). */
  start: number;
  end: number;
  /** O líder da fatia (null = "Outros"). */
  leader: RecapCard | null;
  /** Quantos líderes entram em "Outros". */
  grouped: number;
}

/**
 * Fatias da pizza: com muitos líderes, os de fatia pequena (menos de `minFraction`) e os
 * que passam de `maxSlices` viram uma fatia "Outros" no desenho (a legenda mostra todos).
 */
export function pieSlices(entries: LeaderCount[], { minFraction = 0.025, maxSlices = 12 } = {}): Slice[] {
  const total = entries.reduce((n, e) => n + e.count, 0);
  if (!total) return [];
  let keep = entries;
  let rest: LeaderCount[] = [];
  if (entries.length > maxSlices || entries.some((e) => e.count / total < minFraction)) {
    const cut = entries.findIndex((e, i) => i >= maxSlices - 1 || e.count / total < minFraction);
    if (cut >= 0 && entries.length - cut > 1) {
      keep = entries.slice(0, cut);
      rest = entries.slice(cut);
    }
  }
  const parts = [
    ...keep.map((e) => ({ count: e.count, leader: e.leader, grouped: 0 })),
    ...(rest.length ? [{ count: rest.reduce((n, e) => n + e.count, 0), leader: null, grouped: rest.length }] : []),
  ];
  let at = -Math.PI / 2;
  return parts.map((p) => {
    const start = at;
    at += (p.count / total) * Math.PI * 2;
    return { ...p, start, end: at };
  });
}

/** Legenda: os primeiros `max` líderes e, se sobrar, uma linha "+N outros" com a soma. */
export function legendRows(entries: LeaderCount[], max = 15): { shown: LeaderCount[]; rest: { leaders: number; count: number } | null } {
  if (entries.length <= max) return { shown: entries, rest: null };
  const shown = entries.slice(0, max - 1);
  const others = entries.slice(max - 1);
  return { shown, rest: { leaders: others.length, count: others.reduce((n, e) => n + e.count, 0) } };
}

/** "Rocks.D.Xebec (OP17)": a coleção separa líderes de mesmo nome. */
export const leaderLabel = (c: RecapCard) => (c.set ? `${c.name} (${c.set})` : c.name);

/** Nome de arquivo seguro a partir do nome do torneio. */
export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'torneio';
