// Passos de efeito que são uma decisão: pagar um custo opcional ("You may …:"), escolher entre opções, deixar o
// oponente escolher, só selecionar um alvo, e o passo manual (efeito ainda não automatizado).

import type { EffectStep, GameState, PlayerState } from '../../types';
import type { EffectFrame } from '../constants';
import { lg, log, pr } from '../messages';
import { opponentOf } from '../table';
import { releaseOncePerTurn, targetCandidates } from '../options';
import { pushEffect } from '../stack';
import { abortEffect, askOption, resolveTargets } from '../effects';
import { askPay, canPayCost, costAsksOwner, costPartsOf, describeCost, payImmediateCost } from '../costs';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type ChoiceStep = Extract<EffectStep, { do: 'manual' | 'payCost' | 'select' | 'chooseCost' | 'opponentMay' | 'payEither' | 'chooseOne' }>;

export function execChoiceStep(state: GameState, frame: EffectFrame, step: ChoiceStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'manual':
      if (frame.choice) return true; // o jogador já confirmou
      state.pending = { kind: 'manual', player: frame.controller, source: frame.source, text: step.text };
      return false;
    case 'payCost': {
      const cost = step.cost;
      if (!frame.choice) {
        // Custo que o oponente vê que não dá para pagar (DON!!, campo, Vida): pula sem perguntar.
        // Se só a mão impede, a pergunta abre mesmo assim (com "não" como única resposta).
        if (!costAsksOwner(state, frame.controller, frame.source, cost)) {
          releaseOncePerTurn(state, frame.source, step.ability);
          if (step.scope === undefined) return abortEffect(frame);
          frame.i += step.scope;
          return true;
        }
        // "you may rest 1 of your Characters. If you do, …": sem carta que possa ser escolhida, a
        // ação não pode ser feita e o "If you do" não acontece; pula sem perguntar (o campo é público).
        const next = frame.steps[frame.i + 1];
        const target = next && 'target' in next ? next.target : undefined;
        if (step.scope && !Object.keys(cost).length && typeof target === 'object' && target.required && !targetCandidates(state, frame.controller, frame.source, target).length) {
          log(state, frame.controller, lg('optionalNoCards', `${srcName}: nenhuma carta pode ser escolhida, o efeito opcional não é usado.`, { source: srcName }), { cards: [frame.source] });
          releaseOncePerTurn(state, frame.source, step.ability);
          frame.i += step.scope;
          return true;
        }
        // "you may trash 1 card from your hand. If you do, …": com menos cartas na mão do que o
        // descarte pede, o descarte não pode ser feito e o "If you do" não acontece (o tamanho da mão é público).
        if (step.scope && !Object.keys(cost).length && next?.do === 'trashFromHand' && !next.upTo && ps.hand.length < next.count) {
          log(state, frame.controller, lg('optionalNotEnoughHand', `${srcName}: cartas insuficientes na mão para descartar, o efeito opcional não é usado.`, { source: srcName }), { cards: [frame.source] });
          releaseOncePerTurn(state, frame.source, step.ability);
          frame.i += step.scope;
          return true;
        }
        askPay(
          state,
          frame.controller,
          frame.source,
          cost,
          Object.keys(cost).length
            ? pr('useEffectWithCost', `${srcName}: usar o efeito? Custo: ${describeCost(cost)}.`, { source: srcName, cost: describeCost(cost) }, costPartsOf(cost))
            : pr('useEffect', `${srcName}: usar o efeito?`, { source: srcName }),
        );
        return false;
      }
      if (!frame.choice.length) {
        log(state, frame.controller, lg('declinesEffect', `${ps.name} não usa o efeito de ${srcName}.`, { player: ps.name, source: srcName }), { cards: [frame.source] });
        releaseOncePerTurn(state, frame.source, step.ability);
        if (step.scope === undefined) return abortEffect(frame);
        // "you may X" no meio do efeito: pula só X (e o "If you do, …"), o resto continua.
        frame.i += step.scope;
        return true;
      }
      frame.steps.splice(frame.i + 1, 0, ...payImmediateCost(state, frame.controller, frame.source, cost));
      return true;
    }
    case 'select': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseCard', `${srcName}: escolha uma carta.`, { source: srcName }));
      return Boolean(t);
    }
    case 'chooseCost':
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('chooseACost', `${srcName}: escolha um custo.`, { source: srcName }), Array.from({ length: 11 }, (_, i) => String(i)));
        return false;
      }
      frame.chosenCost = Number(frame.choice[0]);
      log(state, frame.controller, lg('choosesCost', `${ps.name} escolhe o custo ${frame.chosenCost}.`, { player: ps.name, n: frame.chosenCost }));
      return true;
    case 'opponentMay': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const canPay =
        step.pay === 'lifeTrash' ? opp.life.length >= step.count : step.pay === 'discard' ? opp.hand.length >= step.count : opp.donActive >= step.count;
      const what =
        step.pay === 'lifeTrash' ? `descartar ${step.count} carta(s) do topo da Vida` : step.pay === 'discard' ? `descartar ${step.count} carta(s) da mão` : `devolver ${step.count} DON!! ativo(s)`;
      if (!canPay) {
        frame.steps.splice(frame.i + 1, 0, ...step.otherwise);
        return true;
      }
      if (!frame.choice) {
        const payKey = step.pay === 'lifeTrash' ? 'LifeTrash' : step.pay === 'discard' ? 'Discard' : 'ReturnDon';
        askOption(state, frame, opp.id, pr(`opponentMay${payKey}`, `${srcName}: ${what} para evitar o efeito?`, { source: srcName, n: step.count }), [`Sim, ${what}`, 'Não'], [
          `engine.optYes${payKey}`,
          'common.no',
        ]);
        return false;
      }
      if (frame.choice[0] === '0') {
        if (step.pay === 'lifeTrash') frame.steps.splice(frame.i + 1, 0, { do: 'trashLife', side: 'opponent', count: step.count });
        else if (step.pay === 'discard') frame.steps.splice(frame.i + 1, 0, { do: 'opponentDiscards', count: step.count });
        else frame.steps.splice(frame.i + 1, 0, { do: 'opponentReturnsDon', count: step.count, activeOnly: true });
      } else frame.steps.splice(frame.i + 1, 0, ...step.otherwise);
      return true;
    }
    case 'payEither': {
      const payable = step.options.map((c, i) => [c, i] as const).filter(([c]) => canPayCost(state, frame.controller, frame.source, c));
      if (!payable.length) return abortEffect(frame);
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('howToPayCost', `${srcName}: como pagar o custo?`, { source: srcName }),
          payable.map(([c]) => describeCost(c)),
          undefined,
          payable.map(([c]) => costPartsOf(c).cost),
        );
        frame.memo = payable.map(([, i]) => String(i));
        return false;
      }
      const cost = step.options[Number(frame.memo![Number(frame.choice[0])])];
      frame.steps.splice(frame.i + 1, 0, ...payImmediateCost(state, frame.controller, frame.source, cost));
      return true;
    }
    case 'chooseOne': {
      const chooser = step.chooser === 'self' ? frame.controller : opponentOf(state, frame.controller);
      if (!frame.choice) {
        askOption(state, frame, chooser, pr('chooseAnEffect', `${srcName}: escolha um efeito.`, { source: srcName }), step.labels);
        return false;
      }
      const picked = step.options[Number(frame.choice[0])] ?? [];
      log(state, chooser, lg('chosen', `Escolhido: ${step.labels[Number(frame.choice[0])] ?? '-'}`, { label: step.labels[Number(frame.choice[0])] ?? '-' }));
      frame.i++;
      frame.choice = undefined;
      frame.memo = undefined;
      pushEffect(state, frame.source, frame.controller, picked);
      // "K.O. or rest it": as opções agem sobre a carta escolhida antes.
      const top = state.stack[state.stack.length - 1];
      if (top !== frame && top.kind === 'effect' && frame.last) top.last = [...frame.last];
      return false;
    }
  }
}
