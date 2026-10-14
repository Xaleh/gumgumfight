// Duelo entre dois conjuntos de pesos do bot, no mesmo nível: cada sorteio (decks e semente) é jogado
// duas vezes, com os assentos trocados. Usado pelo `tune-weights.ts`; serve também para comparar pesos.
//
//   npx tsx scripts/duel.ts <semente> <partidas> <nível> '<pesos A (json parcial)>' '<pesos B>'
//   saída: "<vitórias de A> <vitórias de B>"

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  actingPlayer,
  actionFromView,
  applyAction,
  BOT_WEIGHTS,
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
const DECKS = readdirSync(join(DATA, 'decks')).filter((f) => f.endsWith('.json'));

const [seedArg, gamesArg, level, wa, wb] = process.argv.slice(2);
const weights = [{ ...BOT_WEIGHTS, ...JSON.parse(wa ?? '{}') }, { ...BOT_WEIGHTS, ...JSON.parse(wb ?? '{}') }];
let rng = Number(seedArg) >>> 0;
const rand = () => {
  rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
  return rng / 2 ** 32;
};

const wins = [0, 0];
for (let g = 0; g < Number(gamesArg); g += 2) {
  const deck = (): DeckList => load(`decks/${DECKS[Math.floor(rand() * DECKS.length)]}`);
  const decks = [deck(), deck()] as const;
  const seed = Math.floor(rand() * 1e9);
  for (const seatA of [0, 1] as PlayerId[]) {
    let s: GameState = createGame({
      seed,
      firstPlayer: 0,
      cards,
      players: [
        { name: 'P0', deck: decks[0], isBot: true },
        { name: 'P1', deck: decks[1], isBot: true },
      ],
    });
    const aliases = identityAliases(s);
    resetPlanner();
    try {
      for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
        const p = actingPlayer(s)!;
        // Sem teto de tempo: o resultado não depende da carga da máquina.
        const over = { weights: weights[p === seatA ? 0 : 1], timeBudgetMs: 1e9 };
        const action = actionFromView(s, aliases, chooseBotAction(viewFor(s, p, aliases), p, level as BotLevel, over));
        if (typeof action === 'string') throw new Error(action);
        s = applyAction(s, action);
      }
    } catch {
      continue;
    }
    if (s.phase === 'gameover' && s.winner !== null) wins[s.winner === seatA ? 0 : 1]++;
  }
}
console.log(`${wins[0]} ${wins[1]}`);
