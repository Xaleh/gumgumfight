import { describe, expect, it } from 'vitest';
import type { GlobalQueue } from '../src/api';
import { bountyOptions, choiceOf, formatOptions, periodOptions, queueFor } from '../src/globalQueues';

/** As 7 filas da OPTCG Logpose API em 26/10/2026, como o servidor as descreve. */
const q = (key: string, name: string, extra: Partial<GlobalQueue>): GlobalQueue => ({
  key,
  name,
  sort: 0,
  format: 'standard',
  minBounty: null,
  window: false,
  period: 'season',
  season: null,
  lastModified: null,
  fetchedAt: '2026-10-26T12:00:00.000Z',
  ...extra,
});
const QUEUES: GlobalQueue[] = [
  q('lw_eastern', 'LW Extra Regulation', { format: 'egb', window: true, period: 'week' }),
  q('lw', 'LW Standard', { window: true, period: 'week' }),
  q('LWS1BillionBounty', 'LW Standard 1Billion', { minBounty: 1, window: true, period: 'week' }),
  q('LWS2BillionBounty', 'LW Standard 2Billion', { minBounty: 2, window: true, period: 'week' }),
  q('Special_Queue', 'Special Queue', { format: null, period: 'other' }),
  q('OP17', 'OP17', { season: 'OP17' }),
  q('OP17-1BillionBounty', 'OP17 1Billion', { minBounty: 1, season: 'OP17' }),
];

describe('filtros do meta global (sem o nome das filas)', () => {
  it('as filas viram período, formato e jogadores', () => {
    expect(periodOptions(QUEUES)).toEqual(['week', 'season:OP17', 'queue:Special_Queue']);
    expect(formatOptions(QUEUES, 'week')).toEqual(['standard', 'egb']);
    expect(formatOptions(QUEUES, 'season:OP17')).toEqual(['standard']);
    expect(formatOptions(QUEUES, 'queue:Special_Queue')).toEqual([]);
    expect(bountyOptions(QUEUES, 'week', 'standard')).toEqual([null, 1, 2]);
    expect(bountyOptions(QUEUES, 'week', 'egb')).toEqual([null]);
    expect(bountyOptions(QUEUES, 'season:OP17', 'standard')).toEqual([null, 1]);
  });

  it('cada escolha aponta para uma fila, e uma combinação que não existe cai na mais próxima', () => {
    expect(queueFor(QUEUES, { period: 'week', format: 'standard', minBounty: 2 })?.key).toBe('LWS2BillionBounty');
    expect(queueFor(QUEUES, { period: 'week', format: 'egb', minBounty: null })?.key).toBe('lw_eastern');
    // Temporada não tem "2 bilhões": fica com todos os jogadores no mesmo formato.
    expect(queueFor(QUEUES, { period: 'season:OP17', format: 'standard', minBounty: 2 })?.key).toBe('OP17');
    // Temporada não tem EGB: fica com o Standard.
    expect(queueFor(QUEUES, { period: 'season:OP17', format: 'egb', minBounty: 1 })?.key).toBe('OP17');
    // Fila à parte: ela mesma, seja qual for o resto.
    expect(queueFor(QUEUES, { period: 'queue:Special_Queue', format: 'standard', minBounty: 1 })?.key).toBe('Special_Queue');
    // Ida e volta: a escolha de uma fila leva de volta a ela.
    for (const x of QUEUES) expect(queueFor(QUEUES, choiceOf(x))?.key).toBe(x.key);
  });
});
