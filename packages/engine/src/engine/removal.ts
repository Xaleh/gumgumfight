// K.O. e remoção do campo: proteções, efeitos de substituição ("instead") e a saída da carta.

import type { AbilityCost, GameState, PlayerId, RemovalStep, Replacement } from '../types';
import { lg, log } from './messages';
import { isMultiplayer, opponent, turnOrder } from './table';
import { aurasOn, cardDef, hasAttribute, hasAttributeOn, locate, ownerOf } from './queries';
import { conditionsMet } from './conditions';
import { abilitySteps, forgetCard, targetCandidates, usedKey } from './options';
import { pushEffect } from './stack';
import { emit, queueTriggered, TIMING_TAG } from './triggers';
import { costAsksOwner } from './costs';
import { detach } from './zones';

type RemovalAction = RemovalStep['action'];
/** Contexto da remoção: causa (batalha / efeito de quem) e, na Vida, topo ou fundo. */
type RemovalCtx = Omit<RemovalStep, 'victims' | 'action' | 'skip'>;

export const removalCtx = (step: RemovalStep): RemovalCtx => ({
  ...(step.inBattle ? { inBattle: true } : {}),
  ...(step.byPlayer !== undefined ? { byPlayer: step.byPlayer } : {}),
  ...(step.by ? { by: step.by } : {}),
  ...(step.bottom ? { bottom: true } : {}),
  ...(step.faceUp ? { faceUp: true } : {}),
});

/** A substituição `r` vale para esta remoção (evento e causa)? */
function replacementMatches(r: Replacement, action: RemovalAction, owner: PlayerId, ctx: RemovalCtx): boolean {
  const inBattle = Boolean(ctx.inBattle);
  const byOpponentEffect = !inBattle && ctx.byPlayer !== undefined && ctx.byPlayer !== owner;
  // "by your opponent" (sem "'s effect"): o K.O. em batalha (só o defensor sai, pelo ataque do oponente) e os efeitos dele.
  const byOpponent = inBattle || byOpponentEffect;
  const cause = (by: Replacement['by']) =>
    by === 'any' || (by === 'battle' ? inBattle : by === 'effect' ? !inBattle : by === 'opponent' ? byOpponent : byOpponentEffect);
  // "would be K.O.'d": só K.O.
  if (r.event !== 'removal' && action === 'ko' && cause(r.by)) return true;
  // "would be removed from the field" / "would leave the field": qualquer saída do campo (o K.O. também),
  // inclusive por efeito próprio quando o texto não diz "by your opponentOf(state, 's effect)".
  return r.event !== 'ko' && cause(r.event === 'koOrRemoval' ? (r.removalBy ?? r.by) : r.by);
}

/** Uma substituição aplicável: quem a oferece e quais das vítimas ela salva. */
interface ReplacementOffer {
  source: string;
  ability: number;
  key: string;
  covered: string[];
  inlineCost?: AbilityCost;
}

/**
 * Próxima substituição a oferecer para as remoções simultâneas `victims`, na ordem de 8-1-3-4-2:
 * primeiro as do jogador do turno, depois as do outro (cada jogador só substitui a saída dos seus
 * Personagens); de cada jogador, primeiro as das próprias cartas afetadas, depois Líder → Personagens
 * → Stage → as criadas por efeito ("during this turn"). As de `skip` já foram oferecidas. Uma oferta
 * cobre todas as vítimas a que se aplica (um pagamento salva todas, Q&A OP15-009, OP11-001, OP05-001).
 */
