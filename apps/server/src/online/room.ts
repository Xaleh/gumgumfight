// Uma partida online: o servidor guarda o estado completo e é a única autoridade.
//
// Cada jogador recebe só a própria visão (viewFor, no motor) pelo canal SSE. As
// ações chegam por POST com a versão (actionCount) da visão em que foram feitas,
// são traduzidas para os uids reais e aplicadas com applyAction.
//
// Relógio: cada jogador tem 17min30s no total. O tempo de um jogador só corre
// enquanto uma ação ou decisão está com ele (actingPlayer). Sem tempo, ele perde.
// Se o jogador da vez ficar desconectado por ABANDON_MS, perde por abandono.
//
// Espectadores: conexões sem assento recebem a visão pública (viewFor com viewer
// null). Quem tem perfil de streamer ou admin pode pedir para ver também as mãos dos
// dois jogadores (as cartas das mãos entram como "extra" na visão pública); decks e
// Vida virada continuam escondidos.
//
// Salas de treino contra o bot (queue 'bot'): o assento do bot é jogado pelo próprio
// servidor, que decide olhando só a visão do bot (como um jogador de verdade).

import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  type Action,
  actingPlayer,
  actionFromView,
  type Aliases,
  aliasRefs,
  applyAction,
  type CardData,
  type CardDef,
  chooseBotAction,
  createAliases,
  createGame,
  type DeckList,
  type GameState,
  IllegalActionError,
  type LogEntry,
  type PlayerId,
  viewFor,
} from '@gumgum/engine';
import type { FormatId } from '../stats/catalog';

export const TIME_BANK_MS = 17 * 60_000 + 30_000;
/** Jogador da vez desconectado por este tempo perde por abandono. */
export const ABANDON_MS = 2 * 60_000;
/** Limite de ações por assento numa janela de RATE_WINDOW_MS. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10_000;
const MAX_ACTIONS = 5000;
/** Espectadores por sala. */
export const MAX_SPECTATORS = 100;
/** Pausa antes de cada jogada do bot, para a jogada ser visível. */
const BOT_DELAY_MS = 700;

export const EMOTES = ['hello', 'gg', 'nice', 'think', 'wow', 'oops', 'thanks', 'hurry'] as const;
export type EmoteId = (typeof EMOTES)[number];

/**
 * private = sala com código; casual e ranked = filas; bot = treino contra o bot do
 * servidor; tournament = partida de uma rodada de torneio.
 */
export type RoomQueue = 'private' | 'casual' | 'ranked' | 'bot' | 'tournament';

/** Partida de torneio jogada na sala. */
export interface RoomTournament {
  id: string;
  name: string;
  round: number;
  /** Id da partida em tournament_matches. */
  matchId: number;
}
export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface SeatInfo {
  ownerHash: string;
  /** Conta Google (obrigatória na ranqueada). */
  userId: string | null;
  name: string;
  bounty: number;
  tier: string;
  deckId: string | null;
  deck: DeckList;
  /** Segredo do assento: autoriza o canal SSE e as ações. */
  token: string;
  /** Assento jogado pelo bot do servidor. */
  bot?: boolean;
}

export interface RoomResult {
  matchId: number | null;
  /** Recompensa antes e depois (ranqueada). */
  bounty: Array<{ before: number | null; after: number | null }> | null;
  error?: string;
}

/** O que é gravado no banco para refazer a sala depois de reiniciar o servidor. */
export interface RoomData {
  id: string;
  code: string | null;
  queue: RoomQueue;
  format: FormatId;
  createdAt: number;
  seats: SeatInfo[];
  seed128: number[] | null;
  aliasSalt: string;
  actions: Action[];
  remaining: [number, number];
  result: RoomResult | null;
  /** Ids das salas de revanche pedidas (por assento). */
  rematch?: [boolean, boolean];
  rematchRoom?: string | null;
  tournament?: RoomTournament;
}

export interface Connection {
  /** Assento do jogador; null = espectador. */
  seat: PlayerId | null;
  /** Espectador vendo as mãos dos dois jogadores (streamer ou admin). */
  hands?: boolean;
  send: (event: string, data: unknown) => void;
  /** Encerra a resposta (o navegador reconecta sozinho). */
  end?: () => void;
  /** Definições e linhas do log já enviadas por esta conexão. */
  sentDefs: Set<string>;
  sentLog: number;
}

