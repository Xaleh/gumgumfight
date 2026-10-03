// Salas online: salas privadas com código, filas casual e ranqueada e a gravação
// das salas no banco (para sobreviver a reinícios e deploys).

import { randomBytes, randomInt } from 'node:crypto';
import type { CardData, PlayerId } from '@gumgum/engine';
import type { FormatId } from '../stats/catalog';
import { newRoomData, randomToken, Room, type RoomData, type RoomResult, type SeatInfo } from './room';

/** Quem quer jogar (perfil do jogador e deck escolhido). */
export type SeatRequest = Omit<SeatInfo, 'token'>;

export type QueueKind = 'casual' | 'ranked';

interface Entry {
  ticket: string;
  seat: SeatRequest;
  format: FormatId;
  queue: QueueKind;
  since: number;
  lastSeen: number;
  matched: { roomId: string; token: string } | null;
}

export interface LobbyDeps {
  cards: (ids: string[]) => CardData[];
  finish?: (room: Room) => RoomResult;
  save?: (data: RoomData) => void;
  remove?: (id: string) => void;
  now?: () => number;
  log?: (msg: string) => void;
  rateLimit?: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Sala privada esperando o segundo jogador. */
const WAITING_TTL_MS = 30 * 60_000;
/** Sala terminada (tela de resultado e revanche). */
const FINISHED_TTL_MS = 15 * 60_000;
/** Quem para de consultar a fila sai dela. */
const QUEUE_STALE_MS = 30_000;
/** Faixa de recompensa aceita na ranqueada: começa em BASE e abre PER_SECOND a cada segundo de espera. */
const RANKED_WINDOW_BASE = 2_000;
const RANKED_WINDOW_PER_SECOND = 400;

export type LobbyError = { error: string; code: number; roomId?: string };

export class Lobby {
  readonly rooms = new Map<string, Room>();
  private readonly codes = new Map<string, string>();
  private queue: Entry[] = [];
  private readonly finishedAt = new Map<string, number>();
  private readonly deps: LobbyDeps & { now: () => number; log: (msg: string) => void };
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(deps: LobbyDeps) {
    this.deps = { ...deps, now: deps.now ?? (() => Date.now()), log: deps.log ?? (() => {}) };
  }

  private makeRoom(data: RoomData) {
    const room = new Room(data, {
      cards: this.deps.cards,
      now: this.deps.now,
      log: this.deps.log,
      save: (r) => this.deps.save?.(r.data),
      finish: this.deps.finish,
      rateLimit: this.deps.rateLimit,
    });
    this.rooms.set(room.id, room);
    if (data.code) this.codes.set(data.code, room.id);
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
    return playing ? { code: 409, error: 'Você já está numa partida online.', roomId: playing.roomId } : null;
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

  joinPrivate(code: string, seat: SeatRequest): { room: Room; token: string } | LobbyError {
    const id = this.codes.get(code.trim().toUpperCase());
    const room = id ? this.rooms.get(id) : undefined;
    if (!room || room.status !== 'waiting') return { code: 404, error: 'Sala não encontrada ou já começou.' };
    if (room.data.seats[0].ownerHash === seat.ownerHash) return { code: 409, error: 'Esta sala é sua: envie o código para outra pessoa.' };
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    this.leaveQueue(seat.ownerHash);
    const token = randomToken();
    room.data.seats.push({ ...seat, token });
    room.start();
    return { room, token };
  }

  // ------------------------------------------------------------------ filas

  enqueue(seat: SeatRequest, format: FormatId, queue: QueueKind): { ticket: string } | LobbyError {
    const busy = this.busy(seat.ownerHash);
    if (busy) return busy;
    this.leaveQueue(seat.ownerHash);
    const now = this.deps.now();
    const entry: Entry = { ticket: randomBytes(12).toString('base64url'), seat, format, queue, since: now, lastSeen: now, matched: null };
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
        a.matched = { roomId: room.id, token: ta };
        b.matched = { roomId: room.id, token: tb };
        break;
      }
    }
  }

  // ------------------------------------------------------------------ fim e limpeza

  /** Sai de uma sala: cancela a espera (sala privada) — numa partida em andamento, use "desistir". */
  leave(room: Room, seat: PlayerId): LobbyError | null {
    if (room.status === 'playing') return { code: 409, error: 'A partida já começou: use "Desistir".' };
    if (room.status === 'waiting' && seat === 0) this.close(room.id);
    return null;
  }

  /** Revanche (só salas privadas): quando os dois pedem, começa uma sala nova com os mesmos decks. */
  rematch(room: Room, seat: PlayerId): LobbyError | null {
    if (room.data.queue !== 'private') return { code: 400, error: 'Revanche só nas salas privadas.' };
    if (room.status !== 'finished') return { code: 409, error: 'A partida ainda não terminou.' };
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
      room.data.rematchRoom = next.id;
      room.notify('rematch', (p) => ({ roomId: next.id, token: next.data.seats[p === 0 ? 1 : 0].token }));
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
    this.finishedAt.delete(id);
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

