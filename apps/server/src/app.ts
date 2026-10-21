import fastifyStatic from '@fastify/static';
import {
  artImage,
  automationStatus,
  type CardData,
  cleanArts,
  type DeckList,
  FORMATS,
  type FormatId,
  formatIssues,
  parseArts,
  spoilerCards,
  validateDeck,
  registerCardCdn,
} from '@gumgum/engine';
import Fastify from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { type GoogleKeys, googleKeyStore } from './auth/google';
import { registerAuth } from './auth/routes';
import { accountOwnerKey, isAdmin, type User } from './auth/store';
import { type ServerOptions, serverOptions } from './config';
import { fail, isPlayerError, type PlayerError } from './errors';
import {
  type DB,
  deleteDeck,
  getCards,
  getDeck,
  getTranslations,
  listCards,
  listDecks,
  recentMatches,
  renameDeck,
  type StoredDeck,
  upsertDeck,
} from './db';
import { WEB_DIST } from './paths';
import { registerPartnerMatchRoutes } from './partners/matches';
import { registerOAuthRoutes } from './partners/oauth';
import { registerReplayLinkRoutes, replayLinkSecret } from './partners/replay-link';
import { isoToSqlite, sqliteToIso } from './partners/store';
import { registerBearerAuth, registerTokenRoutes } from './partners/tokens';
import { WebhookDispatcher } from './partners/webhook';
import { type ApiCard, presentCards } from './present';
import type { LobbyLimits } from './online/lobby';
import { registerOnlineRoutes } from './online/routes';
import { type PushSender, registerPushRoutes } from './push/routes';
import { vapidKeys } from './push/store';
import { deckHash } from './stats/derive';
import { registerStatsRoutes } from './stats/routes';
import { registerReportRoutes } from './reports/routes';
import { registerAccessGate } from './support/access';
import { apoiaseSyncHours, registerSupportRoutes, supportEnabled } from './support/routes';
import { registerTournamentRoutes } from './tournaments/routes';
import { registerEngineTextRoutes } from './card-engine-texts';
import { registerCardGapRoutes } from './card-gaps';
import { registerCardImageRoutes } from './card-images';
import { registerTutorialRoutes } from './tutorial/routes';
import { reportFromGame } from './tournaments/store';
import { currentSpoilerSet } from './spoiler-set';

