// Análise da partida (roadmap B1): cada decisão comparada com a melhor jogada do bot, pela visão de quem decidiu.

import { describe, expect, it } from 'vitest';
import { actingPlayer } from '../src/actions';
import { accuracyOf, AnalysisError, analyzeReplay, decisionIndexes, reviewDecision, severityOf, summarizeAnalysis } from '../src/bot/analysis';
import { chooseBotAction as simpleBot } from '../src/bot/simple';
import { buildCardDef } from '../src/cards';
import { applyAction, cardDef } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/types';
import { cards, fetchToHand, kid, luffy, started, toTurn } from './helpers';

/** Busca sem teto de tempo na prática (os testes não podem depender da máquina). */
const SLOW = { timeBudgetMs: 60_000 };

function clearHand(s: GameState, p: PlayerId) {
  s.players[p].deck.push(...s.players[p].hand);
  s.players[p].hand = [];
}

/** Turno `turn` do jogador 0 com a mão devolvida ao fundo do deck. */
function position(decks: [typeof kid, typeof luffy], turn: number, seed = 1): GameState {
  const s = toTurn(started(seed, decks), turn);
  clearHand(s, 0);
  return s;
}

let injected = 0;
/** Cria uma carta nova para `player` no campo ou na mão (mutação direta, só para testes). */
function inject(s: GameState, player: PlayerId, cardId: string, where: 'field' | 'hand', opts: { rested?: boolean } = {}): string {
  if (!s.defs[cardId]) s.defs[cardId] = buildCardDef(cards.find((c) => c.id === cardId)!);
  const uid = `x${++injected}`;
  s.cards[uid] = { uid, cardId, owner: player };
  if (where === 'hand') s.players[player].hand.push(uid);
  else s.players[player].characters.push({ uid, rested: Boolean(opts.rested), don: 0, playedOnTurn: 0 });
  return uid;
}

/** Jogador 0 (Kid) ataca o Líder do jogador 1 (Luffy) com o Líder: 5000 contra 5000. */
function leaderAttack(life: number, hand: string[]): GameState {
  const s = toTurn(started(1, [kid, luffy]), 3);
  s.players[1].life = s.players[1].life.slice(0, life);
  clearHand(s, 1);
  for (const id of hand) fetchToHand(s, 1, id);
  return applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
}

describe('análise da partida: decisões', () => {
  it('marca o letal perdido e sugere o ataque', () => {
    // Oponente com 0 de Vida e um Blocker: Líder e Zoro atacam, um leva o bloqueio e o outro vence. Encerrar o turno é o erro grave.
    const s = position([kid, luffy], 5);
    s.players[1].life = [];
    inject(s, 1, 'ST01-006', 'field'); // Chopper [Blocker]
    inject(s, 0, 'ST01-013', 'field'); // Zoro 5000
    const r = reviewDecision(s, 0, { type: 'endTurn', player: 0 }, SLOW)!;
    expect(r.kind).toBe('turn');
    expect(r.tag).toBe('lethal');
    expect(r.severity).toBe('blunder');
    expect(r.best.some((a) => a.type === 'attack')).toBe(true);
    expect(r.accuracy).toBeLessThan(10);
  });

  it('a jogada igual à do bot não perde nada', () => {
    const s = position([kid, luffy], 5);
    s.players[1].life = [];
    inject(s, 0, 'ST01-013', 'field');
    const first = reviewDecision(s, 0, { type: 'endTurn', player: 0 }, SLOW)!;
    const r = reviewDecision(s, 0, first.best[0], SLOW)!;
    expect(r.loss).toBe(0);
    expect(r.severity).toBe('good');
    expect(r.accuracy).toBe(100);
    expect(r.tag).toBeUndefined();
  });

  it('marca o Counter desperdiçado com 5 de Vida', () => {
    const s = leaderAttack(5, ['ST01-008', 'ST01-011']); // Robin (+1000), Brook (+2000)
    expect(s.pending?.kind).toBe('counter');
    const robin = s.players[1].hand.find((u) => cardDef(s, u).name === 'Nico Robin')!;
    const r = reviewDecision(s, 7, { type: 'counter', player: 1, uid: robin }, SLOW)!;
    expect(r.kind).toBe('pending');
    expect(r.pending).toBe('counter');
    expect(r.best[0].type).toBe('pass');
    expect(r.loss).toBeGreaterThan(0);
    if (r.severity !== 'good') expect(r.tag).toBe('wastedCounter');
  });

  it('marca o Counter que faltou com 1 de Vida', () => {
    const s = leaderAttack(1, ['ST01-008', 'ST01-011']);
    const r = reviewDecision(s, 7, { type: 'pass', player: 1 }, SLOW)!;
    expect(r.best[0].type).toBe('counter');
    expect(r.severity).not.toBe('good');
    expect(r.tag === 'missedCounter' || r.tag === 'lethal').toBe(true);
  });

  it('marca o alvo do ataque quando o Líder era o melhor alvo', () => {
    // Oponente com 0 de Vida: atacar o Personagem virado em vez do Líder (sem Blocker) deixa de vencer.
    const s = position([luffy, kid], 5);
    s.players[1].life = [];
    clearHand(s, 1);
    s.players[0].donActive = 0;
    const robin = inject(s, 1, 'ST01-008', 'field', { rested: true });
    const leader = s.players[0].leader.uid;
    const r = reviewDecision(s, 0, { type: 'attack', player: 0, attacker: leader, target: robin }, SLOW)!;
    expect(r.severity).toBe('blunder');
    // O letal perdido é o mais grave (e o que o marcador diz); o ataque sugerido é no Líder.
    expect(r.tag).toBe('lethal');
    expect(r.best.find((a) => a.type === 'attack')).toMatchObject({ attacker: leader, target: s.players[1].leader.uid });
  });

  it('só usa o que o jogador sabia: a mão escondida do oponente não muda a análise', () => {
    const base = () => {
      injected = 0;
      const s = position([kid, luffy], 5);
      s.players[0].donActive = 3;
      inject(s, 0, 'ST01-013', 'field');
      inject(s, 1, 'ST01-008', 'field', { rested: true });
      return s;
    };
    const a = base();
    const b = base();
    // Na cópia, a mão do oponente vira outras cartas (o jogador 0 não as vê).
    const other = ['ST01-011', 'ST01-014', 'ST01-006', 'ST01-010'];
    b.players[1].hand.forEach((u, i) => (b.cards[u] = { ...b.cards[u], cardId: other[i % other.length] }));
    const played: Action = { type: 'endTurn', player: 0 };
    const ra = reviewDecision(a, 3, played, SLOW)!;
    const rb = reviewDecision(b, 3, played, SLOW)!;
    expect(rb).toEqual(ra);
  });

  it('decisão sem escolha não entra', () => {
    const s = leaderAttack(5, []);
    // Sem Counter na mão, a etapa de Counter só tem "passar".
    if (s.pending?.kind === 'counter' && !s.pending.options.length) expect(reviewDecision(s, 0, { type: 'pass', player: 1 }, SLOW)).toBeNull();
    expect(reviewDecision(s, 0, { type: 'endTurn', player: 0 }, SLOW)).toBeNull();
  });
});

