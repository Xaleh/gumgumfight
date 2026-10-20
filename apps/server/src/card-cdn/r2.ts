// Cloudflare R2 pela API compatível com S3, com a assinatura AWS SigV4 feita aqui mesmo
// (node:crypto + fetch): nada de SDK nem módulo nativo, o pacote de release continua autocontido.
//
//   PUT  https://<conta>.r2.cloudflarestorage.com/<bucket>/<chave>   grava um objeto
//   HEAD https://<conta>.r2.cloudflarestorage.com/<bucket>/<chave>   o objeto existe?
//
// As leituras públicas não passam por aqui: o bucket fica exposto num domínio próprio
// (CARD_CDN_URL) e as imagens são lidas direto de lá.

import { createHash, createHmac } from 'node:crypto';

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Padrão: https://<accountId>.r2.cloudflarestorage.com */
  endpoint?: string;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** Codificação de caminho da AWS (RFC 3986): cada parte da chave, sem codificar as barras. */
const encodePath = (path: string) =>
  path
    .split('/')
    .map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

/**
 * Cabeçalhos assinados (SigV4) de uma requisição sem query string. `headers` entra na assinatura
 * (além de host, x-amz-date e x-amz-content-sha256); a data pode ser fixada para testes.
 */
export function signRequest(req: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  date?: Date;
}): Record<string, string> {
  const url = new URL(req.url);
  const service = req.service ?? 's3';
  const amzDate = (req.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: url.host,
    'x-amz-content-sha256': req.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    req.method,
    encodePath(decodeURIComponent(url.pathname)),
    '',
    ...names.map((n) => `${n}:${headers[n]}`),
    '',
    names.join(';'),
    req.payloadHash,
  ].join('\n');
  const scope = `${day}/${req.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${req.secretAccessKey}`, day), req.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...rest } = headers;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

export class R2Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function r2Client(cfg: R2Config, fetchImpl: typeof fetch = fetch) {
  const endpoint = (cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(/\/$/, '');
  const objectUrl = (key: string) => `${endpoint}/${encodePath(cfg.bucket)}/${encodePath(key)}`;
  const send = async (method: 'PUT' | 'HEAD', key: string, body?: Buffer, headers: Record<string, string> = {}) => {
    const url = objectUrl(key);
    const signed = signRequest({
      method,
      url,
      headers,
      payloadHash: sha256(body ?? ''),
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: 'auto',
    });
    return fetchImpl(url, { method, headers: signed, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
  };
  return {
    async has(key: string): Promise<boolean> {
      const res = await send('HEAD', key);
      if (res.status === 404) return false;
      if (!res.ok) throw new R2Error(res.status, `R2 HEAD ${key}: ${res.status}`);
      return true;
    },
    async put(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
      const res = await send('PUT', key, body, { 'content-type': contentType, 'cache-control': cacheControl });
      if (!res.ok) throw new R2Error(res.status, `R2 PUT ${key}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}
