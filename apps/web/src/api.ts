import { type MessageKey, type Params, t, tryT } from './i18n';
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
  /** Por formato: o que impede o deck de ser usado nele (vazio = permitido), em português. */
  formats: Record<FormatId, string[]>;
  /** Os mesmos motivos, na mesma ordem, com a chave `rules.…` para traduzir (servidores antigos não mandam). */
  formatCodes?: Record<FormatId, Array<{ code: string; params: Params }>>;
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
  if (!deck.valid) return t('labels.deckIncomplete', { size: deck.size });
  const issues = deck.formats?.[format] ?? [];
  const codes = deck.formatCodes?.[format];
  return issues.length ? issues.map((text, i) => tryT(codes?.[i]?.code, codes?.[i]?.params) ?? text).join('\n') : null;
}

/** Agrupa decks para listas: meus, da comunidade (outros jogadores) e prontos. O título é chave (`t(title)`). */
export function deckGroups(decks: DeckSummary[]): Array<[MessageKey, DeckSummary[]]> {
  return [
    ['labels.deckGroup.mine', decks.filter((d) => d.kind === 'user' && d.mine)],
    ['labels.deckGroup.community', decks.filter((d) => d.kind === 'user' && !d.mine)],
    ['labels.deckGroup.builtin', decks.filter((d) => d.kind === 'builtin')],
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

export type DeckInput = Pick<DeckList, 'name' | 'leader' | 'cards' | 'arts'>;

export type ApiCard = CardData & { provisional?: boolean };

/** Corpo de uma resposta de erro do servidor: `error` em português e `errorCode` (+ `errorParams`) para traduzir. */
type ErrorBody = { error?: string; errorCode?: string; errorParams?: Record<string, unknown> } & Record<string, unknown>;

const isParams = (v: unknown): v is Params => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parâmetros de um erro prontos para a mensagem: só os valores simples; o motivo vindo do motor
 * (`issueCode` + `issueParams`, ex.: carta banida no formato) vira `{issue}` no idioma em vigor.
 */
function errorParams(raw: Record<string, unknown> | undefined): Params | undefined {
  if (!isParams(raw)) return undefined;
  const out: Params = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  const issue = typeof raw.issueCode === 'string' ? tryT(raw.issueCode, isParams(raw.issueParams) ? raw.issueParams : undefined) : undefined;
  if (issue) out.issue = issue;
  return out;
}

/**
 * Texto de um erro do servidor no idioma em vigor: a chave `errors.<errorCode>` se o
 * dicionário a conhece, senão o texto em português que veio em `error`, senão `fallback`.
 */
export function errorMessage(body: ErrorBody | null | undefined, fallback: string): string {
  const code = typeof body?.errorCode === 'string' ? body.errorCode : null;
  return (code ? tryT(`errors.${code}`, errorParams(body?.errorParams)) : undefined) ?? (typeof body?.error === 'string' ? body.error : null) ?? fallback;
}

/** Erro da API com o status e o corpo da resposta (ex.: a sala da partida em andamento). */
export class ApiError extends Error {
  readonly errorCode?: string;
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    if (typeof data.errorCode === 'string') this.errorCode = data.errorCode;
  }
}

/** ApiError a partir de uma resposta com erro (o corpo pode não ser JSON). */
async function apiError(res: Response, url: string): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return new ApiError(errorMessage(body, t('errors.http', { url, status: res.status })), res.status, body ?? {});
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'x-deck-owner': ownerToken() } });
  if (!res.ok) throw await apiError(res, url);
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
  if (!res.ok) throw await apiError(res, `${method} ${url}`);
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

/**
 * player: joga e assiste sem ver as mãos; streamer: assiste vendo as mãos;
 * organizer: cria e gerencia torneios; admin: tudo isso e muda os perfis;
 * dev: tudo do admin e as funções de desenvolvimento (ferramentas manuais, cobertura, testes).
 */
