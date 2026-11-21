// Rotas do Draft (pod de 8, com bots nos lugares vazios).
//
//   GET  /api/draft/active            o pod em que quem pede está (ou null)
//   POST /api/draft/pods              { sets: [...] } abre um pod (uma coleção, ou várias no Pack Rush draft)
//   POST /api/draft/pods/join         { code } entra (ou volta) num pod pelo código
//   GET  /api/draft/pods/:id          o que quem pede vê: lugares, o booster na mão, as próprias escolhas
//   POST /api/draft/pods/:id/start    quem criou começa (os lugares vazios viram bots)
//   POST /api/draft/pods/:id/pick     { card } fica com a carta e passa o resto
//   POST /api/draft/pods/:id/leave    sai (na espera, libera o lugar; no draft, o lugar escolhe sozinho)
//
// A tela consulta o GET a cada segundo enquanto o draft corre (o estado de um pod são poucos KB).
// No fim, `poolId` aponta o deck selado com as escolhas: a montagem e as partidas são as do Selado.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DB } from '../db';
import { fail } from '../errors';
import { ensurePlayer } from '../stats/store';
import { DraftPods, isPodError } from './pods';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  now?: () => number;
}

export function registerDraftRoutes(app: FastifyInstance, { db, viewerHash, now }: Deps): DraftPods {
  const pods = new DraftPods({ db, now });
  // Com relógio injetado (testes), os prazos só andam quando o teste chama `pods.tick()`.
  if (!now) {
    const timer = setInterval(() => pods.tick(), 1000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  const noOwner = fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).');
  const notFound = fail('draftPodNotFound', 'Pod de Draft não encontrado.');
  /** O pod de quem pede: precisa estar sentado nele. */
  const seated = (req: FastifyRequest, id: string) => {
    const owner = viewerHash(req);
    const pod = owner ? pods.get(id) : null;
    return owner && pod && pod.seats.some((s) => s.ownerHash === owner) ? { owner, pod } : null;
  };

  app.get('/api/draft/active', async (req) => {
    const owner = viewerHash(req);
    const pod = owner ? pods.activeFor(owner) : null;
    return { pod: pod && owner ? { id: pod.id, code: pod.code, sets: pod.sets, status: pod.status } : null };
  });

  app.post<{ Body: { sets?: unknown; set?: unknown } }>('/api/draft/pods', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(noOwner);
    const sets = Array.isArray(req.body?.sets) ? req.body.sets.filter((s): s is string => typeof s === 'string') : typeof req.body?.set === 'string' ? [req.body.set] : [];
    const pod = pods.create(owner, ensurePlayer(db, owner).name, sets);
    if (isPodError(pod)) return reply.code(pod.code).send(pod);
    return reply.code(201).send(pods.view(pod, owner));
  });

  app.post<{ Body: { code?: unknown } }>('/api/draft/pods/join', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(noOwner);
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!/^[A-Za-z0-9]{6}$/.test(code.trim())) return reply.code(400).send(fail('draftBadCode', 'Código de pod inválido.'));
    const pod = pods.join(code, owner, ensurePlayer(db, owner).name);
    if (isPodError(pod)) return reply.code(pod.code).send(pod);
    return pods.view(pod, owner);
  });

  app.get<{ Params: { id: string } }>('/api/draft/pods/:id', async (req, reply) => {
    const found = seated(req, req.params.id);
    if (!found) return reply.code(404).send(notFound);
    pods.touch(found.pod, found.owner);
    return pods.view(found.pod, found.owner);
  });

  app.post<{ Params: { id: string } }>('/api/draft/pods/:id/start', async (req, reply) => {
    const found = seated(req, req.params.id);
    if (!found) return reply.code(404).send(notFound);
    const err = pods.start(found.pod, found.owner);
    return err ? reply.code(err.code).send(err) : pods.view(found.pod, found.owner);
  });

  app.post<{ Params: { id: string }; Body: { card?: unknown } }>('/api/draft/pods/:id/pick', async (req, reply) => {
    const found = seated(req, req.params.id);
    if (!found) return reply.code(404).send(notFound);
    const err = pods.pick(found.pod, found.owner, req.body?.card);
    return err ? reply.code(err.code).send(err) : pods.view(found.pod, found.owner);
  });

  app.post<{ Params: { id: string } }>('/api/draft/pods/:id/leave', async (req, reply) => {
    const found = seated(req, req.params.id);
    if (found) pods.leave(found.pod, found.owner);
    return reply.code(204).send();
  });

  return pods;
}
