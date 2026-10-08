// Rotas dos torneios.
//
// Quem cria: contas com perfil Organizador ou Admin. Quem gerencia: o organizador que
// criou o torneio e qualquer admin. Quem joga: contas Google inscritas, com um deck
// válido no formato (a lista fica congelada na inscrição).
//
// Fases: suíço (com top cut opcional no fim) ou eliminação simples. Cada partida é
// uma série melhor de 1, 3 ou 5 (o organizador escolhe a partir de qual fase da
// eliminatória entram a melhor de 3 e a de 5). Não há empate.
//
// Os jogos são disputados nas salas online (fila "tournament"): o placar da série
// soma sozinho no fim de cada jogo. O organizador pode lançar ou corrigir o placar
// de qualquer partida (W.O., problema de conexão, partida jogada fora do site,
// resultado lançado errado) e é quem avança as rodadas.

import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, createsTournaments, isAdmin, type User } from '../auth/store';
import { dataVersion, ResponseCache } from '../cache';
import { type DB, getCards } from '../db';
import type { Lobby } from '../online/lobby';
import { playableDeck } from '../online/routes';
import { TIME_BANK_MS } from '../online/room';
import type { ApiCard } from '../present';
import { FORMATS, isFormat, tierFor } from '../stats/catalog';
import { ensurePlayer } from '../stats/store';
import {
  elimBestOf,
  elimLabel,
  type Pairing,
  singleFirstRound,
  singleNextRound,
  singleRounds,
  standings,
  swissPairings,
  swissRounds,
  winnerOf,
  winsNeeded,
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
  replaceInMatch,
  type RoundSpec,
  seriesResult,
  setMatchRoom,
  setMatchScore,
  startTournament,
  type Tournament,
  type TournamentInput,
  type TournamentMatch,
  type TournamentPlayer,
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
/** Tamanhos aceitos do top cut e das fases da eliminatória (vagas). */
const CUT_SIZES = [2, 4, 8, 16, 32, 64];
const PHASE_SIZES = [2, 4, 8, 16, 32, 64, 128, 256];

type Body = {
  name?: unknown;
  description?: unknown;
  format?: unknown;
  structure?: unknown;
  rounds?: unknown;
  swissBestOf?: unknown;
  topCut?: unknown;
  bo3From?: unknown;
  bo5From?: unknown;
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
  const swiss = b.structure === 'swiss';
  const int = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const rounds = swiss ? int(b.rounds) : null;
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_SWISS_ROUNDS)) {
    return `Número de rodadas inválido (1 a ${MAX_SWISS_ROUNDS}, ou vazio para calcular pelo número de inscritos).`;
  }
  const swissBestOf = swiss ? (int(b.swissBestOf) ?? 1) : 1;
  if (swissBestOf !== 1 && swissBestOf !== 3) return 'As partidas do suíço são melhor de 1 ou de 3.';
  const topCut = swiss ? int(b.topCut) : null;
  if (topCut !== null && !CUT_SIZES.includes(topCut)) return `Top cut inválido (${CUT_SIZES.join(', ')} ou nenhum).`;
  // Fases da eliminatória só existem na eliminação simples ou no top cut.
  const elim = !swiss || topCut !== null;
  const bo3From = elim ? int(b.bo3From) : null;
  const bo5From = elim ? int(b.bo5From) : null;
  for (const v of [bo3From, bo5From]) if (v !== null && !PHASE_SIZES.includes(v)) return 'Fase da eliminatória inválida.';
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
  return { name, description, format: b.format, structure: b.structure, rounds, swissBestOf, topCut, bo3From, bo5From, maxPlayers, startsAt };
}

/** Rodada da eliminatória: melhor de N pelo tamanho da fase. */
const elimRound = (t: Tournament, round: number, pairings: Pairing[]): RoundSpec => ({
  round,
  stage: 'elim',
  bestOf: elimBestOf(pairings.length * 2, t),
  pairings,
});

