// Perfil de deck do Bot do Time (docs/plano-bot-time.md, seção 4): o conhecimento de um deck, escrito a partir do
// guia e revisado pelo Time, que entra na avaliação como **valores**, nunca como regras "se X faça Y".
//
// - `archetype` escolhe um conjunto de pesos (aggro vale mais as últimas Vidas do oponente e menos a exposição;
//   controle vale mais a própria mão); `weights` sobrescreve o que o guia pedir por cima disso.
// - `roles` dá um papel por carta: `engine` (vale a mais em campo e entra antes nas candidatas), `finisher`
//   (vale guardado até o DON!! certo, ver `hold`), `defense` (vale a mais na mão: não se descarta), `fuel`
//   (vale a menos na mão: é a carta de descarte), `removal`/`blocker`/`tech` (só documentam; a simulação já os
//   pontua pelo que fazem).
// - `hold` guarda uma carta na mão até ter N DON!! em campo (ou até o turno N): até lá ela vale `holdBonus` a mais
//   na mão, e jogá-la cedo (ou descartá-la) perde isso.
// - `mulligan`: quais cartas seguram a mão inicial e quantos Personagens baratos ela precisa ter.
// - `matchups`: por Líder adversário (número da carta), o modelo do Counter escondido dele: um deck quase sem
//   Counter (Rocks.D.Xebec) leva ataques com margem menor.
// - `plan`: a curva do deck por DON!! disponível (o termo `nextTurn` da fase 2 lê daqui).
//
// O arquivo fica em `data/decks/meta/<id>.profile.json`; `validateProfile` confere um JSON vindo de fora.

import type { CardData, GameState, PlayerId, PlayerState } from '../types';
import { DEFAULT_WEIGHTS, type Weights } from './evaluate';

export const ARCHETYPES = ['aggro', 'midrange', 'control', 'combo'] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export const CARD_ROLES = ['engine', 'finisher', 'defense', 'fuel', 'removal', 'blocker', 'tech'] as const;
export type CardRole = (typeof CARD_ROLES)[number];

export interface HoldRule {
  /** Guardar até ter este número de DON!! em campo (área de custo + anexados). */
  untilDon?: number;
  /** Guardar até este turno (o número do turno da partida). */
  untilTurn?: number;
}

export interface PlanStep {
  /** DON!! disponíveis no turno (2, 4, 6…). */
  don: number;
  /** Cartas da jogada prevista (números de carta; qualquer uma delas serve). */
  play: string[];
  note?: string;
}

export interface MatchupRule {
  /** Chance de uma carta escondida da mão dele ter Counter (padrão `counterCard`). */
  counterCard?: number;
  /** Parte das que têm Counter que são +2000 (padrão `counterBig`). */
  counterBig?: number;
  /** Fator sobre a vontade dele de gastar Counter num ataque não fatal (padrão `counterWill`). */
  counterWill?: number;
  /** Pesos a mais só neste confronto. */
  weights?: Partial<NumericWeights>;
  note?: string;
}

/** Só os pesos numéricos (os que um perfil pode sobrescrever). */
export type NumericWeights = { [K in keyof Weights as Weights[K] extends number | number[] ? K : never]: Weights[K] };

export interface DeckProfile {
  /** Id do deck (`data/decks/meta/<id>.json`). */
  id: string;
  /** Número da carta do Líder. */
  leader: string;
  archetype: Archetype;
  /** Resumo do plano de jogo (uma frase; o guia inteiro fica no .md). */
  summary?: string;
  plan?: PlanStep[];
  mulligan?: {
    /** Cartas que seguram a mão inicial. */
    keep?: string[];
    /** Mínimo de Personagens de custo ≤ 3 para segurar a mão sem carta de `keep` (padrão 2). */
    minCheap?: number;
  };
  roles?: Record<string, CardRole>;
  hold?: Record<string, HoldRule>;
  weights?: Partial<NumericWeights>;
  matchups?: Record<string, MatchupRule>;
  notes?: string;
}

