// O gibi das lições sem mesa: no celular, uma página; em tela larga, um livro aberto (a figura à esquerda,
// o treinador à direita). A página vira com a dobra de `pageTurn.ts`, pelos botões do treinador ou
// puxando a ponta da folha, e segue a opção "Animações": completas = a dobra; suaves = a página só
// esmaece; desligadas = troca na hora.
//
// A dobra usa cópias paradas das páginas (o que estava na tela e o que vai ficar), por cima do livro de
// verdade. Para puxar a ponta é preciso ver a página seguinte antes de ela existir: `peek` devolve essa
// página, que é montada escondida só para ser copiada.

import { forwardRef, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PageTurn } from '../pageTurn';
import { useSettings } from '../settings';

export interface BookPage {
  /** A figura do passo (carta, anatomia, curva...). `null`: em livro aberto entra a folha de rosto. */
  left: ReactNode | null;
  /** O treinador. */
  right: ReactNode;
}

export interface PageBookHandle {
  /** Faz `action` (que troca a página) com a virada: `dir` 1 = para a frente, −1 = para trás. */
  turn: (dir: 1 | -1, action: () => void) => void;
}

interface Props extends BookPage {
  /** Muda quando a página muda (o passo da lição). */
  pageKey: string;
  /** Folha de rosto da lição: a página da esquerda quando o passo não tem figura. */
  plate: ReactNode;
  /** A página para onde a ponta puxada leva, ou `null` se não dá para ir. */
  peek: (dir: 1 | -1) => BookPage | null;
  /** A ponta foi puxada até o fim: troca a página de verdade. */
  onTurn: (dir: 1 | -1) => void;
  /** Texto de ajuda das pontas que se podem puxar. */
  pullHint: string;
}

/** Mesma largura em que a mesa ganha o painel lateral. */
const WIDE = '(min-width: 1000px)';

function useMedia(query: string) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  }, [query]);
  return on;
}

/** Um dedo (ou o mouse) na ponta da folha. `live`: já andou o bastante para a folha levantar. */
interface Drag {
  id: number;
  dir: 1 | -1;
  /** Onde o dedo encostou, na tela. */
  x: number;
  y: number;
  /** O mesmo ponto nas coordenadas da folha (depois de ela levantar). */
  x0: number;
  t0: number;
  live: boolean;
}

interface Snap {
  left: HTMLElement | null;
  right: HTMLElement;
  height: number;
}

