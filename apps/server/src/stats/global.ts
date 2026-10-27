// Meta global: estatísticas das filas do TCG Matchmaking (a ranqueada por Discord do
// OPTCGSim), publicadas pela OPTCG Logpose API do Matheus (https://optcg-api.vercel.app/docs).
//
// A API tem três rotas, todas com os headers `x-client-name` e `x-api-key`:
//   GET /health          { status }
//   GET /stats           { queues: [{ key, name }] }
//   GET /stats/{queue}   { queue, url, urlExpiresAt, lastModified }: URL assinada (1 h) do JSON
// O JSON da fila é uma lista de `LeaderStat`: leader (id de carta), leaderName, wins,
// number_of_matches (partidas do Líder), raw_win_rate, play_rate, first_win_rate,
// second_win_rate (porcentagens) e matchups[] (opponent, wins, total_games, first_wins,
// first_games, second_wins, second_games...). Quem começou só é conhecido numa parte das
// partidas, por isso guardamos as contagens de primeiro e de segundo separadas.
//
// Dois tipos de fila: as "LW" (Last Week: `lw`, `lw_eastern`, `LWS1BillionBounty`...) são uma
// janela móvel dos últimos 7 dias, recalculada a cada atualização; as outras (`OP17`...) somam a
// temporada inteira. Isso muda a tendência: numa janela, cada resumo já é "a semana"; num total
// acumulado, a semana é a diferença entre dois resumos.
//
// O navegador nunca fala com a API (a chave ficaria exposta): o servidor busca de tempos em
// tempos (`scheduleGlobalStatsSync`), guarda o último JSON normalizado de cada fila
// (`global_stats_queues`) e um resumo diário dos Líderes (`global_stats_history`, para a
// tendência), e as rotas de /api/stats/global* só leem o banco. A URL assinada vence em uma
// hora e nunca é guardada; se `lastModified` não mudou, o JSON não é baixado de novo.

import { dataVersion } from '../cache';
import type { GlobalStatsOptions } from '../config';
import type { DB } from '../db';
import type { FormatId } from './catalog';

export interface GlobalQueue {
  /** Chave da fila na API (`lw`, `lw_eastern`, `LWS1BillionBounty`...). */
  key: string;
  /** Nome da fila na API ("LW Standard"). */
  name: string;
  /** Ordem na lista da API. */
  sort: number;
  /** Formato nosso equivalente (para comparar); null = sem equivalente (Special Queue). */
  format: FormatId | null;
  /** Fila restrita a jogadores com recompensa acima de N bilhões (as filas "1Billion"/"2Billion"); null = aberta. */
  minBounty: number | null;
  /** Janela móvel dos últimos 7 dias (filas "LW", Last Week); false = total acumulado da temporada. */
  window: boolean;
  /** Período, para o filtro da tela: últimos 7 dias, uma temporada (`season`) ou uma fila à parte (Special Queue). */
  period: 'week' | 'season' | 'other';
  /** Coleção da temporada ("OP17"); null fora das filas de temporada. */
  season: string | null;
  /** `lastModified` do JSON na API (null = a API não informou). */
  lastModified: string | null;
  /** Quando o servidor baixou o JSON. */
  fetchedAt: string;
}

export interface GlobalLeader {
  leader: string;
  /** Nome que a API dá ao Líder (serve quando a carta não está no nosso banco). */
  label: string;
  games: number;
  wins: number;
  firstGames: number;
  firstWins: number;
  secondGames: number;
  secondWins: number;
}

export interface GlobalMatchup {
  leader: string;
  oppLeader: string;
  games: number;
  wins: number;
  firstGames: number;
  firstWins: number;
  secondGames: number;
  secondWins: number;
}

export interface GlobalSnapshot {
  leaders: GlobalLeader[];
  matchups: GlobalMatchup[];
}

