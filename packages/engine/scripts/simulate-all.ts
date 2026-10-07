// Partidas bot x bot com decks aleatórios (válidos) de toda a base de cartas.
// Serve para achar travamentos e quebras de invariantes depois de importar coleções novas.
//
//   npm run simulate:all -w @gumgum/engine -- <cards.json | URL> [partidas=300] [aleatoriedade=0]
//   aleatoriedade (0 a 1): chance de cada ação ser uma ação legal qualquer, para exercitar efeitos que o bot não usa.
//   ex.: npm run simulate:all -w @gumgum/engine -- https://gumgumfight.app/api/cards 500

import { readFileSync } from 'node:fs';
import {
  actingPlayer,
  legalActions,
  applyAction,
  type CardData,
  chooseBotAction,
  createGame,
  type DeckList,
  type GameState,
  isColorCompatible,
  leaderAllows,
  validateDeck,
} from '../src';
import { nextRandom } from '../src/rng';

const [source, gamesArg, randomArg] = process.argv.slice(2);
const randomness = Number(randomArg ?? 0);
if (!source) {
  console.error('Uso: simulate-all <cards.json | URL> [partidas]');
  process.exit(1);
}
const games = Number(gamesArg ?? 300);

async function loadCards(): Promise<CardData[]> {
  if (/^https?:/.test(source)) return (await (await fetch(source)).json()) as CardData[];
  return JSON.parse(readFileSync(source, 'utf8')) as CardData[];
}

function randomDeck(rng: { rng: number }, leader: CardData, pool: CardData[]): DeckList | null {
  const options = pool.filter((c) => c.category !== 'leader' && isColorCompatible(leader, c) && leaderAllows(leader, c));
  if (options.length < 13) return null;
  const counts = new Map<string, number>();
  let total = 0;
  while (total < 50) {
    const c = options[Math.floor(nextRandom(rng) * options.length)];
    const n = counts.get(c.id) ?? 0;
    if (n >= 4) continue;
    counts.set(c.id, n + 1);
    total++;
  }
  return { id: leader.id, name: leader.name, leader: leader.id, cards: [...counts].map(([id, count]) => ({ id, count })) };
}

const countCards = (s: GameState, p: 0 | 1) => {
  const ps = s.players[p];
  const limbo = s.stack.filter(
    (f) =>
      (f.kind === 'damage' && f.lifeCard && s.cards[f.lifeCard].owner === p) || (f.kind === 'play' && s.cards[f.uid].owner === p),
  ).length + (s.limbo ?? []).filter((u) => s.cards[u].owner === p).length;
  return 1 + ps.characters.length + (ps.stage ? 1 : 0) + ps.hand.length + ps.deck.length + ps.trash.length + ps.life.length + limbo;
};

async function main() {
  const cards = await loadCards();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const leaders = cards.filter((c) => c.category === 'leader' && c.colors.length);
  const rng = { rng: 12345 };
  let finished = 0;
  let turnSum = 0;
  let actions = 0;
  const failures: string[] = [];
  const t0 = Date.now();

  for (let g = 0; g < games; g++) {
    const l0 = leaders[Math.floor(nextRandom(rng) * leaders.length)];
    const l1 = leaders[Math.floor(nextRandom(rng) * leaders.length)];
    const d0 = randomDeck(rng, l0, cards);
    const d1 = randomDeck(rng, l1, cards);
    if (!d0 || !d1) continue;
    for (const d of [d0, d1]) {
      const r = validateDeck(d, byId);
      if (!r.valid) failures.push(`deck inválido ${d.leader}: ${r.issues[0]?.message}`);
    }
    let s: GameState;
    try {
      s = createGame({
        seed: g + 1,
        cards,
        players: [
          { name: l0.name, deck: d0, isBot: true },
          { name: l1.name, deck: d1, isBot: true },
        ],
      });
      const donTotal = (st: GameState, p: 0 | 1) => {
        const pl = st.players[p];
        return pl.donDeck + pl.donActive + pl.donRested + [pl.leader, ...pl.characters, ...(pl.stage ? [pl.stage] : [])].reduce((n, c) => n + c.don, 0);
      };
      const don0 = [donTotal(s, 0), donTotal(s, 1)];
      let i = 0;
      for (; i < 4000 && s.phase !== 'gameover'; i++) {
        const player = actingPlayer(s)!;
        let action = chooseBotAction(s, player);
        if (randomness > 0 && nextRandom(rng) < randomness) {
          // Ação legal qualquer (sem encerrar o turno, para a partida avançar pelo bot).
          const legal = legalActions(s, player).filter((a) => a.type !== 'endTurn');
          if (legal.length) action = legal[Math.floor(nextRandom(rng) * legal.length)];
        }
        s = applyAction(s, action);
        for (const p of [0, 1] as const) {
          if (countCards(s, p) !== 51) throw new Error(`cartas do jogador ${p}: ${countCards(s, p)}`);
          if (donTotal(s, p) !== don0[p]) throw new Error(`DON!! do jogador ${p}: ${donTotal(s, p)} (esperado ${don0[p]}) após ${action.type}`);
        }
      }
      actions += i;
      if (s.phase === 'gameover') {
        finished++;
        turnSum += s.turn;
      } else failures.push(`partida ${g + 1} (${l0.id} x ${l1.id}) não terminou em 4000 ações`);
    } catch (e) {
      failures.push(`partida ${g + 1} (${l0.id} x ${l1.id}): ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`${cards.length} cartas, ${leaders.length} líderes`);
  console.log(`${finished}/${games} partidas terminaram | média ${(turnSum / Math.max(1, finished)).toFixed(1)} turnos | ${actions} ações | ${Date.now() - t0}ms`);
  if (failures.length) {
    console.log(`\n${failures.length} problema(s):`);
    for (const f of failures.slice(0, 20)) console.log(' -', f);
    process.exit(1);
  }
}

main();
