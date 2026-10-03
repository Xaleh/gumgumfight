import type { Action, CardData, DeckList, PlayerId } from '@gumgum/engine';

export interface DeckSummary {
  id: string;
  name: string;
  kind: 'builtin' | 'user';
  leader: string;
  leaderName: string | null;
  /** Imagem do Líder (null quando o servidor desliga as imagens). */
  leaderImage: string | null;
  colors: string[];
  size: number;
  valid: boolean;
  errors: string[];
  unscripted: number;
  updatedAt: string;
  /** Deck criado por você (na sua conta ou, sem login, neste navegador). Só o dono edita/apaga. */
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
 * Código aleatório deste navegador, enviado em x-deck-owner. Sem login, quem o tem
 * pode editar os decks criados aqui; no login, esses decks passam para a conta.
 * Usa getRandomValues porque randomUUID exige HTTPS.
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
  /** Script escrito à mão. */
  scripted: number;
  /** Lida por completo pelo leitor automático de efeitos. */
  auto: number;
  /** Parte automática, parte manual. */
  partial: number;
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

/** Erro da API com o status e o corpo da resposta (ex.: a sala da partida em andamento). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
  }
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
    const err = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
    throw new ApiError(err?.error ?? `${method} ${url}: ${res.status}`, res.status, err ?? {});
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export interface User {
  id: string;
  /** Nome da conta Google (só você vê; o nome público é o do perfil de estatísticas). */
  name: string | null;
  email: string | null;
  picture: string | null;
}

export const api = {
  config: () => get<{ cardImages: boolean; languages: string[]; googleClientId: string | null }>('/api/config'),
  me: () => get<{ user: User | null }>('/api/auth/me'),
  /** Troca o ID token do botão do Google por uma sessão (cookie). */
  googleLogin: (credential: string) => send<{ user: User; claimedDecks: number }>('POST', '/api/auth/google', { credential }),
  logout: () => send<void>('POST', '/api/auth/logout'),
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
  /** Envia o replay de uma partida terminada; o servidor refaz a partida antes de gravar as estatísticas. */
  saveMatch: (m: MatchUpload) => send<{ id: number }>('POST', '/api/matches', m).catch(() => undefined),
  player: () => get<PlayerProfile | null>('/api/players/me'),
  rename: (name: string) => send<PlayerProfile>('PUT', '/api/players/me', { name }),
  statsMeta: () => get<StatsMeta>('/api/stats/meta'),
  stats: (f: StatsQuery) => get<StatsOverview>(`/api/stats?${statsQs(f)}`),
  cardStats: (f: StatsQuery) => get<CardStatsResponse>(`/api/stats/cards?${statsQs(f)}`),
  trend: (f: StatsQuery, weeks = 6) => get<TrendResponse>(`/api/stats/trend?${statsQs({ ...f, weeks: String(weeks) })}`),
  online: {
    active: () => get<ActiveRoom[]>('/api/online/active'),
    createRoom: (deckId: string, format: FormatId) =>
      send<{ roomId: string; code: string; token: string }>('POST', '/api/online/rooms', { deckId, format }),
    joinRoom: (code: string, deckId: string) => send<{ roomId: string; token: string }>('POST', '/api/online/rooms/join', { code, deckId }),
    enqueue: (deckId: string, format: FormatId, queue: QueueKind) =>
      send<{ ticket: string }>('POST', '/api/online/queue', { deckId, format, queue }),
    poll: (ticket: string) => get<QueuePoll>(`/api/online/queue/${encodeURIComponent(ticket)}`),
    cancel: (ticket: string) => send<void>('DELETE', `/api/online/queue/${encodeURIComponent(ticket)}`),
    act: (roomId: string, t: string, seq: number, action: Action) =>
      send<{ ok: true; actionCount: number }>('POST', `/api/online/rooms/${roomId}/action`, { t, seq, action }),
    emote: (roomId: string, t: string, emote: string) => send<void>('POST', `/api/online/rooms/${roomId}/emote`, { t, emote }),
    rematch: (roomId: string, t: string) => send<void>('POST', `/api/online/rooms/${roomId}/rematch`, { t }),
    leave: (roomId: string, t: string) => send<void>('POST', `/api/online/rooms/${roomId}/leave`, { t }),
    replay: (roomId: string, t: string) => get<Record<string, unknown>>(`/api/online/rooms/${roomId}/replay?t=${encodeURIComponent(t)}`),
    eventsUrl: (roomId: string, t: string) => `/api/online/rooms/${roomId}/events?t=${encodeURIComponent(t)}`,
  },
};

