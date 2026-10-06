// Rotas dos torneios.
//
// Quem cria: contas com perfil Organizador ou Admin. Quem gerencia: o organizador que
// criou o torneio e qualquer admin. Quem joga: contas Google inscritas, com um deck
// válido no formato (a lista fica congelada na inscrição).
//
// As partidas de cada rodada são jogadas nas salas online (fila "tournament"): o
// resultado entra sozinho no fim da partida. O organizador pode lançar ou corrigir
// qualquer resultado da rodada atual (W.O., problema de conexão, partida jogada fora
// do site) e é quem avança as rodadas.

import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, createsTournaments, type User } from '../auth/store';
import { type DB, getCards } from '../db';
import type { Lobby } from '../online/lobby';
import { playableDeck } from '../online/routes';
import type { ApiCard } from '../present';
import { FORMATS, isFormat, tierFor } from '../stats/catalog';
import { ensurePlayer } from '../stats/store';
import {
  type MatchResult,
  singleFirstRound,
  singleNextRound,
  singleRounds,
  standings,
  swissPairings,
  swissRounds,
  winnerOf,
} from './pairing';
import {
  countPlayers,
  createTournament,
  deleteTournament,
  dropPlayer,
  finishTournament,
  getMatch,
  getTournament,
  insertRound,
  listMatches,
  listPlayers,
  listTournaments,
  registerPlayer,
  setMatchResult,
  setMatchRoom,
  startTournament,
  type Tournament,
  type TournamentInput,
  type TournamentMatch,
  tournamentsOf,
  unregisterPlayer,
  updateTournament,
} from './store';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  lobby: Lobby;
  /** Imagens das cartas ligadas (CARD_IMAGES). */
  cardImages: boolean;
}

export const MAX_PLAYERS = 256;
const MAX_SWISS_ROUNDS = 15;

type Body = {
  name?: unknown;
  description?: unknown;
  format?: unknown;
  structure?: unknown;
  rounds?: unknown;
  maxPlayers?: unknown;
  startsAt?: unknown;
};

/** Valida o formulário de criação/edição. */
function parseInput(b: Body | undefined): TournamentInput | string {
  if (!b || typeof b !== 'object') return 'Corpo inválido.';
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (name.length < 3) return 'Dê um nome ao torneio (pelo menos 3 letras).';
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 2000) : '';
  if (!isFormat(b.format)) return 'Formato inválido.';
  if (b.structure !== 'swiss' && b.structure !== 'single') return 'Estrutura inválida.';
  const int = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const rounds = b.structure === 'swiss' ? int(b.rounds) : null;
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_SWISS_ROUNDS)) {
    return `Número de rodadas inválido (1 a ${MAX_SWISS_ROUNDS}, ou vazio para calcular pelo número de inscritos).`;
  }
  const maxPlayers = int(b.maxPlayers);
  if (maxPlayers !== null && (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_PLAYERS)) {
    return `Limite de jogadores inválido (2 a ${MAX_PLAYERS}).`;
  }
  let startsAt: string | null = null;
  if (typeof b.startsAt === 'string' && b.startsAt.trim()) {
    const d = new Date(b.startsAt);
    if (Number.isNaN(d.getTime())) return 'Data de início inválida.';
    startsAt = d.toISOString();
  }
  return { name, description, format: b.format, structure: b.structure, rounds, maxPlayers, startsAt };
}

const isResult = (v: unknown): v is Exclude<MatchResult, 'bye'> => v === 'p1' || v === 'p2' || v === 'draw';

