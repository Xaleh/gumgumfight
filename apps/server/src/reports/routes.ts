// Auditoria das partidas: replay de uma partida gravada e os problemas relatados pelos
// jogadores ao fim de uma partida ranqueada ou de torneio.
//
// Quem relata: um dos dois jogadores da partida, logado. Quem vê e resolve: admin e
// dev (tudo) e o organizador do torneio (os relatos e replays das partidas do torneio
// dele). Os próprios jogadores podem rever o replay das partidas que jogaram.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createsTournaments, isAdmin, type User } from '../auth/store';
import type { DB } from '../db';
import { getTournament } from '../tournaments/store';
import { createReport, getReport, listReports, type MatchReport, matchReplay, matchSummary, matchUsers, resolveReport } from './store';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
}

const MAX_TEXT = 2000;

export function registerReportRoutes(app: FastifyInstance, { db, user }: Deps) {
  const account = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send({ error: 'Entre com a conta Google.' });
    return u;
  };
  /** Pode auditar (ver relatos e replays) as partidas do torneio: admin/dev ou o organizador dele. */
  const audits = (u: User, tournamentId: string | null) => {
    if (isAdmin(u.role)) return true;
    if (!tournamentId || !createsTournaments(u.role)) return false;
    return getTournament(db, tournamentId)?.organizerId === u.id;
  };
  const withMatch = (r: MatchReport) => ({ ...r, match: matchSummary(db, r.matchId) });

  /** Replay de uma partida gravada: para quem jogou, para quem audita o torneio e para admins. */
  app.get<{ Params: { id: string } }>('/api/matches/:id/replay', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const id = Number(req.params.id);
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send({ error: 'Partida não encontrada.' });
    if (!matchUsers(db, id).includes(me.id) && !audits(me, m.tournament?.id ?? null)) {
      return reply.code(403).send({ error: 'Só quem jogou a partida, o organizador do torneio ou um admin pode ver este replay.' });
    }
    const replay = matchReplay(db, id);
    return replay ?? reply.code(404).send({ error: 'Esta partida não tem replay gravado.' });
  });

  /** Resumo de uma partida gravada (mesmas regras de acesso do replay). */
  app.get<{ Params: { id: string } }>('/api/matches/:id', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const id = Number(req.params.id);
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send({ error: 'Partida não encontrada.' });
    if (!matchUsers(db, id).includes(me.id) && !audits(me, m.tournament?.id ?? null)) return reply.code(403).send({ error: 'Partida de outros jogadores.' });
    return { ...m, reports: audits(me, m.tournament?.id ?? null) ? listReports(db, { status: 'all' }).filter((r) => r.matchId === id) : [] };
  });

  /** Relata um problema na partida (ranqueada ou de torneio) que a conta acabou de jogar. */
  app.post<{ Params: { id: string }; Body: { text?: unknown } }>('/api/matches/:id/report', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const id = Number(req.params.id);
    const m = matchSummary(db, id);
    if (!m) return reply.code(404).send({ error: 'Partida não encontrada.' });
    if (!matchUsers(db, id).includes(me.id)) return reply.code(403).send({ error: 'Só quem jogou a partida pode relatar um problema.' });
    if (m.queue !== 'ranked' && m.queue !== 'tournament') {
      return reply.code(400).send({ error: 'Relatos valem para partidas ranqueadas e de torneio.' });
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_TEXT) : '';
    if (text.length < 5) return reply.code(400).send({ error: 'Descreva o problema (pelo menos 5 letras).' });
    return reply.code(201).send(withMatch(createReport(db, id, m.tournament?.id ?? null, me.id, text)));
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
      if (!audits(me, tournamentId)) return reply.code(403).send({ error: 'Só o organizador do torneio (ou um admin) vê os relatos.' });
      return { reports: listReports(db, { tournamentId, status }).map(withMatch) };
    }
    if (isAdmin(me.role)) return { reports: listReports(db, { status }).map(withMatch) };
    if (!createsTournaments(me.role)) return reply.code(403).send({ error: 'Só organizadores e admins veem os relatos.' });
    return { reports: listReports(db, { organizerId: me.id, status }).map(withMatch) };
  });

  /** Resolve (ou reabre) um relato, com uma nota opcional. */
  app.put<{ Params: { id: string }; Body: { resolved?: unknown; note?: unknown } }>('/api/reports/:id', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const r = getReport(db, Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'Relato não encontrado.' });
    if (!audits(me, r.tournamentId)) return reply.code(403).send({ error: 'Só o organizador do torneio (ou um admin) resolve relatos.' });
    const resolved = req.body?.resolved !== false;
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, MAX_TEXT) : null;
    return withMatch(resolveReport(db, r.id, me.id, resolved, note)!);
  });
}
