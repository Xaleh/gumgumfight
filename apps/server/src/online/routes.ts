// Rotas das partidas online.
//
// Transporte: SSE (servidor → navegador) + POST (ações). Funciona atrás do Nginx /
// Nginx Proxy Manager sem configuração extra: o header X-Accel-Buffering desliga o
// buffer do proxy e um comentário a cada 20 s mantém a conexão abaixo do
// proxy_read_timeout. O EventSource reconecta sozinho.
//
// Espectadores usam outro canal (/watch), sem token: qualquer um assiste às partidas
// das filas (e às privadas, com o código). Ver as mãos exige perfil streamer ou admin
// e é recusado para quem está jogando a própria partida.

import { randomInt } from 'node:crypto';
import { buildCardDef, type CardData, type DeckList, formatIssues, formatLabel, type PlayerId, validateDeck } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, seesHands, type User } from '../auth/store';
import { type DB, deleteLiveMatch, getCards, getDeck, listDecks, listLiveMatches, saveLiveMatch } from '../db';
import type { ApiCard } from '../present';
import { type FormatId, isFormat, tierFor } from '../stats/catalog';
import { deriveMatch } from '../stats/derive';
import { ensurePlayer, matchBounties, recordMatch } from '../stats/store';
import { Lobby, type LobbyError, type SeatRequest } from './lobby';
import { type Connection, MAX_SPECTATORS, type Room, type RoomData, type RoomResult, TIME_BANK_MS } from './room';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  /** Testes: relógio e gravação. */
  now?: () => number;
  heartbeatMs?: number;
  rateLimit?: number;
  /** Treino contra o bot do servidor (ONLINE_BOT_ROOMS). */
  botRooms?: boolean;
  botDelayMs?: number;
  /** Fim de uma partida de torneio: lança o resultado no torneio. */
  onTournamentGame?: (game: { tournamentId: string; matchId: number; roomId: string; winner: string | null; statsMatchId: number | null }) => void;
}

const isError = (v: unknown): v is LobbyError => typeof v === 'object' && v !== null && 'error' in v;

/**
 * Deck pronto para jogar no formato (e sem cartas manuais, se `noManual`): usado
 * pelas salas online e pela inscrição nos torneios.
 */
export function playableDeck(db: DB, deckId: unknown, format: FormatId, noManual: boolean): DeckList | LobbyError {
  const deck = typeof deckId === 'string' && deckId ? getDeck(db, deckId) : null;
  if (!deck) return { code: 400, error: 'Escolha um deck.' };
  const cards = new Map(getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]).map((c) => [c.id, c as CardData]));
  const report = validateDeck(deck, cards);
  if (!report.valid) return { code: 400, error: 'Esse deck não é válido para jogar.' };
  const banned = formatIssues(deck, format);
  if (banned.length) return { code: 400, error: `Esse deck não é permitido no formato ${formatLabel(format)}. ${banned[0].message}` };
  // Inclui cartas com script que ainda tenham alguma parte resolvida à mão.
  const manual = new Set([...report.unscripted, ...[...cards.values()].filter((c) => buildCardDef(c).manual).map((c) => c.id)]);
  if (noManual && manual.size) {
    return {
      code: 400,
      error: `Na ranqueada o modo manual não é permitido: este deck tem ${manual.size} carta(s) com efeito ainda não automatizado (⚙).`,
    };
  }
  return { id: deck.id, name: deck.name, leader: deck.leader, cards: deck.cards };
}

