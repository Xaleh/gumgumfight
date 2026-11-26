// Passos de efeito sobre as cartas em campo: K.O., virar e desvirar, devolver à mão ou ao deck, trashar, e os
// efeitos de substituição ("instead").

import type { Ability, EffectStep, GameState, PlayerState } from '../../types';
import type { DamageFrame, EffectFrame } from '../constants';
import { lg, log, pr, promptOf } from '../messages';
import { opponentOf } from '../table';
import { cardDef, locate, ownerOf } from '../queries';
import { targetCandidates, usedKey } from '../options';
import { emit } from '../triggers';
import { addModifier, askCards, askOption, resolveTargets } from '../effects';
import { askPay, costAsksOwner, costPartsOf, describeCost, koCostOptions, ownCostOptions, payImmediateCost, restOwnOptions } from '../costs';
import { continueRemoval, koCharacter, koStage, removalBlocked, removalCtx, removeFromField } from '../removal';
import { cannotBeRested, detach, inLimbo, restCard } from '../zones';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type FieldStep = Extract<EffectStep, {
  do:
    | 'ko' | 'rest' | 'setActive' | 'returnToHand' | 'restOwn' | 'returnOwn' | 'koOwn' | 'trashOwn' | 'selfToDeckBottom' | 'trashTarget'
    | 'trashSelf' | 'returnSelfToHand' | 'ownToBottom' | 'replaceRest' | 'tempReplace' | 'opponentChoosesOwn' | 'koSelf'
    | 'replaceRemoval' | 'removeFromField' | 'replaceDamage' | 'restOwnCharacters' | 'addThisToHand' | 'toDeckBottom';
}>;

