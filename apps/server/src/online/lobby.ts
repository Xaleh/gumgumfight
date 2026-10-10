// Salas online: salas privadas com código, filas casual e ranqueada, treino contra o
// bot do servidor, partidas de torneio, a lista de partidas para assistir e a
// gravação das salas no banco (para sobreviver a reinícios e deploys).

import { randomBytes, randomInt } from 'node:crypto';
import type { CardData, PlayerId } from '@gumgum/engine';
import { type ErrorParams, fail } from '../errors';
import { FORMATS, type FormatId } from '../stats/catalog';
import { newRoomData, randomToken, Room, type RoomData, type RoomQueue, type RoomResult, type RoomTournament, type SeatInfo } from './room';

/** Quem quer jogar (perfil do jogador e deck escolhido). */
export type SeatRequest = Omit<SeatInfo, 'token'>;

export type QueueKind = 'casual' | 'ranked';

interface Entry {
  ticket: string;
  seat: SeatRequest;
  /** IP de quem entrou na fila (só em memória, para os limites por IP). */
  ip: string | null;
  format: FormatId;
  queue: QueueKind;
  since: number;
  lastSeen: number;
  matched: { roomId: string; token: string } | null;
}

/**
 * Tetos contra abuso: criar salas não exige login (só o código do navegador, que
 * qualquer um gera à vontade), e cada sala custa memória e CPU do servidor.
 */
export interface LobbyLimits {
  /** Salas ativas (esperando ou jogando) no servidor inteiro; acima disso, 503. */
  maxRooms: number;
  /** Salas de treino contra o bot do servidor ativas ao mesmo tempo (o servidor joga por ele). */
  maxBotRooms: number;
  /** Salas ativas (ou lugares na fila) de um mesmo IP ao mesmo tempo. */
  perIpRooms: number;
  /** Salas criadas, entradas e filas por IP numa janela de `perIpWindowMs`. */
  perIpCreates: number;
  perIpWindowMs: number;
}

export const DEFAULT_LIMITS: LobbyLimits = {
  maxRooms: 400,
  maxBotRooms: 100,
  perIpRooms: 16,
  perIpCreates: 60,
  perIpWindowMs: 10 * 60_000,
};

export interface LobbyDeps {
  cards: (ids: string[]) => CardData[];
  limits?: Partial<LobbyLimits>;
  finish?: (room: Room) => RoomResult;
  save?: (data: RoomData) => void;
  remove?: (id: string) => void;
  now?: () => number;
  log?: (msg: string) => void;
  rateLimit?: number;
  botDelayMs?: number;
}

/** Partida em andamento na lista "Assistir". */
export interface LiveRoom {
  id: string;
  queue: RoomData['queue'];
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
  tournament: { id: string; name: string; round: number; label: string; game: number; bestOf: number } | null;
}

/** Contadores públicos do menu (sem nomes: só números). */
export interface OnlineStats {
  /** Pessoas no menu, jogando, na fila ou assistindo. */
  online: number;
  /** Partidas em andamento, por tipo de sala. */
  playing: Record<RoomQueue, number>;
  /** Salas privadas esperando o segundo jogador. */
  waiting: number;
  /** Quem está na fila agora, por fila e formato. */
  queue: Record<QueueKind, Record<FormatId, number>>;
  spectators: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Quem está no menu manda um sinal a cada ~10 s; some depois deste tempo sem sinal. */
const PRESENCE_TTL_MS = 30_000;
/** Teto de navegadores lembrados (o código vem do navegador: não deixa a lista crescer sem fim). */
const PRESENCE_MAX = 20_000;
/** Sala privada esperando o segundo jogador. */
const WAITING_TTL_MS = 30 * 60_000;
/** Sala terminada (tela de resultado e revanche). */
const FINISHED_TTL_MS = 15 * 60_000;
/** Quem para de consultar a fila sai dela. */
const QUEUE_STALE_MS = 30_000;
/** Faixa de recompensa aceita na ranqueada: começa em BASE e abre PER_SECOND a cada segundo de espera. */
const RANKED_WINDOW_BASE = 2_000;
const RANKED_WINDOW_PER_SECOND = 400;

/** Recusa para o jogador: `code` é o status HTTP; `errorCode` (+ `errorParams`) é a chave que o cliente traduz. */
export type LobbyError = { error: string; errorCode: string; errorParams?: ErrorParams; code: number; roomId?: string };

const tournamentKey = (t: Pick<RoomTournament, 'id' | 'matchId' | 'game'>) => `${t.id}:${t.matchId}:${t.game}`;

export class Lobby {
  readonly rooms = new Map<string, Room>();
  private readonly codes = new Map<string, string>();
  /** Partida de torneio ("torneio:partida") → sala. */
  private readonly tournamentRooms = new Map<string, string>();
  private queue: Entry[] = [];
  private readonly finishedAt = new Map<string, number>();
  /** Navegadores com o menu aberto → último sinal. */
  private readonly presence = new Map<string, number>();
  /** IPs que ocupam cada sala (só em memória: não vai para o banco). */
  private readonly roomIps = new Map<string, Set<string>>();
  /** Criações recentes por IP (salas, entradas e filas), para o limite por janela. */
  private readonly creates = new Map<string, number[]>();
  readonly limits: LobbyLimits;
  private readonly deps: LobbyDeps & { now: () => number; log: (msg: string) => void };
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(deps: LobbyDeps) {
    this.deps = { ...deps, now: deps.now ?? (() => Date.now()), log: deps.log ?? (() => {}) };
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
  }

