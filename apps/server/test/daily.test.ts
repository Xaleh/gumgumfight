import { type Action, buildChallenge, type CardData, type ChallengeMove, type DeckList, type GameState, resolveMove, runChallenge } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { DAILY_CATALOG } from '../src/daily/catalog';
import { verifyChallenge } from '../src/daily/challenges';
import { dayOf } from '../src/daily/store';
import { type DB, getCards, getDeck, openDb } from '../src/db';
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
    expect(after.stats).toEqual({ opened: 1, players: 1, solvers: 1, avgAttempts: 3 });
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

// ------------------------------------------------------------------ editor de desafios (Administração)

/** Desafio do editor: a mesa do "isca" com os decks prontos, e as jogadas em ações reais (como o editor grava). */
function editorChallenge(db: DB) {
  const isca = DAILY_CATALOG[0];
  const { solution, wrong, id: _id, ...spec } = isca;
  const decks = isca.decks.map((d) => getDeck(db, d)!) as unknown as [DeckList, DeckList];
  const cards = getCards(db, [...new Set(decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))]) as CardData[];
  const start = buildChallenge({ seed: spec.seed, cards, players: [{ name: 'a', deck: decks[0] }, { name: 'b', deck: decks[1] }] }, isca);
  const record = (moves: ChallengeMove[]) => {
    const acc: Action[] = [];
    for (const m of moves) {
      const run = runChallenge(start, isca, acc);
      if (run.status !== 'playing') break;
      acc.push(...resolveMove(run.state, m));
    }
    return acc;
  };
  return { spec, solution: record(solution), wrong: record(wrong), cards, decks };
}

const admin = (app: App, db: DB, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, role: Role = 'admin') =>
  app.inject({ method, url, headers: login(db, role).headers, payload });

