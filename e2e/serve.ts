// Servidor dos testes de ponta a ponta: o mesmo `apps/server/src/index.ts` da produção, com um banco
// SQLite novo a cada execução (em e2e/.tmp/<porta>, apagado antes de subir) e servindo o build do web
// (`apps/web/dist`). Quem chama é o `webServer` do playwright.config.ts; `npm run e2e` compila o web antes.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DB_PATH, PORT, ROOT, TMP_DIR } from './support/paths';

const dist = join(ROOT, 'apps/web/dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('\nFalta o build do web (apps/web/dist). Rode `npm run build` ou use `npm run e2e`, que compila antes.\n');
  process.exit(1);
}

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

Object.assign(process.env, {
  DB_PATH,
  WEB_DIST: dist,
  PORT,
  HOST: '127.0.0.1',
  // Sem log por requisição e sem as buscas periódicas (spoilers, meta global, Apoia.se).
  NODE_ENV: 'test',
  // Sem imagens das cartas: os testes não dependem de sites de fora.
  CARD_IMAGES: 'off',
  PUSH: 'off',
});

// Caminho em variável: o typecheck do e2e não percorre o servidor (que tem o seu próprio tsconfig).
const server = pathToFileURL(join(ROOT, 'apps/server/src/index.ts')).href;
await import(server);
