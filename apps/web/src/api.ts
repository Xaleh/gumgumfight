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
}

export type DeckInput = Pick<DeckList, 'name' | 'leader' | 'cards'>;

export type ApiCard = CardData & { provisional?: boolean };

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
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
    get<{ deck: DeckList & { kind: DeckSummary['kind'] }; cards: ApiCard[]; summary: DeckSummary }>(
      `/api/decks/${encodeURIComponent(id)}`,
    ),
  cards: () => get<ApiCard[]>('/api/cards'),
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
