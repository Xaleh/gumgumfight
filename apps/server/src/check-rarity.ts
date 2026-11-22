// Confere a raridade das cartas do banco, de que o All Blue depende.
//
//   npm run cards:check-rarity -w @gumgum/server
//
// No All Blue só valem C, UC, R e promo (e qualquer Líder). Carta sem raridade conhecida fica de
// fora até ser corrigida (`cardLegality`), para o formato não deixar passar uma SR por falta de
// dado. Este relatório mostra quantas cartas há de cada raridade e lista as que estão sem: são as
// que precisam de correção na fonte (ou em `packages/engine/src/source-fixes.ts`).
// Rodar depois de importar uma coleção nova.

import { cardLegality, rarityCode } from '@gumgum/engine';
import { listCards, openDb } from './db';
import { DB_PATH } from './paths';

const db = openDb();
const cards = listCards(db);
const count: Record<string, number> = {};
const unknown: typeof cards = [];
let legal = 0;
for (const c of cards) {
  const code = rarityCode(c.rarity);
  count[code ?? 'sem raridade'] = (count[code ?? 'sem raridade'] ?? 0) + 1;
  if (cardLegality(c.id, 'allblue', undefined, c) === 'legal') legal++;
  // O Líder é livre: sem a raridade, ele continua valendo.
  else if (code === null) unknown.push(c);
}

console.log(`Banco: ${DB_PATH}`);
console.log(`Cartas: ${cards.length} | valem no All Blue: ${legal}`);
console.log(Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(' | '));
if (unknown.length) {
  console.log(`\nSem raridade conhecida (fora do All Blue até corrigir): ${unknown.length}`);
  for (const c of unknown) console.log(`  ${c.id.padEnd(10)} ${String(c.rarity ?? '-').padEnd(8)} ${c.spoiler ? 'spoiler ' : ''}${c.name}`);
  process.exitCode = 1;
} else {
  console.log('\nToda carta tem raridade conhecida.');
}
