// Bot do Time (docs/plano-bot-time.md): as correções que o Time envia sobre o bot.
//
//   GET  /api/bot/profiles            os decks do meta com o estado do guia e do perfil (só o Time)
//   GET  /api/bot/profiles/:id        o perfil (o que o bot lê) e o guia de um deck do meta
//   PUT  /api/bot/profiles/:id        salva o guia e/ou o perfil no banco (só admin; o perfil é conferido)
//   GET  /api/bot/agent               o agente fora da partida está ligado (BOT_AGENT_API_KEY)
//   POST /api/bot/profiles/:id/generate   agente: guia → rascunho do perfil, para revisar (só admin)
//   POST /api/bot/matches/:id/review      agente: traço da partida x guia → discrepâncias (só admin)
//   POST /api/bot/feedback            marcações de jogadas, a nota e o relatório de uma partida contra o bot (só o Time)
//   GET  /api/bot/reports?used=0|1    os relatórios das partidas (o texto que a mesa monta)
//   PUT  /api/bot/reports/:id         marca como usado (só admin)
//   GET  /api/bot/reports/package?ids=  pacote para o Claude: relatórios + guia + perfil + replay (markdown)
//   GET  /api/bot/feedback?status=    a caixa de correções (o Time lê; admin trata)
//   GET  /api/bot/feedback/summary    resumo por deck do bot (partidas avaliadas, nota média, marcações)
//   GET  /api/bot/feedback/:id        uma correção com a posição (a visão do bot) para virar teste
//   PUT  /api/bot/feedback/:id        estado e resposta (só admin)
//
// A marcação guarda a visão exata do bot na jogada (o replay é refeito até ela): é o que um teste de
// posição precisa. A nota é 1 a 5 por partida.

import { type Action, type DeckList, identityAliases, isBotLevel, validateProfile, viewFor } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAdmin, isTeam, type User } from '../auth/store';
import { type DB, getCards, getDeck } from '../db';
import { describeAction, positionAt } from '../decisions/extract';
import { fail } from '../errors';
import { type Complete, draftProfile, reviewMatch } from './agent';
import type { MetaProfiles } from './profiles';
import { matchTrace } from './trace';
import { buildPackage, packageName } from './package';
import { matchReplay } from '../reports/store';
import { createFeedback, feedbackByDeck, type FeedbackInput, getFeedback, getReports, isFeedbackStatus, listFeedback, listReports, saveReport, setFeedbackStatus, setReportUsed } from './store';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  profiles: MetaProfiles;
  /** O agente fora da partida (null = desligado). */
  complete?: Complete | null;
}

const MAX_TEXT = 2000;
/** Tamanho máximo do relatório (markdown) e relatórios por pacote. */
const MAX_REPORT = 60_000;
const MAX_PACKAGE = 20;
const MAX_MARKS = 40;

const field = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

type MatchRow = { id: number; mode: string; queue: string | null; deck0: string | null; deck1: string | null };