function nextReplacement(state: GameState, victims: string[], action: RemovalAction, ctx: RemovalCtx, skip: string[]): ReplacementOffer | null {
  for (const pid of isMultiplayer(state) ? turnOrder(state, state.activePlayer) : [state.activePlayer, opponent(state.activePlayer)]) {
    const owner = state.players[pid];
    const mine = victims.filter((u) => owner.characters.some((c) => c.uid === u));
    if (!mine.length) continue;
    const sources = [
      ...mine,
      owner.leader.uid,
      ...owner.characters.map((c) => c.uid).filter((u) => !mine.includes(u)),
      ...(owner.stage ? [owner.stage.uid] : []),
    ];
    for (const src of sources) {
      const abilities = cardDef(state, src).abilities;
      for (let i = 0; i < abilities.length; i++) {
        const a = abilities[i];
        const r = a.replace;
        if (a.timing !== 'replace' || !r || r.event === 'rest' || r.event === 'damage') continue;
        if (skip.includes(usedKey(src, i))) continue;
        if (!replacementMatches(r, action, pid, ctx)) continue;
        const covered = mine.filter((v) => (r.who === 'self' ? src === v : targetCandidates(state, pid, src, { ...r.who, side: 'own' }).includes(v)));
        if (!covered.length) continue;
        if (!conditionsMet(state, src, a)) continue;
        if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(src, i))) continue;
        if (a.cost && !costAsksOwner(state, pid, src, a.cost)) continue;
        return { source: src, ability: i, key: usedKey(src, i), covered };
      }
    }
    // "If any of your Characters would be K.O.'d in battle during this turn, you may … instead."
    const temps = state.tempReplacements ?? [];
    for (let k = 0; k < temps.length; k++) {
      const t = temps[k];
      if (t.player !== pid || action !== 'ko' || (t.by === 'battle' && !ctx.inBattle) || skip.includes(`temp:${k}`)) continue;
      if (!costAsksOwner(state, pid, t.source, t.cost)) continue;
      return { source: t.source, ability: -1, key: `temp:${k}`, covered: mine, inlineCost: t.cost };
    }
  }
  return null;
}

/**
 * Efeito de substituição disponível para os Personagens que vão sair do campo juntos? Se houver,
 * empilha a pergunta ("pagar … em vez disso?") e devolve true: a remoção fica para depois das
 * respostas. Recusada uma, a próxima é oferecida (8-1-3-4-2).
 */
function offerReplacement(state: GameState, victims: string[], action: RemovalAction, ctx: RemovalCtx, skip: string[] = []): boolean {
  const live = victims.filter((u) => locate(state, u)?.zone === 'character');
  const offer = live.length ? nextReplacement(state, live, action, ctx, skip) : null;
  if (!offer) return false;
  const owner = ownerOf(state, offer.covered[0]);
  pushEffect(state, offer.source, owner, [
    {
      do: 'replaceRemoval',
      victims: live,
      covered: offer.covered,
      ability: offer.ability,
      key: offer.key,
      action,
      ...ctx,
      skip,
      ...(offer.inlineCost ? { inlineCost: offer.inlineCost } : {}),
    },
  ]);
  return true;
}

/** Oferece as substituições que faltam ou, sem nenhuma, tira os Personagens do campo. */
export function continueRemoval(state: GameState, victims: string[], action: RemovalAction, ctx: RemovalCtx, skip: string[]) {
  if (offerReplacement(state, victims, action, ctx, skip)) return;
  for (const uid of victims) performRemoval(state, uid, action, ctx);
}

/**
 * Personagens que saem do campo juntos por efeito ("K.O. all …", "return up to 2 …"): tira os que
 * estão protegidos, oferece as substituições (cada uma uma vez para todos) e remove o resto.
 */
export function removeFromField(state: GameState, victims: string[], action: RemovalAction, ctx: RemovalCtx) {
  const live = victims.filter((uid) => {
    const loc = locate(state, uid);
    if (loc?.zone !== 'character') return false;
    if (action === 'ko' && koProtected(state, uid, Boolean(ctx.inBattle), ctx.by, ctx.byPlayer)) {
      log(state, loc.player, lg('cannotBeKod', `${cardDef(state, uid).name} não pode ser nocauteado.`, { card: cardDef(state, uid).name }), { cards: [uid] });
      return false;
    }
    if (!ctx.inBattle && removalBlocked(state, uid, ctx.byPlayer)) {
      log(state, ctx.byPlayer ?? loc.player, lg('cannotBeRemoved', `${cardDef(state, uid).name} não pode ser removido do campo.`, { card: cardDef(state, uid).name }), { cards: [uid] });
      return false;
    }
    return true;
  });
  continueRemoval(state, live, action, ctx, []);
}

