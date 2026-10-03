// Configurações do servidor via variáveis de ambiente.

const off = (v: string | undefined) => /^(off|0|false|no|nao|não)$/i.test(v ?? '');

export interface ServerOptions {
  /** CARD_IMAGES=off desliga as imagens oficiais: as URLs nem chegam ao navegador. */
  cardImages: boolean;
}

export const serverOptions: ServerOptions = {
  cardImages: !off(process.env.CARD_IMAGES),
};

/**
 * SPOILER_SYNC: de quantas em quantas horas o servidor procura na API as cartas de
 * spoiler que viraram oficiais (padrão 6). "off" desliga. Nunca roda nos testes.
 */
export function spoilerSyncHours(env = process.env): number | null {
  if (off(env.SPOILER_SYNC) || env.NODE_ENV === 'test' || env.VITEST) return null;
  const hours = Number(env.SPOILER_SYNC ?? 6);
  return Number.isFinite(hours) && hours > 0 ? hours : 6;
}
