// Regras dos torneios, sem banco: classificação, desempates e pareamentos.
//
// Suíço: vitória vale 3 pontos, empate 1 e o bye conta como vitória. Desempates
// (como nos torneios oficiais): % de vitórias dos oponentes (OMW) e % de vitórias
// dos oponentes dos oponentes (OOMW); o % de cada jogador nunca fica abaixo de 33%.
// Cada rodada pareia quem tem a mesma pontuação, sem repetir confrontos; com número
// ímpar de jogadores, o último colocado que ainda não teve bye fica de fora.
//
// Eliminação simples: a chave tem o tamanho da próxima potência de 2; as vagas que
// sobram viram byes para os primeiros cabeças de chave (sorteados no início). Os
// cabeças 1 e 2 só podem se cruzar na final. Não há empate: o organizador decide.

export type Structure = 'swiss' | 'single';
export type MatchResult = 'p1' | 'p2' | 'draw' | 'bye';

export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
const MIN_WIN_RATE = 1 / 3;

export interface TPlayer {
  userId: string;
  /** Ordem sorteada no início (desempate final e cabeças de chave). */
  seed: number;
  dropped: boolean;
}

export interface TMatch {
  round: number;
  table: number;
  p1: string;
  /** null = bye. */
  p2: string | null;
  result: MatchResult | null;
}

export interface Pairing {
  p1: string;
  p2: string | null;
}

export interface Standing {
  rank: number;
  userId: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  /** % de vitórias dos oponentes (0..1). */
  omw: number;
  /** % de vitórias dos oponentes dos oponentes (0..1). */
  oomw: number;
  dropped: boolean;
  /** Eliminação simples: ainda está na chave. */
  alive: boolean;
}

/** Rodadas sugeridas para o suíço: o bastante para sobrar um só invicto. */
export function swissRounds(players: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, players))));
}

/** Rodadas da eliminação simples. */
export function singleRounds(players: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, players))));
}

/** Vencedor de uma partida com resultado (null = empate ou pendente). */
export function winnerOf(m: Pick<TMatch, 'p1' | 'p2' | 'result'>): string | null {
  if (m.result === 'p1' || m.result === 'bye') return m.p1;
  if (m.result === 'p2') return m.p2;
  return null;
}

export function loserOf(m: Pick<TMatch, 'p1' | 'p2' | 'result'>): string | null {
  if (m.result === 'p1') return m.p2;
  if (m.result === 'p2') return m.p1;
  return null;
}

interface Record_ {
  points: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  played: number;
  opponents: string[];
  /** Eliminação simples: perdeu alguma partida. */
  eliminated: boolean;
}

function records(players: TPlayer[], matches: TMatch[]) {
  const recs = new Map<string, Record_>();
  for (const p of players) {
    recs.set(p.userId, { points: 0, wins: 0, losses: 0, draws: 0, byes: 0, played: 0, opponents: [], eliminated: false });
  }
  for (const m of matches) {
    if (!m.result) continue;
    const a = recs.get(m.p1);
    const b = m.p2 ? recs.get(m.p2) : undefined;
    if (m.result === 'bye') {
      if (a) {
        a.points += WIN_POINTS;
        a.wins++;
        a.byes++;
        a.played++;
      }
      continue;
    }
    if (!a || !b) continue;
    a.played++;
    b.played++;
    a.opponents.push(m.p2!);
    b.opponents.push(m.p1);
    if (m.result === 'draw') {
      a.points += DRAW_POINTS;
      b.points += DRAW_POINTS;
      a.draws++;
      b.draws++;
    } else {
      const [w, l] = m.result === 'p1' ? [a, b] : [b, a];
      w.points += WIN_POINTS;
      w.wins++;
      l.losses++;
      l.eliminated = true;
    }
  }
  return recs;
}

const winRate = (r: Record_) => (r.played ? Math.max(MIN_WIN_RATE, r.points / (WIN_POINTS * r.played)) : MIN_WIN_RATE);

/**
 * Classificação. Suíço: pontos, OMW, OOMW e a ordem sorteada. Eliminação simples:
 * quem chegou mais longe na chave (vitórias), quem ainda está vivo e os mesmos desempates.
 */
