// Auditoria das partidas: replay de uma partida gravada e os problemas (bugs) relatados
// pelos jogadores ao fim de qualquer partida gravada (contra o bot, online, ranqueada ou
// de torneio), num formulário: a carta, a interação que deu problema, o que deveria ter
// acontecido e se o jogador quer ser avisado quando o problema for resolvido.
//
// Quem relata: um dos dois jogadores da partida, logado. Quem vê e resolve: admin e
// dev (tudo) e o organizador do torneio (os relatos e replays das partidas do torneio
// dele). Os próprios jogadores podem rever o replay das partidas que jogaram. Ao resolver,
// quem pediu o aviso recebe uma notificação (nos aparelhos com as notificações ligadas).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createsTournaments, isAdmin, type User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import { pushText } from '../push/messages';
import { noNotifier, type Notifier } from '../push/routes';
import { seatCards } from '../partners/matches';
import { getTournament, isListedJudge } from '../tournaments/store';
import {
  createReport,
  getReport,
  listReports,
  markReportNotified,
  type MatchReport,
  matchExtra,
  matchReplay,
  matchSummary,
  matchUsers,
  resolveReport,
} from './store';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  notifier?: Notifier;
}

const MAX_TEXT = 2000;
const MAX_CARD = 120;

/** Texto opcional do formulário: aparado e cortado (vazio = null). */
const field = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function registerReportRoutes(app: FastifyInstance, { db, user, notifier = noNotifier }: Deps) {
  const account = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    return u;
  };
  /** Pode auditar (ver relatos e replays) as partidas do torneio: admin/dev ou o organizador dele. */
  const audits = (u: User, tournamentId: string | null) => {
    if (isAdmin(u.role)) return true;
    if (!tournamentId || !createsTournaments(u.role)) return false;
    return getTournament(db, tournamentId)?.organizerId === u.id;
  };
  /** Pode ver o replay (e o resumo) de uma partida do torneio como quem audita: além deles, os Judges da lista. */
  const judges = (u: User, tournamentId: string | null) => Boolean(tournamentId && isListedJudge(db, tournamentId, u.id));
  const withMatch = (r: MatchReport) => ({ ...r, match: matchSummary(db, r.matchId) });
  /**
   * Quem jogou vê o replay da própria partida, menos num torneio em andamento: o replay traz as
   * duas listas, e as listas de um torneio só se abrem quando ele termina.
   */
  const played = (u: User, id: number, tournamentId: string | null) => {
    if (!matchUsers(db, id).includes(u.id)) return false;
    return !tournamentId || getTournament(db, tournamentId)?.status === 'finished';
  };

  /**
   * Replay de uma partida gravada: para quem jogou (num torneio, só depois do fim), para quem audita o
   * torneio, os Judges dele e admins. Com token de parceiro (matches:read), só para quem jogou.
   */
  app.get<{ Params: { id: string } }>('/api/matches/:id/replay', { config: { scope: 'matches:read' } }, async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const id = Number(req.params.id);
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const tournamentId = m.tournament?.id ?? null;
    if (!played(me, id, tournamentId) && !audits(me, tournamentId) && !judges(me, tournamentId)) {
      if (m.tournament && matchUsers(db, id).includes(me.id)) {
        return reply.code(403).send(fail('replayTournamentRunning', 'O replay desta partida fica disponível quando o torneio terminar (as listas dos decks só se abrem no fim).'));
      }
      return reply.code(403).send(fail('replayForbidden', 'Só quem jogou a partida, o organizador ou um Judge do torneio, ou um admin pode ver este replay.'));
    }
    const replay = matchReplay(db, id);
    return replay ?? reply.code(404).send(fail('noReplay', 'Esta partida não tem replay gravado.'));
  });

  /**
   * Resumo de uma partida gravada (mesmas regras de acesso do replay), com as cartas de cada
   * lado (`seats`): o próprio lado vem completo; o do oponente vem com `cards: null`, salvo
   * em torneio já encerrado (listas públicas) ou para quem audita. `you` é o assento de quem pede.
   */
  app.get<{ Params: { id: string } }>('/api/matches/:id', { config: { scope: 'matches:read' } }, async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const id = Number(req.params.id);
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const tournamentId = m.tournament?.id ?? null;
    const auditor = audits(me, tournamentId);
    const judge = judges(me, tournamentId);
    const you = m.players.find((p) => p.userId === me.id)?.seat ?? null;
    if (you === null && !auditor && !judge) return reply.code(403).send(fail('matchOfOthers', 'Partida de outros jogadores.'));
    const extra = matchExtra(db, id);
    // As duas listas: quem audita, os Judges e, em torneio já encerrado, todo mundo (as listas se abrem no fim).
    const listsPublic = auditor || judge || (tournamentId ? getTournament(db, tournamentId)?.status === 'finished' : false);
    const seats = m.players.map((p) => ({
      seat: p.seat,
      leader: p.leader,
      deckHash: extra.deckHashes[p.seat] ?? null,
      cards: p.seat === you || listsPublic ? seatCards(db, id, p.seat) : null,
    }));
    return {
      ...m,
      mode: extra.mode,
      firstPlayer: extra.firstPlayer,
      replayVersion: extra.replayVersion,
      reasonKey: extra.reasonKey,
      you,
      seats,
      reports: auditor ? listReports(db, { status: 'all' }).filter((r) => r.matchId === id) : [],
    };
  });

  /**
   * Relata um problema na partida que a conta acabou de jogar. `text`: a interação que deu
   * problema (obrigatória); `card`: a carta; `expected`: o que deveria ter acontecido;
   * `notify`: avisar quando o problema for resolvido.
   */
  app.post<{ Params: { id: string }; Body: { text?: unknown; card?: unknown; expected?: unknown; notify?: unknown } }>('/api/matches/:id/report', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const id = Number(req.params.id);
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    if (!matchUsers(db, id).includes(me.id)) return reply.code(403).send(fail('reportOnlyPlayers', 'Só quem jogou a partida pode relatar um problema.'));
    const text = field(req.body?.text, MAX_TEXT) ?? '';
    if (text.length < 5) return reply.code(400).send(fail('reportTooShort', 'Descreva o problema (pelo menos 5 letras).'));
    const input = { text, card: field(req.body?.card, MAX_CARD), expected: field(req.body?.expected, MAX_TEXT), notify: req.body?.notify === true };
    return reply.code(201).send(withMatch(createReport(db, id, m.tournament?.id ?? null, me.id, input)));
  });

  /**
   * Relatos para quem audita: admin/dev veem todos (ranqueadas e torneios); o organizador,
   * os dos torneios dele. `tournament` filtra por torneio; `status`: open (padrão), resolved, all.
   */
  app.get<{ Querystring: { tournament?: string; status?: string } }>('/api/reports', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const tournamentId = typeof req.query.tournament === 'string' && req.query.tournament ? req.query.tournament : undefined;
    const status = req.query.status === 'resolved' || req.query.status === 'all' ? req.query.status : 'open';
    if (tournamentId) {
      if (!audits(me, tournamentId)) return reply.code(403).send(fail('reportsViewForbidden', 'Só o organizador do torneio (ou um admin) vê os relatos.'));
      return { reports: listReports(db, { tournamentId, status }).map(withMatch) };
    }
    if (isAdmin(me.role)) return { reports: listReports(db, { status }).map(withMatch) };
    if (!createsTournaments(me.role)) return reply.code(403).send(fail('reportsOrganizersOnly', 'Só organizadores e admins veem os relatos.'));
    return { reports: listReports(db, { organizerId: me.id, status }).map(withMatch) };
  });

  /** Resolve (ou reabre) um relato, com uma nota opcional. Resolvido: avisa quem pediu (uma vez só). */
  app.put<{ Params: { id: string }; Body: { resolved?: unknown; note?: unknown } }>('/api/reports/:id', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const r = getReport(db, Number(req.params.id));
    if (!r) return reply.code(404).send(fail('reportNotFound', 'Relato não encontrado.'));
    if (!audits(me, r.tournamentId)) return reply.code(403).send(fail('reportResolveForbidden', 'Só o organizador do torneio (ou um admin) resolve relatos.'));
    const resolved = req.body?.resolved !== false;
    const note = field(req.body?.note, MAX_TEXT);
    const saved = resolveReport(db, r.id, me.id, resolved, note)!;
    if (resolved && saved.notify && !saved.notifiedAt) {
      markReportNotified(db, saved.id);
      const card = saved.card;
      void notifier.notify(
        { userIds: [saved.reporterId] },
        {
          category: null,
          text: (locale) => ({
            title: pushText(locale, 'reportFixedTitle'),
            body: card ? pushText(locale, 'reportFixedCardBody', { card }) : pushText(locale, 'reportFixedBody'),
          }),
          tag: `report-${saved.id}`,
          url: '/',
          ttl: 7 * 24 * 3600,
        },
      );
      return withMatch(getReport(db, saved.id)!);
    }
    return withMatch(saved);
  });
}
