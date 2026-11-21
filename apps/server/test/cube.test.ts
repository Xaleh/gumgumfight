// Draft Cubo no servidor: a conta de uso a partir das decklists (cube-source.ts), os arquivos de
// `data/cubes` (cubes.ts) e o pod que drafta do Cubo, até o deck e as partidas.

import { autoBuildLimited, type CardData, cubeEligible, poolCounts, SEALED_LEADER_ID } from '@gumgum/engine';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { type DB, getCards, listCards, openDb } from '../src/db';
import { decksOfStandings, type LimitlessTournament, quarterOf, sampleTournaments, tournamentDecks, usageByCard } from '../src/draft/cube-source';
import { type CubeFile, cubes, currentCube, readCubeFiles, setCubeDir } from '../src/draft/cubes';
import type { DraftPods, PodView } from '../src/draft/pods';
import type { Lobby } from '../src/online/lobby';
import { forgetSealedSets } from '../src/sealed/store';
import { seed } from '../src/seed';

const owner = (n: number) => ({ 'x-deck-owner': `cuber-${n}-0123456789abcdef` });
const ALICE = owner(1);
const BOB = owner(2);
type App = ReturnType<typeof buildApp>;
type Headers = Record<string, string>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, headers: Headers, payload?: unknown) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
const view = async (app: App, id: string, headers: Headers) => (await call(app, 'GET', `/api/draft/pods/${id}`, headers)).json() as PodView;

/** Uma pasta de Cubos com um arquivo feito das cartas do banco de teste (as primeiras `n` que podem estar num Cubo). */
function cubeDir(db: DB, n: number, extra: Partial<CubeFile> = {}): { dir: string; ids: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'gumgum-cubes-'));
  const ids = (listCards(db) as CardData[]).filter(cubeEligible).slice(0, n).map((c) => c.id);
  const file: CubeFile = {
    id: 'T9',
    name: 'Temporada de teste',
    publishedAt: '2026-11-21',
    source: { name: 'teste', url: 'https://example.com', tournaments: 2, decks: 100, from: '2026-01-01', to: '2026-11-01' },
    perColor: 70,
    cards: ids.map((id, i) => ({ id, usage: Math.round((0.4 - i / 2000) * 1000) / 1000, decks: 500 - i })),
    ...extra,
  };
  writeFileSync(join(dir, `${file.id.toLowerCase()}.json`), JSON.stringify(file));
  return { dir, ids };
}