describe('desafio do dia: editor da Administração', () => {
  it('só admin lista e salva', async () => {
    const { db, app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/admin/daily/challenges' })).statusCode).toBe(401);
    expect((await admin(app, db, 'GET', '/api/admin/daily/challenges', undefined, 'player')).statusCode).toBe(403);
    expect((await admin(app, db, 'POST', '/api/admin/daily/challenges', {}, 'organizer')).statusCode).toBe(403);
  });

  it('salva o desafio conferido, com as listas congeladas, e ele entra na fila depois do catálogo', async () => {
    const { db, app, clock } = setup();
    const c = editorChallenge(db);
    const r = await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec: c.spec, solution: c.solution, wrong: c.wrong, note: '  cópia do isca  ' });
    expect(r.statusCode).toBe(201);
    const { id, next } = r.json();
    expect(id).toMatch(/^a-[0-9a-f]{10}$/);
    expect(next).toBe(DAILY_CATALOG.length);
    const row = db.prepare('SELECT spec, note FROM daily_challenges WHERE id = ?').get(id) as { spec: string; note: string };
    expect(row.note).toBe('cópia do isca');
    expect(JSON.parse(row.spec).lists.map((l: DeckList) => l.leader)).toEqual(['ST01-001', 'ST03-001']);

    const list = (await admin(app, db, 'GET', '/api/admin/daily/challenges')).json().challenges;
    expect(list).toHaveLength(DAILY_CATALOG.length + 1);
    expect(list.at(-1)).toMatchObject({ id, source: 'admin', goal: 'lethal', days: [], next: DAILY_CATALOG.length });
    expect(list.at(-1).leaders.map((l: { name: string }) => l.name)).toEqual(['Monkey.D.Luffy', 'Crocodile']);
    expect(JSON.stringify(list)).not.toMatch(/solution|wrong/);

    // Saem os do catálogo; depois, mudar o deck pronto não muda o desafio: ele joga com a lista congelada.
    for (let d = 0; d < DAILY_CATALOG.length; d++) {
      clock.t = T0 + d * DAY_MS;
      await today(app);
    }
    db.prepare("UPDATE decks SET cards = '[]' WHERE id = 'st01-luffy'").run();
    clock.t = T0 + DAILY_CATALOG.length * DAY_MS;
    const res = await today(app);
    expect(res.statusCode, res.body).toBe(200);
    const g = res.json();
    expect(g.challenge.id).toBe(id);
    const done = await playLine(app, g.day, g.view, DAILY_CATALOG[0].solution);
    expect(done.status).toBe('solved');
  });

  it('recusa solução que não resolve, linha errada que resolve, mesa impossível e campos inválidos', async () => {
    const { db, app } = setup();
    const c = editorChallenge(db);
    const post = (body: object) => admin(app, db, 'POST', '/api/admin/daily/challenges', body);
    const code = async (body: object) => {
      const r = await post(body);
      expect(r.statusCode).toBe(400);
      return r.json().errorCode;
    };
    expect(await code({ spec: c.spec, solution: c.wrong })).toBe('challengeNotSolved');
    expect(await code({ spec: c.spec, solution: c.solution, wrong: c.solution })).toBe('challengeWrongSolves');
    expect(await code({ spec: { ...c.spec, decks: ['st01-luffy', 'nao-existe'] }, solution: c.solution })).toBe('challengeDeck');
    const board = { ...c.spec, scenario: { ...c.spec.scenario, sides: [{ hand: ['OP01-001'] }, {}] } };
    expect(await code({ spec: board, solution: c.solution })).toBe('challengeBoard');
    expect(await code({ spec: { ...c.spec, goal: 'draw' }, solution: c.solution })).toBe('challengeInvalid');
    expect(await code({ spec: { ...c.spec, goal: 'survive' }, solution: c.solution })).toBe('challengeInvalid');
    const many = { ...c.spec, scenario: { ...c.spec.scenario, sides: [{ characters: Array(6).fill('ST01-003') }, {}] } };
    expect((await post({ spec: many, solution: c.solution })).json()).toMatchObject({ errorCode: 'challengeInvalid', errorParams: { field: 'Personagens do lado 1' } });
    expect(await code({ spec: c.spec, solution: 'x' })).toBe('challengeInvalid');
    expect(db.prepare('SELECT COUNT(*) AS n FROM daily_challenges').get()).toEqual({ n: 0 });
  });

  it('carta ⚙ na mesa só passa com a confirmação', () => {
    const { db } = setup();
    const c = editorChallenge(db);
    const cards = c.cards.map((x) => (x.id === 'ST01-003' ? { ...x, text: '[Activate: Main] Dance a little and sing a song.' } : x));
    const deps = { deck: (id: string) => getDeck(db, id), cards: () => cards };
    expect(verifyChallenge({ spec: c.spec, solution: c.solution }, deps)).toEqual({ code: 'challengeManualCards', cards: ['ST01-003'] });
    expect(verifyChallenge({ spec: c.spec, solution: c.solution, allowManual: true }, deps)).toHaveProperty('solution');
  });

  it('apaga o que ainda não saiu; o que já saiu e o do catálogo, não', async () => {
    const { db, app, clock } = setup();
    const c = editorChallenge(db);
    const save = async () => (await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec: c.spec, solution: c.solution })).json().id as string;
    const a = await save();
    expect((await admin(app, db, 'DELETE', `/api/admin/daily/challenges/${a}`)).statusCode).toBe(204);
    expect((await admin(app, db, 'DELETE', `/api/admin/daily/challenges/${a}`)).statusCode).toBe(404);
    expect((await admin(app, db, 'DELETE', `/api/admin/daily/challenges/${DAILY_CATALOG[0].id}`)).statusCode).toBe(404);
    const b = await save();
    for (let d = 0; d <= DAILY_CATALOG.length; d++) {
      clock.t = T0 + d * DAY_MS;
      await today(app);
    }
    expect((await admin(app, db, 'GET', '/api/admin/daily/challenges')).json().challenges.at(-1)).toMatchObject({ id: b, days: [dayOf(T0 + DAILY_CATALOG.length * DAY_MS)] });
    expect((await admin(app, db, 'DELETE', `/api/admin/daily/challenges/${b}`)).statusCode).toBe(409);
  });
});

// ------------------------------------------------------------------ fila arrumada na Administração (fase 2)

