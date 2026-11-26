// Ações: `applyAction` copia o estado e aplica a ação (da Fase Principal ou a resposta a uma pergunta).

import { shuffleInPlace } from '../rng';
import type { Action, GameState, PlayerState } from '../types';
import { type DamageFrame, HAND_SIZE, IllegalActionError } from './constants';
import { lg, log, logSecret } from './messages';
import { opponent, opponentsOf } from './table';
import { cardDef, counterValue, getPower, locate, matchesFilter, ownerOf } from './queries';
import { activateError, attackError, counterTargets, forgetCard, playCost, playError, usedKey } from './options';
import { chooseCurve, continueSetup, startOfGame } from './setup';
import { cancelError, detachDonError, makeCheckpoint, restoreCheckpoint, settleCancel } from './cancel';
import { pushEffect, run } from './stack';
import { activateTriggered, emit, pushAbilities } from './triggers';
import { payImmediateCost } from './costs';
import { applyManualOp, manualAllowed } from './manual';
import { detach, drawCards, lifeToHandCard, limboToTrash, payDon, removeFrom, restCard } from './zones';
import { checkDefeat, eliminate } from './defeat';

/**
 * Cópia profunda do estado (só objetos simples, listas e primitivos), umas 4× mais rápida que o
 * `structuredClone` — o bot com busca copia o estado a cada jogada simulada. Como o
 * `structuredClone`, um objeto que aparece em dois lugares (ex.: `memo` de um efeito e as opções da
 * escolha pendente) continua sendo um só na cópia.
 */
export function cloneState<T>(root: T): T {
  const seen = new Map<object, unknown>();
  const copy = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null) return v;
    const hit = seen.get(v);
    if (hit !== undefined) return hit;
    if (Array.isArray(v)) {
      const out: unknown[] = new Array(v.length);
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) out[i] = copy(v[i]);
      return out;
    }
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const k in v) out[k] = copy((v as Record<string, unknown>)[k]);
    return out;
  };
  return copy(root) as T;
}