describe('análise da partida: régua e resumo', () => {
  it('gravidade e precisão pela perda', () => {
    expect(severityOf(0)).toBe('good');
    expect(severityOf(1500)).toBe('inaccuracy');
    expect(severityOf(4000)).toBe('mistake');
    expect(severityOf(10000)).toBe('blunder');
    expect(accuracyOf(0)).toBe(100);
    expect(accuracyOf(6000)).toBeCloseTo(36.8, 1);
    expect(accuracyOf(1e9)).toBe(accuracyOf(30000));
  });

  it('resume por jogador', () => {
    const base = { kind: 'turn' as const, turn: 3, played: { type: 'endTurn', player: 0 } as Action, best: [], bestScore: 0, playedScore: 0 };
    const a = summarizeAnalysis([
      { ...base, index: 1, player: 0, loss: 0, severity: 'good', accuracy: 100 },
      { ...base, index: 2, player: 0, loss: 12000, severity: 'blunder', tag: 'lethal', accuracy: 13.5 },
      { ...base, index: 3, player: 1, loss: 2000, severity: 'inaccuracy', tag: 'better', accuracy: 71.7 },
    ]);
    expect(a.players[0]).toEqual({ decisions: 2, accuracy: 56.8, inaccuracies: 0, mistakes: 0, blunders: 1, lethalsMissed: 1 });
    expect(a.players[1].inaccuracies).toBe(1);
    expect(a.marks.map((m) => m.index)).toEqual([2, 3]);
  });
});

describe('análise da partida: replay inteiro', () => {
  /** Partida rápida entre dois bots heurísticos, até o fim. */
  function playOut(seed: number): { initial: GameState; actions: Action[] } {
    const initial = started(seed, [luffy, kid]);
    let s = initial;
    const actions: Action[] = [];
    for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
      const a = simpleBot(s, actingPlayer(s)!);
      actions.push(a);
      s = applyAction(s, a);
    }
    expect(s.phase).toBe('gameover');
    return { initial, actions };
  }

  it('analisa as decisões com escolha e informa o progresso', () => {
    const { initial, actions } = playOut(3);
    const indexes = decisionIndexes(initial, actions, [0]);
    expect(indexes.length).toBeGreaterThan(3);
    const progress: number[] = [];
    const a = analyzeReplay(initial, actions, { players: [0], planner: { timeBudgetMs: 5, beamWidth: 2, maxDepth: 4 }, onProgress: (done) => progress.push(done) });
    expect(progress[progress.length - 1]).toBe(indexes.length);
    expect(a.reviews.length).toBeGreaterThan(0);
    expect(a.reviews.every((r) => r.player === 0 && indexes.includes(r.index))).toBe(true);
    expect(a.players[1].decisions).toBe(0);
    expect(a.players[0].accuracy).not.toBeNull();
  });

  it('recusa replay que não terminou', () => {
    const { initial, actions } = playOut(4);
    expect(() => analyzeReplay(initial, actions.slice(0, actions.length - 1))).toThrow(AnalysisError);
  });
});
