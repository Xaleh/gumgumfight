// Geradores pseudoaleatórios determinísticos.
// O estado fica dentro do GameState, então a mesma seed + mesmas ações = mesma partida.
//
// - mulberry32 (padrão): 32 bits de estado. Usado nas partidas locais e em todos os
//   replays já gravados, que precisam continuar reproduzíveis.
// - sfc32 (partidas online): 128 bits de estado. Com só 32 bits, dá para descobrir a
//   seed por força bruta a partir da própria mão inicial e prever as compras.

export interface RngHolder {
  rng: number;
  /** Estado do sfc32; quando presente, substitui o mulberry32. */
  rng128?: [number, number, number, number];
}

export function nextRandom(holder: RngHolder): number {
  const s = holder.rng128;
  if (s) {
    let [a, b, c, d] = s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    holder.rng128 = [a, b, c, d];
    return (t >>> 0) / 4294967296;
  }
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Estado inicial do sfc32 a partir de 4 palavras de 32 bits (descarta as 12 primeiras saídas). */
export function seedRng128(words: readonly number[]): [number, number, number, number] {
  if (words.length !== 4) throw new Error('A seed de 128 bits precisa de 4 números.');
  const holder: RngHolder = { rng: 0, rng128: [words[0] | 0, words[1] | 0, words[2] | 0, words[3] | 0] };
  for (let i = 0; i < 12; i++) nextRandom(holder);
  return holder.rng128!;
}

export function shuffleInPlace<T>(holder: RngHolder, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(holder) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
