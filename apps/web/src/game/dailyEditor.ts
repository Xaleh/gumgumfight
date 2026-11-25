// Editor de desafios do dia (Administração): o rascunho da mesa, área por área, e a conversão para o `ChallengeSpec`
// que o motor monta. Sem React: os testes chamam direto.

import type { ChallengeGoal, ChallengeSpec, ScenarioCard, ScenarioSide, ScriptedAttack } from '@gumgum/engine';

export interface FieldDraft {
  id: string;
  rested: boolean;
  /** Jogado neste turno (sem [Rush], não ataca). */
  fresh: boolean;
  don: number;
}

export interface SideDraft {
  deckId: string | null;
  hand: string[];
  characters: FieldDraft[];
  stage: FieldDraft | null;
  leader: { rested: boolean; don: number };
  /** Vida em quantidade (tirada do fundo do deck), quando `life` está vazia. */
  lifeCount: number;
  /** Vida com as cartas exatas, a última no topo. */
  life: string[];
  deckTop: string[];
  trash: string[];
  donActive: number;
  donRested: number;
}

export interface EditorDraft {
  goal: ChallengeGoal;
  level: 1 | 2 | 3;
  turn: number;
  seed: number;
  revealHand: boolean;
  note: string;
  sides: [SideDraft, SideDraft];
  attacks: ScriptedAttack[];
}

/** Áreas onde se põe uma carta do deck. */
export const ZONES = ['hand', 'characters', 'stage', 'life', 'deckTop', 'trash'] as const;
export type Zone = (typeof ZONES)[number];

export const MAX_CHARACTERS = 5;
export const DON_TOTAL = 10;

const emptySide = (lifeCount: number): SideDraft => ({
  deckId: null,
  hand: [],
  characters: [],
  stage: null,
  leader: { rested: false, don: 0 },
  lifeCount,
  life: [],
  deckTop: [],
  trash: [],
  donActive: 0,
  donRested: 0,
});

export function emptyDraft(seed = Math.floor(Math.random() * 1_000_000)): EditorDraft {
  return { goal: 'lethal', level: 1, turn: 7, seed, revealHand: true, note: '', sides: [emptySide(3), emptySide(1)], attacks: [] };
}

/** Cópias de uma carta já postas em alguma área do lado. */
export function usedCopies(side: SideDraft, cardId: string): number {
  const all = [...side.hand, ...side.characters.map((c) => c.id), ...(side.stage ? [side.stage.id] : []), ...side.life, ...side.deckTop, ...side.trash];
  return all.filter((id) => id === cardId).length;
}

/** DON!! em uso no lado (ativos, virados e anexados). */
export function donUsed(side: SideDraft): number {
  return side.donActive + side.donRested + side.leader.don + side.characters.reduce((n, c) => n + c.don, 0) + (side.stage?.don ?? 0);
}

const field = (id: string): FieldDraft => ({ id, rested: false, fresh: false, don: 0 });

function withSide(d: EditorDraft, i: 0 | 1, f: (s: SideDraft) => SideDraft): EditorDraft {
  const sides = [...d.sides] as [SideDraft, SideDraft];
  sides[i] = f(sides[i]);
  return { ...d, sides };
}

/** Põe uma carta numa área (sem passar de 5 Personagens; o Stage é trocado). */
export function addCard(d: EditorDraft, i: 0 | 1, zone: Zone, cardId: string): EditorDraft {
  return withSide(d, i, (s) => {
    switch (zone) {
      case 'characters':
        return s.characters.length >= MAX_CHARACTERS ? s : { ...s, characters: [...s.characters, field(cardId)] };
      case 'stage':
        return { ...s, stage: field(cardId) };
      default:
        return { ...s, [zone]: [...s[zone], cardId] };
    }
  });
}

export function removeCard(d: EditorDraft, i: 0 | 1, zone: Zone, index: number): EditorDraft {
  const next = withSide(d, i, (s) => {
    if (zone === 'stage') return { ...s, stage: null };
    if (zone === 'characters') return { ...s, characters: s.characters.filter((_, k) => k !== index) };
    return { ...s, [zone]: s[zone].filter((_, k) => k !== index) };
  });
  return pruneAttacks(next);
}

export function updateField(d: EditorDraft, i: 0 | 1, zone: 'characters' | 'stage', index: number, patch: Partial<FieldDraft>): EditorDraft {
  return withSide(d, i, (s) =>
    zone === 'stage'
      ? { ...s, stage: s.stage ? { ...s.stage, ...patch } : null }
      : { ...s, characters: s.characters.map((c, k) => (k === index ? { ...c, ...patch } : c)) },
  );
}

export function updateSide(d: EditorDraft, i: 0 | 1, patch: Partial<SideDraft>): EditorDraft {
  return pruneAttacks(withSide(d, i, (s) => ({ ...s, ...patch })));
}

/** Trocar o deck de um lado limpa as cartas postas (elas eram do outro deck). */
export function setDeck(d: EditorDraft, i: 0 | 1, deckId: string | null): EditorDraft {
  const cur = d.sides[i];
  return pruneAttacks(withSide(d, i, () => ({ ...emptySide(cur.lifeCount), deckId, donActive: cur.donActive, donRested: cur.donRested })));
}

/** Quem pode atacar no roteiro (o Líder e os Personagens do oponente) e quem pode ser alvo (o seu Líder e Personagens). */
export function attackOptions(d: EditorDraft): { attackers: string[]; targets: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    attackers: ['leader', ...uniq(d.sides[1].characters.map((c) => c.id))],
    targets: ['leader', ...uniq(d.sides[0].characters.map((c) => c.id))],
  };
}

