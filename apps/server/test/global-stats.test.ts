import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, upsertGoogleUser } from '../src/auth/store';
import type { GlobalStatsOptions } from '../src/config';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import {
  formatSyncResult,
  globalPrevious,
  globalTrend,
  listGlobalQueues,
  normalizeSnapshot,
  queueFormat,
  queueMinBounty,
  queueWindow,
  syncGlobalStats,
} from '../src/stats/global';

/** Cinco Líderes da fila "lw" de verdade (26/10/2026), com os matchups só entre eles. */
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'logpose-lw.json'), 'utf8')) as Array<Record<string, unknown>>;
const API: GlobalStatsOptions = { apiKey: 'k-1', client: 'gumgum', apiUrl: 'https://optcg-api.example' };
const JSON_URL = 'https://res.cloudinary.example/optcg/stats/lw.json?s=abc';

/** API de mentira: confere os dois headers, lista as filas e entrega a URL assinada; o JSON mora noutro host. */
function fakeApi(opts: { lastModified?: string | null; body?: unknown; queues?: Array<{ key: string; name: string }>; special?: 'error' } = {}) {
  const state = {
    lastModified: opts.lastModified === undefined ? '2026-10-26T18:36:57.000Z' : opts.lastModified,
    body: opts.body ?? FIXTURE,
    calls: [] as string[],
  };
  const queues = opts.queues ?? [
    { key: 'lw', name: 'LW Standard' },
    { key: 'Special_Queue', name: 'Special Queue' },
  ];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    state.calls.push(url);
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (url.startsWith(JSON_URL)) return Response.json(state.body);
    if (h['x-client-name'] !== 'gumgum' || h['x-api-key'] !== 'k-1') return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (url === `${API.apiUrl}/stats`) return Response.json({ queues });
    if (url === `${API.apiUrl}/stats/Special_Queue`) return Response.json({ error: 'Cloudinary não configurado' }, { status: 503 });
    const key = url.startsWith(`${API.apiUrl}/stats/`) ? decodeURIComponent(url.slice(`${API.apiUrl}/stats/`.length)) : '';
    if (queues.some((q) => q.key === key)) return Response.json({ queue: key, url: JSON_URL, urlExpiresAt: '2026-10-26T23:32:51.633Z', lastModified: state.lastModified });
    return new Response('nada', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, state };
}

const DAY = (s: string) => () => Date.parse(`${s}T12:00:00Z`);

