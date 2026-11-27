// Rotas das mesas online do Yonko (`/api/yonko/...`). A mesa em si está em yonko/table.ts.
//
// Transporte igual ao das partidas de dois jogadores (online/routes.ts): SSE do servidor para o navegador
// (`/events`, com o token do lugar) e POST para cada pedido. O token fica no navegador de quem senta: é ele que
// permite voltar para a mesa depois de recarregar a página (`/api/yonko/active` lista as mesas da pessoa).
//
// Espectadores usam outro canal (`/watch`), sem token: assiste quem tem o código da mesa (`/api/yonko/watch/:code`)
// ou, se quem criou a abriu, quem a encontra em "Assistir partidas" (`/api/yonko/live`). A tela de transmissão
// entra pelo mesmo canal com a chave do streamer (`k`); o que ela vê está em online/broadcast.ts.

import { randomBytes, randomInt } from 'node:crypto';
import { type CardData, type DeckList, validateDeck, yonkoBannedIn, yonkoTableDeck } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SseMetrics } from '../monitor/sse';
import { accountOwnerKey, seesHands, type User } from '../auth/store';
import { type DB, deleteYonkoTable, getCards, getDeck, listCards, listDecks, listYonkoTables, saveYonkoTable } from '../db';
import { type ErrorParams, fail } from '../errors';
import { broadcastByKey, handsDelayFor, yonkoBroadcastView } from '../online/broadcast';
import { MAX_SPECTATORS, MIN_HANDS_DELAY_MS } from '../online/room';
import type { ApiCard } from '../present';
import { ensurePlayer } from '../stats/store';
import {
  newToken,
  parseRules,
  YONKO_ABANDON_MS,
  YONKO_IDLE_MS,
  YONKO_MIN_PLAYERS,
  YONKO_SEATS,
  YONKO_TIME_BANK_MS,
  type YonkoConnection,
  type YonkoResult,
  type YonkoSeat,
  YonkoTable,
  type YonkoTableData,
  type YonkoWatch,
} from './table';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Mesas abertas ao mesmo tempo no servidor. */
const MAX_TABLES = 200;
/** Partida em andamento sem ninguém conectado por tanto tempo: fechada (o relógio e o abandono já teriam acabado com ela). */
const STALE_PLAYING_MS = 6 * 60 * 60_000;

export interface YonkoDeps {
  db: DB;
  /** Métricas dos canais SSE (monitoramento). */
  sse?: SseMetrics;
  viewerHash: (req: FastifyRequest) => string | null;
  user: (req: FastifyRequest) => User | null;
  present: (cards: CardData[]) => ApiCard[];
  now?: () => number;
  botDelayMs?: number;
  rateLimit?: number;
  heartbeatMs?: number;
  /** Intervalo da faxina das mesas esquecidas (0 = sem faxina automática; os testes chamam `sweep`). */
  sweepMs?: number;
}

type Refusal = { code: number; error: string; errorCode?: string; errorParams?: ErrorParams };
const refusal = (code: number, errorCode: string, text: string, params?: ErrorParams): Refusal => ({ code, ...fail(errorCode, text, params) });
const isRefusal = (v: unknown): v is Refusal => typeof v === 'object' && v !== null && 'error' in v && 'code' in v;

