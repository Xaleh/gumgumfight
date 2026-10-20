// Importa as cartas lançadas para o banco local, pela cadeia de fontes de CARD_SOURCES
// (padrão: só a optcgapi.com; veja card-sources/).
//
//   npm run cards:import                     # ST-01 e ST-02 (decks de teste)
//   npm run cards:import -- ST-01 OP-01 P    # coleções específicas (P = promocionais)
//   npm run cards:import -- --all            # todas as coleções, starter decks e promocionais
//   npm run cards:import -- --file resp.json # importa de uma resposta da optcgapi salva (sem rede, só a optcgapi)
//   npm run cards:import -- --dry-run ST-01  # só mostra o resultado, não grava
//   npm run cards:import -- --spoilers       # baixa os spoilers e troca os que já saíram na API pelos oficiais
//   npm run cards:import -- --images         # só copia para a CDN própria as imagens que ainda estão fora
//
// Com a CDN própria configurada (CARD_CDN_URL + R2_*, veja card-cdn/), toda importação termina
// copiando as imagens novas para ela.
// Variáveis opcionais: CARD_API_BASE (padrão https://optcgapi.com/api), CARD_SOURCES e SPOILER_SOURCES
// (ordem de prioridade das fontes, ex.: CARD_SOURCES=cardkaizoku,optcgapi).

import { automationStatus, translateCardPt } from '@gumgum/engine';
import { join } from 'node:path';
import { cdnFromEnv, syncCardCdn } from './card-cdn';
import { fetchJson } from './card-import';
import { buildChain, chainNames, formatReport, type Layer, resolveChain, saveDiffReport, writeOfficial } from './card-sources';
import { hasOfficialCards, openDb, recordCardGaps } from './db';
import { DEFAULT_API_BASE } from './optcgapi';
import { DATA_DIR, fromUserCwd } from './paths';
import { spoilerRound } from './spoiler-sync';

async function main() {
  const args = process.argv.slice(2);
  const base = (process.env.CARD_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const dryRun = args.includes('--dry-run');
  const cdn = cdnFromEnv();
  const log = (msg: string) => console.log(msg);
  if (args.includes('--images')) {
    if (!cdn) throw new Error('CDN própria não configurada (CARD_CDN_URL, R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    const r = await syncCardCdn(openDb(), cdn, { log });
    for (const f of r.failed) console.error(`Falhou: ${f.url} (${f.error})`);
    if (!r.uploaded && !r.failed.length) console.log(`CDN das imagens: nada novo (${r.cards} cartas na CDN).`);
    return;
  }
  if (args.includes('--spoilers')) {
    const db = openDb();
    const r = await spoilerRound(db, { base, dir: join(DATA_DIR, 'spoilers'), log, cdn });
    for (const s of r.feed.sets) console.log(`Spoilers ${s.set}: ${s.written} cartas baixadas, ${s.removed} removidas`);
    for (const e of r.feed.errors) console.error(`Erro ao baixar spoilers: ${e}`);
    if (!r.sync.pending.length) return console.log('Nenhuma carta de spoiler pendente.');
    console.log(`Coleções com spoilers: ${r.sync.pending.join(', ')}`);
    console.log(`Cartas gravadas da API: ${r.sync.imported} | spoilers que viraram oficiais: ${r.sync.official.length}`);
    if (r.sync.official.length) console.log(r.sync.official.join(' '));
    for (const e of r.sync.errors) console.error(`Erro: ${e}`);
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

  // Resposta salva em arquivo: só a optcgapi, sem rede.
  const { names, warnings } = files.length ? { names: ['optcgapi'], warnings: [] } : chainNames('official');
  for (const w of warnings) console.warn(`Aviso: ${w}`);
  const chain = buildChain(names, { base, fetchJson, files, onBody: (label, n) => console.log(`${label}: ${n} entradas`) });
  console.log(`Fontes (em ordem de prioridade): ${chain.map((s) => s.id).join(' > ')}`);

  const layers: Layer[] = [];
  for (const source of chain) {
    try {
      const got = await source.fetch({ sets: all || files.length ? undefined : sets });
      layers.push({ source, ...got });
      console.log(`${source.id}: ${got.cards.length} cartas`);
      const ignored = (got as { ignored?: number }).ignored;
      if (ignored) console.log(`  ${ignored} entradas ignoradas (sem id, DON!!, tipo desconhecido ou reimpressão promocional de carta de coleção)`);
    } catch (err) {
      console.error(`${source.id}: falhou (${err instanceof Error ? err.message : err}); seguindo com as outras fontes.`);
    }
  }
  if (!layers.length) throw new Error('nenhuma fonte respondeu');

  // Coleções que o banco já tem como oficiais também aceitam cartas de fontes que misturam spoilers.
  const db = dryRun ? null : openDb();
  const { cards: resolved, report } = resolveChain(layers, { kind: 'official', officialSet: db ? (set) => hasOfficialCards(db, set) : undefined });
  const list = resolved.map((r) => r.card);
  const count = (st: string) => list.filter((c) => automationStatus(c) === st).length;
  const scripted = count('scripted') + count('auto');
  const partialPt = list.filter((c) => !translateCardPt(c).complete);
  console.log(`\nTotal: ${list.length} cartas únicas`);
  console.log(
    `Com efeito automatizado: ${scripted} | parcial: ${count('partial')} | manual: ${count('manual')} | tradução automática parcial: ${partialPt.length}`,
  );
  if (layers.length > 1) {
    console.log('\nCartas por fonte vencedora:');
    for (const line of formatReport(report)) console.log(`  ${line}`);
    const saved = saveDiffReport(dryRun ? 'official:dry-run' : 'official', chain, report);
    if (saved) console.log(`Relatório completo (divergências por carta): ${saved}`);
  }

  if (!db) {
    for (const c of list.slice(0, 5)) console.log(JSON.stringify(c, null, 2));
    console.log('\n--dry-run: nada foi gravado.');
    return;
  }
  console.log(`Gravadas ${writeOfficial(db, resolved)} cartas no banco.`);
  const gaps = recordCardGaps(db);
  if (gaps.added) console.log(`Cobertura: ${gaps.added} carta(s) nova(s) com efeito parcial ou manual (⚙); ver a tela "Cobertura das cartas" (Dev).`);
  if (cdn) await syncCardCdn(db, cdn, { log });
}

main().catch((err) => {
  console.error(`\nFalha na importação: ${err instanceof Error ? err.message : err}`);
  console.error('Se a URL mudou, ajuste CARD_API_BASE ou baixe a resposta no navegador e use --file.');
  process.exit(1);
});
