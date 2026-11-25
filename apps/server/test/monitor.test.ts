import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { SseMetrics } from '../src/monitor/sse';
import { cleanPath, fingerprint, listErrors, MAX_ERROR_ROWS, recordError, scrub } from '../src/monitor/store';
import { WEB_REPORTS_PER_IP } from '../src/monitor/routes';
import { seed } from '../src/seed';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: false }, onlineRateLimit: 1e9, botDelayMs: 0, release: 'abc123' }) };
}

let n = 0;
const as = (db: DB, role: Role) => {
  const u = upsertGoogleUser(db, { sub: `mon-${++n}`, email: `mon${n}@example.com`, emailVerified: true, name: `M${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { cookie: `gg_session=${createSession(db, u.id)}` };
};

describe('monitoramento: limpeza e agrupamento', () => {
  it('tira query strings, tokens e e-mails', () => {
    expect(scrub('GET /api/online/rooms/r1/events?t=segredo falhou')).toBe('GET /api/online/rooms/r1/events falhou');
    expect(scrub('em https://gumgumfight.app/?sala=ABCDEF#x')).toBe('em https://gumgumfight.app/');
    expect(scrub('token ggf_abcDEF123_xyz e 0123456789abcdef0123456789abcdef')).toBe('token […] e […]');
    expect(scrub('de fulano@example.com')).toBe('de [e-mail]');
    // Texto comum com ponto de interrogação continua igual.
    expect(scrub('A mesa mudou? Tente de novo.')).toBe('A mesa mudou? Tente de novo.');
    expect(cleanPath('https://gumgumfight.app/torneio/t-1?code=X')).toBe('/torneio/t-1');
  });

  it('o mesmo erro (com outros números e outro build) vira uma linha só', () => {
    const a = fingerprint({ source: 'web', kind: 'window', message: 'Carta 42 não encontrada', stack: 'Error\n    at f (https://x/assets/index-AbC123xy.js:10:5)' });
    const b = fingerprint({ source: 'web', kind: 'window', message: 'Carta 7 não encontrada', stack: 'Error\n    at f (https://x/assets/index-ZZZ999qq.js:11:9)' });
    const c = fingerprint({ source: 'server', kind: 'window', message: 'Carta 7 não encontrada', stack: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const db = openDb(':memory:');
    recordError(db, { source: 'web', kind: 'window', message: 'Carta 42 não encontrada' });
    recordError(db, { source: 'web', kind: 'window', message: 'Carta 43 não encontrada' });
    expect(listErrors(db)).toMatchObject([{ count: 2, message: 'Carta 43 não encontrada' }]);
  });

  it('guarda no máximo MAX_ERROR_ROWS erros diferentes', () => {
    const db = openDb(':memory:');
    // Nomes só com letras (números não distinguem erros): aa, ab, ac…
    const word = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
    for (let i = 0; i < MAX_ERROR_ROWS + 5; i++) recordError(db, { source: 'web', kind: 'window', message: `erro ${word(i)}` });
    expect(listErrors(db, { resolved: true, limit: 10_000 }).length).toBe(MAX_ERROR_ROWS);
  });
});

describe('monitoramento: rotas', () => {
  it('erro forçado no servidor e no navegador aparecem no painel; só admin vê', async () => {
    const { db, app } = setup();
    const admin = as(db, 'admin');
    expect((await app.inject({ url: '/api/admin/monitor' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/admin/monitor', headers: as(db, 'player') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/monitor/test-error', headers: as(db, 'player') })).statusCode).toBe(403);

    // Erro no servidor: a resposta continua um 500, e o erro fica gravado.
    const forced = await app.inject({ method: 'POST', url: '/api/admin/monitor/test-error', headers: admin });
    expect(forced.statusCode).toBe(500);
    await app.inject({ method: 'POST', url: '/api/admin/monitor/test-error', headers: admin });

    // Erro no navegador (sem login), com o token do lugar na URL.
    const web = await app.inject({
      method: 'POST',
      url: '/api/monitor/errors',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' },
      payload: { kind: 'test', message: 'Erro de teste do navegador', stack: 'Error\n at x (https://gumgumfight.app/assets/index-a1b2c3d4.js:1:2)', url: 'https://gumgumfight.app/?sala=ABCDEF&t=segredo', release: 'index-a1b2c3d4.js' },
    });
    expect(web.statusCode).toBe(204);

    const panel = (await app.inject({ url: '/api/admin/monitor', headers: admin })).json();
    expect(panel.release).toBe('abc123');
    expect(panel.errors.counts).toMatchObject({ open: 2, resolved: 0, last24h: 2 });
    const server = panel.errors.list.find((e: { source: string }) => e.source === 'server');
    expect(server).toMatchObject({ kind: 'test', count: 2, status: 500, url: 'POST /api/admin/monitor/test-error', release: 'abc123' });
    expect(server.message).toContain('Erro de teste do monitoramento');
    const browser = panel.errors.list.find((e: { source: string }) => e.source === 'web');
    expect(browser).toMatchObject({ kind: 'test', count: 1, url: '/', userAgent: 'Mozilla/5.0 (iPhone)', release: 'index-a1b2c3d4.js' });
    expect(JSON.stringify(panel)).not.toContain('segredo');

    // Resolver tira da lista dos abertos; o mesmo erro de novo reabre.
    expect((await app.inject({ method: 'POST', url: `/api/admin/monitor/errors/${server.id}/resolve`, headers: admin })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'POST', url: `/api/admin/monitor/errors/${server.id}/resolve`, headers: admin })).statusCode).toBe(404);
    let list = (await app.inject({ url: '/api/admin/monitor', headers: admin })).json().errors.list;
    expect(list.map((e: { source: string }) => e.source)).toEqual(['web']);
    expect((await app.inject({ url: '/api/admin/monitor?resolved=1', headers: admin })).json().errors.list.length).toBe(2);
    await app.inject({ method: 'POST', url: '/api/admin/monitor/test-error', headers: admin });
    list = (await app.inject({ url: '/api/admin/monitor', headers: admin })).json().errors.list;
    expect(list.find((e: { source: string }) => e.source === 'server')).toMatchObject({ count: 3, resolvedAt: null });

    // Apagar: só os resolvidos; com all=1, todos.
    await app.inject({ method: 'POST', url: `/api/admin/monitor/errors/${server.id}/resolve`, headers: admin });
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/monitor/errors', headers: admin })).json()).toEqual({ removed: 1 });
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/monitor/errors?all=1', headers: admin })).json()).toEqual({ removed: 1 });
    await app.close();
  });

  it('erros 4xx não entram; relato inválido do navegador é recusado; há limite por IP', async () => {
    const { db, app } = setup();
    const admin = as(db, 'admin');
    // JSON inválido: 400 lançado pelo Fastify, não é erro do servidor.
    const bad = await app.inject({ method: 'POST', url: '/api/decks', headers: { ...ALICE, 'content-type': 'application/json' }, payload: '{' });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/monitor/errors', payload: { kind: 'hack', message: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/monitor/errors', payload: { kind: 'window' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/admin/monitor', headers: admin })).json().errors.list).toEqual([]);

    let last = 0;
    for (let i = 0; i < WEB_REPORTS_PER_IP + 1; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/monitor/errors', payload: { kind: 'window', message: `erro ${i}` } })).statusCode;
    }
    expect(last).toBe(429);
    await app.close();
  });

  it('conta canais SSE abertos, quedas e reconexões', async () => {
    const { db, app } = setup();
    const admin = as(db, 'admin');
    const created = await app.inject({ method: 'POST', url: '/api/online/rooms', headers: ALICE, payload: { deckId: 'st01-luffy', format: 'egb' } });
    const { roomId, code, token } = created.json();
    await app.inject({ method: 'POST', url: '/api/online/rooms/join', headers: BOB, payload: { code, deckId: 'st02-kid' } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const open = async () => {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/online/rooms/${roomId}/events?t=${token}`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      let text = '';
      while (!text.includes('event: state')) text += new TextDecoder().decode((await reader.read()).value);
      return ctrl;
    };
    const sse = async () => (await app.inject({ url: '/api/admin/monitor', headers: admin })).json().sse;
    const waitFor = async (check: (s: any) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const s = await sse();
        if (check(s)) return s;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('as métricas não chegaram');
    };

    const first = await open();
    expect((await sse()).open).toEqual({ online: 1, yonko: 0, total: 1 });
    first.abort(); // queda: o navegador fechou
    await waitFor((s) => s.open.total === 0);
    const second = await open(); // o mesmo lugar volta: reconexão
    const s = await sse();
    expect(s.open.online).toBe(1);
    expect(s.sinceStart.online).toMatchObject({ opened: 2, clientClosed: 1, serverClosed: 0, reconnects: 1 });
    expect(s.hours.at(-1)).toMatchObject({ opened: 2, clientClosed: 1, reconnects: 1, peak: 1 });
    second.abort();
    await waitFor((x) => x.open.total === 0);
    await app.close();
  });
});

