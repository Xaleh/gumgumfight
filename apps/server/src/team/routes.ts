// Bot do Time (docs/plano-bot-time.md): as correções que o Time envia sobre o bot.
//
//   POST /api/bot/feedback            marcações de jogadas e a nota de uma partida contra o bot (só o Time)
//   GET  /api/bot/feedback?status=    a caixa de correções (o Time lê; admin trata)
//   GET  /api/bot/feedback/summary    resumo por deck do bot (partidas avaliadas, nota média, marcações)
//   GET  /api/bot/feedback/:id        uma correção com a posição (a visão do bot) para virar teste
//   PUT  /api/bot/feedback/:id        estado e resposta (só admin)
//
// A marcação guarda a visão exata do bot na jogada (o replay é refeito até ela): é o que um teste de
// posição precisa. A nota é 1 a 5 por partida.

import { type Action, identityAliases, isBotLevel, viewFor } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAdmin, isTeam, type User } from '../auth/store';
import type { DB } from '../db';
import { describeAction, positionAt } from '../decisions/extract';
import { fail } from '../errors';
import { createFeedback, feedbackByDeck, type FeedbackInput, getFeedback, isFeedbackStatus, listFeedback, setFeedbackStatus } from './store';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
}

const MAX_TEXT = 2000;
const MAX_MARKS = 40;

const field = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

type MatchRow = { id: number; mode: string; queue: string | null; deck0: string | null; deck1: string | null };

export function registerTeamRoutes(app: FastifyInstance, { db, user }: Deps) {
  /** Conta do Time (ou admin), ou responde 401/403. */
  const member = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) {
      void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      return null;
    }
    if (!isTeam(u)) {
      void reply.code(403).send(fail('teamOnly', 'O Bot do Time é só para quem faz parte do Time.'));
      return null;
    }
    return u;
  };

  app.post<{ Body: { matchId?: unknown; level?: unknown; rating?: unknown; comment?: unknown; marks?: unknown } }>('/api/bot/feedback', async (req, reply) => {
    const me = member(req, reply);
    if (!me) return reply;
    const matchId = Number(req.body?.matchId);
    if (!Number.isInteger(matchId)) return reply.code(400).send(fail('invalidMatch', 'Partida inválida.'));
    const m = db.prepare('SELECT id, mode, queue, deck0, deck1 FROM matches WHERE id = ?').get(matchId) as MatchRow | undefined;
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const seats = db.prepare('SELECT seat, controller, leader FROM match_seats WHERE match_id = ? ORDER BY seat').all(matchId) as Array<{ seat: number; controller: string; leader: string }>;
    const botSeat = seats.find((s) => s.controller === 'bot');
    const human = seats.find((s) => s.controller === 'human');
    if (!botSeat || !human || (m.mode !== 'bot' && m.queue !== 'bot')) return reply.code(400).send(fail('notBotMatch', 'Só partidas contra o bot recebem correções.'));
    const level = req.body?.level === undefined ? null : req.body.level;
    if (level !== null && !isBotLevel(level)) return reply.code(400).send(fail('invalidBotLevel', 'Nível do bot inválido.'));
    const rating = req.body?.rating === undefined || req.body?.rating === null ? null : Number(req.body.rating);
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return reply.code(400).send(fail('invalidRating', 'A nota vai de 1 a 5.'));
    const marks = Array.isArray(req.body?.marks) ? (req.body.marks as unknown[]) : [];
    if (marks.length > MAX_MARKS) return reply.code(400).send(fail('tooManyMarks', `No máximo ${MAX_MARKS} marcações por partida.`));
    const comment = field(req.body?.comment, MAX_TEXT);
    if (rating === null && !marks.length) return reply.code(400).send(fail('feedbackEmpty', 'Envie a nota ou pelo menos uma marcação.'));

    const base = {
      matchId,
      userId: me.id,
      botLevel: level,
      botSeat: botSeat.seat,
      botDeck: (botSeat.seat === 0 ? m.deck0 : m.deck1) ?? null,
      leader: botSeat.leader,
      oppLeader: human.leader,
    };
    const inputs: FeedbackInput[] = [];
    for (const raw of marks) {
      const mk = raw as { index?: unknown; expected?: unknown; comment?: unknown };
      const index = Number(mk?.index);
      if (!Number.isInteger(index) || index < 0) return reply.code(400).send(fail('invalidMark', 'Marcação inválida: posição da jogada.'));
      const pos = positionAt(db, matchId, index);
      if (!pos) return reply.code(422).send(fail('markNotReplayable', 'O replay desta partida não refaz até essa jogada.'));
      if (pos.action.player !== botSeat.seat) return reply.code(400).send(fail('markNotBotAction', 'A jogada marcada não é do bot.'));
      const expected = mk.expected;
      const expectedJson =
        expected && typeof expected === 'object' && typeof (expected as { type?: unknown }).type === 'string'
          ? JSON.stringify(expected).slice(0, MAX_TEXT)
          : typeof expected === 'string'
            ? JSON.stringify(expected.trim().slice(0, MAX_TEXT))
            : null;
      const aliases = identityAliases(pos.state);
      const view = viewFor(pos.state, pos.action.player, aliases);
      inputs.push({
        ...base,
        kind: 'mark',
        actionIndex: index,
        turn: pos.state.turn,
        botAction: JSON.stringify(describeAction(pos.state, pos.action as Action)),
        expected: expectedJson,
        position: JSON.stringify({ ...view, log: [], checkpoint: undefined }),
        rating: null,
        comment: field(mk.comment, MAX_TEXT),
      });
    }
    if (rating !== null) {
      inputs.push({ ...base, kind: 'rating', actionIndex: null, turn: null, botAction: null, expected: null, position: null, rating, comment });
    }
    const ids = inputs.map((f) => createFeedback(db, f));
    return reply.code(201).send({ ids });
  });

  app.get<{ Querystring: { status?: string } }>('/api/bot/feedback', async (req, reply) => {
    if (!member(req, reply)) return reply;
    const status = req.query.status === 'all' || isFeedbackStatus(req.query.status) ? req.query.status : 'open';
    return { items: listFeedback(db, status) };
  });

  app.get('/api/bot/feedback/summary', async (req, reply) => {
    if (!member(req, reply)) return reply;
    return { decks: feedbackByDeck(db) };
  });

  app.get<{ Params: { id: string } }>('/api/bot/feedback/:id', async (req, reply) => {
    if (!member(req, reply)) return reply;
    const item = getFeedback(db, Number(req.params.id));
    if (!item) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    return item;
  });

  app.put<{ Params: { id: string }; Body: { status?: unknown; note?: unknown } }>('/api/bot/feedback/:id', async (req, reply) => {
    const me = member(req, reply);
    if (!me) return reply;
    if (!isAdmin(me.role)) return reply.code(403).send(fail('adminOnly', 'Só administradores tratam as correções.'));
    const status = req.body?.status;
    if (!isFeedbackStatus(status)) return reply.code(400).send(fail('invalidStatus', 'Estado inválido.'));
    if (!setFeedbackStatus(db, Number(req.params.id), status, field(req.body?.note, MAX_TEXT), me.id)) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    return getFeedback(db, Number(req.params.id));
  });
}