/** Nome de uma rodada: "Rodada 3" no suíço, "Semifinal" na eliminatória. */
const roundLabel = (matches: TournamentMatch[], round: number) => {
  const ms = matches.filter((m) => m.round === round);
  return ms[0]?.stage === 'elim' ? elimLabel(ms.length * 2) : `Rodada ${round}`;
};

/**
 * Placar pedido pelo organizador: `wins` = [p1, p2], ou `result` (p1/p2) como atalho
 * para a vitória mais curta. null/[0, 0] apaga. Recusa placares impossíveis.
 */
function parseScore(body: { wins?: unknown; result?: unknown } | undefined, bestOf: number): [number, number] | string {
  const need = winsNeeded(bestOf);
  if (body?.result === 'p1') return [need, 0];
  if (body?.result === 'p2') return [0, need];
  if (body?.result === 'draw') return 'No One Piece TCG não há empate.';
  if (body?.result === null || body?.wins === null) return [0, 0];
  const w = body?.wins;
  if (!Array.isArray(w) || w.length !== 2 || !w.every((n) => Number.isInteger(n) && n >= 0 && n <= need)) return 'Placar inválido.';
  if (w[0] === need && w[1] === need) return 'Placar inválido.';
  return [w[0], w[1]];
}

/** Validade do torneio completo em cache (só por garantia: cada gravação já o invalida). */
const DETAIL_TTL_MS = 5_000;