export function applyAction(prev: GameState, action: Action): GameState {
  if (prev.phase === 'gameover') throw new IllegalActionError('A partida já terminou.');
  // As definições das cartas não mudam durante a partida: são compartilhadas, não copiadas.
  const { defs, ...rest } = prev;
  const state = cloneState(rest) as GameState;
  state.defs = defs;
  // Cartas reveladas da mão que já saíram dela deixam de ser lembradas.
  if (state.knownHand?.length) {
    const kept = state.knownHand.filter((u) => state.players.some((ps) => ps.hand.includes(u)));
    if (kept.length) state.knownHand = kept;
    else delete state.knownHand;
  }
  const p = action.player;
  const pending = state.pending;

  if (action.type === 'concede' || action.type === 'timeout') {
    const name = state.players[p]?.name;
    if (name === undefined || state.players[p].out) throw new IllegalActionError('Jogador fora da partida.');
    const reason =
      action.type === 'concede'
        ? lg('winConcede', `${name} desistiu.`, { player: name })
        : action.abandoned
          ? lg('winAbandoned', `${name} abandonou a partida.`, { player: name })
          : lg('winTimeout', `${name} ficou sem tempo.`, { player: name });
    // Com dois jogadores a partida acaba; numa mesa maior ele é eliminado e a mesa segue.
    eliminate(state, [p], () => reason, reason);
    if (state.phase !== 'gameover') {
      // A ação em andamento de outro jogador não volta para antes da saída dele.
      delete state.cancel;
      delete state.checkpoint;
      run(state);
    }
    state.actionCount++;
    return state;
  }

  if (action.type === 'cancel') {
    const err = cancelError(prev, p);
    if (err) throw new IllegalActionError(err);
    if (!state.checkpoint) throw new IllegalActionError('Não é possível cancelar a partir de uma visão da partida.');
    restoreCheckpoint(state, p);
    state.actionCount++;
    return state;
  }

  if (action.type === 'judge') {
    // O Judge corrige a mesa (efeito que o motor não fez como devia): vale com qualquer pendência e
    // fora da vez, sempre pelas regras da ferramenta manual do lado de `player`.
    if (prev.phase !== 'main') throw new IllegalActionError('O Judge só corrige a mesa depois do mulligan.');
    log(state, null, lg('judgeIntervention', `⚖ Correção do Judge (${action.by}):`, { name: action.by }));
    applyManualOp(state, p, action.op);
    // A ação em andamento não pode mais ser cancelada: voltar ao checkpoint apagaria a correção.
    delete state.cancel;
    delete state.checkpoint;
    checkDefeat(state);
    run(state);
    state.actionCount++;
    return state;
  }

  if (action.type === 'manual') {
    if (!manualAllowed(prev, p)) throw new IllegalActionError('Ferramentas manuais indisponíveis agora.');
    // Ação já terminada: a correção manual não pode ser desfeita junto com ela.
    if (state.cancel?.done) {
      delete state.cancel;
      delete state.checkpoint;
    }
    applyManualOp(state, p, action.op);
    checkDefeat(state);
    run(state);
    settleCancel(state, p);
    state.actionCount++;
    return state;
  }

  if (pending) {
    if (pending.player !== p) throw new IllegalActionError('Aguardando o outro jogador.');
    if (pending.kind === 'confirm' && action.type === 'answer' && action.yes && state.cancel?.player === p) state.cancel.paid = true;
    handlePendingResponse(state, action);
  } else {
    if (state.phase !== 'main' || state.activePlayer !== p) throw new IllegalActionError('Não é o seu turno.');
    if (state.stack.length || state.triggered?.length) throw new IllegalActionError('Há efeitos em resolução.');
    // Guarda o estado de antes: se a ação parar numa escolha do próprio jogador, ele pode cancelar.
    const checkpoint = makeCheckpoint(prev);
    handleMainAction(state, action);
    state.checkpoint = checkpoint;
    state.cancel = { player: p, action, ...(action.type === 'activate' ? { paid: true as const } : {}) };
  }

  run(state);
  settleCancel(state, p);
  state.actionCount++;
  return state;
}

/** Qualquer ação que possa ter contado com os DON!! anexados prende todos os DON!! soltos do jogador. */
export function lockDon(ps: PlayerState) {
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) delete fc.donLoose;
}

