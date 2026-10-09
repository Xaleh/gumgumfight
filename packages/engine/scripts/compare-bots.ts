// Confronta dois níveis do bot: taxa de vitória (trocando o assento a cada partida) e tempo por decisão.
// Os dois decidem pela visão (`viewFor`), como no servidor.
//
//   npm run compare-bots -w @gumgum/engine -- [partidas=100] [nívelA=hard] [nívelB=easy] [deckA=st01-luffy] [deckB=st02-kid]
//   ex.: npm run compare-bots -w @gumgum/engine -- 200 hard easy st03-crocodile st04-kaido

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  actingPlayer,
  actionFromView,
  applyAction,
  type BotLevel,
  type CardData,
  chooseBotAction,
  createGame,
  type DeckList,
  type GameState,
  identityAliases,
  type PlayerId,
  resetPlanner,
  viewFor,
} from '../src';

const DATA = join(import.meta.dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = readdirSync(join(DATA, 'cards'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => load(`cards/${f}`).cards as CardData[]);

const [gamesArg, levelA = 'hard', levelB = 'easy', deckA = 'st01-luffy', deckB = 'st02-kid'] = process.argv.slice(2);
const games = Number(gamesArg ?? 100);
const levels = [levelA, levelB] as [BotLevel, BotLevel];
const decks: [DeckList, DeckList] = [load(`decks/${deckA}.json`), load(`decks/${deckB}.json`)];

const wins = { A: 0, B: 0, draws: 0 };
const timesA: number[] = [];
const timesB: number[] = [];
let turns = 0;
let actions = 0;
const t0 = Date.now();

for (let g = 0; g < games; g++) {
  // A joga ora com o deck 1, ora com o deck 2; quem começa alterna também.
  const seatA = (g % 2) as PlayerId;
  const levelOf = (p: PlayerId): BotLevel => (p === seatA ? levels[0] : levels[1]);
  let s: GameState = createGame({
    seed: g + 1,
    firstPlayer: ((g >> 1) % 2) as PlayerId,
    cards,
    players: [
      { name: `${decks[0].name}`, deck: decks[0], isBot: true },
      { name: `${decks[1].name}`, deck: decks[1], isBot: true },
    ],
  });
  const aliases = identityAliases(s);
  resetPlanner();
  for (let i = 0; i < 4000 && s.phase !== 'gameover'; i++) {
    const p = actingPlayer(s)!;
    const t = performance.now();
    const view = viewFor(s, p, aliases);
    const action = actionFromView(s, aliases, chooseBotAction(view, p, levelOf(p)));
    if (typeof action === 'string') throw new Error(action);
    (p === seatA ? timesA : timesB).push(performance.now() - t);
    s = applyAction(s, action);
    actions++;
  }
  if (s.phase !== 'gameover') throw new Error(`partida ${g + 1} não terminou`);
  if (s.winner === null) wins.draws++;
  else if (s.winner === seatA) wins.A++;
  else wins.B++;
  turns += s.turn;
  process.stdout.write(`\rpartida ${g + 1}/${games}: A ${wins.A} x ${wins.B} B${wins.draws ? ` (${wins.draws} empates)` : ''}   `);
}

const pct = (arr: number[], q: number) => {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
const stats = (arr: number[]) => `média ${(arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)).toFixed(1)} ms | p50 ${pct(arr, 0.5).toFixed(1)} ms | p95 ${pct(arr, 0.95).toFixed(1)} ms | máx ${Math.max(0, ...arr).toFixed(0)} ms`;

console.log(`\n${games} partidas em ${((Date.now() - t0) / 1000).toFixed(1)} s | ${actions} ações | média de ${(turns / games).toFixed(1)} turnos`);
console.log(`A (${levels[0]}): ${wins.A} vitórias (${((100 * wins.A) / games).toFixed(0)}%) | ${stats(timesA)}`);
console.log(`B (${levels[1]}): ${wins.B} vitórias (${((100 * wins.B) / games).toFixed(0)}%) | ${stats(timesB)}`);
