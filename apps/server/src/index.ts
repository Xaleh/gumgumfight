import { buildApp } from './app';
import { countCards, openDb } from './db';
import { DB_PATH } from './paths';
import { seed } from './seed';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const db = openDb();
// Sempre sincroniza os decks e cartas provisórias (nunca sobrescreve cartas da API).
const r = seed(db);
console.log(`Banco ${DB_PATH}: ${countCards(db)} cartas, ${r.decks} decks.`);

const app = buildApp(db, { logger: process.env.NODE_ENV !== 'test' });
app.listen({ port: PORT, host: HOST }).catch((err) => {
  console.error(err);
  process.exit(1);
});
