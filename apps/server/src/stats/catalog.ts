// Catálogo das dimensões das estatísticas: formatos, filas, tiers por recompensa
// e o cálculo da recompensa (Beries) na ranqueada. A interface lê tudo isto de
// GET /api/stats/meta, então mudar uma faixa ou um formato é só mexer aqui.

// Formatos: definidos no motor, junto das regras de cartas banidas e rotacionadas.
export { FORMATS, type FormatId, isFormat } from '@gumgum/engine';

export const QUEUES = [
  { id: 'casual', label: 'Casual' },
  { id: 'ranked', label: 'Ranqueada' },
] as const;
export type QueueId = (typeof QUEUES)[number]['id'];

/** Quem controla um lado da partida. */
export type Controller = 'human' | 'bot';

export interface Tier {
  id: string;
  label: string;
  /** Faixa de recompensa em Beries, inclusiva. max null = sem teto. */
  min: number;
  max: number | null;
}

/** Tiers da ranqueada por faixa de recompensa. */
export const TIERS: Tier[] = [
  { id: 'east-blue', label: 'East Blue', min: 0, max: 5_000 },
  { id: 'paradise', label: 'Paradise', min: 5_001, max: 20_000 },
  { id: 'new-world', label: 'Novo Mundo', min: 20_001, max: 50_000 },
  { id: 'supernova', label: 'Supernova', min: 50_001, max: 100_000 },
  { id: 'warlord', label: 'Shichibukai', min: 100_001, max: 250_000 },
  { id: 'emperor', label: 'Yonkou', min: 250_001, max: null },
];

export function tierFor(bounty: number): Tier {
  return TIERS.find((t) => bounty >= t.min && (t.max === null || bounty <= t.max)) ?? TIERS[0];
}

export const isQueue = (v: unknown): v is QueueId => QUEUES.some((q) => q.id === v);
export const isTier = (v: unknown): v is string => TIERS.some((t) => t.id === v);

/** Recompensa de quem nunca jogou ranqueada. */
export const START_BOUNTY = 0;
/** Beries em jogo numa partida entre recompensas iguais. */
export const BOUNTY_STAKE = 1_000;
/** Diferença de recompensa que faz o favorito ter ~91% de chance (escala do Elo). */
export const BOUNTY_SCALE = 20_000;

/**
 * Variação de recompensa ao fim de uma ranqueada, no estilo Elo: vencer quem tem
 * recompensa maior rende mais; perder para quem tem menor custa mais. A
 * recompensa nunca fica negativa.
 */
export function bountyDelta(mine: number, theirs: number, won: boolean): number {
  const expected = 1 / (1 + 10 ** ((theirs - mine) / BOUNTY_SCALE));
  const delta = Math.round(BOUNTY_STAKE * 2 * ((won ? 1 : 0) - expected));
  return Math.max(delta, -mine);
}