/** Formato nosso de uma fila deles: Extra Regulation = EGB; a Special Queue não tem equivalente; o resto é Standard. */
export function queueFormat(key: string, name = ''): FormatId | null {
  const s = `${key} ${name}`;
  if (/special/i.test(s)) return null;
  if (/eastern|extra/i.test(s)) return 'egb';
  return 'standard';
}

/** Filas "LW" (Last Week): janela móvel dos últimos 7 dias. As outras (OP17...) acumulam a temporada. */
export function queueWindow(key: string, name = ''): boolean {
  return /^lw/i.test(key) || /^lw\b/i.test(name);
}

/** Coleção de uma fila de temporada ("OP17", "OP17-1BillionBounty" → "OP17"); null nas outras. */
export function queueSeason(key: string): string | null {
  return key.match(/^((?:OP|EB|ST|PRB)\d+)/i)?.[1].toUpperCase() ?? null;
}

/** Período da fila no filtro da tela: as "LW" são a semana; as que começam pela coleção, a temporada; o resto, à parte. */
export function queuePeriod(key: string, name = ''): GlobalQueue['period'] {
  if (queueWindow(key, name)) return 'week';
  return queueSeason(key) ? 'season' : 'other';
}

/** Filas "1Billion"/"2Billion": só jogadores com recompensa (rating deles) acima de N bilhões. */
export function queueMinBounty(key: string, name = ''): number | null {
  const m = `${key} ${name}`.match(/(\d+)\s*billion/i);
  return m ? Number(m[1]) : null;
}

type Raw = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Ids de carta vêm como na coleção ("OP17-039"); qualquer outra coisa fica como veio, em maiúsculas. */
const cardId = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** Converte a lista `LeaderStat[]` da API para o formato das nossas tabelas. Entradas sem Líder ou sem partidas ficam de fora. */
export function normalizeSnapshot(raw: unknown): GlobalSnapshot {
  const list = Array.isArray(raw) ? (raw as Raw[]) : Array.isArray((raw as Raw)?.leaders) ? ((raw as Raw).leaders as Raw[]) : [];
  const leaders: GlobalLeader[] = [];
  const matchups: GlobalMatchup[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const leader = cardId(r.leader);
    const games = num(r.number_of_matches ?? r.games);
    if (!leader || !games) continue;
    const row: GlobalLeader = {
      leader,
      label: String(r.leaderName ?? r.name ?? leader).trim() || leader,
      games,
      wins: Math.min(games, num(r.wins)),
      firstGames: 0,
      firstWins: 0,
      secondGames: 0,
      secondWins: 0,
    };
    for (const m of Array.isArray(r.matchups) ? (r.matchups as Raw[]) : []) {
      const oppLeader = cardId(m?.opponent);
      const total = num(m?.total_games ?? m?.games);
      if (!oppLeader || !total) continue;
      const mu: GlobalMatchup = {
        leader,
        oppLeader,
        games: total,
        wins: Math.min(total, num(m.wins)),
        firstGames: num(m.first_games),
        firstWins: num(m.first_wins),
        secondGames: num(m.second_games),
        secondWins: num(m.second_wins),
      };
      mu.firstWins = Math.min(mu.firstWins, mu.firstGames);
      mu.secondWins = Math.min(mu.secondWins, mu.secondGames);
      matchups.push(mu);
      row.firstGames += mu.firstGames;
      row.firstWins += mu.firstWins;
      row.secondGames += mu.secondGames;
      row.secondWins += mu.secondWins;
    }
    leaders.push(row);
  }
  leaders.sort((a, b) => b.games - a.games || a.leader.localeCompare(b.leader));
  return { leaders, matchups };
}

// ---- banco ----

interface QueueRow {
  queue: string;
  name: string;
  sort: number;
  last_modified: string | null;
  fetched_at: string;
}

