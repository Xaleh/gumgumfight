// Resolução de um efeito, um passo por vez: "cada oponente", alvos, perguntas ao jogador e os ajudantes dos passos.

import type { CardFilter, EffectStep, GameState, Modifier, MsgList, PlayerId, TargetRef, TargetSpec } from '../types';
import { FAR_TURN, type EffectFrame } from './constants';
import { lg, log, pr, type Prompt, promptOf } from './messages';
import { fixedOpponent, isMultiplayer, markProbeStep, opponentsOf, withOpponent } from './table';
import { cardDef, getCost, getPower, locate, matchesFilter, ownerOf } from './queries';
import { conditionHolds } from './conditions';
import { forgetCard, targetCandidates } from './options';
import { markRevealed } from './cancel';
import { setExpiry } from './turn';
import { pushEffect } from './stack';
import { pushAbilities } from './triggers';
import { execStep } from './exec-step';
import { detach, limboToTrash } from './zones';

export function stepEffect(state: GameState, frame: EffectFrame) {
  if (frame.i >= frame.steps.length) {
    state.stack.pop();
    if (frame.trigger) limboToTrash(state, frame.source);
    return;
  }
  let step = frame.steps[frame.i];
  if (isMultiplayer(state)) {
    // O passo mexe na mão, na Vida, nos DON!! ou no deck "do oponente": roda uma vez contra cada oponente,
    // na ordem dos turnos (cada cópia leva o oponente em `vs`).
    if (step.vs === undefined && eachOpponent(step) && fixedOpponent(state, frame.controller) === undefined) {
      const original = step;
      frame.steps.splice(frame.i, 1, ...opponentsOf(state, frame.controller).map((o) => ({ ...original, vs: o })));
      step = frame.steps[frame.i];
    }
    // O oponente da vez saiu da mesa antes de o passo chegar nele.
    if (step.vs !== undefined && state.players[step.vs].out) {
      frame.i++;
      frame.choice = undefined;
      frame.memo = undefined;
      return;
    }
  }
  const vs = step.vs;
  const at = frame.i;
  const length = frame.steps.length;
  const depth = state.stack.length;
  markProbeStep(state, frame, step);
  let done: boolean;
  try {
    done = vs !== undefined ? withOpponent(frame.controller, vs, () => execStep(state, frame, step)) : execStep(state, frame, step);
  } finally {
    markProbeStep(state, null);
  }
  if (vs !== undefined) {
    // O que o passo deixou para depois continua contra o mesmo oponente: os passos que ele inseriu
    // ("If they do not, …") e os efeitos que empilhou ("Your opponent chooses one").
    for (let k = at + 1; k < at + 1 + (frame.steps.length - length); k++) if (frame.steps[k].vs === undefined) frame.steps[k] = { ...frame.steps[k], vs };
    for (let k = depth; k < state.stack.length; k++) {
      const f = state.stack[k];
      if (f.kind === 'effect' && f.controller === frame.controller && f.focus === undefined) f.focus = vs;
    }
  }
  if (done) {
    frame.i++;
    frame.choice = undefined;
    frame.memo = undefined;
  }
}

/** Passos que agem sobre "o oponente" (a mão, a Vida, os DON!!, o deck dele) sem escolher um alvo em campo. */
const EACH_OPPONENT_STEPS = new Set<EffectStep['do']>([
  'opponentDiscards',
  'trashRandomFromOpponentHand',
  'opponentTrashToBottom',
  'revealOpponentTop',
  'revealOpponentHand',
  'lookOpponentTop',
  'opponentLifeToBottom',
  'opponentLifeToHand',
  'opponentHandToBottom',
  'opponentMay',
  'opponentPlays',
  'opponentAddDon',
  'opponentDraws',
  'opponentChoosesOwn',
  'opponentReturnsDon',
]);

/**
 * Mesa com mais de dois: o passo vale para cada oponente? Segue o texto da carta, como o manual. "Your
 * opponent returns/adds/may return … DON!!" é o oponente fazendo algo, como "your opponent returns all cards
 * in their hand" (Pudding): vale para cada um. Já "rest up to N of your opponent's DON!! cards" é escrito como
 * um alvo: um DON!! de um oponente, escolhido por quem usa o efeito (`donTargetOpponent`). E o que é "effects
 * that interact with an opponent's hand/life": "trash up to 1 card from the top of your opponent's Life
 * cards" tira 1 Vida de cada oponente; "Your opponent chooses one" pergunta a cada um; "If your
 * opponent has 7 or more cards in their hand, trash 2…" só atinge quem tem 7 ou mais (a condição do
 * passo é conferida contra cada um). Não entram aqui os passos com alvo em campo ("up to 1 of your
 * opponent's Characters": um alvo, de qualquer oponente) nem os que só olham o oponente numa condição.
 */
