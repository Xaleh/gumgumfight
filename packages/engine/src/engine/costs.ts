// Custos de habilidade: se dá para pagar, a pergunta "pagar?", o pagamento e o texto do custo.

import type { AbilityCost, EffectStep, GameState, MsgParts, PlayerId, PromptParams, TargetSpec } from '../types';
import { lg, log, msgOf, pr, type Prompt, promptOf } from './messages';
import { opponentSides } from './table';
import { cardDef, getCost, locate, matchesFilter } from './queries';
import { discardable, handDef, playBlocked, restricted, targetCandidates, totalDonOnField } from './options';
import { addModifier } from './effects';
import { koProtected } from './removal';
import { cannotBeRested, faceDownLife, lifeEnds, lifeTop, payDon, restCard } from './zones';

/** Parte `cost` de uma pergunta: as peças do custo, juntas por `engine.cost.join`. */
export function costPartsOf(cost: AbilityCost): MsgParts {
  return { cost: { items: costPieces(cost).map(msgOf), join: 'engine.cost.join' } };
}

/**
 * Paga a parte imediata de um custo (virar a carta, virar DON!!, DON!! −X) e devolve os passos
 * das partes que exigem escolha (descartar, virar Personagens, devolver cartas…).
 */
export function payImmediateCost(state: GameState, player: PlayerId, source: string, cost: AbilityCost): EffectStep[] {
  const ps = state.players[player];
  if (cost.restSelf && locate(state, source)) restCard(state, source);
  if (cost.restDon) payDon(ps, cost.restDon);
  const steps: EffectStep[] = [];
  if (cost.donMinus) {
    if (cost.donMinusOpen) {
      // "1 or more": a quantidade é escolhida no passo seguinte.
      steps.push({ do: 'returnDonChoice', min: cost.donMinus });
    } else {
      // O dono escolhe quais DON!! devolver (CR 10-2-10-1).
      steps.push({ do: 'returnDon', count: cost.donMinus, ...(cost.donMinusActive ? { activeOnly: true as const } : {}) });
    }
  }
  if (cost.trashFromHand) steps.push({ do: 'trashFromHand', count: cost.trashFromHand, filter: cost.trashFilter });
  if (cost.handToBottom) steps.push({ do: 'handToDeckBottom', count: cost.handToBottom });
  if (cost.restCharacters) steps.push({ do: 'restOwnCharacters', count: cost.restCharacters });
  if (cost.restOwn) steps.push({ do: 'restOwn', ...cost.restOwn });
  if (cost.returnOwn) steps.push({ do: 'returnOwn', ...cost.returnOwn });
  if (cost.lifeToHand) steps.push({ do: 'lifeToHand', count: cost.lifeToHand, choose: cost.lifeChoice });
  if (cost.lifeToTrash) steps.push({ do: 'lifeToTrash', ...cost.lifeToTrash });
  if (cost.lifeAll) steps.push(cost.lifeAll === 'hand' ? { do: 'lifeToHand', count: ps.life.length } : { do: 'lifeToTrash', count: ps.life.length });
  if (cost.lifeFace) steps.push({ do: 'lifeFace', ...cost.lifeFace });
  if (cost.mill) steps.push({ do: 'millDeck', count: cost.mill });
  if (cost.trashToBottom) steps.push({ do: 'trashToDeckBottom', ...cost.trashToBottom });
  if (cost.reveal) steps.push({ do: 'revealFromHand', ...cost.reveal });
  if (cost.returnSelf) steps.push({ do: 'returnSelfToHand' });
  if (cost.koSelf) steps.push({ do: 'koSelf' });
  if (cost.leaderPowerMinus) {
    addModifier(state, player, { uid: ps.leader.uid, kind: 'power', amount: -cost.leaderPowerMinus, duration: 'turn' });
    log(state, player, lg('leaderPowerCost', `${cardDef(state, ps.leader.uid).name} recebe −${cost.leaderPowerMinus} de poder (custo).`, { card: cardDef(state, ps.leader.uid).name, n: cost.leaderPowerMinus }), { cards: [ps.leader.uid] });
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
    steps.push({ do: 'rest', target: { side: 'opponent', kinds: ['character'], upTo: cost.restOpponentChars, rested: false, required: true } });
  }
  if (cost.selfPowerMinus) steps.push({ do: 'power', target: 'self', amount: -cost.selfPowerMinus, duration: 'turn' });
  if (cost.trashToDeck) steps.push({ do: 'trashToDeckBottom', count: cost.trashToDeck }, { do: 'shuffleDeck' });
  // Custo "You may play 1 [Kotori] from your hand" (OP05-111): jogar é obrigatório depois de aceitar.
  if (cost.playFromHand) steps.push({ do: 'playFrom', from: 'hand', upTo: 1, filter: cost.playFromHand, required: true });
  if (cost.giveOppDon) {
    steps.push({ do: 'giveRestedDon', target: { side: 'opponent', kinds: ['character'], upTo: 1, required: true }, count: cost.giveOppDon, fromOpponent: true });
  }
  if (cost.handToTop) steps.push({ do: 'handToDeck', count: cost.handToTop, where: 'top' });
  return steps;
}