/** As mesas abertas no servidor (na memória, gravadas no banco a cada mudança). */
export class YonkoTables {
  private tables = new Map<string, YonkoTable>();
  private codes = new Map<string, string>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: YonkoDeps) {}

  private tableDeps() {
    const { db, present, now, botDelayMs, rateLimit } = this.deps;
    return {
      cards: (ids: string[]) => present(getCards(db, ids) as CardData[]) as unknown as CardData[],
      now,
      botDelayMs,
      rateLimit,
      save: (t: YonkoTable) => saveYonkoTable(db, t.id, t.data),
      log: (msg: string) => console.warn(msg),
    };
  }

  get size() {
    return this.tables.size;
  }

  get(id: string) {
    return this.tables.get(id) ?? null;
  }

  byCode(code: unknown) {
    if (typeof code !== 'string') return null;
    const id = this.codes.get(code.trim().toUpperCase());
    return id ? this.get(id) : null;
  }

  /** Refaz as mesas gravadas (ao subir o servidor). */
  restore() {
    for (const row of listYonkoTables(this.deps.db)) {
      try {
        const data = JSON.parse(row.data) as YonkoTableData;
        const table = new YonkoTable(data, this.tableDeps());
        this.tables.set(table.id, table);
        this.codes.set(data.code, table.id);
      } catch (e) {
        console.warn(`Mesa de Yonko ${row.id} não pôde ser refeita: ${e instanceof Error ? e.message : e}`);
        deleteYonkoTable(this.deps.db, row.id);
      }
    }
  }

  create(host: YonkoSeat, rules: unknown): YonkoTable | Refusal {
    if (this.tables.size >= MAX_TABLES) return refusal(503, 'yonkoBusy', 'Muitas mesas abertas agora; tente daqui a pouco.');
    let code = '';
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.codes.has(code));
    const now = (this.deps.now ?? Date.now)();
    const data: YonkoTableData = {
      id: `yk-${randomBytes(8).toString('hex')}`,
      code,
      createdAt: now,
      host: 0,
      rules: parseRules(rules),
      seats: [host, ...Array.from({ length: YONKO_SEATS - 1 }, () => null)],
      players: null,
      seatOf: null,
      seed128: null,
      aliasSalt: '',
      actions: [],
      remaining: [],
      touchedAt: now,
    };
    const table = new YonkoTable(data, this.tableDeps());
    this.tables.set(table.id, table);
    this.codes.set(code, table.id);
    saveYonkoTable(this.deps.db, table.id, data);
    return table;
  }

  remove(table: YonkoTable) {
    table.dispose();
    this.tables.delete(table.id);
    this.codes.delete(table.data.code);
    deleteYonkoTable(this.deps.db, table.id);
  }

  /** As mesas em que esta pessoa tem lugar (para voltar a elas depois de recarregar a página). */
  mine(ownerHash: string | null, userId: string | null) {
    const out: Array<{ id: string; code: string; status: string; token: string }> = [];
    for (const t of this.tables.values()) {
      const token = t.tokenOf(ownerHash, userId);
      if (token) out.push({ id: t.id, code: t.data.code, status: t.status, token });
    }
    return out;
  }

  /** As mesas da lista "Assistir partidas": as que quem criou abriu, com a partida em andamento; as mais novas primeiro. */
  live(): YonkoTable[] {
    return [...this.tables.values()].filter((t) => t.data.listed && t.status === 'playing').sort((a, b) => (b.data.startedAt ?? 0) - (a.data.startedAt ?? 0));
  }

  /** Fecha as mesas esquecidas: espera ou fim sem ninguém conectado, e partidas paradas há horas. */
  sweep() {
    const now = (this.deps.now ?? Date.now)();
    for (const t of [...this.tables.values()]) {
      const idle = now - t.data.touchedAt;
      if (t.status === 'finished' && now - (t.data.finishedAt ?? t.data.touchedAt) > YONKO_IDLE_MS && (t.connections === 0 || idle > YONKO_IDLE_MS)) this.remove(t);
      else if (t.status === 'waiting' && t.connections === 0 && idle > YONKO_IDLE_MS) this.remove(t);
      else if (t.status === 'playing' && t.connections === 0 && idle > STALE_PLAYING_MS) this.remove(t);
    }
  }

  startSweeper() {
    const ms = this.deps.sweepMs ?? 60_000;
    if (ms > 0) this.sweeper = setInterval(() => this.sweep(), ms);
  }

  dispose() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const t of this.tables.values()) t.dispose(false);
    this.tables.clear();
    this.codes.clear();
  }
}