export function eachOpponent(step: EffectStep): boolean {
  if (EACH_OPPONENT_STEPS.has(step.do)) return true;
  switch (step.do) {
    case 'returnDon':
    case 'takeDamage':
    case 'restrict':
      return Boolean(step.opponent);
    case 'trashLife':
      return step.side === 'opponent';
    case 'arrangeLife':
      return step.whose === 'opponent';
    case 'peekLife':
      return step.whose !== 'own';
    case 'handAllToDeck':
    case 'negateOnPlay':
      return step.who === 'opponent';
    case 'trashHandUntil':
      return Boolean(step.both);
    case 'basePower':
      return step.copy === 'opponentLeader';
    // "your opponent rests 1 of their active DON!! cards at the start of their next Main Phase": o oponente faz.
    // Já "up to 1 of your opponent's rested DON!! cards will not become active" é um alvo (`donTargetOpponent`).
    case 'skipRefreshDon':
      return Boolean(step.atMainPhase);
    case 'chooseOne':
      return step.chooser === 'opponent';
    default:
      return false;
  }
}

/** Resolve alvos. Retorna null quando o motor precisa esperar uma escolha. */
export function resolveTargets(
  state: GameState,
  frame: EffectFrame,
  ref: TargetRef,
  intent: 'harm' | 'help',
  prompt: Prompt,
): string[] | null {
  if (ref === 'self') return (frame.last = locate(state, frame.source) ? [frame.source] : []);
  if (ref === 'ownLeader') return (frame.last = [state.players[frame.controller].leader.uid]);
  if (ref === 'battleTarget') {
    return (frame.last = state.battle && locate(state, state.battle.target) ? [state.battle.target] : []);
  }
  if (ref === 'chosen') return (frame.last ?? []).filter((u) => locate(state, u));
  const last = frame.last ?? [];
  const options = targetCandidates(state, frame.controller, frame.source, ref).filter((u) => !ref.notLast || !last.includes(u));
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
    min: requiredTargets(state, ref, options),
    max: Math.min(ref.upTo, options.length),
    ...promptOf(prompt),
    intent,
    source: frame.source,
  };
  return null;
}

/**
 * Mínimo de alvos de uma escolha. Com "up to" é 0; sem "up to" (`required`) o jogador escolhe o
 * máximo possível até o número pedido (8-4-4-1). Com soma máxima de poder/custo ("with a total
 * power of N or less"), o máximo possível é quantas das menores cabem no total.
 */
function requiredTargets(state: GameState, ref: TargetSpec, options: string[]): number {
  if (!ref.required) return 0;
  const n = Math.min(ref.upTo, options.length);
  if (ref.totalMaxPower === undefined && ref.totalMaxCost === undefined) return n;
  const key = (u: string) => (ref.totalMaxPower !== undefined ? getPower(state, u) : getCost(state, u));
  let pw = 0;
  let co = 0;
  let k = 0;
  for (const u of [...options].sort((a, b) => key(a) - key(b))) {
    if (k >= n) break;
    pw += getPower(state, u);
    co += getCost(state, u);
    if ((ref.totalMaxPower !== undefined && pw > ref.totalMaxPower) || (ref.totalMaxCost !== undefined && co > ref.totalMaxCost)) break;
    k++;
  }
  return k;
}

/**
 * "Then, if that Character has 5000 power or less, K.O. it": em campo valem o poder e o custo atuais
 * (OP06-074, OP09-098, OP04-047); revelada do deck ou da Vida, os impressos.
 */
function chosenMatches(state: GameState, card: string, filter: CardFilter): boolean {
  const zone = locate(state, card)?.zone;
  if (zone !== 'character' && zone !== 'leader') return matchesFilter(cardDef(state, card), filter);
  const { maxPower, minPower, maxCost, minCost, ...rest } = filter;
  const power = getPower(state, card);
  const cost = getCost(state, card);
  if (maxPower !== undefined && power > maxPower) return false;
  if (minPower !== undefined && power < minPower) return false;
  if (maxCost !== undefined && cost > maxCost) return false;
  if (minCost !== undefined && cost < minCost) return false;
  return matchesFilter(cardDef(state, card), rest);
}

export function stepConditionMet(state: GameState, frame: EffectFrame, step: EffectStep): boolean {
  if (step.if?.lastDone && !frame.last?.length) return false;
  if (step.if?.searchMissed && frame.searched) return false;
  if (step.if?.lastKOd && !(frame.koTargets ?? []).some((u) => state.players[ownerOf(state, u)].trash.includes(u))) return false;
  if (step.if?.revealedHasChosenCost) {
    const card = frame.last?.[0];
    if (!card || frame.chosenCost === undefined || (cardDef(state, card).cost ?? 0) !== frame.chosenCost) return false;
  }
  const filter = step.if?.chosenMatches;
  if (filter) {
    const card = frame.last?.[0];
    if (!card || !chosenMatches(state, card, filter)) return false;
  }
  return conditionHolds(state, frame.controller, frame.source, step.if);
}

