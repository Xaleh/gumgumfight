// Mesa online do Yonko (todos contra todos, de 3 a 4 lugares): a sala de espera com código, os lugares de
// pessoas e de bots, as regras da mesa e a partida.
//
// É uma sala própria, e não o `Room` das partidas de dois jogadores (online/room.ts), que é feito de pares
// (relógios, emotes, revanche, torneio, Judge, espectadores). O transporte é o mesmo: SSE com a visão de cada
// lugar (`viewFor`), e cada conexão recebe só as definições de cartas e as linhas do registro que ainda não tem.
// As regras do formato estão em docs/regras-yonko.md; o motor é o de sempre (`createGame` com `table`).
//
// O que é gravado (`YonkoTableData`) basta para refazer a mesa depois de reiniciar o servidor: as regras, os
// lugares (com os decks), a seed de 128 bits e as ações da partida.

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
  type CardEngineText,
  chooseSimpleBotAction,
  createAliases,
  createGame,
  type DeckList,
  type GameState,
  hiddenDecision,
  identityAliases,
  IllegalActionError,
  legalActions,
  type LogEntry,
  type PlayerId,
  REPLAY_VERSION,
  type TableRules,
  viewFor,
  YONKO_TABLE,
} from '@gumgum/engine';
import { type ErrorParams, fail } from '../errors';
import { pinEngineTexts } from '../online/room';

/** Lugares de uma mesa. */
export const YONKO_SEATS = 4;
/** Lugares ocupados (pessoas ou bots) para começar: com dois seria o jogo normal. */
export const YONKO_MIN_PLAYERS = 3;
/** Tempo de cada jogador na partida inteira; só corre nas decisões dele. */
export const YONKO_TIME_BANK_MS = 25 * 60_000;
/** Na própria decisão, desconectado por este tempo: eliminado (a mesa segue). */
export const YONKO_ABANDON_MS = 2 * 60_000;
/** Mesa de espera sem ninguém conectado, ou mesa terminada: fechada depois deste tempo. */
export const YONKO_IDLE_MS = 30 * 60_000;
const BOT_DELAY_MS = 700;
/** Counter, carta da Vida, "pagar X?": um tempo que não denuncia se o bot tinha o que usar. */
const BOT_HIDDEN_MS = [800, 2000] as const;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10_000;
const MAX_ACTIONS = 8000;

export interface YonkoSeat {
  /** Navegador (ou conta) de quem senta; null nos bots. */
  ownerHash: string | null;
  userId: string | null;
  name: string;
  /** O deck escolhido (id salvo); o que vai para a mesa é `deck`. */
  deckId: string | null;
  deckName: string;
  /** Nome e cores do Líder (para a sala de espera, que não carrega as cartas). */
  leaderName?: string;
  colors?: string[];
  deck: DeckList;
  /** O deck de 60 foi montado a partir de um deck comum (`yonkoTableDeck`). */
  test: boolean;
  /** Credencial do lugar (no navegador de quem senta); null nos bots. */
  token: string | null;
  bot: boolean;
  /** Pronto para começar (quem criou a mesa começa quando quer; os outros marcam). */
  ready: boolean;
}

export type YonkoStatus = 'waiting' | 'playing' | 'finished';

export interface YonkoTableData {
  id: string;
  code: string;
  createdAt: number;
  /** O lugar de quem manda na mesa (regras, bots, começar). */
  host: number;
  rules: TableRules;
  /** Os lugares da sala de espera (null = vazio). */
  seats: Array<YonkoSeat | null>;
  /** Na partida: os lugares ocupados, na ordem dos lugares. O índice é o `PlayerId` do motor. */
  players: YonkoSeat[] | null;
  /** O lugar da sala de cada jogador da partida (`players[i]` estava em `seats[seatOf[i]]`). */
  seatOf: number[] | null;
  seed128: number[] | null;
  aliasSalt: string;
  actions: Action[];
  /** Tempo de cada jogador (ms), na ordem de `players`. */
  remaining: number[];
  startedAt?: number;
  finishedAt?: number;
  replayVersion?: number;
  /** Textos para o motor das cartas da partida quando ela começou (a mesa é refeita com eles). */
  engineTexts?: Record<string, CardEngineText>;
  /** A última vez que alguém conectado mexeu na mesa (ms): mesas esquecidas fecham sozinhas. */
  touchedAt: number;
}

