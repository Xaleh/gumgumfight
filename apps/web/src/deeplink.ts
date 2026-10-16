// Deep link do construtor: `/?deck=<lista em base64url>&name=<nome>&format=<standard|egb>`.
// Um app parceiro (ou qualquer pessoa) abre o construtor já preenchido com a lista; nada é
// salvo até o usuário clicar em Salvar, porque um link pode vir de qualquer lugar.

import { type FormatId, FORMATS } from '@gumgum/engine';

export interface DeckLink {
  /** A lista em texto, no formato do Exportar lista (`1xOP01-001`, uma carta por linha). */
  text: string;
  /** Nome sugerido (até 60 caracteres). */
  name?: string;
  format?: FormatId;
}

export const DECK_LINK_PARAMS = ['deck', 'name', 'format'] as const;

/** Maior lista aceita no link (uma lista de 51 linhas tem uns 800 caracteres). */
const MAX_DECK_PARAM = 8 * 1024;

/** base64url (com ou sem `=`) → texto UTF-8; null se não for base64 válido. */
export function decodeBase64Url(value: string): string | null {
  const clean = value.trim().replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) return null;
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    const bin = atob(b64);
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Texto → base64url sem `=` (o inverso de `decodeBase64Url`; útil para montar links). */
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Lê os parâmetros do link. `link` null com `invalid` true: havia `deck`, mas não dava para
 * ler (base64 quebrado ou lista vazia); os dois vazios: não era um deep link.
 */
export function parseDeckLink(params: URLSearchParams): { link: DeckLink | null; invalid: boolean } {
  const raw = params.get('deck');
  if (raw === null) return { link: null, invalid: false };
  const text = raw.length <= MAX_DECK_PARAM ? decodeBase64Url(raw) : null;
  if (!text || !text.trim()) return { link: null, invalid: true };
  const name = params.get('name')?.trim().replace(/\s+/g, ' ').slice(0, 60) || undefined;
  const format = params.get('format');
  return {
    link: { text, ...(name ? { name } : {}), ...(FORMATS.some((f) => f.id === format) ? { format: format as FormatId } : {}) },
    invalid: false,
  };
}
