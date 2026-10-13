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
  /**
   * PUSH: notificações no celular (Web Push). "off" desliga: some a opção nas
   * configurações do app. As chaves VAPID são geradas na primeira vez e guardadas no
   * banco; VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (base64url) fixam outras.
   */
  push?: boolean;
  vapidKeys?: { publicKey?: string | null; privateKey?: string | null };
  /** VAPID_SUBJECT: contato do servidor para os serviços de push (mailto: ou https:). */
  vapidSubject?: string;
  /** Apoio ao projeto (Pix, Apoia.se, meta do mês). Sem nada configurado, o item "Apoiar" some do site. */
  support?: SupportOptions;
  /**
   * ACCESS=supporters: o site só abre para apoiadores Tripulante ou acima (e admins).
   * Usado na homologação, que consulta o plano na produção (SUPPORT_SOURCE_URL).
   */
  access?: AccessOptions;
}

export interface SupportOptions {
  /** SUPPORT_PIX_KEY / SUPPORT_PIX_NAME / SUPPORT_PIX_CITY: chave Pix (de preferência aleatória), nome e cidade do recebedor. */
  pixKey?: string | null;
  pixName?: string | null;
  pixCity?: string | null;
  /** SUPPORT_COFFEE_URL: página de doação avulsa com cartão (opcional; o "Cafezim" é o Pix). */
  coffeeUrl?: string | null;
  /** SUPPORT_MONTHLY_URL: página dos planos mensais (a campanha na Apoia.se). */
  monthlyUrl?: string | null;
  /** SUPPORT_GOAL_BRL: custo mensal do site (VPS + domínios), mostrado como meta. */
  goalBrl?: number | null;
  /** SUPPORT_CONTACT_URL: contato para lojas que querem patrocinar (mailto: ou link). */
  contactUrl?: string | null;
  /**
   * APOIASE_API_KEY / APOIASE_API_SECRET: chave e segredo da API pública da Apoia.se (pedidos
   * na Central de Ajuda deles). Com os dois, o plano mensal vem da Apoia.se pelo e-mail da conta.
   */
  apoiaseKey?: string | null;
  apoiaseSecret?: string | null;
  /** APOIASE_API_URL: endereço da API (padrão https://api.apoia.se). */
  apoiaseUrl?: string | null;
  /** KOFI_WEBHOOK_TOKEN: token de verificação do webhook do Ko-fi (sem ele, o webhook fica desligado). */
  kofiToken?: string | null;
  /** INTERNAL_TOKEN: token da consulta de plano feita pela homologação (sem ele, a consulta fica desligada). */
  internalToken?: string | null;
}

export interface AccessOptions {
  mode: 'open' | 'supporters';
  /** SUPPORT_SOURCE_URL: site onde os planos são consultados (a produção). Vazio = só os planos deste servidor. */
  sourceUrl?: string | null;
  /** INTERNAL_TOKEN usado na consulta à produção. */
  token?: string | null;
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

const text = (v: string | undefined) => v?.trim() || null;
/** Só links http(s) e mailto: (o valor vai parar num href). */
const link = (v: string | undefined) => {
  const t = text(v);
  return t && /^(https?:\/\/|mailto:)/i.test(t) ? t : null;
};
const money = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function supportOptions(env = process.env): SupportOptions {
  return {
    pixKey: text(env.SUPPORT_PIX_KEY),
    pixName: text(env.SUPPORT_PIX_NAME),
    pixCity: text(env.SUPPORT_PIX_CITY),
    coffeeUrl: link(env.SUPPORT_COFFEE_URL),
    monthlyUrl: link(env.SUPPORT_MONTHLY_URL),
    goalBrl: money(env.SUPPORT_GOAL_BRL),
    contactUrl: link(env.SUPPORT_CONTACT_URL),
    apoiaseKey: text(env.APOIASE_API_KEY),
    apoiaseSecret: text(env.APOIASE_API_SECRET),
    apoiaseUrl: link(env.APOIASE_API_URL)?.replace(/\/+$/, '') ?? 'https://api.apoia.se',
    kofiToken: text(env.KOFI_WEBHOOK_TOKEN),
    internalToken: text(env.INTERNAL_TOKEN),
  };
}

export function accessOptions(env = process.env): AccessOptions {
  return {
    mode: /^supporters?$/i.test(env.ACCESS ?? '') ? 'supporters' : 'open',
    sourceUrl: link(env.SUPPORT_SOURCE_URL)?.replace(/\/+$/, '') ?? null,
    token: text(env.INTERNAL_TOKEN),
  };
}

export const serverOptions: ServerOptions = {
  cardImages: !off(process.env.CARD_IMAGES),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  adminEmails: parseEmails(process.env.ADMIN_EMAILS),
  onlineBotRooms: !off(process.env.ONLINE_BOT_ROOMS),
  onlineLimits: { maxRooms: positiveInt(process.env.ONLINE_MAX_ROOMS), maxBotRooms: positiveInt(process.env.ONLINE_MAX_BOT_ROOMS) },
  support: supportOptions(),
  access: accessOptions(),
  push: !off(process.env.PUSH),
  vapidKeys: { publicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null, privateKey: process.env.VAPID_PRIVATE_KEY?.trim() || null },
  vapidSubject: process.env.VAPID_SUBJECT?.trim() || undefined,
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