export function standings(players: TPlayer[], matches: TMatch[], structure: Structure): Standing[] {
  const recs = records(players, matches);
  const mw = new Map([...recs].map(([id, r]) => [id, winRate(r)]));
  const avg = (ids: string[], f: (id: string) => number) => (ids.length ? ids.reduce((s, id) => s + f(id), 0) / ids.length : 0);
  const omw = new Map([...recs].map(([id, r]) => [id, avg(r.opponents, (o) => mw.get(o) ?? MIN_WIN_RATE)]));
  const oomw = new Map([...recs].map(([id, r]) => [id, avg(r.opponents, (o) => omw.get(o) ?? 0)]));
  const rows = players.map((p) => {
    const r = recs.get(p.userId)!;
    return {
      rank: 0,
      userId: p.userId,
      points: r.points,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      byes: r.byes,
      omw: omw.get(p.userId)!,
      oomw: oomw.get(p.userId)!,
      dropped: p.dropped,
      alive: structure === 'single' && !r.eliminated && !p.dropped,
      seed: p.seed,
    };
  });
  rows.sort(
    (a, b) =>
      (structure === 'single' ? b.wins - a.wins || Number(b.alive) - Number(a.alive) : 0) ||
      b.points - a.points ||
      b.omw - a.omw ||
      b.oomw - a.oomw ||
      a.seed - b.seed,
  );
  return rows.map(({ seed: _seed, ...r }, i) => ({ ...r, rank: i + 1 }));
}

/** Pareamentos da próxima rodada do suíço (quem desistiu fica de fora). */
export function swissPairings(players: TPlayer[], matches: TMatch[]): Pairing[] {
  const active = new Set(players.filter((p) => !p.dropped).map((p) => p.userId));
  const order = standings(players, matches, 'swiss')
    .filter((s) => active.has(s.userId))
    .map((s) => s.userId);
  const played = new Set<string>();
  const hadBye = new Set<string>();
  for (const m of matches) {
    if (m.p2) played.add(`${m.p1}|${m.p2}`).add(`${m.p2}|${m.p1}`);
    else hadBye.add(m.p1);
  }
  const out: Pairing[] = [];
  let pool = order;
  if (pool.length % 2) {
    // Bye: o último colocado que ainda não teve um (se todos já tiveram, o último).
    const bye = [...pool].reverse().find((id) => !hadBye.has(id)) ?? pool[pool.length - 1];
    pool = pool.filter((id) => id !== bye);
    out.push({ p1: bye, p2: null });
  }
  const pairs = pairUp(pool, (a, b) => !played.has(`${a}|${b}`)) ?? pairUp(pool, () => true)!;
  return [...pairs, ...out];
}

/**
 * Pareia a lista em ordem (o primeiro com o mais próximo possível), voltando atrás
 * quando um confronto repetido não deixa fechar a rodada. null = impossível sem repetir.
 */
function pairUp(ids: string[], ok: (a: string, b: string) => boolean): Pairing[] | null {
  let budget = 50_000;
  const go = (rest: string[]): Pairing[] | null => {
    if (!rest.length) return [];
    if (--budget < 0) return null;
    const [a, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      if (!ok(a, others[i])) continue;
      const tail = go([...others.slice(0, i), ...others.slice(i + 1)]);
      if (tail) return [{ p1: a, p2: others[i] }, ...tail];
    }
    return null;
  };
  return go(ids);
}

/** Posições dos cabeças de chave (1-based) numa chave de `size` vagas: 1 e 2 só se cruzam na final. */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Primeira rodada da eliminação simples, pela ordem dos cabeças de chave. */
export function singleFirstRound(players: TPlayer[]): Pairing[] {
  const seeded = players.filter((p) => !p.dropped).sort((a, b) => a.seed - b.seed);
  const size = 2 ** singleRounds(seeded.length);
  const order = bracketOrder(size);
  const out: Pairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = seeded[order[i] - 1];
    const b = seeded[order[i + 1] - 1];
    if (a && b) out.push({ p1: a.userId, p2: b.userId });
    else if (a || b) out.push({ p1: (a ?? b)!.userId, p2: null });
  }
  return out;
}

/**
 * Rodada seguinte da eliminação simples: os vencedores de mesas vizinhas se
 * enfrentam. Quem desistiu depois de vencer dá bye ao oponente.
 */
export function singleNextRound(players: TPlayer[], previous: TMatch[]): Pairing[] {
  const dropped = new Set(players.filter((p) => p.dropped).map((p) => p.userId));
  const winners = [...previous].sort((a, b) => a.table - b.table).map(winnerOf);
  const out: Pairing[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    const pair = [winners[i], winners[i + 1]].filter((id): id is string => Boolean(id));
    const alive = pair.filter((id) => !dropped.has(id));
    if (alive.length === 2) out.push({ p1: alive[0], p2: alive[1] });
    else if (alive.length === 1) out.push({ p1: alive[0], p2: null });
    else if (pair.length) out.push({ p1: pair[0], p2: null });
  }
  return out;
}
