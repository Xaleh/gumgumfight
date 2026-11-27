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
//
// Espectadores: uma conexão sem lugar (`YonkoConnection.watch`) recebe a visão pública (`viewFor` sem jogador):
// a mão de ninguém. Quem tem o código da mesa assiste; a mesa só entra na lista "Assistir partidas" se quem criou
// a abriu (`listed`). Espectador não conta como presença de jogador (relógio e abandono) nem segura a mesa aberta.
//
// Transmissão (online/broadcast.ts): a tela do OBS pode ver a mesa como o streamer que joga nela (`watch.as`: a
// mão dele, nunca a dos outros) e, onde quem criou liberou (`showHands`), as mãos de todos (`watch.hands`), sempre
// com atraso (no mínimo MIN_HANDS_DELAY_MS): a partida pode estar numa live, e um jogador não pode abrir a
// transmissão para ver a mão dos outros. Cada atraso em uso tem a sua mesa (`LateTable`), refeita a partir das
// ações gravadas e avançada no ritmo em que elas aconteceram (`timeline`). A mesa atrasada segue a partida dela até
// o fim mesmo que a mesa seja reaberta ("jogar de novo") no meio do atraso.

import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  type Action,
  actingPlayer,
  actionFromView,
  type Aliases,
  aliasRefs,
  applyAction,
  type CardData,
  cardImage,
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
import { HANDS_DELAY_MS, MAX_DELAY_MS, MIN_HANDS_DELAY_MS, pinEngineTexts } from '../online/room';

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
  /**
   * Quando cada ação aconteceu e o relógio de cada jogador depois dela (`[ms, ...remaining]`), na ordem de
   * `actions`: é o ritmo da mesa atrasada. Mesas gravadas antes disso não têm o campo (`rebuild` o completa).
   */
  timeline?: number[][];
  /** A mesa aparece na lista "Assistir partidas" (sem isso, só assiste quem tem o código). */
  listed?: boolean;
  /** Quem criou liberou as mãos dos jogadores para quem transmite (perfil Streamer, sempre com atraso). */
  showHands?: boolean;
}

/** O que um espectador pede para ver (o que ele de fato vê sai de `YonkoTable.viewOf`). */
export interface YonkoWatch {
  /** As mãos de todos os jogadores, onde a mesa as liberou (`showHands`); só na mesa atrasada. */
  hands?: boolean;
  /**
   * A mesa vista por quem senta com este token (o streamer que transmite a própria partida): a mão dele, nunca a
   * dos outros. É o token e não o número do jogador, que muda de uma partida para a outra na mesma mesa.
   */
  as?: string;
  /** Atraso pedido (ms); 0 ou ausente = ao vivo. Ver `YonkoTable.delayOf`. */
  delay?: number;
}

export interface YonkoConnection {
  /** Credencial do lugar; null = espectador (`watch`). */
  token: string | null;
  /** Espectador: o que a conexão pede para ver. */
  watch?: YonkoWatch;
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

/** Uma partida da mesa: o que a mesa atrasada precisa para seguir até o fim depois de a mesa ser reaberta. */
interface Game {
  players: YonkoSeat[];
  seatOf: number[];
  /** Os mesmos vetores de `YonkoTableData` enquanto a partida é a da mesa (uma partida nova troca os vetores). */
  actions: Action[];
  timeline: number[][];
  startedAt: number;
  aliases: Aliases;
  /** As mãos estavam liberadas para a transmissão quando a partida começou. */
  hands: boolean;
  /** O estado antes da primeira ação (o motor é determinístico: sempre o mesmo). */
  initial: () => GameState;
  /** A mesa foi reaberta: esta partida saiu do ar (para a mesa atrasada, depois do atraso dela). */
  closedAt?: number;
}

/** Uma mesa atrasada: o estado de `game` depois das primeiras `count` ações, para quem assiste com `delay` de atraso. */
interface LateTable {
  delay: number;
  game: Game;
  state: GameState;
  count: number;
  lastAction: Action | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** O que uma conexão vê: a partida (a da mesa ou a da mesa atrasada), o ponto de vista e se as mãos vão junto. */
interface ConnView {
  late: LateTable | null;
  game: Game | null;
  state: GameState | null;
  lastAction: Action | null;
  pov: PlayerId | null;
  hands: boolean;
}

/** O `state` igual para todas as conexões com a mesma visão (cada uma recebe só as cartas e as linhas que faltam). */
interface Snapshot {
  room: unknown;
  view: Omit<GameState, 'defs' | 'log'> | null;
  defs: Record<string, CardDef>;
  log: LogEntry[];
  lastAction: Action | null;
}

/** Cartas a mais na visão de quem vê as mãos: as mãos de todos e a carta da Vida que o dono está olhando. */
function handsOf(state: GameState): string[] {
  const p = state.pending;
  return [...state.players.flatMap((ps) => ps.hand), ...(p?.kind === 'lifeCard' ? [p.card] : [])];
}

/** Quem a partida espera agora, se for uma pessoa que continua na mesa. */
function humanActing(state: GameState | null, players: YonkoSeat[]): PlayerId | null {
  if (!state || state.phase === 'gameover') return null;
  const p = actingPlayer(state);
  if (p === null || state.players[p].out || players[p].bot) return null;
  return p;
}

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
  /** A partida em curso (ou a que acabou e ainda está na mesa); null na sala de espera. */
  private game: Game | null = null;
  /** As mesas atrasadas em uso, pelo atraso (ms). */
  private lates = new Map<number, LateTable>();
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

