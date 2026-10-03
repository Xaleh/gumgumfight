import { buildApp } from './app';
import { spoilerSyncHours } from './config';
import { countCards, type DB, openDb } from './db';
import { DEFAULT_API_BASE } from './optcgapi';
import { join } from 'node:path';
import { DATA_DIR, DB_PATH } from './paths';
import { seed } from './seed';
import { scheduleSpoilerSync } from './spoiler-sync';

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
if (r.spoilers.written || r.spoilers.removed || r.spoilers.invalid.length) {
  console.log(
    `Spoilers: ${r.spoilers.written} cartas, ${r.spoilers.official} já oficiais, ${r.spoilers.removed} removidas` +
      (r.spoilers.invalid.length ? `, inválidas: ${r.spoilers.invalid.join(', ')}` : ''),
  );
}

// Busca os spoilers novos e troca pelas cartas oficiais quando a API as publicar.
const syncHours = spoilerSyncHours();
if (syncHours) {
  scheduleSpoilerSync(db, {
    base: process.env.CARD_API_BASE ?? DEFAULT_API_BASE,
    dir: join(DATA_DIR, 'spoilers'),
    hours: syncHours,
    log: (msg) => console.log(msg),
  });
}

const app = buildApp(db, { logger: process.env.NODE_ENV !== 'test' });
app.listen({ port: PORT, host: HOST }).catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} já está em uso. Feche o outro processo ou use PORT=<outra porta>.\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
