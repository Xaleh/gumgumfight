// Spoilers novos nos testes: duas cartas de spoiler gravadas direto no banco temporário (spoiler-cli.ts, com a
// função do servidor), como se tivessem acabado de chegar do site. Nenhuma rota de teste na produção.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DB_PATH, ROOT } from './paths';

const run = (action: 'add' | 'remove') =>
  execFileSync('npx', ['tsx', join(ROOT, 'e2e/support/spoiler-cli.ts'), DB_PATH, action], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

/** Os nomes das cartas, na ordem em que o cartão de dicas as mostra (mesma data: pelo número). */
export const NEW_SPOILERS = ['Spoiler Um', 'Spoiler Dois'];

export const addSpoilers = () => void run('add');
/** Tira as cartas: os outros testes seguem sem spoilers no banco. */
export const removeSpoilers = () => void run('remove');
