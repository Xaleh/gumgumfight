import fastifyStatic from '@fastify/static';
import { type CardData, type DeckList, validateDeck } from '@gumgum/engine';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { type ServerOptions, serverOptions } from './config';
import {
  type DB,
  deleteDeck,
  getCards,
  getDeck,
  getTranslations,
  insertMatch,
  listCards,
  listDecks,
  type MatchRecord,
  recentMatches,
  type StoredDeck,
  upsertDeck,
} from './db';
import { WEB_DIST } from './paths';
import { type ApiCard, presentCards } from './present';

export function buildApp(db: DB, opts: { logger?: boolean; server?: ServerOptions } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  const server = opts.server ?? serverOptions;
  const present = (cards: ApiCard[]) =>
    presentCards(cards, getTranslations(db, 'pt', cards.length > 200 ? undefined : cards.map((c) => c.id)), server);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async () => ({ cardImages: server.cardImages, languages: ['pt', 'en'] }));

  app.get<{ Querystring: { set?: string } }>('/api/cards', async (req) => present(listCards(db, req.query.set)));

  app.get<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    const [card] = present(getCards(db, [req.params.id]));
    return card ?? reply.code(404).send({ error: 'Carta não encontrada' });
  });

  /** Cartas cuja tradução automática ficou parcial: lista de trabalho para revisão manual. */
  app.get('/api/translations/pending', async () =>
    present(listCards(db))
      .filter((c) => c.i18n?.pt?.source === 'partial')
      .map((c) => ({ id: c.id, name: c.name, text: c.text, trigger: c.trigger, auto: c.i18n?.pt })),
  );

  /** Deck com resumo de validação (usado nas listas). */
  const summarize = (deck: StoredDeck, cards: Map<string, CardData>) => {
    const report = validateDeck(deck, cards);
    const leader = cards.get(deck.leader);
    return {
      id: deck.id,
      name: deck.name,
      kind: deck.kind,
      leader: deck.leader,
      leaderName: leader?.name ?? null,
      colors: leader?.colors ?? [],
      size: report.total,
      valid: report.valid,
      errors: report.issues.filter((i) => i.level === 'error').map((i) => i.message),
      unscripted: report.unscripted.length,
      updatedAt: deck.updatedAt,
    };
  };
  const cardsFor = (decks: DeckList[]) =>
    new Map(
      getCards(db, [...new Set(decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))].filter(Boolean)).map((c) => [
        c.id,
        c as CardData,
      ]),
    );

  app.get('/api/decks', async () => {
    const decks = listDecks(db);
    const cards = cardsFor(decks);
    return decks.map((d) => summarize(d, cards));
  });

  /** Deck + definições de todas as cartas usadas (o que o cliente precisa para jogar). */
  app.get<{ Params: { id: string } }>('/api/decks/:id', async (req, reply) => {
    const deck = getDeck(db, req.params.id);
    if (!deck) return reply.code(404).send({ error: 'Deck não encontrado' });
    const cards = present(getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]));
    return { deck, cards, summary: summarize(deck, new Map(cards.map((c) => [c.id, c]))) };
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
    const parsed = parseDeckBody(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    const deck = { id: `u-${randomUUID().slice(0, 8)}`, ...parsed };
    upsertDeck(db, deck, 'user');
    const stored = getDeck(db, deck.id)!;
    return reply.code(201).send(summarize(stored, cardsFor([stored])));
  });

  app.put<{ Params: { id: string }; Body: DeckBody }>('/api/decks/:id', async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Deck não encontrado' });
    if (existing.kind !== 'user') return reply.code(403).send({ error: 'Decks prontos não podem ser alterados; duplique-o.' });
    const parsed = parseDeckBody(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    upsertDeck(db, { id: existing.id, ...parsed }, 'user');
    const stored = getDeck(db, existing.id)!;
    return summarize(stored, cardsFor([stored]));
  });

  app.delete<{ Params: { id: string } }>('/api/decks/:id', async (req, reply) => {
    const existing = getDeck(db, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Deck não encontrado' });
    if (existing.kind !== 'user') return reply.code(403).send({ error: 'Decks prontos não podem ser apagados.' });
    deleteDeck(db, existing.id);
    return reply.code(204).send();
  });

  app.post<{ Body: MatchRecord }>('/api/matches', async (req, reply) => {
    const b = req.body;
    if (!b || typeof b.seed !== 'number' || !b.deck0 || !b.deck1) {
      return reply.code(400).send({ error: 'Dados de partida inválidos' });
    }
    const id = insertMatch(db, {
      seed: b.seed,
      mode: String(b.mode ?? 'solo'),
      deck0: String(b.deck0),
      deck1: String(b.deck1),
      winner: b.winner ?? null,
      turns: Number(b.turns ?? 0),
      reason: b.reason ?? null,
    });
    return { id };
  });

  app.get('/api/matches', async () => recentMatches(db));

  // Em produção, o próprio servidor entrega a interface web compilada.
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Não encontrado' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