const toQueue = (r: QueueRow): GlobalQueue => ({
  key: r.queue,
  name: r.name,
  sort: r.sort,
  format: queueFormat(r.queue, r.name),
  minBounty: queueMinBounty(r.queue, r.name),
  window: queueWindow(r.queue, r.name),
  period: queuePeriod(r.queue, r.name),
  season: queuePeriod(r.queue, r.name) === 'season' ? queueSeason(r.queue) : null,
  lastModified: r.last_modified,
  fetchedAt: r.fetched_at,
});

/** Filas já baixadas, na ordem da API. */
export function listGlobalQueues(db: DB): GlobalQueue[] {
  const rows = db.prepare('SELECT queue, name, sort, last_modified, fetched_at FROM global_stats_queues ORDER BY sort, queue').all() as unknown as QueueRow[];
  return rows.map(toQueue);
}

/** Último JSON normalizado de uma fila (null = fila desconhecida ou ainda não baixada). */
export function getGlobalSnapshot(db: DB, key: string): { queue: GlobalQueue; snapshot: GlobalSnapshot } | null {
  const r = db.prepare('SELECT queue, name, sort, last_modified, fetched_at, body FROM global_stats_queues WHERE queue = ?').get(key) as
    | (QueueRow & { body: string })
    | undefined;
  if (!r) return null;
  return { queue: toQueue(r), snapshot: JSON.parse(r.body) as GlobalSnapshot };
}

/** Resumo diário: `[leader, games, wins]` por Líder, bem menor que o JSON inteiro. */
type HistoryBody = Array<[string, number, number]>;

function saveSnapshot(db: DB, q: { key: string; name: string; sort: number; lastModified: string | null }, snapshot: GlobalSnapshot, now: Date) {
  const iso = now.toISOString();
  db.prepare(
    `INSERT INTO global_stats_queues (queue, name, sort, last_modified, fetched_at, body) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(queue) DO UPDATE SET name = excluded.name, sort = excluded.sort, last_modified = excluded.last_modified,
       fetched_at = excluded.fetched_at, body = excluded.body`,
  ).run(q.key, q.name, q.sort, q.lastModified, iso, JSON.stringify(snapshot));
  saveHistory(db, q.key, snapshot, now);
}

function saveHistory(db: DB, key: string, snapshot: GlobalSnapshot, now: Date) {
  const body: HistoryBody = snapshot.leaders.map((l) => [l.leader, l.games, l.wins]);
  db.prepare('INSERT OR REPLACE INTO global_stats_history (queue, day, body) VALUES (?, ?, ?)').run(key, now.toISOString().slice(0, 10), JSON.stringify(body));
}

export interface GlobalTrend {
  /** Segunda-feira de cada semana (AAAA-MM-DD), da mais antiga à atual; só as semanas com dados. */
  weeks: string[];
  rows: Array<{ week: string; leader: string; games: number; wins: number }>;
  /** Primeiro dia com resumo guardado (null = nenhum ainda). */
  since: string | null;
}

