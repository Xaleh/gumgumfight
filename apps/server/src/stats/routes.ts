// Rotas de partidas, perfil e estatísticas.

import { type Action, type CardData, countsInStats, type DeckList, formatLabel, parseArts, type PlayerId, REPLAY_VERSION, validateDeck } from '@gumgum/engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { seesProStats, type User } from '../auth/store';
import { ResponseCache } from '../cache';
import { type DB, getCards } from '../db';
import { fail } from '../errors';
import type { ApiCard } from '../present';
import { FORMATS, isFormat, isPlayFormat, isQueue, isTier, type PlayFormat, type QueueId, QUEUES, TIERS, tierFor } from './catalog';
import { deriveMatch } from './derive';
import { isApprentice } from '../tutorial/store';
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
  /** Conta logada (o plano de apoio decide entre as estatísticas gerais e as Pro). */
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  /**
   * As Estatísticas Pro exigem o plano (só quando o apoio está configurado no servidor;
   * sem ele, todo mundo vê tudo, como antes).
   */
  proGate: boolean;
  /** Chamado com o id de cada partida gravada (avisos "partida terminada" aos apps parceiros). */
  onMatch?: (matchId: number) => void;
}

/** Filas das estatísticas gerais (grátis): partidas casuais, treino contra o bot e salas privadas. */
export const FREE_QUEUES: QueueId[] = ['casual'];
/** Filas competitivas (Estatísticas Pro). */
export const PRO_QUEUES: QueueId[] = ['ranked', 'tournament'];
/** Abaixo disto, um recorte aparece como "amostra pequena" na tela. */
export const SMALL_SAMPLE = 20;

export interface MatchBody {
  mode?: unknown;
  /** Formato do treino: Standard, EGB ou Livre. */
  format?: unknown;
  /** O treino aceitava spoilers (aí a partida não entra nas estatísticas). */
  spoilers?: unknown;
  seed?: unknown;
  firstPlayer?: unknown;
  chooseFirst?: unknown;
  deckIds?: unknown;
  decks?: unknown;
  actions?: unknown;
}

type Query = Record<string, string | undefined>;

const profileOf = (p: Player) => ({ ...p, tier: tierFor(p.bounty).id });

function parseDeck(v: unknown): DeckList | null {
  const d = v as Partial<DeckList> | null;
  if (!d || typeof d.leader !== 'string' || !Array.isArray(d.cards) || d.cards.length > 60) return null;
  const cards = d.cards.filter((c) => typeof c?.id === 'string' && Number.isInteger(c.count) && c.count > 0 && c.count <= 50);
  if (cards.length !== d.cards.length) return null;
  const arts = parseArts(d.arts);
  return { id: String(d.id ?? ''), name: String(d.name ?? '').slice(0, 60), leader: d.leader, cards, ...(arts ? { arts } : {}) };
}

/** Validade das estatísticas em cache (cada partida gravada já as invalida). */
const STATS_TTL_MS = 30_000;

