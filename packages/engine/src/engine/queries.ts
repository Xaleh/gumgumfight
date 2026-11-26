// Consultas sobre as cartas: definição, dono, onde está, custo, poder, palavras-chave, filtros e auras.

import type { Aura, CardDef, GameState, Keyword, LeaderRule, PlayerId, TargetSpec } from '../types';
import type { Located } from './constants';
import { alivePlayers } from './table';
import { conditionHolds, conditionsMet } from './conditions';
import { fieldCardMatches } from './options';

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

/** Condições de passo que dependem do que o efeito já fez ("Then, if you did…"): antes de usar a carta não dá para saber. */
const STEP_IFS_UNKNOWN_AHEAD = ['lastDone', 'searchMissed', 'lastKOd', 'revealedHasChosenCost', 'chosenMatches'] as const;

/**
 * Quanto o [Counter] de um Evento da mão vale na batalha, para a interface mostrar ao lado do Counter dos
 * Personagens: o poder que ele dá a uma carta do dono ("Up to 1 of your Leader or Character cards gains +4000
 * power during this battle" = 4000). Evento que só tira poder do oponente devolve o valor negativo
 * ("give up to 1 of your opponent's Leader or Character cards −2000 power" = −2000). 0 = o efeito não é de
 * poder (devolve à mão, vira, impede K.O.…) ou não dá para dizer o valor de antemão.
 *
 * Vale o que o efeito daria agora: um bônus com condição ("Then, if you have 2 or less Life cards, that card
 * gains an additional +2000") só entra se a condição vale neste momento, e fica de fora o que depende de
 * escolhas feitas durante o efeito ou de uma conta por carta ("+1000 for every…").
 */
export function eventCounterPower(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  if (def.category !== 'event') return 0;
  const owner = ownerOf(state, uid);
  const ability = def.abilities.find((a) => a.timing === 'counter');
  if (!ability || !conditionHolds(state, owner, uid, ability.condition)) return 0;
  let own = 0;
  let theirs = 0;
  // "that card" (`chosen`) é do lado do último alvo escolhido.
  let chosenSide: 'own' | 'opponent' | 'any' = 'own';
  let ifFailed = false;
  for (const step of ability.steps) {
    if (step.afterIf && ifFailed) continue;
    if (step.if) {
      const cond = step.if;
      const met = !STEP_IFS_UNKNOWN_AHEAD.some((k) => cond[k] !== undefined) && conditionHolds(state, owner, uid, cond);
      ifFailed = !met;
      if (!met) continue;
    }
    const target = 'target' in step ? step.target : undefined;
    if (typeof target === 'object') chosenSide = target.side;
    if (step.do !== 'power' || step.per) continue;
    const side = typeof step.target === 'object' ? step.target.side : step.target === 'chosen' ? chosenSide : 'own';
    if (side === 'own' && step.amount > 0) own += step.amount;
    else if (side === 'opponent' && step.amount < 0) theirs += step.amount;
  }
  return own || theirs;
}

export function cardDef(state: GameState, uid: string): CardDef {
  return state.defs[state.cards[uid].cardId];
}

export function ownerOf(state: GameState, uid: string): PlayerId {
  return state.cards[uid].owner;
}

export function locate(state: GameState, uid: string): Located | null {
  for (const ps of state.players) {
    if (ps.out) continue;
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

/** Custo atual de uma carta em campo (custo impresso + efeitos contínuos + modificadores). */
export function getCost(state: GameState, uid: string): number {
  const loc = locate(state, uid);
  if (!loc) return cardDef(state, uid).cost ?? 0;
  return Math.max(0, ownCost(state, uid) + auraPower(state, uid, loc.zone, 'cost'));
}

/** Custo da carta sem as auras de outras cartas: impresso + os próprios efeitos contínuos + modificadores. */
function ownCost(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  let cost = def.cost ?? 0;
  const loc = locate(state, uid);
  if (!loc) return cost;
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticCost && conditionsMet(state, uid, a)) cost += a.staticCost;
    if (a.timing === 'static' && a.costPer && conditionsMet(state, uid, a)) {
      cost += a.costPer.cost * Math.floor(state.players[loc.player].trash.length / a.costPer.every);
    }
  }
  for (const m of state.modifiers) if (m.uid === uid && m.kind === 'cost') cost += m.amount;
  return cost;
}

/** Nome da carta (ou nome alternativo, "Also treat this card's name as …"). */
export function hasName(def: CardDef, name: string): boolean {
  if (def.name === name || def.aliases?.includes(name) || def.wild) return true;
  // O texto às vezes grafa o nome com outra pontuação ("other than [Mr.2.Bon.Kurei.(Bentham)]" na
  // carta "Mr.2.Bon.Kurei(Bentham)"): pontos e espaços não distinguem nomes.
  const key = nameKey(name);
  return nameKey(def.name) === key || Boolean(def.aliases?.some((a) => nameKey(a) === key));
}

