// Rotas de partidas, perfil e estatísticas.

import { type Action, type CardData, type DeckList, type PlayerId, validateDeck } from '@gumgum/engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type DB, getCards } from '../db';
import type { ApiCard } from '../present';
import { FORMATS, type FormatId, isFormat, isQueue, isTier, QUEUES, TIERS, tierFor } from './catalog';
import { deriveMatch } from './derive';
import {
  cardStats,
  findPlayer,
  leaderStats,
  matchupStats,
  myDecks,
  type Player,
  recordMatch,
  renamePlayer,
  type SeatInput,
  type StatsFilter,
  statsDimensions,
  summary,
  trendStats,
} from './store';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  present: (cards: ApiCard[]) => ApiCard[];
}

export interface MatchBody {
  mode?: unknown;
  format?: unknown;
  seed?: unknown;
  firstPlayer?: unknown;
  deckIds?: unknown;
  decks?: unknown;
  actions?: unknown;
}

type Query = Record<string, string | undefined>;

const profile = (p: Player) => ({ ...p, tier: tierFor(p.bounty).id });

function parseDeck(v: unknown): DeckList | null {
  const d = v as Partial<DeckList> | null;
  if (!d || typeof d.leader !== 'string' || !Array.isArray(d.cards) || d.cards.length > 60) return null;
  const cards = d.cards.filter((c) => typeof c?.id === 'string' && Number.isInteger(c.count) && c.count > 0 && c.count <= 50);
  if (cards.length !== d.cards.length) return null;
  return { id: String(d.id ?? ''), name: String(d.name ?? '').slice(0, 60), leader: d.leader, cards };
}