const ids = DAILY_CATALOG.map((c) => c.id);
const put = (app: App, db: DB, url: string, payload: object) => app.inject({ method: 'PUT', url, headers: login(db, 'admin').headers, payload });
/** Publica os dias `from`..`to` (inclusive) e devolve o id do desafio de cada um. */
async function publishDays(app: App, clock: { t: number }, from: number, to: number) {
  const out: string[] = [];
  for (let d = from; d <= to; d++) {
    clock.t = T0 + d * DAY_MS;
    out.push((await today(app, browser(`dia-${d}`))).json().challenge.id);
  }
  return out;
}

describe('desafio do dia: fila com datas fixas e ordem manual', () => {
  it('a data fixa tira o desafio da fila e ele sai no dia marcado', async () => {
    const { db, app, clock } = setup();
    expect(await publishDays(app, clock, 0, 0)).toEqual([ids[0]]);
    // 12/10 é hoje; fixa o 4º do catálogo em 14/10.
    const pin = await put(app, db, `/api/admin/daily/challenges/${ids[3]}/pin`, { day: '2026-10-14' });
    expect(pin.statusCode).toBe(200);
    const list = (await admin(app, db, 'GET', '/api/admin/daily/challenges')).json();
    expect(list.pinned).toEqual([{ day: '2026-10-14', challengeId: ids[3] }]);
    expect(list.queue.slice(0, 2)).toEqual([ids[1], ids[2]]);
    expect(list.challenges.find((c: { id: string }) => c.id === ids[3])).toMatchObject({ pinnedDay: '2026-10-14', next: -1 });
    expect(await publishDays(app, clock, 1, 4)).toEqual([ids[1], ids[3], ids[2], ids[4]]);
  });

  it('recusa data passada, dia já publicado, dia ocupado, data inválida e desafio desconhecido; e solta a data', async () => {
    const { db, app, clock } = setup();
    await publishDays(app, clock, 0, 0);
    const code = async (id: string, day: unknown) => {
      const r = await put(app, db, `/api/admin/daily/challenges/${id}/pin`, { day });
      return [r.statusCode, r.json().errorCode];
    };
    expect(await code(ids[1], '2026-10-11')).toEqual([400, 'pinPast']);
    expect(await code(ids[1], '2026-10-12')).toEqual([409, 'pinPublished']);
    expect(await code(ids[1], '13/10/2026')).toEqual([400, 'badDay']);
    expect(await code('nao-existe', '2026-10-20')).toEqual([404, 'challengeNotFound']);
    expect((await put(app, db, `/api/admin/daily/challenges/${ids[1]}/pin`, { day: '2026-10-20' })).statusCode).toBe(200);
    expect(await code(ids[2], '2026-10-20')).toEqual([409, 'pinTaken']);
    // Soltar a data devolve o desafio à fila.
    expect((await put(app, db, `/api/admin/daily/challenges/${ids[1]}/pin`, { day: null })).statusCode).toBe(200);
    expect((await admin(app, db, 'GET', '/api/admin/daily/challenges')).json()).toMatchObject({ pinned: [], queue: expect.arrayContaining([ids[1]]) });
    expect(await publishDays(app, clock, 1, 1)).toEqual([ids[1]]);
  });

  it('data fixa que passou sem ninguém abrir deixa de valer', async () => {
    const { db, app, clock } = setup();
    await publishDays(app, clock, 0, 0);
    await put(app, db, `/api/admin/daily/challenges/${ids[5]}/pin`, { day: '2026-10-13' });
    // Ninguém abriu em 13/10; em 14/10 o desafio volta para a fila no lugar dele.
    clock.t = T0 + 2 * DAY_MS;
    expect((await admin(app, db, 'GET', '/api/admin/daily/challenges')).json().pinned).toEqual([]);
    expect(await publishDays(app, clock, 2, 6)).toEqual([ids[1], ids[2], ids[3], ids[4], ids[5]]);
  });

  it('a ordem manual muda quem sai primeiro; ordem inválida é recusada', async () => {
    const { db, app, clock } = setup();
    const r = await put(app, db, '/api/admin/daily/queue', { order: [ids[5], ids[4]] });
    expect(r.statusCode).toBe(200);
    expect(r.json().queue.slice(0, 3)).toEqual([ids[5], ids[4], ids[0]]);
    expect((await put(app, db, '/api/admin/daily/queue', { order: [ids[0], ids[0]] })).statusCode).toBe(400);
    expect((await put(app, db, '/api/admin/daily/queue', { order: ['nao-existe'] })).statusCode).toBe(400);
    expect((await put(app, db, '/api/admin/daily/queue', { order: 'x' })).statusCode).toBe(400);
    expect(await publishDays(app, clock, 0, 2)).toEqual([ids[5], ids[4], ids[0]]);
  });

  it('só admin mexe na fila', async () => {
    const { db, app } = setup();
    const player = login(db, 'player').headers;
    expect((await app.inject({ method: 'PUT', url: '/api/admin/daily/queue', headers: player, payload: { order: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/admin/daily/challenges/${ids[0]}/pin`, headers: player, payload: { day: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/admin/daily/challenges/${ids[0]}`, headers: player })).statusCode).toBe(403);
  });
});

describe('desafio do dia: números por dia', () => {
  it('conta quem abriu (o cartão da home não conta), quem tentou, quem resolveu e a média de tentativas', async () => {
    const { db, app } = setup();
    const g = (await today(app, browser('n1'))).json();
    await app.inject({ method: 'GET', url: '/api/daily?brief=1', headers: browser('so-cartao').headers });
    await today(app, browser('n2'));
    await today(app, browser('n3'));
    const c = DAILY_CATALOG[0];
    await playLine(app, g.day, g.view, c.wrong, browser('n1'));
    await playLine(app, g.day, g.view, c.solution, browser('n1'));
    await playLine(app, g.day, g.view, c.solution, browser('n2'));
    await playLine(app, g.day, g.view, c.wrong, browser('n3'));
    // Quem consulta agora também abriu.
    expect((await today(app, browser('n4'))).json().stats).toEqual({ opened: 4, players: 3, solvers: 2, avgAttempts: 1.5 });
    const pub = (await admin(app, db, 'GET', '/api/admin/daily/challenges')).json().published;
    expect(pub).toEqual([{ day: g.day, challenge_id: c.id, number: 1, opened: 4, players: 3, solvers: 2, avgAttempts: 1.5 }]);
  });
});

describe('desafio do dia: editar e duplicar', () => {
  it('lê o desafio inteiro, edita enquanto não saiu e recusa depois', async () => {
    const { db, app, clock } = setup();
    const c = editorChallenge(db);
    const id = (await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec: c.spec, solution: c.solution, wrong: c.wrong, note: 'v1' })).json().id;
    const d = (await admin(app, db, 'GET', `/api/admin/daily/challenges/${id}`)).json();
    expect(d).toMatchObject({ id, source: 'admin', note: 'v1', published: false, solution: c.solution, wrong: c.wrong });
    expect(d.spec).toEqual(c.spec);
    expect(d.spec.lists).toBeUndefined();
    // Edita: mais difícil e com outra nota; a solução continua valendo.
    const edit = await put(app, db, `/api/admin/daily/challenges/${id}`, { spec: { ...c.spec, level: 3 }, solution: c.solution, note: 'v2' });
    expect(edit.statusCode).toBe(200);
    const after = (await admin(app, db, 'GET', `/api/admin/daily/challenges/${id}`)).json();
    expect(after).toMatchObject({ note: 'v2', wrong: null, spec: { level: 3 } });
    // A edição é conferida de novo.
    expect((await put(app, db, `/api/admin/daily/challenges/${id}`, { spec: c.spec, solution: c.wrong })).json().errorCode).toBe('challengeNotSolved');
    // Saiu: não edita mais.
    await put(app, db, `/api/admin/daily/challenges/${id}/pin`, { day: '2026-10-12' });
    clock.t = T0;
    expect((await today(app)).json().challenge.id).toBe(id);
    expect((await put(app, db, `/api/admin/daily/challenges/${id}`, { spec: c.spec, solution: c.solution })).statusCode).toBe(409);
    expect((await admin(app, db, 'GET', `/api/admin/daily/challenges/${id}`)).json().published).toBe(true);
  });

  it('do catálogo: lê a mesa (para duplicar), sem solução, e não edita', async () => {
    const { db, app } = setup();
    const c = editorChallenge(db);
    const d = (await admin(app, db, 'GET', `/api/admin/daily/challenges/${ids[0]}`)).json();
    expect(d).toMatchObject({ source: 'catalog', solution: null, wrong: null });
    expect(d.spec).toEqual(c.spec);
    expect((await put(app, db, `/api/admin/daily/challenges/${ids[0]}`, { spec: c.spec, solution: c.solution })).statusCode).toBe(404);
    expect((await admin(app, db, 'GET', '/api/admin/daily/challenges/nao-existe')).statusCode).toBe(404);
  });
});