/** Segunda-feira (UTC) da semana de uma data. */
function monday(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/**
 * Uso e vitórias por Líder em cada uma das últimas `weeks` semanas, a partir dos resumos
 * diários (vale o último resumo de cada semana). Numa fila "LW" (janela dos últimos 7 dias) o
 * resumo já é a semana. Numa fila acumulada (temporada), as partidas de uma semana são a
 * diferença entre o último resumo da semana e o da semana anterior (uma semana sem resumo
 * anterior não aparece; uma diferença negativa, se a fila for recalculada, vira zero).
 */
export function globalTrend(db: DB, key: string, weeks: number, now = new Date(), window = queueWindow(key)): GlobalTrend {
  const rows = db.prepare('SELECT day, body FROM global_stats_history WHERE queue = ? ORDER BY day').all(key) as unknown as Array<{ day: string; body: string }>;
  const since = rows[0]?.day ?? null;
  // Último resumo de cada semana.
  const lastOfWeek = new Map<string, Map<string, [number, number]>>();
  for (const r of rows) {
    const wk = monday(new Date(`${r.day}T00:00:00Z`));
    lastOfWeek.set(wk, new Map((JSON.parse(r.body) as HistoryBody).map(([l, g, w]) => [l, [g, w]])));
  }
  const out: GlobalTrend = { weeks: [], rows: [], since };
  const current = monday(now);
  const list: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${current}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    list.push(d.toISOString().slice(0, 10));
  }
  const sortedWeeks = [...lastOfWeek.keys()].sort();
  for (const wk of list) {
    const end = lastOfWeek.get(wk);
    if (!end) continue;
    if (window) {
      out.weeks.push(wk);
      for (const [leader, [games, wins]] of end) if (games) out.rows.push({ week: wk, leader, games, wins: Math.min(games, wins) });
      continue;
    }
    // Base: a última semana com resumo antes desta.
    const prev = sortedWeeks.filter((w) => w < wk).pop();
    if (!prev) continue;
    const base = lastOfWeek.get(prev)!;
    out.weeks.push(wk);
    for (const [leader, [games, wins]] of end) {
      const [g0, w0] = base.get(leader) ?? [0, 0];
      const g = Math.max(0, games - g0);
      const w = Math.min(g, Math.max(0, wins - w0));
      if (g) out.rows.push({ week: wk, leader, games: g, wins: w });
    }
  }
  return out;
}

export interface GlobalPrevious {
  /** Dia (AAAA-MM-DD) do resumo usado na comparação. */
  day: string;
  /** Posição (por partidas), partidas e vitórias de cada Líder naquele dia. */
  leaders: Map<string, { rank: number; games: number; wins: number }>;
}

/**
 * Resumo para comparar com o atual (a seta de subiu/desceu): o mais recente com pelo menos
 * 7 dias de diferença e dados diferentes; sem nenhum assim (fila recém-coletada), o mais
 * recente com dados diferentes. Resumos iguais ao atual (a API não mudou) não servem.
 */
export function globalPrevious(db: DB, key: string): GlobalPrevious | null {
  const rows = db.prepare('SELECT day, body FROM global_stats_history WHERE queue = ? ORDER BY day DESC').all(key) as unknown as Array<{ day: string; body: string }>;
  const [current, ...older] = rows;
  if (!current) return null;
  const weekBefore = new Date(`${current.day}T00:00:00Z`);
  weekBefore.setUTCDate(weekBefore.getUTCDate() - 7);
  const limit = weekBefore.toISOString().slice(0, 10);
  const changed = older.filter((r) => r.body !== current.body);
  const ref = changed.find((r) => r.day <= limit) ?? changed[0];
  if (!ref) return null;
  const body = JSON.parse(ref.body) as HistoryBody;
  return { day: ref.day, leaders: new Map(body.map(([leader, games, wins], i) => [leader, { rank: i + 1, games, wins }])) };
}

// ---- cliente da API e sincronização ----

export interface SyncOptions {
  api: GlobalStatsOptions;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Tempo máximo de cada pedido (ms). */
  timeoutMs?: number;
}