describe('Meta global: adaptador do JSON da OPTCG Logpose API', () => {
  it('converte LeaderStat[] para Líderes e matchups com contagens de primeiro e segundo', () => {
    const s = normalizeSnapshot(FIXTURE);
    expect(s.leaders.map((l) => l.leader)).toEqual(['OP17-039', 'ST30-001', 'OP13-004', 'OP17-079', 'OP05-098']);
    const rocks = s.leaders[0];
    expect(rocks).toMatchObject({ label: 'Rocks.D.Xebec', games: 44841, wins: 24146 });
    // Quem começou só é conhecido numa parte das partidas: as contagens vêm da soma dos matchups.
    const mine = s.matchups.filter((m) => m.leader === 'OP17-039');
    expect(mine).toHaveLength(5);
    expect(rocks.firstGames).toBe(mine.reduce((n, m) => n + m.firstGames, 0));
    expect(rocks.firstWins).toBe(mine.reduce((n, m) => n + m.firstWins, 0));
    expect(rocks.secondGames).toBe(mine.reduce((n, m) => n + m.secondGames, 0));
    expect(rocks.firstGames + rocks.secondGames).toBeLessThan(rocks.games);
    const vsLuffyAce = mine.find((m) => m.oppLeader === 'ST30-001')!;
    expect(vsLuffyAce).toMatchObject({ games: 3992, wins: 2285, firstGames: 577, firstWins: 346, secondGames: 881, secondWins: 487 });
    // Espelho: as duas perspectivas somam 50% e primeiro/segundo têm a mesma quantidade de jogos.
    const mirror = mine.find((m) => m.oppLeader === 'OP17-039')!;
    expect(mirror.wins * 2).toBe(mirror.games);
    expect(mirror.firstGames).toBe(mirror.secondGames);
  });

  it('tolera campos faltando, números em texto e ids em minúsculas; descarta quem não tem partidas', () => {
    const s = normalizeSnapshot([
      { leader: 'op05-060', leaderName: 'Luffy', wins: '7', number_of_matches: '10' },
      { leader: 'OP01-001', leaderName: 'Zoro', wins: 5, number_of_matches: 0 },
      { leader: '', number_of_matches: 3 },
      null,
      { leader: 'OP02-001', leaderName: 'Whitebeard', wins: 9, number_of_matches: 4, matchups: [{ opponent: 'OP05-060', wins: 4, total_games: 2 }] },
    ]);
    expect(s.leaders.map((l) => [l.leader, l.games, l.wins])).toEqual([
      ['OP05-060', 10, 7],
      ['OP02-001', 4, 4],
    ]);
    expect(s.leaders[0].firstGames).toBe(0);
    // Vitórias nunca passam das partidas.
    expect(s.matchups).toEqual([{ leader: 'OP02-001', oppLeader: 'OP05-060', games: 2, wins: 2, firstGames: 0, firstWins: 0, secondGames: 0, secondWins: 0 }]);
    expect(normalizeSnapshot({ nada: 1 }).leaders).toEqual([]);
  });

  it('mapeia as filas deles para os nossos formatos e reconhece as filas por recompensa', () => {
    expect(queueFormat('lw', 'LW Standard')).toBe('standard');
    expect(queueFormat('lw_eastern', 'LW Extra Regulation')).toBe('egb');
    expect(queueFormat('Special_Queue', 'Special Queue')).toBeNull();
    expect(queueFormat('OP17-1BillionBounty', 'OP17 1Billion')).toBe('standard');
    expect(queueMinBounty('LWS2BillionBounty', 'LW Standard 2Billion')).toBe(2);
    expect(queueMinBounty('lw', 'LW Standard')).toBeNull();
    // "LW" = Last Week: janela dos últimos 7 dias; as outras filas acumulam a temporada.
    expect(queueWindow('lw', 'LW Standard')).toBe(true);
    expect(queueWindow('LWS2BillionBounty', 'LW Standard 2Billion')).toBe(true);
    expect(queueWindow('lw_eastern', 'LW Extra Regulation')).toBe(true);
    expect(queueWindow('OP17', 'OP17')).toBe(false);
    expect(queueWindow('Special_Queue', 'Special Queue')).toBe(false);
  });
});

