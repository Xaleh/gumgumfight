// Sandbox de regras: uma mesa livre montada pelo jogador (Líder, mão, Personagens, Palco, Vida,
// lixo, topo do deck e DON!! de cada lado) para testar a interação de cartas sem jogar a partida
// inteira. Não há deck de verdade: o deck de cada lado é montado com as cartas citadas e
// completado até 50 com cópias delas (ver `sandboxDeck`), e a mesa sai do `createScenario`.
//
// A situação viaja num link (o navegador codifica o JSON), então tudo que chega aqui de fora
// passa antes pelo `parseSandboxSpec` (forma) e pelo `sandboxIssues` (cartas e limites).

import { buildCardDef } from './cards';
import { DECK_SIZE, DON_DECK_SIZE } from './engine';
import { createScenario, type ScenarioCard, type ScenarioSide } from './scenario';
import type { CardData, DeckList, GameConfig, GameState, PlayerId } from './types';

/** Um lado da mesa: o Líder (obrigatório) e as áreas do `createScenario`. */
export interface SandboxSide extends Omit<ScenarioSide, 'leader'> {
  leader: { id: string; rested?: boolean; don?: number };
}

export interface SandboxSpec {
  /** Turno da partida (1 = primeiro turno de quem começou). */
  turn: number;
  /** De quem é o turno. */
  active: PlayerId;
  sides: [SandboxSide, SandboxSide];
}

export const SANDBOX_LIMITS = {
  turn: 99,
  characters: 5,
  life: 10,
  /** DON!! num único card (Líder, Personagem ou Palco). */
  donOnCard: 10,
  /** Cartas em uma área da lista (mão, lixo, topo do deck, Vida exata). */
  zone: 30,
} as const;

export type SandboxIssueCode =
  | 'turn'
  | 'leader'
  | 'unknownCard'
  | 'leaderOutOfPlace'
  | 'notCharacter'
  | 'notStage'
  | 'tooManyCharacters'
  | 'tooManyCards'
  | 'tooManyDon'
  | 'life';

/** Problema na mesa montada: o código (o texto fica na interface), o lado e a carta, quando há. */
export interface SandboxIssue {
  code: SandboxIssueCode;
  side?: PlayerId;
  card?: string;
  /** Limite que foi passado (DON!!, cartas, Personagens). */
  max?: number;
}

const idOf = (c: string | ScenarioCard) => (typeof c === 'string' ? c : c.id);

/** Cartas citadas num lado (fora o Líder), na ordem em que entram no deck montado. */
export function sandboxCards(side: SandboxSide): string[] {
  return [
    ...(side.deckTop ?? []),
    ...(side.hand ?? []),
    ...(side.characters ?? []).map(idOf),
    ...(side.stage ? [idOf(side.stage)] : []),
    ...(side.trash ?? []),
    ...(Array.isArray(side.life) ? side.life : []),
  ];
}

/** Tamanho do deck de DON!! do Líder (10, salvo regra própria do Líder). */
function donDeckOf(leader: CardData | undefined): number {
  if (!leader) return DON_DECK_SIZE;
  const rule = buildCardDef(leader).abilities.find((a) => a.rule?.kind === 'donDeck')?.rule as { size: number } | undefined;
  return rule?.size ?? DON_DECK_SIZE;
}

/** Vida de um lado: a pedida ou a impressa no Líder. */
function lifeCountOf(side: SandboxSide, leader: CardData | undefined): number {
  if (Array.isArray(side.life)) return side.life.length;
  return side.life ?? leader?.life ?? 5;
}