/** O custo lê a mão do jogador (o oponente não sabe se dá para pagar)? */
function costReadsHand(cost: AbilityCost): boolean {
  return Boolean(cost.trashFromHand || cost.handToBottom || cost.handToTop || cost.playFromHand || cost.reveal || cost.either?.some(costReadsHand));
}

/**
 * O custo sem o que o oponente não consegue conferir: ficam a quantidade de cartas da mão
 * (o tamanho da mão é público) e o resto; saem os filtros sobre as cartas da mão.
 */
function publicCost(cost: AbilityCost): AbilityCost {
  const { trashFilter: _f, playFromHand, reveal, either, ...rest } = cost;
  const extra = (playFromHand ? 1 : 0) + (reveal?.count ?? 0);
  return {
    ...rest,
    ...(extra ? { handToBottom: (rest.handToBottom ?? 0) + extra } : {}),
    ...(either ? { either: either.map(publicCost) } : {}),
  };
}

/**
 * Uma pergunta "pagar X?" deve abrir? Sim quando dá para pagar; e também quando só a parte
 * do custo que lê a mão impede o pagamento (ex.: "descarte 1 carta {FILM} da mão" sem
 * {FILM} na mão): pular a pergunta contaria ao oponente o que há na mão. Nesse caso ela
 * abre só com a resposta "não" (`confirm` com `cannot`). Quando a parte pública já impede
 * (DON!!, campo, Vida, mão vazia), pular não conta nada.
 */
export function costAsksOwner(state: GameState, player: PlayerId, source: string, cost: AbilityCost): boolean {
  return canPayCost(state, player, source, cost) || (costReadsHand(cost) && canPayCost(state, player, source, publicCost(cost)));
}

/** `confirm` para pagar `cost` (ou só recusar, quando não dá para pagar). */
export function askPay(state: GameState, player: PlayerId, source: string, cost: AbilityCost | undefined, prompt: Prompt) {
  const cannot = Boolean(cost && !canPayCost(state, player, source, cost));
  // Com `cannot`, o texto ganha o aviso; a chave fica a da pergunta (a interface junta `engine.cannotPayCost`).
  state.pending = {
    kind: 'confirm',
    player,
    source,
    ...promptOf(prompt),
    prompt: cannot ? `${prompt.text} (Não dá para pagar o custo.)` : prompt.text,
    ...(cannot ? { cannot: true } : {}),
  };
}

