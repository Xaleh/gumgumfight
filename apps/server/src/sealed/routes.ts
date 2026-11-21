// Rotas do Selado (Pré-release): o jogador abre 6 boosters de uma coleção, monta um deck de 40
// com o que saiu e joga com ele (contra o bot ou numa sala privada, pelas rotas de `online/`,
// com `format: 'sealed'` e o id da coleção aberta no lugar do deck).
//
//   GET    /api/sealed/sets              coleções em que dá para abrir boosters
//   GET    /api/sealed/pools             as coleções abertas de quem pede (resumo)
//   POST   /api/sealed/pools             { set } abre 6 boosters de uma coleção; { sets: [...] } abre um Pack Rush
//   GET    /api/sealed/pools/:id         os boosters e o deck
//   PUT    /api/sealed/pools/:id/deck    { leader, cards } salva o deck (mesmo incompleto)
//   DELETE /api/sealed/pools/:id
//   POST   /api/sealed/pools/:id/bot     deck do bot para o treino no navegador (ele abre os próprios boosters)
//
// Dono = conta ou navegador (`viewerHash`), como nos decks. Não exige login.

import { type DeckList, LIMITED_DECK_SIZE, RUSH_MAX_SETS, RUSH_MIN_SETS, SEALED_PACKS } from '@gumgum/engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DB } from '../db';
import { fail } from '../errors';
import { botDeck, checkDeck, createPool, deletePool, getPool, listPools, saveDeck, type SealedPool, sealedSets } from './store';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
}

/** Aberturas por dono a cada 10 minutos: abrir é barato, mas não é para sortear até sair a carta desejada. */
const OPENS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60_000;

function parseDeck(body: unknown): Pick<DeckList, 'leader' | 'cards'> | null {
  const b = body as { leader?: unknown; cards?: unknown } | undefined;
  if (!b || typeof b.leader !== 'string' || !Array.isArray(b.cards) || b.cards.length > 200) return null;
  const cards: DeckList['cards'] = [];
  for (const c of b.cards as Array<{ id?: unknown; count?: unknown }>) {
    if (typeof c?.id !== 'string' || !Number.isInteger(c.count) || (c.count as number) < 1 || (c.count as number) > 99) return null;
    cards.push({ id: c.id.toUpperCase(), count: c.count as number });
  }
  return { leader: b.leader.toUpperCase(), cards };
}

