// Chat do lobby do torneio (apps/server/src/tournaments/chat.ts e as rotas /api/tournaments/:id/chat).

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import { LOBBY_CHAT_AFTER_MS, LOBBY_CHAT_MAX_LENGTH, LOBBY_CHAT_WINDOW, lobbyChatOpen } from '../src/tournaments/chat';

const DECKS = ['st01-luffy', 'st02-kid', 'st03-crocodile', 'st04-kaido'];

function setup(now?: () => number, db: DB = openDb(':memory:')) {
  seed(db);
  const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now });
  return { db, app };
}
type App = ReturnType<typeof buildApp>;
type Who = { id: string; headers: Record<string, string> };

let n = 0;
function login(db: DB, role: Role = 'player'): Who {
  const u = upsertGoogleUser(db, { sub: `chat-${++n}`, email: `chat${n}@example.com`, emailVerified: true, name: `C${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-chat-${n}-0123456789abcdef` } };
}
const req = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who?: Who, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });

/** Organizador (Shanks), dois inscritos (Luffy e Zoro), um Judge (Robin) e um torneio suíço. */
async function arena(app: App, db: DB) {
  const org = login(db, 'organizer');
  await req(app, 'PUT', '/api/players/me', org, { name: 'Shanks' });
  const [luffy, zoro, judge] = [login(db), login(db), login(db)];
  for (const [who, name] of [
    [luffy, 'Luffy'],
    [zoro, 'Zoro'],
    [judge, 'Robin'],
  ] as const) {
    await req(app, 'PUT', '/api/players/me', who, { name });
  }
  const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Copa', format: 'egb', structure: 'swiss', rounds: 1 })).json() as { id: string };
  await req(app, 'POST', `/api/tournaments/${t.id}/register`, luffy, { deckId: DECKS[0] });
  await req(app, 'POST', `/api/tournaments/${t.id}/register`, zoro, { deckId: DECKS[1] });
  await req(app, 'PUT', `/api/tournaments/${t.id}/judges`, org, { player: 'Robin' });
  const url = `/api/tournaments/${t.id}/chat`;
  const say = (who: Who | undefined, text: unknown) => req(app, 'POST', url, who, { text });
  const read = async (who?: Who) => (await req(app, 'GET', url, who)).json() as { rev: string; post: string; moderate: boolean; max: number; messages: Array<Record<string, unknown>> };
  return { org, luffy, zoro, judge, t, url, say, read };
}