export interface YonkoConnection {
  token: string;
  send: (event: string, data: unknown) => void;
  end?: () => void;
  sentDefs: Set<string>;
  sentLog: number;
}

export interface YonkoDeps {
  cards: (ids: string[]) => CardData[];
  now?: () => number;
  save?: (table: YonkoTable) => void;
  remove?: (table: YonkoTable) => void;
  log?: (msg: string) => void;
  botDelayMs?: number;
  rateLimit?: number;
}

export type YonkoResult = { ok: true } | { ok: false; code: number; error: string; errorCode?: string; errorParams?: ErrorParams };

const refuse = (code: number, errorCode: string, text: string, params?: ErrorParams): YonkoResult => ({ ok: false, code, ...fail(errorCode, text, params) });

export const newToken = () => randomBytes(24).toString('base64url');

/** Regras da mesa vindas do navegador: só os campos conhecidos, dentro dos limites. */
export function parseRules(raw: unknown): TableRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number, dflt: number) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : dflt);
  const extraLife = int(r.extraLife, 0, 4, YONKO_TABLE.extraLife ?? 2);
  const eliminationDraw = int(r.eliminationDraw, 0, 2, 0);
  const curveChoice = typeof r.curveChoice === 'boolean' ? r.curveChoice : Boolean(YONKO_TABLE.curveChoice);
  return { ...(extraLife ? { extraLife } : {}), ...(curveChoice ? { curveChoice: true } : {}), ...(eliminationDraw ? { eliminationDraw } : {}) };
}

export class YonkoTable {
  readonly data: YonkoTableData;
  state: GameState | null = null;
  private aliases: Aliases | null = null;
  private deps: Required<Pick<YonkoDeps, 'now' | 'log'>> & YonkoDeps;
  private conns = new Set<YonkoConnection>();
  /** O jogador cujo relógio corre (o da vez, se for pessoa e estiver na mesa). */
  private running: PlayerId | null = null;
  private since = 0;
  /** Desde quando o jogador da vez está sem conexão (para o abandono). */
  private awaySince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private recent = new Map<number, number[]>();
  private lastAction: Action | null = null;

  constructor(data: YonkoTableData, deps: YonkoDeps) {
    this.data = data;
    this.deps = { ...deps, now: deps.now ?? (() => Date.now()), log: deps.log ?? (() => {}) };
    if (data.seed128 && data.players) this.rebuild();
  }

  get id() {
    return this.data.id;
  }

  get status(): YonkoStatus {
    if (!this.state) return 'waiting';
    return this.state.phase === 'gameover' ? 'finished' : 'playing';
  }

  /** Lugar da sala de quem tem o token (ou null). */
  seatOfToken(token: unknown): number | null {
    if (typeof token !== 'string' || !token) return null;
    const i = this.data.seats.findIndex((s) => s?.token === token);
    return i >= 0 ? i : null;
  }

  /** Jogador da partida (índice do motor) de quem tem o token, ou null. */
  playerOfToken(token: unknown): PlayerId | null {
    if (typeof token !== 'string' || !token || !this.data.players) return null;
    const i = this.data.players.findIndex((s) => s.token === token);
    return i >= 0 ? i : null;
  }

  /** Esta conta (ou navegador) tem um lugar nesta mesa? Devolve o token dele. */
  tokenOf(ownerHash: string | null, userId: string | null): string | null {
    const mine = (s: YonkoSeat | null) => Boolean(s && !s.bot && ((ownerHash && s.ownerHash === ownerHash) || (userId && s.userId === userId)));
    const list = this.data.players ?? this.data.seats;
    return list.find(mine)?.token ?? this.data.seats.find(mine)?.token ?? null;
  }

  private touch() {
    this.data.touchedAt = this.deps.now();
  }

  // ------------------------------------------------------------------ sala de espera

  /** Senta uma pessoa no primeiro lugar vazio. */
  join(seat: YonkoSeat): YonkoResult & { seat?: number } {
    if (this.status !== 'waiting') return refuse(409, 'yonkoStarted', 'A partida desta mesa já começou.');
    const i = this.data.seats.findIndex((s) => s === null);
    if (i < 0) return refuse(409, 'yonkoFull', 'A mesa está cheia.');
    this.data.seats[i] = seat;
    this.touch();
    this.changed();
    return { ok: true, seat: i };
  }

