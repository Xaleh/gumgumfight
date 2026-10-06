// Motor de regras do One Piece Card Game.
//
// Modelo: `applyAction(estado, ação) -> novo estado`. O estado nunca é mutado:
// cada ação trabalha sobre uma cópia. Efeitos, batalhas e dano são "frames" em uma
// pilha (`state.stack`); quando um frame precisa de uma decisão de um jogador, o
// motor para e registra `state.pending` até a próxima ação.

import { buildCardDef } from './cards';
import { nextRandom, type RngHolder, seedRng128, shuffleInPlace } from './rng';
import type {
  Aura,
  LeaderRule,
  Restriction,
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

  const holder: RngHolder = { rng: config.seed | 0, ...(config.seed128 ? { rng128: seedRng128(config.seed128) } : {}) };
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
      donDeck: (leaderDef.abilities.find((a) => a.rule?.kind === 'donDeck')?.rule as { size: number } | undefined)?.size ?? DON_DECK_SIZE,
      donActive: 0,
      donRested: 0,
      mulliganDone: false,
    };
    return p;
  }) as [PlayerState, PlayerState];

  const firstPlayer: PlayerId = config.firstPlayer ?? (holder.rng128 ? (nextRandom(holder) < 0.5 ? 0 : 1) : holder.rng & 1 ? 0 : 1);
  // O vencedor do sorteio escolhe se joga primeiro ou segundo.
  const choose = Boolean(config.chooseFirst) && config.firstPlayer === undefined;

  const state: GameState = {
    version: 1,
    seed: config.seed,
    rng: holder.rng,
    ...(holder.rng128 ? { rng128: holder.rng128 } : {}),
    turn: 0,
    firstPlayer,
    ...(choose ? { rollWinner: firstPlayer } : {}),
    activePlayer: firstPlayer,
    phase: 'mulligan',
    players,
    cards,
    defs,
    battle: null,
    stack: [],
    pending: { kind: choose ? 'chooseFirst' : 'mulligan', player: firstPlayer },
    modifiers: [],
    usedThisTurn: [],
    winner: null,
    winReason: null,
    log: [],
    actionCount: 0,
  };

  // "At the start of the game, play up to 1 {X} type Stage card from your deck."
  for (const p of players) {
    const rule = leaderRule(state, p.id, 'startStage');
    const stage = rule && p.deck.find((u) => cardDef(state, u).category === 'stage' && hasType(cardDef(state, u), rule.type));
    if (stage) {
      removeFrom(p.deck, stage);
      p.stage = { uid: stage, rested: false, don: 0, playedOnTurn: 0 };
      log(state, p.id, `${p.name} começa com ${cardDef(state, stage).name} em campo.`);
    }
  }
  for (const p of players) drawCards(state, p.id, HAND_SIZE);
  if (choose) log(state, null, `${players[firstPlayer].name} venceu o sorteio e escolhe quem começa.`);
  else log(state, null, `${players[firstPlayer].name} joga primeiro.`);
  return state;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const opponent = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** Regra especial do Líder do jogador, se houver. */
export function leaderRule<K extends LeaderRule['kind']>(state: GameState, player: PlayerId, kind: K): Extract<LeaderRule, { kind: K }> | undefined {
  const def = cardDef(state, state.players[player].leader.uid);
  return def.abilities.find((a) => a.rule?.kind === kind)?.rule as Extract<LeaderRule, { kind: K }> | undefined;
}

/**
 * Valor de Counter de uma carta na mão (com o bônus de regra do Líder). Personagens têm o
 * Counter impresso; Stages só com efeitos como "All Stage cards in your hand have a +3000 Counter".
 */
export function counterValue(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  if (def.category !== 'character' && def.category !== 'stage') return 0;
  const owner = ownerOf(state, uid);
  const ps = state.players[owner];
  let value = def.counter ?? 0;
  // "If you only have Characters without a Counter, this card in your hand has a +2000 Counter."
  for (const a of def.abilities) {
    if (a.selfHandCounter && !value && conditionHolds(state, owner, uid, a.condition)) value = a.selfHandCounter;
  }
  // Cartas em campo que mudam o Counter das cartas na mão.
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
    for (const a of cardDef(state, fc.uid).abilities) {
      const hc = a.handCounter;
      if (a.timing !== 'static' || !hc || !matchesFilter(def, hc.filter) || !conditionsMet(state, fc.uid, a)) continue;
      if (hc.set) value = hc.amount;
      else if (hc.withoutCounter && !def.counter) value = Math.max(value, hc.amount);
    }
  }
  if (value || def.category !== 'character') return value;
  const bonus = leaderRule(state, owner, 'counterBonus');
  return bonus && hasType(def, bonus.type) ? bonus.amount : 0;
}

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

export function isNegated(state: GameState, uid: string): boolean {
  if (state.modifiers.some((m) => m.uid === uid && m.kind === 'negated')) return true;
  const zone = locate(state, uid)?.zone;
  return (zone === 'leader' || zone === 'character') && aurasOn(state, uid, zone, (au) => Boolean(au.negate)).length > 0;
}

function conditionsMet(state: GameState, uid: string, ability: Ability): boolean {
  const loc = locate(state, uid);
  const owner = ownerOf(state, uid);
  if (loc && isNegated(state, uid)) return false;
  if (ability.don && (!loc || loc.fc.don < ability.don)) return false;
  if (ability.yourTurn && state.activePlayer !== owner) return false;
  if (ability.opponentsTurn && state.activePlayer === owner) return false;
  return conditionHolds(state, owner, uid, ability.condition);
}

let condDepth = 0;

/** Avalia uma condição do ponto de vista de `controller`; `source` é a carta do efeito. */
export function conditionHolds(state: GameState, controller: PlayerId, source: string, cond: Condition | undefined): boolean {
  if (!cond) return true;
  // Condições podem consultar poder/custo, que dependem de condições (ex.: contar Personagens com 7000 de poder).
  if (condDepth > 6) return false;
  condDepth++;
  try {
    return evalCondition(state, controller, source, cond);
  } finally {
    condDepth--;
  }
}

function evalCondition(state: GameState, controller: PlayerId, source: string, cond: Condition): boolean {
  if (cond.anyOf && !cond.anyOf.some((c) => conditionHolds(state, controller, source, c))) return false;
  const ps = state.players[controller];
  const opp = state.players[opponent(controller)];
  if (cond.ownCharacterMinBasePower !== undefined && !ps.characters.some((c) => (cardDef(state, c.uid).power ?? 0) >= cond.ownCharacterMinBasePower!)) {
    return false;
  }
  if (cond.minCharacters !== undefined && ps.characters.length < cond.minCharacters) return false;
  if (
    cond.onlyTypedCharacters &&
    (!ps.characters.length || ps.characters.some((c) => !hasType(cardDef(state, c.uid), cond.onlyTypedCharacters!)))
  ) {
    return false;
  }
  const tp = cond.ownTypedCharacterMinPower;
  if (tp && !ps.characters.some((c) => hasType(cardDef(state, c.uid), tp.type) && getPower(state, c.uid) >= tp.power)) return false;
  if (cond.lifeHandMax !== undefined && ps.life.length + ps.hand.length > cond.lifeHandMax) return false;
  if (cond.minTurn !== undefined && state.turn < cond.minTurn) return false;
  if (cond.totalCharacterCostMin !== undefined && ps.characters.reduce((n, c) => n + getCost(state, c.uid), 0) < cond.totalCharacterCostMin) {
    return false;
  }
  if (cond.activatedEventMinCost !== undefined && !(state.eventsThisTurn ?? []).some((e) => e.player === controller && e.cost >= cond.activatedEventMinCost!)) {
    return false;
  }
  if (cond.attackingLeader && state.battle?.target !== opp.leader.uid) return false;
  if (cond.ownMatching && targetCandidates(state, controller, source, { ...cond.ownMatching.spec, side: 'own' }).length < cond.ownMatching.count) {
    return false;
  }
  if (
    cond.opponentMatching &&
    targetCandidates(state, controller, source, { ...cond.opponentMatching.spec, side: 'opponent' }).length < cond.opponentMatching.count
  ) {
    return false;
  }
  const wc = cond.charactersWithCost;
  if (wc && ps.characters.filter((c) => getCost(state, c.uid) >= wc.cost).length < wc.count) return false;
  if (cond.opponentLeaderAttribute && !(cardDef(state, opp.leader.uid).attributes ?? []).some((a) => a.toLowerCase() === cond.opponentLeaderAttribute!.toLowerCase())) {
    return false;
  }
  if (cond.selfRested && !locate(state, source)?.fc.rested) return false;
  if (cond.selfActive && locate(state, source)?.fc.rested !== false) return false;
  if (cond.leaderActive && ps.leader.rested) return false;
  if (cond.anyCharacterNamed && ![...ps.characters, ...opp.characters].some((c) => hasName(cardDef(state, c.uid), cond.anyCharacterNamed!))) return false;
  if (cond.onlyTypeIncludes && (!ps.characters.length || ps.characters.some((c) => !typeIncludes(cardDef(state, c.uid), cond.onlyTypeIncludes!)))) return false;
  if (cond.allDonRested && (ps.donActive > 0 || totalDonOnField(ps) === 0)) return false;
  if (cond.deficit) {
    const n = (pl: PlayerState) => (cond.deficit!.what === 'don' ? totalDonOnField(pl) : cond.deficit!.what === 'hand' ? pl.hand.length : pl.characters.length);
    if (n(opp) - n(ps) < cond.deficit.n) return false;
  }
  if (cond.trashHasNames && !cond.trashHasNames.every((nm) => ps.trash.some((u) => hasName(cardDef(state, u), nm)))) return false;
  if (
    cond.anyCharacterMinBasePower !== undefined &&
    ![...ps.characters, ...opp.characters].some((c) => (cardDef(state, c.uid).power ?? 0) >= cond.anyCharacterMinBasePower!)
  ) {
    return false;
  }
  if (cond.opponentCharacterKOThisTurn && !(state.koThisTurn ?? []).includes(opp.id)) return false;
  if (cond.distinctTyped) {
    const names = new Set(ps.characters.filter((c) => hasType(cardDef(state, c.uid), cond.distinctTyped!.type)).map((c) => cardDef(state, c.uid).name));
    if (names.size < cond.distinctTyped.count) return false;
  }
  if (cond.chosenCostEqualsDon) {
    const chosen = currentChosen(state).find((u) => locate(state, u));
    if (!chosen || getCost(state, chosen) !== locate(state, chosen)!.fc.don) return false;
  }
  if (cond.attackerCharacter && (!state.battle || locate(state, state.battle.attacker)?.zone !== 'character')) return false;
  if (cond.attackerAttribute && (!state.battle || !hasAttributeOn(state, state.battle.attacker, cond.attackerAttribute))) return false;
  if (cond.handTrashedThisTurn && !(state.handTrashedThisTurn ?? []).includes(controller)) return false;
  if (cond.opponentRestedCardsMin !== undefined) {
    const rested = [opp.leader, ...opp.characters, ...(opp.stage ? [opp.stage] : [])].filter((c) => c.rested).length + opp.donRested;
    if (rested < cond.opponentRestedCardsMin) return false;
  }
  if (cond.leaderNames && !cond.leaderNames.some((nm) => hasName(cardDef(state, ps.leader.uid), nm))) return false;
  if (cond.onlyCharactersWithoutCounter && ps.characters.some((c) => cardDef(state, c.uid).counter)) return false;
  if (cond.leaderMinPower !== undefined && getPower(state, ps.leader.uid) < cond.leaderMinPower) return false;
  if (cond.fewerCharacters && ps.characters.length >= opp.characters.length) return false;
  const acw = cond.anyCharactersWithCost;
  if (acw && [...ps.characters, ...opp.characters].filter((c) => getCost(state, c.uid) >= acw.cost).length < acw.count) return false;
  if (cond.leaderNameIncludes && !cardDef(state, ps.leader.uid).name.toLowerCase().includes(cond.leaderNameIncludes.toLowerCase())) return false;
  if (cond.leaderColor && !cardDef(state, ps.leader.uid).colors.includes(cond.leaderColor)) return false;
  if (cond.leaderMaxPower !== undefined && getPower(state, ps.leader.uid) > cond.leaderMaxPower) return false;
  if (cond.opponentLeaderMinPower !== undefined && getPower(state, opp.leader.uid) < cond.opponentLeaderMinPower) return false;
  if (cond.totalLifeMin !== undefined && ps.life.length + opp.life.length < cond.totalLifeMin) return false;
  if (cond.opponentMaxDonOnField !== undefined && totalDonOnField(opp) > cond.opponentMaxDonOnField) return false;
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
  if (cond.leaderMonocolor && cardDef(state, ps.leader.uid).colors.length !== 1) return false;
  if (cond.not && conditionHolds(state, controller, source, cond.not)) return false;
  if (cond.selfBattledCharacter && !(state.battledCharacter ?? []).includes(source)) return false;
  if (cond.maxActiveDon !== undefined && ps.donActive > cond.maxActiveDon) return false;
  if (cond.minRestedDon !== undefined && ps.donRested < cond.minRestedDon) return false;
  if (cond.anyCharacterMinPower !== undefined && ![...ps.characters, ...opp.characters].some((c) => getPower(state, c.uid) >= cond.anyCharacterMinPower!)) {
    return false;
  }
  if (cond.faceUpLifeMin !== undefined && ps.life.filter((u) => ps.lifeFaceUp?.includes(u)).length < cond.faceUpLifeMin) return false;
  if (cond.leaderAttribute && !(cardDef(state, ps.leader.uid).attributes ?? []).some((a) => a.toLowerCase() === cond.leaderAttribute!.toLowerCase())) {
    return false;
  }
  if (
    cond.haveNamed &&
    !cond.haveNamed.every((n) =>
      ps.characters.some((c) => hasName(cardDef(state, c.uid), n) && (cond.haveNamedBasePower === undefined || cardDef(state, c.uid).power === cond.haveNamedBasePower)),
    )
  ) {
    return false;
  }
  if (
    cond.ownMatchingMax &&
    targetCandidates(state, controller, source, { ...cond.ownMatchingMax.spec, side: 'own' }).length > cond.ownMatchingMax.count
  ) {
    return false;
  }
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
  const given = (pl: PlayerState) => [pl.leader, ...pl.characters].reduce((n, c) => n + c.don, 0);
  if (cond.minGivenDon !== undefined && given(ps) < cond.minGivenDon) return false;
  if (cond.opponentAnyDonGiven && given(opp) === 0) return false;
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
    if (a.timing === 'static' && a.costPer && conditionsMet(state, uid, a)) {
      cost += a.costPer.cost * Math.floor(state.players[locate(state, uid)!.player].trash.length / a.costPer.every);
    }
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
/** Parte de um alvo com "ou" ("{X} type Characters or Characters with a [Trigger]"). */
function matchesPartial(state: GameState, uid: string, f: Partial<TargetSpec>, source: string): boolean {
  const loc = locate(state, uid);
  if (!loc) return false;
  if (f.kinds && !f.kinds.includes(loc.zone)) return false;
  return fieldCardMatches(state, source, loc.fc, { side: 'any', kinds: [loc.zone], upTo: 1, ...f, either: undefined });
}

/** Atributo da carta (impresso ou ganho por efeito). */
function hasAttributeOn(state: GameState, uid: string, attr: string): boolean {
  return hasAttribute(cardDef(state, uid), attr) || state.modifiers.some((m) => m.uid === uid && m.kind === 'attribute' && m.attribute?.toLowerCase() === attr.toLowerCase());
}

/** As cartas escolhidas no efeito em resolução ("the chosen Character"). */
function currentChosen(state: GameState): string[] {
  const top = [...state.stack].reverse().find((f) => f.kind === 'effect');
  return top?.kind === 'effect' ? (top.last ?? []) : [];
}

const hasAttribute = (def: CardDef, a: string) => (def.attributes ?? []).some((x) => x.toLowerCase() === a.toLowerCase());

export function matchesFilter(def: CardDef, f: import('./types').CardFilter): boolean {
  if (f.either && !f.either.some((x) => matchesFilter(def, x))) return false;
  if (f.noEffect && def.text?.replace(/\[[^\]]+\]|\([^)]*\)/g, '').trim()) return false;
  const byName = Boolean(f.orName && hasName(def, f.orName));
  const byAttr = Boolean(f.orAttribute && hasAttribute(def, f.orAttribute));
  if (!byName && !byAttr && !matchesAnyType(def, f.hasAnyType)) return false;
  if (f.attribute && !byName && !hasAttribute(def, f.attribute)) return false;
  if (f.names && !f.names.some((n) => hasName(def, n))) return false;
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
  if (f.hasAllTypes && !f.hasAllTypes.every((t) => hasType(def, t))) return false;
  if (f.withoutKeyword && def.keywords.includes(f.withoutKeyword)) return false;
  return true;
}

