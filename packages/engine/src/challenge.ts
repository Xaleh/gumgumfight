// Desafio do dia: um cenário pronto (`scenario.ts`) com um objetivo, jogado contra um oponente de regras fixas
// e conhecidas (sem sorteio nem bot), para que o servidor refaça a tentativa e confira o resultado sempre igual.
//
//   lethal   é o seu turno: derrote o oponente antes de passar a vez.
//   survive  é o turno do oponente: ele ataca na ordem do roteiro; chegue vivo ao seu turno.
//
// O oponente que defende bloqueia e usa Counter da mão só quando isso segura um ataque ao Líder dele, e nunca
// ativa [Trigger]. O que ataca segue o roteiro (o primeiro ataque da lista que ainda é legal) e então passa a vez.

import { actingPlayer, legalActions } from './actions';
import { applyAction, counterValue, getPower, opponent } from './engine';
import { createScenario, passiveAction, type ScenarioSpec } from './scenario';
import type { Action, GameConfig, GameState, PlayerId } from './types';

/** Quem resolve o desafio é sempre o jogador 0; o oponente é o 1. */
export const SOLVER: PlayerId = 0;
const RIVAL: PlayerId = 1;

export type ChallengeGoal = 'lethal' | 'survive';

/** Um ataque do roteiro: o atacante e o alvo pelo número da carta ('leader' = o Líder). */
export interface ScriptedAttack {
  attacker: string;
  target: string;
}

export interface ChallengeSpec {
  /** Id estável do desafio no catálogo (letras, números e hífen). */
  id: string;
  goal: ChallengeGoal;
  /** Decks prontos de cada lado (ids de `data/decks`): o jogador 0 resolve, o 1 é o oponente. */
  decks: [string, string];
  /** Semente da partida (a ordem do resto do deck). */
  seed: number;
  /** A mesa. O lado ativo tem que combinar com o objetivo (0 em `lethal`, 1 em `survive`). */
  scenario: ScenarioSpec;
  /** `survive`: a ordem dos ataques do oponente. */
  attacks?: ScriptedAttack[];
  /** A mão do oponente faz parte do enunciado (aparece para quem joga). Padrão: escondida. */
  revealHand?: boolean;
  /** Dificuldade, de 1 a 3 (só para mostrar). */
  level?: 1 | 2 | 3;
}

export type ChallengeStatus = 'playing' | 'solved' | 'failed';

/** Monta a mesa do desafio. */
export function buildChallenge(config: GameConfig, spec: ChallengeSpec): GameState {
  const wanted: PlayerId = spec.goal === 'lethal' ? SOLVER : RIVAL;
  if (spec.scenario.active !== wanted) throw new Error(`${spec.id}: em "${spec.goal}" o turno é do jogador ${wanted}`);
  if (spec.goal === 'survive' && !spec.attacks?.length) throw new Error(`${spec.id}: "survive" precisa do roteiro de ataques`);
  return createScenario({ ...config, seed: spec.seed }, spec.scenario);
}

/** Situação do desafio (`turn` = o turno em que ele começou). */
export function challengeStatus(state: GameState, spec: ChallengeSpec, turn: number): ChallengeStatus {
  if (state.phase === 'gameover') return state.winner === SOLVER ? 'solved' : 'failed';
  if (state.turn === turn) return 'playing';
  // O turno acabou: no letal, passou a vez sem vencer; no "sobreviva", chegou vivo ao próprio turno.
  return spec.goal === 'lethal' ? 'failed' : 'solved';
}

const leaderOf = (s: GameState, p: PlayerId) => s.players[p].leader.uid;
const cardIdOf = (s: GameState, uid: string) => s.cards[uid]?.cardId;
const matches = (s: GameState, p: PlayerId, uid: string, ref: string) => (ref === 'leader' ? uid === leaderOf(s, p) : cardIdOf(s, uid) === ref);

/** O ataque em andamento acerta o Líder do defensor se ninguém fizer nada? */
function leaderUnderFire(s: GameState, defender: PlayerId): boolean {
  const b = s.battle;
  return Boolean(b && b.target === leaderOf(s, defender) && getPower(s, b.attacker) >= getPower(s, b.target));
}