  // ------------------------------------------------------------------ limites por IP

  /** Salas ativas (esperando ou jogando). */
  get activeRooms() {
    let n = 0;
    for (const room of this.rooms.values()) if (room.status !== 'finished') n++;
    return n;
  }

  private activeBotRooms() {
    let n = 0;
    for (const room of this.rooms.values()) if (room.status !== 'finished' && room.data.queue === 'bot') n++;
    return n;
  }

  /** Salas ativas e lugares na fila ocupados por um IP. */
  roomsOfIp(ip: string) {
    let n = 0;
    for (const [id, ips] of this.roomIps) {
      const room = this.rooms.get(id);
      if (room && room.status !== 'finished' && ips.has(ip)) n++;
    }
    for (const e of this.queue) if (!e.matched && e.ip === ip) n++;
    return n;
  }

  /** Marca que este IP ocupa a sala (para `roomsOfIp`). */
  tagIp(roomId: string, ip: string | null) {
    if (!ip) return;
    let ips = this.roomIps.get(roomId);
    if (!ips) this.roomIps.set(roomId, (ips = new Set()));
    ips.add(ip);
  }

  /**
   * Pode abrir mais uma sala (ou entrar numa, ou na fila)? Confere os tetos do
   * servidor e, com `ip`, os do IP; quando pode, conta a criação na janela do IP.
   * `kind`: bot = treino contra o bot do servidor; tournament = só o teto global
   * (quem joga torneio está logado e inscrito).
   */
  admit(ip: string | null, kind: 'room' | 'bot' | 'tournament' = 'room'): LobbyError | null {
    const L = this.limits;
    if (this.activeRooms >= L.maxRooms) return { code: 503, ...fail('serverFull', 'O servidor está cheio agora; tente de novo em alguns minutos.') };
    if (kind === 'bot' && this.activeBotRooms() >= L.maxBotRooms) {
      return { code: 503, ...fail('botRoomsFull', 'O treino contra o bot do servidor está lotado agora; jogue contra o bot no navegador ou tente mais tarde.') };
    }
    if (!ip || kind === 'tournament') return null;
    if (this.roomsOfIp(ip) >= L.perIpRooms) return { code: 429, ...fail('tooManyRoomsFromIp', 'Há partidas demais abertas a partir da sua rede.') };
    const now = this.deps.now();
    const recent = (this.creates.get(ip) ?? []).filter((t) => now - t < L.perIpWindowMs);
    if (recent.length >= L.perIpCreates) return { code: 429, ...fail('tooManyRoomsRecently', 'Você abriu partidas demais em pouco tempo; espere alguns minutos.') };
    recent.push(now);
    this.creates.set(ip, recent);
    return null;
  }

  private makeRoom(data: RoomData) {
    const room = new Room(data, {
      cards: this.deps.cards,
      now: this.deps.now,
      log: this.deps.log,
      save: (r) => this.deps.save?.(r.data),
      finish: this.deps.finish,
      rateLimit: this.deps.rateLimit,
      botDelayMs: this.deps.botDelayMs,
    });
    this.rooms.set(room.id, room);
    if (data.code) this.codes.set(data.code, room.id);
    if (data.tournament) this.tournamentRooms.set(tournamentKey(data.tournament), room.id);
    return room;
  }

