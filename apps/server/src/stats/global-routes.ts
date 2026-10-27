// Rotas do meta global (TCG Matchmaking): só leem o que o sync guardou no banco (stats/global.ts).
//
//   GET  /api/stats/global?queue=                 Líderes da fila e a matriz dos mais jogados, no formato de /api/stats
//   GET  /api/stats/global/matchups?queue=&leader= todos os matchups de um Líder (a fila inteira teria milhares de pares)
//   GET  /api/stats/global/trend?queue=&weeks=    tendência semanal a partir dos resumos diários
//   GET  /api/stats/global/compare?queue=&format= o mesmo Líder aqui e lá
//   POST /api/admin/stats/global/sync             força uma rodada do sync (admin)
//
// Abertas a todo mundo (não exigem o plano): é dado público de outra comunidade; o que é nosso
// e caro de produzir (ranqueada, torneios, cartas) continua nas Estatísticas Pro.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isAdmin, type User } from '../auth/store';
import type { ResponseCache } from '../cache';
import type { DB } from '../db';
import { fail } from '../errors';
import { isFormat } from './catalog';
import { getGlobalSnapshot, type GlobalQueue, globalTrend, listGlobalQueues, type SyncResult } from './global';
import { leaderStats, type StatsFilter } from './store';

type CardInfo = Record<string, { name: string; category: string; colors: string[]; imageUrl?: string }>;

interface Deps {
  db: DB;
  cache: ResponseCache;
  /** Nome, cores e imagem das cartas citadas numa resposta. */
  cardInfo: (ids: Iterable<string>) => CardInfo;
  /** O recurso está ligado (chave configurada). */
  enabled: boolean;
  /** Filtro das nossas estatísticas que quem pede pode ver (geral ou Pro), para a comparação. */
  hereFilter: (req: FastifyRequest) => StatsFilter;
  /** Chave do cache: a rota, se quem pede vê as Pro. */
  cacheKey: (req: FastifyRequest) => string;
  ttlMs: number;
  user: (req: FastifyRequest) => User | null;
  /** Uma rodada do sync (undefined = sem chave). */
  sync?: () => Promise<SyncResult>;
}

type Query = Record<string, string | undefined>;

/** Líderes da matriz de matchups (os mais jogados; o mesmo tamanho da matriz da tela, `MATRIX_SIZE` em Stats.tsx). */
const MATRIX = 10;

