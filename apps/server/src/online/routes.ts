// Rotas das partidas online.
//
// Transporte: SSE (servidor → navegador) + POST (ações). Funciona atrás do Nginx /
// Nginx Proxy Manager sem configuração extra: o header X-Accel-Buffering desliga o
// buffer do proxy e um comentário a cada 20 s mantém a conexão abaixo do
// proxy_read_timeout. O EventSource reconecta sozinho.

import { buildCardDef, type CardData, type PlayerId, validateDeck } from '@gumgum/engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../auth/store';
import { type DB, deleteLiveMatch, getCards, getDeck, listLiveMatches, saveLiveMatch } from '../db';
import type { ApiCard } from '../present';
import { type FormatId, isFormat, tierFor } from '../stats/catalog';
import { deriveMatch } from '../stats/derive';
import { ensurePlayer, matchBounties, recordMatch } from '../stats/store';
import { Lobby, type LobbyError, type SeatRequest } from './lobby';
import { type Connection, type Room, type RoomData, type RoomResult, TIME_BANK_MS } from './room';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  /** Testes: relógio e gravação. */
  now?: () => number;
  heartbeatMs?: number;
  rateLimit?: number;
}

const isError = (v: unknown): v is LobbyError => typeof v === 'object' && v !== null && 'error' in v;

