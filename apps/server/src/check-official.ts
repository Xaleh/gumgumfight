// Confere nomes e tipos das cartas da optcgapi com a lista oficial da Bandai.
//
//   npm run cards:check-official -w @gumgum/server
//
// Mostra as cartas em que a API (como a importação a mapeia, já com as correções de
// packages/engine/src/source-fixes.ts) ainda difere da lista oficial, e imprime as entradas
// prontas para colar em SOURCE_FIXES. Também avisa das correções que a API já não precisa.
// Rodar a cada coleção nova (docs/rules/manutencao.md).

import { applySourceFixes, SOURCE_FIXES } from '@gumgum/engine';
import { fetchJson, knownTypes } from './card-import';
import { diffWithOfficial, mergeOfficial, OFFICIAL_CARDLIST, officialSeries, parseOfficialCardList, type OfficialCard } from './official-cards';
import { allEndpoints, DEFAULT_API_BASE, mapApiResponse, rowsOf, typeVocabulary } from './optcgapi';

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'gumgumfight-importer' } });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  return res.text();
}

async function main() {
  const base = (process.env.CARD_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const index = await text(OFFICIAL_CARDLIST);
  const pages: Array<Map<string, OfficialCard>> = [];
  for (const series of officialSeries(index)) pages.push(parseOfficialCardList(await text(`${OFFICIAL_CARDLIST}?series=${series}`)));
  const official = mergeOfficial(pages);
  const rows = (await Promise.all(allEndpoints(base).map(fetchJson))).flatMap(rowsOf);
  const { cards } = mapApiResponse(rows, typeVocabulary(rows, knownTypes()));
  console.log(`Lista oficial: ${official.size} cartas | API: ${cards.length} cartas`);

  const raw = diffWithOfficial(cards, official);
  const remaining = diffWithOfficial(cards.map(applySourceFixes), official);
  const stale = Object.keys(SOURCE_FIXES).filter((id) => official.has(id) && !raw.some((d) => d.id === id));
  console.log(`Diferenças da API: ${raw.length} | depois das correções de source-fixes.ts: ${remaining.length}`);
  if (stale.length) console.log(`Correções que a API já não precisa (pode apagar): ${stale.join(' ')}`);
  if (!remaining.length) return;
  console.log('\nEntradas para SOURCE_FIXES (conferir antes de colar):');
  for (const d of remaining) {
    const fix = { ...(d.name ? { name: d.name.official } : {}), ...(d.types ? { types: d.types.official } : {}) };
    const was = [d.name ? `nome "${d.name.api}"` : '', d.types ? `tipos ${JSON.stringify(d.types.api)}` : ''].filter(Boolean).join(', ');
    console.log(`  '${d.id}': ${JSON.stringify(fix)}, // API: ${was}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