export type Role = 'player' | 'streamer' | 'organizer' | 'admin' | 'dev';

/** Nome de cada perfil: chave do dicionário (mostrar com `t(ROLE_LABEL[role])`). */
export const ROLE_LABEL: Record<Role, MessageKey> = {
  player: 'labels.role.player',
  streamer: 'labels.role.streamer',
  organizer: 'labels.role.organizer',
  admin: 'labels.role.admin',
  dev: 'labels.role.dev',
};
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
  /** Foto mostrada: a enviada pelo usuário ou, sem ela, a do Google. */
  picture: string | null;
  /** O usuário enviou a própria foto (pode voltar para a do Google). */
  customPicture: boolean;
  role: Role;
  /** Plano de apoio ativo (null = sem plano). */
  supporter: SupporterState | null;
}

// ------------------------------------------------------------------ apoio ao projeto

/** Planos de apoio mensal, do menor para o maior. */
export type SupporterTier = 'grumete' | 'tripulante' | 'capitao' | 'almirante';
export const SUPPORTER_TIERS: SupporterTier[] = ['grumete', 'tripulante', 'capitao', 'almirante'];
export const TIER_LABEL: Record<SupporterTier, string> = { grumete: 'Grumete', tripulante: 'Tripulante', capitao: 'Capitão', almirante: 'Almirante' };
export const tierRank = (t: SupporterTier | null | undefined) => (t ? SUPPORTER_TIERS.indexOf(t) + 1 : 0);
/** A conta tem o benefício do plano `min` (admins têm todos, para testar e moderar). */
export const hasPerk = (u: User | null | undefined, min: SupporterTier) => Boolean(u && (isAdmin(u.role) || tierRank(u.supporter?.tier) >= tierRank(min)));

export interface SupporterState {
  tier: SupporterTier;
  /** Até quando vale (null = sem prazo). */
  until: string | null;
  source: 'manual' | 'apoiase' | 'kofi' | null;
  /** Aparece na lista pública de Apoiadores. */
  public: boolean;
}

export interface TierInfo {
  id: SupporterTier;
  label: string;
  price: number;
  perks: string[];
}

export interface SupportInfo {
  enabled: boolean;
  pix: { key: string; name: string; city: string; codes: Array<{ amount: number | null; code: string }> } | null;
  coffeeUrl: string | null;
  monthlyUrl: string | null;
  contactUrl: string | null;
  /** O plano mensal vem da Apoia.se pelo e-mail da conta (mostra "Já apoio: verificar"). */
  apoiase: boolean;
  /** Custo mensal do site (meta). */
  goal: number | null;
  /** Soma mensal dos planos ativos. */
  covered: number;
  supporters: number;
  tiers: TierInfo[];
  me: (Omit<SupporterState, 'tier'> & { tier: SupporterTier | null }) | null;
}

export interface SupporterPayment {
  id: string;
  email: string | null;
  kind: string;
  tier: SupporterTier | null;
  amount: number;
  currency: string;
  paidAt: string;
  userId: string | null;
  userName: string | null;
}

export interface AdminUser extends User {
  createdAt: string;
  lastLoginAt: string;
  supporterTier: SupporterTier | null;
  supporterUntil: string | null;
  supporterSource: 'manual' | 'apoiase' | 'kofi' | null;
}

export interface AppConfig {
  cardImages: boolean;
  languages: string[];
  googleClientId: string | null;
  /** O apoio está configurado: o item "Apoiar o projeto" aparece. */
  support: boolean;
  /** supporters: o site só abre para apoiadores (homologação). */
  access: 'open' | 'supporters';
  /** Chave pública para as notificações (null = desligadas no servidor). */
  pushKey?: string | null;
}