/**
 * Pede ao controlador do efeito que escolha cartas fora do campo (deck, descarte...).
 * `hidden`: as opções vêm de uma zona que o oponente não vê (ex.: "da mão", "do deck"); a
 * escolha abre mesmo sem opção, com o aviso de que nada pode ser escolhido.
 */
export function askCards(
  state: GameState,
  frame: EffectFrame,
  options: string[],
  max: number,
  prompt: Prompt,
  extra: { min?: number; intent?: 'help' | 'harm' | 'discard'; ordered?: boolean; hidden?: string } = {},
) {
  const none = extra.hidden && !options.length;
  const noneKey =
    extra.hidden === 'da mão'
      ? 'noneFromHand'
      : extra.hidden === 'do deck'
        ? 'noneFromDeck'
        : extra.hidden === 'do deck ou do descarte'
          ? 'noneFromDeckOrTrash'
          : 'noneFromHandOrTrash';
  // Olhar o deck (ou outra zona que o próprio jogador não vê) é informação ganha mesmo sem carta
  // à mostra ("não tem X no deck"): a ação deixa de ser cancelável. A própria mão ele já via.
  if (extra.hidden && extra.hidden !== 'da mão') markRevealed(state);
  state.pending = {
    kind: 'selectTargets',
    player: frame.controller,
    options,
    min: Math.min(extra.min ?? 0, options.length),
    max: Math.min(max, options.length),
    ...promptOf(
      none
        ? pr(noneKey, `${cardDef(state, frame.source).name}: nenhuma carta ${extra.hidden} pode ser escolhida.`, { source: cardDef(state, frame.source).name })
        : prompt,
    ),
    intent: extra.intent ?? 'help',
    source: frame.source,
    ...(extra.ordered ? { ordered: true } : {}),
    ...(extra.hidden ? { hidden: true } : {}),
  };
}

/**
 * Quantidade de um passo "up to N" sem alvo ("Trash up to 1 card from the top of your opponent's Life
 * cards"): pergunta de 0 a N (null = esperando a resposta); sem "up to", N (limitado ao disponível).
 */
export function upToCount(state: GameState, frame: EffectFrame, step: { count: number; upTo?: true }, available: number, prompt: Prompt): number | null {
  const max = Math.min(step.count, available);
  if (!step.upTo || max === 0) return max;
  // Do máximo para 0 (a primeira opção é o efeito completo).
  if (!frame.choice) {
    askOption(state, frame, frame.controller, prompt, Array.from({ length: max + 1 }, (_, i) => String(max - i)));
    return null;
  }
  return Math.max(0, max - Number(frame.choice[0]));
}

/**
 * "During the turn in which a card in your hand is trashed by an effect" (ST33-004): qualquer efeito,
 * também o do oponente que faz você descartar.
 */
export function markHandTrashed(state: GameState, player: PlayerId) {
  if (!(state.handTrashedThisTurn ?? []).includes(player)) (state.handTrashedThisTurn ??= []).push(player);
}

/** Coloca em campo uma carta (de qualquer zona), sem pagar o custo. */
export function playFree(state: GameState, uid: string, rested = false, source?: string, notFromHand = false) {
  const def = cardDef(state, uid);
  const ps = state.players[ownerOf(state, uid)];
  // A carta do [Trigger] ("Play this card") vem de fora das áreas, não do descarte (10-1-5-3).
  const from = ps.trash.includes(uid) ? 'trash' : undefined;
  if (def.category === 'character') {
    // "When you play a Character … from your hand" / "… using a Character's effect"
    const fromHand = !notFromHand && ps.hand.includes(uid);
    const byCharacterEffect = source !== undefined && cardDef(state, source).category === 'character';
    detach(state, uid);
    log(state, ps.id, lg('entersField', `${def.name} entra em campo.`, { card: def.name }), { cards: [uid] });
    state.stack.push({
      kind: 'play',
      uid,
      byEffect: true,
      ...(rested ? { rested: true } : {}),
      ...(from ? { from } : {}),
      ...(fromHand ? { fromHand: true } : {}),
      ...(byCharacterEffect ? { byCharacterEffect: true } : {}),
    });
  } else if (def.category === 'stage') {
    detach(state, uid);
    if (ps.stage) {
      const old = ps.stage.uid;
      detach(state, old);
      ps.trash.push(old);
    }
    forgetCard(state, uid);
    ps.stage = { uid, rested, don: 0, playedOnTurn: state.turn };
    log(state, ps.id, lg('entersField', `${def.name} entra em campo.`, { card: def.name }), { cards: [uid] });
    pushAbilities(state, uid, 'onPlay');
  }
}

