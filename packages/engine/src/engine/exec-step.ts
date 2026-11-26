// O que cada passo de efeito faz (`EffectStep.do`).

import { nextRandom, shuffleInPlace } from '../rng';
import type { Ability, Condition, DonSource, EffectStep, GameState, MsgList, PlayerId, PlayerState, Restriction, TargetSpec } from '../types';
import type { DamageFrame, EffectFrame } from './constants';
import { DECK_TOP_BOTTOM, lg, LIFE_TOP_BOTTOM, log, logSecret, msgOf, pr, promptOf } from './messages';
import { fixedOpponent, isMultiplayer, opponentOf, opponentSides, opponentsOf } from './table';
import { basePowerOf, cardDef, getPower, locate, matchesFilter, ownerOf } from './queries';
import { conditionFailure } from './conditions';
import { discardable, handDef, playBlocked, releaseOncePerTurn, restricted, targetCandidates, totalDonOnField, usedKey } from './options';
import { markRevealed } from './cancel';
import { setExpiry } from './turn';
import { pushEffect } from './stack';
import { emit } from './triggers';
import {
  abortEffect,
  addModifier,
  askCards,
  askOption,
  donTargetOpponent,
  markHandTrashed,
  playFree,
  resolveTargets,
  stepConditionMet,
  upToCount,
  useOwnEffect,
} from './effects';
import {
  askPay,
  canPayCost,
  costAsksOwner,
  costPartsOf,
  describeCost,
  koCostOptions,
  ownCostOptions,
  payImmediateCost,
  restOwnOptions,
} from './costs';
import { continueRemoval, koCharacter, koProtected, koStage, removalBlocked, removalCtx, removeFromField } from './removal';
import {
  cannotBeRested,
  describeDonSource,
  detach,
  donSources,
  drawCards,
  faceDownLife,
  inLimbo,
  lifeEnds,
  lifeRemoved,
  lifeToHandCard,
  lifeTop,
  removeFrom,
  restCard,
  summarizeDonSources,
  takeDon,
  takeLife,
  zoneOf,
} from './zones';
import { gameOver } from './defeat';

/** Condições internas do leitor (dependem da escolha anterior), que não são "a condição da carta". */
const INTERNAL_CONDITIONS: Array<keyof Condition> = ['lastDone', 'lastKOd', 'chosenMatches', 'revealedHasChosenCost'];

