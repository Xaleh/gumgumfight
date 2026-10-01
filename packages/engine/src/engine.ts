// Motor de regras do One Piece Card Game.
//
// Modelo: `applyAction(estado, ação) -> novo estado`. O estado nunca é mutado:
// cada ação trabalha sobre uma cópia. Efeitos, batalhas e dano são "frames" em uma
// pilha (`state.stack`); quando um frame precisa de uma decisão de um jogador, o
// motor para e registra `state.pending` até a próxima ação.

import { buildCardDef } from './cards';
import { nextRandom, shuffleInPlace } from './rng';
import type {
  Ability,
  AbilityCost,
  AbilityTiming,
  Action,
  CardDef,
  CardFilter,
  Condition,
  EffectStep,
  FieldCard,
  Frame,
  GameConfig,
  GameEvent,
  GameState,
  Keyword,
  ManualOp,
  Modifier,
  PlayerId,
  PlayerState,
  TargetRef,
  TargetSpec,
} from './types';

export const MAX_CHARACTERS = 5;
export const DON_DECK_SIZE = 10;
export const DECK_SIZE = 50;
export const HAND_SIZE = 5;

export class IllegalActionError extends Error {}

type Located = { player: PlayerId; zone: 'leader' | 'character' | 'stage'; fc: FieldCard };
type EffectFrame = Extract<Frame, { kind: 'effect' }>;
type DamageFrame = Extract<Frame, { kind: 'damage' }>;
type PlayFrame = Extract<Frame, { kind: 'play' }>;

// ---------------------------------------------------------------------------
// Criação da partida
// ---------------------------------------------------------------------------

export function createGame(config: GameConfig): GameState {
  // Só as cartas dos dois decks entram no estado (que é copiado a cada ação).
  const used = new Set(config.players.flatMap((p) => [p.deck.leader, ...p.deck.cards.map((c) => c.id)]));
  const defs: Record<string, CardDef> = {};
  for (const c of config.cards) if (used.has(c.id)) defs[c.id] = buildCardDef(c);

  const holder = { rng: config.seed | 0 };
  const cards: GameState['cards'] = {};
  let counter = 0;
  const makeInstance = (cardId: string, owner: PlayerId) => {
    if (!defs[cardId]) throw new Error(`Carta desconhecida: ${cardId}`);
    const uid = `c${++counter}`;
    cards[uid] = { uid, cardId, owner };
    return uid;
  };

  const players = config.players.map((setup, idx) => {
    const id = idx as PlayerId;
    const leaderDef = defs[setup.deck.leader];
    if (!leaderDef || leaderDef.category !== 'leader') {
      throw new Error(`Líder inválido no deck ${setup.deck.name}`);
    }
    const leaderUid = makeInstance(setup.deck.leader, id);
    const deck: string[] = [];
    for (const entry of setup.deck.cards) {
      for (let i = 0; i < entry.count; i++) deck.push(makeInstance(entry.id, id));
    }
    if (deck.length !== DECK_SIZE) {
      throw new Error(`O deck ${setup.deck.name} tem ${deck.length} cartas (precisa de ${DECK_SIZE})`);
    }
    shuffleInPlace(holder, deck);
    const p: PlayerState = {
      id,
      name: setup.name,
      isBot: Boolean(setup.isBot),
      leader: { uid: leaderUid, rested: false, don: 0, playedOnTurn: 0 },
      characters: [],
      stage: null,
      hand: [],
      deck,
      trash: [],
      life: [],
      donDeck: DON_DECK_SIZE,
      donActive: 0,
      donRested: 0,
      mulliganDone: false,
    };
    return p;
  }) as [PlayerState, PlayerState];

  const firstPlayer: PlayerId = config.firstPlayer ?? (holder.rng & 1 ? 0 : 1);

  const state: GameState = {
    version: 1,
    seed: config.seed,
    rng: holder.rng,
    turn: 0,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: 'mulligan',
    players,
    cards,
    defs,
    battle: null,
    stack: [],
    pending: { kind: 'mulligan', player: firstPlayer },
    modifiers: [],
    usedThisTurn: [],
    winner: null,
    winReason: null,
    log: [],
    actionCount: 0,
  };

  for (const p of players) drawCards(state, p.id, HAND_SIZE);
  log(state, null, `${players[firstPlayer].name} joga primeiro.`);
  return state;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const opponent = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function cardDef(state: GameState, uid: string): CardDef {
  return state.defs[state.cards[uid].cardId];
}

export function ownerOf(state: GameState, uid: string): PlayerId {
  return state.cards[uid].owner;
}

export function locate(state: GameState, uid: string): Located | null {
  for (const ps of state.players) {
    if (ps.leader.uid === uid) return { player: ps.id, zone: 'leader', fc: ps.leader };
    const ch = ps.characters.find((c) => c.uid === uid);
    if (ch) return { player: ps.id, zone: 'character', fc: ch };
    if (ps.stage?.uid === uid) return { player: ps.id, zone: 'stage', fc: ps.stage };
  }
  return null;
}

function conditionsMet(state: GameState, uid: string, ability: Ability): boolean {
  const loc = locate(state, uid);
  const owner = ownerOf(state, uid);
  if (ability.don && (!loc || loc.fc.don < ability.don)) return false;
  if (ability.yourTurn && state.activePlayer !== owner) return false;
  if (ability.opponentsTurn && state.activePlayer === owner) return false;
  return conditionHolds(state, owner, uid, ability.condition);
}

/** Avalia uma condição do ponto de vista de `controller`; `source` é a carta do efeito. */
export function conditionHolds(state: GameState, controller: PlayerId, source: string, cond: Condition | undefined): boolean {
  if (!cond) return true;
  const ps = state.players[controller];
  const opp = state.players[opponent(controller)];
  if (cond.minCharacters !== undefined && ps.characters.length < cond.minCharacters) return false;
  if (cond.selfRested && !locate(state, source)?.fc.rested) return false;
  if (cond.minDonOnField !== undefined && totalDonOnField(ps) < cond.minDonOnField) return false;
  if (cond.handMax !== undefined && ps.hand.length > cond.handMax) return false;
  if (cond.leaderHasType && !hasType(cardDef(state, ps.leader.uid), cond.leaderHasType)) return false;
  if (cond.leaderName && !hasName(cardDef(state, ps.leader.uid), cond.leaderName)) return false;
  if (cond.opponentMoreDon && totalDonOnField(opp) <= totalDonOnField(ps)) return false;
  if (cond.lifeMax !== undefined && ps.life.length > cond.lifeMax) return false;
  if (cond.opponentLifeMax !== undefined && opp.life.length > cond.opponentLifeMax) return false;
  if (cond.totalLifeMax !== undefined && ps.life.length + opp.life.length > cond.totalLifeMax) return false;
  const range = cond.anyCharacterCost;
  if (
    range &&
    ![...ps.characters, ...opp.characters].some((c) => {
      const cost = getCost(state, c.uid);
      return (range.min === undefined || cost >= range.min) && (range.max === undefined || cost <= range.max);
    })
  ) {
    return false;
  }
  if (cond.noCharacterNamed && ps.characters.some((c) => hasName(cardDef(state, c.uid), cond.noCharacterNamed!))) return false;
  if (cond.leaderMulticolor && cardDef(state, ps.leader.uid).colors.length < 2) return false;
  if (cond.handMin !== undefined && ps.hand.length < cond.handMin) return false;
  if (cond.lifeLessThanOpponent && ps.life.length >= opp.life.length) return false;
  if (cond.maxDonOnField !== undefined && totalDonOnField(ps) > cond.maxDonOnField) return false;
  if (cond.haveCharacterNamed && !ps.characters.some((c) => hasName(cardDef(state, c.uid), cond.haveCharacterNamed!))) {
    return false;
  }
  if (cond.opponentMinDonOnField !== undefined && totalDonOnField(opp) < cond.opponentMinDonOnField) return false;
  if (cond.trashMin !== undefined && ps.trash.length < cond.trashMin) return false;
  if (cond.donLeqOpponent && totalDonOnField(ps) > totalDonOnField(opp)) return false;
  if (cond.leaderHasAnyType && !cond.leaderHasAnyType.some((t) => hasType(cardDef(state, ps.leader.uid), t))) return false;
  if (cond.ownCharacterMinCost !== undefined && !ps.characters.some((c) => getCost(state, c.uid) >= cond.ownCharacterMinCost!)) {
    return false;
  }
  if (cond.opponentHandMin !== undefined && opp.hand.length < cond.opponentHandMin) return false;
  if (cond.selfMinPower !== undefined && (!locate(state, source) || getPower(state, source) < cond.selfMinPower)) return false;
  if (cond.anyDonGiven && ![ps.leader, ...ps.characters].some((c) => c.don > 0)) return false;
  if (cond.selfPlayedThisTurn && locate(state, source)?.fc.playedOnTurn !== state.turn) return false;
  if (
    cond.minTypedCharacters &&
    ps.characters.filter((c) => hasType(cardDef(state, c.uid), cond.minTypedCharacters!.type)).length < cond.minTypedCharacters.count
  ) {
    return false;
  }
  if (cond.opponentLifeMin !== undefined && opp.life.length < cond.opponentLifeMin) return false;
  const typed = cond.ownTypedCharacterMinCost;
  if (typed && !ps.characters.some((c) => hasType(cardDef(state, c.uid), typed.type) && getCost(state, c.uid) >= typed.cost)) {
    return false;
  }
  if (
    cond.opponentCharacterMinCost !== undefined &&
    !opp.characters.some((c) => getCost(state, c.uid) >= cond.opponentCharacterMinCost!)
  ) {
    return false;
  }
  const lt = cond.leaderTypeOrName;
  if (lt && !hasType(cardDef(state, ps.leader.uid), lt.type) && !hasName(cardDef(state, ps.leader.uid), lt.name)) return false;
  if (cond.maxCharacters !== undefined && ps.characters.length > cond.maxCharacters) return false;
  if (cond.minActiveDon !== undefined && ps.donActive < cond.minActiveDon) return false;
  if (cond.trashEventsMin !== undefined && ps.trash.filter((u) => cardDef(state, u).category === 'event').length < cond.trashEventsMin) {
    return false;
  }
  if (cond.ownCharacterMinPower !== undefined && !ps.characters.some((c) => getPower(state, c.uid) >= cond.ownCharacterMinPower!)) {
    return false;
  }
  if (cond.lifeLeqOpponent && ps.life.length > opp.life.length) return false;
  if (cond.deckMax !== undefined && ps.deck.length > cond.deckMax) return false;
  const rt = cond.minRestedTyped;
  if (
    rt &&
    ps.characters.filter((c) => c.rested && (!rt.types || rt.types.some((t) => hasType(cardDef(state, c.uid), t)))).length < rt.count
  ) {
    return false;
  }
  if (cond.noOtherNamed && ps.characters.some((c) => c.uid !== source && hasName(cardDef(state, c.uid), cond.noOtherNamed!))) {
    return false;
  }
  if (cond.lifeMin !== undefined && ps.life.length < cond.lifeMin) return false;
  if (
    cond.opponentCharacterMinPower !== undefined &&
    !opp.characters.some((c) => getPower(state, c.uid) >= cond.opponentCharacterMinPower!)
  ) {
    return false;
  }
  if (cond.minRestedCharacters !== undefined && ps.characters.filter((c) => c.rested).length < cond.minRestedCharacters) {
    return false;
  }
  if (
    cond.opponentMinRestedCharacters !== undefined &&
    opp.characters.filter((c) => c.rested).length < cond.opponentMinRestedCharacters
  ) {
    return false;
  }
  return true;
}

/** Custo atual de uma carta em campo (custo impresso + efeitos contínuos + modificadores). */
export function getCost(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  let cost = def.cost ?? 0;
  if (!locate(state, uid)) return cost;
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticCost && conditionsMet(state, uid, a)) cost += a.staticCost;
  }
  for (const m of state.modifiers) if (m.uid === uid && m.kind === 'cost') cost += m.amount;
  const loc = locate(state, uid)!;
  cost += auraPower(state, uid, loc.zone, 'cost');
  return Math.max(0, cost);
}