/** Cópia parada de uma folha, do tamanho que ela tem na tela. */
function copy(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.classList.remove('peek');
  Object.assign(c.style, { width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` });
  if (el.scrollTop) c.dataset.gibiScroll = String(el.scrollTop);
  for (const n of c.querySelectorAll('[id]')) n.removeAttribute('id');
  return c;
}

/** As folhas de um livro (`.gibi-pages`): em livro aberto, as duas páginas; em página única, a folha inteira. */
function snapshot(pages: HTMLElement, spread: boolean): Snap {
  const page = (side: string) => pages.querySelector<HTMLElement>(`:scope > .gibi-page.${side}`)!;
  return spread ? { left: copy(page('left')), right: copy(page('right')), height: pages.offsetHeight } : { left: null, right: copy(pages), height: pages.offsetHeight };
}

export const PageBook = forwardRef<PageBookHandle, Props>(function PageBook({ pageKey, left, right, plate, peek, onTurn, pullHint }, ref) {
  const { animations } = useSettings();
  const spread = useMedia(WIDE);
  const still = useMedia('(prefers-reduced-motion: reduce)');
  const mode = animations === 'full' && still ? 'soft' : animations;
  const host = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef(pageKey);
  keyRef.current = pageKey;
  const turning = useRef<PageTurn | null>(null);
  const drag = useRef<Drag | null>(null);
  const [peeking, setPeeking] = useState<BookPage | null>(null);

  const end = () => {
    turning.current?.destroy();
    turning.current = null;
    if (host.current) host.current.style.minHeight = '';
  };
  // Ao sair da lição ou mudar o formato do livro no meio de uma virada, a camada das cópias sai junto.
  useEffect(() => end, [spread]);

  /** Monta a virada entre duas fotos do livro; a folha que vira é a da página de baixo. */
  const begin = (dir: 1 | -1, from: Snap, to: Snap, grabY?: number) => {
    const h = host.current!;
    const p = pages.current!;
    const lower = dir > 0 ? from : to;
    const upper = dir > 0 ? to : from;
    const height = Math.max(from.height, to.height);
    // Em página única as páginas têm alturas diferentes: o livro não encolhe no meio da virada.
    h.style.minHeight = `${p.offsetTop + height}px`;
    const box = { left: p.offsetLeft, top: p.offsetTop, pageW: spread ? p.offsetWidth / 2 : p.offsetWidth, height, leafH: lower.height, spread };
    const sheets = { leaf: lower.right, back: spread ? upper.left : null, under: upper.right, left: spread ? lower.left : null };
    turning.current = new PageTurn(h, box, sheets, dir, grabY);
    return turning.current;
  };

  const turn = (dir: 1 | -1, action: () => void) => {
    end();
    const p = pages.current;
    if (mode === 'off' || !p) return action();
    const before = keyRef.current;
    const from = mode === 'full' ? snapshot(p, spread) : null;
    flushSync(() => {
      action();
      setPeeking(null);
    });
    if (keyRef.current === before) return;
    if (!from) {
      p.animate([{ opacity: 0, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
      return;
    }
    const t = begin(dir, from, snapshot(p, spread));
    void t.glide(true, true).then(() => turning.current === t && end());
  };
  useImperativeHandle(ref, () => ({ turn }));

  // ---- puxar a ponta da folha
  const onDown = (dir: 1 | -1) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button || drag.current || !peek(dir)) return;
    drag.current = { id: e.pointerId, dir, x: e.clientX, y: e.clientY, x0: 0, t0: performance.now(), live: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: os eventos continuam chegando enquanto o dedo estiver na ponta */
    }
  };
  /** O dedo andou: monta a virada, com a página seguinte copiada de uma montagem escondida. */
  const lift = (d: Drag) => {
    const next = peek(d.dir);
    const p = pages.current;
    if (!next || !p) return null;
    turning.current?.destroy();
    const from = snapshot(p, spread);
    flushSync(() => setPeeking(next));
    if (!peekRef.current) return null;
    const t = begin(d.dir, from, snapshot(peekRef.current, spread), d.y - p.getBoundingClientRect().top);
    d.x0 = t.point(d.x, d.y).x;
    d.live = true;
    return t;
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    if (!d.live && Math.abs(e.clientX - d.x) < 5) return;
    const t = d.live ? turning.current : lift(d);
    if (!t) return;
    const p = t.point(e.clientX, e.clientY);
    const W = spread ? pages.current!.offsetWidth / 2 : pages.current!.offsetWidth;
    // Livro aberto: a ponta fica debaixo do dedo. Página única: anda um pouco mais que o dedo.
    const dx = (p.x - d.x0) * (spread ? 1 : 1.6);
    t.fold(t.dir > 0 ? Math.min(W, W + dx) : Math.max(-W, -W + dx), p.y);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const cancelled = e.type === 'pointercancel';
    const t = turning.current;
    if (!d.live) {
      // Um toque na ponta, sem arrastar, vira a página inteira.
      if (!cancelled) turn(d.dir, () => onTurn(d.dir));
      return;
    }
    if (!t) return;
    // Vale até onde a folha foi, ou o embalo do dedo.
    const v = (t.point(e.clientX, e.clientY).x - d.x0) / Math.max(1, performance.now() - d.t0);
    const gone = t.dir > 0 ? t.progress : 1 - t.progress;
    const commit = !cancelled && (gone > 0.28 || (t.dir > 0 ? v < -0.5 : v > 0.5));
    void t.glide(commit).then(() => {
      if (turning.current !== t) return;
      flushSync(() => {
        if (commit) onTurn(t.dir);
        setPeeking(null);
      });
      end();
    });
  };
  const grip = (dir: 1 | -1, side: string) =>
    mode === 'full' && peek(dir) ? (
      <div className={`gibi-grip ${side}`} title={pullHint} aria-hidden="true" onPointerDown={onDown(dir)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
    ) : null;

  const sheets = (page: BookPage) => (
    <>
      <div className={['gibi-page', 'left', page.left === null ? 'plate' : ''].join(' ')}>{page.left ?? plate}</div>
      <div className="gibi-page right">{page.right}</div>
    </>
  );
  return (
    <div className={['gibi', spread ? 'spread' : ''].join(' ')} ref={host}>
      <div className="gibi-pages" ref={pages}>
        {sheets({ left, right })}
      </div>
      {grip(-1, 'back')}
      {grip(1, 'next')}
      {peeking && (
        <div className="gibi-pages peek" ref={peekRef} aria-hidden="true">
          {sheets(peeking)}
        </div>
      )}
    </div>
  );
});