export function canPayCost(state: GameState, player: PlayerId, source: string, cost: AbilityCost): boolean {
  const ps = state.players[player];
  if (cost.restSelf && (!locate(state, source) || locate(state, source)!.fc.rested || cannotBeRested(state, source))) return false;
  if ((cost.restDon ?? 0) > ps.donActive) return false;
  if ((cost.donMinus ?? 0) > totalDonOnField(ps)) return false;
  if (cost.donMinusActive && (cost.donMinus ?? 0) + (cost.restDon ?? 0) > ps.donActive) return false;
  if ((cost.trashFromHand ?? 0) > discardable(state, player, cost.trashFilter).length) return false;
  if ((cost.handToBottom ?? 0) > ps.hand.length) return false;
  if ((cost.lifeToHand ?? 0) > ps.life.length) return false;
  if (cost.lifeToHand && restricted(state, ps.id, 'noLifeToHand')) return false;
  if (cost.lifeAll && !ps.life.length) return false;
  if (cost.lifeAll === 'hand' && restricted(state, ps.id, 'noLifeToHand')) return false;
  if (cost.leaderPowerMinusActive && ps.leader.rested) return false;
  if (cost.giveDon && (ps.donActive < cost.giveDon.count || !targetCandidates(state, ps.id, source, { ...cost.giveDon.spec, side: 'own' }).length)) return false;
  if (cost.ownToBottom && targetCandidates(state, ps.id, source, { ...cost.ownToBottom.spec, side: cost.ownToBottom.spec.side === 'any' ? 'any' : 'own' }).length < cost.ownToBottom.count) {
    return false;
  }
  if (cost.ownToLife && targetCandidates(state, ps.id, source, { ...cost.ownToLife.spec, side: 'own' }).length < cost.ownToLife.count) return false;
  if (cost.either && !cost.either.some((c) => canPayCost(state, ps.id, source, c))) return false;
  if (cost.returnGivenDon && [ps.leader, ...ps.characters].reduce((n, c) => n + c.don, 0) < cost.returnGivenDon) return false;
  if ((cost.restCharacters ?? 0) > ps.characters.filter((c) => !c.rested && c.uid !== source && !cannotBeRested(state, c.uid)).length) return false;
  // A própria carta não paga duas partes do custo ("rest this card and 1 of your [Enel] cards").
  const selfPays = Boolean(cost.restSelf || cost.trashSelf || cost.koSelf || cost.returnSelf || cost.selfToBottom);
  const others = (list: string[]) => (selfPays ? list.filter((u) => u !== source) : list);
  if (cost.restOwn && others(restOwnOptions(state, player, source, cost.restOwn)).length + (cost.restOwn.withDon ? ps.donActive - (cost.restDon ?? 0) : 0) < cost.restOwn.count) {
    return false;
  }
  if (cost.returnOwn && others(ownCostOptions(state, player, source, cost.returnOwn.spec, false)).length < cost.returnOwn.count) {
    return false;
  }
  if ((cost.trashSelf || cost.selfToBottom) && locate(state, source)?.zone !== 'character' && locate(state, source)?.zone !== 'stage') return false;
  if (cost.returnSelf && locate(state, source)?.zone !== 'character') return false;
  if (cost.selfMinCost !== undefined && (!locate(state, source) || getCost(state, source) < cost.selfMinCost)) return false;
  if (
    cost.restOpponentChars &&
    // (Mesa com mais de dois, sem oponente definido: basta um oponente em que o custo caiba.)
    !opponentSides(state, player).some(
      (o) => state.players[o].characters.filter((c) => !c.rested && !cannotBeRested(state, c.uid)).length >= cost.restOpponentChars!,
    )
  ) {
    return false;
  }
  if ((cost.trashToDeck ?? 0) > ps.trash.length) return false;
  if (cost.playFromHand && !ps.hand.some((u) => matchesFilter(handDef(state, u, cost.playFromHand), cost.playFromHand!) && !playBlocked(state, player, cardDef(state, u)))) return false;
  if (cost.giveOppDon && !opponentSides(state, player).some((o) => state.players[o].donRested >= cost.giveOppDon! && state.players[o].characters.length > 0)) return false;
  if ((cost.handToTop ?? 0) > ps.hand.length) return false;
  if (cost.koSelf && (locate(state, source)?.zone !== 'character' || koProtected(state, source, false, source, player))) return false;
  if (cost.koOwn && others(koCostOptions(state, player, source, cost.koOwn.spec)).length < cost.koOwn.count) return false;
  if (cost.trashOwn && others(ownCostOptions(state, player, source, cost.trashOwn.spec, false)).length < cost.trashOwn.count) return false;
  if ((cost.mill ?? 0) > ps.deck.length) return false;
  if ((cost.lifeToTrash?.count ?? 0) > ps.life.length) return false;
  if (cost.trashToBottom && ps.trash.filter((u) => !cost.trashToBottom!.filter || matchesFilter(cardDef(state, u), cost.trashToBottom!.filter)).length < cost.trashToBottom.count) {
    return false;
  }
  if (cost.reveal && discardable(state, player, cost.reveal.filter).length < cost.reveal.count) return false;
  if (cost.lifeFace) {
    const avail = cost.lifeFace.topOrBottom
      ? lifeEnds(ps, cost.lifeFace.up).length
      : cost.lifeFace.fromTop
        ? lifeTop(ps, cost.lifeFace.count, cost.lifeFace.up).length
        : cost.lifeFace.up
        ? faceDownLife(ps).length
        : ps.life.filter((u) => ps.lifeFaceUp?.includes(u)).length;
    if (avail < cost.lifeFace.count) return false;
  }
  return true;
}

