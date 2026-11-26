// O que dá para fazer agora: atacar, jogar, ativar, bloquear, usar Counter e quem pode ser alvo. Também o
// controle de [Once Per Turn] das habilidades.

import type { Ability, CardDef, CardFilter, EffectStep, FieldCard, GameState, PlayerId, PlayerState, Restriction, TargetSpec } from '../types';
import { isMultiplayer, opponent, opponentOf, opponentSides, opponentsOf } from './table';
import {
  aurasOn,
  canAttackActive,
  cardDef,
  counterValue,
  getCost,
  getPower,
  hasAttributeOn,
  hasBaseEffect,
  hasKeyword,
  hasName,
  hasType,
  locate,
  matchesAnyType,
  matchesFilter,
  matchesPartial,
  ownerOf,
  typeIncludes,
} from './queries';
import { conditionHolds, conditionsMet } from './conditions';
import { canPayCost } from './costs';
import { cannotBeRested } from './zones';

export function usedKey(uid: string, index: number) {
  return `${uid}:${index}`;
}

/**
 * Passos de uma habilidade automática. Uma [Once Per Turn] que começa com custo opcional
 * ("DON!! −1:", "You may trash 1 card from your hand:") é marcada como usada ao ser empilhada
 * (para não disparar duas vezes seguidas), mas a recusa do custo devolve o uso: pelas regras,
 * uma habilidade cujo custo não foi pago não foi ativada.
 */
export function abilitySteps(a: Ability, index: number): EffectStep[] {
  const first = a.steps[0];
  if (a.oncePerTurn && first?.do === 'payCost' && first.ability === undefined) return [{ ...first, ability: index }, ...a.steps.slice(1)];
  // Opcional sem custo: "usar o efeito?" antes; recusar devolve o [Once Per Turn].
  if (a.optional && a.oncePerTurn) return [{ do: 'payCost', cost: {}, ability: index }, ...a.steps];
  return a.steps;
}

/**
 * A carta que sai do campo ou entra nele é uma carta nova (3-1-6): o [Once Per Turn] dela pode
 * ser usado de novo (10-2-13-4) e "this Character battled … during this turn" não vale mais.
 * Esquece os usos do turno da carta e tira a marca dos efeitos dela que ainda esperam na fila
 * (se forem descartados depois, não devolvem o uso da carta nova).
 */
export function forgetCard(state: GameState, uid: string) {
  const prefix = `${uid}:`;
  if (state.usedThisTurn.some((k) => k.startsWith(prefix))) state.usedThisTurn = state.usedThisTurn.filter((k) => !k.startsWith(prefix));
  if (state.battledCharacter?.includes(uid)) state.battledCharacter = state.battledCharacter.filter((u) => u !== uid);
  for (const e of state.triggered ?? []) if (e.source === uid) delete e.opt;
  // "Then, trash this Character at the end of this turn" (OP03-005 Thatch): a carta que saiu do campo e
  // voltou é outra; o efeito adiado sobre "this Character" não vale para ela (Q&A OP03).
  const selfRef = (st: EffectStep) =>
    st.do === 'trashSelf' || st.do === 'returnSelfToHand' || st.do === 'selfToDeckBottom' || ('target' in st && st.target === 'self');
  if (state.delayed?.some((d) => d.source === uid && d.steps.some(selfRef))) {
    state.delayed = state.delayed.filter((d) => d.source !== uid || !d.steps.some(selfRef));
  }
}

/** Devolve o uso do turno de uma [Once Per Turn] cujo custo não foi pago. */
export function releaseOncePerTurn(state: GameState, uid: string, index: number | undefined) {
  if (index === undefined) return;
  const key = usedKey(uid, index);
  const i = state.usedThisTurn.lastIndexOf(key);
  if (i >= 0) state.usedThisTurn.splice(i, 1);
}

export function isIdle(state: GameState): boolean {
  return state.phase === 'main' && !state.pending && state.stack.length === 0 && !state.triggered?.length;
}

