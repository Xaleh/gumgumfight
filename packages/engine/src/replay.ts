// Compatibilidade de replays gravados por versões anteriores do motor.

import { applyAction, createGame } from './engine';
import type { Action, GameConfig } from './types';

/** Versão atual dos replays (`ReplayFile.version`). */
export const REPLAY_VERSION = 2;

/**
 * Replays da versão 1 foram gravados quando a etapa de Counter sem opções e a carta de
 * Vida sem [Trigger] eram puladas sem ação. Hoje o motor sempre pede uma ação nesses
 * pontos; esta função insere as respostas implícitas para o roteiro antigo continuar válido.
 */
export function upgradeReplayActions(config: GameConfig, actions: Action[]): Action[] {
  let state = createGame(config);
  const out: Action[] = [];
  /** Resposta implícita à decisão pendente, a menos que `next` (a próxima ação gravada) já seja ela. */
  const implicit = (next?: Action): Action | null => {
    const p = state.pending;
    if (!p || state.phase === 'gameover') return null;
    if (p.kind === 'counter' && !p.options.length) {
      return next?.type === 'pass' && next.player === p.player ? null : { type: 'pass', player: p.player };
    }
    if (p.kind === 'lifeCard' && !state.defs[state.cards[p.card].cardId].abilities.some((a) => a.timing === 'trigger')) {
      return next?.type === 'answer' && next.player === p.player ? null : { type: 'answer', player: p.player, yes: false };
    }
    return null;
  };
  const step = (a: Action) => {
    state = applyAction(state, a);
    out.push(a);
  };
  for (const a of actions) {
    for (let i = implicit(a); i; i = implicit(a)) step(i);
    if (state.phase === 'gameover') break;
    step(a);
  }
  for (let i = implicit(); i; i = implicit()) step(i);
  return out;
}
