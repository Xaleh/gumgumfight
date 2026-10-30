// Torneios para apps parceiros (SweetApp): a lista e o detalhe de cada torneio num formato
// estável (schemaVersion), público e com CORS, para o parceiro mostrar os torneios do GumGum
// Fight na tela dele e linkar para a inscrição aqui.
//
//   GET /api/partners/tournaments?status=&format=&limit=   lista (mais próximos/recentes primeiro)
//   GET /api/partners/tournaments/:id                      detalhe: classificação e rodadas
//
// Só o que a página pública de cada torneio já mostra: nomes dos jogadores (apelidos públicos),
// Líder de cada um depois que o torneio começa, placares e classificação. Nunca as listas dos
// decks (ficam no site, e só quando o torneio termina), e-mails nem ids de conta. As respostas
// não dependem de quem pede (sem cookie nem token), então o cache é por rota e compartilhado;
// cada gravação de torneio invalida (dataVersion), com ETag para o parceiro revalidar barato.

import { artImage, isPlayFormat } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dataVersion, ResponseCache } from '../cache';
import { type DB, getCards } from '../db';
import { fail } from '../errors';
import { tournamentSpoilerSet } from '../spoiler-set';
import { getSponsor, publicSponsor } from '../support/sponsors';
import { checkInOpensAt } from '../tournaments/clock';
import { elimLabel, singleRounds, type Standing, standings, swissRounds } from '../tournaments/pairing';
import {
  countPlayers,
  getTournament,
  listMatches,
  listPlayers,
  listTournaments,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
  type TournamentStatus,
} from '../tournaments/store';

export const PARTNER_TOURNAMENTS_SCHEMA = 1;
export const PARTNER_TOURNAMENTS_LIMIT = 50;
export const PARTNER_TOURNAMENTS_LIMIT_MAX = 200;
/** Cache compartilhado (a resposta não muda com quem pede); cada gravação de torneio invalida antes. */
const LIST_TTL_MS = 30_000;
const DETAIL_TTL_MS = 10_000;
/** Parâmetro da página do torneio no site (`apps/web/src/App.tsx`, TOURNAMENT_PARAM). */
const SITE_PARAM = 'torneio';
const STATUSES: TournamentStatus[] = ['registration', 'running', 'finished'];

export interface PartnerLeader {
  id: string;
  name: string;
  colors: string[];
  image: string | null;
}

export interface PartnerTournamentSummary {
  id: string;
  name: string;
  description: string;
  /** Página do torneio no site (inscrição, lobby, resultados). */
  url: string;
  format: Tournament['format'];
  spoilers: boolean;
  spoilerSet: string | null;
  structure: Tournament['structure'];
  swissBestOf: number;
  topCut: number | null;
  status: TournamentStatus;
  round: number;
  /** null = ainda depende do número de inscritos. */
  totalRounds: number | null;
  players: number;
  maxPlayers: number | null;
  startsAt: string | null;
  checkIn: boolean;
  checkInOpensAt: string | null;
  organizer: { name: string | null };
  official: boolean;
  prize: string | null;
  sponsor: { id: string; name: string; url: string | null; offer: string | null } | null;
  /** Até quando só apoiadores Almirante se inscrevem. */
  priorityUntil: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Campeão (torneio encerrado). */
  champion: { name: string; leader: PartnerLeader | null } | null;
}

export interface PartnerStanding {
  rank: number;
  name: string;
  points: number;
  wins: number;
  losses: number;
  byes: number;
  omw: number;
  dropped: boolean;
  leader: PartnerLeader | null;
}

export interface PartnerTournamentDetail extends PartnerTournamentSummary {
  standings: PartnerStanding[];
  rounds: Array<{
    round: number;
    stage: TournamentMatch['stage'];
    label: string;
    bestOf: number;
    matches: Array<{
      table: number;
      p1: { name: string } | null;
      p2: { name: string } | null;
      /** p1 | p2 | bye | none (derrota dupla) | loss (inscrição atrasada); null = pendente. */
      result: TournamentMatch['result'];
      wins: [number, number];
    }>;
  }>;
}

interface Deps {
  db: DB;
  /** CARD_IMAGES: sem imagens, `leader.image` vem null. */
  cardImages: boolean;
  now?: () => number;
}

