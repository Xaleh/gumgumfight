// Regras dos torneios, sem banco: classificação, desempates, pareamentos e
// melhor de N. No One Piece TCG não há empate: toda partida tem vencedor.
//
// Suíço: vitória vale 3 pontos e o bye conta como vitória. Desempates (como nos
// torneios oficiais): % de vitórias dos oponentes (OMW) e % de vitórias dos
// oponentes dos oponentes (OOMW); o % de cada jogador nunca fica abaixo de 33%.
// Cada rodada pareia quem tem a mesma pontuação, sem repetir confrontos; com número
// ímpar de jogadores, o último colocado que ainda não teve bye fica de fora.
// Opcionalmente, depois do suíço os melhores colocados vão para o top cut
// (eliminação simples semeada pela classificação).
//
// Eliminação simples: a chave tem o tamanho da próxima potência de 2; as vagas que
// sobram viram byes para os primeiros cabeças de chave. Os cabeças 1 e 2 só podem
// se cruzar na final.
//
// Melhor de N: cada partida (série) termina quando alguém vence a maioria dos jogos.

export type Structure = 'swiss' | 'single';
export type Stage = 'swiss' | 'elim';
export type MatchResult = 'p1' | 'p2' | 'bye';

export const WIN_POINTS = 3;
const MIN_WIN_RATE = 1 / 3;

export interface TPlayer {
  userId: string;
  /** Ordem sorteada no início (desempate final e cabeças de chave). */
  seed: number;
  dropped: boolean;
}

export interface TMatch {
  round: number;
  stage: Stage;
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
  /** Suíço (ou a chave inteira, na eliminação simples). */
  points: number;
  wins: number;
  losses: number;
  byes: number;
  /** % de vitórias dos oponentes (0..1). */
  omw: number;
  /** % de vitórias dos oponentes dos oponentes (0..1). */
  oomw: number;
  dropped: boolean;
  /** Entrou na fase eliminatória (top cut ou eliminação simples). */
  inElim: boolean;
  /** Vitórias na fase eliminatória (inclui byes). */
  elimWins: number;
  /** Ainda vivo na fase eliminatória. */
  alive: boolean;
}

/** Vitórias necessárias numa melhor de N. */
export const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1;

/**
 * Melhor de quantos numa rodada eliminatória com `size` vagas (2 = final, 4 =
 * semifinal…): melhor de 5 a partir de `bo5From`, senão melhor de 3 a partir de
 * `bo3From` (o tamanho da fase), senão jogo único.
 */
export function elimBestOf(size: number, cfg: { bo3From: number | null; bo5From: number | null }): number {
  if (cfg.bo5From && size <= cfg.bo5From) return 5;
  if (cfg.bo3From && size <= cfg.bo3From) return 3;
  return 1;
}

/** Nome da fase eliminatória pelo número de vagas. */
export function elimLabel(size: number): string {
  if (size <= 2) return 'Final';
  if (size === 4) return 'Semifinal';
  if (size === 8) return 'Quartas de final';
  if (size === 16) return 'Oitavas de final';
  return `Rodada de ${size}`;
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
  byes: number;
  played: number;
  opponents: string[];
}

function records(players: TPlayer[], matches: TMatch[]) {
  const recs = new Map<string, Record_>();
  for (const p of players) recs.set(p.userId, { points: 0, wins: 0, losses: 0, byes: 0, played: 0, opponents: [] });
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
    const [w, l] = m.result === 'p1' ? [a, b] : [b, a];
    w.points += WIN_POINTS;
    w.wins++;
    l.losses++;
  }
  return recs;
}

const winRate = (r: Record_) => (r.played ? Math.max(MIN_WIN_RATE, r.points / (WIN_POINTS * r.played)) : MIN_WIN_RATE);

/**
 * Classificação. A base é o suíço (pontos, OMW, OOMW e a ordem sorteada); na
 * eliminação simples, a base usa todas as partidas. Quem entrou na fase
 * eliminatória fica acima de quem não entrou, ordenado por quão longe chegou.
 */
export function standings(players: TPlayer[], matches: TMatch[]): Standing[] {
  const swiss = matches.filter((m) => m.stage === 'swiss');
  const elim = matches.filter((m) => m.stage === 'elim');
  const recs = records(players, swiss.length ? swiss : matches);
  const mw = new Map([...recs].map(([id, r]) => [id, winRate(r)]));
  const avg = (ids: string[], f: (id: string) => number) => (ids.length ? ids.reduce((s, id) => s + f(id), 0) / ids.length : 0);
  const omw = new Map([...recs].map(([id, r]) => [id, avg(r.opponents, (o) => mw.get(o) ?? MIN_WIN_RATE)]));
  const oomw = new Map([...recs].map(([id, r]) => [id, avg(r.opponents, (o) => omw.get(o) ?? 0)]));
  const inElim = new Set(elim.flatMap((m) => [m.p1, m.p2]).filter((id): id is string => Boolean(id)));
  const elimWins = new Map<string, number>();
  const eliminated = new Set<string>();
  for (const m of elim) {
    const w = winnerOf(m);
    if (w) elimWins.set(w, (elimWins.get(w) ?? 0) + 1);
    const l = loserOf(m);
    if (l) eliminated.add(l);
  }
  const rows = players.map((p) => {
    const r = recs.get(p.userId)!;
    return {
      rank: 0,
      userId: p.userId,
      points: r.points,
      wins: r.wins,
      losses: r.losses,
      byes: r.byes,
      omw: omw.get(p.userId)!,
      oomw: oomw.get(p.userId)!,
      dropped: p.dropped,
      inElim: inElim.has(p.userId),
      elimWins: elimWins.get(p.userId) ?? 0,
      alive: inElim.has(p.userId) && !eliminated.has(p.userId) && !p.dropped,
      seed: p.seed,
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.inElim) - Number(a.inElim) ||
      b.elimWins - a.elimWins ||
      Number(b.alive) - Number(a.alive) ||
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
  const order = standings(players, matches)
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

/** Primeira rodada da eliminação simples (ou do top cut), pela ordem dos cabeças de chave (`seed`). */
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