const nameKey = (name: string) => name.replace(/[\s.]/g, '').toLowerCase();

/** Bate com um filtro de tipos ("{A} or {B} type")? Tolerante a tipos mal separados. */
export function matchesAnyType(def: CardDef, types: string[] | undefined): boolean {
  return !types?.length || types.some((t) => hasType(def, t));
}

/** Filtro de cartas fora do campo (busca no deck etc.). */
/** Parte de um alvo com "ou" ("{X} type Characters or Characters with a [Trigger]"). */
export function matchesPartial(state: GameState, uid: string, f: Partial<TargetSpec>, source: string): boolean {
  const loc = locate(state, uid);
  if (!loc) return false;
  if (f.kinds && !f.kinds.includes(loc.zone)) return false;
  return fieldCardMatches(state, source, loc.fc, { side: 'any', kinds: [loc.zone], upTo: 1, ...f, either: undefined });
}

/** Atributo da carta (impresso ou ganho por efeito). */
export function hasAttributeOn(state: GameState, uid: string, attr: string): boolean {
  return hasAttribute(cardDef(state, uid), attr) || state.modifiers.some((m) => m.uid === uid && m.kind === 'attribute' && m.attribute?.toLowerCase() === attr.toLowerCase());
}

/** As cartas escolhidas no efeito em resolução ("the chosen Character"). */
export function currentChosen(state: GameState): string[] {
  const top = [...state.stack].reverse().find((f) => f.kind === 'effect');
  return top?.kind === 'effect' ? (top.last ?? []) : [];
}

export const hasAttribute = (def: CardDef, a: string) => def.wild === true || (def.attributes ?? []).some((x) => x.toLowerCase() === a.toLowerCase());

/**
 * "with no base effect": carta sem texto. [Blocker] é efeito, e uma carta só com [Trigger] também tem
 * efeito base (Q&A P-011/OP06-074, docs/rules/interacoes/11); o [Counter +1000] impresso não conta.
 */
export const hasBaseEffect = (def: CardDef) => Boolean(def.text?.trim() || def.trigger?.trim());

export function matchesFilter(def: CardDef, f: import('../types').CardFilter): boolean {
  if (f.either && !f.either.some((x) => matchesFilter(def, x))) return false;
  if (f.noEffect && hasBaseEffect(def)) return false;
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
  if (f.maxPower !== undefined && (def.power ?? 0) > f.maxPower) return false;
  if (f.minPower !== undefined && (def.power ?? 0) < f.minPower) return false;
  if (f.hasTrigger && !def.trigger?.trim()) return false;
  if (f.hasAllTypes && !f.hasAllTypes.every((t) => hasType(def, t))) return false;
  if (f.withoutKeyword && def.keywords.includes(f.withoutKeyword)) return false;
  return true;
}

/**
 * "with a type including "X"": algum tipo contém o texto (sem diferenciar maiúsculas). O Líder de
 * 6 cores (`wild`) tem todos os tipos, então também tem um que inclui o texto.
 */
export function typeIncludes(def: Pick<CardDef, 'types' | 'wild'>, part: string): boolean {
  if (def.wild) return true;
  const p = part.toLowerCase();
  return def.types.some((t) => t.toLowerCase().includes(p));
}

/** "name includes "X"": o nome (ou um nome alternativo) contém o texto; o Líder de 6 cores tem todos os nomes. */
export function nameIncludes(def: Pick<CardDef, 'name' | 'aliases' | 'wild'>, part: string): boolean {
  if (def.wild) return true;
  const p = part.toLowerCase();
  return def.name.toLowerCase().includes(p) || Boolean(def.aliases?.some((a) => a.toLowerCase().includes(p)));
}

/** Soma das auras ativas que afetam a carta (bônus de outras cartas do mesmo jogador). */
/** Auras ativas (de qualquer jogador) que afetam a carta. */
let auraDepth = 0;

