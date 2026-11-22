// Mesas de Yonko (todos contra todos) entre bots simples, com decks aleatórios de toda a base montados pelas
// regras do formato (docs/regras-yonko.md): 60 cartas da cor do Líder, uma cópia de cada.
// É a fase 1 do plano (docs/plano-modos-de-jogo.md, seção 4): achar travamentos, quebras de invariantes
// e cartas cujos efeitos não se comportam bem com mais de dois jogadores, antes de gastar com tela.
//
//   npm run simulate:yonko -w @gumgum/engine -- [cards.json | pasta | URL] [partidas=500] [aleatoriedade=0.15] [jogadores=4]
//   Sem origem, usa as coleções de data/cards. aleatoriedade (0 a 1): chance de cada ação ser uma ação
//   legal qualquer, para exercitar efeitos que o bot não usa.
//   ex.: npm run simulate:yonko -w @gumgum/engine -- https://gumgumfight.app/api/cards 2000

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actingPlayer,
  applyAction,
  type CardData,
  chooseSimpleBotAction,
  createGame,
  type DeckList,
  type GameState,
  isColorCompatible,
  leaderAllows,
  legalActions,
  type PlayerId,
  setOpponentProbe,
  validateYonkoDeck,
  YONKO_DECK_SIZE,
  YONKO_TABLE,
} from '../src';
import { nextRandom } from '../src/rng';

const [sourceArg, gamesArg, randomArg, playersArg] = process.argv.slice(2);
const source = sourceArg || join(dirname(fileURLToPath(import.meta.url)), '../../../data/cards');
const games = Number(gamesArg ?? 500);
const randomness = Number(randomArg ?? 0.15);
const seats = Number(playersArg ?? 4);
const MAX_ACTIONS = 12_000;

async function loadCards(): Promise<CardData[]> {
  if (/^https?:/.test(source)) return (await (await fetch(source)).json()) as CardData[];
  const read = (file: string) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as CardData[] | { cards?: CardData[] };
    return Array.isArray(data) ? data : (data.cards ?? []);
  };
  if (!statSync(source).isDirectory()) return read(source);
  const byId = new Map<string, CardData>();
  for (const f of readdirSync(source).filter((n) => n.endsWith('.json')).sort()) for (const c of read(join(source, f))) byId.set(c.id, c);
  return [...byId.values()];
}

function randomDeck(rng: { rng: number }, leader: CardData, pool: CardData[]): DeckList | null {
  const options = pool.filter((c) => c.category !== 'leader' && isColorCompatible(leader, c) && leaderAllows(leader, c));
  // Singleton: precisa de pelo menos 60 cartas diferentes na cor do Líder.
  if (options.length < YONKO_DECK_SIZE) return null;
  const picked = new Set<string>();
  while (picked.size < YONKO_DECK_SIZE) picked.add(options[Math.floor(nextRandom(rng) * options.length)].id);
  return { id: leader.id, name: leader.name, leader: leader.id, cards: [...picked].map((id) => ({ id, count: 1 })) };
}

/** Cartas do jogador em todas as áreas (61 = Líder + 60), contando as que estão "no ar" na pilha. */
const countCards = (s: GameState, p: PlayerId) => {
  const ps = s.players[p];
  const limbo =
    s.stack.filter((f) => (f.kind === 'damage' && f.lifeCard && s.cards[f.lifeCard].owner === p) || (f.kind === 'play' && s.cards[f.uid].owner === p)).length +
    (s.limbo ?? []).filter((u) => s.cards[u].owner === p).length;
  return 1 + ps.characters.length + (ps.stage ? 1 : 0) + ps.hand.length + ps.deck.length + ps.trash.length + ps.life.length + limbo;
};

const donTotal = (s: GameState, p: PlayerId) => {
  const pl = s.players[p];
  return pl.donDeck + pl.donActive + pl.donRested + [pl.leader, ...pl.characters, ...(pl.stage ? [pl.stage] : [])].reduce((n, c) => n + c.don, 0);
};

const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