  private get aliases(): Aliases | null {
    return this.game?.aliases ?? null;
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

  /** Esta conta (ou navegador) tem um lugar nesta mesa? */
  isPlayer(ownerHash: string | null, userId: string | null): boolean {
    return this.tokenOf(ownerHash, userId) !== null;
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

  /**
   * Quem criou a mesa decide, na sala de espera, se ela aparece em "Assistir partidas" (`listed`) e se as mãos dos
   * jogadores ficam liberadas para quem transmite (`showHands`). Campos ausentes ficam como estavam.
   */
  setOptions(token: unknown, raw: unknown): YonkoResult {
    const i = this.hostSeat(token);
    if (typeof i !== 'number') return i;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const listed = typeof r.listed === 'boolean' ? r.listed : Boolean(this.data.listed);
    const showHands = typeof r.showHands === 'boolean' ? r.showHands : Boolean(this.data.showHands);
    if (showHands !== Boolean(this.data.showHands)) {
      // As mãos passam a poder aparecer numa live (ou deixam de poder): quem já tinha marcado "pronto" confirma de novo.
      for (const s of this.data.seats) if (s && !s.bot) s.ready = false;
      // Quem assistia pedindo as mãos reconecta, e o pedido é conferido de novo.
      for (const c of [...this.conns]) {
        if (!c.watch?.hands) continue;
        this.conns.delete(c);
        c.end?.();
      }
    }
    if (listed) this.data.listed = true;
    else delete this.data.listed;
    if (showHands) this.data.showHands = true;
    else delete this.data.showHands;
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
    this.data.timeline = [];
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
      this.game = null;
      this.state = null;
      return refuse(422, 'yonkoStartFailed', 'Não deu para começar a partida com esses decks.');
    }
    // Cada conexão recebe a mesa do zero (definições e registro). Quem ainda assiste, atrasado, ao fim da
    // partida anterior continua nela (`advanceTable` o traz para esta quando o atraso passar).
    const fresh = [...this.conns].filter((c) => this.lateOf(c) === null);
    for (const c of fresh) this.reset(c);
    for (const c of fresh) if (this.delayOf(c) > 0) this.ensureLate(this.delayOf(c));
    this.touch();
    this.deps.save?.(this);
    this.send(fresh);
    this.advanceLate();
    return { ok: true };
  }

  /** Depois do fim: a mesa volta para a sala de espera com os mesmos lugares (jogar de novo). */
  reopen(token: unknown): YonkoResult {
    const i = this.seatOfToken(token);
    if (i === null) return refuse(404, 'yonkoNotFound', 'Mesa não encontrada.');
    if (this.status !== 'finished') return refuse(409, 'yonkoNotFinished', 'A partida ainda não terminou.');
    if (i !== this.data.host) return refuse(403, 'yonkoHostOnly', 'Só quem criou a mesa pode fazer isso.');
    this.stopTimers();
    // Quem assiste atrasado ainda não viu o fim: a mesa atrasada segue com a partida que acabou (os vetores dela
    // não são mais os da mesa) e só sai do ar quando o atraso passar por este instante.
    if (this.game) this.game.closedAt = this.deps.now();
    this.game = null;
    this.state = null;
    this.data.players = null;
    this.data.seatOf = null;
    this.data.seed128 = null;
    this.data.actions = [];
    this.data.timeline = [];
    this.data.remaining = [];
    delete this.data.finishedAt;
    for (const s of this.data.seats) if (s && !s.bot) s.ready = false;
    for (const c of this.conns) if (this.lateOf(c) === null) this.reset(c);
    this.touch();
    this.changed();
    this.advanceLate();
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
    const config = {
      seed: 0,
      seed128: this.data.seed128!,
      cards: pinEngineTexts(this.deps.cards(this.cardIds()), this.data.engineTexts),
      table: this.data.rules,
      players: players.map((s) => ({ name: s.name, deck: s.deck, isBot: s.bot })),
    };
    let state = createGame(config);
    let n = 0;
    const salt = this.data.aliasSalt;
    const aliases = createAliases(state, () => `y${createHmac('sha256', salt).update(String(n++)).digest('base64url').slice(0, 10)}`);
    for (const a of this.data.actions) state = applyAction(state, a);
    // Mesa gravada sem os horários das ações (ou com menos): as que faltam contam como antigas (a mesa atrasada
    // as mostra de uma vez).
    const startedAt = this.data.startedAt ?? this.deps.now();
    const timeline = (this.data.timeline ??= []);
    while (timeline.length < this.data.actions.length) timeline.push([startedAt, ...this.data.remaining]);
    this.game = {
      players,
      seatOf: this.data.seatOf ?? players.map((_, i) => i),
      actions: this.data.actions,
      timeline,
      startedAt,
      aliases,
      hands: Boolean(this.data.showHands),
      initial: () => createGame(config),
    };
    this.state = state;
    this.lastAction = this.data.actions[this.data.actions.length - 1] ?? null;
    // O tempo em que o servidor ficou fora do ar não conta para ninguém.
    this.startClock();
  }

  /** Quem precisa agir agora e se é uma pessoa que ainda está na mesa. */
  private humanToAct(): PlayerId | null {
    return humanActing(this.state, this.data.players ?? []);
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
    (this.data.timeline ??= []).push([this.since, ...this.data.remaining]);
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
    this.advanceLate();
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
    return seat ? this.seatConnected(seat) : false;
  }

  private seatConnected(seat: YonkoSeat): boolean {
    if (seat.bot) return true;
    for (const c of this.conns) if (!c.watch && c.token === seat.token) return true;
    return false;
  }

  /** Navegadores de jogadores ligados na mesa (os espectadores não contam: não seguram a mesa aberta). */
  get connections() {
    let n = 0;
    for (const c of this.conns) if (!c.watch) n++;
    return n;
  }

  /** Espectadores conectados agora. */
  get spectators() {
    let n = 0;
    for (const c of this.conns) if (c.watch) n++;
    return n;
  }

  attach(conn: YonkoConnection) {
    if (conn.watch) return this.attachWatcher(conn);
    this.conns.add(conn);
    this.presence();
    this.send([conn]);
  }

  detach(conn: YonkoConnection) {
    if (!this.conns.delete(conn)) return;
    if (!conn.watch) return this.presence();
    this.announceSpectators();
    this.advanceLate();
  }

  private attachWatcher(conn: YonkoConnection) {
    // As mãos só onde quem criou a mesa as liberou.
    if (conn.watch!.hands && !this.data.showHands) conn.watch!.hands = false;
    const delay = this.delayOf(conn);
    if (delay > 0) {
      // Quem já assistia atrasado recebe o que venceu antes de quem chega agora.
      this.advanceLate();
      this.ensureLate(delay);
    }
    this.conns.add(conn);
    this.send([conn]);
    this.announceSpectators();
    if (delay > 0) this.advanceLate();
  }

  /** O número de espectadores mudou: um aviso curto para todos (a mesa não é reenviada). */
  private announceSpectators() {
    const data = { spectators: this.spectators };
    for (const c of this.conns) c.send('presence', data);
  }

  /** Alguém entrou ou saiu: o abandono do jogador da vez começa ou para de contar, e a mesa fica sabendo. */
  private presence() {
    if (this.running !== null) {
      const here = this.connected(this.running);
      if (here && this.awaySince !== null) this.awaySince = null;
      else if (!here && this.awaySince === null) this.awaySince = this.deps.now();
      this.schedule();
    }
    this.send(this.live());
  }

  /** Fecha os canais de um token (quem saiu ou foi tirado da mesa). */
  private close(token: string) {
    for (const c of [...this.conns]) {
      if (c.watch || c.token !== token) continue;
      c.send('closed', {});
      c.end?.();
      this.conns.delete(c);
    }
  }

  /** A conexão recebe a mesa do zero (definições e registro): partida nova, ou outra mesa atrasada. */
  private reset(c: YonkoConnection) {
    c.sentDefs.clear();
    c.sentLog = 0;
  }

  // ------------------------------------------------------------------ mesa atrasada

  /**
   * Atraso da mesa de uma conexão (ms): jogadores, ao vivo; quem pede as mãos de todos, nunca abaixo de
   * MIN_HANDS_DELAY_MS (sem atraso escolhido, HANDS_DELAY_MS); os outros, o que pediram, até MAX_DELAY_MS.
   */
  delayOf(c: Pick<YonkoConnection, 'watch'>): number {
    const w = c.watch;
    if (!w) return 0;
    const delay = Math.min(MAX_DELAY_MS, Math.max(0, w.delay ?? 0));
    return w.hands ? Math.max(MIN_HANDS_DELAY_MS, w.delay === undefined ? HANDS_DELAY_MS : delay) : delay;
  }

  /** A mesa atrasada de uma conexão (null = recebe a mesa de agora). */
  private lateOf(c: YonkoConnection): LateTable | null {
    const delay = this.delayOf(c);
    return delay > 0 ? (this.lates.get(delay) ?? null) : null;
  }

  /** As conexões que recebem a mesa de agora (as outras seguem a mesa atrasada delas, em `advanceTable`). */
  private live(): YonkoConnection[] {
    return [...this.conns].filter((c) => this.lateOf(c) === null);
  }

  /** Refaz a partida de `delay` atrás para o primeiro espectador com esse atraso. */
  private ensureLate(delay: number): boolean {
    if (this.lates.has(delay)) return true;
    const game = this.game;
    if (!game) return false;
    try {
      const cutoff = this.deps.now() - delay;
      let state = game.initial();
      let count = 0;
      while (count < game.actions.length && game.timeline[count][0] <= cutoff) state = applyAction(state, game.actions[count++]);
      this.lates.set(delay, { delay, game, state, count, lastAction: count ? game.actions[count - 1] : null, timer: null });
      return true;
    } catch (e) {
      this.deps.log(`Mesa de Yonko ${this.id}: falha ao montar a mesa atrasada: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** Avança todas as mesas atrasadas (e descarta as que ficaram sem espectador). */
  private advanceLate() {
    for (const late of [...this.lates.values()]) this.advanceTable(late);
  }

  /**
   * Leva uma mesa atrasada até `delay` atrás: aplica as ações que já passaram do atraso, na ordem e no ritmo em
   * que aconteceram, e agenda o próximo passo. Sem ninguém com esse atraso, a mesa é descartada (volta a ser
   * refeita quando alguém chegar). Se a mesa foi reaberta, a partida que acabou fica no ar até o atraso passar
   * pela reabertura; aí quem assistia passa para a mesa de agora (a espera, ou a partida nova, também atrasada).
   */
  private advanceTable(late: LateTable) {
    if (late.timer) clearTimeout(late.timer);
    late.timer = null;
    if (this.lates.get(late.delay) !== late) return;
    const viewers = [...this.conns].filter((c) => this.delayOf(c) === late.delay);
    if (!viewers.length) {
      this.lates.delete(late.delay);
      return;
    }
    const cutoff = this.deps.now() - late.delay;
    const { actions, timeline, closedAt } = late.game;
    try {
      for (;;) {
        const nextAt = late.count < actions.length ? timeline[late.count][0] : Infinity;
        if (nextAt <= cutoff) {
          const action = actions[late.count];
          late.state = applyAction(late.state, action);
          late.count++;
          late.lastAction = action;
          this.send(viewers);
          continue;
        }
        if (closedAt !== undefined && nextAt === Infinity && closedAt <= cutoff) {
          this.lates.delete(late.delay);
          for (const c of viewers) this.reset(c);
          const next = this.ensureLate(late.delay) ? this.lates.get(late.delay)! : null;
          this.send(viewers);
          if (next) this.advanceTable(next);
          return;
        }
        const wake = Math.min(nextAt, closedAt ?? Infinity);
        if (wake !== Infinity) late.timer = setTimeout(() => this.advanceTable(late), wake - cutoff + 5);
        return;
      }
    } catch (e) {
      // O motor é determinístico: não deveria acontecer. Quem assistia reconecta e a mesa é refeita.
      this.deps.log(`Mesa de Yonko ${this.id}: falha na mesa atrasada: ${e instanceof Error ? e.message : e}`);
      this.lates.delete(late.delay);
      for (const c of viewers) {
        this.conns.delete(c);
        c.end?.();
      }
    }
  }

  /** Relógio de uma mesa atrasada: como estava `delay` atrás. */
  private lateClock(late: LateTable) {
    const at = this.deps.now() - late.delay;
    const { timeline, players, startedAt } = late.game;
    const prev = late.count ? timeline[late.count - 1] : [startedAt, ...players.map(() => YONKO_TIME_BANK_MS)];
    const next = timeline[late.count];
    const remaining = prev.slice(1);
    const running = humanActing(late.state, players);
    // Nunca abaixo do que ele tinha na ação seguinte (o servidor pode ter ficado fora do ar no meio).
    if (running !== null) remaining[running] = Math.max(next ? next[1 + running] : 0, remaining[running] - Math.max(0, at - prev[0]));
    return { remaining, running, total: YONKO_TIME_BANK_MS, awaySince: null, abandonMs: YONKO_ABANDON_MS };
  }

  // ------------------------------------------------------------------ o que cada conexão recebe

  /** Relógio agora. */
  clock() {
    const now = this.deps.now();
    const remaining = [...this.data.remaining];
    if (this.running !== null) remaining[this.running] = Math.max(0, remaining[this.running] - Math.max(0, now - this.since));
    return { remaining, running: this.running, total: YONKO_TIME_BANK_MS, awaySince: this.awaySince, abandonMs: YONKO_ABANDON_MS };
  }

  /**
   * O que entra no `state` de uma conexão. Jogador: a mesa de agora, do lugar dele. Espectador: a mesa de agora
   * ou a atrasada, sem a mão de ninguém; `as` troca o ponto de vista pelo de um jogador e `hands` traz as mãos de
   * todos, que só saem da mesa atrasada e de uma partida que começou com as mãos liberadas.
   */
  private viewOf(c: YonkoConnection): ConnView {
    if (!c.watch) return { late: null, game: this.game, state: this.state, lastAction: this.lastAction, pov: this.playerOfToken(c.token), hands: false };
    const late = this.lateOf(c);
    const game = late ? late.game : this.game;
    const state = late ? late.state : this.state;
    const lastAction = late ? late.lastAction : this.lastAction;
    // Pediu atraso e não há mesa atrasada (não deu para refazê-la): a mesa de agora, só com a visão pública.
    if (!late && this.delayOf(c) > 0) return { late, game, state, lastAction, pov: null, hands: false };
    const seat = c.watch.as && game ? game.players.findIndex((s) => !s.bot && s.token === c.watch!.as) : -1;
    return { late, game, state, lastAction, pov: seat >= 0 ? seat : null, hands: Boolean(late && c.watch.hands && game?.hands) };
  }

  /**
   * O resumo da mesa para quem tem `token` (a sala de espera e, na partida, quem é quem); `token` null é um
   * espectador, e `v` diz o que ele vê (com `v.late`, a partida como estava na mesa atrasada).
   */
  info(token: string | null, v?: Pick<ConnView, 'late' | 'pov' | 'hands'>) {
    const you = this.seatOfToken(token);
    const late = v?.late ?? null;
    const game = late ? late.game : this.game;
    const state = late ? late.state : this.state;
    const seatView = (s: YonkoSeat | null, i: number) =>
      s && {
        name: s.name,
        bot: s.bot,
        ready: s.bot || i === this.data.host || s.ready,
        connected: this.seatConnected(s),
        leader: s.deck.leader,
        leaderName: s.leaderName ?? s.deck.leader,
        colors: s.colors ?? [],
        // O nome do deck é de quem senta à mesa: quem só assiste vê o Líder.
        deckName: token === null ? '' : s.deckName,
        test: s.test,
        you: i === you,
      };
    return {
      id: this.id,
      // O código é o convite para sentar: quem assiste não o recebe (uma tela de transmissão o mostraria na live).
      code: token === null ? '' : this.data.code,
      status: late ? (late.state.phase === 'gameover' ? 'finished' : 'playing') : this.status,
      host: this.data.host,
      you,
      rules: this.data.rules,
      seats: this.data.seats.map(seatView),
      problem: this.status === 'waiting' ? this.startProblem() : null,
      /** Na partida: o jogador do motor de quem pede, e cada jogador com o lugar da sala dele. */
      player: token === null ? null : this.playerOfToken(token),
      players: game?.players.map((s, i) => ({ seat: game.seatOf[i], name: s.name, bot: s.bot, connected: this.seatConnected(s), leader: s.deck.leader, test: s.test })) ?? null,
      clock: late ? this.lateClock(late) : state ? this.clock() : null,
      spectators: this.spectators,
      /** A mesa aparece em "Assistir partidas", e as mãos podem aparecer para quem transmite. */
      listed: Boolean(this.data.listed),
      showHands: Boolean(this.data.showHands),
      /** Só para o espectador: de quem é a visão (null = pública), se as mãos de todos vêm junto e o atraso (ms). */
      watch: token === null ? { pov: v?.pov ?? null, hands: Boolean(v?.hands), delay: late?.delay ?? 0 } : null,
    };
  }

  /** O resumo público da mesa: a lista "Assistir partidas" e a busca pelo código. */
  summary() {
    const st = this.state;
    const seated = this.data.players ?? this.data.seats.filter((s): s is YonkoSeat => s !== null);
    return {
      id: this.id,
      status: this.status,
      listed: Boolean(this.data.listed),
      handsAllowed: Boolean(this.data.showHands),
      spectators: this.spectators,
      turn: st?.turn ?? 0,
      createdAt: this.data.createdAt,
      players: seated.map((s, i) => {
        const ps = this.data.players ? st?.players[i] : undefined;
        return {
          name: s.name,
          bot: s.bot,
          leader: s.deck.leader,
          leaderName: s.leaderName ?? s.deck.leader,
          leaderImage: (st && ps && cardImage(st, ps.leader.uid)) ?? null,
          colors: s.colors ?? [],
          life: ps?.life.length ?? 0,
          hand: ps?.hand.length ?? 0,
          out: Boolean(ps?.out),
        };
      }),
    };
  }

  /** O `state` de uma visão (igual para todas as conexões que a têm). */
  private snapshot(c: YonkoConnection, v: ConnView): Snapshot {
    const room = this.info(c.watch ? null : c.token, v);
    // Jogador sem lugar na partida (não acontece: a mesa fecha a entrada ao começar) não recebe nem a pública.
    if (!v.state || !v.game || (!c.watch && v.pov === null)) return { room, view: null, defs: {}, log: [], lastAction: null };
    const extra = v.hands ? handsOf(v.state) : undefined;
    const { defs, log, ...view } = viewFor(v.state, v.pov, v.game.aliases, extra);
    return { room, view, defs, log, lastAction: v.lastAction ? aliasRefs(v.state, v.pov, v.game.aliases, v.lastAction, extra) : null };
  }

  /** Manda a cada conexão a mesa como ela a vê (só as cartas e as linhas novas); cada visão é montada uma vez. */
  private send(conns: Iterable<YonkoConnection>) {
    const shared = new Map<string, Snapshot>();
    for (const c of conns) {
      const v = this.viewOf(c);
      // Os jogadores têm cada um a sua visão; os espectadores dividem as deles.
      const key = c.watch ? `${v.late?.delay ?? 0}:${v.pov}:${v.hands ? 1 : 0}` : null;
      let s = key === null ? undefined : shared.get(key);
      if (!s) {
        s = this.snapshot(c, v);
        if (key !== null) shared.set(key, s);
      }
      if (!s.view) {
        c.send('state', { room: s.room, view: null, defs: {}, log: { from: 0, entries: [] }, lastAction: null });
        continue;
      }
      const newDefs: Record<string, CardDef> = {};
      for (const id in s.defs) {
        if (c.sentDefs.has(id)) continue;
        c.sentDefs.add(id);
        newDefs[id] = s.defs[id];
      }
      const from = Math.min(c.sentLog, s.log.length);
      const entries: LogEntry[] = s.log.slice(from);
      c.sentLog = s.log.length;
      c.send('state', { room: s.room, view: s.view, defs: newDefs, log: { from, entries }, lastAction: s.lastAction });
    }
  }

  /** Mudou algo: grava e avisa quem recebe a mesa de agora (a mesa atrasada avança sozinha, em `advanceLate`). */
  private changed() {
    this.deps.save?.(this);
    this.send(this.live());
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
    for (const late of this.lates.values()) if (late.timer) clearTimeout(late.timer);
    this.lates.clear();
    for (const c of this.conns) {
      if (closed) c.send('closed', {});
      c.end?.();
    }
    this.conns.clear();
  }
}
