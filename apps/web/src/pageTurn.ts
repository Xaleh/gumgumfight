// Virada de página com dobra (como num gibi): a folha da direita dobra, mostra o verso e acompanha o dedo.
//
// A conta é a de uma folha de papel dobrada no plano. Um ponto E da borda de fora da folha é levado até F
// (o dedo); a dobra é a mediatriz entre os dois. Do lado da lombada a folha continua no lugar; o resto
// aparece refletido na dobra, de verso para cima. `foldAt` faz só a conta (testada em
// test/pageTurn.test.ts) e `PageTurn` desenha com cópias paradas das páginas (quem monta as cópias é o
// componente PageBook).
//
// Coordenadas da folha: a lombada é x = 0, a borda de fora é x = W, e o topo é y = 0. Em livro aberto a
// folha que vira é a da direita e o verso cai sobre a página da esquerda (x de −W a 0).

export interface Pt {
  x: number;
  y: number;
}

/** Matriz 2D na ordem do CSS: `matrix(a, b, c, d, e, f)`. */
export type Matrix = [number, number, number, number, number, number];

export interface Fold {
  /** Onde o ponto da borda ficou, depois de preso à lombada. */
  F: Pt;
  /** A folha está deitada no lugar: não há dobra. */
  flat: boolean;
  /** A parte da folha que continua no lugar (polígono). */
  keep: Pt[];
  /** A parte que saiu do lugar: é ela que aparece refletida, de verso. */
  gone: Pt[];
  /** Reflexão na dobra. */
  mirror: Matrix;
  /** Um ponto da dobra e a normal dela (aponta para o lado que a folha deixou). */
  mx: number;
  my: number;
  nx: number;
  ny: number;
  /** Largura da parte que saiu, medida a partir da dobra. */
  reach: number;
  /** 0 com a folha deitada de um lado ou do outro, 1 no meio do caminho: acende as sombras. */
  lift: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Recorta o polígono pelo lado `sign` da dobra (Sutherland-Hodgman contra um semiplano). */
function cut(pts: Pt[], side: (p: Pt) => number, sign: 1 | -1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const sa = side(a) * sign;
    const sb = side(b) * sign;
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const u = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  return out;
}

/**
 * A dobra de uma folha `W` × `H` quando o ponto `E` da borda de fora é levado até `to`.
 * A folha está presa na lombada: o ponto nunca fica mais longe dos dois cantos da lombada do que estava.
 */
export function foldAt(W: number, H: number, E: Pt, to: Pt): Fold {
  let F = { ...to };
  for (let k = 0; k < 6; k++) {
    for (const S of [
      { x: 0, y: 0 },
      { x: 0, y: H },
    ]) {
      const r = Math.hypot(E.x - S.x, E.y - S.y);
      const d = Math.hypot(F.x - S.x, F.y - S.y);
      if (d > r) F = { x: S.x + ((F.x - S.x) * r) / d, y: S.y + ((F.y - S.y) * r) / d };
    }
  }
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  const lift = Math.min(1, 3 * Math.sin((Math.PI * Math.min(2 * W, Math.max(0, W - F.x))) / (2 * W)));
  const dx = E.x - F.x;
  const dy = E.y - F.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { F, flat: true, keep: rect, gone: [], mirror: IDENTITY, mx: E.x, my: E.y, nx: 1, ny: 0, reach: 0, lift: 0 };
  const nx = dx / len;
  const ny = dy / len;
  const mx = (E.x + F.x) / 2;
  const my = (E.y + F.y) / 2;
  const side = (p: Pt) => (p.x - mx) * nx + (p.y - my) * ny;
  const k = 2 * (mx * nx + my * ny);
  return {
    F,
    flat: false,
    keep: cut(rect, side, -1),
    gone: cut(rect, side, 1),
    mirror: [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, k * nx, k * ny],
    mx,
    my,
    nx,
    ny,
    reach: Math.max(...rect.map(side)),
    lift,
  };
}

/** `m1` depois de `m2` (primeiro `m2`, como na lista de `transform` do CSS). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const css = (m: Matrix) => `matrix(${m.map((v) => +v.toFixed(5)).join(',')})`;
const polygon = (pts: Pt[]) => (pts.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${pts.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})`);

/** As cópias paradas das páginas, já com largura e altura fixas. */
export interface TurnSheets {
  /** A frente da folha que vira. */
  leaf: HTMLElement;
  /** O verso dela (livro aberto: a página que fica à esquerda). `null`: a própria folha vista por trás. */
  back: HTMLElement | null;
  /** O que a folha descobre do lado direito. */
  under: HTMLElement;
  /** Livro aberto: a página da esquerda, parada, até o verso da folha cobri-la. */
  left: HTMLElement | null;
}

export interface TurnBox {
  /** Canto do livro dentro de `host` (px). */
  left: number;
  top: number;
  /** Largura de uma página (em livro aberto, metade do livro). */
  pageW: number;
  /** Altura do livro e da folha que vira (em página única as páginas podem ter alturas diferentes). */
  height: number;
  leafH: number;
  spread: boolean;
}

/** Folga em volta do livro para as sombras não serem cortadas. */
const BLEED = 12;

const el = (cls: string, ...children: HTMLElement[]) => {
  const d = document.createElement('div');
  d.className = cls;
  d.append(...children);
  return d;
};

/**
 * Uma virada em andamento: a camada com as cópias fica por cima do livro de verdade até `destroy()`.
 * `dir` 1 = para a frente (a folha sai da direita); −1 = para trás (a folha volta da esquerda).
 */
export class PageTurn {
  readonly dir: 1 | -1;
  private readonly box: TurnBox;
  private readonly root: HTMLElement;
  private readonly half: HTMLElement;
  private readonly front: HTMLElement;
  private readonly lid: HTMLElement;
  private readonly back: HTMLElement;
  private readonly underShade: HTMLElement;
  private readonly backShade: HTMLElement;
  private readonly E: Pt;
  private F: Pt;
  private raf = 0;
  private settle: (() => void) | null = null;