/** Nome da carta (ou nome alternativo, "Also treat this card's name as …"). */
export function hasName(def: CardDef, name: string): boolean {
  return def.name === name || Boolean(def.aliases?.includes(name));
}

/** Bate com um filtro de tipos ("{A} or {B} type")? Tolerante a tipos mal separados. */
export function matchesAnyType(def: CardDef, types: string[] | undefined): boolean {
  return !types?.length || types.some((t) => hasType(def, t));
}

/** Filtro de cartas fora do campo (busca no deck etc.). */
export function matchesFilter(def: CardDef, f: import('./types').CardFilter): boolean {
  if (!matchesAnyType(def, f.hasAnyType)) return false;
  if (f.category && def.category !== f.category) return false;
  if (f.maxCost !== undefined && (def.cost ?? 0) > f.maxCost) return false;
  if (f.minCost !== undefined && (def.cost ?? 0) < f.minCost) return false;
  if (f.excludeName && hasName(def, f.excludeName)) return false;
  if (f.name && !hasName(def, f.name)) return false;
  if (f.color && !def.colors.includes(f.color)) return false;
  if (f.typeIncludes && !typeIncludes(def, f.typeIncludes)) return false;
  if (f.noEffect && (def.text ?? '').trim()) return false;
  if (f.maxPower !== undefined && (def.power ?? 0) > f.maxPower) return false;
  if (f.minPower !== undefined && (def.power ?? 0) < f.minPower) return false;
  if (f.hasTrigger && !def.trigger?.trim()) return false;
  return true;
}

/** "with a type including "X"": algum tipo contém o texto (sem diferenciar maiúsculas). */
export function typeIncludes(def: CardDef, part: string): boolean {
  const p = part.toLowerCase();
  return def.types.some((t) => t.toLowerCase().includes(p));
}

/** Soma das auras ativas que afetam a carta (bônus de outras cartas do mesmo jogador). */
function auraPower(state: GameState, uid: string, zone: 'leader' | 'character' | 'stage', what: 'power' | 'cost' = 'power'): number {
  if (zone === 'stage') return 0;
  const owner = ownerOf(state, uid);
  const target = cardDef(state, uid);
  let bonus = 0;
  for (const ps of state.players) {
    for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
      for (const a of cardDef(state, fc.uid).abilities) {
        if (a.timing !== 'static' || !a.aura || !a.aura.kinds.includes(zone)) continue;
        // Aura própria afeta as suas cartas; aura 'opponent' afeta as do oponente.
        if (((a.aura.side ?? 'own') === 'own') !== (ps.id === owner)) continue;
        if (what === 'cost' ? a.aura.cost === undefined : a.aura.cost !== undefined) continue;
        if (!matchesAnyType(target, a.aura.hasAnyType) || !conditionsMet(state, fc.uid, a)) continue;
        if (a.aura.typeIncludes && !typeIncludes(target, a.aura.typeIncludes)) continue;
        bonus += what === 'cost' ? a.aura.cost! : a.aura.power;
      }
    }
  }
  return bonus;
}

export function getPower(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  let power = def.power ?? 0;
  const loc = locate(state, uid);
  if (!loc) return power;
  if (loc.player === state.activePlayer) power += loc.fc.don * 1000;
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticPower && conditionsMet(state, uid, a)) power += a.staticPower;
    if (a.timing === 'static' && a.battleVsAttribute && state.battle && conditionsMet(state, uid, a)) {
      const b = state.battle;
      const other = b.attacker === uid ? b.target : b.target === uid ? b.attacker : null;
      if (other && cardDef(state, other).category === 'character' && cardDef(state, other).attributes?.includes(a.battleVsAttribute.attribute)) {
        power += a.battleVsAttribute.power;
      }
    }
  }
  power += auraPower(state, uid, loc.zone);
  for (const m of state.modifiers) if (m.uid === uid && m.kind === 'power') power += m.amount;
  return power;
}

export function hasKeyword(state: GameState, uid: string, kw: Keyword): boolean {
  const def = cardDef(state, uid);
  if (def.keywords.includes(kw)) return true;
  if (state.modifiers.some((m) => m.uid === uid && m.kind === 'keyword' && m.keyword === kw)) return true;
  return def.abilities.some((a) => a.timing === 'static' && a.staticKeyword === kw && conditionsMet(state, uid, a));
}

/**
 * Verifica o tipo ({Straw Hat Crew}). Tolera listas mal separadas vindas de APIs
 * (ex.: "Supernovas Straw Hat Crew" como um único item).
 */
export function hasType(def: CardDef, type: string): boolean {
  if (def.types.includes(type)) return true;
  // Sem diferenciar maiúsculas: a API traz "Film" nos tipos e "{FILM}" nos textos.
  return ` ${def.types.join(' ')} `.toLowerCase().includes(` ${type.toLowerCase()} `);
}

function canAttackActive(state: GameState, uid: string): boolean {
  if (state.modifiers.some((m) => m.uid === uid && m.kind === 'canAttackActive')) return true;
  return cardDef(state, uid).abilities.some(
    (a) => a.timing === 'static' && a.staticCanAttackActive && conditionsMet(state, uid, a),
  );
}

function usedKey(uid: string, index: number) {
  return `${uid}:${index}`;
}

export function isIdle(state: GameState): boolean {
  return state.phase === 'main' && !state.pending && state.stack.length === 0;
}

/** Motivo pelo qual o ataque é ilegal, ou null se for legal. */
export function attackError(state: GameState, player: PlayerId, attacker: string, target: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível atacar agora.';
  if (state.turn <= 2) return 'Nenhum jogador pode atacar no seu primeiro turno.';
  const a = locate(state, attacker);
  if (!a || a.player !== player || a.zone === 'stage') return 'Atacante inválido.';
  if (a.fc.rested) return 'O atacante está virado.';
  if (
    state.modifiers.some((m) => m.uid === attacker && m.kind === 'cannotAttack') ||
    cardDef(state, attacker).abilities.some((x) => x.timing === 'static' && x.staticCannotAttack && conditionsMet(state, attacker, x))
  ) {
    return 'Esta carta não pode atacar.';
  }
  const t = locate(state, target);
  if (!t || t.player === player || t.zone === 'stage') return 'Alvo inválido.';
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

export function playError(state: GameState, player: PlayerId, uid: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível jogar cartas agora.';
  const ps = state.players[player];
  if (!ps.hand.includes(uid)) return 'A carta não está na sua mão.';
  const def = cardDef(state, uid);
  if ((def.cost ?? 0) > ps.donActive) return 'DON!! insuficientes.';
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
  if ((ability.cost?.restDon ?? 0) > ps.donActive) return 'DON!! ativos insuficientes.';
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
function discardable(state: GameState, player: PlayerId, filter?: CardFilter): string[] {
  const hand = state.players[player].hand;
  return filter ? hand.filter((u) => matchesFilter(cardDef(state, u), filter)) : [...hand];
}

function totalDonOnField(ps: PlayerState): number {
  const attached = ps.leader.don + ps.characters.reduce((s, c) => s + c.don, 0) + (ps.stage?.don ?? 0);
  return ps.donActive + ps.donRested + attached;
}

export function blockerOptions(state: GameState, defender: PlayerId): string[] {
  const b = state.battle;
  if (!b || b.noBlocker) return [];
  return state.players[defender].characters
    .filter((c) => !c.rested && c.uid !== b.target && hasKeyword(state, c.uid, 'blocker'))
    .filter((c) => b.noBlockerMinPower === null || getPower(state, c.uid) < b.noBlockerMinPower)
    .filter((c) => b.noBlockerMaxPower === undefined || getPower(state, c.uid) > b.noBlockerMaxPower)
    .filter((c) => b.noBlockerMaxCost === undefined || getCost(state, c.uid) > b.noBlockerMaxCost)
    .map((c) => c.uid);
}

export function counterOptions(state: GameState, defender: PlayerId): string[] {
  const ps = state.players[defender];
  return ps.hand.filter((uid) => {
    const def = cardDef(state, uid);
    if (def.category === 'character') return (def.counter ?? 0) > 0;
    if (def.category === 'event') {
      return def.abilities.some((a) => a.timing === 'counter') && (def.cost ?? 0) <= ps.donActive;
    }
    return false;
  });
}

export function targetCandidates(state: GameState, controller: PlayerId, source: string, spec: TargetSpec): string[] {
  if (spec.maxCostDynamic) {
    const own = state.players[controller].life.length;
    const opp = state.players[opponent(controller)].life.length;
    const bound = spec.maxCostDynamic === 'opponentLife' ? opp : spec.maxCostDynamic === 'ownLife' ? own : own + opp;
    spec = { ...spec, maxCost: Math.min(spec.maxCost ?? bound, bound) };
  }
  const sides: PlayerId[] =
    spec.side === 'own' ? [controller] : spec.side === 'opponent' ? [opponent(controller)] : [opponent(controller), controller];
  const pool: FieldCard[] = [];
  for (const ps of sides.map((id) => state.players[id])) {
    if (spec.kinds.includes('leader')) pool.push(ps.leader);
    if (spec.kinds.includes('character')) pool.push(...ps.characters);
    if (spec.kinds.includes('stage') && ps.stage) pool.push(ps.stage);
  }
  return pool
    .filter((fc) => {
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
      if (!matchesAnyType(def, spec.hasAnyType)) return false;
      return true;
    })
    .map((fc) => fc.uid);
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, action: Action): GameState {
  if (prev.phase === 'gameover') throw new IllegalActionError('A partida já terminou.');
  const state: GameState = structuredClone(prev);
  const p = action.player;
  const pending = state.pending;

  if (action.type === 'concede') {
    gameOver(state, opponent(p), `${state.players[p].name} desistiu.`);
    state.actionCount++;
    return state;
  }

  if (action.type === 'manual') {
    if (!manualAllowed(prev, p)) throw new IllegalActionError('Ferramentas manuais indisponíveis agora.');
    applyManualOp(state, p, action.op);
    checkDefeat(state);
    run(state);
    state.actionCount++;
    return state;
  }

  if (pending) {
    if (pending.player !== p) throw new IllegalActionError('Aguardando o outro jogador.');
    handlePendingResponse(state, action);
  } else {
    if (state.phase !== 'main' || state.activePlayer !== p) throw new IllegalActionError('Não é o seu turno.');
    if (state.stack.length) throw new IllegalActionError('Há efeitos em resolução.');
    handleMainAction(state, action);
  }

  run(state);
  state.actionCount++;
  return state;
}

function handlePendingResponse(state: GameState, action: Action) {
  const pending = state.pending!;
  const p = action.player;

  switch (pending.kind) {
    case 'mulligan': {
      if (action.type !== 'mulligan') throw new IllegalActionError('Escolha manter ou trocar a mão.');
      const ps = state.players[p];
      if (action.redraw) {
        ps.deck.push(...ps.hand);
        ps.hand = [];
        shuffleInPlace(state, ps.deck);
        drawCards(state, p, HAND_SIZE);
        log(state, p, `${ps.name} trocou a mão inicial.`);
      } else {
        log(state, p, `${ps.name} manteve a mão inicial.`);
      }
      ps.mulliganDone = true;
      state.pending = null;
      const other = state.players[opponent(p)];
      if (!other.mulliganDone) {
        state.pending = { kind: 'mulligan', player: other.id };
      } else {
        for (const pl of state.players) {
          const life = cardDef(state, pl.leader.uid).life ?? 5;
          // A carta do topo do deck fica por baixo da pilha de Vida.
          for (let i = 0; i < life; i++) pl.life.unshift(pl.deck.shift()!);
        }
        state.turn = 1;
        state.activePlayer = state.firstPlayer;
        startTurn(state);
      }
      return;
    }

    case 'selectTargets': {
      if (action.type !== 'choose') throw new IllegalActionError('Escolha os alvos.');
      const uids = [...new Set(action.uids)];
      if (uids.length < pending.min || uids.length > pending.max) {
        throw new IllegalActionError(`Escolha entre ${pending.min} e ${pending.max} alvo(s).`);
      }
      if (uids.some((u) => !pending.options.includes(u))) throw new IllegalActionError('Alvo inválido.');
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
        log(state, p, `${cardDef(state, blocker).name} bloqueia o ataque!`);
        pushAbilities(state, blocker, 'onBlock');
        emit(state, { kind: 'blockerActivated', player: p, card: blocker });
      }
      return;
    }

    case 'counter': {
      const ps = state.players[p];
      if (action.type === 'pass') {
        state.pending = null;
        state.battle!.step = 'damage';
        return;
      }
      if (action.type !== 'counter') throw new IllegalActionError('Use um Counter ou passe.');
      if (!pending.options.includes(action.uid)) throw new IllegalActionError('Carta de Counter inválida.');
      const def = cardDef(state, action.uid);
      removeFrom(ps.hand, action.uid);
      ps.trash.push(action.uid);
      state.pending = null;
      if (def.category === 'character') {
        const target = state.battle!.target;
        state.modifiers.push({ uid: target, kind: 'power', amount: def.counter!, duration: 'battle' });
        log(state, p, `Counter: ${def.name} dá +${def.counter} a ${cardDef(state, target).name}.`);
      } else {
        payDon(ps, def.cost ?? 0);
        const ability = def.abilities.find((a) => a.timing === 'counter')!;
        log(state, p, `${ps.name} usa o evento ${def.name}.`);
        pushEffect(state, action.uid, p, ability.steps);
        emit(state, { kind: 'eventActivated', player: p, card: action.uid });
      }
      return;
    }

    case 'option': {
      if (action.type !== 'option') throw new IllegalActionError('Escolha uma das opções.');
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= pending.options.length) {
        throw new IllegalActionError('Opção inválida.');
      }
      const top = state.stack[state.stack.length - 1];
      if (top?.kind === 'effect') top.choice = [String(action.index)];
      state.pending = null;
      return;
    }

    case 'confirm': {
      if (action.type !== 'answer') throw new IllegalActionError('Responda sim ou não.');
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
      log(state, p, `Efeito de ${cardDef(state, pending.source).name} resolvido manualmente.`);
      return;
    }

    case 'trigger': {
      if (action.type !== 'answer') throw new IllegalActionError('Responda se ativa o [Trigger].');
      const frame = state.stack[state.stack.length - 1] as DamageFrame;
      const card = pending.card;
      const ps = state.players[p];
      frame.lifeCard = undefined;
      state.pending = null;
      if (action.yes) {
        ps.trash.push(card);
        const def = cardDef(state, card);
        log(state, p, `[Trigger] ${def.name} ativado!`);
        const trig = def.abilities.find((a) => a.timing === 'trigger')!;
        pushEffect(state, card, p, trig.steps);
      } else {
        ps.hand.push(card);
        log(state, p, `${ps.name} adiciona a carta de Vida à mão.`);
      }
      return;
    }
  }
}

