// GIF animado sem dependências (trecho do replay, roadmap F2): paleta global de até 256 cores
// escolhida pelas cores mais frequentes dos quadros (histograma de 4 bits por canal), cada pixel
// na cor mais próxima da paleta e LZW de largura variável (até 12 bits), como manda o GIF89a.

/** Um quadro: pixels RGBA (como `ImageData.data`) e quanto tempo fica na tela. */
export interface GifFrame {
  rgba: Uint8ClampedArray | Uint8Array;
  delayMs: number;
}

/** Cor (0xRRGGBB) de cada balde do histograma de 4 bits por canal (o centro do balde). */
const bucketColor = (b: number) => {
  const r = ((b >> 8) & 15) * 17;
  const g = ((b >> 4) & 15) * 17;
  const bl = (b & 15) * 17;
  return [r, g, bl] as const;
};
const bucketOf = (px: Uint8ClampedArray | Uint8Array, i: number) => ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);

/**
 * Paleta (até 256 cores RGB) e, para cada um dos 4.096 baldes, o índice da cor mais próxima.
 * `step`: lê 1 de cada `step` pixels para contar as cores (o resultado quase não muda e fica rápido).
 */
export function buildPalette(frames: GifFrame[], step = 3): { palette: Uint8Array; map: Uint8Array } {
  const count = new Uint32Array(4096);
  for (const f of frames) for (let i = 0; i < f.rgba.length; i += 4 * step) count[bucketOf(f.rgba, i)]++;
  const used = [...count.keys()].filter((b) => count[b] > 0).sort((a, b) => count[b] - count[a]);
  const chosen = used.slice(0, 256);
  if (!chosen.length) chosen.push(0);
  const palette = new Uint8Array(256 * 3);
  chosen.forEach((b, i) => palette.set(bucketColor(b), i * 3));
  const map = new Uint8Array(4096);
  const direct = new Map(chosen.map((b, i) => [b, i]));
  for (let b = 0; b < 4096; b++) {
    const hit = direct.get(b);
    if (hit !== undefined) {
      map[b] = hit;
      continue;
    }
    const [r, g, bl] = bucketColor(b);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < chosen.length; i++) {
      const dr = palette[i * 3] - r;
      const dg = palette[i * 3 + 1] - g;
      const db = palette[i * 3 + 2] - bl;
      // Peso maior no verde (o olho é mais sensível a ele).
      const d = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    map[b] = best;
  }
  return { palette, map };
}

/** Índices da paleta de um quadro. */
export function indexFrame(rgba: Uint8ClampedArray | Uint8Array, map: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = map[bucketOf(rgba, i)];
  return out;
}

/** Bytes que crescem conforme o uso. */
class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;
  byte(b: number) {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }
  bytes(bs: ArrayLike<number>) {
    for (let i = 0; i < bs.length; i++) this.byte(bs[i]);
  }
  u16(v: number) {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }
  ascii(s: string) {
    for (const ch of s) this.byte(ch.charCodeAt(0));
  }
  out() {
    return this.buf.slice(0, this.len);
  }
}

/** LZW do GIF para índices de 8 bits, já em sub-blocos de até 255 bytes (com o terminador). */
export function lzw(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = new Bytes();
  let block: number[] = [];
  let acc = 0;
  let bits = 0;
  let size = minCodeSize + 1;
  const flushBlock = () => {
    if (!block.length) return;
    out.byte(block.length);
    out.bytes(block);
    block = [];
  };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(acc & 255);
      if (block.length === 255) flushBlock();
      acc >>>= 8;
      bits -= 8;
    }
  };
  // Dicionário: (prefixo << 8 | próximo índice) → código.
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  if (indices.length) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const hit = dict.get(key);
      if (hit !== undefined) {
        prefix = hit;
        continue;
      }
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        // O decodificador sobe a largura um código depois: sobe quando o próximo código não cabe.
        if (next > 1 << size && size < 12) size++;
      } else {
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        size = minCodeSize + 1;
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (bits > 0) block.push(acc & 255);
  flushBlock();
  out.byte(0);
  return out.out();
}

/** GIF89a animado em loop. Os quadros têm `width × height` pixels. */
export function encodeGif(frames: GifFrame[], width: number, height: number): Uint8Array {
  const { palette, map } = buildPalette(frames);
  const out = new Bytes();
  out.ascii('GIF89a');
  out.u16(width);
  out.u16(height);
  // Paleta global de 256 cores (2^(7+1)), 8 bits por cor.
  out.byte(0xf7);
  out.byte(0);
  out.byte(0);
  out.bytes(palette);
  // Repetir para sempre (NETSCAPE2.0).
  out.bytes([0x21, 0xff, 0x0b]);
  out.ascii('NETSCAPE2.0');
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  for (const f of frames) {
    const delay = Math.max(2, Math.round(f.delayMs / 10));
    out.bytes([0x21, 0xf9, 0x04, 0x00]);
    out.u16(delay);
    out.bytes([0x00, 0x00]);
    out.byte(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.byte(0);
    out.byte(8);
    out.bytes(lzw(indexFrame(f.rgba, map)));
  }
  out.byte(0x3b);
  return out.out();
}
