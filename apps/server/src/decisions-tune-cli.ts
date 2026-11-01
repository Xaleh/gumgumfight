// Ajusta os pesos de defesa do bot para concordar com as decisões de jogadores humanos (docs/bot-tempo.md, seção 11).
//
//   npm run decisions:tune -w @gumgum/server -- [opções]
//
//   --tournament <id|latest>   posições dos jogos deste torneio (latest: o último encerrado)
//   --placement <N>            com --tournament: só de quem ficou entre os N primeiros
//   --tournament-top <N>       posições de quem ficou entre os N primeiros de algum torneio encerrado (todas as partidas deles)
//   --top <N>                  posições dos N perfis de maior recompensa na ranqueada
//   --queue, --since, --limit  como em `npm run decisions` (padrão: 300 partidas)
//   --kinds counter,block      tipos de decisão imitados (padrão: counter,block)
//   --max <N>                  teto de posições guardadas (padrão 1500; cada uma ocupa ~100 KB)
//   --rounds <N>               rodadas do SPSA (padrão 80)
//   --batch <N>                posições por rodada (padrão 200)
//   --level <hard|normal>      nível do bot (padrão hard)
//   --with-hand                também ajusta `handCard` (o valor da carta que sai da Vida para a mão)
//   --leader <número>          só posições de jogadores com este Líder (ex.: OP17-039)
//   --profile <deck>           Bot do Time: parte dos pesos do perfil de data/decks/meta/<deck>.profile.json e ajusta
//                              também os `weights` dele (use com --leader do mesmo deck)
//
// Saída: a concordância antes e depois (numa parte das posições que o ajuste não viu), a defesa do Líder por
// Vida (humano, bot atual, bot ajustado) e o json dos pesos, para conferir com `duel.ts` e `vs-human.ts`.
// Só lê o banco, mas usa CPU por minutos: rode numa cópia do banco ou fora do horário de pico.

import { BOT_WEIGHTS, type BotLevel, profileWeights } from '@gumgum/engine';
import { MetaProfiles } from './team/profiles';
import { openDb } from './db';
import { selectMatches, topRankedPlayers, topTournamentPlayers, tournamentInfo, type DecisionKind } from './decisions/extract';
import { agreement, collectSamples, defenseByLife, initialTheta, partialWeights, spsa, weightsOf } from './decisions/tune';
import { DB_PATH } from './paths';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name: string, fallback: number) => (opt(name) === undefined ? fallback : Number(opt(name)));

const db = openDb();
const tArg = opt('tournament');
const tournament = tArg ? tournamentInfo(db, tArg) : null;
if (tArg && !tournament) {
  console.log(`Torneio não encontrado: ${tArg}`);
  process.exit(1);
}
const players = new Set<string>();
if (opt('top')) for (const p of topRankedPlayers(db, Number(opt('top')))) players.add(p);
if (opt('tournament-top')) for (const p of topTournamentPlayers(db, Number(opt('tournament-top')))) players.add(p);
if ((opt('top') || opt('tournament-top')) && !players.size) {
  console.log('Nenhum perfil corresponde aos filtros.');
  process.exit(0);
}

const level = (opt('level') ?? 'hard') as BotLevel;
const withHand = args.includes('--with-hand');
// Bot do Time: ajusta também os `weights` do perfil de um deck do meta, partindo dos pesos do perfil (arquétipo e
// ajustes do guia). As posições devem ser de jogos com esse Líder (`--leader`), senão o ajuste não diz nada sobre o deck.
const profileId = opt('profile');
const profile = profileId ? new MetaProfiles().profile(profileId) : null;
if (profileId && !profile) {
  console.error(`Perfil ${profileId} não encontrado (ou inválido) em data/decks/meta.`);
  process.exit(1);
}
const baseWeights = profile ? profileWeights(profile, null) : BOT_WEIGHTS;
const extraKeys = profile ? Object.keys(profile.weights ?? {}) : [];
const kinds = (opt('kinds') ?? 'counter,block').split(',') as DecisionKind[];
const ids = selectMatches(db, {
  queue: opt('queue'),
  since: opt('since'),
  leader: opt('leader'),
  tournament: tournament?.id,
  players: players.size ? [...players] : undefined,
  limit: num('limit', 300),
});
console.log(`Banco: ${DB_PATH} | ${ids.length} partidas${tournament ? ` do torneio ${tournament.name}` : ''}${players.size ? ` de ${players.size} perfis` : ''}`);

const t0 = Date.now();
const placement = opt('placement');
const { samples, failed } = collectSamples(db, ids, {
  kinds,
  max: num('max', 1500),
  placements: tournament?.placements,
  maxPlacement: placement ? Number(placement) : undefined,
});
console.log(`Posições: ${samples.length} (${kinds.join(', ')}) | ${failed} partidas não refizeram | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (samples.length < 50) {
  console.log('Poucas posições para ajustar (mínimo 50). Amplie os filtros.');
  process.exit(0);
}

// Um quinto das posições fica de fora do ajuste, para medir a concordância sem viés.
const shuffled = [...samples].sort(() => Math.random() - 0.5);
const holdout = shuffled.slice(0, Math.floor(shuffled.length / 5));
const train = shuffled.slice(holdout.length);

const before = agreement(holdout, baseWeights, level);
console.log(`Concordância com as pessoas antes (${holdout.length} posições fora do ajuste): ${(100 * before).toFixed(1)}%`);
const theta = spsa(train, initialTheta(baseWeights, withHand, extraKeys), {
  rounds: num('rounds', 80),
  batch: num('batch', 200),
  level,
  onRound: (round, plus, minus) => process.stdout.write(`\rrodada ${round + 1}: θ+ ${(100 * plus).toFixed(1)}% x ${(100 * minus).toFixed(1)}% θ−   `),
});
const tuned = weightsOf(theta, baseWeights);
const after = agreement(holdout, tuned, level);
console.log(`\nConcordância depois: ${(100 * after).toFixed(1)}% (antes ${(100 * before).toFixed(1)}%) | ${((Date.now() - t0) / 60000).toFixed(1)} min`);

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const now = defenseByLife(holdout, baseWeights, level);
const next = defenseByLife(holdout, tuned, level);
console.log('\nDefesa do Líder por Vida (posições fora do ajuste): humano / bot atual / bot ajustado');
for (const k of Object.keys(now).sort()) console.log(`  ${k.padEnd(14)} ${String(now[k].n).padStart(5)}   ${pct(now[k].human, now[k].n)} / ${pct(now[k].bot, now[k].n)} / ${pct(next[k].bot, next[k].n)}`);

console.log(profile ? `\nPesos ajustados (json parcial para duel.ts e vs-human.ts; os de \`weights\` do perfil ${profile.id} entram no .profile.json):` : '\nPesos ajustados (json parcial para duel.ts e vs-human.ts):');
console.log(JSON.stringify(partialWeights(tuned, withHand, extraKeys)));
console.log(`Atuais: ${JSON.stringify(partialWeights(baseWeights, withHand, extraKeys))}`);
