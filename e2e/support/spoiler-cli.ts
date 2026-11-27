// Põe (ou tira) duas cartas de spoiler no banco dos testes de ponta a ponta, com a mesma função do servidor
// (`upsertCards`): entram com a data de agora, como um spoiler que acabou de chegar do site.
// Uso: tsx e2e/support/spoiler-cli.ts <banco> add|remove.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [dbPath, action] = process.argv.slice(2);
if (!dbPath || (action !== 'add' && action !== 'remove')) {
  console.error('uso: tsx e2e/support/spoiler-cli.ts <banco> add|remove');
  process.exit(1);
}

/** Origem só destes testes (começa com o `spoiler:` das cartas ainda não lançadas). */
const SOURCE = 'spoiler:e2e';

// Caminho em variável: o typecheck do e2e não percorre o servidor (que tem o seu próprio tsconfig).
const server = join(dirname(fileURLToPath(import.meta.url)), '../../apps/server/src');
const { openDb, upsertCards } = await import(pathToFileURL(join(server, 'db.ts')).href);

const db = openDb(dbPath);
if (action === 'add') {
  const card = (id: string, name: string) => ({ id, name, category: 'character', colors: ['red'], cost: 2, power: 3000, counter: 1000, types: ['E2E'], text: '[On Play] Draw 1 card.', set: 'EB99' });
  upsertCards(db, [card('EB99-001', 'Spoiler Um'), card('EB99-002', 'Spoiler Dois')], { provisional: true, source: SOURCE });
} else {
  db.prepare('DELETE FROM cards WHERE source = ?').run(SOURCE);
}
db.close();