/** Defesa do oponente: bloqueia e usa Counter só para segurar um ataque ao Líder; nunca ativa [Trigger]. */
function defend(s: GameState, legal: Action[]): Action | null {
  const p = s.pending;
  if (!p || p.player !== RIVAL) return null;
  if (p.kind === 'block') {
    const block = leaderUnderFire(s, RIVAL) ? legal.find((a) => a.type === 'choose' && a.uids.length === 1) : undefined;
    return block ?? legal.find((a) => a.type === 'choose' && a.uids.length === 0) ?? passiveAction(s, RIVAL);
  }
  if (p.kind === 'counter') {
    const pass = legal.find((a) => a.type === 'pass') ?? null;
    const b = s.battle;
    if (!b || !leaderUnderFire(s, RIVAL)) return pass;
    // Só o valor de Counter dos Personagens da mão (sem Eventos): do maior para o menor, e só se der para segurar.
    const counters = legal
      .filter((a): a is Extract<Action, { type: 'counter' }> => a.type === 'counter' && a.target === undefined && counterValue(s, a.uid) > 0)
      .sort((x, y) => counterValue(s, y.uid) - counterValue(s, x.uid) || x.uid.localeCompare(y.uid));
    const missing = getPower(s, b.attacker) - getPower(s, b.target) + 1;
    const total = counters.reduce((n, a) => n + counterValue(s, a.uid), 0);
    return total >= missing && counters.length ? counters[0] : pass;
  }
  if (p.kind === 'lifeCard') return legal.find((a) => a.type === 'answer' && !a.yes) ?? passiveAction(s, RIVAL);
  return passiveAction(s, RIVAL);
}

/** Turno do oponente no "sobreviva": o primeiro ataque do roteiro que ainda é legal; sem nenhum, passa a vez. */
function attack(s: GameState, spec: ChallengeSpec, legal: Action[]): Action | null {
  if (s.pending) return passiveAction(s, RIVAL);
  for (const plan of spec.attacks ?? []) {
    const found = legal.find(
      (a) => a.type === 'attack' && matches(s, RIVAL, a.attacker, plan.attacker) && matches(s, SOLVER, a.target, plan.target),
    );
    if (found) return found;
  }
  return legal.find((a) => a.type === 'endTurn') ?? null;
}

/** Jogada do oponente agora (`null` = não é a vez dele). */
export function challengeRivalAction(s: GameState, spec: ChallengeSpec): Action | null {
  if (actingPlayer(s) !== RIVAL) return null;
  const legal = legalActions(s, RIVAL).filter((a) => a.type !== 'cancel' && a.type !== 'concede');
  if (s.pending && s.pending.player === RIVAL && s.activePlayer === SOLVER) return defend(s, legal);
  return attack(s, spec, legal);
}

/** Ações do jogador que o desafio aceita (as ferramentas manuais e a desistência ficam de fora). */
const ALLOWED = new Set<Action['type']>(['playCard', 'attachDon', 'detachDon', 'cancel', 'activate', 'attack', 'endTurn', 'choose', 'answer', 'counter', 'pass', 'option']);

export interface ChallengeRun {
  state: GameState;
  status: ChallengeStatus;
  /** Ações do jogador aplicadas (as que vêm depois do fim do desafio são ignoradas). */
  applied: number;
  /** Jogada recusada (o índice e o motivo); as anteriores valem. */
  error?: { index: number; message: string };
}

/** Limite de jogadas do oponente seguidas (proteção contra laço). */
const RIVAL_GUARD = 200;

/**
 * Refaz o desafio: aplica as ações do jogador na ordem e, entre elas, as do oponente. `translate` traduz cada
 * ação recebida para os uids reais na mesa daquele momento (ex.: `actionFromView`); devolve texto quando a
 * ação não vale. Para quando o desafio termina, quando as ações acabam ou na primeira ação recusada.
 */