/** Pesos de cada arquétipo, por cima de `DEFAULT_WEIGHTS` (o perfil sobrescreve por cima destes). */
export const ARCHETYPE_WEIGHTS: Record<Archetype, Partial<NumericWeights>> = {
  // Fechar a partida: as duas últimas Vidas do oponente valem ainda mais; expor Personagens custa menos.
  aggro: { lifeOpp: [0, 42000, 58000, 62000, 65500, 68500], exposed: 300, handCard: 2600, rush: 400 },
  midrange: {},
  // A mão é o recurso: cada carta vale mais, o Counter impresso também; a pressão cedo vale menos.
  control: { handCard: 3300, handCardBase: 1500, handCounter: 1300, lifeOpp: [0, 35000, 48000, 53000, 57500, 60500], exposed: 650, blocker: 1800 },
  // Guarda as peças: cartas na mão valem mais e o teto da mão é maior.
  combo: { handCard: 3200, handCardBase: 1500, handSoftCap: 9 },
};

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{3,16}(_[a-z0-9]+)?$/.test(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkWeights(raw: unknown, where: string): Partial<NumericWeights> | string {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${where}: precisa ser um objeto`;
  const out: Record<string, number | number[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const base = (DEFAULT_WEIGHTS as unknown as Record<string, unknown>)[k];
    if (base === undefined || (typeof base !== 'number' && !Array.isArray(base))) return `${where}.${k}: peso desconhecido`;
    if (Array.isArray(base)) {
      if (!Array.isArray(v) || v.length !== base.length || !v.every(isNum)) return `${where}.${k}: precisa ser uma lista de ${base.length} números`;
      out[k] = v as number[];
    } else {
      if (!isNum(v)) return `${where}.${k}: precisa ser um número`;
      out[k] = v;
    }
  }
  return out as Partial<NumericWeights>;
}

/** Confere um perfil vindo de um arquivo ou do agente; devolve o perfil limpo ou o motivo da recusa. */
export function validateProfile(raw: unknown): DeckProfile | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'o perfil precisa ser um objeto JSON';
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id.trim()) return 'id: obrigatório';
  if (!isId(p.leader)) return 'leader: número da carta do Líder';
  if (!ARCHETYPES.includes(p.archetype as Archetype)) return `archetype: um de ${ARCHETYPES.join(', ')}`;
  const out: DeckProfile = { id: p.id.trim(), leader: p.leader, archetype: p.archetype as Archetype };
  if (p.summary !== undefined) {
    if (typeof p.summary !== 'string') return 'summary: texto';
    out.summary = p.summary.slice(0, 500);
  }
  if (p.notes !== undefined) {
    if (typeof p.notes !== 'string') return 'notes: texto';
    out.notes = p.notes.slice(0, 4000);
  }
  if (p.plan !== undefined) {
    if (!Array.isArray(p.plan)) return 'plan: lista';
    out.plan = [];
    for (const [i, st] of (p.plan as unknown[]).entries()) {
      const s = st as Record<string, unknown>;
      if (!s || !isNum(s.don) || !Array.isArray(s.play) || !s.play.every(isId)) return `plan[${i}]: {don, play: [cartas]}`;
      out.plan.push({ don: s.don, play: s.play as string[], ...(typeof s.note === 'string' ? { note: s.note.slice(0, 300) } : {}) });
    }
  }
  if (p.mulligan !== undefined) {
    const m = p.mulligan as Record<string, unknown>;
    if (!m || typeof m !== 'object') return 'mulligan: objeto';
    out.mulligan = {};
    if (m.keep !== undefined) {
      if (!Array.isArray(m.keep) || !m.keep.every(isId)) return 'mulligan.keep: lista de cartas';
      out.mulligan.keep = m.keep as string[];
    }
    if (m.minCheap !== undefined) {
      if (!isNum(m.minCheap) || m.minCheap < 0 || m.minCheap > 5) return 'mulligan.minCheap: 0 a 5';
      out.mulligan.minCheap = m.minCheap;
    }
  }
  if (p.roles !== undefined) {
    if (!p.roles || typeof p.roles !== 'object') return 'roles: objeto {carta: papel}';
    out.roles = {};
    for (const [id, role] of Object.entries(p.roles as Record<string, unknown>)) {
      if (!isId(id) || !CARD_ROLES.includes(role as CardRole)) return `roles.${id}: um de ${CARD_ROLES.join(', ')}`;
      out.roles[id] = role as CardRole;
    }
  }
  if (p.hold !== undefined) {
    if (!p.hold || typeof p.hold !== 'object') return 'hold: objeto {carta: {untilDon, untilTurn}}';
    out.hold = {};
    for (const [id, rule] of Object.entries(p.hold as Record<string, unknown>)) {
      const r = rule as Record<string, unknown>;
      if (!isId(id) || !r || typeof r !== 'object') return `hold.${id}: {untilDon, untilTurn}`;
      const h: HoldRule = {};
      if (r.untilDon !== undefined) {
        if (!isNum(r.untilDon) || r.untilDon < 1 || r.untilDon > 10) return `hold.${id}.untilDon: 1 a 10`;
        h.untilDon = r.untilDon;
      }
      if (r.untilTurn !== undefined) {
        if (!isNum(r.untilTurn) || r.untilTurn < 1 || r.untilTurn > 30) return `hold.${id}.untilTurn: 1 a 30`;
        h.untilTurn = r.untilTurn;
      }
      out.hold[id] = h;
    }
  }
  const w = checkWeights(p.weights, 'weights');
  if (typeof w === 'string') return w;
  if (p.weights !== undefined) out.weights = w;
  if (p.matchups !== undefined) {
    if (!p.matchups || typeof p.matchups !== 'object') return 'matchups: objeto {Líder: regra}';
    out.matchups = {};
    for (const [id, rule] of Object.entries(p.matchups as Record<string, unknown>)) {
      const r = rule as Record<string, unknown>;
      if (!isId(id) || !r || typeof r !== 'object') return `matchups.${id}: objeto`;
      const m: MatchupRule = {};
      for (const k of ['counterCard', 'counterBig', 'counterWill'] as const) {
        if (r[k] === undefined) continue;
        if (!isNum(r[k]) || (r[k] as number) < 0 || (r[k] as number) > 1.5) return `matchups.${id}.${k}: 0 a 1,5`;
        m[k] = r[k] as number;
      }
      const mw = checkWeights(r.weights, `matchups.${id}.weights`);
      if (typeof mw === 'string') return mw;
      if (r.weights !== undefined) m.weights = mw;
      if (typeof r.note === 'string') m.note = r.note.slice(0, 300);
      out.matchups[id] = m;
    }
  }
  return out;
}

/** DON!! em campo de um lado (área de custo + anexados): os DON!! disponíveis no turno. */
export function donInPlay(ps: PlayerState): number {
  return ps.donActive + ps.donRested + ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
}

/** A regra de guardar ainda vale nesta posição. */
export function holding(state: GameState, ps: PlayerState, rule: HoldRule): boolean {
  if (rule.untilDon !== undefined && donInPlay(ps) < rule.untilDon) return true;
  if (rule.untilTurn !== undefined && state.turn < rule.untilTurn) return true;
  return false;
}

/**
 * Os pesos do bot com o perfil: `DEFAULT_WEIGHTS` ← arquétipo ← `weights` do perfil ← confronto com o Líder
 * adversário (`matchups`), mais os papéis e as regras de guardar, que a avaliação lê carta a carta.
 */
export function profileWeights(profile: DeckProfile, oppLeader: string | null, base: Weights = DEFAULT_WEIGHTS): Weights {
  const matchup = oppLeader ? profile.matchups?.[oppLeader] : undefined;
  return {
    ...base,
    ...ARCHETYPE_WEIGHTS[profile.archetype],
    ...profile.weights,
    ...(matchup?.counterCard !== undefined ? { counterCard: matchup.counterCard } : {}),
    ...(matchup?.counterBig !== undefined ? { counterBig: matchup.counterBig } : {}),
    ...(matchup?.counterWill !== undefined ? { counterWill: matchup.counterWill } : {}),
    ...matchup?.weights,
    roles: profile.roles ?? {},
    hold: profile.hold ?? {},
    plan: profile.plan ?? [],
  };
}

/** O Líder do oponente na visão (número da carta; o Líder é sempre visível). */
export function opponentLeader(state: GameState, player: PlayerId): string | null {
  const opp = state.players[player === 0 ? 1 : 0];
  return state.cards[opp.leader.uid]?.cardId ?? null;
}

/**
 * Mulligan pelo perfil: segura a mão com `minCheap` Personagens de custo ≤ 3 (padrão 2), ou com uma carta de
 * `keep` e um a menos. Sem perfil (ou sem `mulligan`), vale a regra do bot heurístico (2 baratos).
 */
export function keepHand(state: GameState, player: PlayerId, profile: DeckProfile | undefined, defs: (uid: string) => Pick<CardData, 'id' | 'category' | 'cost'>): boolean {
  const hand = state.players[player].hand.map(defs);
  const cheap = hand.filter((d) => d.category === 'character' && (d.cost ?? 0) <= 3).length;
  const min = profile?.mulligan?.minCheap ?? 2;
  if (cheap >= min) return true;
  const keep = profile?.mulligan?.keep ?? [];
  return keep.length > 0 && hand.some((d) => keep.includes(d.id)) && cheap >= min - 1;
}