describe('Meta global: sincronização', () => {
  it('lista as filas, baixa o JSON pela URL assinada e guarda o instantâneo e o resumo do dia', async () => {
    const db = openDb(':memory:');
    const api = fakeApi();
    const r = await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY('2026-10-26') });
    expect(r.error).toBeUndefined();
    expect(r.queues).toEqual([
      { key: 'lw', name: 'LW Standard', status: 'updated', leaders: 5 },
      { key: 'Special_Queue', name: 'Special Queue', status: 'error', error: 'respondeu 503' },
    ]);
    expect(formatSyncResult(r)).toBe('Meta global: 2 fila(s), 1 atualizada(s) (lw: 5 Líderes) | erros: Special_Queue: respondeu 503');
    const [q] = listGlobalQueues(db);
    expect(q).toMatchObject({ key: 'lw', name: 'LW Standard', sort: 0, format: 'standard', minBounty: null, lastModified: '2026-10-26T18:36:57.000Z' });
    expect(q.fetchedAt).toBe('2026-10-26T12:00:00.000Z');
    expect(db.prepare('SELECT queue, day FROM global_stats_history').all()).toEqual([{ queue: 'lw', day: '2026-10-26' }]);
    // A URL assinada é usada na hora e não fica guardada.
    expect(JSON.stringify(db.prepare('SELECT body FROM global_stats_queues').all())).not.toContain('cloudinary');
  });

  it('não baixa o JSON de novo enquanto lastModified não muda, mas registra o resumo de cada dia', async () => {
    const db = openDb(':memory:');
    const api = fakeApi();
    await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY('2026-10-26') });
    const r = await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY('2026-10-27') });
    expect(r.queues[0]).toEqual({ key: 'lw', name: 'LW Standard', status: 'unchanged', leaders: 5 });
    expect(api.state.calls.filter((u) => u.startsWith(JSON_URL))).toHaveLength(1);
    expect(db.prepare('SELECT day FROM global_stats_history ORDER BY day').all()).toEqual([{ day: '2026-10-26' }, { day: '2026-10-27' }]);
    // Mudou na API: baixa e regrava.
    api.state.lastModified = '2026-10-28T06:00:00.000Z';
    const r3 = await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY('2026-10-28') });
    expect(r3.queues[0].status).toBe('updated');
    expect(api.state.calls.filter((u) => u.startsWith(JSON_URL))).toHaveLength(2);
  });

  it('chave recusada ou API fora não derruba nada: o que já foi baixado continua servindo', async () => {
    const db = openDb(':memory:');
    const api = fakeApi();
    await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY('2026-10-26') });
    const bad = await syncGlobalStats(db, { api: { ...API, apiKey: 'errada' }, fetchImpl: api.fetchImpl });
    expect(bad).toEqual({ queues: [], error: 'chave ou cliente recusados (401)' });
    const down = await syncGlobalStats(db, { api: API, fetchImpl: (async () => new Response('x', { status: 502 })) as typeof fetch });
    expect(down.error).toBe('respondeu 502');
    expect(listGlobalQueues(db)).toHaveLength(1);
  });

  /** Uma fila só, com um resumo por chamada de `run(dia, partidas, vitórias)` (Zoro fica parado em 100/50). */
  const history = (key: string, name: string) => {
    const db = openDb(':memory:');
    const api = fakeApi({ queues: [{ key, name }] });
    const run = async (day: string, games: number, wins: number) => {
      api.state.lastModified = `${day}T06:00:00.000Z`;
      api.state.body = [
        { leader: 'OP05-060', leaderName: 'Luffy', wins, number_of_matches: games },
        { leader: 'OP01-001', leaderName: 'Zoro', wins: 50, number_of_matches: 100 },
      ];
      await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY(day) });
    };
    return { db, run };
  };

  it('numa fila "LW" (janela de 7 dias), cada semana é o último resumo dela', async () => {
    const { db, run } = history('lw', 'LW Standard');
    await run('2026-10-13', 100, 50);
    await run('2026-10-15', 120, 60);
    await run('2026-10-22', 200, 110);
    const t = globalTrend(db, 'lw', 4, new Date('2026-10-23T12:00:00Z'));
    expect(t.weeks).toEqual(['2026-10-12', '2026-10-19']);
    expect(t.rows).toEqual([
      { week: '2026-10-12', leader: 'OP05-060', games: 120, wins: 60 },
      { week: '2026-10-12', leader: 'OP01-001', games: 100, wins: 50 },
      { week: '2026-10-19', leader: 'OP05-060', games: 200, wins: 110 },
      { week: '2026-10-19', leader: 'OP01-001', games: 100, wins: 50 },
    ]);
  });

  it('a seta de subiu/desceu compara com o resumo de 7 dias antes (ou o mais recente diferente)', async () => {
    const { db, run } = history('lw', 'LW Standard');
    // Um resumo só: nada para comparar.
    await run('2026-10-10', 80, 40);
    expect(globalPrevious(db, 'lw')).toBeNull();
    // Dia seguinte, dados novos: compara com a véspera (ainda não há uma semana).
    await run('2026-10-11', 90, 45);
    let p = globalPrevious(db, 'lw')!;
    expect(p.day).toBe('2026-10-10');
    expect(p.leaders.get('OP01-001')).toEqual({ rank: 1, games: 100, wins: 50 });
    expect(p.leaders.get('OP05-060')).toEqual({ rank: 2, games: 80, wins: 40 });
    // Uma semana depois: vale o resumo de 7 dias antes, não a véspera.
    await run('2026-10-17', 95, 50);
    await run('2026-10-18', 150, 80);
    p = globalPrevious(db, 'lw')!;
    expect(p.day).toBe('2026-10-11');
    // A API não mudou no dia seguinte (resumo igual): continua comparando com o mesmo dia.
    const api = fakeApi({ queues: [{ key: 'lw', name: 'LW Standard' }], lastModified: '2026-10-18T06:00:00.000Z' });
    await syncGlobalStats(db, { api: API, fetchImpl: api.fetchImpl, now: DAY('2026-10-19') });
    expect(globalPrevious(db, 'lw')!.day).toBe('2026-10-11');
  });

  it('numa fila acumulada (temporada), a semana é a diferença entre os últimos resumos de semanas seguidas', async () => {
    const { db, run } = history('OP17', 'OP17');
    // Semana de 12/10: dois resumos (vale o último); 19/10; 26/10 (segunda).
    await run('2026-10-13', 100, 50);
    await run('2026-10-15', 120, 60);
    await run('2026-10-22', 200, 110);
    await run('2026-10-26', 230, 120);
    const t = globalTrend(db, 'OP17', 4, new Date('2026-10-28T12:00:00Z'));
    expect(t.since).toBe('2026-10-13');
    // A primeira semana não tem base; as duas seguintes são diferenças.
    expect(t.weeks).toEqual(['2026-10-19', '2026-10-26']);
    expect(t.rows).toEqual([
      { week: '2026-10-19', leader: 'OP05-060', games: 80, wins: 50 },
      { week: '2026-10-26', leader: 'OP05-060', games: 30, wins: 10 },
    ]);
    // Fila recalculada para menos: a diferença negativa vira zero (linha some), nunca negativa.
    await run('2026-10-27', 50, 20);
    const t2 = globalTrend(db, 'OP17', 4, new Date('2026-10-28T12:00:00Z'));
    expect(t2.rows.filter((r) => r.week === '2026-10-26')).toEqual([]);
  });
});