describe('chat do lobby do torneio', () => {
  it('qualquer um lê; só inscritos, Judges e o organizador escrevem, cada um com o seu papel', async () => {
    let now = Date.parse('2026-10-10T19:00:00Z');
    const { db, app } = setup(() => now);
    const { org, luffy, judge, t, say, read } = await arena(app, db);
    const visitor = login(db);
    const admin = login(db, 'admin');
    await req(app, 'PUT', '/api/players/me', admin, { name: 'Sengoku' });

    expect((await req(app, 'GET', `/api/tournaments/${t.id}/lobby`)).json().chat).toBe(true);
    // Vazio para todos; cada um sabe se pode escrever e se pode apagar as mensagens dos outros.
    expect(await read()).toMatchObject({ post: 'login', moderate: false, max: LOBBY_CHAT_MAX_LENGTH, messages: [] });
    expect(await read(visitor)).toMatchObject({ post: 'participants', moderate: false });
    expect(await read(luffy)).toMatchObject({ post: 'ok', moderate: false });
    expect(await read(judge)).toMatchObject({ post: 'ok', moderate: true });
    expect(await read(org)).toMatchObject({ post: 'ok', moderate: true });
    expect(await read(admin)).toMatchObject({ post: 'ok', moderate: true });

    expect((await say(undefined, 'oi')).statusCode).toBe(401);
    expect((await say(visitor, 'oi')).json()).toMatchObject({ errorCode: 'lobbyChatParticipantsOnly' });
    expect((await req(app, 'GET', '/api/tournaments/nope/chat')).statusCode).toBe(404);

    // Quem manda recebe a conversa já com a mensagem.
    const sent = await say(luffy, '  bom   torneio\n a todos  ');
    expect(sent.statusCode).toBe(201);
    expect(sent.json().messages).toEqual([{ id: expect.any(Number), userId: luffy.id, name: 'Luffy', role: 'player', text: 'bom torneio a todos', at: new Date(now).toISOString() }]);
    now += 2000;
    expect((await say(judge, 'qualquer dúvida, chamem o Judge')).statusCode).toBe(201);
    expect((await say(org, 'rodada 1 em 5 minutos')).statusCode).toBe(201);
    expect((await say(admin, 'boa sorte')).statusCode).toBe(201);
    expect((await read(visitor)).messages.map((m) => [m.name, m.role, m.text])).toEqual([
      ['Luffy', 'player', 'bom torneio a todos'],
      ['Robin', 'judge', 'qualquer dúvida, chamem o Judge'],
      ['Shanks', 'organizer', 'rodada 1 em 5 minutos'],
      ['Sengoku', 'judge', 'boa sorte'],
    ]);
    // A conversa é do torneio: outro torneio começa vazio.
    const other = (await req(app, 'POST', '/api/tournaments', org, { name: 'Outra', format: 'egb', structure: 'swiss' })).json();
    expect((await req(app, 'GET', `/api/tournaments/${other.id}/chat`, org)).json().messages).toEqual([]);
  });

  it('texto: censura palavrões, recusa vazio e comprido, e segura quem manda rápido demais', async () => {
    let now = Date.parse('2026-10-10T19:00:00Z');
    const { db, app } = setup(() => now);
    const { luffy, zoro, say, read } = await arena(app, db);

    expect((await say(luffy, 42)).json()).toMatchObject({ errorCode: 'invalidChatMessage' });
    expect((await say(luffy, '   ')).json()).toMatchObject({ errorCode: 'emptyChatMessage' });
    expect((await say(luffy, 'a'.repeat(LOBBY_CHAT_MAX_LENGTH + 1))).json()).toMatchObject({ errorCode: 'chatMessageTooLong', errorParams: { max: LOBBY_CHAT_MAX_LENGTH } });
    expect((await say(luffy, 'a'.repeat(LOBBY_CHAT_MAX_LENGTH))).statusCode).toBe(201);
    // Menos de 1,5 s depois: recusada; o outro jogador tem o próprio ritmo.
    now += 1000;
    expect((await say(luffy, 'de novo')).statusCode).toBe(429);
    expect((await say(zoro, 'que merda de sorteio')).statusCode).toBe(201);
    expect((await read()).messages.at(-1)).toMatchObject({ name: 'Zoro', text: 'que ***** de sorteio' });
    // No máximo 10 por minuto.
    for (let i = 0; i < 9; i++) {
      now += 2000;
      expect((await say(luffy, `msg ${i}`)).statusCode).toBe(201);
    }
    now += 2000;
    expect((await say(luffy, 'a décima primeira')).json()).toMatchObject({ errorCode: 'chatTooFast' });
    now += 60_000;
    expect((await say(luffy, 'agora vai')).statusCode).toBe(201);
    expect((await read()).messages).toHaveLength(12);
  });

  it('apagar: quem escreveu, um Judge ou o organizador; a mensagem some para todos', async () => {
    let now = Date.parse('2026-10-10T19:00:00Z');
    const { db, app } = setup(() => now);
    const { org, luffy, zoro, judge, url, say, read } = await arena(app, db);
    const ids: number[] = [];
    for (const [who, text] of [
      [luffy, 'um'],
      [zoro, 'dois'],
      [luffy, 'três'],
      [org, 'quatro'],
    ] as const) {
      now += 2000;
      ids.push(((await say(who, text)).json().messages as Array<{ id: number }>).at(-1)!.id);
    }
    const del = (who: Who | undefined, id: number | string) => req(app, 'DELETE', `${url}/${id}`, who);
    expect((await del(undefined, ids[0])).statusCode).toBe(401);
    // Um inscrito não apaga a mensagem de outro, nem a do organizador.
    expect((await del(zoro, ids[0])).json()).toMatchObject({ errorCode: 'lobbyChatCannotRemove' });
    expect((await del(luffy, ids[3])).statusCode).toBe(403);
    expect((await del(luffy, 'x')).statusCode).toBe(404);
    expect((await del(luffy, 999_999)).statusCode).toBe(404);
    // O autor apaga a própria; o Judge e o organizador apagam qualquer uma.
    expect((await del(luffy, ids[0])).json().messages.map((m: { text: string }) => m.text)).toEqual(['dois', 'três', 'quatro']);
    expect((await del(judge, ids[1])).statusCode).toBe(200);
    expect((await del(org, ids[2])).statusCode).toBe(200);
    expect((await read()).messages.map((m) => m.text)).toEqual(['quatro']);
    // Apagar de novo: já não existe.
    expect((await del(org, ids[2])).json()).toMatchObject({ errorCode: 'lobbyChatMessageNotFound' });
    // A mensagem apagada fica no banco, com quem apagou.
    const rows = db.prepare('SELECT text, removed_by FROM tournament_chat ORDER BY id').all() as Array<{ text: string; removed_by: string | null }>;
    expect(rows.map((r) => [r.text, r.removed_by])).toEqual([
      ['um', luffy.id],
      ['dois', judge.id],
      ['três', org.id],
      ['quatro', null],
    ]);
  });

  it('consulta sem novidade sai como 304; a versão muda a cada mensagem e a cada mensagem apagada', async () => {
    const { db, app } = setup();
    const { luffy, zoro, t, url, say } = await arena(app, db);
    const poll = (who: Who, etag?: string) => app.inject({ method: 'GET', url, headers: { ...who.headers, ...(etag ? { 'if-none-match': etag } : {}) } });

    const first = await poll(luffy);
    const etag = String(first.headers.etag);
    expect((await poll(luffy, etag)).statusCode).toBe(304);
    await say(zoro, 'oi');
    const second = await poll(luffy, etag);
    expect(second.statusCode).toBe(200);
    expect(second.json().rev).not.toBe(first.json().rev);
    expect((await poll(luffy, String(second.headers.etag))).statusCode).toBe(304);
    await req(app, 'DELETE', `${url}/${second.json().messages[0].id}`, zoro);
    const third = await poll(luffy, String(second.headers.etag));
    expect(third.json().messages).toEqual([]);
    // Sair do torneio muda o que a conta pode fazer: a resposta guardada deixa de valer.
    expect(third.json().post).toBe('ok');
    await req(app, 'DELETE', `/api/tournaments/${t.id}/register`, luffy);
    const fourth = await poll(luffy, String(third.headers.etag));
    expect(fourth.statusCode).toBe(200);
    expect(fourth.json()).toMatchObject({ post: 'participants', rev: third.json().rev });
  });

  it('só as últimas mensagens; a conversa sobrevive a um reinício do servidor', async () => {
    let now = Date.parse('2026-10-10T19:00:00Z');
    const db = openDb(':memory:');
    const { app } = setup(() => now, db);
    const { luffy, zoro, url, say } = await arena(app, db);
    const total = LOBBY_CHAT_WINDOW + 5;
    for (let i = 0; i < total; i++) {
      now += 7000;
      expect((await say(i % 2 ? luffy : zoro, `m${i}`)).statusCode).toBe(201);
    }
    const before = (await req(app, 'GET', url)).json();
    expect(before.messages).toHaveLength(LOBBY_CHAT_WINDOW);
    expect(before.messages[0].text).toBe('m5');
    expect(before.messages.at(-1).text).toBe(`m${total - 1}`);

    const restarted = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => now });
    const after = (await req(restarted, 'GET', url)).json();
    expect(after.messages).toEqual(before.messages);
    // A versão não repete a de antes do reinício (o navegador não fica preso numa resposta antiga).
    expect(after.rev).not.toBe(before.rev);
  });

  it('depois de encerrado o torneio, o chat ainda vale por um tempo e então fecha', async () => {
    // `finished_at` é a hora real do banco; o relógio do app anda a partir dela.
    let now = Date.now();
    const { db, app } = setup(() => now);
    const { org, luffy, t, say, read } = await arena(app, db);
    expect((await req(app, 'POST', `/api/tournaments/${t.id}/start`, org, { begin: true })).statusCode).toBe(200);
    expect((await say(luffy, 'valendo')).statusCode).toBe(201);
    db.prepare("UPDATE tournaments SET status = 'finished', finished_at = datetime('now') WHERE id = ?").run(t.id);
    now += 60_000;
    expect((await say(luffy, 'gg')).statusCode).toBe(201);
    now += LOBBY_CHAT_AFTER_MS + 60_000;
    expect((await say(luffy, 'tarde demais')).json()).toMatchObject({ errorCode: 'lobbyChatClosed' });
    // Fechado, continua dando para ler (e o organizador ainda pode apagar).
    expect(await read(luffy)).toMatchObject({ post: 'closed' });
    expect((await read()).messages.map((m) => m.text)).toEqual(['valendo', 'gg']);
    expect(await read(org)).toMatchObject({ post: 'closed', moderate: true });

    expect(lobbyChatOpen({ status: 'running', finishedAt: null }, now)).toBe(true);
    expect(lobbyChatOpen({ status: 'finished', finishedAt: null }, now)).toBe(false);
    expect(lobbyChatOpen({ status: 'finished', finishedAt: '2026-01-02 03:04:05' }, Date.parse('2026-01-02T04:04:05Z'))).toBe(true);
    expect(lobbyChatOpen({ status: 'finished', finishedAt: '2026-01-02T03:04:05.000Z' }, Date.parse('2026-01-02T05:04:06Z'))).toBe(false);
  });
});