// ------------------------------------------------------------------ online

export type QueueKind = 'casual' | 'ranked';

export interface OnlineSeat {
  roomId: string;
  token: string;
}

export interface ActiveRoom extends OnlineSeat {
  status: 'waiting' | 'playing';
  queue: 'private' | QueueKind;
  code: string | null;
}

export type QueuePoll =
  | { status: 'waiting'; waited: number; players: number }
  | { status: 'matched'; roomId: string; token: string };

export interface OnlineRoomInfo {
  id: string;
  code: string | null;
  queue: 'private' | QueueKind;
  format: FormatId;
  status: 'waiting' | 'playing' | 'finished';
  you: PlayerId;
  players: Array<{ name: string; bounty: number; tier: string; leader: string; connected: boolean }>;
  clock: { remaining: [number, number]; running: PlayerId | null; total: number; awaySince: number | null };
  result: { matchId: number | null; bounty: Array<{ before: number | null; after: number | null }> | null; error?: string } | null;
  rematch: [boolean, boolean];
}

// ------------------------------------------------------------------ estatísticas

export type FormatId = 'standard' | 'egb';

export interface MatchUpload {
  mode: 'bot' | 'demo';
  format: FormatId;
  seed: number;
  firstPlayer?: PlayerId;
  deckIds: [string, string];
  decks: [DeckList, DeckList];
  actions: Action[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  /** Recompensa em Beries (ranqueada). */
  bounty: number;
  rankedGames: number;
  tier: string;
}

export interface Tier {
  id: string;
  label: string;
  min: number;
  max: number | null;
}

export interface CardInfo {
  name: string;
  category: string;
  colors: string[];
  imageUrl?: string;
}

export interface WinCount {
  games: number;
  wins: number;
}

export interface StatsMeta {
  formats: Array<{ id: FormatId; label: string }>;
  queues: Array<{ id: string; label: string }>;
  tiers: Tier[];
  leaders: Array<{ leader: string; games: number }>;
  me: PlayerProfile | null;
  myDecks: Array<WinCount & { hash: string; leader: string; deckId: string | null; lastPlayed: string }>;
  cards: Record<string, CardInfo>;
}

export interface StatsQuery {
  format?: string;
  queue?: string;
  by?: 'human' | 'bot';
  opponent?: string;
  tiers?: string[];
  leader?: string;
  oppLeader?: string;
  first?: string;
  days?: string;
  mine?: boolean;
  deck?: string;
  weeks?: string;
}

export interface StatsSummary extends WinCount {
  matches: number;
  players: number;
  first: WinCount;
  second: WinCount;
  mulligan: WinCount;
  keep: WinCount;
}

export interface StatsOverview {
  summary: StatsSummary;
  leaders: Array<WinCount & { leader: string; lists: number; firstGames: number; firstWins: number }>;
  matchups: Array<WinCount & { leader: string; oppLeader: string; firstGames: number; firstWins: number }>;
  cards: Record<string, CardInfo>;
}

export interface CardStatRow extends WinCount {
  cardId: string;
  avgCopies: number;
  openingGames: number;
  openingWins: number;
  drawnGames: number;
  drawnWins: number;
  notDrawnGames: number;
  notDrawnWins: number;
  playedGames: number;
  playedWins: number;
  timesPlayed: number;
}

export interface CardStatsResponse {
  summary: StatsSummary;
  rows: CardStatRow[];
  cards: Record<string, CardInfo>;
}

export interface TrendResponse {
  /** Segunda-feira de cada semana (AAAA-MM-DD), da mais antiga à atual. */
  weeks: string[];
  rows: Array<WinCount & { week: string; leader: string }>;
  cards: Record<string, CardInfo>;
}

function statsQs(f: StatsQuery): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '' || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) q.set(k, v.join(','));
    } else q.set(k, v === true ? '1' : String(v));
  }
  return q.toString();
}
