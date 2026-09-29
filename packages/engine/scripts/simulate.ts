// Roda N partidas bot x bot e mostra estatísticas.
// Uso: npm run simulate -w @gumgum/engine -- 500

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actingPlayer, applyAction, chooseBotAction, createGame, type CardData, type DeckList, type GameState } from '../src';

const DATA = join(import.meta.dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = [...load('cards/st01.json').cards, ...load('cards/st02.json').cards];
const decks: DeckList[] = [load('decks/st01-luffy.json'), load('decks/st02-kid.json')];

const n = Number(process.argv[2] ?? 200);
const wins = [0, 0];
const firstWins = [0, 0];
let turns = 0;
const t0 = Date.now();

for (let seed = 1; seed <= n; seed++) {
  let s: GameState = createGame({
    seed,
    cards,
    players: [
      { name: decks[0].name, deck: decks[0], isBot: true },
      { name: decks[1].name, deck: decks[1], isBot: true },
    ],
  });
  while (s.phase !== 'gameover') s = applyAction(s, chooseBotAction(s, actingPlayer(s)!));
  wins[s.winner!]++;
  firstWins[s.winner === s.firstPlayer ? 0 : 1]++;
  turns += s.turn;
}

console.log(`${n} partidas em ${Date.now() - t0}ms`);
console.log(`${decks[0].name}: ${wins[0]} vitórias | ${decks[1].name}: ${wins[1]} vitórias`);
console.log(`Quem começa vence: ${firstWins[0]} | quem joga em segundo vence: ${firstWins[1]}`);
console.log(`Média de turnos: ${(turns / n).toFixed(1)}`);
