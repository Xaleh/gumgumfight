// Testes de posição do bot com busca (docs/bot-tempo.md): tabuleiro montado → jogada esperada.
// O bot decide pela visão (como no servidor); o oponente não bloqueia nem usa Counter.

import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { DEFAULT_WEIGHTS, evaluate } from '../src/bot/evaluate';
import { planAction, plannerOptions, resetPlanner } from '../src/bot/planner';
import { chooseBotAction as simpleBot } from '../src/bot/simple';
import { applyAction, cardDef } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/types';
import { buildCardDef } from '../src/cards';
import { actionFromView, identityAliases, viewFor } from '../src/view';
import { cards, fetchToHand, kid, luffy, started, toTurn } from './helpers';

/** Busca determinística e sem teto de tempo (os testes não podem depender da máquina). */
const OPTS = plannerOptions('hard', { random: () => 0.5, timeBudgetMs: 60_000 });

/** Jogada do bot pela visão dele, traduzida de volta para o estado completo. */
function botAction(s: GameState, p: PlayerId): Action {
  const aliases = identityAliases(s);
  const a = actionFromView(s, aliases, planAction(viewFor(s, p, aliases), p, OPTS));
  if (typeof a === 'string') throw new Error(a);
  return a;
}

/** O oponente (scriptado) não bloqueia, não usa Counter e põe a Vida na mão; outras perguntas, pelo bot heurístico. */
function opponentAnswer(s: GameState, p: PlayerId): Action {
  const pending = s.pending!;
  if (pending.kind === 'block') return { type: 'choose', player: p, uids: [] };
  if (pending.kind === 'counter') return { type: 'pass', player: p };
  if (pending.kind === 'lifeCard') return { type: 'answer', player: p, yes: false };
  return simpleBot(s, p);
}

/** Joga o turno inteiro do bot `p` (até o `endTurn` ou o fim da partida) e devolve o estado e as ações dele. */
function botTurn(s: GameState, p: PlayerId): { state: GameState; actions: Action[] } {
  resetPlanner();
  const actions: Action[] = [];
  for (let i = 0; i < 200 && s.phase !== 'gameover'; i++) {
    const acting = actingPlayer(s)!;
    if (acting !== p) {
      s = applyAction(s, opponentAnswer(s, acting));
      continue;
    }
    if (!s.pending && s.activePlayer !== p) break;
    const a = botAction(s, p);
    actions.push(a);
    s = applyAction(s, a);
    if (a.type === 'endTurn') break;
  }
  return { state: s, actions };
}

/** Uma decisão isolada do bot `p` (escolha pendente). */
function botDecision(s: GameState, p: PlayerId): Action {
  resetPlanner();
  expect(actingPlayer(s)).toBe(p);
  return botAction(s, p);
}

const names = (s: GameState, uids: string[]) => uids.map((u) => cardDef(s, u).name);
const inTrash = (s: GameState, p: PlayerId, cardId: string) => s.players[p].trash.some((u) => s.cards[u].cardId === cardId);

/** Turno `turn` do jogador 0 com a mão devolvida ao fundo do deck (as cartas de teste entram com `fetchToHand`/`inject`). */
function position(decks: [typeof kid, typeof luffy], turn: number, seed = 1): GameState {
  const s = toTurn(started(seed, decks), turn);
  clearHand(s, 0);
  return s;
}

function clearHand(s: GameState, p: PlayerId) {
  s.players[p].deck.push(...s.players[p].hand);
  s.players[p].hand = [];
}

let injected = 0;

/** Cria uma instância nova de `cardId` (de qualquer coleção carregada) para `player`, no campo ou na mão (mutação direta, só para testes). */
function inject(s: GameState, player: PlayerId, cardId: string, where: 'field' | 'hand', opts: { rested?: boolean; turn?: number } = {}): string {
  if (!s.defs[cardId]) {
    const data = cards.find((c) => c.id === cardId);
    if (!data) throw new Error(`${cardId} não carregada`);
    s.defs[cardId] = buildCardDef(data);
  }
  const uid = `x${++injected}`;
  s.cards[uid] = { uid, cardId, owner: player };
  if (where === 'hand') s.players[player].hand.push(uid);
  else s.players[player].characters.push({ uid, rested: Boolean(opts.rested), don: 0, playedOnTurn: opts.turn ?? 0 });
  return uid;
}