/**
 * Personagens seus que podem pagar um custo "K.O. N of your …": o protegido ("cannot be K.O.'d [by
 * effects]") não serve, a proibição vence a exigência (1-3-3). É o seu efeito que nocauteia, então
 * "by your opponent's effects" não protege.
 */
export function koCostOptions(state: GameState, player: PlayerId, source: string, spec: TargetSpec): string[] {
  return ownCostOptions(state, player, source, spec, false).filter((u) => !koProtected(state, u, false, source, player));
}

/** Cartas suas que podem pagar um custo de "rest/return N of your …". */
/** Cartas que podem ser viradas para pagar `restOwn` (a própria carta inclusive, ver `ownCostOptions`). */
export function restOwnOptions(state: GameState, player: PlayerId, source: string, cost: { spec: TargetSpec; withDon?: true }): string[] {
  return ownCostOptions(state, player, source, cost.spec, true);
}

/**
 * Cartas suas que pagam um custo ("return 1 of your Characters", "rest 1 of your cards"). A própria carta
 * vale (OP01-047 Law devolve a si mesmo); o texto diz quando não vale ("other than this Character", `excludeSelf`).
 */
export function ownCostOptions(state: GameState, player: PlayerId, source: string, spec: TargetSpec, needActive: boolean): string[] {
  return targetCandidates(state, player, source, { ...spec, side: 'own' }).filter(
    (u) => !needActive || (!locate(state, u)?.fc.rested && !cannotBeRested(state, u)),
  );
}

export function describeCost(cost: AbilityCost): string {
  return costPieces(cost)
    .map((p) => p.text)
    .join(' e ');
}

