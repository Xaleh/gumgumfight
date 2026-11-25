// A mão provável do oponente (docs/bot-tempo.md, seção 13): o bot não vê a mão dele, mas sabe o Líder e, pelo
// meta, a lista que esse Líder costuma jogar. Um jogador de verdade faz a mesma conta: "Law azul joga oito Counters
// de +2000 e já gastou três; o Rocks.D.Xebec quase não tem Counter; esse deck tem quatro Rush de custo 5".
//
// - `DeckGuess` é o deck provável do Líder adversário: as cartas com as cópias esperadas (podem ser fracionárias,
//   do deck médio das estatísticas) e só o que a conta precisa de cada uma (Counter impresso, Evento [Counter] e
//   [Rush]). Vem de fora do motor (o servidor monta pelas estatísticas públicas do Líder, pelo deck do meta ou pelo
//   deck pronto do mesmo Líder) e nunca é a lista do oponente de verdade.
// - `handModel` tira do deck provável o que o bot já viu desse oponente (campo, lixo, Vida aberta, cartas da mão
//   reveladas) e devolve a chance de uma carta escondida da mão dele cobrir 0, 1, 2… mil de Counter, mais os [Rush]
//   que ele pode ter. É calculado uma vez por decisão, na visão do bot: nada da mão real entra.
// - O planejador usa o modelo no risco de Counter dos ataques (`counterAbility`) e a avaliação, na ameaça do
//   próximo ataque dele (`incomingHits`: um [Rush] provável que cabe no DON!! é mais um atacante).

import { buildCardDef } from '../cards';
import type { CardData, CardDef, GameState, PlayerId } from '../types';
import { HIDDEN_CARD } from '../view';

/** Uma carta do deck provável: as cópias esperadas e o que a conta da mão precisa saber dela. */
export interface GuessCard {
  id: string;
  /** Cópias esperadas no deck (0 a 4; fracionário no deck médio das estatísticas). */
  count: number;
  /** Counter impresso (Personagem). */
  counter?: number;
  /** Evento [Counter]: o custo e o +poder. */
  event?: { cost: number; power: number };
  /** Personagem com [Rush]: o custo e o poder. */
  rush?: { cost: number; power: number };
}

/** O deck provável de um Líder adversário. */
export interface DeckGuess {
  leader: string;
  /** De onde veio (`stats`, `meta:<id>`, `deck:<arquivo>`), para a explicação e os testes. */
  source: string;
  cards: GuessCard[];
}

/** O que o bot deduz da mão escondida do oponente numa posição. */
export interface HandModel {
  source: string;
  /**
   * Chance de uma carta escondida da mão dele cobrir 0, 1, 2, 3 ou 4 mil (o último índice vale "4 ou mais"),
   * já com os Eventos [Counter] que o DON!! ativo dele paga.
   */
  counter: number[];
  /** Os [Rush] que ainda podem estar na mão: custo, poder e a chance de uma carta escondida ser este. */
  rush: Array<{ cost: number; power: number; p: number }>;
  /** As cartas mais prováveis numa carta escondida (até 5), para a explicação. */
  likely: Array<{ id: string; p: number }>;
}

/** O +poder de um Evento [Counter] pela definição (a soma dos passos de +poder da habilidade de Counter). */
export function counterEventPowerOf(def: CardDef): number {
  const ab = def.abilities.find((a) => a.timing === 'counter');
  return ab?.steps.reduce((sum, st) => sum + (st.do === 'power' && st.amount > 0 ? st.amount : 0), 0) ?? 0;
}

/** A parte da carta que a conta da mão precisa (Counter, Evento [Counter], [Rush]). */
export function guessCardOf(def: CardDef, count: number): GuessCard {
  const out: GuessCard = { id: def.id, count };
  if (def.category === 'character' && def.counter) out.counter = def.counter;
  if (def.category === 'event') {
    const power = counterEventPowerOf(def);
    if (power > 0) out.event = { cost: def.cost ?? 0, power };
  }
  if (def.category === 'character' && def.keywords.includes('rush')) out.rush = { cost: def.cost ?? 0, power: def.power ?? 0 };
  return out;
}

/**
 * Monta o deck provável de uma lista (cartas e cópias, sem o Líder) com a base de cartas. Cartas fora da base
 * ficam de fora; o Líder, se vier na lista, também.
 */
export function deckGuessFrom(leader: string, list: Array<{ id: string; count: number }>, cards: Map<string, CardData> | ((id: string) => CardData | undefined), source: string): DeckGuess {
  const get = typeof cards === 'function' ? cards : (id: string) => cards.get(id);
  const out: GuessCard[] = [];
  for (const { id, count } of list) {
    if (id === leader || !(count > 0)) continue;
    const data = get(id);
    if (!data || data.category === 'leader') continue;
    out.push(guessCardOf(buildCardDef(data), Math.min(4, count)));
  }
  return { leader, source, cards: out };
}