describe('bot com busca: fase principal', () => {
  it('vira o Personagem e o ataca', () => {
    // Kid x Luffy, turno 5 (5 DON!!): Straw Sword vira o Vito do oponente; o Líder (5000 + DON!!) o nocauteia.
    const s = position([kid, luffy], 5);
    fetchToHand(s, 0, 'ST02-017'); // Straw Sword: "Rest up to 1 of your opponent's Characters."
    inject(s, 1, 'ST02-002', 'field'); // Vito 5000 (ativo) no campo do oponente.
    const { state, actions } = botTurn(s, 0);
    expect(actions.some((a) => a.type === 'playCard' && cardDef(s, a.uid).name === 'Straw Sword')).toBe(true);
    expect(inTrash(state, 1, 'ST02-002'), 'Vito deveria ter sido nocauteado').toBe(true);
  });

  it('anexa DON!! e ataca no mesmo turno', () => {
    // 4 DON!! e nada na mão: o Líder (5000) precisa de 1 DON!! para nocautear o Franky (6000) virado.
    const s = position([kid, luffy], 7);
    s.players[0].donActive = 4;
    inject(s, 1, 'ST01-010', 'field', { rested: true }); // Franky 6000, custo 4
    const { state, actions } = botTurn(s, 0);
    expect(actions.filter((a) => a.type === 'attachDon').length).toBeGreaterThan(0);
    expect(inTrash(state, 1, 'ST01-010'), 'Franky deveria ter sido nocauteado').toBe(true);
  });

  it('não gasta DON!! em quem não pode atacar', () => {
    // Koby entrou neste turno (sem [Rush]): DON!! nele não serve para nada.
    const s = position([kid, luffy], 5);
    const koby = inject(s, 0, 'ST02-006', 'field', { turn: s.turn });
    const { actions } = botTurn(s, 0);
    expect(actions.some((a) => a.type === 'attachDon' && a.target === koby)).toBe(false);
  });

  it('guarda DON!! para Evento [Counter]', () => {
    // Luffy x Kid, 3 DON!! e Guard Point (custo 1) na mão: ataca com o Líder, mas fecha o turno com DON!! ativo.
    const s = position([luffy, kid], 3);
    fetchToHand(s, 0, 'ST01-014');
    const { state, actions } = botTurn(s, 0);
    expect(actions.some((a) => a.type === 'attack')).toBe(true);
    expect(state.players[0].donActive).toBeGreaterThanOrEqual(1);
    expect(state.players[0].hand.map((u) => s.cards[u].cardId)).toContain('ST01-014');
  });

  it('prefere K.O. de Personagem caro a dano no Líder com Vida alta', () => {
    // Franky (6000) ativo pode bater no Líder (5 de Vida) ou na Robin (5000, custo 3) virada.
    const s = position([luffy, kid], 5);
    const franky = inject(s, 0, 'ST01-010', 'field');
    const robin = inject(s, 1, 'ST01-008', 'field', { rested: true });
    s.players[0].donActive = 0;
    const { actions } = botTurn(s, 0);
    const attack = actions.find((a) => a.type === 'attack' && a.attacker === franky);
    expect(attack && attack.type === 'attack' ? attack.target : null).toBe(robin);
  });

  it('prefere a carta com efeito útil', () => {
    // 3 DON!!, Killer ([On Play] K.O. de Personagem virado de custo ≤ 3) e Vito (vanilla 5000) na mão. Do outro lado,
    // Robin (5000, custo 3) virada e um Chopper [Blocker] ativo: o Líder não a alcança (bloqueio), o Killer sim.
    const s = position([kid, luffy], 3);
    fetchToHand(s, 0, 'ST02-005');
    fetchToHand(s, 0, 'ST02-002');
    inject(s, 1, 'ST01-008', 'field', { rested: true });
    inject(s, 1, 'ST01-006', 'field');
    const { state, actions } = botTurn(s, 0);
    expect(names(s, actions.filter((a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard').map((a) => a.uid))).toContain('Killer');
    expect(inTrash(state, 1, 'ST01-008')).toBe(true);
  });

  it('conta com o Blocker do oponente', () => {
    // Oponente com 0 de Vida e um Chopper [Blocker] ativo; o bot tem Líder e Zoro ativos: um ataque leva o bloqueio, o outro vence.
    const s = position([kid, luffy], 5);
    s.players[1].life = [];
    inject(s, 1, 'ST01-006', 'field'); // Chopper, [Blocker]
    inject(s, 0, 'ST01-013', 'field'); // Zoro 5000
    const { state } = botTurn(s, 0);
    expect(state.phase).toBe('gameover');
    expect(state.winner).toBe(0);
  });
});

describe('bot com busca: defesa', () => {
  /** Jogador 0 (Kid) ataca o Líder do jogador 1 (Luffy, o bot) com o Líder: 5000 contra 5000. */
  function leaderAttack(life: number, hand: string[]): GameState {
    const s = toTurn(started(1, [kid, luffy]), 3);
    s.players[1].life = s.players[1].life.slice(0, life);
    clearHand(s, 1);
    for (const id of hand) fetchToHand(s, 1, id);
    return applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
  }

  it('com 5 de Vida deixa o ataque passar', () => {
    const s = leaderAttack(5, ['ST01-008', 'ST01-011']); // Robin (+1000), Brook (+2000)
    expect(s.pending?.kind).toBe('counter');
    expect(botDecision(s, 1).type).toBe('pass');
  });

  it('com 2 de Vida usa Counter', () => {
    const s = leaderAttack(2, ['ST01-008', 'ST01-011']);
    expect(s.pending?.kind).toBe('counter');
    const a = botDecision(s, 1);
    expect(a.type).toBe('counter');
    // Uma carta de +1000 basta (5000 contra 5000): não gasta o Brook (+2000).
    expect(a.type === 'counter' ? cardDef(s, a.uid).name : null).toBe('Nico Robin');
  });

  it('bloqueia com Vida baixa', () => {
    const s = toTurn(started(1, [kid, luffy]), 3);
    s.players[1].life = s.players[1].life.slice(0, 1);
    clearHand(s, 1);
    inject(s, 1, 'ST01-006', 'field'); // Chopper [Blocker]
    const t = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(t.pending?.kind).toBe('block');
    const a = botDecision(t, 1);
    expect(a.type === 'choose' ? names(t, a.uids) : null).toEqual(['Tony Tony.Chopper']);
  });

  it('Evento [Counter] com alvo: dá o poder a quem está sendo atacado', () => {
    // Luffy (bot, jogador 1) com Scalpel na mão e 1 DON!!; o Vito dele (5000) é atacado por um Franky (6000).
    const s = toTurn(started(1, [kid, luffy]), 5);
    clearHand(s, 1);
    inject(s, 1, 'ST02-015', 'hand'); // Scalpel (+2000)
    s.players[1].donActive = 1;
    const vito = inject(s, 1, 'ST02-002', 'field', { rested: true });
    const franky = inject(s, 0, 'ST01-010', 'field');
    let t = applyAction(s, { type: 'attack', player: 0, attacker: franky, target: vito });
    expect(t.pending?.kind).toBe('counter');
    const a = botDecision(t, 1);
    expect(a.type).toBe('counter');
    t = applyAction(t, a);
    expect(t.pending?.kind).toBe('selectTargets');
    const target = botDecision(t, 1);
    expect(target.type === 'choose' ? target.uids : null).toEqual([vito]);
  });
});

describe('avaliação', () => {
  const w = DEFAULT_WEIGHTS;

  it('carta na mão', () => {
    const s = started(1, [kid, luffy]);
    const before = evaluate(s, 0, w);
    fetchToHand(s, 0, 'ST02-002');
    expect(evaluate(s, 0, w)).toBeGreaterThan(before);
  });

  it('Blocker', () => {
    const a = started(1, [kid, luffy]);
    inject(a, 0, 'ST02-012', 'field'); // Bepo 3000, custo 1
    const b = started(1, [kid, luffy]);
    inject(b, 0, 'ST02-004', 'field'); // Bege 1000, custo 1, [Blocker]
    expect(evaluate(b, 0, w)).toBeGreaterThan(evaluate(a, 0, w) - 500);
  });

  it('Personagem virado exposto no turno do oponente', () => {
    const s = toTurn(started(1, [kid, luffy]), 2); // turno do jogador 1
    const active = structuredClone(s);
    inject(active, 0, 'ST02-002', 'field');
    const rested = structuredClone(s);
    inject(rested, 0, 'ST02-002', 'field', { rested: true });
    expect(evaluate(rested, 0, w)).toBeLessThan(evaluate(active, 0, w));
  });

  it('Vida côncava: a última vale mais que a primeira', () => {
    const s = started(1, [kid, luffy]);
    const full = evaluate(s, 0, w);
    s.players[0].life = s.players[0].life.slice(0, 4);
    const four = evaluate(s, 0, w);
    s.players[0].life = s.players[0].life.slice(0, 1);
    const one = evaluate(s, 0, w);
    s.players[0].life = [];
    const zero = evaluate(s, 0, w);
    expect(full - four).toBeLessThan(one - zero);
  });

  it('as ações legais continuam válidas depois de cada jogada do bot', () => {
    let s = toTurn(started(3, [kid, luffy]), 5);
    for (let i = 0; i < 40 && s.phase !== 'gameover'; i++) {
      const p = actingPlayer(s)!;
      const a: Action = p === 0 ? botAction(s, p) : s.pending ? opponentAnswer(s, p) : { type: 'endTurn', player: p };
      expect(legalActions(s, p).length).toBeGreaterThan(0);
      s = applyAction(s, a);
    }
  });
});
