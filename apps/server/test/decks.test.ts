import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { seed } from '../src/seed';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8'));

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function app() {
  const db = openDb(':memory:');
  seed(db);
  return buildApp(db, { server: { cardImages: true } });
}

describe('API de decks', () => {
  it('lista decks prontos com validação', async () => {
    const list = (await app().inject('/api/decks')).json();
    expect(list.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(['st01-luffy', 'st02-kid']));
    const d = list.find((x: { id: string }) => x.id === 'st01-luffy');
    expect(d).toMatchObject({ kind: 'builtin', valid: true, size: 50, leaderName: 'Monkey.D.Luffy', colors: ['red'] });
  });

  it('informa em quais formatos cada deck pode ser usado', async () => {
    const list = (await app().inject('/api/decks')).json();
    const byId = (id: string) => list.find((x: { id: string }) => x.id === id);
    // ST-01 tem o bloco ①: só vale no Extra Grand Battle.
    expect(byId('st01-luffy').formats.egb).toEqual([]);
    expect(byId('st01-luffy').formats.standard.length).toBeGreaterThan(0);
    expect(byId('st13-ace').formats).toEqual({ standard: [], egb: [] });
    // O Líder ST10-001 (Law) está banido: não vale em nenhum formato.
    expect(byId('st10-law').formats.standard).toEqual([expect.stringMatching(/ST10-001 está banida/)]);
    expect(byId('st10-law').formats.egb).toEqual([expect.stringMatching(/ST10-001 está banida/)]);
  });

  it('cria, edita e apaga um deck do jogador', async () => {
    const a = app();
    const created = await a.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Rascunho', leader: 'ST01-001', cards: [{ id: 'st01-002', count: 4 }] } });
    expect(created.statusCode).toBe(201);
    const c = created.json();
    expect(c).toMatchObject({ kind: 'user', valid: false, size: 4, mine: true });
    expect(c.errors[0]).toMatch(/faltam 46/);

    const updated = await a.inject({ method: 'PUT', url: `/api/decks/${c.id}`, headers: ALICE, payload: { name: 'Meu Luffy', leader: 'ST01-001', cards: luffy.cards } });
    expect(updated.json()).toMatchObject({ name: 'Meu Luffy', valid: true, size: 50 });

    const full = (await a.inject(`/api/decks/${c.id}`)).json();
    expect(full.cards.length).toBe(17);
    expect(full.summary.valid).toBe(true);

    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${c.id}`, headers: ALICE })).statusCode).toBe(204);
    expect((await a.inject(`/api/decks/${c.id}`)).statusCode).toBe(404);
  });

  it('decks prontos não podem ser alterados nem apagados', async () => {
    const a = app();
    expect((await a.inject({ method: 'PUT', url: '/api/decks/st01-luffy', payload: { name: 'x', leader: 'ST01-001', cards: [] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: '/api/decks/st01-luffy' })).statusCode).toBe(403);
  });

  it('rejeita dados malformados', async () => {
    const a = app();
    const post = (payload: object, headers: Record<string, string> = ALICE) => a.inject({ method: 'POST', url: '/api/decks', headers, payload });
    expect((await post({ name: '', leader: 'ST01-001', cards: [] })).statusCode).toBe(400);
    expect((await post({ name: 'x', cards: [{ id: 'A', count: 0 }] })).statusCode).toBe(400);
    expect((await post({ name: 'x', cards: 'nada' })).statusCode).toBe(400);
    expect((await post({ name: 'x', leader: 'ST01-001', cards: [] }, {})).statusCode).toBe(400);
    expect((await post({ name: 'x', leader: 'ST01-001', cards: [] }, { 'x-deck-owner': 'curto' })).statusCode).toBe(400);
  });

  it('decks do jogador sobrevivem ao seed (reinício do servidor)', async () => {
    const db = openDb(':memory:');
    seed(db);
    const a = buildApp(db, { server: { cardImages: true } });
    const c = (await a.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Meu', leader: 'ST01-001', cards: luffy.cards } })).json();
    seed(db);
    expect((await a.inject(`/api/decks/${c.id}`)).json().deck.name).toBe('Meu');
  });

  it('só o dono edita ou apaga; os outros veem o deck como da comunidade', async () => {
    const a = app();
    const c = (await a.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Da Alice', leader: 'ST01-001', cards: luffy.cards } })).json();

    const put = (headers: Record<string, string>) =>
      a.inject({ method: 'PUT', url: `/api/decks/${c.id}`, headers, payload: { name: 'Hack', leader: 'ST01-001', cards: [] } });
    expect((await put(BOB)).statusCode).toBe(403);
    expect((await put({})).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${c.id}`, headers: BOB })).statusCode).toBe(403);

    const asBob = (await a.inject({ url: '/api/decks', headers: BOB })).json();
    expect(asBob.find((d: { id: string }) => d.id === c.id)).toMatchObject({ name: 'Da Alice', mine: false });
    const asAlice = (await a.inject({ url: '/api/decks', headers: ALICE })).json();
    expect(asAlice.find((d: { id: string }) => d.id === c.id).mine).toBe(true);

    // o hash do dono nunca é enviado ao cliente
    const full = await a.inject({ url: `/api/decks/${c.id}`, headers: BOB });
    expect(full.body).not.toContain('ownerHash');
    expect(full.json().deck.mine).toBe(false);

    // editar não troca o dono
    expect((await put(ALICE)).statusCode).toBe(200);
    expect((await put(BOB)).statusCode).toBe(403);
  });
});
