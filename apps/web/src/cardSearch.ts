// Busca do catálogo de cartas (construtor de decks): o campo de texto aceita atalhos além do
// texto livre. Sem React, para poder testar.
//
//   c3        custo 3
//   c2000     Counter +2000 (número a partir de 1000 é Counter, abaixo disso é custo)
//   c3 c2000  os dois juntos: custo 3 com Counter +2000
//
// Atalhos do mesmo tipo somam (c3 c4 = custo 3 ou 4); tipos diferentes se combinam (custo E
// Counter). O que não for atalho continua sendo a busca por nome, número, tipo ou texto.

import type { CardData } from '@gumgum/engine';

export interface CardQuery {
  /** Custos aceitos (vazio = qualquer custo). */
  costs: number[];
  /** Valores de Counter aceitos (vazio = qualquer um, inclusive carta sem Counter). */
  counters: number[];
  /** O resto da busca, em minúsculas: trecho procurado no nome, número, tipo ou texto. */
  text: string;
}

/** A partir deste número, `c<número>` é Counter (+1000, +2000); abaixo, é custo. */
const COUNTER_MIN = 1000;

const SHORTCUT = /^c(\d+)$/;

export function parseCardQuery(query: string): CardQuery {
  const costs: number[] = [];
  const counters: number[] = [];
  const words: string[] = [];
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    const m = SHORTCUT.exec(word);
    if (!m) {
      words.push(word);
      continue;
    }
    const n = Number(m[1]);
    (n >= COUNTER_MIN ? counters : costs).push(n);
  }
  return { costs, counters, text: words.join(' ') };
}

export function matchesCardQuery(card: CardData, q: CardQuery): boolean {
  if (q.costs.length && (card.cost === undefined || !q.costs.includes(card.cost))) return false;
  if (q.counters.length && (card.counter === undefined || !q.counters.includes(card.counter))) return false;
  if (q.text) {
    const hay = `${card.id} ${card.name} ${card.types.join(' ')} ${card.text} ${card.i18n?.pt?.text ?? ''}`.toLowerCase();
    if (!hay.includes(q.text)) return false;
  }
  return true;
}
