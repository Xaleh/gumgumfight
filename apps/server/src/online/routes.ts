// Rotas das partidas online.
//
// Transporte: SSE (servidor → navegador) + POST (ações). Funciona atrás do Nginx /
// Nginx Proxy Manager sem configuração extra: o header X-Accel-Buffering desliga o
// buffer do proxy e um comentário a cada 20 s mantém a conexão abaixo do
// proxy_read_timeout. O EventSource reconecta sozinho.
//
// Espectadores usam outro canal (/watch), sem token: qualquer um assiste às partidas
// das filas (e às privadas, com o código). Ver as mãos exige perfil streamer ou admin, só
// vale nas partidas de torneio e nas salas privadas liberadas por quem criou, é recusado
// para quem está jogando a própria partida e mostra a mesa atrasada.
// Modo transmissão (/api/broadcast): ver online/broadcast.ts.

import { randomInt } from 'node:crypto';
import {
  buildCardDef,
  type CardData,
  cardLegality,
  cleanArts,
  type DeckList,
  formatIssues,
  formatLabel,
  type PlayerId,
  spoilerIssues,
  validateDeck,
} from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, seesHands, type User } from '../auth/store';
import { type DB, deleteLiveMatch, getCards, getDeck, listDecks, listLeaders, listLiveMatches, saveLiveMatch } from '../db';
import { fail } from '../errors';
import type { ApiCard } from '../present';
import { type FormatId, isFormat, tierFor } from '../stats/catalog';
import { deriveMatch } from '../stats/derive';
import { ensurePlayer, matchBounties, recordMatch } from '../stats/store';
import { isApprentice } from '../tutorial/store';
import { actsAsJudge, getTournament } from '../tournaments/store';
import { pushText } from '../push/messages';
import { noNotifier, type Notifier } from '../push/routes';
import {
  type Broadcast,
  broadcastByKey,
  broadcastView,
  DEFAULT_SETTINGS,
  getBroadcast,
  handsDelayFor,
  newBroadcastKey,
  parseSettings,
  setBroadcastRoom,
  setBroadcastSettings,
} from './broadcast';
import { Lobby, type LobbyError, type LobbyLimits, type SeatRequest } from './lobby';
import {
  type ActResult,
  type Connection,
  MAX_SPECTATORS,
  MIN_HANDS_DELAY_MS,
  pinEngineTexts,
  type Room,
  type RoomData,
  type RoomEvent,
  type RoomResult,
  TIME_BANK_MS,
} from './room';

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
  /** Tetos de salas (servidor e por IP); ver `DEFAULT_LIMITS` em lobby.ts. */
  limits?: Partial<LobbyLimits>;
  botDelayMs?: number;
  /** Fim de uma partida de torneio: lança o resultado no torneio. */
  onTournamentGame?: (game: { tournamentId: string; matchId: number; roomId: string; winner: string | null; statsMatchId: number | null }) => void;
  /** Chamado com o id de cada partida gravada (avisos "partida terminada" aos apps parceiros). */
  onMatch?: (matchId: number) => void;
  /** Notificações no celular (partida começou, sua vez). */
  notifier?: Notifier;
}

/**
 * Notificação de uma sala: a partida começou ou a vez passou para o jogador (a sala já
 * escolheu quem avisar: quem está longe do app). Tocar no aviso abre a partida (`?partida=`).
 */
export function roomNotice(notifier: Notifier, room: Room, event: RoomEvent) {
  for (const i of event.seats) {
    const seat = room.data.seats[i];
    const opponent = room.data.seats[i === 0 ? 1 : 0]?.name ?? '?';
    if (!seat) continue;
    const [title, body] = event.type === 'start' ? (['matchStartTitle', 'matchStartBody'] as const) : (['turnTitle', 'turnBody'] as const);
    void notifier.notify(
      { ownerHash: seat.ownerHash, userIds: [seat.userId] },
      {
        category: 'matches',
        text: (locale) => ({ title: pushText(locale, title), body: pushText(locale, body, { opponent }) }),
        tag: `room-${room.id}`,
        url: `/?partida=${encodeURIComponent(room.id)}`,
        ttl: event.type === 'start' ? 300 : 120,
        urgency: 'high',
      },
    );
  }
}