/** As peças de um custo, cada uma com o português e a chave `engine.cost.*` (juntas por " e "). */
function costPieces(cost: AbilityCost): Prompt[] {
  const parts: Prompt[] = [];
  const c = (key: string, text: string, params?: PromptParams) => parts.push(pr(`cost.${key}`, text, params));
  if (cost.donMinus) {
    const n = cost.donMinus;
    if (cost.donMinusActive) c('donMinusActive', `devolver ${n} DON!! ativo(s) ao deck de DON!!`, { n });
    else if (cost.donMinusOpen) c('donMinusOpen', `DON!! −${n} ou mais (devolver ${n} ou mais DON!! ao deck de DON!!)`, { n });
    else c('donMinus', `DON!! −${n} (devolver ${n} DON!! ao deck de DON!!)`, { n });
  }
  if (cost.restDon) c('restDon', `virar ${cost.restDon} DON!!`, { n: cost.restDon });
  if (cost.restSelf) c('restSelf', 'virar esta carta');
  if (cost.trashFromHand) c('trashFromHand', `descartar ${cost.trashFromHand} carta(s) da mão`, { n: cost.trashFromHand });
  if (cost.handToBottom) c('handToBottom', `colocar ${cost.handToBottom} carta(s) da mão no fundo do deck`, { n: cost.handToBottom });
  if (cost.lifeToHand) c('lifeToHand', `colocar ${cost.lifeToHand} carta(s) da Vida na mão`, { n: cost.lifeToHand });
  if (cost.restOwn) {
    const n = cost.restOwn.count;
    if (cost.restOwn.withDon) c('restOwnWithDon', `virar ${n} carta(s) sua(s) (DON!! incluídos)`, { n });
    else c('restOwn', `virar ${n} carta(s) sua(s)`, { n });
  }
  if (cost.returnOwn) c('returnOwn', `devolver ${cost.returnOwn.count} Personagem(ns) seu(s) à mão`, { n: cost.returnOwn.count });
  if (cost.trashSelf) c('trashSelf', 'descartar esta carta');
  if (cost.koSelf) c('koSelf', 'nocautear esta carta');
  if (cost.leaderPowerMinus) c('leaderPowerMinus', `dar −${cost.leaderPowerMinus} de poder ao seu Líder`, { n: cost.leaderPowerMinus });
  if (cost.giveDon) c('giveDon', `dar ${cost.giveDon.count} DON!! ativo(s)`, { n: cost.giveDon.count });
  if (cost.ownToBottom) {
    const n = cost.ownToBottom.count;
    if (cost.ownToBottom.spec.side === 'any') c('anyToBottom', `colocar ${n} carta(s) no fundo do deck do dono`, { n });
    else c('ownToBottom', `colocar ${n} carta(s) sua(s) no fundo do deck do dono`, { n });
  }
  if (cost.selfToBottom) c('selfToBottom', 'colocar esta carta no fundo do deck');
  if (cost.koOwn) c('koOwn', `nocautear ${cost.koOwn.count} Personagem(ns) seu(s)`, { n: cost.koOwn.count });
  if (cost.trashOwn) c('trashOwn', `descartar ${cost.trashOwn.count} Personagem(ns) seu(s)`, { n: cost.trashOwn.count });
  if (cost.returnSelf) c('returnSelf', 'devolver esta carta à mão');
  if (cost.mill) c('mill', `descartar ${cost.mill} carta(s) do topo do deck`, { n: cost.mill });
  if (cost.trashToBottom) c('trashToBottom', `colocar ${cost.trashToBottom.count} carta(s) do descarte no fundo do deck`, { n: cost.trashToBottom.count });
  if (cost.lifeToTrash) c('lifeToTrash', `descartar ${cost.lifeToTrash.count} carta(s) da Vida`, { n: cost.lifeToTrash.count });
  if (cost.lifeAll === 'hand') c('lifeAllToHand', 'colocar todas as cartas de Vida na mão');
  if (cost.lifeAll === 'trash') c('lifeAllToTrash', 'descartar todas as cartas de Vida');
  if (cost.reveal) c('reveal', `revelar ${cost.reveal.count} carta(s) da mão`, { n: cost.reveal.count });
  if (cost.lifeFace) {
    const n = cost.lifeFace.count;
    if (cost.lifeFace.up) c('lifeFaceUp', `virar ${n} carta(s) de Vida para cima`, { n });
    else c('lifeFaceDown', `virar ${n} carta(s) de Vida para baixo`, { n });
  }
  if (cost.restCharacters) c('restCharacters', `virar ${cost.restCharacters} Personagem(ns) seu(s)`, { n: cost.restCharacters });
  if (cost.restOpponentChars) c('restOpponentChars', `virar ${cost.restOpponentChars} Personagem(ns) do oponente`, { n: cost.restOpponentChars });
  if (cost.selfPowerMinus) c('selfPowerMinus', `dar −${cost.selfPowerMinus} de poder a esta carta`, { n: cost.selfPowerMinus });
  if (cost.trashToDeck) c('trashToDeck', `devolver ${cost.trashToDeck} carta(s) do descarte ao deck e embaralhar`, { n: cost.trashToDeck });
  if (cost.playFromHand) c('playFromHand', 'jogar 1 carta da mão');
  if (cost.giveOppDon) c('giveOppDon', `dar ${cost.giveOppDon} DON!! virado(s) do oponente a um Personagem dele`, { n: cost.giveOppDon });
  if (cost.handToTop) c('handToTop', `colocar ${cost.handToTop} carta(s) da mão no topo do deck`, { n: cost.handToTop });
  return parts;
}