/** Motivo pelo qual o ataque é ilegal, ou null se for legal. */
export function attackError(state: GameState, player: PlayerId, attacker: string, target: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível atacar agora.';
  if (isMultiplayer(state) ? (state.turnsTaken?.[player] ?? 0) <= 1 : state.turn <= 2) return 'Nenhum jogador pode atacar no seu primeiro turno.';
  const a = locate(state, attacker);
  if (!a || a.player !== player || a.zone === 'stage') return 'Atacante inválido.';
  if (a.fc.rested) return 'O atacante está virado.';
  if (cannotBeRested(state, attacker)) return 'Esta carta não pode ser virada, então não pode atacar.';
  if (
    state.modifiers.some((m) => m.uid === attacker && m.kind === 'cannotAttack') ||
    cardDef(state, attacker).abilities.some((x) => x.timing === 'static' && x.staticCannotAttack && conditionsMet(state, attacker, x))
  ) {
    return 'Esta carta não pode atacar.';
  }
  if (restricted(state, player, 'noAttackLeader') && opponentsOf(state, player).some((o) => state.players[o].leader.uid === target)) return 'Você não pode atacar o Líder neste turno.';
  const maxCostBlock = state.modifiers.find((m) => m.uid === attacker && m.kind === 'cannotAttackCharMaxCost');
  if (maxCostBlock && locate(state, target)?.zone === 'character' && (cardDef(state, target).cost ?? 0) <= maxCostBlock.amount) {
    return 'Este Líder não pode atacar esse Personagem neste turno.';
  }
  if (locate(state, attacker)?.zone === 'character' && aurasOn(state, attacker, 'character', (au) => Boolean(au.cannotAttack)).length) {
    return 'Esta carta não pode atacar.';
  }
  const t = locate(state, target);
  if (!t || t.player === player || t.zone === 'stage') return 'Alvo inválido.';
  // "If this Character is rested, your opponent cannot attack any card other than this Character."
  // "… other than the Character [Eustass"Captain"Kid]" (P-067): vale qualquer Personagem com esse nome (outra cópia também).
  const taunt = state.players[t.player].characters.find(
    (c) => c.rested && cardDef(state, c.uid).abilities.some((x) => x.timing === 'static' && x.staticTaunt && conditionsMet(state, c.uid, x)),
  );
  if (taunt && !(t.zone === 'character' && hasName(cardDef(state, target), cardDef(state, taunt.uid).name))) {
    return `Só é possível atacar ${cardDef(state, taunt.uid).name}.`;
  }
  if (
    t.zone === 'leader' &&
    a.zone === 'character' &&
    a.fc.playedOnTurn === state.turn &&
    cardDef(state, attacker).abilities.some((x) => x.timing === 'static' && x.noLeaderAttackOnPlayTurn)
  ) {
    return 'Este Personagem não pode atacar um Líder no turno em que entra.';
  }
  const tax = state.modifiers.find((m) => m.uid === attacker && m.kind === 'attackTax');
  if (tax && state.players[player].hand.length < tax.amount) return `Para atacar, descarte ${tax.amount} cartas da mão.`;
  if (a.zone === 'character' && a.fc.playedOnTurn === state.turn && !hasKeyword(state, attacker, 'rush')) {
    if (!(t.zone === 'character' && hasKeyword(state, attacker, 'rushCharacter'))) {
      return 'Personagens não podem atacar no turno em que entram (sem [Rush]).';
    }
  }
  if (t.zone === 'character' && !t.fc.rested && !canAttackActive(state, attacker)) {
    return 'Só é possível atacar personagens virados.';
  }
  return null;
}

/**
 * Custo de uma carta enquanto está na mão: o impresso mais "give this card in your hand −N cost"
 * (da própria carta, com a condição dela) e "Give … in your hand −N cost" (auras do campo).
 * É o custo que vale para efeitos que jogam da mão "with a cost of N or less" (Q&A OP11-023 Arlong:
 * com −3 na mão, pode ser jogado por Aladine OP11-024 e Fisher Tiger OP11-035).
 */
