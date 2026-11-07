// Sala do Tempo (docs/plano-sala-do-tempo.md): um torneio do módulo de torneios em que as vagas
// que os humanos do Time não ocupam são preenchidas por jogadores virtuais, sorteados pela
// distribuição de Líderes de um evento real (o preset, `data/chamber/<id>.json`). O suíço pareia
// humanos e virtuais juntos; a mesa humano x virtual é jogada de verdade contra o Bot do Time
// (com o deck do meta do Líder sorteado) e a mesa virtual x virtual é só um passo estatístico:
// o resultado sai do confronto dos Líderes (matriz do preset) e da força sorteada de cada um.
//
// Nada aqui toca o relógio dos torneios: a Sala do Tempo nunca tem check-in; quem abriu a sala
// gera e inicia cada rodada à mão, no ritmo do grupo.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckList } from '@gumgum/engine';
import { type DB, getDeck, listDecks, type StoredDeck } from '../db';
import { DATA_DIR } from '../paths';
import { isPlayFormat, type PlayFormat } from '../stats/catalog';
import { advanceRound, beginTournament, deckIssue } from './clock';
import { winsNeeded } from './pairing';
import {
  getTournament,
  insertVirtuals,
  isVirtualId,
  listMatches,
  listVirtuals,
  setMatchScore,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
  type TournamentVirtual,
  VIRTUAL_PREFIX,
} from './store';

/** Um Líder do evento: a fração dos jogadores que o jogam e, opcionalmente, o deck pronto que o bot usa por ele. */
export interface ChamberLeader {
  leader: string;
  /** Fração dos jogadores do evento (0..1). A soma de todos pode ficar abaixo de 1: o resto é "outros". */
  share: number;
  /** Deck pronto escolhido à mão (id em `decks`); sem ele, o deck do meta com o Líder, depois qualquer deck pronto com o Líder. */
  deck: string | null;
}

export interface ChamberPreset {
  id: string;
  name: string;
  description: string;
  format: PlayFormat;
  spoilers: boolean;
  /** Jogadores do evento (humanos + virtuais), rodadas do suíço e top cut sugeridos (quem abre a sala pode mudar). */
  players: number;
  rounds: number | null;
  topCut: number | null;
  bo3From: number | null;
  bo5From: number | null;
  leaders: ChamberLeader[];
  /** Taxa de vitória do Líder da chave contra o Líder interno (0..1); o inverso vale para o outro lado. Sem o par: 50%. */
  matchups: Record<string, Record<string, number>>;
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CUT_SIZES = [2, 4, 8, 16, 32, 64];
const PHASE_SIZES = [2, 4, 8, 16, 32, 64, 128, 256];
export const MIN_CHAMBER_PLAYERS = 4;
export const MAX_CHAMBER_PLAYERS = 2048;
const MAX_SWISS_ROUNDS = 15;

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Lê e confere um preset; devolve o motivo (em texto) quando o arquivo não serve. */
export function parsePreset(id: string, raw: unknown): ChamberPreset | string {
  if (!raw || typeof raw !== 'object') return 'não é um objeto JSON';
  const p = raw as Record<string, unknown>;
  if (!SAFE_ID.test(id)) return 'id inválido';
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
  if (!name) return 'sem nome';
  if (!isPlayFormat(p.format)) return 'formato inválido';
  const players = int(p.players, MIN_CHAMBER_PLAYERS, MAX_CHAMBER_PLAYERS);
  if (players === null) return `players deve ser um inteiro de ${MIN_CHAMBER_PLAYERS} a ${MAX_CHAMBER_PLAYERS}`;
  const rounds = p.rounds === undefined || p.rounds === null ? null : int(p.rounds, 1, MAX_SWISS_ROUNDS);
  if (p.rounds !== undefined && p.rounds !== null && rounds === null) return 'rounds inválido';
  const cut = (v: unknown, sizes: number[]) => (v === undefined || v === null ? null : typeof v === 'number' && sizes.includes(v) ? v : undefined);
  const topCut = cut(p.topCut, CUT_SIZES);
  const bo3From = cut(p.bo3From, PHASE_SIZES);
  const bo5From = cut(p.bo5From, PHASE_SIZES);
  if (topCut === undefined) return 'topCut inválido';
  if (bo3From === undefined || bo5From === undefined) return 'bo3From/bo5From inválidos';
  if (!Array.isArray(p.leaders) || !p.leaders.length) return 'sem leaders';
  const leaders: ChamberLeader[] = [];
  let total = 0;
  for (const l of p.leaders as unknown[]) {
    if (!l || typeof l !== 'object') return 'leader inválido';
    const { leader, share, deck } = l as Record<string, unknown>;
    if (typeof leader !== 'string' || !leader.trim()) return 'leader sem id';
    if (typeof share !== 'number' || !(share >= 0) || share > 1) return `share inválido em ${leader}`;
    if (deck !== undefined && deck !== null && typeof deck !== 'string') return `deck inválido em ${leader}`;
    total += share;
    leaders.push({ leader: leader.trim(), share, deck: typeof deck === 'string' && deck.trim() ? deck.trim() : null });
  }
  if (total > 1.0001) return 'a soma dos shares passa de 1';
  const matchups: ChamberPreset['matchups'] = {};
  if (p.matchups !== undefined) {
    if (!p.matchups || typeof p.matchups !== 'object') return 'matchups inválido';
    for (const [a, row] of Object.entries(p.matchups as Record<string, unknown>)) {
      if (!row || typeof row !== 'object') return `matchups de ${a} inválido`;
      matchups[a] = {};
      for (const [b, rate] of Object.entries(row as Record<string, unknown>)) {
        if (typeof rate !== 'number' || !(rate > 0) || !(rate < 1)) return `matchup ${a} x ${b} fora de (0, 1)`;
        matchups[a][b] = rate;
      }
    }
  }
  return {
    id,
    name,
    description: typeof p.description === 'string' ? p.description.trim() : '',
    format: p.format,
    // O Livre sempre aceita spoilers (como nos torneios).
    spoilers: p.format === 'free' || p.spoilers === true,
    players,
    rounds,
    topCut,
    bo3From,
    bo5From,
    leaders,
    matchups,
  };
}

/** Os presets dos eventos (`data/chamber/*.json`), relidos a cada consulta (são poucos e mudam à mão). */
export class ChamberPresets {
  constructor(private dir = join(DATA_DIR, 'chamber')) {}