  private waitingSeat(token: unknown): number | YonkoResult {
    const i = this.seatOfToken(token);
    if (i === null) return refuse(404, 'yonkoNotFound', 'Mesa não encontrada.');
    if (this.status !== 'waiting') return refuse(409, 'yonkoStarted', 'A partida desta mesa já começou.');
    return i;
  }

  private hostSeat(token: unknown): number | YonkoResult {
    const i = this.waitingSeat(token);
    if (typeof i !== 'number') return i;
    if (i !== this.data.host) return refuse(403, 'yonkoHostOnly', 'Só quem criou a mesa pode fazer isso.');
    return i;
  }

  setDeck(token: unknown, deck: Pick<YonkoSeat, 'deckId' | 'deckName' | 'deck' | 'test' | 'leaderName' | 'colors'>): YonkoResult {
    const i = this.waitingSeat(token);
    if (typeof i !== 'number') return i;
    Object.assign(this.data.seats[i]!, deck, { ready: false });
    this.touch();
    this.changed();
    return { ok: true };
  }

  setReady(token: unknown, ready: unknown): YonkoResult {
    const i = this.waitingSeat(token);
    if (typeof i !== 'number') return i;
    this.data.seats[i]!.ready = ready === true;
    this.touch();
    this.changed();
    return { ok: true };
  }

  setRules(token: unknown, rules: unknown): YonkoResult {
    const i = this.hostSeat(token);
    if (typeof i !== 'number') return i;
    this.data.rules = parseRules(rules);
    // Regras novas: quem já tinha marcado "pronto" confirma de novo.
    for (const s of this.data.seats) if (s && !s.bot) s.ready = false;
    this.touch();
    this.changed();
    return { ok: true };
  }

  /** Quem criou a mesa põe um bot num lugar vazio (`seat`), ou no primeiro vazio. */
  addBot(token: unknown, at: unknown, bot: YonkoSeat): YonkoResult {
    const i = this.hostSeat(token);
    if (typeof i !== 'number') return i;
    const slot = Number.isInteger(at) ? (at as number) : this.data.seats.findIndex((s) => s === null);
    if (slot < 0 || slot >= YONKO_SEATS || this.data.seats[slot] !== null) return refuse(409, 'yonkoSeatTaken', 'Esse lugar não está vazio.');
    this.data.seats[slot] = bot;
    this.touch();
    this.changed();
    return { ok: true };
  }

  /** Quem criou a mesa tira um bot ou uma pessoa de um lugar. */
  clearSeat(token: unknown, at: unknown): YonkoResult {
    const i = this.hostSeat(token);
    if (typeof i !== 'number') return i;
    if (!Number.isInteger(at) || (at as number) < 0 || (at as number) >= YONKO_SEATS || at === i) return refuse(400, 'yonkoBadSeat', 'Lugar inválido.');
    const gone = this.data.seats[at as number];
    if (!gone) return { ok: true };
    this.data.seats[at as number] = null;
    // Quem foi tirado da mesa perde a conexão (o navegador volta para o menu do Yonko).
    if (gone.token) this.close(gone.token);
    this.touch();
    this.changed();
    return { ok: true };
  }

  /** Sai da sala de espera. Quem criou passa a mesa adiante; sem mais ninguém, ela fecha (`empty`). */
  leaveWaiting(token: unknown): YonkoResult & { empty?: boolean } {
    const i = this.waitingSeat(token);
    if (typeof i !== 'number') return i;
    const gone = this.data.seats[i]!;
    this.data.seats[i] = null;
    if (gone.token) this.close(gone.token);
    const humans = this.data.seats.map((s, k) => (s && !s.bot ? k : -1)).filter((k) => k >= 0);
    if (!humans.length) return { ok: true, empty: true };
    if (i === this.data.host) this.data.host = humans[0];
    this.touch();
    this.changed();
    return { ok: true };
  }

