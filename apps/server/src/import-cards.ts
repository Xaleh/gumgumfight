// Importa cartas da optcgapi.com para o banco local.
//
//   npm run cards:import                     # ST-01 e ST-02 (decks de teste)
//   npm run cards:import -- ST-01 OP-01      # coleções específicas
//   npm run cards:import -- --all            # todas as coleções e starter decks
//   npm run cards:import -- --file resp.json # importa de um arquivo salvo (sem rede)
//   npm run cards:import -- --dry-run ST-01  # só mostra o resultado, não grava
//   npm run cards:import -- --spoilers       # baixa os spoilers e troca os que já saíram na API pelos oficiais
//
// Variável opcional: CARD_API_BASE (padrão https://optcgapi.com/api).

import { readFileSync } from 'node:fs';
import { automationStatus, type CardData, translateCardPt } from '@gumgum/engine';
import { fetchJson, knownTypes } from './card-import';
import { openDb, upsertCards } from './db';
import { allEndpoints, DEFAULT_API_BASE, mapApiResponse, rowsOf, setEndpoint, typeVocabulary } from './optcgapi';
import { join } from 'node:path';
import { DATA_DIR, fromUserCwd } from './paths';
import { refreshSpoilerFeeds, syncSpoilers } from './spoiler-sync';

async function main() {
  const args = process.argv.slice(2);
  const base = (process.env.CARD_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const dryRun = args.includes('--dry-run');
  if (args.includes('--spoilers')) {
    const db = openDb();
    const feed = await refreshSpoilerFeeds(db, join(DATA_DIR, 'spoilers'));
    for (const s of feed.sets) console.log(`Spoilers ${s.set}: ${s.written} cartas baixadas, ${s.removed} removidas`);
    for (const e of feed.errors) console.error(`Erro ao baixar spoilers: ${e}`);
    const r = await syncSpoilers(db, { base });
    if (!r.pending.length) return console.log('Nenhuma carta de spoiler pendente.');
    console.log(`Coleções com spoilers: ${r.pending.join(', ')}`);
    console.log(`Cartas gravadas da API: ${r.imported} | spoilers que viraram oficiais: ${r.official.length}`);
    if (r.official.length) console.log(r.official.join(' '));
    for (const e of r.errors) console.error(`Erro: ${e}`);
    return;
  }
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
  // Baixa tudo antes de mapear: o vocabulário de tipos vem dos textos de todas as fontes.
  const bodies: Array<{ label: string; body: unknown }> = [];
  for (const src of sources) bodies.push({ label: src.label, body: await src.load() });
  const vocab = typeVocabulary(
    bodies.flatMap((b) => rowsOf(b.body)),
    knownTypes(),
  );

  for (const { label, body } of bodies) console.log(`${label}: ${rowsOf(body).length} entradas`);
  // Todas as linhas juntas: a mesma carta aparece em várias fontes (coleção e starter deck
  // que a reimprime) e a versão certa é escolhida vendo todas (mergeRows).
  const mapped = mapApiResponse(
    bodies.flatMap((b) => rowsOf(b.body)),
    vocab,
  );
  for (const c of mapped.cards) {
    cards.set(c.id, c);
    raw.set(c.id, mapped.raw.get(c.id));
  }
  if (mapped.ignored) console.log(`${mapped.ignored} entradas ignoradas (sem id, DON!! ou tipo desconhecido)`);

  const list = [...cards.values()];
  const count = (st: string) => list.filter((c) => automationStatus(c) === st).length;
  const scripted = count('scripted') + count('auto');
  const partialPt = list.filter((c) => !translateCardPt(c).complete);
  console.log(`\nTotal: ${list.length} cartas únicas`);
  console.log(
    `Com efeito automatizado: ${scripted} | parcial: ${count('partial')} | manual: ${count('manual')} | tradução automática parcial: ${partialPt.length}`,
  );

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