describe('SseMetrics', () => {
  it('separa o que o servidor encerrou das quedas, e grava por hora somando', () => {
    const db = openDb(':memory:');
    let t = Date.UTC(2026, 10, 25, 10, 0, 0);
    const m = new SseMetrics({ db, now: () => t });
    const a = m.track('online', 'r1:a');
    const b = m.track('yonko', 'y1:b');
    t += 30_000;
    a.serverEnd();
    a.close();
    a.close(); // a segunda vez não conta
    b.close();
    t += 3 * 60_000; // passou da janela: não é reconexão
    m.track('online', 'r1:a').close();
    const snap = m.snapshot();
    expect(snap.open.total).toBe(0);
    expect(snap.sinceStart.online).toMatchObject({ opened: 2, serverClosed: 1, clientClosed: 1, reconnects: 0, avgSeconds: 15 });
    expect(snap.sinceStart.yonko).toMatchObject({ opened: 1, clientClosed: 1 });
    expect(snap.hours).toEqual([{ hour: '2026-11-25T10', opened: 3, clientClosed: 2, serverClosed: 1, reconnects: 0, peak: 2, seconds: 60 }]);
    // Um processo novo (deploy) na mesma hora soma, não sobrescreve.
    const m2 = new SseMetrics({ db, now: () => t });
    m2.track('online', 'r2:c');
    expect(m2.snapshot().hours[0]).toMatchObject({ opened: 4, peak: 2 });
  });
});