function handlePendingResponse(state: GameState, action: Action) {
  const pending = state.pending!;
  const p = action.player;

  switch (pending.kind) {
    case 'chooseFirst': {
      if (action.type !== 'answer') throw new IllegalActionError('Escolha se você joga primeiro ou segundo.');
      const first = action.yes ? p : opponent(p);
      state.firstPlayer = first;
      state.activePlayer = first;
      log(
        state,
        p,
        lg(action.yes ? 'choseFirst' : 'choseSecond', `${state.players[p].name} escolheu jogar ${action.yes ? 'primeiro' : 'segundo'}.`, {
          player: state.players[p].name,
        }),
      );
      log(state, null, lg('goesFirst', `${state.players[first].name} joga primeiro.`, { player: state.players[first].name }));
      state.pending = { kind: 'mulligan', player: first };
      startOfGame(state);
      return;
    }
    case 'mulligan': {
      if (action.type !== 'mulligan') throw new IllegalActionError('Escolha manter ou trocar a mão.');
      const ps = state.players[p];
      if (action.redraw) {
        ps.deck.push(...ps.hand);
        ps.hand = [];
        shuffleInPlace(state, ps.deck);
        drawCards(state, p, HAND_SIZE);
        log(state, p, lg('mulliganRedraw', `${ps.name} trocou a mão inicial.`, { player: ps.name }));
      } else {
        log(state, p, lg('mulliganKeep', `${ps.name} manteve a mão inicial.`, { player: ps.name }));
      }
      ps.mulliganDone = true;
      state.pending = null;
      continueSetup(state);
      return;
    }

    case 'selectTargets': {
      if (action.type !== 'choose') throw new IllegalActionError('Escolha os alvos.');
      const uids = [...new Set(action.uids)];
      if (uids.length < pending.min || uids.length > pending.max) {
        throw new IllegalActionError(`Escolha entre ${pending.min} e ${pending.max} alvo(s).`);
      }
      if (uids.some((u) => !pending.options.includes(u))) throw new IllegalActionError('Alvo inválido.');
      // "Até N" deixado em branco com cartas à escolha: fica no histórico, senão para o oponente (e no
      // replay) parece que o efeito falhou ("[Trigger] Absalom ativado!" e nada acontece). Não numa
      // escolha escondida (da mão, do deck): a linha contaria ao oponente que havia carta válida.
      if (!uids.length && pending.options.length && pending.max > 0 && !pending.hidden) {
        const src = cardDef(state, pending.source).name;
        const name = state.players[p].name;
        log(state, p, lg('skipChoice', `${src}: ${name} não escolheu nenhuma carta.`, { source: src, player: name }), { cards: [pending.source] });
      }
      const top = state.stack[state.stack.length - 1];
      if (top.kind === 'effect') top.choice = uids;
      else if (top.kind === 'play') top.replaceChoice = uids;
      state.pending = null;
      return;
    }

    case 'block': {
      if (action.type !== 'choose') throw new IllegalActionError('Escolha um bloqueador ou nenhum.');
      if (action.uids.length > 1) throw new IllegalActionError('Apenas um bloqueador.');
      state.pending = null;
      const blocker = action.uids[0];
      if (blocker) {
        if (!pending.options.includes(blocker)) throw new IllegalActionError('Bloqueador inválido.');
        restCard(state, blocker);
        state.battle!.target = blocker;
        state.battle!.blocked = true;
        log(state, p, lg('blocks', `${cardDef(state, blocker).name} bloqueia o ataque!`, { card: cardDef(state, blocker).name }), { cards: [blocker] });
        pushAbilities(state, blocker, 'onBlock');
        emit(state, { kind: 'blockerActivated', player: p, card: blocker });
      }
      return;
    }

    case 'counter': {
      const ps = state.players[p];
      if (action.type === 'pass') {
        state.pending = null;
        // Um terceiro passou: a etapa segue com o próximo (e o defensor por último).
        if (pending.bystander) state.battle!.bystanders = (state.battle!.bystanders ?? []).filter((id) => id !== p);
        else state.battle!.step = 'damage';
        return;
      }
      if (action.type !== 'counter') throw new IllegalActionError('Use um Counter ou passe.');
      if (!pending.options.includes(action.uid)) throw new IllegalActionError('Carta de Counter inválida.');
      const def = cardDef(state, action.uid);
      const isEvent = def.category === 'event';
      // Sem alvo, o valor de Counter vai para o atacado; com alvo, para o Líder ou 1 Personagem do defensor.
      const target = action.target ?? state.battle!.target;
      if (action.target !== undefined) {
        if (isEvent) throw new IllegalActionError('O Evento [Counter] escolhe os alvos no próprio efeito.');
        if (!counterTargets(state, p).includes(target)) throw new IllegalActionError('O Counter só pode ir para o seu Líder ou um Personagem seu.');
      }
      // Custo com as reduções da carta na mão (2-7-6), lido antes de ela sair da mão.
      const cost = isEvent ? playCost(state, action.uid) : 0;
      if (isEvent) {
        const red = (state.costReductions ?? []).findIndex((r) => r.player === p && matchesFilter(def, r.filter));
        if (red >= 0) state.costReductions!.splice(red, 1);
      }
      removeFrom(ps.hand, action.uid);
      ps.trash.push(action.uid);
      state.pending = null;
      if (!isEvent) {
        const amount = counterValue(state, action.uid);
        state.modifiers.push({ uid: target, kind: 'power', amount, duration: 'battle' });
        log(state, p, lg('counter', `Counter: ${def.name} dá +${amount} a ${cardDef(state, target).name}.`, { card: def.name, amount, target: cardDef(state, target).name }), { cards: [action.uid, target] });
      } else {
        payDon(ps, cost);
        const ability = def.abilities.find((a) => a.timing === 'counter')!;
        log(state, p, lg('usesEvent', `${ps.name} usa o evento ${def.name}.`, { player: ps.name, card: def.name }), { cards: [action.uid] });
        pushEffect(state, action.uid, p, ability.steps);
        emit(state, { kind: 'eventActivated', player: p, card: action.uid });
        (state.eventsThisTurn ??= []).push({ player: p, cost: def.cost ?? 0 });
      }
      return;
    }

    case 'option': {
      if (action.type !== 'option') throw new IllegalActionError('Escolha uma das opções.');
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= pending.options.length) {
        throw new IllegalActionError('Opção inválida.');
      }
      state.pending = null;
      if (pending.order) {
        const chosen = state.triggered?.find((e) => e.id === pending.order![action.index]);
        if (chosen) activateTriggered(state, chosen);
        return;
      }
      if (pending.curve) {
        chooseCurve(state, p, action.index === 0 ? 'odd' : 'even');
        continueSetup(state);
        return;
      }
      const top = state.stack[state.stack.length - 1];
      if (top?.kind === 'effect') top.choice = [String(action.index)];
      state.pending = null;
      return;
    }

    case 'confirm': {
      if (action.type !== 'answer') throw new IllegalActionError('Responda sim ou não.');
      if (action.yes && pending.cannot) throw new IllegalActionError('Não dá para pagar o custo.');
      const top = state.stack[state.stack.length - 1];
      if (top?.kind === 'effect') top.choice = action.yes ? ['yes'] : [];
      state.pending = null;
      return;
    }

    case 'manual': {
      if (action.type !== 'manualDone') throw new IllegalActionError('Aplique o efeito e clique em Concluir.');
      const top = state.stack[state.stack.length - 1];
      if (top?.kind === 'effect') top.choice = [];
      state.pending = null;
      log(state, p, lg('manualResolved', `Efeito de ${cardDef(state, pending.source).name} resolvido manualmente.`, { card: cardDef(state, pending.source).name }), { cards: [pending.source] });
      return;
    }

    case 'lifeCard': {
      if (action.type !== 'answer') throw new IllegalActionError('Responda se ativa o [Trigger] ou coloca a carta na mão.');
      const card = pending.card;
      const def = cardDef(state, card);
      const trig = def.abilities.find((a) => a.timing === 'trigger');
      if (action.yes && !trig) throw new IllegalActionError('Esta carta não tem [Trigger].');
      const frame = state.stack[state.stack.length - 1] as DamageFrame;
      const ps = state.players[p];
      frame.lifeCard = undefined;
      state.pending = null;
      if (action.yes) {
        if (ps.lifeFaceUp?.includes(card)) removeFrom(ps.lifeFaceUp, card);
        // Enquanto o [Trigger] resolve, a carta não está em área nenhuma (10-1-5-3): não conta
        // no descarte nem na Vida e não sai "from your trash" (Q&A OP14-082, OP15-097, OP15-079).
        // Vai para o descarte quando o efeito termina, se ele não a moveu (jogada, mão...).
        (state.limbo ??= []).push(card);
        // A carta vai junto (`revealed`): a interface sem animações mostra ao oponente qual foi.
        log(state, p, lg('triggerActivated', `[Trigger] ${def.name} ativado!`, { card: def.name }), { uids: [card], by: p });
        pushEffect(state, card, p, trig!.steps);
        const top = state.stack[state.stack.length - 1];
        if (top.kind === 'effect' && top.source === card) top.trigger = true;
        else limboToTrash(state, card);
        emit(state, { kind: 'triggerActivated', player: p, card });
      } else {
        // Para o oponente a linha é a mesma com ou sem [Trigger]; só o dono lê qual carta foi.
        logSecret(
          state,
          p,
          lg('lifeCardToHand', `${ps.name} coloca a carta de Vida na mão.`, { player: ps.name }),
          lg('lifeCardToHandSecret', `${ps.name} coloca ${def.name} (da Vida) na mão.`, { player: ps.name, card: def.name }),
          [card],
        );
        lifeToHandCard(state, ps.id, card);
      }
      return;
    }
  }
}

