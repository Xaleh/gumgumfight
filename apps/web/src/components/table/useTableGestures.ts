// Os gestos da mesa: o toque longo (abre a carta) e o arrasto (carta da mão, atacante, DON!! da fileira e DON!!
// anexado). O `Table` diz o que é um destino válido e o que fazer ao soltar.

import { useEffect, useRef } from 'react';
import type { Drag, DragKind, Mode } from './shared';

const LONG_PRESS_MS = 420;
const DRAG_THRESHOLD = 9;
/** Quanto puxar a carta da mão para cima até ela "sair" (arrastar). */
const HAND_PULL = 22;
/** Com o mouse, deslizar a carta da mão para os lados já começa a arrastá-la (reordenar ou jogar). */
const HAND_SLIDE = 14;

export function useTableGestures({
  mode,
  dropValid,
  onCard,
  onDrop,
  setDrag,
  setLifted,
  setZoom,
  setMode,
}: {
  mode: Mode;
  /** Destinos válidos para o que está sendo arrastado. */
  dropValid: (d: Pick<Drag, 'kind' | 'uid'>, over: string | null) => boolean;
  /** O toque numa carta (deslizar pela mão e soltar numa carta vale como um toque nela). */
  onCard: (uid: string) => void;
  /** Soltou o que arrastava. */
  onDrop: (d: Drag) => void;
  setDrag: (d: Drag | null) => void;
  /** A carta da mão erguida sob o dedo. */
  setLifted: (uid: string | null) => void;
  setZoom: (uid: string | null) => void;
  setMode: (m: Mode) => void;
}) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const press = useRef<{
    x: number;
    y: number;
    /** Âncora do toque longo (recomeça quando o dedo anda). */
    ax: number;
    ay: number;
    uid: string | null;
    kind: DragKind | null;
    /** Posição na fileira do DON!! ativo pressionado. */
    don?: number;
    timer: ReturnType<typeof setTimeout>;
    moved: boolean;
    /** Começou na própria mão: deslizar ergue a carta sob o dedo. */
    hand: boolean;
    browsed: boolean;
    /** Mouse: deslizar para os lados na mão arrasta a carta (no toque, folheia). */
    mouse: boolean;
  } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef<(d: Drag) => void>(() => undefined);
  dropRef.current = onDrop;
  const dropValidRef = useRef(dropValid);
  dropValidRef.current = dropValid;
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;

  const armLongPress = (uid: string | null) =>
    setTimeout(() => {
      const p = press.current;
      if (!p || !uid || dragRef.current) return;
      suppressClick.current = true;
      press.current = null;
      setLifted(null);
      setZoom(uid);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target as HTMLElement;
    // Na mão, a faixa que a carta erguida deixa a descoberto (o `::after` de `.hand-card.peek`) vale como a carta.
    const inHand = el.matches('[data-hand-uid]') ? el.querySelector<HTMLElement>('[data-uid]') : null;
    const dragEl = el.closest<HTMLElement>('[data-drag]') ?? (inHand?.dataset.drag ? inHand : null);
    const cardEl = el.closest<HTMLElement>('[data-uid]') ?? inHand;
    if (!dragEl && !cardEl) return;
    const uid = (dragEl ?? cardEl)!.dataset.uid ?? null;
    const kind = (dragEl?.dataset.drag as DragKind | undefined) ?? null;
    const don = dragEl?.dataset.don !== undefined ? Number(dragEl.dataset.don) : undefined;
    const hand = Boolean(cardEl && el.closest('.hand.bottom'));
    if (press.current) clearTimeout(press.current.timer);
    if (hand && uid) setLifted(uid);
    press.current = {
      x: e.clientX,
      y: e.clientY,
      ax: e.clientX,
      ay: e.clientY,
      uid,
      kind,
      ...(don !== undefined ? { don } : {}),
      timer: armLongPress(cardEl?.dataset.uid ?? null),
      moved: false,
      hand,
      browsed: false,
      mouse: e.pointerType === 'mouse',
    };
  };

  useEffect(() => {
    /** Posição na mão sob o dedo, pelas mesmas contas do leque no CSS. */
    const handSlot = (x: number): number | undefined => {
      const box = document.querySelector<HTMLElement>('.hand.bottom');
      const card = box?.querySelector<HTMLElement>('.hand-card');
      if (!box || !card) return undefined;
      const n = box.querySelectorAll('.hand-card').length;
      const w = box.clientWidth;
      const cw = card.offsetWidth;
      const step = n > 1 ? Math.min(cw * 0.9, (w - cw - 34) / (n - 1)) : 1;
      const left = box.getBoundingClientRect().left;
      return Math.max(0, Math.min(n - 1, Math.round((x - left - w / 2) / step + (n - 1) / 2)));
    };
    const findOver = (x: number, y: number, d: Drag): Pick<Drag, 'over' | 'insert'> => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return { over: null };
      if (d.kind === 'hand') {
        if (el.closest('.bottom-strip, [data-drop="hand"]')) return { over: 'hand', insert: handSlot(x) };
        return { over: el.closest('[data-drop="field"]') && dropValidRef.current(d, 'field') ? 'field' : null };
      }
      if (d.kind === 'attached') {
        // DON!! anexado volta para a própria fileira de DON!! (a de baixo).
        return { over: el.closest('.don-row.bottom') && dropValidRef.current(d, 'don') ? 'don' : null };
      }
      const uid = el.closest<HTMLElement>('[data-uid]')?.dataset.uid ?? null;
      return { over: uid && dropValidRef.current(d, uid) ? uid : null };
    };
    const startDrag = (p: NonNullable<typeof press.current>, e: PointerEvent) => {
      clearTimeout(p.timer);
      const m = modeRef.current;
      // Arrastar um DON!! marcado leva todos os marcados; um DON!! sem marca vai sozinho.
      const marked = m?.kind === 'don' ? m.picked : [];
      const dons = p.kind !== 'don' ? [] : p.don !== undefined && marked.includes(p.don) ? marked : p.don !== undefined ? [p.don] : marked;
      const count = p.kind === 'don' ? Math.max(1, dons.length) : 1;
      dragRef.current = { kind: p.kind!, uid: p.uid, x: e.clientX, y: e.clientY, over: null, count, ...(dons.length ? { dons } : {}) };
      setLifted(null);
      setZoom(null);
      setMode(null);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (p.hand && !dragRef.current) {
        // Na mão: puxar para cima tira a carta; para os lados, ergue a carta sob o dedo (toque) ou, com o
        // mouse, já arrasta (soltar na própria mão reordena).
        if (p.kind && (p.y - e.clientY > HAND_PULL || (p.mouse && Math.abs(e.clientX - p.x) > HAND_SLIDE))) startDrag(p, e);
        else {
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) p.moved = true;
          if (Math.hypot(e.clientX - p.ax, e.clientY - p.ay) > 8) {
            clearTimeout(p.timer);
            p.ax = e.clientX;
            p.ay = e.clientY;
            const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const under = hit?.closest('.hand.bottom') ? hit.closest<HTMLElement>('[data-uid]')?.dataset.uid : undefined;
            if (under && under !== p.uid) {
              p.uid = under;
              p.browsed = true;
              setLifted(under);
            }
            p.timer = armLongPress(p.uid);
          }
          return;
        }
      } else if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
        p.moved = true;
        clearTimeout(p.timer);
        if (!p.kind) return;
        startDrag(p, e);
      }
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: e.clientX, y: e.clientY, ...findOver(e.clientX, e.clientY, d) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const p = press.current;
      if (p) clearTimeout(p.timer);
      press.current = null;
      setLifted(null);
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        setDrag(null);
        suppressClick.current = true;
        dropRef.current(d);
      } else if (p?.hand && p.browsed && p.uid) {
        // Deslizou pela mão e soltou numa carta: age como um toque nela.
        suppressClick.current = true;
        onCardRef.current(p.uid);
      }
      // O clique (se houver) chega logo depois do pointerup; depois disso, libera.
      setTimeout(() => (suppressClick.current = false), 60);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return { onPointerDown, onClickCapture };
}