export function costInHand(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  let cost = def.cost ?? 0;
  for (const a of def.abilities) {
    if (a.handCost && (!a.yourTurn || state.activePlayer === owner) && conditionHolds(state, owner, uid, a.condition)) cost += a.handCost;
  }
  const ps = state.players[owner];
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
    for (const a of cardDef(state, fc.uid).abilities) {
      if (a.timing === 'static' && a.handCostAura && matchesFilter(def, a.handCostAura.filter) && conditionsMet(state, fc.uid, a)) cost += a.handCostAura.amount;
    }
  }
  return Math.max(0, cost);
}

/**
 * A definição da carta com o custo que ela tem na mão (para filtros "with a cost of N or less" de efeitos que
 * jogam da mão). Com "base cost" no filtro (OP12-041 Sanji, OP15-014 Bartolomeo), vale o custo impresso.
 */
export function handDef(state: GameState, uid: string, filter?: CardFilter): CardDef {
  const def = cardDef(state, uid);
  if (filter?.base) return def;
  const cost = costInHand(state, uid);
  return cost === (def.cost ?? 0) ? def : { ...def, cost };
}

/** Custo para jogar uma carta da mão (o custo na mão mais as reduções da próxima jogada). */
export function playCost(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  let cost = costInHand(state, uid);
  const red = (state.costReductions ?? []).find((r) => r.player === owner && matchesFilter(def, r.filter));
  if (red) cost -= red.amount;
  return Math.max(0, cost);
}

export function restricted(state: GameState, player: PlayerId, kind: Restriction['kind']): Restriction | undefined {
  return state.restrictions?.find((r) => r.player === player && r.kind === kind);
}

/** "You cannot play Character cards (with a base cost of N or more) during this turn." */
export function playBlocked(state: GameState, player: PlayerId, def: CardDef): boolean {
  const r = restricted(state, player, 'noPlayCharacters');
  return Boolean(r && def.category === 'character' && (r.minCost === undefined || (def.cost ?? 0) >= r.minCost));
}

export function playError(state: GameState, player: PlayerId, uid: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível jogar cartas agora.';
  const ps = state.players[player];
  if (!ps.hand.includes(uid)) return 'A carta não está na sua mão.';
  const def = cardDef(state, uid);
  if (playCost(state, uid) > ps.donActive) return 'DON!! insuficientes.';
  if (playBlocked(state, player, def)) return 'Você não pode jogar este Personagem neste turno.';
  if (restricted(state, player, 'noPlayFromHand') && def.category !== 'event') return 'Você não pode jogar cartas da mão neste turno.';
  if (def.category === 'event' && !def.abilities.some((a) => a.timing === 'main')) {
    return 'Este evento não tem efeito [Main].';
  }
  if (def.category === 'leader') return 'Líderes não podem ser jogados.';
  return null;
}

export function activateError(state: GameState, player: PlayerId, uid: string, index: number): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível ativar efeitos agora.';
  const loc = locate(state, uid);
  if (!loc || loc.player !== player) return 'Carta inválida.';
  const ability = cardDef(state, uid).abilities[index];
  if (!ability || ability.timing !== 'activateMain') return 'Habilidade inválida.';
  if (!conditionsMet(state, uid, ability)) return 'Condições não atendidas.';
  if (ability.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, index))) return 'Já usada neste turno.';
  const ps = state.players[player];
  if (ability.cost?.restSelf && loc.fc.rested) return 'A carta já está virada.';
  if (ability.cost?.restSelf && cannotBeRested(state, uid)) return 'Esta carta não pode ser virada.';
  if ((ability.cost?.restDon ?? 0) > ps.donActive) return 'DON!! ativos insuficientes.';
  if (ability.cost?.donMinusActive && (ability.cost.donMinus ?? 0) + (ability.cost.restDon ?? 0) > ps.donActive) return 'DON!! ativos insuficientes.';
  if ((ability.cost?.donMinus ?? 0) > totalDonOnField(ps)) return 'DON!! insuficientes em campo.';
  if (
    (ability.cost?.trashFromHand ?? 0) + (ability.cost?.handToBottom ?? 0) >
    discardable(state, player, ability.cost?.trashFilter).length
  ) {
    return 'Cartas insuficientes na mão.';
  }
  if ((ability.cost?.lifeToHand ?? 0) > ps.life.length) return 'Cartas de Vida insuficientes.';
  if (ability.cost && !canPayCost(state, player, uid, ability.cost)) return 'O custo não pode ser pago.';
  if ((ability.cost?.restCharacters ?? 0) > ps.characters.filter((c) => !c.rested && c.uid !== uid).length) {
    return 'Personagens ativos insuficientes.';
  }
  return null;
}