/** "with a type including "X"": algum tipo contém o texto (sem diferenciar maiúsculas). */
export function typeIncludes(def: CardDef, part: string): boolean {
  const p = part.toLowerCase();
  return def.types.some((t) => t.toLowerCase().includes(p));
}

/** Soma das auras ativas que afetam a carta (bônus de outras cartas do mesmo jogador). */
/** Auras ativas (de qualquer jogador) que afetam a carta. */
let auraDepth = 0;

function aurasOn(state: GameState, uid: string, zone: 'leader' | 'character' | 'stage', want: (au: Aura) => boolean): Aura[] {
  if (zone === 'stage') return [];
  // Condições de auras podem depender de custo/poder, que dependem de auras: corta ciclos.
  if (auraDepth > 8) return [];
  auraDepth++;
  try {
    return collectAuras(state, uid, zone, want);
  } finally {
    auraDepth--;
  }
}

function collectAuras(state: GameState, uid: string, zone: 'leader' | 'character', want: (au: Aura) => boolean): Aura[] {
  const owner = ownerOf(state, uid);
  const target = cardDef(state, uid);
  const out: Aura[] = [];
  for (const ps of state.players) {
    for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
      for (const a of cardDef(state, fc.uid).abilities) {
        if (a.timing !== 'static' || !a.aura || !a.aura.kinds.includes(zone)) continue;
        // Aura própria afeta as suas cartas; aura 'opponent' afeta as do oponente.
        if (!a.aura.bothSides && ((a.aura.side ?? 'own') === 'own') !== (ps.id === owner)) continue;
        // O tipo de aura é filtrado antes das condições (que podem consultar custo/poder e voltar aqui).
        if (!want(a.aura)) continue;
        if (!matchesAnyType(target, a.aura.hasAnyType) || !conditionsMet(state, fc.uid, a)) continue;
        if (a.aura.typeIncludes && !typeIncludes(target, a.aura.typeIncludes)) continue;
        if (a.aura.names && !a.aura.names.some((n) => hasName(target, n))) continue;
        // Custo impresso (o custo atual depende das próprias auras de custo).
        if (a.aura.minCost !== undefined && (target.cost ?? 0) < a.aura.minCost) continue;
        if (a.aura.maxCost !== undefined && (target.cost ?? 0) > a.aura.maxCost) continue;
        if (a.aura.color && !target.colors.includes(a.aura.color)) continue;
        if (a.aura.excludeName && hasName(target, a.aura.excludeName)) continue;
        if (a.aura.excludeSelf && fc.uid === uid) continue;
        if (a.aura.hasTrigger && !target.trigger?.trim()) continue;
        if (a.aura.hasAllTypes && !a.aura.hasAllTypes.every((t) => hasType(target, t))) continue;
        if (a.aura.notTypeIncludes && typeIncludes(target, a.aura.notTypeIncludes)) continue;
        if (a.aura.exactCosts && !a.aura.exactCosts.includes(target.cost ?? -1)) continue;
        if (a.aura.minPower !== undefined && (target.power ?? 0) < a.aura.minPower) continue;
        if (a.aura.maxPower !== undefined && (target.power ?? 0) > a.aura.maxPower) continue;
        out.push(a.aura);
      }
    }
  }
  return out;
}

function auraPower(state: GameState, uid: string, zone: 'leader' | 'character' | 'stage', what: 'power' | 'cost' = 'power'): number {
  let bonus = 0;
  const want = (au: Aura) =>
    what === 'cost' ? au.cost !== undefined : au.cost === undefined && !au.keyword && au.basePower === undefined && !au.basePowerCopyLeader && Boolean(au.power);
  for (const au of aurasOn(state, uid, zone, want)) bonus += what === 'cost' ? au.cost! : au.power;
  return bonus;
}

export function getPower(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  let power = def.power ?? 0;
  const loc = locate(state, uid);
  if (!loc) return power;
  if (loc.zone !== 'stage') {
    for (const au of aurasOn(state, uid, loc.zone, (x) => x.basePower !== undefined || Boolean(x.basePowerCopyLeader))) {
      power = au.basePowerCopyLeader ? (cardDef(state, state.players[loc.player].leader.uid).power ?? 0) : au.basePower!;
    }
  }
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticBasePower !== undefined && conditionsMet(state, uid, a)) {
      power = a.staticBasePower === 'leader' ? (cardDef(state, state.players[loc.player].leader.uid).power ?? 0) : a.staticBasePower;
    }
  }
  for (const m of state.modifiers) if (m.uid === uid && m.kind === 'basePower') power = m.amount;
  if (loc.player === state.activePlayer) power += loc.fc.don * 1000;
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticPower && conditionsMet(state, uid, a)) power += a.staticPower;
    if (a.timing === 'static' && a.powerPer && conditionsMet(state, uid, a)) {
      const ps = state.players[loc.player];
      const p = a.powerPer;
      const n =
        p.what === 'distinctCharacters'
          ? new Set(ps.characters.map((c) => cardDef(state, c.uid).name)).size
          : p.what === 'hand'
          ? ps.hand.length
          : p.what === 'restedDon'
            ? ps.donRested
            : p.what === 'trash'
              ? ps.trash.length
              : ps.trash.filter((u) => cardDef(state, u).category === 'event').length;
      power += p.power * Math.floor(n / p.every);
    }
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
  if (def.keywords.includes(kw) && !isNegated(state, uid)) return true;
  if (state.modifiers.some((m) => m.uid === uid && m.kind === 'keyword' && m.keyword === kw)) return true;
  if (def.abilities.some((a) => a.timing === 'static' && a.staticKeyword === kw && conditionsMet(state, uid, a))) return true;
  const loc = locate(state, uid);
  return !!loc && aurasOn(state, uid, loc.zone, (au) => au.keyword === kw).length > 0;
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

/**
 * Passos de uma habilidade automática. Uma [Once Per Turn] que começa com custo opcional
 * ("DON!! −1:", "You may trash 1 card from your hand:") é marcada como usada ao ser empilhada
 * (para não disparar duas vezes seguidas), mas a recusa do custo devolve o uso: pelas regras,
 * uma habilidade cujo custo não foi pago não foi ativada.
 */
function abilitySteps(a: Ability, index: number): EffectStep[] {
  const first = a.steps[0];
  if (a.oncePerTurn && first?.do === 'payCost' && first.ability === undefined) return [{ ...first, ability: index }, ...a.steps.slice(1)];
  return a.steps;
}

/** Devolve o uso do turno de uma [Once Per Turn] cujo custo não foi pago. */
function releaseOncePerTurn(state: GameState, uid: string, index: number | undefined) {
  if (index === undefined) return;
  const key = usedKey(uid, index);
  const i = state.usedThisTurn.lastIndexOf(key);
  if (i >= 0) state.usedThisTurn.splice(i, 1);
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
  if (cannotBeRested(state, attacker)) return 'Esta carta não pode ser virada, então não pode atacar.';
  if (
    state.modifiers.some((m) => m.uid === attacker && m.kind === 'cannotAttack') ||
    cardDef(state, attacker).abilities.some((x) => x.timing === 'static' && x.staticCannotAttack && conditionsMet(state, attacker, x))
  ) {
    return 'Esta carta não pode atacar.';
  }
  if (restricted(state, player, 'noAttackLeader') && state.players[opponent(player)].leader.uid === target) return 'Você não pode atacar o Líder neste turno.';
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
  const taunt = state.players[t.player].characters.find(
    (c) => c.rested && cardDef(state, c.uid).abilities.some((x) => x.timing === 'static' && x.staticTaunt && conditionsMet(state, c.uid, x)),
  );
  if (taunt && taunt.uid !== target) return `Só é possível atacar ${cardDef(state, taunt.uid).name}.`;
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

/** Custo para jogar uma carta da mão (com "give this card in your hand −N cost" e reduções da próxima jogada). */
export function playCost(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  let cost = def.cost ?? 0;
  for (const a of def.abilities) {
    if (a.handCost && (!a.yourTurn || state.activePlayer === owner) && conditionHolds(state, owner, uid, a.condition)) cost += a.handCost;
  }
  const red = (state.costReductions ?? []).find((r) => r.player === owner && matchesFilter(def, r.filter));
  if (red) cost -= red.amount;
  const ps = state.players[owner];
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
    for (const a of cardDef(state, fc.uid).abilities) {
      if (a.timing === 'static' && a.handCostAura && matchesFilter(def, a.handCostAura.filter) && conditionsMet(state, fc.uid, a)) cost += a.handCostAura.amount;
    }
  }
  return Math.max(0, cost);
}

function restricted(state: GameState, player: PlayerId, kind: Restriction['kind']): Restriction | undefined {
  return state.restrictions?.find((r) => r.player === player && r.kind === kind);
}

/** "You cannot play Character cards (with a base cost of N or more) during this turn." */
function playBlocked(state: GameState, player: PlayerId, def: CardDef): boolean {
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
  if (!b || b.noBlocker || hasKeyword(state, b.attacker, 'unblockable')) return [];
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
  return pool.filter((fc) => fieldCardMatches(state, source, fc, spec)).map((fc) => fc.uid);
}

