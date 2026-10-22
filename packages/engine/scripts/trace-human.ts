// Depuração: uma partida bot (A) x "humano fraco" (B, scripts/human.ts), jogada a jogada, com o tabuleiro e as
// mãos no começo de cada turno. DBG=<turno> mostra a linha escolhida pelo bot a partir desse turno.
//
//   npx tsx scripts/trace-human.ts [semente=1] [nível=hard] [deckA=st01-luffy] [deckB=st02-kid]

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  actingPlayer,
  actionFromView,
  applyAction,
  type BotLevel,
  type CardData,
  cardDef,
  chooseBotAction,
  createGame,
  type DeckList,
  type GameState,
  getPower,
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
const [seedArg = '1', level = 'hard', deckA = 'st01-luffy', deckB = 'st02-kid'] = process.argv.slice(2);
const decks: DeckList[] = [load(`decks/${deckA}.json`), load(`decks/${deckB}.json`)];

let s: GameState = createGame({
  seed: Number(seedArg),
  firstPlayer: 0,
  cards,
  players: [
    { name: 'A', deck: decks[0], isBot: true },
    { name: 'B', deck: decks[1], isBot: true },
  ],
});
const aliases = identityAliases(s);
resetPlanner();

const card = (u: string, rested: boolean, don: number) =>
  `${cardDef(s, u).name}(${cardDef(s, u).cost ?? '-'}c ${getPower(s, u)}${rested ? ' virado' : ''}${don ? ` +${don} DON` : ''})`;
function board() {
  for (const p of [0, 1] as PlayerId[]) {
    const ps = s.players[p];
    const field = [ps.leader, ...ps.characters].map((c) => card(c.uid, c.rested, c.don)).join(', ');
    console.log(`  [${p ? 'B humano' : `A ${level}`}] Vida ${ps.life.length} | mão ${ps.hand.length} | DON ${ps.donActive} ativo, ${ps.donRested} virado | ${field}`);
    console.log(`      mão: ${ps.hand.map((u) => `${cardDef(s, u).name}(${cardDef(s, u).cost ?? '-'}c, Counter ${cardDef(s, u).counter ?? 0})`).join(', ')}`);
  }
}

let logged = 0;
let lastTurn = 0;
for (let i = 0; i < 4000 && s.phase !== 'gameover'; i++) {
  if (s.turn !== lastTurn && !s.pending) {
    lastTurn = s.turn;
    console.log(`\n=== Turno ${s.turn} (${s.activePlayer ? 'B' : 'A'}) ===`);
    board();
  }
  const p = actingPlayer(s)!;
  const debug = process.env.DBG && Number(process.env.DBG) <= s.turn;
  const over = { timeBudgetMs: 1e9, onDecision: debug ? (info: string, depth: number) => depth === 0 && console.log(`    # ${info}`) : undefined };
  const view = viewFor(s, p, aliases);
  const action = actionFromView(s, aliases, p === 0 ? chooseBotAction(view, p, level as BotLevel, over) : humanAction(view, p));
  if (typeof action === 'string') throw new Error(action);
  s = applyAction(s, action);
  for (; logged < s.log.length; logged++) console.log(`  ${s.log[logged].secret ?? s.log[logged].text}`);
}
console.log(`\nVencedor: ${s.winner === null ? 'ninguém' : s.winner ? 'B (humano)' : 'A (bot)'} no turno ${s.turn}`);
