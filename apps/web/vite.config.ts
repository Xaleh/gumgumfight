import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 127.0.0.1 em vez de localhost: evita tentar IPv6 (::1) quando o servidor escuta só em IPv4.
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
