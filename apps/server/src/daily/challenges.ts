// Desafios do dia: os do catálogo em código (a semente) e os montados na Administração (tabela `daily_challenges`).
// Todo desafio da Administração é conferido antes de entrar na fila: a mesa monta, a solução resolve e a linha errada
// falha, com as cartas e os textos do motor deste servidor.

import { randomBytes } from 'node:crypto';
import {
  type Action,
  buildChallenge,
  type CardData,
  type ChallengeSpec,
  type ChallengeStatus,
  type DeckList,
  needsManual,
  runChallenge,
  type ScenarioCard,
  type ScenarioSide,
  type ScenarioSpec,
} from '@gumgum/engine';
import type { DB } from '../db';
import { DAILY_CATALOG } from './catalog';

export interface DailyChallenge extends ChallengeSpec {
  /** Listas dos dois decks congeladas quando o desafio foi salvo (desafios da Administração). */
  lists?: [DeckList, DeckList];
  source: 'catalog' | 'admin';
  note?: string;
  createdBy?: string | null;
  createdAt?: string;
}

type Row = { id: string; spec: string; note: string | null; created_by: string | null; created_at: string };

function fromRow(r: Row): DailyChallenge | null {
  try {
    const spec = JSON.parse(r.spec) as ChallengeSpec & { lists: [DeckList, DeckList] };
    return { ...spec, id: r.id, source: 'admin', note: r.note ?? undefined, createdBy: r.created_by, createdAt: r.created_at };
  } catch {
    return null;
  }
}

/** Todos os desafios da fila: o catálogo, depois os da Administração na ordem em que foram salvos. */
export function allChallenges(db: DB): DailyChallenge[] {
  const rows = db.prepare('SELECT id, spec, note, created_by, created_at FROM daily_challenges ORDER BY created_at, id').all() as Row[];
  const catalog = DAILY_CATALOG.map(({ solution: _s, wrong: _w, ...c }): DailyChallenge => ({ ...c, source: 'catalog' }));
  return [...catalog, ...rows.map(fromRow).filter((c): c is DailyChallenge => c !== null)];
}

/** Dias em que cada desafio saiu. */
export function publishedDays(db: DB): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of db.prepare('SELECT challenge_id, day FROM daily_schedule ORDER BY day').all() as Array<{ challenge_id: string; day: string }>) {
    out.set(r.challenge_id, [...(out.get(r.challenge_id) ?? []), r.day]);
  }
  return out;
}

// ------------------------------------------------------------------ o que vem do editor

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$/;
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const optBool = (v: unknown) => v === undefined || typeof v === 'boolean';

class Invalid extends Error {}
const need = (ok: boolean, what: string) => {
  if (!ok) throw new Invalid(what);
};

function cardList(v: unknown, max: number, what: string): string[] | undefined {
  if (v === undefined) return undefined;
  need(Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && CARD_ID.test(x)), what);
  return v as string[];
}

function fieldCard(v: unknown, what: string): string | ScenarioCard {
  if (typeof v === 'string') {
    need(CARD_ID.test(v), what);
    return v;
  }
  const c = v as Partial<ScenarioCard> | null;
  need(!!c && typeof c === 'object' && typeof c.id === 'string' && CARD_ID.test(c.id), what);
  need(optBool(c!.rested) && optBool(c!.fresh) && (c!.don === undefined || isInt(c!.don, 0, 10)), what);
  return { id: c!.id!, ...(c!.rested ? { rested: true } : {}), ...(c!.fresh ? { fresh: true } : {}), ...(c!.don ? { don: c!.don } : {}) };
}

