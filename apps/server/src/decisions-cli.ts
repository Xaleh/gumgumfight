// Extrai as decisões dos jogadores humanos dos replays gravados e compara com o bot (docs/bot-tempo.md, seção 11).
//
//   npm run decisions -w @gumgum/server -- [opções]
//
//   --queue <casual|ranked|tournament>   só esta fila
//   --since <ISO>                        só partidas a partir desta data
//   --top <N>                            só os N perfis de maior recompensa na ranqueada
//   --tournament-top <N>                 só quem ficou entre os N primeiros de algum torneio encerrado
//   --player <id>[,<id>…]                só estes perfis (players.id)
//   --tournament <id|latest>             só os jogos deste torneio (latest: o último encerrado), com a colocação de cada um
//   --split <N>                          com --tournament: repete o resumo só para os N primeiros e só para o resto
//   --limit <N>                          no máximo N partidas (padrão 200, as mais recentes)
//   --bot <hard|normal|none>             nível do bot comparado em cada decisão (padrão hard; none = só extrai)
//   --budget <ms>                        teto de tempo por decisão do bot (padrão 250)
//   --out <arquivo.jsonl>                grava um registro por decisão e, em <arquivo>-turnos.jsonl, um por turno (sem ele, só o resumo)
//
//   DB_PATH=/caminho/gumgum.db npm run decisions -w @gumgum/server -- --tournament-top 4 --out top.jsonl
//
// Só lê o banco. Pode rodar na cópia do backup (o banco é um arquivo).

import { appendFileSync, writeFileSync } from 'node:fs';
import type { BotLevel } from '@gumgum/engine';
import { extractMatch, formatSummary, selectMatches, summarize, topRankedPlayers, topTournamentPlayers, tournamentInfo, type DecisionRecord, type TurnRecord } from './decisions/extract';
import { openDb } from './db';
import { DB_PATH, fromUserCwd } from './paths';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name: string, fallback: number) => {
  const v = opt(name);
  return v === undefined ? fallback : Number(v);
};

const db = openDb();
const players = new Set<string>();
const top = opt('top');
if (top) for (const p of topRankedPlayers(db, Number(top))) players.add(p);
const ttop = opt('tournament-top');
if (ttop) for (const p of topTournamentPlayers(db, Number(ttop))) players.add(p);
const list = opt('player');
if (list) for (const p of list.split(',')) players.add(p.trim());
if ((top || ttop || list) && !players.size) {
  console.log('Nenhum perfil corresponde aos filtros.');
  process.exit(0);
}

const botArg = opt('bot') ?? 'hard';
const bot = botArg === 'none' ? undefined : (botArg as BotLevel);
const budgetMs = num('budget', 250);
const out = opt('out') ? fromUserCwd(opt('out')!) : null;
/** Os turnos inteiros vão num arquivo ao lado (`<saída>-turnos.jsonl`). */
const outTurns = out ? out.replace(/\.jsonl$/, '') + '-turnos.jsonl' : null;
if (out) writeFileSync(out, '');
if (outTurns) writeFileSync(outTurns, '');

const tArg = opt('tournament');
const tournament = tArg ? tournamentInfo(db, tArg) : null;
if (tArg && !tournament) {
  console.log(`Torneio não encontrado: ${tArg}`);
  process.exit(1);
}
if (tournament) console.log(`Torneio: ${tournament.name} (${tournament.id}) | ${tournament.players} inscritos | encerrado em ${tournament.finishedAt ?? 'andamento'}`);

const ids = selectMatches(db, {
  queue: opt('queue'),
  since: opt('since'),
  tournament: tournament?.id,
  players: players.size ? [...players] : undefined,
  limit: num('limit', 200),
});
console.log(`Banco: ${DB_PATH} | ${ids.length} partidas${players.size ? ` de ${players.size} perfis` : ''}${bot ? ` | bot ${bot} (${budgetMs} ms por decisão)` : ''}`);

const all: DecisionRecord[] = [];
const allTurns: TurnRecord[] = [];
let failed = 0;
const t0 = Date.now();
ids.forEach((id, i) => {
  const r = extractMatch(db, id, { bot, budgetMs, placements: tournament?.placements });
  if (r.error) {
    failed++;
    if (process.env.VERBOSE) console.error(`partida ${id}: ${r.error}`);
  }
  all.push(...r.records);
  allTurns.push(...r.turns);
  if (out && r.records.length) appendFileSync(out, r.records.map((rec) => JSON.stringify(rec)).join('\n') + '\n');
  if (outTurns && r.turns.length) appendFileSync(outTurns, r.turns.map((rec) => JSON.stringify(rec)).join('\n') + '\n');
  process.stdout.write(`\rpartida ${i + 1}/${ids.length} | decisões ${all.length} | ${((Date.now() - t0) / 1000).toFixed(0)} s   `);
});
console.log('\n');
console.log(formatSummary(summarize(all, ids.length, failed, allTurns)));
const split = opt('split');
if (tournament && split) {
  const n = Number(split);
  const top = (p: number | undefined) => p !== undefined && p <= n;
  const turnPlace = (t: TurnRecord) => all.find((d) => d.match === t.match && d.seat === t.seat)?.placement;
  console.log(`\n================ Só os ${n} primeiros do torneio ================\n`);
  console.log(formatSummary(summarize(all.filter((d) => top(d.placement)), ids.length, failed, allTurns.filter((t) => top(turnPlace(t))))));
  console.log(`\n================ Do ${n + 1}º lugar para baixo ================\n`);
  console.log(formatSummary(summarize(all.filter((d) => !top(d.placement)), ids.length, failed, allTurns.filter((t) => !top(turnPlace(t))))));
}
if (out) console.log(`\nRegistros em ${out} e turnos em ${outTurns}`);
