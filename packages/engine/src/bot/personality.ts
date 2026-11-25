// Personalidade do bot (roadmap D3): o estilo de jogo, independente do nível (fácil, normal, difícil).
//
// - `balanced` (equilibrado): o bot de sempre, com os pesos ajustados em auto-jogo (`DEFAULT_WEIGHTS`).
// - `aggressive` (agressivo): vai na Vida do oponente. As últimas Vidas dele valem mais, a própria vale menos
//   (gasta pouco Counter e bloqueia pouco), expor Personagens custa menos e ele espera menos Counter do outro lado.
// - `control` (controle): a mão e o campo são o recurso. Cada carta na mão vale mais, Personagens em campo e
//   Blockers também; a Vida do oponente vale menos que tirar os Personagens dele.
// - `cautious` (conservador com a Vida): defende cedo. A própria Vida vale mais (usa Counter e bloqueia com mais
//   Vida), a ameaça do próximo ataque do oponente pesa mais e ele evita deixar Personagens virados expostos.
//
// Nos níveis com busca, a personalidade é uma camada de pesos por cima de `DEFAULT_WEIGHTS` (os termos continuam
// os da avaliação; nada de regra "se X faça Y"). No fácil (o bot heurístico), ela muda os limiares das regras dele
// (`SimpleStyle`). O Bot do Time ignora a personalidade: o estilo dele sai do perfil do deck.

import type { Weights } from './evaluate';
import type { NumericWeights } from './profile';

export const BOT_PERSONALITIES = ['balanced', 'aggressive', 'control', 'cautious'] as const;
export type BotPersonality = (typeof BOT_PERSONALITIES)[number];
export const isBotPersonality = (v: unknown): v is BotPersonality => BOT_PERSONALITIES.includes(v as BotPersonality);

/** Pesos de cada personalidade, por cima de `DEFAULT_WEIGHTS`. */
export const PERSONALITY_WEIGHTS: Record<BotPersonality, Partial<NumericWeights>> = {
  balanced: {},
  aggressive: {
    life: [0, 6000, 9000, 11500, 14000, 16500],
    lifeExtra: 2500,
    lifeOpp: [0, 46000, 64000, 71000, 76000, 80000],
    lifeOppExtra: 4000,
    handCard: 2400,
    handCardBase: 900,
    handCounter: 800,
    exposed: 150,
    threatHit: 1800,
    counterWill: 0.7,
    rush: 600,
  },
  control: {
    handCard: 3500,
    handCardBase: 1700,
    handCounter: 1400,
    handSoftCap: 9,
    lifeOpp: [0, 30000, 42000, 46500, 50000, 52500],
    lifeOppExtra: 2500,
    charCost: 1000,
    charBase: 1500,
    blocker: 2200,
    exposed: 700,
    counterWill: 1.2,
  },
  cautious: {
    life: [0, 22000, 34000, 42000, 48000, 53000],
    lifeExtra: 5000,
    handCounter: 1200,
    blocker: 2000,
    exposed: 900,
    threatHit: 4500,
    lethal: 3000,
  },
};

/** Os pesos do bot com a personalidade (sem ela, ou equilibrada, os de `base`). */
export function personalityWeights(personality: BotPersonality | undefined, base: Weights): Weights {
  if (!personality || personality === 'balanced') return base;
  return { ...base, ...PERSONALITY_WEIGHTS[personality] };
}

/** Limiares do bot heurístico (nível fácil). */
export interface SimpleStyle {
  /** Usa Counter para salvar o Líder com esta Vida ou menos. */
  counterLife: number;
  /** Usa Counter para salvar um Personagem de custo igual ou maior que este. */
  counterCharCost: number;
  /** Bloqueia o ataque ao Líder com esta Vida ou menos. */
  blockLife: number;
  /** Bloqueia o ataque a um Personagem de valor (custo × 1000 + poder) igual ou maior que este. */
  blockCharValue: number;
  /** Ataca um Personagem (K.O.) antes do Líder quando o custo dele é este ou maior. */
  koFirstCost: number;
}

export const SIMPLE_STYLES: Record<BotPersonality, SimpleStyle> = {
  balanced: { counterLife: 2, counterCharCost: 4, blockLife: 1, blockCharValue: 6000, koFirstCost: 3 },
  // Não defende o Líder até a última Vida, não gasta Counter em Personagem e só bate em Personagem sem Líder ao alcance.
  aggressive: { counterLife: 1, counterCharCost: 99, blockLife: 0, blockCharValue: 99_000, koFirstCost: 99 },
  // Protege o campo (Counter e bloqueio pelos Personagens) e tira qualquer Personagem antes de ir no Líder.
  control: { counterLife: 2, counterCharCost: 3, blockLife: 1, blockCharValue: 4000, koFirstCost: 1 },
  // Defende o Líder com mais Vida.
  cautious: { counterLife: 3, counterCharCost: 4, blockLife: 2, blockCharValue: 6000, koFirstCost: 3 },
};
