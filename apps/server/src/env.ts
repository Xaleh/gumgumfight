// Em desenvolvimento, lê o arquivo .env da raiz do projeto (ex.: GOOGLE_CLIENT_ID).
// Precisa ser o primeiro import do index.ts: config.ts lê process.env ao ser carregado.
// Em produção as variáveis vêm do pm2 (deploy/ecosystem.config.cjs).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths';

const file = join(ROOT, '.env');
if (process.env.NODE_ENV !== 'production' && existsSync(file)) process.loadEnvFile(file);
