import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { claimBrowserData, createSession, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8'));
const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };
const NOW = Date.parse('2026-10-21T12:00:00Z');

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true }, now: () => NOW }) };
}
type App = ReturnType<typeof setup>['app'];

const create = async (app: App, payload: object, headers = ALICE) => app.inject({ method: 'POST', url: '/api/decks', headers, payload });
const list = async (app: App, headers: Record<string, string> = ALICE) => (await app.inject({ url: '/api/decks', headers })).json() as Array<Record<string, unknown>>;
const byId = async (app: App, id: string, headers: Record<string, string> = ALICE) => (await list(app, headers)).find((d) => d.id === id)!;

let users = 0;
function session(db: DB, role: 'admin' | 'dev' | 'player' = 'admin') {
  const u = upsertGoogleUser(db, { sub: `u-${++users}`, email: `u${users}@example.com`, emailVerified: true, name: `Pessoa ${users}`, picture: null });
  if (role !== 'player') setUserRole(db, u.id, role);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}` } };
}

describe('deck sem Líder', () => {
  it('não é salvo, nem como rascunho', async () => {
    const { app } = setup();
    const noLeader = await create(app, { name: 'Sem Líder', leader: '', cards: [{ id: 'ST01-002', count: 4 }] });
    expect(noLeader.statusCode).toBe(400);
    expect(noLeader.json().errorCode).toBe('deckLeaderRequired');
    // Uma carta que não é Líder também não vale como Líder.
    expect((await create(app, { name: 'x', leader: 'ST01-002', cards: [] })).json().errorCode).toBe('deckLeaderInvalid');

    const ok = (await create(app, { name: 'Rascunho', leader: 'ST01-001', cards: [] })).json();
    const put = await app.inject({ method: 'PUT', url: `/api/decks/${ok.id}`, headers: ALICE, payload: { name: 'Rascunho', leader: '', cards: [] } });
    expect(put.json().errorCode).toBe('deckLeaderRequired');
  });

  it('os decks antigos sem Líder somem ao abrir o banco', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gg-decks-')), 'db.sqlite');
    const first = openDb(file);
    first.prepare("INSERT INTO decks (id, name, leader, cards, kind, owner_hash) VALUES ('u-vazio', 'Vazio', '', '[]', 'user', 'x')").run();
    first.prepare("INSERT INTO decks (id, name, leader, cards, kind, owner_hash) VALUES ('u-ok', 'Ok', 'ST01-001', '[]', 'user', 'x')").run();
    first.close();
    const db = openDb(file);
    expect(db.prepare("SELECT id FROM decks WHERE kind = 'user' ORDER BY id").all().map((r) => (r as { id: string }).id)).toEqual(['u-ok']);
    db.close();
  });
});

describe('favoritos', () => {
  it('cada um marca os seus, em qualquer deck, e passam para a conta no login', async () => {
    const { db, app } = setup();
    const fav = (id: string, favorite: unknown, headers: Record<string, string> = ALICE) =>
      app.inject({ method: 'PUT', url: `/api/decks/${id}/favorite`, headers, payload: { favorite } });

    expect((await fav('st01-luffy', true)).json()).toEqual({ id: 'st01-luffy', favorite: true });
    expect((await byId(app, 'st01-luffy')).favorite).toBe(true);
    expect((await byId(app, 'st01-luffy', BOB)).favorite).toBe(false);
    expect((await fav('st01-luffy', 'sim')).statusCode).toBe(400);
    expect((await fav('nao-existe', true)).statusCode).toBe(404);
    expect((await fav('st01-luffy', true, {})).statusCode).toBe(400);

    // Repetir não duplica; desmarcar tira.
    await fav('st02-kid', true);
    await fav('st02-kid', true);
    await fav('st02-kid', false);
    expect((await list(app)).filter((d) => d.favorite).map((d) => d.id)).toEqual(['st01-luffy']);

    // Entrar com a conta leva os favoritos do navegador.
    const nami = session(db, 'player');
    const { createHash } = await import('node:crypto');
    claimBrowserData(db, createHash('sha256').update(ALICE['x-deck-owner']).digest('hex'), nami.id);
    expect((await byId(app, 'st01-luffy', nami.headers)).favorite).toBe(true);
    expect((await byId(app, 'st01-luffy')).favorite).toBe(false);

    // Apagar o deck apaga o favorito.
    const mine = (await create(app, { name: 'Meu', leader: 'ST01-001', cards: [] })).json();
    await fav(mine.id, true);
    await app.inject({ method: 'DELETE', url: `/api/decks/${mine.id}`, headers: ALICE });
    expect(db.prepare('SELECT COUNT(*) AS n FROM deck_favorites WHERE deck_id = ?').get(mine.id)).toEqual({ n: 0 });
  });
});

describe('lista igual a outro deck', () => {
  it('com checkDuplicate, avisa qual deck já tem a mesma lista (o meu primeiro)', async () => {
    const { app } = setup();
    // Igual ao deck pronto ST01.
    const dupBuiltin = await create(app, { name: 'Cópia', leader: 'ST01-001', cards: luffy.cards, checkDuplicate: true });
    expect(dupBuiltin.statusCode).toBe(409);
    expect(dupBuiltin.json()).toMatchObject({ errorCode: 'deckDuplicate', duplicate: { id: 'st01-luffy', kind: 'builtin', mine: false } });

    // Sem o pedido (apps parceiros), salva normalmente.
    const mine = await create(app, { name: 'Meu Luffy', leader: 'ST01-001', cards: luffy.cards });
    expect(mine.statusCode).toBe(201);
    const again = await create(app, { name: 'De novo', leader: 'ST01-001', cards: [...luffy.cards].reverse(), checkDuplicate: true });
    expect(again.json().duplicate).toMatchObject({ id: mine.json().id, name: 'Meu Luffy', mine: true });

    // Lista diferente passa.
    const other = await create(app, { name: 'Outro', leader: 'ST01-001', cards: luffy.cards.slice(1), checkDuplicate: true });
    expect(other.statusCode).toBe(201);
  });
});

/** Joga uma partida bot x bot e devolve o replay. */
function playOut(decks: [DeckList, DeckList], cards: CardData[], s: number) {
  let state = createGame({ seed: s, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
  const actions: Action[] = [];
  while (state.phase !== 'gameover' && actions.length < 3000) {
    const a = chooseBotAction(state, actingPlayer(state)!);
    actions.push(a);
    state = applyAction(state, a);
  }
  return { seed: s, actions };
}

describe('partidas por deck', () => {
  it('conta as partidas de pessoas e lembra a última de quem pede', async () => {
    const { app } = setup();
    const mine = (await create(app, { name: 'Meu Luffy', leader: 'ST01-001', cards: luffy.cards })).json();
    const [a, b] = await Promise.all([mine.id, 'st02-kid'].map(async (id) => (await app.inject(`/api/decks/${id}`)).json()));
    const decks = [a.deck, b.deck] as [DeckList, DeckList];
    const r = playOut(decks, [...a.cards, ...b.cards], 11);
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches',
      headers: ALICE,
      payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: [mine.id, 'st02-kid'], decks, actions: r.actions },
    });
    expect(res.statusCode).toBe(200);

    expect(await byId(app, mine.id)).toMatchObject({ games: 1, lastPlayedAt: expect.any(String) });
    // O lado do robô não conta; quem não jogou não tem "última partida".
    expect(await byId(app, 'st02-kid')).toMatchObject({ games: 0, lastPlayedAt: null });
    expect(await byId(app, mine.id, BOB)).toMatchObject({ games: 1, lastPlayedAt: null });
  });
});

describe('limpeza de decks (Admin/Dev)', () => {
  const backdate = (db: DB, id: string, days: number) =>
    db
      .prepare('UPDATE decks SET updated_at = ? WHERE id = ?')
      .run(new Date(NOW - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19), id);

  it('agrupa cópias idênticas, rascunhos abandonados e decks sem uso; só admin/dev', async () => {
    const { db, app } = setup();
    const admin = session(db, 'admin');
    const player = session(db, 'player');
    const get = (kind: string, headers: Record<string, string> = admin.headers) => app.inject({ url: `/api/admin/decks/cleanup?kind=${kind}`, headers });

    expect((await get('dupes', {})).statusCode).toBe(401);
    expect((await get('dupes', player.headers)).statusCode).toBe(403);

    const copy = (await create(app, { name: 'Cópia de ST01', leader: 'ST01-001', cards: luffy.cards })).json();
    const list = luffy.cards.slice(1);
    const original = (await create(app, { name: 'Luffy do Bob', leader: 'ST01-001', cards: list }, BOB)).json();
    const bobCopy = (await create(app, { name: 'Cópia do Luffy do Bob', leader: 'ST01-001', cards: list })).json();
    backdate(db, bobCopy.id, 10);
    const draft = (await create(app, { name: 'teste', leader: 'ST01-001', cards: [{ id: 'ST01-002', count: 4 }] })).json();
    const freshDraft = (await create(app, { name: 'novo', leader: 'ST01-001', cards: [] })).json();
    const idle = (await create(app, { name: 'Antigo', leader: 'ST01-001', cards: luffy.cards.slice(2) })).json();
    backdate(db, draft.id, 31);
    backdate(db, freshDraft.id, 5);
    backdate(db, idle.id, 120);

    const dupes = (await get('dupes')).json();
    expect(dupes.counts).toEqual({ dupes: 2, drafts: 1, idle: 1 });
    expect(dupes.rules).toEqual({ draftMaxCards: 20, draftDays: 30, idleDays: 90 });
    const groupOf = (id: string) => dupes.groups.find((g: { rows: Array<{ id: string }> }) => g.rows.some((r) => r.id === id));
    // O deck pronto fica; a cópia sai.
    expect(groupOf(copy.id).rows.map((r: { id: string; keep: boolean }) => [r.id, r.keep])).toEqual([
      ['st01-luffy', true],
      [copy.id, false],
    ]);
    // Entre decks de jogadores, fica o criado primeiro (nenhum foi jogado), mesmo que a cópia seja mais antiga na edição.
    expect(groupOf(bobCopy.id).rows.map((r: { id: string; keep: boolean }) => [r.id, r.keep])).toEqual([
      [original.id, true],
      [bobCopy.id, false],
    ]);
    expect(groupOf(bobCopy.id).rows[0]).toMatchObject({ owner: 'browser', ownerName: null, games: 0 });

    expect((await get('drafts')).json().groups[0].rows.map((r: { id: string }) => r.id)).toEqual([draft.id]);
    expect((await get('idle')).json().groups[0].rows.map((r: { id: string }) => r.id)).toEqual([idle.id]);

    // Apagar: só admin/dev, nunca deck pronto.
    const del = (ids: unknown, headers: Record<string, string> = admin.headers) => app.inject({ method: 'POST', url: '/api/admin/decks/delete', headers, payload: { ids } });
    expect((await del([copy.id], player.headers)).statusCode).toBe(403);
    expect((await del('tudo')).statusCode).toBe(400);
    expect((await del([copy.id, bobCopy.id, 'st01-luffy', 'nao-existe'])).json()).toEqual({ deleted: 2 });
    expect((await app.inject('/api/decks/st01-luffy')).statusCode).toBe(200);
    expect((await get('dupes')).json().counts.dupes).toBe(0);

    // O Dev também pode.
    const dev = session(db, 'dev');
    expect((await del([draft.id], dev.headers)).json()).toEqual({ deleted: 1 });
  });
});