/** Uma carta em campo atende aos filtros do alvo (sem olhar lado/zona)? */
function fieldCardMatches(state: GameState, source: string, fc: FieldCard, spec: TargetSpec): boolean {
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
  if (spec.noEffect && def.text?.replace(/\[[^\]]+\]|\([^)]*\)/g, '').trim()) return false;
  if (spec.either && !spec.either.some((f) => matchesPartial(state, fc.uid, f, source))) return false;
  if (!matchesAnyType(def, spec.hasAnyType)) return false;
  if (spec.hasAllTypes && !spec.hasAllTypes.every((t) => hasType(def, t))) return false;
  if (spec.withoutKeyword && hasKeyword(state, fc.uid, spec.withoutKeyword)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, action: Action): GameState {
  if (prev.phase === 'gameover') throw new IllegalActionError('A partida já terminou.');
  // As definições das cartas não mudam durante a partida: são compartilhadas, não copiadas.
  const { defs, ...rest } = prev;
  const state = structuredClone(rest) as GameState;
  state.defs = defs;
  const p = action.player;
  const pending = state.pending;

  if (action.type === 'concede') {
    gameOver(state, opponent(p), `${state.players[p].name} desistiu.`);
    state.actionCount++;
    return state;
  }

  if (action.type === 'timeout') {
    const name = state.players[p].name;
    gameOver(state, opponent(p), action.abandoned ? `${name} abandonou a partida.` : `${name} ficou sem tempo.`);
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
    case 'chooseFirst': {
      if (action.type !== 'answer') throw new IllegalActionError('Escolha se você joga primeiro ou segundo.');
      const first = action.yes ? p : opponent(p);
      state.firstPlayer = first;
      state.activePlayer = first;
      log(state, p, `${state.players[p].name} escolheu jogar ${action.yes ? 'primeiro' : 'segundo'}.`);
      log(state, null, `${state.players[first].name} joga primeiro.`);
      state.pending = { kind: 'mulligan', player: first };
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
      if (def.category !== 'event') {
        const target = state.battle!.target;
        const amount = counterValue(state, action.uid);
        state.modifiers.push({ uid: target, kind: 'power', amount, duration: 'battle' });
        log(state, p, `Counter: ${def.name} dá +${amount} a ${cardDef(state, target).name}.`);
      } else {
        payDon(ps, def.cost ?? 0);
        const ability = def.abilities.find((a) => a.timing === 'counter')!;
        log(state, p, `${ps.name} usa o evento ${def.name}.`);
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
        emit(state, { kind: 'triggerActivated', player: p, card });
      } else {
        ps.hand.push(card);
        log(state, p, `${ps.name} adiciona a carta de Vida à mão.`);
        emit(state, { kind: 'lifeToHand', player: p, card });
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
      const cost = playCost(state, action.uid);
      const red = (state.costReductions ?? []).findIndex((r) => r.player === p && matchesFilter(def, r.filter));
      if (red >= 0) state.costReductions!.splice(red, 1);
      removeFrom(ps.hand, action.uid);
      payDon(ps, cost);
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
      const tax = state.modifiers.find((m) => m.uid === action.attacker && m.kind === 'attackTax');
      if (tax) pushEffect(state, action.attacker, p, [{ do: 'trashFromHand', count: tax.amount }]);
      // "When your Leader … attacks or is attacked"
      for (const lead of [action.attacker, action.target]) {
        if (locate(state, lead)?.zone === 'leader') emit(state, { kind: 'leaderBattle', player: ownerOf(state, lead), card: lead });
      }
      return;
    }

    case 'endTurn': {
      // Efeitos de [End of Your Turn] resolvem antes de o turno passar.
      state.stack.push({ kind: 'endTurn' });
      for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
        pushAbilities(state, fc.uid, 'endOfTurn');
      }
      // "… at the end of this turn"
      for (const d of state.delayed ?? []) {
        pushEffect(state, d.source, d.controller, d.steps);
        const top = state.stack[state.stack.length - 1];
        if (top?.kind === 'effect' && d.last) top.last = d.last;
      }
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

  // "This effect can be activated at the start of your turn": a condição é vista agora (antes de Renovar/DON!!).
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
    for (const a of cardDef(state, fc.uid).abilities) {
      if (a.timing !== 'startOfTurn' || !conditionsMet(state, fc.uid, a) || !a.steps.length) continue;
      const first = JSON.stringify(a.steps[0].if ?? null);
      if (a.steps[0].if && !conditionHolds(state, ps.id, fc.uid, a.steps[0].if)) continue;
      const steps = a.steps.map((st) => (JSON.stringify(st.if ?? null) === first ? { ...st, if: undefined } : st));
      pushEffect(state, fc.uid, ps.id, steps);
    }
  }

  // Refresh: DON!! anexados voltam à área de custo e tudo fica ativo.
  const fieldCards = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])];
  for (const fc of fieldCards) {
    ps.donRested += fc.don;
    fc.don = 0;
    // "will not become active in your opponent's next Refresh Phase"
    const skip = state.modifiers.some((m) => m.uid === fc.uid && m.kind === 'skipRefresh') || noRefreshByAura(state, fc.uid);
    if (!skip) fc.rested = false;
  }
  state.modifiers = state.modifiers.filter((m) => !(m.kind === 'skipRefresh' && fieldCards.some((fc) => fc.uid === m.uid)));
  const keep = Math.min(ps.donRested, (state.donSkipRefresh ?? []).filter((d) => d.player === ps.id).reduce((n, d) => n + d.count, 0));
  state.donSkipRefresh = (state.donSkipRefresh ?? []).filter((d) => d.player !== ps.id);
  ps.donActive += ps.donRested - keep;
  ps.donRested = keep;

  // Draw: o primeiro jogador não compra no primeiro turno.
  if (state.turn !== 1) drawCards(state, ps.id, 1);

  // DON!!: 2 por turno (1 no primeiro turno do primeiro jogador).
  const n = Math.min(state.turn === 1 ? 1 : 2, ps.donDeck);
  const hadDon = totalDonOnField(ps) > 0;
  ps.donDeck -= n;
  ps.donActive += n;
  if (n && hadDon && leaderRule(state, ps.id, 'donPhaseToLeader')) {
    ps.donActive--;
    ps.leader.don++;
  }
  checkDefeat(state);
}

/** "all Characters with a cost of 5 or less do not become active in your and your opponent's Refresh Phases" */
function noRefreshByAura(state: GameState, uid: string): boolean {
  if (locate(state, uid)?.zone !== 'character') return false;
  return state.players.some((pl) =>
    [pl.leader, ...pl.characters, ...(pl.stage ? [pl.stage] : [])].some((fc) =>
      cardDef(state, fc.uid).abilities.some(
        (a) => a.timing === 'static' && a.noRefreshMaxCost !== undefined && getCost(state, uid) <= a.noRefreshMaxCost && conditionsMet(state, fc.uid, a),
      ),
    ),
  );
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
  state.eventsThisTurn = [];
  state.restrictions = [];
  state.costReductions = [];
  state.battledCharacter = [];
  state.koThisTurn = [];
  state.tempReplacements = [];
  state.handTrashedThisTurn = [];
  state.onPlayNegated = (state.onPlayNegated ?? []).filter((n) => n.untilTurn > state.turn);
  // "You lose at the end of the turn in which your deck becomes 0 cards."
  for (const pl of state.players) {
    if (pl.deck.length === 0 && leaderRule(state, pl.id, 'deckOutEndOfTurn')) {
      gameOver(state, opponent(pl.id), `${pl.name} terminou o turno sem cartas no deck.`);
      return;
    }
  }
  // "take an extra turn after this one"
  if (state.extraTurn === state.activePlayer) state.extraTurn = undefined;
  else state.activePlayer = opponent(state.activePlayer);
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
  if (steps.length) state.stack.push({ kind: 'effect', source, controller, steps: [...steps], i: 0 }); // cópia: passos podem ser inseridos durante a resolução
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
};

/** Dispara as habilidades "When …" de todas as cartas em campo que reagem ao acontecimento. */
function emit(state: GameState, ev: EmittedEvent) {
  for (const ps of state.players) {
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
        pushEffect(state, fc.uid, ps.id, abilitySteps(a, i));
        // "that Character" no efeito se refere à carta do acontecimento.
        const top = state.stack[state.stack.length - 1];
        if (ev.card && a.steps.length && top?.kind === 'effect' && top.source === fc.uid) top.last = [ev.card];
        if (ev.count !== undefined && top?.kind === 'effect' && top.source === fc.uid) top.eventCount = ev.count;
      });
    }
  }
}

function eventMatches(state: GameState, e: GameEvent, ev: EmittedEvent, owner: PlayerId, uid: string): boolean {
  switch (e.kind) {
    case 'donReturned':
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
      return ev.player === owner && (!e.sourceType || (ev.card !== undefined && hasType(cardDef(state, ev.card), e.sourceType)));
    case 'anyOf':
      return false;
    case 'characterPlayed':
      return (
        (e.who === 'self') === (ev.player === owner) &&
        (!e.filter || matchesFilter(cardDef(state, ev.card!), e.filter)) &&
        (!e.from || e.from === ev.from) &&
        (!e.byEffect || Boolean(ev.byEffect))
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
      return ev.player !== owner;
    case 'leaderBattle':
      return ev.player === owner && (!e.filter || matchesFilter(cardDef(state, ev.card!), e.filter));
    case 'returnedToHand':
      return ev.player !== owner && ev.byPlayer === owner;
  }
}

/**
 * "… cannot be rested": a carta não pode ser virada de jeito nenhum — nem por efeitos,
 * nem para atacar, bloquear ou pagar custos.
 */
export function cannotBeRested(state: GameState, uid: string): boolean {
  return state.modifiers.some((m) => m.uid === uid && m.kind === 'cannotBeRested');
}

/** Vira uma carta em campo (dispara "When this Character becomes rested"). */
function restCard(state: GameState, uid: string, byEffectOf?: PlayerId, restSource?: string) {
  const loc = locate(state, uid);
  if (!loc || loc.fc.rested) return;
  if (cannotBeRested(state, uid)) return;
  if (
    byEffectOf !== undefined &&
    byEffectOf !== loc.player &&
    cardDef(state, uid).abilities.some((a) => a.timing === 'static' && a.staticNoRest && conditionsMet(state, uid, a))
  ) {
    return;
  }
  // "If this Character would be rested by your opponent's Character's effect, you may rest 1 of your other Characters instead."
  if (byEffectOf !== undefined && byEffectOf !== loc.player && restSource && cardDef(state, restSource).category === 'character') {
    const abilities = cardDef(state, uid).abilities;
    const i = abilities.findIndex(
      (a, k) =>
        a.timing === 'replace' &&
        a.replace?.event === 'rest' &&
        conditionsMet(state, uid, a) &&
        !(a.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, k))) &&
        (!a.cost || canPayCost(state, loc.player, uid, a.cost)),
    );
    if (i >= 0) {
      pushEffect(state, uid, loc.player, [{ do: 'replaceRest', victim: uid, ability: i, byPlayer: byEffectOf }]);
      return;
    }
  }
  loc.fc.rested = true;
  emit(state, { kind: 'selfRested', player: loc.player, card: uid, byPlayer: byEffectOf, from: restSource });
  if (byEffectOf !== undefined && loc.zone === 'character') emit(state, { kind: 'restedByEffect', player: loc.player, card: uid, byPlayer: byEffectOf });
}

/** Devolve DON!! ao deck de DON!! (dispara "When a DON!! card on your field is returned…"). */
function returnDonAndEmit(state: GameState, ps: PlayerState, n: number) {
  if (n <= 0) return;
  returnDon(ps, n);
  emit(state, { kind: 'donReturned', player: ps.id, count: n });
}

/** Empilha as habilidades automáticas de uma carta (onPlay, whenAttacking, ...). */
function onPlayNegated(state: GameState, player: PlayerId): boolean {
  if (leaderRule(state, player, 'ownOnPlayNegated')) return true;
  return (state.onPlayNegated ?? []).some((n) => n.player === player && n.untilTurn >= state.turn);
}

function pushAbilities(state: GameState, uid: string, timing: AbilityTiming) {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  const toPush: Array<[number, Ability]> = [];
  if (timing === 'onPlay' && onPlayNegated(state, owner)) {
    log(state, owner, `O [Ao Jogar] de ${def.name} está anulado.`);
    return;
  }
  def.abilities.forEach((a, i) => {
    if (a.timing !== timing || !conditionsMet(state, uid, a)) return;
    if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, i))) return;
    toPush.push([i, a]);
  });
  // Empilha de trás para frente para resolver na ordem do texto.
  for (const [i, a] of toPush.reverse()) {
    if (a.oncePerTurn) state.usedThisTurn.push(usedKey(uid, i));
    pushEffect(state, uid, owner, abilitySteps(a, i));
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
  const rested = Boolean(frame.rested) || Boolean(leaderRule(state, owner, 'playRested'));
  ps.characters.push({ uid: frame.uid, rested, don: 0, playedOnTurn: state.turn });
  state.stack.pop();
  pushAbilities(state, frame.uid, 'onPlay');
  emit(state, { kind: 'characterPlayed', player: owner, card: frame.uid, from: frame.from, byEffect: frame.byEffect });
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
      if (locate(state, b.target)?.zone === 'character') (state.battledCharacter ??= []).push(b.attacker);
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
      const after = b.after ?? [];
      state.battle = null;
      state.stack.pop();
      for (const uid of fought) {
        const before = state.stack.length;
        pushAbilities(state, uid, 'battlesCharacter');
        // "the opponent's Character you battled with"
        const other = (b.fought ?? []).find((u) => u !== uid);
        for (const f of state.stack.slice(before)) if (f.kind === 'effect' && other) f.last = [other];
      }
      for (const d of after) {
        pushEffect(state, d.source, d.controller, d.steps);
        const top = state.stack[state.stack.length - 1];
        if (top?.kind === 'effect' && d.last) top.last = d.last;
      }
      return;
    }
  }
}