/** Objeto sem as chaves `undefined` (para não sobrescrever os padrões num spread). */
const stripUndefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export function buildApp(
  db: DB,
  opts: {
    /** true = log padrão; um objeto vale como opções do pino (os testes passam um `stream`). */
    logger?: boolean | Record<string, unknown>;
    server?: ServerOptions;
    googleKeys?: GoogleKeys;
    /** Testes: relógio, limite de ações, atraso do bot e tetos de salas nas partidas online. */
    now?: () => number;
    onlineRateLimit?: number;
    botDelayMs?: number;
    onlineLimits?: Partial<LobbyLimits>;
    /** Testes: fetch usado na consulta do plano à produção (ACCESS=supporters). */
    fetchImpl?: typeof fetch;
    /** Testes: envio das notificações (sem ele, vai para o serviço de push de verdade). */
    pushSend?: PushSender;
    /** Testes: esperas entre as tentativas do webhook dos parceiros (ms). */
    webhookRetryMs?: number[];
  } = {},
) {
  // trustProxy: em produção o servidor fica atrás do Nginx.
  // redact: o header Authorization (tokens de parceiros) nunca vai para o log.
  const logger = opts.logger
    ? { ...(typeof opts.logger === 'object' ? opts.logger : {}), redact: ['req.headers.authorization', 'headers.authorization', 'authorization'] }
    : false;
  const app = Fastify({ logger, trustProxy: true });
  const server = opts.server ?? serverOptions;
  // Notificações: as chaves VAPID nascem no banco na primeira vez (ou vêm do ambiente).
  const pushKeys = server.push === false ? null : vapidKeys(db, server.vapidKeys);
  const present = (cards: ApiCard[]) =>
    presentCards(cards, getTranslations(db, 'pt', cards.length > 200 ? undefined : cards.map((c) => c.id)), server);

  // Nenhuma página vai para um iframe, menos o replay embutido (`/replay/<id>`, com as origens dos parceiros).
  app.addHook('onSend', async (_req, reply) => {
    if (reply.hasHeader('content-security-policy')) return;
    reply.header('x-frame-options', 'DENY').header('content-security-policy', "frame-ancestors 'none'");
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => ({
    cardImages: server.cardImages,
    /** CDN própria das imagens: o navegador a aceita no /card-img/ (kit de divulgação). */
    cardCdn: server.cardCdn ?? null,
    languages: ['pt', 'en'],
    googleClientId: server.googleClientId ?? null,
    /** O apoio está configurado: o item "Apoiar o projeto" aparece no menu. */
    support: supportEnabled(server.support),
    /** supporters: o site só abre para apoiadores (homologação). */
    access: server.access?.mode ?? 'open',
    /** Chave pública VAPID para o navegador se inscrever nas notificações (null = desligadas). */
    pushKey: pushKeys?.publicKey ?? null,
    /** Próxima coleção a ser lançada: a dos modos "+ spoilers" fora do Livre ("Standard + EB05"); null = nenhuma. */
    spoilerSet: currentSpoilerSet(db),
  }));

  app.get<{ Querystring: { set?: string } }>('/api/cards', async (req) => present(listCards(db, req.query.set)));

  app.get<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    const [card] = present(getCards(db, [req.params.id]));
    return card ?? reply.code(404).send(fail('cardNotFound', 'Carta não encontrada'));
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
  /** Tarefas depois do login (as rotas de apoio põem aqui a consulta à Apoia.se). */
  const afterLogin: Array<(user: User) => Promise<void>> = [];
  // API para parceiros: `Authorization: Bearer` vale como a conta dona do token (antes de todas as rotas).
  registerBearerAuth(app, { db, now: opts.now });
  const auth = registerAuth(app, {
    db,
    clientId: server.googleClientId ?? null,
    keys: opts.googleKeys ?? googleKeyStore(),
    browserHash,
    adminEmails: server.adminEmails,
    afterLogin,
  });
  // Homologação só para apoiadores (ACCESS=supporters): antes de todas as outras rotas.
  registerAccessGate(app, { db, user: auth.viewer, access: server.access ?? { mode: 'open' }, fetchImpl: opts.fetchImpl, now: opts.now });

  /**
   * Dono dos decks e do perfil: a conta Google, se houver sessão; sem login, o
   * navegador. Só o dono edita/apaga os decks que criou.
   */
  const viewerHash = (req: FastifyRequest): string | null => {
    const user = auth.viewer(req);
    return user ? accountOwnerKey(user.id) : browserHash(req);
  };
  const notifier = registerPushRoutes(app, {
    db,
    browserHash,
    user: auth.viewer,
    keys: pushKeys,
    subject: server.vapidSubject ?? 'https://gumgumfight.app',
    send: opts.pushSend,
    log: (msg) => app.log.warn(msg),
  });
  const isMine = (deck: StoredDeck, viewer: string | null) =>
    deck.kind === 'user' && deck.ownerHash !== null && deck.ownerHash === viewer;
  /** Avisos "partida terminada" aos apps vinculados (fase 3 da API para parceiros). */
  const webhooks = new WebhookDispatcher({ db, fetchImpl: opts.fetchImpl, log: (msg) => app.log.warn(msg), retryMs: opts.webhookRetryMs });
  app.decorate('webhooks', webhooks);
  const publicDeck = ({ ownerHash: _hidden, ...deck }: StoredDeck) => deck;

  /** Deck com resumo de validação (usado nas listas). */
  const summarize = (deck: StoredDeck, cards: Map<string, CardData>, viewer: string | null) => {
    const report = validateDeck(deck, cards);
    const leader = cards.get(deck.leader);
    const byFormat = FORMATS.map((f) => [f.id, formatIssues(deck, f.id)] as const);
    return {
      id: deck.id,
      name: deck.name,
      kind: deck.kind,
      leader: deck.leader,
      leaderName: leader?.name ?? null,
      leaderImage: (server.cardImages && leader && artImage(leader, deck.arts?.[leader.id])) || null,
      colors: leader?.colors ?? [],
      size: report.total,
      valid: report.valid,
      errors: report.issues.filter((i) => i.level === 'error').map((i) => i.message),
      /** Por formato: o que impede o deck de ser usado nele (vazio = permitido). */
      formats: Object.fromEntries(byFormat.map(([id, issues]) => [id, issues.map((i) => i.message)])) as Record<FormatId, string[]>,
      /** Os mesmos motivos, na mesma ordem, com a chave de tradução (`rules.…`) e os parâmetros. */
      formatCodes: Object.fromEntries(byFormat.map(([id, issues]) => [id, issues.map(({ code, params }) => ({ code, params }))])) as Record<
        FormatId,
        Array<{ code: string; params: Record<string, string | number> }>
      >,
      unscripted: report.unscripted.length,
      /** Cartas de spoiler (ainda não lançadas): o deck não vale na ranqueada nem em torneio sem spoilers. */
      spoilers: spoilerCards(deck, cards),
      updatedAt: deck.updatedAt,
      /** Hash da lista exata (o mesmo de `deckHash` nas partidas), para parceiros casarem deck e partida. */
      deckHash: deckHash(deck),
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

  /** `mine=1`: só os decks de quem pede (conta ou navegador). */
  app.get<{ Querystring: { mine?: string } }>('/api/decks', { config: { scope: 'decks:read' } }, async (req) => {
    const viewer = viewerHash(req);
    const decks = req.query.mine === '1' ? listDecks(db).filter((d) => isMine(d, viewer)) : listDecks(db);
    const cards = cardsFor(decks);
    return decks.map((d) => summarize(d, cards, viewer));
  });

  /** Deck + definições de todas as cartas usadas (o que o cliente precisa para jogar). Com token, só os próprios e os prontos. */
  app.get<{ Params: { id: string } }>('/api/decks/:id', { config: { scope: 'decks:read' } }, async (req, reply) => {
    const deck = getDeck(db, req.params.id);
    if (!deck) return reply.code(404).send(fail('deckNotFound', 'Deck não encontrado'));
    const viewer = viewerHash(req);
    if (req.apiAuth && deck.kind === 'user' && !isMine(deck, viewer)) return reply.code(403).send(fail('deckNotMine', 'Este deck pertence a outro jogador.'));
    const cards = present(getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]));
    const summary = summarize(deck, new Map(cards.map((c) => [c.id, c])), viewer);
    return { deck: { ...publicDeck(deck), mine: summary.mine }, cards, summary };
  });

  type DeckBody = { name?: unknown; leader?: unknown; cards?: unknown; arts?: unknown; expectedUpdatedAt?: unknown };
  const parseDeckBody = (b: DeckBody | undefined): Omit<DeckList, 'id'> | PlayerError => {
    if (!b || typeof b !== 'object') return fail('invalidBody', 'Corpo inválido.');
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
    if (!name) return fail('deckNameRequired', 'Dê um nome ao deck.');
    const leader = typeof b.leader === 'string' ? b.leader.trim().toUpperCase() : '';
    if (!Array.isArray(b.cards) || b.cards.length > 60) return fail('invalidCardList', 'Lista de cartas inválida.');
    const cards: DeckList['cards'] = [];
    for (const c of b.cards as Array<{ id?: unknown; count?: unknown }>) {
      if (typeof c?.id !== 'string' || !Number.isInteger(c.count) || (c.count as number) < 1 || (c.count as number) > 50) {
        return fail('invalidCardList', 'Lista de cartas inválida.');
      }
      cards.push({ id: c.id.trim().toUpperCase(), count: c.count as number });
    }
    const deck = { name, leader, cards, arts: parseArts(b.arts) };
    // Só as artes que existem, das cartas que estão no deck.
    const arts = cleanArts(deck, cardsFor([{ id: '', ...deck }]));
    return { name, leader, cards, ...(arts ? { arts } : {}) };
  };

  // Decks incompletos podem ser salvos (rascunho); só decks válidos aparecem para jogar.
  app.post<{ Body: DeckBody }>('/api/decks', { config: { scope: 'decks:write' } }, async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    const parsed = parseDeckBody(req.body);
    if (isPlayerError(parsed)) return reply.code(400).send(parsed);
    const deck = { id: `u-${randomUUID().slice(0, 8)}`, ...parsed };
    upsertDeck(db, deck, 'user', owner);
    const stored = getDeck(db, deck.id)!;
    return reply.code(201).send(summarize(stored, cardsFor([stored]), owner));
  });

  /**
   * Detecção de conflito (apps que sincronizam decks): com `If-Unmodified-Since` ou
   * `expectedUpdatedAt` no corpo, um deck alterado no site depois dessa data responde 409
   * `deck_conflict` com a versão atual, em vez de sobrescrevê-la.
   */
  app.put<{ Params: { id: string }; Body: DeckBody }>('/api/decks/:id', { config: { scope: 'decks:write' } }, async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send(fail('deckNotFound', 'Deck não encontrado'));
    if (existing.kind !== 'user') return reply.code(403).send(fail('builtinDeckReadOnly', 'Decks prontos não podem ser alterados; duplique-o.'));
    const viewer = viewerHash(req);
    if (!isMine(existing, viewer)) {
      return reply.code(403).send(fail('deckNotMineEdit', 'Este deck pertence a outro jogador; duplique-o para editar.'));
    }
    const expectedRaw = req.body?.expectedUpdatedAt ?? req.headers['if-unmodified-since'];
    if (expectedRaw !== undefined) {
      const expected = isoToSqlite(expectedRaw);
      if (!expected) return reply.code(400).send(fail('invalidExpectedUpdatedAt', 'expectedUpdatedAt inválido (use ISO 8601).'));
      if (existing.updatedAt > expected) {
        const current = summarize(existing, cardsFor([existing]), viewer);
        return reply.code(409).send({
          ...fail('deck_conflict', 'O deck foi alterado no GumGum Fight depois da versão que você tem.'),
          current: { ...publicDeck(existing), updatedAt: sqliteToIso(existing.updatedAt), summary: current },
        });
      }
    }
    const parsed = parseDeckBody(req.body);
    if (isPlayerError(parsed)) return reply.code(400).send(parsed);
    upsertDeck(db, { id: existing.id, ...parsed }, 'user');
    const stored = getDeck(db, existing.id)!;
    return summarize(stored, cardsFor([stored]), viewer);
  });

  /** Só o nome: o dono ou um admin/dev (que corrige o nome de decks de outros jogadores). */
  app.put<{ Params: { id: string }; Body: { name?: unknown } }>('/api/decks/:id/name', async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send(fail('deckNotFound', 'Deck não encontrado'));
    if (existing.kind !== 'user') return reply.code(403).send(fail('builtinDeckReadOnly', 'Decks prontos não podem ser alterados; duplique-o.'));
    const viewer = viewerHash(req);
    if (!isMine(existing, viewer) && !isAdmin(auth.viewer(req)?.role)) {
      return reply.code(403).send(fail('deckNotMineEdit', 'Este deck pertence a outro jogador; duplique-o para editar.'));
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!name) return reply.code(400).send(fail('deckNameRequired', 'Dê um nome ao deck.'));
    renameDeck(db, existing.id, name);
    const stored = getDeck(db, existing.id)!;
    return summarize(stored, cardsFor([stored]), viewer);
  });

  app.delete<{ Params: { id: string } }>('/api/decks/:id', { config: { scope: 'decks:write' } }, async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send(fail('deckNotFound', 'Deck não encontrado'));
    if (existing.kind !== 'user') return reply.code(403).send(fail('builtinDeckNoDelete', 'Decks prontos não podem ser apagados.'));
    if (!isMine(existing, viewerHash(req))) {
      return reply.code(403).send(fail('deckNotMine', 'Este deck pertence a outro jogador.'));
    }
    deleteDeck(db, existing.id);
    return reply.code(204).send();
  });

  registerStatsRoutes(app, { db, viewerHash, user: auth.viewer, present, proGate: supportEnabled(server.support), onMatch: (id) => webhooks.matchFinished(id) });
  registerPartnerMatchRoutes(app, { db, user: auth.viewer });
  registerTokenRoutes(app, { db, user: auth.viewer });
  const sendIndex = existsSync(WEB_DIST) ? (reply: FastifyReply) => reply.sendFile('index.html') : undefined;
  registerOAuthRoutes(app, { db, user: auth.viewer, now: opts.now, sendIndex });
  registerReplayLinkRoutes(app, {
    db,
    user: auth.viewer,
    present,
    origins: server.replayEmbedOrigins ?? [],
    secret: replayLinkSecret(db, server.replayLinkSecret),
    now: opts.now,
    sendIndex,
  });
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
    onMatch: (id) => webhooks.matchFinished(id),
    notifier,
  });
  // Exposto para os testes (o estado das salas fica só na memória do servidor).
  app.decorate('onlineLobby', lobby);
  // Com relógio injetado (testes), o relógio dos torneios não roda sozinho: os testes chamam `app.tournamentTick()`.
  registerTournamentRoutes(app, { db, user: auth.viewer, present, lobby, cardImages: server.cardImages, now: opts.now, tickMs: opts.now ? 0 : undefined, notifier });

  // Imagens das cartas pelo mesmo domínio (kit de divulgação; em produção o Nginx atende antes).
  // A CDN própria entra como origem "cdn" do /card-img/ (e das URLs reescritas do kit de divulgação).
  registerCardCdn(server.cardCdn);
  registerCardImageRoutes(app, { enabled: server.cardImages, fetchImpl: opts.fetchImpl });
  registerCardGapRoutes(app, { db, user: auth.viewer });
  registerEngineTextRoutes(app, { db, user: auth.viewer });

  registerReportRoutes(app, { db, user: auth.viewer, notifier });
  registerSupportRoutes(app, {
    db,
    user: auth.viewer,
    options: server.support ?? {},
    afterLogin,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    syncHours: opts.now ? 0 : apoiaseSyncHours(),
  });
  registerTutorialRoutes(app, { db, viewerHash, user: auth.viewer, now: opts.now });

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
    // Arquivo de /assets que não existe é 404, nunca a página: depois de um deploy, a aba aberta
    // na versão anterior pede arquivos que já saíram, e HTML no lugar de JS quebra a tela (e o
    // service worker o guardaria no cache no lugar do arquivo).
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.url.startsWith('/assets/')
        ? reply.code(404).send(fail('notFound', 'Não encontrado'))
        : reply.sendFile('index.html'),
    );
  }

  return app;
}
