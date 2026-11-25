// Link do Sandbox de regras: `/?sandbox=<mesa em base64url>`. A mesa inteira viaja no link (é
// o que se quer compartilhar); quem abre vê o editor preenchido e decide se joga. O conteúdo vem
// de fora, então passa pelo `parseSandboxSpec` do motor (forma e limites) antes de ser usado.

import { parseSandboxSpec, type SandboxSpec } from '@gumgum/engine';
import { decodeBase64Url, encodeBase64Url } from '../deeplink';

export const SANDBOX_PARAM = 'sandbox';

/** Maior mesa aceita no link (uma mesa cheia dos dois lados fica em uns 2 KB). */
const MAX_SANDBOX_PARAM = 8 * 1024;

/** A mesa em texto compacto (sem os valores padrão) para o link. */
export function encodeSandbox(spec: SandboxSpec): string {
  return encodeBase64Url(JSON.stringify(parseSandboxSpec(spec) ?? spec));
}

/** Endereço completo para compartilhar a mesa. */
export function sandboxUrl(spec: SandboxSpec, origin: string): string {
  return `${origin}/?${SANDBOX_PARAM}=${encodeSandbox(spec)}`;
}

/**
 * Lê a mesa do link. `spec` null com `invalid` true: havia `sandbox`, mas não dava para ler;
 * os dois vazios: não era um link do sandbox.
 */
export function parseSandboxLink(params: URLSearchParams): { spec: SandboxSpec | null; invalid: boolean } {
  const raw = params.get(SANDBOX_PARAM);
  if (raw === null) return { spec: null, invalid: false };
  const text = raw.length <= MAX_SANDBOX_PARAM ? decodeBase64Url(raw) : null;
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const spec = parseSandboxSpec(json);
  return { spec, invalid: spec === null };
}
