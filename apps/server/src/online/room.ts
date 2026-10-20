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
// Mesa atrasada: um espectador pode assistir com atraso (`Connection.delay`). As mãos dos dois
// jogadores só aparecem nas partidas de torneio e nas salas privadas em que quem criou liberou
// as mãos (`RoomData.showHands`, para um streamer transmitir o jogo de dois amigos); fora disso,
// ninguém vê a mão do oponente. Quem as vê sempre assiste atrasado (no mínimo MIN_HANDS_DELAY_MS): a partida pode estar
// numa live, e o oponente não pode abrir a transmissão para ver a mão do outro. Cada atraso
// em uso tem a sua mesa, refeita a partir das ações gravadas e avançada no mesmo ritmo em que
// elas aconteceram; emotes, chat, dados e o aviso de revanche chegam com o mesmo atraso.
// O modo transmissão também pode mostrar a mesa do ponto de vista do streamer que joga a
// partida (`Connection.as`: a mão dele, nunca a do oponente).
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
  type CardEngineText,
  chooseBotAction,
  createAliases,
  createGame,
  type DeckList,
  type GameState,
  hiddenDecision,
  IllegalActionError,
  type LogEntry,
  type ManualOp,
  type PlayerId,
  REPLAY_VERSION,
  upgradeReplayActions,
  viewFor,
} from '@gumgum/engine';
import { type ErrorParams, fail } from '../errors';
import type { PlayFormat } from '../stats/catalog';
import { censor } from './profanity';

export const TIME_BANK_MS = 17 * 60_000 + 30_000;
/** Jogador da vez desconectado por este tempo perde por abandono. */
export const ABANDON_MS = 2 * 60_000;
/** Limite de ações por assento numa janela de RATE_WINDOW_MS. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10_000;
const MAX_ACTIONS = 5000;
/** Espectadores por sala. */
export const MAX_SPECTATORS = 100;
/** Atraso padrão da mesa de quem vê as mãos dos jogadores (ver o começo do arquivo). */
export const HANDS_DELAY_MS = 3 * 60_000;
/** Atraso mínimo para ver as mãos dos dois jogadores e o máximo de qualquer mesa atrasada. */
export const MIN_HANDS_DELAY_MS = 60_000;
export const MAX_DELAY_MS = 10 * 60_000;
/** Pausa antes de cada jogada do bot, para a jogada ser visível. */
const BOT_DELAY_MS = 700;
/**
 * Faixa de tempo do bot nas decisões que escondem informação (Counter, carta da Vida, "pagar X?",
 * escolhas na mão ou no deck): um tempo fixo (ou uma resposta imediata) contaria ao oponente
 * que o bot não tinha o que usar.
 */
const BOT_HIDDEN_DECISION_MS = [800, 2000] as const;

export interface DiceThrow {
  seat: PlayerId;
  vx: number;
  vy: number;
}

export const EMOTES = ['hello', 'gg', 'nice', 'think', 'wow', 'oops', 'thanks', 'hurry'] as const;
export type EmoteId = (typeof EMOTES)[number];

/** Tamanho máximo de uma mensagem do chat da partida. */
export const CHAT_MAX_LENGTH = 120;
/** Chat: intervalo mínimo entre mensagens e teto por minuto, por assento. */
const CHAT_MIN_INTERVAL_MS = 1500;
const CHAT_PER_MINUTE = 10;

/**
 * private = sala com código; casual e ranked = filas; bot = treino contra o bot do
 * servidor; tournament = partida de uma rodada de torneio.
 */
export type RoomQueue = 'private' | 'casual' | 'ranked' | 'bot' | 'tournament';

/** Jogo de uma partida de torneio jogado na sala. */
export interface RoomTournament {
  id: string;
  name: string;
  round: number;
  /** Nome da rodada ("Rodada 3", "Semifinal"…). */
  label: string;
  /** Id da partida (série) em tournament_matches. */
  matchId: number;
  /** Jogo da série (1, 2, 3…) e melhor de quantos. */
  game: number;
  bestOf: number;
  /** Jogos já vencidos na série, por conta (userId). */
  wins: Record<string, number>;
  /** Conta que começa este jogo (quem perdeu o anterior); ausente = sorteio. */
  firstUserId?: string | null;
  /** O organizador liberou as mãos ao vivo para quem transmite (sem o atraso mínimo; ver `Room.handsLive`). */
  liveHands?: boolean;
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
  /** Concluiu o tutorial: título "Aprendiz da Grand Line" ao lado do nome. */
  apprentice?: boolean;
}

export interface RoomResult {
  matchId: number | null;
  /** Recompensa antes e depois (ranqueada). */
  bounty: Array<{ before: number | null; after: number | null }> | null;
  error?: string;
  /** Chave de `error` para o cliente traduzir. */
  errorCode?: string;
}

/** As cartas com os textos para o motor fixados na sala (sem `pinned`, as cartas como estão). */
export function pinEngineTexts(cards: CardData[], pinned: Record<string, CardEngineText> | undefined): CardData[] {
  if (!pinned) return cards;
  return cards.map(({ engineText: _now, ...c }) => (pinned[c.id] ? { ...c, engineText: pinned[c.id] } : c));
}

