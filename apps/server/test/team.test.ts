// Bot do Time: as correções do Time sobre as jogadas do bot (marcações com a posição exata e a nota da partida).

import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, setUserTeam, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { positionAt } from '../src/decisions/extract';
import { DATA_DIR } from '../src/paths';
import { seed } from '../src/seed';

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true } }) };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, role: Role = 'player', team = false) {
  n++;
  const u = upsertGoogleUser(db, { sub: `team-${n}`, email: `t${n}@example.com`, emailVerified: true, name: `T${n}`, picture: null });
  setUserRole(db, u.id, role);
  setUserTeam(db, u.id, team);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `browser-t${n}-0123456789abcdef` } };
}

async function decksAndCards(app: App, ids: [string, string]) {
  const [a, b] = await Promise.all(ids.map(async (id) => (await app.inject(`/api/decks/${id}`)).json()));
  return { decks: [a.deck, b.deck] as [DeckList, DeckList], cards: [...a.cards, ...b.cards] as CardData[] };
}

/** Joga uma partida bot x bot e devolve o replay. */
function playOut(decks: [DeckList, DeckList], cards: CardData[], s: number) {
  let state = createGame({ seed: s, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
  const actions: Action[] = [];
  while (state.phase !== 'gameover' && actions.length < 3000) {
    const a = chooseBotAction(state, actingPlayer(state)!);
    actions.push(a);
    state = applyAction(state, a);
  }
  return { seed: s, decks, actions, winner: state.winner, turns: state.turn };
}

/** Grava uma partida contra o bot (o assento 0 é de quem envia; o 1, do bot). */
async function recordBotMatch(app: App, who: { headers: Record<string, string> }, s = 11) {
  const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
  const r = playOut(decks, cards, s);
  const res = await app.inject({
    method: 'POST',
    url: '/api/matches',
    headers: who.headers,
    payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: ['st01-luffy', 'st02-kid'], decks, actions: r.actions },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { matchId: res.json().id as number, actions: r.actions };
}

describe('Bot do Time: correções', () => {
  it('só o Time envia; a marcação guarda a visão do bot na jogada e a nota vai de 1 a 5', async () => {
    const { db, app } = setup();
    const fan = login(db);
    const member = login(db, 'player', true);
    const { matchId, actions } = await recordBotMatch(app, member);
    const post = (who: { headers: Record<string, string> }, payload: object) => app.inject({ method: 'POST', url: '/api/bot/feedback', headers: who.headers, payload });

    expect((await app.inject({ method: 'POST', url: '/api/bot/feedback', payload: { matchId, rating: 3 } })).statusCode).toBe(401);
    expect((await post(fan, { matchId, rating: 3 })).statusCode).toBe(403);
    expect((await post(member, { matchId })).statusCode).toBe(400);
    expect((await post(member, { matchId, rating: 9 })).statusCode).toBe(400);
    expect((await post(member, { matchId: 999, rating: 3 })).statusCode).toBe(404);
    expect((await post(member, { matchId, level: 'chefe', rating: 3 })).statusCode).toBe(400);

    // A jogada marcada precisa ser do bot (assento 1).
    const human = actions.findIndex((a) => a.player === 0 && a.type !== 'mulligan');
    expect((await post(member, { matchId, marks: [{ index: human }] })).json().errorCode).toBe('markNotBotAction');
    const bot = actions.findIndex((a, i) => i > 10 && a.player === 1 && (a.type === 'attack' || a.type === 'playCard'));
    expect(bot).toBeGreaterThan(0);
    const sent = await post(member, {
      matchId,
      level: 'team',
      rating: 4,
      comment: 'Jogou bem, mas deixou o Zoro virado.',
      marks: [{ index: bot, expected: { type: 'endTurn' }, comment: 'Devia ter guardado o DON!!' }],
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().ids).toHaveLength(2);

    // A lista (sem a posição) e o item inteiro (com a visão do bot).
    const list = (await app.inject({ url: '/api/bot/feedback', headers: member.headers })).json().items;
    expect(list).toHaveLength(2);
    const mark = list.find((f: { kind: string }) => f.kind === 'mark');
    expect(mark).toMatchObject({ matchId, kind: 'mark', botLevel: 'team', botSeat: 1, botDeck: 'st02-kid', actionIndex: bot, expected: { type: 'endTurn' }, status: 'open', userName: 'T2' });
    expect(mark.botAction.type).toBe(actions[bot].type);
    expect(mark.position).toBeUndefined();
    const full = (await app.inject({ url: `/api/bot/feedback/${mark.id}`, headers: member.headers })).json();
    expect(full.position.turn).toBe(mark.turn);
    // A visão é a do bot: a mão do humano está escondida.
    expect(full.position.players[0].hand.every((u: string) => full.position.cards[u].cardId === '?')).toBe(true);
    expect(full.position.players[1].hand.some((u: string) => full.position.cards[u].cardId !== '?')).toBe(true);
    const pos = positionAt(db, matchId, bot)!;
    expect(pos.action).toEqual(actions[bot]);
    expect(list.find((f: { kind: string }) => f.kind === 'rating')).toMatchObject({ rating: 4, comment: 'Jogou bem, mas deixou o Zoro virado.' });

    const summary = (await app.inject({ url: '/api/bot/feedback/summary', headers: member.headers })).json().decks;
    expect(summary).toEqual([{ botDeck: 'st02-kid', leader: 'ST02-001', ratings: 1, avgRating: 4, openMarks: 1, marks: 1 }]);

    // Só o admin trata; o Time lê a caixa.
    expect((await app.inject({ method: 'PUT', url: `/api/bot/feedback/${mark.id}`, headers: member.headers, payload: { status: 'test' } })).statusCode).toBe(403);
    const admin = login(db, 'admin');
    expect((await app.inject({ method: 'PUT', url: `/api/bot/feedback/${mark.id}`, headers: admin.headers, payload: { status: 'nope' } })).statusCode).toBe(400);
    const done = (await app.inject({ method: 'PUT', url: `/api/bot/feedback/${mark.id}`, headers: admin.headers, payload: { status: 'test', note: 'virou o teste "guarda DON!!"' } })).json();
    expect(done).toMatchObject({ status: 'test', note: 'virou o teste "guarda DON!!"' });
    expect(done.resolvedAt).toBeTruthy();
    expect((await app.inject({ url: '/api/bot/feedback', headers: member.headers })).json().items).toHaveLength(1);
    expect((await app.inject({ url: '/api/bot/feedback?status=all', headers: admin.headers })).json().items).toHaveLength(2);
  });

  it('recusa partidas que não são contra o bot', async () => {
    const { db, app } = setup();
    const member = login(db, 'player', true);
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 3);
    const demo = await app.inject({ method: 'POST', url: '/api/matches', headers: member.headers, payload: { mode: 'demo', format: 'egb', seed: r.seed, decks, actions: r.actions } });
    const res = await app.inject({ method: 'POST', url: '/api/bot/feedback', headers: member.headers, payload: { matchId: demo.json().id, rating: 2 } });
    expect(res.json().errorCode).toBe('notBotMatch');
  });
});

describe('Bot do Time: decks do meta, guia e perfil', () => {
  it('lista os decks de data/decks/meta com o estado do guia e do perfil; só o Time lê', async () => {
    const { db, app } = setup();
    const fan = login(db);
    const member = login(db, 'player', true);
    expect((await app.inject({ url: '/api/bot/profiles', headers: fan.headers })).statusCode).toBe(403);
    const list = (await app.inject({ url: '/api/bot/profiles', headers: member.headers })).json().decks;
    const xebec = list.find((d: { id: string }) => d.id === 'op17-xebec');
    expect(xebec).toMatchObject({ leader: 'OP17-039', hasGuide: true, hasProfile: true, archetype: 'control', profileError: null });
    const full = (await app.inject({ url: '/api/bot/profiles/op17-xebec', headers: member.headers })).json();
    expect(full.profile).toMatchObject({ id: 'op17-xebec', archetype: 'control', hold: { 'OP17-118': { untilDon: 10 } } });
    expect(full.guide).toMatch(/^# Rocks.D.Xebec/);
    expect((await app.inject({ url: '/api/bot/profiles/nope', headers: member.headers })).statusCode).toBe(404);
  });

  it('o carregador relê o perfil quando o arquivo muda e recusa um perfil inválido', async () => {
    const { mkdtempSync, writeFileSync, utimesSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { MetaProfiles } = await import('../src/team/profiles');
    const dir = mkdtempSync(join(tmpdir(), 'gg-meta-'));
    writeFileSync(join(dir, 'x-deck.json'), JSON.stringify({ id: 'x-deck', name: 'X', leader: 'ST01-001', cards: [] }));
    const profiles = new MetaProfiles(dir);
    expect(profiles.list()).toMatchObject([{ id: 'x-deck', hasGuide: false, hasProfile: false, profileError: null }]);
    expect(profiles.profile('x-deck')).toBeNull();
    writeFileSync(join(dir, 'x-deck.profile.json'), JSON.stringify({ id: 'x-deck', leader: 'ST01-001', archetype: 'tempo' }));
    expect(profiles.list()[0]).toMatchObject({ hasProfile: false, profileError: expect.stringMatching(/archetype/) });
    const p = join(dir, 'x-deck.profile.json');
    writeFileSync(p, JSON.stringify({ id: 'x-deck', leader: 'ST01-001', archetype: 'aggro', summary: 'bate' }));
    utimesSync(p, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(profiles.list()[0]).toMatchObject({ hasProfile: true, archetype: 'aggro', summary: 'bate' });
    writeFileSync(join(dir, 'x-deck.md'), '# guia');
    expect(profiles.guide('x-deck')).toBe('# guia');
    expect(profiles.guide('../x-deck')).toBeNull();
  });
});

describe('Bot do Time: editor de guia e perfil, e o agente fora da partida', () => {
  const fakeComplete = (answers: string[]) => {
    const calls: Array<{ system: string; user: string }> = [];
    const complete = async (system: string, user: string) => {
      calls.push({ system, user });
      return answers.shift() ?? '';
    };
    return { complete, calls };
  };

  it('o admin salva guia e perfil no banco (por cima dos arquivos) e o perfil é conferido', async () => {
    const { db, app } = setup();
    const member = login(db, 'player', true);
    const admin = login(db, 'admin');
    const put = (who: { headers: Record<string, string> }, payload: object) => app.inject({ method: 'PUT', url: '/api/bot/profiles/op17-xebec', headers: who.headers, payload });
    expect((await put(member, { guide: 'x' })).statusCode).toBe(403);
    expect((await put(admin, {})).statusCode).toBe(400);
    expect((await put(admin, { profile: { id: 'op17-xebec', leader: 'OP17-039', archetype: 'tempo' } })).json().errorCode).toBe('invalidProfile');
    expect((await put(admin, { profile: { id: 'outro', leader: 'OP17-039', archetype: 'aggro' } })).json().errorCode).toBe('invalidProfile');
    const saved = (await put(admin, { guide: '# Guia novo', profile: JSON.stringify({ id: 'op17-xebec', leader: 'OP17-039', archetype: 'aggro', summary: 'bate' }) })).json();
    expect(saved).toMatchObject({ id: 'op17-xebec', hasGuide: true, hasProfile: true, archetype: 'aggro', overridden: true, guide: '# Guia novo' });
    expect(saved.profile.summary).toBe('bate');
    // O arquivo continua como estava; o banco é o que vale no servidor.
    expect(JSON.parse(readFileSync(join(DATA_DIR, 'decks', 'meta', 'op17-xebec.profile.json'), 'utf8')).archetype).toBe('control');
    const got = (await app.inject({ url: '/api/bot/profiles/op17-xebec', headers: member.headers })).json();
    expect(got.profile.archetype).toBe('aggro');
    // Voltar ao arquivo: null nos dois.
    const back = (await put(admin, { guide: null, profile: null })).json();
    expect(back).toMatchObject({ archetype: 'control', overridden: false });
    expect(back.guide).toMatch(/^# Rocks.D.Xebec/);
  });

  it('sem a chave, o agente está desligado (503); com ela, o guia vira um rascunho de perfil e a partida é revisada', async () => {
    const off = setup();
    const admin0 = login(off.db, 'admin');
    expect((await off.app.inject({ url: '/api/bot/agent', headers: admin0.headers })).json()).toEqual({ enabled: false });
    expect((await off.app.inject({ method: 'POST', url: '/api/bot/profiles/op17-xebec/generate', headers: admin0.headers, payload: {} })).statusCode).toBe(503);

    const db = openDb(':memory:');
    seed(db);
    const { complete, calls } = fakeComplete([
      'texto solto { "profile": { "leader": "OP17-039", "archetype": "cheio" } }',
      '```json\n{ "profile": { "id": "ignorado", "leader": "OP17-039", "archetype": "control", "roles": { "OP17-118": "finisher" }, "hold": { "OP17-118": { "untilDon": 10 } } }, "why": { "archetype": "o guia fala em mão como recurso" } }\n```',
      '- Turno 3: Fez: baixou o Newgate. Guia: Buckin primeiro. Conceito: travar o atacante antes de desenvolver.',
    ]);
    const app = buildApp(db, { server: { cardImages: true }, agentComplete: complete });
    const admin = login(db, 'admin');
    const member = login(db, 'player', true);
    expect((await app.inject({ url: '/api/bot/agent', headers: member.headers })).json()).toEqual({ enabled: true });
    expect((await app.inject({ method: 'POST', url: '/api/bot/profiles/op17-xebec/generate', headers: member.headers, payload: {} })).statusCode).toBe(403);
    // A primeira resposta é inválida: o agente tenta de novo com o motivo; a segunda vale (o id é o do deck).
    const gen = await app.inject({ method: 'POST', url: '/api/bot/profiles/op17-xebec/generate', headers: admin.headers, payload: {} });
    expect(gen.statusCode, gen.body).toBe(200);
    expect(gen.json().profile).toMatchObject({ id: 'op17-xebec', archetype: 'control', hold: { 'OP17-118': { untilDon: 10 } } });
    expect(gen.json().why.archetype).toMatch(/mão/);
    expect(calls).toHaveLength(2);
    expect(calls[0].user).toContain('GUIA:');
    expect(calls[0].user).toContain('OP17-039');
    expect(calls[1].user).toMatch(/recusada: perfil inválido: archetype/);
    // Revisão de uma partida contra o bot: o traço vai turno a turno com os nomes das cartas.
    const { matchId } = await recordBotMatch(app, member);
    const review = await app.inject({ method: 'POST', url: `/api/bot/matches/${matchId}/review`, headers: admin.headers, payload: { deckId: 'op17-xebec' } });
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json()).toMatchObject({ deckId: 'op17-xebec' });
    expect(review.json().review).toMatch(/Turno 3/);
    expect(calls[2].user).toMatch(/TURNO \d+ \(bot\)/);
    expect(calls[2].user).toMatch(/ataca|baixa|encerra o turno/);
    // Sem guia para o deck do bot (ST02): 400.
    expect((await app.inject({ method: 'POST', url: `/api/bot/matches/${matchId}/review`, headers: admin.headers, payload: {} })).json().errorCode).toBe('noGuide');
  });
});

describe('Bot do Time: traço de uma partida a partir do arquivo de replay (sem a chave)', () => {
  it('o replay baixado vira o mesmo traço da partida gravada', async () => {
    const { db, app } = setup();
    const member = login(db, 'player', true);
    const { matchId } = await recordBotMatch(app, member);
    const { fileTrace, matchTrace } = await import('../src/team/trace');
    const { matchReplay } = await import('../src/reports/store');
    const file = matchReplay(db, matchId)!;
    const fromDb = matchTrace(db, matchId, 1)!;
    const fromFile = fileTrace(db, file as never, 1)!;
    expect(fromFile).toBe(fromDb);
    expect(fromFile).toMatch(/TURNO \d+ \(bot\)/);
    expect(fromFile).toMatch(/FIM: o bot (venceu|perdeu)/);
    expect(fileTrace(db, { ...(file as object), decks: [] } as never, 1)).toBeNull();
  });
});
