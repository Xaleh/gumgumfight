// D2: o bot com a mão provável do oponente (`handguess.ts`) contra o mesmo bot sem ela, no mesmo nível. Cada sorteio
// (decks prontos e semente) é jogado duas vezes, com os assentos trocados. O deck provável de cada lado é o deck pronto
// do Líder adversário (nos decks prontos, a lista que todo mundo joga com aquele Líder: o "meta" desse universo).
//
//   npx tsx scripts/duel-handguess.ts <semente> <partidas> [nível]
//   saída: "<vitórias com a estimativa> <vitórias sem>"

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
  deckGuessFrom,
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
const byId = new Map(cards.map((c) => [c.id, c]));
const DECKS = readdirSync(join(DATA, 'decks')).filter((f) => f.endsWith('.json'));

const [seedArg, gamesArg, levelArg] = process.argv.slice(2);
const level = (levelArg ?? 'hard') as BotLevel;
let rng = Number(seedArg) >>> 0;
const rand = () => {
  rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
  return rng / 2 ** 32;
};

const wins = [0, 0];
for (let g = 0; g < Number(gamesArg); g += 2) {
  const deck = (): DeckList => load(`decks/${DECKS[Math.floor(rand() * DECKS.length)]}`);
  const decks = [deck(), deck()] as const;
  const guesses = decks.map((d) => deckGuessFrom(d.leader, d.cards, byId, `deck:${d.leader}`));
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
        // Sem teto de tempo: o resultado não depende da carga da máquina. O lado A conhece o deck provável do oponente.
        const over = { timeBudgetMs: 1e9, ...(p === seatA ? { handGuess: guesses[1 - p] } : {}) };
        const action = actionFromView(s, aliases, chooseBotAction(viewFor(s, p, aliases), p, level, over));
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