function stepDamage(state: GameState, frame: DamageFrame) {
  if (frame.remaining <= 0) {
    state.stack.pop();
    // Reações ao dano só depois que ele (e os [Trigger]) termina.
    if (frame.lost) {
      emit(state, { kind: 'damageTaken', player: frame.defender });
      emit(state, { kind: 'damageDealt', player: frame.defender });
      lifeRemoved(state, frame.defender);
    }
    return;
  }
  // "If you would take damage, you may … instead": oferecida uma vez, antes da primeira Vida (e da derrota).
  if (!frame.replaceAsked && !frame.lost) {
    frame.replaceAsked = true;
    if (offerDamageReplacement(state, frame.defender)) return;
  }
  const ps = state.players[frame.defender];
  if (ps.life.length === 0) {
    gameOver(state, opponent(frame.defender), `O líder de ${ps.name} recebeu dano sem cartas de Vida.`);
    return;
  }
  const card = ps.life.pop()!;
  frame.remaining--;
  frame.lost = (frame.lost ?? 0) + 1;
  const def = cardDef(state, card);
  if (frame.banish) {
    ps.trash.push(card);
    log(state, frame.defender, `[Banish] A carta de Vida vai para o descarte.`);
    return;
  }
  if (ps.lifeFaceUp?.includes(card) && leaderRule(state, ps.id, 'faceUpLifeToDeck')) {
    lifeToHandCard(state, ps.id, card);
    return;
  }
  if (def.abilities.some((a) => a.timing === 'trigger')) {
    frame.lifeCard = card;
    state.pending = { kind: 'trigger', player: frame.defender, card };
    return;
  }
  lifeToHandCard(state, ps.id, card);
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
  if (frame.choice) {
    let chosen = frame.choice.filter((u) => options.includes(u));
    // "with a total power/cost of N or less": fica com as escolhas que cabem no total.
    if (ref.totalMaxPower !== undefined || ref.totalMaxCost !== undefined) {
      let pw = 0;
      let co = 0;
      chosen = chosen.filter((u) => {
        const np = pw + getPower(state, u);
        const nc = co + getCost(state, u);
        if ((ref.totalMaxPower !== undefined && np > ref.totalMaxPower) || (ref.totalMaxCost !== undefined && nc > ref.totalMaxCost)) return false;
        pw = np;
        co = nc;
        return true;
      });
    }
    return (frame.last = chosen);
  }
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
  if (step.if?.lastDone && !frame.last?.length) return false;
  if (step.if?.revealedHasChosenCost) {
    const card = frame.last?.[0];
    if (!card || frame.chosenCost === undefined || (cardDef(state, card).cost ?? 0) !== frame.chosenCost) return false;
  }
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
  const from = ps.trash.includes(uid) ? 'trash' : undefined;
  if (def.category === 'character') {
    detach(state, uid);
    log(state, ps.id, `${def.name} entra em campo.`);
    state.stack.push({ kind: 'play', uid, byEffect: true, ...(rested ? { rested: true } : {}), ...(from ? { from } : {}) });
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
  const steps: EffectStep[] = [];
  if (cost.donMinus) {
    if (cost.donMinusOpen) {
      // "1 or more": a quantidade é escolhida no passo seguinte.
      steps.push({ do: 'returnDonChoice', min: cost.donMinus });
    } else {
      returnDonAndEmit(state, ps, cost.donMinus);
      log(state, player, `${ps.name} devolve ${cost.donMinus} DON!! ao deck de DON!!.`);
    }
  }
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
  if (cost.koSelf) steps.push({ do: 'koSelf' });
  if (cost.leaderPowerMinus) {
    addModifier(state, player, { uid: ps.leader.uid, kind: 'power', amount: -cost.leaderPowerMinus, duration: 'turn' });
    log(state, player, `${cardDef(state, ps.leader.uid).name} recebe −${cost.leaderPowerMinus} de poder (custo).`);
  }
  if (cost.giveDon) steps.push({ do: 'giveActiveDon', count: cost.giveDon.count, target: cost.giveDon.spec });
  if (cost.ownToBottom) steps.push({ do: 'ownToBottom', ...cost.ownToBottom });
  if (cost.ownToLife) steps.push({ do: 'ownToBottom', ...cost.ownToLife, toLife: true });
  if (cost.either) steps.push({ do: 'payEither', options: cost.either });
  if (cost.returnGivenDon) steps.push({ do: 'returnGivenDon', count: cost.returnGivenDon });
  if (cost.koOwn) steps.push({ do: 'koOwn', ...cost.koOwn });
  if (cost.trashOwn) steps.push({ do: 'trashOwn', ...cost.trashOwn });
  if (cost.selfToBottom) steps.push({ do: 'selfToDeckBottom' });
  if (cost.trashSelf) steps.push({ do: 'trashSelf' });
  if (cost.restOpponentChars) {
    steps.push({ do: 'rest', target: { side: 'opponent', kinds: ['character'], upTo: cost.restOpponentChars, rested: false } });
  }
  if (cost.selfPowerMinus) steps.push({ do: 'power', target: 'self', amount: -cost.selfPowerMinus, duration: 'turn' });
  if (cost.trashToDeck) steps.push({ do: 'trashToDeckBottom', count: cost.trashToDeck }, { do: 'shuffleDeck' });
  if (cost.playFromHand) steps.push({ do: 'playFrom', from: 'hand', upTo: 1, filter: cost.playFromHand });
  if (cost.giveOppDon) {
    steps.push({ do: 'giveRestedDon', target: { side: 'opponent', kinds: ['character'], upTo: 1 }, count: cost.giveOppDon, fromOpponent: true });
  }
  if (cost.handToTop) steps.push({ do: 'handToDeck', count: cost.handToTop, where: 'top' });
  return steps;
}

/** Cartas de Vida viradas para baixo, do topo para o fundo. */
function faceDownLife(ps: PlayerState): string[] {
  return [...ps.life].reverse().filter((u) => !ps.lifeFaceUp?.includes(u));
}

export function canPayCost(state: GameState, player: PlayerId, source: string, cost: AbilityCost): boolean {
  const ps = state.players[player];
  if (cost.restSelf && (!locate(state, source) || locate(state, source)!.fc.rested || cannotBeRested(state, source))) return false;
  if ((cost.restDon ?? 0) > ps.donActive) return false;
  if ((cost.donMinus ?? 0) > totalDonOnField(ps)) return false;
  if ((cost.trashFromHand ?? 0) > discardable(state, player, cost.trashFilter).length) return false;
  if ((cost.handToBottom ?? 0) > ps.hand.length) return false;
  if ((cost.lifeToHand ?? 0) > ps.life.length) return false;
  if (cost.lifeToHand && restricted(state, ps.id, 'noLifeToHand')) return false;
  if (cost.leaderPowerMinus && ps.leader.rested) return false;
  if (cost.giveDon && (ps.donActive < cost.giveDon.count || !targetCandidates(state, ps.id, source, { ...cost.giveDon.spec, side: 'own' }).length)) return false;
  if (cost.ownToBottom && targetCandidates(state, ps.id, source, { ...cost.ownToBottom.spec, side: 'own' }).length < cost.ownToBottom.count) return false;
  if (cost.ownToLife && targetCandidates(state, ps.id, source, { ...cost.ownToLife.spec, side: 'own' }).length < cost.ownToLife.count) return false;
  if (cost.either && !cost.either.some((c) => canPayCost(state, ps.id, source, c))) return false;
  if (cost.returnGivenDon && [ps.leader, ...ps.characters].reduce((n, c) => n + c.don, 0) < cost.returnGivenDon) return false;
  if ((cost.restCharacters ?? 0) > ps.characters.filter((c) => !c.rested && c.uid !== source && !cannotBeRested(state, c.uid)).length) return false;
  if (cost.restOwn && ownCostOptions(state, player, source, cost.restOwn.spec, true).length < cost.restOwn.count) return false;
  if (cost.returnOwn && ownCostOptions(state, player, source, cost.returnOwn.spec, false).length < cost.returnOwn.count) {
    return false;
  }
  if ((cost.trashSelf || cost.selfToBottom) && locate(state, source)?.zone !== 'character' && locate(state, source)?.zone !== 'stage') return false;
  if (cost.returnSelf && locate(state, source)?.zone !== 'character') return false;
  if (cost.selfMinCost !== undefined && (!locate(state, source) || getCost(state, source) < cost.selfMinCost)) return false;
  if (
    cost.restOpponentChars &&
    state.players[opponent(player)].characters.filter((c) => !c.rested && !cannotBeRested(state, c.uid)).length < cost.restOpponentChars
  ) {
    return false;
  }
  if ((cost.trashToDeck ?? 0) > ps.trash.length) return false;
  if (cost.playFromHand && !ps.hand.some((u) => matchesFilter(cardDef(state, u), cost.playFromHand!) && !playBlocked(state, player, cardDef(state, u)))) return false;
  if (cost.giveOppDon && (state.players[opponent(player)].donRested < cost.giveOppDon || !state.players[opponent(player)].characters.length)) return false;
  if ((cost.handToTop ?? 0) > ps.hand.length) return false;
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
    (u) => u !== source && (!needActive || (!locate(state, u)?.fc.rested && !cannotBeRested(state, u))),
  );
}