function handleMainAction(state: GameState, action: Action) {
  const p = action.player;
  const ps = state.players[p];

  switch (action.type) {
    case 'playCard': {
      const err = playError(state, p, action.uid);
      if (err) throw new IllegalActionError(err);
      const def = cardDef(state, action.uid);
      removeFrom(ps.hand, action.uid);
      payDon(ps, def.cost ?? 0);
      if (def.category === 'character') {
        log(state, p, `${ps.name} joga ${def.name}.`);
        state.stack.push({ kind: 'play', uid: action.uid });
      } else if (def.category === 'stage') {
        if (ps.stage) {
          ps.donRested += ps.stage.don;
          ps.trash.push(ps.stage.uid);
        }
        ps.stage = { uid: action.uid, rested: false, don: 0, playedOnTurn: state.turn };
        log(state, p, `${ps.name} joga o Stage ${def.name}.`);
        pushAbilities(state, action.uid, 'onPlay');
      } else {
        ps.trash.push(action.uid);
        log(state, p, `${ps.name} usa o evento ${def.name}.`);
        const main = def.abilities.find((a) => a.timing === 'main')!;
        pushEffect(state, action.uid, p, main.steps);
        emit(state, { kind: 'eventActivated', player: p, card: action.uid });
      }
      return;
    }

    case 'attachDon': {
      if (ps.donActive < 1) throw new IllegalActionError('Nenhum DON!! ativo.');
      const loc = locate(state, action.target);
      if (!loc || loc.player !== p || loc.zone === 'stage') throw new IllegalActionError('Alvo inválido.');
      ps.donActive--;
      loc.fc.don++;
      return;
    }

    case 'activate': {
      const err = activateError(state, p, action.uid, action.ability);
      if (err) throw new IllegalActionError(err);
      const loc = locate(state, action.uid)!;
      const ability = cardDef(state, action.uid).abilities[action.ability];
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(action.uid, action.ability));
      log(state, p, `${cardDef(state, action.uid).name}: ${ability.label ?? 'efeito ativado'}.`);
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
        `${cardDef(state, action.attacker).name} (${getPower(state, action.attacker)}) ataca ${cardDef(state, action.target).name} (${getPower(state, action.target)}).`,
      );
      state.stack.push({ kind: 'battle' });
      // Virar o atacante pode disparar "When this Character becomes rested" (resolve antes da batalha seguir).
      restCard(state, action.attacker);
      return;
    }

    case 'endTurn': {
      // Efeitos de [End of Your Turn] resolvem antes de o turno passar.
      state.stack.push({ kind: 'endTurn' });
      for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
        pushAbilities(state, fc.uid, 'endOfTurn');
      }
      // "… at the end of this turn"
      for (const d of state.delayed ?? []) pushEffect(state, d.source, d.controller, d.steps);
      state.delayed = [];
      return;
    }

    default:
      throw new IllegalActionError(`Ação ${action.type} não permitida agora.`);
  }
}

// ---------------------------------------------------------------------------
// Fluxo de turno
// ---------------------------------------------------------------------------

function startTurn(state: GameState) {
  const ps = state.players[state.activePlayer];
  state.phase = 'main';
  state.modifiers = state.modifiers.filter((m) => !(m.duration === 'untilYourNextTurn' && (m.untilTurn ?? 0) <= state.turn));
  log(state, ps.id, `— Turno ${state.turn}: ${ps.name} —`);

  // Refresh: DON!! anexados voltam à área de custo e tudo fica ativo.
  const fieldCards = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])];
  for (const fc of fieldCards) {
    ps.donRested += fc.don;
    fc.don = 0;
    // "will not become active in your opponent's next Refresh Phase"
    const skip = state.modifiers.some((m) => m.uid === fc.uid && m.kind === 'skipRefresh');
    if (!skip) fc.rested = false;
  }
  state.modifiers = state.modifiers.filter((m) => !(m.kind === 'skipRefresh' && fieldCards.some((fc) => fc.uid === m.uid)));
  ps.donActive += ps.donRested;
  ps.donRested = 0;

  // Draw: o primeiro jogador não compra no primeiro turno.
  if (state.turn !== 1) drawCards(state, ps.id, 1);

  // DON!!: 2 por turno (1 no primeiro turno do primeiro jogador).
  const n = Math.min(state.turn === 1 ? 1 : 2, ps.donDeck);
  ps.donDeck -= n;
  ps.donActive += n;
  checkDefeat(state);
}

function endTurn(state: GameState) {
  const ps = state.players[state.activePlayer];
  log(state, ps.id, `${ps.name} encerra o turno.`);
  state.modifiers = state.modifiers.filter(
    (m) =>
      m.duration !== 'turn' &&
      !((m.duration === 'nextOpponentTurn' || m.duration === 'endOfYourNextTurn') && (m.untilTurn ?? 0) <= state.turn),
  );
  state.usedThisTurn = [];
  state.activePlayer = opponent(state.activePlayer);
  state.turn++;
  startTurn(state);
}

// ---------------------------------------------------------------------------
// Pilha de resolução
// ---------------------------------------------------------------------------

function run(state: GameState) {
  let guard = 0;
  while (!state.pending && state.stack.length && state.phase !== 'gameover') {
    if (++guard > 5000) throw new Error('Loop infinito na resolução de efeitos.');
    const frame = state.stack[state.stack.length - 1];
    switch (frame.kind) {
      case 'effect':
        stepEffect(state, frame);
        break;
      case 'battle':
        stepBattle(state);
        break;
      case 'damage':
        stepDamage(state, frame);
        break;
      case 'play':
        stepPlay(state, frame);
        break;
      case 'endTurn':
        state.stack.pop();
        endTurn(state);
        break;
    }
    checkDefeat(state);
  }
}

function pushEffect(state: GameState, source: string, controller: PlayerId, steps: EffectStep[]) {
  if (steps.length) state.stack.push({ kind: 'effect', source, controller, steps, i: 0 });
}

/** Dados de um acontecimento: quem causou/sofreu (player) e a carta envolvida. */
type EmittedEvent = { kind: GameEvent['kind']; player: PlayerId; card?: string };

/** Dispara as habilidades "When …" de todas as cartas em campo que reagem ao acontecimento. */
function emit(state: GameState, ev: EmittedEvent) {
  for (const ps of state.players) {
    for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
      const def = cardDef(state, fc.uid);
      def.abilities.forEach((a, i) => {
        if (a.timing !== 'event' || !a.event || a.event.kind !== ev.kind) return;
        if (!eventMatches(a.event, ev, ps.id, fc.uid)) return;
        if (!conditionsMet(state, fc.uid, a)) return;
        if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(fc.uid, i))) return;
        if (a.oncePerTurn) state.usedThisTurn.push(usedKey(fc.uid, i));
        pushEffect(state, fc.uid, ps.id, a.steps);
      });
    }
  }
}