export const api = {
  config: () => get<AppConfig>('/api/config'),
  push: {
    /** Grava a inscrição deste navegador nas notificações, com o idioma e os avisos escolhidos. */
    save: (subscription: PushSubscriptionJSON, prefs: { locale: string; matches: boolean; tournaments: boolean }) =>
      send<void>('PUT', '/api/push/subscription', { subscription, ...prefs }),
    remove: (endpoint: string) => send<void>('DELETE', '/api/push/subscription', { endpoint }),
  },
  me: () => get<{ user: User | null }>('/api/auth/me'),
  /** Troca o ID token do botão do Google por uma sessão (cookie). */
  googleLogin: (credential: string) => send<{ user: User; claimedDecks: number }>('POST', '/api/auth/google', { credential }),
  logout: () => send<void>('POST', '/api/auth/logout'),
  /** Troca a foto da conta (data URL já reduzida; ver `picture.ts`). */
  setPicture: (image: string) => send<{ user: User }>('PUT', '/api/auth/me/picture', { image }),
  /** Remove a foto enviada: volta a valer a do Google. */
  removePicture: () => send<{ user: User }>('DELETE', '/api/auth/me/picture'),
  decks: () => get<DeckSummary[]>('/api/decks'),
  deck: (id: string) =>
    get<{ deck: DeckList & { kind: DeckSummary['kind']; mine: boolean }; cards: ApiCard[]; summary: DeckSummary }>(
      `/api/decks/${encodeURIComponent(id)}`,
    ),
  cards: () => get<ApiCard[]>('/api/cards'),
  coverage: () => get<{ total: CoverageRow; sets: CoverageRow[] }>('/api/coverage'),
  createDeck: (d: DeckInput) => send<DeckSummary>('POST', '/api/decks', d),
  updateDeck: (id: string, d: DeckInput) => send<DeckSummary>('PUT', `/api/decks/${encodeURIComponent(id)}`, d),
  /** Só o nome: o dono ou um admin/dev (em decks de outros jogadores). */
  renameDeck: (id: string, name: string) => send<DeckSummary>('PUT', `/api/decks/${encodeURIComponent(id)}/name`, { name }),
  deleteDeck: (id: string) => send<void>('DELETE', `/api/decks/${encodeURIComponent(id)}`),
  /** Envia o replay de uma partida terminada; o servidor refaz a partida antes de gravar as estatísticas. */
  saveMatch: (m: MatchUpload) => send<{ id: number }>('POST', '/api/matches', m).catch(() => undefined),
  player: () => get<PlayerProfile | null>('/api/players/me'),
  rename: (name: string) => send<PlayerProfile>('PUT', '/api/players/me', { name }),
  statsMeta: () => get<StatsMeta>('/api/stats/meta'),
  stats: (f: StatsQuery) => get<StatsOverview>(`/api/stats?${statsQs(f)}`),
  cardStats: (f: StatsQuery) => get<CardStatsResponse>(`/api/stats/cards?${statsQs(f)}`),
  /** Amostra das Estatísticas Pro (top 3 da ranqueada e dos torneios nos últimos 30 dias). */
  statsTeaser: (format?: string) =>
    get<{ total: number; leaders: number; top: Array<WinCount & { leader: string }>; cards: Record<string, CardInfo> }>(
      `/api/stats/teaser${format ? `?format=${encodeURIComponent(format)}` : ''}`,
    ),
  trend: (f: StatsQuery, weeks = 6) => get<TrendResponse>(`/api/stats/trend?${statsQs({ ...f, weeks: String(weeks) })}`),
  tutorial: {
    progress: () => get<TutorialProgressDto>('/api/tutorial/progress'),
    saveProgress: (p: { done: string[]; dismissed: boolean; completed: boolean; reset?: boolean }) => send<TutorialProgressDto>('PUT', '/api/tutorial/progress', p),
    /** Evento anônimo de lição (sem esperar resposta; falhas são ignoradas). */
    event: (lesson: string, event: TutorialEventKind, step = '') => send<void>('POST', '/api/tutorial/events', { lesson, event, step }).catch(() => undefined),
  },
  admin: {
    tutorial: (days = 30) => get<{ days: number; since: string; lessons: TutorialFunnel[] }>(`/api/admin/tutorial?days=${days}`),
    users: (q = '') => get<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(q)}`),
    setRole: (id: string, role: Role) => send<User>('PUT', `/api/admin/users/${encodeURIComponent(id)}/role`, { role }),
    /** Plano dado à mão; `until` "AAAA-MM-DD" ou null (sem prazo). */
    setSupporter: (id: string, tier: SupporterTier | null, until: string | null) =>
      send<Pick<AdminUser, 'id' | 'supporterTier' | 'supporterUntil' | 'supporterSource'>>('PUT', `/api/admin/users/${encodeURIComponent(id)}/supporter`, {
        tier,
        until,
      }),
    payments: () => get<SupporterPayment[]>('/api/admin/support/payments'),
    sponsors: () => get<AdminSponsor[]>('/api/admin/sponsors'),
    createSponsor: (s: SponsorInput) => send<AdminSponsor>('POST', '/api/admin/sponsors', s),
    updateSponsor: (id: string, s: SponsorInput) => send<AdminSponsor>('PUT', `/api/admin/sponsors/${encodeURIComponent(id)}`, s),
    deleteSponsor: (id: string) => send<void>('DELETE', `/api/admin/sponsors/${encodeURIComponent(id)}`),
    /** Logo em data URL (PNG, JPEG ou WebP); null apaga. */
    setSponsorLogo: (id: string, image: string | null) => send<AdminSponsor>('PUT', `/api/admin/sponsors/${encodeURIComponent(id)}/logo`, { image }),
  },
  sponsors: (placement?: 'tournaments' | 'home') =>
    get<{ sponsors: PublicSponsor[]; contactUrl: string | null }>(`/api/sponsors${placement ? `?placement=${placement}` : ''}`),
  /** Acesso ao site (homologação só para apoiadores). */
  access: () =>
    get<{ mode: 'open' | 'supporters'; allowed: boolean; reason: 'open' | 'login' | 'admin' | 'supporter' | 'remote' | 'denied' | 'unverified'; homeUrl: string | null }>(
      '/api/access',
    ),
  support: {
    info: () => get<SupportInfo>('/api/support'),
    supporters: () => get<Array<{ name: string; tier: SupporterTier }>>('/api/support/supporters'),
    setPublic: (visible: boolean) => send<{ public: boolean }>('PUT', '/api/support/me', { public: visible }),
    /** Consulta agora, na Apoia.se, o apoio do e-mail da conta. */
    verifyApoiase: () =>
      send<{ isBacker: boolean; isPaidThisMonth: boolean; tier: SupporterTier | null; until: string | null }>('POST', '/api/support/apoiase/sync'),
  },
  tournaments: {
    list: () => get<{ tournaments: TournamentSummary[]; canCreate: boolean; organize: OrganizeLimits | null }>('/api/tournaments'),
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
    /** Derrota dupla: os dois perdem (`dropBoth`: e saem do torneio). */
    doubleLoss: (id: string, matchId: number, dropBoth: boolean) =>
      send<TournamentDetail>('PUT', `/api/tournaments/${encodeURIComponent(id)}/matches/${matchId}/result`, { result: 'double', dropBoth }),
    drop: (id: string, userId: string) =>
      send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/players/${encodeURIComponent(userId)}/drop`),
    /** Desfaz a desistência (`restoreMatch`: a partida da rodada atual volta a ficar pendente). */
    reinstate: (id: string, userId: string, restoreMatch: boolean) =>
      send<TournamentDetail>('POST', `/api/tournaments/${encodeURIComponent(id)}/players/${encodeURIComponent(userId)}/reinstate`, { restoreMatch }),
    /** Libera a inscrição atrasada (para todos, ou só para o apelido `player`) ou a fecha. */
    lateEntry: (id: string, open: boolean, player?: string) =>
      send<TournamentDetail>('PUT', `/api/tournaments/${encodeURIComponent(id)}/late`, { open, player }),
    play: (id: string, matchId: number) => send<OnlineSeat>('POST', `/api/tournaments/${encodeURIComponent(id)}/matches/${matchId}/play`),
    /** Kit de divulgação (quem gerencia, com o torneio encerrado). */
    recap: (id: string) => get<TournamentRecap>(`/api/tournaments/${encodeURIComponent(id)}/recap`),
  },
  /** Auditoria: replay e relatos de problemas (bugs) das partidas gravadas. */
  matches: {
    replay: (id: number) => get<Record<string, unknown>>(`/api/matches/${id}/replay`),
    report: (id: number, form: ReportForm) => send<MatchReport>('POST', `/api/matches/${id}/report`, form),
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
    /** `key`: tela de transmissão (fonte do OBS); a chave faz as vezes do login e as opções do streamer decidem o que ela vê. */
    watchUrl: (roomId: string, hands: boolean, key?: string) =>
      `/api/online/rooms/${roomId}/watch${key ? `?k=${encodeURIComponent(key)}` : hands ? '?hands=1' : ''}`,
    /** `showHands`: libera as mãos dos jogadores para quem transmite (streamer, com atraso). */
    createRoom: (deckId: string, format: FormatId, showHands = false) =>
      send<{ roomId: string; code: string; token: string }>('POST', '/api/online/rooms', { deckId, format, ...(showHands ? { showHands } : {}) }),
    joinRoom: (code: string, deckId: string) => send<{ roomId: string; token: string }>('POST', '/api/online/rooms/join', { code, deckId }),
    /** `leader` (só casual): Líder do oponente desejado no primeiro minuto. */
    enqueue: (deckId: string, format: FormatId, queue: QueueKind, leader?: string | null) =>
      send<{ ticket: string }>('POST', '/api/online/queue', { deckId, format, queue, ...(leader ? { leader } : {}) }),
    /** Líderes que dá para escolher na fila casual do formato (e quantos estão na fila com cada um). */
    leaders: (format: FormatId) => get<QueueLeader[]>(`/api/online/leaders?format=${encodeURIComponent(format)}`),
    poll: (ticket: string) => get<QueuePoll>(`/api/online/queue/${encodeURIComponent(ticket)}`),
    cancel: (ticket: string) => send<void>('DELETE', `/api/online/queue/${encodeURIComponent(ticket)}`),
    act: (roomId: string, t: string, seq: number, action: Action) =>
      send<{ ok: true; actionCount: number }>('POST', `/api/online/rooms/${roomId}/action`, { t, seq, action }),
    emote: (roomId: string, t: string, emote: string) => send<void>('POST', `/api/online/rooms/${roomId}/emote`, { t, emote }),
    /** Mensagem do chat da partida (o servidor censura palavrões antes de repassar). */
    chat: (roomId: string, t: string, text: string) => send<void>('POST', `/api/online/rooms/${roomId}/chat`, { t, text }),
    /** O app saiu da tela ou voltou (decide se a vez que chega vira notificação). Vai mesmo com a página fechando. */
    focus: (roomId: string, t: string, visible: boolean) =>
      fetch(`/api/online/rooms/${roomId}/focus`, {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', 'x-deck-owner': ownerToken() },
        body: JSON.stringify({ t, visible }),
      }).catch(() => undefined),
    /** Lançamento do dado do sorteio (velocidade em larguras/alturas da mesa por segundo). */
    dice: (roomId: string, t: string, vx: number, vy: number) => send<void>('POST', `/api/online/rooms/${roomId}/dice`, { t, vx, vy }),
    rematch: (roomId: string, t: string) => send<void>('POST', `/api/online/rooms/${roomId}/rematch`, { t }),
    leave: (roomId: string, t: string) => send<void>('POST', `/api/online/rooms/${roomId}/leave`, { t }),
    replay: (roomId: string) => get<Record<string, unknown>>(`/api/online/rooms/${roomId}/replay`),
    eventsUrl: (roomId: string, t: string) => `/api/online/rooms/${roomId}/events?t=${encodeURIComponent(t)}`,
  },
  /** Modo transmissão (perfil Streamer ou Admin): o link da fonte do OBS e a partida da live. */
  broadcast: {
    mine: () => get<BroadcastInfo>('/api/broadcast'),
    newKey: () => send<BroadcastInfo>('POST', '/api/broadcast/key'),
    choose: (roomId: string | null) => send<BroadcastInfo>('PUT', '/api/broadcast/room', { roomId }),
    settings: (s: Partial<BroadcastSettings>) => send<BroadcastInfo>('PUT', '/api/broadcast/settings', s),
    /** O que a fonte do OBS mostra agora (sem login: a chave é o segredo); `rev` muda a cada troca. */
    byKey: (key: string) => get<{ roomId: string | null; chat: boolean; rev: number }>(`/api/broadcast/${encodeURIComponent(key)}`),
  },
};

