// A conta da dobra da virada de página (src/pageTurn.ts): o que fica no lugar, o que aparece de verso e
// onde a folha pode ir sem se soltar da lombada.

import { describe, expect, it } from 'vitest';
import { foldAt, invert, type Matrix, multiply, type Pt } from '../src/pageTurn';

const W = 400;
const H = 560;
const E: Pt = { x: W, y: 470 };

/** Área de um polígono (fórmula do cadarço). */
function area(pts: Pt[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
const apply = (m: Matrix, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

describe('foldAt', () => {
  it('com a ponta no lugar a folha fica deitada, inteira e sem sombra', () => {
    const f = foldAt(W, H, E, E);
    expect(f.flat).toBe(true);
    expect(area(f.keep)).toBeCloseTo(W * H);
    expect(f.gone).toEqual([]);
    expect(f.lift).toBe(0);
  });

  it('a dobra divide a folha em duas partes que somam a folha toda', () => {
    for (const to of [{ x: 300, y: 430 }, { x: 120, y: 380 }, { x: -150, y: 300 }, { x: -380, y: 460 }]) {
      const f = foldAt(W, H, E, to);
      expect(f.flat).toBe(false);
      expect(area(f.keep) + area(f.gone)).toBeCloseTo(W * H, 3);
    }
  });

  it('a reflexão leva a ponta da folha até o dedo e deixa a dobra onde está', () => {
    const f = foldAt(W, H, E, { x: 180, y: 400 });
    const tip = apply(f.mirror, E);
    expect(tip.x).toBeCloseTo(f.F.x);
    expect(tip.y).toBeCloseTo(f.F.y);
    const onFold = { x: f.mx - f.ny * 37, y: f.my + f.nx * 37 };
    const same = apply(f.mirror, onFold);
    expect(same.x).toBeCloseTo(onFold.x);
    expect(same.y).toBeCloseTo(onFold.y);
  });

  it('a folha não se solta da lombada: a ponta nunca fica mais longe dos cantos dela do que estava', () => {
    for (const to of [{ x: -900, y: -700 }, { x: -50, y: 2000 }, { x: 900, y: 100 }, { x: -2000, y: 470 }]) {
      const { F } = foldAt(W, H, E, to);
      expect(Math.hypot(F.x, F.y)).toBeLessThanOrEqual(Math.hypot(E.x, E.y) + 0.5);
      expect(Math.hypot(F.x, F.y - H)).toBeLessThanOrEqual(Math.hypot(E.x, E.y - H) + 0.5);
    }
  });

  it('virada inteira: a dobra é a lombada, nada fica no lugar e o verso é a folha espelhada', () => {
    const f = foldAt(W, H, E, { x: -W, y: E.y });
    expect(area(f.keep)).toBeCloseTo(0);
    expect(area(f.gone)).toBeCloseTo(W * H);
    expect(apply(f.mirror, { x: W, y: 100 })).toEqual({ x: -W, y: 100 });
    expect(f.lift).toBeCloseTo(0);
  });

  it('as sombras acendem no meio do caminho', () => {
    expect(foldAt(W, H, E, { x: 0, y: E.y }).lift).toBe(1);
  });
});

describe('matrizes', () => {
  it('uma matriz vezes a inversa dela é a identidade', () => {
    const m: Matrix = [0.6, 0.8, -0.8, 0.6, 120, -45];
    const id = multiply(m, invert(m));
    [1, 0, 0, 1, 0, 0].forEach((v, i) => expect(id[i]).toBeCloseTo(v));
  });

  it('multiply aplica primeiro a matriz da direita', () => {
    const move: Matrix = [1, 0, 0, 1, 10, 0];
    const double: Matrix = [2, 0, 0, 2, 0, 0];
    expect(apply(multiply(double, move), { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
    expect(apply(multiply(move, double), { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });
});