  constructor(host: HTMLElement, box: TurnBox, sheets: TurnSheets, dir: 1 | -1, grabY?: number) {
    this.dir = dir;
    this.box = box;
    const { pageW: W, leafH: H } = box;
    this.E = { x: W, y: grabY === undefined ? H * 0.84 : Math.min(H, Math.max(0, grabY)) };
    this.F = { x: dir > 0 ? W : -W, y: this.E.y };

    // O verso: em livro aberto, a página seguinte (espelhada, para a reflexão desfazer); em página
    // única, a própria folha bem apagada, como papel visto contra a luz.
    const inner = el(box.spread ? 'gibi-turn-flip' : 'gibi-turn-ghost', sheets.back ?? (sheets.leaf.cloneNode(true) as HTMLElement));
    this.backShade = el('gibi-turn-shade');
    this.back = el('gibi-turn-back', inner, this.backShade);
    this.back.style.width = `${W}px`;
    this.back.style.height = `${H}px`;
    // A tampa cobre só o lado da lombada: é ela que corta o verso na dobra e deixa a sombra da folha aparecer.
    this.lid = el('gibi-turn-lid', this.back);
    // A sombra que a folha faz na página de baixo não passa do tamanho da folha.
    this.underShade = el('gibi-turn-shade');
    const cast = el('gibi-turn-cast', this.underShade);
    cast.style.width = `${W}px`;
    cast.style.height = `${H}px`;
    this.front = el('gibi-turn-front', sheets.leaf);
    this.half = el('gibi-turn-half', el('gibi-turn-under', sheets.under), cast, this.front, this.lid);
    this.half.style.left = `${box.spread ? W : 0}px`;
    this.half.style.width = `${W}px`;
    const stage = el('gibi-turn-stage', ...(sheets.left ? [el('gibi-turn-left', sheets.left)] : []), this.half);
    stage.style.left = stage.style.top = `${BLEED}px`;
    stage.style.width = `${box.spread ? 2 * W : W}px`;
    stage.style.height = `${box.height}px`;
    this.root = el(box.spread ? 'gibi-turn spread' : 'gibi-turn', stage);
    this.root.setAttribute('aria-hidden', 'true');
    this.root.setAttribute('inert', '');
    Object.assign(this.root.style, { left: `${box.left - BLEED}px`, top: `${box.top - BLEED}px`, width: `${(box.spread ? 2 * W : W) + 2 * BLEED}px`, height: `${box.height + 2 * BLEED}px` });
    host.append(this.root);
    // A rolagem de dentro de cada página não vem na cópia.
    for (const c of this.root.querySelectorAll<HTMLElement>('[data-gibi-scroll]')) c.scrollTop = Number(c.dataset.gibiScroll);
    this.fold(this.F.x, this.F.y);
  }