/** Opções da transmissão do streamer (ver apps/server/src/online/broadcast.ts). */
export interface BroadcastSettings {
  /** Atraso em segundos (0 a 600). */
  delayS: number;
  /** Mãos dos dois jogadores nas partidas que ele assiste (com pelo menos `minHandsDelayS` de atraso). */
  handsPlayers: boolean;
  /** A mão dele nas partidas que ele joga. */
  handsOwn: boolean;
  /** Atraso nas partidas de torneio mesmo sem as mãos. */
  delayTournaments: boolean;
  /** Chat dos jogadores na tela de transmissão. */
  chat: boolean;
}

/** Transmissão da conta: o link (null antes de criar), a partida escolhida e as opções. */
export interface BroadcastInfo extends BroadcastSettings {
  key: string | null;
  roomId: string | null;
  minHandsDelayS: number;
}

/** Endereço da tela de transmissão (fonte do OBS) de uma chave. */
export const broadcastUrl = (key: string) => `${location.origin}/?transmissao=${encodeURIComponent(key)}`;

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
  /** Tela de transmissão: a chave do link faz as vezes do login para ver as mãos. */
  key?: string;
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
  /** As mãos dos jogadores podem aparecer para quem transmite (torneio ou sala privada liberada). */
  handsAllowed?: boolean;
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
  /** `leaderWait`: quanto falta para a escolha de Líder (`wantLeader`) expirar; 0 = qualquer oponente. */
  | { status: 'waiting'; waited: number; players: number; wantLeader?: string | null; leaderWait?: number }
  | { status: 'matched'; roomId: string; token: string };

