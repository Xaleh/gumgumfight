import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const LONG_PRESS_MS = 420;
/** Mover o dedo mais do que isto cancela (o usuário está rolando). */
const MOVE_LIMIT = 10;

/**
 * Pressionar e segurar com o dedo (ou caneta): dispara `onLongPress`; o mouse não entra (ele tem hover).
 * Depois de disparar, o clique e o menu de contexto que o navegador manda em seguida devem ser ignorados:
 * `consume()` diz se o evento atual veio de um toque (longo ou não); a flag só zera no próximo pointerdown.
 */
export function useLongPress<T extends HTMLElement>(onLongPress?: (e: ReactPointerEvent<T>) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touch = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const onPointerDown = (e: ReactPointerEvent<T>) => {
    fired.current = false;
    touch.current = e.pointerType !== 'mouse';
    if (!onLongPress || !touch.current) return;
    clear();
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      start.current = null;
      fired.current = true;
      navigator.vibrate?.(12);
      onLongPress(e);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<T>) => {
    const s = start.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_LIMIT) clear();
  };

  /** O toque longo acabou de disparar: o clique/menu de contexto seguinte é dele e deve ser ignorado. */
  const consume = () => fired.current;
  /** O ponteiro atual é um dedo/caneta (não existe "botão direito"). */
  const isTouch = () => touch.current;

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear },
    consume,
    isTouch,
  };
}
