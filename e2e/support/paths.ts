// Porta e caminhos dos testes de ponta a ponta, iguais no config, no servidor (serve.ts) e nos testes.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const PORT = process.env.E2E_PORT ?? '3410';
/** Uma pasta por porta: duas execuções em portas diferentes não apagam o banco uma da outra. */
export const TMP_DIR = join(ROOT, 'e2e/.tmp', PORT);
export const DB_PATH = join(TMP_DIR, 'e2e.db');