/** Procura "If you would take damage, you may … instead" no campo do defensor e pergunta. */
export function offerDamageReplacement(state: GameState, defender: PlayerId): boolean {
  const owner = state.players[defender];
  for (const fc of [owner.leader, ...owner.characters, ...(owner.stage ? [owner.stage] : [])]) {
    const abilities = cardDef(state, fc.uid).abilities;
    for (let i = 0; i < abilities.length; i++) {
      const a = abilities[i];
      if (a.timing !== 'replace' || a.replace?.event !== 'damage') continue;
      if (!conditionsMet(state, fc.uid, a)) continue;
      if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(fc.uid, i))) continue;
      if (a.cost && !costAsksOwner(state, owner.id, fc.uid, a.cost)) continue;
      pushEffect(state, fc.uid, owner.id, [{ do: 'replaceDamage', ability: i }]);
      return true;
    }
  }
  return false;
}

/** Executa a remoção (sem substituição: nenhuma se aplicou ou todas foram recusadas). */
function performRemoval(state: GameState, victim: string, action: RemovalAction, ctx: RemovalCtx) {
  const loc = locate(state, victim);
  if (loc?.zone !== 'character') return;
  if (action === 'ko') {
    koCharacter(state, victim, { ...ctx, noReplace: true });
    return;
  }
  const owner = state.players[loc.player];
  detach(state, victim);
  const name = cardDef(state, victim).name;
  if (action === 'hand') {
    owner.hand.push(victim);
    log(state, ctx.byPlayer ?? null, lg('returnsToHand', `${name} volta para a mão.`, { card: name }), { cards: [victim] });
  } else if (action === 'deckBottom') {
    owner.deck.push(victim);
    log(state, ctx.byPlayer ?? null, lg('toOwnerDeckBottom', `${name} vai para o fundo do deck de ${owner.name}.`, { card: name, player: owner.name }), { cards: [victim] });
  } else if (action === 'trash') {
    owner.trash.push(victim);
    log(state, ctx.byPlayer ?? null, lg('goesToTrash', `${name} vai para o descarte.`, { card: name }), { cards: [victim] });
  } else {
    if (ctx.bottom) owner.life.unshift(victim);
    else owner.life.push(victim);
    // "face-up": a carta fica pública na Vida (3-10-2-1).
    if (ctx.faceUp) (owner.lifeFaceUp ??= []).push(victim);
    log(
      state,
      ctx.byPlayer ?? null,
      lg(
        `toOwnerLife${ctx.bottom ? 'Bottom' : 'Top'}${ctx.faceUp ? 'FaceUp' : ''}`,
        `${name} vai para o ${ctx.bottom ? 'fundo' : 'topo'} da Vida de ${owner.name}${ctx.faceUp ? ', virada para cima' : ''}.`,
        { card: name, player: owner.name },
      ),
      { cards: [victim] },
    );
  }
  emit(state, { kind: 'characterRemoved', player: owner.id, card: victim, byPlayer: ctx.byPlayer });
  if (action === 'hand') emit(state, { kind: 'returnedToHand', player: owner.id, card: victim, byPlayer: ctx.byPlayer });
}

/** "cannot be removed from the field by your opponent's effects": o efeito de `byPlayer` não tira a carta do campo? */
export function removalBlocked(state: GameState, uid: string, byPlayer: PlayerId | undefined): boolean {
  const loc = locate(state, uid);
  if (!loc || byPlayer === undefined || byPlayer === loc.player) return false;
  if (cardDef(state, uid).abilities.some((a) => a.timing === 'static' && a.staticNoRemoval && conditionsMet(state, uid, a))) return true;
  return loc.zone !== 'stage' && aurasOn(state, uid, loc.zone, (au) => Boolean(au.noRemoval)).length > 0;
}

