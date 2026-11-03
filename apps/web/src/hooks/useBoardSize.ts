import { type RefObject, useLayoutEffect } from 'react';

/** Até esta largura (px) a mesa conta como estreita (`[data-narrow]`, a antiga `@container (max-width: 420px)`). */
const NARROW = 420;

/**
 * Mede a coluna da mesa e marca no elemento o que o CSS precisa para dimensionar as cartas:
 * `--bw` e `--bh` (largura e altura do conteúdo, em px), `data-landscape` (largura ≥ altura, a antiga
 * `@container (min-aspect-ratio: 1/1)`) e `data-narrow`. Faz isso direto no DOM, sem renderizar de novo,
 * e só quando o tamanho muda: trocar estas variáveis refaz o estilo da mesa inteira, então não pode
 * acontecer a cada jogada (era o custo da container query que vinha antes).
 */
export function useBoardSize(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let w = -1;
    let h = -1;
    const apply = (width: number, height: number) => {
      // Meio pixel não muda nenhuma carta: evita refazer o estilo por arredondamento.
      if (Math.abs(width - w) < 0.5 && Math.abs(height - h) < 0.5) return;
      w = width;
      h = height;
      el.style.setProperty('--bw', `${width}px`);
      el.style.setProperty('--bh', `${height}px`);
      el.toggleAttribute('data-landscape', width >= height);
      el.toggleAttribute('data-narrow', width <= NARROW);
    };
    // Já na primeira pintura (o ResizeObserver só avisa depois do primeiro layout).
    const cs = getComputedStyle(el);
    apply(
      el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
    );
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => apply(el.clientWidth, el.clientHeight);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      apply(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
