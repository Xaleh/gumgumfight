// Ajuste dos pesos do bot por imitação (Fase 6 do card do bot, com dados de gente): guarda as posições em que
// jogadores humanos decidiram uma defesa (Counter, bloqueio), e procura os pesos que fazem o bot escolher o que
// eles escolheram, na mesma visão. Usa SPSA, como o ajuste por auto-jogo (`packages/engine/scripts/tune-weights.ts`),
// mas a nota de cada variação é a concordância com as pessoas, não a vitória contra outra versão do bot.
//
// Só os pesos que pesam na defesa entram: os degraus da própria Vida (`life`) e a ameaça do próximo ataque do
// oponente (`threatHit`, `lethal`). Eles quase não mudam o próprio turno do bot (a própria Vida só cai lá por
// efeito de carta, e a ameaça é zerada no planejamento: `defenseOrPlan`), então imitar a defesa não estraga o
// ataque. Os pesos da mão (`handCard*`) também mudariam quais cartas o bot joga, e ficam de fora.
//
// O resultado é um ponto de partida, não um veredito: confira no auto-jogo (`duel.ts`) e contra o humano fraco
// (`vs-human.ts`) antes de adotar (docs/bot-tempo.md, seção 11).

import { type Action, BOT_WEIGHTS, type BotLevel, type BotWeights, chooseBotAction, type GameState, identityAliases, type PlayerId, resetPlanner, viewFor } from '@gumgum/engine';
import type { DB } from '../db';
import { type Choice, type DecisionKind, describeAction, extractMatch } from './extract';

export interface Sample {
  /** A visão do jogador na hora da decisão (sem o histórico), a mesma com que o bot decide. */
  view: GameState;
  player: PlayerId;
  kind: DecisionKind;
  /** Vida do jogador e se o atacado era o Líder (para o resumo por Vida). */
  life: number;
  leader: boolean;
  human: Choice;
  match: number;
}

export interface CollectOptions {
  kinds: DecisionKind[];
  /** Teto de posições guardadas (cada uma ocupa ~100 KB de memória). */
  max: number;
  placements?: Map<string, number>;
  /** Só jogadores até esta colocação no torneio (com `placements`). */
  maxPlacement?: number;
}

/** Refaz as partidas e guarda as posições de defesa com mais de uma resposta legal. */
export function collectSamples(db: DB, matchIds: number[], opts: CollectOptions): { samples: Sample[]; failed: number } {
  const samples: Sample[] = [];
  let failed = 0;
  for (const id of matchIds) {
    if (samples.length >= opts.max) break;
    const r = extractMatch(db, id, {
      placements: opts.placements,
      onDecision: (state: GameState, action: Action, rec) => {
        if (samples.length >= opts.max || !opts.kinds.includes(rec.kind) || rec.legal < 2) return;
        if (opts.maxPlacement !== undefined && (rec.placement === undefined || rec.placement > opts.maxPlacement)) return;
        const view = viewFor(state, action.player, identityAliases(state));
        samples.push({
          view: { ...view, log: [], checkpoint: undefined },
          player: action.player,
          kind: rec.kind,
          life: rec.life,
          leader: Boolean(rec.battle?.targetIsLeader),
          human: rec.chosen,
          match: id,
        });
      },
    });
    if (r.error) failed++;
  }
  return { samples, failed };
}

/** O que o bot escolhe numa posição com estes pesos (determinístico, sem teto de tempo). */
export function botChoice(sample: Sample, weights: BotWeights, level: BotLevel): Choice | null {
  resetPlanner();
  try {
    return describeAction(sample.view, chooseBotAction(sample.view, sample.player, level, { weights, random: () => 0.5, timeBudgetMs: 1e9 }));
  } catch {
    return null;
  }
}

/** Fração das posições em que o bot escolhe o mesmo que o humano. */
export function agreement(samples: Sample[], weights: BotWeights, level: BotLevel): number {
  if (!samples.length) return 0;
  let same = 0;
  for (const s of samples) {
    const c = botChoice(s, weights, level);
    if (c && JSON.stringify(c) === JSON.stringify(s.human)) same++;
  }
  return same / samples.length;
}