export function registerStatsRoutes(app: FastifyInstance, { db, viewerHash, user, present, proGate, onMatch }: Deps) {
  const cache = new ResponseCache();
  const pro = (req: FastifyRequest) => !proGate || seesProStats(user(req));
  /**
   * Chave do cache: a rota com a query, o tipo de acesso (geral ou Pro) e, quando a
   * resposta depende de quem pede, o dono.
   */
  const cacheKey = (req: FastifyRequest, personal: boolean) => `${req.url}|${pro(req) ? 'pro' : 'free'}|${personal ? (viewerHash(req) ?? '-') : ''}`;
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
    const format: PlayFormat = isPlayFormat(b?.format) ? b.format : 'standard';
    const decks = Array.isArray(b?.decks) ? b.decks.map(parseDeck) : [];
    if (typeof b?.seed !== 'number' || !Array.isArray(b.actions) || decks.length !== 2 || decks.some((d) => !d)) {
      return reply.code(400).send({ error: 'Dados de partida inválidos' });
    }
    // Tempo esgotado só existe nas partidas online, gravadas pelo próprio servidor.
    if ((b.actions as Action[]).some((a) => a?.type === 'timeout')) return reply.code(400).send({ error: 'Dados de partida inválidos' });
    const pair = decks as [DeckList, DeckList];
    const cards = getCards(db, [...new Set(pair.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))]) as CardData[];
    const byId = new Map(cards.map((c) => [c.id, c]));
    if (pair.some((d) => !validateDeck(d, byId, { format }).valid)) {
      return reply.code(400).send({ error: `Deck inválido ou não permitido no formato ${formatLabel(format)}.` });
    }

    const firstPlayer = b.firstPlayer === 0 || b.firstPlayer === 1 ? (b.firstPlayer as PlayerId) : undefined;
    // A versão do motor que gravou: sem ela, um replay antigo é refeito como se fosse atual e para na primeira
    // pergunta que o motor passou a fazer depois (`upgradeReplayActions` só roda para versões anteriores).
    const replay = {
      version: REPLAY_VERSION,
      seed: b.seed,
      firstPlayer,
      ...(b.chooseFirst === true && firstPlayer === undefined ? { chooseFirst: true } : {}),
      decks: pair,
      actions: b.actions as Action[],
    };
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
    // Só Standard e EGB puros entram nas estatísticas (sem Livre e sem spoilers).
    const listed = countsInStats(format, { spoilerMode: b.spoilers === true, spoilerCards: cards.some((c) => c.spoiler) });
    const id = recordMatch(db, { mode, format, queue: 'casual', listed, replay, seats: [seat(0), seat(1)] }, facts);
    onMatch?.(id);
    return { id, winner: facts.winner, turns: facts.turns };
  });

  app.get('/api/players/me', { config: { scope: 'profile' } }, async (req) => {
    const owner = viewerHash(req);
    const p = owner ? findPlayer(db, owner) : null;
    return p ? { ...profileOf(p), apprentice: isApprentice(db, owner!) } : null;
  });

  app.put<{ Body: { name?: unknown } }>('/api/players/me', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
    if (name.length < 2) return reply.code(400).send(fail('nameTooShort', 'O nome precisa de pelo menos 2 letras.'));
    return { ...profileOf(renamePlayer(db, owner, name)), apprentice: isApprentice(db, owner) };
  });

  /** Opções dos filtros: formatos, filas, tiers, Líderes com partidas e o perfil do jogador. */
  app.get('/api/stats/meta', { config: { scope: 'stats:read' } }, async (req, reply) =>
    cache.send(req, reply, cacheKey(req, true), STATS_TTL_MS, () => {
      const owner = viewerHash(req);
      const me = owner ? findPlayer(db, owner) : null;
      const { leaders } = statsDimensions(db);
      const decks = me ? myDecks(db, me.id) : [];
      return {
        /** Estatísticas Pro liberadas (plano Tripulante ou acima). */
        pro: pro(req),
        /** O servidor separa as estatísticas gerais das Pro (apoio configurado). */
        proGate,
        freeQueues: FREE_QUEUES,
        smallSample: SMALL_SAMPLE,
        formats: FORMATS,
        queues: QUEUES,
        tiers: TIERS,
        leaders,
        me: me ? profileOf(me) : null,
        myDecks: decks,
        cards: cardInfo([...leaders.map((l) => l.leader), ...decks.map((d) => d.leader)]),
      };
    }),
  );

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
      // As próprias partidas: todas as filas, para todo mundo.
      return filter;
    }
    if (pro(req)) {
      // Meta competitivo: torneio só entra depois de terminar.
      filter.hideLiveTournaments = true;
    } else {
      // Estatísticas gerais: só partidas casuais (inclui treino contra o bot e salas privadas), sem filtro por faixa.
      // Pedir a ranqueada ou um torneio sem o plano dá resultado vazio (a tela nem oferece a opção).
      filter.queues = FREE_QUEUES;
      filter.tiers = undefined;
    }
    return filter;
  };

  /**
   * Amostra das Estatísticas Pro para quem não tem o plano: os 3 Líderes mais jogados na
   * ranqueada e nos torneios encerrados dos últimos 30 dias.
   */
  app.get<{ Querystring: Query }>('/api/stats/teaser', async (req, reply) =>
    cache.send(req, reply, `${req.url}|teaser`, STATS_TTL_MS, () => {
      const f: StatsFilter = {
        by: 'human',
        format: isFormat(req.query.format) ? req.query.format : undefined,
        queues: PRO_QUEUES,
        hideLiveTournaments: true,
        days: 30,
      };
      const all = leaderStats(db, f);
      const total = all.reduce((n, l) => n + l.games, 0);
      const top = all.slice(0, 3).map((l) => ({ leader: l.leader, games: l.games, wins: l.wins }));
      return { total, leaders: all.length, top, cards: cardInfo(top.map((l) => l.leader)) };
    }),
  );

  /** Visão geral: totais, Líderes e matchups. */
  app.get<{ Querystring: Query }>('/api/stats', { config: { scope: 'stats:read' } }, async (req, reply) =>
    cache.send(req, reply, cacheKey(req, req.query.mine === '1'), STATS_TTL_MS, () => {
      const f = parseFilter(req);
      const leaders = leaderStats(db, f);
      const matchups = matchupStats(db, f);
      return {
        summary: summary(db, f),
        leaders,
        matchups,
        cards: cardInfo([...leaders.map((l) => l.leader), ...matchups.map((m) => m.oppLeader)]),
      };
    }),
  );

  /** Tendência semanal: uso e vitórias por Líder nas últimas semanas (padrão 6, máximo 26). */
  app.get<{ Querystring: Query }>('/api/stats/trend', { config: { scope: 'stats:read' } }, async (req, reply) =>
    cache.send(req, reply, cacheKey(req, req.query.mine === '1'), STATS_TTL_MS, () => {
      const weeks = Math.min(26, Math.max(2, Math.floor(Number(req.query.weeks) || 6)));
      const t = trendStats(db, parseFilter(req), weeks);
      return { ...t, cards: cardInfo(t.rows.map((r) => r.leader)) };
    }),
  );

  /** Cartas de um Líder (ou de uma lista): efetividade no deck, na mão inicial, compradas e jogadas. */
  app.get<{ Querystring: Query }>('/api/stats/cards', { config: { scope: 'stats:read' } }, async (req, reply) => {
    if (!req.query.leader && !req.query.deck) return reply.code(400).send(fail('chooseLeaderOrList', 'Escolha um Líder ou uma lista.'));
    return cache.send(req, reply, cacheKey(req, req.query.mine === '1'), STATS_TTL_MS, () => {
      const f = parseFilter(req);
      const rows = cardStats(db, f);
      return { summary: summary(db, f), rows, cards: cardInfo(rows.map((r) => r.cardId).concat(f.leader ?? [])) };
    });
  });
}
