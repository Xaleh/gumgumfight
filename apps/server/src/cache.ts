// Cache curto das respostas caras (torneio completo, estatísticas), com ETag.
//
// As páginas consultam essas rotas em intervalos fixos (o torneio a cada 5 s por
// jogador), e cada consulta refaz várias leituras no SQLite, que é síncrono e
// bloqueia o event loop das partidas online. Aqui a resposta fica pronta em memória
// e é reaproveitada enquanto nada muda: cada gravação relevante (partida gravada,
// torneio alterado, nome trocado) chama `bump()`, e uma entrada só vale enquanto a
// versão em que foi calculada é a atual (mais um TTL curto, por garantia).
//
// Com o ETag, o navegador manda `If-None-Match` e recebe 304 sem corpo quando nada
// mudou: o polling passa a custar só os headers.

import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Versão dos dados: muda a cada gravação que afeta uma resposta cacheada. */
export class DataVersion {
  private n = 0;
  get current() {
    return this.n;
  }
  bump() {
    this.n++;
  }
}

/** Versão global, compartilhada pelos módulos (uma gravação qualquer invalida tudo: simples e seguro). */
export const dataVersion = new DataVersion();

interface Entry {
  version: number;
  at: number;
  body: string;
  etag: string;
}

export class ResponseCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly version: DataVersion = dataVersion,
    /** Entradas no máximo; ao passar, o cache é esvaziado (as chaves incluem o viewer, então são muitas). */
    private readonly max = 2000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Corpo JSON (já serializado) e ETag para `key`, recalculado quando a versão ou o TTL vencem. */
  get(key: string, ttlMs: number, compute: () => unknown): Entry {
    const hit = this.entries.get(key);
    const now = this.now();
    if (hit && hit.version === this.version.current && now - hit.at < ttlMs) return hit;
    const body = JSON.stringify(compute());
    const entry: Entry = { version: this.version.current, at: now, body, etag: `"${createHash('sha1').update(body).digest('base64url')}"` };
    if (this.entries.size >= this.max) this.entries.clear();
    this.entries.set(key, entry);
    return entry;
  }

  clear() {
    this.entries.clear();
  }

  /** Responde com o JSON cacheado, ou 304 se o navegador já tem esta versão. */
  send(req: FastifyRequest, reply: FastifyReply, key: string, ttlMs: number, compute: () => unknown) {
    const entry = this.get(key, ttlMs, compute);
    // no-cache: o navegador guarda a resposta, mas revalida sempre (manda o If-None-Match).
    reply.header('etag', entry.etag).header('cache-control', 'private, no-cache');
    if (req.headers['if-none-match'] === entry.etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(entry.body);
  }
}
