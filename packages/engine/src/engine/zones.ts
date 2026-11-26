// Utilitários de zonas: onde a carta está, tirar do campo, virar, comprar, DON!! e Vida.

import type { DonSource, GameState, PlayerId, PlayerState } from '../types';
import { IllegalActionError } from './constants';
import { lg, log, type Prompt } from './messages';
import { cardDef, leaderRule, locate, ownerOf } from './queries';
import { conditionsMet } from './conditions';
import { forgetCard, usedKey } from './options';
import { pushEffect } from './stack';
import { emit } from './triggers';
import { costAsksOwner } from './costs';
import { removeCharacter } from './removal';

/**
 * "… cannot be rested": a carta não pode ser virada de jeito nenhum — nem por efeitos,
 * nem para atacar, bloquear ou pagar custos.
 */
export function cannotBeRested(state: GameState, uid: string): boolean {
  return state.modifiers.some((m) => m.uid === uid && m.kind === 'cannotBeRested');
}

/** Vira uma carta em campo (dispara "When this Character becomes rested"). */
export function restCard(state: GameState, uid: string, byEffectOf?: PlayerId, restSource?: string) {
  const loc = locate(state, uid);
  if (!loc || loc.fc.rested) return;
  if (cannotBeRested(state, uid)) {
    // "… cannot be rested": o efeito tenta virar e nada acontece; o histórico explica (Q&A EB02-011).
    if (byEffectOf !== undefined) log(state, byEffectOf, lg('cannotBeRestedActive', `${cardDef(state, uid).name} não pode ser virada (efeito "não vira" ativo).`, { card: cardDef(state, uid).name }), { cards: [uid] });
    return;
  }
  if (
    byEffectOf !== undefined &&
    byEffectOf !== loc.player &&
    cardDef(state, uid).abilities.some(
      (a) =>
        a.timing === 'static' &&
        a.staticNoRest &&
        (a.staticNoRest === true || !restSource || ['leader', 'character'].includes(cardDef(state, restSource).category)) &&
        conditionsMet(state, uid, a),
    )
  ) {
    log(state, byEffectOf, lg('cannotBeRestedByOpponent', `${cardDef(state, uid).name} não pode ser virada por efeitos do oponente.`, { card: cardDef(state, uid).name }), { cards: [uid] });
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
        (!a.cost || costAsksOwner(state, loc.player, uid, a.cost)),
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
export function returnDonAndEmit(state: GameState, ps: PlayerState, n: number) {
  if (n <= 0) return;
  returnDon(ps, n);
  emit(state, { kind: 'donReturned', player: ps.id, count: n, byPlayer: ps.id });
}

/** Cartas de Vida viradas para baixo, do topo para o fundo. */
/** Cartas do topo e do fundo da Vida que podem ser viradas para cima (`up`) ou para baixo, nessa ordem. */
export function lifeEnds(ps: PlayerState, up: boolean): string[] {
  const top = ps.life[ps.life.length - 1];
  const bottom = ps.life[0];
  const ok = (u: string | undefined) => u !== undefined && (up ? !ps.lifeFaceUp?.includes(u) : Boolean(ps.lifeFaceUp?.includes(u)));
  return [...new Set([top, bottom])].filter(ok) as string[];
}

/**
 * As N cartas do topo da Vida que podem ser viradas para cima (`up`) ou para baixo, do topo para o fundo.
 * "Turn N cards from the top of your Life cards face-up" só olha essas: a do topo já virada não é pulada.
 */
export function lifeTop(ps: PlayerState, n: number, up: boolean): string[] {
  return ps.life
    .slice(Math.max(0, ps.life.length - n))
    .reverse()
    .filter((u) => (up ? !ps.lifeFaceUp?.includes(u) : Boolean(ps.lifeFaceUp?.includes(u))));
}

export function faceDownLife(ps: PlayerState): string[] {
  return [...ps.life].reverse().filter((u) => !ps.lifeFaceUp?.includes(u));
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

/** A carta está fora de qualquer área (a do [Trigger] enquanto ele resolve, 10-1-5-3)? */
export function inLimbo(state: GameState, uid: string): boolean {
  return Boolean(state.limbo?.includes(uid));
}

function leaveLimbo(state: GameState, uid: string) {
  if (!state.limbo) return;
  removeFrom(state.limbo, uid);
  if (!state.limbo.length) delete state.limbo;
}

/** Fim do [Trigger]: a carta que o efeito não moveu vai para o descarte (10-1-5-3). */
export function limboToTrash(state: GameState, uid: string) {
  if (!inLimbo(state, uid)) return;
  leaveLimbo(state, uid);
  state.players[ownerOf(state, uid)].trash.push(uid);
}

/** Tira a carta de onde estiver (DON!! anexados voltam virados à área de custo). */
export function detach(state: GameState, uid: string) {
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
    forgetCard(state, uid);
    return;
  }
  for (const zone of [ps.hand, ps.deck, ps.trash, ps.life]) removeFrom(zone, uid);
  if (ps.lifeFaceUp?.includes(uid)) removeFrom(ps.lifeFaceUp, uid);
  leaveLimbo(state, uid);
}

export function drawCards(state: GameState, player: PlayerId, n: number) {
  const ps = state.players[player];
  for (let i = 0; i < n && ps.deck.length; i++) ps.hand.push(ps.deck.shift()!);
}

export function payDon(ps: PlayerState, n: number) {
  if (n > ps.donActive) throw new IllegalActionError('DON!! insuficientes.');
  ps.donActive -= n;
  ps.donRested += n;
}

/** Devolve `n` DON!! sem perguntar (virados, depois ativos, depois os dados às cartas). */
function returnDon(ps: PlayerState, n: number) {
  for (let i = 0; i < n; i++) {
    const src = donSources(ps)[0];
    if (!src) break;
    takeDon(ps, src);
  }
}

/** Origens dos DON!! no campo de `ps`: virados, ativos, Líder, Personagens e Stage (só as que têm DON!!). */
export function donSources(ps: PlayerState): DonSource[] {
  const out: DonSource[] = [];
  if (ps.donRested) out.push('rested');
  if (ps.donActive) out.push('active');
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) if (fc.don > 0) out.push(fc.uid);
  return out;
}

/** Devolve ao deck de DON!! um DON!! da origem `src`. */
export function takeDon(ps: PlayerState, src: DonSource) {
  if (src === 'rested') ps.donRested--;
  else if (src === 'active') ps.donActive--;
  else {
    const fc = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])].find((c) => c.uid === src);
    if (!fc || fc.don <= 0) return;
    fc.don--;
    if (fc.donLoose && fc.donLoose > fc.don) {
      if (fc.don) fc.donLoose = fc.don;
      else delete fc.donLoose;
    }
  }
  ps.donDeck++;
}

