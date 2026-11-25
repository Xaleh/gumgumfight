// Servidor dos testes de ponta a ponta: o mesmo `apps/server/src/index.ts` da produção, com um banco
// SQLite novo a cada execução (em e2e/.tmp/<porta>, apagado antes de subir) e servindo o build do web
// (`apps/web/dist`). Quem chama é o `webServer` do playwright.config.ts; `npm run e2e` compila o web antes.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.E2E_PORT ?? '3410';
// Uma pasta por porta: duas execuções em portas diferentes não apagam o banco uma da outra.
const tmp = join(root, 'e2e/.tmp', port);
const dist = join(root, 'apps/web/dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('\nFalta o build do web (apps/web/dist). Rode `npm run build` ou use `npm run e2e`, que compila antes.\n');
  process.exit(1);
}

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

Object.assign(process.env, {
  DB_PATH: join(tmp, 'e2e.db'),
  WEB_DIST: dist,
  PORT: port,
  HOST: '127.0.0.1',
  // Sem log por requisição e sem as buscas periódicas (spoilers, meta global, Apoia.se).
  NODE_ENV: 'test',
  // Sem imagens das cartas: os testes não dependem de sites de fora.
  CARD_IMAGES: 'off',
  PUSH: 'off',
});

// Caminho em variável: o typecheck do e2e não percorre o servidor (que tem o seu próprio tsconfig).
const server = pathToFileURL(join(root, 'apps/server/src/index.ts')).href;
await import(server);
