// Tempo das animações da mesa, compartilhado com quem decide quando o bot age.
//
// A camada de animação (components/Motion.tsx) avisa até quando as cartas ainda
// estão voando; o bot (useGame) espera esse tempo antes da próxima jogada, para
// cada animação terminar antes de a mesa mudar de novo.

let busyUntil = 0;

/** Marca a mesa como ocupada por mais `ms` milissegundos (a partir de agora). */
export function holdMotion(ms: number) {
  busyUntil = Math.max(busyUntil, performance.now() + ms);
}

/** Quanto falta para as animações em andamento terminarem (0 se nenhuma). */
export function motionWait(): number {
  return Math.max(0, busyUntil - performance.now());
}

/** O sistema pede menos movimento (acessibilidade). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