async function main() {
  const cards = await loadCards();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const leaders = cards.filter((c) => c.category === 'leader' && c.colors.length);
  const rng = { rng: 4242 };
  const failures: string[] = [];
  /** Cartas presentes nas partidas que falharam: quem aparece muito é suspeita. */
  const suspects = new Map<string, number>();
  /** Passos que perguntaram pelo oponente sem contexto (ver `setOpponentProbe`). */
  const unfocused = new Map<string, number>();
  const unfocusedCards = new Map<string, Set<string>>();
  /** Eventos [Counter] usados por quem não era o defensor. */
  const meddled = new Map<string, number>();
  setOpponentProbe((cardId, step) => {
    bump(unfocused, step.do);
    (unfocusedCards.get(step.do) ?? unfocusedCards.set(step.do, new Set()).get(step.do)!).add(cardId);
  });

  let finished = 0;
  let draws = 0;
  let turnSum = 0;
  let actions = 0;
  let windows = 0;
  let eliminations = 0;
  let winsOutright = 0;
  const winsBySeat = new Array(seats).fill(0) as number[];
  const winsByOrder = new Array(seats).fill(0) as number[];
  const t0 = Date.now();

  for (let g = 0; g < games; g++) {
    const decks: DeckList[] = [];
    while (decks.length < seats) {
      const d = randomDeck(rng, leaders[Math.floor(nextRandom(rng) * leaders.length)], cards);
      if (d) decks.push(d);
    }
    const label = `partida ${g + 1} (${decks.map((d) => d.leader).join(' x ')})`;
    for (const d of decks) {
      const report = validateYonkoDeck(d, byId);
      if (!report.valid) failures.push(`${label}: deck inválido de ${d.leader}: ${report.issues.find((i) => i.level === 'error')?.message}`);
    }
    const blame = () => {
      for (const d of decks) for (const id of new Set([d.leader, ...d.cards.map((c) => c.id)])) bump(suspects, id);
    };
    let s: GameState | undefined;
    let i = 0;
    try {
      s = createGame({ seed: g + 1, cards, table: YONKO_TABLE, players: decks.map((d, k) => ({ name: `${k + 1}º ${d.name}`, deck: d, isBot: true })) });
      const don0 = s.players.map((_, p) => donTotal(s!, p));
      for (; i < MAX_ACTIONS && s.phase !== 'gameover'; i++) {
        const player = actingPlayer(s)!;
        if (s.players[player].out) throw new Error(`o motor espera uma ação de um jogador eliminado (${s.players[player].name})`);
        const bystander = s.pending?.kind === 'counter' && s.pending.bystander === true;
        if (bystander) windows++;
        let action = chooseSimpleBotAction(s, player);
        if (randomness > 0 && nextRandom(rng) < randomness) {
          // Ação legal qualquer (sem encerrar o turno, para a partida avançar pelo bot).
          const legal = legalActions(s, player).filter((a) => a.type !== 'endTurn' && a.type !== 'cancel');
          if (legal.length) action = legal[Math.floor(nextRandom(rng) * legal.length)];
        }
        if (bystander && action.type === 'counter') bump(meddled, s.cards[action.uid].cardId);
        s = applyAction(s, action);
        for (const ps of s.players) {
          if (ps.out) {
            if (countCards(s, ps.id) !== 1 || donTotal(s, ps.id) !== 0) throw new Error(`o eliminado ${ps.name} ainda tem cartas ou DON!! em jogo`);
            continue;
          }
          if (countCards(s, ps.id) !== YONKO_DECK_SIZE + 1) throw new Error(`cartas de ${ps.name}: ${countCards(s, ps.id)} após ${action.type}`);
          if (donTotal(s, ps.id) !== don0[ps.id]) throw new Error(`DON!! de ${ps.name}: ${donTotal(s, ps.id)} (esperado ${don0[ps.id]}) após ${action.type}`);
          if (ps.characters.length > 5) throw new Error(`${ps.name} tem ${ps.characters.length} Personagens`);
        }
      }
      actions += i;
      if (s.phase !== 'gameover') {
        failures.push(`${label} não terminou em ${MAX_ACTIONS} ações (turno ${s.turn})`);
        blame();
      } else if (s.winner === null && s.winReason?.startsWith('Laço infinito')) {
        // Laço infinito vira empate (11-1) em vez de travar: aqui continua sendo um problema a olhar.
        failures.push(`${label}: ${s.winReason}`);
        blame();
      } else {
        finished++;
        turnSum += s.turn;
        eliminations += s.eliminated?.length ?? 0;
        if (s.winner === null) draws++;
        else {
          winsBySeat[s.winner]++;
          winsByOrder[(s.winner - s.firstPlayer + seats) % seats]++;
          // "You win the game" (efeito ou regra do Líder) encerra a mesa com os outros ainda de pé.
          const outright = s.winReasonKey === 'log.winByEffect' || s.winReasonKey === 'log.winDeckOutLeaderRule';
          if (outright) winsOutright++;
          const placed = new Set([...(s.eliminated ?? []), s.winner]);
          if (!outright && placed.size !== seats) failures.push(`${label}: a classificação não tem os ${seats} jogadores (${[...placed].join(', ')})`);
        }
      }
    } catch (e) {
      const last = s?.log.slice(-3).map((l) => l.text).join(' | ');
      failures.push(`${label}, ação ${i}: ${e instanceof Error ? e.message : e}${last ? `\n     últimas linhas: ${last}` : ''}`);
      blame();
    }
  }

  const name = (id: string) => `${id} ${byId.get(id)?.name ?? ''}`.trim();
  console.log(`${cards.length} cartas, ${leaders.length} líderes, mesas de ${seats}, aleatoriedade ${randomness}`);
  console.log(
    `${finished}/${games} partidas terminaram (${draws} empates) | média ${(turnSum / Math.max(1, finished)).toFixed(1)} turnos e ${(actions / Math.max(1, games)).toFixed(0)} ações | ${Date.now() - t0}ms`,
  );
  console.log(`vitórias por posição na ordem (1º a jogar … último): ${winsByOrder.join(' / ')}`);
  console.log(`vezes de Counter abertas a quem não era o defensor: ${(windows / Math.max(1, games)).toFixed(1)} por partida | eliminações registradas: ${eliminations}`);
  if (winsOutright) console.log(`vitórias diretas ("you win the game", com oponentes ainda na mesa): ${winsOutright}`);
  if (meddled.size) {
    console.log('\nEventos [Counter] mais usados por quem não era o defensor:');
    for (const [id, n] of top(meddled, 10)) console.log(`  ${String(n).padStart(5)}  ${name(id)}`);
  }
  if (unfocused.size) {
    console.log('\npassos que usaram "o oponente" sem valer para cada um (ensinar a `eachOpponent`):');
    for (const [step, n] of top(unfocused, 30)) console.log(`  ${String(n).padStart(5)}  ${step}  (${[...unfocusedCards.get(step)!].slice(0, 6).map(name).join('; ')})`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} problema(s):`);
    for (const f of failures.slice(0, 25)) console.log(' -', f);
    console.log('\ncartas mais presentes nas partidas com problema:');
    for (const [id, n] of top(suspects, 15)) console.log(`  ${String(n).padStart(4)}  ${name(id)}`);
    process.exit(1);
  }
}

main();
