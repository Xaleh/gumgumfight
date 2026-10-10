import type { Action, CardData, DeckList, FormatId, PlayerId } from '@gumgum/engine';

export type { FormatId };

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
  /** Por formato: o que impede o deck de ser usado nele (vazio = permitido). */
  formats: Record<FormatId, string[]>;
  unscripted: number;
  updatedAt: string;
  /** Deck criado por você (na sua conta ou, sem login, neste navegador). Só o dono edita/apaga. */
  mine: boolean;
}

/** Deck completo e permitido no formato (cartas banidas ou rotacionadas impedem). */
export function canPlay(deck: DeckSummary, format: FormatId): boolean {
  return deck.valid && !deck.formats?.[format]?.length;
}

/** Por que o deck não pode ser usado no formato (null = pode). */
export function whyNotPlayable(deck: DeckSummary, format: FormatId): string | null {
  if (!deck.valid) return `Incompleto: ${deck.size}/50`;
  const issues = deck.formats?.[format] ?? [];
  return issues.length ? issues.join('\n') : null;
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

/**
 * player: joga e assiste sem ver as mãos; streamer: assiste vendo as mãos;
 * organizer: cria e gerencia torneios; admin: tudo isso e muda os perfis;
 * dev: tudo do admin e as funções de desenvolvimento (ferramentas manuais, cobertura, testes).
 */
export type Role = 'player' | 'streamer' | 'organizer' | 'admin' | 'dev';

export const ROLE_LABEL: Record<Role, string> = { player: 'Player', streamer: 'Streamer', organizer: 'Organizador', admin: 'Admin', dev: 'Dev' };
/** Poderes de administrador (o Dev é um Admin com as ferramentas de desenvolvimento). */
export const isAdmin = (role: Role | undefined) => role === 'admin' || role === 'dev';
/**
 * Funções de desenvolvimento, escondidas do público: ferramentas manuais na partida,
 * cobertura das cartas, opções de teste e treino no servidor contra o bot.
 */
export const isDev = (role: Role | undefined) => role === 'dev';

export interface User {
  id: string;
  /** Nome da conta Google (só você vê; o nome público é o do perfil de estatísticas). */
  name: string | null;
  email: string | null;
  picture: string | null;
  role: Role;
}

export interface AdminUser extends User {
  createdAt: string;
  lastLoginAt: string;
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
  admin: {
    users: (q = '') => get<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(q)}`),
    setRole: (id: string, role: Role) => send<User>('PUT', `/api/admin/users/${encodeURIComponent(id)}/role`, { role }),
  },
  tournaments: {
    list: () => get<{ tournaments: TournamentSummary[]; canCreate: boolean }>('/api/tournaments'),
    get: (id: string) => get<TournamentDetail>(`/api/tournaments/${encodeURIComponent(id)}`),
    create: (t: TournamentInput) => send<TournamentDetail>('POST', '/api/tournaments', t),
    update: (id: string, t: TournamentInput) => send<TournamentDetail>('PUT', `/api/tournaments/${encodeURIComponent(id)}`, t),
    remove: (id: string) => send<void>('DELETE', `/api/tournaments/${encodeURIComponent(id)}`),
    register: (id: string, deckId: string) => send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/register`, { deckId }),
    /** Check-in (torneios com hora marcada; abre 30 min antes do início). */
    checkIn: (id: string) => send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/checkin`),
    /** Torneios em que a conta está em jogo agora (atalho da tela inicial). */
    me: () => get<{ entries: TournamentMine[] }>('/api/tournaments/me'),
    /** Cancela a inscrição ou, com o torneio em andamento, desiste. */
    leave: (id: string) => send<TournamentDetail>('DELETE', `/api/tournaments/${encodeURIComponent(id)}/register`),
    start: (id: string) => send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/start`),
    next: (id: string) => send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/next`),
    finish: (id: string) => send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/finish`),
    /** Placar da série [p1, p2] ([0, 0] apaga). */
    setScore: (id: string, matchId: number, wins: [number, number]) =>
      send<TournamentDetail>('PUT', `/api/tournaments/${encodeURIComponent(id)}/matches/${matchId}/result`, { wins }),
    drop: (id: string, userId: string) =>
      send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/players/${encodeURIComponent(userId)}/drop`),
    play: (id: string, matchId: number) => send<OnlineSeat>('POST', `/api/tournaments/${encodeURIComponent(id)}/matches/${matchId}/play`),
  },
  /** Auditoria: replay e relatos de problemas das partidas gravadas (ranqueadas e de torneio). */
  matches: {
    replay: (id: number) => get<Record<string, unknown>>(`/api/matches/${id}/replay`),
    report: (id: number, text: string) => send<MatchReport>('POST', `/api/matches/${id}/report`, { text }),
  },
  reports: {
    list: (opts: { tournament?: string; status?: 'open' | 'resolved' | 'all' } = {}) =>
      get<{ reports: MatchReport[] }>(
        `/api/reports?${new URLSearchParams({ ...(opts.tournament ? { tournament: opts.tournament } : {}), status: opts.status ?? 'open' })}`,
      ),
    resolve: (id: number, resolved: boolean, note?: string) => send<MatchReport>('PUT', `/api/reports/${id}`, { resolved, note }),
  },
  online: {
    config: () => get<{ timeBankMs: number; botRooms: boolean }>('/api/online/config'),
    active: () => get<ActiveRoom[]>('/api/online/active'),
    /** Contadores do menu; a consulta também conta este navegador como conectado. */
    stats: () => get<OnlineStats>('/api/online/stats'),
    /** Treino contra o bot transmitido: o servidor joga pelo bot e a partida aparece em "Assistir" (exige login). */
    botRoom: (deckId: string, botDeckId: string, format: FormatId, first?: PlayerId) =>
      send<{ roomId: string; token: string }>('POST', '/api/online/bot', { deckId, botDeckId, format, ...(first !== undefined ? { first } : {}) }),
    live: () => get<{ rooms: LiveRoom[]; hands: boolean }>('/api/online/live'),
    byCode: (code: string) => get<LiveRoom>(`/api/online/watch/${encodeURIComponent(code)}`),
    room: (roomId: string) => get<LiveRoom>(`/api/online/rooms/${encodeURIComponent(roomId)}`),
    watchUrl: (roomId: string, hands: boolean) => `/api/online/rooms/${roomId}/watch${hands ? '?hands=1' : ''}`,
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
    /** Mensagem do chat da partida (o servidor censura palavrões antes de repassar). */
    chat: (roomId: string, t: string, text: string) => send<void>('POST', `/api/online/rooms/${roomId}/chat`, { t, text }),
    /** Lançamento do dado do sorteio (velocidade em larguras/alturas da mesa por segundo). */
    dice: (roomId: string, t: string, vx: number, vy: number) => send<void>('POST', `/api/online/rooms/${roomId}/dice`, { t, vx, vy }),
    rematch: (roomId: string, t: string) => send<void>('POST', `/api/online/rooms/${roomId}/rematch`, { t }),
    leave: (roomId: string, t: string) => send<void>('POST', `/api/online/rooms/${roomId}/leave`, { t }),
    replay: (roomId: string) => get<Record<string, unknown>>(`/api/online/rooms/${roomId}/replay`),
    eventsUrl: (roomId: string, t: string) => `/api/online/rooms/${roomId}/events?t=${encodeURIComponent(t)}`,
  },
};

// ------------------------------------------------------------------ online

export type QueueKind = 'casual' | 'ranked';

export interface OnlineSeat {
  roomId: string;
  token: string;
}

/** Espectador: assiste a uma sala (com as mãos à mostra, se for streamer ou admin). */
export interface WatchTarget {
  roomId: string;
  hands: boolean;
}

export type RoomQueue = 'private' | QueueKind | 'bot' | 'tournament';

export interface ActiveRoom extends OnlineSeat {
  status: 'waiting' | 'playing';
  queue: RoomQueue;
  code: string | null;
}

/** Partida na lista "Assistir". */
export interface LiveRoom {
  id: string;
  /** Quem pede joga esta partida (só na lista "Assistir"): não dá para vê-la com as mãos. */
  mine?: boolean;
  queue: RoomQueue;
  format: FormatId;
  status: 'playing' | 'finished';
  players: Array<{
    name: string;
    leader: string;
    leaderName: string | null;
    leaderImage: string | null;
    colors: string[];
    tier: string;
    bounty: number;
    bot: boolean;
    life: number;
    hand: number;
  }>;
  turn: number;
  spectators: number;
  createdAt: number;
  /** Jogo de uma partida de torneio. */
  tournament: { id: string; name: string; round: number; label: string; game: number; bestOf: number } | null;
}

/** Contadores públicos do menu (só números). */
export interface OnlineStats {
  /** Pessoas no menu, jogando, na fila ou assistindo. */
  online: number;
  /** Partidas em andamento, por tipo de sala. */
  playing: Record<RoomQueue, number>;
  /** Salas privadas esperando o segundo jogador. */
  waiting: number;
  queue: Record<QueueKind, Record<FormatId, number>>;
  spectators: number;
}

export type QueuePoll =
  | { status: 'waiting'; waited: number; players: number }
  | { status: 'matched'; roomId: string; token: string };

export interface OnlineRoomInfo {
  id: string;
  code: string | null;
  queue: RoomQueue;
  format: FormatId;
  /** Jogo de uma partida de torneio; `score`: placar da série antes deste jogo, na ordem dos assentos. */
  tournament: {
    id: string;
    name: string;
    round: number;
    label: string;
    matchId: number;
    game: number;
    bestOf: number;
    score: number[];
  } | null;
  status: 'waiting' | 'playing' | 'finished';
  /** Seu assento; null = você está assistindo. */
  you: PlayerId | null;
  players: Array<{ name: string; bounty: number; tier: string; leader: string; connected: boolean; bot: boolean }>;
  spectators: number;
  clock: { remaining: [number, number]; running: PlayerId | null; total: number; awaySince: number | null };
  result: { matchId: number | null; bounty: Array<{ before: number | null; after: number | null }> | null; error?: string } | null;
  rematch: [boolean, boolean];
}

// ------------------------------------------------------------------ torneios

export type TournamentStructure = 'swiss' | 'single';
export type TournamentStatus = 'registration' | 'running' | 'finished';
/** Não há empate no One Piece TCG. */
export type TournamentResult = 'p1' | 'p2';

export const STRUCTURE_LABEL: Record<TournamentStructure, string> = { swiss: 'Suíço', single: 'Eliminação simples' };
export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  registration: 'Inscrições abertas',
  running: 'Em andamento',
  finished: 'Encerrado',
};

export interface TournamentInput {
  name: string;
  description: string;
  format: FormatId;
  structure: TournamentStructure;
  /** Rodadas do suíço: null = calculado pelo número de inscritos no início. */
  rounds: number | null;
  /** Partidas do suíço: melhor de 1 ou de 3. */
  swissBestOf: number;
  /** Suíço: quantos vão para a eliminatória no fim (null = sem top cut). */
  topCut: number | null;
  /** Eliminatória: melhor de 3 / de 5 a partir da fase com estas vagas (8 = quartas; null = nunca). */
  bo3From: number | null;
  bo5From: number | null;
  maxPlayers: number | null;
  /** ISO. Com `checkIn`, o torneio começa sozinho nesta hora. */
  startsAt: string | null;
  /** Check-in 30 min antes, início automático na hora e tolerância por rodada (W.O. automático). */
  checkIn: boolean;
  /** Minutos para entrar na sala em cada rodada (1 a 60). */
  toleranceMin: number;
}

export interface TournamentSummary {
  id: string;
  name: string;
  format: FormatId;
  structure: TournamentStructure;
  topCut: number | null;
  status: TournamentStatus;
  round: number;
  totalRounds: number | null;
  players: number;
  maxPlayers: number | null;
  startsAt: string | null;
  checkIn: boolean;
  checkInOpensAt: string | null;
  organizerName: string | null;
  /** Você está inscrito. */
  registered: boolean;
}

/** Torneio em que a conta está em jogo agora (check-in aberto ou em andamento), para o atalho da tela inicial. */
export interface TournamentMine {
  id: string;
  name: string;
  status: TournamentStatus;
  startsAt: string | null;
  checkInOpensAt: string | null;
  checkedIn: boolean;
  round: number;
  label: string | null;
  /** Prazo para entrar na sala na rodada atual. */
  deadline: string | null;
  match: {
    id: number;
    table: number;
    /** null = bye. */
    opponent: string | null;
    bestOf: number;
    game: number;
    result: TournamentResult | 'bye' | 'none' | null;
    winner: string | null;
    room: 'waiting' | 'playing' | 'finished' | null;
  } | null;
}

export interface TournamentPlayerRef {
  userId: string;
  name: string;
}

export interface TournamentMatchInfo {
  id: number;
  table: number;
  p1: TournamentPlayerRef;
  /** null = bye. */
  p2: TournamentPlayerRef | null;
  bestOf: number;
  /** Jogos vencidos por p1 e p2 na série. */
  wins: [number, number];
  /** Jogo da série em disputa (1, 2, 3…). */
  game: number;
  /** none = W.O. duplo (ninguém apareceu). */
  result: TournamentResult | 'bye' | 'none' | null;
  winner: string | null;
  /** game = sala online; drop = desistência; noshow = W.O. automático. */
  reportedBy: 'game' | 'bye' | 'drop' | 'noshow' | 'organizer' | null;
  roomId: string | null;
  /** Situação da sala online (null = nenhuma sala aberta agora). */
  room: 'waiting' | 'playing' | 'finished' | null;
  /** Cada jogador já entrou na sala da série (ou, na rodada 1, fez check-in). */
  present: [boolean, boolean];
  /** Jogos disputados nas salas desta série (todos ficam gravados). `statsMatchId`: replay, para quem pode vê-lo. */
  games: TournamentGame[];
}

export interface TournamentGame {
  game: number;
  winner: TournamentPlayerRef | null;
  /** Entrou no placar da série. */
  counted: boolean;
  playedAt: string;
  statsMatchId: number | null;
}

/** Problema relatado por um jogador ao fim de uma partida ranqueada ou de torneio. */
export interface MatchReport {
  id: number;
  matchId: number;
  tournamentId: string | null;
  reporterId: string;
  reporterName: string;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
  /** A partida gravada (quando a lista vem com o resumo). */
  match?: MatchSummary | null;
}

export interface MatchSummary {
  id: number;
  queue: RoomQueue | string;
  format: FormatId | string;
  winner: number | null;
  turns: number | null;
  reason: string | null;
  playedAt: string;
  players: Array<{ seat: number; name: string; userId: string | null; leader: string; deckId: string | null; won: boolean }>;
  tournament: { id: string; name: string; matchId: number; game: number; round: number; table: number } | null;
}

export interface TournamentStanding {
  rank: number;
  userId: string;
  name: string;
  points: number;
  wins: number;
  losses: number;
  byes: number;
  omw: number;
  oomw: number;
  dropped: boolean;
  /** Entrou na fase eliminatória (top cut ou chave). */
  inElim: boolean;
  elimWins: number;
  alive: boolean;
}

export type TournamentStage = 'swiss' | 'elim';

export interface TournamentDetail {
  id: string;
  name: string;
  description: string;
  format: FormatId;
  structure: TournamentStructure;
  swissBestOf: number;
  topCut: number | null;
  bo3From: number | null;
  bo5From: number | null;
  status: TournamentStatus;
  round: number;
  /** Fase da rodada atual. */
  stage: TournamentStage | null;
  /** Rodadas previstas (suíço + top cut, ou a chave). */
  totalRounds: number;
  swissRounds: number | null;
  /** Suíço com rodadas calculadas pelo número de inscritos. */
  roundsAuto: boolean;
  /** Relógio de cada jogador em cada jogo (ms): quem zera o tempo perde. */
  clockMs: number;
  maxPlayers: number | null;
  startsAt: string | null;
  /** Torneio com hora marcada: check-in, início automático e W.O. por ausência. */
  checkIn: boolean;
  checkInMs: number;
  toleranceMin: number;
  toleranceMs: number;
  checkInOpensAt: string | null;
  checkInOpen: boolean;
  /** Inscritos que já fizeram check-in. */
  checkedIn: number;
  roundAt: string | null;
  /** Prazo para entrar na sala na rodada atual (null = sem tolerância correndo). */
  deadline: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  organizerName: string | null;
  canManage: boolean;
  canRegister: boolean;
  me: {
    deckId: string | null;
    deckName: string;
    leader: string;
    dropped: boolean;
    matchId: number | null;
    checkedInAt: string | null;
  } | null;
  players: Array<{
    userId: string;
    name: string;
    seed: number | null;
    dropped: boolean;
    checkedIn: boolean;
    leader: string;
    leaderName: string | null;
    leaderImage: string | null;
    colors: string[];
    /** Lista do deck: só para o organizador, o próprio jogador e, no fim, para todos. */
    deck: { name: string; leader: string; cards: Array<{ id: string; count: number; name: string | null }> } | null;
  }>;
  rounds: Array<{ round: number; stage: TournamentStage; label: string; bestOf: number; matches: TournamentMatchInfo[] }>;
  standings: TournamentStanding[];
  /** Todas as partidas da rodada atual têm resultado. */
  roundComplete: boolean;
  /** O que o botão de avançar faz: outra rodada do suíço, o top cut, a próxima fase da chave ou encerrar. */
  next: 'swiss' | 'cut' | 'elim' | 'finish' | null;
  /** Relatos abertos dos jogadores (só para quem gerencia). */
  openReports: number;
}

/** Vitórias necessárias numa melhor de N. */
export const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1;

/** Nome da fase da eliminatória pelo número de vagas. */
export function phaseLabel(size: number): string {
  if (size <= 2) return 'Final';
  if (size === 4) return 'Semifinal';
  if (size === 8) return 'Quartas de final';
  if (size === 16) return 'Oitavas de final';
  return `Rodada de ${size}`;
}

// ------------------------------------------------------------------ estatísticas

export interface MatchUpload {
  mode: 'bot';
  format: FormatId;
  seed: number;
  firstPlayer?: PlayerId;
  /** O vencedor do sorteio escolheu quem começa (primeira ação). */
  chooseFirst?: boolean;
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
  /** `bot`: partidas bot x bot de versões antigas (ficam fora das estatísticas de pessoas). */
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
