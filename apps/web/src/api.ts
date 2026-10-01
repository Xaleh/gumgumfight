import type { CardData, DeckList } from '@gumgum/engine';

export interface DeckSummary {
  id: string;
  name: string;
  kind: 'builtin' | 'user';
  leader: string;
  leaderName: string | null;
  colors: string[];
  size: number;
  valid: boolean;
  errors: string[];
  unscripted: number;
  updatedAt: string;
  /** Deck criado neste navegador (só o dono edita/apaga). */
  mine: boolean;
}

/** Agrupa decks para listas: meus, da comunidade (outros jogadores) e prontos. */
export function deckGroups(decks: DeckSummary[]): Array<[string, DeckSummary[]]> {
  return [
    ['Meus decks', decks.filter((d) => d.kind === 'user' && d.mine)],
    ['Decks da comunidade', decks.filter((d) => d.kind === 'user' && !d.mine)],
    ['Decks prontos', decks.filter((d) => d.kind === 'builtin')],
  ];
}

// ------------------------------------------------------------------ dono dos decks

const OWNER_KEY = 'gumgum.owner';
let ownerMemo: string | null = null;

/**
 * Código aleatório deste navegador, enviado em x-deck-owner. Quem o tem pode editar
 * os decks criados aqui. Usa getRandomValues porque randomUUID exige HTTPS.
 */
export function ownerToken(): string {
  if (ownerMemo) return ownerMemo;
  try {
    const saved = localStorage.getItem(OWNER_KEY);
    if (saved && saved.length >= 16) return (ownerMemo = saved);
  } catch {
    /* armazenamento indisponível */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  ownerMemo = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(OWNER_KEY, ownerMemo);
  } catch {
    /* vale só nesta sessão */
  }
  return ownerMemo;
}

export interface CoverageRow {
  set: string;
  total: number;
  vanilla: number;
  scripted: number;
  manual: number;
  ptComplete: number;
}

export type DeckInput = Pick<DeckList, 'name' | 'leader' | 'cards'>;

export type ApiCard = CardData & { provisional?: boolean };

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'x-deck-owner': ownerToken() } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      'x-deck-owner': ownerToken(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `${method} ${url}: ${res.status}`);
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export const api = {
  config: () => get<{ cardImages: boolean; languages: string[] }>('/api/config'),
  decks: () => get<DeckSummary[]>('/api/decks'),
  deck: (id: string) =>
    get<{ deck: DeckList & { kind: DeckSummary['kind']; mine: boolean }; cards: ApiCard[]; summary: DeckSummary }>(
      `/api/decks/${encodeURIComponent(id)}`,
    ),
  cards: () => get<ApiCard[]>('/api/cards'),
  coverage: () => get<{ total: CoverageRow; sets: CoverageRow[] }>('/api/coverage'),
  createDeck: (d: DeckInput) => send<DeckSummary>('POST', '/api/decks', d),
  updateDeck: (id: string, d: DeckInput) => send<DeckSummary>('PUT', `/api/decks/${encodeURIComponent(id)}`, d),
  deleteDeck: (id: string) => send<void>('DELETE', `/api/decks/${encodeURIComponent(id)}`),
  saveMatch: (m: {
    seed: number;
    mode: string;
    deck0: string;
    deck1: string;
    winner: number | null;
    turns: number;
    reason: string | null;
  }) =>
    fetch('/api/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(m),
    }).catch(() => undefined),
};