function setup(cards = 400) {
  const db = openDb(':memory:');
  seed(db);
  const cube = cubeDir(db, cards);
  setCubeDir(cube.dir);
  let clock = Date.UTC(2026, 10, 21, 12);
  const app = buildApp(db, { server: { cardImages: true, onlineBotRooms: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => clock });
  const pods = (app as unknown as { draftPods: DraftPods }).draftPods;
  return { db, app, pods, cube, wait: (ms: number) => ((clock += ms), pods.tick()) };
}

beforeEach(() => forgetSealedSets());
afterAll(() => setCubeDir());

describe('Cubo: o uso das cartas a partir das decklists', () => {
  const entry = (set: string, number: string, count = 4) => ({ count, set, number, name: 'x' });
  const standing = (cards: Array<[string, string]>, leader: [string, string] = ['OP01', '001']) => ({
    player: 'someone',
    name: 'Some One',
    country: 'BR',
    decklist: { leader: entry(...leader, 1), character: cards.slice(0, 6).map(([s, n]) => entry(s, n)), event: cards.slice(6, 8).map(([s, n]) => entry(s, n)), stage: cards.slice(8).map(([s, n]) => entry(s, n)) },
  });
  const nine: Array<[string, string]> = Array.from({ length: 9 }, (_, i) => ['OP01', String(i + 10).padStart(3, '0')]);

  it('de cada decklist ficam só as cartas (sem o Líder, sem jogador), uma vez cada', () => {
    const decks = decksOfStandings([standing(nine), { player: 'x', decklist: null }, standing([...nine, ['op02', '004']]), { decklist: { character: [entry('OP01', '010')] } }]);
    expect(decks).toHaveLength(2);
    expect(decks[0]).toEqual(nine.map(([s, n]) => `${s}-${n}`));
    expect(decks[1]).toContain('OP02-004');
    expect(decks[0]).not.toContain('OP01-001');
    expect(JSON.stringify(decks)).not.toMatch(/someone|Some One|BR/);
    expect(decksOfStandings({ nope: true })).toEqual([]);
  });

  it('a amostra são os maiores torneios de cada trimestre, sem formatos fora do padrão', () => {
    const t = (id: string, date: string, players: number, format: string | null = null): LimitlessTournament => ({ id, game: 'OP', format, name: id, date, players });
    expect(quarterOf('2026-11-20T17:15:00.000Z')).toBe('2026Q4');
    expect(quarterOf('2024-01-02T00:00:00.000Z')).toBe('2024Q1');
    const sample = sampleTournaments(
      [t('a', '2024-01-10', 40), t('b', '2024-02-10', 90), t('c', '2024-03-10', 64), t('d', '2024-03-11', 20), t('e', '2024-05-01', 33), t('f', '2024-05-02', 500, 'CUSTOM'), t('g', '1970-01-01', 99), { ...t('h', '2024-05-03', 80), game: 'PTCG' }],
      { perQuarter: 2, minPlayers: 32 },
    );
    expect(sample.map((x) => x.id)).toEqual(['b', 'c', 'e']);
  });

  it('a nota é a média dos melhores trimestres; carta nova é medida pelos trimestres que tem', () => {
    const deck = (...ids: string[]) => ids;
    const tour = (date: string, decks: string[][]) => ({ id: date, date, players: decks.length, decks });
    const many = (n: number, d: string[]) => Array.from({ length: n }, () => d);
    const { cards, quarters } = usageByCard(
      [
        tour('2024-01-05', [...many(60, deck('OLD', 'ALWAYS')), ...many(40, deck('ALWAYS'))]),
        tour('2024-04-05', [...many(20, deck('OLD', 'ALWAYS')), ...many(80, deck('ALWAYS'))]),
        tour('2024-07-05', [...many(50, deck('NEW', 'ALWAYS')), ...many(50, deck('ALWAYS'))]),
        tour('2024-10-05', [deck('TINY')]), // trimestre com poucos decks: não entra
      ],
      100,
    );
    expect(quarters.map((q) => q.quarter)).toEqual(['2024Q1', '2024Q2', '2024Q3']);
    expect(cards.get('ALWAYS')).toMatchObject({ usage: 1, decks: 300 });
    // OLD: 60%, 20% e 0% nos três trimestres que existem para ela.
    expect(cards.get('OLD')!.usage).toBeCloseTo((0.6 + 0.2 + 0) / 3);
    expect(cards.get('OLD')!.peak).toEqual({ quarter: '2024Q1', share: 0.6 });
    // NEW só existe no último: vale os 50% dele, sem ser diluída pelos anteriores.
    expect(cards.get('NEW')!.usage).toBeCloseTo(0.5);
    expect(cards.has('TINY')).toBe(false);
  });

  it('as decklists de um torneio são baixadas uma vez e ficam no cache, sem dados de jogador', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'gumgum-cube-cache-'));
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify([standing(nine)]), { headers: { ratelimit: '"50-in-5min"; r=40; t=300' } });
    };
    const t: LimitlessTournament = { id: 'abc123', game: 'OP', format: null, name: 'x', date: '2026-05-01T10:00:00.000Z', players: 64 };
    const first = await tournamentDecks(t, { cacheDir, fetch: fetcher });
    expect(first).toMatchObject({ id: 'abc123', players: 64 });
    expect(first.decks).toHaveLength(1);
    expect(await tournamentDecks(t, { cacheDir, fetch: fetcher })).toEqual(first);
    expect(urls).toEqual(['https://play.limitlesstcg.com/api/tournaments/abc123/standings']);
    expect(readdirSync(cacheDir)).toEqual(['abc123.json']);
    await expect(tournamentDecks({ ...t, id: 'zzz' }, { cacheDir, fetch: async () => new Response('no', { status: 500 }) })).rejects.toThrow(/HTTP 500/);
  });
});