  /** Por que a mesa ainda não pode começar (null = pode). */
  startProblem(): { code: string; text: string; params?: ErrorParams } | null {
    const seated = this.data.seats.filter((s): s is YonkoSeat => s !== null);
    if (seated.length < YONKO_MIN_PLAYERS) return { code: 'yonkoTooFew', text: `A mesa precisa de pelo menos ${YONKO_MIN_PLAYERS} lugares ocupados.`, params: { n: YONKO_MIN_PLAYERS } };
    const waiting = this.data.seats.filter((s, k) => s && !s.bot && !s.ready && k !== this.data.host);
    if (waiting.length) return { code: 'yonkoNotReady', text: `Esperando ${waiting.map((s) => s!.name).join(', ')} ficar pronto.`, params: { names: waiting.map((s) => s!.name).join(', ') } };
    return null;
  }

  /** Quem criou a mesa começa a partida. */
  start(token: unknown): YonkoResult {
    const i = this.hostSeat(token);
    if (typeof i !== 'number') return i;
    const problem = this.startProblem();
    if (problem) return refuse(409, problem.code, problem.text, problem.params);
    const seatOf = this.data.seats.map((s, k) => (s ? k : -1)).filter((k) => k >= 0);
    this.data.players = seatOf.map((k) => this.data.seats[k]!);
    this.data.seatOf = seatOf;
    this.data.seed128 = [0, 1, 2, 3].map(() => randomInt(0, 2 ** 32) | 0);
    this.data.aliasSalt = randomBytes(16).toString('base64url');
    this.data.actions = [];
    this.data.remaining = this.data.players.map(() => YONKO_TIME_BANK_MS);
    this.data.replayVersion = REPLAY_VERSION;
    this.data.engineTexts = Object.fromEntries(
      this.deps
        .cards(this.cardIds())
        .filter((c) => c.engineText)
        .map((c) => [c.id, c.engineText!]),
    );
    this.data.startedAt = this.deps.now();
    delete this.data.finishedAt;
    try {
      this.rebuild();
    } catch (e) {
      this.deps.log(`Mesa de Yonko ${this.id}: não começou: ${e instanceof Error ? e.message : e}`);
      this.data.players = null;
      this.data.seatOf = null;
      this.data.seed128 = null;
      return refuse(422, 'yonkoStartFailed', 'Não deu para começar a partida com esses decks.');
    }
    // Cada conexão recebe a mesa do zero (definições e registro).
    for (const c of this.conns) {
      c.sentDefs.clear();
      c.sentLog = 0;
    }
    this.touch();
    this.changed();
    return { ok: true };
  }

  /** Depois do fim: a mesa volta para a sala de espera com os mesmos lugares (jogar de novo). */
  reopen(token: unknown): YonkoResult {
    const i = this.seatOfToken(token);
    if (i === null) return refuse(404, 'yonkoNotFound', 'Mesa não encontrada.');
    if (this.status !== 'finished') return refuse(409, 'yonkoNotFinished', 'A partida ainda não terminou.');
    if (i !== this.data.host) return refuse(403, 'yonkoHostOnly', 'Só quem criou a mesa pode fazer isso.');
    this.stopTimers();
    this.state = null;
    this.aliases = null;
    this.data.players = null;
    this.data.seatOf = null;
    this.data.seed128 = null;
    this.data.actions = [];
    this.data.remaining = [];
    delete this.data.finishedAt;
    for (const s of this.data.seats) if (s && !s.bot) s.ready = false;
    for (const c of this.conns) {
      c.sentDefs.clear();
      c.sentLog = 0;
    }
    this.touch();
    this.changed();
    return { ok: true };
  }

  // ------------------------------------------------------------------ partida

  private cardIds() {
    const list = this.data.players ?? this.data.seats.filter((s): s is YonkoSeat => s !== null);
    return [...new Set(list.flatMap((s) => [s.deck.leader, ...s.deck.cards.map((c) => c.id)]))];
  }

