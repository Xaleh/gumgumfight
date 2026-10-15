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

import { CARD_IMAGE_ORIGINS, CARD_IMAGE_PREFIX, CARD_IMAGE_SAFE_PATH as SAFE_PATH, proxiedImageUrl } from '@gumgum/engine';
import type { FastifyInstance } from 'fastify';

// A tabela de origens e a reescrita das URLs ficam no motor (`art.ts`), porque o navegador
// também reescreve (decklist do oponente no fim da partida); aqui só a rota.
export { CARD_IMAGE_ORIGINS, CARD_IMAGE_PREFIX, proxiedImageUrl };

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