export function execStep(state: GameState, frame: EffectFrame, step: EffectStep): boolean {
  const ps = state.players[frame.controller];
  const srcName = cardDef(state, frame.source).name;
  const fresh = !frame.choice && !frame.memo;
  // "If X, A. Then, B.": com o "if" falho, o "Then" também não acontece (CR 4-10-2, OP06-116).
  if (fresh && step.afterIf && frame.ifFailed) {
    if (step.do === 'payCost' && step.scope) frame.i += step.scope;
    return true;
  }
  const met = !fresh || stepConditionMet(state, frame, step);
  // Só um "If X, …" conta para o "Then" ("If you do" é outra regra).
  if (fresh && step.if && Object.keys(step.if).some((k) => k !== 'lastDone' && k !== 'lastKOd')) frame.ifFailed = !met;
  if (!met) {
    // "If you have 2 or less Characters, play…": a condição da carta não vale. O histórico diz
    // o motivo (o jogador costuma achar que o efeito falhou, ou que a carta que queria escolher
    // não servia). Condições internas (depende da escolha anterior) continuam silenciosas.
    const cond = step.if;
    if (cond && Object.keys(cond).some((k) => !INTERNAL_CONDITIONS.includes(k as keyof Condition))) {
      const why = conditionFailure(state, frame.controller, frame.source, cond);
      const text = `${srcName}: a condição não vale (${why.text}), o efeito não acontece.`;
      if (state.log[state.log.length - 1]?.text !== text) {
        log(state, frame.controller, lg('conditionFails', text, { source: srcName, reason: why.text }, { reason: { items: [msgOf(why)] } }), { cards: [frame.source] });
      }
    }
    // "If that card is a [Sabo] …, you may play that card. If you do, …" (ST13-007): sem a condição, o
    // "you may" não acontece, e o "If you do" (o trecho do `scope`) também não.
    if (step.do === 'payCost' && step.scope) frame.i += step.scope;
    return true;
  }

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
    case 'giveRestedDon': {
      // O oponente só entra quando o DON!! sai da área de custo dele (ou do dono da carta escolhida).
      const multi = isMultiplayer(state) && (step.fromOpponent || step.fromOwner) && fixedOpponent(state, frame.controller) === undefined;
      const poolOf = (g: PlayerState) => g.donRested + (step.anyState ? g.donActive : 0);
      // Mesa com mais de dois: o alvo pode ser de qualquer oponente e o DON!! sai de quem o controla; "o
      // oponente", nas contas de antes da escolha, é quem tem mais DON!! para dar.
      const opp =
        step.fromOpponent || step.fromOwner
          ? multi
            ? opponentsOf(state, frame.controller).map((o) => state.players[o]).reduce((a, x) => (poolOf(x) > poolOf(a) ? x : a))
            : state.players[opponentOf(state, frame.controller)]
          : ps;
      // "from its owner's cost area" (OP15-023): o DON!! sai da área de custo do dono da carta escolhida.
      const giverOf = (uid: string): PlayerState =>
        step.fromOwner || (multi && ownerOf(state, uid) !== frame.controller) ? state.players[ownerOf(state, uid)] : step.fromOpponent ? opp : ps;
      const prompt = step.anyState ? 'DON!!' : 'DON!! virado(s)';
      const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
      let t: string[];
      let qty = step.count;
      /** Quantos dos DON!! dados saem virados (o resto, ativos); só com `anyState` e os dois estados disponíveis. */
      let fromRested: number | undefined;
      const stage = frame.memo?.[0];
      if (frame.memo && (stage === 'qty' || stage?.startsWith('state:'))) {
        t = frame.memo.slice(1);
        if (stage === 'qty') {
          qty = Math.min(step.count, poolOf(giverOf(t[0]))) - Number(frame.choice?.[0] ?? 0);
        } else {
          qty = Number(stage.slice('state:'.length));
          const g = giverOf(t[0]);
          fromRested = Math.min(qty, g.donRested) - Number(frame.choice?.[0] ?? 0);
        }
        frame.choice = undefined;
        frame.memo = undefined;
      } else {
        let spec = step.target;
        if (step.fromOwner && typeof spec === 'object') {
          // Só quem tem DON!! na área de custo pode receber; sem DON!! de nenhum lado, nada acontece.
          const sides = (['own', 'opponent'] as const).filter((side) => poolOf(side === 'own' ? ps : opp) > 0);
          if (!sides.length) return true;
          if (sides.length === 1) spec = { ...spec, side: sides[0] };
        } else if (poolOf(step.fromOpponent ? opp : ps) === 0) return true;
        const chosen = resolveTargets(
          state,
          frame,
          spec,
          step.fromOpponent ? 'harm' : 'help',
          pr(step.anyState ? 'chooseDonReceiver' : 'chooseRestedDonReceiver', `${srcName}: escolha quem recebe ${prompt}.`, { source: srcName, n: step.count }),
        );
        if (!chosen) return false;
        t = chosen;
        // "Give up to 2 rested DON!! cards to …" (OP05-008): com um alvo só, o jogador escolhe quantos (do máximo para 1).
        const max = t.length ? Math.min(step.count, poolOf(giverOf(t[0]))) : 0;
        if (t.length === 1 && max > 1) {
          frame.memo = ['qty', ...t];
          askOption(
            state,
            frame,
            frame.controller,
            pr('howManyDonToGive', `${srcName}: quantos DON!! dar a ${cardDef(state, t[0]).name}?`, { source: srcName, target: cardDef(state, t[0]).name }),
            Array.from({ length: max }, (_, i) => String(max - i)),
          );
          return false;
        }
      }
      // Virado ou ativo ("from its owner's cost area" aceita DON!! ativo, Q&A OP15): quem ativa escolhe
      // quantos saem virados, do máximo de virados para o mínimo.
      if (step.anyState && fromRested === undefined && t.length === 1) {
        const g = giverOf(t[0]);
        const n = Math.min(qty, poolOf(g));
        const kMax = Math.min(n, g.donRested);
        const kMin = Math.max(0, n - g.donActive);
        if (kMax > kMin) {
          const label = (k: number) =>
            n === 1 ? (k ? 'DON!! virado' : 'DON!! ativo') : `${k} ${pl(k, 'virado', 'virados')} e ${n - k} ${pl(n - k, 'ativo', 'ativos')}`;
          frame.memo = [`state:${qty}`, ...t];
          // Com 1 DON!!, as opções são fixas (virado/ativo); com mais, cada opção traz dois números e fica como está.
          askOption(
            state,
            frame,
            frame.controller,
            pr(
              n === 1 ? 'giveDonRestedOrActive' : 'giveDonHowManyRested',
              `${srcName}: dar ${n === 1 ? 'um DON!! virado ou ativo' : 'quantos DON!! virados (o resto ativos)'} de ${g.name} a ${cardDef(state, t[0]).name}?`,
              { source: srcName, owner: g.name, target: cardDef(state, t[0]).name },
            ),
            Array.from({ length: kMax - kMin + 1 }, (_, i) => label(kMax - i)),
            n === 1 ? Array.from({ length: kMax - kMin + 1 }, (_, i) => (kMax - i ? 'engine.optRestedDon' : 'engine.optActiveDon')) : undefined,
          );
          return false;
        }
      }
      for (const uid of t) {
        const loc = locate(state, uid);
        const giver = giverOf(uid);
        const n = Math.min(qty, poolOf(giver));
        if (loc && n > 0) {
          const rested = fromRested === undefined ? Math.min(n, giver.donRested) : Math.min(fromRested, giver.donRested, n);
          giver.donRested -= rested;
          giver.donActive -= n - rested;
          loc.fc.don += n;
          emit(state, { kind: 'donGiven', player: loc.player, card: uid });
          const state_ = step.anyState ? ` (${rested} ${pl(rested, 'virado', 'virados')}, ${n - rested} ${pl(n - rested, 'ativo', 'ativos')})` : '';
          const text = `${cardDef(state, uid).name} recebe ${n} DON!!${state_} da área de custo de ${giver.name}.`;
          const params = { card: cardDef(state, uid).name, n, player: giver.name };
          log(state, frame.controller, step.anyState ? lg('receivesDonMixed', text, { ...params, rested, active: n - rested }) : lg('receivesDon', text, params));
        }
      }
      return true;
    }
    case 'draw': {
      if (restricted(state, frame.controller, 'noDrawByEffect')) return true;
      if (!step.upTo) {
        drawCards(state, frame.controller, step.count);
        log(state, frame.controller, lg('draws', `${ps.name} compra ${step.count} carta(s).`, { player: ps.name, n: step.count }));
        emit(state, { kind: 'drawByEffect', player: frame.controller });
        return true;
      }
      // "Draw up to N cards" (4-5-4): uma por vez; antes de cada uma o jogador pode parar
      // (memo[0] = quantas já comprou). O oponente vê só a pergunta, sem o texto.
      let drawn = Number(frame.memo?.[0] ?? 0);
      let stop = false;
      if (frame.choice) {
        if (frame.choice[0] === 'yes') {
          drawCards(state, frame.controller, 1);
          drawn++;
        } else stop = true;
        frame.choice = undefined;
      }
      if (!stop && drawn < step.count && ps.deck.length) {
        frame.memo = [String(drawn)];
        state.pending = {
          kind: 'confirm',
          player: frame.controller,
          source: frame.source,
          ...promptOf(pr(drawn ? 'drawUpToMore' : 'drawUpToFirst', `${srcName}: comprar ${drawn ? 'mais ' : ''}1 carta? (${drawn} de até ${step.count})`, { source: srcName, drawn, max: step.count })),
          drawUpTo: true,
        };
        return false;
      }
      frame.memo = undefined;
      log(
        state,
        frame.controller,
        drawn ? lg('draws', `${ps.name} compra ${drawn} carta(s).`, { player: ps.name, n: drawn }) : lg('drawsNone', `${ps.name} não compra cartas.`, { player: ps.name }),
      );
      if (drawn) emit(state, { kind: 'drawByEffect', player: frame.controller });
      return true;
    }
    case 'addDonFromDeck': {
      const n = Math.min(step.count, ps.donDeck);
      ps.donDeck -= n;
      if (step.rested) ps.donRested += n;
      else ps.donActive += n;
      return true;
    }
    case 'restOpponentDon': {
      if (isMultiplayer(state) && fixedOpponent(state, frame.controller) === undefined) {
        // "Rest up to N of your opponent's DON!! cards": cada DON!! é um alvo, de qualquer oponente.
        const done = Number(frame.choice ? (frame.memo?.[frame.memo.length - 1] ?? 0) : (frame.memo?.[0] === 'restN' ? frame.memo[1] : 0));
        let left = step.count - done;
        let n = done;
        while (left > 0) {
          const id = donTargetOpponent(
            state,
            frame,
            opponentSides(state, frame.controller).filter((o) => state.players[o].donActive > 0),
            pr('whoseDonToRest', `${srcName}: virar 1 DON!! ativo de qual oponente?`, { source: srcName }),
          );
          if (id === undefined) {
            // Guarda quantos já foram virados no fim da memória da pergunta.
            frame.memo!.push(String(n));
            return false;
          }
          if (id === null) break;
          const o = state.players[id];
          o.donActive--;
          o.donRested++;
          log(state, frame.controller, lg('donRested', `1 DON!! de ${o.name} é virado.`, { n: 1, player: o.name }));
          n++;
          left--;
        }
        return true;
      }
      const o = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, o.donActive);
      o.donActive -= n;
      o.donRested += n;
      if (n) log(state, frame.controller, lg('donRested', `${n} DON!! de ${o.name} é virado.`, { n, player: o.name }));
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
    case 'playThis': {
      if (zoneOf(state, frame.source) === 'character' || zoneOf(state, frame.source) === 'stage') return true;
      playFree(state, frame.source, step.rested, frame.source);
      return true;
    }
    case 'trashFromHand': {
      const options = discardable(state, frame.controller, step.filter);
      const n = Math.min(step.count, options.length);
      // Mão vazia é público; "nenhuma carta da mão serve" (filtro) não é: a escolha abre mesmo assim.
      if (n === 0 && (!ps.hand.length || frame.choice)) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseHandCardsToTrash', `${srcName}: escolha ${n} carta(s) da mão para descartar.`, { source: srcName, n }), {
          min: step.upTo ? 0 : n,
          intent: 'discard',
          hidden: 'da mão',
        });
        return false;
      }
      const trashed = frame.choice.filter((u) => options.includes(u));
      for (const uid of trashed) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        log(state, frame.controller, lg('trashesCard', `${ps.name} descarta ${cardDef(state, uid).name}.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      frame.eventCount = trashed.length;
      frame.trashed = trashed;
      if (trashed.length) {
        markHandTrashed(state, frame.controller);
        emit(state, { kind: 'handTrashedByEffect', player: frame.controller, card: frame.source, count: trashed.length });
      }
      return true;
    }
    case 'setDonActive': {
      if (restricted(state, frame.controller, 'noSetDonActiveByCharacter') && cardDef(state, frame.source).category === 'character') return true;
      const n = upToCount(state, frame, step, ps.donRested, pr('howManyDonToSetActive', `${srcName}: quantos DON!! deixar ativos?`, { source: srcName }));
      if (n === null) return false;
      ps.donRested -= n;
      ps.donActive += n;
      if (n) log(state, frame.controller, lg('donSetActive', `${n} DON!! de ${ps.name} fica(m) ativo(s).`, { n, player: ps.name }));
      return true;
    }
    case 'search': {
      const top = ps.deck.slice(0, step.look);
      const options = top.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      // 1ª escolha (memo vazio): as cartas pegas. 2ª (resto no fundo, 2+ cartas): a ordem do fundo.
      if (!frame.memo) {
        if (!frame.choice) {
          if (!top.length) return true;
          // Mostra todas as cartas olhadas, mesmo sem opção válida: o jogador vê o que vai para o fundo.
          state.pending = {
            kind: 'selectTargets',
            player: frame.controller,
            options,
            min: 0,
            max: Math.min(step.upTo, options.length),
            ...promptOf(
              options.length
                ? pr(
                    step.play ? 'searchPlay' : step.toTrash ? 'searchTrash' : step.toLife ? 'searchToLife' : 'searchToHand',
                    `${srcName}: olhe as ${top.length} cartas do topo e escolha até ${step.upTo} para ${step.play ? 'jogar' : step.toTrash ? 'descartar' : step.toLife ? 'colocar no topo da Vida' : 'adicionar à mão'}.`,
                    { source: srcName, count: top.length, max: step.upTo },
                  )
                : pr('searchNone', `${srcName}: nenhuma das ${top.length} cartas do topo pode ser escolhida.`, { source: srcName, count: top.length }),
            ),
            intent: 'help',
            source: frame.source,
            shown: top,
            hidden: true,
          };
          return false;
        }
        frame.memo = frame.choice.filter((u) => options.includes(u));
        frame.choice = undefined;
        const rest = top.filter((u) => !frame.memo!.includes(u));
        if (step.rest === 'bottom' && rest.length > 1) {
          askCards(
            state,
            frame,
            rest,
            rest.length,
            pr('orderBottomCards', `${srcName}: escolha a ordem das cartas que vão para o fundo do deck (a primeira fica mais acima; a última, no fundo).`, { source: srcName }),
            { min: rest.length, ordered: true },
          );
          return false;
        }
      }
      const chosen = frame.memo.filter((u) => top.includes(u));
      let rest = top.filter((u) => !chosen.includes(u));
      if (frame.choice) {
        const order = frame.choice.filter((u) => rest.includes(u));
        rest = [...order, ...rest.filter((u) => !order.includes(u))];
      }
      for (const uid of top) removeFrom(ps.deck, uid);
      for (const uid of chosen) {
        if (step.toTrash) {
          ps.trash.push(uid);
          log(state, frame.controller, lg('trashesCard', `${ps.name} descarta ${cardDef(state, uid).name}.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
        } else if (step.toLife) {
          ps.life.push(uid);
          if (step.lifeFaceDown) log(state, frame.controller, lg('addsOneToLife', `${ps.name} coloca 1 carta no topo da Vida.`, { player: ps.name }));
          else {
            (ps.lifeFaceUp ??= []).push(uid);
            log(state, frame.controller, lg('addsToLifeFaceUp', `${ps.name} coloca ${cardDef(state, uid).name} no topo da Vida, virada para cima.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
          }
        } else if (step.play) {
          // "play up to 1 … Then, place the rest at the bottom": joga a carta (o resto vai para o fundo antes).
          ps.hand.push(uid);
          playFree(state, uid, step.rested, frame.source, true); // vem do deck (só passa pela mão)
        } else if (step.noReveal) {
          // "add up to 1 card to your hand" (sem "reveal", OP16-021): o oponente não vê a carta.
          ps.hand.push(uid);
          log(state, frame.controller, lg('addsOneToHand', `${ps.name} adiciona 1 carta à mão.`, { player: ps.name }));
        } else {
          ps.hand.push(uid);
          log(state, frame.controller, lg('revealsAddsToHand', `${ps.name} revela ${cardDef(state, uid).name} e adiciona à mão.`, { player: ps.name, card: cardDef(state, uid).name }), { uids: [uid], by: ps.id });
        }
      }
      frame.searched = chosen.length;
      if (step.rest === 'bottom') {
        ps.deck.push(...rest);
        if (rest.length) log(state, frame.controller, lg('placesAtBottom', `${ps.name} coloca ${rest.length} carta(s) no fundo do deck.`, { player: ps.name, n: rest.length }));
      } else if (step.rest === 'trash') ps.trash.push(...rest);
      else if (rest.length) {
        // "place the rest at the top or bottom of the deck in any order": o jogador ordena em seguida.
        ps.deck.unshift(...rest);
        frame.steps.splice(frame.i + 1, 0, { do: 'arrangeTop', look: rest.length });
      }
      return true;
    }
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
    case 'returnDonChoice': {
      const max = totalDonOnField(ps);
      if (max > step.min && !frame.choice) {
        askOption(
          state,
          frame,
          frame.controller,
          pr('howManyDonToReturn', `${srcName}: quantos DON!! devolver ao deck de DON!!?`, { source: srcName }),
          Array.from({ length: max - step.min + 1 }, (_, i) => `${step.min + i} DON!!`),
        );
        return false;
      }
      const n = Math.min(max, step.min + (frame.choice ? Number(frame.choice[0]) : 0));
      frame.steps.splice(frame.i + 1, 0, { do: 'returnDon', count: n });
      return true;
    }
    case 'returnDon': {
      const owner = step.opponent ? state.players[opponentOf(state, frame.controller)] : ps;
      const picked = (frame.memo ?? []) as DonSource[];
      if (frame.choice) {
        const src = donSources(owner)[Number(frame.choice[0])];
        if (src) {
          takeDon(owner, src);
          picked.push(src);
        }
        frame.choice = undefined;
      }
      while (picked.length < step.count) {
        // "return N of your active DON!! cards": só os ativos da área de custo (sem escolha).
        const sources = step.activeOnly ? (owner.donActive ? (['active'] as DonSource[]) : []) : donSources(owner);
        if (!sources.length) break;
        // Só pergunta quando a escolha muda alguma coisa: há mais de uma origem e sobra DON!! no campo.
        if (sources.length > 1 && totalDonOnField(owner) > step.count - picked.length) {
          frame.memo = picked;
          state.pending = {
            kind: 'option',
            player: owner.id,
            source: frame.source,
            ...promptOf(
              pr('chooseDonToReturn', `${srcName}: escolha o ${picked.length + 1}º de ${step.count} DON!! a devolver ao deck de DON!!.`, {
                source: srcName,
                index: picked.length + 1,
                count: step.count,
              }),
            ),
            // As opções trazem contagens e nomes de carta; a interface as monta por `don`.
            options: sources.map((src) => describeDonSource(state, owner, src)),
            don: sources,
          };
          return false;
        }
        takeDon(owner, sources[0]);
        picked.push(sources[0]);
      }
      if (picked.length) {
        emit(state, { kind: 'donReturned', player: owner.id, count: picked.length, byPlayer: frame.controller });
        const from = summarizeDonSources(state, picked);
        log(
          state,
          frame.controller,
          lg(
            'returnsDon',
            `${owner.name} devolve ${picked.length} DON!! ao deck de DON!! (${from.map((p) => p.text).join(', ')}).`,
            { player: owner.name, n: picked.length, from: from.map((p) => p.text).join(', ') },
            { from: { items: from.map(msgOf), join: 'log.listComma' } },
          ),
        );
      }
      return true;
    }
    case 'trashLife': {
      const target = state.players[step.side === 'own' ? frame.controller : opponentOf(state, frame.controller)];
      const n = upToCount(state, frame, step, target.life.length, pr('howManyLifeToTrash', `${srcName}: quantas cartas da Vida de ${target.name} descartar?`, { source: srcName, player: target.name }));
      if (n === null) return false;
      for (let i = 0; i < n; i++) target.trash.push(takeLife(target));
      if (n) lifeRemoved(state, target.id);
      if (n) log(state, frame.controller, lg('lifeToTrash', `${n} carta(s) de Vida de ${target.name} vão para o descarte.`, { n, player: target.name }));
      return true;
    }
    case 'gainKeyword': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseKeywordTarget', `${srcName}: escolha quem ganha [${step.keyword}].`, { source: srcName, keyword: step.keyword }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'keyword', keyword: step.keyword, amount: 0, duration: step.duration });
      return true;
    }
    case 'select': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseCard', `${srcName}: escolha uma carta.`, { source: srcName }));
      return Boolean(t);
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
    case 'opponentDiscards': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options: [...opp.hand],
          min: n,
          max: n,
          ...promptOf(pr('chooseOwnHandCardsToTrash', `${srcName}: escolha ${n} carta(s) da sua mão para descartar.`, { source: srcName, n })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.hand.includes(u))) {
        removeFrom(opp.hand, uid);
        opp.trash.push(uid);
        markHandTrashed(state, opp.id);
        log(state, opp.id, lg('trashesCard', `${opp.name} descarta ${cardDef(state, uid).name}.`, { player: opp.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'tutor': {
      const options = ps.deck.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice) {
        // Abre mesmo sem carta válida: pular contaria ao oponente o que há no deck.
        if (!ps.deck.length) return true;
        askCards(state, frame, options, step.upTo, pr('chooseDeckCardsToHand', `${srcName}: escolha até ${step.upTo} carta(s) do deck para adicionar à mão.`, { source: srcName, n: step.upTo }), {
          hidden: 'do deck',
        });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.deck, uid);
        ps.hand.push(uid);
        log(state, frame.controller, lg('revealsFromDeckToHand', `${ps.name} revela ${cardDef(state, uid).name} do deck e adiciona à mão.`, { player: ps.name, card: cardDef(state, uid).name }), { uids: [uid], by: ps.id });
      }
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
    case 'trashRandomFromOpponentHand': {
      const opp = state.players[opponentOf(state, frame.controller)];
      for (let i = 0; i < step.count && opp.hand.length; i++) {
        const uid = opp.hand[Math.floor(nextRandom(state) * opp.hand.length)];
        removeFrom(opp.hand, uid);
        opp.trash.push(uid);
        markHandTrashed(state, opp.id);
        log(state, frame.controller, lg('trashesRandom', `${opp.name} descarta ${cardDef(state, uid).name} (escolhida ao acaso).`, { player: opp.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
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
    case 'trashToDeckBottom': {
      const options = ps.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter));
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseTrashCardsToBottom', `${srcName}: escolha ${n} carta(s) do descarte para o fundo do deck.`, { source: srcName, n }), { min: n });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.trash, uid);
        ps.deck.push(uid);
      }
      log(state, frame.controller, lg('trashToBottom', `${ps.name} coloca ${n} carta(s) do descarte no fundo do deck.`, { player: ps.name, n }));
      return true;
    }
    case 'lifeToTrash': {
      const n = Math.min(step.count, ps.life.length);
      if (n === 0) return true;
      if (step.choose && ps.life.length > 1 && !frame.choice) {
        askOption(state, frame, frame.controller, pr('trashLifeTopOrBottom', `${srcName}: descartar a carta do topo ou do fundo da Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) ps.trash.push(takeLife(ps, fromBottom));
      if (n) lifeRemoved(state, ps.id);
      log(state, frame.controller, lg('trashesLife', `${ps.name} descarta ${n} carta(s) da Vida.`, { player: ps.name, n }));
      return true;
    }
    case 'revealFromHand': {
      const options = discardable(state, frame.controller, step.filter);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseHandCardsToReveal', `${srcName}: escolha ${n} carta(s) da mão para revelar.`, { source: srcName, n }), { min: n });
        return false;
      }
      log(state, frame.controller, lg('reveals', `${ps.name} revela ${frame.choice.map((u) => cardDef(state, u).name).join(', ')}.`, { player: ps.name, cards: frame.choice.map((u) => cardDef(state, u).name).join(', ') }), { uids: frame.choice, by: ps.id });
      frame.last = frame.choice.filter((u) => options.includes(u));
      return true;
    }
    case 'lifeFace': {
      ps.lifeFaceUp ??= [];
      if (step.topOrBottom) {
        // A carta do topo ou a do fundo da Vida (a que puder ser virada); com as duas, o jogador escolhe.
        const ends = lifeEnds(ps, step.up);
        if (!ends.length) return true;
        let uid = ends[0];
        if (ends.length > 1) {
          if (!frame.choice) {
            askOption(state, frame, frame.controller, pr('flipLifeTopOrBottom', `${srcName}: virar a carta do topo ou do fundo da Vida?`, { source: srcName }), ['Topo', 'Fundo'], ['engine.optTop', 'engine.optBottom']);
            return false;
          }
          uid = ends[Number(frame.choice[0])] ?? ends[0];
        }
        if (step.up) ps.lifeFaceUp.push(uid);
        else removeFrom(ps.lifeFaceUp, uid);
        const top = uid === ps.life[ps.life.length - 1];
        // Virada para cima, a carta fica pública (3-10-2-1): o log diz qual é.
        const card = cardDef(state, uid).name;
        log(
          state,
          frame.controller,
          step.up
            ? lg(
                `flipsLife${top ? 'Top' : 'Bottom'}UpCard`,
                `${ps.name} vira a carta do ${top ? 'topo' : 'fundo'} da Vida para cima: ${card}.`,
                { player: ps.name, card },
              )
            : lg(`flipsLife${top ? 'Top' : 'Bottom'}Down`, `${ps.name} vira a carta do ${top ? 'topo' : 'fundo'} da Vida para baixo.`, { player: ps.name }),
          step.up ? { cards: [uid] } : undefined,
        );
        return true;
      }
      const pool = step.fromTop
        ? lifeTop(ps, step.count, step.up)
        : step.up
          ? faceDownLife(ps)
          : [...ps.life].reverse().filter((u) => ps.lifeFaceUp!.includes(u));
      const flipped = pool.slice(0, step.count);
      for (const uid of flipped) {
        if (step.up) ps.lifeFaceUp.push(uid);
        else removeFrom(ps.lifeFaceUp, uid);
      }
      const n = flipped.length;
      if (step.up && n) {
        const cards = flipped.map((u) => cardDef(state, u).name).join(', ');
        log(state, frame.controller, lg('flipsLifeUpCards', `${ps.name} vira ${n} carta(s) de Vida para cima: ${cards}.`, { player: ps.name, n, cards }), { cards: flipped });
        return true;
      }
      log(
        state,
        frame.controller,
        lg(step.up ? 'flipsLifeUp' : 'flipsLifeDown', `${ps.name} vira ${n} carta(s) de Vida para ${step.up ? 'cima' : 'baixo'}.`, { player: ps.name, n }),
      );
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
    case 'revealTop': {
      const card = ps.deck[0];
      frame.last = card ? [card] : [];
      frame.revealed = frame.last;
      if (card) log(state, frame.controller, lg('revealsDeckTop', `${ps.name} revela ${cardDef(state, card).name} do topo do deck.`, { player: ps.name, card: cardDef(state, card).name }), { uids: [card] });
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
    case 'revealedToHand': {
      const card = frame.last?.[0];
      if (card && ps.deck.includes(card) && (!step.filter || matchesFilter(cardDef(state, card), step.filter))) {
        removeFrom(ps.deck, card);
        ps.hand.push(card);
        log(state, frame.controller, lg('addsToHand', `${ps.name} adiciona ${cardDef(state, card).name} à mão.`, { player: ps.name, card: cardDef(state, card).name }), { cards: [card] });
      }
      return true;
    }
    case 'opponentTrashToBottom': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const pile = opp.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter));
      const n = Math.min(step.count, pile.length);
      if (!n) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: step.chooser === 'self' ? frame.controller : opp.id,
          options: pile,
          min: step.upTo ? 0 : n,
          max: n,
          ...promptOf(
            pr(
              step.chooser === 'self' ? 'chooseOpponentTrashToBottom' : 'chooseOwnTrashToBottom',
              `${srcName}: escolha ${n} carta(s) do descarte ${step.chooser === 'self' ? 'do oponente' : 'seu'} para o fundo do deck.`,
              { source: srcName, n },
            ),
          ),
          intent: 'discard',
          source: frame.source,
          ordered: true,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.trash.includes(u))) {
        removeFrom(opp.trash, uid);
        opp.deck.push(uid);
      }
      log(state, opp.id, lg('oppTrashToBottom', `${frame.choice.length} carta(s) do descarte de ${opp.name} vão para o fundo do deck.`, { n: frame.choice.length, player: opp.name }));
      return true;
    }
    case 'arrangeLife': {
      const owner = step.whose === 'own' ? ps : state.players[opponentOf(state, frame.controller)];
      if (owner.life.length < 2) return true;
      if (!frame.choice) {
        // Do topo para o fundo, na ordem dos cliques.
        askCards(state, frame, [...owner.life].reverse(), owner.life.length, pr('arrangeLife', `${srcName}: ordene as cartas de Vida (a primeira escolhida fica no topo).`, { source: srcName }), {
          min: owner.life.length,
          ordered: true,
        });
        return false;
      }
      const order = frame.choice.filter((u) => owner.life.includes(u));
      if (order.length === owner.life.length) owner.life = [...order].reverse();
      log(state, frame.controller, lg('arrangesLife', `${ps.name} reorganiza as cartas de Vida de ${owner.name}.`, { player: ps.name, owner: owner.name }));
      return true;
    }
    case 'restDonOrCharacter': {
      const skip = Boolean(step.skipRefresh);
      // skipRefresh: só cartas viradas que ainda não vão ficar viradas; DON!! virados que ainda não vão ficar.
      const skippedDon = (id: PlayerId) => (state.donSkipRefresh ?? []).filter((d) => d.player === id).reduce((n, d) => n + d.count, 0);
      const hasDon = (id: PlayerId) => (skip ? state.players[id].donRested > skippedDon(id) : state.players[id].donActive > 0);
      // Mesa com mais de dois: "1 of your opponent's DON!! cards or Characters" é um alvo de qualquer oponente;
      // cada oponente com DON!! que sirva vira uma opção.
      const many = isMultiplayer(state) && fixedOpponent(state, frame.controller) === undefined;
      const donOwners = (many ? opponentSides(state, frame.controller) : [opponentOf(state, frame.controller)]).filter(hasDon);
      const opp = state.players[donOwners[0] ?? opponentOf(state, frame.controller)];
      const donAvailable = donOwners.length > 0;
      const spec: TargetSpec = { ...step.spec, side: 'opponent', upTo: 1 };
      const chars = targetCandidates(state, frame.controller, frame.source, spec).filter((u) =>
        skip ? !state.modifiers.some((m) => m.uid === u && m.kind === 'skipRefresh') : !locate(state, u)?.fc.rested,
      );
      const onlyChars = spec.kinds.every((k) => k === 'character');
      const cardLabel = onlyChars ? 'um Personagem do oponente' : 'uma carta do oponente (Líder, Personagem ou Stage)';
      if (!frame.memo && many && donOwners.length > 1) {
        if (!chars.length && !donAvailable) return true;
        // Uma opção de DON!! por oponente ("Virar 1 DON!! ativo de Fulano").
        const name = (id: PlayerId) => state.players[id].name;
        const donText = (id: PlayerId) => (skip ? `1 DON!! virado de ${name(id)}` : `Virar 1 DON!! ativo de ${name(id)}`);
        const donPart = (id: PlayerId): MsgList => ({ items: [{ key: skip ? 'engine.optSkipRefreshDonOf' : 'engine.optRestDonOf', params: { player: name(id) } }] });
        const charText = skip
          ? onlyChars
            ? 'Um Personagem virado do oponente'
            : 'Uma carta virada do oponente (Líder, Personagem ou Stage)'
          : `Virar ${cardLabel}`;
        const charKey = skip ? (onlyChars ? 'engine.optSkipRefreshCharacter' : 'engine.optSkipRefreshCard') : onlyChars ? 'engine.optRestOpponentCharacter' : 'engine.optRestOpponentCard';
        askOption(
          state,
          frame,
          frame.controller,
          skip
            ? pr('whatSkipsRefresh', `${srcName}: o que não desvira na próxima Renovação do oponente?`, { source: srcName })
            : pr('whatToRest', `${srcName}: o que virar?`, { source: srcName }),
          [...donOwners.map(donText), ...(chars.length ? [charText] : []), 'Nenhum'],
          [...donOwners.map(() => null), ...(chars.length ? [charKey] : []), 'engine.optNone'],
          [...donOwners.map(donPart), ...(chars.length ? [null] : []), null],
        );
        frame.memo = ['pick', ...donOwners.map((id) => `don:${id}`), ...(chars.length ? ['char'] : [])];
        return false;
      }
      if (!frame.memo) {
        if (!donAvailable && !chars.length) return true;
        if (!frame.choice) {
          const opts = skip
            ? [
                ...(donAvailable ? ['1 DON!! virado do oponente'] : []),
                ...(chars.length ? [onlyChars ? 'Um Personagem virado do oponente' : 'Uma carta virada do oponente (Líder, Personagem ou Stage)'] : []),
                'Nenhum',
              ]
            : [...(donAvailable ? ['Virar 1 DON!! ativo do oponente'] : []), ...(chars.length ? [`Virar ${cardLabel}`] : []), 'Nenhum'];
          const optKeys = skip
            ? [
                ...(donAvailable ? ['engine.optSkipRefreshDon'] : []),
                ...(chars.length ? [onlyChars ? 'engine.optSkipRefreshCharacter' : 'engine.optSkipRefreshCard'] : []),
                'engine.optNone',
              ]
            : [...(donAvailable ? ['engine.optRestOpponentDon'] : []), ...(chars.length ? [onlyChars ? 'engine.optRestOpponentCharacter' : 'engine.optRestOpponentCard'] : []), 'engine.optNone'];
          askOption(
            state,
            frame,
            frame.controller,
            skip
              ? pr('whatSkipsRefresh', `${srcName}: o que não desvira na próxima Renovação do oponente?`, { source: srcName })
              : pr('whatToRest', `${srcName}: o que virar?`, { source: srcName }),
            opts,
            optKeys,
          );
          frame.memo = ['pick', ...(donAvailable ? [many ? `don:${opp.id}` : 'don'] : []), ...(chars.length ? ['char'] : [])];
          return false;
        }
      }
      if (frame.memo?.[0] === 'pick') {
        const raw = frame.memo[1 + Number(frame.choice?.[0])];
        frame.choice = undefined;
        // 'don' (o único oponente) ou 'don:<lugar>' (mesa com mais de dois).
        const pick = raw?.startsWith('don:') ? 'don' : raw;
        const opp = raw?.startsWith('don:') ? state.players[Number(raw.slice(4))] : state.players[opponentOf(state, frame.controller)];
        if (pick === 'don') {
          if (skip) {
            (state.donSkipRefresh ??= []).push({ player: opp.id, count: 1 });
            log(state, frame.controller, lg('donSkipsRefresh', `1 DON!! de ${opp.name} não fica ativo na próxima Renovação.`, { n: 1, player: opp.name }));
          } else {
            opp.donActive--;
            opp.donRested++;
            log(state, frame.controller, lg('donRested', `1 DON!! de ${opp.name} é virado.`, { n: 1, player: opp.name }));
          }
          return true;
        }
        if (pick !== 'char') return true;
        frame.memo = ['char'];
      }
      if (skip) {
        const t = resolveTargets(state, frame, spec, 'harm', pr('chooseSkipRefreshCard', `${srcName}: escolha a carta que não desvira no próximo turno.`, { source: srcName }));
        if (!t) return false;
        for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'skipRefresh', amount: 0, duration: 'nextOpponentTurn' });
        return true;
      }
      const t = resolveTargets(state, frame, spec, 'harm', pr(onlyChars ? 'chooseCharacterToRest' : 'chooseCardToRest', `${srcName}: escolha ${onlyChars ? 'o Personagem' : 'a carta'} a virar.`, { source: srcName }));
      if (!t) return false;
      // Virado por efeito: valem "cannot be rested by your opponent's effects", a substituição de rest e restedByEffect.
      for (const uid of t) restCard(state, uid, frame.controller, frame.source);
      return true;
    }
    case 'chooseCost':
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('chooseACost', `${srcName}: escolha um custo.`, { source: srcName }), Array.from({ length: 11 }, (_, i) => String(i)));
        return false;
      }
      frame.chosenCost = Number(frame.choice[0]);
      log(state, frame.controller, lg('choosesCost', `${ps.name} escolhe o custo ${frame.chosenCost}.`, { player: ps.name, n: frame.chosenCost }));
      return true;
    case 'revealOpponentTop': {
      const card = state.players[opponentOf(state, frame.controller)].deck[0];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, lg('revealsOppDeckTop', `${ps.name} revela ${cardDef(state, card).name} do topo do deck do oponente.`, { player: ps.name, card: cardDef(state, card).name }), { uids: [card] });
      return true;
    }
    case 'giveActiveDon': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseActiveDonReceiver', `${srcName}: escolha quem recebe DON!! ativo(s).`, { source: srcName, n: step.count }));
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        const n = Math.min(step.count, ps.donActive);
        if (loc && n) {
          ps.donActive -= n;
          loc.fc.don += n;
          emit(state, { kind: 'donGiven', player: loc.player, card: uid });
        }
      }
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
    case 'moveGivenDon': {
      // 1º: quem recebe; 2º: de quais cartas saem os DON!! anexados.
      if (!frame.memo) {
        const t = resolveTargets(state, frame, step.target, 'help', pr('chooseAttachedDonReceiver', `${srcName}: escolha quem recebe os DON!! anexados.`, { source: srcName }));
        if (!t) return false;
        if (!t.length) return true;
        frame.memo = [t[0]];
        frame.choice = undefined;
      }
      const dest = frame.memo[0];
      const sources = [ps.leader, ...ps.characters].filter((c) => c.uid !== dest && c.don > 0).map((c) => c.uid);
      if (!sources.length || !locate(state, dest)) return true;
      if (!frame.choice) {
        askCards(state, frame, sources, Math.min(step.count, sources.length), pr('chooseDonSources', `${srcName}: escolha de quais cartas saem os DON!! (até ${step.count} no total).`, { source: srcName, max: step.count }));
        return false;
      }
      let left = step.count;
      for (const uid of frame.choice.filter((u) => sources.includes(u))) {
        const from = locate(state, uid)!.fc;
        const share = frame.choice.length === 1 ? left : 1;
        const n = Math.min(share, from.don, left);
        from.don -= n;
        locate(state, dest)!.fc.don += n;
        left -= n;
      }
      if (left < step.count) {
        log(state, frame.controller, lg('receivesAttachedDon', `${cardDef(state, dest).name} recebe ${step.count - left} DON!! anexado(s).`, { card: cardDef(state, dest).name, n: step.count - left }), { cards: [dest] });
        emit(state, { kind: 'donGiven', player: frame.controller, card: dest });
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
    case 'drawPerMatching': {
      const n = targetCandidates(state, frame.controller, frame.source, step.spec).length;
      frame.eventCount = 0;
      if (!n || restricted(state, frame.controller, 'noDrawByEffect')) return true;
      const before = ps.hand.length;
      drawCards(state, frame.controller, n);
      frame.eventCount = ps.hand.length - before;
      log(state, frame.controller, lg('draws', `${ps.name} compra ${frame.eventCount} carta(s).`, { player: ps.name, n: frame.eventCount }));
      emit(state, { kind: 'drawByEffect', player: frame.controller });
      return true;
    }
    case 'trashEventCount': {
      const n = frame.eventCount ?? 0;
      if (!n) return true;
      if (step.from === 'deck') {
        const k = Math.min(n, ps.deck.length);
        ps.trash.push(...ps.deck.splice(0, k));
        if (k) log(state, frame.controller, lg('millsDeck', `${ps.name} descarta ${k} carta(s) do topo do deck.`, { player: ps.name, n: k }));
        return true;
      }
      frame.steps.splice(frame.i + 1, 0, { do: 'trashFromHand', count: n });
      return true;
    }
    case 'opponentPicksFromHand': {
      // O oponente escolhe com as cartas viradas para baixo: equivale a uma escolha ao acaso.
      const n = Math.min(step.count, ps.hand.length);
      for (let k = 0; k < n; k++) {
        const uid = ps.hand[Math.floor(nextRandom(state) * ps.hand.length)];
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        markHandTrashed(state, ps.id);
        log(state, frame.controller, lg('trashesChosenByOpponent', `${ps.name} descarta ${cardDef(state, uid).name} (escolhida pelo oponente).`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'revealOpponentHand': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const picked: string[] = [];
      const pool = [...opp.hand];
      for (let k = 0; k < step.count && pool.length; k++) picked.push(pool.splice(Math.floor(nextRandom(state) * pool.length), 1)[0]);
      frame.last = picked;
      frame.revealed = picked;
      if (picked.length) log(state, frame.controller, lg('reveals', `${opp.name} revela ${picked.map((u) => cardDef(state, u).name).join(', ')}.`, { player: opp.name, cards: picked.map((u) => cardDef(state, u).name).join(', ') }), { uids: picked });
      return true;
    }
    case 'opponentLifeToBottom': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.life.length);
      for (let k = 0; k < n; k++) opp.deck.push(takeLife(opp));
      if (n) {
        lifeRemoved(state, opp.id);
        log(state, frame.controller, lg('oppLifeToBottom', `${n} carta(s) da Vida de ${opp.name} vão para o fundo do deck.`, { n, player: opp.name }));
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
    case 'winGame':
      gameOver(state, frame.controller, lg('winByEffect', `${ps.name} vence pelo efeito de ${srcName}.`, { player: ps.name, source: srcName }));
      return true;
    case 'extraTurn':
      state.extraTurn = frame.controller;
      log(state, frame.controller, lg('extraTurn', `${ps.name} jogará um turno extra.`, { player: ps.name }));
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
    case 'opponentAddDon': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.donDeck);
      // "your opponent may add …": quem decide é o oponente.
      if (step.may && n > 0) {
        if (!frame.choice) {
          state.pending = {
            kind: 'confirm',
            player: opp.id,
            source: frame.source,
            ...promptOf(pr('opponentMayAddDon', `${srcName}: adicionar ${n} DON!! ativo(s) do seu deck de DON!!?`, { source: srcName, n })),
          };
          return false;
        }
        if (!frame.choice.length) {
          log(state, opp.id, lg('declinesAddDon', `${opp.name} não adiciona DON!!.`, { player: opp.name }));
          return true;
        }
      }
      opp.donDeck -= n;
      opp.donActive += n;
      if (n) log(state, frame.controller, lg('addsActiveDon', `${opp.name} adiciona ${n} DON!! ativo(s).`, { player: opp.name, n }));
      return true;
    }
    case 'donMatchOpponent': {
      // "until you have the same number of DON!! cards on your field as your opponent": com mais de dois, basta
      // um oponente (regra 10 do manual): vale o que tem mais DON!! (o que obriga a devolver menos).
      const extra = totalDonOnField(ps) - Math.max(...opponentSides(state, frame.controller).map((o) => totalDonOnField(state.players[o])));
      if (extra > 0) frame.steps.splice(frame.i + 1, 0, { do: 'returnDon', count: extra });
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
    case 'handAllToDeck': {
      const who = step.who === 'self' ? ps : state.players[opponentOf(state, frame.controller)];
      const n = who.hand.length;
      who.deck.push(...who.hand.splice(0));
      frame.eventCount = n;
      // "at the bottom of your deck in any order": vão para o fundo na ordem da mão, sem embaralhar
      // (como o "place the rest at the bottom of your deck in any order" das buscas).
      if (step.bottom) {
        log(state, frame.controller, lg('handToBottom', `${who.name} coloca ${n} carta(s) da mão no fundo do deck.`, { player: who.name, n }));
        return true;
      }
      shuffleInPlace(state, who.deck);
      log(state, frame.controller, lg('handToDeckShuffle', `${who.name} devolve ${n} carta(s) da mão ao deck e embaralha.`, { player: who.name, n }));
      return true;
    }
    case 'opponentDraws': {
      const o = state.players[opponentOf(state, frame.controller)];
      drawCards(state, o.id, step.count);
      log(state, frame.controller, lg('draws', `${o.name} compra ${step.count} carta(s).`, { player: o.name, n: step.count }));
      return true;
    }
    case 'trashHand': {
      const n = ps.hand.length;
      ps.trash.push(...ps.hand.splice(0));
      if (n) {
        markHandTrashed(state, ps.id);
        log(state, frame.controller, lg('trashesWholeHand', `${ps.name} descarta toda a mão (${n} carta(s)).`, { player: ps.name, n }));
        emit(state, { kind: 'handTrashedByEffect', player: frame.controller, card: frame.source, count: n });
      }
      return true;
    }
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
    case 'takeDamage':
      state.stack.push({
        kind: 'damage',
        defender: step.opponent ? opponentOf(state, frame.controller) : frame.controller,
        remaining: step.count,
        banish: false,
        ...(isMultiplayer(state) ? { by: frame.controller } : {}),
      });
      return true;
    case 'lifeTrashUntil': {
      const n = Math.max(0, ps.life.length - step.count);
      for (let k = 0; k < n; k++) ps.trash.push(takeLife(ps));
      if (n) {
        lifeRemoved(state, ps.id);
        log(state, frame.controller, lg('lifeToTrash', `${n} carta(s) de Vida de ${ps.name} vão para o descarte.`, { n, player: ps.name }));
      }
      return true;
    }
    case 'trashHandUntil': {
      const who = step.both ? [frame.controller, opponentOf(state, frame.controller)] : [frame.controller];
      const memo = frame.memo ?? [];
      // Um jogador por vez: memo guarda quem já descartou.
      const next = who.find((p) => !memo.includes(String(p)) && state.players[p].hand.length > step.count);
      if (next === undefined) return true;
      const pl = state.players[next];
      if (!frame.choice) {
        const n = pl.hand.length - step.count;
        state.pending = {
          kind: 'selectTargets',
          player: next,
          options: [...pl.hand],
          min: n,
          max: n,
          ...promptOf(pr('trashHandUntil', `${srcName}: descarte ${n} carta(s) até ficar com ${step.count} na mão.`, { source: srcName, n, max: step.count })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      const trashed = frame.choice.filter((u) => pl.hand.includes(u)).slice(0, pl.hand.length - step.count);
      for (const uid of trashed) {
        removeFrom(pl.hand, uid);
        pl.trash.push(uid);
      }
      log(state, next, lg('trashesCards', `${pl.name} descarta ${trashed.length} carta(s).`, { player: pl.name, n: trashed.length }));
      if (trashed.length) markHandTrashed(state, next);
      if (trashed.length && next === frame.controller) emit(state, { kind: 'handTrashedByEffect', player: next, card: frame.source, count: trashed.length });
      frame.memo = [...memo, String(next)];
      frame.choice = undefined;
      return !who.some((p) => !frame.memo!.includes(String(p)) && state.players[p].hand.length > step.count);
    }
    case 'negateOnPlay': {
      const who = step.who === 'self' ? frame.controller : opponentOf(state, frame.controller);
      const until: import('../types').Expiry = { untilTurn: state.turn };
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
    case 'drawEventCount': {
      const n = frame.eventCount ?? 0;
      if (n && !restricted(state, frame.controller, 'noDrawByEffect')) {
        drawCards(state, frame.controller, n);
        log(state, frame.controller, lg('draws', `${ps.name} compra ${n} carta(s).`, { player: ps.name, n }));
      }
      return true;
    }
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
    case 'trashFaceUpLife': {
      const up = ps.life.filter((u) => ps.lifeFaceUp?.includes(u));
      for (const uid of up) {
        removeFrom(ps.life, uid);
        removeFrom(ps.lifeFaceUp!, uid);
        ps.trash.push(uid);
      }
      if (up.length) {
        log(state, frame.controller, lg('trashesFaceUpLife', `${ps.name} descarta ${up.length} carta(s) de Vida virada(s) para cima.`, { player: ps.name, n: up.length }));
        lifeRemoved(state, ps.id);
      }
      return true;
    }
    case 'revealedToTopOrBottom': {
      const card = frame.revealed?.[0] ?? frame.last?.[0];
      if (!card || !ps.deck.includes(card)) return true;
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('revealedTopOrBottom', `${srcName}: ${cardDef(state, card).name} fica no topo ou vai para o fundo do deck?`, { source: srcName, card: cardDef(state, card).name }), ['Topo do deck', 'Fundo do deck'], DECK_TOP_BOTTOM);
        return false;
      }
      if (frame.choice[0] === '1') {
        removeFrom(ps.deck, card);
        ps.deck.push(card);
      }
      return true;
    }
    case 'lifeOneToDeckTop': {
      // "look at all your Life cards; place 1 at the top of your deck and place the rest back … in any order"
      if (!ps.life.length) return true;
      if (!frame.memo) {
        if (!frame.choice) {
          askCards(state, frame, [...ps.life].reverse(), 1, pr('chooseLifeToDeckTop', `${srcName}: escolha a carta de Vida que vai para o topo do deck.`, { source: srcName }), { min: 1 });
          return false;
        }
        const uid = frame.choice.find((u) => ps.life.includes(u));
        if (uid) {
          removeFrom(ps.life, uid);
          if (ps.lifeFaceUp?.includes(uid)) removeFrom(ps.lifeFaceUp, uid);
          ps.deck.unshift(uid);
          log(state, frame.controller, lg('lifeToDeckTop', `${ps.name} coloca 1 carta da Vida no topo do deck.`, { player: ps.name }));
          lifeRemoved(state, ps.id);
        }
        frame.memo = ['order'];
        frame.choice = undefined;
      }
      if (ps.life.length < 2) return true;
      if (!frame.choice) {
        askCards(state, frame, [...ps.life].reverse(), ps.life.length, pr('arrangeLife', `${srcName}: ordene as cartas de Vida (a primeira escolhida fica no topo).`, { source: srcName }), { min: ps.life.length, ordered: true });
        return false;
      }
      const order = frame.choice.filter((u) => ps.life.includes(u));
      if (order.length === ps.life.length) ps.life = [...order].reverse();
      return true;
    }
    case 'cannotBlock': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCannotBlockTarget', `${srcName}: escolha quem não poderá bloquear.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'cannotBlock', amount: 0, duration: step.duration });
      return true;
    }
    case 'returnGivenDon': {
      let left = step.count;
      const holders = [ps.leader, ...ps.characters].filter((c) => c.don > 0).sort((a, b) => b.don - a.don);
      for (const fc of holders) {
        const n = Math.min(fc.don, left);
        fc.don -= n;
        ps.donRested += n;
        left -= n;
        if (!left) break;
      }
      log(state, frame.controller, lg('returnsAttachedDon', `${ps.name} devolve ${step.count - left} DON!! anexado(s) à área de custo.`, { player: ps.name, n: step.count - left }));
      return true;
    }
    case 'lastToDeckTop': {
      for (const uid of (frame.last ?? []).filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.deck.unshift(uid);
        logSecret(
          state,
          frame.controller,
          lg('handCardToDeckTop', `${ps.name} coloca 1 carta da mão no topo do deck.`, { player: ps.name }),
          lg('cardBackToDeckTop', `${cardDef(state, uid).name} volta ao topo do deck.`, { card: cardDef(state, uid).name }),
          [uid],
        );
      }
      return true;
    }
    case 'koSelf':
      // canPayCost já recusou o custo se esta carta não pode ser nocauteada (1-3-3).
      if (locate(state, frame.source)?.zone === 'character') koCharacter(state, frame.source, { force: true });
      return true;
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
    case 'revealLifeTop': {
      const card = ps.life[ps.life.length - 1];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, lg('revealsLifeTop', `${ps.name} revela ${cardDef(state, card).name} do topo da Vida.`, { player: ps.name, card: cardDef(state, card).name }), { uids: [card] });
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
    case 'handToDeck': {
      if (!frame.memo) {
        const n = Math.min(step.count, ps.hand.length);
        if (!n) return true;
        if (!frame.choice) {
          askCards(state, frame, [...ps.hand], n, pr('chooseHandCardsToDeck', `${srcName}: escolha ${n} carta(s) da mão para colocar no deck.`, { source: srcName, n }), { min: n, intent: 'discard' });
          return false;
        }
        frame.memo = frame.choice.filter((u) => ps.hand.includes(u)).slice(0, n);
        frame.choice = undefined;
      }
      let where = step.where;
      if (where === 'choose') {
        if (!frame.choice) {
          askOption(state, frame, frame.controller, pr('deckTopOrBottom', `${srcName}: colocar no topo ou no fundo do deck?`, { source: srcName }), ['Topo do deck', 'Fundo do deck'], DECK_TOP_BOTTOM);
          return false;
        }
        where = frame.choice[0] === '0' ? 'top' : 'bottom';
      }
      for (const uid of frame.memo) {
        removeFrom(ps.hand, uid);
        if (where === 'top') ps.deck.unshift(uid);
        else ps.deck.push(uid);
      }
      log(
        state,
        frame.controller,
        lg(where === 'top' ? 'handToDeckTop' : 'handToBottom', `${ps.name} coloca ${frame.memo.length} carta(s) da mão no ${where === 'top' ? 'topo' : 'fundo'} do deck.`, {
          player: ps.name,
          n: frame.memo.length,
        }),
      );
      frame.memo = undefined;
      return true;
    }
    case 'lookOpponentTop': {
      // A carta aparece inteira só para quem olha (`shown`); o oponente e os espectadores veem
      // apenas que uma carta do topo foi olhada. O histórico guarda o nome só para quem olhou.
      const opp = state.players[opponentOf(state, frame.controller)];
      const card = opp.deck[0];
      if (!card) return true;
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('opponentDeckTopIs', `${srcName}: a carta do topo do deck do oponente é ${cardDef(state, card).name}.`, { source: srcName, card: cardDef(state, card).name }), ['OK'], ['common.ok'], undefined, [card]);
        return false;
      }
      logSecret(
        state,
        frame.controller,
        lg('looksOpponentDeckTop', `${ps.name} olha a carta do topo do deck de ${opp.name}.`, { player: ps.name, opponent: opp.name }),
        lg('looksOpponentDeckTopCard', `${ps.name} olha ${cardDef(state, card).name} no topo do deck de ${opp.name}.`, { player: ps.name, card: cardDef(state, card).name, opponent: opp.name }),
        [card],
      );
      return true;
    }
    case 'revealedToBottom': {
      const card = frame.revealed?.[0] ?? frame.last?.[0];
      if (card && ps.deck.includes(card)) {
        removeFrom(ps.deck, card);
        ps.deck.push(card);
      }
      return true;
    }
    case 'cannotBeRested': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCannotBeRestedTarget', `${srcName}: escolha quem não pode ser virado.`, { source: srcName }));
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'cannotBeRested', amount: 0, duration: step.duration });
      return true;
    }
    case 'opponentLifeToHand': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = upToCount(state, frame, step, opp.life.length, pr('howManyOpponentLifeToHand', `${srcName}: quantas cartas da Vida de ${opp.name} vão para a mão dele?`, { source: srcName, player: opp.name }));
      if (n === null) return false;
      for (let i = 0; i < n; i++) lifeToHandCard(state, opp.id, opp.life.pop()!);
      if (n) lifeRemoved(state, opp.id);
      if (n) log(state, frame.controller, lg('lifeToHand', `${opp.name} coloca ${n} carta(s) da Vida na mão.`, { player: opp.name, n }));
      return true;
    }
    case 'opponentHandToBottom': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options: [...opp.hand],
          min: n,
          max: n,
          ...promptOf(pr('chooseOwnHandCardsToBottom', `${srcName}: escolha ${n} carta(s) da sua mão para o fundo do deck.`, { source: srcName, n })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.hand.includes(u))) {
        removeFrom(opp.hand, uid);
        opp.deck.push(uid);
      }
      log(state, opp.id, lg('handToBottom', `${opp.name} coloca ${n} carta(s) da mão no fundo do deck.`, { player: opp.name, n }));
      return true;
    }
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
    case 'delayed': {
      const entry = { controller: frame.controller, source: frame.source, steps: step.steps, ...(step.keepChosen && frame.last ? { last: [...frame.last] } : {}) };
      if (step.when === 'battle' && state.battle) (state.battle.after ??= []).push(entry);
      else if (step.when !== 'battle') (state.delayed ??= []).push(entry);
      return true;
    }
    case 'lifeToHand': {
      if (restricted(state, frame.controller, 'noLifeToHand')) return true;
      const n = Math.min(step.count, ps.life.length);
      if (n === 0) return true;
      if (step.choose && ps.life.length > 1 && !frame.choice) {
        askOption(state, frame, frame.controller, pr('lifeFromWhere', `${srcName}: de onde tirar a carta de Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) lifeToHandCard(state, ps.id, fromBottom ? ps.life.shift()! : ps.life.pop()!);
      lifeRemoved(state, ps.id);
      log(
        state,
        frame.controller,
        lg(fromBottom ? 'lifeBottomToHand' : 'lifeTopToHand', `${ps.name} coloca ${n} carta(s) da Vida (${fromBottom ? 'fundo' : 'topo'}) na mão.`, { player: ps.name, n }),
      );
      return true;
    }
    case 'handToLife': {
      const options = [
        ...(step.trashOnly ? [] : discardable(state, frame.controller, step.filter)),
        ...(step.fromTrash || step.trashOnly ? ps.trash.filter((u) => matchesFilter(cardDef(state, u), step.filter ?? {})) : []),
      ];
      // Com "top or bottom": primeiro as cartas (memo), depois a posição.
      let picked = frame.memo;
      if (!picked) {
        if (!frame.choice) {
          if (!options.length && (step.trashOnly || !ps.hand.length)) return true;
          askCards(state, frame, options, step.upTo, pr(step.choose ? 'chooseHandCardsToLife' : 'chooseHandCardsToLifeTop', `${srcName}: escolha até ${step.upTo} carta(s) da mão para ${step.choose ? 'a' : 'o topo da'} Vida.`, { source: srcName, n: step.upTo }), step.trashOnly ? {} : { hidden: 'da mão' });
          return false;
        }
        picked = frame.choice.filter((u) => options.includes(u));
        if (step.choose && picked.length) {
          frame.memo = picked;
          frame.choice = undefined;
          askOption(state, frame, frame.controller, pr('lifeTopOrBottom', `${srcName}: colocar no topo ou no fundo da Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
          return false;
        }
      }
      const bottom = Boolean(step.choose) && frame.choice?.[0] === '1';
      // Da mão para a Vida com uma exigência ("up to 1 {Supernovas} type Character card"): a carta é
      // revelada (11-2-1), como na busca do deck para a mão; sai no log público com o nome. Sem
      // exigência (qualquer carta) não há o que conferir e ela vai escondida, como a carta que vai
      // do deck para a Vida (Q&A de regras). Do descarte ou virada para cima, ela já é pública.
      const filtered = Object.keys(step.filter ?? {}).length > 0;
      const shown = picked.filter((uid) => filtered || step.faceUp || ps.trash.includes(uid));
      for (const uid of picked) {
        removeFrom(ps.hand, uid);
        removeFrom(ps.trash, uid);
        if (bottom) ps.life.unshift(uid);
        else ps.life.push(uid);
        if (step.faceUp) (ps.lifeFaceUp ??= []).push(uid);
      }
      if (picked.length) {
        const names = shown.length ? ` (${shown.map((u) => cardDef(state, u).name).join(', ')})` : '';
        const from = step.trashOnly ? 'do descarte' : step.fromTrash ? 'da mão ou do descarte' : 'da mão';
        const reveal = filtered && !step.trashOnly;
        // Chave: revela (com nomes) | com nomes | sem nomes, e topo/fundo; a origem é uma parte traduzível.
        const key = `${reveal ? 'revealsToLife' : names ? 'toLifeNamed' : 'toLife'}${bottom ? 'Bottom' : 'Top'}`;
        log(
          state,
          frame.controller,
          lg(
            key,
            `${ps.name} ${reveal ? 'revela e ' : ''}coloca ${picked.length} carta(s) ${from}${names} no ${bottom ? 'fundo' : 'topo'} da Vida.`,
            { player: ps.name, n: picked.length, from, ...(names ? { cards: shown.map((u) => cardDef(state, u).name).join(', ') } : {}) },
            { from: { items: [{ key: step.trashOnly ? 'log.fromTrash' : step.fromTrash ? 'log.fromHandOrTrash' : 'log.fromHand' }] } },
          ),
          reveal ? { uids: shown, by: ps.id } : { cards: shown },
        );
      }
      return true;
    }
    case 'fieldToLife': {
      // Com "top or bottom": primeiro o alvo (memo), depois a posição.
      let targets = frame.memo;
      if (!targets) {
        const t = resolveTargets(state, frame, step.target, 'help', pr('chooseCharacterToLife', `${srcName}: escolha um Personagem para a Vida.`, { source: srcName }));
        if (!t) return false;
        targets = t.filter((u) => locate(state, u)?.zone === 'character' && !removalBlocked(state, u, frame.controller));
        if (step.choose && targets.length) {
          frame.memo = targets;
          frame.choice = undefined;
          askOption(state, frame, frame.controller, pr('lifeTopOrBottom', `${srcName}: colocar no topo ou no fundo da Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
          return false;
        }
      }
      const bottom = Boolean(step.choose) && frame.choice?.[0] === '1';
      removeFromField(state, targets.filter((u) => locate(state, u)?.zone === 'character'), 'life', {
        byPlayer: frame.controller,
        by: frame.source,
        ...(bottom ? { bottom: true } : {}),
        ...(step.faceUp ? { faceUp: true } : {}),
      });
      return true;
    }
    case 'peekLife': {
      const opp = step.whose === 'own' ? ps : state.players[opponentOf(state, frame.controller)];
      // Etapa 1: de quem é a Vida (memo[0] = 'own' | 'opp').
      if (!frame.memo) {
        const sides = (step.whose === 'either' ? ['own', 'opp'] : [step.whose === 'own' ? 'own' : 'opp']).filter(
          (side) => (side === 'own' ? ps : opp).life.length > 0,
        );
        if (!sides.length) return true;
        if (!frame.choice) {
          const labels = sides.map((side) => (side === 'own' ? 'Olhar a sua Vida' : 'Olhar a Vida do oponente'));
          const labelKeys = sides.map((side) => (side === 'own' ? 'engine.optPeekOwnLife' : 'engine.optPeekOpponentLife'));
          askOption(state, frame, frame.controller, pr('peekWhichLife', `${srcName}: olhar a carta do topo de qual Vida?`, { source: srcName }), [...labels, 'Não olhar'], [
            ...labelKeys,
            'engine.optDontPeek',
          ]);
          frame.memo = ['pick', ...sides];
          return false;
        }
      }
      if (frame.memo?.[0] === 'pick') {
        const sides = frame.memo.slice(1);
        const side = sides[Number(frame.choice?.[0])];
        if (!side) return true; // "Não olhar"
        frame.memo = [side];
        frame.choice = undefined;
      }
      const side = frame.memo![0];
      const life = (side === 'own' ? ps : opp).life;
      if (!frame.choice) {
        const card = life[life.length - 1];
        askOption(
          state,
          frame,
          frame.controller,
          pr('lifeTopIsWhere', `${srcName}: a carta do topo é ${cardDef(state, card).name}. Onde deixar?`, { source: srcName, card: cardDef(state, card).name }),
          ['Manter no topo', 'Colocar no fundo'],
          ['engine.optKeepOnTop', 'engine.optPlaceAtBottom'],
        );
        return false;
      }
      if (frame.choice[0] === '1') life.unshift(life.pop()!);
      log(
        state,
        frame.controller,
        lg(
          `peeksLife${side === 'own' ? 'Own' : 'Opponent'}${frame.choice[0] === '1' ? 'Bottom' : 'Top'}`,
          `${ps.name} olha a carta do topo da Vida ${side === 'own' ? 'própria' : 'do oponente'} e a deixa no ${frame.choice[0] === '1' ? 'fundo' : 'topo'}.`,
          { player: ps.name },
        ),
      );
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
    case 'handToDeckBottom': {
      const n = Math.min(step.count, ps.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, [...ps.hand], n, pr('chooseHandCardsToBottom', `${srcName}: escolha ${n} carta(s) da mão para o fundo do deck.`, { source: srcName, n }), {
          min: n,
          intent: 'discard',
        });
        return false;
      }
      for (const uid of frame.choice.filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.deck.push(uid);
      }
      log(state, frame.controller, lg('handToBottom', `${ps.name} coloca ${n} carta(s) da mão no fundo do deck.`, { player: ps.name, n }));
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
    case 'drawUntil': {
      const n = Math.max(0, step.count - ps.hand.length);
      if (n) {
        drawCards(state, frame.controller, n);
        log(state, frame.controller, lg('draws', `${ps.name} compra ${n} carta(s).`, { player: ps.name, n }));
      }
      return true;
    }
    case 'opponentReturnsDon': {
      const opp = state.players[opponentOf(state, frame.controller)];
      if (step.activeOnly) {
        const k = Math.min(step.count, opp.donActive);
        opp.donActive -= k;
        opp.donDeck += k;
        if (k) emit(state, { kind: 'donReturned', player: opp.id, count: k, byPlayer: frame.controller });
        return true;
      }
      // O oponente escolhe quais dos seus DON!! devolver.
      const n = Math.min(step.count, totalDonOnField(opp));
      if (n) frame.steps.splice(frame.i + 1, 0, { do: 'returnDon', count: n, opponent: true });
      return true;
    }
    case 'millDeck': {
      const n = Math.min(step.count, ps.deck.length);
      const milled = ps.deck.splice(0, n);
      ps.trash.push(...milled);
      // "If the trashed card has a cost of 6 or more"
      frame.last = milled;
      if (n) log(state, frame.controller, lg('millsDeck', `${ps.name} descarta ${n} carta(s) do topo do deck.`, { player: ps.name, n }));
      return true;
    }
    case 'useOwnEffect':
      return useOwnEffect(state, frame, step.timing);
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
    case 'addLifeFromDeck': {
      const n = upToCount(state, frame, step, ps.deck.length, pr('howManyDeckToLife', `${srcName}: quantas cartas do topo do deck adicionar à Vida?`, { source: srcName }));
      if (n === null) return false;
      for (let i = 0; i < n; i++) ps.life.push(ps.deck.shift()!);
      if (n) log(state, frame.controller, lg('deckToLife', `${ps.name} adiciona ${n} carta(s) do deck à Vida.`, { player: ps.name, n }));
      return true;
    }
    case 'useMainEffect':
      return useOwnEffect(state, frame, 'main');
    case 'useCounterEffect':
      return useOwnEffect(state, frame, 'counter');
    case 'toDeckBottom': {
      const t = resolveTargets(state, frame, step.target, 'harm', pr('chooseCharacterToBottom', `${srcName}: escolha um personagem para o fundo do deck.`, { source: srcName }));
      if (!t) return false;
      removeFromField(state, t.filter((u) => locate(state, u)?.zone === 'character'), 'deckBottom', { byPlayer: frame.controller, by: frame.source });
      return true;
    }
    case 'fromTrashToHand': {
      const options = ps.trash.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice) {
        if (!options.length) return true;
        askCards(state, frame, options, step.upTo, pr('chooseTrashCardsToHand', `${srcName}: escolha até ${step.upTo} carta(s) do descarte para a mão.`, { source: srcName, n: step.upTo }));
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.trash, uid);
        ps.hand.push(uid);
        log(state, frame.controller, lg('trashToHand', `${ps.name} adiciona ${cardDef(state, uid).name} do descarte à mão.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
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
    case 'shuffleDeck':
      shuffleInPlace(state, ps.deck);
      log(state, frame.controller, lg('shuffles', `${ps.name} embaralha o deck.`, { player: ps.name }));
      return true;
    case 'arrangeTop': {
      // "Look at N cards from the top of your deck and place them at the top or bottom of your deck in any
      // order": todas vão para o topo ou todas para o fundo, sem dividir (Q&A OP01-073; CR 1-3-7). 1ª pergunta:
      // topo ou fundo, com as cartas à mostra; 2ª (com 2 ou mais cartas): a ordem. `memo` = [destino, ...cartas].
      if (!frame.memo) {
        const top = ps.deck.slice(0, step.look);
        if (!top.length) return true;
        let where: 'top' | 'bottom' = 'top';
        // "place them at the top of your deck in any order": só a ordem.
        if (!step.topOnly) {
          if (!frame.choice) {
            // Olhar o deck é informação ganha: a ação deixa de ser cancelável.
            markRevealed(state);
            askOption(
              state,
              frame,
              frame.controller,
              pr('arrangeTopOrBottom', `${srcName}: estas são as ${top.length} cartas do topo. Ficam no topo ou vão para o fundo do deck?`, {
                source: srcName,
                count: top.length,
              }),
              ['Topo do deck', 'Fundo do deck'],
              DECK_TOP_BOTTOM,
              undefined,
              top,
            );
            return false;
          }
          where = frame.choice[0] === '1' ? 'bottom' : 'top';
        }
        frame.memo = [where, ...top];
        frame.choice = undefined;
        if (top.length > 1) {
          askCards(
            state,
            frame,
            top,
            top.length,
            where === 'top'
              ? pr('arrangeTopOrder', `${srcName}: clique nas cartas na ordem em que ficarão no topo (a primeira fica por cima; as que não escolher mantêm a ordem).`, { source: srcName })
              : pr('arrangeBottomOrder', `${srcName}: clique nas cartas na ordem em que irão para o fundo (a última escolhida fica por baixo de tudo; as que não escolher mantêm a ordem).`, {
                  source: srcName,
                }),
            { ordered: true },
          );
          return false;
        }
      }
      const [where, ...cards] = frame.memo;
      const chosen = (frame.choice ?? []).filter((u) => cards.includes(u));
      const order = [...chosen, ...cards.filter((u) => !chosen.includes(u))];
      for (const uid of order) removeFrom(ps.deck, uid);
      if (where === 'bottom') {
        ps.deck.push(...order);
        log(state, frame.controller, lg('placesAtBottom', `${ps.name} coloca ${order.length} carta(s) no fundo do deck.`, { player: ps.name, n: order.length }));
      } else {
        ps.deck.unshift(...order);
        log(state, frame.controller, lg('returnsToDeckTop', `${ps.name} devolve ${order.length} carta(s) ao topo do deck.`, { player: ps.name, n: order.length }));
      }
      return true;
    }
  }
}