  /** O ponto da tela nas coordenadas da folha. */
  point(clientX: number, clientY: number): Pt {
    const r = this.half.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /** Quanto da virada já foi: 0 com a folha deitada na direita, 1 com ela toda do outro lado. */
  get progress(): number {
    return (this.box.pageW - this.F.x) / (2 * this.box.pageW);
  }

  /** Leva o ponto da borda da folha até (x, y). */
  fold(x: number, y: number) {
    const { pageW: W, leafH: H } = this.box;
    const f = foldAt(W, H, this.E, { x, y });
    this.F = f.F;
    this.root.style.setProperty('--lift', f.lift.toFixed(3));
    this.front.style.clipPath = f.flat ? '' : polygon(f.keep);
    this.lid.hidden = this.underShade.hidden = f.flat;
    if (f.flat) return;
    // Faixas alinhadas à dobra: x é a distância da dobra para o lado que a folha deixou.
    const D = Math.hypot(W, H);
    const along: Matrix = [f.nx, f.ny, -f.ny, f.nx, f.mx, f.my];
    const strip = css(multiply(along, [1, 0, 0, 1, 0, -D]));
    for (const s of [this.underShade, this.backShade]) {
      s.style.width = s.style.height = `${2 * D}px`;
      s.style.transform = strip;
    }
    this.backShade.style.background = `linear-gradient(90deg, rgba(43,17,8,.3) 0, rgba(255,255,255,var(--gibi-sheen)) ${0.14 * f.reach}px, rgba(255,255,255,0) ${0.5 * f.reach}px, rgba(43,17,8,.14) ${f.reach}px)`;
    this.underShade.style.background = `linear-gradient(90deg, rgba(20,8,3,.4) 0, rgba(20,8,3,0) ${Math.min(80, f.reach * 0.6)}px)`;
    const lid = multiply(along, [1, 0, 0, 1, -2 * D, -D]);
    this.lid.style.width = this.lid.style.height = `${2 * D}px`;
    this.lid.style.transform = css(lid);
    this.back.style.transform = css(multiply(invert(lid), f.mirror));
  }

  /**
   * Termina a virada sozinha: `commit` leva a folha até o outro lado; sem ele, devolve ao lugar.
   * `auto`: a virada inteira sem o dedo (mais lenta, com a folha subindo no meio do caminho).
   */
  glide(commit: boolean, auto = false): Promise<void> {
    const { pageW: W, leafH: H, spread } = this.box;
    const from = { ...this.F };
    const tx = this.dir > 0 === commit ? -W : W;
    const ty = this.E.y;
    const ms = auto ? (spread ? 720 : 640) : 160 + (440 * Math.abs(tx - from.x)) / (2 * W);
    const arc = auto ? Math.min(H * 0.13, W * 0.3) : 0;
    cancelAnimationFrame(this.raf);
    this.settle?.();
    return new Promise((resolve) => {
      this.settle = resolve;
      const t0 = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - t0) / ms);
        const e = auto ? (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2) : 1 - Math.pow(1 - u, 3);
        this.fold(from.x + (tx - from.x) * e, from.y + (ty - from.y) * e - Math.sin(Math.PI * e) * arc);
        if (u < 1) this.raf = requestAnimationFrame(step);
        else {
          this.settle = null;
          resolve();
        }
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  /** Tira a camada da virada (quem esperava o fim de `glide` é avisado). */
  destroy() {
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.settle?.();
    this.settle = null;
  }
}