  get directory() {
    return this.dir;
  }

  list(): ChamberPreset[] {
    if (!existsSync(this.dir)) return [];
    const out: ChamberPreset[] = [];
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      const id = f.replace(/\.json$/, '');
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
      } catch {
        continue;
      }
      const p = parsePreset(id, raw);
      if (typeof p !== 'string') out.push(p);
    }
    return out;
  }

  get(id: string): ChamberPreset | null {
    return this.list().find((p) => p.id === id) ?? null;
  }
}

// ------------------------------------------------------------------ decks dos virtuais

/** Um Líder do preset com o deck que o bot joga por ele (null = nenhum deck pronto válido com o Líder: vira "outros"). */
export interface ChamberLeaderDeck extends ChamberLeader {
  deckId: string | null;
  deckName: string | null;
  /** O deck é do grupo "Decks do meta" (tem guia e perfil do Bot do Time). */
  meta: boolean;
}

/**
 * Para cada Líder do preset, o deck pronto válido no torneio: o escolhido no preset, senão o
 * primeiro deck do meta com o Líder, senão qualquer deck pronto com o Líder. `others`: os decks
 * prontos válidos entre os quais a fatia "outros" (e os Líderes sem deck) são sorteados.
 */
export function chamberDecks(
  db: DB,
  preset: ChamberPreset,
  t: Pick<Tournament, 'format' | 'spoilers'> & Partial<Pick<Tournament, 'spoilerSet' | 'status'>>,
  at: Date,
): { leaders: ChamberLeaderDeck[]; others: StoredDeck[] } {
  const builtin = listDecks(db).filter((d) => d.kind === 'builtin' && deckIssue(db, d, t, at) === null);
  const byId = new Map(builtin.map((d) => [d.id, d]));
  const rank = (d: StoredDeck) => (d.group === 'meta' ? 0 : 1);
  const leaders = preset.leaders.map((l): ChamberLeaderDeck => {
    const chosen = l.deck ? byId.get(l.deck) : undefined;
    const deck = chosen ?? builtin.filter((d) => d.leader === l.leader).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
    return { ...l, deckId: deck?.id ?? null, deckName: deck?.name ?? null, meta: deck?.group === 'meta' };
  });
  return { leaders, others: builtin };
}

