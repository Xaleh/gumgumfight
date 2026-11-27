// Efeitos disparados (CR 8-6) e os eventos que os disparam.

import type { AbilityTiming, EffectStep, GameEvent, GameState, PlayerId, TriggeredEffect } from '../types';
import { lg, log, pr, promptOf } from './messages';
import { alivePlayers, isMultiplayer, opponent, turnOrder } from './table';
import { cardDef, hasName, hasType, leaderRule, locate, matchesFilter, ownerOf } from './queries';
import { conditionsMet } from './conditions';
import { abilitySteps, usedKey } from './options';
import { pushEffect } from './stack';

// ---------------------------------------------------------------------------
// Efeitos disparados (CR 8-6)
//
// Um efeito automático ("When …", [On Play], [On K.O.], [When Attacking]…) não entra na
// pilha na hora em que dispara: ele vai para `state.triggered` e espera não haver nenhum
// efeito nem dano em resolução.
//  - Disparou enquanto um efeito resolvia: espera esse efeito terminar (8-6-3, 8-6-1-1).
//  - Disparou durante o dano: espera todo o dano (8-6-2); só o [Trigger] interrompe o dano.
//  - Depois, um de cada vez, na ordem em que dispararam; os disparados juntos (mesmo lote)
//    resolvem primeiro os do jogador do turno, depois os do outro (8-6-1). Entre vários do
//    mesmo jogador vindos de cartas diferentes, o dono escolhe a ordem (6-6-1-1-3, Q&A).
//  - Na hora de ativar, a carta precisa continuar no campo (8-1-3-1-3) e as condições da
//    habilidade precisam valer (8-4-1-1). O [On K.O.] e os efeitos adiados são exceção.
// ---------------------------------------------------------------------------

export const TIMING_TAG: Partial<Record<AbilityTiming, string>> = {
  onPlay: '[Ao Jogar]',
  whenAttacking: '[Ao Atacar]',
  onOpponentAttack: '[No Ataque do Oponente]',
  onBlock: '[Ao Bloquear]',
  onKO: '[Ao ser Nocauteado]',
  endOfTurn: '[Fim do Seu Turno]',
  endOfOpponentTurn: '[Fim do Turno do Oponente]',
  startOfTurn: '(início do turno)',
  startOfOpponentTurn: '(início do turno do oponente)',
  startOfMainPhase: '(início da Fase Principal)',
  battlesCharacter: '(fim da batalha)',
};

export function queueTriggered(
  state: GameState,
  source: string,
  controller: PlayerId,
  steps: EffectStep[],
  extra: { timing?: AbilityTiming; ability?: number; opt?: string; offField?: true; last?: string[]; eventCount?: number } = {},
): TriggeredEffect | null {
  if (!steps.length) return null;
  const tag = extra.timing ? TIMING_TAG[extra.timing] : undefined;
  const e: TriggeredEffect = {
    id: (state.triggerSeq = (state.triggerSeq ?? 0) + 1),
    source,
    controller,
    steps: [...steps],
    label: `${cardDef(state, source).name}${tag ? ` ${tag}` : ''}`,
    batch: state.triggerBatch ?? 0,
    ...(extra.offField ? { offField: true as const } : {}),
    ...(extra.ability !== undefined ? { ability: extra.ability } : {}),
    ...(extra.opt ? { opt: extra.opt } : {}),
    ...(extra.last ? { last: extra.last } : {}),
    ...(extra.eventCount !== undefined ? { eventCount: extra.eventCount } : {}),
  };
  (state.triggered ??= []).push(e);
  return e;
}

/** Efeitos adiados ("at the end of this turn/battle"): resolvem depois dos efeitos já disparados. */
export function queueDelayed(state: GameState, list: Array<{ source: string; controller: PlayerId; steps: EffectStep[]; last?: string[] }>) {
  if (!list.length) return;
  state.triggerBatch = (state.triggerBatch ?? 0) + 1;
  for (const d of list) queueTriggered(state, d.source, d.controller, d.steps, { offField: true, ...(d.last ? { last: d.last } : {}) });
}

/**
 * Leva para a pilha o próximo efeito disparado, ou pergunta ao dono a ordem. Só quando não há
 * efeito nem dano em resolução. Devolve true se mexeu na pilha, na fila ou abriu uma escolha.
 */
