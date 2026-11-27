// Condições das habilidades e dos passos de efeito: se valem agora e, quando não valem, o motivo para o histórico.

import type { Ability, Condition, GameState, PlayerId, PlayerState } from '../types';
import { lg, type Prompt } from './messages';
import { alivePlayers, anyOpponent, fixedOpponent, isMultiplayer, opponent, opponentOf, opponentsOf } from './table';
import {
  cardDef,
  currentChosen,
  getCost,
  getPower,
  hasAttribute,
  hasAttributeOn,
  hasName,
  hasType,
  isNegated,
  locate,
  nameIncludes,
  ownerOf,
  typeIncludes,
} from './queries';
import { targetCandidates, totalDonOnField } from './options';

export function conditionsMet(state: GameState, uid: string, ability: Ability): boolean {
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
    return anyOpponent(state, controller, () => evalCondition(state, controller, source, cond));
  } finally {
    condDepth--;
  }
}

function evalCondition(state: GameState, controller: PlayerId, source: string, cond: Condition): boolean {
  if (cond.anyOf && !cond.anyOf.some((c) => conditionHolds(state, controller, source, c))) return false;
  const ps = state.players[controller];
  const opp = state.players[opponentOf(state, controller)];
  // "Characters on the field", "a Character": de qualquer jogador da mesa.
  const everyone = isMultiplayer(state) ? alivePlayers(state) : [ps, opp];
  const allCharacters = () => everyone.flatMap((pl) => pl.characters);
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
  // "If it is your second turn or later" (`minTurn: 3`, o turno 3 da partida de dois). Numa mesa de mais de dois o
  // número do turno da mesa não diz de quem é o turno: valem os turnos que o próprio jogador já jogou.
  if (cond.minTurn !== undefined && (isMultiplayer(state) ? (state.turnsTaken?.[controller] ?? 0) < Math.ceil(cond.minTurn / 2) : state.turn < cond.minTurn)) return false;
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
  if (cond.opponentLeaderAttribute && !hasAttribute(cardDef(state, opp.leader.uid), cond.opponentLeaderAttribute)) {
    return false;
  }
  if (cond.selfRested && !locate(state, source)?.fc.rested) return false;
  if (cond.selfActive && locate(state, source)?.fc.rested !== false) return false;
  if (cond.leaderActive && ps.leader.rested) return false;
  if (cond.anyCharacterNamed && !allCharacters().some((c) => hasName(cardDef(state, c.uid), cond.anyCharacterNamed!))) return false;
  if (cond.onlyTypeIncludes && (!ps.characters.length || ps.characters.some((c) => !typeIncludes(cardDef(state, c.uid), cond.onlyTypeIncludes!)))) return false;
  if (cond.allDonRested && (ps.donActive > 0 || totalDonOnField(ps) === 0)) return false;
  if (cond.deficit) {
    const n = (pl: PlayerState) => (cond.deficit!.what === 'don' ? totalDonOnField(pl) : cond.deficit!.what === 'hand' ? pl.hand.length : pl.characters.length);
    if (n(opp) - n(ps) < cond.deficit.n) return false;
  }
  if (cond.trashHasNames && !cond.trashHasNames.every((nm) => ps.trash.some((u) => hasName(cardDef(state, u), nm)))) return false;
  if (
    cond.anyCharacterMinBasePower !== undefined &&
    !allCharacters().some((c) => (cardDef(state, c.uid).power ?? 0) >= cond.anyCharacterMinBasePower!)
  ) {
    return false;
  }
  if (cond.opponentCharacterKOThisTurn && !(state.koThisTurn ?? []).includes(opp.id)) return false;
  if (cond.opponentLifeRemovedThisTurn && !(state.lifeRemovedThisTurn ?? []).includes(opp.id)) return false;
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
  if (cond.ownRestedCardsMin !== undefined) {
    const rested = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])].filter((c) => c.rested).length + ps.donRested;
    if (rested < cond.ownRestedCardsMin) return false;
  }
  if (cond.leaderNames && !cond.leaderNames.some((nm) => hasName(cardDef(state, ps.leader.uid), nm))) return false;
  if (cond.onlyCharactersWithoutCounter && ps.characters.some((c) => cardDef(state, c.uid).counter)) return false;
  if (cond.leaderMinPower !== undefined && getPower(state, ps.leader.uid) < cond.leaderMinPower) return false;
  if (cond.fewerCharacters && ps.characters.length >= opp.characters.length) return false;
  const acw = cond.anyCharactersWithCost;
  if (acw && allCharacters().filter((c) => getCost(state, c.uid) >= acw.cost).length < acw.count) return false;
  if (cond.leaderNameIncludes && !nameIncludes(cardDef(state, ps.leader.uid), cond.leaderNameIncludes)) return false;
  if (cond.leaderColor && !cardDef(state, ps.leader.uid).colors.includes(cond.leaderColor)) return false;
  if (cond.leaderMaxPower !== undefined && getPower(state, ps.leader.uid) > cond.leaderMaxPower) return false;
  if (cond.opponentLeaderMinPower !== undefined && getPower(state, opp.leader.uid) < cond.opponentLeaderMinPower) return false;
  if (cond.totalLifeMin !== undefined && ps.life.length + opp.life.length < cond.totalLifeMin) return false;
  if (cond.opponentMaxDonOnField !== undefined && totalDonOnField(opp) > cond.opponentMaxDonOnField) return false;
  if (cond.minDonOnField !== undefined && totalDonOnField(ps) < cond.minDonOnField) return false;
  if (cond.handMax !== undefined && ps.hand.length > cond.handMax) return false;
  if (cond.leaderHasType && !hasType(cardDef(state, ps.leader.uid), cond.leaderHasType)) return false;
  if (cond.leaderTypeIncludes && !typeIncludes(cardDef(state, ps.leader.uid), cond.leaderTypeIncludes)) return false;
  if (cond.leaderName && !hasName(cardDef(state, ps.leader.uid), cond.leaderName)) return false;
  if (cond.opponentMoreDon && totalDonOnField(opp) <= totalDonOnField(ps)) return false;
  if (cond.lifeMax !== undefined && ps.life.length > cond.lifeMax) return false;
  if (cond.opponentLifeMax !== undefined && opp.life.length > cond.opponentLifeMax) return false;
  if (cond.totalLifeMax !== undefined && ps.life.length + opp.life.length > cond.totalLifeMax) return false;
  const range = cond.anyCharacterCost;
  if (
    range &&
    !allCharacters().some((c) => {
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
  if (cond.anyCharacterMinPower !== undefined && !allCharacters().some((c) => getPower(state, c.uid) >= cond.anyCharacterMinPower!)) {
    return false;
  }
  if (cond.faceUpLifeMin !== undefined && ps.life.filter((u) => ps.lifeFaceUp?.includes(u)).length < cond.faceUpLifeMin) return false;
  if (cond.leaderAttribute && !hasAttribute(cardDef(state, ps.leader.uid), cond.leaderAttribute)) {
    return false;
  }
  // "If you have [Jewelry Bonney]" / "… [Merry Go] on your field": qualquer carta sua com o nome (Líder, Personagem
  // ou Stage); "If you have a [X] Character": só Personagens.
  const named = (n: string, onlyCharacters?: boolean) =>
    (onlyCharacters ? ps.characters : [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]).some((c) => hasName(cardDef(state, c.uid), n));
  if (
    cond.haveNamed &&
    !cond.haveNamed.every((n) =>
      cond.haveNamedBasePower === undefined
        ? named(n)
        : ps.characters.some((c) => hasName(cardDef(state, c.uid), n) && cardDef(state, c.uid).power === cond.haveNamedBasePower),
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
  if (cond.haveCharacterNamed && !named(cond.haveCharacterNamed, cond.haveCharacterOnly)) {
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
  if (cond.leaderAnyDonGiven && ps.leader.don === 0) return false;
  if (cond.leaderMinDon !== undefined && ps.leader.don < cond.leaderMinDon) return false;
  if (cond.selfPlayedThisTurn && locate(state, source)?.fc.playedOnTurn !== state.turn) return false;
  if (
    cond.minTypedCharacters &&
    ps.characters.filter((c) => (cond.minTypedCharacters!.types ?? [cond.minTypedCharacters!.type]).some((t) => hasType(cardDef(state, c.uid), t))).length <
      cond.minTypedCharacters.count
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
  if (
    cond.noOtherNamed &&
    ps.characters.some(
      (c) =>
        c.uid !== source &&
        hasName(cardDef(state, c.uid), cond.noOtherNamed!) &&
        (cond.noOtherNamedBaseCost === undefined || cardDef(state, c.uid).cost === cond.noOtherNamedBaseCost),
    )
  ) {
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

/**
 * Explica, para o histórico, por que a condição de um efeito não vale ("If you have 2 or less
 * Characters…"): o jogador vê o motivo em vez de um efeito que "não abriu". Cobre as contagens
 * mais comuns; as outras condições recebem o texto genérico.
 */
export function conditionFailure(state: GameState, controller: PlayerId, source: string, cond: Condition): Prompt {
  const ps = state.players[controller];
  // Só para o texto do histórico: sem oponente definido (mesa com mais de dois), descreve o próximo da ordem.
  const opp = state.players[isMultiplayer(state) ? (fixedOpponent(state, controller) ?? opponentsOf(state, controller)[0] ?? controller) : opponent(controller)];
  const chars = ps.characters.length;
  const self = ps.characters.some((c) => c.uid === source) ? ', contando esta carta' : '';
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  // "{player} tem N …; precisa de L ou menos/mais" (chave `log.cond.<key>`).
  const has = (key: string, player: string, k: number, what: string, limit: number, more: boolean) =>
    lg(`cond.${key}`, `${player} tem ${what}; precisa de ${limit} ou ${more ? 'mais' : 'menos'}`, { player, n: k, limit });
  if (cond.maxCharacters !== undefined && chars > cond.maxCharacters) {
    return has(self ? 'maxCharactersSelf' : 'maxCharacters', ps.name, chars, `${n(chars, 'Personagem', 'Personagens')}${self}`, cond.maxCharacters, false);
  }
  if (cond.minCharacters !== undefined && chars < cond.minCharacters) {
    return has(self ? 'minCharactersSelf' : 'minCharacters', ps.name, chars, `${n(chars, 'Personagem', 'Personagens')}${self}`, cond.minCharacters, true);
  }
  const hand = ps.hand.length;
  if (cond.handMax !== undefined && hand > cond.handMax) return has('handMax', ps.name, hand, `${n(hand, 'carta', 'cartas')} na mão`, cond.handMax, false);
  if (cond.handMin !== undefined && hand < cond.handMin) return has('handMin', ps.name, hand, `${n(hand, 'carta', 'cartas')} na mão`, cond.handMin, true);
  const life = ps.life.length;
  if (cond.lifeMax !== undefined && life > cond.lifeMax) return has('lifeMax', ps.name, life, `${n(life, 'carta', 'cartas')} de Vida`, cond.lifeMax, false);
  if (cond.lifeMin !== undefined && life < cond.lifeMin) return has('lifeMin', ps.name, life, `${n(life, 'carta', 'cartas')} de Vida`, cond.lifeMin, true);
  const oppLife = opp.life.length;
  if (cond.opponentLifeMax !== undefined && oppLife > cond.opponentLifeMax) {
    return has('lifeMax', opp.name, oppLife, `${n(oppLife, 'carta', 'cartas')} de Vida`, cond.opponentLifeMax, false);
  }
  if (cond.opponentLifeMin !== undefined && oppLife < cond.opponentLifeMin) {
    return has('lifeMin', opp.name, oppLife, `${n(oppLife, 'carta', 'cartas')} de Vida`, cond.opponentLifeMin, true);
  }
  const don = totalDonOnField(ps);
  if (cond.minDonOnField !== undefined && don < cond.minDonOnField) return has('donMin', ps.name, don, `${don} DON!! no campo`, cond.minDonOnField, true);
  if (cond.maxDonOnField !== undefined && don > cond.maxDonOnField) return has('donMax', ps.name, don, `${don} DON!! no campo`, cond.maxDonOnField, false);
  if (cond.leaderHasType && !hasType(cardDef(state, ps.leader.uid), cond.leaderHasType)) {
    return lg('cond.leaderNoType', `o Líder de ${ps.name} não tem o tipo {${cond.leaderHasType}}`, { player: ps.name, type: cond.leaderHasType });
  }
  if (cond.leaderHasAnyType && !cond.leaderHasAnyType.some((t) => hasType(cardDef(state, ps.leader.uid), t))) {
    const types = cond.leaderHasAnyType.map((t) => `{${t}}`).join(' nem ');
    return lg(
      'cond.leaderNoAnyType',
      `o Líder de ${ps.name} não tem o tipo ${types}`,
      { player: ps.name, types },
      { types: { items: cond.leaderHasAnyType.map((type) => ({ key: 'log.cond.typeName', params: { type } })), join: 'log.cond.nor' } },
    );
  }
  return lg('cond.generic', 'a condição do efeito não vale agora');
}
