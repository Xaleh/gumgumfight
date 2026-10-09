import fastifyStatic from '@fastify/static';
import {
  automationStatus,
  type CardData,
  type DeckList,
  FORMATS,
  type FormatId,
  formatIssues,
  validateDeck,
} from '@gumgum/engine';
import Fastify from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { type GoogleKeys, googleKeyStore } from './auth/google';
import { registerAuth } from './auth/routes';
import { accountOwnerKey } from './auth/store';
import { type ServerOptions, serverOptions } from './config';
import {
  type DB,
  deleteDeck,
  getCards,
  getDeck,
  getTranslations,
  listCards,
  listDecks,
  recentMatches,
  type StoredDeck,
  upsertDeck,
} from './db';
import { WEB_DIST } from './paths';
import { type ApiCard, presentCards } from './present';
import type { LobbyLimits } from './online/lobby';
import { registerOnlineRoutes } from './online/routes';
import { registerStatsRoutes } from './stats/routes';
import { registerReportRoutes } from './reports/routes';
import { registerTournamentRoutes } from './tournaments/routes';
import { reportFromGame } from './tournaments/store';

/** Objeto sem as chaves `undefined` (para não sobrescrever os padrões num spread). */
const stripUndefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export function buildApp(
  db: DB,
  opts: {
    logger?: boolean;
    server?: ServerOptions;
    googleKeys?: GoogleKeys;
    /** Testes: relógio, limite de ações, atraso do bot e tetos de salas nas partidas online. */
    now?: () => number;
    onlineRateLimit?: number;
    botDelayMs?: number;
    onlineLimits?: Partial<LobbyLimits>;
  } = {},
) {
  // trustProxy: em produção o servidor fica atrás do Nginx.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const server = opts.server ?? serverOptions;
  const present = (cards: ApiCard[]) =>
    presentCards(cards, getTranslations(db, 'pt', cards.length > 200 ? undefined : cards.map((c) => c.id)), server);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => ({
    cardImages: server.cardImages,
    languages: ['pt', 'en'],
    googleClientId: server.googleClientId ?? null,
  }));

  app.get<{ Querystring: { set?: string } }>('/api/cards', async (req) => present(listCards(db, req.query.set)));

  app.get<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    const [card] = present(getCards(db, [req.params.id]));
    return card ?? reply.code(404).send({ error: 'Carta não encontrada' });
  });

  /**
   * Cobertura por coleção: quantas cartas têm efeito automatizado, quantas são
   * resolvidas com as ferramentas manuais e como está a tradução.
   */
  app.get('/api/coverage', async () => {
    const empty = (set: string) => ({ set, total: 0, vanilla: 0, scripted: 0, auto: 0, partial: 0, manual: 0, ptComplete: 0 });
    type Row = ReturnType<typeof empty>;
    const bySet = new Map<string, Row>();
    for (const c of present(listCards(db))) {
      const set = c.set ?? c.id.split('-')[0];
      const row = bySet.get(set) ?? empty(set);
      row.total++;
      row[automationStatus(c)]++;
      if (c.i18n?.pt?.source !== 'partial') row.ptComplete++;
      bySet.set(set, row);
    }
    const sets = [...bySet.values()].sort((a, b) => a.set.localeCompare(b.set, 'en', { numeric: true }));
    const total = empty('TOTAL');
    for (const r of sets) for (const k of Object.keys(total) as Array<keyof Row>) if (k !== 'set') total[k] += r[k];
    return { total, sets };
  });

  /** Cartas cuja tradução automática ficou parcial: lista de trabalho para revisão manual. */
  app.get('/api/translations/pending', async () =>
    present(listCards(db))
      .filter((c) => c.i18n?.pt?.source === 'partial')
      .map((c) => ({ id: c.id, name: c.name, text: c.text, trigger: c.trigger, auto: c.i18n?.pt })),
  );

  /**
   * Código do navegador: cada navegador gera um código aleatório e o envia no
   * header x-deck-owner. Só guardamos o hash.
   */
  const browserHash = (req: FastifyRequest): string | null => {
    const token = req.headers['x-deck-owner'];
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
    return createHash('sha256').update(token).digest('hex');
  };
  const auth = registerAuth(app, {
    db,
    clientId: server.googleClientId ?? null,
    keys: opts.googleKeys ?? googleKeyStore(),
    browserHash,
    adminEmails: server.adminEmails,
  });
  /**
   * Dono dos decks e do perfil: a conta Google, se houver sessão; sem login, o
   * navegador. Só o dono edita/apaga os decks que criou.
   */
  const viewerHash = (req: FastifyRequest): string | null => {
    const user = auth.viewer(req);
    return user ? accountOwnerKey(user.id) : browserHash(req);
  };
  const isMine = (deck: StoredDeck, viewer: string | null) =>
    deck.kind === 'user' && deck.ownerHash !== null && deck.ownerHash === viewer;
  const publicDeck = ({ ownerHash: _hidden, ...deck }: StoredDeck) => deck;

  /** Deck com resumo de validação (usado nas listas). */
  const summarize = (deck: StoredDeck, cards: Map<string, CardData>, viewer: string | null) => {
    const report = validateDeck(deck, cards);
    const leader = cards.get(deck.leader);
    return {
      id: deck.id,
      name: deck.name,
      kind: deck.kind,
      leader: deck.leader,
      leaderName: leader?.name ?? null,
      leaderImage: (server.cardImages && leader?.imageUrl) || null,
      colors: leader?.colors ?? [],
      size: report.total,
      valid: report.valid,
      errors: report.issues.filter((i) => i.level === 'error').map((i) => i.message),
      /** Por formato: o que impede o deck de ser usado nele (vazio = permitido). */
      formats: Object.fromEntries(FORMATS.map((f) => [f.id, formatIssues(deck, f.id).map((i) => i.message)])) as Record<
        FormatId,
        string[]
      >,
      unscripted: report.unscripted.length,
      updatedAt: deck.updatedAt,
      mine: isMine(deck, viewer),
    };
  };
  const cardsFor = (decks: DeckList[]) =>
    new Map(
      getCards(db, [...new Set(decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))].filter(Boolean)).map((c) => [
        c.id,
        c as CardData,
      ]),
    );

  app.get('/api/decks', async (req) => {
    const decks = listDecks(db);
    const cards = cardsFor(decks);
    const viewer = viewerHash(req);
    return decks.map((d) => summarize(d, cards, viewer));
  });

  /** Deck + definições de todas as cartas usadas (o que o cliente precisa para jogar). */
  app.get<{ Params: { id: string } }>('/api/decks/:id', async (req, reply) => {
    const deck = getDeck(db, req.params.id);
    if (!deck) return reply.code(404).send({ error: 'Deck não encontrado' });
    const cards = present(getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]));
    const summary = summarize(deck, new Map(cards.map((c) => [c.id, c])), viewerHash(req));
    return { deck: { ...publicDeck(deck), mine: summary.mine }, cards, summary };
  });

  type DeckBody = { name?: unknown; leader?: unknown; cards?: unknown };
  const parseDeckBody = (b: DeckBody | undefined): Omit<DeckList, 'id'> | string => {
    if (!b || typeof b !== 'object') return 'Corpo inválido.';
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
    if (!name) return 'Dê um nome ao deck.';
    const leader = typeof b.leader === 'string' ? b.leader.trim().toUpperCase() : '';
    if (!Array.isArray(b.cards) || b.cards.length > 60) return 'Lista de cartas inválida.';
    const cards: DeckList['cards'] = [];
    for (const c of b.cards as Array<{ id?: unknown; count?: unknown }>) {
      if (typeof c?.id !== 'string' || !Number.isInteger(c.count) || (c.count as number) < 1 || (c.count as number) > 50) {
        return 'Lista de cartas inválida.';
      }
      cards.push({ id: c.id.trim().toUpperCase(), count: c.count as number });
    }
    return { name, leader, cards };
  };

  // Decks incompletos podem ser salvos (rascunho); só decks válidos aparecem para jogar.
  app.post<{ Body: DeckBody }>('/api/decks', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send({ error: 'Navegador sem código de dono (header x-deck-owner).' });
    const parsed = parseDeckBody(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    const deck = { id: `u-${randomUUID().slice(0, 8)}`, ...parsed };
    upsertDeck(db, deck, 'user', owner);
    const stored = getDeck(db, deck.id)!;
    return reply.code(201).send(summarize(stored, cardsFor([stored]), owner));
  });

  app.put<{ Params: { id: string }; Body: DeckBody }>('/api/decks/:id', async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Deck não encontrado' });
    if (existing.kind !== 'user') return reply.code(403).send({ error: 'Decks prontos não podem ser alterados; duplique-o.' });
    const viewer = viewerHash(req);
    if (!isMine(existing, viewer)) {
      return reply.code(403).send({ error: 'Este deck pertence a outro jogador; duplique-o para editar.' });
    }
    const parsed = parseDeckBody(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    upsertDeck(db, { id: existing.id, ...parsed }, 'user');
    const stored = getDeck(db, existing.id)!;
    return summarize(stored, cardsFor([stored]), viewer);
  });

  app.delete<{ Params: { id: string } }>('/api/decks/:id', async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Deck não encontrado' });
    if (existing.kind !== 'user') return reply.code(403).send({ error: 'Decks prontos não podem ser apagados.' });
    if (!isMine(existing, viewerHash(req))) {
      return reply.code(403).send({ error: 'Este deck pertence a outro jogador.' });
    }
    deleteDeck(db, existing.id);
    return reply.code(204).send();
  });

  registerStatsRoutes(app, { db, viewerHash, present });
  const lobby = registerOnlineRoutes(app, {
    db,
    viewerHash,
    user: auth.viewer,
    present,
    now: opts.now,
    rateLimit: opts.onlineRateLimit,
    botRooms: server.onlineBotRooms ?? true,
    botDelayMs: opts.botDelayMs,
    limits: { ...stripUndefined(server.onlineLimits ?? {}), ...opts.onlineLimits },
    onTournamentGame: (game) => reportFromGame(db, game),
  });
  // Exposto para os testes (o estado das salas fica só na memória do servidor).
  app.decorate('onlineLobby', lobby);
  // Com relógio injetado (testes), o relógio dos torneios não roda sozinho: os testes chamam `app.tournamentTick()`.
  registerTournamentRoutes(app, { db, user: auth.viewer, present, lobby, cardImages: server.cardImages, now: opts.now, tickMs: opts.now ? 0 : undefined });

  registerReportRoutes(app, { db, user: auth.viewer });

  app.get('/api/matches', async () => recentMatches(db));

  // Em produção, o próprio servidor entrega a interface web compilada.
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, {
      root: WEB_DIST,
      // Arquivos de /assets têm hash no nome: podem ficar em cache por 1 ano.
      setHeaders: (res, path) => {
        if (/[\\/]assets[\\/]/.test(path)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        else res.setHeader('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Não encontrado' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