function eventMatches(e: GameEvent, ev: EmittedEvent, owner: PlayerId, uid: string): boolean {
  switch (e.kind) {
    case 'donReturned':
      return ev.player === owner;
    case 'characterKO':
      return e.whose === 'any' || (e.whose === 'own') === (ev.player === owner);
    case 'eventActivated':
    case 'blockerActivated':
      return (e.who === 'self') === (ev.player === owner);
    case 'selfRested':
    case 'attackDamage':
    case 'battleKO':
      return ev.card === uid;
  }
}

/** Vira uma carta em campo (dispara "When this Character becomes rested"). */
function restCard(state: GameState, uid: string) {
  const loc = locate(state, uid);
  if (!loc || loc.fc.rested) return;
  // "cannot be rested" vale contra efeitos do oponente; custos/ataques do próprio jogador continuam.
  if (state.activePlayer !== loc.player && state.modifiers.some((m) => m.uid === uid && m.kind === 'cannotBeRested')) return;
  loc.fc.rested = true;
  emit(state, { kind: 'selfRested', player: loc.player, card: uid });
}

/** Devolve DON!! ao deck de DON!! (dispara "When a DON!! card on your field is returned…"). */
function returnDonAndEmit(state: GameState, ps: PlayerState, n: number) {
  if (n <= 0) return;
  returnDon(ps, n);
  emit(state, { kind: 'donReturned', player: ps.id });
}

/** Empilha as habilidades automáticas de uma carta (onPlay, whenAttacking, ...). */
function pushAbilities(state: GameState, uid: string, timing: AbilityTiming) {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  const toPush: Array<[number, Ability]> = [];
  def.abilities.forEach((a, i) => {
    if (a.timing !== timing || !conditionsMet(state, uid, a)) return;
    if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, i))) return;
    toPush.push([i, a]);
  });
  // Empilha de trás para frente para resolver na ordem do texto.
  for (const [i, a] of toPush.reverse()) {
    if (a.oncePerTurn) state.usedThisTurn.push(usedKey(uid, i));
    pushEffect(state, uid, owner, a.steps);
  }
}

function stepPlay(state: GameState, frame: PlayFrame) {
  const owner = ownerOf(state, frame.uid);
  const ps = state.players[owner];
  if (ps.characters.length >= MAX_CHARACTERS) {
    if (!frame.replaceChoice) {
      state.pending = {
        kind: 'selectTargets',
        player: owner,
        options: ps.characters.map((c) => c.uid),
        min: 1,
        max: 1,
        prompt: 'Área de personagens cheia: escolha um personagem para descartar.',
        intent: 'discard',
        source: frame.uid,
      };
      return;
    }
    const out = frame.replaceChoice[0];
    const fc = ps.characters.find((c) => c.uid === out)!;
    ps.donRested += fc.don;
    removeCharacter(state, out);
    ps.trash.push(out);
    log(state, owner, `${cardDef(state, out).name} é descartado para abrir espaço.`);
  }
  ps.characters.push({ uid: frame.uid, rested: Boolean(frame.rested), don: 0, playedOnTurn: state.turn });
  state.stack.pop();
  pushAbilities(state, frame.uid, 'onPlay');
}

function stepBattle(state: GameState) {
  const b = state.battle!;
  const attackerOwner = ownerOf(state, b.attacker);
  const defender = opponent(attackerOwner);

  if (b.step !== 'end' && (!locate(state, b.attacker) || !locate(state, b.target))) {
    log(state, null, 'A batalha termina (uma das cartas saiu do campo).');
    b.step = 'end';
  }

  switch (b.step) {
    case 'whenAttacking': {
      b.step = 'block';
      // [On Your Opponent's Attack] do defensor resolve depois do [When Attacking] (pilha).
      const def = state.players[defender];
      for (const fc of [def.leader, ...def.characters, ...(def.stage ? [def.stage] : [])]) {
        pushAbilities(state, fc.uid, 'onOpponentAttack');
      }
      pushAbilities(state, b.attacker, 'whenAttacking');
      return;
    }

    case 'block': {
      b.step = 'counter';
      const options = blockerOptions(state, defender);
      if (options.length) state.pending = { kind: 'block', player: defender, options };
      return;
    }

    case 'counter': {
      const options = counterOptions(state, defender);
      if (!options.length) {
        b.step = 'damage';
        return;
      }
      state.pending = { kind: 'counter', player: defender, options };
      return;
    }

    case 'damage': {
      b.step = 'end';
      if (locate(state, b.attacker)?.zone === 'character' && locate(state, b.target)?.zone === 'character') {
        b.fought = [b.attacker, b.target];
      }
      const ap = getPower(state, b.attacker);
      const tp = getPower(state, b.target);
      const target = locate(state, b.target)!;
      if (ap < tp) {
        log(state, null, `O ataque falha (${ap} contra ${tp}).`);
        return;
      }
      if (target.zone === 'leader') {
        const n = hasKeyword(state, b.attacker, 'doubleAttack') ? 2 : 1;
        log(state, null, `O ataque acerta o líder (${ap} contra ${tp})${n > 1 ? ' — Double Attack!' : ''}.`);
        // Empilhado antes do dano: resolve depois dele.
        if (state.players[defender].life.length) emit(state, { kind: 'attackDamage', player: attackerOwner, card: b.attacker });
        state.stack.push({
          kind: 'damage',
          defender,
          remaining: n,
          banish: hasKeyword(state, b.attacker, 'banish'),
        });
      } else {
        koCharacter(state, b.target, { inBattle: true, by: b.attacker });
        if (!locate(state, b.target)) emit(state, { kind: 'battleKO', player: attackerOwner, card: b.attacker });
      }
      return;
    }

    case 'end': {
      // "If this Character battles your opponent's Character": dispara ao fim da batalha.
      const fought = (b.fought ?? []).filter((uid) => locate(state, uid));
      state.modifiers = state.modifiers.filter((m) => m.duration !== 'battle');
      state.battle = null;
      state.stack.pop();
      for (const uid of fought) pushAbilities(state, uid, 'battlesCharacter');
      return;
    }
  }
}

function stepDamage(state: GameState, frame: DamageFrame) {
  if (frame.remaining <= 0) {
    state.stack.pop();
    return;
  }
  const ps = state.players[frame.defender];
  if (ps.life.length === 0) {
    gameOver(state, opponent(frame.defender), `O líder de ${ps.name} recebeu dano sem cartas de Vida.`);
    return;
  }
  const card = ps.life.pop()!;
  frame.remaining--;
  const def = cardDef(state, card);
  if (frame.banish) {
    ps.trash.push(card);
    log(state, frame.defender, `[Banish] A carta de Vida vai para o descarte.`);
    return;
  }
  if (def.abilities.some((a) => a.timing === 'trigger')) {
    frame.lifeCard = card;
    state.pending = { kind: 'trigger', player: frame.defender, card };
    return;
  }
  ps.hand.push(card);
  log(state, frame.defender, `${ps.name} perde 1 Vida (${ps.life.length} restante(s)).`);
}

function stepEffect(state: GameState, frame: EffectFrame) {
  if (frame.i >= frame.steps.length) {
    state.stack.pop();
    return;
  }
  const step = frame.steps[frame.i];
  const done = execStep(state, frame, step);
  if (done) {
    frame.i++;
    frame.choice = undefined;
    frame.memo = undefined;
  }
}

/** Resolve alvos. Retorna null quando o motor precisa esperar uma escolha. */
function resolveTargets(
  state: GameState,
  frame: EffectFrame,
  ref: TargetRef,
  intent: 'harm' | 'help',
  prompt: string,
): string[] | null {
  if (ref === 'self') return (frame.last = locate(state, frame.source) ? [frame.source] : []);
  if (ref === 'ownLeader') return (frame.last = [state.players[frame.controller].leader.uid]);
  if (ref === 'battleTarget') {
    return (frame.last = state.battle && locate(state, state.battle.target) ? [state.battle.target] : []);
  }
  if (ref === 'chosen') return (frame.last ?? []).filter((u) => locate(state, u));
  const options = targetCandidates(state, frame.controller, frame.source, ref);
  if (ref.all) return (frame.last = options);
  if (frame.choice) return (frame.last = frame.choice.filter((u) => options.includes(u)));
  if (!options.length) return (frame.last = []);
  state.pending = {
    kind: 'selectTargets',
    player: frame.controller,
    options,
    min: 0,
    max: Math.min(ref.upTo, options.length),
    prompt,
    intent,
    source: frame.source,
  };
  return null;
}

function stepConditionMet(state: GameState, frame: EffectFrame, step: EffectStep): boolean {
  const filter = step.if?.chosenMatches;
  if (filter) {
    const card = frame.last?.[0];
    if (!card || !matchesFilter(cardDef(state, card), filter)) return false;
  }
  return conditionHolds(state, frame.controller, frame.source, step.if);
}

/** Pede ao controlador do efeito que escolha cartas fora do campo (deck, descarte...). */
function askCards(
  state: GameState,
  frame: EffectFrame,
  options: string[],
  max: number,
  prompt: string,
  extra: { min?: number; intent?: 'help' | 'harm' | 'discard'; ordered?: boolean } = {},
) {
  state.pending = {
    kind: 'selectTargets',
    player: frame.controller,
    options,
    min: extra.min ?? 0,
    max: Math.min(max, options.length),
    prompt,
    intent: extra.intent ?? 'help',
    source: frame.source,
    ...(extra.ordered ? { ordered: true } : {}),
  };
}

/** Coloca em campo uma carta (de qualquer zona), sem pagar o custo. */
function playFree(state: GameState, uid: string, rested = false) {
  const def = cardDef(state, uid);
  const ps = state.players[ownerOf(state, uid)];
  if (def.category === 'character') {
    detach(state, uid);
    log(state, ps.id, `${def.name} entra em campo.`);
    state.stack.push({ kind: 'play', uid, ...(rested ? { rested: true } : {}) });
  } else if (def.category === 'stage') {
    detach(state, uid);
    if (ps.stage) {
      const old = ps.stage.uid;
      detach(state, old);
      ps.trash.push(old);
    }
    ps.stage = { uid, rested, don: 0, playedOnTurn: state.turn };
    log(state, ps.id, `${def.name} entra em campo.`);
    pushAbilities(state, uid, 'onPlay');
  }
}

/** Resolve os passos de outro efeito da própria carta ("Activate this card's [Main] effect"). */
function useOwnEffect(state: GameState, frame: EffectFrame, timing: 'main' | 'counter' | 'onPlay' | 'onKO'): false {
  const ability = cardDef(state, frame.source).abilities.find((a) => a.timing === timing);
  frame.i++;
  frame.choice = undefined;
  frame.memo = undefined;
  if (ability) pushEffect(state, frame.source, frame.controller, ability.steps);
  return false; // o índice já avançou
}

/** Registra um modificador; "until the end of your opponent's next turn" calcula o turno em que acaba. */
function addModifier(state: GameState, controller: PlayerId, m: Modifier) {
  const mine = state.activePlayer === controller;
  if (m.duration === 'nextOpponentTurn') {
    // No seu turno: acaba no fim do próximo turno (do oponente). No turno do oponente: no fim do turno seguinte a ele.
    m.untilTurn = state.turn + (mine ? 1 : 2);
  } else if (m.duration === 'untilYourNextTurn' || m.duration === 'endOfYourNextTurn') {
    // Turno em que começa o seu próximo turno.
    m.untilTurn = state.turn + (mine ? 2 : 1);
  }
  state.modifiers.push(m);
}