export function registerGlobalStatsRoutes(app: FastifyInstance, { db, cache, cardInfo, enabled, hereFilter, cacheKey, ttlMs, user, sync }: Deps) {
  const off = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => reply.code(404).send(fail('globalOff', 'Meta global desligado neste servidor.'));

  /** A fila pedida, ou a primeira da lista. */
  const pickQueue = (key: string | undefined): GlobalQueue | null => {
    const queues = listGlobalQueues(db);
    return (key && queues.find((q) => q.key === key)) || queues[0] || null;
  };

  /** Nome e cores dos Líderes; quem não está no nosso banco fica com o nome que a API deu. */
  const infoFor = (ids: Iterable<string>, labels: Map<string, string>) => {
    const cards = cardInfo(ids);
    for (const [id, label] of labels) if (!cards[id]) cards[id] = { name: label, category: 'leader', colors: [] };
    return cards;
  };

  app.get<{ Querystring: Query }>('/api/stats/global', { config: { scope: 'stats:read' } }, async (req, reply) => {
    if (!enabled) return off(reply);
    return cache.send(req, reply, `${req.url}|global`, ttlMs, () => {
      const queues = listGlobalQueues(db);
      const queue = pickQueue(req.query.queue);
      const data = queue && getGlobalSnapshot(db, queue.key);
      if (!queue || !data) return { queue: null, queues, summary: null, leaders: [], matchups: [], cards: {} };
      const { leaders, matchups } = data.snapshot;
      const sum = (k: 'games' | 'wins' | 'firstGames' | 'firstWins' | 'secondGames' | 'secondWins') => leaders.reduce((n, l) => n + l[k], 0);
      // Uma fila grande tem mais de 4.000 pares (meio megabyte): aqui vai só a matriz; o resto sai por Líder.
      const top = new Set(leaders.slice(0, MATRIX).map((l) => l.leader));
      return {
        queue,
        queues,
        summary: {
          games: sum('games'),
          wins: sum('wins'),
          // Cada partida aparece nos dois Líderes.
          matches: Math.round(sum('games') / 2),
          players: 0,
          first: { games: sum('firstGames'), wins: sum('firstWins') },
          second: { games: sum('secondGames'), wins: sum('secondWins') },
          mulligan: { games: 0, wins: 0 },
          keep: { games: 0, wins: 0 },
        },
        leaders: leaders.map((l) => ({ ...l, lists: 0 })),
        matchups: matchups.filter((m) => top.has(m.leader) && top.has(m.oppLeader)),
        cards: infoFor(
          leaders.map((l) => l.leader),
          new Map(leaders.map((l) => [l.leader, l.label])),
        ),
      };
    });
  });

  /** Todos os matchups de um Líder da fila (a lista de adversários da tela). */
  app.get<{ Querystring: Query }>('/api/stats/global/matchups', { config: { scope: 'stats:read' } }, async (req, reply) => {
    if (!enabled) return off(reply);
    const leader = (req.query.leader ?? '').trim().toUpperCase();
    if (!leader) return reply.code(400).send(fail('chooseLeader', 'Escolha um Líder.'));
    return cache.send(req, reply, `${req.url}|global`, ttlMs, () => {
      const queue = pickQueue(req.query.queue);
      const data = queue && getGlobalSnapshot(db, queue.key);
      const matchups = data?.snapshot.matchups.filter((m) => m.leader === leader) ?? [];
      const labels = new Map(data?.snapshot.leaders.map((l) => [l.leader, l.label]) ?? []);
      return { queue, leader, matchups, cards: infoFor([leader, ...matchups.map((m) => m.oppLeader)], labels) };
    });
  });

  app.get<{ Querystring: Query }>('/api/stats/global/trend', { config: { scope: 'stats:read' } }, async (req, reply) => {
    if (!enabled) return off(reply);
    return cache.send(req, reply, `${req.url}|global`, ttlMs, () => {
      const queue = pickQueue(req.query.queue);
      if (!queue) return { queue: null, weeks: [], rows: [], since: null, cards: {} };
      const weeks = Math.min(26, Math.max(2, Math.floor(Number(req.query.weeks) || 6)));
      const t = globalTrend(db, queue.key, weeks);
      const labels = new Map(getGlobalSnapshot(db, queue.key)?.snapshot.leaders.map((l) => [l.leader, l.label]) ?? []);
      return { queue, ...t, cards: infoFor(t.rows.map((r) => r.leader), labels) };
    });
  });

  /**
   * Comparação: participação e vitórias de cada Líder nas nossas partidas (o que quem pede
   * pode ver, no formato da fila) e na fila deles. A participação é por lado (soma 100%).
   */
  app.get<{ Querystring: Query }>('/api/stats/global/compare', { config: { scope: 'stats:read' } }, async (req, reply) => {
    if (!enabled) return off(reply);
    const queue = pickQueue(req.query.queue);
    const format = isFormat(req.query.format) ? req.query.format : queue?.format;
    if (!queue || !format) return reply.code(400).send(fail('noFormat', 'Esta fila não tem um formato equivalente para comparar.'));
    return cache.send(req, reply, `${cacheKey(req)}|global`, ttlMs, () => {
      const data = getGlobalSnapshot(db, queue.key);
      const here = leaderStats(db, { ...hereFilter(req), format, leader: undefined, oppLeader: undefined });
      const hereBy = new Map(here.map((l) => [l.leader, l]));
      const globalBy = new Map(data?.snapshot.leaders.map((l) => [l.leader, l]) ?? []);
      const ids = [...new Set([...hereBy.keys(), ...globalBy.keys()])];
      const rows = ids
        .map((leader) => {
          const h = hereBy.get(leader);
          const g = globalBy.get(leader);
          return { leader, here: h ? { games: h.games, wins: h.wins } : null, global: g ? { games: g.games, wins: g.wins } : null };
        })
        .sort((a, b) => (b.here?.games ?? 0) + (b.global?.games ?? 0) - ((a.here?.games ?? 0) + (a.global?.games ?? 0)));
      return {
        queue,
        format,
        here: { games: here.reduce((n, l) => n + l.games, 0) },
        global: { games: data?.snapshot.leaders.reduce((n, l) => n + l.games, 0) ?? 0 },
        rows,
        cards: infoFor(ids, new Map(data?.snapshot.leaders.map((l) => [l.leader, l.label]) ?? [])),
      };
    });
  });

  app.post('/api/admin/stats/global/sync', async (req, reply) => {
    const me = user(req);
    if (!me) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    if (!isAdmin(me.role)) return reply.code(403).send(fail('adminOnly', 'Só para administradores.'));
    if (!enabled || !sync) return off(reply);
    return sync();
  });
}
