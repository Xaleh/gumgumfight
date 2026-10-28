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
  chooseSimpleBotAction,
  counterValue,
  createGame,
  type DeckList,
  type GameConfig,
  type GameState,
  getPower,
  identityAliases,
  legalActions,
  playCost,
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
  /**
   * No Counter: quanto a mão podia dar (Counters impressos e Eventos [Counter] que o DON!! ativo paga) e quanto
   * a carta usada deu. Separa "não quis" de "não tinha como".
   */
  counters?: number;
  chosenValue?: number;
  /**
   * No Counter usado: o custo e o tipo da carta, e o DON!! que o jogador terá no próximo turno (o de campo mais 2).
   * Uma carta que custa mais que isso não seria jogada tão cedo: é a "carta morta" que vale gastar.
   */
  chosenCost?: number;
  chosenCategory?: string;
  donNext?: number;
  /** No mulligan: a mão inicial, por faixa de custo dos Personagens, Eventos e Counter impresso somado (em 1000). */
  opening?: { le2: number; c3: number; c4: number; ge5: number; events: number; counter: number };
  /** Colocação do jogador no torneio da partida (só com `--tournament`). */
  placement?: number;
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
  /** Só os jogos deste torneio (`tournaments.id`). */
  tournament?: string;
  limit?: number;
}