export function registerTeamRoutes(app: FastifyInstance, { db, user, profiles, complete = null }: Deps) {
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

  app.post<{ Body: { matchId?: unknown; level?: unknown; rating?: unknown; comment?: unknown; marks?: unknown; report?: unknown } }>('/api/bot/feedback', async (req, reply) => {
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
    // O relatório da partida (markdown montado pela mesa com as jogadas marcadas), para o pacote do Claude.
    const report = typeof req.body?.report === 'string' && req.body.report.trim() ? req.body.report.trim().slice(0, MAX_REPORT) : null;
    if (rating === null && !marks.length && !report) return reply.code(400).send(fail('feedbackEmpty', 'Envie a nota ou pelo menos uma marcação.'));

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
      const mk = raw as { index?: unknown; step?: unknown; expected?: unknown; comment?: unknown };
      const index = Number(mk?.index);
      if (!Number.isInteger(index) || index < 0) return reply.code(400).send(fail('invalidMark', 'Marcação inválida: posição da jogada.'));
      const step = mk.step === undefined || mk.step === null ? null : Number(mk.step);
      if (step !== null && !(Number.isInteger(step) && step >= 0 && step < 60)) return reply.code(400).send(fail('invalidMark', 'Marcação inválida: posição da jogada.'));
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
        step,
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
    const reportId = report
      ? saveReport(db, { matchId, userId: me.id, botLevel: level, botDeck: base.botDeck, leader: base.leader, oppLeader: base.oppLeader, rating, marks: marks.length, report })
      : null;
    return reply.code(201).send({ ids, reportId });
  });

  /** Os relatórios das partidas (`used=0`: só os ainda não usados). */
  app.get<{ Querystring: { used?: string } }>('/api/bot/reports', async (req, reply) => {
    if (!member(req, reply)) return reply;
    const used = req.query.used === '0' ? false : req.query.used === '1' ? true : undefined;
    return { reports: listReports(db, { used }) };
  });

  /** Marca (ou desmarca) um relatório como já usado para melhorar o bot. Só admin. */
  app.put<{ Params: { id: string }; Body: { used?: unknown } }>('/api/bot/reports/:id', async (req, reply) => {
    const me = member(req, reply);
    if (!me) return reply;
    if (!isAdmin(me.role)) return reply.code(403).send(fail('adminOnly', 'Só administradores tratam as correções.'));
    if (typeof req.body?.used !== 'boolean') return reply.code(400).send(fail('invalidStatus', 'Estado inválido.'));
    if (!setReportUsed(db, Number(req.params.id), req.body.used, me.id)) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    return getReports(db, [Number(req.params.id)])[0];
  });

  /**
   * O pacote para o Claude (markdown): os relatórios escolhidos e, por deck do bot, o guia e o perfil atuais, e o replay
   * de cada partida. `ids`: até 20, separados por vírgula.
   */
  app.get<{ Querystring: { ids?: string } }>('/api/bot/reports/package', async (req, reply) => {
    if (!member(req, reply)) return reply;
    const ids = [...new Set(String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_PACKAGE);
    const reports = getReports(db, ids);
    if (!reports.length) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    return { filename: packageName(reports), content: buildPackage(reports, (id) => ({ guide: profiles.guide(id), profile: profiles.profile(id) }), (id) => matchReplay(db, id)) };
  });

  /** Os decks do meta, com o estado do guia e do perfil de cada um (a aba "Bot do Time"). */
  app.get('/api/bot/profiles', async (req, reply) => {
    if (!member(req, reply)) return reply;
    return { decks: profiles.list() };
  });

  /**
   * O perfil (o que o bot lê) e o guia de um deck do meta; o treino no navegador no nível Time usa o perfil. Com
   * `?leader=`, um deck que não é do meta (o de um jogador) recebe o do deck do meta com o mesmo Líder.
   */
  app.get<{ Params: { id: string }; Querystring: { leader?: string } }>('/api/bot/profiles/:id', async (req, reply) => {
    if (!member(req, reply)) return reply;
    const list = profiles.list();
    const leader = typeof req.query.leader === 'string' ? req.query.leader : null;
    const id = list.some((d) => d.id === req.params.id) ? req.params.id : (profiles.profileFor(null, leader)?.id ?? req.params.id);
    const info = list.find((d) => d.id === id);
    if (!info) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    return { ...info, profile: profiles.profile(info.id), guide: profiles.guide(info.id) };
  });

  /** Admin logado do Time, ou 401/403. */
  const admin = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = member(req, reply);
    if (!u) return null;
    if (!isAdmin(u.role)) {
      void reply.code(403).send(fail('adminOnly', 'Só administradores editam os decks do meta.'));
      return null;
    }
    return u;
  };

  /** Salva o guia (markdown) e/ou o perfil (conferido) de um deck do meta no banco; `null` volta ao arquivo. */
  app.put<{ Params: { id: string }; Body: { guide?: unknown; profile?: unknown } }>('/api/bot/profiles/:id', async (req, reply) => {
    const me = admin(req, reply);
    if (!me) return reply;
    const info = profiles.list().find((d) => d.id === req.params.id);
    if (!info) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    const patch: { guide?: string | null; profile?: import('@gumgum/engine').DeckProfile | null } = {};
    if (req.body?.guide !== undefined) {
      if (req.body.guide !== null && typeof req.body.guide !== 'string') return reply.code(400).send(fail('invalidGuide', 'O guia é um texto (markdown).'));
      patch.guide = req.body.guide === null || !req.body.guide.trim() ? null : req.body.guide.slice(0, 60_000);
    }
    if (req.body?.profile !== undefined) {
      if (req.body.profile === null) patch.profile = null;
      else {
        const p = validateProfile(typeof req.body.profile === 'string' ? safeJson(req.body.profile) : req.body.profile);
        if (typeof p === 'string') return reply.code(400).send(fail('invalidProfile', `Perfil inválido: ${p}`, { reason: p }));
        if (p.id !== info.id) return reply.code(400).send(fail('invalidProfile', `Perfil inválido: id ${p.id} não é ${info.id}`, { reason: `id ${p.id}` }));
        patch.profile = p;
      }
    }
    if (patch.guide === undefined && patch.profile === undefined) return reply.code(400).send(fail('nothingToSave', 'Nada para salvar.'));
    profiles.save(info.id, patch, me.id);
    const after = profiles.list().find((d) => d.id === info.id)!;
    return { ...after, profile: profiles.profile(info.id), guide: profiles.guide(info.id) };
  });

  app.get('/api/bot/agent', async (req, reply) => {
    if (!member(req, reply)) return reply;
    return { enabled: complete !== null };
  });

  /** Agente: o guia vira um rascunho de perfil (não salva: o admin revisa e salva pelo PUT). */
  app.post<{ Params: { id: string } }>('/api/bot/profiles/:id/generate', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!complete) return reply.code(503).send(fail('agentOff', 'O agente está desligado neste servidor (BOT_AGENT_API_KEY).'));
    const info = profiles.list().find((d) => d.id === req.params.id);
    if (!info) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    const guide = profiles.guide(info.id);
    if (!guide) return reply.code(400).send(fail('noGuide', 'Este deck ainda não tem guia.'));
    const deck = getDeck(db, info.id) as DeckList | null;
    if (!deck) return reply.code(404).send(fail('notFound', 'Não encontrado'));
    const cards = getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]);
    try {
      const r = await draftProfile(complete, { deck, cards, guide });
      if ('error' in r) return reply.code(422).send(fail('agentBadProfile', `O agente não devolveu um perfil válido: ${r.error}`, { reason: r.error }));
      return { profile: r.profile, why: r.why };
    } catch (e) {
      return reply.code(502).send(fail('agentFailed', `O agente falhou: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  /** Agente: a partida gravada (o lado do bot) comparada com o guia do deck que ele jogou. */
  app.post<{ Params: { id: string }; Body: { deckId?: unknown } }>('/api/bot/matches/:id/review', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!complete) return reply.code(503).send(fail('agentOff', 'O agente está desligado neste servidor (BOT_AGENT_API_KEY).'));
    const matchId = Number(req.params.id);
    const m = db.prepare('SELECT deck0, deck1 FROM matches WHERE id = ?').get(matchId) as { deck0: string | null; deck1: string | null } | undefined;
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const bot = db.prepare("SELECT seat FROM match_seats WHERE match_id = ? AND controller = 'bot'").get(matchId) as { seat: 0 | 1 } | undefined;
    if (!bot) return reply.code(400).send(fail('notBotMatch', 'Só partidas contra o bot recebem correções.'));
    const deckId = typeof req.body?.deckId === 'string' ? req.body.deckId : ((bot.seat === 0 ? m.deck0 : m.deck1) ?? null);
    const guide = deckId ? profiles.guide(deckId) : null;
    if (!guide) return reply.code(400).send(fail('noGuide', 'Este deck ainda não tem guia.'));
    const trace = matchTrace(db, matchId, bot.seat);
    if (!trace) return reply.code(422).send(fail('markNotReplayable', 'O replay desta partida não refaz até essa jogada.'));
    try {
      return { deckId, review: await reviewMatch(complete, { guide, profile: deckId ? profiles.profile(deckId) : null, trace }) };
    } catch (e) {
      return reply.code(502).send(fail('agentFailed', `O agente falhou: ${e instanceof Error ? e.message : String(e)}`));
    }
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
