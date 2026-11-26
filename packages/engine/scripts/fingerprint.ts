// Impressão digital do motor: joga as mesmas partidas (sementes fixas, decks aleatórios das coleções de
// data/cards, bot simples com ações legais quaisquer no meio) e imprime um hash do que aconteceu em cada grupo.
// Serve para conferir uma mudança que não pode alterar o jogo (ex.: mover código de arquivo, como no
// docs/plano-divisao-motor-e-mesa.md): rode antes e depois; os hashes têm que sair iguais.
//
//   npm run fingerprint -w @gumgum/engine -- [partidas de 2 = 300] [mesas de 4 = 40]
//
// O hash cobre o estado final de cada partida (sem as definições das cartas), as ações legais a cada 20 ações
// e as jogadas do bot com busca em algumas posições (com relógio e sorteio fixos). Mudar uma carta, o bot ou
// uma regra muda o hash: isso é esperado, e aí a comparação não vale.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  actingPlayer,
  applyAction,
  type CardData,
  chooseBotAction,
  chooseSimpleBotAction,
  createGame,
  type DeckList,
  type GameState,
  isColorCompatible,
  leaderAllows,
  legalActions,
  resetPlanner,
  YONKO_DECK_SIZE,
  YONKO_TABLE,
} from '../src';
import { nextRandom } from '../src/rng';

const games2 = Number(process.argv[2] ?? 300);
const games4 = Number(process.argv[3] ?? 40);

const DIR = join(import.meta.dirname, '../../../data/cards');
const cards: CardData[] = readdirSync(DIR)
  .filter((f) => /^(op|st)\d+\.json$/.test(f))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')).cards as CardData[]);
const leaders = cards.filter((c) => c.category === 'leader' && c.colors.length);

const rng = { rng: 987654 };
const pick = <T>(xs: T[]): T => xs[Math.floor(nextRandom(rng) * xs.length)];

/** Deck válido pelas cores do Líder, com cartas sorteadas (`copies` de cada, no máximo). */
function randomDeck(size: number, copies: number): DeckList {
  for (;;) {
    const leader = pick(leaders);
    const options = cards.filter((c) => c.category !== 'leader' && isColorCompatible(leader, c) && leaderAllows(leader, c));
    if (options.length * copies < size) continue;
    const counts = new Map<string, number>();
    for (let total = 0; total < size; ) {
      const c = pick(options);
      const n = counts.get(c.id) ?? 0;
      if (n >= copies) continue;
      counts.set(c.id, n + 1);
      total++;
    }
    return { id: leader.id, name: leader.name, leader: leader.id, cards: [...counts].map(([id, count]) => ({ id, count })) };
  }
}

function newGame(seed: number, players: number): GameState {
  const decks = Array.from({ length: players }, () => (players > 2 ? randomDeck(YONKO_DECK_SIZE, 1) : randomDeck(50, 4)));
  return createGame({
    seed,
    cards,
    ...(players > 2 ? { table: YONKO_TABLE } : {}),
    players: decks.map((d, k) => ({ name: `${k + 1} ${d.name}`, deck: d, isBot: true })),
  });
}

/** O estado sem as definições das cartas (iguais em todas as partidas e grandes). */
const stateText = (s: GameState): string => {
  const { defs: _defs, ...rest } = s;
  return JSON.stringify(rest);
};

function simulate(label: string, games: number, players: number, randomness: number) {
  const hash = createHash('sha256');
  let actions = 0;
  let finished = 0;
  let errors = 0;
  for (let g = 0; g < games; g++) {
    try {
      let s = newGame(g + 1, players);
      let i = 0;
      for (; i < 4000 && s.phase !== 'gameover'; i++) {
        const player = actingPlayer(s)!;
        let action = chooseSimpleBotAction(s, player);
        if (randomness > 0 && nextRandom(rng) < randomness) {
          // Ação legal qualquer (sem encerrar o turno, para a partida avançar pelo bot).
          const legal = legalActions(s, player).filter((a) => a.type !== 'endTurn' && a.type !== 'cancel');
          if (legal.length) action = pick(legal);
        }
        s = applyAction(s, action);
        if (i % 20 === 0 && s.phase !== 'gameover') hash.update(JSON.stringify(legalActions(s, actingPlayer(s)!)));
      }
      actions += i;
      if (s.phase === 'gameover') finished++;
      hash.update(stateText(s));
    } catch (e) {
      // Um erro do motor também faz parte da impressão digital: tem que ser o mesmo dos dois lados.
      errors++;
      hash.update(`erro: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${label}: ${games} partidas, ${finished} terminadas, ${errors} erros, ${actions} ações | ${hash.digest('hex').slice(0, 24)}`);
}

/** Algumas jogadas do bot com busca (planner) no meio de partidas do bot simples, com relógio e sorteio fixos. */
function searchBot(games: number) {
  const hash = createHash('sha256');
  let clock = 0;
  resetPlanner();
  for (let g = 0; g < games; g++) {
    let s = newGame(1000 + g, 2);
    for (let i = 0; i < 400 && s.phase !== 'gameover'; i++) {
      const player = actingPlayer(s)!;
      const action = i % 9 === 0 ? chooseBotAction(s, player, 'normal', { random: () => nextRandom(rng), now: () => (clock += 2) }) : chooseSimpleBotAction(s, player);
      hash.update(JSON.stringify(action));
      s = applyAction(s, action);
    }
    hash.update(stateText(s));
  }
  console.log(`bot com busca: ${games} partidas | ${hash.digest('hex').slice(0, 24)}`);
}

console.log(`${cards.length} cartas, ${leaders.length} Líderes`);
simulate('2 jogadores, só o bot', games2, 2, 0);
simulate('2 jogadores, 30% de ações quaisquer', games2, 2, 0.3);
simulate('4 jogadores (Yonko), 20% de ações quaisquer', games4, 4, 0.2);
searchBot(6);
