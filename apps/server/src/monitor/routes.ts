// Rotas do monitoramento (A2).
//
//   POST   /api/monitor/errors                  o navegador relata um erro (sem login; limite por IP)
//   GET    /api/admin/monitor[?resolved=1]      painel (admin/dev): erros, canais SSE, processo
//   POST   /api/admin/monitor/test-error        erro forçado no servidor (para conferir a captura)
//   POST   /api/admin/monitor/errors/:id/resolve
//   DELETE /api/admin/monitor/errors[?all=1]    apaga os resolvidos (ou todos)
//
// Os erros do servidor entram pelo hook `onError` do Fastify (qualquer erro lançado numa rota que vira 5xx: a
// resposta continua a mesma de antes) e por `watchProcess` (exceções e promessas rejeitadas sem tratamento, antes
// de o processo cair e o pm2 subi-lo de novo).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isAdmin, type User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import { SseMetrics } from './sse';
import { clearErrors, errorCounts, listErrors, recordError, resolveError } from './store';

/** Relatos do navegador aceitos por IP a cada 10 min (o resto é ignorado em silêncio, com 429). */
export const WEB_REPORTS_PER_IP = 20;
const WEB_WINDOW_MS = 10 * 60_000;
const WEB_KINDS = new Set(['window', 'promise', 'render', 'test']);

/** A versão que está no ar: `RELEASE`, o arquivo `VERSION` do pacote (commit) ou `dev`. */
export function currentRelease(env = process.env): string {
  if (env.RELEASE?.trim()) return env.RELEASE.trim().slice(0, 40);
  for (const dir of [dirname(process.argv[1] ?? '.'), process.cwd()]) {
    try {
      const v = readFileSync(join(dir, '..', 'VERSION'), 'utf8').trim();
      if (v) return v.slice(0, 12);
    } catch {
      // sem pacote: desenvolvimento
    }
  }
  return 'dev';
}

/** Exceções e promessas rejeitadas sem tratamento: grava antes de o processo cair (sem mudar esse comportamento). */
export function watchProcess(db: DB, release = currentRelease()) {
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      recordError(db, { source: 'server', kind: origin === 'unhandledRejection' ? 'rejection' : 'uncaught', message: e.message, stack: e.stack, release });
    } catch {
      // o banco pode ser a causa: não atrapalha a queda
    }
  });
}

export interface MonitorDeps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  now?: () => number;
  release?: string;
  /** Métricas dos canais SSE (as mesmas passadas às rotas online e do Yonko). */
  sse: SseMetrics;
}

export function registerMonitorRoutes(app: FastifyInstance, deps: MonitorDeps) {
  const { db, user, sse } = deps;
  const now = deps.now ?? Date.now;
  const release = deps.release ?? currentRelease();
  const startedAt = now();
  sse.start();
  app.addHook('onClose', async () => sse.stop());

  // Erro lançado numa rota: grava os 5xx (os 4xx lançados, como corpo inválido, são do cliente).
  app.addHook('onError', async (req, _reply, err) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return;
    try {
      recordError(db, {
        source: 'server',
        kind: req.routeOptions.url === '/api/admin/monitor/test-error' ? 'test' : 'route',
        message: err.message,
        stack: err.stack,
        url: `${req.method} ${req.routeOptions.url ?? (req.url.split('?')[0] || '/')}`,
        status,
        release,
      });
    } catch (e) {
      req.log.error(e, 'monitor: falha ao gravar o erro');
    }
  });

  const hits = new Map<string, { n: number; since: number }>();
  app.post<{ Body: Record<string, unknown> }>('/api/monitor/errors', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const t = now();
    if (hits.size > 5000) for (const [ip, h] of hits) if (t - h.since > WEB_WINDOW_MS) hits.delete(ip);
    const h = hits.get(req.ip);
    if (!h || t - h.since > WEB_WINDOW_MS) hits.set(req.ip, { n: 1, since: t });
    else if (++h.n > WEB_REPORTS_PER_IP) return reply.code(429).send(fail('tooManyReports', 'Relatos demais.'));
    const b = req.body ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const message = str(b.message);
    const kind = str(b.kind);
    if (!message || !kind || !WEB_KINDS.has(kind)) return reply.code(400).send(fail('badErrorReport', 'Relato de erro inválido.'));
    recordError(db, {
      source: 'web',
      kind,
      message,
      stack: str(b.stack),
      url: str(b.url),
      release: str(b.release),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    return reply.code(204).send();
  });

  const adminOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const me = user(req);
    if (!me) void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    else if (!isAdmin(me.role)) void reply.code(403).send(fail('adminOnly', 'Só para administradores.'));
    return Boolean(me && isAdmin(me.role));
  };

  app.get<{ Querystring: { resolved?: string } }>('/api/admin/monitor', async (req, reply) => {
    if (!adminOnly(req, reply)) return reply;
    const mem = process.memoryUsage();
    return {
      release,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      memory: { rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
      errors: { counts: errorCounts(db), list: listErrors(db, { resolved: req.query.resolved === '1' }) },
      sse: sse.snapshot(),
    };
  });

  app.post('/api/admin/monitor/test-error', async (req, reply) => {
    if (!adminOnly(req, reply)) return reply;
    throw new Error('Erro de teste do monitoramento (forçado na Administração)');
  });

  app.post<{ Params: { id: string } }>('/api/admin/monitor/errors/:id/resolve', async (req, reply) => {
    if (!adminOnly(req, reply)) return reply;
    if (!resolveError(db, req.params.id)) return reply.code(404).send(fail('errorNotFound', 'Erro não encontrado.'));
    return { ok: true };
  });

  app.delete<{ Querystring: { all?: string } }>('/api/admin/monitor/errors', async (req, reply) => {
    if (!adminOnly(req, reply)) return reply;
    return { removed: clearErrors(db, req.query.all === '1') };
  });
}
