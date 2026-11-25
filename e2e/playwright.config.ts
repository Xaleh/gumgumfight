// Testes de ponta a ponta no navegador (Playwright). `npm run e2e` compila o web e roda tudo;
// ver docs/plano-testes-e2e.md e a seção "Testes" do README.
//
// Dois projetos:
//   desktop — Chromium em 1280 × 800, todos os testes;
//   iphone  — o iPhone 13 no WebKit (o motor do Safari), só os testes marcados com @iphone.
// Sem o WebKit instalado (`npx playwright install webkit`), o projeto iphone roda no Chromium com a
// tela, o toque e o user agent do iPhone e avisa; no CI (CI=true) o WebKit é obrigatório.

import { defineConfig, devices, webkit } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.E2E_PORT ?? 3410);
const ci = Boolean(process.env.CI);

function hasWebkit() {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
}

const { defaultBrowserType: _webkit, ...iphoneOnChromium } = devices['iPhone 13'];
const iphone = ci || hasWebkit() ? devices['iPhone 13'] : iphoneOnChromium;
// O arquivo é carregado de novo em cada processo do Playwright: o aviso sai uma vez só.
if (iphone === iphoneOnChromium && !process.env.E2E_WEBKIT_WARNED) {
  process.env.E2E_WEBKIT_WARNED = '1';
  console.warn('[e2e] WebKit não instalado: o projeto iphone roda no Chromium com a emulação do iPhone.');
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(root, 'test-results/e2e'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Os testes dividem um servidor e um banco: um de cada vez, na ordem dos arquivos.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { outputFolder: join(root, 'playwright-report'), open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // O service worker guardaria a casca do app entre testes; cada teste começa do zero.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'iphone', use: iphone, grep: /@iphone/ },
  ],
  webServer: {
    command: 'npx tsx e2e/serve.ts',
    cwd: root,
    url: `http://127.0.0.1:${port}/api/health`,
    env: { E2E_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