/** O que é gravado no banco para refazer a sala depois de reiniciar o servidor. */
export interface RoomData {
  id: string;
  code: string | null;
  queue: RoomQueue;
  format: PlayFormat;
  /**
   * Sala privada, treino contra o bot e torneio: aceita cartas de spoiler (o Livre sempre
   * aceita). As filas não têm o campo: a casual aceita spoilers e a ranqueada não.
   */
  spoilers?: boolean;
  createdAt: number;
  seats: SeatInfo[];
  seed128: number[] | null;
  /**
   * O vencedor do sorteio escolhe se joga primeiro. Salas gravadas antes desta
   * opção não têm o campo e continuam sendo refeitas como foram jogadas.
   */
  chooseFirst?: boolean;
  aliasSalt: string;
  actions: Action[];
  remaining: [number, number];
  result: RoomResult | null;
  /** Ids das salas de revanche pedidas (por assento). */
  rematch?: [boolean, boolean];
  rematchRoom?: string | null;
  tournament?: RoomTournament;
  /** Quem começa, quando não é sorteado (jogos 2+ de uma série de torneio). */
  firstPlayer?: PlayerId;
  /**
   * Versão do motor (`REPLAY_VERSION`) em que a partida começou. Salas começadas antes da
   * versão 9 não têm o campo e são refeitas com a preparação antiga (`legacySetup`).
   */
  replayVersion?: number;
  /**
   * Textos para o motor (perfil Dev) das cartas da partida quando ela começou: a sala é refeita com
   * eles mesmo que o Dev mude o texto depois. Salas gravadas antes do campo usam os de agora.
   */
  engineTexts?: Record<string, CardEngineText>;
  /**
   * Quando cada ação de `actions` aconteceu (ms) e o tempo dos dois jogadores logo depois dela:
   * é o que a mesa atrasada de quem vê as mãos reproduz. Salas gravadas antes do campo não o têm.
   */
  timeline?: Array<[at: number, left0: number, left1: number]>;
  /** Quando a partida começou (ms). */
  startedAt?: number;
  /** Sala privada: quem criou liberou as mãos dos jogadores para quem transmite (streamer e admin, com atraso). */
  showHands?: boolean;
  /**
   * Partida de torneio pausada à espera do Judge (chamado de um jogador, `by` = assento, ou do
   * próprio Judge/organizador, `by` = null): o relógio para e nenhuma jogada é aceita até `resume`.
   */
  pause?: { by: PlayerId | null; at: number } | null;
  /** Pausas já feitas (`[de, até]`; `até` = null na pausa em curso), para a mesa atrasada descontar o tempo parado. */
  pauses?: Array<[number, number | null]>;
  /**
   * Modo manual do Judge (partida de torneio pausada): quem entrou (`by` = conta, `name` = nome no log)
   * pode desfazer jogadas (`judgeUndo`) e corrigir a mesa (`judgeAct`). Sai com `leaveManual` ou ao retomar.
   */
  manual?: { by: string; name: string; at: number } | null;
}

export interface Connection {
  /** Assento do jogador; null = espectador. */
  seat: PlayerId | null;
  /** Espectador vendo as mãos dos dois jogadores (streamer ou admin), na mesa atrasada (ao vivo só com `Room.handsLive`). */
  hands?: boolean;
  /** Espectador que vê a mesa como este jogador (o streamer transmitindo a própria partida). */
  as?: PlayerId;
  /** Atraso da mesa deste espectador (ms); 0 ou ausente = ao vivo. Ver `lateDelay`. */
  delay?: number;
  /** Judge do torneio (ou organizador): vê as duas mãos ao vivo, sem atraso, só nas salas de torneio. */
  judge?: boolean;
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
  /** Momentos que viram notificação no celular (ver push/routes.ts). */
  onEvent?: (room: Room, event: RoomEvent) => void;
}

/**
 * `start`: os dois jogadores estão na sala e a partida começou. `turn`: a vez passou para
 * um assento humano (começo do turno ou uma decisão no turno do oponente, como o Counter).
 * `seats`: quem avisar — só jogadores humanos longe do app (sem conexão ou com o app fora
 * da tela), nunca quem acabou de entrar na sala.
 */
export type RoomEvent = { type: 'start' | 'turn'; seats: PlayerId[] };

/** Intervalo mínimo entre dois avisos de "sua vez" para o mesmo assento (ataques com Blocker e Counter em sequência). */
export const TURN_NOTICE_MS = 30_000;

/**
 * Resultado de uma ação. Recusa: `code` é o status HTTP; `errorCode` (+ `errorParams`) é a chave
 * que o cliente traduz. Sem `errorCode` quando o texto vem do motor (`IllegalActionError`).
 */
export type ActResult = { ok: true; actionCount: number } | { ok: false; code: number; error: string; errorCode?: string; errorParams?: ErrorParams };

export const randomToken = () => randomBytes(24).toString('base64url');