describe('desafio do dia: defensor configurável e enunciado (fase 3)', () => {
  it('o enunciado leva a defesa e o texto livre; o desafio do Evento de Counter sai na vez dele', async () => {
    const { app, clock } = setup();
    const i = DAILY_CATALOG.findIndex((c) => c.id === 'mellow');
    expect(i).toBeGreaterThan(0);
    const first = (await today(app)).json();
    expect(first.challenge).toMatchObject({ defense: { eventCounters: false, triggers: false }, intro: null });
    await publishDays(app, clock, 1, i);
    const g = (await today(app, browser('dia-' + i))).json();
    expect(g.challenge).toMatchObject({ id: 'mellow', defense: { eventCounters: true, triggers: false }, revealHand: true });
    // A mão aberta mostra o Love-Love Mellow.
    expect(g.view.players[1].hand.map((u: string) => g.view.cards[u].cardId)).toEqual(['ST03-017']);
  });

  it('o editor salva a defesa e o enunciado por idioma; no "sobreviva" a defesa cai; idioma ou texto inválido é recusado', async () => {
    const { db, app } = setup();
    const c = editorChallenge(db);
    const intro = { 'pt-BR': '  Gaste o Counter do oponente primeiro.  ', en: 'Burn their Counter first.', es: '   ' };
    const r = await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec: { ...c.spec, defense: { eventCounters: true, triggers: true }, intro }, solution: c.solution });
    expect(r.statusCode).toBe(201);
    const d = (await admin(app, db, 'GET', `/api/admin/daily/challenges/${r.json().id}`)).json();
    expect(d.spec.defense).toEqual({ eventCounters: true, triggers: true });
    expect(d.spec.intro).toEqual({ 'pt-BR': 'Gaste o Counter do oponente primeiro.', en: 'Burn their Counter first.' });
    // Defesa desligada não é guardada.
    const off = await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec: { ...c.spec, defense: { eventCounters: false } }, solution: c.solution });
    expect((await admin(app, db, 'GET', `/api/admin/daily/challenges/${off.json().id}`)).json().spec.defense).toBeUndefined();
    const bad = async (spec: object) => (await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec, solution: c.solution })).json();
    expect(await bad({ ...c.spec, intro: { xx: 'oi' } })).toMatchObject({ errorCode: 'challengeInvalid', errorParams: { field: 'enunciado' } });
    expect(await bad({ ...c.spec, intro: { 'pt-BR': 'x'.repeat(401) } })).toMatchObject({ errorCode: 'challengeInvalid' });
    expect(await bad({ ...c.spec, defense: { triggers: 'sim' } })).toMatchObject({ errorCode: 'challengeInvalid', errorParams: { field: 'defesa do oponente' } });
  });

  it('a defesa conta na conferência: com o Evento ligado, a mesma solução pode deixar de valer', async () => {
    const { db, app } = setup();
    const c = editorChallenge(db);
    // "isca" sem cartas na mão do oponente: ligar a defesa não muda nada e a solução continua valendo.
    const ok = await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec: { ...c.spec, defense: { eventCounters: true } }, solution: c.solution });
    expect(ok.statusCode).toBe(201);
    // Com o Love-Love Mellow na mão e 2 DON!!, a solução do "isca" deixa de resolver.
    const sides = [c.spec.scenario.sides[0], { ...c.spec.scenario.sides[1], hand: ['ST03-017'], donActive: 2, donRested: 4 }];
    const spec = { ...c.spec, scenario: { ...c.spec.scenario, sides }, defense: { eventCounters: true } };
    expect((await admin(app, db, 'POST', '/api/admin/daily/challenges', { spec, solution: c.solution })).json().errorCode).toBe('challengeNotSolved');
  });
});
