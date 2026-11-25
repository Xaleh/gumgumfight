// Monitoramento (A2): relata ao servidor os erros que acontecem no navegador (`POST /api/monitor/errors`), para a
// aba "Monitoramento" da Administração. Entram os erros sem tratamento (`error`), as promessas rejeitadas sem
// tratamento (`unhandledrejection`) e os erros de tela que o ErrorBoundary segura.
//
// Vai só o caminho da página (sem query string: os links de sala e de convite levam códigos), a mensagem, a pilha e
// o arquivo do build. O servidor limpa de novo e agrupa os iguais. Por página aberta, no máximo `MAX_PER_PAGE`
// relatos, e o mesmo erro só uma vez por minuto.

export type WebErrorKind = 'window' | 'promise' | 'render' | 'test';

export interface WebErrorReport {
  kind: WebErrorKind;
  message: string;
  stack?: string;
  /** Caminho da página, sem query string. */
  url: string;
  /** Arquivo do build em que o erro aconteceu (ex.: `index-AbC123.js`). */
  release: string;
}

export const MAX_PER_PAGE = 10;
const DEDUPE_MS = 60_000;

/** Barulho que não é erro do site: o aviso do ResizeObserver, erros de scripts de outros domínios e de extensões. */
export function isNoise(message: string, stack?: string): boolean {
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/^Script error\.?$/i.test(message.trim())) return true;
  return /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack ?? '');
}

/** Monta o relator: filtra o barulho, não repete o mesmo erro em menos de 1 min e para depois de `max`. */
export function createReporter({ send, now = Date.now, max = MAX_PER_PAGE }: { send: (r: WebErrorReport) => void; now?: () => number; max?: number }) {
  const last = new Map<string, number>();
  let sent = 0;
  return (r: WebErrorReport): boolean => {
    if (!r.message || isNoise(r.message, r.stack) || sent >= max) return false;
    const key = `${r.kind}\u0000${r.message}`;
    const t = now();
    const before = last.get(key);
    if (before !== undefined && t - before < DEDUPE_MS) return false;
    last.set(key, t);
    sent++;
    send({ ...r, message: r.message.slice(0, 500), stack: r.stack?.slice(0, 4000), url: r.url.split(/[?#]/)[0] });
    return true;
  };
}

/** O erro que a Administração força para conferir a captura (vira `kind: 'test'`). */
export class MonitorTestError extends Error {
  constructor() {
    super('Erro de teste do navegador (forçado na Administração)');
    this.name = 'MonitorTestError';
  }
}

/** Arquivo do build deste módulo (o nome muda a cada versão publicada). */
function release(): string {
  try {
    return new URL(import.meta.url).pathname.split('/').pop() || 'dev';
  } catch {
    return 'dev';
  }
}

let report: ((r: WebErrorReport) => boolean) | null = null;

const describe = (value: unknown): { message: string; stack?: string; test: boolean } => {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack, test: value instanceof MonitorTestError };
  return { message: typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) ?? String(value); } catch { return String(value); } })(), test: false };
};

/** Relata um erro já capturado (o ErrorBoundary chama com `render`). */
export function reportError(kind: WebErrorKind, error: unknown) {
  if (!report) return;
  const d = describe(error);
  report({ kind: d.test ? 'test' : kind, message: d.message, stack: d.stack, url: location.pathname, release: release() });
}

/** Liga a captura dos erros sem tratamento (uma vez, no main.tsx). */
export function installMonitor() {
  if (report || typeof window === 'undefined') return;
  report = createReporter({
    send: (r) => {
      fetch('/api/monitor/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r), keepalive: true }).catch(() => undefined);
    },
  });
  window.addEventListener('error', (e) => {
    // Recurso que não carregou (imagem, script): o evento não tem mensagem nem erro; não é exceção.
    if (!e.error && !e.message) return;
    reportError('window', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));
}

/** Botão da Administração: um erro sem tratamento de verdade, pelo mesmo caminho dos outros. */
export function forceBrowserError() {
  setTimeout(() => {
    throw new MonitorTestError();
  });
}
