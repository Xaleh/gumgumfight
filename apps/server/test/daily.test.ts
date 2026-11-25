import { type Action, type ChallengeMove, type GameState, resolveMove } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { DAILY_CATALOG } from '../src/daily/catalog';
import { dayOf } from '../src/daily/store';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';

const DAY_MS = 86_400_000;
/** 12/10/2026, meio-dia em Brasília. */
const T0 = Date.UTC(2026, 9, 12, 15);

function setup() {
  const clock = { t: T0 };
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => clock.t });
  return { db, app, clock };
}
type App = ReturnType<typeof buildApp>;

const browser = (id: string) => ({ headers: { 'x-deck-owner': `daily-browser-${id}-0123456789abcdef` } });
let n = 0;
function login(db: DB, role: Role) {
  const u = upsertGoogleUser(db, { sub: `dsub-${++n}`, email: `d${n}@example.com`, emailVerified: true, name: `D${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `dbrowser-${n}-0123456789abcdef` } };
}

const today = (app: App, who = browser('a')) => app.inject({ method: 'GET', url: '/api/daily', headers: who.headers });
const play = (app: App, day: string, actions: Action[], who = browser('a')) =>
  app.inject({ method: 'POST', url: '/api/daily/play', headers: who.headers, payload: { day, actions } });

/** Joga as jogadas escritas pela API, como o navegador faz: cada jogada sobre a visão que o servidor devolveu. */
async function playLine(app: App, day: string, view: GameState, moves: ChallengeMove[], who = browser('a')) {
  const actions: Action[] = [];
  let last: { status: string; view: GameState; result: { attempts: number; solved: boolean }; streak: { current: number; best: number }; error?: unknown } | null = null;
  for (const m of moves) {
    actions.push(...resolveMove(last?.view ?? view, m));
    const r = await play(app, day, actions, who);
    expect(r.statusCode).toBe(200);
    last = r.json();
    expect(last!.error).toBeUndefined();
    if (last!.status !== 'playing') break;
  }
  return last!;
}

describe('desafio do dia: fila', () => {
  it('cada dia publica o próximo do catálogo, e a solução de cada um resolve', async () => {
    const { app, clock } = setup();
    for (const [i, c] of DAILY_CATALOG.entries()) {
      clock.t = T0 + i * DAY_MS;
      const g = (await today(app, browser(`fila-${i}`))).json();
      expect(g.number).toBe(i + 1);
      expect(g.challenge.id).toBe(c.id);
      const done = await playLine(app, g.day, g.view, c.solution, browser(`fila-${i}`));
      expect(done.status, c.id).toBe('solved');
    }
    // Catálogo usado inteiro: recomeça pelo publicado há mais tempo.
    clock.t = T0 + DAILY_CATALOG.length * DAY_MS;
    const again = (await today(app)).json();
    expect(again.challenge.id).toBe(DAILY_CATALOG[0].id);
    expect(again.number).toBe(DAILY_CATALOG.length + 1);
  });

  it('a linha errada de cada desafio não resolve', async () => {
    const { app, clock } = setup();
    for (const [i, c] of DAILY_CATALOG.entries()) {
      clock.t = T0 + i * DAY_MS;
      const g = (await today(app, browser(`erro-${i}`))).json();
      const done = await playLine(app, g.day, g.view, c.wrong, browser(`erro-${i}`));
      expect(done.status, c.id).toBe('failed');
      expect(done.result).toEqual({ attempts: 1, solved: false });
    }
  });

  it('o dia publicado não muda, e o dia vira à meia-noite de Brasília', async () => {
    const { app, clock } = setup();
    const a = (await today(app)).json();
    clock.t = T0 + 3 * 3_600_000; // 15h em Brasília
    expect((await today(app)).json()).toMatchObject({ day: a.day, number: 1 });
    expect(dayOf(Date.UTC(2026, 9, 13, 2, 59))).toBe('2026-10-12');
    expect(dayOf(Date.UTC(2026, 9, 13, 3, 0))).toBe('2026-10-13');
  });
});

describe('desafio do dia: tentativas e sequência', () => {
  it('conta as tentativas até resolver; depois o resultado não muda', async () => {
    const { app } = setup();
    const g = (await today(app)).json();
    const c = DAILY_CATALOG[0];
    expect(g.result).toEqual({ attempts: 0, solved: false });
    await playLine(app, g.day, g.view, c.wrong);
    await playLine(app, g.day, g.view, c.wrong);
    const ok = await playLine(app, g.day, g.view, c.solution);
    expect(ok.result).toEqual({ attempts: 3, solved: true });
    expect(ok.streak).toMatchObject({ current: 1, best: 1 });
    await playLine(app, g.day, g.view, c.wrong);
    const after = (await today(app)).json();
    expect(after.result).toEqual({ attempts: 3, solved: true });
    expect(after.stats).toEqual({ players: 1, solvers: 1 });
    // Tentativa ainda em andamento não conta.
    const other = browser('b');
    await play(app, g.day, resolveMove(g.view, c.solution[0]), other);
    expect((await today(app, other)).json().result).toEqual({ attempts: 0, solved: false });
  });

  it('dias seguidos formam a sequência; pular um dia zera', async () => {
    const { app, clock } = setup();
    const solveToday = async () => {
      const g = (await today(app)).json();
      const c = DAILY_CATALOG.find((x) => x.id === g.challenge.id)!;
      return playLine(app, g.day, g.view, c.solution);
    };
    await solveToday();
    clock.t += DAY_MS;
    expect((await solveToday()).streak).toMatchObject({ current: 2, best: 2 });
    // Ontem resolvido e hoje ainda não: a sequência continua valendo.
    clock.t += DAY_MS;
    expect((await today(app)).json().streak).toMatchObject({ current: 2, best: 2 });
    // Pulou um dia: zera, e o recorde fica.
    clock.t += DAY_MS;
    const g = (await today(app)).json();
    expect(g.streak).toMatchObject({ current: 0, best: 2, solved: 2 });
    expect(g.history.map((h: { solved: boolean }) => h.solved)).toEqual([false, false, true, true]);
  });

  it('o desafio de ontem ainda aceita jogadas; o de antes de ontem, não', async () => {
    const { app, clock } = setup();
    const g = (await today(app)).json();
    clock.t += DAY_MS;
    const c = DAILY_CATALOG[0];
    expect((await playLine(app, g.day, g.view, c.solution)).status).toBe('solved');
    clock.t += DAY_MS;
    expect((await play(app, g.day, [])).statusCode).toBe(409);
  });
});

describe('desafio do dia: segurança', () => {
  it('a resposta não leva a solução nem as cartas escondidas do oponente', async () => {
    const { app } = setup();
    const r = await today(app);
    const text = r.body;
    expect(text).not.toMatch(/solution|wrong/);
    // A Vida do oponente no primeiro desafio é Doflamingo (ST03-009): escondida.
    expect(text).not.toContain('ST03-009');
    const g = r.json();
    expect(Object.keys(g.view.cards).some((uid: string) => uid.includes('ST0'))).toBe(false);
    expect(g.view.players[1].life.every((u: string) => g.view.cards[u].cardId === '?')).toBe(true);
  });

  it('com a mão revelada no enunciado, o jogador vê a mão do oponente', async () => {
    const { app, clock } = setup();
    const i = DAILY_CATALOG.findIndex((c) => c.id === 'reforco');
    for (let d = 0; d <= i; d++) {
      clock.t = T0 + d * DAY_MS;
      await today(app);
    }
    const g = (await today(app)).json();
    expect(g.challenge).toMatchObject({ id: 'reforco', revealHand: true });
    expect(g.view.players[1].hand.map((u: string) => g.view.cards[u].cardId).sort()).toEqual(['ST03-006', 'ST03-011']);
    expect(g.view.players[1].life.every((u: string) => g.view.cards[u].cardId === '?')).toBe(true);
  });

  it('recusa jogada do oponente, uid inventado, dono ausente e corpo malformado', async () => {
    const { app } = setup();
    const g = (await today(app)).json();
    const r1 = (await play(app, g.day, [{ type: 'endTurn', player: 1 }])).json();
    expect(r1).toMatchObject({ status: 'playing', applied: 0 });
    expect(r1.error).toBeDefined();
    const r2 = (await play(app, g.day, [{ type: 'attack', player: 0, attacker: 'p0-1', target: 'p1-1' }])).json();
    expect(r2.error).toBeDefined();
    expect((await app.inject({ method: 'POST', url: '/api/daily/play', payload: { day: g.day, actions: [] } })).statusCode).toBe(400);
    expect((await play(app, g.day, 'x' as unknown as Action[])).statusCode).toBe(400);
    expect((await play(app, '2020-01-01', [])).statusCode).toBe(409);
  });

  it('a fila na Administração é só para admin', async () => {
    const { db, app } = setup();
    await today(app);
    expect((await app.inject({ method: 'GET', url: '/api/admin/daily' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/daily', headers: login(db, 'player').headers })).statusCode).toBe(403);
    const r = (await app.inject({ method: 'GET', url: '/api/admin/daily', headers: login(db, 'admin').headers })).json();
    expect(r.published).toHaveLength(1);
    expect(r.queue[0].id).toBe(DAILY_CATALOG[1].id);
    expect(JSON.stringify(r)).not.toMatch(/solution/);
  });
});
