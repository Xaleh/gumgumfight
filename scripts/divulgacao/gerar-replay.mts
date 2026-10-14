// Partida bot x bot gravada como replay (.json), para gravar a mesa no "Assistir replay" do site.
// Uso: npx tsx scripts/divulgacao/gerar-replay.mts <deck0> <deck1> <seed> <saida.json> [nome0] [nome1]
// Precisa da API no ar (npm run dev): os decks e as cartas vêm de /api/decks/<id>.
//
// O bot desempata com sorteio e tem prazo por decisão; aqui o desempate usa a seed e não há prazo, então a
// mesma seed (com o mesmo motor e as mesmas cartas) dá a mesma partida. O replay-padrao.json, usado pelo
// gerar.sh e com os cortes de montar.py, foi gerado antes disso: uma partida nova pede cortes novos.
import { writeFileSync } from 'node:fs';
import { type Action, actingPlayer, applyAction, chooseBotAction, createGame, type GameState, REPLAY_VERSION } from '../../packages/engine/src/index.ts';

const [, , d0, d1, seedArg, out, n0 = 'Jogador 1', n1 = 'Jogador 2'] = process.argv;
const API = process.env.API ?? 'http://127.0.0.1:3001';
const get = async (id: string) => (await fetch(`${API}/api/decks/${id}`)).json();
const [a, b] = await Promise.all([get(d0), get(d1)]);
const cards = new Map();
for (const c of [...a.cards, ...b.cards]) cards.set(c.id, c);
const seed = Number(seedArg);
/** mulberry32: sorteio com seed para o desempate do bot. */
let r = seed >>> 0;
const random = () => {
  r = (r + 0x6d2b79f5) >>> 0;
  let t = r;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const config = {
  seed,
  firstPlayer: 0 as const,
  cards: [...cards.values()],
  players: [
    { name: n0, deck: a.deck, isBot: false },
    { name: n1, deck: b.deck, isBot: true },
  ],
};
let s: GameState = createGame(config);
const actions: Action[] = [];
while (s.phase !== 'gameover' && actions.length < 3000) {
  const act = chooseBotAction(s, actingPlayer(s)!, 'normal', { random, timeBudgetMs: Infinity });
  actions.push(act);
  s = applyAction(s, act);
}
console.log(JSON.stringify({ seed, turns: s.turn, winner: s.winner, actions: actions.length, life: s.players.map((p) => p.life?.length) }));
writeFileSync(out, JSON.stringify({ format: 'gumgumfight-replay', version: REPLAY_VERSION, seed, decks: [a.deck, b.deck], firstPlayer: 0, names: [n0, n1], deckIds: [d0, d1], actions }));
