import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { type DB, getCards, getDeck, insertMatch, listCards, listDecks, type MatchRecord, recentMatches } from './db';
import { WEB_DIST } from './paths';

export function buildApp(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/api/health', async () => ({ ok: true }));

  app.get<{ Querystring: { set?: string } }>('/api/cards', async (req) => listCards(db, req.query.set));

  app.get<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    const [card] = getCards(db, [req.params.id]);
    return card ?? reply.code(404).send({ error: 'Carta não encontrada' });
  });

  app.get('/api/decks', async () =>
    listDecks(db).map((d) => ({ id: d.id, name: d.name, leader: d.leader, size: d.cards.reduce((s, c) => s + c.count, 0) })),
  );

  /** Deck + definições de todas as cartas usadas (o que o cliente precisa para jogar). */
  app.get<{ Params: { id: string } }>('/api/decks/:id', async (req, reply) => {
    const deck = getDeck(db, req.params.id);
    if (!deck) return reply.code(404).send({ error: 'Deck não encontrado' });
    const cards = getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]);
    return { deck, cards };
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