function side(v: unknown, i: number): ScenarioSide {
  const s = (v ?? {}) as Record<string, unknown>;
  need(typeof s === 'object', `lado ${i}`);
  const out: ScenarioSide = {};
  const hand = cardList(s.hand, 20, `mão do lado ${i}`);
  if (hand?.length) out.hand = hand;
  if (s.characters !== undefined) {
    need(Array.isArray(s.characters) && s.characters.length <= 5, `Personagens do lado ${i}`);
    out.characters = (s.characters as unknown[]).map((c) => fieldCard(c, `Personagem do lado ${i}`));
  }
  if (s.stage !== undefined && s.stage !== null) out.stage = fieldCard(s.stage, `Stage do lado ${i}`);
  if (s.leader !== undefined) {
    const l = s.leader as { rested?: unknown; don?: unknown };
    need(!!l && typeof l === 'object' && optBool(l.rested) && (l.don === undefined || isInt(l.don, 0, 10)), `Líder do lado ${i}`);
    out.leader = { ...(l.rested ? { rested: true } : {}), ...(l.don ? { don: l.don as number } : {}) };
  }
  if (s.life !== undefined) {
    if (typeof s.life === 'number') {
      need(isInt(s.life, 0, 10), `Vida do lado ${i}`);
      out.life = s.life;
    } else out.life = cardList(s.life, 10, `Vida do lado ${i}`);
  }
  const top = cardList(s.deckTop, 10, `topo do deck do lado ${i}`);
  if (top?.length) out.deckTop = top;
  const trash = cardList(s.trash, 40, `descarte do lado ${i}`);
  if (trash?.length) out.trash = trash;
  for (const k of ['donActive', 'donRested'] as const) {
    if (s[k] !== undefined) {
      need(isInt(s[k], 0, 10), `DON!! do lado ${i}`);
      if (s[k]) out[k] = s[k] as number;
    }
  }
  return out;
}

/** Lê o desafio enviado pelo editor (lança `Invalid` com o campo que não vale). */
export function parseSpec(input: unknown): Omit<ChallengeSpec, 'id'> {
  const b = (input ?? {}) as Record<string, unknown>;
  need(b.goal === 'lethal' || b.goal === 'survive', 'objetivo');
  need(b.level === undefined || b.level === 1 || b.level === 2 || b.level === 3, 'nível');
  need(Array.isArray(b.decks) && b.decks.length === 2 && b.decks.every((d) => typeof d === 'string' && d.length > 0 && d.length <= 64), 'decks');
  need(isInt(b.seed, 0, 2 ** 31 - 1), 'semente');
  need(optBool(b.revealHand), 'mão revelada');
  const sc = (b.scenario ?? {}) as Record<string, unknown>;
  need(isInt(sc.turn, 1, 30), 'turno');
  need(Array.isArray(sc.sides) && sc.sides.length === 2, 'lados');
  const scenario: ScenarioSpec = {
    turn: sc.turn as number,
    active: b.goal === 'lethal' ? 0 : 1,
    sides: [side((sc.sides as unknown[])[0], 1), side((sc.sides as unknown[])[1], 2)],
  };
  let attacks: ChallengeSpec['attacks'];
  if (b.goal === 'survive') {
    need(
      Array.isArray(b.attacks) &&
        b.attacks.length >= 1 &&
        b.attacks.length <= 10 &&
        b.attacks.every((a) => {
          const x = a as { attacker?: unknown; target?: unknown };
          return [x?.attacker, x?.target].every((r) => typeof r === 'string' && (r === 'leader' || CARD_ID.test(r)));
        }),
      'roteiro de ataques',
    );
    attacks = (b.attacks as Array<{ attacker: string; target: string }>).map(({ attacker, target }) => ({ attacker, target }));
  }
  return {
    goal: b.goal as ChallengeSpec['goal'],
    level: (b.level ?? 1) as 1 | 2 | 3,
    decks: b.decks as [string, string],
    seed: b.seed as number,
    scenario,
    ...(attacks ? { attacks } : {}),
    ...(b.revealHand && b.goal === 'lethal' ? { revealHand: true } : {}),
  };
}

