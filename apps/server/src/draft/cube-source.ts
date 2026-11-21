// De onde sai o uso das cartas para a lista do Cubo: as decklists dos torneios de One Piece da
// plataforma do Limitless TCG (https://play.limitlesstcg.com), pela API pública deles
// (https://docs.limitlesstcg.com/developer.html). Não precisa de chave; o limite de pedidos vem
// no cabeçalho `ratelimit` e é respeitado aqui.
//
//   GET /api/tournaments?game=OP&limit=N        lista (id, name, date, players, format)
//   GET /api/tournaments/{id}/standings         jogadores, com a decklist de cada um
//
// Só as cartas de cada deck são guardadas (nunca nome ou país de jogador). O uso de uma carta é
// contado por trimestre: a fração dos decks do trimestre que a jogaram. A nota que ordena o Cubo
// é a média dos melhores trimestres da carta (`usageByCard`), para valer tanto a carta que foi
// base de um deck forte em 2023 quanto a que é base hoje.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LIMITLESS_API = 'https://play.limitlesstcg.com/api';
export const LIMITLESS_GAME = 'OP';

export interface LimitlessTournament {
  id: string;
  game: string;
  format: string | null;
  name: string;
  date: string;
  players: number;
}

interface LimitlessEntry {
  count?: number;
  set?: string;
  number?: string;
}

interface LimitlessStanding {
  decklist?: { leader?: LimitlessEntry; character?: LimitlessEntry[]; event?: LimitlessEntry[]; stage?: LimitlessEntry[] } | null;
}

/** As decklists de um torneio, só com o que a conta de uso precisa. */
export interface TournamentDecks {
  id: string;
  date: string;
  players: number;
  /** As cartas de cada deck (sem o Líder), uma vez cada. */
  decks: string[][];
}

/** "OP18" + "084" -> "OP18-084". */
const cardIdOf = (e: LimitlessEntry): string | null => (e.set && e.number ? `${e.set.toUpperCase()}-${e.number}` : null);

/** As cartas de cada decklist de uma resposta de `/standings` (jogador sem lista fica de fora). */
export function decksOfStandings(standings: unknown): string[][] {
  if (!Array.isArray(standings)) return [];
  const decks: string[][] = [];
  for (const row of standings as LimitlessStanding[]) {
    const list = row?.decklist;
    if (!list || typeof list !== 'object') continue;
    const ids = new Set<string>();
    for (const part of [list.character, list.event, list.stage]) {
      if (!Array.isArray(part)) continue;
      for (const e of part) {
        const id = cardIdOf(e);
        if (id) ids.add(id);
      }
    }
    // Lista pela metade não é um deck jogado.
    if (ids.size >= 8) decks.push([...ids].sort());
  }
  return decks;
}