export function execFieldStep(state: GameState, frame: EffectFrame, step: FieldStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'ko': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseKoTarget', `${srcName}: escolha um personagem para K.O.`, { source: srcName }));
      if (!t) return false;
      frame.koTargets = t.filter((u) => locate(state, u));
      // Os Personagens saem juntos: cada substituição é oferecida uma vez para todos (8-1-3-4).
      removeFromField(state, t.filter((u) => locate(state, u)?.zone === 'character'), 'ko', { byPlayer: frame.controller, by: frame.source });
      // "K.O. … Stage": só o efeito que diz Stage alcança um (Q&A OP13-098).
      for (const uid of t) if (locate(state, uid)?.zone === 'stage') koStage(state, uid, { byPlayer: frame.controller, by: frame.source });
      return true;
    }
    case 'rest': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseRestTarget', `${srcName}: escolha uma carta para virar.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc) {
          const before = loc.fc.rested;
          restCard(state, uid, frame.controller, frame.source);
          // "cannot be rested" (ou a substituição de rest) deixa a carta como estava: o histórico já explicou.
          if (loc.fc.rested && !before) log(state, frame.controller, lg('isRested', `${cardDef(state, uid).name} é virado.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        }
      }
      return true;
    }
    case 'setActive': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseActiveTarget', `${srcName}: escolha uma carta para desvirar.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc) {
          loc.fc.rested = false;
          log(state, frame.controller, lg('becomesActive', `${cardDef(state, uid).name} fica ativo.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        }
      }
      return true;
    }
    case 'returnToHand': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseReturnToHandTarget', `${srcName}: escolha um personagem para devolver à mão.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc?.zone === 'stage') {
          detach(state, uid);
          state.players[loc.player].hand.push(uid);
          log(state, frame.controller, lg('returnsToHand', `${cardDef(state, uid).name} volta para a mão.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        }
      }
      removeFromField(state, t.filter((u) => locate(state, u)?.zone === 'character'), 'hand', { byPlayer: frame.controller, by: frame.source });
      return true;
    }
    case 'restOwn':
    case 'returnOwn': {
      const rest = step.do === 'restOwn';
      const options = rest ? restOwnOptions(state, frame.controller, frame.source, step) : ownCostOptions(state, frame.controller, frame.source, step.spec, false);
      let count = step.count;
      // "rest N of your cards": primeiro quantos DON!! ativos virar (só pergunta quando há escolha), depois as cartas.
      if (rest && step.withDon && !frame.memo) {
        const min = Math.max(0, count - options.length);
        const max = Math.min(count, ps.donActive);
        let k = min;
        if (max > min) {
          if (!frame.choice) {
            askOption(
              state,
              frame,
              frame.controller,
              pr('howManyActiveDonToRest', `${srcName}: quantos DON!! ativos virar (de ${count} carta(s))?`, { source: srcName, n: count }),
              Array.from({ length: max - min + 1 }, (_, i) => `${max - i} DON!!`),
            );
            return false;
          }
          k = max - Number(frame.choice[0]);
          frame.choice = undefined;
        }
        if (k > 0) {
          ps.donActive -= k;
          ps.donRested += k;
          log(state, frame.controller, lg('restsDon', `${ps.name} vira ${k} DON!!.`, { player: ps.name, n: k }));
        }
        frame.memo = [String(count - k)];
      }
      if (rest && step.withDon) count = Number(frame.memo![0]);
      const n = Math.min(count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr(rest ? 'chooseOwnCardsToRest' : 'chooseOwnCardsToReturn', `${srcName}: escolha ${n} carta(s) sua(s) para ${rest ? 'virar' : 'devolver à mão'}.`, { source: srcName, n }), {
          min: n,
        });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        if (rest) restCard(state, uid);
        else {
          detach(state, uid);
          state.players[ownerOf(state, uid)].hand.push(uid);
          log(state, frame.controller, lg('returnsToHand', `${cardDef(state, uid).name} volta para a mão.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        }
      }
      return true;
    }
    case 'koOwn':
    case 'trashOwn': {
      const options =
        step.do === 'koOwn' ? koCostOptions(state, frame.controller, frame.source, step.spec) : ownCostOptions(state, frame.controller, frame.source, step.spec, false);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(
          state,
          frame,
          options,
          n,
          pr(step.do === 'koOwn' ? 'chooseOwnCharactersToKo' : 'chooseOwnCharactersToTrash', `${srcName}: escolha ${n} Personagem(ns) seu(s) para ${step.do === 'koOwn' ? 'nocautear' : 'descartar'}.`, {
            source: srcName,
            n,
          }),
          { min: n, intent: 'discard' },
        );
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        // "You may K.O. 1 of your Stages" (OP18-066): o Stage vai pelo K.O. de Stage.
        if (step.do === 'koOwn' && locate(state, uid)?.zone === 'stage') koStage(state, uid, { byPlayer: frame.controller, by: frame.source });
        else if (step.do === 'koOwn') koCharacter(state, uid, { force: true });
        else {
          detach(state, uid);
          state.players[ownerOf(state, uid)].trash.push(uid);
        }
      }
      return true;
    }
    case 'selfToDeckBottom': {
      if (!locate(state, frame.source)) return true;
      const owner = state.players[ownerOf(state, frame.source)];
      detach(state, frame.source);
      owner.deck.push(frame.source);
      log(state, frame.controller, lg('toDeckBottom', `${srcName} vai para o fundo do deck.`, { card: srcName }), { cards: [frame.source] });
      return true;
    }
    case 'trashTarget': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCharacterToTrash', `${srcName}: escolha um Personagem para o descarte.`, { source: srcName }));
      if (!t) return false;
      removeFromField(state, t.filter((u) => locate(state, u)?.zone === 'character'), 'trash', { byPlayer: frame.controller, by: frame.source });
      return true;
    }
    case 'trashSelf':
    case 'returnSelfToHand': {
      if (locate(state, frame.source)?.zone !== 'character' && locate(state, frame.source)?.zone !== 'stage') return true;
      const owner = state.players[ownerOf(state, frame.source)];
      detach(state, frame.source);
      if (step.do === 'trashSelf') owner.trash.push(frame.source);
      else owner.hand.push(frame.source);
      log(
        state,
        frame.controller,
        step.do === 'trashSelf' ? lg('goesToTrash', `${srcName} vai para o descarte.`, { card: srcName }) : lg('goesToHand', `${srcName} vai para a mão.`, { card: srcName }),
        { cards: [frame.source] },
      );
      return true;
    }
    case 'ownToBottom': {
      const options = targetCandidates(state, frame.controller, frame.source, { ...step.spec, side: step.spec.side === 'any' && !step.toLife ? 'any' : 'own' });
      if (!options.length) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options,
          min: Math.min(step.count, options.length),
          max: Math.min(step.count, options.length),
          ...promptOf(pr('chooseOwnToBottomCost', `${srcName}: escolha o que vai para o fundo do deck (custo).`, { source: srcName })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        const owner = state.players[ownerOf(state, uid)];
        // Personagem do oponente: remoção por efeito (proteções e substituições valem).
        if (owner.id !== frame.controller && locate(state, uid)?.zone === 'character') {
          removeFromField(state, [uid], 'deckBottom', { byPlayer: frame.controller, by: frame.source });
          continue;
        }
        detach(state, uid);
        if (step.toLife) {
          owner.life.push(uid);
          (owner.lifeFaceUp ??= []).push(uid);
          log(state, frame.controller, lg('toLifeTopFaceUp', `${cardDef(state, uid).name} vai para o topo da Vida, virada para cima.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        } else {
          owner.deck.push(uid);
          log(state, frame.controller, lg('toDeckBottom', `${cardDef(state, uid).name} vai para o fundo do deck.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        }
      }
      return true;
    }
    case 'replaceRest': {
      const ability = cardDef(state, frame.source).abilities[step.ability];
      if (!locate(state, step.victim) || !ability) return true;
      if (!frame.choice) {
        askPay(state, frame.controller, frame.source, ability.cost, ability.cost
            ? pr('replaceRestPay', `${srcName} vai ser virado. Pagar ${describeCost(ability.cost)} para evitar?`, { source: srcName, cost: describeCost(ability.cost) }, costPartsOf(ability.cost))
            : pr('replaceRestEffect', `${srcName} vai ser virado. Pagar o efeito para evitar?`, { source: srcName }));
        return false;
      }
      if (!frame.choice.length) {
        const loc = locate(state, step.victim);
        if (loc) loc.fc.rested = true;
        emit(state, { kind: 'selfRested', player: frame.controller, card: step.victim, byPlayer: step.byPlayer });
        if (loc?.zone === 'character') emit(state, { kind: 'restedByEffect', player: frame.controller, card: step.victim, byPlayer: step.byPlayer });
        return true;
      }
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(frame.source, step.ability));
      frame.steps.splice(frame.i + 1, 0, ...(ability.cost ? payImmediateCost(state, frame.controller, frame.source, ability.cost) : []));
      return true;
    }
    case 'tempReplace':
      (state.tempReplacements ??= []).push({ player: frame.controller, source: frame.source, by: step.by, cost: step.cost });
      return true;
    case 'opponentChoosesOwn': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const options = targetCandidates(state, opp.id, frame.source, { ...step.spec, side: 'own' }).filter(
        (u) => locate(state, u)?.zone === 'character' && !removalBlocked(state, u, frame.controller),
      );
      const n = Math.min(step.count, options.length);
      if (!n) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options,
          min: n,
          max: n,
          ...promptOf(
            pr(
              step.action === 'hand' ? 'opponentReturnsOwnToHand' : 'opponentReturnsOwnToBottom',
              `${srcName}: escolha ${n} Personagem(ns) seu(s) para ${step.action === 'hand' ? 'devolver à mão' : 'colocar no fundo do deck'}.`,
              { source: srcName, n },
            ),
          ),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      // Quem escolhe é o dono, mas a remoção é do efeito de quem controla: as substituições valem.
      const chosen = frame.choice.filter((u) => options.includes(u)).slice(0, n);
      removeFromField(state, chosen, step.action === 'hand' ? 'hand' : 'deckBottom', { byPlayer: frame.controller, by: frame.source });
      return true;
    }
    case 'koSelf':
      // canPayCost já recusou o custo se esta carta não pode ser nocauteada (1-3-3).
      if (locate(state, frame.source)?.zone === 'character') koCharacter(state, frame.source, { force: true });
      return true;
    case 'replaceRemoval': {
      const ability: Ability | undefined = step.inlineCost ? { timing: 'replace', steps: [], cost: step.inlineCost } : cardDef(state, frame.source).abilities[step.ability];
      const owner = state.players[frame.controller];
      const ctx = removalCtx(step);
      const onField = (u: string) => locate(state, u)?.zone === 'character';
      const victims = step.victims.filter(onField);
      const covered = step.covered.filter(onField);
      // Esta substituição não volta a ser oferecida para estas remoções (recusada ou aplicada).
      const skip = [...(step.skip ?? []), step.key];
      // Recusar (ou não poder pagar) não gasta o [Once Per Turn] e passa para a próxima substituição (8-1-3-4-2).
      const decline = () => {
        continueRemoval(state, victims, step.action, ctx, skip);
        return true;
      };
      if (!covered.length || !ability) return decline();
      const names = covered.map((u) => cardDef(state, u).name).join(', ');
      if (!frame.choice) {
        if (ability.cost && !costAsksOwner(state, owner.id, frame.source, ability.cost)) return decline();
        askPay(
          state,
          owner.id,
          frame.source,
          ability.cost,
          pr(
            ability.cost ? 'replaceRemovalPay' : 'replaceRemovalEffect',
            `${srcName}: ${names} ${covered.length > 1 ? 'vão' : 'vai'} sair do campo. Pagar ${ability.cost ? describeCost(ability.cost) : 'o efeito'} para evitar?`,
            { source: srcName, cards: names, n: covered.length, ...(ability.cost ? { cost: describeCost(ability.cost) } : {}) },
            ability.cost ? costPartsOf(ability.cost) : undefined,
          ),
        );
        return false;
      }
      if (!frame.choice.length) return decline();
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(frame.source, step.ability));
      // Os que esta substituição não cobre continuam saindo (ou recebem a próxima substituição).
      const rest = victims.filter((u) => !covered.includes(u));
      const next: EffectStep[] = rest.length ? [{ do: 'removeFromField', victims: rest, action: step.action, ...ctx, skip }] : [];
      // "you may add it to the top of your Life cards face-down instead"
      if (ability.cost?.victimToLife) {
        for (const uid of covered) {
          detach(state, uid);
          owner.life.push(uid);
          log(state, owner.id, lg('toLifeInstead', `${cardDef(state, uid).name} vai para o topo da Vida em vez de sair do campo.`, { card: cardDef(state, uid).name }), { cards: [uid] });
        }
        frame.steps.splice(frame.i + 1, 0, ...next);
        return true;
      }
      log(
        state,
        owner.id,
        lg('staysOnField', `${srcName}: ${names} ${covered.length > 1 ? 'ficam' : 'fica'} em campo (efeito de substituição).`, {
          source: srcName,
          cards: names,
          n: covered.length,
        }),
        { cards: [frame.source, ...covered] },
      );
      const costSteps = ability.cost ? payImmediateCost(state, owner.id, frame.source, ability.cost) : [];
      if (ability.cost?.victimPowerMinus) {
        for (const uid of covered) addModifier(state, owner.id, { uid, kind: 'power', amount: -ability.cost.victimPowerMinus, duration: 'turn' });
      }
      frame.steps.splice(frame.i + 1, 0, ...costSteps, ...next, ...ability.steps);
      return true;
    }
    case 'removeFromField':
      continueRemoval(state, step.victims.filter((u) => locate(state, u)?.zone === 'character'), step.action, removalCtx(step), step.skip ?? []);
      return true;
    case 'replaceDamage': {
      const ability = cardDef(state, frame.source).abilities[step.ability];
      const owner = state.players[frame.controller];
      // O dano em resolução (logo abaixo deste efeito na pilha).
      const damage = [...state.stack].reverse().find((f): f is DamageFrame => f.kind === 'damage' && f.defender === owner.id);
      if (!locate(state, frame.source) || !ability || !damage || (ability.cost && !costAsksOwner(state, owner.id, frame.source, ability.cost))) return true;
      if (!frame.choice) {
        askPay(
          state,
          owner.id,
          frame.source,
          ability.cost,
          pr(
            ability.cost ? 'replaceDamagePay' : 'replaceDamageEffect',
            `${srcName}: você vai sofrer ${damage.remaining} de dano. Pagar ${ability.cost ? describeCost(ability.cost) : 'o efeito'} para evitar?`,
            { source: srcName, n: damage.remaining, ...(ability.cost ? { cost: describeCost(ability.cost) } : {}) },
            ability.cost ? costPartsOf(ability.cost) : undefined,
          ),
        );
        return false;
      }
      if (!frame.choice.length) return true;
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(frame.source, step.ability));
      log(state, owner.id, lg('damagePrevented', `${srcName}: ${owner.name} não sofre o dano (efeito de substituição).`, { source: srcName, player: owner.name }), { cards: [frame.source] });
      damage.remaining = 0;
      const costSteps = ability.cost ? payImmediateCost(state, owner.id, frame.source, ability.cost) : [];
      frame.steps.splice(frame.i + 1, 0, ...costSteps, ...ability.steps);
      return true;
    }
    case 'restOwnCharacters': {
      const options = ps.characters
        .filter((c) => !c.rested && c.uid !== frame.source && !cannotBeRested(state, c.uid))
        .map((c) => c.uid);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseOwnCharactersToRest', `${srcName}: escolha ${n} Personagem(ns) seu(s) para virar.`, { source: srcName, n }), { min: n });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) restCard(state, uid);
      return true;
    }
    case 'addThisToHand': {
      const owner = state.players[ownerOf(state, frame.source)];
      // Do descarte ([On K.O.]) ou, no [Trigger], de fora das áreas ("… and add this card to your hand").
      if (owner.trash.includes(frame.source) || inLimbo(state, frame.source)) {
        detach(state, frame.source);
        owner.hand.push(frame.source);
        log(state, frame.controller, lg('goesToHand', `${srcName} vai para a mão.`, { card: srcName }), { cards: [frame.source] });
      }
      return true;
    }
    case 'toDeckBottom': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCharacterToBottom', `${srcName}: escolha um personagem para o fundo do deck.`, { source: srcName }));
      if (!t) return false;
      removeFromField(state, t.filter((u) => locate(state, u)?.zone === 'character'), 'deckBottom', { byPlayer: frame.controller, by: frame.source });
      return true;
    }
  }
}