/**
 * O personagem (ou Stage) está protegido de K.O. ("cannot be K.O.'d [in battle | by effects]")?
 * `byPlayer` é o dono do efeito que nocauteia: "by your opponent's effects" só protege contra o
 * oponente; o K.O. pelo próprio efeito (ou custo) continua valendo (1-3-1).
 */
export function koProtected(state: GameState, uid: string, inBattle: boolean, by?: string, byPlayer?: PlayerId): boolean {
  const byOpponent = !inBattle && byPlayer !== undefined && byPlayer !== ownerOf(state, uid);
  /** Proteção contra K.O. por efeito: `true` vale contra todos; `'opponent'`, só contra o oponente. */
  const effectKO = (v: true | 'opponent' | undefined) => !inBattle && (v === true || (v === 'opponent' && byOpponent));
  const kinds = inBattle ? ['cannotBeKO', 'cannotBeKOInBattle'] : ['cannotBeKO', 'cannotBeKOByEffect', ...(byOpponent ? ['cannotBeKOByOpponentEffect'] : [])];
  if (state.modifiers.some((m) => m.uid === uid && kinds.includes(m.kind))) return true;
  const zone = locate(state, uid)?.zone;
  if (!inBattle && zone && zone !== 'stage' && aurasOn(state, uid, zone, (au) => effectKO(au.noEffectKO)).length) return true;
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
      ((inBattle ? a.staticNoBattleKO : effectKO(a.staticNoEffectKO)) ||
        (inBattle && a.noBattleKOVsAttribute !== undefined && by !== undefined && hasAttribute(cardDef(state, by), a.noBattleKOVsAttribute) && (!a.noBattleKOVsAttributeCharacters || byChar)) ||
        (inBattle && a.noBattleKOByLeader && by !== undefined && locate(state, by)?.zone === 'leader') ||
        // "by Characters without the "Special" attribute": o Líder (qualquer atributo) ainda nocauteia.
        (inBattle && a.noBattleKOUnlessAttribute !== undefined && byChar && !hasAttributeOn(state, by!, a.noBattleKOUnlessAttribute))) &&
      conditionsMet(state, uid, a),
  );
}

