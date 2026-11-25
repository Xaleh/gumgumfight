// Cria uma conta e uma sessão no banco dos testes de ponta a ponta, com as mesmas funções do
// servidor (`auth/store.ts`): é o "login" dos testes, sem rota nem atalho no código de produção.
// Uso: tsx e2e/support/account-cli.ts <banco> <apelido> [perfil]. Escreve {"userId", "token"} na saída.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [dbPath, name, role] = process.argv.slice(2);
if (!dbPath || !name) {
  console.error('uso: tsx e2e/support/account-cli.ts <banco> <apelido> [perfil]');
  process.exit(1);
}

// Caminhos em variável: o typecheck do e2e não percorre o servidor (que tem o seu próprio tsconfig).
const server = join(dirname(fileURLToPath(import.meta.url)), '../../apps/server/src');
const { openDb } = await import(pathToFileURL(join(server, 'db.ts')).href);
const store = await import(pathToFileURL(join(server, 'auth/store.ts')).href);

const db = openDb(dbPath);
const sub = `e2e-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const user = store.upsertGoogleUser(db, { sub, email: `${sub}@e2e.invalid`, name, picture: null, emailVerified: true });
if (role) store.setUserRole(db, user.id, role);
const token: string = store.createSession(db, user.id);
db.close();
process.stdout.write(JSON.stringify({ userId: user.id, token }));
