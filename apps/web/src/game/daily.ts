// Desafio do dia no navegador: o texto para compartilhar (sem as jogadas) e os nomes do roteiro de ataques.
// Sem React: os testes chamam direto.

import type { GameState } from '@gumgum/engine';
import type { DailyResult, DailyStreak, DailyToday } from '../api';
import type { Translate } from '../i18n';

/** Endereço que abre o desafio do dia direto (`/?desafio`). */
export const DAILY_PARAM = 'desafio';

/**
 * Resultado para compartilhar: número do desafio, se resolveu e em quantas tentativas, a sequência e os últimos dias
 * (✅ resolvido, ⬛ não). Nada da mesa nem das jogadas, para não entregar a resposta.
 */
export function dailyShareText(
  t: Translate,
  data: Pick<DailyToday, 'number' | 'day' | 'history'>,
  result: DailyResult,
  streak: DailyStreak,
  origin: string,
): string {
  const days = data.history
    .filter((h) => h.day < data.day)
    .slice(0, 6)
    .reverse()
    .map((h) => (h.solved ? '✅' : '⬛'))
    .join('');
  const lines = [
    t('daily.share.title', { n: data.number }),
    result.solved ? t('daily.share.solved', { n: result.attempts }) : t('daily.share.failed', { n: result.attempts }),
    ...(streak.current > 0 ? [t('daily.share.streak', { n: streak.current })] : []),
    `${days}${result.solved ? '✅' : '⬛'}`,
    `${origin}/?${DAILY_PARAM}`,
  ];
  return lines.join('\n');
}

/** Nome de um lado do roteiro ('leader' = o Líder; senão o nome da carta, como a visão mostra). */
export function scriptName(t: Translate, view: GameState | undefined, ref: string, side: 'attacker' | 'target'): string {
  if (ref === 'leader') return side === 'attacker' ? t('daily.theirLeader') : t('daily.yourLeader');
  return view?.defs[ref]?.name ?? ref;
}
