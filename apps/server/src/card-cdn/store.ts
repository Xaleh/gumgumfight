// O que o resto do card-cdn/ compartilha: onde as imagens ficam e como uma imagem é reconhecida.

import { createHash } from 'node:crypto';

/** Onde as imagens ficam guardadas. */
export interface ImageStore {
  /** Endereço público, sem barra no fim. */
  publicBase: string;
  has(key: string): Promise<boolean>;
  put(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void>;
}

/** Cache das imagens: o endereço muda quando o conteúdo muda (`?v=`). */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

export const MAX_BYTES = 4 * 1024 * 1024;

export const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Tipo pelo conteúdo: a optcgapi manda PNG com `content-type: image/jpeg`. */
export function sniffImageType(body: Buffer): string | null {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** `?v=`: hash do conteúdo, curto. */
export const contentHash = (body: Buffer) => createHash('sha256').update(body).digest('hex').slice(0, 12);
