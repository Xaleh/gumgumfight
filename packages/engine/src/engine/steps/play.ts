// Passos de efeito que põem cartas em jogo ou usam outro efeito: jogar da mão, do deck, do trash ou das reveladas,
// ativar Eventos e [Trigger], repetir o efeito principal, efeitos adiados, turno extra e vitória.

import type { EffectStep, GameState, PlayerState } from '../../types';
import type { EffectFrame } from '../constants';
import { lg, log, pr, promptOf } from '../messages';
import { opponentOf, opponentSides } from '../table';
import { cardDef, matchesFilter } from '../queries';
import { handDef, playBlocked, totalDonOnField } from '../options';
import { pushEffect } from '../stack';
import { emit } from '../triggers';
import { askCards, askOption, playFree, useOwnEffect } from '../effects';
import { askPay } from '../costs';
import { removeFrom, zoneOf } from '../zones';
import { gameOver } from '../defeat';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type PlayStep = Extract<EffectStep, {
  do:
    | 'playThis' | 'playRevealed' | 'handPlayOrLife' | 'winGame' | 'extraTurn' | 'opponentPlays' | 'activateEventFromTrash'
    | 'activateEventFromHand' | 'activateTriggerFromHand' | 'delayed' | 'useOwnEffect' | 'useMainEffect' | 'useCounterEffect'
    | 'playFrom';
}>;