/** "2026-11-20T…" -> "2026Q4". */
export const quarterOf = (date: string): string => `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/**
 * Os torneios que entram na conta: os `perQuarter` maiores de cada trimestre, com pelo menos
 * `minPlayers` jogadores. Formatos fora do padrão ("EXTRA", "CUSTOM") ficam de fora.
 */
export function sampleTournaments(list: readonly LimitlessTournament[], opts: { perQuarter: number; minPlayers: number }): LimitlessTournament[] {
  const byQuarter = new Map<string, LimitlessTournament[]>();
  for (const t of list) {
    if (t.game !== LIMITLESS_GAME || (t.format && t.format !== 'STANDARD') || t.players < opts.minPlayers || !/^20\d\d-\d\d/.test(t.date)) continue;
    const q = quarterOf(t.date);
    byQuarter.set(q, [...(byQuarter.get(q) ?? []), t]);
  }
  return [...byQuarter.keys()]
    .sort()
    .flatMap((q) => byQuarter.get(q)!.sort((a, b) => b.players - a.players || a.id.localeCompare(b.id)).slice(0, opts.perQuarter));
}

export interface CardUsage {
  /** A nota: média da fração de decks com a carta nos melhores trimestres dela (0 a 1). */
  usage: number;
  /** Decks com a carta, somando tudo. */
  decks: number;
  /** O trimestre de maior uso e a fração de decks nele. */
  peak: { quarter: string; share: number };
}

/** Trimestres que entram na média de cada carta: o melhor ano dela. */
export const USAGE_BEST_QUARTERS = 4;

/**
 * O uso de cada carta. Por trimestre, a fração dos decks que a jogaram; a nota é a média dos
 * `USAGE_BEST_QUARTERS` melhores trimestres. Carta que só existe há menos trimestres que isso é
 * medida pelos que tem (uma carta nova não perde para uma antiga por falta de tempo). Trimestre
 * com menos de `minDecks` decks não entra.
 */
export function usageByCard(tournaments: readonly TournamentDecks[], minDecks = 100): { cards: Map<string, CardUsage>; quarters: Array<{ quarter: string; tournaments: number; decks: number }> } {
  const byQuarter = new Map<string, { tournaments: number; decks: number; counts: Map<string, number> }>();
  for (const t of tournaments) {
    const q = quarterOf(t.date);
    let slot = byQuarter.get(q);
    if (!slot) byQuarter.set(q, (slot = { tournaments: 0, decks: 0, counts: new Map() }));
    slot.tournaments++;
    slot.decks += t.decks.length;
    for (const deck of t.decks) for (const id of deck) slot.counts.set(id, (slot.counts.get(id) ?? 0) + 1);
  }
  const quarters = [...byQuarter.keys()].sort().filter((q) => byQuarter.get(q)!.decks >= minDecks);
  const shares = new Map<string, { decks: number; first: number; byQuarter: number[] }>();
  quarters.forEach((q, i) => {
    const slot = byQuarter.get(q)!;
    for (const [id, n] of slot.counts) {
      let s = shares.get(id);
      if (!s) shares.set(id, (s = { decks: 0, first: i, byQuarter: quarters.map(() => 0) }));
      s.decks += n;
      s.byQuarter[i] = n / slot.decks;
    }
  });
  const cards = new Map<string, CardUsage>();
  for (const [id, s] of shares) {
    const lived = Math.min(USAGE_BEST_QUARTERS, quarters.length - s.first);
    const best = [...s.byQuarter].sort((a, b) => b - a).slice(0, lived);
    const top = s.byQuarter.indexOf(Math.max(...s.byQuarter));
    cards.set(id, { usage: best.reduce((n, x) => n + x, 0) / lived, decks: s.decks, peak: { quarter: quarters[top], share: s.byQuarter[top] } });
  }
  return { cards, quarters: quarters.map((q) => ({ quarter: q, tournaments: byQuarter.get(q)!.tournaments, decks: byQuarter.get(q)!.decks })) };
}

// ---------------------------------------------------------------- rede

type Fetch = (url: string) => Promise<Response>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera o que o cabeçalho `ratelimit` pede: `"50-in-5min"; r=0; t=120` = sem pedidos por 120 s. */
async function respectLimit(res: Response, log: (msg: string) => void) {
  const header = res.headers.get('ratelimit') ?? '';
  const left = Number(/\br=(\d+)/.exec(header)?.[1] ?? NaN);
  const reset = Number(/\bt=(\d+)/.exec(header)?.[1] ?? NaN);
  if (left <= 1 && reset > 0) {
    log(`Limite de pedidos da API: esperando ${reset} s.`);
    await sleep((reset + 1) * 1000);
  }
}

async function getJson(url: string, fetcher: Fetch, log: (msg: string) => void): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetcher(url);
    if (res.status === 429 && attempt <= 3) {
      const wait = Number(res.headers.get('retry-after') ?? 60);
      log(`A API pediu para esperar ${wait} s.`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const body = await res.json();
    await respectLimit(res, log);
    return body;
  }
}

export interface FetchOptions {
  /** Pasta onde as decklists de cada torneio ficam guardadas (um torneio terminado não muda). */
  cacheDir: string;
  fetch?: Fetch;
  log?: (msg: string) => void;
}

export async function listTournaments(opts: Pick<FetchOptions, 'fetch' | 'log'> = {}): Promise<LimitlessTournament[]> {
  const body = await getJson(`${LIMITLESS_API}/tournaments?game=${LIMITLESS_GAME}&limit=10000`, opts.fetch ?? fetch, opts.log ?? (() => undefined));
  if (!Array.isArray(body)) throw new Error('A lista de torneios veio num formato inesperado.');
  return body as LimitlessTournament[];
}

/** As decklists de um torneio: do cache, ou da API (e então gravadas no cache). */
export async function tournamentDecks(t: LimitlessTournament, opts: FetchOptions): Promise<TournamentDecks> {
  const file = join(opts.cacheDir, `${t.id.replace(/[^a-z0-9]/gi, '')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as TournamentDecks;
  const body = await getJson(`${LIMITLESS_API}/tournaments/${encodeURIComponent(t.id)}/standings`, opts.fetch ?? fetch, opts.log ?? (() => undefined));
  const out: TournamentDecks = { id: t.id, date: t.date, players: t.players, decks: decksOfStandings(body) };
  mkdirSync(opts.cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}