const isError = (v: unknown): v is LobbyError => typeof v === 'object' && v !== null && 'error' in v;

/** Corpo da resposta de uma ação recusada pela sala (sem o status, que vai no código HTTP). */
const refused = (r: Extract<ActResult, { ok: false }>) => ({
  error: r.error,
  ...(r.errorCode ? { errorCode: r.errorCode } : {}),
  ...(r.errorParams ? { errorParams: r.errorParams } : {}),
});

/** O que mais, além do formato, o deck precisa cumprir. */
export interface DeckRules {
  /** Sem cartas com efeito manual (ranqueada). */
  noManual?: boolean;
  /** Sem cartas de spoiler, ainda não lançadas (ranqueada e torneios sem spoilers). */
  noSpoilers?: boolean;
  /** Data em que o deck precisa valer (banimentos com data); padrão: agora. */
  at?: Date;
}

/** Regras da ranqueada: só cartas lançadas e nenhum efeito manual. */
export const RANKED_RULES: DeckRules = { noManual: true, noSpoilers: true };

/**
 * Deck pronto para jogar no formato (e nas regras extras de `rules`): usado pelas
 * salas online e pela inscrição nos torneios.
 */
export function playableDeck(db: DB, deckId: unknown, format: FormatId, rules: DeckRules = {}): DeckList | LobbyError {
  const deck = typeof deckId === 'string' && deckId ? getDeck(db, deckId) : null;
  if (!deck) return { code: 400, ...fail('chooseDeck', 'Escolha um deck.') };
  const cards = new Map(getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]).map((c) => [c.id, c as CardData]));
  const report = validateDeck(deck, cards);
  if (!report.valid) return { code: 400, ...fail('deckInvalid', 'Esse deck não é válido para jogar.') };
  const banned = formatIssues(deck, format, rules.at);
  if (banned.length) {
    // `issue` em português; `issueCode` + `issueParams` para o cliente traduzir o motivo (chave `rules.…`).
    const { message: issue, code: issueCode, params: issueParams } = banned[0];
    return {
      code: 400,
      ...fail('deckNotAllowedInFormat', `Esse deck não é permitido no formato ${formatLabel(format)}. ${issue}`, {
        format: formatLabel(format),
        issue,
        issueCode,
        issueParams,
      }),
    };
  }
  const spoilers = rules.noSpoilers ? spoilerIssues(deck, cards) : [];
  if (spoilers.length) {
    const { message: issue, params } = spoilers[0];
    return { code: 400, ...fail('deckHasSpoilers', `Esse deck tem cartas que ainda não foram lançadas. ${issue}`, params) };
  }
  // Inclui cartas com script que ainda tenham alguma parte resolvida à mão.
  const manual = new Set([...report.unscripted, ...[...cards.values()].filter((c) => buildCardDef(c).manual).map((c) => c.id)]);
  if (rules.noManual && manual.size) {
    return {
      code: 400,
      ...fail(
        'rankedNoManualCards',
        `Na ranqueada o modo manual não é permitido: este deck tem ${manual.size} carta(s) com efeito ainda não automatizado (⚙).`,
        { n: manual.size },
      ),
    };
  }
  const arts = cleanArts(deck, cards);
  return { id: deck.id, name: deck.name, leader: deck.leader, cards: deck.cards, ...(arts ? { arts } : {}) };
}