/** Pergunta com opções de texto; a resposta chega em frame.choice = [índice]. */
function askOption(state: GameState, frame: EffectFrame, player: PlayerId, prompt: string, options: string[]) {
  state.pending = { kind: 'option', player, source: frame.source, prompt, options };
}

/** Interrompe o efeito: os passos restantes não acontecem. */
function abortEffect(frame: EffectFrame): false {
  frame.i = frame.steps.length;
  frame.choice = undefined;
  frame.memo = undefined;
  return false;
}

/**
 * Paga a parte imediata de um custo (virar a carta, virar DON!!, DON!! −X) e devolve os passos
 * das partes que exigem escolha (descartar, virar Personagens, devolver cartas…).
 */
function payImmediateCost(state: GameState, player: PlayerId, source: string, cost: AbilityCost): EffectStep[] {
  const ps = state.players[player];
  if (cost.restSelf && locate(state, source)) restCard(state, source);
  if (cost.restDon) payDon(ps, cost.restDon);
  if (cost.donMinus) {
    returnDonAndEmit(state, ps, cost.donMinus);
    log(state, player, `${ps.name} devolve ${cost.donMinus} DON!! ao deck de DON!!.`);
  }
  const steps: EffectStep[] = [];
  if (cost.trashFromHand) steps.push({ do: 'trashFromHand', count: cost.trashFromHand, filter: cost.trashFilter });
  if (cost.handToBottom) steps.push({ do: 'handToDeckBottom', count: cost.handToBottom });
  if (cost.restCharacters) steps.push({ do: 'restOwnCharacters', count: cost.restCharacters });
  if (cost.restOwn) steps.push({ do: 'restOwn', ...cost.restOwn });
  if (cost.returnOwn) steps.push({ do: 'returnOwn', ...cost.returnOwn });
  if (cost.lifeToHand) steps.push({ do: 'lifeToHand', count: cost.lifeToHand, choose: cost.lifeChoice });
  if (cost.lifeToTrash) steps.push({ do: 'lifeToTrash', ...cost.lifeToTrash });
  if (cost.lifeFace) steps.push({ do: 'lifeFace', ...cost.lifeFace });
  if (cost.mill) steps.push({ do: 'millDeck', count: cost.mill });
  if (cost.trashToBottom) steps.push({ do: 'trashToDeckBottom', ...cost.trashToBottom });
  if (cost.reveal) steps.push({ do: 'revealFromHand', ...cost.reveal });
  if (cost.returnSelf) steps.push({ do: 'returnSelfToHand' });
  if (cost.koOwn) steps.push({ do: 'koOwn', ...cost.koOwn });
  if (cost.trashOwn) steps.push({ do: 'trashOwn', ...cost.trashOwn });
  if (cost.selfToBottom) steps.push({ do: 'selfToDeckBottom' });
  if (cost.trashSelf) steps.push({ do: 'trashSelf' });
  return steps;
}

/** Cartas de Vida viradas para baixo, do topo para o fundo. */
function faceDownLife(ps: PlayerState): string[] {
  return [...ps.life].reverse().filter((u) => !ps.lifeFaceUp?.includes(u));
}

export function canPayCost(state: GameState, player: PlayerId, source: string, cost: AbilityCost): boolean {
  const ps = state.players[player];
  if (cost.restSelf && (!locate(state, source) || locate(state, source)!.fc.rested)) return false;
  if ((cost.restDon ?? 0) > ps.donActive) return false;
  if ((cost.donMinus ?? 0) > totalDonOnField(ps)) return false;
  if ((cost.trashFromHand ?? 0) > discardable(state, player, cost.trashFilter).length) return false;
  if ((cost.handToBottom ?? 0) > ps.hand.length) return false;
  if ((cost.lifeToHand ?? 0) > ps.life.length) return false;
  if ((cost.restCharacters ?? 0) > ps.characters.filter((c) => !c.rested && c.uid !== source).length) return false;
  if (cost.restOwn && ownCostOptions(state, player, source, cost.restOwn.spec, true).length < cost.restOwn.count) return false;
  if (cost.returnOwn && ownCostOptions(state, player, source, cost.returnOwn.spec, false).length < cost.returnOwn.count) {
    return false;
  }
  if ((cost.trashSelf || cost.returnSelf || cost.selfToBottom) && locate(state, source)?.zone !== 'character') return false;
  if (cost.koOwn && ownCostOptions(state, player, source, cost.koOwn.spec, false).length < cost.koOwn.count) return false;
  if (cost.trashOwn && ownCostOptions(state, player, source, cost.trashOwn.spec, false).length < cost.trashOwn.count) return false;
  if ((cost.mill ?? 0) > ps.deck.length) return false;
  if ((cost.lifeToTrash?.count ?? 0) > ps.life.length) return false;
  if (cost.trashToBottom && ps.trash.filter((u) => !cost.trashToBottom!.filter || matchesFilter(cardDef(state, u), cost.trashToBottom!.filter)).length < cost.trashToBottom.count) {
    return false;
  }
  if (cost.reveal && discardable(state, player, cost.reveal.filter).length < cost.reveal.count) return false;
  if (cost.lifeFace) {
    const avail = cost.lifeFace.up ? faceDownLife(ps).length : ps.life.filter((u) => ps.lifeFaceUp?.includes(u)).length;
    if (avail < cost.lifeFace.count) return false;
  }
  return true;
}

/** Cartas suas que podem pagar um custo de "rest/return N of your …". */
function ownCostOptions(state: GameState, player: PlayerId, source: string, spec: TargetSpec, needActive: boolean): string[] {
  return targetCandidates(state, player, source, { ...spec, side: 'own' }).filter(
    (u) => u !== source && (!needActive || !locate(state, u)?.fc.rested),
  );
}

export function describeCost(cost: AbilityCost): string {
  const parts: string[] = [];
  if (cost.donMinus) parts.push(`DON!! −${cost.donMinus} (devolver ${cost.donMinus} DON!! ao deck de DON!!)`);
  if (cost.restDon) parts.push(`virar ${cost.restDon} DON!!`);
  if (cost.restSelf) parts.push('virar esta carta');
  if (cost.trashFromHand) parts.push(`descartar ${cost.trashFromHand} carta(s) da mão`);
  if (cost.handToBottom) parts.push(`colocar ${cost.handToBottom} carta(s) da mão no fundo do deck`);
  if (cost.lifeToHand) parts.push(`colocar ${cost.lifeToHand} carta(s) da Vida na mão`);
  if (cost.restOwn) parts.push(`virar ${cost.restOwn.count} carta(s) sua(s)`);
  if (cost.returnOwn) parts.push(`devolver ${cost.returnOwn.count} Personagem(ns) seu(s) à mão`);
  if (cost.trashSelf) parts.push('descartar esta carta');
  if (cost.selfToBottom) parts.push('colocar esta carta no fundo do deck');
  if (cost.koOwn) parts.push(`nocautear ${cost.koOwn.count} Personagem(ns) seu(s)`);
  if (cost.trashOwn) parts.push(`descartar ${cost.trashOwn.count} Personagem(ns) seu(s)`);
  if (cost.returnSelf) parts.push('devolver esta carta à mão');
  if (cost.mill) parts.push(`descartar ${cost.mill} carta(s) do topo do deck`);
  if (cost.trashToBottom) parts.push(`colocar ${cost.trashToBottom.count} carta(s) do descarte no fundo do deck`);
  if (cost.lifeToTrash) parts.push(`descartar ${cost.lifeToTrash.count} carta(s) da Vida`);
  if (cost.reveal) parts.push(`revelar ${cost.reveal.count} carta(s) da mão`);
  if (cost.lifeFace) parts.push(`virar ${cost.lifeFace.count} carta(s) de Vida para ${cost.lifeFace.up ? 'cima' : 'baixo'}`);
  if (cost.restCharacters) parts.push(`virar ${cost.restCharacters} Personagem(ns) seu(s)`);
  return parts.join(' e ');
}

