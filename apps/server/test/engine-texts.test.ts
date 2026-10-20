import { buildCardDef, CARD_SCRIPTS, type CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, getCards, listCardGaps, openDb, recordCardGaps, upsertCards } from '../src/db';
import { pinEngineTexts } from '../src/online/room';
import { seed } from '../src/seed';

const OFFICIAL = "[On Play] Swap out up to 1 of your opponent's Characters with 3000 power or less by K.O.ing it.";
const REWRITE = "[On Play] K.O. up to 1 of your opponent's Characters with 3000 power or less.";
const card: CardData = { id: 'EX01-001', name: 'Carta Teste', category: 'character', colors: ['red'], cost: 2, power: 3000, types: [], text: OFFICIAL, set: 'EX01' };

let n = 0;
function setup() {
  const db = openDb(':memory:');
  seed(db);
  upsertCards(db, [card], { provisional: false, source: 'api:test' });
  recordCardGaps(db);
  return { db, app: buildApp(db, { server: { cardImages: false } }) };
}
const as = (db: DB, role: Role, name = `D${++n}`) => {
  const u = upsertGoogleUser(db, { sub: `et-${++n}`, email: `et${n}@example.com`, emailVerified: true, name, picture: null });
  setUserRole(db, u.id, role);
  return { cookie: `gg_session=${createSession(db, u.id)}` };
};