export function aurasOn(state: GameState, uid: string, zone: 'leader' | 'character' | 'stage', want: (au: Aura) => boolean): Aura[] {
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
  for (const ps of alivePlayers(state)) {
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
        // Custo atual ("Characters with a cost of 12 or more": o Rodo OP17-094, impresso 1, vale 13 com o
        // +12 dele); "base cost" fica no impresso. Uma aura de custo que filtra por custo olha o custo sem as
        // auras (senão ela dependeria de si mesma).
        if (a.aura.minCost !== undefined || a.aura.maxCost !== undefined) {
          const cost = a.aura.baseCost ? (target.cost ?? 0) : a.aura.cost !== undefined ? Math.max(0, ownCost(state, uid)) : getCost(state, uid);
          if (a.aura.minCost !== undefined && cost < a.aura.minCost) continue;
          if (a.aura.maxCost !== undefined && cost > a.aura.maxCost) continue;
        }
        if (a.aura.color && !target.colors.includes(a.aura.color)) continue;
        if (a.aura.excludeName && hasName(target, a.aura.excludeName)) continue;
        if (a.aura.excludeSelf && fc.uid === uid) continue;
        if (a.aura.rested !== undefined && Boolean(locate(state, uid)?.fc.rested) !== a.aura.rested) continue;
        if (a.aura.hasTrigger && !target.trigger?.trim()) continue;
        if (a.aura.hasAllTypes && !a.aura.hasAllTypes.every((t) => hasType(target, t))) continue;
        if (a.aura.notTypeIncludes && typeIncludes(target, a.aura.notTypeIncludes)) continue;
        // "Characters with a cost of 3 or 4" (P-084): custo atual, como em minCost/maxCost.
        if (a.aura.exactCosts && !a.aura.exactCosts.includes(a.aura.baseCost ? (target.cost ?? -1) : a.aura.cost !== undefined ? Math.max(0, ownCost(state, uid)) : getCost(state, uid))) continue;
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

/**
 * Poder base atual: o impresso, ou, se há efeitos que o fixam ("base power becomes X", auras, permanentes,
 * troca de poder base), o MAIOR entre eles (4-9-2-1; Q&A ST34-004 Linlin, OP17-008 Jozu).
 */
export function basePowerOf(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  if (!loc) return def.power ?? 0;
  const leaderPower = () => cardDef(state, state.players[loc.player].leader.uid).power ?? 0;
  const set: number[] = [];
  if (loc.zone !== 'stage') {
    for (const au of aurasOn(state, uid, loc.zone, (x) => x.basePower !== undefined || Boolean(x.basePowerCopyLeader))) {
      set.push(au.basePowerCopyLeader ? leaderPower() : au.basePower!);
    }
  }
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticBasePower !== undefined && conditionsMet(state, uid, a)) {
      set.push(a.staticBasePower === 'leader' ? leaderPower() : a.staticBasePower);
    }
  }
  for (const m of state.modifiers) if (m.uid === uid && m.kind === 'basePower') set.push(m.amount);
  return set.length ? Math.max(...set) : def.power ?? 0;
}

export function getPower(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  if (!loc) return def.power ?? 0;
  let power = basePowerOf(state, uid);
  if (loc.player === state.activePlayer) power += loc.fc.don * 1000;
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticPower && conditionsMet(state, uid, a)) power += a.staticPower;
    if (a.timing === 'static' && a.powerPer && conditionsMet(state, uid, a)) {
      const ps = state.players[loc.player];
      const p = a.powerPer;
      const n =
        p.what === 'distinctCharacters'
          ? new Set(ps.characters.map((c) => cardDef(state, c.uid).name)).size
          : p.what === 'characters'
          ? // Pelos dados impressos (nome, tipo): contar pelo poder voltaria a este cálculo.
            ps.characters.filter((c) => matchesFilter(cardDef(state, c.uid), p.filter ?? {})).length
          : p.what === 'hand'
          ? ps.hand.length
          : p.what === 'restedDon'
            ? ps.donRested
            : p.what === 'trash'
              ? ps.trash.length
              : ps.trash.filter((u) => cardDef(state, u).category === 'event').length;
      power += p.power * Math.floor(n / p.every);
    }
    // Durante a batalha; no fim dela o bônus vira um modificador "during this turn" (ver o passo 'end').
    if (a.timing === 'static' && a.battleVsAttribute && state.battle && !state.battle.endFired && conditionsMet(state, uid, a)) {
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
export function hasType(def: Pick<CardDef, 'types' | 'wild'>, type: string): boolean {
  if (def.types.includes(type) || def.wild) return true;
  // Sem diferenciar maiúsculas: a API traz "Film" nos tipos e "{FILM}" nos textos.
  return ` ${def.types.join(' ')} `.toLowerCase().includes(` ${type.toLowerCase()} `);
}

export function canAttackActive(state: GameState, uid: string): boolean {
  if (state.modifiers.some((m) => m.uid === uid && m.kind === 'canAttackActive')) return true;
  return cardDef(state, uid).abilities.some(
    (a) => a.timing === 'static' && a.staticCanAttackActive && conditionsMet(state, uid, a),
  );
}
