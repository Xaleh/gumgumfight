import type { CardData } from '@gumgum/engine';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, listCardGaps, openDb, recordCardGaps, upsertCards } from '../src/db';
import { seed } from '../src/seed';

const char = (id: string, text: string): CardData => ({ id, name: `Carta ${id}`, category: 'character', colors: ['red'], cost: 2, power: 3000, types: [], text, set: 'GX01' });
// Duas cartas com a mesma frase que o leitor não entende (só muda o número) e uma parcial.
const GAPS = [
  char('GX01-001', '[On Play] Swap up to 1 of your opponent\'s Characters with 3000 power or less.'),
  char('GX01-002', '[When Attacking] Swap up to 2 of your opponent\'s Characters with 5000 power or less.'),
  char('GX01-003', '[On Play] Draw 1 card.\n[On K.O.] Do something unusual with this card.'),
];

let n = 0;
function setup() {
  const db = openDb(':memory:');
  seed(db);
  upsertCards(db, GAPS, { provisional: false, source: 'api:test' });
  return { db, app: buildApp(db, { server: { cardImages: false } }) };
}
const as = (db: DB, role: Role) => {
  const u = upsertGoogleUser(db, { sub: `gap-${++n}`, email: `gap${n}@example.com`, emailVerified: true, name: `G${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { cookie: `gg_session=${createSession(db, u.id)}` };
};

describe('lacunas do leitor (Dev)', () => {
  it('só o perfil Dev vê', async () => {
    const { db, app } = setup();
    expect((await app.inject({ url: '/api/dev/card-gaps' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/dev/card-gaps', headers: as(db, 'admin') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/dev/card-gaps/reviewed', headers: as(db, 'player') })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/dev/card-gaps', headers: as(db, 'dev') })).statusCode).toBe(200);
  });

  it('mostra o diagnóstico, o ranking das frases e as cartas novas até o Dev marcar como vistas', async () => {
    const { db, app } = setup();
    const dev = as(db, 'dev');
    expect(recordCardGaps(db).added).toBeGreaterThanOrEqual(3);

    const summary = (await app.inject({ url: '/api/dev/card-gaps', headers: dev })).json();
    expect(summary.sets.find((s: { set: string }) => s.set === 'GX01')).toEqual({ set: 'GX01', partial: 1, manual: 2, new: 3 });
    const swap = summary.patterns.find((p: { pattern: string }) => p.pattern.startsWith('Swap'));
    expect(swap).toMatchObject({
      stage: 'clause',
      pattern: "Swap up to N of your opponent's Characters with N power or less",
      cards: ['GX01-001', 'GX01-002'],
      sets: ['GX01'],
    });
    // A frase que resolve mais cartas vem primeiro.
    expect(summary.patterns[0].cards.length).toBeGreaterThanOrEqual(2);

    const set = (await app.inject({ url: '/api/dev/card-gaps/cards?set=GX01', headers: dev })).json().cards;
    expect(set.map((c: { id: string }) => c.id)).toEqual(['GX01-001', 'GX01-002', 'GX01-003']);
    expect(set[2]).toMatchObject({ status: 'partial', isNew: true, provisional: false });
    expect(set[2].lines.map((l: { ok: boolean }) => l.ok)).toEqual([true, false]);
    expect((await app.inject({ url: '/api/dev/card-gaps/cards', headers: dev })).statusCode).toBe(400);

    const ids = (await app.inject({ url: '/api/dev/card-gaps/cards?ids=GX01-002,ST01-001', headers: dev })).json().cards;
    expect(ids.map((c: { id: string }) => c.id)).toEqual(['GX01-002']);

    // Marcar uma, depois todas.
    const count = async () => (await app.inject({ url: '/api/dev/card-gaps/new-count', headers: dev })).json().newCount as number;
    const before = await count();
    expect((await app.inject({ method: 'POST', url: '/api/dev/card-gaps/reviewed', headers: dev, payload: { ids: ['GX01-001'] } })).json()).toEqual({ reviewed: 1 });
    expect(await count()).toBe(before - 1);
    expect((await app.inject({ method: 'POST', url: '/api/dev/card-gaps/reviewed', headers: dev, payload: { ids: 'GX01-002' } })).statusCode).toBe(400);
    await app.inject({ method: 'POST', url: '/api/dev/card-gaps/reviewed', headers: dev, payload: {} });
    expect(await count()).toBe(0);
    const news = (await app.inject({ url: '/api/dev/card-gaps/cards?new=1', headers: dev })).json().cards;
    expect(news).toEqual([]);
  });

  it('texto novo deixa a carta nova de novo; carta que o leitor passou a entender sai da lista', () => {
    const { db } = setup();
    recordCardGaps(db, { reviewed: true });
    upsertCards(db, [char('GX01-001', '[On Play] Swap up to 1 of your Characters with a cost of 2 or less.'), char('GX01-002', '[On Play] Draw 1 card.')], {
      provisional: false,
      source: 'api:test',
    });
    expect(recordCardGaps(db)).toEqual({ added: 1, removed: 1 });
    const rows = listCardGaps(db);
    expect(rows.get('GX01-001')?.reviewedAt).toBeNull();
    expect(rows.has('GX01-002')).toBe(false);
    expect(rows.get('GX01-003')?.reviewedAt).not.toBeNull();
  });

  describe('banco que já tinha cartas antes da tabela', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gaps-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('as cartas ⚙ de antes entram como vistas; as que chegam depois são novas', () => {
      const path = join(dir, 'db.sqlite');
      const old = openDb(path);
      upsertCards(old, GAPS.slice(0, 2), { provisional: false, source: 'api:test' });
      old.exec('DROP TABLE card_gaps');
      old.close();

      const db = openDb(path);
      const rows = listCardGaps(db);
      expect([...rows.values()].map((r) => [r.cardId, Boolean(r.reviewedAt)])).toEqual([
        ['GX01-001', true],
        ['GX01-002', true],
      ]);
      upsertCards(db, GAPS.slice(2), { provisional: true, source: 'spoiler:test' });
      expect(recordCardGaps(db).added).toBe(1);
      expect(listCardGaps(db).get('GX01-003')?.reviewedAt).toBeNull();
      db.close();
    });
  });
});