export interface RoomDeps {
  cards: (ids: string[]) => CardData[];
  now?: () => number;
  /** Chamado a cada mudança (para gravar no banco). */
  save?: (room: Room) => void;
  /** Fim da partida: grava as estatísticas e devolve o resultado. */
  finish?: (room: Room) => RoomResult;
  log?: (msg: string) => void;
  /** Ações por assento a cada 10 s (padrão RATE_LIMIT). */
  rateLimit?: number;
  /** Pausa antes de cada jogada do bot (padrão BOT_DELAY_MS; os testes usam 0). */
  botDelayMs?: number;
}

export type ActResult = { ok: true; actionCount: number } | { ok: false; code: number; error: string };

export const randomToken = () => randomBytes(24).toString('base64url');

export function newRoomData(
  init: Pick<RoomData, 'queue' | 'format' | 'code' | 'tournament'> & { id?: string; seats: SeatInfo[] },
): RoomData {
  return {
    ...(init.tournament ? { tournament: init.tournament } : {}),
    id: init.id ?? randomBytes(9).toString('base64url'),
    code: init.code,
    queue: init.queue,
    format: init.format,
    createdAt: Date.now(),
    seats: init.seats,
    seed128: null,
    aliasSalt: randomBytes(16).toString('hex'),
    actions: [],
    remaining: [TIME_BANK_MS, TIME_BANK_MS],
    result: null,
  };
}

export class Room {
  readonly data: RoomData;
  state: GameState | null = null;
  private aliases: Aliases | null = null;
  private readonly conns = new Set<Connection>();
  private running: PlayerId | null = null;
  private since = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  /** Desde quando o jogador da vez está sem conexão. */
  private awaySince: number | null = null;
  /** Ferramentas manuais: quantas cartas do topo do deck cada assento está olhando. */
  private peek: [number, number] = [0, 0];
  private recent: [number[], number[]] = [[], []];
  private lastEmote: [number, number] = [0, 0];
  private lastAction: Action | null = null;
  private readonly deps: Required<Pick<RoomDeps, 'now' | 'log'>> & RoomDeps;

  constructor(data: RoomData, deps: RoomDeps) {
    this.data = data;
    this.deps = { ...deps, now: deps.now ?? (() => Date.now()), log: deps.log ?? (() => {}) };
    if (data.seed128) this.rebuild();
  }

  get id() {
    return this.data.id;
  }

  get status(): RoomStatus {
    if (!this.state) return 'waiting';
    return this.state.phase === 'gameover' ? 'finished' : 'playing';
  }

  get ranked() {
    return this.data.queue === 'ranked';
  }

  seatOf(token: unknown): PlayerId | null {
    if (typeof token !== 'string') return null;
    const i = this.data.seats.findIndex((s) => s.token === token);
    return i === 0 || i === 1 ? i : null;
  }

  /** Segundo jogador entrou: embaralha e começa. */
  start() {
    if (this.state || this.data.seats.length !== 2) return;
    this.data.seed128 = [0, 1, 2, 3].map(() => randomInt(0, 2 ** 32) | 0);
    this.rebuild();
    this.save();
    this.broadcast();
  }

  private config() {
    const [a, b] = this.data.seats;
    const ids = [...new Set([a, b].flatMap((s) => [s.deck.leader, ...s.deck.cards.map((c) => c.id)]))];
    return {
      seed: 0,
      seed128: this.data.seed128!,
      cards: this.deps.cards(ids),
      players: [
        { name: a.name, deck: a.deck, isBot: Boolean(a.bot) },
        { name: b.name, deck: b.deck, isBot: Boolean(b.bot) },
      ] as [{ name: string; deck: DeckList; isBot: boolean }, { name: string; deck: DeckList; isBot: boolean }],
    };
  }