/** Confere um deck provável vindo de fora (rota, worker); devolve o deck limpo ou null. */
export function validateDeckGuess(raw: unknown): DeckGuess | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.leader !== 'string' || typeof g.source !== 'string' || !Array.isArray(g.cards)) return null;
  const num = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const pair = (v: unknown) => !!v && typeof v === 'object' && num((v as { cost: unknown }).cost, 20) && num((v as { power: unknown }).power, 20000);
  const cards: GuessCard[] = [];
  for (const c of g.cards.slice(0, 80) as Array<Record<string, unknown>>) {
    if (!c || typeof c.id !== 'string' || !num(c.count, 4)) return null;
    const card: GuessCard = { id: c.id.slice(0, 24), count: c.count as number };
    if (c.counter !== undefined) {
      if (!num(c.counter, 5000)) return null;
      card.counter = c.counter as number;
    }
    if (c.event !== undefined) {
      if (!pair(c.event)) return null;
      card.event = { cost: (c.event as GuessCard['event'])!.cost, power: (c.event as GuessCard['event'])!.power };
    }
    if (c.rush !== undefined) {
      if (!pair(c.rush)) return null;
      card.rush = { cost: (c.rush as GuessCard['rush'])!.cost, power: (c.rush as GuessCard['rush'])!.power };
    }
    cards.push(card);
  }
  return { leader: g.leader.slice(0, 24), source: g.source.slice(0, 80), cards };
}

/** Os mil de Counter que uma carta cobre, com `don` DON!! ativos para pagar um Evento [Counter]. */
function coverOf(c: Pick<GuessCard, 'counter' | 'event'>, don: number): number {
  const printed = c.counter ?? 0;
  const event = c.event && c.event.cost <= don ? c.event.power : 0;
  return Math.min(4, Math.floor(Math.max(printed, event) / 1000));
}

/**
 * A mão provável do oponente de `player` na visão: o deck provável menos as cartas desse oponente que o bot vê
 * (qualquer uma fora do deck, da Vida virada e da parte escondida da mão), com a distribuição de Counter de uma
 * carta escondida. `hold` é a vantagem das cartas com Counter (razão de chances): quem joga guarda os Counters na
 * mão e gasta as outras, então a mão tem mais Counter que o deck. Sem deck provável (ou com o deck esgotado pelo
 * que já saiu), devolve undefined e o bot usa o modelo fixo.
 */
export function handModel(state: GameState, player: PlayerId, guess: DeckGuess | undefined, hold: number): HandModel | undefined {
  if (!guess?.cards.length) return undefined;
  const opp: PlayerId = player === 0 ? 1 : 0;
  const leaderUid = state.players[opp].leader.uid;
  // Cartas desse oponente à vista: campo, lixo, Vida aberta, mão revelada, cartas fora do jogo. O Líder não entra.
  const seen = new Map<string, number>();
  for (const c of Object.values(state.cards)) {
    if (c.owner !== opp || c.uid === leaderUid || c.cardId === HIDDEN_CARD) continue;
    seen.set(c.cardId, (seen.get(c.cardId) ?? 0) + 1);
  }
  const don = state.players[opp].donActive;
  const pool = guess.cards.map((c) => ({ card: c, left: Math.max(0, c.count - (seen.get(c.id) ?? 0)) })).filter((x) => x.left > 0);
  // Cartas que o deck provável não explica (um deck de 50 com 40 cartas na lista): não têm Counter.
  const listed = guess.cards.reduce((n, c) => n + c.count, 0);
  const filler = Math.max(0, 50 - listed);
  let total = filler;
  const weighted = pool.map((x) => {
    const cover = coverOf(x.card, don);
    const w = x.left * (cover > 0 ? Math.max(0, hold) : 1);
    total += w;
    return { ...x, cover, w };
  });
  if (total <= 0) return undefined;
  const counter = [filler / total, 0, 0, 0, 0];
  for (const x of weighted) counter[x.cover] += x.w / total;
  const rush = weighted.filter((x) => x.card.rush).map((x) => ({ ...x.card.rush!, p: x.w / total }));
  const likely = weighted
    .map((x) => ({ id: x.card.id, p: x.w / total }))
    .sort((a, b) => b.p - a.p || a.id.localeCompare(b.id))
    .slice(0, 5);
  return { source: guess.source, counter, rush, likely };
}

/**
 * Chance de as cartas da mão do oponente somarem `need` de Counter: as conhecidas (`known`, em mil cada) contam pelo
 * valor, e cada uma das `unknown` escondidas pela distribuição `dist` (índice = mil).
 */
export function counterChance(known: number[], unknown: number, need: number, dist: number[]): number {
  if (need <= 0) return 1;
  const steps = Math.ceil(need / 1000);
  const have = known.reduce((s, k) => s + k, 0);
  if (have >= steps) return 1;
  const left = steps - have;
  let d = new Float64Array(left + 1);
  d[0] = 1;
  for (let c = 0; c < Math.max(0, unknown); c++) {
    const next = new Float64Array(left + 1);
    for (let i = 0; i <= left; i++) {
      if (!d[i]) continue;
      for (let k = 0; k < dist.length; k++) if (dist[k]) next[Math.min(left, i + k)] += d[i] * dist[k];
    }
    d = next;
  }
  return d[left];
}
