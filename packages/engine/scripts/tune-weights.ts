// Otimiza os pesos da avaliação do bot em auto-jogo (SPSA): a cada rodada, perturba todos os pesos ao
// mesmo tempo (±C em escala log), põe θ+ e θ− para jogar entre si (`duel.ts`, em paralelo) e move os
// pesos na direção de quem venceu mais. Parte de BOT_WEIGHTS; o estado fica em <saída>.state, então
// rodar de novo com a mesma saída continua de onde parou.
//
//   npx tsx scripts/tune-weights.ts <saída.jsonl> [rodadas=150] [partidas por rodada=96] [nível=normal]
//   ex.: npm run tune-weights -w @gumgum/engine -- tune.jsonl 150 96 normal
//
// O nível `normal` (busca de uma jogada) é ~20x mais rápido que o `hard` e usa a mesma avaliação;
// confira o resultado no `hard` com `duel.ts` antes de trocar os pesos padrão.

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BOT_WEIGHTS, type BotWeights } from '../src';

const run = promisify(execFile);
const [out, roundsArg = '150', gamesArg = '96', level = 'normal'] = process.argv.slice(2);
if (!out) throw new Error('uso: tune-weights.ts <saída.jsonl> [rodadas] [partidas] [nível]');
const ROUNDS = Number(roundsArg);
const WORKERS = Math.max(1, availableParallelism());
const GAMES = Math.ceil(Number(gamesArg) / (2 * WORKERS)) * 2 * WORKERS;
const C = 0.2;
const A = 0.12;

/** Pesos ajustados: os degraus de Vida (perder a k-ésima carta) e os termos escalares. */
const SCALARS = [
  'handCard', 'handCardOpp', 'handCardBase', 'handCounter', 'handCounterEvent',
  'charCost', 'charBase', 'charPower', 'blocker', 'rush', 'stage', 'exposed', 'don',
  'threat', 'threatHit', 'lethal', 'counterCard', 'counterBig', 'counterWill', 'counterStack', 'winCap', 'lethalPlan',
] as const satisfies readonly (keyof BotWeights)[];

type Theta = Record<string, number>;

function initial(w: BotWeights): Theta {
  const t: Theta = {};
  for (const k of SCALARS) t[k] = Math.log(w[k]);
  for (let i = 1; i <= 5; i++) {
    t[`life${i}`] = Math.log(w.life[i] - w.life[i - 1]);
    t[`lifeOpp${i}`] = Math.log(w.lifeOpp[i] - w.lifeOpp[i - 1]);
  }
  return t;
}

function weights(t: Theta): Partial<BotWeights> {
  const w: Partial<BotWeights> = {};
  for (const k of SCALARS) w[k] = Number(Math.exp(t[k]).toPrecision(4));
  const table = (prefix: string) => {
    const out = [0];
    for (let i = 1; i <= 5; i++) out.push(Math.round(out[i - 1] + Math.exp(t[`${prefix}${i}`])));
    return out;
  };
  w.life = table('life');
  w.lifeOpp = table('lifeOpp');
  w.lifeExtra = Math.round(Math.exp(t.life5));
  w.lifeOppExtra = Math.round(Math.exp(t.lifeOpp5));
  return w;
}

async function duel(seed: number, games: number, a: Partial<BotWeights>, b: Partial<BotWeights>): Promise<[number, number]> {
  const { stdout } = await run('npx', ['tsx', join(import.meta.dirname, 'duel.ts'), String(seed), String(games), level, JSON.stringify(a), JSON.stringify(b)], {
    cwd: join(import.meta.dirname, '..'),
    maxBuffer: 1 << 20,
  });
  const [x, y] = stdout.trim().split(/\s+/).slice(-2).map(Number);
  return [x, y];
}

const stateFile = `${out}.state`;
let theta = initial(BOT_WEIGHTS);
let start = 0;
if (existsSync(stateFile)) ({ theta, round: start } = JSON.parse(readFileSync(stateFile, 'utf8')));

for (let round = start; round < ROUNDS; round++) {
  const delta: Theta = Object.fromEntries(Object.keys(theta).map((k) => [k, Math.random() < 0.5 ? -1 : 1]));
  const plus = weights(Object.fromEntries(Object.entries(theta).map(([k, v]) => [k, v + C * delta[k]])));
  const minus = weights(Object.fromEntries(Object.entries(theta).map(([k, v]) => [k, v - C * delta[k]])));
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: WORKERS }, () => duel(Math.floor(Math.random() * 2 ** 31), GAMES / WORKERS, plus, minus)),
  );
  const a = results.reduce((n, r) => n + r[0], 0);
  const b = results.reduce((n, r) => n + r[1], 0);
  const y = (a - b) / Math.max(1, a + b);
  const step = A / (1 + round / 50) ** 0.602;
  for (const k of Object.keys(theta)) theta[k] += ((step * y) / (2 * C)) * delta[k];
  writeFileSync(stateFile, JSON.stringify({ theta, round: round + 1 }));
  appendFileSync(out, `${JSON.stringify({ round, plus: a, minus: b, secs: Math.round((Date.now() - t0) / 1000), weights: weights(theta) })}\n`);
  process.stdout.write(`\rrodada ${round + 1}/${ROUNDS}: θ+ ${a} x ${b} θ−   `);
}
console.log(`\n${JSON.stringify(weights(theta))}`);