function execStep(state: GameState, frame: EffectFrame, step: EffectStep): boolean {
  const ps = state.players[frame.controller];
  const srcName = cardDef(state, frame.source).name;
  if (!frame.choice && !frame.memo && !stepConditionMet(state, frame, step)) return true;

  switch (step.do) {
    case 'power': {
      const t = resolveTargets(
        state,
        frame,
        step.target,
        step.amount < 0 ? 'harm' : 'help',
        `${srcName}: escolha quem recebe ${step.amount > 0 ? '+' : ''}${step.amount} de poder.`,
      );
      if (!t) return false;
      const duration = step.duration === 'battle' && !state.battle ? 'turn' : step.duration;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount, duration });
        log(state, frame.controller, `${cardDef(state, uid).name} recebe ${step.amount > 0 ? '+' : ''}${step.amount} de poder.`);
      }
      return true;
    }
    case 'ko': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um personagem para K.O.`);
      if (!t) return false;
      for (const uid of t) {
        const zone = locate(state, uid)?.zone;
        if (zone === 'character') koCharacter(state, uid);
        else if (zone === 'stage') {
          // Stages nocauteados vão para o descarte (sem [On K.O.]).
          detach(state, uid);
          state.players[ownerOf(state, uid)].trash.push(uid);
          log(state, frame.controller, `${cardDef(state, uid).name} (Stage) foi nocauteado.`);
        }
      }
      return true;
    }
    case 'rest': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha uma carta para virar.`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc) {
          restCard(state, uid);
          log(state, frame.controller, `${cardDef(state, uid).name} é virado.`);
        }
      }
      return true;
    }
    case 'setActive': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha uma carta para desvirar.`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc) {
          loc.fc.rested = false;
          log(state, frame.controller, `${cardDef(state, uid).name} fica ativo.`);
        }
      }
      return true;
    }
    case 'giveRestedDon': {
      if (ps.donRested === 0) return true;
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe DON!! virado(s).`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        const n = Math.min(step.count, ps.donRested);
        if (loc && n > 0) {
          ps.donRested -= n;
          loc.fc.don += n;
          log(state, frame.controller, `${cardDef(state, uid).name} recebe ${n} DON!!.`);
        }
      }
      return true;
    }
    case 'draw':
      drawCards(state, frame.controller, step.count);
      log(state, frame.controller, `${ps.name} compra ${step.count} carta(s).`);
      return true;
    case 'addDonFromDeck': {
      const n = Math.min(step.count, ps.donDeck);
      ps.donDeck -= n;
      if (step.rested) ps.donRested += n;
      else ps.donActive += n;
      return true;
    }
    case 'restOpponentDon': {
      const o = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, o.donActive);
      o.donActive -= n;
      o.donRested += n;
      if (n) log(state, frame.controller, `${n} DON!! de ${o.name} é virado.`);
      return true;
    }
    case 'returnToHand': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um personagem para devolver à mão.`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc?.zone !== 'character') continue;
        const owner = state.players[loc.player];
        owner.donRested += loc.fc.don;
        removeCharacter(state, uid);
        owner.hand.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} volta para a mão.`);
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
            ? `O oponente não pode usar [Blocker] com ${step.minPower}+ de poder nesta batalha.`
            : 'O oponente não pode usar [Blocker] nesta batalha.',
        );
      }
      return true;
    case 'noBlockerWhenAttacking': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem ataca sem poder ser bloqueado.`);
      if (!t) return false;
      for (const uid of t) state.modifiers.push({ uid, kind: 'noBlockerWhenAttacking', amount: 0, duration: 'turn' });
      return true;
    }
    case 'playThis': {
      if (zoneOf(state, frame.source) === 'character' || zoneOf(state, frame.source) === 'stage') return true;
      playFree(state, frame.source);
      return true;
    }
    case 'trashFromHand': {
      const options = discardable(state, frame.controller, step.filter);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options,
          min: step.upTo ? 0 : n,
          max: n,
          prompt: `${srcName}: escolha ${n} carta(s) da mão para descartar.`,
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        log(state, frame.controller, `${ps.name} descarta ${cardDef(state, uid).name}.`);
      }
      return true;
    }
    case 'setDonActive': {
      const n = Math.min(step.count, ps.donRested);
      ps.donRested -= n;
      ps.donActive += n;
      if (n) log(state, frame.controller, `${n} DON!! de ${ps.name} fica(m) ativo(s).`);
      return true;
    }
    case 'search': {
      const top = ps.deck.slice(0, step.look);
      const options = top.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice && options.length) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options,
          min: 0,
          max: Math.min(step.upTo, options.length),
          prompt: `${srcName}: olhe as ${top.length} cartas do topo e escolha até ${step.upTo} para ${step.play ? 'jogar' : 'adicionar à mão'}.`,
          intent: 'help',
          source: frame.source,
        };
        return false;
      }
      const chosen = (frame.choice ?? []).filter((u) => options.includes(u));
      for (const uid of top) removeFrom(ps.deck, uid);
      for (const uid of chosen) {
        if (step.play) {
          // "play up to 1 … Then, place the rest at the bottom": joga a carta (o resto vai para o fundo antes).
          ps.hand.push(uid);
          playFree(state, uid);
        } else {
          ps.hand.push(uid);
          log(state, frame.controller, `${ps.name} revela ${cardDef(state, uid).name} e adiciona à mão.`);
        }
      }
      const rest = top.filter((u) => !chosen.includes(u));
      if (step.rest === 'bottom') ps.deck.push(...rest);
      else if (step.rest === 'trash') ps.trash.push(...rest);
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
        if (!canPayCost(state, frame.controller, frame.source, cost)) {
          if (step.scope === undefined) return abortEffect(frame);
          frame.i += step.scope;
          return true;
        }
        state.pending = {
          kind: 'confirm',
          player: frame.controller,
          source: frame.source,
          prompt: Object.keys(cost).length
            ? `${srcName}: usar o efeito? Custo: ${describeCost(cost)}.`
            : `${srcName}: usar o efeito?`,
        };
        return false;
      }
      if (!frame.choice.length) {
        log(state, frame.controller, `${ps.name} não usa o efeito de ${srcName}.`);
        if (step.scope === undefined) return abortEffect(frame);
        // "you may X" no meio do efeito: pula só X (e o "If you do, …"), o resto continua.
        frame.i += step.scope;
        return true;
      }
      frame.steps.splice(frame.i + 1, 0, ...payImmediateCost(state, frame.controller, frame.source, cost));
      return true;
    }
    case 'trashLife': {
      const target = state.players[step.side === 'own' ? frame.controller : opponent(frame.controller)];
      const n = Math.min(step.count, target.life.length);
      for (let i = 0; i < n; i++) target.trash.push(target.life.pop()!);
      if (n) log(state, frame.controller, `${n} carta(s) de Vida de ${target.name} vão para o descarte.`);
      return true;
    }
    case 'gainKeyword': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem ganha [${step.keyword}].`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'keyword', keyword: step.keyword, amount: 0, duration: step.duration });
      return true;
    }
    case 'select': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha uma carta.`);
      return Boolean(t);
    }
    case 'cannotBeKO': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem não pode ser nocauteado.`);
      if (!t) return false;
      for (const uid of t.filter((u) => locate(state, u)?.zone === 'character')) {
        addModifier(state, frame.controller, { uid, kind: step.inBattle ? 'cannotBeKOInBattle' : 'cannotBeKO', amount: 0, duration: step.duration });
        log(state, frame.controller, `${cardDef(state, uid).name} não pode ser nocauteado${step.inBattle ? ' em batalha' : ''} neste turno.`);
      }
      return true;
    }
    case 'cost': {
      const t = resolveTargets(
        state,
        frame,
        step.target,
        step.amount < 0 ? 'harm' : 'help',
        `${srcName}: escolha quem recebe ${step.amount > 0 ? '+' : ''}${step.amount} de custo.`,
      );
      if (!t) return false;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'cost', amount: step.amount, duration: step.duration });
        log(state, frame.controller, `${cardDef(state, uid).name}: ${step.amount > 0 ? '+' : ''}${step.amount} de custo.`);
      }
      return true;
    }
    case 'opponentDiscards': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, opp.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options: [...opp.hand],
          min: n,
          max: n,
          prompt: `${srcName}: escolha ${n} carta(s) da sua mão para descartar.`,
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.hand.includes(u))) {
        removeFrom(opp.hand, uid);
        opp.trash.push(uid);
        log(state, opp.id, `${opp.name} descarta ${cardDef(state, uid).name}.`);
      }
      return true;
    }
    case 'tutor': {
      const options = ps.deck.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice) {
        if (!options.length) return true;
        askCards(state, frame, options, step.upTo, `${srcName}: escolha até ${step.upTo} carta(s) do deck para adicionar à mão.`);
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.deck, uid);
        ps.hand.push(uid);
        log(state, frame.controller, `${ps.name} revela ${cardDef(state, uid).name} do deck e adiciona à mão.`);
      }
      return true;
    }
    case 'restOwn':
    case 'returnOwn': {
      const rest = step.do === 'restOwn';
      const options = ownCostOptions(state, frame.controller, frame.source, step.spec, rest);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, `${srcName}: escolha ${n} carta(s) sua(s) para ${rest ? 'virar' : 'devolver à mão'}.`, { min: n });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        if (rest) restCard(state, uid);
        else {
          detach(state, uid);
          state.players[ownerOf(state, uid)].hand.push(uid);
          log(state, frame.controller, `${cardDef(state, uid).name} volta para a mão.`);
        }
      }
      return true;
    }
    case 'koOwn':
    case 'trashOwn': {
      const options = ownCostOptions(state, frame.controller, frame.source, step.spec, false);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, `${srcName}: escolha ${n} Personagem(ns) seu(s) para ${step.do === 'koOwn' ? 'nocautear' : 'descartar'}.`, { min: n, intent: 'discard' });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        if (step.do === 'koOwn') koCharacter(state, uid, { force: true });
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
      log(state, frame.controller, `${srcName} vai para o fundo do deck.`);
      return true;
    }
    case 'trashTarget': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um Personagem para o descarte.`);
      if (!t) return false;
      for (const uid of t.filter((u) => locate(state, u)?.zone === 'character')) {
        const owner = state.players[ownerOf(state, uid)];
        detach(state, uid);
        owner.trash.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} vai para o descarte.`);
      }
      return true;
    }
    case 'trashRandomFromOpponentHand': {
      const opp = state.players[opponent(frame.controller)];
      for (let i = 0; i < step.count && opp.hand.length; i++) {
        const uid = opp.hand[Math.floor(nextRandom(state) * opp.hand.length)];
        removeFrom(opp.hand, uid);
        opp.trash.push(uid);
        log(state, frame.controller, `${opp.name} descarta ${cardDef(state, uid).name} (escolhida ao acaso).`);
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
      log(state, frame.controller, `${srcName} vai para ${step.do === 'trashSelf' ? 'o descarte' : 'a mão'}.`);
      return true;
    }
    case 'trashToDeckBottom': {
      const options = ps.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter));
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, `${srcName}: escolha ${n} carta(s) do descarte para o fundo do deck.`, { min: n });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.trash, uid);
        ps.deck.push(uid);
      }
      log(state, frame.controller, `${ps.name} coloca ${n} carta(s) do descarte no fundo do deck.`);
      return true;
    }
    case 'lifeToTrash': {
      const n = Math.min(step.count, ps.life.length);
      if (n === 0) return true;
      if (step.choose && ps.life.length > 1 && !frame.choice) {
        askOption(state, frame, frame.controller, `${srcName}: descartar a carta do topo ou do fundo da Vida?`, ['Topo da Vida', 'Fundo da Vida']);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) ps.trash.push(fromBottom ? ps.life.shift()! : ps.life.pop()!);
      log(state, frame.controller, `${ps.name} descarta ${n} carta(s) da Vida.`);
      return true;
    }
    case 'revealFromHand': {
      const options = discardable(state, frame.controller, step.filter);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, `${srcName}: escolha ${n} carta(s) da mão para revelar.`, { min: n });
        return false;
      }
      log(state, frame.controller, `${ps.name} revela ${frame.choice.map((u) => cardDef(state, u).name).join(', ')}.`);
      return true;
    }
    case 'lifeFace': {
      ps.lifeFaceUp ??= [];
      const pool = step.up ? faceDownLife(ps) : [...ps.life].reverse().filter((u) => ps.lifeFaceUp!.includes(u));
      for (const uid of pool.slice(0, step.count)) {
        if (step.up) ps.lifeFaceUp.push(uid);
        else removeFrom(ps.lifeFaceUp, uid);
      }
      log(state, frame.controller, `${ps.name} vira ${Math.min(step.count, pool.length)} carta(s) de Vida para ${step.up ? 'cima' : 'baixo'}.`);
      return true;
    }
    case 'skipRefresh': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha quem não desvira no próximo turno.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'skipRefresh', amount: 0, duration: 'nextOpponentTurn' });
      return true;
    }
    case 'revealTop': {
      const card = ps.deck[0];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, `${ps.name} revela ${cardDef(state, card).name} do topo do deck.`);
      return true;
    }
    case 'playRevealed': {
      const card = frame.last?.[0];
      if (card && ps.deck.includes(card) && (!step.filter || matchesFilter(cardDef(state, card), step.filter))) {
        const def = cardDef(state, card);
        if (def.category === 'character' || def.category === 'stage') playFree(state, card, step.rested);
      }
      return true;
    }
    case 'revealedToBottom': {
      const card = frame.last?.[0];
      if (card && ps.deck.includes(card)) {
        removeFrom(ps.deck, card);
        ps.deck.push(card);
      }
      return true;
    }
    case 'cannotBeRested': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha quem não pode ser virado.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'cannotBeRested', amount: 0, duration: step.duration });
      return true;
    }
    case 'opponentLifeToHand': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, opp.life.length);
      for (let i = 0; i < n; i++) opp.hand.push(opp.life.pop()!);
      if (n) log(state, frame.controller, `${opp.name} coloca ${n} carta(s) da Vida na mão.`);
      return true;
    }
    case 'opponentHandToBottom': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, opp.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options: [...opp.hand],
          min: n,
          max: n,
          prompt: `${srcName}: escolha ${n} carta(s) da sua mão para o fundo do deck.`,
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.hand.includes(u))) {
        removeFrom(opp.hand, uid);
        opp.deck.push(uid);
      }
      log(state, opp.id, `${opp.name} coloca ${n} carta(s) da mão no fundo do deck.`);
      return true;
    }
    case 'delayed':
      (state.delayed ??= []).push({ controller: frame.controller, source: frame.source, steps: step.steps });
      return true;
    case 'lifeToHand': {
      const n = Math.min(step.count, ps.life.length);
      if (n === 0) return true;
      if (step.choose && ps.life.length > 1 && !frame.choice) {
        askOption(state, frame, frame.controller, `${srcName}: de onde tirar a carta de Vida?`, ['Topo da Vida', 'Fundo da Vida']);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) ps.hand.push(fromBottom ? ps.life.shift()! : ps.life.pop()!);
      log(state, frame.controller, `${ps.name} coloca ${n} carta(s) da Vida (${fromBottom ? 'fundo' : 'topo'}) na mão.`);
      return true;
    }
    case 'handToLife': {
      const options = discardable(state, frame.controller, step.filter);
      if (!frame.choice) {
        if (!options.length) return true;
        askCards(state, frame, options, step.upTo, `${srcName}: escolha até ${step.upTo} carta(s) da mão para o topo da Vida.`);
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.life.push(uid);
      }
      if (frame.choice.length) log(state, frame.controller, `${ps.name} coloca ${frame.choice.length} carta(s) da mão na Vida.`);
      return true;
    }
    case 'fieldToLife': {
      // Com "top or bottom": primeiro o alvo (memo), depois a posição.
      let targets = frame.memo;
      if (!targets) {
        const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha um Personagem para a Vida.`);
        if (!t) return false;
        targets = t.filter((u) => locate(state, u)?.zone === 'character');
        if (step.choose && targets.length) {
          frame.memo = targets;
          frame.choice = undefined;
          askOption(state, frame, frame.controller, `${srcName}: colocar no topo ou no fundo da Vida?`, ['Topo da Vida', 'Fundo da Vida']);
          return false;
        }
      }
      const bottom = Boolean(step.choose) && frame.choice?.[0] === '1';
      for (const uid of targets.filter((u) => locate(state, u)?.zone === 'character')) {
        const owner = state.players[ownerOf(state, uid)];
        detach(state, uid);
        if (bottom) owner.life.unshift(uid);
        else owner.life.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} vai para o ${bottom ? 'fundo' : 'topo'} da Vida de ${owner.name}.`);
      }
      return true;
    }
    case 'peekLife': {
      const opp = state.players[opponent(frame.controller)];
      // Etapa 1: de quem é a Vida (memo[0] = 'own' | 'opp').
      if (!frame.memo) {
        const sides = (step.whose === 'either' ? ['own', 'opp'] : [step.whose === 'own' ? 'own' : 'opp']).filter(
          (side) => (side === 'own' ? ps : opp).life.length > 0,
        );
        if (!sides.length) return true;
        if (!frame.choice) {
          const labels = sides.map((side) => (side === 'own' ? 'Olhar a sua Vida' : 'Olhar a Vida do oponente'));
          askOption(state, frame, frame.controller, `${srcName}: olhar a carta do topo de qual Vida?`, [...labels, 'Não olhar']);
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
        askOption(state, frame, frame.controller, `${srcName}: a carta do topo é ${cardDef(state, card).name}. Onde deixar?`, [
          'Manter no topo',
          'Colocar no fundo',
        ]);
        return false;
      }
      if (frame.choice[0] === '1') life.unshift(life.pop()!);
      log(
        state,
        frame.controller,
        `${ps.name} olha a carta do topo da Vida ${side === 'own' ? 'própria' : 'do oponente'} e a deixa no ${frame.choice[0] === '1' ? 'fundo' : 'topo'}.`,
      );
      return true;
    }
    case 'chooseOne': {
      const chooser = step.chooser === 'self' ? frame.controller : opponent(frame.controller);
      if (!frame.choice) {
        askOption(state, frame, chooser, `${srcName}: escolha um efeito.`, step.labels);
        return false;
      }
      const picked = step.options[Number(frame.choice[0])] ?? [];
      log(state, chooser, `Escolhido: ${step.labels[Number(frame.choice[0])] ?? '-'}`);
      frame.i++;
      frame.choice = undefined;
      frame.memo = undefined;
      pushEffect(state, frame.source, frame.controller, picked);
      return false;
    }
    case 'restOwnCharacters': {
      const options = ps.characters.filter((c) => !c.rested && c.uid !== frame.source).map((c) => c.uid);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, `${srcName}: escolha ${n} Personagem(ns) seu(s) para virar.`, { min: n });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) restCard(state, uid);
      return true;
    }
    case 'handToDeckBottom': {
      const n = Math.min(step.count, ps.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, [...ps.hand], n, `${srcName}: escolha ${n} carta(s) da mão para o fundo do deck.`, {
          min: n,
          intent: 'discard',
        });
        return false;
      }
      for (const uid of frame.choice.filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.deck.push(uid);
      }
      log(state, frame.controller, `${ps.name} coloca ${n} carta(s) da mão no fundo do deck.`);
      return true;
    }
    case 'canAttackActive':
    case 'cannotAttack': {
      const harm = step.do === 'cannotAttack';
      const t = resolveTargets(state, frame, step.target, harm ? 'harm' : 'help', `${srcName}: escolha o alvo do efeito.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: step.do, amount: 0, duration: step.duration });
      return true;
    }
    case 'drawUntil': {
      const n = Math.max(0, step.count - ps.hand.length);
      if (n) {
        drawCards(state, frame.controller, n);
        log(state, frame.controller, `${ps.name} compra ${n} carta(s).`);
      }
      return true;
    }
    case 'opponentReturnsDon': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, totalDonOnField(opp));
      if (n) {
        returnDonAndEmit(state, opp, n);
        log(state, frame.controller, `${opp.name} devolve ${n} DON!! ao deck de DON!!.`);
      }
      return true;
    }
    case 'millDeck': {
      const n = Math.min(step.count, ps.deck.length);
      ps.trash.push(...ps.deck.splice(0, n));
      if (n) log(state, frame.controller, `${ps.name} descarta ${n} carta(s) do topo do deck.`);
      return true;
    }
    case 'useOwnEffect':
      return useOwnEffect(state, frame, step.timing);
    case 'addThisToHand': {
      const owner = state.players[ownerOf(state, frame.source)];
      if (owner.trash.includes(frame.source)) {
        removeFrom(owner.trash, frame.source);
        owner.hand.push(frame.source);
        log(state, frame.controller, `${srcName} vai para a mão.`);
      }
      return true;
    }
    case 'addLifeFromDeck': {
      const n = Math.min(step.count, ps.deck.length);
      for (let i = 0; i < n; i++) ps.life.push(ps.deck.shift()!);
      if (n) log(state, frame.controller, `${ps.name} adiciona ${n} carta(s) do deck à Vida.`);
      return true;
    }
    case 'useMainEffect':
      return useOwnEffect(state, frame, 'main');
    case 'useCounterEffect':
      return useOwnEffect(state, frame, 'counter');
    case 'toDeckBottom': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um personagem para o fundo do deck.`);
      if (!t) return false;
      for (const uid of t) {
        if (locate(state, uid)?.zone !== 'character') continue;
        const owner = state.players[ownerOf(state, uid)];
        detach(state, uid);
        owner.deck.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} vai para o fundo do deck de ${owner.name}.`);
      }
      return true;
    }
    case 'fromTrashToHand': {
      const options = ps.trash.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice) {
        if (!options.length) return true;
        askCards(state, frame, options, step.upTo, `${srcName}: escolha até ${step.upTo} carta(s) do descarte para a mão.`);
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.trash, uid);
        ps.hand.push(uid);
        log(state, frame.controller, `${ps.name} adiciona ${cardDef(state, uid).name} do descarte à mão.`);
      }
      return true;
    }
    case 'playFrom': {
      const zone =
        step.from === 'deck' ? ps.deck : step.from === 'hand' ? ps.hand : step.from === 'trash' ? ps.trash : [...ps.hand, ...ps.trash];
      const options = zone.filter((u) => {
        const def = cardDef(state, u);
        return (def.category === 'character' || def.category === 'stage') && matchesFilter(def, step.filter);
      });
      if (!frame.choice) {
        if (!options.length) return true;
        const where =
          step.from === 'deck' ? 'do deck' : step.from === 'hand' ? 'da mão' : step.from === 'trash' ? 'do descarte' : 'da mão ou do descarte';
        askCards(state, frame, options, step.upTo, `${srcName}: escolha até ${step.upTo} carta(s) ${where} para jogar.`);
        return false;
      }
      // Empilhadas ao contrário para entrarem na ordem escolhida.
      const chosen = frame.choice.filter((u) => options.includes(u));
      for (const uid of chosen.reverse()) playFree(state, uid, step.rested);
      return true;
    }
    case 'shuffleDeck':
      shuffleInPlace(state, ps.deck);
      log(state, frame.controller, `${ps.name} embaralha o deck.`);
      return true;
    case 'arrangeTop': {
      // 1ª escolha: cartas que vão para o fundo. 2ª (se sobrar 2+ no topo): ordem do topo.
      if (!frame.memo) {
        const top = ps.deck.slice(0, step.look);
        if (!top.length) return true;
        if (!frame.choice) {
          askCards(
            state,
            frame,
            top,
            top.length,
            `${srcName}: estas são as ${top.length} cartas do topo. Escolha as que vão para o fundo do deck (na ordem); as demais ficam no topo.`,
            { ordered: true },
          );
          return false;
        }
        const bottom = frame.choice.filter((u) => top.includes(u));
        const keep = top.filter((u) => !bottom.includes(u));
        // As que ficam continuam no topo (visíveis) até a escolha da ordem.
        for (const uid of bottom) removeFrom(ps.deck, uid);
        ps.deck.push(...bottom);
        if (bottom.length) log(state, frame.controller, `${ps.name} coloca ${bottom.length} carta(s) no fundo do deck.`);
        if (keep.length <= 1) return true;
        frame.memo = keep;
        frame.choice = undefined;
        askCards(
          state,
          frame,
          keep,
          keep.length,
          `${srcName}: clique nas cartas na ordem em que ficarão no topo (a primeira fica por cima).`,
          { min: keep.length, ordered: true },
        );
        return false;
      }
      const keep = frame.memo;
      const chosen = (frame.choice ?? []).filter((u) => keep.includes(u));
      const order = [...chosen, ...keep.filter((u) => !chosen.includes(u))];
      for (const uid of order) removeFrom(ps.deck, uid);
      ps.deck.unshift(...order);
      log(state, frame.controller, `${ps.name} devolve ${order.length} carta(s) ao topo do deck.`);
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Ferramentas manuais (efeitos ainda não automatizados)
// ---------------------------------------------------------------------------

/**
 * Quando o jogador pode usar as ferramentas manuais: ao resolver um efeito manual,
 * na etapa de Counter (efeitos contínuos do defensor) e livremente no próprio turno.
 */
export function manualAllowed(state: GameState, player: PlayerId): boolean {
  if (state.phase !== 'main') return false;
  const pending = state.pending;
  if (pending) return (pending.kind === 'manual' || pending.kind === 'counter') && pending.player === player;
  return isIdle(state) && state.activePlayer === player;
}

type CardZone = 'hand' | 'deck' | 'trash' | 'life' | 'leader' | 'character' | 'stage';

export function zoneOf(state: GameState, uid: string): CardZone | null {
  const loc = locate(state, uid);
  if (loc) return loc.zone;
  const ps = state.players[ownerOf(state, uid)];
  if (ps.hand.includes(uid)) return 'hand';
  if (ps.deck.includes(uid)) return 'deck';
  if (ps.trash.includes(uid)) return 'trash';
  if (ps.life.includes(uid)) return 'life';
  return null;
}

/** Tira a carta de onde estiver (DON!! anexados voltam virados à área de custo). */
function detach(state: GameState, uid: string) {
  const ps = state.players[ownerOf(state, uid)];
  const loc = locate(state, uid);
  if (loc?.zone === 'character') {
    ps.donRested += loc.fc.don;
    removeCharacter(state, uid);
    return;
  }
  if (loc?.zone === 'stage') {
    ps.donRested += loc.fc.don;
    ps.stage = null;
    state.modifiers = state.modifiers.filter((m) => m.uid !== uid);
    return;
  }
  for (const zone of [ps.hand, ps.deck, ps.trash, ps.life]) removeFrom(zone, uid);
}

const ZONE_LABEL: Record<string, string> = {
  hand: 'a mão',
  trash: 'o descarte',
  deckTop: 'o topo do deck',
  deckBottom: 'o fundo do deck',
  life: 'a Vida',
  character: 'o campo',
  stage: 'o campo (Stage)',
};

function applyManualOp(state: GameState, p: PlayerId, op: ManualOp) {
  const ps = state.players[p];
  const tag = '(manual)';
  const fieldCard = (uid: string) => {
    const loc = locate(state, uid);
    if (!loc) throw new IllegalActionError('A carta precisa estar em campo.');
    return loc;
  };

  switch (op.op) {
    case 'draw': {
      const n = Math.max(1, Math.min(10, Math.floor(op.count)));
      drawCards(state, p, n);
      log(state, p, `${tag} ${ps.name} compra ${n} carta(s).`);
      return;
    }
    case 'move': {
      if (!state.cards[op.uid]) throw new IllegalActionError('Carta inválida.');
      const owner = ownerOf(state, op.uid);
      const from = zoneOf(state, op.uid);
      const def = cardDef(state, op.uid);
      if (!from || from === 'leader') throw new IllegalActionError('Essa carta não pode ser movida.');
      if (owner !== p && !['character', 'stage', 'life'].includes(from)) {
        throw new IllegalActionError('Do oponente, só é possível mover cartas em campo ou da Vida.');
      }
      const os = state.players[owner];
      if (op.to === 'character') {
        if (def.category !== 'character') throw new IllegalActionError('Só Personagens vão para a área de personagens.');
        if (from !== 'character' && os.characters.length >= MAX_CHARACTERS) {
          throw new IllegalActionError('Área de personagens cheia: descarte um antes.');
        }
      }
      if (op.to === 'stage' && def.category !== 'stage') throw new IllegalActionError('Só Stages vão para a área de Stage.');
      detach(state, op.uid);
      switch (op.to) {
        case 'hand':
          os.hand.push(op.uid);
          break;
        case 'trash':
          os.trash.push(op.uid);
          break;
        case 'deckTop':
          os.deck.unshift(op.uid);
          break;
        case 'deckBottom':
          os.deck.push(op.uid);
          break;
        case 'life':
          os.life.push(op.uid);
          break;
        case 'character':
          os.characters.push({ uid: op.uid, rested: Boolean(op.rested), don: 0, playedOnTurn: state.turn });
          break;
        case 'stage':
          if (os.stage) {
            const old = os.stage.uid;
            detach(state, old);
            os.trash.push(old);
          }
          os.stage = { uid: op.uid, rested: Boolean(op.rested), don: 0, playedOnTurn: state.turn };
          break;
      }
      const shown = ['deck', 'hand', 'life'].includes(from) && owner !== p ? 'Uma carta' : def.name;
      log(state, p, `${tag} ${shown} vai para ${ZONE_LABEL[op.to]}${owner !== p ? ` de ${os.name}` : ''}.`);
      if (op.to === 'character' || op.to === 'stage') pushAbilities(state, op.uid, 'onPlay');
      return;
    }
    case 'ko': {
      const loc = fieldCard(op.uid);
      if (loc.zone !== 'character') throw new IllegalActionError('Só Personagens podem ser nocauteados.');
      log(state, p, `${tag} K.O. em ${cardDef(state, op.uid).name}.`);
      koCharacter(state, op.uid, { force: true });
      return;
    }
    case 'setRested': {
      const loc = fieldCard(op.uid);
      loc.fc.rested = op.rested;
      log(state, p, `${tag} ${cardDef(state, op.uid).name} fica ${op.rested ? 'virado' : 'ativo'}.`);
      return;
    }
    case 'power': {
      fieldCard(op.uid);
      const duration = op.duration === 'battle' && !state.battle ? 'turn' : op.duration;
      state.modifiers.push({ uid: op.uid, kind: 'power', amount: op.amount, duration });
      log(state, p, `${tag} ${cardDef(state, op.uid).name}: ${op.amount > 0 ? '+' : ''}${op.amount} de poder.`);
      return;
    }
    case 'donFromDeck': {
      const n = Math.min(Math.max(1, op.count), ps.donDeck);
      ps.donDeck -= n;
      if (op.rested) ps.donRested += n;
      else ps.donActive += n;
      log(state, p, `${tag} +${n} DON!! ${op.rested ? 'virado' : 'ativo'}.`);
      return;
    }
    case 'donToDeck': {
      returnDonAndEmit(state, ps, Math.max(1, op.count));
      log(state, p, `${tag} DON!! −${op.count}.`);
      return;
    }
    case 'donGive': {
      const loc = fieldCard(op.uid);
      if (loc.player !== p || loc.zone === 'stage') throw new IllegalActionError('Escolha seu Líder ou um Personagem seu.');
      if (op.from === 'active' ? ps.donActive < 1 : ps.donRested < 1) throw new IllegalActionError('Sem DON!! disponível.');
      if (op.from === 'active') ps.donActive--;
      else ps.donRested--;
      loc.fc.don++;
      log(state, p, `${tag} ${cardDef(state, op.uid).name} recebe 1 DON!! ${op.from === 'active' ? 'ativo' : 'virado'}.`);
      return;
    }
    case 'donSetState': {
      const target = state.players[op.player];
      const n = Math.min(Math.max(1, op.count), op.rested ? target.donActive : target.donRested);
      if (op.rested) {
        target.donActive -= n;
        target.donRested += n;
      } else {
        target.donRested -= n;
        target.donActive += n;
      }
      log(state, p, `${tag} ${n} DON!! de ${target.name} fica ${op.rested ? 'virado' : 'ativo'}.`);
      return;
    }
    case 'shuffle':
      shuffleInPlace(state, ps.deck);
      log(state, p, `${tag} ${ps.name} embaralha o deck.`);
      return;
  }
}

// ---------------------------------------------------------------------------
// Utilitários de zonas
// ---------------------------------------------------------------------------

/** O personagem está protegido de K.O. ("cannot be K.O.'d [in battle]")? */
export function koProtected(state: GameState, uid: string, inBattle: boolean, by?: string): boolean {
  const kinds = inBattle ? ['cannotBeKO', 'cannotBeKOInBattle'] : ['cannotBeKO'];
  if (state.modifiers.some((m) => m.uid === uid && kinds.includes(m.kind))) return true;
  const byAttrs = by ? (cardDef(state, by).attributes ?? []) : [];
  return cardDef(state, uid).abilities.some(
    (a) =>
      a.timing === 'static' &&
      ((inBattle ? a.staticNoBattleKO : a.staticNoEffectKO) ||
        (inBattle && a.noBattleKOVsAttribute !== undefined && byAttrs.includes(a.noBattleKOVsAttribute)) ||
        (inBattle && a.noBattleKOByLeader && by !== undefined && locate(state, by)?.zone === 'leader')) &&
      conditionsMet(state, uid, a),
  );
}

function koCharacter(state: GameState, uid: string, opts: { inBattle?: boolean; force?: boolean; by?: string } = {}) {
  const loc = locate(state, uid);
  if (!loc || loc.zone !== 'character') return;
  if (!opts.force && koProtected(state, uid, Boolean(opts.inBattle), opts.by)) {
    log(state, loc.player, `${cardDef(state, uid).name} não pode ser nocauteado.`);
    return;
  }
  const ps = state.players[loc.player];
  ps.donRested += loc.fc.don;
  removeCharacter(state, uid);
  ps.trash.push(uid);
  log(state, loc.player, `${cardDef(state, uid).name} foi nocauteado (K.O.).`);
  emit(state, { kind: 'characterKO', player: loc.player, card: uid });
  const def = cardDef(state, uid);
  def.abilities.forEach((a) => {
    // [On K.O.] com [Your Turn]/[Opponent's Turn]: a carta já saiu do campo, só o turno é checado.
    const turnOk = (!a.yourTurn || state.activePlayer === loc.player) && (!a.opponentsTurn || state.activePlayer !== loc.player);
    if (a.timing === 'onKO' && turnOk) pushEffect(state, uid, loc.player, a.steps);
  });
}

function removeCharacter(state: GameState, uid: string) {
  for (const ps of state.players) ps.characters = ps.characters.filter((c) => c.uid !== uid);
  state.modifiers = state.modifiers.filter((m) => m.uid !== uid);
}

function drawCards(state: GameState, player: PlayerId, n: number) {
  const ps = state.players[player];
  for (let i = 0; i < n && ps.deck.length; i++) ps.hand.push(ps.deck.shift()!);
}

function payDon(ps: PlayerState, n: number) {
  if (n > ps.donActive) throw new IllegalActionError('DON!! insuficientes.');
  ps.donActive -= n;
  ps.donRested += n;
}

function returnDon(ps: PlayerState, n: number) {
  for (let i = 0; i < n; i++) {
    if (ps.donRested > 0) ps.donRested--;
    else if (ps.donActive > 0) ps.donActive--;
    else {
      const fc = [ps.leader, ...ps.characters].find((c) => c.don > 0);
      if (!fc) break;
      fc.don--;
    }
    ps.donDeck++;
  }
}

function removeFrom(arr: string[], uid: string) {
  const i = arr.indexOf(uid);
  if (i >= 0) arr.splice(i, 1);
}

function checkDefeat(state: GameState) {
  if (state.phase === 'gameover' || state.phase === 'mulligan') return;
  for (const ps of state.players) {
    if (ps.deck.length === 0) {
      gameOver(state, opponent(ps.id), `${ps.name} ficou sem cartas no deck.`);
      return;
    }
  }
}

function gameOver(state: GameState, winner: PlayerId, reason: string) {
  state.phase = 'gameover';
  state.winner = winner;
  state.winReason = reason;
  state.pending = null;
  log(state, winner, `Fim de jogo: ${state.players[winner].name} venceu! ${reason}`);
}

function log(state: GameState, player: PlayerId | null, text: string) {
  state.log.push({ turn: state.turn, player, text });
}