export function registerTournamentRoutes(app: FastifyInstance, { db, user, present, lobby, cardImages }: Deps) {
  /** Conta logada, ou responde 401. */
  const account = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send({ error: 'Entre com a conta Google.' });
    return u;
  };
  const canManage = (t: Tournament, u: User | null) => Boolean(u && (u.role === 'admin' || (u.id === t.organizerId && createsTournaments(u.role))));

  /** Torneio que a conta logada gerencia, ou responde 401/403/404. */
  const managed = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): { t: Tournament; me: User } | null => {
    const me = account(req, reply);
    if (!me) return null;
    const t = getTournament(db, req.params.id);
    if (!t) {
      void reply.code(404).send({ error: 'Torneio não encontrado.' });
      return null;
    }
    if (!canManage(t, me)) {
      void reply.code(403).send({ error: 'Só o organizador do torneio (ou um admin) pode fazer isso.' });
      return null;
    }
    return { t, me };
  };

  const summary = (t: Tournament & { players?: number }, mine: Set<string>) => ({
    id: t.id,
    name: t.name,
    format: t.format,
    structure: t.structure,
    status: t.status,
    round: t.round,
    /** null = suíço com rodadas calculadas no início. */
    totalRounds: t.rounds,
    players: t.players ?? countPlayers(db, t.id),
    maxPlayers: t.maxPlayers,
    startsAt: t.startsAt,
    organizerName: t.organizerName,
    registered: mine.has(t.id),
  });

  app.get('/api/tournaments', async (req) => {
    const u = user(req);
    const mine = u ? tournamentsOf(db, u.id) : new Set<string>();
    return {
      tournaments: listTournaments(db).map((t) => summary(t, mine)),
      canCreate: createsTournaments(u?.role),
    };
  });

  /** Torneio completo: inscritos, rodadas, classificação e o que quem pede pode fazer. */
  const detail = (t: Tournament, u: User | null) => {
    const players = listPlayers(db, t.id);
    const matches = listMatches(db, t.id);
    const manage = canManage(t, u);
    // As listas ficam escondidas até o fim (só o organizador e o próprio jogador as veem).
    const showDeck = (userId: string) => manage || t.status === 'finished' || userId === u?.id;
    const ids = players.flatMap((p) => [p.deck.leader, ...(showDeck(p.userId) ? p.deck.cards.map((c) => c.id) : [])]);
    const cards = new Map(present(getCards(db, [...new Set(ids)])).map((c) => [c.id, c] as const));
    const name = new Map(players.map((p) => [p.userId, p.name]));
    const ref = (id: string | null) => (id ? { userId: id, name: name.get(id) ?? '?' } : null);
    const live = (m: TournamentMatch) => {
      const room = m.roomId ? lobby.get(m.roomId) : null;
      return room ? room.status : null;
    };
    const rounds = Array.from({ length: t.round }, (_, i) => ({
      round: i + 1,
      matches: matches
        .filter((m) => m.round === i + 1)
        .map((m) => ({
          id: m.id,
          table: m.table,
          p1: ref(m.p1)!,
          p2: ref(m.p2),
          result: m.result,
          winner: winnerOf(m),
          /** Quem lançou: game (sala online), bye, drop (desistência) ou organizer. */
          reportedBy: m.reportedBy === null || ['game', 'bye', 'drop'].includes(m.reportedBy) ? m.reportedBy : 'organizer',
          roomId: m.roomId,
          room: live(m),
        })),
    }));
    const me = u ? players.find((p) => p.userId === u.id) : undefined;
    const current = me && t.status === 'running' ? matches.find((m) => m.round === t.round && (m.p1 === me.userId || m.p2 === me.userId)) : undefined;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.format,
      structure: t.structure,
      status: t.status,
      round: t.round,
      totalRounds: t.rounds ?? (t.structure === 'swiss' ? swissRounds(players.length) : singleRounds(players.length)),
      roundsAuto: t.rounds === null,
      maxPlayers: t.maxPlayers,
      startsAt: t.startsAt,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      organizerName: t.organizerName,
      canManage: manage,
      canRegister: Boolean(u) && t.status === 'registration',
      me: me ? { deckId: me.deckId, deckName: me.deck.name, leader: me.deck.leader, dropped: me.dropped, matchId: current?.id ?? null } : null,
      players: players.map((p) => {
        const leader = cards.get(p.deck.leader);
        return {
          userId: p.userId,
          name: p.name,
          seed: t.status === 'registration' ? null : p.seed,
          dropped: p.dropped,
          leader: p.deck.leader,
          leaderName: leader?.name ?? null,
          leaderImage: (cardImages && leader?.imageUrl) || null,
          colors: leader?.colors ?? [],
          deck: showDeck(p.userId)
            ? { name: p.deck.name, leader: p.deck.leader, cards: p.deck.cards.map((c) => ({ ...c, name: cards.get(c.id)?.name ?? null })) }
            : null,
        };
      }),
      rounds,
      standings: t.status === 'registration' ? [] : standings(players, matches, t.structure).map((s) => ({ ...s, name: name.get(s.userId) ?? '?' })),
      roundComplete: t.status === 'running' && roundComplete(t, matches),
    };
  };

  /** Todas as partidas da rodada atual têm resultado (na eliminação simples, sem empate). */
  const roundComplete = (t: Tournament, matches: TournamentMatch[]) =>
    matches.filter((m) => m.round === t.round).every((m) => m.result && (t.structure === 'swiss' || m.result !== 'draw'));

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = getTournament(db, req.params.id);
    return t ? detail(t, user(req)) : reply.code(404).send({ error: 'Torneio não encontrado.' });
  });

  // ---------------------------------------------------------------- organizador

  app.post<{ Body: Body }>('/api/tournaments', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    if (!createsTournaments(me.role)) return reply.code(403).send({ error: 'Só organizadores e administradores podem criar torneios.' });
    const input = parseInput(req.body);
    if (typeof input === 'string') return reply.code(400).send({ error: input });
    // O nome público do organizador vem do perfil de estatísticas.
    ensurePlayer(db, accountOwnerKey(me.id));
    const t = createTournament(db, input, me.id);
    return reply.code(201).send(detail(t, me));
  });

  app.put<{ Params: { id: string }; Body: Body }>('/api/tournaments/:id', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    if (found.t.status !== 'registration') return reply.code(409).send({ error: 'O torneio já começou: não dá para mudar as regras.' });
    const input = parseInput(req.body);
    if (typeof input === 'string') return reply.code(400).send({ error: input });
    if (input.maxPlayers !== null && input.maxPlayers < countPlayers(db, found.t.id)) {
      return reply.code(400).send({ error: 'O limite é menor que o número de inscritos.' });
    }
    // Mudar o formato pode invalidar decks já inscritos: confere de novo.
    if (input.format !== found.t.format) {
      const bad = listPlayers(db, found.t.id).filter((p) => p.deckId && 'error' in playableDeck(db, p.deckId, input.format, false));
      if (bad.length) {
        return reply.code(400).send({ error: `${bad.length} inscrito(s) usam decks que não valem no formato ${FORMATS.find((f) => f.id === input.format)?.label}.` });
      }
    }
    updateTournament(db, found.t.id, input);
    return detail(getTournament(db, found.t.id)!, found.me);
  });

  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    deleteTournament(db, found.t.id);
    return reply.code(204).send();
  });

  /** Fecha as inscrições, sorteia a ordem e gera a primeira rodada. */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/start', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'registration') return reply.code(409).send({ error: 'O torneio já começou.' });
    const players = listPlayers(db, t.id);
    if (players.length < 2) return reply.code(400).send({ error: 'São precisos pelo menos 2 inscritos.' });
    // Embaralha (Fisher-Yates) para sortear a ordem dos cabeças de chave e da 1ª rodada.
    const order = players.map((p) => p.userId);
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const seeded = players.map((p) => ({ ...p, seed: order.indexOf(p.userId) + 1 }));
    const swiss = t.structure === 'swiss';
    const rounds = swiss ? (t.rounds ?? swissRounds(players.length)) : singleRounds(players.length);
    const pairings = swiss ? swissPairings(seeded, []) : singleFirstRound(seeded);
    startTournament(db, t.id, order, rounds, pairings);
    return detail(getTournament(db, t.id)!, me);
  });

  /** Com a rodada atual completa: gera a próxima ou, depois da última, encerra o torneio. */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/next', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'running') return reply.code(409).send({ error: 'O torneio não está em andamento.' });
    const matches = listMatches(db, t.id);
    if (!roundComplete(t, matches)) {
      return reply.code(409).send({
        error:
          t.structure === 'single'
            ? 'Ainda há partidas da rodada sem vencedor (na eliminação simples não há empate).'
            : 'Ainda há partidas da rodada sem resultado.',
      });
    }
    const players = listPlayers(db, t.id);
    const active = players.filter((p) => !p.dropped);
    const current = matches.filter((m) => m.round === t.round);
    const last = t.structure === 'swiss' ? t.round >= (t.rounds ?? 0) || active.length < 2 : current.length <= 1;
    if (last) finishTournament(db, t.id);
    else insertRound(db, t.id, t.round + 1, t.structure === 'swiss' ? swissPairings(players, matches) : singleNextRound(players, current));
    return detail(getTournament(db, t.id)!, me);
  });

  /** Encerra antes da última rodada (a classificação fica como está). */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/finish', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    if (found.t.status !== 'running') return reply.code(409).send({ error: 'O torneio não está em andamento.' });
    finishTournament(db, found.t.id);
    return detail(getTournament(db, found.t.id)!, found.me);
  });

  /** Lança ou corrige o resultado de uma partida da rodada atual (null apaga). */
  app.put<{ Params: { id: string; matchId: string }; Body: { result?: unknown } }>(
    '/api/tournaments/:id/matches/:matchId/result',
    async (req, reply) => {
      const found = managed(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const m = getMatch(db, t.id, Number(req.params.matchId));
      if (!m) return reply.code(404).send({ error: 'Partida não encontrada.' });
      if (t.status !== 'running' || m.round !== t.round) {
        return reply.code(409).send({ error: 'Só dá para mudar resultados da rodada atual.' });
      }
      if (!m.p2) return reply.code(400).send({ error: 'Esta partida é um bye.' });
      const result = req.body?.result ?? null;
      if (result !== null && !isResult(result)) return reply.code(400).send({ error: 'Resultado inválido.' });
      if (result === 'draw' && t.structure === 'single') return reply.code(400).send({ error: 'Na eliminação simples não há empate.' });
      setMatchResult(db, t.id, m.id, result, me.id);
      return detail(t, me);
    },
  );

  /** Tira um jogador: nas inscrições, cancela a inscrição; durante o torneio, é uma desistência. */
  app.post<{ Params: { id: string; userId: string } }>('/api/tournaments/:id/players/:userId/drop', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    const r = removePlayer(t, req.params.userId);
    return r ? reply.code(r.code).send({ error: r.error }) : detail(getTournament(db, t.id)!, me);
  });

  const removePlayer = (t: Tournament, userId: string): { code: number; error: string } | null => {
    const p = listPlayers(db, t.id).find((x) => x.userId === userId);
    if (!p) return { code: 404, error: 'Jogador não inscrito.' };
    if (t.status === 'registration') unregisterPlayer(db, t.id, userId);
    else if (t.status === 'running') {
      if (p.dropped) return { code: 409, error: 'Este jogador já saiu do torneio.' };
      dropPlayer(db, t, userId);
    } else return { code: 409, error: 'O torneio já terminou.' };
    return null;
  };

  // ---------------------------------------------------------------- jogadores

  /** Inscrição (ou troca de deck, enquanto as inscrições estão abertas). */
  app.post<{ Params: { id: string }; Body: { deckId?: unknown } }>('/api/tournaments/:id/register', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send({ error: 'Torneio não encontrado.' });
    if (t.status !== 'registration') return reply.code(409).send({ error: 'As inscrições deste torneio já fecharam.' });
    const already = listPlayers(db, t.id).some((p) => p.userId === me.id);
    if (!already && t.maxPlayers !== null && countPlayers(db, t.id) >= t.maxPlayers) {
      return reply.code(409).send({ error: 'O torneio está lotado.' });
    }
    const deck = playableDeck(db, req.body?.deckId, t.format, false);
    if ('error' in deck) return reply.code(deck.code).send({ error: deck.error });
    const profile = ensurePlayer(db, accountOwnerKey(me.id));
    registerPlayer(db, t.id, me.id, profile.name, deck.id ?? null, deck);
    return detail(t, me);
  });

  /** Cancela a inscrição ou, com o torneio em andamento, desiste. */
  app.delete<{ Params: { id: string } }>('/api/tournaments/:id/register', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send({ error: 'Torneio não encontrado.' });
    const r = removePlayer(t, me.id);
    return r ? reply.code(r.code).send({ error: r.error }) : detail(getTournament(db, t.id)!, me);
  });

  /**
   * Abre (ou entra na) sala online da partida da rodada atual. O primeiro a entrar
   * espera o oponente; a partida começa quando os dois estão na sala.
   */
  app.post<{ Params: { id: string; matchId: string } }>('/api/tournaments/:id/matches/:matchId/play', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    const m = t && getMatch(db, t.id, Number(req.params.matchId));
    if (!t || !m) return reply.code(404).send({ error: 'Partida não encontrada.' });
    if (m.p1 !== me.id && m.p2 !== me.id) return reply.code(403).send({ error: 'Esta partida não é sua.' });
    if (t.status !== 'running' || m.round !== t.round) return reply.code(409).send({ error: 'Esta partida não é da rodada atual.' });
    if (!m.p2) return reply.code(400).send({ error: 'Você está de bye nesta rodada: a vitória já é sua.' });
    if (m.result) return reply.code(409).send({ error: 'Esta partida já tem resultado.' });
    const player = listPlayers(db, t.id).find((p) => p.userId === me.id)!;
    if (player.dropped) return reply.code(409).send({ error: 'Você saiu do torneio.' });
    const ownerHash = accountOwnerKey(me.id);
    const profile = ensurePlayer(db, ownerHash);
    const r = lobby.tournamentRoom(
      {
        ownerHash,
        userId: me.id,
        name: profile.name,
        bounty: profile.bounty,
        tier: tierFor(profile.bounty).id,
        deckId: player.deckId,
        deck: player.deck,
      },
      t.format,
      { id: t.id, name: t.name, round: m.round, matchId: m.id },
    );
    if ('error' in r) return reply.code(r.code).send(r);
    if (m.roomId !== r.room.id) setMatchRoom(db, t.id, m.id, r.room.id);
    return { roomId: r.room.id, token: r.token };
  });
}