describe('Meta global: rotas', () => {
  function setup(global: GlobalStatsOptions | null = API) {
    const db = openDb(':memory:');
    seed(db);
    const api = fakeApi();
    const app = buildApp(db, { server: { cardImages: true, adminEmails: ['admin@example.com'], globalStats: global }, fetchImpl: api.fetchImpl });
    return { db, app, api };
  }
  const admin = (db: DB) => {
    const u = upsertGoogleUser(db, { sub: 'adm', email: 'admin@example.com', emailVerified: true, name: 'Adm', picture: null }, ['admin@example.com']);
    return { cookie: `gg_session=${createSession(db, u.id)}` };
  };

  it('sem a chave, o meta global não existe: /api/stats/meta diz null e as rotas dão 404', async () => {
    const { app } = setup(null);
    expect((await app.inject('/api/stats/meta')).json().global).toBeNull();
    expect((await app.inject('/api/stats/global')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/admin/stats/global/sync' })).statusCode).toBe(401);
  });

  it('antes do primeiro sync, responde vazio; o admin força uma rodada e as rotas passam a servir a fila', async () => {
    const { db, app } = setup();
    expect((await app.inject('/api/stats/meta')).json().global).toEqual({ queues: [] });
    expect((await app.inject('/api/stats/global?queue=lw')).json()).toMatchObject({ queue: null, queues: [], leaders: [] });

    expect((await app.inject({ method: 'POST', url: '/api/admin/stats/global/sync' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/api/admin/stats/global/sync', headers: admin(db) });
    expect(r.statusCode).toBe(200);
    expect(r.json().queues[0]).toMatchObject({ key: 'lw', status: 'updated', leaders: 5 });

    const meta = (await app.inject('/api/stats/meta')).json();
    expect(meta.global.queues).toHaveLength(1);
    expect(meta.global.queues[0]).toMatchObject({ key: 'lw', name: 'LW Standard', format: 'standard' });

    const g = (await app.inject('/api/stats/global?queue=lw')).json();
    expect(g.queue.key).toBe('lw');
    expect(g.summary).toMatchObject({ games: 115827, matches: 57914, players: 0 });
    expect(g.summary.first.games).toBeGreaterThan(0);
    expect(g.leaders[0]).toMatchObject({ leader: 'OP17-039', games: 44841, wins: 24146, lists: 0, rank: 1, prevRank: null });
    // Primeiro resumo: ainda não há com o que comparar a posição.
    expect(g.previous).toBeNull();
    expect(g.leaders[0].secondGames).toBeGreaterThan(0);
    // A matriz (os 10 mais jogados): aqui, os 5 do recorte entre si.
    expect(g.matchups.length).toBe(25);
    // Carta do nosso banco: nome e cores de lá; carta que não temos: o nome que a API deu.
    expect(g.cards['ST30-001']).toMatchObject({ name: 'Luffy & Ace', category: 'leader' });
    expect(g.cards['ST30-001'].colors.length).toBeGreaterThan(0);
    expect(g.cards['OP17-039']).toEqual({ name: 'Rocks.D.Xebec', category: 'leader', colors: [] });
    // Fila desconhecida: cai na primeira.
    expect((await app.inject('/api/stats/global?queue=xyz')).json().queue.key).toBe('lw');

    // Os matchups de um Líder saem à parte (a fila inteira teria milhares de pares).
    const m = (await app.inject('/api/stats/global/matchups?queue=lw&leader=op17-039')).json();
    expect(m.leader).toBe('OP17-039');
    expect(m.matchups).toHaveLength(5);
    expect(m.matchups.every((x: { leader: string }) => x.leader === 'OP17-039')).toBe(true);
    expect(m.cards['ST30-001'].name).toBe('Luffy & Ace');
    expect((await app.inject('/api/stats/global/matchups?queue=lw')).statusCode).toBe(400);
  });

  it('compara o mesmo Líder aqui e lá; fila sem formato equivalente não compara', async () => {
    const { db, app } = setup();
    await app.inject({ method: 'POST', url: '/api/admin/stats/global/sync', headers: admin(db) });
    const c = (await app.inject('/api/stats/global/compare?queue=lw')).json();
    expect(c).toMatchObject({ format: 'standard', here: { games: 0 }, global: { games: 115827 } });
    expect(c.rows[0]).toEqual({ leader: 'OP17-039', here: null, global: { games: 44841, wins: 24146 } });
    expect(c.rows).toHaveLength(5);
    expect(c.cards['OP17-039'].name).toBe('Rocks.D.Xebec');
    // Formato explícito vale sobre o da fila.
    expect((await app.inject('/api/stats/global/compare?queue=lw&format=egb')).json().format).toBe('egb');
    // A Special Queue não tem formato nosso.
    db.prepare("INSERT INTO global_stats_queues (queue, name, sort, last_modified, fetched_at, body) VALUES ('Special_Queue', 'Special Queue', 1, null, '2026-10-26T12:00:00.000Z', '{\"leaders\":[],\"matchups\":[]}')").run();
    expect((await app.inject('/api/stats/global/compare?queue=Special_Queue')).statusCode).toBe(400);
  });

  it('a tendência de uma fila "LW" já tem a semana atual e informa desde quando há resumos', async () => {
    const { db, app } = setup();
    await app.inject({ method: 'POST', url: '/api/admin/stats/global/sync', headers: admin(db) });
    const t = (await app.inject('/api/stats/global/trend?queue=lw&weeks=4')).json();
    expect(t.queue.key).toBe('lw');
    // "LW" é uma janela de 7 dias: o primeiro resumo já é a semana atual.
    expect(t.weeks).toHaveLength(1);
    expect(t.rows).toHaveLength(5);
    expect(t.rows[0]).toMatchObject({ leader: 'OP17-039', games: 44841, wins: 24146 });
    expect(t.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