  /** Cria o jogo e refaz as ações gravadas (ao começar ou ao reiniciar o servidor). */
  private rebuild() {
    const players = this.data.players!;
    let state = createGame({
      seed: 0,
      seed128: this.data.seed128!,
      cards: pinEngineTexts(this.deps.cards(this.cardIds()), this.data.engineTexts),
      table: this.data.rules,
      players: players.map((s) => ({ name: s.name, deck: s.deck, isBot: s.bot })),
    });
    let n = 0;
    const salt = this.data.aliasSalt;
    this.aliases = createAliases(state, () => `y${createHmac('sha256', salt).update(String(n++)).digest('base64url').slice(0, 10)}`);
    for (const a of this.data.actions) state = applyAction(state, a);
    this.state = state;
    this.lastAction = this.data.actions[this.data.actions.length - 1] ?? null;
    // O tempo em que o servidor ficou fora do ar não conta para ninguém.
    this.startClock();
  }

  /** Quem precisa agir agora e se é uma pessoa que ainda está na mesa. */
  private humanToAct(): PlayerId | null {
    const s = this.state;
    if (!s || s.phase === 'gameover') return null;
    const p = actingPlayer(s);
    if (p === null || s.players[p].out || this.data.players![p].bot) return null;
    return p;
  }

  private startClock() {
    this.running = this.humanToAct();
    this.since = this.deps.now();
    this.awaySince = this.running !== null && !this.connected(this.running) ? this.since : null;
    this.schedule();
    this.driveBot();
  }