/** Cartas da mão que podem ser descartadas (com filtro opcional). */
export function discardable(state: GameState, player: PlayerId, filter?: CardFilter): string[] {
  const hand = state.players[player].hand;
  return filter ? hand.filter((u) => matchesFilter(cardDef(state, u), filter)) : [...hand];
}

export function totalDonOnField(ps: PlayerState): number {
  const attached = ps.leader.don + ps.characters.reduce((s, c) => s + c.don, 0) + (ps.stage?.don ?? 0);
  return ps.donActive + ps.donRested + attached;
}

export function blockerOptions(state: GameState, defender: PlayerId): string[] {
  const b = state.battle;
  if (!b || b.noBlocker || hasKeyword(state, b.attacker, 'unblockable')) return [];
  // "Your opponent cannot activate [Blocker] during this turn."
  if (restricted(state, defender, 'noBlocker')) return [];
  return state.players[defender].characters
    .filter((c) => !c.rested && c.uid !== b.target && hasKeyword(state, c.uid, 'blocker'))
    .filter((c) => !state.modifiers.some((m) => m.uid === c.uid && m.kind === 'cannotBlock'))
    // Bloquear vira o [Blocker].
    .filter((c) => !cannotBeRested(state, c.uid))
    .filter((c) => b.noBlockerMinPower === null || getPower(state, c.uid) < b.noBlockerMinPower)
    .filter((c) => b.noBlockerMaxPower === undefined || getPower(state, c.uid) > b.noBlockerMaxPower)
    .filter((c) => b.noBlockerMaxCost === undefined || getCost(state, c.uid) > b.noBlockerMaxCost)
    .map((c) => c.uid);
}

export function counterOptions(state: GameState, defender: PlayerId): string[] {
  const ps = state.players[defender];
  return ps.hand.filter((uid) => {
    const def = cardDef(state, uid);
    if (def.category === 'character' || def.category === 'stage') return counterValue(state, uid) > 0;
    if (def.category === 'event') {
      // Reduções de custo da carta na mão valem também para o Evento [Counter] (2-7-6).
      return def.abilities.some((a) => a.timing === 'counter') && playCost(state, uid) <= ps.donActive;
    }
    return false;
  });
}

/**
 * Mesa com mais de dois: os Eventos [Counter] que um jogador de fora da batalha pode usar na etapa de
 * Counter (o manual do formato deixa: "you MAY play counter effects"). Só Eventos que ele pode pagar.
 */
export function bystanderCounterOptions(state: GameState, player: PlayerId): string[] {
  return counterOptions(state, player).filter((uid) => cardDef(state, uid).category === 'event');
}

/**
 * Quem pode receber o valor de Counter de uma carta da mão (7-1-3-1-1): o Líder ou 1 Personagem do
 * defensor, inclusive um que não é o alvo do ataque (o bônus acaba no fim da batalha, Q&A de regras).
 */
export function counterTargets(state: GameState, defender: PlayerId): string[] {
  const ps = state.players[defender];
  return [ps.leader.uid, ...ps.characters.map((c) => c.uid)];
}