export function koCharacter(
  state: GameState,
  uid: string,
  opts: { inBattle?: boolean; force?: boolean; by?: string; byPlayer?: PlayerId; noReplace?: boolean } = {},
) {
  const loc = locate(state, uid);
  if (!loc || loc.zone !== 'character') return;
  if (!opts.force && koProtected(state, uid, Boolean(opts.inBattle), opts.by, opts.byPlayer)) {
    log(state, loc.player, lg('cannotBeKod', `${cardDef(state, uid).name} não pode ser nocauteado.`, { card: cardDef(state, uid).name }), { cards: [uid] });
    return;
  }
  if (!opts.force && !opts.inBattle && removalBlocked(state, uid, opts.byPlayer)) {
    log(state, loc.player, lg('cannotBeRemoved', `${cardDef(state, uid).name} não pode ser removido do campo.`, { card: cardDef(state, uid).name }), { cards: [uid] });
    return;
  }
  if (!opts.force && !opts.noReplace) {
    const ctx: RemovalCtx = {
      ...(opts.inBattle ? { inBattle: true } : {}),
      ...(opts.byPlayer !== undefined ? { byPlayer: opts.byPlayer } : {}),
      ...(opts.by ? { by: opts.by } : {}),
    };
    if (offerReplacement(state, [uid], 'ko', ctx)) return;
  }
  // [On K.O.]: as condições são checadas no campo, antes de a carta sair (10-2-17-1): DON!! dados,
  // [Your Turn]/[Opponent's Turn], condição, negação (8-2-1-1) e [Once Per Turn]. O efeito resolve
  // depois, com a carta já no trash.
  const def = cardDef(state, uid);
  const byEffect = !opts.inBattle && opts.byPlayer !== undefined;
  const onKO: number[] = [];
  let lapsed = false;
  def.abilities.forEach((a, i) => {
    if (a.timing !== 'onKO') return;
    if (a.koBy && !(byEffect && (a.koBy === 'effect' || opts.byPlayer !== loc.player))) return;
    if (conditionsMet(state, uid, a) && !(a.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, i)))) onKO.push(i);
    else lapsed = true;
  });
  const ps = state.players[loc.player];
  ps.donRested += loc.fc.don;
  removeCharacter(state, uid);
  ps.trash.push(uid);
  log(state, loc.player, lg('kod', `${def.name} foi nocauteado (K.O.).`, { card: def.name }), { cards: [uid] });
  if (lapsed) {
    log(
      state,
      loc.player,
      lg('onKoConditionFails', `${def.name} ${TIMING_TAG.onKO}: a condição não vale, o efeito não é ativado.`, { card: def.name, tag: TIMING_TAG.onKO! }, {
        tag: { items: [{ key: 'log.tag.onKO' }] },
      }),
      { cards: [uid] },
    );
  }
  (state.koThisTurn ??= []).push(loc.player);
  emit(state, { kind: 'characterKO', player: loc.player, card: uid });
  if (opts.inBattle || opts.byPlayer !== undefined) {
    emit(state, { kind: 'characterRemoved', player: loc.player, card: uid, byPlayer: opts.byPlayer, inBattle: opts.inBattle });
  }
  // O uso marcado aqui é da carta no trash (removeCharacter já esqueceu os do campo); se ela voltar
  // ao campo neste turno, entra como carta nova e o uso é esquecido de novo (forgetCard).
  for (const i of onKO) {
    const a = def.abilities[i];
    const opt = a.oncePerTurn ? usedKey(uid, i) : undefined;
    if (opt) state.usedThisTurn.push(opt);
    queueTriggered(state, uid, loc.player, abilitySteps(a, i), { timing: 'onKO', ability: i, offField: true, ...(opt ? { opt } : {}) });
  }
}

/**
 * K.O. de um Stage por efeito (10-2-1): passa pelas mesmas proteções do Personagem ("cannot be
 * K.O.'d [by your opponent's effects]", "cannot be removed from the field by your opponent's
 * effects") e vai para o descarte. Não há substituição nem evento de Stage nocauteado (nenhuma
 * carta pede); os de Personagem ("When a Character is K.O.'d", [On K.O.]) não valem para ele.
 */
export function koStage(state: GameState, uid: string, ctx: { byPlayer: PlayerId; by: string }) {
  const loc = locate(state, uid);
  if (loc?.zone !== 'stage') return;
  const name = cardDef(state, uid).name;
  if (koProtected(state, uid, false, ctx.by, ctx.byPlayer)) {
    log(state, loc.player, lg('stageCannotBeKod', `${name} (Stage) não pode ser nocauteado.`, { card: name }), { cards: [uid] });
    return;
  }
  if (removalBlocked(state, uid, ctx.byPlayer)) {
    log(state, loc.player, lg('stageCannotBeRemoved', `${name} (Stage) não pode ser removido do campo.`, { card: name }), { cards: [uid] });
    return;
  }
  detach(state, uid);
  state.players[loc.player].trash.push(uid);
  log(state, ctx.byPlayer, lg('stageKod', `${name} (Stage) foi nocauteado.`, { card: name }), { cards: [uid] });
}

/** Tira o Personagem do campo: perde os modificadores e os usos do turno (é uma carta nova, 3-1-6). */
export function removeCharacter(state: GameState, uid: string) {
  for (const ps of state.players) ps.characters = ps.characters.filter((c) => c.uid !== uid);
  state.modifiers = state.modifiers.filter((m) => m.uid !== uid);
  forgetCard(state, uid);
}
