import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { seed } from '../src/seed';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8'));

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

  it('cria, edita e apaga um deck do jogador', async () => {
    const a = app();
    const created = await a.inject({ method: 'POST', url: '/api/decks', payload: { name: 'Rascunho', leader: 'ST01-001', cards: [{ id: 'st01-002', count: 4 }] } });
    expect(created.statusCode).toBe(201);
    const c = created.json();
    expect(c).toMatchObject({ kind: 'user', valid: false, size: 4 });
    expect(c.errors[0]).toMatch(/faltam 46/);

    const updated = await a.inject({ method: 'PUT', url: `/api/decks/${c.id}`, payload: { name: 'Meu Luffy', leader: 'ST01-001', cards: luffy.cards } });
    expect(updated.json()).toMatchObject({ name: 'Meu Luffy', valid: true, size: 50 });

    const full = (await a.inject(`/api/decks/${c.id}`)).json();
    expect(full.cards.length).toBe(17);
    expect(full.summary.valid).toBe(true);

    expect((await a.inject({ method: 'DELETE', url: `/api/decks/${c.id}` })).statusCode).toBe(204);
    expect((await a.inject(`/api/decks/${c.id}`)).statusCode).toBe(404);
  });

  it('decks prontos não podem ser alterados nem apagados', async () => {
    const a = app();
    expect((await a.inject({ method: 'PUT', url: '/api/decks/st01-luffy', payload: { name: 'x', leader: 'ST01-001', cards: [] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: '/api/decks/st01-luffy' })).statusCode).toBe(403);
  });

  it('rejeita dados malformados', async () => {
    const a = app();
    expect((await a.inject({ method: 'POST', url: '/api/decks', payload: { name: '', leader: 'ST01-001', cards: [] } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/decks', payload: { name: 'x', cards: [{ id: 'A', count: 0 }] } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/decks', payload: { name: 'x', cards: 'nada' } })).statusCode).toBe(400);
  });

  it('decks do jogador sobrevivem ao seed (reinício do servidor)', async () => {
    const db = openDb(':memory:');
    seed(db);
    const a = buildApp(db, { server: { cardImages: true } });
    const c = (await a.inject({ method: 'POST', url: '/api/decks', payload: { name: 'Meu', leader: 'ST01-001', cards: luffy.cards } })).json();
    seed(db);
    expect((await a.inject(`/api/decks/${c.id}`)).json().deck.name).toBe('Meu');
  });
});