export function registerPartnerTournamentRoutes(app: FastifyInstance, { db, cardImages, now = Date.now }: Deps) {
  const cache = new ResponseCache(dataVersion, 500, now);
  const siteOf = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

  const sponsorOf = (id: string | null) => {
    const sp = id ? getSponsor(db, id) : null;
    if (!sp || !sp.active) return null;
    const p = publicSponsor(sp);
    return { id: p.id, name: p.name, url: p.url ?? null, offer: p.offer ?? null };
  };

  const plannedRounds = (t: Tournament, players: number) =>
    t.structure === 'single' ? singleRounds(players) : (t.rounds ?? swissRounds(players)) + (t.topCut ? singleRounds(Math.min(t.topCut, players)) : 0);

  /** Líderes (carta) dos jogadores, só o que a página pública mostra: depois do início. */
  const leadersOf = (t: Tournament, players: TournamentPlayer[]): Map<string, PartnerLeader> => {
    if (t.status === 'registration') return new Map();
    const cards = new Map(getCards(db, [...new Set(players.map((p) => p.deck.leader))]).map((c) => [c.id, c] as const));
    const out = new Map<string, PartnerLeader>();
    for (const p of players) {
      const c = cards.get(p.deck.leader);
      if (c) out.set(p.userId, { id: c.id, name: c.name, colors: c.colors, image: (cardImages && artImage(c, p.deck.arts?.[c.id])) || null });
    }
    return out;
  };

  const championOf = (t: Tournament, players: TournamentPlayer[], matches: TournamentMatch[], leaders: Map<string, PartnerLeader>) => {
    if (t.status !== 'finished' || !players.length) return null;
    const ranked = standings(players, matches);
    const first = ranked.find((s) => !s.dropped) ?? ranked[0];
    const p = first && players.find((x) => x.userId === first.userId);
    return p ? { name: p.name, leader: leaders.get(p.userId) ?? null } : null;
  };

  const summary = (req: FastifyRequest, t: Tournament & { players?: number }, extra: { champion: PartnerTournamentSummary['champion'] }): PartnerTournamentSummary => {
    const players = t.players ?? countPlayers(db, t.id);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      url: `${siteOf(req)}/?${SITE_PARAM}=${encodeURIComponent(t.id)}`,
      format: t.format,
      spoilers: t.spoilers,
      spoilerSet: tournamentSpoilerSet(db, t),
      structure: t.structure,
      swissBestOf: t.swissBestOf,
      topCut: t.topCut,
      status: t.status,
      round: t.round,
      totalRounds: t.status === 'registration' ? null : plannedRounds(t, players),
      players,
      maxPlayers: t.maxPlayers,
      startsAt: t.startsAt,
      checkIn: t.checkIn,
      checkInOpensAt: checkInOpensAt(t),
      organizer: { name: t.organizerName },
      official: t.official,
      prize: t.prize,
      sponsor: sponsorOf(t.sponsorId),
      priorityUntil: t.priorityUntil,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      champion: extra.champion,
    };
  };

  /** Resposta pública e cacheável: CORS aberto (dados públicos, sem cookie) e ETag para revalidar. */
  const send = (req: FastifyRequest, reply: FastifyReply, key: string, ttl: number, compute: () => unknown) => {
    const entry = cache.get(key, ttl, compute);
    reply
      .header('access-control-allow-origin', '*')
      .header('etag', entry.etag)
      .header('cache-control', `public, max-age=${Math.floor(ttl / 1000)}`);
    if (req.headers['if-none-match'] === entry.etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(entry.body);
  };

  app.get<{ Querystring: { status?: string; format?: string; limit?: string } }>('/api/partners/tournaments', async (req, reply) => {
    const wanted = (req.query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (wanted.some((s) => !STATUSES.includes(s as TournamentStatus))) {
      return reply.header('access-control-allow-origin', '*').code(400).send(fail('invalidStatus', 'status inválido (registration, running, finished).'));
    }
    if (req.query.format !== undefined && !isPlayFormat(req.query.format)) {
      return reply.header('access-control-allow-origin', '*').code(400).send(fail('invalidFormat', 'format inválido.'));
    }
    const limitRaw = req.query.limit === undefined ? PARTNER_TOURNAMENTS_LIMIT : Number(req.query.limit);
    if (!Number.isInteger(limitRaw) || limitRaw < 1) return reply.header('access-control-allow-origin', '*').code(400).send(fail('invalidLimit', 'limit inválido.'));
    const limit = Math.min(PARTNER_TOURNAMENTS_LIMIT_MAX, limitRaw);
    const format = req.query.format;
    const key = `partners:tournaments:${wanted.join(',') || '-'}:${format ?? '-'}:${limit}:${siteOf(req)}`;
    return send(req, reply, key, LIST_TTL_MS, () => {
      const all = listTournaments(db, PARTNER_TOURNAMENTS_LIMIT_MAX)
        .filter((t) => (!wanted.length || wanted.includes(t.status)) && (!format || t.format === format))
        .slice(0, limit);
      return {
        schemaVersion: PARTNER_TOURNAMENTS_SCHEMA,
        generatedAt: new Date(now()).toISOString(),
        site: siteOf(req),
        tournaments: all.map((t) => {
          if (t.status !== 'finished') return summary(req, t, { champion: null });
          const players = listPlayers(db, t.id);
          const matches = listMatches(db, t.id);
          return summary(req, t, { champion: championOf(t, players, matches, leadersOf(t, players)) });
        }),
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/partners/tournaments/:id', async (req, reply) => {
    const t = getTournament(db, req.params.id);
    if (!t) return reply.header('access-control-allow-origin', '*').code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const key = `partners:tournament:${t.id}:${siteOf(req)}`;
    return send(req, reply, key, DETAIL_TTL_MS, (): PartnerTournamentDetail => {
      const players = listPlayers(db, t.id);
      const matches = listMatches(db, t.id);
      const leaders = leadersOf(t, players);
      const name = new Map(players.map((p) => [p.userId, p.name]));
      const ref = (id: string | null) => (id ? { name: name.get(id) ?? '?' } : null);
      const rank = (s: Standing): PartnerStanding => ({
        rank: s.rank,
        name: name.get(s.userId) ?? '?',
        points: s.points,
        wins: s.wins,
        losses: s.losses,
        byes: s.byes,
        omw: s.omw,
        dropped: s.dropped,
        leader: leaders.get(s.userId) ?? null,
      });
      return {
        ...summary(req, { ...t, players: players.length }, { champion: championOf(t, players, matches, leaders) }),
        standings: t.status === 'registration' ? [] : standings(players, matches).map(rank),
        rounds: Array.from({ length: t.round }, (_, i) => {
          const ms = matches.filter((m) => m.round === i + 1);
          const stage = ms[0]?.stage ?? 'swiss';
          return {
            round: i + 1,
            stage,
            label: stage === 'elim' ? elimLabel(ms.length * 2) : `Rodada ${i + 1}`,
            bestOf: ms[0]?.bestOf ?? 1,
            matches: ms.map((m) => ({ table: m.table, p1: ref(m.p1), p2: ref(m.p2), result: m.result, wins: m.wins })),
          };
        }),
      };
    });
  });
}