const actionsOf = (v: unknown, what: string): Action[] => {
  need(Array.isArray(v) && v.length <= 300 && v.every((a) => a && typeof a === 'object' && typeof (a as Action).type === 'string'), what);
  return v as Action[];
};

/** Cartas do cenário que estão na mesa (e os Líderes), para conferir as ⚙. */
function tableCards(spec: Omit<ChallengeSpec, 'id'>, lists: [DeckList, DeckList]): string[] {
  const ids = new Set<string>(lists.map((l) => l.leader));
  for (const s of spec.scenario.sides) {
    for (const c of [...(s.hand ?? []), ...(s.deckTop ?? []), ...(Array.isArray(s.life) ? s.life : [])]) ids.add(c);
    for (const c of [...(s.characters ?? []), ...(s.stage ? [s.stage] : [])]) ids.add(typeof c === 'string' ? c : c.id);
  }
  return [...ids];
}

export type VerifyError =
  | { code: 'challengeInvalid'; field: string }
  | { code: 'challengeDeck'; deck: string }
  | { code: 'challengeBoard'; reason: string }
  | { code: 'challengeManualCards'; cards: string[] }
  | { code: 'challengeNotSolved'; status: ChallengeStatus; reason?: string }
  | { code: 'challengeWrongSolves'; status: ChallengeStatus; reason?: string };

export interface Verified {
  spec: Omit<ChallengeSpec, 'id'> & { lists: [DeckList, DeckList] };
  solution: Action[];
  wrong: Action[] | null;
}

/**
 * Confere o que veio do editor: monta a mesa com as listas atuais dos decks e as cartas deste servidor, recusa cartas
 * ⚙ na mesa sem `allowManual`, joga a solução (tem que resolver) e a linha errada (tem que terminar sem resolver).
 */
export function verifyChallenge(
  body: { spec?: unknown; solution?: unknown; wrong?: unknown; allowManual?: unknown },
  deps: { deck: (id: string) => DeckList | null; cards: (ids: string[]) => CardData[] },
): Verified | VerifyError {
  let spec: Omit<ChallengeSpec, 'id'>;
  let solution: Action[];
  let wrong: Action[] | null;
  try {
    spec = parseSpec(body.spec);
    solution = actionsOf(body.solution, 'solução');
    wrong = body.wrong === undefined || body.wrong === null ? null : actionsOf(body.wrong, 'linha errada');
  } catch (e) {
    if (e instanceof Invalid) return { code: 'challengeInvalid', field: e.message };
    throw e;
  }
  const lists: DeckList[] = [];
  for (const id of spec.decks) {
    const d = deps.deck(id);
    if (!d) return { code: 'challengeDeck', deck: id };
    lists.push({ id: d.id, name: d.name, leader: d.leader, cards: d.cards.map((c) => ({ id: c.id, count: c.count })) });
  }
  const frozen = lists as [DeckList, DeckList];
  const cards = deps.cards([...new Set(frozen.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))]);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const manual = tableCards(spec, frozen).filter((id) => {
    const c = byId.get(id);
    return c && needsManual(c);
  });
  // Efeito ⚙ não roda sozinho (nem para o oponente): só entra com a confirmação de quem montou, que jogou a solução e viu.
  if (manual.length && body.allowManual !== true) return { code: 'challengeManualCards', cards: manual };
  const full = { ...spec, id: 'check' } as ChallengeSpec;
  let start;
  try {
    start = buildChallenge({ seed: spec.seed, cards, players: [{ name: '1', deck: frozen[0] }, { name: '2', deck: frozen[1] }] }, full);
  } catch (e) {
    return { code: 'challengeBoard', reason: e instanceof Error ? e.message : String(e) };
  }
  const ok = runChallenge(start, full, solution);
  if (ok.status !== 'solved' || ok.error) return { code: 'challengeNotSolved', status: ok.status, ...(ok.error ? { reason: ok.error.message } : {}) };
  if (wrong) {
    const bad = runChallenge(start, full, wrong);
    if (bad.status !== 'failed' || bad.error) return { code: 'challengeWrongSolves', status: bad.status, ...(bad.error ? { reason: bad.error.message } : {}) };
  }
  return { spec: { ...spec, lists: frozen }, solution, wrong };
}