/** Líder que dá para escolher como oponente na fila casual. */
export interface QueueLeader {
  id: string;
  name: string;
  imageUrl: string | null;
  colors: string[];
  /** Jogadores na fila casual do formato com este Líder agora. */
  queue: number;
}

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
  /** De quem é a visão: o seu assento, ou o do streamer que transmite a própria partida (null = pública). */
  pov?: PlayerId | null;
  players: Array<{ name: string; bounty: number; tier: string; leader: string; connected: boolean; bot: boolean; apprentice?: boolean }>;
  spectators: number;
  clock: { remaining: [number, number]; running: PlayerId | null; total: number; awaySince: number | null };
  /** `error`: texto em português; mostrar com `errorMessage(result, …)`, que traduz `errorCode`. */
  result: {
    matchId: number | null;
    bounty: Array<{ before: number | null; after: number | null }> | null;
    error?: string;
    errorCode?: string;
  } | null;
  rematch: [boolean, boolean];
  /** Atraso da mesa desta conexão em ms (quem vê as mãos); 0 ou ausente = ao vivo. */
  delay?: number;
  /** As mãos dos jogadores podem aparecer para quem transmite (torneio ou sala privada liberada). */
  handsAllowed?: boolean;
}

// ------------------------------------------------------------------ torneios