/** Grava a partida terminada nas estatísticas (refeita pelo motor, como as do navegador). */
function finishMatch(db: DB, room: Room): RoomResult {
  const replay = {
    seed: 0,
    seed128: room.data.seed128!,
    decks: [room.data.seats[0].deck, room.data.seats[1].deck] as [typeof room.data.seats[0]['deck'], typeof room.data.seats[0]['deck']],
    actions: room.data.actions,
  };
  const ids = [...new Set(replay.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
  const facts = deriveMatch(replay, getCards(db, ids) as CardData[]);
  const seat = (p: PlayerId) => ({ controller: 'human' as const, ownerHash: room.data.seats[p].ownerHash, deckId: room.data.seats[p].deckId });
  const matchId = recordMatch(
    db,
    { mode: 'online', format: room.data.format, queue: room.ranked ? 'ranked' : 'casual', replay, seats: [seat(0), seat(1)] },
    facts,
  );
  return { matchId, bounty: matchBounties(db, matchId) };
}

export function registerOnlineRoutes(app: FastifyInstance, deps: Deps) {
  const { db, viewerHash, user, present } = deps;
  const lobby = new Lobby({
    cards: (ids) => present(getCards(db, ids)),
    finish: (room) => finishMatch(db, room),
    save: (data) => saveLiveMatch(db, data.id, data),
    remove: (id) => deleteLiveMatch(db, id),
    now: deps.now,
    rateLimit: deps.rateLimit,
    log: (msg) => app.log.warn(msg),
  });
  lobby.restore(
    listLiveMatches(db).flatMap((r) => {
      try {
        return [JSON.parse(r.data) as RoomData];
      } catch {
        deleteLiveMatch(db, r.id);
        return [];
      }
    }),
  );
  lobby.startSweeper();
  app.addHook('onClose', async () => lobby.dispose());

  /** Perfil e deck de quem pede uma partida, ou o motivo de não poder jogar. */
  const seatFor = (req: FastifyRequest, body: { deckId?: unknown } | undefined, ranked: boolean): SeatRequest | LobbyError => {
    const ownerHash = viewerHash(req);
    if (!ownerHash) return { code: 400, error: 'Navegador sem código de dono (header x-deck-owner).' };
    const account = user(req);
    if (ranked && !account) return { code: 401, error: 'A ranqueada é só para quem entrou com a conta Google.' };
    const deckId = typeof body?.deckId === 'string' ? body.deckId : '';
    const deck = deckId ? getDeck(db, deckId) : null;
    if (!deck) return { code: 400, error: 'Escolha um deck.' };
    const cards = new Map(getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]).map((c) => [c.id, c as CardData]));
    const report = validateDeck(deck, cards);
    if (!report.valid) return { code: 400, error: 'Esse deck não é válido para jogar.' };
    // Inclui cartas com script que ainda tenham alguma parte resolvida à mão.
    const manual = new Set([...report.unscripted, ...[...cards.values()].filter((c) => buildCardDef(c).manual).map((c) => c.id)]);
    if (ranked && manual.size) {
      return {
        code: 400,
        error: `Na ranqueada o modo manual não é permitido: este deck tem ${manual.size} carta(s) com efeito ainda não automatizado (⚙).`,
      };
    }
    const profile = ensurePlayer(db, ownerHash);
    return {
      ownerHash,
      userId: account?.id ?? null,
      name: profile.name,
      bounty: profile.bounty,
      tier: tierFor(profile.bounty).id,
      deckId: deck.id,
      deck: { id: deck.id, name: deck.name, leader: deck.leader, cards: deck.cards },
    };
  };
  const formatOf = (v: unknown): FormatId => (isFormat(v) ? v : 'standard');

  /** Sala + assento a partir do token (query `t` ou corpo). */
  const seatIn = (id: string, token: unknown): { room: Room; seat: PlayerId } | null => {
    const room = lobby.get(id);
    const seat = room?.seatOf(token) ?? null;
    return room && seat !== null ? { room, seat } : null;
  };

  app.get('/api/online/config', async () => ({ timeBankMs: TIME_BANK_MS }));

  app.get('/api/online/active', async (req) => {
    const owner = viewerHash(req);
    return owner ? lobby.activeFor(owner) : [];
  });

  type RoomBody = { deckId?: unknown; format?: unknown; code?: unknown };
  app.post<{ Body: RoomBody }>('/api/online/rooms', async (req, reply) => {
    const seat = seatFor(req, req.body, false);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const r = lobby.createPrivate(seat, formatOf(req.body?.format));
    if (isError(r)) return reply.code(r.code).send(r);
    return reply.code(201).send({ roomId: r.room.id, code: r.room.data.code, token: r.token });
  });

  app.post<{ Body: RoomBody }>('/api/online/rooms/join', async (req, reply) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!/^[A-Za-z0-9]{6}$/.test(code.trim())) return reply.code(400).send({ error: 'Código de sala inválido.' });
    const seat = seatFor(req, req.body, false);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const r = lobby.joinPrivate(code, seat);
    if (isError(r)) return reply.code(r.code).send(r);
    return { roomId: r.room.id, token: r.token };
  });

  app.post<{ Body: RoomBody & { queue?: unknown } }>('/api/online/queue', async (req, reply) => {
    const queue = req.body?.queue === 'ranked' ? 'ranked' : 'casual';
    const seat = seatFor(req, req.body, queue === 'ranked');
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const r = lobby.enqueue(seat, formatOf(req.body?.format), queue);
    if (isError(r)) return reply.code(r.code).send(r);
    return reply.code(201).send(r);
  });

  app.get<{ Params: { ticket: string } }>('/api/online/queue/:ticket', async (req, reply) => {
    const r = lobby.poll(req.params.ticket);
    return r ?? reply.code(404).send({ error: 'Você não está mais na fila.' });
  });

  app.delete<{ Params: { ticket: string } }>('/api/online/queue/:ticket', async (req, reply) => {
    lobby.cancel(req.params.ticket);
    return reply.code(204).send();
  });

  /** Canal da partida (SSE): estado, presença, emotes e avisos. */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/online/rooms/:id/events', (req, reply) => {
    const found = seatIn(req.params.id, req.query.t);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    const { room, seat } = found;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const conn: Connection = {
      seat,
      sentDefs: new Set(),
      sentLog: 0,
      send: (event, data) => {
        if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      end: () => res.end(),
    };
    // Evento (e não comentário) para o navegador perceber um canal parado e reconectar.
    const heartbeat = setInterval(() => conn.send('ping', {}), deps.heartbeatMs ?? 20_000);
    room.attach(conn);
    const close = () => {
      clearInterval(heartbeat);
      room.detach(conn);
    };
    req.raw.on('close', close);
    res.on('error', close);
  });

  type SeatBody = { t?: unknown; seq?: unknown; action?: unknown; emote?: unknown };
  const withSeat = (req: FastifyRequest<{ Params: { id: string }; Body: SeatBody }>) => seatIn(req.params.id, req.body?.t);

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/action', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    const r = found.room.act(found.seat, req.body?.seq, req.body?.action);
    return r.ok ? r : reply.code(r.code).send({ error: r.error });
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/emote', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    const r = found.room.emote(found.seat, req.body?.emote);
    return r.ok ? reply.code(204).send() : reply.code(r.code).send({ error: r.error });
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/rematch', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    const err = lobby.rematch(found.room, found.seat);
    return err ? reply.code(err.code).send(err) : reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/leave', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(204).send();
    const err = lobby.leave(found.room, found.seat);
    return err ? reply.code(err.code).send(err) : reply.code(204).send();
  });

  /** Replay completo, para baixar depois do fim (antes disso revelaria as cartas escondidas). */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/online/rooms/:id/replay', async (req, reply) => {
    const found = seatIn(req.params.id, req.query.t);
    const replay = found?.room.replay();
    return replay ?? reply.code(404).send({ error: 'Replay disponível só depois do fim da partida.' });
  });

  return lobby;
}