export function runChallenge(
  start: GameState,
  spec: ChallengeSpec,
  actions: Action[],
  translate: (state: GameState, action: Action) => Action | string = (_s, a) => a,
): ChallengeRun {
  const turn = start.turn;
  let s = start;
  let applied = 0;
  const settle = () => {
    for (let guard = 0; guard < RIVAL_GUARD && challengeStatus(s, spec, turn) === 'playing'; guard++) {
      const a = challengeRivalAction(s, spec);
      if (!a) return;
      s = applyAction(s, a);
    }
  };
  settle();
  for (const raw of actions) {
    if (challengeStatus(s, spec, turn) !== 'playing') break;
    const fail = (message: string): ChallengeRun => ({ state: s, status: challengeStatus(s, spec, turn), applied, error: { index: applied, message } });
    if (!raw || typeof raw !== 'object' || !ALLOWED.has(raw.type) || raw.player !== SOLVER) return fail('Jogada não permitida no desafio.');
    if (actingPlayer(s) !== SOLVER) return fail('Não é a sua vez.');
    const a = translate(s, raw);
    if (typeof a === 'string') return fail(a);
    try {
      s = applyAction(s, a);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    applied++;
    settle();
  }
  return { state: s, status: challengeStatus(s, spec, turn), applied };
}

// ------------------------------------------------------------------ jogadas por número de carta

/**
 * Jogada escrita pelo número da carta, para guardar a solução de um desafio sem depender dos uids
 * ('leader' = o Líder). Só os testes e a conferência do catálogo usam; nunca vai para o navegador.
 */
export type ChallengeMove =
  | { play: string }
  | { don: string; n?: number }
  | { attack: string; target: string }
  | { activate: string; ability?: number }
  | { block: string | null }
  | { counter: string }
  | { choose: string[] }
  | { answer: boolean }
  | 'pass'
  | 'end';

/** Traduz uma jogada escrita para as ações do jogador na mesa `s` (lança erro se a carta não estiver lá). */
export function resolveMove(s: GameState, move: ChallengeMove): Action[] {
  const me = s.players[SOLVER];
  const mine = [me.leader.uid, ...me.characters.map((c) => c.uid), ...(me.stage ? [me.stage.uid] : [])];
  const find = (ref: string, pool: string[], owner: PlayerId = SOLVER) => {
    const uid = pool.find((u) => matches(s, owner, u, ref));
    if (!uid) throw new Error(`${ref}: carta não encontrada`);
    return uid;
  };
  const player = SOLVER;
  if (move === 'pass') return [{ type: 'pass', player }];
  if (move === 'end') return [{ type: 'endTurn', player }];
  if ('play' in move) return [{ type: 'playCard', player, uid: find(move.play, me.hand) }];
  if ('don' in move) return Array.from({ length: move.n ?? 1 }, () => ({ type: 'attachDon', player, target: find(move.don, mine) }));
  if ('attack' in move) {
    const theirs = [s.players[RIVAL].leader.uid, ...s.players[RIVAL].characters.map((c) => c.uid)];
    return [{ type: 'attack', player, attacker: find(move.attack, mine), target: find(move.target, theirs, RIVAL) }];
  }
  if ('activate' in move) return [{ type: 'activate', player, uid: find(move.activate, mine), ability: move.ability ?? 0 }];
  if ('block' in move) return [{ type: 'choose', player, uids: move.block ? [find(move.block, mine)] : [] }];
  if ('counter' in move) return [{ type: 'counter', player, uid: find(move.counter, me.hand) }];
  if ('choose' in move) {
    const p = s.pending;
    const left = p && 'options' in p && Array.isArray(p.options) ? [...p.options] : Object.keys(s.cards);
    const uids = move.choose.map((ref) => {
      const uid = left.find((u) => cardIdOf(s, u) === ref || (ref === 'leader' && u === me.leader.uid));
      if (!uid) throw new Error(`${ref}: opção não encontrada`);
      left.splice(left.indexOf(uid), 1);
      return uid;
    });
    return [{ type: 'choose', player, uids }];
  }
  return [{ type: 'answer', player, yes: move.answer }];
}

/** Joga a solução escrita do começo ao fim, com o oponente respondendo entre as jogadas. */
export function playMoves(start: GameState, spec: ChallengeSpec, moves: ChallengeMove[]): ChallengeRun {
  let run = runChallenge(start, spec, []);
  for (const m of moves) {
    if (run.status !== 'playing') break;
    const actions = resolveMove(run.state, m);
    const next = runChallenge(run.state, spec, actions);
    run = { ...next, applied: run.applied + next.applied, error: next.error && { ...next.error, index: run.applied + next.error.index } };
    if (run.error) break;
  }
  return run;
}