  /** Desconta do jogador da vez o tempo desde a última mudança. */
  private settle() {
    const now = this.deps.now();
    if (this.running !== null) this.data.remaining[this.running] = Math.max(0, this.data.remaining[this.running] - Math.max(0, now - this.since));
    this.since = now;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running === null) return;
    const now = this.deps.now();
    const left = this.data.remaining[this.running] - (now - this.since);
    const away = this.awaySince === null ? Infinity : this.awaySince + YONKO_ABANDON_MS - now;
    this.timer = setTimeout(() => this.tick(), Math.max(0, Math.min(left, away)) + 5);
  }

  /** O relógio do jogador da vez acabou, ou ele está ausente há tempo demais: ele sai da mesa. */
  tick() {
    this.timer = null;
    if (this.running === null || !this.state || this.state.phase === 'gameover') return;
    this.settle();
    const p = this.running;
    const abandoned = this.awaySince !== null && this.deps.now() - this.awaySince >= YONKO_ABANDON_MS;
    if (this.data.remaining[p] > 0 && !abandoned) return this.schedule();
    try {
      this.commit({ type: 'timeout', player: p, ...(abandoned && this.data.remaining[p] > 0 ? { abandoned: true } : {}) });
    } catch (e) {
      this.deps.log(`Mesa de Yonko ${this.id}: falha no fim por tempo: ${e instanceof Error ? e.message : e}`);
    }
  }

  private commit(action: Action) {
    this.settle();
    this.state = applyAction(this.state!, action);
    this.data.actions.push(action);
    this.lastAction = action;
    this.running = this.humanToAct();
    if (this.running === null || this.connected(this.running)) this.awaySince = null;
    else this.awaySince ??= this.deps.now();
    if (this.state.phase === 'gameover') {
      this.data.finishedAt = this.deps.now();
      this.stopTimers();
    } else {
      this.schedule();
      this.driveBot();
    }
    this.changed();
  }

  /** Ninguém de carne e osso continua na partida: os bots terminam sem esperar. */
  private onlyBotsLeft(): boolean {
    const s = this.state;
    return Boolean(s && this.data.players!.every((p, i) => p.bot || s.players[i].out));
  }

  /** Se a vez é de um bot, ele joga depois de uma pausa. */
  private driveBot() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const s = this.state;
    if (!s || s.phase === 'gameover') return;
    const p = actingPlayer(s);
    if (p === null || !this.data.players![p].bot || s.players[p].out) return;
    const fast = this.onlyBotsLeft();
    const base = this.deps.botDelayMs ?? BOT_DELAY_MS;
    const delay = fast || base === 0 ? 0 : hiddenDecision(s.pending) ? BOT_HIDDEN_MS[0] + Math.random() * (BOT_HIDDEN_MS[1] - BOT_HIDDEN_MS[0]) : s.pending ? base * 0.7 : base;
    this.botTimer = setTimeout(() => this.botMove(p), delay);
  }

  private botMove(p: PlayerId) {
    this.botTimer = null;
    const s = this.state;
    if (!s || s.phase === 'gameover' || actingPlayer(s) !== p) return;
    if (this.data.actions.length >= MAX_ACTIONS) {
      this.deps.log(`Mesa de Yonko ${this.id}: partida longa demais; o bot desiste.`);
      return this.commit({ type: 'concede', player: p });
    }
    // O bot decide pela visão do lugar dele, como uma pessoa (apelidos iguais aos uids), e a jogada volta
    // para os uids reais como a de uma pessoa (as cartas escondidas vêm por posição).
    const ids = identityAliases(s);
    const view = viewFor(s, p, ids);
    let chosen: Action | undefined;
    try {
      chosen = chooseSimpleBotAction(view, p);
    } catch {
      chosen = legalActions(view, p).find((a) => a.type !== 'cancel');
    }
    const real = chosen ? actionFromView(s, ids, chosen) : null;
    const action = real && typeof real !== 'string' ? real : undefined;
    try {
      this.commit(action ?? { type: 'concede', player: p });
    } catch (e) {
      // Uma escolha que o motor recusa: o bot tenta a primeira ação legal; sem nenhuma, desiste.
      this.deps.log(`Mesa de Yonko ${this.id}: jogada do bot recusada: ${e instanceof Error ? e.message : e}`);
      const fallback = legalActions(s, p).find((a) => a.type !== 'cancel' && JSON.stringify(a) !== JSON.stringify(action));
      try {
        this.commit(fallback ?? { type: 'concede', player: p });
      } catch {
        this.commit({ type: 'concede', player: p });
      }
    }
  }

  /** Ação de uma pessoa, feita sobre a visão de número `seq`. */
  act(token: unknown, seq: unknown, raw: unknown): YonkoResult & { actionCount?: number } {
    const p = this.playerOfToken(token);
    if (p === null) return refuse(404, 'yonkoNotFound', 'Mesa não encontrada.');
    if (!this.state || !this.aliases) return refuse(409, 'yonkoNotStarted', 'A partida ainda não começou.');
    if (this.state.phase === 'gameover') return refuse(409, 'matchOver', 'A partida já terminou.');
    const action = raw as Action;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string' || action.player !== p) return refuse(400, 'invalidAction', 'Ação inválida.');
    if (action.type === 'timeout' || action.type === 'manual' || action.type === 'judge') return refuse(400, 'invalidAction', 'Ação inválida.');
    if (this.state.players[p].out) return refuse(409, 'yonkoOut', 'Você já saiu desta partida.');
    if (action.type !== 'concede' && seq !== this.state.actionCount) return refuse(409, 'boardChanged', 'A mesa mudou; tente de novo.');
    if (this.data.actions.length >= MAX_ACTIONS) return refuse(409, 'matchTooLong', 'Partida longa demais.');
    const now = this.deps.now();
    const recent = (this.recent.get(p) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= (this.deps.rateLimit ?? RATE_LIMIT)) return refuse(429, 'tooManyActions', 'Muitas ações em pouco tempo.');
    recent.push(now);
    this.recent.set(p, recent);
    const real = action.type === 'concede' ? action : actionFromView(this.state, this.aliases, action);
    if (typeof real === 'string') return { ok: false, code: 422, error: real };
    try {
      this.touch();
      this.commit(real);
    } catch (e) {
      if (e instanceof IllegalActionError) return { ok: false, code: 422, error: e.message };
      this.deps.log(`Mesa de Yonko ${this.id}: erro do motor: ${e instanceof Error ? e.stack : e}`);
      return { ok: false, code: 422, error: e instanceof Error ? e.message : 'Ação inválida.' };
    }
    return { ok: true, actionCount: this.state.actionCount };
  }

  // ------------------------------------------------------------------ conexões

  /** A pessoa do jogador `p` tem um navegador ligado na mesa (bots contam como presentes). */
  connected(p: PlayerId): boolean {
    const seat = this.data.players?.[p];
    if (!seat) return false;
    if (seat.bot) return true;
    for (const c of this.conns) if (c.token === seat.token) return true;
    return false;
  }

  private seatConnected(seat: YonkoSeat): boolean {
    if (seat.bot) return true;
    for (const c of this.conns) if (c.token === seat.token) return true;
    return false;
  }

  get connections() {
    return this.conns.size;
  }

  attach(conn: YonkoConnection) {
    this.conns.add(conn);
    this.presence();
    this.send([conn]);
  }

  detach(conn: YonkoConnection) {
    this.conns.delete(conn);
    this.presence();
  }

  /** Alguém entrou ou saiu: o abandono do jogador da vez começa ou para de contar, e a mesa fica sabendo. */
  private presence() {
    if (this.running !== null) {
      const here = this.connected(this.running);
      if (here && this.awaySince !== null) this.awaySince = null;
      else if (!here && this.awaySince === null) this.awaySince = this.deps.now();
      this.schedule();
    }
    this.send(this.conns);
  }

  /** Fecha os canais de um token (quem saiu ou foi tirado da mesa). */
  private close(token: string) {
    for (const c of [...this.conns]) {
      if (c.token !== token) continue;
      c.send('closed', {});
      c.end?.();
      this.conns.delete(c);
    }
  }

  /** Relógio agora. */
  clock() {
    const now = this.deps.now();
    const remaining = [...this.data.remaining];
    if (this.running !== null) remaining[this.running] = Math.max(0, remaining[this.running] - Math.max(0, now - this.since));
    return { remaining, running: this.running, total: YONKO_TIME_BANK_MS, awaySince: this.awaySince, abandonMs: YONKO_ABANDON_MS };
  }

  /** O resumo da mesa para quem tem `token` (a sala de espera e, na partida, quem é quem). */
  info(token: string) {
    const you = this.seatOfToken(token);
    const seatView = (s: YonkoSeat | null, i: number) =>
      s && {
        name: s.name,
        bot: s.bot,
        ready: s.bot || i === this.data.host || s.ready,
        connected: this.seatConnected(s),
        leader: s.deck.leader,
        leaderName: s.leaderName ?? s.deck.leader,
        colors: s.colors ?? [],
        deckName: s.deckName,
        test: s.test,
        you: i === you,
      };
    return {
      id: this.id,
      code: this.data.code,
      status: this.status,
      host: this.data.host,
      you,
      rules: this.data.rules,
      seats: this.data.seats.map(seatView),
      problem: this.status === 'waiting' ? this.startProblem() : null,
      /** Na partida: o jogador do motor de quem pede, e cada jogador com o lugar da sala dele. */
      player: this.playerOfToken(token),
      players: this.data.players?.map((s, i) => ({ seat: this.data.seatOf![i], name: s.name, bot: s.bot, connected: this.connected(i), leader: s.deck.leader, test: s.test })) ?? null,
      clock: this.state ? this.clock() : null,
    };
  }

  /** Manda a cada conexão a mesa como ela a vê (só as cartas e as linhas novas). */
  private send(conns: Iterable<YonkoConnection>) {
    for (const c of conns) {
      const room = this.info(c.token);
      const p = this.playerOfToken(c.token);
      if (!this.state || !this.aliases || p === null) {
        c.send('state', { room, view: null, defs: {}, log: { from: 0, entries: [] }, lastAction: null });
        continue;
      }
      const { defs, log, ...view } = viewFor(this.state, p, this.aliases);
      const newDefs: Record<string, CardDef> = {};
      for (const id in defs) {
        if (c.sentDefs.has(id)) continue;
        c.sentDefs.add(id);
        newDefs[id] = defs[id];
      }
      const from = Math.min(c.sentLog, log.length);
      const entries: LogEntry[] = log.slice(from);
      c.sentLog = log.length;
      const lastAction = this.lastAction ? aliasRefs(this.state, p, this.aliases, this.lastAction) : null;
      c.send('state', { room, view, defs: newDefs, log: { from, entries }, lastAction });
    }
  }

  /** Mudou algo: grava e avisa todo mundo. */
  private changed() {
    this.deps.save?.(this);
    this.send(this.conns);
  }

  private stopTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.timer = null;
    this.botTimer = null;
    this.running = null;
    this.awaySince = null;
  }

  /** Para os relógios e fecha os canais (`closed`: a mesa acabou e o navegador não deve reconectar). */
  dispose(closed = true) {
    this.stopTimers();
    for (const c of this.conns) {
      if (closed) c.send('closed', {});
      c.end?.();
    }
    this.conns.clear();
  }
}
