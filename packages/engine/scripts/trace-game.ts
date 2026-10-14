// Depuração do bot: joga uma partida bot x bot e imprime o histórico, com o tabuleiro e as mãos no
// começo de cada turno. Determinística (desempate com semente, sem teto de tempo).
//
//   npx tsx scripts/trace-game.ts [semente=1] [nívelA=hard] [nívelB=hard] [deckA=st01-luffy] [deckB=st02-kid]
//
// Variáveis de ambiente: WA='{"lifeOpp":[…]}' troca pesos do jogador A (json parcial); DBG=<turno>
// mostra, a partir desse turno, a linha que o planejador escolheu em cada decisão.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  actingPlayer,
  actionFromView,
  applyAction,
  BOT_WEIGHTS,
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

const DATA = join(import.meta.dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = readdirSync(join(DATA, 'cards'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => load(`cards/${f}`).cards as CardData[]);
const [seedArg = '1', levelA = 'hard', levelB = 'hard', deckA = 'st01-luffy', deckB = 'st02-kid'] = process.argv.slice(2);
const levels = [levelA, levelB] as BotLevel[];
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

let rng = (Number(seedArg) * 7919 + 17) >>> 0;
const random = () => {
  rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
  return rng / 2 ** 32;
};
const weightsA = process.env.WA ? { ...BOT_WEIGHTS, ...JSON.parse(process.env.WA) } : BOT_WEIGHTS;

const card = (u: string, rested: boolean, don: number) =>
  `${cardDef(s, u).name}(${cardDef(s, u).cost ?? '-'}c ${getPower(s, u)}${rested ? ' virado' : ''}${don ? ` +${don} DON` : ''})`;
function board() {
  for (const p of [0, 1] as PlayerId[]) {
    const ps = s.players[p];
    const field = [ps.leader, ...ps.characters].map((c) => card(c.uid, c.rested, c.don)).join(', ');
    console.log(`  [${p ? 'B' : 'A'} ${levels[p]}] Vida ${ps.life.length} | mão ${ps.hand.length} | deck ${ps.deck.length} | DON ${ps.donActive} ativo, ${ps.donRested} virado | ${field}`);
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
  const over = {
    random,
    timeBudgetMs: 1e9,
    weights: p === 0 ? weightsA : BOT_WEIGHTS,
    onDecision: debug ? (info: string, depth: number) => depth === 0 && console.log(`    # ${info}`) : undefined,
  };
  const action = actionFromView(s, aliases, chooseBotAction(viewFor(s, p, aliases), p, levels[p], over));
  if (typeof action === 'string') throw new Error(action);
  s = applyAction(s, action);
  for (; logged < s.log.length; logged++) {
    const e = s.log[logged];
    console.log(`  ${e.secret ?? e.text}`);
  }
}
console.log(`\nVencedor: ${s.winner === null ? 'ninguém' : s.winner ? 'B' : 'A'} no turno ${s.turn}`);