/** Grava a partida terminada nas estatísticas (refeita pelo motor, como as do navegador). */
function finishMatch(db: DB, room: Room, onTournamentGame: Deps['onTournamentGame']): RoomResult {
  const replay = {
    seed: 0,
    seed128: room.data.seed128!,
    chooseFirst: room.data.chooseFirst,
    firstPlayer: room.data.firstPlayer,
    ...(room.legacySetup ? { legacySetup: true } : {}),
    decks: [room.data.seats[0].deck, room.data.seats[1].deck] as [typeof room.data.seats[0]['deck'], typeof room.data.seats[0]['deck']],
    actions: room.data.actions,
  };
  const ids = [...new Set(replay.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
  const facts = deriveMatch(replay, getCards(db, ids) as CardData[]);
  const seat = (p: PlayerId) => {
    const s = room.data.seats[p];
    return s.bot
      ? { controller: 'bot' as const, ownerHash: null, deckId: s.deckId }
      : { controller: 'human' as const, ownerHash: s.ownerHash, deckId: s.deckId };
  };
  // Treino contra o bot entra nas estatísticas como as partidas contra o bot do navegador.
  const mode = room.data.queue === 'bot' ? 'bot' : 'online';
  const queue = room.ranked ? 'ranked' : room.data.queue === 'tournament' ? 'tournament' : 'casual';
  const matchId = recordMatch(db, { mode, format: room.data.format, queue, replay, seats: [seat(0), seat(1)] }, facts);
  const t = room.data.tournament;
  if (t) {
    const winner = room.state?.winner ?? null;
    onTournamentGame?.({
      tournamentId: t.id,
      matchId: t.matchId,
      roomId: room.id,
      winner: winner === null ? null : room.data.seats[winner].userId,
      statsMatchId: matchId,
    });
  }
  return { matchId, bounty: matchBounties(db, matchId) };
}

export function registerOnlineRoutes(app: FastifyInstance, deps: Deps) {
  const { db, viewerHash, user, present } = deps;
  const lobby = new Lobby({
    cards: (ids) => present(getCards(db, ids)),
    finish: (room) => finishMatch(db, room, deps.onTournamentGame),
    save: (data) => saveLiveMatch(db, data.id, data),
    remove: (id) => deleteLiveMatch(db, id),
    now: deps.now,
    rateLimit: deps.rateLimit,
    botDelayMs: deps.botDelayMs,
    log: (msg) => app.log.warn(msg),
  });
  const botRooms = deps.botRooms ?? true;
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
  const seatFor = (
    req: FastifyRequest,
    body: { deckId?: unknown } | undefined,
    ranked: boolean,
    format: FormatId,
  ): SeatRequest | LobbyError => {
    const ownerHash = viewerHash(req);
    if (!ownerHash) return { code: 400, error: 'Navegador sem código de dono (header x-deck-owner).' };
    const account = user(req);
    if (ranked && !account) return { code: 401, error: 'A ranqueada é só para quem entrou com a conta Google.' };
    const deck = deckFor(body?.deckId, format, ranked);
    if (isError(deck)) return deck;
    const profile = ensurePlayer(db, ownerHash);
    return {
      ownerHash,
      userId: account?.id ?? null,
      name: profile.name,
      bounty: profile.bounty,
      tier: tierFor(profile.bounty).id,
      deckId: deck.id!,
      deck,
    };
  };

  /** Deck pronto para jogar no formato (e sem cartas manuais, na ranqueada). */
  const deckFor = (deckId: unknown, format: FormatId, ranked: boolean) => playableDeck(db, deckId, format, ranked);
  const formatOf = (v: unknown): FormatId => (isFormat(v) ? v : 'standard');

  /** Sala + assento a partir do token (query `t` ou corpo). */
  const seatIn = (id: string, token: unknown): { room: Room; seat: PlayerId } | null => {
    const room = lobby.get(id);
    const seat = room?.seatOf(token) ?? null;
    return room && seat !== null ? { room, seat } : null;
  };

  app.get('/api/online/config', async () => ({ timeBankMs: TIME_BANK_MS, botRooms }));

  app.get('/api/online/active', async (req) => {
    const owner = viewerHash(req);
    return owner ? lobby.activeFor(owner) : [];
  });

  type RoomBody = { deckId?: unknown; format?: unknown; code?: unknown };
  app.post<{ Body: RoomBody }>('/api/online/rooms', async (req, reply) => {
    const format = formatOf(req.body?.format);
    const seat = seatFor(req, req.body, false, format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const r = lobby.createPrivate(seat, format);
    if (isError(r)) return reply.code(r.code).send(r);
    return reply.code(201).send({ roomId: r.room.id, code: r.room.data.code, token: r.token });
  });

  app.post<{ Body: RoomBody }>('/api/online/rooms/join', async (req, reply) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!/^[A-Za-z0-9]{6}$/.test(code.trim())) return reply.code(400).send({ error: 'Código de sala inválido.' });
    const format = lobby.privateFormat(code);
    if (!format) return reply.code(404).send({ error: 'Sala não encontrada ou já começou.' });
    const seat = seatFor(req, req.body, false, format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const r = lobby.joinPrivate(code, seat);
    if (isError(r)) return reply.code(r.code).send(r);
    return { roomId: r.room.id, token: r.token };
  });

  app.post<{ Body: RoomBody & { queue?: unknown } }>('/api/online/queue', async (req, reply) => {
    const queue = req.body?.queue === 'ranked' ? 'ranked' : 'casual';
    const format = formatOf(req.body?.format);
    const seat = seatFor(req, req.body, queue === 'ranked', format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const r = lobby.enqueue(seat, format, queue);
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

  /**
   * Treino contra o bot jogado pelo servidor (fase de testes do modo espectador).
   * `botDeckId` ausente ou "random": um deck pronto sorteado entre os permitidos no formato.
   */
  app.post<{ Body: RoomBody & { botDeckId?: unknown } }>('/api/online/bot', async (req, reply) => {
    if (!botRooms) return reply.code(404).send({ error: 'O treino online contra o bot está desligado neste servidor.' });
    const format = formatOf(req.body?.format);
    const seat = seatFor(req, req.body, false, format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    let botDeckId = req.body?.botDeckId;
    if (typeof botDeckId !== 'string' || !botDeckId || botDeckId === 'random') {
      const pool = listDecks(db).filter((d) => d.kind === 'builtin' && !isError(deckFor(d.id, format, false)));
      if (!pool.length) return reply.code(400).send({ error: `Nenhum deck pronto é permitido no ${formatLabel(format)}.` });
      botDeckId = pool[randomInt(pool.length)].id;
    }
    const botDeck = deckFor(botDeckId, format, false);
    if (isError(botDeck)) return reply.code(botDeck.code).send({ error: `Deck do bot: ${botDeck.error}` });
    const bot: SeatRequest = { ownerHash: 'bot', userId: null, name: 'Bot', bounty: 0, tier: tierFor(0).id, deckId: botDeck.id!, deck: botDeck };
    const r = lobby.createBotRoom(seat, bot, format);
    if (isError(r)) return reply.code(r.code).send(r);
    return reply.code(201).send({ roomId: r.room.id, token: r.token });
  });

  /** Abre o canal SSE de uma conexão (jogador ou espectador) com a sala. */
  const stream = (req: FastifyRequest, reply: FastifyReply, room: Room, init: Pick<Connection, 'seat' | 'hands'>) => {
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
      ...init,
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
  };

  /** Canal da partida (SSE): estado, presença, emotes e avisos. */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/online/rooms/:id/events', (req, reply) => {
    const found = seatIn(req.params.id, req.query.t);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    stream(req, reply, found.room, { seat: found.seat });
  });

  // ---------------------------------------------------------------- espectadores

  /** Sala que pode ser assistida (as de treino contra o bot somem quando o treino está desligado). */
  const watchable = (id: string): Room | null => {
    const room = lobby.get(id);
    if (!room || (room.data.queue === 'bot' && !botRooms)) return null;
    return room;
  };

  /**
   * Partidas em andamento para assistir. `hands`: quem pede pode ligar "Ver mãos".
   * `mine`: quem pede joga a partida (nela, as mãos nunca aparecem).
   */
  app.get('/api/online/live', async (req) => {
    const account = user(req);
    const owner = viewerHash(req);
    return {
      rooms: lobby.live({ bots: botRooms }).map((r) => ({ ...r, mine: lobby.get(r.id)?.isPlayer(owner, account?.id ?? null) ?? false })),
      hands: seesHands(account?.role),
    };
  });

  /** Sala privada pelo código, para assistir. */
  app.get<{ Params: { code: string } }>('/api/online/watch/:code', async (req, reply) => {
    const room = /^[A-Za-z0-9]{6}$/.test(req.params.code) ? lobby.byCode(req.params.code) : null;
    if (!room) return reply.code(404).send({ error: 'Nenhuma partida em andamento com esse código.' });
    return { ...lobby.summary(room), mine: room.isPlayer(viewerHash(req), user(req)?.id ?? null) };
  });

  /** Resumo de uma sala (o espectador confere se ela ainda existe antes de reconectar). */
  app.get<{ Params: { id: string } }>('/api/online/rooms/:id', async (req, reply) => {
    const room = watchable(req.params.id);
    return room ? lobby.summary(room) : reply.code(404).send({ error: 'Partida não encontrada.' });
  });

  /** Canal do espectador (SSE). `hands=1`: vê as mãos dos dois jogadores (streamer ou admin). */
  app.get<{ Params: { id: string }; Querystring: { hands?: string } }>('/api/online/rooms/:id/watch', (req, reply) => {
    const room = watchable(req.params.id);
    if (!room || room.status === 'waiting') return reply.code(404).send({ error: 'Partida não encontrada.' });
    const hands = req.query.hands === '1';
    if (hands) {
      const account = user(req);
      if (!seesHands(account?.role)) return reply.code(403).send({ error: 'Ver as mãos é só para streamers e administradores.' });
      if (room.isPlayer(accountOwnerKey(account!.id), account!.id)) {
        return reply.code(403).send({ error: 'Você está jogando esta partida: não dá para assisti-la vendo as mãos.' });
      }
    }
    if (room.spectators >= MAX_SPECTATORS) return reply.code(429).send({ error: 'Esta partida já tem espectadores demais.' });
    stream(req, reply, room, { seat: null, hands });
  });

  type SeatBody = { t?: unknown; seq?: unknown; action?: unknown; emote?: unknown; vx?: unknown; vy?: unknown };
  const withSeat = (req: FastifyRequest<{ Params: { id: string }; Body: SeatBody }>) => seatIn(req.params.id, req.body?.t);

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/action', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    const r = found.room.act(found.seat, req.body?.seq, req.body?.action);
    return r.ok ? r : reply.code(r.code).send({ error: r.error });
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/dice', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send({ error: 'Partida não encontrada.' });
    const r = found.room.throwDice(found.seat, req.body?.vx, req.body?.vy);
    return r.ok ? reply.code(204).send() : reply.code(r.code).send({ error: r.error });
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

  /**
   * Replay completo, para baixar depois do fim (antes disso revelaria as cartas
   * escondidas). Jogadores e espectadores: depois do fim, tudo já é público.
   */
  app.get<{ Params: { id: string } }>('/api/online/rooms/:id/replay', async (req, reply) => {
    const replay = lobby.get(req.params.id)?.replay();
    return replay ?? reply.code(404).send({ error: 'Replay disponível só depois do fim da partida.' });
  });

  return lobby;
}
