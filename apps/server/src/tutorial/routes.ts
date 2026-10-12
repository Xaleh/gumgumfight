// Rotas do tutorial: progresso do dono (conta ou navegador) e eventos anônimos das lições.
//
//   GET  /api/tutorial/progress        progresso do dono
//   PUT  /api/tutorial/progress        junta o progresso do navegador ao gravado (união; `reset` recomeça)
//   POST /api/tutorial/events          conta um evento de lição (sem dono, sem IP gravado)
//   GET  /api/admin/tutorial?days=30   funil por lição (admin e dev)

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isAdmin, type User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import { getProgress, mergeProgress, recordEvent, TUTORIAL_EVENTS, TUTORIAL_ID, type TutorialEvent, tutorialFunnel } from './store';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  user: (req: FastifyRequest) => User | null;
  now?: () => number;
}

/** Eventos por IP por minuto (só na memória: o IP não é gravado). */
const EVENTS_PER_MINUTE = 60;

export function registerTutorialRoutes(app: FastifyInstance, { db, viewerHash, user, now = Date.now }: Deps) {
  app.get('/api/tutorial/progress', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    return getProgress(db, owner);
  });

  app.put<{ Body: { done?: unknown; dismissed?: unknown; completed?: unknown; reset?: unknown } }>('/api/tutorial/progress', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    const b = req.body ?? {};
    if (b.done !== undefined && !Array.isArray(b.done)) return reply.code(400).send(fail('badProgress', 'Progresso inválido.'));
    const done = ((b.done as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === 'string' && TUTORIAL_ID.test(x));
    return mergeProgress(db, owner, { done, dismissed: b.dismissed === true, completed: b.completed === true, reset: b.reset === true });
  });

  const recent = new Map<string, { start: number; n: number }>();
  app.post<{ Body: { lesson?: unknown; step?: unknown; event?: unknown } }>('/api/tutorial/events', async (req, reply) => {
    const b = req.body ?? {};
    const lesson = typeof b.lesson === 'string' ? b.lesson : '';
    const step = typeof b.step === 'string' ? b.step : '';
    const event = b.event as TutorialEvent;
    if (!TUTORIAL_ID.test(lesson) || (step !== '' && !TUTORIAL_ID.test(step)) || !TUTORIAL_EVENTS.includes(event)) {
      return reply.code(400).send(fail('badEvent', 'Evento inválido.'));
    }
    const t = now();
    const key = req.ip ?? '?';
    const r = recent.get(key);
    if (!r || t - r.start > 60_000) recent.set(key, { start: t, n: 1 });
    else if (++r.n > EVENTS_PER_MINUTE) return reply.code(429).send(fail('tooManyEvents', 'Eventos demais.'));
    if (recent.size > 10_000) recent.clear();
    recordEvent(db, new Date(t).toISOString().slice(0, 10), lesson, event === 'start' || event === 'complete' ? '' : step, event);
    return reply.code(204).send();
  });

  app.get<{ Querystring: { days?: string } }>('/api/admin/tutorial', async (req, reply) => {
    const me = user(req);
    if (!me) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    if (!isAdmin(me.role)) return reply.code(403).send(fail('adminOnly', 'Só para administradores.'));
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    return { days, since, lessons: tutorialFunnel(db, since) };
  });
}