export function nextTriggered(state: GameState): boolean {
  const queue = state.triggered;
  if (!queue?.length) return false;
  if (state.stack.some((f) => f.kind === 'effect' || f.kind === 'damage')) return false;
  const batch = Math.min(...queue.map((e) => e.batch));
  const together = queue.filter((e) => e.batch === batch);
  // Primeiro os do jogador do turno; depois os dos outros, na ordem dos turnos.
  const player = together.some((e) => e.controller === state.activePlayer)
    ? state.activePlayer
    : isMultiplayer(state)
      ? (turnOrder(state, state.activePlayer).find((id) => together.some((e) => e.controller === id)) ?? together[0].controller)
      : opponent(state.activePlayer);
  const mine = together.filter((e) => e.controller === player);
  // Na vez dele, a carta saiu do campo ou a condição deixou de valer: o efeito não ativa.
  const lapsed = mine.find(
    (e) => !e.offField && (!locate(state, e.source) || (e.ability !== undefined && !conditionsMet(state, e.source, cardDef(state, e.source).abilities[e.ability]))),
  );
  if (lapsed) {
    dropTriggered(state, lapsed);
    const left = !locate(state, lapsed.source);
    const why = left ? 'a carta saiu do campo' : 'a condição não vale mais';
    // O rótulo é "Nome [Marca]": a marca de momento vai como parte traduzível (`log.tag.*`).
    const card = cardDef(state, lapsed.source).name;
    const timing = (Object.keys(TIMING_TAG) as AbilityTiming[]).find((k) => lapsed.label === `${card} ${TIMING_TAG[k]}`);
    const text = `${lapsed.label}: ${why}, o efeito não é ativado.`;
    log(
      state,
      lapsed.controller,
      timing
        ? lg(left ? 'lapsedLeftTagged' : 'lapsedConditionTagged', text, { card, tag: TIMING_TAG[timing]! }, { tag: { items: [{ key: `log.tag.${timing}` }] } })
        : lg(left ? 'lapsedLeft' : 'lapsedCondition', text, { card: lapsed.label }),
      { cards: [lapsed.source] },
    );
    return true;
  }
  if (new Set(mine.map((e) => e.source)).size > 1) {
    state.pending = {
      kind: 'option',
      player,
      source: mine[0].source,
      ...promptOf(pr('triggerOrder', 'Efeitos que ativaram ao mesmo tempo: escolha qual resolve primeiro.')),
      options: mine.map((e) => e.label),
      order: mine.map((e) => e.id),
    };
    return true;
  }
  activateTriggered(state, mine[0]);
  return true;
}

function removeTriggered(state: GameState, e: TriggeredEffect) {
  state.triggered = (state.triggered ?? []).filter((x) => x.id !== e.id);
  if (!state.triggered.length) delete state.triggered;
}

function dropTriggered(state: GameState, e: TriggeredEffect) {
  removeTriggered(state, e);
  if (e.opt) {
    const i = state.usedThisTurn.lastIndexOf(e.opt);
    if (i >= 0) state.usedThisTurn.splice(i, 1);
  }
}

/** O efeito disparado ativa: vai para a pilha. Os que ele disparar formam um lote novo. */
export function activateTriggered(state: GameState, e: TriggeredEffect) {
  removeTriggered(state, e);
  state.triggerBatch = (state.triggerBatch ?? 0) + 1;
  pushEffect(state, e.source, e.controller, e.steps);
  const top = state.stack[state.stack.length - 1];
  if (top?.kind !== 'effect') return;
  if (e.last) top.last = [...e.last];
  if (e.eventCount !== undefined) top.eventCount = e.eventCount;
}

/** Dados de um acontecimento: quem causou/sofreu (player) e a carta envolvida. */
type EmittedEvent = {
  kind: GameEvent['kind'];
  player: PlayerId;
  card?: string;
  count?: number;
  byPlayer?: PlayerId;
  inBattle?: boolean;
  from?: string;
  byEffect?: boolean;
  fromHand?: boolean;
  byCharacterEffect?: boolean;
};

/** Dispara as habilidades "When …" de todas as cartas em campo que reagem ao acontecimento. */
export function emit(state: GameState, ev: EmittedEvent) {
  for (const ps of alivePlayers(state)) {
    for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
      const def = cardDef(state, fc.uid);
      def.abilities.forEach((a, i) => {
        if (a.timing !== 'event' || !a.event) return;
        const matches = (e: GameEvent): boolean =>
          e.kind === 'anyOf' ? e.events.some(matches) : e.kind === ev.kind && eventMatches(state, e, ev, ps.id, fc.uid);
        if (!matches(a.event)) return;
        if (!conditionsMet(state, fc.uid, a)) return;
        if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(fc.uid, i))) return;
        if (a.oncePerTurn) state.usedThisTurn.push(usedKey(fc.uid, i));
        // "that Character" no efeito se refere à carta do acontecimento.
        queueTriggered(state, fc.uid, ps.id, abilitySteps(a, i), {
          ability: i,
          ...(a.oncePerTurn ? { opt: usedKey(fc.uid, i) } : {}),
          ...(ev.card ? { last: [ev.card] } : {}),
          ...(ev.count !== undefined ? { eventCount: ev.count } : {}),
        });
      });
    }
  }
}