export function describeCost(cost: AbilityCost): string {
  const parts: string[] = [];
  if (cost.donMinus) {
    parts.push(
      cost.donMinusOpen
        ? `DON!! −${cost.donMinus} ou mais (devolver ${cost.donMinus} ou mais DON!! ao deck de DON!!)`
        : `DON!! −${cost.donMinus} (devolver ${cost.donMinus} DON!! ao deck de DON!!)`,
    );
  }
  if (cost.restDon) parts.push(`virar ${cost.restDon} DON!!`);
  if (cost.restSelf) parts.push('virar esta carta');
  if (cost.trashFromHand) parts.push(`descartar ${cost.trashFromHand} carta(s) da mão`);
  if (cost.handToBottom) parts.push(`colocar ${cost.handToBottom} carta(s) da mão no fundo do deck`);
  if (cost.lifeToHand) parts.push(`colocar ${cost.lifeToHand} carta(s) da Vida na mão`);
  if (cost.restOwn) parts.push(`virar ${cost.restOwn.count} carta(s) sua(s)`);
  if (cost.returnOwn) parts.push(`devolver ${cost.returnOwn.count} Personagem(ns) seu(s) à mão`);
  if (cost.trashSelf) parts.push('descartar esta carta');
  if (cost.koSelf) parts.push('nocautear esta carta');
  if (cost.leaderPowerMinus) parts.push(`dar −${cost.leaderPowerMinus} de poder ao seu Líder`);
  if (cost.giveDon) parts.push(`dar ${cost.giveDon.count} DON!! ativo(s)`);
  if (cost.ownToBottom) parts.push(`colocar ${cost.ownToBottom.count} carta(s) sua(s) no fundo do deck`);
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
  if (cost.restOpponentChars) parts.push(`virar ${cost.restOpponentChars} Personagem(ns) do oponente`);
  if (cost.selfPowerMinus) parts.push(`dar −${cost.selfPowerMinus} de poder a esta carta`);
  if (cost.trashToDeck) parts.push(`devolver ${cost.trashToDeck} carta(s) do descarte ao deck e embaralhar`);
  if (cost.playFromHand) parts.push('jogar 1 carta da mão');
  if (cost.giveOppDon) parts.push(`dar ${cost.giveOppDon} DON!! virado(s) do oponente a um Personagem dele`);
  if (cost.handToTop) parts.push(`colocar ${cost.handToTop} carta(s) da mão no topo do deck`);
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
      // "For every {X} type card on your field, give …"
      const mult = step.per ? targetCandidates(state, frame.controller, frame.source, step.per).length : 1;
      for (const uid of t) {
        if (!mult) break;
        addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * mult, duration });
        log(state, frame.controller, `${cardDef(state, uid).name} recebe ${step.amount > 0 ? '+' : ''}${step.amount} de poder.`);
      }
      return true;
    }
    case 'ko': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um personagem para K.O.`);
      if (!t) return false;
      for (const uid of t) {
        const zone = locate(state, uid)?.zone;
        if (zone === 'character') koCharacter(state, uid, { byPlayer: frame.controller, by: frame.source });
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
          restCard(state, uid, frame.controller, frame.source);
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
      const giver = step.fromOpponent ? state.players[1 - frame.controller] : ps;
      const pool = () => giver.donRested + (step.anyState ? giver.donActive : 0);
      if (pool() === 0) return true;
      const t = resolveTargets(state, frame, step.target, step.fromOpponent ? 'harm' : 'help', `${srcName}: escolha quem recebe DON!! virado(s).`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        const n = Math.min(step.count, pool());
        if (loc && n > 0) {
          const fromRested = Math.min(n, giver.donRested);
          giver.donRested -= fromRested;
          giver.donActive -= n - fromRested;
          loc.fc.don += n;
          emit(state, { kind: 'donGiven', player: loc.player, card: uid });
          log(state, frame.controller, `${cardDef(state, uid).name} recebe ${n} DON!!.`);
        }
      }
      return true;
    }
    case 'draw':
      if (restricted(state, frame.controller, 'noDrawByEffect')) return true;
      drawCards(state, frame.controller, step.count);
      log(state, frame.controller, `${ps.name} compra ${step.count} carta(s).`);
      emit(state, { kind: 'drawByEffect', player: frame.controller });
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
        if (loc?.zone === 'stage') {
          detach(state, uid);
          state.players[loc.player].hand.push(uid);
          log(state, frame.controller, `${cardDef(state, uid).name} volta para a mão.`);
          continue;
        }
        if (loc?.zone !== 'character') continue;
        if (removalBlocked(state, uid, frame.controller)) {
          log(state, frame.controller, `${cardDef(state, uid).name} não pode ser removido do campo.`);
          continue;
        }
        if (offerReplacement(state, uid, 'hand', { byPlayer: frame.controller })) continue;
        const owner = state.players[loc.player];
        owner.donRested += loc.fc.don;
        removeCharacter(state, uid);
        owner.hand.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} volta para a mão.`);
        emit(state, { kind: 'characterRemoved', player: loc.player, card: uid, byPlayer: frame.controller });
        emit(state, { kind: 'returnedToHand', player: loc.player, card: uid, byPlayer: frame.controller });
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
      playFree(state, frame.source, step.rested);
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
      const trashed = frame.choice.filter((u) => options.includes(u));
      for (const uid of trashed) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        log(state, frame.controller, `${ps.name} descarta ${cardDef(state, uid).name}.`);
      }
      frame.eventCount = trashed.length;
      frame.trashed = trashed;
      if (trashed.length) {
        (state.handTrashedThisTurn ??= []).push(frame.controller);
        emit(state, { kind: 'handTrashedByEffect', player: frame.controller, card: frame.source, count: trashed.length });
      }
      return true;
    }
    case 'setDonActive': {
      if (restricted(state, frame.controller, 'noSetDonActiveByCharacter') && cardDef(state, frame.source).category === 'character') return true;
      const n = Math.min(step.count, ps.donRested);
      ps.donRested -= n;
      ps.donActive += n;
      if (n) log(state, frame.controller, `${n} DON!! de ${ps.name} fica(m) ativo(s).`);
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
            prompt: options.length
              ? `${srcName}: olhe as ${top.length} cartas do topo e escolha até ${step.upTo} para ${step.play ? 'jogar' : step.toTrash ? 'descartar' : 'adicionar à mão'}.`
              : `${srcName}: nenhuma das ${top.length} cartas do topo pode ser escolhida.`,
            intent: 'help',
            source: frame.source,
            shown: top,
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
            `${srcName}: escolha a ordem das cartas que vão para o fundo do deck (a primeira fica mais acima; a última, no fundo).`,
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
          log(state, frame.controller, `${ps.name} descarta ${cardDef(state, uid).name}.`);
        } else if (step.toLife) {
          ps.life.push(uid);
          if (step.lifeFaceDown) log(state, frame.controller, `${ps.name} coloca 1 carta no topo da Vida.`);
          else {
            (ps.lifeFaceUp ??= []).push(uid);
            log(state, frame.controller, `${ps.name} coloca ${cardDef(state, uid).name} no topo da Vida, virada para cima.`);
          }
        } else if (step.play) {
          // "play up to 1 … Then, place the rest at the bottom": joga a carta (o resto vai para o fundo antes).
          ps.hand.push(uid);
          playFree(state, uid, step.rested);
        } else {
          ps.hand.push(uid);
          log(state, frame.controller, `${ps.name} revela ${cardDef(state, uid).name} e adiciona à mão.`);
        }
      }
      if (step.rest === 'bottom') {
        ps.deck.push(...rest);
        if (rest.length) log(state, frame.controller, `${ps.name} coloca ${rest.length} carta(s) no fundo do deck.`);
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
        if (!canPayCost(state, frame.controller, frame.source, cost)) {
          releaseOncePerTurn(state, frame.source, step.ability);
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
          `${srcName}: quantos DON!! devolver ao deck de DON!!?`,
          Array.from({ length: max - step.min + 1 }, (_, i) => `${step.min + i} DON!!`),
        );
        return false;
      }
      const n = Math.min(max, step.min + (frame.choice ? Number(frame.choice[0]) : 0));
      returnDonAndEmit(state, ps, n);
      log(state, frame.controller, `${ps.name} devolve ${n} DON!! ao deck de DON!!.`);
      return true;
    }
    case 'trashLife': {
      const target = state.players[step.side === 'own' ? frame.controller : opponent(frame.controller)];
      const n = Math.min(step.count, target.life.length);
      for (let i = 0; i < n; i++) target.trash.push(target.life.pop()!);
      if (n) lifeRemoved(state, target.id);
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
        const kind = step.inBattle ? 'cannotBeKOInBattle' : step.byEffect ? 'cannotBeKOByEffect' : 'cannotBeKO';
        addModifier(state, frame.controller, { uid, kind, amount: 0, duration: step.duration });
        log(state, frame.controller, `${cardDef(state, uid).name} não pode ser nocauteado${step.inBattle ? ' em batalha' : step.byEffect ? ' por efeitos' : ''}.`);
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
        if (removalBlocked(state, uid, frame.controller)) {
          log(state, frame.controller, `${cardDef(state, uid).name} não pode ser removido do campo.`);
          continue;
        }
        if (offerReplacement(state, uid, 'trash', { byPlayer: frame.controller })) continue;
        const owner = state.players[ownerOf(state, uid)];
        detach(state, uid);
        owner.trash.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} vai para o descarte.`);
        emit(state, { kind: 'characterRemoved', player: owner.id, card: uid, byPlayer: frame.controller });
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
      if (n) lifeRemoved(state, ps.id);
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
      frame.last = frame.choice.filter((u) => options.includes(u));
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
      if (card) log(state, frame.controller, `${ps.name} revela ${cardDef(state, card).name} do topo do deck.`);
      return true;
    }
    case 'playRevealed': {
      const card = frame.last?.[0];
      if (card && (ps.deck.includes(card) || ps.life.includes(card)) && (!step.filter || matchesFilter(cardDef(state, card), step.filter))) {
        const def = cardDef(state, card);
        if (ps.lifeFaceUp?.includes(card)) removeFrom(ps.lifeFaceUp, card);
        if (def.category === 'character' || def.category === 'stage') playFree(state, card, step.rested);
      }
      return true;
    }
    case 'revealedToHand': {
      const card = frame.last?.[0];
      if (card && ps.deck.includes(card) && (!step.filter || matchesFilter(cardDef(state, card), step.filter))) {
        removeFrom(ps.deck, card);
        ps.hand.push(card);
        log(state, frame.controller, `${ps.name} adiciona ${cardDef(state, card).name} à mão.`);
      }
      return true;
    }
    case 'opponentTrashToBottom': {
      const opp = state.players[opponent(frame.controller)];
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
          prompt: `${srcName}: escolha ${n} carta(s) do descarte ${step.chooser === 'self' ? 'do oponente' : 'seu'} para o fundo do deck.`,
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
      log(state, opp.id, `${frame.choice.length} carta(s) do descarte de ${opp.name} vão para o fundo do deck.`);
      return true;
    }
    case 'arrangeLife': {
      const owner = step.whose === 'own' ? ps : state.players[opponent(frame.controller)];
      if (owner.life.length < 2) return true;
      if (!frame.choice) {
        // Do topo para o fundo, na ordem dos cliques.
        askCards(state, frame, [...owner.life].reverse(), owner.life.length, `${srcName}: ordene as cartas de Vida (a primeira escolhida fica no topo).`, {
          min: owner.life.length,
          ordered: true,
        });
        return false;
      }
      const order = frame.choice.filter((u) => owner.life.includes(u));
      if (order.length === owner.life.length) owner.life = [...order].reverse();
      log(state, frame.controller, `${ps.name} reorganiza as cartas de Vida de ${owner.name}.`);
      return true;
    }
    case 'restDonOrCharacter': {
      const opp = state.players[opponent(frame.controller)];
      const chars = targetCandidates(state, frame.controller, frame.source, { ...step.spec, side: 'opponent' }).filter((u) => !locate(state, u)?.fc.rested);
      if (!frame.memo) {
        if (!opp.donActive && !chars.length) return true;
        if (!frame.choice) {
          const opts = [...(opp.donActive ? ['Virar 1 DON!! ativo do oponente'] : []), ...(chars.length ? ['Virar um Personagem do oponente'] : []), 'Nenhum'];
          askOption(state, frame, frame.controller, `${srcName}: o que virar?`, opts);
          frame.memo = ['pick', ...(opp.donActive ? ['don'] : []), ...(chars.length ? ['char'] : [])];
          return false;
        }
      }
      if (frame.memo?.[0] === 'pick') {
        const pick = frame.memo[1 + Number(frame.choice?.[0])];
        frame.choice = undefined;
        if (pick === 'don') {
          opp.donActive--;
          opp.donRested++;
          log(state, frame.controller, `1 DON!! de ${opp.name} é virado.`);
          return true;
        }
        if (pick !== 'char') return true;
        frame.memo = ['char'];
      }
      const t = resolveTargets(state, frame, { ...step.spec, side: 'opponent', upTo: 1 }, 'harm', `${srcName}: escolha o Personagem a virar.`);
      if (!t) return false;
      for (const uid of t) restCard(state, uid);
      return true;
    }
    case 'chooseCost':
      if (!frame.choice) {
        askOption(state, frame, frame.controller, `${srcName}: escolha um custo.`, Array.from({ length: 11 }, (_, i) => String(i)));
        return false;
      }
      frame.chosenCost = Number(frame.choice[0]);
      log(state, frame.controller, `${ps.name} escolhe o custo ${frame.chosenCost}.`);
      return true;
    case 'revealOpponentTop': {
      const card = state.players[opponent(frame.controller)].deck[0];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, `${ps.name} revela ${cardDef(state, card).name} do topo do deck do oponente.`);
      return true;
    }
    case 'giveActiveDon': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe DON!! ativo(s).`);
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
      const options = targetCandidates(state, frame.controller, frame.source, { ...step.spec, side: 'own' });
      if (!options.length) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options,
          min: Math.min(step.count, options.length),
          max: Math.min(step.count, options.length),
          prompt: `${srcName}: escolha o que vai para o fundo do deck (custo).`,
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        const owner = state.players[ownerOf(state, uid)];
        detach(state, uid);
        if (step.toLife) {
          owner.life.push(uid);
          (owner.lifeFaceUp ??= []).push(uid);
          log(state, frame.controller, `${cardDef(state, uid).name} vai para o topo da Vida, virada para cima.`);
        } else {
          owner.deck.push(uid);
          log(state, frame.controller, `${cardDef(state, uid).name} vai para o fundo do deck.`);
        }
      }
      return true;
    }
    case 'moveGivenDon': {
      // 1º: quem recebe; 2º: de quais cartas saem os DON!! anexados.
      if (!frame.memo) {
        const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe os DON!! anexados.`);
        if (!t) return false;
        if (!t.length) return true;
        frame.memo = [t[0]];
        frame.choice = undefined;
      }
      const dest = frame.memo[0];
      const sources = [ps.leader, ...ps.characters].filter((c) => c.uid !== dest && c.don > 0).map((c) => c.uid);
      if (!sources.length || !locate(state, dest)) return true;
      if (!frame.choice) {
        askCards(state, frame, sources, Math.min(step.count, sources.length), `${srcName}: escolha de quais cartas saem os DON!! (até ${step.count} no total).`);
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
        log(state, frame.controller, `${cardDef(state, dest).name} recebe ${step.count - left} DON!! anexado(s).`);
        emit(state, { kind: 'donGiven', player: frame.controller, card: dest });
      }
      return true;
    }
    case 'handPlayOrLife': {
      if (!frame.memo) {
        const options = (step.from === 'trash' ? ps.trash : ps.hand).filter((u) => matchesFilter(cardDef(state, u), step.filter));
        if (!options.length) return true;
        if (!frame.choice) {
          askCards(state, frame, options, 1, `${srcName}: escolha uma carta ${step.from === 'trash' ? 'do descarte' : 'da mão'}.`);
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
        askOption(state, frame, frame.controller, `${srcName}: o que fazer com ${def.name}?`, [
          ...(canPlay ? ['Jogar'] : []),
          'Colocar no topo da Vida (virada para cima)',
        ]);
        frame.memo = [uid, canPlay ? 'play' : 'life'];
        return false;
      }
      const pickPlay = frame.memo[1] === 'play' && frame.choice[0] === '0';
      if (pickPlay) playFree(state, uid);
      else {
        removeFrom(ps.hand, uid);
        removeFrom(ps.trash, uid);
        ps.life.push(uid);
        (ps.lifeFaceUp ??= []).push(uid);
        log(state, frame.controller, `${def.name} vai para o topo da Vida, virada para cima.`);
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
      log(state, frame.controller, `${ps.name} compra ${frame.eventCount} carta(s).`);
      emit(state, { kind: 'drawByEffect', player: frame.controller });
      return true;
    }
    case 'trashEventCount': {
      const n = frame.eventCount ?? 0;
      if (!n) return true;
      if (step.from === 'deck') {
        const k = Math.min(n, ps.deck.length);
        ps.trash.push(...ps.deck.splice(0, k));
        if (k) log(state, frame.controller, `${ps.name} descarta ${k} carta(s) do topo do deck.`);
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
        log(state, frame.controller, `${ps.name} descarta ${cardDef(state, uid).name} (escolhida pelo oponente).`);
      }
      return true;
    }
    case 'revealOpponentHand': {
      const opp = state.players[opponent(frame.controller)];
      const picked: string[] = [];
      const pool = [...opp.hand];
      for (let k = 0; k < step.count && pool.length; k++) picked.push(pool.splice(Math.floor(nextRandom(state) * pool.length), 1)[0]);
      frame.last = picked;
      frame.revealed = picked;
      if (picked.length) log(state, frame.controller, `${opp.name} revela ${picked.map((u) => cardDef(state, u).name).join(', ')}.`);
      return true;
    }
    case 'opponentLifeToBottom': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, opp.life.length);
      for (let k = 0; k < n; k++) {
        const uid = opp.life.pop()!;
        if (opp.lifeFaceUp) removeFrom(opp.lifeFaceUp, uid);
        opp.deck.push(uid);
      }
      if (n) {
        lifeRemoved(state, opp.id);
        log(state, frame.controller, `${n} carta(s) da Vida de ${opp.name} vão para o fundo do deck.`);
      }
      return true;
    }
    case 'anyNumberForPower': {
      if (!frame.memo) {
        const options =
          step.source === 'trash'
            ? ps.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter))
            : targetCandidates(state, frame.controller, frame.source, { ...step.spec!, side: 'own' });
        if (!frame.choice) {
          if (!options.length) return true;
          askCards(state, frame, options, options.length, `${srcName}: escolha quantas cartas quiser.`, { ordered: step.action === 'bottom' });
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
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe +${bonus} de poder.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: bonus, duration: step.duration === 'battle' && !state.battle ? 'turn' : step.duration });
      return true;
    }
    case 'skipRefreshDon': {
      const opp = state.players[opponent(frame.controller)];
      (state.donSkipRefresh ??= []).push({ player: opp.id, count: step.count });
      log(state, frame.controller, `${step.count} DON!! de ${opp.name} não fica(m) ativo(s) na próxima Renovação.`);
      return true;
    }
    case 'replaceRest': {
      const ability = cardDef(state, frame.source).abilities[step.ability];
      if (!locate(state, step.victim) || !ability) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'confirm',
          player: frame.controller,
          source: frame.source,
          prompt: `${srcName} vai ser virado. Pagar ${ability.cost ? describeCost(ability.cost) : 'o efeito'} para evitar?`,
        };
        return false;
      }
      if (!frame.choice.length) {
        const loc = locate(state, step.victim);
        if (loc) loc.fc.rested = true;
        emit(state, { kind: 'selfRested', player: frame.controller, card: step.victim, byPlayer: step.byPlayer });
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
      gameOver(state, frame.controller, `${ps.name} vence pelo efeito de ${srcName}.`);
      return true;
    case 'extraTurn':
      state.extraTurn = frame.controller;
      log(state, frame.controller, `${ps.name} jogará um turno extra.`);
      return true;
    case 'opponentMay': {
      const opp = state.players[opponent(frame.controller)];
      const canPay =
        step.pay === 'lifeTrash' ? opp.life.length >= step.count : step.pay === 'discard' ? opp.hand.length >= step.count : opp.donActive >= step.count;
      const what =
        step.pay === 'lifeTrash' ? `descartar ${step.count} carta(s) do topo da Vida` : step.pay === 'discard' ? `descartar ${step.count} carta(s) da mão` : `devolver ${step.count} DON!! ativo(s)`;
      if (!canPay) {
        frame.steps.splice(frame.i + 1, 0, ...step.otherwise);
        return true;
      }
      if (!frame.choice) {
        askOption(state, frame, opp.id, `${srcName}: ${what} para evitar o efeito?`, [`Sim, ${what}`, 'Não']);
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
      const opp = state.players[opponent(frame.controller)];
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
          prompt: `${srcName}: você pode jogar até ${step.upTo} Personagem(ns) da sua mão.`,
          intent: 'help',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u)).reverse()) playFree(state, uid);
      return true;
    }
    case 'opponentAddDon': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, opp.donDeck);
      opp.donDeck -= n;
      opp.donActive += n;
      if (n) log(state, frame.controller, `${opp.name} adiciona ${n} DON!! ativo(s).`);
      return true;
    }
    case 'donMatchOpponent': {
      const extra = totalDonOnField(ps) - totalDonOnField(state.players[opponent(frame.controller)]);
      if (extra > 0) {
        returnDonAndEmit(state, ps, extra);
        log(state, frame.controller, `${ps.name} devolve ${extra} DON!! ao deck de DON!!.`);
      }
      return true;
    }
    case 'powerPerDon': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha a carta.`);
      if (!t) return false;
      for (const uid of t) {
        const don = locate(state, uid)?.fc.don ?? 0;
        if (don) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * don, duration: step.duration });
      }
      return true;
    }
    case 'powerPerRevealedCost': {
      const card = (frame.last ?? [])[0];
      const n = card ? (cardDef(state, card).cost ?? 0) : 0;
      if (!n) return true;
      const t = resolveTargets(state, { ...frame, last: [] }, step.target, 'help', `${srcName}: escolha a carta.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.amount * n, duration: step.duration });
      return true;
    }
    case 'gainAttribute': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem ganha o atributo.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'attribute', attribute: step.attribute, amount: 0, duration: step.duration });
      return true;
    }
    case 'attackTax': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha a carta.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'attackTax', amount: step.count, duration: step.duration });
      return true;
    }
    case 'handAllToDeck': {
      const who = step.who === 'self' ? ps : state.players[opponent(frame.controller)];
      const n = who.hand.length;
      who.deck.push(...who.hand.splice(0));
      shuffleInPlace(state, who.deck);
      frame.eventCount = n;
      log(state, frame.controller, `${who.name} devolve ${n} carta(s) da mão ao deck e embaralha.`);
      return true;
    }
    case 'opponentDraws': {
      const o = state.players[opponent(frame.controller)];
      drawCards(state, o.id, step.count);
      log(state, frame.controller, `${o.name} compra ${step.count} carta(s).`);
      return true;
    }
    case 'trashHand': {
      const n = ps.hand.length;
      ps.trash.push(...ps.hand.splice(0));
      if (n) {
        log(state, frame.controller, `${ps.name} descarta toda a mão (${n} carta(s)).`);
        emit(state, { kind: 'handTrashedByEffect', player: frame.controller, card: frame.source, count: n });
      }
      return true;
    }
    case 'opponentChoosesOwn': {
      const opp = state.players[opponent(frame.controller)];
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
          prompt: `${srcName}: escolha ${n} Personagem(ns) seu(s) para ${step.action === 'hand' ? 'devolver à mão' : 'colocar no fundo do deck'}.`,
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u)).slice(0, n)) {
        const loc = locate(state, uid);
        if (!loc) continue;
        opp.donRested += loc.fc.don;
        removeCharacter(state, uid);
        if (step.action === 'hand') opp.hand.push(uid);
        else opp.deck.push(uid);
        log(state, opp.id, `${cardDef(state, uid).name} ${step.action === 'hand' ? 'volta para a mão' : 'vai para o fundo do deck'}.`);
        emit(state, { kind: 'characterRemoved', player: opp.id, card: uid, byPlayer: frame.controller });
      }
      return true;
    }
    case 'takeDamage':
      state.stack.push({ kind: 'damage', defender: step.opponent ? opponent(frame.controller) : frame.controller, remaining: step.count, banish: false });
      return true;
    case 'lifeTrashUntil': {
      const n = Math.max(0, ps.life.length - step.count);
      for (let k = 0; k < n; k++) ps.trash.push(ps.life.pop()!);
      if (n) {
        lifeRemoved(state, ps.id);
        log(state, frame.controller, `${n} carta(s) de Vida de ${ps.name} vão para o descarte.`);
      }
      return true;
    }
    case 'trashHandUntil': {
      const who = step.both ? [frame.controller, opponent(frame.controller)] : [frame.controller];
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
          prompt: `${srcName}: descarte ${n} carta(s) até ficar com ${step.count} na mão.`,
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
      log(state, next, `${pl.name} descarta ${trashed.length} carta(s).`);
      if (trashed.length && next === frame.controller) emit(state, { kind: 'handTrashedByEffect', player: next, card: frame.source, count: trashed.length });
      frame.memo = [...memo, String(next)];
      frame.choice = undefined;
      return !who.some((p) => !frame.memo!.includes(String(p)) && state.players[p].hand.length > step.count);
    }
    case 'negateOnPlay': {
      const who = step.who === 'self' ? frame.controller : opponent(frame.controller);
      const mine = state.activePlayer === frame.controller;
      const untilTurn = step.duration === 'nextOpponentTurn' ? state.turn + (mine ? 1 : 2) : state.turn;
      (state.onPlayNegated ??= []).push({ player: who, untilTurn });
      log(state, frame.controller, `Os efeitos [Ao Jogar] de ${state.players[who].name} estão anulados.`);
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
        log(state, frame.controller, `${ps.name} compra ${n} carta(s).`);
      }
      return true;
    }
    case 'restDonForPower': {
      if (!frame.memo) {
        if (!ps.donActive) return true;
        if (!frame.choice) {
          askOption(state, frame, frame.controller, `${srcName}: quantos DON!! virar (+${step.power} de poder cada)?`, Array.from({ length: ps.donActive + 1 }, (_, i) => String(i)));
          return false;
        }
        const n = Math.min(Number(frame.choice[0]), ps.donActive);
        if (!n) return true;
        ps.donActive -= n;
        ps.donRested += n;
        frame.memo = [String(n)];
        frame.choice = undefined;
      }
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe o poder.`);
      if (!t) return false;
      const n = Number(frame.memo[0]);
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'power', amount: step.power * n, duration: 'battle' });
      log(state, frame.controller, `${ps.name} vira ${n} DON!! (+${step.power * n} de poder).`);
      return true;
    }
    case 'payEither': {
      const payable = step.options.map((c, i) => [c, i] as const).filter(([c]) => canPayCost(state, frame.controller, frame.source, c));
      if (!payable.length) return abortEffect(frame);
      if (!frame.choice) {
        askOption(state, frame, frame.controller, `${srcName}: como pagar o custo?`, payable.map(([c]) => describeCost(c)));
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
        if (step.withLeader) askCards(state, frame, options, 1, `${srcName}: escolha 1 Personagem para trocar o poder base com o seu Líder.`, { min: 1 });
        else askCards(state, frame, options, 2, `${srcName}: escolha 2 cartas para trocar o poder base.`, { min: 2 });
        return false;
      }
      const picked = frame.choice.filter((u) => options.includes(u));
      const [a, b] = step.withLeader ? [ps.leader.uid, picked[0]] : picked;
      if (!a || !b) return true;
      const base = (uid: string) => {
        const m = [...state.modifiers].reverse().find((x) => x.uid === uid && x.kind === 'basePower');
        return m ? m.amount : cardDef(state, uid).power ?? 0;
      };
      const pa = base(a);
      const pb = base(b);
      addModifier(state, frame.controller, { uid: a, kind: 'basePower', amount: pb, duration: step.duration });
      addModifier(state, frame.controller, { uid: b, kind: 'basePower', amount: pa, duration: step.duration });
      log(state, frame.controller, `${cardDef(state, a).name} e ${cardDef(state, b).name} trocam o poder base.`);
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
        log(state, frame.controller, `${ps.name} descarta ${up.length} carta(s) de Vida virada(s) para cima.`);
        lifeRemoved(state, ps.id);
      }
      return true;
    }
    case 'revealedToTopOrBottom': {
      const card = frame.revealed?.[0] ?? frame.last?.[0];
      if (!card || !ps.deck.includes(card)) return true;
      if (!frame.choice) {
        askOption(state, frame, frame.controller, `${srcName}: ${cardDef(state, card).name} fica no topo ou vai para o fundo do deck?`, ['Topo do deck', 'Fundo do deck']);
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
          askCards(state, frame, [...ps.life].reverse(), 1, `${srcName}: escolha a carta de Vida que vai para o topo do deck.`, { min: 1 });
          return false;
        }
        const uid = frame.choice.find((u) => ps.life.includes(u));
        if (uid) {
          removeFrom(ps.life, uid);
          if (ps.lifeFaceUp?.includes(uid)) removeFrom(ps.lifeFaceUp, uid);
          ps.deck.unshift(uid);
          log(state, frame.controller, `${ps.name} coloca 1 carta da Vida no topo do deck.`);
          lifeRemoved(state, ps.id);
        }
        frame.memo = ['order'];
        frame.choice = undefined;
      }
      if (ps.life.length < 2) return true;
      if (!frame.choice) {
        askCards(state, frame, [...ps.life].reverse(), ps.life.length, `${srcName}: ordene as cartas de Vida (a primeira escolhida fica no topo).`, { min: ps.life.length, ordered: true });
        return false;
      }
      const order = frame.choice.filter((u) => ps.life.includes(u));
      if (order.length === ps.life.length) ps.life = [...order].reverse();
      return true;
    }
    case 'cannotBlock': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha quem não poderá bloquear.`);
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
      log(state, frame.controller, `${ps.name} devolve ${step.count - left} DON!! anexado(s) à área de custo.`);
      return true;
    }
    case 'lastToDeckTop': {
      for (const uid of (frame.last ?? []).filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.deck.unshift(uid);
        logSecret(state, frame.controller, `${ps.name} coloca 1 carta da mão no topo do deck.`, `${cardDef(state, uid).name} volta ao topo do deck.`);
      }
      return true;
    }
    case 'koSelf':
      if (locate(state, frame.source)?.zone === 'character') koCharacter(state, frame.source, { force: true });
      return true;
    case 'negate': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha cujo efeito será anulado.`);
      if (!t) return false;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'negated', amount: 0, duration: step.duration });
        log(state, frame.controller, `O efeito de ${cardDef(state, uid).name} é anulado.`);
      }
      return true;
    }
    case 'restrict':
      (state.restrictions ??= []).push({ player: frame.controller, kind: step.kind, ...(step.minCost !== undefined ? { minCost: step.minCost } : {}) });
      return true;
    case 'nextPlayDiscount':
      (state.costReductions ??= []).push({ player: frame.controller, filter: step.filter, amount: step.amount });
      return true;
    case 'basePower': {
      // "Select … . This Character's base power becomes the same as the selected Character's power": guarda a escolha.
      if (step.copy === 'chosen' && !frame.memo) frame.memo = [...(frame.last ?? [])];
      const t = resolveTargets(state, frame, step.target, step.target === 'self' || step.target === 'ownLeader' ? 'help' : 'harm', `${srcName}: escolha a carta.`);
      if (!t) return false;
      const copied =
        step.copy === 'opponentLeader'
          ? state.players[opponent(frame.controller)].leader.uid
          : step.copy === 'attacker'
            ? state.battle?.attacker
            : step.copy === 'chosen'
              ? (frame.memo ?? frame.last ?? []).find((u) => locate(state, u))
              : undefined;
      if (step.copy && !copied) return true;
      const amount = copied ? getPower(state, copied) : step.amount ?? 0;
      for (const uid of t) {
        addModifier(state, frame.controller, { uid, kind: 'basePower', amount, duration: step.duration });
        log(state, frame.controller, `O poder base de ${cardDef(state, uid).name} passa a ser ${amount}.`);
      }
      return true;
    }
    case 'revealLifeTop': {
      const card = ps.life[ps.life.length - 1];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, `${ps.name} revela ${cardDef(state, card).name} do topo da Vida.`);
      return true;
    }
    case 'activateEventFromTrash':
    case 'activateEventFromHand': {
      const fromTrash = step.do === 'activateEventFromTrash';
      const options = (fromTrash ? ps.trash : ps.hand).filter((u) => {
        const def = cardDef(state, u);
        return def.category === 'event' && matchesFilter(def, step.filter) && def.abilities.some((a) => a.timing === 'main');
      });
      if (!options.length) return true;
      if (!frame.choice) {
        askCards(state, frame, options, 1, `${srcName}: escolha um Evento da mão para ativar.`);
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
      log(state, frame.controller, `${ps.name} ativa ${def.name} ${fromTrash ? 'do descarte' : 'da mão'}.`);
      pushEffect(state, uid, frame.controller, def.abilities.find((a) => a.timing === 'main')!.steps);
      emit(state, { kind: 'eventActivated', player: frame.controller, card: uid });
      (state.eventsThisTurn ??= []).push({ player: frame.controller, cost: def.cost ?? 0 });
      return false; // o índice já avançou
    }
    case 'trashAnyForPower': {
      const options = ps.hand.filter((u) => {
        const def = cardDef(state, u);
        return (!step.categories || step.categories.includes(def.category as 'event' | 'stage' | 'character')) && (!step.filter || matchesFilter(def, step.filter));
      });
      if (step.target && step.target !== 'self' && !frame.memo) {
        // Primeiro escolhe quem recebe o poder.
        const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe o poder.`);
        if (!t) return false;
        frame.memo = t.length ? t : ['-'];
        frame.choice = undefined;
      }
      if (!options.length) return true;
      if (!frame.choice) {
        askCards(state, frame, options, options.length, `${srcName}: descarte quantas cartas quiser (+${step.power} de poder para cada).`, { intent: 'discard' });
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
        log(state, frame.controller, `${cardDef(state, receiver).name} recebe +${step.power * chosen.length} de poder (${chosen.length} carta(s) descartada(s)).`);
      }
      return true;
    }
    case 'redirectAttack': {
      if (!state.battle) return true;
      if (step.toChosen) {
        const to = (frame.last ?? []).find((u) => locate(state, u)?.player === frame.controller);
        if (to && to !== state.battle.target) {
          state.battle.target = to;
          log(state, frame.controller, `O ataque agora mira ${cardDef(state, to).name}.`);
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
          prompt: `${srcName}: escolha o novo alvo do ataque.`,
          intent: 'help',
          source: frame.source,
        };
        return false;
      }
      const target = frame.choice.find((u) => options.includes(u));
      if (target && locate(state, target)) {
        state.battle.target = target;
        log(state, frame.controller, `O ataque agora mira ${cardDef(state, target).name}.`);
      }
      return true;
    }
    case 'handToDeck': {
      if (!frame.memo) {
        const n = Math.min(step.count, ps.hand.length);
        if (!n) return true;
        if (!frame.choice) {
          askCards(state, frame, [...ps.hand], n, `${srcName}: escolha ${n} carta(s) da mão para colocar no deck.`, { min: n, intent: 'discard' });
          return false;
        }
        frame.memo = frame.choice.filter((u) => ps.hand.includes(u)).slice(0, n);
        frame.choice = undefined;
      }
      let where = step.where;
      if (where === 'choose') {
        if (!frame.choice) {
          askOption(state, frame, frame.controller, `${srcName}: colocar no topo ou no fundo do deck?`, ['Topo do deck', 'Fundo do deck']);
          return false;
        }
        where = frame.choice[0] === '0' ? 'top' : 'bottom';
      }
      for (const uid of frame.memo) {
        removeFrom(ps.hand, uid);
        if (where === 'top') ps.deck.unshift(uid);
        else ps.deck.push(uid);
      }
      log(state, frame.controller, `${ps.name} coloca ${frame.memo.length} carta(s) da mão no ${where === 'top' ? 'topo' : 'fundo'} do deck.`);
      frame.memo = undefined;
      return true;
    }
    case 'lookOpponentTop': {
      const deck = state.players[opponent(frame.controller)].deck;
      if (!deck.length) return true;
      if (!frame.choice) {
        askOption(state, frame, frame.controller, `${srcName}: a carta do topo do deck do oponente é ${cardDef(state, deck[0]).name}.`, ['OK']);
        return false;
      }
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
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha quem não pode ser virado.`);
      if (!t) return false;
      for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'cannotBeRested', amount: 0, duration: step.duration });
      return true;
    }
    case 'opponentLifeToHand': {
      const opp = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, opp.life.length);
      for (let i = 0; i < n; i++) lifeToHandCard(state, opp.id, opp.life.pop()!);
      if (n) lifeRemoved(state, opp.id);
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
    case 'replaceRemoval': {
      const ability: Ability | undefined = step.inlineCost ? { timing: 'replace', steps: [], cost: step.inlineCost } : cardDef(state, frame.source).abilities[step.ability];
      const owner = state.players[frame.controller];
      if (!locate(state, step.victim) || !ability) return true;
      if (!frame.choice) {
        if (ability.cost && !canPayCost(state, owner.id, frame.source, ability.cost)) {
          performRemoval(state, step.victim, step.action, step.inBattle);
          return true;
        }
        state.pending = {
          kind: 'confirm',
          player: owner.id,
          source: frame.source,
          prompt: `${srcName}: ${cardDef(state, step.victim).name} vai sair do campo. Pagar ${ability.cost ? describeCost(ability.cost) : 'o efeito'} para evitar?`,
        };
        return false;
      }
      if (!frame.choice.length) {
        performRemoval(state, step.victim, step.action, step.inBattle);
        return true;
      }
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(frame.source, step.ability));
      // "you may add it to the top of your Life cards face-down instead"
      if (ability.cost?.victimToLife) {
        detach(state, step.victim);
        owner.life.push(step.victim);
        log(state, owner.id, `${cardDef(state, step.victim).name} vai para o topo da Vida em vez de sair do campo.`);
        return true;
      }
      log(state, owner.id, `${srcName}: ${cardDef(state, step.victim).name} fica em campo (efeito de substituição).`);
      const costSteps = ability.cost ? payImmediateCost(state, owner.id, frame.source, ability.cost) : [];
      if (ability.cost?.victimPowerMinus) {
        addModifier(state, owner.id, { uid: step.victim, kind: 'power', amount: -ability.cost.victimPowerMinus, duration: 'turn' });
      }
      frame.steps.splice(frame.i + 1, 0, ...costSteps, ...ability.steps);
      return true;
    }
    case 'replaceDamage': {
      const ability = cardDef(state, frame.source).abilities[step.ability];
      const owner = state.players[frame.controller];
      // O dano em resolução (logo abaixo deste efeito na pilha).
      const damage = [...state.stack].reverse().find((f): f is DamageFrame => f.kind === 'damage' && f.defender === owner.id);
      if (!locate(state, frame.source) || !ability || !damage || (ability.cost && !canPayCost(state, owner.id, frame.source, ability.cost))) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'confirm',
          player: owner.id,
          source: frame.source,
          prompt: `${srcName}: você vai sofrer ${damage.remaining} de dano. Pagar ${ability.cost ? describeCost(ability.cost) : 'o efeito'} para evitar?`,
        };
        return false;
      }
      if (!frame.choice.length) return true;
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(frame.source, step.ability));
      log(state, owner.id, `${srcName}: ${owner.name} não sofre o dano (efeito de substituição).`);
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
        askOption(state, frame, frame.controller, `${srcName}: de onde tirar a carta de Vida?`, ['Topo da Vida', 'Fundo da Vida']);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) lifeToHandCard(state, ps.id, fromBottom ? ps.life.shift()! : ps.life.pop()!);
      lifeRemoved(state, ps.id);
      log(state, frame.controller, `${ps.name} coloca ${n} carta(s) da Vida (${fromBottom ? 'fundo' : 'topo'}) na mão.`);
      return true;
    }
    case 'handToLife': {
      const options = [
        ...(step.trashOnly ? [] : discardable(state, frame.controller, step.filter)),
        ...(step.fromTrash || step.trashOnly ? ps.trash.filter((u) => matchesFilter(cardDef(state, u), step.filter ?? {})) : []),
      ];
      if (!frame.choice) {
        if (!options.length) return true;
        askCards(state, frame, options, step.upTo, `${srcName}: escolha até ${step.upTo} carta(s) da mão para o topo da Vida.`);
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.hand, uid);
        removeFrom(ps.trash, uid);
        ps.life.push(uid);
        if (step.faceUp) (ps.lifeFaceUp ??= []).push(uid);
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
        targets = t.filter((u) => locate(state, u)?.zone === 'character' && !removalBlocked(state, u, frame.controller));
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
      if (step.activeOnly) {
        const k = Math.min(step.count, opp.donActive);
        opp.donActive -= k;
        opp.donDeck += k;
        if (k) emit(state, { kind: 'donReturned', player: opp.id, count: k });
        return true;
      }
      const n = Math.min(step.count, totalDonOnField(opp));
      if (n) {
        returnDonAndEmit(state, opp, n);
        log(state, frame.controller, `${opp.name} devolve ${n} DON!! ao deck de DON!!.`);
      }
      return true;
    }
    case 'millDeck': {
      const n = Math.min(step.count, ps.deck.length);
      const milled = ps.deck.splice(0, n);
      ps.trash.push(...milled);
      // "If the trashed card has a cost of 6 or more"
      frame.last = milled;
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
        if (removalBlocked(state, uid, frame.controller)) {
          log(state, frame.controller, `${cardDef(state, uid).name} não pode ser removido do campo.`);
          continue;
        }
        if (offerReplacement(state, uid, 'deckBottom', { byPlayer: frame.controller })) continue;
        const owner = state.players[ownerOf(state, uid)];
        detach(state, uid);
        owner.deck.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} vai para o fundo do deck de ${owner.name}.`);
        emit(state, { kind: 'characterRemoved', player: owner.id, card: uid, byPlayer: frame.controller });
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
      const donCap = step.filter.maxCostDon ? totalDonOnField(ps) : step.filter.maxCostOppDon ? totalDonOnField(state.players[opponent(frame.controller)]) : undefined;
      const filter = donCap !== undefined ? { ...step.filter, maxCost: Math.min(step.filter.maxCost ?? 99, donCap) } : step.filter;
      const lastColors = step.notColorOfLast && frame.last?.[0] ? cardDef(state, frame.last[0]).colors : [];
      const sameName = step.filter.sameNameAsChosen ? (frame.trashed ?? []).map((u) => cardDef(state, u).name) : null;
      const options = zone.filter((u) => {
        const def = cardDef(state, u);
        return (
          (!sameName || sameName.includes(def.name)) &&
          (def.category === 'character' || def.category === 'stage') &&
          !def.abilities.some((a) => a.noPlayByEffect) &&
          matchesFilter(def, filter) &&
          !playBlocked(state, frame.controller, def) &&
          !def.colors.some((c) => lastColors.includes(c))
        );
      });
      if (!frame.choice) {
        if (!options.length) return !!(frame.last = []);
        const where =
          step.from === 'deck' ? 'do deck' : step.from === 'hand' ? 'da mão' : step.from === 'trash' ? 'do descarte' : 'da mão ou do descarte';
        askCards(state, frame, options, step.upTo, `${srcName}: escolha até ${step.upTo} carta(s) ${where} para jogar.`);
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
        // "place them at the top of your deck in any order": só a ordem.
        if (step.topOnly && !frame.choice) frame.choice = [];
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
const ZONE_FROM = { deck: 'do deck', hand: 'da mão', life: 'da Vida' } as const;

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
      // Na etapa de Counter, uma carta da mão só sai como Counter (vai para o descarte):
      // jogá-la no campo ativaria o [Ao Jogar] no meio do ataque.
      if (state.pending?.kind === 'counter' && from === 'hand' && (op.to === 'character' || op.to === 'stage')) {
        throw new IllegalActionError('Na etapa de Counter, use a carta como Counter (ela vai para o descarte), não a jogue no campo.');
      }
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
      // De uma zona escondida para outra: o oponente só fica sabendo que "uma carta" se moveu.
      const hiddenMove = ['deck', 'hand', 'life'].includes(from) && ['hand', 'deckTop', 'deckBottom', 'life'].includes(op.to);
      const where = `vai para ${ZONE_LABEL[op.to]}${owner !== p ? ` de ${os.name}` : ''}.`;
      if (!hiddenMove) log(state, p, `${tag} ${def.name} ${where}`);
      else if (owner !== p) log(state, p, `${tag} Uma carta ${where}`);
      else logSecret(state, p, `${tag} Uma carta (${ZONE_FROM[from as 'deck' | 'hand' | 'life']}) ${where}`, `${tag} ${def.name} ${where}`);
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
    case 'peek': {
      const n = Math.min(Math.max(1, Math.floor(op.count) || 1), ps.deck.length);
      log(state, p, `${tag} ${ps.name} olha ${n} carta(s) do topo do deck.`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Utilitários de zonas
// ---------------------------------------------------------------------------

type RemovalAction = 'ko' | 'hand' | 'deckBottom' | 'trash' | 'life';

/**
 * Efeito de substituição disponível para o Personagem que vai sair do campo? Se houver,
 * empilha a pergunta ("pagar … em vez disso?") e devolve true: a remoção fica para depois da resposta.
 */
function offerReplacement(
  state: GameState,
  victim: string,
  action: RemovalAction,
  ctx: { inBattle?: boolean; byPlayer?: PlayerId },
): boolean {
  const loc = locate(state, victim);
  if (!loc || loc.zone !== 'character') return false;
  const owner = state.players[loc.player];
  const byOpponentEffect = !ctx.inBattle && ctx.byPlayer !== undefined && ctx.byPlayer !== loc.player;
  for (const fc of [owner.leader, ...owner.characters, ...(owner.stage ? [owner.stage] : [])]) {
    const abilities = cardDef(state, fc.uid).abilities;
    for (let i = 0; i < abilities.length; i++) {
      const a = abilities[i];
      const r = a.replace;
      if (a.timing !== 'replace' || !r || r.event === 'rest' || r.event === 'damage') continue;
      if (r.who === 'self' ? fc.uid !== victim : !targetCandidates(state, owner.id, fc.uid, { ...r.who, side: 'own' }).includes(victim)) continue;
      const isKO = action === 'ko';
      const eventOk =
        (r.event !== 'removal' && isKO) || (r.event !== 'ko' && byOpponentEffect);
      if (!eventOk) continue;
      if (isKO && r.event === 'ko') {
        if (r.by === 'battle' && !ctx.inBattle) continue;
        if (r.by === 'effect' && ctx.inBattle) continue;
        if (r.by === 'opponentEffect' && !byOpponentEffect) continue;
      }
      if (!conditionsMet(state, fc.uid, a)) continue;
      if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(fc.uid, i))) continue;
      if (a.cost && !canPayCost(state, owner.id, fc.uid, a.cost)) continue;
      pushEffect(state, fc.uid, owner.id, [
        { do: 'replaceRemoval', victim, ability: i, action, ...(ctx.inBattle ? { inBattle: true } : {}) },
      ]);
      return true;
    }
  }
  // "If any of your Characters would be K.O.'d in battle during this turn, you may … instead."
  for (const t of state.tempReplacements ?? []) {
    if (t.player !== owner.id || action !== 'ko' || (t.by === 'battle' && !ctx.inBattle)) continue;
    if (!canPayCost(state, owner.id, t.source, t.cost)) continue;
    pushEffect(state, t.source, owner.id, [{ do: 'replaceRemoval', victim, ability: -1, action, inlineCost: t.cost, ...(ctx.inBattle ? { inBattle: true } : {}) }]);
    return true;
  }
  return false;
}

/** Procura "If you would take damage, you may … instead" no campo do defensor e pergunta. */
function offerDamageReplacement(state: GameState, defender: PlayerId): boolean {
  const owner = state.players[defender];
  for (const fc of [owner.leader, ...owner.characters, ...(owner.stage ? [owner.stage] : [])]) {
    const abilities = cardDef(state, fc.uid).abilities;
    for (let i = 0; i < abilities.length; i++) {
      const a = abilities[i];
      if (a.timing !== 'replace' || a.replace?.event !== 'damage') continue;
      if (!conditionsMet(state, fc.uid, a)) continue;
      if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(fc.uid, i))) continue;
      if (a.cost && !canPayCost(state, owner.id, fc.uid, a.cost)) continue;
      pushEffect(state, fc.uid, owner.id, [{ do: 'replaceDamage', ability: i }]);
      return true;
    }
  }
  return false;
}

/** Executa a remoção (depois de recusada a substituição). */
function performRemoval(state: GameState, victim: string, action: RemovalAction, inBattle?: boolean) {
  if (locate(state, victim)?.zone !== 'character') return;
  if (action === 'ko') {
    koCharacter(state, victim, { inBattle, noReplace: true });
    return;
  }
  const owner = state.players[ownerOf(state, victim)];
  detach(state, victim);
  if (action === 'hand') owner.hand.push(victim);
  else if (action === 'deckBottom') owner.deck.push(victim);
  else if (action === 'trash') owner.trash.push(victim);
  else owner.life.push(victim);
  log(state, null, `${cardDef(state, victim).name} sai do campo.`);
}

/** "cannot be removed from the field by your opponent's effects": o efeito de `byPlayer` não tira a carta do campo? */
export function removalBlocked(state: GameState, uid: string, byPlayer: PlayerId | undefined): boolean {
  const loc = locate(state, uid);
  if (!loc || byPlayer === undefined || byPlayer === loc.player) return false;
  if (cardDef(state, uid).abilities.some((a) => a.timing === 'static' && a.staticNoRemoval && conditionsMet(state, uid, a))) return true;
  return loc.zone !== 'stage' && aurasOn(state, uid, loc.zone, (au) => Boolean(au.noRemoval)).length > 0;
}

/** O personagem está protegido de K.O. ("cannot be K.O.'d [in battle]")? */
export function koProtected(state: GameState, uid: string, inBattle: boolean, by?: string): boolean {
  const kinds = inBattle ? ['cannotBeKO', 'cannotBeKOInBattle'] : ['cannotBeKO', 'cannotBeKOByEffect'];
  if (state.modifiers.some((m) => m.uid === uid && kinds.includes(m.kind))) return true;
  const byAttrs = by ? (cardDef(state, by).attributes ?? []) : [];
  const zone = locate(state, uid)?.zone;
  if (!inBattle && zone && zone !== 'stage' && aurasOn(state, uid, zone, (au) => Boolean(au.noEffectKO)).length) return true;
  if (inBattle && zone && zone !== 'stage' && aurasOn(state, uid, zone, (au) => Boolean(au.noBattleKO)).length) return true;
  const byChar = by !== undefined && cardDef(state, by).category === 'character';
  const opposing = by !== undefined && ownerOf(state, by) !== ownerOf(state, uid);
  if (
    !inBattle &&
    cardDef(state, uid).abilities.some(
      (a) =>
        a.timing === 'static' &&
        ((a.noEffectKOUnlessAttribute !== undefined && byChar && !hasAttributeOn(state, by!, a.noEffectKOUnlessAttribute)) ||
          (a.noEffectKOByMaxBasePower !== undefined && byChar && opposing && (cardDef(state, by!).power ?? 0) <= a.noEffectKOByMaxBasePower)) &&
        conditionsMet(state, uid, a),
    )
  ) {
    return true;
  }
  return cardDef(state, uid).abilities.some(
    (a) =>
      a.timing === 'static' &&
      ((inBattle ? a.staticNoBattleKO : a.staticNoEffectKO) ||
        (inBattle && a.noBattleKOVsAttribute !== undefined && byAttrs.includes(a.noBattleKOVsAttribute)) ||
        (inBattle && a.noBattleKOByLeader && by !== undefined && locate(state, by)?.zone === 'leader')) &&
      conditionsMet(state, uid, a),
  );
}

function koCharacter(
  state: GameState,
  uid: string,
  opts: { inBattle?: boolean; force?: boolean; by?: string; byPlayer?: PlayerId; noReplace?: boolean } = {},
) {
  const loc = locate(state, uid);
  if (!loc || loc.zone !== 'character') return;
  if (!opts.force && koProtected(state, uid, Boolean(opts.inBattle), opts.by)) {
    log(state, loc.player, `${cardDef(state, uid).name} não pode ser nocauteado.`);
    return;
  }
  if (!opts.force && !opts.inBattle && removalBlocked(state, uid, opts.byPlayer)) {
    log(state, loc.player, `${cardDef(state, uid).name} não pode ser removido do campo.`);
    return;
  }
  if (!opts.force && !opts.noReplace && offerReplacement(state, uid, 'ko', { inBattle: opts.inBattle, byPlayer: opts.byPlayer })) return;
  const ps = state.players[loc.player];
  ps.donRested += loc.fc.don;
  removeCharacter(state, uid);
  ps.trash.push(uid);
  log(state, loc.player, `${cardDef(state, uid).name} foi nocauteado (K.O.).`);
  (state.koThisTurn ??= []).push(loc.player);
  emit(state, { kind: 'characterKO', player: loc.player, card: uid });
  if (opts.inBattle || opts.byPlayer !== undefined) {
    emit(state, { kind: 'characterRemoved', player: loc.player, card: uid, byPlayer: opts.byPlayer, inBattle: opts.inBattle });
  }
  const def = cardDef(state, uid);
  def.abilities.forEach((a) => {
    // [On K.O.] com [Your Turn]/[Opponent's Turn]: a carta já saiu do campo, só o turno é checado.
    const turnOk = (!a.yourTurn || state.activePlayer === loc.player) && (!a.opponentsTurn || state.activePlayer !== loc.player);
    const byEffect = !opts.inBattle && opts.byPlayer !== undefined;
    const causeOk = !a.koBy || (byEffect && (a.koBy === 'effect' || opts.byPlayer !== loc.player));
    if (a.timing === 'onKO' && turnOk && causeOk) pushEffect(state, uid, loc.player, a.steps);
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

/** Carta de Vida indo para a mão (ou para o fundo do deck, se estiver virada para cima e o Líder mandar). */
function lifeToHandCard(state: GameState, player: PlayerId, uid: string) {
  const ps = state.players[player];
  const faceUp = ps.lifeFaceUp?.includes(uid);
  if (faceUp) removeFrom(ps.lifeFaceUp!, uid);
  if (faceUp && leaderRule(state, player, 'faceUpLifeToDeck')) {
    ps.deck.push(uid);
    log(state, player, `${cardDef(state, uid).name} (Vida virada para cima) vai para o fundo do deck.`);
  } else {
    ps.hand.push(uid);
    emit(state, { kind: 'lifeToHand', player, card: uid });
  }
}

/** Uma carta saiu da Vida de `player` (dispara "When a card is removed from … Life cards" e "becomes 0"). */
function lifeRemoved(state: GameState, player: PlayerId) {
  emit(state, { kind: 'lifeRemoved', player });
  if (state.players[player].life.length === 0) emit(state, { kind: 'lifeZero', player });
}

function removeFrom(arr: string[], uid: string) {
  const i = arr.indexOf(uid);
  if (i >= 0) arr.splice(i, 1);
}

function checkDefeat(state: GameState) {
  if (state.phase === 'gameover' || state.phase === 'mulligan') return;
  for (const ps of state.players) {
    if (ps.deck.length === 0) {
      if (leaderRule(state, ps.id, 'deckOutEndOfTurn')) continue;
      if (leaderRule(state, ps.id, 'deckOutWin')) {
        gameOver(state, ps.id, `${ps.name} ficou sem cartas no deck e vence pela regra do Líder.`);
        return;
      }
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

/** Linha do log com cartas que só `player` vê; o oponente recebe `text` (no online). */
function logSecret(state: GameState, player: PlayerId, text: string, secret: string) {
  state.log.push({ turn: state.turn, player, text, secret });
}
