import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { poll } from '../src/poll';

/** `document` mínimo (os testes rodam em Node): visibilidade e os listeners dela. */
function fakeDocument(hidden = false) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    show() {
      doc.hidden = false;
      for (const fn of listeners) fn();
    },
    hide() {
      doc.hidden = true;
      for (const fn of listeners) fn();
    },
    listeners,
  };
  (globalThis as { document?: unknown }).document = doc;
  return doc;
}

/** Deixa as promessas pendentes andarem (sem avançar o relógio). */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('poll: consultas periódicas sem acúmulo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeDocument();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
  });

  it('chama agora e de novo a cada intervalo, contado a partir do fim da anterior', async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = poll(run, 1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('nunca sobrepõe: enquanto uma consulta está pendente, nenhuma outra sai', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const stop = poll(run, 1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('falhas dobram o espaçamento até o teto; um sucesso volta ao normal', async () => {
    let ok = false;
    const calls: number[] = [];
    const run = vi.fn(() => {
      calls.push(Date.now());
      return ok ? Promise.resolve() : Promise.reject(new Error('fora do ar'));
    });
    const stop = poll(run, 1000, { max: 4 });
    await flush();
    // Falhando: 1 s (intervalo normal), 2 s, 4 s, 4 s (teto 4 × 1 s), 4 s…
    for (const wait of [1000, 2000, 4000, 4000, 4000]) {
      const before = run.mock.calls.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(run).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(before + 1);
    }
    ok = true;
    await vi.advanceTimersByTimeAsync(4000); // a última tentativa (ainda no teto) dá certo
    const n = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000); // e a seguinte volta ao intervalo normal
    expect(run).toHaveBeenCalledTimes(n + 1);
    stop();
  });

  it('com a aba escondida não consulta; ao aparecer, consulta na hora', async () => {
    const doc = fakeDocument(true);
    const run = vi.fn(() => Promise.resolve());
    const stop = poll(run, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
    doc.show();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    doc.hide();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    expect(doc.listeners.size).toBe(0);
  });

  it('immediate: false espera o primeiro intervalo', async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = poll(run, 1000, { immediate: false });
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('uma função que lança na hora conta como falha, sem derrubar o ciclo', async () => {
    let n = 0;
    const run = vi.fn(() => {
      if (n++ === 0) throw new Error('bum');
      return Promise.resolve();
    });
    const stop = poll(run, 1000);
    await flush();
    await vi.advanceTimersByTimeAsync(1000); // falhou: tenta de novo no intervalo normal
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });
});