/** Texto da opção de devolver 1 DON!! da origem `src`. */
export function describeDonSource(state: GameState, ps: PlayerState, src: DonSource): string {
  if (src === 'rested') return `DON!! virado da área de custo (${ps.donRested})`;
  if (src === 'active') return `DON!! ativo da área de custo (${ps.donActive})`;
  const fc = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])].find((c) => c.uid === src)!;
  const name = cardDef(state, src).name;
  // Personagens com o mesmo nome ganham um número, na ordem do campo.
  const same = ps.characters.filter((c) => cardDef(state, c.uid).name === name);
  const tag = src === ps.leader.uid ? ' (Líder)' : same.length > 1 ? ` #${same.findIndex((c) => c.uid === src) + 1}` : '';
  return `DON!! dado a ${name}${tag} (${fc.don})`;
}

/** Resumo das origens dos DON!! devolvidos, para o log ("2 ativos, 1 de Shanks"). */
/** De onde saíram os DON!! devolvidos ("2 virados, 1 de Nami"), uma peça por origem. */
export function summarizeDonSources(state: GameState, picked: DonSource[]): Prompt[] {
  const counts = new Map<DonSource, number>();
  for (const src of picked) counts.set(src, (counts.get(src) ?? 0) + 1);
  return [...counts].map(([src, n]) =>
    src === 'rested'
      ? lg('donFromRested', `${n} virado${n > 1 ? 's' : ''}`, { n })
      : src === 'active'
        ? lg('donFromActive', `${n} ativo${n > 1 ? 's' : ''}`, { n })
        : lg('donFromCard', `${n} de ${cardDef(state, src).name}`, { n, card: cardDef(state, src).name }),
  );
}

/** Tira a carta do topo (ou do fundo) da Vida; se estava virada para cima, deixa de estar. */
export function takeLife(ps: PlayerState, fromBottom = false): string {
  const uid = fromBottom ? ps.life.shift()! : ps.life.pop()!;
  if (ps.lifeFaceUp?.includes(uid)) removeFrom(ps.lifeFaceUp, uid);
  return uid;
}

/** Carta de Vida indo para a mão (ou para o fundo do deck, se estiver virada para cima e o Líder mandar). */
export function lifeToHandCard(state: GameState, player: PlayerId, uid: string) {
  const ps = state.players[player];
  const faceUp = ps.lifeFaceUp?.includes(uid);
  if (faceUp) removeFrom(ps.lifeFaceUp!, uid);
  if (faceUp && leaderRule(state, player, 'faceUpLifeToDeck')) {
    ps.deck.push(uid);
    log(state, player, lg('faceUpLifeToBottom', `${cardDef(state, uid).name} (Vida virada para cima) vai para o fundo do deck.`, { card: cardDef(state, uid).name }), { cards: [uid] });
  } else {
    ps.hand.push(uid);
    emit(state, { kind: 'lifeToHand', player, card: uid });
  }
}

/** Uma carta saiu da Vida de `player` (dispara "When a card is removed from … Life cards" e "becomes 0"). */
export function lifeRemoved(state: GameState, player: PlayerId, reachedZero = state.players[player].life.length === 0) {
  if (!(state.lifeRemovedThisTurn ?? []).includes(player)) (state.lifeRemovedThisTurn ??= []).push(player);
  emit(state, { kind: 'lifeRemoved', player });
  if (reachedZero) emit(state, { kind: 'lifeZero', player });
}

export function removeFrom(arr: string[], uid: string) {
  const i = arr.indexOf(uid);
  if (i >= 0) arr.splice(i, 1);
}