/** Tudo que impede a mesa de ser montada (vazio = dá para jogar). */
export function sandboxIssues(spec: SandboxSpec, cards: readonly CardData[]): SandboxIssue[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const issues: SandboxIssue[] = [];
  if (!Number.isInteger(spec.turn) || spec.turn < 1 || spec.turn > SANDBOX_LIMITS.turn) issues.push({ code: 'turn', max: SANDBOX_LIMITS.turn });
  for (const side of [0, 1] as PlayerId[]) {
    const s = spec.sides[side];
    const leader = byId.get(s.leader.id);
    if (!leader || leader.category !== 'leader') issues.push({ code: 'leader', side, card: s.leader.id });
    const seen = new Set<string>();
    for (const id of sandboxCards(s)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const c = byId.get(id);
      if (!c) issues.push({ code: 'unknownCard', side, card: id });
      else if (c.category === 'leader') issues.push({ code: 'leaderOutOfPlace', side, card: id });
    }
    for (const c of s.characters ?? []) {
      const card = byId.get(idOf(c));
      if (card && card.category !== 'character' && card.category !== 'leader') issues.push({ code: 'notCharacter', side, card: card.id });
    }
    if (s.stage) {
      const card = byId.get(idOf(s.stage));
      if (card && card.category !== 'stage' && card.category !== 'leader') issues.push({ code: 'notStage', side, card: card.id });
    }
    if ((s.characters ?? []).length > SANDBOX_LIMITS.characters) issues.push({ code: 'tooManyCharacters', side, max: SANDBOX_LIMITS.characters });
    const life = lifeCountOf(s, leader);
    if (life > SANDBOX_LIMITS.life) issues.push({ code: 'life', side, max: SANDBOX_LIMITS.life });
    const explicitLife = Array.isArray(s.life) ? 0 : life;
    if (sandboxCards(s).length + explicitLife > DECK_SIZE) issues.push({ code: 'tooManyCards', side, max: DECK_SIZE });
    const onCards = [s.leader.don ?? 0, ...(s.characters ?? []).map((c) => (typeof c === 'string' ? 0 : (c.don ?? 0))), typeof s.stage === 'object' ? (s.stage.don ?? 0) : 0];
    const donMax = donDeckOf(leader);
    const don = (s.donActive ?? 0) + (s.donRested ?? 0) + onCards.reduce((a, b) => a + b, 0);
    if (don > donMax) issues.push({ code: 'tooManyDon', side, max: donMax });
  }
  return issues;
}

/**
 * Deck de 50 de um lado: as cartas citadas e, para completar, cópias delas em rodízio (a
 * primeira citada primeiro). Sem nenhuma carta citada, cópias do primeiro Personagem da cor do
 * Líder (ou do primeiro Personagem da base). O deck não segue as regras de construção: é só o
 * estoque de onde o `createScenario` tira as cartas de cada área.
 */
export function sandboxDeck(side: SandboxSide, cards: readonly CardData[]): DeckList {
  const leader = cards.find((c) => c.id === side.leader.id);
  const named = sandboxCards(side);
  let filler = [...new Set(named)];
  if (filler.length === 0) {
    const characters = cards.filter((c) => c.category === 'character').sort((a, b) => a.id.localeCompare(b.id));
    const sameColor = characters.find((c) => c.colors.some((k) => leader?.colors.includes(k)));
    const pick = sameColor ?? characters[0];
    if (!pick) throw new Error('a base de cartas não tem nenhum Personagem para completar o deck');
    filler = [pick.id];
  }
  const counts = new Map<string, number>();
  for (const id of named) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (let i = 0, n = named.length; n < DECK_SIZE; i++, n++) {
    const id = filler[i % filler.length];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    id: 'sandbox',
    name: leader?.name ?? side.leader.id,
    leader: side.leader.id,
    cards: [...counts].map(([id, count]) => ({ id, count })),
  };
}

/** Configuração da partida do sandbox: os dois decks montados e só as cartas que eles usam. */
export function sandboxConfig(spec: SandboxSpec, cards: readonly CardData[], names: [string, string], seed = 1): GameConfig {
  const decks = spec.sides.map((s) => sandboxDeck(s, cards)) as [DeckList, DeckList];
  const used = new Set(decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]));
  return {
    seed,
    cards: cards.filter((c) => used.has(c.id)),
    players: [
      { name: names[0], deck: decks[0], isBot: false },
      { name: names[1], deck: decks[1], isBot: false },
    ],
  };
}