export interface ExtractOptions {
  /** Compara com o bot deste nível (omitido: não compara). */
  bot?: BotLevel;
  /** Teto de tempo por decisão do bot (ms). */
  budgetMs?: number;
  /** Colocação no torneio por conta (`users.id`), gravada em cada registro. */
  placements?: Map<string, number>;
  /**
   * Chamado em cada decisão humana com o estado completo antes da ação (o ajuste de pesos por imitação guarda a
   * visão do jogador e a escolha dele).
   */
  onDecision?: (state: GameState, action: Action, rec: DecisionRecord) => void;
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
  if (f.tournament) {
    where.push('m.id IN (SELECT stats_match_id FROM tournament_games WHERE tournament_id = ? AND stats_match_id IS NOT NULL)');
    args.push(f.tournament);
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

export interface TournamentInfo {
  id: string;
  name: string;
  finishedAt: string | null;
  players: number;
  /** Colocação por conta (`users.id`). */
  placements: Map<string, number>;
}

/** Um torneio encerrado (`latest`: o mais recente) e a classificação final. null se não existe. */
export function tournamentInfo(db: DB, idOrLatest: string): TournamentInfo | null {
  const row = (
    idOrLatest === 'latest'
      ? db.prepare("SELECT id, name, finished_at FROM tournaments WHERE status = 'finished' ORDER BY finished_at DESC, rowid DESC LIMIT 1").get()
      : db.prepare('SELECT id, name, finished_at FROM tournaments WHERE id = ?').get(idOrLatest)
  ) as { id: string; name: string; finished_at: string | null } | undefined;
  if (!row) return null;
  const players = listPlayers(db, row.id);
  const placements = new Map(standings(players, listMatches(db, row.id)).map((s) => [s.userId, s.rank]));
  return { id: row.id, name: row.name, finishedAt: row.finished_at, players: players.length, placements };
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

/** O que um lado fez num turno inteiro (fase principal), para comparar com o turno que o bot jogaria. */
export interface TurnSummary {
  /** Cartas jogadas da mão, por número. */
  played: string[];
  /** Ataques: atacante → alvo (números de carta). */
  attacks: Array<{ attacker: string; target: string }>;
  /** DON!! anexados no turno. */
  donAttached: number;
  /** DON!! ativo que sobrou ao encerrar. */
  donLeft: number;
}

export interface TurnRecord {
  match: number;
  seat: PlayerId;
  player: string | null;
  queue: string;
  turn: number;
  life: number;
  oppLife: number;
  hand: number;
  oppHand: number;
  don: number;
  human: TurnSummary;
  /** O turno que o bot jogaria a partir da mesma posição inicial (o oponente não bloqueia nem usa Counter). */
  bot?: TurnSummary;
  won: boolean;
}

export interface MatchExtraction {
  records: DecisionRecord[];
  turns: TurnRecord[];
  /** Por que a partida foi pulada (replay ilegível ou que não refaz). */
  error?: string;
}

/** O +poder que uma carta da mão dá como Counter (impresso, ou o de um Evento [Counter] pagável com `don`). */
function counterPower(state: GameState, uid: string, don: number): number {
  const def = state.defs[state.cards[uid].cardId];
  if (def.category === 'event') {
    const ab = def.abilities.find((a) => a.timing === 'counter');
    if (!ab || playCost(state, uid) > don) return 0;
    return ab.steps.reduce((sum, st) => sum + (st.do === 'power' && st.amount > 0 ? st.amount : 0), 0);
  }
  return counterValue(state, uid);
}

const EMPTY_TURN = (): TurnSummary => ({ played: [], attacks: [], donAttached: 0, donLeft: 0 });

/** Acumula uma ação da fase principal no resumo do turno. */
function noteTurnAction(state: GameState, a: Action, t: TurnSummary) {
  const id = (uid: string) => state.cards[uid]?.cardId ?? uid;
  if (a.type === 'playCard') t.played.push(id(a.uid));
  else if (a.type === 'attack') t.attacks.push({ attacker: id(a.attacker), target: id(a.target) });
  else if (a.type === 'attachDon') t.donAttached++;
  else if (a.type === 'detachDon') t.donAttached--;
  else if (a.type === 'endTurn') t.donLeft = state.players[a.player].donActive;
}

/**
 * O turno que o bot jogaria a partir de `state` (início da fase principal de `player`): as perguntas ao
 * oponente são respondidas como na simulação do planejador (não bloqueia, não usa Counter, Vida para a mão).
 */
function botTurn(state: GameState, player: PlayerId, aliases: ReturnType<typeof identityAliases>, opts: ExtractOptions): TurnSummary {
  const t = EMPTY_TURN();
  let s = state;
  for (let i = 0; i < 80 && s.phase !== 'gameover'; i++) {
    const p = s.pending?.player ?? s.activePlayer;
    let a: Action;
    if (p !== player) {
      const pd = s.pending!;
      a =
        pd.kind === 'block' ? { type: 'choose', player: p, uids: [] }
        : pd.kind === 'counter' ? { type: 'pass', player: p }
        : pd.kind === 'lifeCard' ? { type: 'answer', player: p, yes: false }
        : chooseSimpleBotAction(s, p);
    } else {
      const fromBot = actionFromView(s, aliases, chooseBotAction(viewFor(s, player, aliases), player, opts.bot!, { timeBudgetMs: opts.budgetMs ?? 250, random: () => 0.5 }));
      if (typeof fromBot === 'string') break;
      a = fromBot;
      if (!s.pending) noteTurnAction(s, a, t);
    }
    try {
      s = applyAction(s, a);
    } catch {
      break;
    }
    if (a.type === 'endTurn' && a.player === player) break;
  }
  return t;
}

/** Refaz uma partida e devolve as decisões dos lados humanos. */
export function extractMatch(db: DB, matchId: number, opts: ExtractOptions = {}): MatchExtraction {
  const m = db.prepare('SELECT id, mode, format, queue, replay FROM matches WHERE id = ?').get(matchId) as MatchRow | undefined;
  if (!m?.replay) return { records: [], turns: [], error: 'sem replay' };
  let stored: StoredReplay;
  try {
    stored = JSON.parse(m.replay) as StoredReplay;
  } catch {
    return { records: [], turns: [], error: 'replay ilegível' };
  }
  const seats = seatsOf(db, matchId);
  const humans = seats.filter((s) => s.controller === 'human');
  if (!humans.length) return { records: [], turns: [] };

  const ids = [...new Set(stored.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
  const cards = pinEngineTexts(getCards(db, ids) as CardData[], stored.engineTexts);
  const config: GameConfig = {
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
  // Partidas do navegador gravadas antes de o replay guardar a versão: refeitas como atuais, param na primeira
  // pergunta que o motor passou a fazer depois. Nesse caso, a segunda tentativa passa as ações pelo
  // `upgradeReplayActions` (que insere as respostas que o motor antigo dava sozinho).
  const version = stored.version ?? (stored.legacySetup ? 8 : REPLAY_VERSION);
  const attempts: Array<{ config: GameConfig; actions: Action[] }> = [];
  try {
    if (version < REPLAY_VERSION) {
      const c = replayConfig(config, version);
      attempts.push({ config: c, actions: upgradeReplayActions(c, stored.actions) });
    } else {
      attempts.push({ config, actions: stored.actions });
      if (stored.version === undefined) attempts.push({ config, actions: upgradeReplayActions(config, stored.actions) });
    }
  } catch (e) {
    return { records: [], turns: [], error: `replay da versão ${version} não refaz: ${e instanceof Error ? e.message : String(e)}` };
  }
  let last: MatchExtraction = { records: [], turns: [], error: 'sem tentativa' };
  for (const attempt of attempts) {
    last = replayMatch(matchId, m, attempt.config, attempt.actions, humans, opts);
    if (!last.error) return last;
  }
  return last;
}

function replayMatch(matchId: number, m: MatchRow, config: GameConfig, actions: Action[], humans: SeatRow[], opts: ExtractOptions): MatchExtraction {
  const records: DecisionRecord[] = [];
  const turns: TurnRecord[] = [];
  let state: GameState;
  try {
    state = createGame(config);
  } catch (e) {
    return { records: [], turns: [], error: e instanceof Error ? e.message : String(e) };
  }
  resetPlanner();
  const aliases = identityAliases(state);
  const bySeat = new Map(humans.map((s) => [s.seat, s]));
  /** O turno em andamento de um lado humano (fase principal), até o `endTurn`. */
  let current: TurnRecord | null = null;
  try {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (state.phase === 'gameover') break;
      const seat = bySeat.get(a.player);
      const kind = seat && !NOT_DECISIONS.has(a.type) ? decisionKind(state, a.player) : null;
      if (seat && kind === 'main' && !state.pending && state.turn > 2) {
        if (!current || current.turn !== state.turn || current.seat !== a.player) {
          const me = state.players[a.player];
          const opp = state.players[a.player === 0 ? 1 : 0];
          const rec: TurnRecord = {
            match: matchId,
            seat: a.player,
            player: seat.player_id,
            queue: m.queue ?? 'casual',
            turn: state.turn,
            life: me.life.length,
            oppLife: opp.life.length,
            hand: me.hand.length,
            oppHand: opp.hand.length,
            don: me.donActive,
            human: EMPTY_TURN(),
            won: Boolean(seat.won),
          };
          if (opts.bot) rec.bot = botTurn(state, a.player, aliases, opts);
          current = rec;
          turns.push(rec);
        }
        noteTurnAction(state, a, current.human);
      }
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
        const userId = rec.user;
        if (userId && opts.placements?.has(userId)) rec.placement = opts.placements.get(userId);
        if (kind === 'mulligan') {
          const o = { le2: 0, c3: 0, c4: 0, ge5: 0, events: 0, counter: 0 };
          for (const uid of me.hand) {
            const def = state.defs[state.cards[uid].cardId];
            o.counter += (def.counter ?? 0) / 1000;
            if (def.category === 'event') o.events++;
            else if (def.category === 'character') {
              const cost = def.cost ?? 0;
              if (cost <= 2) o.le2++;
              else if (cost === 3) o.c3++;
              else if (cost === 4) o.c4++;
              else o.ge5++;
            }
          }
          rec.opening = o;
        }
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
        if (kind === 'counter') {
          rec.counters = me.hand.reduce((sum, uid) => sum + counterPower(state, uid, me.donActive), 0);
          if (a.type === 'counter') {
            rec.chosenValue = counterPower(state, a.uid, me.donActive);
            const def = state.defs[state.cards[a.uid].cardId];
            rec.chosenCost = def.cost ?? 0;
            rec.chosenCategory = def.category;
            const field = me.donActive + me.donRested + me.leader.don + me.characters.reduce((n, c) => n + c.don, 0) + (me.stage?.don ?? 0);
            rec.donNext = Math.min(10, field + Math.min(2, me.donDeck));
          }
        }
        opts.onDecision?.(state, a, rec);
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
    return { records, turns, error: `ação ${records.length ? records[records.length - 1].index + 1 : 0} recusada: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { records, turns };
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
  /** Counter no Líder só quando a mão bastava para parar o ataque: a vontade, separada da capacidade. */
  leaderCounterAble: Record<string, { n: number; human: number; bot: number; botCompared: number }>;
  /**
   * Ataque fatal ao Líder (0 de Vida): quantos a mão podia parar, quantos o humano e o bot pararam, e
   * quantas vezes o humano gastou Counter sem ter como parar.
   */
  lethal: { n: number; able: number; humanStopped: number; botStopped: number; botCompared: number; humanWasted: number };
  /** Posições em que a mão parava o ataque fatal, o humano usou Counter e o bot passaria (até 30). */
  lethalMisses: Array<{ match: number; index: number; need: number; counters: number; hand: number; don: number; card: string; attacker: string; attackerPower: number }>;
  /** Turnos inteiros (fase principal): o que o humano fez e o que o bot faria da mesma posição. */
  turns: TurnStats | null;
  /** Mulligan por número de Personagens de custo ≤ 3 na mão inicial: quantos trocaram (humano e bot). */
  mulligan: Record<string, { n: number; human: number; bot: number; botCompared: number }>;
  /**
   * Counters usados pelo humano no Líder, por faixa de Vida: o tipo da carta e se ela caberia no DON!! do
   * próximo turno (Personagem que custa mais que isso é carta que não seria jogada tão cedo).
   */
  counterCards: Record<string, { n: number; event: number; character: number; aboveNext: number; costSum: number }>;
  /** Quem começa: quantas vezes escolheram jogar primeiro (humano e bot). */
  chooseFirst: { n: number; human: number; bot: number; botCompared: number };
}

export interface TurnStats {
  n: number;
  /** Médias por turno: cartas jogadas, ataques, DON!! anexados e DON!! que sobrou. */
  human: { played: number; attacks: number; donAttached: number; donLeft: number };
  bot: { played: number; attacks: number; donAttached: number; donLeft: number };
  /** Em quantos turnos o humano jogou mais cartas que o bot, e em quantos atacou mais. */
  humanPlayedMore: number;
  botPlayedMore: number;
  humanAttackedMore: number;
  botAttackedMore: number;
  /** O mesmo, só com o oponente em 2 de Vida ou menos (quando "pressionar" é a pergunta). */
  lowLife: { n: number; humanPlayedMore: number; botPlayedMore: number; humanAttackedMore: number; botAttackedMore: number };
}

const bump = <T extends Record<string, number>>(table: Record<string, T>, key: string, blank: T, f: (row: T) => void) => {
  const row = (table[key] ??= { ...blank });
  f(row);
};

export function summarize(records: DecisionRecord[], matches: number, failed: number, turns: TurnRecord[] = []): Summary {
  const s: Summary = {
    matches,
    failed,
    decisions: records.length,
    kinds: {},
    leaderDefense: {},
    counterByNeed: {},
    mainDisagreements: [],
    leaderCounterAble: {},
    lethal: { n: 0, able: 0, humanStopped: 0, botStopped: 0, botCompared: 0, humanWasted: 0 },
    lethalMisses: [],
    turns: null,
    mulligan: {},
    counterCards: {},
    chooseFirst: { n: 0, human: 0, bot: 0, botCompared: 0 },
  };
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
      if (r.kind === 'counter') {
        bump(s.counterByNeed, `+${Math.min(4, r.battle.need / 1000)}000`, { n: 0, human: 0, bot: 0, botCompared: 0 }, add);
        const able = (r.counters ?? 0) >= r.battle.need;
        if (able) bump(s.leaderCounterAble, `vida${Math.min(5, r.life)}`, { n: 0, human: 0, bot: 0, botCompared: 0 }, add);
        if (r.life === 0) {
          const L = s.lethal;
          L.n++;
          if (able) L.able++;
          if (!able && r.chosen.type === 'counter') L.humanWasted++;
          if (able && r.chosen.type === 'counter') L.humanStopped++;
          if (r.bot) {
            L.botCompared++;
            if (able && r.bot.type === 'counter') L.botStopped++;
            if (able && r.chosen.type === 'counter' && r.bot.type === 'pass' && s.lethalMisses.length < 30) {
              s.lethalMisses.push({
                match: r.match,
                index: r.index,
                need: r.battle.need,
                counters: r.counters ?? 0,
                hand: r.hand,
                don: r.don,
                card: r.chosen.card ?? '?',
                attacker: r.battle.attacker,
                attackerPower: r.battle.attackerPower,
              });
            }
          }
        }
      }
    }
    if (r.kind === 'mulligan' && r.opening) {
      const low = Math.min(3, r.opening.le2 + r.opening.c3);
      bump(s.mulligan, `${low}${low === 3 ? '+' : ''}`, { n: 0, human: 0, bot: 0, botCompared: 0 }, (row) => {
        row.n++;
        if (r.chosen.redraw) row.human++;
        if (r.bot) {
          row.botCompared++;
          if (r.bot.redraw) row.bot++;
        }
      });
    }
    if (r.kind === 'chooseFirst') {
      const c = s.chooseFirst;
      c.n++;
      if (r.chosen.yes) c.human++;
      if (r.bot) {
        c.botCompared++;
        if (r.bot.yes) c.bot++;
      }
    }
    if (r.kind === 'counter' && r.chosen.type === 'counter' && r.battle?.targetIsLeader && r.chosenCategory) {
      bump(s.counterCards, r.life >= 4 ? 'vida4-5' : r.life >= 2 ? 'vida2-3' : 'vida0-1', { n: 0, event: 0, character: 0, aboveNext: 0, costSum: 0 }, (row) => {
        row.n++;
        row.costSum += r.chosenCost ?? 0;
        if (r.chosenCategory === 'event') row.event++;
        if (r.chosenCategory === 'character') {
          row.character++;
          if ((r.chosenCost ?? 0) > (r.donNext ?? 10)) row.aboveNext++;
        }
      });
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
  const compared = turns.filter((t) => t.bot);
  if (compared.length) {
    const avg = (f: (t: TurnSummary) => number, side: 'human' | 'bot') => compared.reduce((sum, t) => sum + f(t[side]!), 0) / compared.length;
    const means = (side: 'human' | 'bot') => ({
      played: avg((t) => t.played.length, side),
      attacks: avg((t) => t.attacks.length, side),
      donAttached: avg((t) => t.donAttached, side),
      donLeft: avg((t) => t.donLeft, side),
    });
    const count = (list: TurnRecord[]) => ({
      n: list.length,
      humanPlayedMore: list.filter((t) => t.human.played.length > t.bot!.played.length).length,
      botPlayedMore: list.filter((t) => t.human.played.length < t.bot!.played.length).length,
      humanAttackedMore: list.filter((t) => t.human.attacks.length > t.bot!.attacks.length).length,
      botAttackedMore: list.filter((t) => t.human.attacks.length < t.bot!.attacks.length).length,
    });
    s.turns = { human: means('human'), bot: means('bot'), ...count(compared), lowLife: count(compared.filter((t) => t.oppLife <= 2)) };
  }
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
  const able = Object.entries(s.leaderCounterAble).sort();
  if (able.length) {
    out.push('');
    out.push('Counter no Líder quando a mão bastava para parar o ataque (a vontade, sem a capacidade):');
    for (const [k, row] of able) out.push(`  ${k.padEnd(14)} ${String(row.n).padStart(6)}   humano ${pct(row.human, row.n)}   bot ${pct(row.bot, row.botCompared)}`);
  }
  if (s.lethal.n) {
    const L = s.lethal;
    out.push('');
    out.push(`Ataque fatal ao Líder: ${L.n} | a mão parava ${L.able} | humano parou ${pct(L.humanStopped, L.able)} | bot pararia ${pct(L.botStopped, L.botCompared ? L.able : 0)} | humano gastou Counter sem ter como parar: ${L.humanWasted}`);
    if (s.lethalMisses.length) {
      out.push('  Parava, o humano segurou e o bot passaria (partida, ação, precisa, mão dava, mão, DON!!, carta usada, atacante):');
      for (const x of s.lethalMisses) out.push(`    ${x.match} ${x.index}  +${x.need} de ${x.counters} | ${x.hand} cartas, ${x.don} DON!! | ${x.card} | ${x.attacker} ${x.attackerPower}`);
    }
  }
  const cards = Object.entries(s.counterCards).sort();
  if (cards.length) {
    out.push('');
    out.push('Counters usados pelo humano no Líder (carta usada): Evento / Personagem / Personagem acima do DON!! do próximo turno / custo médio:');
    for (const [k, row] of cards)
      out.push(`  ${k.padEnd(14)} ${String(row.n).padStart(6)}   ${pct(row.event, row.n)} / ${pct(row.character, row.n)} / ${pct(row.aboveNext, row.character)} / ${(row.costSum / row.n).toFixed(1)}`);
  }
  const mull = Object.entries(s.mulligan).sort();
  if (mull.length) {
    out.push('');
    out.push('Mulligan por Personagens de custo ≤ 3 na mão inicial: quem trocou a mão, humano x bot:');
    for (const [k, row] of mull) out.push(`  ${`${k} baratos`.padEnd(14)} ${String(row.n).padStart(6)}   humano ${pct(row.human, row.n)}   bot ${pct(row.bot, row.botCompared)}`);
  }
  if (s.chooseFirst.n) {
    const c = s.chooseFirst;
    out.push('');
    out.push(`Quem começa (${c.n} escolhas): escolheu jogar primeiro, humano ${pct(c.human, c.n)}   bot ${pct(c.bot, c.botCompared)}`);
  }
  if (s.mainDisagreements.length) {
    out.push('');
    out.push('Fase principal, quando discordam (humano → bot):');
    for (const d of s.mainDisagreements) out.push(`  ${d.human.padEnd(10)} → ${d.bot.padEnd(28)} ${String(d.n).padStart(6)}`);
  }
  if (s.turns) {
    const t = s.turns;
    const f = (x: number) => x.toFixed(2);
    out.push('');
    out.push(`Turnos inteiros (${t.n}; médias por turno: cartas jogadas / ataques / DON!! anexados / DON!! que sobrou):`);
    out.push(`  humano  ${f(t.human.played)} / ${f(t.human.attacks)} / ${f(t.human.donAttached)} / ${f(t.human.donLeft)}`);
    out.push(`  bot     ${f(t.bot.played)} / ${f(t.bot.attacks)} / ${f(t.bot.donAttached)} / ${f(t.bot.donLeft)}`);
    out.push(`  humano jogou mais cartas em ${pct(t.humanPlayedMore, t.n)} dos turnos, menos em ${pct(t.botPlayedMore, t.n)}; atacou mais em ${pct(t.humanAttackedMore, t.n)}, menos em ${pct(t.botAttackedMore, t.n)}`);
    const l = t.lowLife;
    if (l.n) out.push(`  com o oponente em 2 de Vida ou menos (${l.n}): jogou mais cartas em ${pct(l.humanPlayedMore, l.n)}, menos em ${pct(l.botPlayedMore, l.n)}; atacou mais em ${pct(l.humanAttackedMore, l.n)}, menos em ${pct(l.botAttackedMore, l.n)}`);
  }
  return out.join('\n');
}