export function registerSealedRoutes(app: FastifyInstance, { db, viewerHash }: Deps) {
  const noOwner = fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).');

  /** Resumo para as listas: o deck e o que falta para jogar. */
  const summary = (pool: SealedPool) => {
    const report = pool.deck ? checkDeck(db, pool, pool.deck) : null;
    return {
      id: pool.id,
      set: pool.set,
      createdAt: pool.createdAt,
      updatedAt: pool.updatedAt,
      wins: pool.wins,
      losses: pool.losses,
      /** Deck de Draft (as cartas foram escolhidas num pod). */
      draft: Boolean(pool.podId),
      leader: pool.deck?.leader || null,
      size: report?.total ?? 0,
      /** Deck completo e conferido: dá para jogar. */
      ready: Boolean(report?.valid),
    };
  };
  const full = (pool: SealedPool) => {
    const report = pool.deck ? checkDeck(db, pool, pool.deck) : null;
    return {
      ...summary(pool),
      packs: pool.packs,
      /** A coleção de cada booster (no Pack Rush elas variam). */
      packSets: pool.packSets,
      deck: pool.deck,
      issues: (report?.issues ?? []).map(({ level, message, code, params, cardId }) => ({ level, message, code, params, ...(cardId ? { cardId } : {}) })),
    };
  };
  /** A coleção aberta do dono que pede, ou null (não existe ou é de outra pessoa: a mesma resposta). */
  const mine = (req: FastifyRequest, id: string): SealedPool | null => {
    const owner = viewerHash(req);
    const pool = owner ? getPool(db, id) : null;
    return pool && pool.ownerHash === owner ? pool : null;
  };
  const notFound = fail('sealedPoolNotFound', 'Coleção do Selado não encontrada.');

  app.get('/api/sealed/sets', async () => ({
    packs: SEALED_PACKS,
    deckSize: LIMITED_DECK_SIZE,
    /** Pack Rush: quantas coleções dá para escolher. */
    rush: { min: RUSH_MIN_SETS, max: RUSH_MAX_SETS },
    sets: sealedSets(db),
  }));

  app.get('/api/sealed/pools', async (req) => {
    const owner = viewerHash(req);
    return owner ? listPools(db, owner).map(summary) : [];
  });

  const opens = new Map<string, { start: number; n: number }>();
  app.post<{ Body: { set?: unknown; sets?: unknown } }>('/api/sealed/pools', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(noOwner);
    // `sets` (Pack Rush): as coleções escolhidas; `set`: uma só.
    const list = Array.isArray(req.body?.sets) ? req.body.sets.filter((s): s is string => typeof s === 'string') : null;
    if (list && [...new Set(list.map((s) => s.toUpperCase()))].length < RUSH_MIN_SETS) {
      return reply.code(400).send(fail('sealedRushFewSets', `O Pack Rush precisa de pelo menos ${RUSH_MIN_SETS} coleções.`, { n: RUSH_MIN_SETS }));
    }
    if (list && list.length > RUSH_MAX_SETS) {
      return reply.code(400).send(fail('sealedRushManySets', `O Pack Rush aceita até ${RUSH_MAX_SETS} coleções.`, { n: RUSH_MAX_SETS }));
    }
    const set = typeof req.body?.set === 'string' ? req.body.set : '';
    const sets = list ?? [set];
    const now = Date.now();
    const w = opens.get(owner);
    if (!w || now - w.start > WINDOW_MS) opens.set(owner, { start: now, n: 1 });
    else if (++w.n > OPENS_PER_WINDOW) return reply.code(429).send(fail('sealedTooManyOpens', 'Muitas aberturas em pouco tempo. Tente de novo em alguns minutos.'));
    if (opens.size > 5000) for (const [k, v] of opens) if (now - v.start > WINDOW_MS) opens.delete(k);
    const pool = createPool(db, owner, sets);
    if (!pool) return reply.code(400).send(fail('sealedSetUnavailable', 'Essa coleção não está disponível no Selado.', { set: sets.join(' + ').toUpperCase() }));
    return reply.code(201).send(full(pool));
  });

  app.get<{ Params: { id: string } }>('/api/sealed/pools/:id', async (req, reply) => {
    const pool = mine(req, req.params.id);
    return pool ? full(pool) : reply.code(404).send(notFound);
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/sealed/pools/:id/deck', async (req, reply) => {
    const pool = mine(req, req.params.id);
    if (!pool) return reply.code(404).send(notFound);
    const deck = parseDeck(req.body);
    if (!deck) return reply.code(400).send(fail('sealedDeckInvalid', 'Deck inválido.'));
    // Deck incompleto pode ser salvo (o jogador continua depois); carta que não saiu nos boosters, não.
    const errors = checkDeck(db, pool, deck).issues.filter((i) => i.level === 'error' && !['rules.tooFewCards', 'rules.pickLeader'].includes(i.code));
    // O motivo que mais ajuda primeiro: a carta que não saiu, antes de "o deck passou de 40".
    const fromPool = ['rules.notInPool', 'rules.poolCopies', 'rules.leaderNotInPool'];
    const blocking = errors.find((i) => fromPool.includes(i.code)) ?? errors[0];
    if (blocking) return reply.code(400).send(fail('sealedDeckNotFromPool', blocking.message, { issueCode: blocking.code, issueParams: blocking.params }));
    saveDeck(db, pool.id, deck);
    return full(getPool(db, pool.id)!);
  });

  app.delete<{ Params: { id: string } }>('/api/sealed/pools/:id', async (req, reply) => {
    const pool = mine(req, req.params.id);
    if (pool) deletePool(db, pool.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/sealed/pools/:id/bot', async (req, reply) => {
    const pool = mine(req, req.params.id);
    if (!pool) return reply.code(404).send(notFound);
    const deck = botDeck(db, pool.set, pool.podId);
    if (!deck) return reply.code(400).send(fail('sealedSetUnavailable', 'Essa coleção não está disponível no Selado.', { set: pool.set }));
    return { name: deck.name, leader: deck.leader, cards: deck.cards };
  });
}