describe('texto para o motor (Dev)', () => {
  it('só o perfil Dev usa', async () => {
    const { db, app } = setup();
    expect((await app.inject({ url: '/api/dev/engine-texts' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: `/api/dev/engine-texts/${card.id}`, headers: as(db, 'admin'), payload: { text: REWRITE } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/dev/engine-texts/preview', headers: as(db, 'player'), payload: { cardId: card.id, text: REWRITE } })).statusCode).toBe(403);
  });

  it('prévia: o que o leitor faria com o texto, sem gravar', async () => {
    const { db, app } = setup();
    const dev = as(db, 'dev');
    const res = (await app.inject({ method: 'POST', url: '/api/dev/engine-texts/preview', headers: dev, payload: { cardId: card.id, text: REWRITE, trigger: '' } })).json();
    expect(res.status).toBe('auto');
    expect(res.lines).toEqual([{ line: REWRITE, ok: true }]);
    expect(res.pt.complete).toBe(true);
    expect(getCards(db, [card.id])[0].engineText).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: '/api/dev/engine-texts/preview', headers: dev, payload: { cardId: 'XX-999', text: REWRITE } })).statusCode).toBe(404);
  });

  it('grava: o motor lê o texto novo, o texto exibido continua o oficial e a carta sai das ⚙', async () => {
    const { db, app } = setup();
    const dev = as(db, 'dev', 'Nami');
    expect(listCardGaps(db).has(card.id)).toBe(true);
    const saved = await app.inject({ method: 'PUT', url: `/api/dev/engine-texts/${card.id}`, headers: dev, payload: { text: REWRITE } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      card: { text: OFFICIAL },
      engineText: { text: REWRITE, trigger: null, authorName: 'Nami' },
      stale: false,
      official: { status: 'manual' },
      current: { status: 'auto' },
      history: [{ action: 'set', text: REWRITE, authorName: 'Nami' }],
    });

    const api = (await app.inject({ url: `/api/cards/${card.id}` })).json();
    expect(api.text).toBe(OFFICIAL);
    expect(api.engineText).toEqual({ text: REWRITE });
    expect(api.i18n.pt.source).toBe('auto');
    const def = buildCardDef(getCards(db, [card.id])[0]);
    expect(def.text).toBe(OFFICIAL);
    expect(def.manual).toBe(false);
    expect(def.abilities.map((a) => a.timing)).toEqual(['onPlay']);
    expect(listCardGaps(db).has(card.id)).toBe(false);

    const list = (await app.inject({ url: '/api/dev/engine-texts', headers: dev })).json().texts;
    expect(list).toEqual([
      expect.objectContaining({ cardId: card.id, name: 'Carta Teste', set: 'EX01', stale: false, missing: false, status: 'auto', officialStatus: 'manual', authorName: 'Nami' }),
    ]);
    const gaps = (await app.inject({ url: '/api/dev/card-gaps/cards?set=EX01', headers: dev })).json().cards;
    expect(gaps).toEqual([]);
  });

  it('texto oficial que muda (errata, fonte nova) desliga o texto para o motor até o Dev revisar', async () => {
    const { db, app } = setup();
    const dev = as(db, 'dev');
    await app.inject({ method: 'PUT', url: `/api/dev/engine-texts/${card.id}`, headers: dev, payload: { text: REWRITE } });
    upsertCards(db, [{ ...card, text: `${OFFICIAL} Then, draw 1 card.` }], { provisional: false, source: 'api:test' });
    expect(getCards(db, [card.id])[0].engineText).toBeUndefined();
    const detail = (await app.inject({ url: `/api/dev/engine-texts/${card.id}`, headers: dev })).json();
    expect(detail).toMatchObject({ stale: true, current: { status: 'manual' }, engineText: { text: REWRITE } });
    expect((await app.inject({ url: '/api/dev/engine-texts', headers: dev })).json().texts[0].stale).toBe(true);
    // Gravar de novo revisa: vale para o texto oficial novo.
    await app.inject({ method: 'PUT', url: `/api/dev/engine-texts/${card.id}`, headers: dev, payload: { text: `${REWRITE} Then, draw 1 card.` } });
    expect(getCards(db, [card.id])[0].engineText?.text).toBe(`${REWRITE} Then, draw 1 card.`);
  });

  it('remover volta ao texto oficial e fica no histórico', async () => {
    const { db, app } = setup();
    const dev = as(db, 'dev', 'Zoro');
    await app.inject({ method: 'PUT', url: `/api/dev/engine-texts/${card.id}`, headers: dev, payload: { text: REWRITE } });
    const del = (await app.inject({ method: 'DELETE', url: `/api/dev/engine-texts/${card.id}`, headers: dev })).json();
    expect(del).toMatchObject({ engineText: null, current: { status: 'manual' } });
    expect(del.history.map((h: { action: string }) => h.action)).toEqual(['remove', 'set']);
    expect(getCards(db, [card.id])[0].engineText).toBeUndefined();
    expect(listCardGaps(db).get(card.id)?.reviewedAt).toBeNull();
    expect((await app.inject({ method: 'DELETE', url: `/api/dev/engine-texts/${card.id}`, headers: dev })).statusCode).toBe(404);
  });

  it('recusa texto vazio, igual ao oficial, longo demais e carta com script', async () => {
    const { db, app } = setup();
    const dev = as(db, 'dev');
    const put = (id: string, payload: object) => app.inject({ method: 'PUT', url: `/api/dev/engine-texts/${id}`, headers: dev, payload });
    expect((await put(card.id, { text: '  ' })).json().errorCode).toBe('engineTextEmpty');
    expect((await put(card.id, { text: OFFICIAL })).json().errorCode).toBe('engineTextSameAsOfficial');
    expect((await put(card.id, { text: 'x'.repeat(3001) })).json().errorCode).toBe('engineTextTooLong');
    expect((await put(card.id, { text: REWRITE, trigger: 3 })).statusCode).toBe(400);
    const scripted = Object.keys(CARD_SCRIPTS).find((id) => getCards(db, [id]).length)!;
    expect((await put(scripted, { text: REWRITE })).statusCode).toBe(409);
    expect((await put('XX-999', { text: REWRITE })).statusCode).toBe(404);
  });

  it('sala online: os textos do começo da partida ficam fixos', () => {
    const now: CardData = { ...card, engineText: { text: 'outro texto' } };
    const plain: CardData = { ...card, id: 'EX01-002' };
    const pinned = pinEngineTexts([now, plain], { 'EX01-002': { text: REWRITE } });
    expect(pinned[0].engineText).toBeUndefined();
    expect(pinned[1].engineText).toEqual({ text: REWRITE });
    // Sala de antes do campo: as cartas como estão.
    expect(pinEngineTexts([now], undefined)[0].engineText).toEqual({ text: 'outro texto' });
  });
});
