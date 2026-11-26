// Passos de efeito que mudam poder, custo, palavras-chave e o que uma carta pode ou não fazer (atacar, bloquear,
// ser nocauteada, desvirar): quase todos só criam um modificador ou uma restrição com duração.

import type { EffectStep, GameState, PlayerId, PlayerState, Restriction } from '../../types';
import type { EffectFrame } from '../constants';
import { lg, log, pr, promptOf } from '../messages';
import { fixedOpponent, isMultiplayer, opponentOf, opponentSides } from '../table';
import { basePowerOf, cardDef, getPower, locate, matchesFilter, ownerOf } from '../queries';
import { targetCandidates } from '../options';
import { setExpiry } from '../turn';
import { addModifier, askCards, askOption, donTargetOpponent, resolveTargets } from '../effects';
import { koCharacter, koProtected } from '../removal';
import { detach, removeFrom } from '../zones';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type PowerStep = Extract<EffectStep, {
  do:
    | 'power' | 'noBlockerThisBattle' | 'noBlockerWhenAttacking' | 'gainKeyword' | 'cannotBeKO' | 'cost' | 'skipRefresh'
    | 'anyNumberForPower' | 'skipRefreshDon' | 'powerPerDon' | 'powerPerMatching' | 'powerPerRevealedCost' | 'gainAttribute'
    | 'attackTax' | 'negateOnPlay' | 'cannotAttackCharacters' | 'restDonForPower' | 'swapBasePower' | 'cannotBlock' | 'negate'
    | 'restrict' | 'nextPlayDiscount' | 'basePower' | 'setPowerZero' | 'trashAnyForPower' | 'redirectAttack' | 'cannotBeRested'
    | 'canAttackActive' | 'cannotAttack';
}>;

