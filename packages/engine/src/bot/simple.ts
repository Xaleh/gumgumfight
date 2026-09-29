// Bot heurístico simples. O objetivo não é jogar bem, e sim produzir partidas
// plausíveis para testar a interface e o motor.

import { legalActions } from '../actions';
import { cardDef, getPower, locate, opponent } from '../engine';
import type { Action, GameState, PlayerId } from '../types';

export function chooseBotAction(state: GameState, player: PlayerId): Action {
  const actions = legalActions(state, player);
  if (!actions.length) throw new Error('O bot não tem ações legais.');
  const pending = state.pending;
  if (pending) return choosePending(state, player, actions);
  return chooseMain(state, player, actions);
}

function value(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  return (def.cost ?? 0) * 1000 + getPower(state, uid);
}

function choosePending(state: GameState, player: PlayerId, actions: Action[]): Action {
  const pending = state.pending!;
  const me = state.players[player];

  switch (pending.kind) {
    case 'mulligan': {
      const cheap = me.hand.filter((u) => {
        const d = cardDef(state, u);
        return d.category === 'character' && (d.cost ?? 0) <= 3;
      }).length;
      return { type: 'mulligan', player, redraw: cheap < 2 };
    }

    case 'trigger':
      return { type: 'answer', player, yes: true };

    case 'selectTargets': {
      const opts = [...pending.options];
      if (pending.intent === 'discard') {
        opts.sort((a, b) => value(state, a) - value(state, b));
        return { type: 'choose', player, uids: [opts[0]] };
      }
      if (pending.intent === 'harm') {
        opts.sort((a, b) => value(state, b) - value(state, a));
        return { type: 'choose', player, uids: [opts[0]] };
      }
      // help: prioriza quem está na batalha, depois quem ainda pode atacar.
      const b = state.battle;
      if (b && opts.includes(b.target) && locate(state, b.target)?.player === player) {
        return { type: 'choose', player, uids: [b.target] };
      }
      if (b && opts.includes(b.attacker)) return { type: 'choose', player, uids: [b.attacker] };
      const active = opts.filter((u) => !locate(state, u)?.fc.rested);
      const pool = active.length ? active : opts;
      const leader = pool.find((u) => u === me.leader.uid);
      return { type: 'choose', player, uids: [leader ?? pool[0]] };
    }

    case 'block': {
      const b = state.battle!;
      const ap = getPower(state, b.attacker);
      const tp = getPower(state, b.target);
      const targetIsLeader = b.target === me.leader.uid;
      const dangerous = targetIsLeader ? me.life.length <= 1 && ap >= tp : ap >= tp && value(state, b.target) >= 6000;
      if (dangerous) {
        const blockers = [...pending.options].sort((x, y) => value(state, x) - value(state, y));
        return { type: 'choose', player, uids: [blockers[0]] };
      }
      return { type: 'choose', player, uids: [] };
    }

    case 'counter': {
      const b = state.battle!;
      const ap = getPower(state, b.attacker);
      const tp = getPower(state, b.target);
      if (ap < tp) return { type: 'pass', player };
      const targetIsLeader = b.target === me.leader.uid;
      const worth = targetIsLeader ? me.life.length <= 2 : (cardDef(state, b.target).cost ?? 0) >= 4;
      if (!worth) return { type: 'pass', player };
      const need = ap - tp + 1;
      const boost = (uid: string) => {
        const d = cardDef(state, uid);
        return d.category === 'character' ? d.counter ?? 0 : 3000;
      };
      const total = pending.options.reduce((s, u) => s + boost(u), 0);
      if (total < need) return { type: 'pass', player };
      // Usa o menor Counter que resolve sozinho; senão o maior disponível.
      const sorted = [...pending.options].sort((x, y) => boost(x) - boost(y));
      const single = sorted.find((u) => boost(u) >= need);
      return { type: 'counter', player, uid: single ?? sorted[sorted.length - 1] };
    }
  }
}