describe('Cubo: os arquivos de data/cubes', () => {
  it('o Cubo publicado no repositório tem 420 cartas, 70 por cor no arquivo, sem repetir', () => {
    const [file] = readCubeFiles();
    expect(file).toMatchObject({ id: 'T1', perColor: 70 });
    expect(file.cards).toHaveLength(420);
    expect(new Set(file.cards.map((c) => c.id)).size).toBe(420);
    expect(file.cards.every((c) => /^[A-Z]+\d*-\d{3}$/.test(c.id) && c.usage > 0 && c.usage <= 1 && c.decks > 0)).toBe(true);
    expect(file.source.decks).toBeGreaterThan(1000);
  });

  it('o servidor fica com as cartas que tem e que podem estar num Cubo; sem cartas para um pod, o Cubo não aparece', () => {
    const db = openDb(':memory:');
    seed(db);
    const leader = (listCards(db) as CardData[]).find((c) => c.category === 'leader')!;
    const ok = cubeDir(db, 390);
    writeFileSync(join(ok.dir, 't9.json'), JSON.stringify({ ...readCubeFiles(ok.dir)[0], cards: [...readCubeFiles(ok.dir)[0].cards, { id: 'XX99-999', usage: 0.5, decks: 9 }, { id: leader.id, usage: 0.5, decks: 9 }] }));
    setCubeDir(ok.dir);
    const cube = currentCube(db)!;
    expect(cube.key).toBe('CUBE:T9');
    expect(cube.cards).toEqual(ok.ids);
    expect(cube.usage.get(ok.ids[0])).toBe(0.4);
    // 383 cartas não dão um pod de 8 (384).
    setCubeDir(cubeDir(db, 383).dir);
    expect(cubes(db)).toEqual([]);
    // O mais recente vem primeiro.
    const two = cubeDir(db, 400);
    writeFileSync(join(two.dir, 't10.json'), JSON.stringify({ ...readCubeFiles(two.dir)[0], id: 'T10', publishedAt: '2027-02-01' }));
    writeFileSync(join(two.dir, 'broken.json'), '{nope');
    setCubeDir(two.dir);
    expect(cubes(db).map((c) => c.key)).toEqual(['CUBE:T10', 'CUBE:T9']);
  });
});

