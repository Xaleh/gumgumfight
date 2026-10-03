import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 127.0.0.1 em vez de localhost: evita tentar IPv6 (::1) quando o servidor escuta só em IPv4.
    proxy: {
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