export function execPowerStep(state: GameState, frame: EffectFrame, step: PowerStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'power': {
      const t = resolveTargets(
        state,
        frame,
        step.target,
        step.amount < 0 ? 'harm' : 'help',
        pr('choosePowerTarget', `${srcName}: escolha quem recebe ${step.amount > 0 ? '+' : ''}${step.amount} de poder.`, {
          source: srcName,
          amount: `${step.amount > 0 ? '+' : ''}${step.amount}`,
        }),
      );
      if (!t) return false;
      const duration = step.duration === 'battle' && !state.battle ? 'turn' : step.duration;
      // "For every {X} type card on your field, give …"
      const mult = step.per ? targetCandidates(state, frame.controller, frame.source, step.per).length : 1;
      for (const uid of t) {
        if (!mult) break;
        addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * mult, duration });
        const amount = `${step.amount > 0 ? '+' : ''}${step.amount}`;
        log(state, frame.controller, lg('getsPower', `${cardDef(state, uid).name} recebe ${amount} de poder.`, { card: cardDef(state, uid).name, amount }), { cards: [uid] });
      }
      return true;
    }
    case 'noBlockerThisBattle':
      if (state.battle) {
        if (step.minPower !== undefined) state.battle.noBlockerMinPower = step.minPower;
        else if (step.maxPower !== undefined) state.battle.noBlockerMaxPower = step.maxPower;
        else if (step.maxCost !== undefined) state.battle.noBlockerMaxCost = step.maxCost;
        else state.battle.noBlocker = true;
        log(
          state,
          frame.controller,
          step.minPower !== undefined
            ? lg('noBlockerMinPower', `O oponente não pode usar [Blocker] com ${step.minPower}+ de poder nesta batalha.`, { power: step.minPower })
            : lg('noBlocker', 'O oponente não pode usar [Blocker] nesta batalha.'),
        );
      }
      return true;
    case 'noBlockerWhenAttacking': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseUnblockableTarget', `${srcName}: escolha quem ataca sem poder ser bloqueado.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) state.modifiers.push({ uid, kind: 'noBlockerWhenAttacking', amount: 0, duration: 'turn' });
      return true;
    }
    case 'gainKeyword': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseKeywordTarget', `${srcName}: escolha quem ganha [${step.keyword}].`, { source: srcName, keyword: step.keyword }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'keyword', keyword: step.keyword, amount: 0, duration: step.duration });
      return true;
    }
    case 'cannotBeKO': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseCannotBeKoTarget', `${srcName}: escolha quem não pode ser nocauteado.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t.filter((u) => locate(state, u)?.zone === 'character')) {
        const kind = step.inBattle
          ? 'cannotBeKOInBattle'
          : step.byEffect === 'opponent'
            ? 'cannotBeKOByOpponentEffect'
            : step.byEffect
              ? 'cannotBeKOByEffect'
              : 'cannotBeKO';
        const how = step.inBattle ? ' em batalha' : step.byEffect === 'opponent' ? ' por efeitos do oponente' : step.byEffect ? ' por efeitos' : '';
        const key = step.inBattle ? 'cannotBeKodInBattle' : step.byEffect === 'opponent' ? 'cannotBeKodByOpponent' : step.byEffect ? 'cannotBeKodByEffects' : 'cannotBeKod';
        addModifier(state, frame.controller, { uid, kind, amount: 0, duration: step.duration });
        log(state, frame.controller, lg(key, `${cardDef(state, uid).name} não pode ser nocauteado${how}.`, { card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'cost': {
      const t = resolveTargets(
        state,
        frame,
        step.target,
        step.amount < 0 ? 'harm' : 'help',
        pr('chooseCostTarget', `${srcName}: escolha quem recebe ${step.amount > 0 ? '+' : ''}${step.amount} de custo.`, {
          source: srcName,
          amount: `${step.amount > 0 ? '+' : ''}${step.amount}`,
        }),
      );
      if (!t) return false;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'cost', amount: step.amount, duration: step.duration });
        const amount = `${step.amount > 0 ? '+' : ''}${step.amount}`;
        log(state, frame.controller, lg('getsCost', `${cardDef(state, uid).name}: ${amount} de custo.`, { card: cardDef(state, uid).name, amount }), { cards: [uid] });
      }
      return true;
    }
    case 'skipRefresh': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseSkipRefreshTarget', `${srcName}: escolha quem não desvira no próximo turno.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) {
        // Carta própria: a sua próxima Renovação (no seu próximo turno).
        const own = ownerOf(state, uid) === frame.controller;
        addModifier(state, frame.controller, { uid, kind: 'skipRefresh', amount: 0, duration: own ? 'endOfYourNextTurn' : 'nextOpponentTurn' });
      }
      return true;
    }
    case 'anyNumberForPower': {
      if (!frame.memo) {
        const options =
          step.source === 'trash'
            ? ps.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter))
            : targetCandidates(state, frame.controller, frame.source, { ...step.spec!, side: 'own' }).filter(
                // "K.O. any number of your Characters": o protegido não seria nocauteado nem contaria.
                (u) => step.action !== 'ko' || !koProtected(state, u, false, frame.source, frame.controller),
              );
        if (!frame.choice) {
          if (!options.length) return true;
          askCards(state, frame, options, options.length, pr('chooseAnyNumber', `${srcName}: escolha quantas cartas quiser.`, { source: srcName }), { ordered: step.action === 'bottom' });
          return false;
        }
        const chosen = frame.choice.filter((u) => options.includes(u));
        for (const uid of chosen) {
          if (step.source === 'trash') {
            removeFrom(ps.trash, uid);
            ps.deck.push(uid);
          } else if (step.action === 'ko') koCharacter(state, uid, { force: true });
          else {
            detach(state, uid);
            if (step.action === 'hand') ps.hand.push(uid);
            else ps.deck.push(uid);
          }
        }
        const bonus = step.power * Math.floor(chosen.length / step.every);
        if (!bonus) return true;
        frame.memo = [String(bonus)];
        frame.choice = undefined;
      }
      const bonus = Number(frame.memo[0]);
      const t = resolveTargets(state, frame, step.target, 'help', pr('choosePowerTarget', `${srcName}: escolha quem recebe +${bonus} de poder.`, { source: srcName, amount: `+${bonus}` }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: bonus, duration: step.duration === 'battle' && !state.battle ? 'turn' : step.duration });
      return true;
    }
    case 'skipRefreshDon': {
      const opp = state.players[opponentOf(state, frame.controller)];
      if (step.atMainPhase) {
        (state.donRestAtMain ??= []).push({ player: opp.id, count: step.count });
        log(state, frame.controller, lg('oppWillRestDon', `${opp.name} vai virar ${step.count} DON!! ativo(s) no início da próxima Fase Principal.`, { player: opp.name, n: step.count }));
        return true;
      }
      let target = opp;
      if (isMultiplayer(state) && fixedOpponent(state, frame.controller) === undefined) {
        // "Up to 1 of your opponent's rested DON!! cards will not become active": um alvo, de qualquer oponente.
        const skipped = (id: PlayerId) => (state.donSkipRefresh ?? []).filter((d) => d.player === id).reduce((k, d) => k + d.count, 0);
        const id = donTargetOpponent(
          state,
          frame,
          opponentSides(state, frame.controller).filter((o) => state.players[o].donRested > skipped(o)),
          pr('whoseDonSkipsRefresh', `${srcName}: o DON!! virado de qual oponente não desvira?`, { source: srcName }),
        );
        if (id === undefined) return false;
        if (id === null) return true;
        target = state.players[id];
      }
      (state.donSkipRefresh ??= []).push({ player: target.id, count: step.count });
      log(state, frame.controller, lg('donSkipsRefresh', `${step.count} DON!! de ${target.name} não fica(m) ativo(s) na próxima Renovação.`, { n: step.count, player: target.name }));
      return true;
    }
    case 'powerPerDon': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseTheCard', `${srcName}: escolha a carta.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) {
        const don = locate(state, uid)?.fc.don ?? 0;
        if (don) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * don, duration: step.duration });
      }
      return true;
    }
    case 'powerPerMatching': {
      // O número é contado ao resolver e não muda depois (Personagens que entram ou saem não contam).
      const n = targetCandidates(state, frame.controller, frame.source, step.spec).length;
      if (!n) return true;
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseTheCard', `${srcName}: escolha a carta.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * n, duration: step.duration });
      return true;
    }
    case 'powerPerRevealedCost': {
      const card = (frame.last ?? [])[0];
      const n = card ? (cardDef(state, card).cost ?? 0) : 0;
      if (!n) return true;
      const t = resolveTargets(state, { ...frame, last: [] }, step.target, 'help', pr('chooseTheCard', `${srcName}: escolha a carta.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * n, duration: step.duration });
      return true;
    }
    case 'gainAttribute': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseAttributeTarget', `${srcName}: escolha quem ganha o atributo.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'attribute', attribute: step.attribute, amount: 0, duration: step.duration });
      return true;
    }
    case 'attackTax': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseTheCard', `${srcName}: escolha a carta.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'attackTax', amount: step.count, duration: step.duration });
      return true;
    }
    case 'negateOnPlay': {
      const who = step.who === 'self' ? frame.controller : opponentOf(state, frame.controller);
      const until: import('../../types').Expiry = { untilTurn: state.turn };
      if (step.duration === 'nextOpponentTurn') setExpiry(state, frame.controller, until, step.duration);
      (state.onPlayNegated ??= []).push({ player: who, untilTurn: until.untilTurn!, source: frame.source, ...(until.untilStartOf !== undefined ? { untilStartOf: until.untilStartOf } : {}), ...(until.untilEndOf !== undefined ? { untilEndOf: until.untilEndOf } : {}) });
      log(state, frame.controller, lg('playerOnPlayNegated', `Os efeitos [Ao Jogar] de ${state.players[who].name} estão anulados.`, { player: state.players[who].name }));
      return true;
    }
    case 'cannotAttackCharacters':
      if (locate(state, frame.source)) {
        addModifier(state, frame.controller, { uid: frame.source, kind: 'cannotAttackCharMaxCost', amount: step.maxBaseCost, duration: step.duration });
      }
      return true;
    case 'restDonForPower': {
      if (!frame.memo) {
        if (!ps.donActive) return true;
        if (!frame.choice) {
          askOption(state, frame, frame.controller, pr('howManyDonToRestForPower', `${srcName}: quantos DON!! virar (+${step.power} de poder cada)?`, { source: srcName, power: step.power }), Array.from({ length: ps.donActive + 1 }, (_, i) => String(i)));
          return false;
        }
        const n = Math.min(Number(frame.choice[0]), ps.donActive);
        if (!n) return true;
        ps.donActive -= n;
        ps.donRested += n;
        frame.memo = [String(n)];
        frame.choice = undefined;
      }
      const t = resolveTargets(state, frame, step.target, 'help', pr('choosePowerReceiver', `${srcName}: escolha quem recebe o poder.`, { source: srcName }));
      if (!t) return false;
      const n = Number(frame.memo[0]);
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.power * n, duration: 'battle' });
      log(state, frame.controller, lg('restsDonForPower', `${ps.name} vira ${n} DON!! (+${step.power * n} de poder).`, { player: ps.name, n, power: step.power * n }));
      return true;
    }
    case 'swapBasePower': {
      const options = targetCandidates(state, frame.controller, frame.source, step.spec);
      if (options.length < (step.withLeader ? 1 : 2)) return true;
      if (!frame.choice) {
        // "Select your Leader and 1 Character": o Líder já está escolhido.
        if (step.withLeader) askCards(state, frame, options, 1, pr('swapBasePowerWithLeader', `${srcName}: escolha 1 Personagem para trocar o poder base com o seu Líder.`, { source: srcName }), { min: 1 });
        else askCards(state, frame, options, 2, pr('swapBasePower', `${srcName}: escolha 2 cartas para trocar o poder base.`, { source: srcName }), { min: 2 });
        return false;
      }
      const picked = frame.choice.filter((u) => options.includes(u));
      const [a, b] = step.withLeader ? [ps.leader.uid, picked[0]] : picked;
      if (!a || !b) return true;
      const pa = basePowerOf(state, a);
      const pb = basePowerOf(state, b);
      addModifier(state, frame.controller, { uid: a, kind: 'basePower', amount: pb, duration: step.duration });
      addModifier(state, frame.controller, { uid: b, kind: 'basePower', amount: pa, duration: step.duration });
      log(state, frame.controller, lg('swapBasePower', `${cardDef(state, a).name} e ${cardDef(state, b).name} trocam o poder base.`, { card: cardDef(state, a).name, other: cardDef(state, b).name }), { cards: [a, b] });
      return true;
    }
    case 'cannotBlock': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCannotBlockTarget', `${srcName}: escolha quem não poderá bloquear.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'cannotBlock', amount: 0, duration: step.duration });
      return true;
    }
    case 'negate': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseNegateTarget', `${srcName}: escolha cujo efeito será anulado.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'negated', amount: 0, duration: step.duration });
        log(state, frame.controller, lg('effectNegated', `O efeito de ${cardDef(state, uid).name} é anulado.`, { card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'restrict': {
      // Quem fica restrito e até quando: "your opponent cannot …", "until the end of your opponent's next turn".
      const player = step.opponent ? opponentOf(state, frame.controller) : frame.controller;
      const r: Restriction = { player, kind: step.kind, ...(step.minCost !== undefined ? { minCost: step.minCost } : {}) };
      // Como em addModifier: no seu turno, acaba no fim do turno seguinte (do oponente); no do oponente, no fim do próximo dele.
      if (step.duration === 'nextOpponentTurn') setExpiry(state, frame.controller, r, step.duration);
      (state.restrictions ??= []).push(r);
      return true;
    }
    case 'nextPlayDiscount':
      (state.costReductions ??= []).push({ player: frame.controller, filter: step.filter, amount: step.amount });
      return true;
    case 'basePower': {
      // "Select … . This Character's base power becomes the same as the selected Character's power": guarda a escolha.
      if (step.copy === 'chosen' && !frame.memo) frame.memo = [...(frame.last ?? [])];
      const t = resolveTargets(state, frame, step.target, step.target === 'self' || step.target === 'ownLeader' ? 'help' : 'harm', pr('chooseTheCard', `${srcName}: escolha a carta.`, { source: srcName }));
      if (!t) return false;
      const copied =
        step.copy === 'opponentLeader'
          ? state.players[opponentOf(state, frame.controller)].leader.uid
          : step.copy === 'attacker'
            ? state.battle?.attacker
            : step.copy === 'chosen'
              ? (frame.memo ?? frame.last ?? []).find((u) => locate(state, u))
              : undefined;
      if (step.copy && !copied) return true;
      const amount = copied ? getPower(state, copied) : step.amount ?? 0;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'basePower', amount, duration: step.duration });
        log(state, frame.controller, lg('basePowerSet', `O poder base de ${cardDef(state, uid).name} passa a ser ${amount}.`, { card: cardDef(state, uid).name, n: amount }), { cards: [uid] });
      }
      return true;
    }
    case 'setPowerZero': {
      // «Set Power to 0» (4-12): reduz pelo poder atual no momento da ativação; já 0 ou negativo, nada muda.
      // É um −X comum: Counters e DON!! posteriores somam por cima, e some ao fim da duração (Q&A OP07-002 Ain).
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseZeroPowerTarget', `${srcName}: escolha cujo poder fica em 0.`, { source: srcName }));
      if (!t) return false;
      const duration = step.duration === 'battle' && !state.battle ? 'turn' : step.duration;
      for (const uid of t) {
        const current = getPower(state, uid);
        if (current > 0) addModifier(state, frame.controller, { uid, kind: 'power', amount: -current, duration });
        log(state, frame.controller, lg('powerSet', `O poder de ${cardDef(state, uid).name} fica em ${Math.min(current, 0)}.`, { card: cardDef(state, uid).name, n: Math.min(current, 0) }), { cards: [uid] });
      }
      return true;
    }
    case 'trashAnyForPower': {
      const options = ps.hand.filter((u) => {
        const def = cardDef(state, u);
        return (!step.categories || step.categories.includes(def.category as 'event' | 'stage' | 'character')) && (!step.filter || matchesFilter(def, step.filter));
      });
      if (step.target && step.target !== 'self' && !frame.memo) {
        // Primeiro escolhe quem recebe o poder.
        const t = resolveTargets(state, frame, step.target, 'help', pr('choosePowerReceiver', `${srcName}: escolha quem recebe o poder.`, { source: srcName }));
        if (!t) return false;
        frame.memo = t.length ? t : ['-'];
        frame.choice = undefined;
      }
      if (!options.length && (!ps.hand.length || frame.choice)) return true;
      if (!frame.choice) {
        askCards(state, frame, options, options.length, pr('trashAnyForPower', `${srcName}: descarte quantas cartas quiser (+${step.power} de poder para cada).`, { source: srcName, power: step.power }), { intent: 'discard', hidden: 'da mão' });
        return false;
      }
      const chosen = frame.choice.filter((u) => options.includes(u));
      for (const uid of chosen) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
      }
      const receiver = step.target && step.target !== 'self' ? frame.memo?.[0] : frame.source;
      if (chosen.length && receiver && locate(state, receiver)) {
        addModifier(state, frame.controller, { uid: receiver, kind: 'power', amount: step.power * chosen.length, duration: step.duration });
        log(state, frame.controller, lg('powerPerTrashed', `${cardDef(state, receiver).name} recebe +${step.power * chosen.length} de poder (${chosen.length} carta(s) descartada(s)).`, { card: cardDef(state, receiver).name, power: step.power * chosen.length, n: chosen.length }), { cards: [receiver] });
      }
      return true;
    }
    case 'redirectAttack': {
      if (!state.battle) return true;
      if (step.toChosen) {
        const to = (frame.last ?? []).find((u) => locate(state, u)?.player === frame.controller);
        if (to && to !== state.battle.target) {
          state.battle.target = to;
          log(state, frame.controller, lg('retarget', `${srcName}: o ataque passa a mirar ${cardDef(state, to).name} (troca de alvo por efeito, não é [Blocker]: a carta não vira).`, { source: srcName, card: cardDef(state, to).name }), { cards: [frame.source, to] });
        }
        return true;
      }
      const options = [...(step.noLeader ? [] : [ps.leader.uid]), ...targetCandidates(state, frame.controller, frame.source, step.spec)].filter(
        (u) => u !== state.battle!.target,
      );
      if (!options.length) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options,
          min: 0,
          max: 1,
          ...promptOf(pr('chooseNewAttackTarget', `${srcName}: escolha o novo alvo do ataque.`, { source: srcName })),
          intent: 'help',
          source: frame.source,
        };
        return false;
      }
      const target = frame.choice.find((u) => options.includes(u));
      if (target && locate(state, target)) {
        state.battle.target = target;
        log(state, frame.controller, lg('retarget', `${srcName}: o ataque passa a mirar ${cardDef(state, target).name} (troca de alvo por efeito, não é [Blocker]: a carta não vira).`, { source: srcName, card: cardDef(state, target).name }), { cards: [frame.source, target] });
      }
      return true;
    }
    case 'cannotBeRested': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCannotBeRestedTarget', `${srcName}: escolha quem não pode ser virado.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'cannotBeRested', amount: 0, duration: step.duration });
      return true;
    }
    case 'canAttackActive':
    case 'cannotAttack': {
      const harm = step.do === 'cannotAttack';
      const t = resolveTargets(state, frame, step.target, harm ? 'harm' : 'help', pr('chooseEffectTarget', `${srcName}: escolha o alvo do efeito.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: step.do, amount: 0, duration: step.duration });
      return true;
    }
  }
}