export type TournamentStructure = 'swiss' | 'single';
export type TournamentStatus = 'registration' | 'running' | 'finished';
/** Não há empate no One Piece TCG. */
export type TournamentResult = 'p1' | 'p2';

/** Chaves do dicionário (mostrar com `t(STRUCTURE_LABEL[s])`). */
export const STRUCTURE_LABEL: Record<TournamentStructure, MessageKey> = { swiss: 'labels.structure.swiss', single: 'labels.structure.single' };
export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, MessageKey> = {
  registration: 'labels.tourStatus.registration',
  running: 'labels.tourStatus.running',
  finished: 'labels.tourStatus.finished',
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
  /** Só admin: torneio do time (Torneio da Tripulação), prêmio, loja patrocinadora e inscrição antecipada de 48 h para Almirantes. */
  official?: boolean;
  prize?: string | null;
  sponsorId?: string | null;
  priority?: boolean;
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
  /** Torneio do time (Torneio da Tripulação). */
  official: boolean;
  prize: string | null;
  sponsor: PublicSponsor | null;
  /** Até quando só Almirantes se inscrevem. */
  priorityUntil: string | null;
}

/** Limites de quem organiza: Organizador/Admin sem cota; apoiador Capitão ou Almirante com cota mensal. */
export interface OrganizeLimits {
  kind: 'role' | 'supporter';
  perMonth: number | null;
  used: number;
  maxPlayers: number;
}

