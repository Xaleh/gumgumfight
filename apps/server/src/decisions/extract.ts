// Extrator de decisões dos replays gravados: refaz cada partida com o motor e emite um registro por
// decisão de um jogador humano (a situação que ele via, as ações legais, o que escolheu, e o que o bot
// escolheria na mesma visão). É a matéria-prima para melhorar o bot com partidas de gente: onde o bot
// discorda dos bons jogadores, com que frequência um humano usa Counter em cada situação, etc.
// (docs/bot-tempo.md, seção 11).
//
// Só lê o banco; não grava nada. Partidas cujo replay não refaz (versão antiga demais, carta que mudou)
// são contadas em `failed` e puladas.

import {
  type Action,
  actionFromView,
  applyAction,
  type BotLevel,
  type CardData,
  type CardEngineText,
  chooseBotAction,
  createGame,
  type DeckList,
  type GameConfig,
  type GameState,
  getPower,
  identityAliases,
  legalActions,
  type PlayerId,
  REPLAY_VERSION,
  replayConfig,
  resetPlanner,
  upgradeReplayActions,
  viewFor,
} from '@gumgum/engine';
import { type DB, getCards } from '../db';
import { pinEngineTexts } from '../online/room';
import { standings } from '../tournaments/pairing';
import { listFinished, listMatches, listPlayers } from '../tournaments/store';

export type DecisionKind = 'main' | 'counter' | 'block' | 'lifeCard' | 'selectTargets' | 'option' | 'confirm' | 'mulligan' | 'chooseFirst';

/** A jogada, descrita por números de carta (legível e comparável entre partidas). */
export interface Choice {
  type: Action['type'];
  /** Carta jogada/ativada/usada como Counter, ou o atacante. */
  card?: string;
  /** Cartas escolhidas (`choose`), em ordem alfabética. */
  cards?: string[];
  /** Alvo do ataque ou do Counter (número da carta; o Líder pelo número dele). */
  target?: string;
  yes?: boolean;
  index?: number;
  redraw?: boolean;
}

export interface DecisionRecord {
  match: number;
  seat: PlayerId;
  /** Perfil público (`players.id`) e conta (`users.id`, só com login). */
  player: string | null;
  user: string | null;
  mode: string;
  queue: string;
  format: string;
  tier: string | null;
  bounty: number | null;
  playedAt: string;
  /** Índice da ação no replay. */
  index: number;
  turn: number;
  myTurn: boolean;
  kind: DecisionKind;
  life: number;
  oppLife: number;
  hand: number;
  oppHand: number;
  don: number;
  oppDon: number;
  /** Na defesa (Counter, bloqueio): a batalha em curso. */
  battle?: { attacker: string; attackerPower: number; target: string; targetPower: number; targetIsLeader: boolean; need: number };
  /** Quantas ações legais havia. */
  legal: number;
  chosen: Choice;
  /** A escolha do bot na mesma visão (quando pedida) e se bate com a do humano. */
  bot?: Choice;
  agree?: boolean;
  /** O lado venceu a partida. */
  won: boolean;
}

export interface MatchFilter {
  queue?: string;
  /** `created_at >= since` (ISO). */
  since?: string;
  /** Só partidas destes perfis (`players.id`). */
  players?: string[];
  limit?: number;
}

export interface ExtractOptions {
  /** Compara com o bot deste nível (omitido: não compara). */
  bot?: BotLevel;
  /** Teto de tempo por decisão do bot (ms). */
  budgetMs?: number;
}

interface StoredReplay {
  seed: number;
  seed128?: number[];
  firstPlayer?: PlayerId;
  chooseFirst?: boolean;
  legacySetup?: boolean;
  decks: [DeckList, DeckList];
  actions: Action[];
  version?: number;
  engineTexts?: Record<string, CardEngineText>;
}

interface MatchRow {
  id: number;
  mode: string;
  format: string | null;
  queue: string | null;
  replay: string;
}

interface SeatRow {
  seat: PlayerId;
  controller: string;
  player_id: string | null;
  owner_hash: string | null;
  tier: string | null;
  bounty_before: number | null;
  won: number;
  played_at: string;
}