/** Resolve os passos de outro efeito da própria carta ("Activate this card's [Main] effect"). */
export function useOwnEffect(state: GameState, frame: EffectFrame, timing: 'main' | 'counter' | 'onPlay' | 'onKO'): false {
  const ability = cardDef(state, frame.source).abilities.find((a) => a.timing === timing);
  frame.i++;
  frame.choice = undefined;
  frame.memo = undefined;
  if (ability) pushEffect(state, frame.source, frame.controller, ability.steps);
  return false; // o índice já avançou
}

/** Registra um modificador; "until the end of your opponent's next turn" calcula o turno em que acaba. */
export function addModifier(state: GameState, controller: PlayerId, m: Modifier) {
  setExpiry(state, controller, m, m.duration);
  state.modifiers.push(m);
}

/**
 * "will not become active in your (opponent's) next Refresh Phase": vale até a próxima Renovação do dono
 * da carta, que o consome (`refreshDrawDon`), seja ela em que turno for. Não acaba pela contagem de
 * turnos: com um turno extra, ou numa mesa com mais de dois jogadores, a Renovação do dono pode vir
 * depois do turno em que um "until the end of … next turn" acabaria.
 */
export function addSkipRefresh(state: GameState, uid: string) {
  state.modifiers.push({ uid, kind: 'skipRefresh', amount: 0, duration: 'nextOpponentTurn', untilTurn: FAR_TURN });
}

/** DON!! virados na área de custo de `player` que já não desviram na próxima Renovação dele. */
export function donSkippingRefresh(state: GameState, player: PlayerId): number {
  return (state.donSkipRefresh ?? []).filter((d) => d.player === player).reduce((n, d) => n + d.count, 0);
}

/**
 * "Up to N of your opponent's rested DON!! cards will not become active in your opponent's next Refresh
 * Phase": os alvos são DON!! virados da área de custo na hora do efeito (os dados a cartas não contam,
 * nem os que virarem depois) que ainda não estão congelados. Devolve quantos ficaram.
 */
export function addDonSkipRefresh(state: GameState, player: PlayerId, count: number): number {
  const n = Math.min(count, state.players[player].donRested - donSkippingRefresh(state, player));
  if (n <= 0) return 0;
  (state.donSkipRefresh ??= []).push({ player, count: n });
  return n;
}

/**
 * Pergunta com opções de texto; a resposta chega em frame.choice = [índice]. `optionKeys` são as
 * chaves de tradução das opções fixas (null = texto de carta, nome, número: fica como está). `shown`:
 * cartas que só quem responde vê junto da pergunta.
 */
export function askOption(
  state: GameState,
  frame: EffectFrame,
  player: PlayerId,
  prompt: Prompt,
  options: string[],
  optionKeys?: (string | null)[],
  optionParts?: (MsgList | null)[],
  shown?: string[],
) {
  state.pending = {
    kind: 'option',
    player,
    source: frame.source,
    ...promptOf(prompt),
    options,
    ...(optionKeys ? { optionKeys } : {}),
    ...(optionParts ? { optionParts } : {}),
    ...(shown?.length ? { shown } : {}),
  };
}

/**
 * Mesa com mais de dois: de qual oponente sai o DON!! de um efeito escrito como alvo ("rest up to 1 of your
 * opponent's DON!! cards"). Cada DON!! é um alvo, de qualquer oponente, como um Personagem (regra 1 do manual).
 * `candidates`: os oponentes que têm um DON!! que serve. Devolve o oponente, null (nenhum serve) ou undefined
 * (abriu a pergunta). Com dois jogadores, ou com o oponente já fixado (um passo "para cada oponente"), não pergunta.
 * Usa `frame.memo[0] = 'donOf'` enquanto espera a resposta.
 */
export function donTargetOpponent(state: GameState, frame: EffectFrame, candidates: PlayerId[], prompt: Prompt): PlayerId | null | undefined {
  if (frame.memo?.[0] === 'donOf' && frame.choice) {
    const id = Number(frame.memo[1 + Number(frame.choice[0])]);
    frame.memo = undefined;
    frame.choice = undefined;
    return Number.isInteger(id) && candidates.includes(id) ? id : null;
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  askOption(
    state,
    frame,
    frame.controller,
    prompt,
    candidates.map((id) => state.players[id].name),
    candidates.map(() => null),
  );
  frame.memo = ['donOf', ...candidates.map(String)];
  return undefined;
}

/** Interrompe o efeito: os passos restantes não acontecem. */
export function abortEffect(frame: EffectFrame): false {
  frame.i = frame.steps.length;
  frame.choice = undefined;
  frame.memo = undefined;
  return false;
}
