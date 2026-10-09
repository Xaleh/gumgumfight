// Configurações do servidor via variáveis de ambiente.

const off = (v: string | undefined) => /^(off|0|false|no|nao|não)$/i.test(v ?? '');

export interface ServerOptions {
  /** CARD_IMAGES=off desliga as imagens oficiais: as URLs nem chegam ao navegador. */
  cardImages: boolean;
  /** GOOGLE_CLIENT_ID: Client ID do OAuth (tipo "Aplicativo da Web"). Sem ele, o login fica desligado. */
  googleClientId?: string | null;
  /**
   * ADMIN_EMAILS: e-mails (separados por vírgula) das contas Google que são sempre
   * administradoras. É assim que o primeiro admin aparece; os outros perfis são
   * dados por um admin na tela de perfis.
   */
  adminEmails?: string[];
  /**
   * ONLINE_BOT_ROOMS: treino contra o bot transmitido (o servidor joga pelo bot e a
   * partida aparece em "Assistir"; exige login). "off" desliga: some a opção
   * "Transmitir esta partida" e essas salas deixam de aparecer na lista para assistir.
   */
  onlineBotRooms?: boolean;
  /**
   * ONLINE_MAX_ROOMS / ONLINE_MAX_BOT_ROOMS: tetos de salas ativas no servidor (todas e
   * só as de treino contra o bot). Cada sala custa memória e CPU, e criar uma não exige
   * login; os padrões estão em online/lobby.ts (DEFAULT_LIMITS).
   */
  onlineLimits?: { maxRooms?: number; maxBotRooms?: number };
}

const positiveInt = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export const parseEmails = (v: string | undefined) =>
  (v ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));

export const serverOptions: ServerOptions = {
  cardImages: !off(process.env.CARD_IMAGES),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  adminEmails: parseEmails(process.env.ADMIN_EMAILS),
  onlineBotRooms: !off(process.env.ONLINE_BOT_ROOMS),
  onlineLimits: { maxRooms: positiveInt(process.env.ONLINE_MAX_ROOMS), maxBotRooms: positiveInt(process.env.ONLINE_MAX_BOT_ROOMS) },
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
