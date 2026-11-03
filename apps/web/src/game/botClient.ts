// Pede a jogada do bot ao Web Worker (botWorker.ts), para a busca não travar a página.
//
// Sem Worker (navegador sem suporte, arquivo do worker indisponível offline, testes), ou se ele
// quebrar, o cálculo roda na própria página como antes, logo depois da renderização.

import { type BotMove, type BotRequest, computeBotMove } from './botMove';
import type { WorkerReply, WorkerRequest } from './botWorker';

/** undefined: ainda não tentou; null: sem worker (calcula na página). */
let worker: Worker | null | undefined;
let nextId = 1;
/** Pedidos esperando resposta do worker: o que fazer com a resposta e como refazer na página se ele quebrar. */
const waiting = new Map<number, { reply: (r: WorkerReply) => void; fallback: () => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    const w = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const job = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      job?.reply(e.data);
    };
    // O worker não abriu ou quebrou: dali em diante tudo na página, inclusive o que estava esperando.
    const broken = () => {
      if (worker !== w) return;
      worker = null;
      w.terminate();
      const jobs = [...waiting.values()];
      waiting.clear();
      for (const job of jobs) job.fallback();
    };
    w.onerror = broken;
    w.onmessageerror = broken;
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Calcula na página, numa tarefa à parte (a renderização que pediu a jogada termina antes). */
function local(req: BotRequest, resolve: (m: BotMove) => void, reject: (e: unknown) => void): () => void {
  const timer = setTimeout(() => {
    try {
      resolve(computeBotMove(req));
    } catch (e) {
      reject(e);
    }
  }, 0);
  return () => clearTimeout(timer);
}

/**
 * Começa a pensar a jogada do bot. `cancel` descarta a resposta (a mesa mudou, pausa): o worker
 * termina a conta, mas o resultado é ignorado.
 */
export function thinkBot(req: BotRequest): { result: Promise<BotMove>; cancel: () => void } {
  let cancel = () => {};
  const result = new Promise<BotMove>((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      cancel = local(req, resolve, reject);
      return;
    }
    const id = nextId++;
    let stopLocal: (() => void) | null = null;
    waiting.set(id, {
      reply: (r) => (r.ok ? resolve(r.move) : reject(new Error(r.error))),
      fallback: () => {
        stopLocal = local(req, resolve, reject);
      },
    });
    cancel = () => {
      waiting.delete(id);
      stopLocal?.();
    };
    try {
      w.postMessage({ ...req, id } satisfies WorkerRequest);
    } catch {
      // O estado não pôde ser copiado para o worker (não deveria): calcula na página.
      waiting.delete(id);
      cancel = local(req, resolve, reject);
    }
  });
  return { result, cancel };
}