  /** Cria o jogo e refaz as ações gravadas (ao começar ou depois de reiniciar o servidor). */
  private rebuild() {
    let state = createGame(this.config());
    let i = 0;
    const salt = this.data.aliasSalt;
    this.aliases = createAliases(state, () => `k${createHmac('sha256', salt).update(String(i++)).digest('base64url').slice(0, 10)}`);
    for (const a of this.data.actions) state = applyAction(state, a);
    this.state = state;
    this.lastAction = this.data.actions[this.data.actions.length - 1] ?? null;
    // O tempo em que o servidor ficou fora do ar não conta para ninguém.
    this.startClock();
  }

  private startClock() {
    this.running = this.state && this.state.phase !== 'gameover' ? actingPlayer(this.state) : null;
    this.since = this.deps.now();
    this.awaySince = null;
    this.updatePresence();
    this.schedule();
    this.driveBot();
  }

  /** Desconta do jogador da vez o tempo desde a última mudança. */
  private settle() {
    const now = this.deps.now();
    if (this.running !== null) this.data.remaining[this.running] = Math.max(0, this.data.remaining[this.running] - (now - this.since));
    this.since = now;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running === null) return;
    const now = this.deps.now();
    const left = this.data.remaining[this.running] - (now - this.since);
    const away = this.awaySince === null ? Infinity : this.awaySince + ABANDON_MS - now;
    const wait = Math.max(0, Math.min(left, away));
    this.timer = setTimeout(() => this.tick(), wait + 5);
  }

  /** O relógio do jogador da vez acabou, ou ele está ausente há tempo demais. */
  private tick() {
    this.timer = null;
    if (this.running === null || !this.state || this.state.phase === 'gameover') return;
    this.settle();
    const p = this.running;
    const now = this.deps.now();
    const abandoned = this.awaySince !== null && now - this.awaySince >= ABANDON_MS;
    if (this.data.remaining[p] > 0 && !abandoned) return this.schedule();
    try {
      this.commit({ type: 'timeout', player: p, ...(abandoned && this.data.remaining[p] > 0 ? { abandoned: true } : {}) });
    } catch (e) {
      this.deps.log(`Partida online ${this.id}: falha no fim por tempo: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Aplica uma ação já com uids reais e avisa todo mundo. */
  private commit(action: Action) {
    this.settle();
    this.state = applyAction(this.state!, action);
    this.data.actions.push(action);
    this.lastAction = action;
    // Olhar o topo do deck vale até a próxima ação que não seja das ferramentas manuais.
    if (action.type !== 'manual') this.peek[action.player] = 0;
    else if (action.op.op === 'peek') this.peek[action.player] = Math.max(0, Math.min(action.op.count, 50));
    this.running = this.state.phase === 'gameover' ? null : actingPlayer(this.state);
    if (this.running === null || this.connected(this.running)) this.awaySince = null;
    else this.awaySince ??= this.deps.now();
    this.schedule();
    this.driveBot();
    if (this.state.phase === 'gameover' && !this.data.result) {
      try {
        this.data.result = this.deps.finish?.(this) ?? { matchId: null, bounty: null };
      } catch (e) {
        this.deps.log(`Partida online ${this.id}: falha ao gravar o resultado: ${e instanceof Error ? e.message : e}`);
        this.data.result = { matchId: null, bounty: null, error: 'Não foi possível gravar o resultado.' };
      }
    }
    this.save();
    this.broadcast();
  }

  /** Ação de um jogador, feita sobre a visão de versão `seq`. */
  act(seat: PlayerId, seq: unknown, raw: unknown): ActResult {
    if (!this.state || !this.aliases) return { ok: false, code: 409, error: 'A partida ainda não começou.' };
    if (this.state.phase === 'gameover') return { ok: false, code: 409, error: 'A partida já terminou.' };
    const action = raw as Action;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return { ok: false, code: 400, error: 'Ação inválida.' };
    }
    if (action.player !== seat) return { ok: false, code: 403, error: 'Essa ação não é sua.' };
    if (action.type === 'timeout') return { ok: false, code: 400, error: 'Ação inválida.' };
    if (action.type === 'manual' && this.ranked) {
      return { ok: false, code: 403, error: 'As ferramentas manuais não são permitidas na ranqueada.' };
    }
    if (this.data.actions.length >= MAX_ACTIONS) return { ok: false, code: 409, error: 'Partida longa demais.' };
    // Desistir vale a qualquer momento; o resto precisa da visão atual.
    if (action.type !== 'concede' && seq !== this.state.actionCount) {
      return { ok: false, code: 409, error: 'A mesa mudou; tente de novo.' };
    }
    const now = this.deps.now();
    const recent = (this.recent[seat] = this.recent[seat].filter((t) => now - t < RATE_WINDOW_MS));
    if (recent.length >= (this.deps.rateLimit ?? RATE_LIMIT)) return { ok: false, code: 429, error: 'Muitas ações em pouco tempo.' };
    recent.push(now);

    const real = actionFromView(this.state, this.aliases, action, this.peekCards(seat));
    if (typeof real === 'string') return { ok: false, code: 422, error: real };
    try {
      // applyAction não muda o estado anterior: uma ação recusada não deixa rastro.
      this.commit(real);
    } catch (e) {
      if (e instanceof IllegalActionError) return { ok: false, code: 422, error: e.message };
      this.deps.log(`Partida online ${this.id}: erro do motor: ${e instanceof Error ? e.stack : e}`);
      return { ok: false, code: 422, error: e instanceof Error ? e.message : 'Ação inválida.' };
    }
    return { ok: true, actionCount: this.state.actionCount };
  }

  /** Se a vez é do bot do servidor, agenda a jogada dele. */
  private driveBot() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const seat = this.running;
    if (seat === null || !this.data.seats[seat]?.bot) return;
    this.botTimer = setTimeout(() => this.botMove(seat), this.deps.botDelayMs ?? BOT_DELAY_MS);
  }

  private botMove(seat: PlayerId) {
    this.botTimer = null;
    if (!this.state || !this.aliases || this.state.phase === 'gameover' || this.running !== seat) return;
    try {
      // Decide pela visão do bot, como faria um jogador: sem espiar a mão do oponente.
      const extra = this.peekCards(seat);
      const view = viewFor(this.state, seat, this.aliases, extra);
      const real = actionFromView(this.state, this.aliases, chooseBotAction(view, seat), extra);
      if (typeof real === 'string') throw new Error(real);
      this.commit(real);
    } catch (e) {
      // Bot travado: desiste, para a partida não ficar parada.
      this.deps.log(`Partida online ${this.id}: o bot falhou: ${e instanceof Error ? e.message : e}`);
      try {
        this.commit({ type: 'concede', player: seat });
      } catch {
        /* a partida já terminou */
      }
    }
  }

  private peekCards(seat: PlayerId): string[] {
    const n = this.peek[seat];
    return n && this.state ? this.state.players[seat].deck.slice(0, n) : [];
  }

  emote(seat: PlayerId, emote: unknown): ActResult {
    if (!EMOTES.includes(emote as EmoteId)) return { ok: false, code: 400, error: 'Emote inválido.' };
    const now = this.deps.now();
    if (now - this.lastEmote[seat] < 3000) return { ok: false, code: 429, error: 'Espere um pouco.' };
    this.lastEmote[seat] = now;
    for (const c of this.conns) c.send('emote', { seat, emote });
    return { ok: true, actionCount: this.state?.actionCount ?? 0 };
  }

  // ------------------------------------------------------------------ conexões

  connected(seat: PlayerId) {
    if (this.data.seats[seat]?.bot) return true;
    for (const c of this.conns) if (c.seat === seat) return true;
    return false;
  }

  /** Espectadores conectados agora. */
  get spectators() {
    let n = 0;
    for (const c of this.conns) if (c.seat === null) n++;
    return n;
  }

  /** Esta conta (ou navegador) joga nesta sala? */
  isPlayer(ownerHash: string | null, userId: string | null) {
    return this.data.seats.some((s) => !s.bot && ((ownerHash !== null && s.ownerHash === ownerHash) || (userId !== null && s.userId === userId)));
  }

  attach(conn: Connection) {
    this.conns.add(conn);
    this.updatePresence();
    conn.send('state', this.snapshot(conn));
    this.broadcastPresence();
  }

  detach(conn: Connection) {
    this.conns.delete(conn);
    this.updatePresence();
    this.broadcastPresence();
  }

  private updatePresence() {
    if (this.running === null) return;
    if (this.connected(this.running)) this.awaySince = null;
    else this.awaySince ??= this.deps.now();
    if (this.state) this.schedule();
  }

  private broadcastPresence() {
    const presence = [0, 1].map((s) => this.connected(s as PlayerId));
    const spectators = this.spectators;
    for (const c of this.conns) c.send('presence', { connected: presence, spectators });
  }

  /** Avisos fora do jogo (revanche, sala cancelada). `data` recebe null para os espectadores. */
  notify(event: string, data: (seat: PlayerId | null) => unknown) {
    for (const c of this.conns) c.send(event, data(c.seat));
  }

  broadcast() {
    for (const c of this.conns) c.send('state', this.snapshot(c));
  }

  clock() {
    const now = this.deps.now();
    const remaining = [...this.data.remaining] as [number, number];
    if (this.running !== null) remaining[this.running] = Math.max(0, remaining[this.running] - (now - this.since));
    return { remaining, running: this.running, total: TIME_BANK_MS, awaySince: this.awaySince };
  }

  /** Resumo da sala (sem o jogo) para a conexão `seat` (null = espectador). */
  info(seat: PlayerId | null) {
    return {
      id: this.id,
      code: this.data.code,
      queue: this.data.queue,
      format: this.data.format,
      tournament: this.data.tournament ?? null,
      status: this.status,
      you: seat,
      players: this.data.seats.map((s, i) => ({
        name: s.name,
        bounty: s.bounty,
        tier: s.tier,
        leader: s.deck.leader,
        connected: this.connected(i as PlayerId),
        bot: Boolean(s.bot),
      })),
      spectators: this.spectators,
      clock: this.clock(),
      result: this.data.result,
      rematch: this.data.rematch ?? [false, false],
    };
  }

  /**
   * Estado para uma conexão: a visão do jogador, mais só as definições de cartas e
   * as linhas do log que esta conexão ainda não recebeu.
   */
  snapshot(conn: Connection) {
    const room = this.info(conn.seat);
    if (!this.state || !this.aliases) return { room, view: null, defs: {}, log: { from: 0, entries: [] }, lastAction: null };
    const extra = this.extraFor(conn);
    const { defs, log, ...view } = viewFor(this.state, conn.seat, this.aliases, extra);
    const newDefs: Record<string, CardDef> = {};
    for (const [id, def] of Object.entries(defs)) {
      if (!conn.sentDefs.has(id)) {
        conn.sentDefs.add(id);
        newDefs[id] = def;
      }
    }
    const from = Math.min(conn.sentLog, log.length);
    const entries: LogEntry[] = log.slice(from);
    conn.sentLog = log.length;
    return {
      room,
      view,
      defs: newDefs,
      log: { from, entries },
      lastAction: this.lastAction ? aliasRefs(this.state, conn.seat, this.aliases, this.lastAction, extra) : null,
      peek: conn.seat === null ? 0 : this.peek[conn.seat],
    };
  }

  /** Cartas a mais na visão: o topo do deck espiado (jogador) ou as duas mãos (espectador com mãos). */
  private extraFor(conn: Connection): string[] {
    if (conn.seat !== null) return this.peekCards(conn.seat);
    if (conn.hands && this.state) return this.state.players.flatMap((p) => p.hand);
    return [];
  }

  /** Replay completo (só depois do fim da partida). */
  replay() {
    if (!this.state || this.state.phase !== 'gameover') return null;
    return {
      format: 'gumgumfight-replay' as const,
      version: 1 as const,
      seed: 0,
      seed128: this.data.seed128,
      firstPlayer: this.state.firstPlayer,
      names: this.data.seats.map((s) => s.name),
      deckIds: this.data.seats.map((s) => s.deckId),
      decks: this.data.seats.map((s) => s.deck),
      actions: this.data.actions,
    };
  }

  private save() {
    this.deps.save?.(this);
  }

  /**
   * Para o relógio e fecha as conexões. `closed`: a sala acabou (cancelada ou
   * expirada) e o navegador não deve reconectar; sem isso (servidor desligando),
   * o navegador reconecta e encontra a sala refeita a partir do banco.
   */
  dispose(closed = true) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    for (const c of this.conns) {
      if (closed) c.send('closed', {});
      c.end?.();
    }
    this.conns.clear();
  }
}