/** Partidas gravadas com replay e pelo menos um lado humano, as mais recentes primeiro. */
export function selectMatches(db: DB, f: MatchFilter = {}): number[] {
  const where = ['m.replay IS NOT NULL'];
  const args: Array<string | number> = [];
  let seatWhere = "s.match_id = m.id AND s.controller = 'human'";
  if (f.players?.length) {
    seatWhere += ` AND s.player_id IN (${f.players.map(() => '?').join(',')})`;
    args.push(...f.players);
  }
  where.push(`EXISTS (SELECT 1 FROM match_seats s WHERE ${seatWhere})`);
  if (f.queue) {
    where.push('m.queue = ?');
    args.push(f.queue);
  }
  if (f.since) {
    where.push('m.created_at >= ?');
    args.push(f.since);
  }
  const limit = f.limit ?? 1000;
  const rows = db.prepare(`SELECT m.id FROM matches m WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`).all(...args, limit) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** Os N perfis de maior recompensa na ranqueada. */
export function topRankedPlayers(db: DB, n: number): string[] {
  const rows = db.prepare('SELECT id FROM players WHERE ranked_games > 0 ORDER BY bounty DESC LIMIT ?').all(n) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Perfis de quem ficou entre os N primeiros de algum torneio encerrado. */
export function topTournamentPlayers(db: DB, n: number): string[] {
  const users = new Set<string>();
  for (const t of listFinished(db)) {
    const table = standings(listPlayers(db, t.id), listMatches(db, t.id));
    for (const s of table) if (s.rank <= n) users.add(s.userId);
  }
  if (!users.size) return [];
  const rows = db
    .prepare(`SELECT id FROM players WHERE owner_hash IN (${[...users].map(() => '?').join(',')})`)
    .all(...[...users].map((u) => `user:${u}`)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function seatsOf(db: DB, matchId: number): SeatRow[] {
  return db
    .prepare(
      `SELECT ms.seat, ms.controller, ms.player_id, p.owner_hash, ms.tier, ms.bounty_before, ms.won, ms.played_at
       FROM match_seats ms LEFT JOIN players p ON p.id = ms.player_id WHERE ms.match_id = ? ORDER BY ms.seat`,
    )
    .all(matchId) as unknown as SeatRow[];
}

/** Descreve a jogada por números de carta. */
export function describeAction(state: GameState, a: Action): Choice {
  const id = (uid: string) => state.cards[uid]?.cardId ?? uid;
  switch (a.type) {
    case 'playCard':
    case 'activate':
      return { type: a.type, card: id(a.uid) };
    case 'attachDon':
    case 'detachDon':
      return { type: a.type, target: id(a.target) };
    case 'attack':
      return { type: a.type, card: id(a.attacker), target: id(a.target) };
    case 'counter':
      return { type: a.type, card: id(a.uid), ...(a.target ? { target: id(a.target) } : {}) };
    case 'choose':
      return { type: a.type, cards: a.uids.map(id).sort() };
    case 'answer':
      return { type: a.type, yes: a.yes };
    case 'option':
      return { type: a.type, index: a.index };
    case 'mulligan':
      return { type: a.type, redraw: a.redraw };
    default:
      return { type: a.type };
  }
}

function sameChoice(a: Choice, b: Choice): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Ações que não são decisões de jogo (ferramentas manuais, relógio, desistência, desfazer). */
const NOT_DECISIONS = new Set<Action['type']>(['manual', 'manualDone', 'judge', 'timeout', 'concede', 'cancel']);

function decisionKind(state: GameState, player: PlayerId): DecisionKind | null {
  const p = state.pending;
  if (p) return p.player === player ? (p.kind as DecisionKind) : null;
  return state.activePlayer === player ? 'main' : null;
}

export interface MatchExtraction {
  records: DecisionRecord[];
  /** Por que a partida foi pulada (replay ilegível ou que não refaz). */
  error?: string;
}

/** Refaz uma partida e devolve as decisões dos lados humanos. */
export function extractMatch(db: DB, matchId: number, opts: ExtractOptions = {}): MatchExtraction {
  const m = db.prepare('SELECT id, mode, format, queue, replay FROM matches WHERE id = ?').get(matchId) as MatchRow | undefined;
  if (!m?.replay) return { records: [], error: 'sem replay' };
  let stored: StoredReplay;
  try {
    stored = JSON.parse(m.replay) as StoredReplay;
  } catch {
    return { records: [], error: 'replay ilegível' };
  }
  const seats = seatsOf(db, matchId);
  const humans = seats.filter((s) => s.controller === 'human');
  if (!humans.length) return { records: [] };

  const ids = [...new Set(stored.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
  const cards = pinEngineTexts(getCards(db, ids) as CardData[], stored.engineTexts);
  let config: GameConfig = {
    seed: stored.seed,
    seed128: stored.seed128,
    firstPlayer: stored.firstPlayer,
    chooseFirst: stored.chooseFirst,
    legacySetup: stored.legacySetup,
    cards,
    players: [
      { name: 'A', deck: stored.decks[0] },
      { name: 'B', deck: stored.decks[1] },
    ],
  };
  const version = stored.version ?? (stored.legacySetup ? 8 : REPLAY_VERSION);
  let actions = stored.actions;
  try {
    if (version < REPLAY_VERSION) {
      config = replayConfig(config, version);
      actions = upgradeReplayActions(config, actions);
    }
  } catch (e) {
    return { records: [], error: `replay da versão ${version} não refaz: ${e instanceof Error ? e.message : String(e)}` };
  }

  const records: DecisionRecord[] = [];
  let state: GameState;
  try {
    state = createGame(config);
  } catch (e) {
    return { records: [], error: e instanceof Error ? e.message : String(e) };
  }
  resetPlanner();
  const aliases = identityAliases(state);
  const bySeat = new Map(humans.map((s) => [s.seat, s]));
  try {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (state.phase === 'gameover') break;
      const seat = bySeat.get(a.player);
      const kind = seat && !NOT_DECISIONS.has(a.type) ? decisionKind(state, a.player) : null;
      if (seat && kind) {
        const me = state.players[a.player];
        const opp = state.players[a.player === 0 ? 1 : 0];
        const rec: DecisionRecord = {
          match: matchId,
          seat: a.player,
          player: seat.player_id,
          user: seat.owner_hash?.startsWith('user:') ? seat.owner_hash.slice('user:'.length) : null,
          mode: m.mode,
          queue: m.queue ?? 'casual',
          format: m.format ?? 'standard',
          tier: seat.tier,
          bounty: seat.bounty_before,
          playedAt: seat.played_at,
          index: i,
          turn: state.turn,
          myTurn: state.activePlayer === a.player,
          kind,
          life: me.life.length,
          oppLife: opp.life.length,
          hand: me.hand.length,
          oppHand: opp.hand.length,
          don: me.donActive,
          oppDon: opp.donActive,
          legal: legalActions(state, a.player).length,
          chosen: describeAction(state, a),
          won: Boolean(seat.won),
        };
        const b = state.battle;
        if (b && (kind === 'counter' || kind === 'block')) {
          const ap = getPower(state, b.attacker);
          const tp = getPower(state, b.target);
          rec.battle = {
            attacker: state.cards[b.attacker].cardId,
            attackerPower: ap,
            target: state.cards[b.target].cardId,
            targetPower: tp,
            targetIsLeader: b.target === me.leader.uid,
            need: Math.max(0, ap - tp + 1000),
          };
        }
        if (opts.bot) {
          // O bot decide pela visão do jogador (sem ver a mão do oponente nem o deck), como no servidor.
          const view = viewFor(state, a.player, aliases);
          const fromBot = actionFromView(state, aliases, chooseBotAction(view, a.player, opts.bot, { timeBudgetMs: opts.budgetMs ?? 250, random: () => 0.5 }));
          if (typeof fromBot !== 'string') {
            rec.bot = describeAction(state, fromBot);
            rec.agree = sameChoice(rec.chosen, rec.bot);
          }
        }
        records.push(rec);
      }
      state = applyAction(state, a);
    }
  } catch (e) {
    return { records, error: `ação ${records.length ? records[records.length - 1].index + 1 : 0} recusada: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { records };
}

// ------------------------------------------------------------------ resumo

export interface Summary {
  matches: number;
  failed: number;
  decisions: number;
  /** Por tipo de decisão: quantas e em quantas o bot concordou. */
  kinds: Record<string, { n: number; agree: number; compared: number }>;
  /** Defesa do Líder: taxa de Counter/bloqueio do humano e do bot, por Vida do defensor. */
  leaderDefense: Record<string, { n: number; human: number; bot: number; botCompared: number }>;
  /** Counter por margem exigida (em milhares), só nos ataques ao Líder. */
  counterByNeed: Record<string, { n: number; human: number; bot: number; botCompared: number }>;
  /** Fase principal: os pares (tipo do humano → tipo do bot) mais frequentes quando discordam. */
  mainDisagreements: Array<{ human: string; bot: string; n: number }>;
}

const bump = <T extends Record<string, number>>(table: Record<string, T>, key: string, blank: T, f: (row: T) => void) => {
  const row = (table[key] ??= { ...blank });
  f(row);
};

export function summarize(records: DecisionRecord[], matches: number, failed: number): Summary {
  const s: Summary = { matches, failed, decisions: records.length, kinds: {}, leaderDefense: {}, counterByNeed: {}, mainDisagreements: [] };
  const pairs = new Map<string, number>();
  for (const r of records) {
    bump(s.kinds, r.kind, { n: 0, agree: 0, compared: 0 }, (row) => {
      row.n++;
      if (r.agree !== undefined) {
        row.compared++;
        if (r.agree) row.agree++;
      }
    });
    if ((r.kind === 'counter' || r.kind === 'block') && r.battle?.targetIsLeader && r.battle.need > 0) {
      const defended = (c: Choice) => (r.kind === 'counter' ? c.type === 'counter' : c.type === 'choose' && (c.cards?.length ?? 0) > 0);
      const add = (row: { n: number; human: number; bot: number; botCompared: number }) => {
        row.n++;
        if (defended(r.chosen)) row.human++;
        if (r.bot) {
          row.botCompared++;
          if (defended(r.bot)) row.bot++;
        }
      };
      bump(s.leaderDefense, `${r.kind}:vida${Math.min(5, r.life)}`, { n: 0, human: 0, bot: 0, botCompared: 0 }, add);
      if (r.kind === 'counter') bump(s.counterByNeed, `+${Math.min(4, r.battle.need / 1000)}000`, { n: 0, human: 0, bot: 0, botCompared: 0 }, add);
    }
    if (r.kind === 'main' && r.bot && !r.agree) {
      // Mesmo tipo de jogada com outra carta ou outro alvo também é discordância, marcada como tal.
      const k = r.chosen.type === r.bot.type ? `${r.chosen.type}→${r.bot.type} (outra carta/alvo)` : `${r.chosen.type}→${r.bot.type}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
  }
  s.mainDisagreements = [...pairs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => {
      const [human, bot] = k.split('→');
      return { human, bot, n };
    });
  return s;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');

/** O resumo em texto, para o terminal. */
export function formatSummary(s: Summary): string {
  const out: string[] = [];
  out.push(`Partidas: ${s.matches} (${s.failed} não refizeram) | decisões humanas: ${s.decisions}`);
  out.push('');
  out.push('Por tipo de decisão (concordância do bot, quando comparado):');
  for (const [kind, row] of Object.entries(s.kinds).sort((a, b) => b[1].n - a[1].n)) {
    out.push(`  ${kind.padEnd(14)} ${String(row.n).padStart(6)}   bot concorda ${pct(row.agree, row.compared)}`);
  }
  const defense = Object.entries(s.leaderDefense).sort();
  if (defense.length) {
    out.push('');
    out.push('Defesa do Líder (ataque que acertaria): quem defende, humano x bot, por Vida do defensor:');
    for (const [k, row] of defense) out.push(`  ${k.padEnd(14)} ${String(row.n).padStart(6)}   humano ${pct(row.human, row.n)}   bot ${pct(row.bot, row.botCompared)}`);
  }
  const need = Object.entries(s.counterByNeed).sort();
  if (need.length) {
    out.push('');
    out.push('Counter no Líder por margem exigida:');
    for (const [k, row] of need) out.push(`  ${k.padEnd(14)} ${String(row.n).padStart(6)}   humano ${pct(row.human, row.n)}   bot ${pct(row.bot, row.botCompared)}`);
  }
  if (s.mainDisagreements.length) {
    out.push('');
    out.push('Fase principal, quando discordam (humano → bot):');
    for (const d of s.mainDisagreements) out.push(`  ${d.human.padEnd(10)} → ${d.bot.padEnd(28)} ${String(d.n).padStart(6)}`);
  }
  return out.join('\n');
}