function chooseMain(state: GameState, player: PlayerId, actions: Action[]): Action {
  const me = state.players[player];
  const opp = state.players[opponent(player)];
  const canBattle = state.turn > 2;
  const find = <T extends Action['type']>(type: T, pred: (a: Extract<Action, { type: T }>) => boolean = () => true) =>
    actions.find((a): a is Extract<Action, { type: T }> => a.type === type && pred(a as Extract<Action, { type: T }>));

  // 1) Habilidades que dão DON!! virados (só vale se houver DON!! virados e ataques possíveis).
  const giveDon = find('activate', (a) => {
    const ab = cardDef(state, a.uid).abilities[a.ability];
    return ab.steps[0]?.do === 'giveRestedDon' && me.donRested > 0 && canBattle && !ab.cost?.restSelf;
  });
  if (giveDon) return giveDon;

  // 2) Jogar cartas: personagem mais caro, stage, eventos com alvo.
  const plays = actions
    .filter((a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard')
    .filter((a) => {
      const def = cardDef(state, a.uid);
      if (def.category === 'stage') return !me.stage;
      if (def.category === 'character') return me.characters.length < 5;
      const main = def.abilities.find((ab) => ab.timing === 'main');
      const step = main?.steps[0];
      if (!step) return false;
      if (step.do === 'ko' || step.do === 'rest') return opp.characters.length > 0 && canBattle;
      return false;
    })
    .sort((a, b) => (cardDef(state, b.uid).cost ?? 0) - (cardDef(state, a.uid).cost ?? 0));
  if (plays.length) return plays[0];

  // 3) Outras habilidades ativáveis úteis.
  const other = find('activate', (a) => {
    const ab = cardDef(state, a.uid).abilities[a.ability];
    const step = ab.steps[0];
    if (!step || !canBattle) return false;
    if (step.do === 'rest') return opp.characters.some((c) => !c.rested);
    if (step.do === 'giveRestedDon') return me.donRested > 0;
    if (step.do === 'power') return !me.leader.rested;
    return false;
  });
  if (other) return other;

  if (canBattle) {
    // 4) Anexar DON!!: primeiro no líder até superar o líder oponente, depois nos personagens.
    const oppLeaderPower = getPower(state, opp.leader.uid);
    const attackers = [me.leader, ...me.characters].filter(
      (fc) => !fc.rested && actions.some((a) => a.type === 'attack' && a.attacker === fc.uid),
    );
    for (const fc of attackers) {
      if (getPower(state, fc.uid) < oppLeaderPower + 1000) {
        const attach = find('attachDon', (a) => a.target === fc.uid);
        if (attach && keepDonForLeaderAbility(state, player) < me.donActive) return attach;
      }
    }

    // 5) Atacar.
    const attacks = actions.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack');
    for (const fc of attackers) {
      const ap = getPower(state, fc.uid);
      const mine = attacks.filter((a) => a.attacker === fc.uid);
      const koTarget = mine
        .filter((a) => a.target !== opp.leader.uid && getPower(state, a.target) <= ap)
        .sort((x, y) => value(state, y.target) - value(state, x.target))[0];
      if (koTarget && (cardDef(state, koTarget.target).cost ?? 0) >= 3) return koTarget;
      const leaderAttack = mine.find((a) => a.target === opp.leader.uid);
      if (leaderAttack && ap >= oppLeaderPower) return leaderAttack;
      if (koTarget) return koTarget;
    }

    // 6) Habilidades de "desvirar" (ex.: líder Kid) depois dos ataques.
    const setActive = find('activate', (a) => {
      const ab = cardDef(state, a.uid).abilities[a.ability];
      return ab.steps[0]?.do === 'setActive' && Boolean(locate(state, a.uid)?.fc.rested);
    });
    if (setActive) return setActive;
  }

  return { type: 'endTurn', player };
}

/** Reserva DON!! para habilidades do líder que custam DON!! (ex.: ③ do Kid). */
function keepDonForLeaderAbility(state: GameState, player: PlayerId): number {
  const leader = state.players[player].leader;
  const ab = cardDef(state, leader.uid).abilities.find((a) => a.timing === 'activateMain' && a.cost?.restDon);
  return ab && !state.usedThisTurn.some((k) => k.startsWith(`${leader.uid}:`)) ? ab.cost!.restDon! : 0;
}
