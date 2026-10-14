import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const SW_SOURCE = join(__dirname, 'src/service-worker.js');

/** O service worker com a versão e a lista de arquivos guardados para abrir sem internet. */
function renderServiceWorker(build: string, precache: string[]) {
  return readFileSync(SW_SOURCE, 'utf8').replace('__BUILD__', JSON.stringify(build)).replace('__PRECACHE__', JSON.stringify(precache));
}

/**
 * `/sw.js`: o service worker do PWA (cache da casca do app e notificações). Na compilação
 * guarda o HTML, o JS principal, o CSS, as imagens e os ícones (os dicionários dos outros
 * idiomas e os áudios ficam para quando forem usados); em desenvolvimento, sem cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'gumgum-service-worker',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('content-type', 'text/javascript');
        res.setHeader('cache-control', 'no-cache');
        res.end(renderServiceWorker('dev', []));
      });
    },
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .filter((f) => (f.type === 'chunk' ? f.isEntry : /\.(css|webp|jpg|png|svg)$/.test(f.fileName)))
        .map((f) => `/${f.fileName}`);
      const icons = readdirSync(join(__dirname, 'public/icons'))
        .filter((f) => !f.includes('1024'))
        .map((f) => `/icons/${f}`);
      const precache = ['/index.html', '/manifest.webmanifest', '/favicon.svg', ...icons, ...files].sort();
      const build = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderServiceWorker(build, precache) });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    port: 5173,
    host: true,
    // 127.0.0.1 em vez de localhost: evita tentar IPv6 (::1) quando o servidor escuta só em IPv4.
    proxy: {
      // Imagens das cartas pelo mesmo domínio (kit de divulgação dos torneios).
      '/card-img': 'http://127.0.0.1:3001',
      '/api': {
        target: 'http://127.0.0.1:3001',
        // Quando o servidor reinicia, fecha também os canais SSE das partidas online
        // (sem isso o proxy do Vite segura a conexão e o navegador não reconecta).
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => {
              if (!res.writableEnded) res.end();
            });
          });
        },
      },
    },
  },
});
