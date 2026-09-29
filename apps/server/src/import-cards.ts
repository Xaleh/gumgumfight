// Importa cartas da optcgapi.com para o banco local.
//
//   npm run cards:import                     # ST-01 e ST-02 (decks de teste)
//   npm run cards:import -- ST-01 OP-01      # coleções específicas
//   npm run cards:import -- --all            # todas as coleções e starter decks
//   npm run cards:import -- --file resp.json # importa de um arquivo salvo (sem rede)
//   npm run cards:import -- --dry-run ST-01  # só mostra o resultado, não grava
//
// Variável opcional: CARD_API_BASE (padrão https://optcgapi.com/api).

import { readFileSync } from 'node:fs';
import { type CardData, hasScript, translateToPt } from '@gumgum/engine';
import { openDb, upsertCards } from './db';
import { allEndpoints, DEFAULT_API_BASE, mapApiResponse, setEndpoint } from './optcgapi';
import { fromUserCwd } from './paths';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'gumgumfight-importer' } });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const base = (process.env.CARD_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const dryRun = args.includes('--dry-run');
  const files: string[] = [];
  const sets: string[] = [];
  let all = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file') files.push(fromUserCwd(args[++i]));
    else if (a === '--all') all = true;
    else if (!a.startsWith('--')) sets.push(a);
  }
  if (!files.length && !all && !sets.length) sets.push('ST-01', 'ST-02');

  const sources: Array<{ label: string; load: () => Promise<unknown> }> = [
    ...files.map((f) => ({ label: f, load: async () => JSON.parse(readFileSync(f, 'utf8')) as unknown })),
    ...(all ? allEndpoints(base) : sets.map((s) => setEndpoint(base, s))).map((url) => ({
      label: url,
      load: () => fetchJson(url),
    })),
  ];

  const cards = new Map<string, CardData>();
  const raw = new Map<string, unknown>();
  for (const src of sources) {
    const r = mapApiResponse(await src.load());
    console.log(`${src.label}: ${r.cards.length} cartas${r.ignored ? ` (${r.ignored} entradas ignoradas)` : ''}`);
    for (const c of r.cards) {
      cards.set(c.id, c);
      raw.set(c.id, r.raw.get(c.id));
    }
  }

  const list = [...cards.values()];
  const scripted = list.filter((c) => hasScript(c.id)).length;
  const partialPt = list.filter((c) => !translateToPt(c.text).complete || (c.trigger && !translateToPt(c.trigger).complete));
  console.log(`\nTotal: ${list.length} cartas únicas`);
  console.log(`Com efeito automatizado: ${scripted} | tradução automática parcial: ${partialPt.length}`);

  if (dryRun) {
    for (const c of list.slice(0, 5)) console.log(JSON.stringify(c, null, 2));
    console.log('\n--dry-run: nada foi gravado.');
    return;
  }
  const db = openDb();
  const r = upsertCards(db, list, { provisional: false, source: `api:${files.length ? 'arquivo' : new URL(base).host}`, raw });
  console.log(`Gravadas ${r.written} cartas no banco.`);
}

main().catch((err) => {
  console.error(`\nFalha na importação: ${err instanceof Error ? err.message : err}`);
  console.error('Se a URL mudou, ajuste CARD_API_BASE ou baixe a resposta no navegador e use --file.');
  process.exit(1);
});
