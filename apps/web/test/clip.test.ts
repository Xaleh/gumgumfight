import type { ClipFrame } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { clipImages, rowSlots } from '../src/clip/draw';
import { buildPalette, encodeGif, indexFrame, lzw } from '../src/clip/gif';
import { clipFileName, clipPlan, FRAME_MS, frameMs, MAX_CLIP_MS } from '../src/clip/plan';

/** Decodificador LZW do GIF (a referência do teste): sub-blocos → índices. */
function unlzw(data: Uint8Array, at: number, minCodeSize: number): { out: number[]; next: number } {
  const bytes: number[] = [];
  let i = at;
  for (let len = data[i++]; len; len = data[i++]) {
    for (let k = 0; k < len; k++) bytes.push(data[i + k]);
    i += len;
  }
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, c) => (c < clear ? [c] : []));
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let p = 0;
  let prev: number[] | null = null;
  for (;;) {
    while (bits < size) {
      if (p >= bytes.length) throw new Error('fim dos dados sem o código de fim');
      acc |= bytes[p++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('código inválido');
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return { out, next: i };
}

/** Lê um GIF: tamanho, paleta, e os índices e o tempo de cada quadro. */
function readGif(data: Uint8Array) {
  const s = String.fromCharCode(...data.slice(0, 6));
  const w = data[6] | (data[7] << 8);
  const h = data[8] | (data[9] << 8);
  const palette = data.slice(13, 13 + 768);
  let i = 13 + 768;
  const frames: Array<{ delay: number; indices: number[] }> = [];
  let delay = 0;
  let loops = false;
  while (data[i] !== 0x3b) {
    if (data[i] === 0x21) {
      const label = data[i + 1];
      if (label === 0xf9) delay = data[i + 4] | (data[i + 5] << 8);
      if (label === 0xff) loops = String.fromCharCode(...data.slice(i + 3, i + 14)) === 'NETSCAPE2.0';
      i += 2;
      for (let len = data[i++]; len; len = data[i++]) i += len;
    } else if (data[i] === 0x2c) {
      i += 10;
      const { out, next } = unlzw(data, i + 1, data[i]);
      frames.push({ delay, indices: out });
      i = next;
    } else throw new Error(`bloco inesperado em ${i}`);
  }
  return { signature: s, w, h, palette, frames, loops };
}

/** Quadro RGBA de uma cor só, com uma faixa de outra cor. */
function solid(w: number, h: number, base: [number, number, number], band?: { y: number; color: [number, number, number] }) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = band && y === band.y ? band.color : base;
      px.set([...c, 255], (y * w + x) * 4);
    }
  return px;
}

describe('trecho do replay: GIF', () => {
  it('LZW de ida e volta, inclusive quando o dicionário enche e recomeça', () => {
    // Ruído com muitas sequências diferentes: passa dos 4.096 códigos.
    let seed = 7;
    const noise = Uint8Array.from({ length: 60_000 }, () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256);
    expect(unlzw(lzw(noise), 0, 8).out).toEqual([...noise]);
    const flat = new Uint8Array(10_000).fill(3);
    const packed = lzw(flat);
    expect(packed.length).toBeLessThan(400);
    expect(unlzw(packed, 0, 8).out).toEqual([...flat]);
    expect(unlzw(lzw(new Uint8Array(0)), 0, 8).out).toEqual([]);
  });

  it('GIF89a em loop, com os quadros, os tempos e as cores', () => {
    const w = 40;
    const h = 30;
    const red: [number, number, number] = [210, 50, 40];
    const blue: [number, number, number] = [40, 100, 180];
    const yellow: [number, number, number] = [250, 205, 70];
    const gif = readGif(encodeGif([{ rgba: solid(w, h, red), delayMs: 900 }, { rgba: solid(w, h, blue, { y: 4, color: yellow }), delayMs: 2600 }], w, h));
    expect(gif.signature).toBe('GIF89a');
    expect([gif.w, gif.h]).toEqual([w, h]);
    expect(gif.loops).toBe(true);
    expect(gif.frames.map((f) => f.delay)).toEqual([90, 260]);
    const color = (idx: number) => [gif.palette[idx * 3], gif.palette[idx * 3 + 1], gif.palette[idx * 3 + 2]];
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 16);
    for (const f of gif.frames) expect(f.indices).toHaveLength(w * h);
    expect(gif.frames[0].indices.every((i) => near(color(i), red))).toBe(true);
    expect(near(color(gif.frames[1].indices[0]), blue)).toBe(true);
    expect(near(color(gif.frames[1].indices[4 * w + 3]), yellow)).toBe(true);
  });

  it('paleta: no máximo 256 cores, e cada pixel vai para a mais próxima', () => {
    const px = new Uint8ClampedArray(512 * 4);
    for (let i = 0; i < 512; i++) px.set([(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255], i * 4);
    const { palette, map } = buildPalette([{ rgba: px, delayMs: 100 }], 1);
    expect(palette.length).toBe(768);
    const idx = indexFrame(px, map);
    expect(idx.length).toBe(512);
    expect(Math.max(...idx)).toBeLessThan(256);
  });
});