export function targetCandidates(state: GameState, controller: PlayerId, source: string, spec: TargetSpec): string[] {
  // 'any' ("up to 1 Leader or Character card", sem "your opponent's"): as cartas de qualquer jogador da mesa.
  const sides: PlayerId[] =
    spec.side === 'own'
      ? [controller]
      : spec.side === 'opponent'
        ? opponentSides(state, controller)
        : isMultiplayer(state)
          ? [...opponentsOf(state, controller), controller]
          : [opponent(controller), controller];
  const out: string[] = [];
  for (const id of sides) {
    const ps = state.players[id];
    let sided = spec;
    if (spec.maxCostDynamic) {
      // "with a cost equal to or less than the number of your opponent's Life cards": numa mesa com mais de
      // dois, a Vida que conta para as cartas de um oponente é a dele.
      const own = state.players[controller].life.length;
      const opp = (id === controller ? state.players[opponentOf(state, controller)] : ps).life.length;
      const bound = spec.maxCostDynamic === 'opponentLife' ? opp : spec.maxCostDynamic === 'ownLife' ? own : own + opp;
      sided = { ...spec, maxCost: Math.min(spec.maxCost ?? bound, bound) };
    }
    const pool: FieldCard[] = [];
    if (sided.kinds.includes('leader')) pool.push(ps.leader);
    if (sided.kinds.includes('character')) pool.push(...ps.characters);
    if (sided.kinds.includes('stage') && ps.stage) pool.push(ps.stage);
    for (const fc of pool) if (fieldCardMatches(state, source, fc, sided)) out.push(fc.uid);
  }
  return out;
}

/** Uma carta em campo atende aos filtros do alvo (sem olhar lado/zona)? */
export function fieldCardMatches(state: GameState, source: string, fc: FieldCard, spec: TargetSpec): boolean {
  const def = cardDef(state, fc.uid);
  if (spec.excludeSelf && fc.uid === source) return false;
  const power = spec.base ? (def.power ?? 0) : getPower(state, fc.uid);
  const cost = spec.base ? (def.cost ?? 0) : getCost(state, fc.uid);
  if (spec.maxPower !== undefined && power > spec.maxPower) return false;
  if (spec.minPower !== undefined && power < spec.minPower) return false;
  if (spec.maxCost !== undefined && (def.cost === undefined || cost > spec.maxCost)) return false;
  if (spec.minCost !== undefined && (def.cost === undefined || cost < spec.minCost)) return false;
  if (spec.excludeName && hasName(def, spec.excludeName)) return false;
  if (spec.name && !hasName(def, spec.name)) return false;
  if (spec.color && !def.colors.includes(spec.color)) return false;
  if (spec.typeIncludes && !typeIncludes(def, spec.typeIncludes)) return false;
  if (spec.rested !== undefined && fc.rested !== spec.rested) return false;
  if (spec.hasType && !hasType(def, spec.hasType)) return false;
  if (spec.keyword && !hasKeyword(state, fc.uid, spec.keyword)) return false;
  if (spec.hasTrigger && !def.trigger?.trim()) return false;
  if (spec.minDon !== undefined && fc.don < spec.minDon) return false;
  if (spec.withoutTiming && def.abilities.some((a) => a.timing === spec.withoutTiming)) return false;
  if (spec.leaderOnlyNamed && def.category === 'leader' && !hasName(def, spec.leaderOnlyNamed)) return false;
  if (spec.names && !spec.names.some((n) => hasName(def, n))) return false;
  if (spec.attribute && !hasAttributeOn(state, fc.uid, spec.attribute)) return false;
  if (spec.noEffect && hasBaseEffect(def)) return false;
  if (spec.either && !spec.either.some((f) => matchesPartial(state, fc.uid, f, source))) return false;
  if (!matchesAnyType(def, spec.hasAnyType)) return false;
  if (spec.hasAllTypes && !spec.hasAllTypes.every((t) => hasType(def, t))) return false;
  if (spec.withoutKeyword && hasKeyword(state, fc.uid, spec.withoutKeyword)) return false;
  return true;
}
