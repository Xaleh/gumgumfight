// All Blue no servidor: selo do deck, filas (casual sim, ranqueada não), salas privadas, Líderes
// e o sorteio do deck do bot.

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, upsertGoogleUser } from '../src/auth/store';
import { type DB, listDecks, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { seed } from '../src/seed';
import { chamberDecks, type ChamberPreset } from '../src/tournaments/chamber';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true, onlineBotRooms: true }, onlineRateLimit: 1e9, botDelayMs: 0 }) };
}
type App = ReturnType<typeof buildApp>;
const post = (app: App, url: string, headers: Record<string, string>, payload: unknown) => app.inject({ method: 'POST', url, headers, payload: payload as object });
function login(db: DB, name: string) {
  const user = upsertGoogleUser(db, { sub: `sub-${name}`, email: `${name}@example.com`, emailVerified: true, name, picture: null });
  return { cookie: `gg_session=${createSession(db, user.id)}` };
}

describe('All Blue: selo do deck', () => {
  it('o resumo diz em quais formatos o deck vale; os decks prontos do All Blue vêm marcados', async () => {
    const { app } = setup();
    const decks = (await app.inject({ url: '/api/decks', headers: ALICE })).json() as Array<{
      id: string;
      allBlue: boolean;
      formats: Record<string, string[]>;
      formatCodes: Record<string, Array<{ code: string; params: Record<string, string> }>>;
    }>;
    const starter = decks.find((d) => d.id === 'st01-luffy')!;
    expect(starter.allBlue).toBe(false);
    expect(starter.formats.egb).toEqual([]);
    expect(starter.formatCodes.allblue.map((c) => [c.code, c.params.id, c.params.rarity])).toEqual([
      ['rules.rarity', 'ST01-012', 'SR'],
      ['rules.rarity', 'ST01-013', 'SR'],
    ]);
    const ready = decks.filter((d) => d.allBlue);
    expect(ready.map((d) => d.id).sort()).toEqual(['allblue-crocodile', 'allblue-kaido', 'allblue-kid', 'allblue-luffy', 'allblue-sakazuki', 'allblue-yamato']);
    for (const d of ready) expect(d.formats.allblue, d.id).toEqual([]);
    // Líder banido pela Bandai: fora dos formatos oficiais; no All Blue o que barra é só a raridade.
    const law = decks.find((d) => d.id === 'st10-law')!;
    expect(law.formatCodes.egb.map((c) => c.code)).toContain('rules.banned');
    expect(law.formatCodes.allblue.every((c) => c.code === 'rules.rarity')).toBe(true);
  });
});