export function saveChallenge(db: DB, v: Verified, note: string | null, userId: string | null): string {
  const id = `a-${randomBytes(5).toString('hex')}`;
  db.prepare('INSERT INTO daily_challenges (id, spec, solution, wrong, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    JSON.stringify(v.spec),
    JSON.stringify(v.solution),
    v.wrong ? JSON.stringify(v.wrong) : null,
    note,
    userId,
    new Date().toISOString(),
  );
  return id;
}

const isPublished = (db: DB, id: string) => Boolean(db.prepare('SELECT 1 FROM daily_schedule WHERE challenge_id = ?').get(id));

/** Troca um desafio da Administração que ainda não saiu (mantém id, data de criação, posição e data fixa). */
export function updateChallenge(db: DB, id: string, v: Verified, note: string | null): 'updated' | 'notFound' | 'published' {
  if (!db.prepare('SELECT 1 FROM daily_challenges WHERE id = ?').get(id)) return 'notFound';
  if (isPublished(db, id)) return 'published';
  db.prepare('UPDATE daily_challenges SET spec = ?, solution = ?, wrong = ?, note = ? WHERE id = ?').run(
    JSON.stringify(v.spec),
    JSON.stringify(v.solution),
    v.wrong ? JSON.stringify(v.wrong) : null,
    note,
    id,
  );
  return 'updated';
}

/** Apaga um desafio da Administração que ainda não saiu. */
export function deleteChallenge(db: DB, id: string): 'deleted' | 'notFound' | 'published' {
  if (!db.prepare('SELECT 1 FROM daily_challenges WHERE id = ?').get(id)) return 'notFound';
  if (isPublished(db, id)) return 'published';
  db.prepare('DELETE FROM daily_challenges WHERE id = ?').run(id);
  db.prepare('DELETE FROM daily_queue WHERE challenge_id = ?').run(id);
  return 'deleted';
}

export interface ChallengeDetail {
  id: string;
  source: DailyChallenge['source'];
  /** O desafio como o editor monta (sem as listas congeladas). */
  spec: Omit<ChallengeSpec, 'id'>;
  /** Solução e linha errada gravadas (ações); null nos do catálogo, escritos por número de carta. */
  solution: Action[] | null;
  wrong: Action[] | null;
  note: string | null;
  published: boolean;
}

/** Um desafio inteiro, para editar ou duplicar no editor (só a Administração lê). */
export function challengeDetail(db: DB, id: string): ChallengeDetail | null {
  const strip = ({ id: _i, lists: _l, source: _s, note: _n, createdBy: _b, createdAt: _a, ...spec }: DailyChallenge) => spec;
  const r = db.prepare('SELECT spec, solution, wrong, note FROM daily_challenges WHERE id = ?').get(id) as
    | { spec: string; solution: string; wrong: string | null; note: string | null }
    | undefined;
  if (r) {
    const c = fromRow({ id, spec: r.spec, note: r.note, created_by: null, created_at: '' });
    if (!c) return null;
    return {
      id,
      source: 'admin',
      spec: strip(c),
      solution: JSON.parse(r.solution) as Action[],
      wrong: r.wrong ? (JSON.parse(r.wrong) as Action[]) : null,
      note: r.note,
      published: isPublished(db, id),
    };
  }
  const c = DAILY_CATALOG.find((x) => x.id === id);
  if (!c) return null;
  const { solution: _s, wrong: _w, ...rest } = c;
  return { id, source: 'catalog', spec: strip({ ...rest, source: 'catalog' }), solution: null, wrong: null, note: null, published: isPublished(db, id) };
}
