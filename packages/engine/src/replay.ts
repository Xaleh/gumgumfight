// Compatibilidade de replays gravados por versões anteriores do motor.

import { applyAction, createGame } from './engine';
import type { Action, GameConfig } from './types';

/** Versão atual dos replays (`ReplayFile.version`). */
export const REPLAY_VERSION = 8;

/**
 * Replays de versões anteriores foram gravados quando o motor pulava sem ação etapas que hoje
 * sempre pedem uma: a etapa de Counter sem opções e a carta de Vida sem [Trigger] (versão 1);
 * a pergunta "pagar X?" sem como pagar e as escolhas na mão ou no deck sem opção (versão 2);
 * a escolha da ordem entre efeitos disparados juntos (versão 3) e a de quais DON!! devolver no
 * DON!! −X (versão 4), respondidas com a primeira opção (a ordem antiga: virados, ativos, dados).
 * Esta função insere as respostas implícitas para o roteiro antigo continuar válido. (Desde a
 * versão 4 os efeitos disparados resolvem em outra ordem (CR 8-6): um replay antigo com efeitos
 * encadeados pode tomar outro rumo. Da mesma forma, um [On K.O.] que ativava sem cumprir as
 * condições no campo ([DON!! xX], negação, [Once Per Turn]) hoje não ativa, e o [Once Per Turn] de
 * uma carta que saiu do campo e voltou no mesmo turno hoje pode ser usado de novo; não há decisão
 * nova a inserir, então a versão não mudou.) Até a versão 5, a escolha de alvos sem "up to" aceitava
 * 0 alvos; a gravada com menos alvos do que hoje é obrigatório (8-4-4-1) é completada com as
 * primeiras opções. Até a versão 6, só a primeira substituição aplicável ("… instead") era
 * oferecida, só contra remoção por efeito do oponente (fora `fieldToLife` e "your opponent
 * chooses") e uma vez por Personagem; a pergunta que o roteiro antigo não tem é recusada (o que
 * acontecia antes). Pagar uma vez hoje salva todos os Personagens removidos juntos, então um replay
 * antigo que pagou por cada um pode tomar outro rumo. Até a versão 7, "rest up to 1 of your
 * opponent's DON!! cards or Characters" virava o Personagem sem oferecer a substituição de rest
 * ("If this Character would be rested by your opponent's Character's effect, … instead"); a
 * pergunta também é recusada. (Também desde a versão 8, "cannot be K.O.'d by your opponent's
 * effects" não protege do K.O. pelo próprio efeito, o Personagem protegido não paga custo de K.O.
 * e o Stage protegido não é nocauteado: sem decisão nova, mas um replay antigo pode tomar outro rumo.
 * O mesmo vale para a carta do [Trigger], que hoje fica fora do descarte enquanto resolve, para
 * o Personagem posto na Vida "face-up" (`fieldToLife`), que hoje fica virado para cima, para o
 * Evento [Counter] com redução de custo na mão e para os efeitos de fim de batalha, que hoje
 * resolvem antes de expirar o "during this battle". A ação `counter` ganhou `target` opcional;
 * sem ele, o Counter vai para o atacado, como sempre.)
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
    if (p.kind === 'confirm' && replacementAsked()) {
      return next?.type === 'answer' && next.player === p.player ? null : { type: 'answer', player: p.player, yes: false };
    }
    if (p.kind === 'option' && (p.order || p.don)) {
      return next?.type === 'option' && next.player === p.player ? null : { type: 'option', player: p.player, index: 0 };
    }
    if (p.kind === 'selectTargets' && p.hidden && !p.options.length) {
      return next?.type === 'choose' && !next.uids.length && next.player === p.player ? null : { type: 'choose', player: p.player, uids: [] };
    }
    return null;
  };
  /** A pergunta aberta é a de uma substituição contra remoção ou rest (passo `replaceRemoval`/`replaceRest`)? */
  const replacementAsked = () => {
    const frame = state.stack[state.stack.length - 1];
    const step = frame?.kind === 'effect' ? frame.steps[frame.i]?.do : undefined;
    return step === 'replaceRemoval' || step === 'replaceRest';
  };
  const step = (a: Action) => {
    state = applyAction(state, a);
    out.push(a);
  };
  /**
   * Escolha gravada com menos alvos do que o mínimo atual: antes de a escolha sem "up to" passar a
   * ser obrigatória (8-4-4-1), dava para escolher 0. Completa com as primeiras opções para o
   * replay continuar carregando (dali em diante a partida pode tomar outro rumo).
   */
  const completed = (a: Action): Action => {
    const p = state.pending;
    if (p?.kind !== 'selectTargets' || a.type !== 'choose' || a.player !== p.player || a.uids.length >= p.min) return a;
    const uids = [...a.uids];
    for (const u of p.options) if (uids.length < p.min && !uids.includes(u)) uids.push(u);
    return { ...a, uids };
  };
  for (const a of actions) {
    for (let i = implicit(a); i; i = implicit(a)) step(i);
    if (state.phase === 'gameover') break;
    step(completed(a));
  }
  for (let i = implicit(); i; i = implicit()) step(i);
  return out;
}
