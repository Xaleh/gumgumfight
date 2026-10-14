// Imagens das cartas pelo mesmo domínio do site (`/card-img/...`).
//
// As imagens vêm de sites de fora (optcgapi e, para os spoilers, optcgleaks). Um <img>
// comum as mostra sem problema, mas o kit de divulgação dos torneios desenha as cartas
// num canvas e exporta PNG/PDF: com imagem de outro domínio sem CORS, o navegador
// "contamina" o canvas e recusa a exportação. Por isso o kit usa as URLs reescritas
// para `/card-img/<origem>/<caminho>`, servidas pelo próprio domínio.
//
// Em produção o Nginx atende `/card-img/` com proxy_pass + proxy_cache (ver
// deploy/bootstrap-hostinger.sh) e a requisição nem chega ao app. Esta rota é a
// alternativa sem Nginx (desenvolvimento, testes, instalação simples): busca na origem
// e devolve a imagem com cache longo no navegador.

import type { FastifyInstance } from 'fastify';

/** Origens aceitas: prefixo público → endereço de origem. Só estas (nada de proxy aberto). */
export const CARD_IMAGE_ORIGINS: Record<string, string> = {
  optcgapi: 'https://optcgapi.com/media/',
  optcgleaks: 'https://images.optcgleaks.com/',
};

export const CARD_IMAGE_PREFIX = '/card-img/';

/** Caminho seguro: letras, números e `_ - . /`, sem `..` e com extensão de imagem. */
const SAFE_PATH = /^(?!.*\.\.)[A-Za-z0-9_\-./]+\.(?:jpe?g|png|webp)$/i;

/** URL da imagem pelo mesmo domínio (null = origem desconhecida: o kit desenha a carta sem arte). */
export function proxiedImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const [key, base] of Object.entries(CARD_IMAGE_ORIGINS)) {
    if (!url.startsWith(base)) continue;
    const path = url.slice(base.length).split(/[?#]/)[0];
    return SAFE_PATH.test(path) ? `${CARD_IMAGE_PREFIX}${key}/${path}` : null;
  }
  return null;
}

/** Tamanho máximo de uma imagem de carta (as da optcgapi têm ~100 KB). */
const MAX_BYTES = 4 * 1024 * 1024;

export function registerCardImageRoutes(app: FastifyInstance, { enabled, fetchImpl = fetch }: { enabled: boolean; fetchImpl?: typeof fetch }) {
  app.get<{ Params: { origin: string; '*': string } }>('/card-img/:origin/*', async (req, reply) => {
    const base = CARD_IMAGE_ORIGINS[req.params.origin];
    const path = req.params['*'];
    if (!enabled || !base || !SAFE_PATH.test(path)) return reply.code(404).send();
    let res: Response;
    try {
      res = await fetchImpl(base + path, { signal: AbortSignal.timeout(15_000) });
    } catch {
      return reply.code(502).send();
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return reply.code(res.status === 404 ? 404 : 502).send();
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return reply.code(502).send();
    return reply
      .header('content-type', type)
      .header('cache-control', 'public, max-age=604800')
      .header('access-control-allow-origin', '*')
      .send(body);
  });
}
