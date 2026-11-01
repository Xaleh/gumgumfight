// Bot do Time: as correções do Time sobre as jogadas do bot (marcações com a posição exata e a nota da partida).

import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, setUserTeam, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import { positionAt } from '../src/decisions/extract';
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