describe('Draft Cubo: o pod', () => {
  it('GET /api/draft/cube devolve a lista em uso, com o uso de cada carta', async () => {
    const { app, cube } = setup();
    const got = (await call(app, 'GET', '/api/draft/cube', {})).json().cube;
    expect(got).toMatchObject({ key: 'CUBE:T9', id: 'T9', name: 'Temporada de teste', perColor: 70 });
    expect(got.cards.map((c: { id: string }) => c.id)).toEqual(cube.ids);
    expect(got.cards[0]).toEqual({ id: cube.ids[0], usage: 0.4, decks: 500 });
  });

  it('sem Cubo no servidor: a rota devolve null e o pod não abre', async () => {
    const { app } = setup(100);
    expect((await call(app, 'GET', '/api/draft/cube', {})).json()).toEqual({ cube: null });
    expect((await call(app, 'POST', '/api/draft/pods', ALICE, { cube: true })).json().errorCode).toBe('cubeUnavailable');
  });

  it('sozinho com 7 bots: os boosters saem do Cubo, sem repetir carta, e o deck aceita qualquer Líder', async () => {
    const { app, db, cube } = setup();
    const created = await call(app, 'POST', '/api/draft/pods', ALICE, { cube: true });
    expect(created.statusCode).toBe(201);
    const pod = created.json() as PodView;
    expect(pod).toMatchObject({ sets: 'CUBE:T9', status: 'waiting', capacity: 8, rounds: 4 });
    const started = (await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE)).json() as PodView;
    expect(started).toMatchObject({ status: 'drafting', packSet: 'CUBE:T9', timeLeft: 46_000 });
    expect(started.pack).toHaveLength(12);
    expect(started.pack!.every((id) => cube.ids.includes(id))).toBe(true);

    let v = started;
    const seen: string[] = [];
    for (let guard = 0; guard < 60 && v.status === 'drafting'; guard++) {
      seen.push(...v.pack!);
      v = (await call(app, 'POST', `/api/draft/pods/${pod.id}/pick`, ALICE, { card: v.pack![0] })).json() as PodView;
    }
    expect(v.status).toBe('done');
    const picks = v.picks.flat();
    expect(picks).toHaveLength(48);
    // Uma cópia de cada: nenhuma carta escolhida duas vezes.
    expect(new Set(picks).size).toBe(48);
    expect(picks.every((id) => cube.ids.includes(id))).toBe(true);

    const pool = (await call(app, 'GET', `/api/sealed/pools/${v.poolId}`, ALICE)).json();
    expect(pool).toMatchObject({ set: 'CUBE:T9', draft: true, ready: false });
    const counts = poolCounts(pool.packs);
    const catalog = new Map((getCards(db, [...counts.keys(), SEALED_LEADER_ID, 'ST10-001']) as CardData[]).map((c) => [c.id, c]));
    // Qualquer Líder do jogo, mesmo sem ter passado por nenhum booster.
    const saved = await call(app, 'PUT', `/api/sealed/pools/${v.poolId}/deck`, ALICE, autoBuildLimited(counts, catalog, 'ST10-001'));
    expect(saved.json()).toMatchObject({ ready: true, size: 40, leader: 'ST10-001' });
    // Carta de fora do que a pessoa draftou continua recusada.
    const outside = cube.ids.find((id) => !counts.has(id))!;
    const cheat = autoBuildLimited(counts, catalog, 'ST10-001');
    cheat.cards = [...cheat.cards.slice(1), { id: outside, count: cheat.cards[0].count }];
    expect((await call(app, 'PUT', `/api/sealed/pools/${v.poolId}/deck`, ALICE, cheat)).json().errorParams.issueCode).toBe('rules.notInPool');

    // O bot do treino é um dos que draftaram no pod: 40 cartas do Cubo, nenhuma das de Alice.
    const bot = (await call(app, 'POST', `/api/sealed/pools/${v.poolId}/bot`, ALICE)).json();
    expect(bot.name).toBe('Draft Cubo');
    expect(bot.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(40);
    expect(bot.cards.every((c: { id: string; count: number }) => c.count === 1 && cube.ids.includes(c.id) && !counts.has(c.id))).toBe(true);
    // Selado de Cubo não existe: os boosters do Cubo só saem num pod.
    expect((await call(app, 'POST', '/api/sealed/pools', ALICE, { set: 'CUBE:T9' })).json().errorCode).toBe('sealedSetUnavailable');
  });

  it('os bots do Cubo escolhem pelo uso da carta', async () => {
    const { app, pods } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { cube: true })).json() as PodView;
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    await view(app, pod.id, ALICE);
    // Cada bot já escolheu uma carta do primeiro booster; na média, cartas bem usadas (as primeiras do arquivo).
    const data = pods.get(pod.id)! as unknown as { draft: { picks: string[][][] } };
    const first = data.draft.picks.slice(1).map((p) => p[0][0]);
    expect(first.every(Boolean)).toBe(true);
    expect(new Set(first).size).toBe(7);
  });

  it('sala privada de Draft Cubo: só entra quem draftou no mesmo pod', async () => {
    const { app, db } = setup();
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    const build = async (headers: Headers, poolId: string) => {
      const pool = (await call(app, 'GET', `/api/sealed/pools/${poolId}`, headers)).json();
      const counts = poolCounts(pool.packs);
      const catalog = new Map((getCards(db, [...counts.keys(), SEALED_LEADER_ID]) as CardData[]).map((c) => [c.id, c]));
      expect((await call(app, 'PUT', `/api/sealed/pools/${poolId}/deck`, headers, autoBuildLimited(counts, catalog))).json().ready).toBe(true);
    };
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { cube: true })).json() as PodView;
    await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code });
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    let a = await view(app, pod.id, ALICE);
    for (let guard = 0; guard < 200 && a.status === 'drafting'; guard++) {
      for (const who of [ALICE, BOB]) {
        const v = await view(app, pod.id, who);
        if (v.pack) await call(app, 'POST', `/api/draft/pods/${pod.id}/pick`, who, { card: v.pack[0] });
      }
      a = await view(app, pod.id, ALICE);
    }
    const b = await view(app, pod.id, BOB);
    expect([a.status, b.status]).toEqual(['done', 'done']);
    // Alice e Bob não ficaram com nenhuma carta em comum.
    expect(a.picks.flat().filter((id) => b.picks.flat().includes(id))).toEqual([]);
    await build(ALICE, a.poolId!);
    await build(BOB, b.poolId!);
    const room = (await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: a.poolId, format: 'sealed' })).json();
    expect(lobby.get(room.roomId)!.data).toMatchObject({ format: 'sealed', sealedSet: 'CUBE:T9', sealedPod: pod.id });
    // Outro pod do mesmo Cubo não entra.
    const carol = owner(3);
    const other = (await call(app, 'POST', '/api/draft/pods', carol, { cube: true })).json() as PodView;
    await call(app, 'POST', `/api/draft/pods/${other.id}/start`, carol);
    let c = await view(app, other.id, carol);
    for (let guard = 0; guard < 60 && c.status === 'drafting'; guard++) c = (await call(app, 'POST', `/api/draft/pods/${other.id}/pick`, carol, { card: c.pack![0] })).json() as PodView;
    await build(carol, c.poolId!);
    expect((await call(app, 'POST', '/api/online/rooms/join', carol, { code: room.code, deckId: c.poolId })).json().errorCode).toBe('sealedRoomIsDraft');
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code: room.code, deckId: b.poolId })).statusCode).toBe(200);
    expect(lobby.get(room.roomId)!.data.seats.map((s) => s.deck.name)).toEqual(['Draft Cubo', 'Draft Cubo']);
  });
});