export interface SyncResult {
  queues: Array<{ key: string; name: string; status: 'updated' | 'unchanged' | 'error'; leaders?: number; error?: string }>;
  /** Falha antes de chegar às filas (chave recusada, API fora). */
  error?: string;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Uma rodada: lista as filas e, para cada uma, baixa o JSON (só quando `lastModified` mudou)
 * e grava o instantâneo e o resumo do dia. Nunca lança: os erros voltam no resultado.
 */
export async function syncGlobalStats(db: DB, { api, fetchImpl = fetch, now = Date.now, timeoutMs = 15_000 }: SyncOptions): Promise<SyncResult> {
  const headers = { 'x-client-name': api.client, 'x-api-key': api.apiKey, accept: 'application/json' };
  const base = api.apiUrl.replace(/\/+$/, '');
  const getJson = async (url: string, withKey: boolean): Promise<unknown> => {
    const res = await fetchImpl(url, { headers: withKey ? headers : { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401) throw new Error('chave ou cliente recusados (401)');
    if (!res.ok) throw new Error(`respondeu ${res.status}`);
    return res.json();
  };
  const result: SyncResult = { queues: [] };
  let queues: Array<{ key: string; name: string }>;
  try {
    const body = (await getJson(`${base}/stats`, true)) as { queues?: unknown };
    queues = (Array.isArray(body?.queues) ? body.queues : [])
      .map((q: Raw) => ({ key: String(q?.key ?? '').trim(), name: String(q?.name ?? q?.key ?? '').trim() }))
      .filter((q) => q.key);
    if (!queues.length) throw new Error('lista de filas vazia');
  } catch (err) {
    result.error = errorText(err);
    return result;
  }
  const known = new Map(listGlobalQueues(db).map((q) => [q.key, q]));
  let changed = false;
  for (const [sort, q] of queues.entries()) {
    try {
      const info = (await getJson(`${base}/stats/${encodeURIComponent(q.key)}`, true)) as { url?: unknown; lastModified?: unknown };
      const lastModified = typeof info?.lastModified === 'string' ? info.lastModified : null;
      const old = known.get(q.key);
      const date = new Date(now());
      if (old && lastModified && old.lastModified === lastModified) {
        // Nada mudou na API: só garante o resumo de hoje (a tendência precisa de um por dia).
        const cur = getGlobalSnapshot(db, q.key);
        if (cur) saveHistory(db, q.key, cur.snapshot, date);
        if (old.name !== q.name || old.sort !== sort) {
          db.prepare('UPDATE global_stats_queues SET name = ?, sort = ? WHERE queue = ?').run(q.name, sort, q.key);
          changed = true;
        }
        result.queues.push({ key: q.key, name: q.name, status: 'unchanged', leaders: cur?.snapshot.leaders.length });
        continue;
      }
      if (typeof info?.url !== 'string' || !/^https?:\/\//.test(info.url)) throw new Error('sem URL do JSON');
      const snapshot = normalizeSnapshot(await getJson(info.url, false));
      if (!snapshot.leaders.length) throw new Error('JSON sem Líderes');
      saveSnapshot(db, { key: q.key, name: q.name, sort, lastModified }, snapshot, date);
      changed = true;
      result.queues.push({ key: q.key, name: q.name, status: 'updated', leaders: snapshot.leaders.length });
    } catch (err) {
      result.queues.push({ key: q.key, name: q.name, status: 'error', error: errorText(err) });
    }
  }
  if (changed) dataVersion.bump();
  return result;
}

/** Uma linha de log por rodada ("Meta global: 7 filas, 2 atualizadas | erros: ..."). */
export function formatSyncResult(r: SyncResult): string {
  if (r.error) return `Meta global: falha na sincronização: ${r.error}`;
  const updated = r.queues.filter((q) => q.status === 'updated');
  const errors = r.queues.filter((q) => q.status === 'error');
  return (
    `Meta global: ${r.queues.length} fila(s), ${updated.length} atualizada(s)` +
    (updated.length ? ` (${updated.map((q) => `${q.key}: ${q.leaders} Líderes`).join(', ')})` : '') +
    (errors.length ? ` | erros: ${errors.map((q) => `${q.key}: ${q.error}`).join('; ')}` : '')
  );
}

/** Sincroniza 20 s depois de subir e a cada `hours` horas (o resultado vai para o log). */
export function scheduleGlobalStatsSync(db: DB, opts: SyncOptions & { hours: number; log: (msg: string) => void }) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      opts.log(formatSyncResult(await syncGlobalStats(db, opts)));
    } catch (err) {
      opts.log(`Meta global: falha na sincronização: ${errorText(err)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 20_000).unref();
  setInterval(run, opts.hours * 3600_000).unref();
}
