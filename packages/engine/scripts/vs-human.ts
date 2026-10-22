// Bot x "humano fraco" (scripts/human.ts): taxa de vitória do bot, assentos trocados, decks prontos sorteados.
//
//   npx tsx scripts/vs-human.ts [partidas=100] [nível=hard] ['<pesos do bot (json parcial)>']
//   HUMAN=careful npx tsx scripts/vs-human.ts 100 hard     # o humano usa Counter sempre com Vida baixa
//   saída: "<vitórias do bot> <vitórias do humano>"
//
// Mede o que o auto-jogo não mede: o bot contra quem defende como gente (segura o ataque fatal sempre,
// Counter com Vida baixa) e desenvolve o campo todo turno.

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
import { humanAction } from './human';

const DATA = join(import.meta.dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = readdirSync(join(DATA, 'cards'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => load(`cards/${f}`).cards as CardData[]);
const DECKS = readdirSync(join(DATA, 'decks')).filter((f) => f.endsWith('.json'));

const [gamesArg = '100', level = 'hard', wn = '{}'] = process.argv.slice(2);
const games = Number(gamesArg);
const weights = { ...BOT_WEIGHTS, ...JSON.parse(wn) };
let rng = Number(process.env.SEED ?? 11) >>> 0;
const rand = () => {
  rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
  return rng / 2 ** 32;
};

const wins = [0, 0];
for (let g = 0; g < games; g += 2) {
  const deck = (): DeckList => load(`decks/${DECKS[Math.floor(rand() * DECKS.length)]}`);
  const decks = [deck(), deck()] as const;
  const seed = Math.floor(rand() * 1e9);
  for (const seatBot of [0, 1] as PlayerId[]) {
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
    for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
      const p = actingPlayer(s)!;
      const view = viewFor(s, p, aliases);
      const a = p === seatBot ? chooseBotAction(view, p, level as BotLevel, { weights, timeBudgetMs: 1e9 }) : humanAction(view, p);
      const action = actionFromView(s, aliases, a);
      if (typeof action === 'string') throw new Error(action);
      s = applyAction(s, action);
    }
    if (s.phase === 'gameover' && s.winner !== null) wins[s.winner === seatBot ? 0 : 1]++;
    process.stdout.write(`\rpartida ${g + seatBot + 1}/${games}: bot ${wins[0]} x ${wins[1]} humano   `);
  }
}
console.log(`\n${wins[0]} ${wins[1]} (bot ${((100 * wins[0]) / Math.max(1, wins[0] + wins[1])).toFixed(0)}%)`);