const frame = (over: Partial<ClipFrame> = {}): ClipFrame => {
  const side = {
    name: 'A',
    leader: { uid: 'c1', cardId: 'OP01-001', name: 'L', category: 'leader' as const, colors: ['red'], image: 'https://x/l.png' },
    characters: [{ uid: 'c2', cardId: 'OP01-002', name: 'C', category: 'character' as const, colors: ['red'], image: 'https://x/c.png' }],
    stage: null,
    hand: 5,
    deck: 40,
    life: 5,
    lifeFaceUp: [],
    donActive: 1,
    donRested: 0,
    donDeck: 9,
    trash: 0,
    trashTop: null,
  };
  return { pos: 0, turn: 1, phase: 'main', activePlayer: 0, winner: null, players: [side, { ...side, name: 'B' }], highlight: null, battle: null, ...over };
};

describe('trecho do replay: tempos e layout', () => {
  it('a carta em destaque e o fim ficam mais tempo; o trecho para no limite dos Reels', () => {
    const hl = frame({ highlight: { card: frame().players[0].leader, player: 0, kind: 'play' } });
    expect(frameMs(frame(), true)).toBe(FRAME_MS.first);
    expect(frameMs(frame(), false)).toBe(FRAME_MS.normal);
    expect(frameMs(hl, false)).toBe(FRAME_MS.highlight);
    expect(frameMs(frame({ battle: { attacker: 'c2', target: 'c1' } }), false)).toBe(FRAME_MS.battle);
    expect(frameMs(frame({ phase: 'gameover', winner: 1 }), false)).toBe(FRAME_MS.end);
    const plan = clipPlan([frame(), hl, frame()]);
    expect(plan.totalMs).toBe(FRAME_MS.first + FRAME_MS.highlight + FRAME_MS.normal);
    expect(plan.cut).toBe(false);
    const long = clipPlan(Array.from({ length: 200 }, () => hl));
    expect(long.cut).toBe(true);
    expect(long.totalMs).toBeLessThanOrEqual(MAX_CLIP_MS);
    expect(long.steps.length).toBeGreaterThan(10);
    expect(clipFileName(3, 20, 'mp4')).toBe('gumgum-trecho-3-20.mp4');
  });

  it('as cartas de uma fileira cabem na largura e ficam centradas', () => {
    for (const n of [1, 3, 5, 8]) {
      const slots = rowSlots(n, 540, 0, 980, 180);
      expect(slots).toHaveLength(n);
      const left = slots[0].x;
      const right = slots[n - 1].x + slots[n - 1].w;
      expect(right - left).toBeLessThanOrEqual(980 + 1e-6);
      expect((left + right) / 2).toBeCloseTo(540);
      expect(slots[0].w).toBeLessThanOrEqual(180);
    }
    expect(rowSlots(0, 540, 0, 980, 180)).toEqual([]);
  });

  it('carrega só as imagens das cartas à vista', () => {
    expect(clipImages([frame()]).sort()).toEqual(['https://x/c.png', 'https://x/l.png']);
  });
});
