import { buildApp } from './app';
import { countCards, type DB, openDb } from './db';
import { DB_PATH } from './paths';
import { seed } from './seed';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

let db: DB;
try {
  db = openDb();
} catch (err) {
  console.error(`\nFalha ao abrir o banco SQLite (${DB_PATH}).`);
  console.error('Verifique se a pasta tem permissão de escrita e se o Node é 22.13 ou mais recente (node -v).\n');
  throw err;
}
// Sempre sincroniza os decks e cartas provisórias (nunca sobrescreve cartas da API).
const r = seed(db);
console.log(`Banco ${DB_PATH}: ${countCards(db)} cartas, ${r.decks} decks.`);

const app = buildApp(db, { logger: process.env.NODE_ENV !== 'test' });
app.listen({ port: PORT, host: HOST }).catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} já está em uso. Feche o outro processo ou use PORT=<outra porta>.\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