/** Uma mesa atrasada: o estado depois das primeiras `count` ações, para quem assiste com `delay` de atraso. */
interface LateTable {
  delay: number;
  state: GameState;
  count: number;
  lastAction: Action | null;
  /** Emotes, chat, dados e revanche que ainda não passaram do atraso desta mesa. */
  events: LateEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Evento fora do jogo à espera do atraso: sai depois das `after` primeiras ações e de `at` + atraso. */
interface LateEvent {
  at: number;
  after: number;
  event: string;
  data: unknown;
}

/**
 * Atraso da mesa de uma conexão: jogadores, ao vivo; quem vê as mãos, nunca abaixo de `minHands`
 * (MIN_HANDS_DELAY_MS, ou 0 onde o organizador liberou as mãos ao vivo; ver `Room.handsLive`).
 */
export function lateDelay(c: Pick<Connection, 'seat' | 'hands' | 'delay' | 'judge'>, minHands = MIN_HANDS_DELAY_MS): number {
  if (c.seat !== null || c.judge) return 0;
  const delay = Math.min(MAX_DELAY_MS, Math.max(0, c.delay ?? 0));
  return c.hands ? Math.max(minHands, c.delay === undefined ? HANDS_DELAY_MS : delay) : delay;
}

/**
 * Cartas a mais na visão de quem vê as mãos (sempre da mesa atrasada): as duas mãos e a carta
 * da Vida que o dono está olhando.
 */
function handsOf(state: GameState): string[] {
  const p = state.pending;
  return [...state.players.flatMap((ps) => ps.hand), ...(p?.kind === 'lifeCard' ? [p.card] : [])];
}

export function newRoomData(
  init: Pick<RoomData, 'queue' | 'format' | 'spoilers' | 'code' | 'tournament'> & { id?: string; seats: SeatInfo[] },
): RoomData {
  return {
    ...(init.tournament ? { tournament: init.tournament } : {}),
    ...(init.spoilers !== undefined ? { spoilers: init.spoilers } : {}),
    id: init.id ?? randomBytes(9).toString('base64url'),
    code: init.code,
    queue: init.queue,
    format: init.format,
    createdAt: Date.now(),
    seats: init.seats,
    seed128: null,
    chooseFirst: true,
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
  /** Pausada pelo Judge: o relógio não corre e as jogadas são recusadas (`data.pause`). */
  private paused = false;
  private since = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  /** Desde quando o jogador da vez está sem conexão. */
  private awaySince: number | null = null;
  private recent: [number[], number[]] = [[], []];
  private lastEmote: [number, number] = [0, 0];
  /** Instantes das mensagens de chat recentes de cada assento (rate limit). */
  private chatTimes: [number[], number[]] = [[], []];
  /**
   * Lançamento do dado do sorteio de cada assento (velocidade em larguras/alturas da
   * mesa por segundo). Só para a animação: o vencedor já saiu da seed. Fica em memória.
   */
  private diceThrows: [DiceThrow | null, DiceThrow | null] = [null, null];
  private diceAt: [number, number] = [0, 0];
  /** Mesas atrasadas, por atraso; cada uma só existe enquanto alguém assiste com aquele atraso. */
  private readonly lates = new Map<number, LateTable>();
  /** Emotes, chat, dados e revanche dos últimos MAX_DELAY_MS (para as mesas atrasadas que surgirem). Só em memória. */
  private recentEvents: LateEvent[] = [];
  private lastAction: Action | null = null;
  /** Último aviso de "sua vez" de cada assento. */
  private turnNoticeAt: [number, number] = [-Infinity, -Infinity];
  /** O jogador está com o app fora da tela (o navegador avisa em /focus). Só em memória. */
  private hidden: [boolean, boolean] = [false, false];
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

  /** As mãos dos jogadores podem aparecer para quem assiste (com o perfil e o atraso): torneio ou sala privada liberada. */
  get handsAllowed(): boolean {
    return this.data.queue === 'tournament' || (this.data.queue === 'private' && Boolean(this.data.showHands));
  }

  /**
   * As mãos podem aparecer ao vivo, sem o atraso mínimo: partida de torneio em que o organizador
   * liberou as mãos ao vivo. Fora disso, quem vê as mãos assiste com pelo menos MIN_HANDS_DELAY_MS.
   */
  get handsLive(): boolean {
    return this.data.queue === 'tournament' && Boolean(this.data.tournament?.liveHands);
  }

  /** Atraso mínimo de quem vê as mãos nesta sala (ms). */
  get minHandsDelay(): number {
    return this.handsLive ? 0 : MIN_HANDS_DELAY_MS;
  }

  /** Atraso da mesa desta conexão (ver `lateDelay`). */
  delayOf(c: Pick<Connection, 'seat' | 'hands' | 'delay' | 'judge'>): number {
    return lateDelay(c, this.minHandsDelay);
  }

  private isLate(c: Connection): boolean {
    return this.delayOf(c) > 0;
  }

  /**
   * Partida de torneio: o fim não revela as cartas escondidas (o que sobrou no deck e na mão
   * do oponente), e o replay não sai da sala. As listas só se abrem quando o torneio termina,
   * na página dele; até lá, ninguém leva a lista do adversário da mesa.
   */
  get sealed(): boolean {
    return this.data.queue === 'tournament';
  }

  seatOf(token: unknown): PlayerId | null {
    if (typeof token !== 'string') return null;
    const i = this.data.seats.findIndex((s) => s.token === token);
    return i === 0 || i === 1 ? i : null;
  }

  /** Segundo jogador entrou: embaralha e começa. `by`: quem entrou agora (não precisa de aviso). */
  start(by?: PlayerId) {
    if (this.state || this.data.seats.length !== 2) return;
    this.data.seed128 = [0, 1, 2, 3].map(() => randomInt(0, 2 ** 32) | 0);
    this.data.replayVersion = REPLAY_VERSION;
    this.data.engineTexts = Object.fromEntries(
      this.deps
        .cards(this.cardIds())
        .filter((c) => c.engineText)
        .map((c) => [c.id, c.engineText!]),
    );
    this.data.startedAt = this.deps.now();
    this.data.timeline = [];
    this.rebuild();
    this.save();
    this.broadcast();
    const seats = ([0, 1] as const).filter((p) => p !== by && this.away(p));
    if (seats.length) this.deps.onEvent?.(this, { type: 'start', seats });
  }

  private cardIds() {
    return [...new Set(this.data.seats.flatMap((s) => [s.deck.leader, ...s.deck.cards.map((c) => c.id)]))];
  }

  private config() {
    const [a, b] = this.data.seats;
    return {
      seed: 0,
      seed128: this.data.seed128!,
      chooseFirst: Boolean(this.data.chooseFirst),
      ...(this.data.firstPlayer !== undefined ? { firstPlayer: this.data.firstPlayer } : {}),
      ...(this.legacySetup ? { legacySetup: true } : {}),
      cards: pinEngineTexts(this.deps.cards(this.cardIds()), this.data.engineTexts),
      players: [
        { name: a.name, deck: a.deck, isBot: Boolean(a.bot) },
        { name: b.name, deck: b.deck, isBot: Boolean(b.bot) },
      ] as [{ name: string; deck: DeckList; isBot: boolean }, { name: string; deck: DeckList; isBot: boolean }],
    };
  }

  /** Partida começada antes da versão 9 dos replays: preparação antiga (ordem da Vida, "at the start of the game"). */
  get legacySetup(): boolean {
    return (this.data.replayVersion ?? 8) < 9;
  }

  /** Cria o jogo e refaz as ações gravadas (ao começar ou depois de reiniciar o servidor). */
  private rebuild() {
    const config = this.config();
    let state = createGame(config);
    let i = 0;
    const salt = this.data.aliasSalt;
    this.aliases = createAliases(state, () => `k${createHmac('sha256', salt).update(String(i++)).digest('base64url').slice(0, 10)}`);
    // Partida começada numa versão anterior do motor (deploy no meio do jogo): as perguntas que o motor
    // passou a fazer recebem a resposta que ele dava sozinho (`upgradeReplayActions`).
    if ((this.data.replayVersion ?? 8) < REPLAY_VERSION && this.data.actions.length) this.data.actions = upgradeReplayActions(config, this.data.actions);
    // Sem o instante das ações (sala gravada antes do campo, ou ações refeitas acima), elas contam
    // como feitas agora: a mesa atrasada nunca mostra as mãos de agora antes da hora.
    const now = this.deps.now();
    if (this.data.timeline?.length !== this.data.actions.length) {
      this.data.timeline = this.data.actions.map(() => [now, this.data.remaining[0], this.data.remaining[1]]);
    }
    this.data.startedAt ??= now;
    for (const a of this.data.actions) state = applyAction(state, a);
    this.state = state;
    this.lastAction = this.data.actions[this.data.actions.length - 1] ?? null;
    // O tempo em que o servidor ficou fora do ar não conta para ninguém.
    this.startClock();
  }

  private startClock() {
    this.running = this.state && this.state.phase !== 'gameover' ? actingPlayer(this.state) : null;
    this.paused = Boolean(this.data.pause) && this.running !== null;
    if (!this.paused && this.data.pause) this.data.pause = null;
    if (!this.paused && this.data.manual) this.data.manual = null;
    this.since = this.deps.now();
    this.awaySince = null;
    this.updatePresence();
    this.schedule();
    this.driveBot();
  }

  /** Desconta do jogador da vez o tempo desde a última mudança (nada durante a pausa). */
  private settle() {
    const now = this.deps.now();
    if (this.running !== null && !this.paused) this.data.remaining[this.running] = Math.max(0, this.data.remaining[this.running] - (now - this.since));
    this.since = now;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running === null || this.paused) return;
    const now = this.deps.now();
    const left = this.data.remaining[this.running] - (now - this.since);
    const away = this.awaySince === null ? Infinity : this.awaySince + ABANDON_MS - now;
    const wait = Math.max(0, Math.min(left, away));
    this.timer = setTimeout(() => this.tick(), wait + 5);
  }

  /** O relógio do jogador da vez acabou, ou ele está ausente há tempo demais. */
  private tick() {
    this.timer = null;
    if (this.running === null || this.paused || !this.state || this.state.phase === 'gameover') return;
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
    (this.data.timeline ??= []).push([this.deps.now(), this.data.remaining[0], this.data.remaining[1]]);
    this.lastAction = action;
    const before = this.running;
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
        this.data.result = { matchId: null, bounty: null, ...fail('resultNotSaved', 'Não foi possível gravar o resultado.') };
      }
    }
    this.save();
    this.broadcast();
    this.advanceLate();
    if (this.running !== null && this.running !== before) this.turnNotice(this.running);
  }

  /** Avisa que a vez passou para `seat`, se ele estiver longe do app (no máximo um aviso a cada TURN_NOTICE_MS). */
  private turnNotice(seat: PlayerId) {
    if (!this.away(seat)) return;
    const now = this.deps.now();
    if (now - this.turnNoticeAt[seat] < TURN_NOTICE_MS) return;
    this.turnNoticeAt[seat] = now;
    this.deps.onEvent?.(this, { type: 'turn', seats: [seat] });
  }

  /** Jogador humano sem conexão com a sala ou com o app fora da tela (quem recebe notificação). */
  private away(seat: PlayerId) {
    const s = this.data.seats[seat];
    return Boolean(s && !s.bot && (this.hidden[seat] || !this.connected(seat)));
  }

  /** O navegador do jogador avisa quando o app sai da tela ou volta para ela. */
  setVisible(seat: PlayerId, visible: boolean) {
    this.hidden[seat] = !visible;
  }

  /** Ação de um jogador, feita sobre a visão de versão `seq`. */
  act(seat: PlayerId, seq: unknown, raw: unknown): ActResult {
    if (!this.state || !this.aliases) return { ok: false, code: 409, ...fail('matchNotStarted', 'A partida ainda não começou.') };
    if (this.state.phase === 'gameover') return { ok: false, code: 409, ...fail('matchOver', 'A partida já terminou.') };
    if (this.paused) return { ok: false, code: 409, ...fail('roomPaused', 'A partida está pausada à espera do Judge.') };
    const action = raw as Action;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return { ok: false, code: 400, ...fail('invalidAction', 'Ação inválida.') };
    }
    if (action.player !== seat) return { ok: false, code: 403, ...fail('notYourAction', 'Essa ação não é sua.') };
    // `timeout` é do relógio do servidor; `manual` (mexer na mesa à mão) não existe mais nas partidas online.
    if (action.type === 'timeout' || action.type === 'manual') return { ok: false, code: 400, ...fail('invalidAction', 'Ação inválida.') };
    if (this.data.actions.length >= MAX_ACTIONS) return { ok: false, code: 409, ...fail('matchTooLong', 'Partida longa demais.') };
    // Desistir vale a qualquer momento; o resto precisa da visão atual.
    if (action.type !== 'concede' && seq !== this.state.actionCount) {
      return { ok: false, code: 409, ...fail('boardChanged', 'A mesa mudou; tente de novo.') };
    }
    const now = this.deps.now();
    const recent = (this.recent[seat] = this.recent[seat].filter((t) => now - t < RATE_WINDOW_MS));
    if (recent.length >= (this.deps.rateLimit ?? RATE_LIMIT)) return { ok: false, code: 429, ...fail('tooManyActions', 'Muitas ações em pouco tempo.') };
    recent.push(now);

    const real = actionFromView(this.state, this.aliases, action);
    if (typeof real === 'string') return { ok: false, code: 422, error: real };
    try {
      // applyAction não muda o estado anterior: uma ação recusada não deixa rastro.
      this.commit(real);
    } catch (e) {
      if (e instanceof IllegalActionError) return { ok: false, code: 422, error: e.message };
      this.deps.log(`Partida online ${this.id}: erro do motor: ${e instanceof Error ? e.stack : e}`);
      return e instanceof Error ? { ok: false, code: 422, error: e.message } : { ok: false, code: 422, ...fail('invalidAction', 'Ação inválida.') };
    }
    return { ok: true, actionCount: this.state.actionCount };
  }

  // ------------------------------------------------------------------ pausa (chamado de Judge)

  get isPaused() {
    return this.paused;
  }

  /**
   * Chamado de Judge: congela a partida. `by`: o assento que chamou (null = o próprio Judge ou o
   * organizador). O tempo de quem estava jogando para de contar, o abandono também, e as jogadas
   * dos dois são recusadas até `resume`; o chat continua aberto para falarem com o Judge.
   */
  pause(by: PlayerId | null): ActResult {
    if (!this.state || this.state.phase === 'gameover') return { ok: false, code: 409, ...fail('matchNotStarted', 'A partida ainda não começou.') };
    if (this.paused) return { ok: false, code: 409, ...fail('roomAlreadyPaused', 'A partida já está pausada.') };
    this.settle();
    const now = this.deps.now();
    this.paused = true;
    this.data.pause = { by, at: now };
    (this.data.pauses ??= []).push([now, null]);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.save();
    this.broadcast();
    return { ok: true, actionCount: this.state.actionCount };
  }

  /** O Judge (ou o organizador) libera a partida: o relógio volta de onde parou e o abandono recomeça do zero. Sai do modo manual. */
  resume(): ActResult {
    if (!this.paused) return { ok: false, code: 409, ...fail('roomNotPaused', 'A partida não está pausada.') };
    const now = this.deps.now();
    this.paused = false;
    this.data.pause = null;
    this.data.manual = null;
    const last = this.data.pauses?.[this.data.pauses.length - 1];
    if (last && last[1] === null) last[1] = now;
    this.since = now;
    this.awaySince = this.running !== null && !this.connected(this.running) ? now : null;
    this.schedule();
    this.driveBot();
    this.save();
    this.broadcast();
    return { ok: true, actionCount: this.state?.actionCount ?? 0 };
  }

  // ------------------------------------------------------------------ modo manual do Judge

  get manualMode() {
    return this.data.manual ?? null;
  }

  /**
   * O Judge entra no modo manual (só em partida de torneio): a partida pausa, se ainda não estava
   * (`pausedNow`), e só ele mexe na mesa até sair (`leaveManual`) ou retomar (`resume`).
   */
  enterManual(by: { id: string; name: string }): ActResult & { pausedNow?: boolean } {
    if (this.data.queue !== 'tournament') return { ok: false, code: 409, ...fail('manualTournamentOnly', 'O modo manual só existe nas partidas de torneio.') };
    if (!this.state || this.state.phase === 'gameover') return { ok: false, code: 409, ...fail('matchNotStarted', 'A partida ainda não começou.') };
    if (this.data.manual) return { ok: false, code: 409, ...fail('roomAlreadyManual', 'A partida já está no modo manual.') };
    let pausedNow = false;
    if (!this.paused) {
      const r = this.pause(null);
      if (!r.ok) return r;
      pausedNow = true;
    }
    this.data.manual = { by: by.id, name: by.name, at: this.deps.now() };
    this.save();
    this.broadcast();
    return { ok: true, actionCount: this.state.actionCount, pausedNow };
  }

  /** Sai do modo manual; a partida continua pausada até o Judge retomar. */
  leaveManual(): ActResult {
    if (!this.data.manual) return { ok: false, code: 409, ...fail('roomNotManual', 'A partida não está no modo manual.') };
    this.data.manual = null;
    this.save();
    this.broadcast();
    return { ok: true, actionCount: this.state?.actionCount ?? 0 };
  }

  /** Recusa do modo manual: a sala precisa estar nele, com a mesa na versão que o Judge viu (`seq`). */
  private manualRefusal(seq: unknown): ActResult | null {
    if (!this.state || !this.aliases || this.state.phase === 'gameover') return { ok: false, code: 409, ...fail('matchNotStarted', 'A partida ainda não começou.') };
    if (!this.data.manual || !this.paused) return { ok: false, code: 409, ...fail('roomNotManual', 'A partida não está no modo manual.') };
    if (seq !== this.state.actionCount) return { ok: false, code: 409, ...fail('boardChanged', 'A mesa mudou; tente de novo.') };
    return null;
  }

  /**
   * Últimas `limit` ações, para o Judge escolher até onde desfazer: `count` é quantas ações ficam se ele
   * voltar para antes desta, e `logFrom`/`logTo` são as linhas do log que ela gerou (o log da visão tem
   * as mesmas linhas, na mesma ordem). Refaz a partida desde o começo (só no modo manual, raro).
   */
  history(limit = 30): Array<{ count: number; type: Action['type']; player: PlayerId; logFrom: number; logTo: number }> {
    if (!this.state) return [];
    const actions = this.data.actions;
    const first = Math.max(0, actions.length - limit);
    const out: Array<{ count: number; type: Action['type']; player: PlayerId; logFrom: number; logTo: number }> = [];
    let state = createGame(this.config());
    for (let i = 0; i < actions.length; i++) {
      const logFrom = state.log.length;
      state = applyAction(state, actions[i]);
      if (i >= first) out.push({ count: i, type: actions[i].type, player: actions[i].player, logFrom, logTo: state.log.length });
    }
    return out.reverse();
  }

  /**
   * O Judge desfaz as jogadas: ficam só as primeiras `count` ações e a partida é refeita a partir
   * delas (o motor é determinístico: refazer a mesma jogada dá o mesmo resultado, inclusive compras
   * e embaralhamentos). O relógio fica como está. Devolve as ações removidas (para a auditoria).
   */
  judgeUndo(seq: unknown, count: unknown): ActResult & { removed?: Action[] } {
    const refused = this.manualRefusal(seq);
    if (refused) return refused;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count >= this.data.actions.length) {
      return { ok: false, code: 400, ...fail('invalidUndo', 'Escolha uma jogada para desfazer.') };
    }
    const removed = this.data.actions.slice(count);
    const actions = this.data.actions;
    const timeline = this.data.timeline;
    this.data.actions = actions.slice(0, count);
    if (timeline) this.data.timeline = timeline.slice(0, count);
    try {
      this.rebuild();
    } catch (e) {
      // Não deveria acontecer (as mesmas ações já foram aplicadas): volta como estava.
      this.data.actions = actions;
      if (timeline) this.data.timeline = timeline;
      this.rebuild();
      this.deps.log(`Partida online ${this.id}: falha ao desfazer: ${e instanceof Error ? e.message : e}`);
      return { ok: false, code: 500, ...fail('undoFailed', 'Não foi possível desfazer.') };
    }
    // Eventos fora do jogo presos a ações que não existem mais saem logo depois do novo fim.
    for (const e of this.recentEvents) e.after = Math.min(e.after, count);
    // As mesas atrasadas que passaram do novo fim são refeitas (quem assiste com atraso recebe a mesa de novo).
    for (const late of [...this.lates.values()]) {
      if (late.count <= count) continue;
      if (late.timer) clearTimeout(late.timer);
      this.lates.delete(late.delay);
      if (this.ensureLate(late.delay)) {
        for (const c of this.conns) if (this.isLate(c) && this.delayOf(c) === late.delay) c.send('state', this.snapshot(c));
      } else {
        for (const c of this.conns) if (this.isLate(c) && this.delayOf(c) === late.delay) c.end?.();
      }
    }
    this.save();
    this.broadcast();
    this.advanceLate();
    return { ok: true, actionCount: this.state!.actionCount, removed };
  }

  /**
   * Correção do Judge no modo manual, pelo lado de `player`: `op` é uma ferramenta manual (vira a ação
   * `judge` do motor, com o nome de quem corrigiu no log) e `action` é uma resposta no lugar do jogador
   * (concluir um efeito manual, passar ou encerrar o turno). As cartas vêm com os apelidos da visão do
   * Judge (as duas mãos à vista). O relógio continua parado.
   */
  judgeAct(seq: unknown, player: unknown, input: { op?: unknown; action?: unknown }): ActResult & { action?: Action } {
    const refused = this.manualRefusal(seq);
    if (refused) return refused;
    if (player !== 0 && player !== 1) return { ok: false, code: 400, ...fail('invalidAction', 'Ação inválida.') };
    if (this.data.actions.length >= MAX_ACTIONS) return { ok: false, code: 409, ...fail('matchTooLong', 'Partida longa demais.') };
    let action: Action;
    if (input.op !== undefined) {
      const op = input.op as ManualOp;
      if (!op || typeof op !== 'object' || typeof op.op !== 'string') return { ok: false, code: 400, ...fail('invalidAction', 'Ação inválida.') };
      action = { type: 'judge', player, op, by: this.data.manual!.name };
    } else {
      const type = (input.action as { type?: unknown } | null)?.type;
      if (type !== 'manualDone' && type !== 'pass' && type !== 'endTurn') return { ok: false, code: 400, ...fail('invalidAction', 'Ação inválida.') };
      action = { type, player };
    }
    const real = actionFromView(this.state!, this.aliases!, action, handsOf(this.state!));
    if (typeof real === 'string') return { ok: false, code: 422, error: real };
    try {
      this.commit(real);
    } catch (e) {
      if (e instanceof IllegalActionError) return { ok: false, code: 422, error: e.message };
      this.deps.log(`Partida online ${this.id}: erro do motor na correção do Judge: ${e instanceof Error ? e.stack : e}`);
      return { ok: false, code: 422, ...fail('invalidAction', 'Ação inválida.') };
    }
    // A correção terminou a partida (K.O. no Líder sem Vida, deck vazio…): não há mais o que pausar.
    if (this.state!.phase === 'gameover' && this.paused) this.resume();
    return { ok: true, actionCount: this.state!.actionCount, action: real };
  }

  /** Se a vez é do bot do servidor, agenda a jogada dele. */
  private driveBot() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const seat = this.running;
    if (seat === null || this.paused || !this.data.seats[seat]?.bot) return;
    const hidden = hiddenDecision(this.state?.pending);
    const delay =
      this.deps.botDelayMs ??
      (hidden ? BOT_HIDDEN_DECISION_MS[0] + Math.random() * (BOT_HIDDEN_DECISION_MS[1] - BOT_HIDDEN_DECISION_MS[0]) : BOT_DELAY_MS);
    this.botTimer = setTimeout(() => this.botMove(seat), delay);
  }

  private botMove(seat: PlayerId) {
    this.botTimer = null;
    if (!this.state || !this.aliases || this.state.phase === 'gameover' || this.running !== seat) return;
    try {
      // Decide pela visão do bot, como faria um jogador: sem espiar a mão do oponente.
      const view = viewFor(this.state, seat, this.aliases);
      const real = actionFromView(this.state, this.aliases, chooseBotAction(view, seat));
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

  /** O jogador jogou o dado do sorteio: os outros veem o mesmo lançamento. */
  throwDice(seat: PlayerId, vx: unknown, vy: unknown): ActResult {
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (!ok(vx) || !ok(vy)) return { ok: false, code: 400, ...fail('invalidDiceThrow', 'Lançamento inválido.') };
    if (!this.state || this.state.phase !== 'mulligan') return { ok: false, code: 409, ...fail('diceAlreadyRolled', 'O sorteio já passou.') };
    if (this.diceThrows[seat]) return { ok: true, actionCount: this.state.actionCount };
    const clamp = (v: number) => Math.max(-12, Math.min(12, v));
    const t = { seat, vx: clamp(vx), vy: clamp(vy) };
    this.diceThrows[seat] = t;
    this.diceAt[seat] = this.deps.now();
    this.emit('dice', t);
    return { ok: true, actionCount: this.state.actionCount };
  }

  emote(seat: PlayerId, emote: unknown): ActResult {
    if (!EMOTES.includes(emote as EmoteId)) return { ok: false, code: 400, ...fail('invalidEmote', 'Emote inválido.') };
    const now = this.deps.now();
    if (now - this.lastEmote[seat] < 3000) return { ok: false, code: 429, ...fail('emoteTooFast', 'Espere um pouco.') };
    this.lastEmote[seat] = now;
    this.emit('emote', { seat, emote });
    return { ok: true, actionCount: this.state?.actionCount ?? 0 };
  }

  /**
   * Mensagem de texto do chat da partida: limpa, limita o tamanho e a frequência, censura
   * palavrões e manda para todas as conexões (os espectadores também veem). Nada fica
   * gravado: o chat vive só na memória da sala.
   */
  chat(seat: PlayerId, text: unknown): ActResult {
    if (typeof text !== 'string') return { ok: false, code: 400, ...fail('invalidChatMessage', 'Mensagem inválida.') };
    // Sem quebras de linha nem caracteres de controle; espaços repetidos viram um só.
    const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return { ok: false, code: 400, ...fail('emptyChatMessage', 'Mensagem vazia.') };
    if (clean.length > CHAT_MAX_LENGTH) return { ok: false, code: 400, ...fail('chatMessageTooLong', `A mensagem pode ter no máximo ${CHAT_MAX_LENGTH} caracteres.`, { max: CHAT_MAX_LENGTH }) };
    const now = this.deps.now();
    const times = (this.chatTimes[seat] = this.chatTimes[seat].filter((t) => now - t < 60_000));
    const last = times[times.length - 1] ?? 0;
    if (now - last < CHAT_MIN_INTERVAL_MS || times.length >= CHAT_PER_MINUTE) return { ok: false, code: 429, ...fail('chatTooFast', 'Espere um pouco antes de mandar outra mensagem.') };
    times.push(now);
    const message = censor(clean);
    this.emit('chat', { seat, text: message });
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
    // Mãos dos jogadores só onde são permitidas (torneio ou sala privada liberada); o Judge, só em sala de torneio.
    if (conn.hands && !this.handsAllowed) conn.hands = false;
    if (conn.judge && this.data.queue !== 'tournament') conn.judge = false;
    if (this.isLate(conn)) {
      // Quem já assistia atrasado recebe o que venceu antes de quem chega agora.
      this.advanceLate();
      // Sem a mesa atrasada (não deu para refazê-la), assiste ao vivo, só com a visão pública.
      if (!this.ensureLate(this.delayOf(conn))) Object.assign(conn, { hands: false, as: undefined, delay: 0 });
    }
    const late = this.lateOf(conn);
    this.conns.add(conn);
    this.updatePresence();
    conn.send('state', this.snapshot(conn));
    // Quem chega durante o sorteio vê os dados já jogados (na mesa atrasada, os que já passaram do atraso).
    if ((late ? late.state : this.state)?.phase === 'mulligan') {
      const cutoff = this.deps.now() - (late?.delay ?? 0);
      this.diceThrows.forEach((t, i) => t && (!late || this.diceAt[i] <= cutoff) && conn.send('dice', t));
    }
    this.broadcastPresence();
    if (late) this.advanceLate();
  }

  detach(conn: Connection) {
    this.conns.delete(conn);
    this.updatePresence();
    this.broadcastPresence();
    if (this.isLate(conn)) this.advanceLate();
  }

  // ------------------------------------------------------------------ mesa atrasada

  /** A mesa atrasada de uma conexão (null = assiste ao vivo). */
  private lateOf(conn: Connection): LateTable | null {
    return this.isLate(conn) ? (this.lates.get(this.delayOf(conn)) ?? null) : null;
  }

  /** Guarda um evento fora do jogo para as mesas atrasadas (as atuais e as que surgirem). */
  private queueLate(event: string, data: unknown) {
    const e: LateEvent = { at: this.deps.now(), after: this.data.actions.length, event, data };
    this.recentEvents = this.recentEvents.filter((x) => x.at > e.at - MAX_DELAY_MS);
    this.recentEvents.push(e);
    for (const late of this.lates.values()) late.events.push(e);
    this.advanceLate();
  }

  /** Manda um evento agora para quem assiste ao vivo e, depois do atraso, para quem assiste atrasado. */
  private emit(event: string, data: unknown) {
    for (const c of this.conns) if (!this.isLate(c)) c.send(event, data);
    this.queueLate(event, data);
  }

  /** Refaz a mesa de `delay` atrás para o primeiro espectador com esse atraso. */
  private ensureLate(delay: number): boolean {
    if (this.lates.has(delay)) return true;
    if (!this.state) return false;
    try {
      const cutoff = this.deps.now() - delay;
      const timeline = this.data.timeline ?? [];
      let state = createGame(this.config());
      let count = 0;
      while (count < this.data.actions.length && timeline[count][0] <= cutoff) state = applyAction(state, this.data.actions[count++]);
      const events = this.recentEvents.filter((e) => e.at > cutoff);
      this.lates.set(delay, { delay, state, count, lastAction: count ? this.data.actions[count - 1] : null, events, timer: null });
      return true;
    } catch (e) {
      this.deps.log(`Partida online ${this.id}: falha ao montar a mesa atrasada: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** Avança todas as mesas atrasadas (e descarta as que ficaram sem espectador). */
  private advanceLate() {
    for (const late of [...this.lates.values()]) this.advanceTable(late);
  }

  /**
   * Leva uma mesa atrasada até `delay` atrás: aplica as ações e entrega os eventos que já passaram
   * do atraso, na ordem em que aconteceram, e agenda o próximo passo. Sem ninguém com esse
   * atraso, a mesa é descartada (volta a ser refeita quando alguém chegar).
   */
  private advanceTable(late: LateTable) {
    if (late.timer) clearTimeout(late.timer);
    late.timer = null;
    const viewers = [...this.conns].filter((c) => this.isLate(c) && this.delayOf(c) === late.delay);
    if (!viewers.length) {
      this.lates.delete(late.delay);
      return;
    }
    const cutoff = this.deps.now() - late.delay;
    const timeline = this.data.timeline ?? [];
    try {
      for (;;) {
        const event = late.events[0];
        if (event && event.at <= cutoff && event.after <= late.count) {
          late.events.shift();
          for (const c of viewers) c.send(event.event, event.data);
          continue;
        }
        const nextAt = late.count < this.data.actions.length ? timeline[late.count][0] : Infinity;
        if (nextAt <= cutoff) {
          const action = this.data.actions[late.count];
          late.state = applyAction(late.state, action);
          late.count++;
          late.lastAction = action;
          for (const c of viewers) c.send('state', this.snapshot(c));
          continue;
        }
        const wake = Math.min(nextAt, event?.at ?? Infinity);
        if (wake !== Infinity) late.timer = setTimeout(() => this.advanceTable(late), wake - cutoff + 5);
        return;
      }
    } catch (e) {
      // O motor é determinístico: não deveria acontecer. Quem assistia reconecta e a mesa é refeita.
      this.deps.log(`Partida online ${this.id}: falha na mesa atrasada: ${e instanceof Error ? e.message : e}`);
      this.lates.delete(late.delay);
      for (const c of viewers) c.end?.();
    }
  }

  /** Relógio de uma mesa atrasada: como estava `delay` atrás. */
  private lateClock(late: LateTable) {
    const at = this.deps.now() - late.delay;
    const timeline = this.data.timeline ?? [];
    const prev = late.count ? timeline[late.count - 1] : [this.data.startedAt ?? at, TIME_BANK_MS, TIME_BANK_MS];
    const next = timeline[late.count];
    const remaining: [number, number] = [prev[1], prev[2]];
    const running = late.state.phase === 'gameover' ? null : actingPlayer(late.state);
    if (running !== null) {
      // O tempo parado pelo Judge entre a ação anterior e este instante não conta.
      let pausedMs = 0;
      for (const [from, to] of this.data.pauses ?? []) pausedMs += Math.max(0, Math.min(to ?? this.deps.now(), at) - Math.max(from, prev[0]));
      // Nunca abaixo do que ele tinha na ação seguinte (o servidor pode ter ficado fora do ar no meio).
      remaining[running] = Math.max(next ? next[1 + running] : 0, remaining[running] - Math.max(0, at - prev[0] - pausedMs));
    }
    const pausedAt = this.data.pause && this.data.pause.at <= at ? this.data.pause : null;
    return { remaining, running, total: TIME_BANK_MS, awaySince: null, paused: Boolean(pausedAt) };
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

  /** Avisos fora do jogo (revanche). `data` recebe null para os espectadores; quem vê as mãos recebe depois do atraso. */
  notify(event: string, data: (seat: PlayerId | null) => unknown) {
    for (const c of this.conns) if (!this.isLate(c)) c.send(event, data(c.seat));
    this.queueLate(event, data(null));
  }

  /** Estado novo para quem assiste ao vivo (a mesa atrasada avança sozinha, em `advanceLate`). */
  broadcast() {
    for (const c of this.conns) if (!this.isLate(c)) c.send('state', this.snapshot(c));
  }

  clock() {
    const now = this.deps.now();
    const remaining = [...this.data.remaining] as [number, number];
    if (this.running !== null && !this.paused) remaining[this.running] = Math.max(0, remaining[this.running] - (now - this.since));
    return { remaining, running: this.running, total: TIME_BANK_MS, awaySince: this.awaySince, paused: this.paused };
  }

  /**
   * Resumo da sala (sem o jogo) para a conexão `seat` (null = espectador); com `late`, como estava
   * na mesa atrasada. `pov`: o jogador de quem é a visão (o próprio assento, ou o streamer que joga).
   */
  info(seat: PlayerId | null, late: LateTable | null = null, pov: PlayerId | null = seat) {
    const over = late ? late.state.phase === 'gameover' : this.status === 'finished';
    return {
      id: this.id,
      code: this.data.code,
      queue: this.data.queue,
      format: this.data.format,
      ...(this.data.spoilers !== undefined ? { spoilers: this.data.spoilers } : {}),
      tournament: this.data.tournament
        ? {
            id: this.data.tournament.id,
            name: this.data.tournament.name,
            round: this.data.tournament.round,
            label: this.data.tournament.label,
            matchId: this.data.tournament.matchId,
            game: this.data.tournament.game,
            bestOf: this.data.tournament.bestOf,
            /** Placar da série antes deste jogo, na ordem dos assentos. */
            score: this.data.seats.map((s) => (s.userId ? (this.data.tournament!.wins[s.userId] ?? 0) : 0)),
          }
        : null,
      status: late ? (over ? 'finished' : 'playing') : this.status,
      you: seat,
      pov,
      players: this.data.seats.map((s, i) => ({
        name: s.name,
        /** Conta do jogador (para o Judge dar warning); null sem login ou bot. */
        userId: s.bot ? null : s.userId,
        bounty: s.bounty,
        tier: s.tier,
        apprentice: Boolean(s.apprentice),
        leader: s.deck.leader,
        connected: this.connected(i as PlayerId),
        bot: Boolean(s.bot),
      })),
      spectators: this.spectators,
      clock: late ? this.lateClock(late) : this.clock(),
      /** Pausada pelo chamado de Judge (`by`: assento que chamou; null = o Judge/organizador). */
      pause: !late && this.paused && this.data.pause ? { by: this.data.pause.by, at: this.data.pause.at } : null,
      /** Modo manual do Judge (só ao vivo): quem está corrigindo a mesa. */
      manual: !late && this.paused && this.data.manual ? { name: this.data.manual.name, at: this.data.manual.at } : null,
      result: over ? this.data.result : null,
      rematch: over ? (this.data.rematch ?? [false, false]) : [false, false],
      /** As mãos dos jogadores podem aparecer para quem transmite (torneio ou sala privada liberada). */
      handsAllowed: this.handsAllowed,
      /** As mãos podem aparecer ao vivo, sem o atraso mínimo (torneio com mãos ao vivo). */
      handsLive: this.handsLive,
      /** Atraso da mesa desta conexão (ms); 0 = ao vivo. */
      delay: late ? late.delay : 0,
    };
  }

  /**
   * Estado para uma conexão: a visão do jogador, mais só as definições de cartas e
   * as linhas do log que esta conexão ainda não recebeu.
   */
  snapshot(conn: Connection) {
    const late = this.lateOf(conn);
    const state = late ? late.state : this.state;
    const lastAction = late ? late.lastAction : this.lastAction;
    // A visão de um jogador sem a mesa atrasada que ela exige seria o presente: fica a pública.
    const pov = conn.seat ?? (late || !this.isLate(conn) ? (conn.as ?? null) : null);
    const room = this.info(conn.seat, late, pov);
    if (!state || !this.aliases) return { room, view: null, defs: {}, log: { from: 0, entries: [] }, lastAction: null };
    // As mãos dos dois só saem da mesa atrasada (ou ao vivo para o Judge e, no torneio com mãos ao vivo,
    // para quem as vê sem atraso), onde são permitidas: fora disso, nada a mais.
    const extra = this.handsAllowed && ((late && conn.hands) || (!late && (conn.judge || (conn.hands && this.handsLive)))) ? handsOf(state) : [];
    const opts = { revealEnd: !this.sealed };
    const { defs, log, ...view } = viewFor(state, pov, this.aliases, extra, opts);
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
      lastAction: lastAction ? aliasRefs(state, pov, this.aliases, lastAction, extra, opts) : null,
    };
  }


  /** Replay completo (só depois do fim da partida; nunca numa partida de torneio, `sealed`). */
  replay() {
    if (!this.state || this.state.phase !== 'gameover' || this.sealed) return null;
    return {
      format: 'gumgumfight-replay' as const,
      version: this.data.replayVersion ?? 8,
      seed: 0,
      seed128: this.data.seed128,
      firstPlayer: this.state.firstPlayer,
      // Houve a escolha do vencedor do sorteio (não quando a sala já definia quem começa).
      ...(this.state.rollWinner !== undefined ? { chooseFirst: true } : {}),
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
    for (const late of this.lates.values()) if (late.timer) clearTimeout(late.timer);
    this.lates.clear();
    for (const c of this.conns) {
      if (closed) c.send('closed', {});
      c.end?.();
    }
    this.conns.clear();
  }
}