/** Grava a partida terminada nas estatísticas (refeita pelo motor, como as do navegador). */
function finishMatch(db: DB, room: Room, onTournamentGame: Deps['onTournamentGame'], onMatch?: Deps['onMatch']): RoomResult {
  const replay = {
    seed: 0,
    seed128: room.data.seed128!,
    chooseFirst: room.data.chooseFirst,
    firstPlayer: room.data.firstPlayer,
    ...(room.legacySetup ? { legacySetup: true } : {}),
    decks: [room.data.seats[0].deck, room.data.seats[1].deck] as [typeof room.data.seats[0]['deck'], typeof room.data.seats[0]['deck']],
    actions: room.data.actions,
    // Para rever a partida depois (auditoria): a versão do motor e quem jogou.
    version: room.data.replayVersion ?? 8,
    names: room.data.seats.map((s) => s.name),
    deckIds: room.data.seats.map((s) => s.deckId),
  };
  const ids = [...new Set(replay.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
  // Com os textos para o motor do começo da partida (os mesmos com que a sala foi jogada).
  const facts = deriveMatch(replay, pinEngineTexts(getCards(db, ids) as CardData[], room.data.engineTexts));
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
  onMatch?.(matchId);
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
    finish: (room) => finishMatch(db, room, deps.onTournamentGame, deps.onMatch),
    save: (data) => saveLiveMatch(db, data.id, data),
    remove: (id) => deleteLiveMatch(db, id),
    now: deps.now,
    rateLimit: deps.rateLimit,
    botDelayMs: deps.botDelayMs,
    limits: deps.limits,
    log: (msg) => app.log.warn(msg),
    onRoomEvent: (room, event) => roomNotice(deps.notifier ?? noNotifier, room, event),
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
    if (!ownerHash) return { code: 400, ...fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).') };
    const account = user(req);
    if (ranked && !account) return { code: 401, ...fail('rankedLoginRequired', 'A ranqueada é só para quem entrou com a conta Google.') };
    const deck = deckFor(body?.deckId, format, ranked);
    if (isError(deck)) return deck;
    const profile = ensurePlayer(db, ownerHash);
    return {
      ownerHash,
      userId: account?.id ?? null,
      name: profile.name,
      bounty: profile.bounty,
      tier: tierFor(profile.bounty).id,
      apprentice: isApprentice(db, ownerHash),
      deckId: deck.id!,
      deck,
    };
  };

  /** Deck pronto para jogar no formato (na ranqueada, também sem cartas manuais nem spoilers). */
  const deckFor = (deckId: unknown, format: FormatId, ranked: boolean) => playableDeck(db, deckId, format, ranked ? RANKED_RULES : {});
  const formatOf = (v: unknown): FormatId => (isFormat(v) ? v : 'standard');

  /** Sala + assento a partir do token (query `t` ou corpo). */
  const seatIn = (id: string, token: unknown): { room: Room; seat: PlayerId } | null => {
    const room = lobby.get(id);
    const seat = room?.seatOf(token) ?? null;
    return room && seat !== null ? { room, seat } : null;
  };

  app.get('/api/online/config', async () => ({ timeBankMs: TIME_BANK_MS, botRooms }));

  /**
   * Contadores do menu (conectados, partidas por modo, filas). Quem está com o menu
   * aberto consulta a cada ~10 s, e essa consulta é o sinal que o conta em "conectados".
   */
  app.get('/api/online/stats', async (req) => {
    const owner = viewerHash(req);
    if (owner) lobby.touch(owner);
    return lobby.stats();
  });

  app.get('/api/online/active', async (req) => {
    const owner = viewerHash(req);
    return owner ? lobby.activeFor(owner) : [];
  });

  type RoomBody = { deckId?: unknown; format?: unknown; code?: unknown; showHands?: unknown };
  app.post<{ Body: RoomBody }>('/api/online/rooms', async (req, reply) => {
    const format = formatOf(req.body?.format);
    const seat = seatFor(req, req.body, false, format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const limit = lobby.admit(req.ip);
    if (limit) return reply.code(limit.code).send(limit);
    const r = lobby.createPrivate(seat, format, req.body?.showHands === true);
    if (isError(r)) return reply.code(r.code).send(r);
    lobby.tagIp(r.room.id, req.ip);
    return reply.code(201).send({ roomId: r.room.id, code: r.room.data.code, token: r.token });
  });

  app.post<{ Body: RoomBody }>('/api/online/rooms/join', async (req, reply) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!/^[A-Za-z0-9]{6}$/.test(code.trim())) return reply.code(400).send(fail('invalidRoomCode', 'Código de sala inválido.'));
    const format = lobby.privateFormat(code);
    if (!format) return reply.code(404).send(fail('roomNotFound', 'Sala não encontrada ou já começou.'));
    const seat = seatFor(req, req.body, false, format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const limit = lobby.admit(req.ip);
    if (limit) return reply.code(limit.code).send(limit);
    const r = lobby.joinPrivate(code, seat);
    if (isError(r)) return reply.code(r.code).send(r);
    lobby.tagIp(r.room.id, req.ip);
    return { roomId: r.room.id, token: r.token };
  });

  /** Líderes permitidos no formato, para escolher o oponente na fila casual. */
  const formatLeaders = (format: FormatId) => listLeaders(db).filter((c) => cardLegality(c.id, format) === 'legal');

  /**
   * Líderes que dá para escolher na fila casual do formato, com quantos jogadores
   * daquele Líder estão na fila agora (`queue`).
   */
  app.get<{ Querystring: { format?: string } }>('/api/online/leaders', async (req) => {
    const format = formatOf(req.query.format);
    const waiting = lobby.casualLeaders(format);
    return present(formatLeaders(format)).map((c) => ({
      id: c.id,
      name: c.name,
      imageUrl: c.imageUrl ?? null,
      colors: c.colors,
      queue: waiting[c.id] ?? 0,
    }));
  });

  /**
   * Entra na fila. Na casual, `leader` (opcional) é o Líder do oponente desejado:
   * no primeiro minuto só forma par com ele; depois, com qualquer um.
   */
  app.post<{ Body: RoomBody & { queue?: unknown; leader?: unknown } }>('/api/online/queue', async (req, reply) => {
    const queue = req.body?.queue === 'ranked' ? 'ranked' : 'casual';
    const format = formatOf(req.body?.format);
    const leader = queue === 'casual' && typeof req.body?.leader === 'string' && req.body.leader ? req.body.leader : null;
    const pick = leader ? getCards(db, [leader])[0] : null;
    if (leader && (pick?.category !== 'leader' || cardLegality(leader, format) !== 'legal')) {
      return reply.code(400).send(fail('invalidLeaderPick', 'Esse Líder não pode ser escolhido neste formato.', { format: formatLabel(format) }));
    }
    const seat = seatFor(req, req.body, queue === 'ranked', format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const limit = lobby.admit(req.ip);
    if (limit) return reply.code(limit.code).send(limit);
    const r = lobby.enqueue(seat, format, queue, req.ip, leader);
    if (isError(r)) return reply.code(r.code).send(r);
    return reply.code(201).send(r);
  });

  app.get<{ Params: { ticket: string } }>('/api/online/queue/:ticket', async (req, reply) => {
    const r = lobby.poll(req.params.ticket);
    return r ?? reply.code(404).send(fail('notInQueue', 'Você não está mais na fila.'));
  });

  app.delete<{ Params: { ticket: string } }>('/api/online/queue/:ticket', async (req, reply) => {
    lobby.cancel(req.params.ticket);
    return reply.code(204).send();
  });

  /**
   * Treino contra o bot transmitido: o servidor joga pelo bot e a partida aparece em
   * "Assistir". Só com login (sem conta, o treino roda no navegador).
   * `botDeckId` ausente ou "random": um deck pronto sorteado entre os permitidos no formato.
   * `first`: 0 = o jogador começa, 1 = o bot começa; ausente ou "random" = sorteio.
   */
  app.post<{ Body: RoomBody & { botDeckId?: unknown; first?: unknown } }>('/api/online/bot', async (req, reply) => {
    if (!botRooms) return reply.code(404).send(fail('botRoomsOff', 'O treino online contra o bot está desligado neste servidor.'));
    if (!user(req)) return reply.code(401).send(fail('botRoomLoginRequired', 'Para transmitir o treino contra o bot, entre com a conta Google.'));
    const format = formatOf(req.body?.format);
    const seat = seatFor(req, req.body, false, format);
    if (isError(seat)) return reply.code(seat.code).send(seat);
    const limit = lobby.admit(req.ip, 'bot');
    if (limit) return reply.code(limit.code).send(limit);
    let botDeckId = req.body?.botDeckId;
    if (typeof botDeckId !== 'string' || !botDeckId || botDeckId === 'random') {
      const pool = listDecks(db).filter((d) => d.kind === 'builtin' && !isError(deckFor(d.id, format, false)));
      if (!pool.length) return reply.code(400).send(fail('noBuiltinDeckInFormat', `Nenhum deck pronto é permitido no ${formatLabel(format)}.`, { format: formatLabel(format) }));
      botDeckId = pool[randomInt(pool.length)].id;
    }
    const botDeck = deckFor(botDeckId, format, false);
    if (isError(botDeck)) {
      // Mesmo motivo do deck do jogador, com o prefixo "Deck do bot" (chave própria: botChooseDeck, botDeckInvalid…).
      const errorCode = `bot${botDeck.errorCode[0].toUpperCase()}${botDeck.errorCode.slice(1)}`;
      return reply.code(botDeck.code).send(fail(errorCode, `Deck do bot: ${botDeck.error}`, botDeck.errorParams));
    }
    const bot: SeatRequest = { ownerHash: 'bot', userId: null, name: 'Bot', bounty: 0, tier: tierFor(0).id, deckId: botDeck.id!, deck: botDeck };
    const first = req.body?.first;
    const r = lobby.createBotRoom(seat, bot, format, first === 0 || first === 1 ? first : undefined);
    if (isError(r)) return reply.code(r.code).send(r);
    lobby.tagIp(r.room.id, req.ip);
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

  /** Canal da partida (SSE): estado, presença, emotes, chat e avisos. */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/online/rooms/:id/events', (req, reply) => {
    const found = seatIn(req.params.id, req.query.t);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
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
    if (!room) return reply.code(404).send(fail('noMatchWithCode', 'Nenhuma partida em andamento com esse código.'));
    return { ...lobby.summary(room), mine: room.isPlayer(viewerHash(req), user(req)?.id ?? null) };
  });

  /** Resumo de uma sala (o espectador confere se ela ainda existe antes de reconectar). */
  app.get<{ Params: { id: string } }>('/api/online/rooms/:id', async (req, reply) => {
    const room = watchable(req.params.id);
    return room ? lobby.summary(room) : reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
  });

  /**
   * Decks dos dois jogadores (lista completa e as cartas), para o painel de decklist de quem transmite.
   * A mesma regra de "Ver mãos": só Streamer/Admin, só nas salas que liberam as mãos (torneio e privada
   * liberada) e nunca na própria partida.
   */
  app.get<{ Params: { id: string } }>('/api/online/rooms/:id/decks', async (req, reply) => {
    const room = watchable(req.params.id);
    if (!room || room.status === 'waiting') return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const account = user(req);
    if (!seesHands(account?.role)) return reply.code(403).send(fail('handsForbidden', 'Ver as mãos é só para streamers e administradores.'));
    if (!room.handsAllowed) {
      return reply.code(403).send(fail('handsTournamentOnly', 'As mãos dos jogadores só aparecem nas partidas de torneio e nas salas privadas que liberaram as mãos.'));
    }
    if (room.isPlayer(accountOwnerKey(account!.id), account!.id)) {
      return reply.code(403).send(fail('handsOwnMatch', 'Você está jogando esta partida: não dá para assisti-la vendo as mãos.'));
    }
    const players = room.data.seats.map((s) => ({
      name: s.name,
      bot: Boolean(s.bot),
      deck: { name: s.deck.name, leader: s.deck.leader, cards: s.deck.cards, ...(s.deck.arts ? { arts: s.deck.arts } : {}) },
    }));
    const ids = [...new Set(players.flatMap((p) => [p.deck.leader, ...p.deck.cards.map((c) => c.id)]))];
    return { players, cards: present(getCards(db, ids)) };
  });

  /** Deck de quem joga (painel de decklist da mesa no desktop): só o do próprio assento, pelo token. */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/online/rooms/:id/my-deck', async (req, reply) => {
    const found = seatIn(req.params.id, req.query.t);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const s = found.room.data.seats[found.seat];
    const deck = { name: s.deck.name, leader: s.deck.leader, cards: s.deck.cards, ...(s.deck.arts ? { arts: s.deck.arts } : {}) };
    const ids = [...new Set([deck.leader, ...deck.cards.map((c) => c.id)])];
    return { players: [{ name: s.name, bot: Boolean(s.bot), deck }], cards: present(getCards(db, ids)) };
  });

  /**
   * Canal do espectador (SSE). `hands=1`: vê as mãos dos dois jogadores (streamer ou admin, só em
   * partida de torneio ou sala privada liberada), na mesa atrasada (o atraso escolhido nas opções da transmissão, nunca abaixo do mínimo). `k`:
   * tela de transmissão; a chave faz as vezes do login e as opções do streamer decidem o que
   * a conexão vê (`broadcastView`). `judge=1`: o Judge do torneio (ou o organizador) entra em
   * qualquer sala do torneio, mesmo em espera, e vê as duas mãos ao vivo, sem atraso.
   */
  app.get<{ Params: { id: string }; Querystring: { hands?: string; k?: string; judge?: string } }>('/api/online/rooms/:id/watch', (req, reply) => {
    const room = watchable(req.params.id);
    const judge = req.query.judge === '1';
    if (!room || (room.status === 'waiting' && !judge)) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    let view: Pick<Connection, 'hands' | 'as' | 'delay' | 'judge'> = {};
    if (judge) {
      const account = user(req);
      if (!account) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      const t = room.data.tournament ? getTournament(db, room.data.tournament.id) : null;
      if (!t || !actsAsJudge(db, t, account)) return reply.code(403).send(fail('judgeForbidden', 'Só o Judge ou o organizador deste torneio entra na sala como Judge.'));
      app.log.info(`torneio ${t.id}: ${account.id} entrou como Judge na sala ${room.id}`);
      view = { judge: true };
    } else if (req.query.k !== undefined) {
      const found = broadcastByKey(db, String(req.query.k));
      if (!found || !seesHands(found.user.role)) return reply.code(403).send(fail('broadcastNotFound', 'Link de transmissão inválido. Copie o link de novo no app.'));
      view = broadcastView(found.broadcast, room, found.user);
    } else if (req.query.hands === '1') {
      const account = user(req);
      if (!seesHands(account?.role)) return reply.code(403).send(fail('handsForbidden', 'Ver as mãos é só para streamers e administradores.'));
      if (!room.handsAllowed) {
        return reply.code(403).send(fail('handsTournamentOnly', 'As mãos dos jogadores só aparecem nas partidas de torneio e nas salas privadas que liberaram as mãos.'));
      }
      if (room.isPlayer(accountOwnerKey(account!.id), account!.id)) {
        return reply.code(403).send(fail('handsOwnMatch', 'Você está jogando esta partida: não dá para assisti-la vendo as mãos.'));
      }
      view = { hands: true, delay: handsDelayFor(db, account!.id, room) };
    }
    if (room.spectators >= MAX_SPECTATORS) return reply.code(429).send(fail('tooManySpectators', 'Esta partida já tem espectadores demais.'));
    stream(req, reply, room, { seat: null, ...view });
  });

  // ---------------------------------------------------------------- modo transmissão

  /** Conta que pode transmitir (a que vê as mãos: streamer, admin ou dev), ou responde 401/403. */
  const broadcaster = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const account = user(req);
    if (!account) {
      void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      return null;
    }
    if (!seesHands(account.role)) {
      void reply.code(403).send(fail('broadcastForbidden', 'O modo transmissão é só para os perfis Streamer e Admin.'));
      return null;
    }
    return account;
  };
  /** Transmissão da conta para o app (sem a versão, que é da tela de transmissão). */
  const mine = (b: Broadcast | null) => {
    const { rev: _, ...rest } = b ?? { key: null, roomId: null, rev: 0, ...DEFAULT_SETTINGS };
    return { ...rest, minHandsDelayS: MIN_HANDS_DELAY_MS / 1000 };
  };
  const noKey = (reply: FastifyReply) => reply.code(409).send(fail('broadcastNoKey', 'Crie o link da transmissão antes (Assistir partidas → Modo transmissão).'));

  /** Transmissão da conta: a chave do link do OBS (null antes de gerar), a partida escolhida e as opções. */
  app.get('/api/broadcast', async (req, reply) => {
    const account = broadcaster(req, reply);
    if (!account) return reply;
    return mine(getBroadcast(db, account.id));
  });

  /** Gera o link da transmissão (ou um novo: o antigo para de funcionar no OBS). */
  app.post('/api/broadcast/key', async (req, reply) => {
    const account = broadcaster(req, reply);
    if (!account) return reply;
    return mine(newBroadcastKey(db, account.id));
  });

  /** Escolhe a partida que vai para a transmissão (`roomId` null tira a partida da tela); vale a própria partida. */
  app.put<{ Body: { roomId?: unknown } }>('/api/broadcast/room', async (req, reply) => {
    const account = broadcaster(req, reply);
    if (!account) return reply;
    if (!getBroadcast(db, account.id)) return noKey(reply);
    const roomId = req.body?.roomId;
    if (roomId === null) return mine(setBroadcastRoom(db, account.id, null));
    const room = typeof roomId === 'string' ? watchable(roomId) : null;
    if (!room || room.status === 'waiting') return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    return mine(setBroadcastRoom(db, account.id, room.id));
  });

  /** Opções da transmissão (`{ delayS, handsPlayers, handsOwn, delayTournaments, chat }`; campos ausentes ficam). */
  app.put<{ Body: Record<string, unknown> }>('/api/broadcast/settings', async (req, reply) => {
    const account = broadcaster(req, reply);
    if (!account) return reply;
    const current = getBroadcast(db, account.id);
    if (!current) return noKey(reply);
    return mine(setBroadcastSettings(db, account.id, parseSettings(req.body, current)));
  });

  /**
   * O que a tela de transmissão (fonte do OBS) mostra agora: a partida escolhida no app, se o chat
   * aparece e a versão (`rev`, que muda a cada troca: a tela reconecta). Sem login: a chave é o
   * segredo. Some (404) se o link foi trocado ou a conta perdeu o perfil.
   */
  app.get<{ Params: { key: string } }>('/api/broadcast/:key', async (req, reply) => {
    const found = broadcastByKey(db, req.params.key);
    if (!found || !seesHands(found.user.role)) return reply.code(404).send(fail('broadcastNotFound', 'Link de transmissão inválido. Copie o link de novo no app.'));
    const { roomId, chat, rev } = found.broadcast;
    return { roomId, chat, rev };
  });

  type SeatBody = { t?: unknown; seq?: unknown; action?: unknown; emote?: unknown; text?: unknown; vx?: unknown; vy?: unknown; visible?: unknown };
  const withSeat = (req: FastifyRequest<{ Params: { id: string }; Body: SeatBody }>) => seatIn(req.params.id, req.body?.t);

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/action', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const r = found.room.act(found.seat, req.body?.seq, req.body?.action);
    return r.ok ? r : reply.code(r.code).send(refused(r));
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/dice', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const r = found.room.throwDice(found.seat, req.body?.vx, req.body?.vy);
    return r.ok ? reply.code(204).send() : reply.code(r.code).send(refused(r));
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/emote', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const r = found.room.emote(found.seat, req.body?.emote);
    return r.ok ? reply.code(204).send() : reply.code(r.code).send(refused(r));
  });

  /**
   * O app do jogador saiu da tela ou voltou (`visible`): com ele fora da tela, a vez que
   * chega vira notificação no celular (ver `Room.turnNotice`).
   */
  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/focus', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    found.room.setVisible(found.seat, req.body?.visible !== false);
    return reply.code(204).send();
  });

  /** Chat da partida (texto livre, censurado no servidor; só quem tem assento manda). */
  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/chat', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const r = found.room.chat(found.seat, req.body?.text);
    return r.ok ? reply.code(204).send() : reply.code(r.code).send(refused(r));
  });

  app.post<{ Params: { id: string }; Body: SeatBody }>('/api/online/rooms/:id/rematch', async (req, reply) => {
    const found = withSeat(req);
    if (!found) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
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
   * escondidas). Jogadores e espectadores: depois do fim, tudo já é público. Numa
   * partida de torneio, não: o replay (com as duas listas) fica na página do torneio,
   * para quem audita e, quando o torneio termina, para os dois jogadores.
   */
  app.get<{ Params: { id: string } }>('/api/online/rooms/:id/replay', async (req, reply) => {
    const room = lobby.get(req.params.id);
    if (room?.sealed) {
      return reply.code(403).send(fail('replayTournament', 'Numa partida de torneio o replay fica na página do torneio: para o organizador e os Judges, e para os jogadores quando o torneio termina.'));
    }
    const replay = room?.replay();
    return replay ?? reply.code(404).send(fail('replayAfterEnd', 'Replay disponível só depois do fim da partida.'));
  });

  return lobby;
}
