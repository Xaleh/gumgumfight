// Compatibilidade de replays gravados por versões anteriores do motor.

import { applyAction, createGame } from './engine';
import type { Action, GameConfig } from './types';

/** Versão atual dos replays (`ReplayFile.version`). */
export const REPLAY_VERSION = 5;

/**
 * Replays de versões anteriores foram gravados quando o motor pulava sem ação etapas que hoje
 * sempre pedem uma: a etapa de Counter sem opções e a carta de Vida sem [Trigger] (versão 1);
 * a pergunta "pagar X?" sem como pagar e as escolhas na mão ou no deck sem opção (versão 2);
 * a escolha da ordem entre efeitos disparados juntos (versão 3) e a de quais DON!! devolver no
 * DON!! −X (versão 4), respondidas com a primeira opção (a ordem antiga: virados, ativos, dados).
 * Esta função insere as respostas implícitas para o roteiro antigo continuar válido. (Desde a
 * versão 4 os efeitos disparados resolvem em outra ordem (CR 8-6): um replay antigo com efeitos
 * encadeados pode tomar outro rumo. Da mesma forma, um [On K.O.] que ativava sem cumprir as
 * condições no campo ([DON!! xX], negação, [Once Per Turn]) hoje não ativa; não há decisão nova
 * a inserir, então a versão não mudou.)
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
    if (p.kind === 'confirm' && p.cannot) {
      return next?.type === 'answer' && !next.yes && next.player === p.player ? null : { type: 'answer', player: p.player, yes: false };
    }
    if (p.kind === 'option' && (p.order || p.don)) {
      return next?.type === 'option' && next.player === p.player ? null : { type: 'option', player: p.player, index: 0 };
    }
    if (p.kind === 'selectTargets' && p.hidden && !p.options.length) {
      return next?.type === 'choose' && !next.uids.length && next.player === p.player ? null : { type: 'choose', player: p.player, uids: [] };
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
