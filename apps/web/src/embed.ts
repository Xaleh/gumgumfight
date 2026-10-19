// Replay embutido em apps parceiros (SweetApp): `/replay/<id>?t=<token>&embed=1&lang=pt-BR&layout=tablet|lateral`.
// O servidor gera o link assinado (`POST /api/matches/:id/replay-link`) e libera esta página num
// iframe só nas origens dos parceiros (apps/server/src/partners/replay-link.ts).
//
// Comandos por postMessage (do parceiro para o player): `{type:'seek', pos}`, `{type:'play'}`,
// `{type:'pause'}`. O player avisa `{type:'ready', pos, total}` ao abrir, `{type:'pos', pos, total}` a
// cada ação e `{type:'ended'}` no fim, todos com `source: 'gumgumfight-replay'`.

import { isLocale, type Locale } from './i18n';

export type EmbedLayout = 'tablet' | 'lateral';

export interface ReplayEmbed {
  matchId: number;
  /** Token assinado do link (sem ele o servidor recusa). */
  token: string;
  /** embed=1: sem os botões de sair e de baixar (a página vive dentro de outro site). */
  embed: boolean;
  lang?: Locale;
  /** Mesa em pé (tablet) ou lateral (jogadores à esquerda e à direita), nas telas largas. */
  layout?: EmbedLayout;
  /** autoplay=1: começa rodando; sem ele, parado no início (passo a passo). */
  autoplay: boolean;
}

const PATH = /^\/replay\/(\d{1,12})\/?$/;
const TOKEN = /^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{43}$/;

/** A página é a do replay embutido? (Antes de saber se o link é válido.) */
export const isReplayPath = (pathname: string) => pathname.startsWith('/replay/');

/** `lang` do link: o código exato (`pt-BR`) ou só o idioma (`pt`, `en-US` → `en`). */
function embedLocale(v: string | null): Locale | undefined {
  if (!v) return undefined;
  if (isLocale(v)) return v;
  const base = v.split('-')[0].toLowerCase();
  if (base === 'pt') return 'pt-BR';
  return isLocale(base) ? base : undefined;
}

/** Lê o endereço da página; null se não for um link de replay utilizável (caminho ou token inválidos). */
export function parseReplayEmbed(pathname: string, search: string | URLSearchParams): ReplayEmbed | null {
  const m = PATH.exec(pathname);
  if (!m) return null;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const token = params.get('t');
  if (!token || !TOKEN.test(token)) return null;
  const matchId = Number(m[1]);
  if (!Number.isSafeInteger(matchId) || matchId < 1) return null;
  const layout = params.get('layout');
  const lang = embedLocale(params.get('lang'));
  return {
    matchId,
    token,
    embed: params.get('embed') === '1',
    ...(lang ? { lang } : {}),
    ...(layout === 'tablet' || layout === 'lateral' ? { layout } : {}),
    autoplay: params.get('autoplay') === '1',
  };
}

export type EmbedCommand = { type: 'seek'; pos: number } | { type: 'play' } | { type: 'pause' };

/** Comando vindo do parceiro; null para qualquer outra mensagem (outras bibliotecas também usam postMessage). */
export function parseEmbedCommand(data: unknown): EmbedCommand | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { type?: unknown; pos?: unknown };
  if (d.type === 'play' || d.type === 'pause') return { type: d.type };
  if (d.type === 'seek' && typeof d.pos === 'number' && Number.isInteger(d.pos) && d.pos >= 0) return { type: 'seek', pos: d.pos };
  return null;
}

/** A mensagem veio de uma origem liberada (as do servidor; o próprio site também vale)? */
export const embedOriginAllowed = (origin: string, allowed: readonly string[], self: string) => origin === self || allowed.includes(origin);

export const EMBED_SOURCE = 'gumgumfight-replay';

export type EmbedEvent = { type: 'ready'; pos: number; total: number } | { type: 'pos'; pos: number; total: number } | { type: 'ended' };
