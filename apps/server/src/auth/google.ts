// Login com conta Google (Google Identity Services).
// O navegador recebe do Google um ID token (JWT assinado com RS256) e o envia ao
// servidor, que confere a assinatura com as chaves públicas do Google e os campos
// iss/aud/exp. Não há segredo do cliente nem redirecionamento: só o Client ID.

import { createPublicKey, type JsonWebKey, type KeyObject, verify } from 'node:crypto';
import type { ErrorParams } from '../errors';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Tolerância para relógios fora de sincronia. */
const CLOCK_SKEW_MS = 60_000;

export interface GoogleIdentity {
  /** Id permanente da conta Google (o e-mail pode mudar). */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Devolve a chave pública do Google com esse `kid` (ou null se não existir). */
export type GoogleKeys = (kid: string) => Promise<KeyObject | null>;

/**
 * Chaves públicas do Google, guardadas em memória pelo tempo do Cache-Control.
 * Um `kid` desconhecido força uma nova busca (o Google troca as chaves de tempos
 * em tempos), no máximo uma vez por minuto.
 */
export function googleKeyStore(fetchImpl: typeof fetch = fetch, url = GOOGLE_CERTS_URL): GoogleKeys {
  let keys = new Map<string, KeyObject>();
  let expiresAt = 0;
  let fetchedAt = 0;
  let pending: Promise<void> | null = null;

  const refresh = async () => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new LoginError('googleKeysUnavailable', `Chaves do Google indisponíveis (${res.status})`, { status: res.status });
    const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const next = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kid && jwk.kty === 'RSA') next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    keys = next;
    fetchedAt = Date.now();
    expiresAt = fetchedAt + maxAge * 1000;
  };
  const load = () => (pending ??= refresh().finally(() => (pending = null)));

  return async (kid) => {
    if (Date.now() >= expiresAt) await load();
    if (!keys.has(kid) && Date.now() - fetchedAt > 60_000) await load();
    return keys.get(kid) ?? null;
  };
}

const decodePart = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Erro de login mostrado ao usuário: a mensagem em português e a chave `errorCode` para o cliente traduzir. */
export class LoginError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly errorParams?: ErrorParams,
  ) {
    super(message);
  }
}

/** Confere um ID token do Google. Lança um `LoginError` com a mensagem para o usuário se ele não for válido. */
export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  keys: GoogleKeys,
  now = Date.now(),
): Promise<GoogleIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new LoginError('googleTokenMalformed', 'Token do Google malformado.');
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new LoginError('googleTokenMalformed', 'Token do Google malformado.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new LoginError('googleTokenBadAlg', 'Token do Google com assinatura inesperada.');
  const key = await keys(header.kid);
  if (!key) throw new LoginError('googleTokenUnknownKey', 'Token do Google assinado com uma chave desconhecida.');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify('RSA-SHA256', signed, key, Buffer.from(parts[2], 'base64url'))) {
    throw new LoginError('googleTokenBadSignature', 'Assinatura do token do Google inválida.');
  }

  if (!ISSUERS.has(String(payload.iss))) throw new LoginError('googleTokenBadIssuer', 'Token não foi emitido pelo Google.');
  if (payload.aud !== clientId) throw new LoginError('googleTokenBadAudience', 'Token emitido para outro site.');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now - CLOCK_SKEW_MS) throw new LoginError('loginExpired', 'Login expirado; tente de novo.');
  if (typeof payload.iat === 'number' && payload.iat * 1000 > now + CLOCK_SKEW_MS) throw new LoginError('googleTokenFuture', 'Token do Google com data futura.');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new LoginError('googleTokenNoAccount', 'Token do Google sem conta.');

  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    sub: payload.sub,
    email: str(payload.email),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: str(payload.name),
    picture: str(payload.picture),
  };
}