/** Normal padrão (Box-Muller). */
function gaussian(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Sorteia `n` virtuais pela distribuição do preset: cada Líder com deck recebe o arredondamento
 * (maior resto) de `share × n`; o que sobra (a fatia "outros" e os Líderes sem deck) sorteia entre os
 * decks prontos válidos. Sem nenhum deck válido, devolve vazio (o torneio não pode começar).
 */
export function spawnVirtuals(db: DB, preset: ChamberPreset, t: Tournament, n: number, at: Date): Array<Omit<TournamentVirtual, 'seed'>> {
  const { leaders, others } = chamberDecks(db, preset, t, at);
  if (!others.length || n <= 0) return [];
  const covered = leaders.filter((l) => l.deckId);
  const exact = covered.map((l) => l.share * n);
  const counts = exact.map((x) => Math.floor(x));
  let left = n - counts.reduce((s, c) => s + c, 0);
  // Maior resto: distribui as vagas que o piso deixou, até a fatia que cabe aos Líderes com deck.
  const coveredShare = covered.reduce((s, l) => s + l.share, 0);
  let toLeaders = Math.min(left, Math.max(0, Math.round(coveredShare * n) - counts.reduce((s, c) => s + c, 0)));
  const order = exact.map((x, i) => ({ i, rest: x - counts[i] })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (toLeaders <= 0) break;
    counts[i]++;
    toLeaders--;
    left--;
  }
  const out: Array<Omit<TournamentVirtual, 'seed'>> = [];
  const push = (deck: Pick<StoredDeck, 'id' | 'leader'>) => {
    const k = out.length + 1;
    out.push({ id: `${VIRTUAL_PREFIX}${k}`, name: `Piloto ${k}`, leader: deck.leader, deckId: deck.id, skill: gaussian() });
  };
  covered.forEach((l, i) => {
    for (let k = 0; k < counts[i]; k++) push({ id: l.deckId!, leader: l.leader });
  });
  for (let k = 0; k < left; k++) push(others[Math.floor(Math.random() * others.length)]);
  // Embaralha: a ordem dos ids não diz o Líder (a ordem sorteada do torneio vem depois).
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((v, i) => ({ ...v, id: `${VIRTUAL_PREFIX}${i + 1}`, name: `Piloto ${i + 1}` }));
}

// ------------------------------------------------------------------ inscritos + virtuais

/** Inscrito virtual visto como um inscrito (deck congelado = o deck pronto que o bot joga). */
export type ChamberEntrant = TournamentPlayer & { virtual: boolean; skill: number };

/**
 * Todos os que jogam o torneio: os inscritos e, na Sala do Tempo, os virtuais (com o deck pronto
 * de cada um). É esta lista que vai para o pareamento, a classificação e o kit de divulgação.
 */
export function entrants(db: DB, t: Tournament, players: TournamentPlayer[]): ChamberEntrant[] {
  const humans = players.map((p) => ({ ...p, virtual: false, skill: 0 }));
  if (!t.chamber) return humans;
  const decks = new Map<string, DeckList | null>();
  const deckOf = (id: string): DeckList => {
    let d = decks.get(id);
    if (d === undefined) {
      const s = getDeck(db, id);
      d = s ? { id: s.id, name: s.name, leader: s.leader, cards: s.cards, ...(s.arts ? { arts: s.arts } : {}) } : null;
      decks.set(id, d);
    }
    return d ?? { id, name: id, leader: '', cards: [] };
  };
  const virtuals = listVirtuals(db, t.id).map(
    (v): ChamberEntrant => ({
      userId: v.id,
      name: v.name,
      deckId: v.deckId,
      deck: { ...deckOf(v.deckId), leader: v.leader },
      seed: v.seed,
      dropped: false,
      registeredAt: t.createdAt,
      checkedInAt: null,
      warningsReviewedAt: null,
      virtual: true,
      skill: v.skill,
    }),
  );
  return [...humans, ...virtuals];
}

// ------------------------------------------------------------------ mesas estatísticas

/** Peso da diferença de força (desvios-padrão) na chance de vitória, somado ao logit do confronto. */
const SKILL_WEIGHT = 0.6;

/** Taxa de vitória de `a` contra `b` pelo preset (o par inverso vale ao contrário; sem dado, 50%). */
export function matchupRate(preset: Pick<ChamberPreset, 'matchups'>, a: string, b: string): number {
  const direct = preset.matchups[a]?.[b];
  if (direct !== undefined) return direct;
  const inverse = preset.matchups[b]?.[a];
  return inverse !== undefined ? 1 - inverse : 0.5;
}

/** Chance de `a` vencer um jogo contra `b`: logit do confronto dos Líderes mais a diferença de força. */
export function winProbability(
  preset: Pick<ChamberPreset, 'matchups'>,
  a: { leader: string; skill: number },
  b: { leader: string; skill: number },
): number {
  const m = Math.min(0.99, Math.max(0.01, matchupRate(preset, a.leader, b.leader)));
  const x = Math.log(m / (1 - m)) + SKILL_WEIGHT * (a.skill - b.skill);
  return 1 / (1 + Math.exp(-x));
}

/** Joga a série no sorteio: jogos até alguém chegar à maioria. */
export function simulateSeries(bestOf: number, pWin: number, random: () => number = Math.random): [number, number] {
  const need = winsNeeded(bestOf);
  const wins: [number, number] = [0, 0];
  while (wins[0] < need && wins[1] < need) wins[random() < pWin ? 0 : 1]++;
  return wins;
}

/** Quem lançou uma mesa estatística (em `tournament_matches.reported_by`). */
export const SIM_REPORTER = 'sim';

/**
 * Resolve as mesas virtual x virtual da rodada ainda sem resultado. Devolve quantas resolveu.
 * As mesas com um humano ficam pendentes: são jogadas de verdade contra o bot.
 */
export function resolveVirtualTables(db: DB, t: Tournament, preset: ChamberPreset, round: number, matches = listMatches(db, t.id)): number {
  const virtuals = new Map(listVirtuals(db, t.id).map((v) => [v.id, v]));
  let n = 0;
  for (const m of matches) {
    if (m.round !== round || m.result || !m.p2) continue;
    const a = virtuals.get(m.p1);
    const b = virtuals.get(m.p2);
    if (!a || !b) continue;
    setMatchScore(db, t.id, m.id, m.bestOf, simulateSeries(m.bestOf, winProbability(preset, a, b)), SIM_REPORTER);
    n++;
  }
  return n;
}

/** A mesa tem pelo menos um humano (é jogada de verdade). */
export const humanTable = (m: Pick<TournamentMatch, 'p1' | 'p2'>) => !isVirtualId(m.p1) || (m.p2 !== null && !isVirtualId(m.p2));

/**
 * Começa a Sala do Tempo: sorteia os virtuais até completar o evento, embaralha todos, gera a rodada 1
 * e resolve as mesas só de virtuais. Devolve os virtuais sorteados (vazio = nenhum deck pronto vale no
 * formato: o torneio não começou).
 */
export function beginChamber(db: DB, t: Tournament, preset: ChamberPreset, players: TournamentPlayer[], at: string): Array<Omit<TournamentVirtual, 'seed'>> {
  const n = Math.max(0, (t.chamberSize ?? preset.players) - players.length);
  const virtuals = spawnVirtuals(db, preset, t, n, new Date(at));
  if (n > 0 && !virtuals.length) return [];
  insertVirtuals(db, t.id, virtuals);
  const all = entrants(db, t, players);
  beginTournament(db, t, all, at);
  resolveVirtualTables(db, getTournament(db, t.id)!, preset, 1);
  return virtuals;
}

/** Como `advanceRound`, resolvendo em seguida as mesas só de virtuais da rodada gerada. */
export function advanceChamber(db: DB, t: Tournament, preset: ChamberPreset, all: ChamberEntrant[], matches: TournamentMatch[], at: string) {
  const step = advanceRound(db, t, all, matches, at);
  const after = getTournament(db, t.id)!;
  if (after.status === 'running') resolveVirtualTables(db, after, preset, after.round);
  return step;
}
