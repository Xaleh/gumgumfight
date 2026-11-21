// Draft: num pod, cada jogador abre um booster, fica com 1 carta e passa o resto ao vizinho, até
// os boosters acabarem; depois abre o próximo. No fim, monta um deck de 40 com o que escolheu
// (as regras do deck são as do Selado, `sealed.ts`).
//
// Escolhas do GumGum Fight (a Bandai não publica regra de Draft): pod de 8 assentos, 4 boosters
// de 12 cartas por assento (48 escolhas), o passe alterna de sentido a cada rodada. Lugar vazio
// é ocupado por um bot.
//
// O estado é JSON puro e as funções não o alteram (devolvem o novo estado): o servidor grava e
// refaz o draft como faz com as partidas. Os boosters de todas as rodadas são sorteados na
// criação (`openDraftBoosters`) e ficam no estado, que nunca sai do servidor: cada jogador só
// recebe o booster que está na mão dele e as cartas que escolheu.

import { rarityCode } from './formats';
import { nextRandom, type RngHolder } from './rng';
import { limitedScore } from './sealed';
import type { CardData } from './types';

export const DRAFT_SEATS = 8;
export const DRAFT_ROUNDS = 4;

export interface DraftState {
  seats: number;
  rounds: number;
  /** Rodada em andamento (0 a `rounds` − 1); igual a `rounds` quando o draft acabou. */
  round: number;
  /** Boosters das rodadas que ainda não começaram: `sealed[rodada][assento]`. */
  sealed: string[][][];
  /** Coleção de cada booster: `sets[rodada][assento]` (no Pack Rush draft elas variam). */
  sets: string[][];
  /** Boosters na mão de cada assento, em fila: o primeiro é o que ele está vendo. */
  queues: string[][][];
  /** Cartas escolhidas: `picks[assento][rodada]`. */
  picks: string[][][];
}

/** Começa o draft: cada assento abre o booster da primeira rodada. */
export function createDraft(boosters: { packs: string[][][]; sets: string[][] }): DraftState {
  const rounds = boosters.packs.length;
  const seats = boosters.packs[0]?.length ?? 0;
  if (!rounds || seats < 2 || boosters.packs.some((r) => r.length !== seats)) throw new Error('Draft precisa de boosters para todos os assentos em todas as rodadas.');
  return openRound({
    seats,
    rounds,
    round: 0,
    sealed: boosters.packs.map((r) => r.map((p) => [...p])),
    sets: boosters.sets.map((r) => [...r]),
    queues: Array.from({ length: seats }, () => []),
    picks: Array.from({ length: seats }, () => Array.from({ length: rounds }, () => [])),
  });
}

function openRound(s: DraftState): DraftState {
  if (s.round >= s.rounds) return s;
  s.queues = s.sealed[s.round].map((pack) => [pack]);
  s.sealed[s.round] = [];
  return s;
}

export const draftDone = (s: DraftState): boolean => s.round >= s.rounds;

/** O booster que o assento está vendo (null: está esperando o vizinho passar, ou o draft acabou). */
export const draftPack = (s: DraftState, seat: number): string[] | null => (draftDone(s) ? null : (s.queues[seat]?.[0] ?? null));

/** Para quem o assento passa nesta rodada: nas rodadas ímpares (1ª, 3ª) para a esquerda, nas pares para a direita. */
export const draftPassTo = (s: Pick<DraftState, 'seats' | 'round'>, seat: number): number => (seat + (s.round % 2 === 0 ? 1 : s.seats - 1)) % s.seats;

/** Quantas cartas o assento já escolheu nesta rodada. */
export const draftPicked = (s: DraftState, seat: number): number => (draftDone(s) ? 0 : s.picks[seat][s.round].length);

/**
 * O assento fica com `cardId` do booster que está vendo e passa o resto ao vizinho. Quando o
 * último booster da rodada esvazia, a próxima rodada abre para todos. Recusa (com erro) carta que
 * não está no booster ou assento sem booster na mão.
 */
export function draftPick(state: DraftState, seat: number, cardId: string): DraftState {
  const pack = draftPack(state, seat);
  if (!pack) throw new Error('Nenhum booster na mão deste assento.');
  const at = pack.indexOf(cardId);
  if (at < 0) throw new Error(`A carta ${cardId} não está neste booster.`);
  const s: DraftState = structuredClone(state);
  const [mine, ...waiting] = s.queues[seat];
  mine.splice(at, 1);
  s.queues[seat] = waiting;
  s.picks[seat][s.round].push(cardId);
  if (mine.length) s.queues[draftPassTo(s, seat)].push(mine);
  if (s.queues.every((q) => !q.length)) {
    s.round++;
    openRound(s);
  }
  return s;
}

/** Todas as cartas que o assento escolheu, na ordem. */
export const draftPicks = (s: DraftState, seat: number): string[] => s.picks[seat].flat();

/** Segundos para escolher: mais tempo com o booster cheio, menos conforme ele esvazia (46 s com 12 cartas, 13 s com 1). */
export const draftPickSeconds = (cardsInPack: number): number => 10 + 3 * Math.max(1, cardsInPack);

const RARITY_BONUS: Record<string, number> = { R: 0.7, SR: 2, SEC: 3 };

/**
 * A carta que um bot pega do booster (e a escolha automática de quem deixou o tempo acabar): a de
 * melhor nota para um deck de Selado, com um bônus pela raridade. Líder, só o primeiro (o de 6
 * cores está sempre disponível). `holder`: um pouco de acaso, para os bots não escolherem todos igual.
 */
export function draftChoice(pack: readonly string[], picked: readonly string[], cards: ReadonlyMap<string, CardData>, holder?: RngHolder): string {
  const hasLeader = picked.some((id) => cards.get(id)?.category === 'leader');
  let best = pack[0];
  let bestScore = -Infinity;
  for (const id of pack) {
    const card = cards.get(id);
    let score = -100;
    if (card) score = card.category === 'leader' ? (hasLeader ? -10 : 3.5) : limitedScore(card) + (RARITY_BONUS[rarityCode(card.rarity) ?? ''] ?? 0);
    if (holder) score += nextRandom(holder) * 1.2;
    if (score > bestScore || (score === bestScore && id < best)) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}