/** A mesa descrita em `spec`, na Main Phase do jogador ativo. Lança erro se `sandboxIssues` não estiver vazio. */
export function createSandbox(spec: SandboxSpec, config: GameConfig): GameState {
  const issues = sandboxIssues(spec, config.cards);
  if (issues.length) throw new Error(`mesa inválida: ${issues.map((i) => `${i.code}${i.card ? ` ${i.card}` : ''}`).join(', ')}`);
  return createScenario(config, {
    turn: spec.turn,
    active: spec.active,
    sides: spec.sides.map(({ leader, ...rest }) => ({ ...rest, leader: { rested: leader.rested, don: leader.don } })) as [ScenarioSide, ScenarioSide],
  });
}

// ------------------------------------------------------------------ link (dados de fora)

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const cardId = (v: unknown): string | null => (typeof v === 'string' && CARD_ID.test(v) ? v : null);

function idList(v: unknown): string[] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > SANDBOX_LIMITS.zone) return null;
  const out = v.map(cardId);
  return out.every((x): x is string => x !== null) ? out : null;
}

function fieldCard(v: unknown): string | ScenarioCard | null {
  if (typeof v === 'string') return cardId(v);
  if (!isObj(v)) return null;
  const id = cardId(v.id);
  if (!id) return null;
  const don = int(v.don, 0, SANDBOX_LIMITS.donOnCard);
  if (v.don !== undefined && don === undefined) return null;
  return { id, ...(v.rested === true ? { rested: true } : {}), ...(don ? { don } : {}), ...(v.fresh === true ? { fresh: true } : {}) };
}

function parseSide(v: unknown): SandboxSide | null {
  if (!isObj(v) || !isObj(v.leader)) return null;
  const leaderId = cardId(v.leader.id);
  if (!leaderId) return null;
  const leaderDon = int(v.leader.don, 0, SANDBOX_LIMITS.donOnCard);
  if (v.leader.don !== undefined && leaderDon === undefined) return null;
  const side: SandboxSide = {
    leader: { id: leaderId, ...(v.leader.rested === true ? { rested: true } : {}), ...(leaderDon ? { don: leaderDon } : {}) },
  };
  for (const key of ['hand', 'trash', 'deckTop'] as const) {
    const list = idList(v[key]);
    if (list === null) return null;
    if (list?.length) side[key] = list;
  }
  if (v.characters !== undefined) {
    if (!Array.isArray(v.characters) || v.characters.length > SANDBOX_LIMITS.characters) return null;
    const list = v.characters.map(fieldCard);
    if (list.some((c) => c === null)) return null;
    if (list.length) side.characters = list as Array<string | ScenarioCard>;
  }
  if (v.stage !== undefined && v.stage !== null) {
    const stage = fieldCard(v.stage);
    if (!stage) return null;
    side.stage = stage;
  }
  if (v.life !== undefined) {
    if (typeof v.life === 'number') {
      const n = int(v.life, 0, SANDBOX_LIMITS.life);
      if (n === undefined) return null;
      side.life = n;
    } else {
      const list = idList(v.life);
      if (!list || list.length > SANDBOX_LIMITS.life) return null;
      side.life = list;
    }
  }
  for (const key of ['donActive', 'donRested'] as const) {
    if (v[key] === undefined) continue;
    const n = int(v[key], 0, DON_DECK_SIZE);
    if (n === undefined) return null;
    if (n) side[key] = n;
  }
  return side;
}

/**
 * Lê uma mesa vinda de fora (o JSON do link): só a forma e os limites, sem olhar a base de
 * cartas (isso é o `sandboxIssues`). null = não é uma mesa do sandbox.
 */
export function parseSandboxSpec(raw: unknown): SandboxSpec | null {
  if (!isObj(raw) || !Array.isArray(raw.sides) || raw.sides.length !== 2) return null;
  const turn = int(raw.turn, 1, SANDBOX_LIMITS.turn);
  const active = raw.active === 0 || raw.active === 1 ? raw.active : undefined;
  if (turn === undefined || active === undefined) return null;
  const a = parseSide(raw.sides[0]);
  const b = parseSide(raw.sides[1]);
  return a && b ? { turn, active, sides: [a, b] } : null;
}
