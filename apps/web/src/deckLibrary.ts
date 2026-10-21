// Listas de decks (seletor de deck, biblioteca do construtor): abas, busca, filtro por cor,
// ordenação, decks recentes e o selo de estado de cada deck. Sem React, para poder testar.

import type { CardData } from '@gumgum/engine';
import type { DeckSummary } from './api';

export type DeckTab = 'recent' | 'favorites' | 'mine' | 'community' | 'builtin';
export type DeckSort = 'recent' | 'updated' | 'name' | 'color' | 'leader' | 'games';

/** Ordem das cores no filtro e na ordenação por cor. */
export const DECK_COLORS = ['red', 'green', 'blue', 'purple', 'black', 'yellow'] as const;

const RECENT_KEY = 'gumgum.recentDecks';
const RECENT_MAX = 12;

/** Decks escolhidos neste navegador, do mais recente ao mais antigo: [id, quando (ms)]. */
export function localRecent(): Array<[string, number]> {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((r): r is [string, number] => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'number') : [];
  } catch {
    return [];
  }
}

/** Lembra o deck escolhido (vai para o topo de "Recentes"). */
export function rememberDeck(id: string, now = Date.now()) {
  try {
    const list = [[id, now] as [string, number], ...localRecent().filter(([x]) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento */
  }
}

/** Data do SQLite (`YYYY-MM-DD HH:MM:SS`, UTC) ou ISO em milissegundos (0 = sem data). */
export function deckTime(at: string | null | undefined): number {
  if (!at) return 0;
  const ms = Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Quando o deck foi usado por último: a última partida no servidor ou a última escolha neste navegador. */
export function lastUsed(deck: DeckSummary, local: ReadonlyMap<string, number>): number {
  return Math.max(deckTime(deck.lastPlayedAt), local.get(deck.id) ?? 0);
}

export function inTab(deck: DeckSummary, tab: DeckTab, local: ReadonlyMap<string, number>): boolean {
  switch (tab) {
    case 'recent':
      return lastUsed(deck, local) > 0;
    case 'favorites':
      return Boolean(deck.favorite);
    case 'mine':
      return deck.kind === 'user' && deck.mine;
    case 'community':
      return deck.kind === 'user' && !deck.mine;
    case 'builtin':
      return deck.kind === 'builtin';
  }
}

/** Nome, Líder (nome e número) e cores: o que a busca encontra. */
export function matchesQuery(deck: DeckSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${deck.name} ${deck.leaderName ?? ''} ${deck.leader}`.toLowerCase().includes(q);
}

export function matchesColors(deck: DeckSummary, colors: readonly string[]): boolean {
  return !colors.length || deck.colors.some((c) => colors.includes(c));
}

const colorRank = (d: DeckSummary) => {
  const i = DECK_COLORS.indexOf(d.colors[0] as (typeof DECK_COLORS)[number]);
  return i < 0 ? DECK_COLORS.length : i;
};

export function sortDecks(decks: DeckSummary[], sort: DeckSort, local: ReadonlyMap<string, number>): DeckSummary[] {
  const byName = (a: DeckSummary, b: DeckSummary) => a.name.localeCompare(b.name);
  const cmp: Record<DeckSort, (a: DeckSummary, b: DeckSummary) => number> = {
    recent: (a, b) => lastUsed(b, local) - lastUsed(a, local) || deckTime(b.updatedAt) - deckTime(a.updatedAt) || byName(a, b),
    updated: (a, b) => deckTime(b.updatedAt) - deckTime(a.updatedAt) || byName(a, b),
    name: byName,
    color: (a, b) => colorRank(a) - colorRank(b) || (a.leaderName ?? '').localeCompare(b.leaderName ?? '') || byName(a, b),
    // Decks do mesmo Líder juntos (pelo nome; no empate, pelo número), o editado por último antes.
    leader: (a, b) =>
      (a.leaderName ?? '').localeCompare(b.leaderName ?? '') || a.leader.localeCompare(b.leader) || deckTime(b.updatedAt) - deckTime(a.updatedAt) || byName(a, b),
    games: (a, b) => (b.games ?? 0) - (a.games ?? 0) || byName(a, b),
  };
  return [...decks].sort(cmp[sort]);
}

/**
 * Aba aberta de início: a que mostra o deck já escolhido (`current`), se houver; senão os
 * recentes; senão os meus; senão os prontos.
 */
export function initialTab(decks: DeckSummary[], local: ReadonlyMap<string, number>, current?: string): DeckTab {
  const chosen = current ? decks.find((d) => d.id === current) : undefined;
  if (chosen) {
    const tab = (['recent', 'favorites', 'mine', 'community', 'builtin'] as const).find((t) => inTab(chosen, t, local));
    if (tab) return tab;
  }
  if (decks.some((d) => lastUsed(d, local) > 0)) return 'recent';
  if (decks.some((d) => d.kind === 'user' && d.mine)) return 'mine';
  return 'builtin';
}

/**
 * Selo de estado: rascunho (tamanho), Standard, só Extra Grand Battle ou proibido. É o resumo
 * genérico; quem escolhe um deck para jogar diz se ele vale nas regras da partida.
 */
export type DeckState = 'draft' | 'standard' | 'egb' | 'banned';
export function deckState(d: DeckSummary): DeckState {
  if (!d.valid) return 'draft';
  if (!d.formats.standard.length) return 'standard';
  if (!d.formats.egb.length) return 'egb';
  return 'banned';
}

/** Curva de custo (0 a 10+), counters e tipos de um deck, para a prévia, o visualizador e o construtor. */
export interface DeckNumbers {
  total: number;
  curve: number[];
  counter1000: number;
  counter2000: number;
  byCategory: Record<'character' | 'event' | 'stage', number>;
}
export function deckNumbers(cards: ReadonlyArray<{ id: string; count: number }>, byId: ReadonlyMap<string, CardData>): DeckNumbers {
  const out: DeckNumbers = { total: 0, curve: Array.from({ length: 11 }, () => 0), counter1000: 0, counter2000: 0, byCategory: { character: 0, event: 0, stage: 0 } };
  for (const { id, count } of cards) {
    const card = byId.get(id);
    out.total += count;
    if (!card) continue;
    if (card.cost !== undefined) out.curve[Math.min(card.cost, 10)] += count;
    if (card.counter === 1000) out.counter1000 += count;
    if (card.counter === 2000) out.counter2000 += count;
    if (card.category !== 'leader') out.byCategory[card.category] += count;
  }
  return out;
}

/** As cartas que mais aparecem (mais cópias; no empate, a mais cara). */
export function topCards<T extends { id: string; count: number }>(cards: readonly T[], byId: ReadonlyMap<string, CardData>, n = 6): T[] {
  return [...cards].sort((a, b) => b.count - a.count || (byId.get(b.id)?.cost ?? 0) - (byId.get(a.id)?.cost ?? 0) || a.id.localeCompare(b.id)).slice(0, n);
}