export function registerYonkoRoutes(app: FastifyInstance, deps: YonkoDeps) {
  const { db, viewerHash, user } = deps;
  const tables = new YonkoTables(deps);
  tables.restore();
  tables.startSweeper();
  app.addHook('onClose', async () => tables.dispose());

  /** Todas as cartas (para completar o deck de teste), relidas no máximo a cada minuto. */
  let pool: { at: number; cards: CardData[] } | null = null;
  const allCards = () => {
    const now = Date.now();
    if (!pool || now - pool.at > 60_000) pool = { at: now, cards: listCards(db) as unknown as CardData[] };
    return pool.cards;
  };

  /** O deck que vai para a mesa: um deck de 60 como está, ou o deck de teste a partir de um de 50. */
  const tableDeck = (deckId: unknown): Pick<YonkoSeat, 'deckId' | 'deckName' | 'deck' | 'test' | 'leaderName' | 'colors'> | Refusal => {
    const stored = typeof deckId === 'string' && deckId ? getDeck(db, deckId) : null;
    if (!stored) return refusal(400, 'chooseDeck', 'Escolha um deck.');
    const deck: DeckList = { id: stored.id, name: stored.name, leader: stored.leader, cards: stored.cards, ...(stored.arts ? { arts: stored.arts } : {}) };
    if (yonkoBannedIn(deck)) return refusal(400, 'yonkoBanned', 'O Luffy de 6 cores (SEALED-001) é proibido no Yonko.');
    const made = yonkoTableDeck(deck, allCards(), randomInt(0, 2 ** 31));
    if (!made) return refusal(400, 'yonkoDeckInvalid', 'Esse deck não serve para o Yonko: use um deck de 60 (uma cópia de cada) ou um deck completo de 50.');
    const leader = (getCards(db, [stored.leader]) as unknown as CardData[])[0];
    return { deckId: stored.id, deckName: stored.name, leaderName: leader?.name ?? stored.leader, colors: leader?.colors ?? [], deck: made.deck, test: made.test };
  };

  /** Lugar de uma pessoa (perfil, deck e token novo), ou o motivo de não poder sentar. */
  const personSeat = (req: FastifyRequest, deckId: unknown): YonkoSeat | Refusal => {
    const ownerHash = viewerHash(req);
    if (!ownerHash) return refusal(400, 'noOwner', 'Navegador sem código de dono (header x-deck-owner).');
    const deck = tableDeck(deckId);
    if (isRefusal(deck)) return deck;
    const profile = ensurePlayer(db, ownerHash);
    return { ownerHash, userId: user(req)?.id ?? null, name: profile.name, ...deck, token: newToken(), bot: false, ready: false };
  };

  /** Um bot com um deck pronto, de preferência de um Líder que ninguém da mesa usa. */
  const botSeat = (table: YonkoTable): YonkoSeat | Refusal => {
    const taken = new Set(table.data.seats.filter((s): s is YonkoSeat => s !== null).map((s) => s.deck.leader));
    const builtin = listDecks(db).filter((d) => d.kind === 'builtin' && d.group !== 'allblue');
    const shuffled = builtin.sort(() => Math.random() - 0.5);
    const ordered = [...shuffled.filter((d) => !taken.has(d.leader)), ...shuffled.filter((d) => taken.has(d.leader))];
    const n = table.data.seats.filter((s) => s?.bot).length + 1;
    for (const d of ordered) {
      const cards = new Map((getCards(db, [d.leader, ...d.cards.map((c) => c.id)]) as unknown as CardData[]).map((c) => [c.id, c]));
      if (!validateDeck(d, cards).valid) continue;
      const deck = tableDeck(d.id);
      if (isRefusal(deck)) continue;
      return { ownerHash: null, userId: null, name: `Bot ${n}`, ...deck, token: null, bot: true, ready: true };
    }
    return refusal(503, 'yonkoNoBotDeck', 'Nenhum deck pronto disponível para o bot.');
  };

  /** Sai das outras salas de espera desta pessoa (cada um senta numa mesa por vez enquanto espera). */
  const leaveOtherWaiting = (req: FastifyRequest, except?: string) => {
    for (const mine of tables.mine(viewerHash(req), user(req)?.id ?? null)) {
      if (mine.id === except || mine.status !== 'waiting') continue;
      const t = tables.get(mine.id);
      if (!t) continue;
      const r = t.leaveWaiting(mine.token);
      if (r.ok && r.empty) tables.remove(t);
    }
  };

  const reply = (res: FastifyReply, r: YonkoResult | Refusal, ok: unknown = { ok: true }) => {
    if ('ok' in r && r.ok) return ok;
    const { code, ...body } = r as Refusal;
    return res.code(code).send(body);
  };

  app.get('/api/yonko/config', async () => ({ timeBankMs: YONKO_TIME_BANK_MS, abandonMs: YONKO_ABANDON_MS, seats: YONKO_SEATS, minPlayers: YONKO_MIN_PLAYERS }));

  /** As mesas em que quem pede tem lugar (com o token): o navegador volta para elas depois de recarregar. */
  app.get('/api/yonko/active', async (req) => tables.mine(viewerHash(req), user(req)?.id ?? null));

  /** Cria uma mesa com código; quem cria fica no primeiro lugar e manda nela. */
  app.post<{ Body: { deckId?: unknown; rules?: unknown } }>('/api/yonko/tables', async (req, res) => {
    const seat = personSeat(req, req.body?.deckId);
    if (isRefusal(seat)) return reply(res, seat);
    leaveOtherWaiting(req);
    const table = tables.create(seat, req.body?.rules);
    if (isRefusal(table)) return reply(res, table);
    return res.code(201).send({ id: table.id, code: table.data.code, token: seat.token });
  });

  /** Entra numa mesa pelo código. Quem já tem lugar nela volta para o mesmo lugar. */
  app.post<{ Body: { code?: unknown; deckId?: unknown } }>('/api/yonko/tables/join', async (req, res) => {
    const table = tables.byCode(req.body?.code);
    if (!table) return reply(res, refusal(404, 'yonkoCodeNotFound', 'Nenhuma mesa com esse código.'));
    const already = table.tokenOf(viewerHash(req), user(req)?.id ?? null);
    if (already) return { id: table.id, code: table.data.code, token: already };
    const seat = personSeat(req, req.body?.deckId);
    if (isRefusal(seat)) return reply(res, seat);
    const r = table.join(seat);
    if (!r.ok) return reply(res, r);
    leaveOtherWaiting(req, table.id);
    return { id: table.id, code: table.data.code, token: seat.token };
  });

  /** Abre o canal SSE de uma conexão (jogador ou espectador) e a liga à mesa até o navegador fechar. */
  const stream = (req: FastifyRequest, res: FastifyReply, table: YonkoTable, who: Pick<YonkoConnection, 'token' | 'watch'>, metricKey: string) => {
    res.hijack();
    const raw = res.raw;
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    raw.write('retry: 2000\n\n');
    const metric = deps.sse?.track('yonko', metricKey);
    const conn: YonkoConnection = {
      ...who,
      sentDefs: new Set(),
      sentLog: 0,
      send: (event, data) => {
        if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      end: () => {
        metric?.serverEnd();
        raw.end();
      },
    };
    const heartbeat = setInterval(() => conn.send('ping', {}), deps.heartbeatMs ?? 20_000);
    table.attach(conn);
    const close = () => {
      clearInterval(heartbeat);
      table.detach(conn);
      metric?.close();
    };
    req.raw.on('close', close);
    raw.on('error', close);
    raw.on('close', () => metric?.close());
  };

  /** Canal da mesa (SSE): a sala de espera e, na partida, a mesa vista do lugar de quem conecta. */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/yonko/tables/:id/events', (req, res) => {
    const table = tables.get(req.params.id);
    const token = req.query.t;
    if (!table || typeof token !== 'string' || table.seatOfToken(token) === null) return res.code(404).send(fail('yonkoNotFound', 'Mesa não encontrada.'));
    stream(req, res, table, { token }, `${table.id}:${token}`);
  });

  // ---------------------------------------------------------------- espectadores

  /** O resumo público de uma mesa, com `mine`: quem pede tem lugar nela (nela, as mãos dos outros nunca aparecem). */
  const publicSummary = (req: FastifyRequest, table: YonkoTable) => ({ ...table.summary(), mine: table.isPlayer(viewerHash(req), user(req)?.id ?? null) });

  /**
   * Mesas para assistir: as que quem criou abriu (as outras, só com o código). `hands`: quem pede pode ligar
   * "Ver mãos" (nas mesas que as liberaram).
   */
  app.get('/api/yonko/live', async (req) => ({ tables: tables.live().map((t) => publicSummary(req, t)), hands: seesHands(user(req)?.role) }));

  /** Mesa pelo código, para assistir (em espera, em andamento ou terminada). */
  app.get<{ Params: { code: string } }>('/api/yonko/watch/:code', async (req, res) => {
    const table = /^[A-Za-z0-9]{6}$/.test(req.params.code) ? tables.byCode(req.params.code) : null;
    if (!table) return res.code(404).send(fail('yonkoCodeNotFound', 'Nenhuma mesa com esse código.'));
    return publicSummary(req, table);
  });

  /** Resumo de uma mesa (o espectador confere se ela ainda existe antes de reconectar). */
  app.get<{ Params: { id: string } }>('/api/yonko/tables/:id', async (req, res) => {
    const table = tables.get(req.params.id);
    return table ? publicSummary(req, table) : res.code(404).send(fail('yonkoNotFound', 'Mesa não encontrada.'));
  });

  /**
   * Canal do espectador (SSE): a mesa sem a mão de ninguém. `hands=1`: as mãos de todos (perfil Streamer,
   * Organizador ou Admin, só na mesa que as liberou e nunca na própria), na mesa atrasada. `k`: tela de
   * transmissão; a chave faz as vezes do login e as opções do streamer decidem o que a conexão vê
   * (`yonkoBroadcastView`). Vale em qualquer momento da mesa: na espera chega só a sala, e a partida aparece
   * quando começar (a transmissão segue sozinha para o "jogar de novo").
   */
  app.get<{ Params: { id: string }; Querystring: { hands?: string; k?: string } }>('/api/yonko/tables/:id/watch', (req, res) => {
    const table = tables.get(req.params.id);
    if (!table) return res.code(404).send(fail('yonkoNotFound', 'Mesa não encontrada.'));
    let watch: YonkoWatch = {};
    if (req.query.k !== undefined) {
      const found = broadcastByKey(db, String(req.query.k));
      if (!found || !seesHands(found.user.role)) return res.code(403).send(fail('broadcastNotFound', 'Link de transmissão inválido. Copie o link de novo no app.'));
      watch = yonkoBroadcastView(found.broadcast, table, found.user);
    } else if (req.query.hands === '1') {
      const account = user(req);
      if (!account || !seesHands(account.role)) return res.code(403).send(fail('handsForbidden', 'Ver as mãos é só para streamers, organizadores e administradores.'));
      if (!table.data.showHands) return res.code(403).send(fail('yonkoHandsClosed', 'As mãos dos jogadores só aparecem nas mesas em que quem criou as liberou.'));
      if (table.isPlayer(accountOwnerKey(account.id), account.id) || table.isPlayer(viewerHash(req), null)) {
        return res.code(403).send(fail('handsOwnMatch', 'Você está jogando esta partida: não dá para assisti-la vendo as mãos.'));
      }
      watch = { hands: true, delay: handsDelayFor(db, account.id, { minHandsDelay: MIN_HANDS_DELAY_MS }) };
    }
    if (table.spectators >= MAX_SPECTATORS) return res.code(429).send(fail('tooManySpectators', 'Esta partida já tem espectadores demais.'));
    stream(req, res, table, { token: null, watch }, `${table.id}:watch`);
  });

  type Body = { t?: unknown; [k: string]: unknown };
  /** A mesa de um pedido (pelo id e pelo token do corpo). */
  const found = (id: string, body: Body | undefined): YonkoTable | Refusal => {
    const table = tables.get(id);
    if (!table || table.seatOfToken(body?.t) === null) return refusal(404, 'yonkoNotFound', 'Mesa não encontrada.');
    return table;
  };

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/deck', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    const deck = tableDeck(req.body?.deckId);
    if (isRefusal(deck)) return reply(res, deck);
    return reply(res, table.setDeck(req.body.t, deck));
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/ready', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    return reply(res, table.setReady(req.body.t, req.body.ready));
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/rules', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    return reply(res, table.setRules(req.body.t, req.body.rules));
  });

  /** Quem criou a mesa a abre em "Assistir partidas" (`listed`) e libera as mãos para quem transmite (`showHands`). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/options', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    return reply(res, table.setOptions(req.body.t, req.body));
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/bot', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    if (table.seatOfToken(req.body.t) !== table.data.host) return reply(res, refusal(403, 'yonkoHostOnly', 'Só quem criou a mesa pode fazer isso.'));
    const bot = botSeat(table);
    if (isRefusal(bot)) return reply(res, bot);
    return reply(res, table.addBot(req.body.t, req.body.seat, bot));
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/clear', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    return reply(res, table.clearSeat(req.body.t, req.body.seat));
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/start', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    return reply(res, table.start(req.body.t));
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/action', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    const r = table.act(req.body.t, req.body.seq, req.body.action);
    return reply(res, r, { ok: true, actionCount: r.ok ? r.actionCount : undefined });
  });

  /** Jogar de novo: quem criou a mesa a reabre, com os mesmos lugares, depois do fim. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/reopen', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    return reply(res, table.reopen(req.body.t));
  });

  /**
   * Sair: na espera, libera o lugar (sem mais ninguém, a mesa fecha); na partida, desiste (sai da mesa e
   * ela segue com os outros); depois do fim, só esquece o lugar.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/yonko/tables/:id/leave', async (req, res) => {
    const table = found(req.params.id, req.body);
    if (isRefusal(table)) return reply(res, table);
    if (table.status === 'waiting') {
      const r = table.leaveWaiting(req.body.t);
      if (r.ok && r.empty) tables.remove(table);
      return reply(res, r);
    }
    if (table.status === 'playing') {
      const p = table.playerOfToken(req.body.t);
      if (p !== null && !table.state?.players[p].out) {
        const r = table.act(req.body.t, null, { type: 'concede', player: p });
        if (!r.ok) return reply(res, r);
      }
    }
    return { ok: true };
  });

  return tables;
}