function eventMatches(state: GameState, e: GameEvent, ev: EmittedEvent, owner: PlayerId, uid: string): boolean {
  switch (e.kind) {
    case 'donReturned':
      // "… returned to your DON!! deck by your effect": não vale quando o efeito do oponente devolve.
      if (e.byYourEffect && ev.byPlayer !== undefined && ev.byPlayer !== owner) return false;
      return ev.player === owner && (ev.count ?? 1) >= (e.min ?? 1);
    case 'donGiven':
    case 'damageTaken':
    case 'lifeZero':
      return ev.player === owner;
    case 'lifeRemoved':
      return e.whose === 'any' || (e.whose === 'own') === (ev.player === owner);
    case 'restedByEffect':
      return ev.byPlayer === owner;
    case 'handTrashedByEffect':
      if (e.sourceLeader && (ev.card !== state.players[owner].leader.uid || !hasName(cardDef(state, ev.card), e.sourceLeader))) return false;
      return ev.player === owner && (!e.sourceType || (ev.card !== undefined && hasType(cardDef(state, ev.card), e.sourceType)));
    case 'anyOf':
      return false;
    case 'characterPlayed':
      return (
        (e.who === 'self') === (ev.player === owner) &&
        (!e.filter || matchesFilter(cardDef(state, ev.card!), e.filter)) &&
        (!e.from || e.from === ev.from) &&
        (!e.byEffect || Boolean(ev.byEffect)) &&
        (!e.byCharacterEffect || Boolean(ev.byCharacterEffect)) &&
        (!e.fromHand || Boolean(ev.fromHand))
      );
    case 'characterRemoved': {
      if (e.whose !== 'any' && (e.whose === 'own') !== (ev.player === owner)) return false;
      if (e.filter && !matchesFilter(cardDef(state, ev.card!), e.filter)) return false;
      if (ev.inBattle) return Boolean(e.orKO);
      if (ev.byPlayer === undefined) return false;
      return e.by === 'any' || (e.by === 'self') === (ev.byPlayer === owner);
    }
    case 'characterKO':
      return (e.whose === 'any' || (e.whose === 'own') === (ev.player === owner)) && (!e.filter || matchesFilter(cardDef(state, ev.card!), e.filter));
    case 'eventActivated':
    case 'blockerActivated':
      return (e.who === 'self') === (ev.player === owner);
    case 'selfRested':
      if (ev.card !== uid) return false;
      if (e.byOpponent && (ev.byPlayer === undefined || ev.byPlayer === owner)) return false;
      if (e.byCharacter && (!ev.from || cardDef(state, ev.from).category !== 'character')) return false;
      return true;
    case 'attackDamage':
    case 'battleKO':
      return ev.card === uid;
    case 'triggerActivated':
      return e.who === 'any' || ev.player !== owner;
    case 'drawByEffect':
    case 'lifeToHand':
      return ev.player === owner;
    case 'damageDealt':
      // Com quem causou o dano conhecido (o ataque; numa mesa de mais de dois, também o efeito), só ele reage.
      return ev.player !== owner && (ev.byPlayer === undefined || ev.byPlayer === owner);
    case 'leaderBattle':
      return ev.player === owner && (!e.filter || matchesFilter(cardDef(state, ev.card!), e.filter));
    case 'returnedToHand':
      return ev.player !== owner && ev.byPlayer === owner;
  }
}

/** Empilha as habilidades automáticas de uma carta (onPlay, whenAttacking, ...). */
function onPlayNegated(state: GameState, player: PlayerId): boolean {
  if (leaderRule(state, player, 'ownOnPlayNegated')) return true;
  return (state.onPlayNegated ?? []).some((n) => n.player === player && n.untilTurn >= state.turn);
}

/** Dispara as habilidades automáticas de uma carta (onPlay, whenAttacking, ...), na ordem do texto. */
export function pushAbilities(state: GameState, uid: string, timing: AbilityTiming): TriggeredEffect[] {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  if (timing === 'onPlay' && onPlayNegated(state, owner)) {
    log(state, owner, lg('onPlayNegated', `O [Ao Jogar] de ${def.name} está anulado.`, { card: def.name }), { cards: [uid] });
    return [];
  }
  const queued: TriggeredEffect[] = [];
  def.abilities.forEach((a, i) => {
    if (a.timing !== timing || !conditionsMet(state, uid, a)) return;
    if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, i))) return;
    if (a.oncePerTurn) state.usedThisTurn.push(usedKey(uid, i));
    const e = queueTriggered(state, uid, owner, abilitySteps(a, i), { timing, ability: i, ...(a.oncePerTurn ? { opt: usedKey(uid, i) } : {}) });
    if (e) queued.push(e);
  });
  return queued;
}
