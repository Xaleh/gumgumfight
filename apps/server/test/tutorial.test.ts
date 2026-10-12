import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { seed } from '../src/seed';

function setup(now = () => Date.UTC(2026, 9, 12, 12)) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now });
  return { db, app, lobby: (app as unknown as { onlineLobby: Lobby }).onlineLobby };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, role: Role = 'player') {
  const u = upsertGoogleUser(db, { sub: `tsub-${++n}`, email: `t${n}@example.com`, emailVerified: true, name: `T${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `tbrowser-${n}-0123456789abcdef` } };
}
const browser = (id: string) => ({ headers: { 'x-deck-owner': `tutorial-browser-${id}-0123456789abcdef` } });
const req = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, who?: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });

describe('tutorial: progresso', () => {
  it('guarda por navegador, junta sem perder lições e liga o convite dispensado e o título', async () => {
    const { app } = setup();
    const b = browser('a');
    expect((await req(app, 'GET', '/api/tutorial/progress', b)).json()).toEqual({ done: [], dismissed: false, apprentice: false });
    await req(app, 'PUT', '/api/tutorial/progress', b, { done: ['goal', 'card'] });
    const r = (await req(app, 'PUT', '/api/tutorial/progress', b, { done: ['table', 'goal'], dismissed: true })).json();
    expect(r.done.sort()).toEqual(['card', 'goal', 'table']);
    expect(r.dismissed).toBe(true);
    // Um PUT sem o campo não desliga o que já foi ligado.
    const again = (await req(app, 'PUT', '/api/tutorial/progress', b, { done: [] })).json();
    expect(again).toMatchObject({ dismissed: true, apprentice: false });
    expect(again.done).toHaveLength(3);
    // "Recomeçar do zero" limpa as lições (o convite dispensado fica).
    expect((await req(app, 'PUT', '/api/tutorial/progress', b, { done: [], reset: true })).json()).toMatchObject({ done: [], dismissed: true });
    // Outro navegador começa do zero.
    expect((await req(app, 'GET', '/api/tutorial/progress', browser('b'))).json().done).toEqual([]);
  });

  it('com login, o progresso é da conta (vale em qualquer navegador)', async () => {
    const { db, app } = setup();
    const u = login(db);
    await req(app, 'PUT', '/api/tutorial/progress', u, { done: ['goal'] });
    const otherBrowser = { headers: { ...u.headers, 'x-deck-owner': 'outro-navegador-0123456789abcdef' } };
    expect((await req(app, 'GET', '/api/tutorial/progress', otherBrowser)).json().done).toEqual(['goal']);
  });

  it('recusa ids inválidos e corpo malformado', async () => {
    const { app } = setup();
    const b = browser('c');
    const r = (await req(app, 'PUT', '/api/tutorial/progress', b, { done: ['ok', 'não pode', '<x>', 7] })).json();
    expect(r.done).toEqual(['ok']);
    expect((await req(app, 'PUT', '/api/tutorial/progress', b, { done: 'goal' })).statusCode).toBe(400);
    expect((await req(app, 'GET', '/api/tutorial/progress')).statusCode).toBe(400);
  });

  it('o título aparece no perfil e na faixa da partida online', async () => {
    const { db, app, lobby } = setup();
    const u = login(db);
    await req(app, 'PUT', '/api/players/me', u, { name: 'Aprendiz' });
    expect((await req(app, 'GET', '/api/players/me', u)).json().apprentice).toBe(false);
    await req(app, 'PUT', '/api/tutorial/progress', u, { done: ['goal'], completed: true });
    expect((await req(app, 'GET', '/api/players/me', u)).json()).toMatchObject({ name: 'Aprendiz', apprentice: true });
    const room = (await req(app, 'POST', '/api/online/rooms', u, { deckId: 'st01-luffy', format: 'egb' })).json();
    expect(room.roomId).toBeTruthy();
    const info = lobby.get(room.roomId)!.info(0);
    expect(info.players[0]).toMatchObject({ name: 'Aprendiz', apprentice: true });
  });
});

describe('tutorial: eventos anônimos e funil', () => {
  it('conta eventos sem dono e mostra o funil só para admin', async () => {
    const { db, app } = setup();
    const ev = (lesson: string, event: string, step = '') => req(app, 'POST', '/api/tutorial/events', undefined, { lesson, step, event });
    expect((await ev('don', 'start')).statusCode).toBe(204);
    await ev('don', 'start');
    await ev('don', 'step', 'play');
    await ev('don', 'step', 'play');
    await ev('don', 'step', 'quiz');
    await ev('don', 'exit', 'quiz');
    await ev('don', 'fail', 'play');
    await ev('don', 'complete');
    expect((await ev('don', 'hack')).statusCode).toBe(400);
    expect((await ev('<script>', 'start')).statusCode).toBe(400);
    const rows = db.prepare('SELECT * FROM tutorial_events').all() as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0]).sort()).toEqual(['count', 'day', 'event', 'lesson', 'step']);

    expect((await req(app, 'GET', '/api/admin/tutorial')).statusCode).toBe(401);
    expect((await req(app, 'GET', '/api/admin/tutorial', login(db))).statusCode).toBe(403);
    const f = (await req(app, 'GET', '/api/admin/tutorial', login(db, 'admin'))).json();
    const don = f.lessons.find((l: { lesson: string }) => l.lesson === 'don');
    expect(don).toMatchObject({ starts: 2, completes: 1, exits: 1, fails: 1 });
    expect(don.steps).toEqual(
      expect.arrayContaining([
        { step: 'play', reached: 2, exits: 0, fails: 1 },
        { step: 'quiz', reached: 1, exits: 1, fails: 0 },
      ]),
    );
  });

  it('limita eventos por minuto', async () => {
    const { app } = setup();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await req(app, 'POST', '/api/tutorial/events', undefined, { lesson: 'goal', event: 'start' })).statusCode;
    expect(last).toBe(429);
  });
});
