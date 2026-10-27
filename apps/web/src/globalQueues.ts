// Filtros do meta global (TCG Matchmaking): as filas da API ("LW Standard 1Billion", "OP17"...) viram três
// escolhas na tela, sem o nome deles: período (últimos 7 dias, temporada ou fila à parte), formato e jogadores
// (todos ou só os de recompensa alta lá). A combinação escolhida aponta para uma fila da API.

import type { FormatId, GlobalQueue } from './api';

/** Período no filtro: `week`, `season:OP17` ou `queue:<chave>` (filas à parte, como a Special Queue). */
export type PeriodId = string;

export interface QueueChoice {
  period: PeriodId;
  format: FormatId | null;
  minBounty: number | null;
}

export const periodOf = (q: GlobalQueue): PeriodId => (q.period === 'week' ? 'week' : q.period === 'season' && q.season ? `season:${q.season}` : `queue:${q.key}`);

export const choiceOf = (q: GlobalQueue): QueueChoice => ({ period: periodOf(q), format: q.format, minBounty: q.minBounty });

const FORMAT_ORDER: FormatId[] = ['standard', 'egb'];

/** Períodos na ordem da tela: a semana, as temporadas (a mais nova primeiro) e as filas à parte. */
export function periodOptions(queues: GlobalQueue[]): PeriodId[] {
  const ids = [...new Set(queues.map(periodOf))];
  const rank = (id: PeriodId) => (id === 'week' ? 0 : id.startsWith('season:') ? 1 : 2);
  return ids.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? b.localeCompare(a, 'en', { numeric: true }) : 0));
}

/** Formatos do período (Standard antes do EGB). */
export function formatOptions(queues: GlobalQueue[], period: PeriodId): FormatId[] {
  const have = new Set(queues.filter((q) => periodOf(q) === period).map((q) => q.format));
  return FORMAT_ORDER.filter((f) => have.has(f));
}

/** Faixas de jogadores do período e formato: todos (null) e depois as de recompensa, da menor para a maior. */
export function bountyOptions(queues: GlobalQueue[], period: PeriodId, format: FormatId | null): Array<number | null> {
  const list = [...new Set(queues.filter((q) => periodOf(q) === period && q.format === format).map((q) => q.minBounty))];
  return list.sort((a, b) => (a ?? 0) - (b ?? 0));
}

/**
 * A fila da escolha. Quando a combinação não existe (ex.: trocar para um período sem a faixa de
 * recompensa escolhida), fica com o que for possível, nesta ordem: mesmo formato e todos os jogadores,
 * mesmo formato, a primeira do período.
 */
export function queueFor(queues: GlobalQueue[], c: QueueChoice): GlobalQueue | undefined {
  const inPeriod = queues.filter((q) => periodOf(q) === c.period);
  return (
    inPeriod.find((q) => q.format === c.format && q.minBounty === c.minBounty) ??
    inPeriod.find((q) => q.format === c.format && q.minBounty === null) ??
    inPeriod.find((q) => q.format === c.format) ??
    inPeriod.find((q) => q.format === 'standard' && q.minBounty === null) ??
    inPeriod[0]
  );
}
