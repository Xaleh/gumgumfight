// Web Push sem dependências: a assinatura VAPID (RFC 8292) e a criptografia do conteúdo
// (RFC 8291, "aes128gcm") feitas com o `node:crypto`. O navegador entrega ao servidor uma
// inscrição (endpoint do serviço de push + chaves); o servidor cifra a mensagem para essas
// chaves e a envia ao endpoint, assinando com o par de chaves VAPID do servidor.

import { createECDH, createPrivateKey, createCipheriv, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';

/** Par de chaves VAPID: a pública (65 bytes, ponto não comprimido) e a privada (32 bytes), em base64url. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Inscrição de um navegador (`PushSubscription.toJSON()`). */
export interface PushTarget {
  endpoint: string;
  /** Chave pública ECDH P-256 do navegador (base64url, 65 bytes). */
  p256dh: string;
  /** Segredo de autenticação do navegador (base64url, 16 bytes). */
  auth: string;
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    publicKey: Buffer.concat([Buffer.from([4]), b64(jwk.x!), b64(jwk.y!)]).toString('base64url'),
    privateKey: jwk.d!,
  };
}

/** As chaves de uma inscrição têm o tamanho certo (chave pública P-256 não comprimida e segredo de 16 bytes). */
export function validKeys(p256dh: unknown, auth: unknown): boolean {
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 100 || auth.length > 40) return false;
  const pub = b64(p256dh);
  return pub.length === 65 && pub[0] === 4 && b64(auth).length === 16;
}

/**
 * Cabeçalho `Authorization` do VAPID: um JWT ES256 com a origem do serviço de push
 * (`aud`), a validade (12 h) e o contato do servidor (`sub`, mailto: ou https:).
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const pub = b64(keys.publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url'), d: keys.privateKey },
    format: 'jwk',
  });
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${body}.${sig}, k=${keys.publicKey}`;
}

/**
 * Cifra a mensagem para a inscrição (RFC 8291): ECDH entre uma chave descartável do
 * servidor e a do navegador, HKDF com o segredo de autenticação, AES-128-GCM num único
 * registro. `salt` e `localPrivateKey` só são passados nos testes.
 */
export function encryptPayload(
  payload: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  opts: { salt?: Buffer; localPrivateKey?: Buffer } = {},
): Buffer {
  const uaPublic = b64(target.p256dh);
  const ecdh = createECDH('prime256v1');
  if (opts.localPrivateKey) ecdh.setPrivateKey(opts.localPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, b64(target.auth), keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02: delimitador do último (e único) registro, sem preenchimento.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export interface PushOptions {
  /** Segundos que o serviço de push guarda a mensagem se o aparelho estiver desligado. */
  ttl: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

/** Envia uma mensagem; devolve o status HTTP do serviço de push (404/410 = inscrição que não existe mais). */
export async function sendPush(target: PushTarget, payload: unknown, keys: VapidKeys, subject: string, opts: PushOptions): Promise<number> {
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidAuthorization(target.endpoint, keys, subject),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(opts.ttl),
      urgency: opts.urgency ?? 'normal',
    },
    body: encryptPayload(Buffer.from(JSON.stringify(payload)), target),
    signal: AbortSignal.timeout(10_000),
  });
  await res.arrayBuffer().catch(() => undefined);
  return res.status;
}

/**
 * Serviços de push aceitos (Chrome/Android, Firefox, Edge/Windows, Safari/iOS). O servidor faz
 * um POST para o endpoint que o navegador manda: sem esta lista, qualquer URL viraria um
 * pedido do servidor para onde o cliente quisesse.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];

export function allowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}