export function registerStatsRoutes(app: FastifyInstance, { db, viewerHash, present }: Deps) {
  /** Nome, cores e imagem das cartas citadas numa resposta. */
  const cardInfo = (ids: Iterable<string>) => {
    const out: Record<string, { name: string; category: string; colors: string[]; imageUrl?: string }> = {};
    for (const c of present(getCards(db, [...new Set(ids)]))) {
      out[c.id] = { name: c.name, category: c.category, colors: c.colors, imageUrl: c.imageUrl };
    }
    return out;
  };

  /**
   * Resultado de uma partida jogada no navegador (contra o bot ou bot x bot).
   * O servidor refaz a partida a partir do replay e só grava o que a simulação
   * confirma. Sempre casual: a ranqueada será gravada pelo servidor de partidas
   * online (com `recordMatch`), nunca a partir do que o navegador envia.
   */
  app.post<{ Body: MatchBody }>('/api/matches', async (req, reply) => {
    const b = req.body;
    const mode = b?.mode === 'demo' ? 'demo' : 'bot';
    const format: FormatId = isFormat(b?.format) ? b.format : 'standard';
    const decks = Array.isArray(b?.decks) ? b.decks.map(parseDeck) : [];
    if (typeof b?.seed !== 'number' || !Array.isArray(b.actions) || decks.length !== 2 || decks.some((d) => !d)) {
      return reply.code(400).send({ error: 'Dados de partida inválidos' });
    }
    const pair = decks as [DeckList, DeckList];
    const cards = getCards(db, [...new Set(pair.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))]) as CardData[];
    const byId = new Map(cards.map((c) => [c.id, c]));
    if (pair.some((d) => !validateDeck(d, byId).valid)) return reply.code(400).send({ error: 'Deck inválido.' });

    const firstPlayer = b.firstPlayer === 0 || b.firstPlayer === 1 ? (b.firstPlayer as PlayerId) : undefined;
    const replay = { seed: b.seed, firstPlayer, decks: pair, actions: b.actions as Action[] };
    let facts;
    try {
      facts = deriveMatch(replay, cards);
    } catch (e) {
      return reply.code(422).send({ error: `Replay não confere: ${e instanceof Error ? e.message : String(e)}` });
    }

    const owner = viewerHash(req);
    const deckIds = Array.isArray(b.deckIds) ? b.deckIds.map((d) => (typeof d === 'string' ? d.slice(0, 64) : null)) : [];
    const seat = (p: PlayerId): SeatInput => {
      const human = mode === 'bot' && p === 0 && owner !== null;
      return { controller: human ? 'human' : 'bot', ownerHash: human ? owner : null, deckId: deckIds[p] ?? null };
    };
    const id = recordMatch(db, { mode, format, queue: 'casual', replay, seats: [seat(0), seat(1)] }, facts);
    return { id, winner: facts.winner, turns: facts.turns };
  });

  app.get('/api/players/me', async (req) => {
    const owner = viewerHash(req);
    const p = owner ? findPlayer(db, owner) : null;
    return p ? profile(p) : null;
  });

  app.put<{ Body: { name?: unknown } }>('/api/players/me', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send({ error: 'Navegador sem código de dono (header x-deck-owner).' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
    if (name.length < 2) return reply.code(400).send({ error: 'O nome precisa de pelo menos 2 letras.' });
    return profile(renamePlayer(db, owner, name));
  });

  /** Opções dos filtros: formatos, filas, tiers, Líderes com partidas e o perfil do jogador. */
  app.get('/api/stats/meta', async (req) => {
    const owner = viewerHash(req);
    const me = owner ? findPlayer(db, owner) : null;
    const { leaders } = statsDimensions(db);
    const decks = me ? myDecks(db, me.id) : [];
    return {
      formats: FORMATS,
      queues: QUEUES,
      tiers: TIERS,
      leaders,
      me: me ? profile(me) : null,
      myDecks: decks,
      cards: cardInfo([...leaders.map((l) => l.leader), ...decks.map((d) => d.leader)]),
    };
  });

  const parseFilter = (req: FastifyRequest<{ Querystring: Query }>): StatsFilter => {
    const q = req.query;
    const owner = viewerHash(req);
    const days = Number(q.days);
    const filter: StatsFilter = {
      by: q.by === 'bot' ? 'bot' : 'human',
      format: isFormat(q.format) ? q.format : undefined,
      queue: isQueue(q.queue) ? q.queue : undefined,
      opponent: q.opponent === 'bot' || q.opponent === 'human' ? q.opponent : undefined,
      tiers: q.tiers?.split(',').filter(isTier),
      leader: q.leader || undefined,
      oppLeader: q.oppLeader || undefined,
      first: q.first === 'first' ? true : q.first === 'second' ? false : undefined,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      deckHash: q.deck || undefined,
    };
    if (q.mine === '1') {
      // Sem perfil ainda: nenhum resultado (id que nunca existe).
      filter.playerId = (owner && findPlayer(db, owner)?.id) || '-';
    }
    return filter;
  };

  /** Visão geral: totais, Líderes e matchups. */
  app.get<{ Querystring: Query }>('/api/stats', async (req) => {
    const f = parseFilter(req);
    const leaders = leaderStats(db, f);
    const matchups = matchupStats(db, f);
    return {
      summary: summary(db, f),
      leaders,
      matchups,
      cards: cardInfo([...leaders.map((l) => l.leader), ...matchups.map((m) => m.oppLeader)]),
    };
  });

  /** Tendência semanal: uso e vitórias por Líder nas últimas semanas (padrão 6, máximo 26). */
  app.get<{ Querystring: Query }>('/api/stats/trend', async (req) => {
    const weeks = Math.min(26, Math.max(2, Math.floor(Number(req.query.weeks) || 6)));
    const t = trendStats(db, parseFilter(req), weeks);
    return { ...t, cards: cardInfo(t.rows.map((r) => r.leader)) };
  });

  /** Cartas de um Líder (ou de uma lista): efetividade no deck, na mão inicial, compradas e jogadas. */
  app.get<{ Querystring: Query }>('/api/stats/cards', async (req, reply) => {
    const f = parseFilter(req);
    if (!f.leader && !f.deckHash) return reply.code(400).send({ error: 'Escolha um Líder ou uma lista.' });
    const rows = cardStats(db, f);
    return { summary: summary(db, f), rows, cards: cardInfo(rows.map((r) => r.cardId).concat(f.leader ?? [])) };
  });
}