/** Ataques do roteiro que apontam para cartas que saíram da mesa caem fora. */
function pruneAttacks(d: EditorDraft): EditorDraft {
  const { attackers, targets } = attackOptions(d);
  const attacks = d.attacks.filter((a) => attackers.includes(a.attacker) && targets.includes(a.target));
  return attacks.length === d.attacks.length ? d : { ...d, attacks };
}

const scenarioCard = (c: FieldDraft): string | ScenarioCard =>
  c.rested || c.fresh || c.don ? { id: c.id, ...(c.rested ? { rested: true } : {}), ...(c.fresh ? { fresh: true } : {}), ...(c.don ? { don: c.don } : {}) } : c.id;

function sideSpec(s: SideDraft): ScenarioSide {
  return {
    ...(s.hand.length ? { hand: s.hand } : {}),
    ...(s.characters.length ? { characters: s.characters.map(scenarioCard) } : {}),
    ...(s.stage ? { stage: scenarioCard(s.stage) } : {}),
    ...(s.leader.rested || s.leader.don ? { leader: { ...(s.leader.rested ? { rested: true } : {}), ...(s.leader.don ? { don: s.leader.don } : {}) } } : {}),
    life: s.life.length ? s.life : s.lifeCount,
    ...(s.deckTop.length ? { deckTop: s.deckTop } : {}),
    ...(s.trash.length ? { trash: s.trash } : {}),
    ...(s.donActive ? { donActive: s.donActive } : {}),
    ...(s.donRested ? { donRested: s.donRested } : {}),
  };
}

/** O desafio que o motor monta e o servidor confere (null enquanto falta escolher um deck). */
export function specOf(d: EditorDraft): Omit<ChallengeSpec, 'id'> | null {
  const [a, b] = d.sides;
  if (!a.deckId || !b.deckId) return null;
  return {
    goal: d.goal,
    level: d.level,
    decks: [a.deckId, b.deckId],
    seed: d.seed,
    scenario: { turn: d.turn, active: d.goal === 'lethal' ? 0 : 1, sides: [sideSpec(a), sideSpec(b)] },
    ...(d.goal === 'survive' ? { attacks: d.attacks } : {}),
    ...(d.goal === 'lethal' && d.revealHand ? { revealHand: true } : {}),
  };
}

const fromCard = (c: string | ScenarioCard): FieldDraft =>
  typeof c === 'string' ? field(c) : { id: c.id, rested: Boolean(c.rested), fresh: Boolean(c.fresh), don: c.don ?? 0 };

function sideFrom(s: ScenarioSide, deckId: string): SideDraft {
  return {
    deckId,
    hand: [...(s.hand ?? [])],
    characters: (s.characters ?? []).map(fromCard),
    stage: s.stage ? fromCard(s.stage) : null,
    leader: { rested: Boolean(s.leader?.rested), don: s.leader?.don ?? 0 },
    lifeCount: typeof s.life === 'number' ? s.life : Array.isArray(s.life) ? 0 : 5,
    life: Array.isArray(s.life) ? [...s.life] : [],
    deckTop: [...(s.deckTop ?? [])],
    trash: [...(s.trash ?? [])],
    donActive: s.donActive ?? 0,
    donRested: s.donRested ?? 0,
  };
}

/** O rascunho de um desafio já salvo (para editar ou duplicar): o caminho inverso de `specOf`. */
export function draftFromSpec(spec: Omit<ChallengeSpec, 'id'>, note = ''): EditorDraft {
  return {
    goal: spec.goal,
    level: spec.level ?? 1,
    turn: spec.scenario.turn,
    seed: spec.seed,
    revealHand: spec.goal === 'lethal' && Boolean(spec.revealHand),
    note,
    sides: [sideFrom(spec.scenario.sides[0], spec.decks[0]), sideFrom(spec.scenario.sides[1], spec.decks[1])],
    attacks: (spec.attacks ?? []).map((a) => ({ ...a })),
  };
}

/** Dias previstos para a fila: a partir de `start`, um por dia, pulando os dias com data fixa. */
export function forecastDays(start: string, count: number, pinnedDays: Iterable<string>): string[] {
  const pinned = new Set(pinnedDays);
  const out: string[] = [];
  let d = start;
  const next = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  while (out.length < count) {
    if (!pinned.has(d)) out.push(d);
    d = next(d);
  }
  return out;
}

/** O que muda a partida gravada (mesa, decks, semente, objetivo, roteiro): mudou, a solução gravada deixa de valer. */
export function boardKey(d: EditorDraft): string {
  return JSON.stringify([d.goal, d.turn, d.seed, d.sides, d.goal === 'survive' ? d.attacks : []]);
}

/** O que ainda impede de ir para a mesa (chaves do dicionário), antes de o motor montar. */
export function draftProblems(d: EditorDraft): Array<'decks' | 'don0' | 'don1' | 'attacks'> {
  const out: Array<'decks' | 'don0' | 'don1' | 'attacks'> = [];
  if (!d.sides[0].deckId || !d.sides[1].deckId) out.push('decks');
  if (donUsed(d.sides[0]) > DON_TOTAL) out.push('don0');
  if (donUsed(d.sides[1]) > DON_TOTAL) out.push('don1');
  if (d.goal === 'survive' && d.attacks.length === 0) out.push('attacks');
  return out;
}