export function registerTournamentRoutes(app: FastifyInstance, { db, user, present, lobby, cardImages }: Deps) {
  const cache = new ResponseCache();
  /** Conta logada, ou responde 401. */
  const account = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send({ error: 'Entre com a conta Google.' });
    return u;
  };
  const canManage = (t: Tournament, u: User | null) => Boolean(u && (isAdmin(u.role) || (u.id === t.organizerId && createsTournaments(u.role))));

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

  /** Rodadas previstas: suíço (+ top cut) ou a chave inteira. */
  const plannedRounds = (t: Tournament, players: number) =>
    t.structure === 'single'
      ? singleRounds(players)
      : (t.rounds ?? swissRounds(players)) + (t.topCut ? singleRounds(Math.min(t.topCut, players)) : 0);

  const summary = (t: Tournament & { players?: number }, mine: Set<string>) => {
    const players = t.players ?? countPlayers(db, t.id);
    return {
      id: t.id,
      name: t.name,
      format: t.format,
      structure: t.structure,
      topCut: t.topCut,
      status: t.status,
      round: t.round,
      /** null = ainda depende do número de inscritos. */
      totalRounds: t.status === 'registration' ? null : plannedRounds(t, players),
      players,
      maxPlayers: t.maxPlayers,
      startsAt: t.startsAt,
      organizerName: t.organizerName,
      registered: mine.has(t.id),
    };
  };

  app.get('/api/tournaments', async (req) => {
    const u = user(req);
    const mine = u ? tournamentsOf(db, u.id) : new Set<string>();
    return {
      tournaments: listTournaments(db).map((t) => summary(t, mine)),
      canCreate: createsTournaments(u?.role),
    };
  });

  const roundComplete = (t: Tournament, matches: TournamentMatch[]) => matches.filter((m) => m.round === t.round).every((m) => m.result);

  /** Próximo passo depois da rodada atual: outra rodada do suíço, o top cut, a próxima fase ou o fim. */
  const nextStep = (t: Tournament, players: TournamentPlayer[], matches: TournamentMatch[]): 'swiss' | 'cut' | 'elim' | 'finish' => {
    const current = matches.filter((m) => m.round === t.round);
    const active = players.filter((p) => !p.dropped).length;
    if (current[0]?.stage === 'elim') return current.length <= 1 ? 'finish' : 'elim';
    if (t.round < (t.rounds ?? 0) && active >= 2) return 'swiss';
    return t.topCut && active >= 2 ? 'cut' : 'finish';
  };

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
    const rounds = Array.from({ length: t.round }, (_, i) => {
      const ms = matches.filter((m) => m.round === i + 1);
      return {
        round: i + 1,
        stage: ms[0]?.stage ?? 'swiss',
        label: roundLabel(matches, i + 1),
        bestOf: ms[0]?.bestOf ?? 1,
        matches: ms.map((m) => ({
          id: m.id,
          table: m.table,
          p1: ref(m.p1)!,
          p2: ref(m.p2),
          bestOf: m.bestOf,
          wins: m.wins,
          result: m.result,
          winner: winnerOf(m),
          /** Quem lançou: game (salas online), bye, drop (desistência) ou organizer. */
          reportedBy: m.reportedBy === null || ['game', 'bye', 'drop'].includes(m.reportedBy) ? m.reportedBy : 'organizer',
          roomId: m.roomId,
          room: m.roomId ? (lobby.get(m.roomId)?.status ?? null) : null,
          /** Jogo da série em disputa agora (1, 2, 3…). */
          game: m.wins[0] + m.wins[1] + 1,
        })),
      };
    });
    const me = u ? players.find((p) => p.userId === u.id) : undefined;
    const current = me && t.status === 'running' ? matches.find((m) => m.round === t.round && (m.p1 === me.userId || m.p2 === me.userId)) : undefined;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.format,
      structure: t.structure,
      swissBestOf: t.swissBestOf,
      topCut: t.topCut,
      bo3From: t.bo3From,
      bo5From: t.bo5From,
      status: t.status,
      round: t.round,
      /** Fase da rodada atual. */
      stage: matches.find((m) => m.round === t.round)?.stage ?? null,
      /** Rodadas previstas (suíço + top cut, ou a chave). */
      totalRounds: plannedRounds(t, players.length),
      /** Rodadas do suíço (só no suíço). */
      swissRounds: t.structure === 'swiss' ? (t.rounds ?? swissRounds(players.length)) : null,
      roundsAuto: t.rounds === null,
      /** Relógio de cada jogador em cada jogo: quem zera o tempo perde. */
      clockMs: TIME_BANK_MS,
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
      standings: t.status === 'registration' ? [] : standings(players, matches).map((s) => ({ ...s, name: name.get(s.userId) ?? '?' })),
      roundComplete: t.status === 'running' && roundComplete(t, matches),
      /** O que o botão de avançar faz agora. */
      next: t.status === 'running' ? nextStep(t, players, matches) : null,
    };
  };

  /**
   * A página do torneio consulta esta rota a cada 5 s por jogador: a resposta fica em
   * cache (por torneio e conta, invalidado a cada gravação) e sai como 304 quando o
   * navegador já a tem.
   */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send({ error: 'Torneio não encontrado.' });
    const u = user(req);
    return cache.send(req, reply, `tournament:${t.id}:${u?.id ?? '-'}`, DETAIL_TTL_MS, () => detail(t, u));
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
    if (t.structure === 'swiss') {
      const rounds = t.rounds ?? swissRounds(players.length);
      startTournament(db, t.id, order, rounds, { round: 1, stage: 'swiss', bestOf: t.swissBestOf, pairings: swissPairings(seeded, []) });
    } else {
      startTournament(db, t.id, order, singleRounds(players.length), elimRound(t, 1, singleFirstRound(seeded)));
    }
    return detail(getTournament(db, t.id)!, me);
  });

  /** Com a rodada atual completa: gera a próxima rodada (do suíço, o top cut ou a próxima fase) ou encerra. */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/next', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'running') return reply.code(409).send({ error: 'O torneio não está em andamento.' });
    const matches = listMatches(db, t.id);
    if (!roundComplete(t, matches)) return reply.code(409).send({ error: 'Ainda há partidas da rodada sem resultado.' });
    const players = listPlayers(db, t.id);
    const step = nextStep(t, players, matches);
    const round = t.round + 1;
    if (step === 'swiss') {
      insertRound(db, t.id, { round, stage: 'swiss', bestOf: t.swissBestOf, pairings: swissPairings(players, matches) });
    } else if (step === 'cut') {
      // Os melhores do suíço (quem desistiu fica de fora), semeados pela classificação.
      const ranked = standings(players, matches).filter((s) => !s.dropped);
      const cut = ranked.slice(0, Math.min(t.topCut!, ranked.length)).map((s, i) => ({ userId: s.userId, seed: i + 1, dropped: false }));
      insertRound(db, t.id, elimRound(t, round, singleFirstRound(cut)));
    } else if (step === 'elim') {
      insertRound(db, t.id, elimRound(t, round, singleNextRound(players, matches.filter((m) => m.round === t.round))));
    } else finishTournament(db, t.id);
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

  /**
   * Lança ou corrige o placar de uma partida (`{ wins: [p1, p2] }` ou `{ result: p1 | p2 }`).
   * Rodada atual: qualquer placar, inclusive parcial ou zerado. Rodadas passadas: só
   * placares com vencedor, e só enquanto a troca de vencedor não desmontar o que veio depois.
   */
  app.put<{ Params: { id: string; matchId: string }; Body: { wins?: unknown; result?: unknown } }>(
    '/api/tournaments/:id/matches/:matchId/result',
    async (req, reply) => {
      const found = managed(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const m = getMatch(db, t.id, Number(req.params.matchId));
      if (!m) return reply.code(404).send({ error: 'Partida não encontrada.' });
      if (t.status === 'registration') return reply.code(409).send({ error: 'O torneio ainda não começou.' });
      if (!m.p2) return reply.code(400).send({ error: 'Esta partida é um bye.' });
      const wins = parseScore(req.body, m.bestOf);
      if (typeof wins === 'string') return reply.code(400).send({ error: wins });
      const result = seriesResult(m.bestOf, wins);
      const live = t.status === 'running' && m.round === t.round;
      if (!live) {
        if (!result) return reply.code(409).send({ error: 'Partidas de rodadas passadas precisam de um vencedor.' });
        const matches = listMatches(db, t.id);
        const oldWinner = winnerOf(m);
        const newWinner = result === 'p1' ? m.p1 : m.p2;
        if (oldWinner && oldWinner !== newWinner) {
          if (m.stage === 'swiss' && matches.some((x) => x.stage === 'elim')) {
            return reply.code(409).send({ error: 'O top cut já começou: os resultados do suíço não mudam mais.' });
          }
          if (m.stage === 'elim') {
            // Na chave, o vencedor já foi para a partida seguinte: troca-o lá, se ela ainda não começou.
            const next = matches.find((x) => x.round === m.round + 1 && (x.p1 === oldWinner || x.p2 === oldWinner));
            if (next) {
              if (next.result && next.result !== 'bye') {
                return reply
                  .code(409)
                  .send({ error: `Corrija antes o resultado da partida seguinte (${roundLabel(matches, next.round)}, mesa ${next.table}).` });
              }
              if (next.wins[0] + next.wins[1] > 0 || (next.roomId && lobby.get(next.roomId)?.status === 'playing')) {
                return reply.code(409).send({ error: 'A partida seguinte da chave já começou: zere o placar dela antes de corrigir esta.' });
              }
              replaceInMatch(db, t.id, next.id, oldWinner, newWinner!);
            }
          }
        }
      }
      setMatchScore(db, t.id, m.id, m.bestOf, wins, me.id);
      return detail(getTournament(db, t.id)!, me);
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
   * Abre (ou entra na) sala online do jogo atual da série. O primeiro a entrar
   * espera o oponente; o jogo começa quando os dois estão na sala.
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
    const limit = lobby.admit(req.ip, 'tournament');
    if (limit) return reply.code(limit.code).send(limit);
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
      {
        id: t.id,
        name: t.name,
        round: m.round,
        label: roundLabel(listMatches(db, t.id), m.round),
        matchId: m.id,
        game: m.wins[0] + m.wins[1] + 1,
        bestOf: m.bestOf,
        wins: { [m.p1]: m.wins[0], [m.p2]: m.wins[1] },
        firstUserId: m.nextFirst,
      },
    );
    if ('error' in r) return reply.code(r.code).send(r);
    lobby.tagIp(r.room.id, req.ip);
    if (m.roomId !== r.room.id) setMatchRoom(db, t.id, m.id, r.room.id);
    // A sala mudou de estado (criada ou começou): a página do torneio mostra isso.
    dataVersion.bump();
    return { roomId: r.room.id, token: r.token };
  });
}