function handleMainAction(state: GameState, action: Action) {
  const p = action.player;
  const ps = state.players[p];
  if (action.type !== 'attachDon' && action.type !== 'detachDon') lockDon(ps);

  switch (action.type) {
    case 'playCard': {
      const err = playError(state, p, action.uid);
      if (err) throw new IllegalActionError(err);
      const def = cardDef(state, action.uid);
      const cost = playCost(state, action.uid);
      const red = (state.costReductions ?? []).findIndex((r) => r.player === p && matchesFilter(def, r.filter));
      if (red >= 0) state.costReductions!.splice(red, 1);
      removeFrom(ps.hand, action.uid);
      payDon(ps, cost);
      if (def.category === 'character') {
        log(state, p, lg('plays', `${ps.name} joga ${def.name}.`, { player: ps.name, card: def.name }), { cards: [action.uid] });
        state.stack.push({ kind: 'play', uid: action.uid, fromHand: true });
      } else if (def.category === 'stage') {
        if (ps.stage) {
          const old = ps.stage.uid;
          detach(state, old);
          ps.trash.push(old);
        }
        forgetCard(state, action.uid);
        ps.stage = { uid: action.uid, rested: false, don: 0, playedOnTurn: state.turn };
        log(state, p, lg('playsStage', `${ps.name} joga o Stage ${def.name}.`, { player: ps.name, card: def.name }), { cards: [action.uid] });
        pushAbilities(state, action.uid, 'onPlay');
      } else {
        ps.trash.push(action.uid);
        log(state, p, lg('usesEvent', `${ps.name} usa o evento ${def.name}.`, { player: ps.name, card: def.name }), { cards: [action.uid] });
        const main = def.abilities.find((a) => a.timing === 'main')!;
        pushEffect(state, action.uid, p, main.steps);
        emit(state, { kind: 'eventActivated', player: p, card: action.uid });
        (state.eventsThisTurn ??= []).push({ player: p, cost: def.cost ?? 0 });
      }
      return;
    }

    case 'attachDon': {
      if (ps.donActive < 1) throw new IllegalActionError('Nenhum DON!! ativo.');
      const loc = locate(state, action.target);
      if (!loc || loc.player !== p || loc.zone === 'stage') throw new IllegalActionError('Alvo inválido.');
      ps.donActive--;
      loc.fc.don++;
      emit(state, { kind: 'donGiven', player: p, card: action.target });
      // Anexar disparou um efeito: o DON!! já foi "usado". Senão, ele pode voltar (detachDon).
      if (state.stack.length || state.triggered?.length) lockDon(ps);
      else loc.fc.donLoose = (loc.fc.donLoose ?? 0) + 1;
      return;
    }

    case 'detachDon': {
      const err = detachDonError(state, p, action.target);
      if (err) throw new IllegalActionError(err);
      const loc = locate(state, action.target)!;
      loc.fc.don--;
      loc.fc.donLoose!--;
      if (!loc.fc.donLoose) delete loc.fc.donLoose;
      ps.donActive++;
      log(state, p, lg('detachDon', `${ps.name} devolve 1 DON!! de ${cardDef(state, action.target).name} à área de custo.`, { player: ps.name, card: cardDef(state, action.target).name }), { cards: [action.target] });
      return;
    }

    case 'activate': {
      const err = activateError(state, p, action.uid, action.ability);
      if (err) throw new IllegalActionError(err);
      const loc = locate(state, action.uid)!;
      const ability = cardDef(state, action.uid).abilities[action.ability];
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(action.uid, action.ability));
      {
        const card = cardDef(state, action.uid).name;
        // O rótulo da habilidade vai como parte traduzível quando tem chave (`labelKey`).
        log(
          state,
          p,
          ability.label === undefined
            ? lg('activatedEffect', `${card}: efeito ativado.`, { card })
            : lg(
                'activated',
                `${card}: ${ability.label}.`,
                { card, label: ability.label },
                ability.labelKey ? { label: { items: [{ key: ability.labelKey, ...(ability.labelParams ? { params: ability.labelParams } : {}) }] } } : undefined,
              ),
          { cards: [action.uid] },
        );
      }
      // Custos com escolha (descartar, virar cartas…) resolvem antes do efeito.
      const steps = ability.cost ? payImmediateCost(state, p, action.uid, ability.cost) : [];
      pushEffect(state, action.uid, p, [...steps, ...ability.steps]);
      return;
    }

    case 'attack': {
      const err = attackError(state, p, action.attacker, action.target);
      if (err) throw new IllegalActionError(err);
      state.battle = {
        attacker: action.attacker,
        target: action.target,
        originalTarget: action.target,
        step: 'whenAttacking',
        blocked: false,
        noBlocker: state.modifiers.some((m) => m.uid === action.attacker && m.kind === 'noBlockerWhenAttacking'),
        noBlockerMinPower: null,
      };
      log(
        state,
        p,
        lg(
          'attacks',
          `${cardDef(state, action.attacker).name} (${getPower(state, action.attacker)}) ataca ${cardDef(state, action.target).name} (${getPower(state, action.target)}).`,
          {
            card: cardDef(state, action.attacker).name,
            power: getPower(state, action.attacker),
            target: cardDef(state, action.target).name,
            targetPower: getPower(state, action.target),
          },
        ),
        { cards: [action.attacker, action.target] },
      );
      state.stack.push({ kind: 'battle' });
      // Virar o atacante pode disparar "When this Character becomes rested" (resolve antes da batalha seguir).
      restCard(state, action.attacker);
      const tax = state.modifiers.find((m) => m.uid === action.attacker && m.kind === 'attackTax');
      if (tax) pushEffect(state, action.attacker, p, [{ do: 'trashFromHand', count: tax.amount }]);
      // "When your Leader … attacks or is attacked"
      for (const lead of [action.attacker, action.target]) {
        if (locate(state, lead)?.zone === 'leader') emit(state, { kind: 'leaderBattle', player: ownerOf(state, lead), card: lead });
      }
      // [When Attacking] e [On Your Opponent's Attack] disparam na declaração do ataque, junto com
      // os "When your Leader attacks": mesmo lote, o jogador escolhe a ordem (8-6-1). Os do jogador
      // do turno resolvem antes (10-2-16).
      pushAbilities(state, action.attacker, 'whenAttacking');
      // Com mais de dois na mesa, "your opponent's attack" é o ataque de qualquer oponente, mesmo a outra
      // mesa: reagem todos os oponentes do atacante, o defensor primeiro.
      const defender = ownerOf(state, action.target);
      for (const id of [defender, ...opponentsOf(state, p).filter((o) => o !== defender)]) {
        const def = state.players[id];
        for (const fc of [def.leader, ...def.characters, ...(def.stage ? [def.stage] : [])]) {
          pushAbilities(state, fc.uid, 'onOpponentAttack');
        }
      }
      return;
    }

    case 'endTurn': {
      // End Phase (6-6-1-1): os [End of Your Turn] do jogador do turno e os [End of Your Opponent's
      // Turn] do outro ativam juntos (mesmo lote: os do jogador do turno resolvem primeiro, 8-6-1).
      // Os "at the end of this turn" entram depois deles, no frame `endTurn` (6-6-1-2).
      state.stack.push({ kind: 'endTurn' });
      for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) pushAbilities(state, fc.uid, 'endOfTurn');
      for (const other of opponentsOf(state, p).map((o) => state.players[o])) {
        for (const fc of [other.leader, ...other.characters, ...(other.stage ? [other.stage] : [])]) pushAbilities(state, fc.uid, 'endOfOpponentTurn');
      }
      return;
    }

    default:
      throw new IllegalActionError(`Ação ${action.type} não permitida agora.`);
  }
}