export function execPlayStep(state: GameState, frame: EffectFrame, step: PlayStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'playThis': {
      if (zoneOf(state, frame.source) === 'character' || zoneOf(state, frame.source) === 'stage') return true;
      playFree(state, frame.source, step.rested, frame.source);
      return true;
    }
    case 'playRevealed': {
      const card = frame.last?.[0];
      if (card && (ps.deck.includes(card) || ps.life.includes(card)) && (!step.filter || matchesFilter(cardDef(state, card), step.filter))) {
        const def = cardDef(state, card);
        if (step.upTo && (def.category === 'character' || def.category === 'stage')) {
          if (!frame.choice) {
            askPay(state, frame.controller, frame.source, {}, pr(step.rested ? 'playCardRested' : 'playCard', `${srcName}: jogar ${def.name}${step.rested ? ' virado' : ''}?`, { source: srcName, card: def.name }));
            return false;
          }
          if (!frame.choice.length) return true;
        }
        if (ps.lifeFaceUp?.includes(card)) removeFrom(ps.lifeFaceUp, card);
        if (def.category === 'character' || def.category === 'stage') playFree(state, card, step.rested, frame.source);
      }
      return true;
    }
    case 'handPlayOrLife': {
      if (!frame.memo) {
        const fromTrash = step.from === 'trash';
        const options = (fromTrash ? ps.trash : ps.hand).filter((u) => matchesFilter(fromTrash ? cardDef(state, u) : handDef(state, u, step.filter), step.filter));
        // Do descarte (público) pula sem opção; da mão abre sempre.
        if (!options.length && (fromTrash || !ps.hand.length || frame.choice)) return true;
        if (!frame.choice) {
          askCards(state, frame, options, 1, pr(fromTrash ? 'chooseCardFromTrash' : 'chooseCardFromHand', `${srcName}: escolha uma carta ${fromTrash ? 'do descarte' : 'da mão'}.`, { source: srcName }), fromTrash ? {} : { hidden: 'da mão' });
          return false;
        }
        const uid = frame.choice.find((u) => options.includes(u));
        if (!uid) return true;
        frame.memo = [uid];
        frame.choice = undefined;
      }
      const uid = frame.memo[0];
      const def = cardDef(state, uid);
      const canPlay = (def.category === 'character' || def.category === 'stage') && !playBlocked(state, frame.controller, def);
      if (!frame.choice) {
        askOption(
          state,
          frame,
          frame.controller,
          pr('playOrLife', `${srcName}: o que fazer com ${def.name}?`, { source: srcName, card: def.name }),
          [...(canPlay ? ['Jogar'] : []), 'Colocar no topo da Vida (virada para cima)'],
          [...(canPlay ? ['engine.optPlay'] : []), 'engine.optLifeTopFaceUp'],
        );
        frame.memo = [uid, canPlay ? 'play' : 'life'];
        return false;
      }
      const pickPlay = frame.memo[1] === 'play' && frame.choice[0] === '0';
      if (pickPlay) playFree(state, uid, false, frame.source);
      else {
        removeFrom(ps.hand, uid);
        removeFrom(ps.trash, uid);
        ps.life.push(uid);
        (ps.lifeFaceUp ??= []).push(uid);
        log(state, frame.controller, lg('toLifeTopFaceUp', `${def.name} vai para o topo da Vida, virada para cima.`, { card: def.name }), { cards: [uid] });
      }
      return true;
    }
    case 'winGame':
      gameOver(state, frame.controller, lg('winByEffect', `${ps.name} vence pelo efeito de ${srcName}.`, { player: ps.name, source: srcName }));
      return true;
    case 'extraTurn':
      state.extraTurn = frame.controller;
      log(state, frame.controller, lg('extraTurn', `${ps.name} jogará um turno extra.`, { player: ps.name }));
      return true;
    case 'opponentPlays': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const options = opp.hand.filter((u) => {
        const def = cardDef(state, u);
        return def.category === 'character' && matchesFilter(def, step.filter) && !def.abilities.some((a) => a.noPlayByEffect);
      });
      if (!options.length) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options,
          min: 0,
          max: Math.min(step.upTo, options.length),
          ...promptOf(pr('opponentMayPlay', `${srcName}: você pode jogar até ${step.upTo} Personagem(ns) da sua mão.`, { source: srcName, n: step.upTo })),
          intent: 'help',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u)).reverse()) playFree(state, uid, false, frame.source);
      return true;
    }
    case 'activateEventFromTrash':
    case 'activateEventFromHand': {
      const fromTrash = step.do === 'activateEventFromTrash';
      const options = (fromTrash ? ps.trash : ps.hand).filter((u) => {
        const def = cardDef(state, u);
        return def.category === 'event' && matchesFilter(def, step.filter) && def.abilities.some((a) => a.timing === 'main');
      });
      if (!options.length && (fromTrash || !ps.hand.length || frame.choice)) return true;
      if (!frame.choice) {
        askCards(state, frame, options, 1, pr(fromTrash ? 'chooseEventFromTrash' : 'chooseEventFromHand', `${srcName}: escolha um Evento ${fromTrash ? 'do descarte' : 'da mão'} para ativar.`, { source: srcName }), fromTrash ? {} : { hidden: 'da mão' });
        return false;
      }
      const uid = frame.choice.find((u) => options.includes(u));
      frame.i++;
      frame.choice = undefined;
      frame.memo = undefined;
      if (!uid) return false;
      const def = cardDef(state, uid);
      if (!fromTrash) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
      }
      log(
        state,
        frame.controller,
        lg(fromTrash ? 'activatesFromTrash' : 'activatesFromHand', `${ps.name} ativa ${def.name} ${fromTrash ? 'do descarte' : 'da mão'}.`, { player: ps.name, card: def.name }),
        { cards: [uid] },
      );
      pushEffect(state, uid, frame.controller, def.abilities.find((a) => a.timing === 'main')!.steps);
      emit(state, { kind: 'eventActivated', player: frame.controller, card: uid });
      (state.eventsThisTurn ??= []).push({ player: frame.controller, cost: def.cost ?? 0 });
      return false; // o índice já avançou
    }
    case 'activateTriggerFromHand': {
      // OP18-105 Spandam: a carta revelada continua na mão; o [Trigger] dela resolve como efeito dela
      // ("Play this card" a joga da mão).
      const options = ps.hand.filter((u) => {
        const def = cardDef(state, u);
        return matchesFilter(def, step.filter) && def.abilities.some((a) => a.timing === 'trigger');
      });
      if (!options.length && (!ps.hand.length || frame.choice)) return true;
      if (!frame.choice) {
        askCards(state, frame, options, 1, pr('chooseHandCardsToReveal', `${srcName}: escolha 1 carta(s) da mão para revelar.`, { source: srcName, n: 1 }), { hidden: 'da mão' });
        return false;
      }
      const uid = frame.choice.find((u) => options.includes(u));
      frame.i++;
      frame.choice = undefined;
      frame.memo = undefined;
      if (!uid) return false;
      const def = cardDef(state, uid);
      log(state, frame.controller, lg('reveals', `${ps.name} revela ${def.name}.`, { player: ps.name, cards: def.name }), { uids: [uid], by: ps.id });
      log(state, frame.controller, lg('triggerActivated', `[Trigger] ${def.name} ativado!`, { card: def.name }), { cards: [uid] });
      pushEffect(state, uid, frame.controller, def.abilities.find((a) => a.timing === 'trigger')!.steps);
      emit(state, { kind: 'triggerActivated', player: frame.controller, card: uid });
      return false; // o índice já avançou
    }
    case 'delayed': {
      const entry = { controller: frame.controller, source: frame.source, steps: step.steps, ...(step.keepChosen && frame.last ? { last: [...frame.last] } : {}) };
      if (step.when === 'battle' && state.battle) (state.battle.after ??= []).push(entry);
      else if (step.when !== 'battle') (state.delayed ??= []).push(entry);
      return true;
    }
    case 'useOwnEffect':
      return useOwnEffect(state, frame, step.timing);
    case 'useMainEffect':
      return useOwnEffect(state, frame, 'main');
    case 'useCounterEffect':
      return useOwnEffect(state, frame, 'counter');
    case 'playFrom': {
      const zone =
        step.from === 'deck'
          ? ps.deck
          : step.from === 'hand'
            ? ps.hand
            : step.from === 'trash'
              ? ps.trash
              : step.from === 'deckOrTrash'
                ? [...ps.deck, ...ps.trash]
                : [...ps.hand, ...ps.trash];
      const donCap = step.filter.maxCostDon ? totalDonOnField(ps) : step.filter.maxCostOppDon ? Math.max(...opponentSides(state, frame.controller).map((o) => totalDonOnField(state.players[o]))) : undefined;
      const filter = donCap !== undefined ? { ...step.filter, maxCost: Math.min(step.filter.maxCost ?? 99, donCap) } : step.filter;
      const lastColors = step.notColorOfLast && frame.last?.[0] ? cardDef(state, frame.last[0]).colors : [];
      const sameName = step.filter.sameNameAsChosen ? (frame.trashed ?? []).map((u) => cardDef(state, u).name) : null;
      const options = zone.filter((u) => {
        const def = cardDef(state, u);
        return (
          (!sameName || sameName.includes(def.name)) &&
          (def.category === 'character' || def.category === 'stage') &&
          !def.abilities.some((a) => a.noPlayByEffect) &&
          // Da mão, vale o custo que a carta tem na mão ("give this card in your hand −3 cost", Q&A OP11-023).
          matchesFilter(ps.hand.includes(u) ? handDef(state, u, filter) : def, filter) &&
          !playBlocked(state, frame.controller, def) &&
          !def.colors.some((c) => lastColors.includes(c))
        );
      });
      if (!frame.choice) {
        const where =
          step.from === 'deck'
            ? 'do deck'
            : step.from === 'hand'
              ? 'da mão'
              : step.from === 'trash'
                ? 'do descarte'
                : step.from === 'deckOrTrash'
                  ? 'do deck ou do descarte'
                  : 'da mão ou do descarte';
        // Do descarte (público) pula sem opção; da mão ou do deck abre sempre (a zona vazia é pública).
        const hidden = step.from !== 'trash' && (step.from === 'deck' || step.from === 'deckOrTrash' ? ps.deck : ps.hand).length > 0;
        if (!options.length && !hidden) return !!(frame.last = []);
        askCards(state, frame, options, step.upTo, pr(
          step.from === 'deck'
            ? 'choosePlayFromDeck'
            : step.from === 'hand'
              ? 'choosePlayFromHand'
              : step.from === 'trash'
                ? 'choosePlayFromTrash'
                : step.from === 'deckOrTrash'
                  ? 'choosePlayFromDeckOrTrash'
                  : 'choosePlayFromHandOrTrash',
          `${srcName}: escolha até ${step.upTo} carta(s) ${where} para jogar.`,
          { source: srcName, n: step.upTo },
        ), {
          ...(hidden ? { hidden: where } : {}),
          ...(step.required ? { min: 1 } : {}),
        });
        return false;
      }
      // Empilhadas ao contrário para entrarem na ordem escolhida.
      let chosen = frame.choice.filter((u) => options.includes(u));
      if (step.filter.distinctNames) chosen = chosen.filter((u, k) => !chosen.slice(0, k).some((v) => cardDef(state, v).name === cardDef(state, u).name));
      if (step.filter.totalMaxCost !== undefined) {
        let total = 0;
        chosen = chosen.filter((u) => (total + (cardDef(state, u).cost ?? 0) <= step.filter.totalMaxCost! ? ((total += cardDef(state, u).cost ?? 0), true) : false));
      }
      frame.last = [...chosen];
      for (const uid of chosen.reverse()) playFree(state, uid, step.rested, frame.source);
      return true;
    }
  }
}
