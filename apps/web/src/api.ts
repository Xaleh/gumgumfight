import type { CardData, DeckList } from '@gumgum/engine';

export interface DeckSummary {
  id: string;
  name: string;
  leader: string;
  size: number;
}

export type ApiCard = CardData & { provisional?: boolean };

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  decks: () => get<DeckSummary[]>('/api/decks'),
  deck: (id: string) => get<{ deck: DeckList; cards: ApiCard[] }>(`/api/decks/${encodeURIComponent(id)}`),
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