  /** Refaz as salas gravadas (depois de reiniciar o servidor). */
  restore(rows: RoomData[]) {
    for (const data of rows) {
      try {
        const room = this.makeRoom(data);
        if (room.status === 'finished') this.finishedAt.set(room.id, this.deps.now());
      } catch (e) {
        this.deps.log(`Partida online ${data.id} não pôde ser refeita: ${e instanceof Error ? e.message : e}`);
        this.rooms.delete(data.id);
        if (data.code) this.codes.delete(data.code);
        this.deps.remove?.(data.id);
      }
    }
  }

  get(id: string) {
    return this.rooms.get(id) ?? null;
  }

  private newCode() {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if (!this.codes.has(code)) return code;
    }
  }

  /** Partida em andamento do jogador, se houver. */
  activeFor(ownerHash: string) {
    const out: Array<{ roomId: string; token: string; status: string; queue: string; code: string | null }> = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'finished') continue;
      const seat = room.data.seats.findIndex((s) => s.ownerHash === ownerHash);
      if (seat < 0) continue;
      out.push({ roomId: room.id, token: room.data.seats[seat].token, status: room.status, queue: room.data.queue, code: room.data.code });
    }
    return out;
  }

  private busy(ownerHash: string): LobbyError | null {
    const playing = this.activeFor(ownerHash).find((r) => r.status === 'playing');
    return playing ? { code: 409, ...fail('alreadyPlaying', 'Você já está numa partida online.'), roomId: playing.roomId } : null;
  }

  createPrivate(seat: SeatRequest, format: FormatId): { room: Room; token: string } | LobbyError {
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    // Uma sala de espera por jogador: a anterior é cancelada.
    for (const r of this.activeFor(seat.ownerHash)) if (r.status === 'waiting') this.close(r.roomId);
    this.leaveQueue(seat.ownerHash);
    const token = randomToken();
    const room = this.makeRoom(newRoomData({ queue: 'private', format, code: this.newCode(), seats: [{ ...seat, token }] }));
    this.deps.save?.(room.data);
    return { room, token };
  }

  /** Sala privada à espera de oponente, pelo código do convite. */
  private waitingRoom(code: string): Room | undefined {
    const id = this.codes.get(code.trim().toUpperCase());
    const room = id ? this.rooms.get(id) : undefined;
    return room?.status === 'waiting' ? room : undefined;
  }

  /** Formato da sala privada do código (quem entra joga no formato de quem criou). */
  privateFormat(code: string): FormatId | null {
    return this.waitingRoom(code)?.data.format ?? null;
  }

  joinPrivate(code: string, seat: SeatRequest): { room: Room; token: string } | LobbyError {
    const room = this.waitingRoom(code);
    if (!room) return { code: 404, ...fail('roomNotFound', 'Sala não encontrada ou já começou.') };
    if (room.data.seats[0].ownerHash === seat.ownerHash) return { code: 409, ...fail('ownRoom', 'Esta sala é sua: envie o código para outra pessoa.') };
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    this.leaveQueue(seat.ownerHash);
    const token = randomToken();
    room.data.seats.push({ ...seat, token });
    room.start();
    return { room, token };
  }

  /**
   * Treino contra o bot do servidor: começa na hora; a partida pode ser assistida.
   * `first`: quem começa (0 = o jogador, 1 = o bot); sem ele, o sorteio decide.
   */
  createBotRoom(seat: SeatRequest, bot: SeatRequest, format: FormatId, first?: PlayerId): { room: Room; token: string } | LobbyError {
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    for (const r of this.activeFor(seat.ownerHash)) if (r.status === 'waiting') this.close(r.roomId);
    this.leaveQueue(seat.ownerHash);
    const token = randomToken();
    const room = this.makeRoom(
      newRoomData({ queue: 'bot', format, code: null, seats: [{ ...seat, token }, { ...bot, token: randomToken(), bot: true }] }),
    );
    if (first !== undefined) room.data.firstPlayer = first;
    room.start();
    return { room, token };
  }

  /**
   * Jogo de uma partida de torneio: o primeiro dos dois jogadores a entrar abre a
   * sala e o segundo a começa. Quem já está sentado recebe o próprio assento de
   * volta. Cada jogo de uma melhor de N tem a sua sala; um jogo terminado sem
   * vencedor é trocado por outra sala.
   */
  tournamentRoom(seat: SeatRequest, format: FormatId, tournament: RoomTournament): { room: Room; token: string } | LobbyError {
    const id = this.tournamentRooms.get(tournamentKey(tournament));
    const existing = id ? this.rooms.get(id) : undefined;
    if (existing && existing.status !== 'finished') {
      const mine = existing.data.seats.find((s) => s.ownerHash === seat.ownerHash);
      if (mine) return { room: existing, token: mine.token };
      if (existing.status === 'waiting') {
        const busy = this.busy(seat.ownerHash);
        if (busy) return busy;
        this.leaveQueue(seat.ownerHash);
        const token = randomToken();
        existing.data.seats.push({ ...seat, token });
        // Jogos 2+ da série: quem perdeu o anterior começa.
        const first = existing.data.seats.findIndex((s) => s.userId && s.userId === tournament.firstUserId);
        if (first === 0 || first === 1) existing.data.firstPlayer = first;
        existing.start();
        return { room: existing, token };
      }
      return { code: 409, ...fail('matchInProgress', 'Esta partida já está em andamento.') };
    }
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    for (const r of this.activeFor(seat.ownerHash)) if (r.status === 'waiting') this.close(r.roomId);
    this.leaveQueue(seat.ownerHash);
    const token = randomToken();
    const room = this.makeRoom(newRoomData({ queue: 'tournament', format, code: null, tournament, seats: [{ ...seat, token }] }));
    this.deps.save?.(room.data);
    return { room, token };
  }

  // ------------------------------------------------------------------ espectadores

  /**
   * Partidas para assistir: as das filas (e as de treino contra o bot, se `bots`).
   * Salas privadas não aparecem; para assisti-las é preciso o código (byCode).
   */
  live(opts: { bots: boolean }): LiveRoom[] {
    const out: LiveRoom[] = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'playing' || !room.state) continue;
      if (room.data.queue === 'private' || (room.data.queue === 'bot' && !opts.bots)) continue;
      out.push(this.summary(room));
    }
    // Torneios e ranqueadas primeiro; dentro de cada fila, as mais novas.
    const rank = (q: string) => (q === 'tournament' ? 0 : q === 'ranked' ? 1 : q === 'casual' ? 2 : 3);
    return out.sort((a, b) => rank(a.queue) - rank(b.queue) || b.createdAt - a.createdAt);
  }

  summary(room: Room): LiveRoom {
    const st = room.state;
    return {
      id: room.id,
      queue: room.data.queue,
      format: room.data.format,
      status: room.status === 'finished' ? 'finished' : 'playing',
      players: room.data.seats.map((s, i) => ({
        name: s.name,
        leader: s.deck.leader,
        leaderName: st?.defs[s.deck.leader]?.name ?? null,
        leaderImage: st?.defs[s.deck.leader]?.imageUrl ?? null,
        colors: st?.defs[s.deck.leader]?.colors ?? [],
        tier: s.tier,
        bounty: s.bounty,
        bot: Boolean(s.bot),
        life: st?.players[i].life.length ?? 0,
        hand: st?.players[i].hand.length ?? 0,
      })),
      turn: st?.turn ?? 0,
      spectators: room.spectators,
      createdAt: room.data.createdAt,
      tournament: room.data.tournament
        ? {
            id: room.data.tournament.id,
            name: room.data.tournament.name,
            round: room.data.tournament.round,
            label: room.data.tournament.label,
            game: room.data.tournament.game,
            bestOf: room.data.tournament.bestOf,
          }
        : null,
    };
  }

  /** Sala privada pelo código do convite, para assistir (já começada ou terminada). */
  byCode(code: string): Room | null {
    const id = this.codes.get(code.trim().toUpperCase());
    const room = id ? this.rooms.get(id) : undefined;
    return room && room.status !== 'waiting' ? room : null;
  }

  // ------------------------------------------------------------------ contadores do menu

  /** Sinal de quem está com o menu aberto (conta em "conectados" por PRESENCE_TTL_MS). */
  touch(ownerHash: string) {
    const now = this.deps.now();
    this.presence.delete(ownerHash);
    this.presence.set(ownerHash, now);
    // Ordem de inserção = ordem do último sinal: os mais antigos ficam no começo.
    for (const [key, at] of this.presence) {
      if (now - at < PRESENCE_TTL_MS && this.presence.size <= PRESENCE_MAX) break;
      this.presence.delete(key);
    }
  }

  stats(): OnlineStats {
    const now = this.deps.now();
    const people = new Set<string>();
    for (const [key, at] of this.presence) if (now - at < PRESENCE_TTL_MS) people.add(key);
    const playing: Record<RoomQueue, number> = { private: 0, casual: 0, ranked: 0, bot: 0, tournament: 0 };
    let waiting = 0;
    let spectators = 0;
    for (const room of this.rooms.values()) {
      if (room.status === 'finished') continue;
      if (room.status === 'waiting') waiting++;
      else playing[room.data.queue]++;
      spectators += room.spectators;
      room.data.seats.forEach((s, i) => {
        if (!s.bot && room.connected(i as PlayerId)) people.add(s.ownerHash);
      });
    }
    const byFormat = () => Object.fromEntries(FORMATS.map((f) => [f.id, 0])) as Record<FormatId, number>;
    const queue: OnlineStats['queue'] = { casual: byFormat(), ranked: byFormat() };
    for (const e of this.queue) {
      if (e.matched || now - e.lastSeen >= QUEUE_STALE_MS) continue;
      queue[e.queue][e.format]++;
      people.add(e.seat.ownerHash);
    }
    // Espectadores não se identificam: entram só como número.
    return { online: people.size + spectators, playing, waiting, queue, spectators };
  }

  // ------------------------------------------------------------------ filas

  enqueue(seat: SeatRequest, format: FormatId, queue: QueueKind, ip: string | null = null): { ticket: string } | LobbyError {
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    this.leaveQueue(seat.ownerHash);
    const now = this.deps.now();
    const entry: Entry = { ticket: randomBytes(12).toString('base64url'), seat, ip, format, queue, since: now, lastSeen: now, matched: null };
    this.queue.push(entry);
    this.match();
    return { ticket: entry.ticket };
  }

  poll(ticket: string) {
    const entry = this.queue.find((e) => e.ticket === ticket);
    if (!entry) return null;
    const now = this.deps.now();
    entry.lastSeen = now;
    this.match();
    if (entry.matched) {
      // Entregue: sai da fila.
      this.queue = this.queue.filter((e) => e !== entry);
      return { status: 'matched' as const, ...entry.matched };
    }
    return {
      status: 'waiting' as const,
      waited: now - entry.since,
      players: this.queue.filter((e) => !e.matched && e.queue === entry.queue && e.format === entry.format).length,
    };
  }

  cancel(ticket: string) {
    const entry = this.queue.find((e) => e.ticket === ticket);
    if (!entry) return false;
    this.queue = this.queue.filter((e) => e !== entry);
    // Já pareado mas ainda não entregue: a partida começou; o jogador a encontra em "partida em andamento".
    return true;
  }

  private leaveQueue(ownerHash: string) {
    this.queue = this.queue.filter((e) => e.matched || e.seat.ownerHash !== ownerHash);
  }

  private window(e: Entry, now: number) {
    return RANKED_WINDOW_BASE + (RANKED_WINDOW_PER_SECOND * (now - e.since)) / 1000;
  }

  /** Forma pares na ordem de chegada. */
  private match() {
    const now = this.deps.now();
    this.queue = this.queue.filter((e) => e.matched || now - e.lastSeen < QUEUE_STALE_MS);
    const open = this.queue.filter((e) => !e.matched);
    for (let i = 0; i < open.length; i++) {
      const a = open[i];
      if (a.matched) continue;
      for (let j = i + 1; j < open.length; j++) {
        const b = open[j];
        if (b.matched || a.queue !== b.queue || a.format !== b.format) continue;
        if (a.seat.ownerHash === b.seat.ownerHash) continue;
        if (a.queue === 'ranked') {
          if (a.seat.userId && a.seat.userId === b.seat.userId) continue;
          const gap = Math.abs(a.seat.bounty - b.seat.bounty);
          if (gap > Math.max(this.window(a, now), this.window(b, now))) continue;
        }
        const ta = randomToken();
        const tb = randomToken();
        const room = this.makeRoom(
          newRoomData({ queue: a.queue, format: a.format, code: null, seats: [{ ...a.seat, token: ta }, { ...b.seat, token: tb }] }),
        );
        room.start();
        this.tagIp(room.id, a.ip);
        this.tagIp(room.id, b.ip);
        a.matched = { roomId: room.id, token: ta };
        b.matched = { roomId: room.id, token: tb };
        break;
      }
    }
  }

  // ------------------------------------------------------------------ fim e limpeza

  /** Sai de uma sala: cancela a espera (sala privada) — numa partida em andamento, use "desistir". */
  leave(room: Room, seat: PlayerId): LobbyError | null {
    if (room.status === 'playing') return { code: 409, ...fail('leaveUseConcede', 'A partida já começou: use "Desistir".') };
    if (room.status === 'waiting' && seat === 0) this.close(room.id);
    return null;
  }

  /** Fecha uma sala que ainda espera o segundo jogador (partida de torneio decidida por W.O.). */
  closeIfWaiting(id: string) {
    const room = this.rooms.get(id);
    if (room?.status === 'waiting') this.close(id);
  }

  /** Revanche (só salas privadas): quando os dois pedem, começa uma sala nova com os mesmos decks. */
  rematch(room: Room, seat: PlayerId): LobbyError | null {
    if (room.data.queue !== 'private') return { code: 400, ...fail('rematchPrivateOnly', 'Revanche só nas salas privadas.') };
    if (room.status !== 'finished') return { code: 409, ...fail('matchNotFinished', 'A partida ainda não terminou.') };
    if (room.data.rematchRoom) return null;
    const flags = (room.data.rematch ??= [false, false]);
    flags[seat] = true;
    if (flags[0] && flags[1]) {
      for (const s of room.data.seats) {
        const busy = this.busy(s.ownerHash);
        if (busy) return busy;
      }
      // Quem foi o segundo assento passa a ser o primeiro (quem começa é sorteado).
      const seats = [room.data.seats[1], room.data.seats[0]].map((s) => ({ ...s, token: randomToken() }));
      const next = this.makeRoom(newRoomData({ queue: 'private', format: room.data.format, code: null, seats }));
      next.start();
      for (const ip of this.roomIps.get(room.id) ?? []) this.tagIp(next.id, ip);
      room.data.rematchRoom = next.id;
      // Espectadores seguem para a sala nova (sem token: continuam só assistindo).
      room.notify('rematch', (p) => (p === null ? { roomId: next.id } : { roomId: next.id, token: next.data.seats[p === 0 ? 1 : 0].token }));
    }
    this.deps.save?.(room.data);
    room.broadcast();
    return null;
  }

  private close(id: string) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.dispose();
    this.rooms.delete(id);
    if (room.data.code) this.codes.delete(room.data.code);
    if (room.data.tournament) {
      const key = tournamentKey(room.data.tournament);
      if (this.tournamentRooms.get(key) === id) this.tournamentRooms.delete(key);
    }
    this.finishedAt.delete(id);
    this.roomIps.delete(id);
    this.deps.remove?.(id);
  }

  /** Apaga salas velhas e entradas abandonadas da fila. */
  sweep() {
    const now = this.deps.now();
    for (const room of [...this.rooms.values()]) {
      if (room.status === 'waiting' && now - room.data.createdAt > WAITING_TTL_MS) this.close(room.id);
      else if (room.status === 'finished') {
        const at = this.finishedAt.get(room.id);
        if (at === undefined) this.finishedAt.set(room.id, now);
        else if (now - at > FINISHED_TTL_MS) this.close(room.id);
      }
    }
    for (const [ip, times] of this.creates) {
      const recent = times.filter((t) => now - t < this.limits.perIpWindowMs);
      if (recent.length) this.creates.set(ip, recent);
      else this.creates.delete(ip);
    }
    this.match();
  }

  startSweeper(ms = 30_000) {
    this.sweeper = setInterval(() => this.sweep(), ms);
    this.sweeper.unref?.();
  }

  dispose() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.dispose(false);
    this.rooms.clear();
  }
}