/** Loja patrocinadora (o que o site mostra). */
export interface PublicSponsor {
  id: string;
  name: string;
  url: string | null;
  offer: string | null;
  placements: Array<'tournaments' | 'home'>;
  logoUrl: string | null;
}

export interface AdminSponsor extends PublicSponsor {
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
  active: boolean;
}

export interface SponsorInput {
  name: string;
  url: string | null;
  offer: string | null;
  placements: Array<'tournaments' | 'home'>;
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
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
    result: TournamentResult | 'bye' | 'none' | 'loss' | null;
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
  /** none = derrota dupla (W.O. duplo ou lançada pelo organizador); loss = inscrição atrasada (derrota sem oponente). */
  result: TournamentResult | 'bye' | 'none' | 'loss' | null;
  winner: string | null;
  /** game = sala online; drop = desistência; noshow = W.O. automático; late = inscrição atrasada. */
  reportedBy: 'game' | 'bye' | 'drop' | 'noshow' | 'late' | 'organizer' | null;
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
/** Formulário de relato de bug ao fim da partida. */
export interface ReportForm {
  /** A interação que deu problema. */
  text: string;
  card?: string;
  expected?: string;
  notify?: boolean;
}

export interface MatchReport {
  id: number;
  matchId: number;
  tournamentId: string | null;
  reporterId: string;
  reporterName: string;
  /** O que aconteceu: a interação que deu problema. */
  text: string;
  /** A carta com problema. */
  card: string | null;
  /** O que deveria ter acontecido. */
  expected: string | null;
  /** O jogador quer ser avisado quando o problema for resolvido. */
  notify: boolean;
  /** Quando o aviso da correção foi enviado. */
  notifiedAt: string | null;
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

/** Carta do kit de divulgação; `image` vem pelo mesmo domínio (`/card-img/…`) para desenhar no canvas. */
export interface RecapCard {
  id: string;
  name: string;
  set: string | null;
  cost: number | null;
  category: string;
  colors: string[];
  image: string | null;
}

export interface RecapRecord {
  wins: number;
  losses: number;
  byes: number;
}

export interface RecapPlayer {
  rank: number;
  userId: string;
  name: string;
  dropped: boolean;
  deckName: string;
  leader: RecapCard;
  /** Sem o líder, ordenadas por custo, cada carta uma vez com a quantidade. */
  cards: Array<RecapCard & { count: number }>;
  swiss: RecapRecord | null;
  elim: RecapRecord | null;
}

export interface RecapRound {
  round: number;
  stage: TournamentStage;
  size: number;
  bestOf: number;
  opponent: { name: string; leader: RecapCard } | null;
  outcome: 'win' | 'loss' | 'bye' | 'none' | 'pending';
  /** Placar do ponto de vista do campeão. */
  score: [number, number];
  how: 'game' | 'bye' | 'drop' | 'noshow' | 'late' | 'organizer' | null;
  /** Jogos que contaram: venceu? começou (na play) ou foi o segundo (na draw)? null = sem o dado. */
  games: Array<{ game: number; won: boolean | null; first: boolean | null }>;
}

export interface LeaderCount {
  leader: RecapCard;
  count: number;
}

export interface TournamentRecap {
  tournament: {
    id: string;
    name: string;
    format: string;
    structure: TournamentStructure;
    topCut: number | null;
    players: number;
    swissRounds: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    organizerName: string | null;
    official: boolean;
    prize: string | null;
    sponsor: PublicSponsor | null;
    earlyFinish: boolean;
  };
  champion: RecapPlayer | null;
  campaign: RecapRound[];
  top: RecapPlayer[];
  leadersTop8: LeaderCount[];
  leadersAll: LeaderCount[];
  cardImages: boolean;
}

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
  official: boolean;
  prize: string | null;
  sponsor: PublicSponsor | null;
  /** Inscrição antecipada: até esta hora só Almirantes se inscrevem. */
  priorityUntil: string | null;
  priorityOpen: boolean;
  /** Limite de jogadores que quem pede pode escolher ao editar. */
  maxPlayersCap: number;
  canManage: boolean;
  canRegister: boolean;
  /** Inscrição atrasada liberada para quem vê (entra na rodada 2 com uma derrota). */
  canLateRegister: boolean;
  /** Para quem gerencia: a janela da inscrição atrasada está aberta (suíço, rodada 1). */
  lateWindow: boolean;
  /** Para quem gerencia: a quem a inscrição atrasada foi liberada (null = fechada). */
  lateEntry: { all: boolean; name: string | null } | null;
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
    /**
     * Para quem gerencia, nos que saíram: pode voltar ao torneio? `optional` = a partida da
     * rodada pode ser devolvida; `required` = só volta devolvendo-a; null = não pode voltar.
     */
    reinstate: 'no' | 'optional' | 'required' | null;
    checkedIn: boolean;
    /** Líder do deck: null enquanto as inscrições estão abertas (só o organizador e o próprio jogador o veem). */
    leader: string | null;
    leaderName: string | null;
    leaderImage: string | null;
    colors: string[];
    /** Plano de apoio ativo (selo ao lado do nome). */
    supporter: SupporterTier | null;
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
  if (size <= 2) return t('labels.phase.final');
  if (size === 4) return t('labels.phase.semifinal');
  if (size === 8) return t('labels.phase.quarterfinal');
  if (size === 16) return t('labels.phase.roundOf16');
  return t('labels.phase.roundOf', { n: size });
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
  /** Concluiu o tutorial: título "Aprendiz da Grand Line" (só em /api/players/me). */
  apprentice?: boolean;
}

/** Progresso do tutorial gravado no servidor (conta ou navegador). */
export interface TutorialProgressDto {
  done: string[];
  dismissed: boolean;
  apprentice: boolean;
}

export type TutorialEventKind = 'start' | 'step' | 'fail' | 'exit' | 'complete';

/** Funil de uma lição na Administração. */
export interface TutorialFunnel {
  lesson: string;
  starts: number;
  completes: number;
  exits: number;
  fails: number;
  steps: Array<{ step: string; reached: number; exits: number; fails: number }>;
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
  /** Estatísticas Pro liberadas para quem pede (plano Tripulante ou acima, ou servidor sem apoio configurado). */
  pro: boolean;
  /** O servidor separa as estatísticas gerais (casual) das Pro (ranqueada e torneios). */
  proGate: boolean;
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