describe('All Blue: filas e salas', () => {
  it('fila casual: recusa o deck com SR (com o motivo) e aceita o deck do formato', async () => {
    const { app } = setup();
    const bad = await post(app, '/api/online/queue', ALICE, { deckId: 'st01-luffy', queue: 'casual', format: 'allblue' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ errorCode: 'deckNotAllowedInFormat', errorParams: { format: 'All Blue', issueCode: 'rules.rarity' } });
    const ok = await post(app, '/api/online/queue', ALICE, { deckId: 'allblue-luffy', queue: 'casual', format: 'allblue' });
    expect(ok.statusCode).toBe(201);
    const stats = (await app.inject('/api/online/stats')).json();
    expect(stats.queue.casual).toMatchObject({ standard: 0, egb: 0, allblue: 1 });
    // Fila própria: quem espera no EGB não é pareado com quem espera no All Blue.
    const egb = await post(app, '/api/online/queue', BOB, { deckId: 'allblue-kid', queue: 'casual', format: 'egb' });
    expect(egb.statusCode).toBe(201);
    expect((await app.inject(`/api/online/queue/${ok.json().ticket}`)).json().status).toBe('waiting');
    const match = await post(app, '/api/online/queue', { 'x-deck-owner': 'carol-0123456789abcdef' }, { deckId: 'allblue-kid', queue: 'casual', format: 'allblue' });
    expect((await app.inject(`/api/online/queue/${match.json().ticket}`)).json().status).toBe('matched');
  });

  it('não tem ranqueada', async () => {
    const { db, app } = setup();
    const r = await post(app, '/api/online/queue', { ...ALICE, ...login(db, 'alice') }, { deckId: 'allblue-luffy', queue: 'ranked', format: 'allblue' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ errorCode: 'rankedNotInFormat', errorParams: { format: 'All Blue' } });
  });

  it('sala privada: quem entra joga nas regras de quem criou', async () => {
    const { app } = setup();
    const created = await post(app, '/api/online/rooms', ALICE, { deckId: 'allblue-luffy', format: 'allblue', spoilers: false });
    expect(created.statusCode).toBe(201);
    const { code } = created.json();
    const bad = await post(app, '/api/online/rooms/join', BOB, { code, deckId: 'st02-kid' });
    expect(bad.json()).toMatchObject({ errorCode: 'deckNotAllowedInFormat', errorParams: { issueCode: 'rules.rarity' } });
    expect((await post(app, '/api/online/rooms/join', BOB, { code, deckId: 'allblue-kid' })).statusCode).toBe(200);
  });

  it('todo Líder vale, inclusive os banidos pela Bandai', async () => {
    const { app } = setup();
    const ids = async (format: string) => ((await app.inject(`/api/online/leaders?format=${format}`)).json() as Array<{ id: string }>).map((l) => l.id);
    const all = await ids('allblue');
    expect(all).toContain('ST10-001');
    expect(await ids('egb')).not.toContain('ST10-001');
    expect(all.length).toBeGreaterThan((await ids('egb')).length);
    const pick = await post(app, '/api/online/queue', ALICE, { deckId: 'allblue-luffy', queue: 'casual', format: 'allblue', leader: 'ST10-001' });
    expect(pick.statusCode).toBe(201);
  });
});

describe('All Blue: decks prontos como oponente', () => {
  const botDeck = (app: App, roomId: string) => (app as unknown as { onlineLobby: Lobby }).onlineLobby.get(roomId)!.data.seats[1].deckId;

  it('o bot sorteia entre os decks do All Blue no formato, e nunca um deles nos outros', async () => {
    const { db, app } = setup();
    // Uma pessoa por sala: cada jogador só tem uma partida aberta por vez.
    const player = (n: number) => ({ 'x-deck-owner': `player-${n}-0123456789abcdef`, ...login(db, `player${n}`) });
    for (let i = 0; i < 8; i++) {
      const room = await post(app, '/api/online/bot', player(i), { deckId: 'allblue-luffy', format: 'allblue', spoilers: false });
      expect(room.statusCode).toBe(201);
      expect(botDeck(app, room.json().roomId)).toMatch(/^allblue-/);
    }
    for (let i = 8; i < 16; i++) {
      const room = await post(app, '/api/online/bot', player(i), { deckId: 'st01-luffy', format: 'egb', spoilers: false });
      expect(room.statusCode).toBe(201);
      expect(botDeck(app, room.json().roomId)).not.toMatch(/^allblue-/);
    }
  });

  it('a Sala do Tempo só usa os decks do All Blue num evento desse formato', () => {
    const { db } = setup();
    const preset = { leaders: [{ leader: 'ST01-001', share: 0.5 }] } as unknown as ChamberPreset;
    const at = new Date('2026-11-21T12:00:00Z');
    const egb = chamberDecks(db, preset, { format: 'egb', spoilers: false }, at);
    expect(egb.others.some((d) => d.group === 'allblue')).toBe(false);
    expect(egb.leaders[0].deckId).toBe('st01-luffy');
    const ab = chamberDecks(db, preset, { format: 'allblue', spoilers: false }, at);
    expect(ab.others.map((d) => d.id).sort()).toEqual(listDecks(db).filter((d) => d.group === 'allblue').map((d) => d.id).sort());
    expect(ab.leaders[0].deckId).toBe('allblue-luffy');
  });
});

describe('All Blue: fora das estatísticas do construído', () => {
  it('a tela de estatísticas só lista os formatos oficiais', async () => {
    const { app } = setup();
    const meta = (await app.inject({ url: '/api/stats/meta', headers: ALICE })).json();
    expect(meta.formats.map((f: { id: string }) => f.id)).toEqual(['standard', 'egb']);
  });
});
