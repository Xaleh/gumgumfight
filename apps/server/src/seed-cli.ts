import { openDb } from './db';
import { DB_PATH } from './paths';
import { seed } from './seed';

const db = openDb();
const r = seed(db);
console.log(`Banco: ${DB_PATH}`);
console.log(`Cartas gravadas: ${r.written} | ignoradas (já vindas da API): ${r.skipped} | decks: ${r.decks} | traduções manuais: ${r.translations}`);
console.log(
  `Spoilers: ${r.spoilers.written} gravados | ${r.spoilers.official} já oficiais | ${r.spoilers.removed} removidos` +
    (r.spoilers.invalid.length ? ` | inválidos: ${r.spoilers.invalid.join(', ')}` : ''),
);