/** A defesa (usou Counter / bloqueou) por Vida, só nos ataques ao Líder: humano e bot com estes pesos. */
export function defenseByLife(samples: Sample[], weights: BotWeights, level: BotLevel): Record<string, { n: number; human: number; bot: number }> {
  const out: Record<string, { n: number; human: number; bot: number }> = {};
  const defended = (kind: DecisionKind, c: Choice | null) => (kind === 'counter' ? c?.type === 'counter' : c?.type === 'choose' && (c.cards?.length ?? 0) > 0);
  for (const s of samples) {
    if (!s.leader) continue;
    const row = (out[`${s.kind}:vida${Math.min(5, s.life)}`] ??= { n: 0, human: 0, bot: 0 });
    row.n++;
    if (defended(s.kind, s.human)) row.human++;
    if (defended(s.kind, botChoice(s, weights, level))) row.bot++;
  }
  return out;
}

// ------------------------------------------------------------------ SPSA

/** Parâmetros ajustados, em escala log: os 5 degraus da própria Vida e a ameaça do próximo ataque. */
export type Theta = Record<string, number>;

export function initialTheta(w: BotWeights = BOT_WEIGHTS, withHand = false): Theta {
  const t: Theta = { threatHit: Math.log(w.threatHit), lethal: Math.log(w.lethal) };
  for (let i = 1; i <= 5; i++) t[`life${i}`] = Math.log(w.life[i] - w.life[i - 1]);
  // Opcional: o valor da carta da própria mão que o bot não vê (a que sai da Vida no ataque que ele deixa passar,
  // a comprada por efeito). Pesa em toda defesa ("deixar passar dá uma carta"), mas também nos efeitos de compra
  // do próprio turno: confira no auto-jogo com mais cuidado.
  if (withHand) t.handCard = Math.log(w.handCard);
  return t;
}

/** Os pesos completos para um θ (o resto fica como em `base`). */
export function weightsOf(t: Theta, base: BotWeights = BOT_WEIGHTS): BotWeights {
  const life = [0];
  for (let i = 1; i <= 5; i++) life.push(Math.round(life[i - 1] + Math.exp(t[`life${i}`])));
  return {
    ...base,
    life,
    lifeExtra: Math.round(Math.exp(t.life5)),
    threatHit: Math.round(Math.exp(t.threatHit)),
    lethal: Math.round(Math.exp(t.lethal)),
    ...(t.handCard !== undefined ? { handCard: Math.round(Math.exp(t.handCard)) } : {}),
  };
}

/** Só o que o ajuste muda (o json parcial que `duel.ts` e `vs-human.ts` aceitam). */
export function partialWeights(w: BotWeights, withHand = false): Partial<BotWeights> {
  return { life: w.life, lifeExtra: w.lifeExtra, threatHit: w.threatHit, lethal: w.lethal, ...(withHand ? { handCard: w.handCard } : {}) };
}

export interface SpsaOptions {
  rounds: number;
  /** Posições sorteadas por rodada (cada variação é avaliada nas mesmas). */
  batch: number;
  level: BotLevel;
  /** Tamanho da perturbação e do passo (escala log). */
  c?: number;
  a?: number;
  random?: () => number;
  onRound?: (round: number, plus: number, minus: number, theta: Theta) => void;
}

/** SPSA sobre a concordância com as pessoas. Devolve o θ final. */
export function spsa(samples: Sample[], start: Theta, o: SpsaOptions): Theta {
  const rand = o.random ?? Math.random;
  const C = o.c ?? 0.25;
  const A = o.a ?? 0.6;
  const theta = { ...start };
  for (let round = 0; round < o.rounds; round++) {
    const batch = Array.from({ length: Math.min(o.batch, samples.length) }, () => samples[Math.floor(rand() * samples.length)]);
    const delta: Theta = Object.fromEntries(Object.keys(theta).map((k) => [k, rand() < 0.5 ? -1 : 1]));
    const plus = agreement(batch, weightsOf(Object.fromEntries(Object.entries(theta).map(([k, v]) => [k, v + C * delta[k]]))), o.level);
    const minus = agreement(batch, weightsOf(Object.fromEntries(Object.entries(theta).map(([k, v]) => [k, v - C * delta[k]]))), o.level);
    const step = A / (1 + round / 30) ** 0.602;
    for (const k of Object.keys(theta)) theta[k] += ((step * (plus - minus)) / (2 * C)) * delta[k];
    o.onRound?.(round, plus, minus, theta);
  }
  return theta;
}
