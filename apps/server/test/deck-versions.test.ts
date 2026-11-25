// Versões do deck (roadmap C2): cada lista salva vira uma versão, com o que entrou e saiu e as partidas
// e a taxa de vitória de cada uma (pelo hash da lista, o mesmo de `deck_lists`).
import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { deckVersions } from '../src/decks/versions';
import { getDeck, openDb } from '../src/db';
import { seed } from '../src/seed';
import { deckHash } from '../src/stats/derive';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8')) as DeckList;
const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: false } }) };
}
type App = ReturnType<typeof setup>['app'];

const versions = async (app: App, id: string, headers: Record<string, string> = ALICE) => app.inject({ url: `/api/decks/${id}/versions`, headers });

function playOut(decks: [DeckList, DeckList], cards: CardData[], s: number) {
  let state = createGame({ seed: s, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
  const actions: Action[] = [];
  while (state.phase !== 'gameover' && actions.length < 3000) {
    const a = chooseBotAction(state, actingPlayer(state)!);
    actions.push(a);
    state = applyAction(state, a);
  }
  return { seed: s, actions, winner: state.winner };
}

/** Joga com o deck salvo `id` contra o Kid e grava a partida; devolve se o deck venceu. */
async function play(app: App, id: string, s: number) {
  const [a, b] = await Promise.all([id, 'st02-kid'].map(async (d) => (await app.inject(`/api/decks/${d}`)).json()));
  const decks = [a.deck, b.deck] as [DeckList, DeckList];
  const r = playOut(decks, [...a.cards, ...b.cards], s);
  const res = await app.inject({
    method: 'POST',
    url: '/api/matches',
    headers: ALICE,
    payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: [id, 'st02-kid'], decks, actions: r.actions },
  });
  expect(res.statusCode).toBe(200);
  return r.winner === 0;
}

describe('versões do deck', () => {
  it('cada lista salva vira uma versão, com o que entrou e saiu; renomear não cria versão', async () => {
    const { app } = setup();
    const v1 = luffy.cards;
    const created = (await app.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Meu Luffy', leader: luffy.leader, cards: v1 } })).json();
    const id = created.id as string;

    // Troca as cópias da primeira carta por mais cópias da segunda.
    const [first, second, ...rest] = v1;
    const v2 = [{ id: second.id, count: second.count + 1 }, ...rest, ...(first.count > 1 ? [{ id: first.id, count: first.count - 1 }] : [])];
    const put = (cards: DeckList['cards'], name = 'Meu Luffy') =>
      app.inject({ method: 'PUT', url: `/api/decks/${id}`, headers: ALICE, payload: { name, leader: luffy.leader, cards } });
    expect((await put(v2)).statusCode).toBe(200);
    // Salvar a mesma lista de novo (só com outro nome) não é versão nova.
    await put(v2, 'Luffy v2');
    await app.inject({ method: 'PUT', url: `/api/decks/${id}/name`, headers: ALICE, payload: { name: 'Luffy!' } });

    const body = (await versions(app, id)).json();
    expect(body.total).toBe(2);
    const [now, before] = body.versions;
    expect(now).toMatchObject({ number: 2, current: true, games: 0, winRate: null, hash: deckHash({ leader: luffy.leader, cards: v2 }) });
    expect(before).toMatchObject({ number: 1, current: false, hash: deckHash(luffy) });
    expect(now.diff.added).toEqual([{ id: second.id, before: second.count, after: second.count + 1, delta: 1 }]);
    expect(now.diff.removed).toEqual([{ id: first.id, before: first.count, after: first.count - 1, delta: -1 }]);
    // A primeira versão: tudo entrou.
    expect(before.diff.added.length).toBe(new Set(v1.map((c) => c.id)).size);
    expect(before.diff.removed).toEqual([]);

    // Voltar à lista antiga leva a versão 1 para o fim da linha do tempo (é a atual de novo).
    await put(v1);
    const back = (await versions(app, id)).json();
    expect(back.versions.map((v: { hash: string; current: boolean }) => [v.hash, v.current])).toEqual([
      [deckHash(luffy), true],
      [deckHash({ leader: luffy.leader, cards: v2 }), false],
    ]);
  });

  it('as partidas e a taxa de vitória ficam na versão em que foram jogadas', async () => {
    const { app } = setup();
    const id = (await app.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Luffy', leader: luffy.leader, cards: luffy.cards } })).json()
      .id as string;
    let wins1 = 0;
    for (const s of [11, 12]) if (await play(app, id, s)) wins1++;

    // -1 ST01-002 (tinha 4), +1 ST01-009 (tinha 2): a lista continua legal para jogar.
    const v2 = luffy.cards.map((c, i) => (i === 0 ? { ...c, count: c.count - 1 } : i === 7 ? { ...c, count: c.count + 1 } : c));
    await app.inject({ method: 'PUT', url: `/api/decks/${id}`, headers: ALICE, payload: { name: 'Luffy', leader: luffy.leader, cards: v2 } });
    const won2 = await play(app, id, 13);

    const [now, before] = (await versions(app, id)).json().versions;
    expect(before).toMatchObject({ number: 1, games: 2, wins: wins1, winRate: wins1 / 2, firstPlayedAt: expect.any(String) });
    expect(before.wins + before.losses + before.draws).toBe(2);
    expect(now).toMatchObject({ number: 2, current: true, games: 1, wins: won2 ? 1 : 0, winRate: won2 ? 1 : 0 });
    // O lado do robô não conta para o deck pronto do oponente.
    expect((await versions(app, 'st02-kid')).json().versions[0]).toMatchObject({ games: 0, current: true });
  });

  it('deck inexistente: 404; o deck de outro jogador pode ser visto pelo site, como o próprio deck', async () => {
    const { app } = setup();
    expect((await versions(app, 'nao-existe')).statusCode).toBe(404);
    const id = (await app.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Luffy', leader: luffy.leader, cards: luffy.cards } })).json()
      .id as string;
    expect((await versions(app, id, BOB)).statusCode).toBe(200);
  });

  it('a migração cria a primeira versão dos decks que já existiam e junta as listas das partidas antigas', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gg-versions-')), 'db.sqlite');
    const first = openDb(file);
    first.prepare("INSERT INTO decks (id, name, leader, cards, kind, owner_hash) VALUES ('u-old', 'Antigo', 'ST01-001', '[{\"id\":\"ST01-002\",\"count\":4}]', 'user', 'x')").run();
    first.exec('DELETE FROM deck_versions');
    // Uma partida antiga com outra lista do mesmo deck (de antes das versões).
    const oldList = { leader: 'ST01-001', cards: [{ id: 'ST01-003', count: 4 }] };
    first.prepare('INSERT INTO deck_lists (hash, leader, cards) VALUES (?, ?, ?)').run(deckHash(oldList), oldList.leader, JSON.stringify(oldList.cards));
    const match = Number(first.prepare("INSERT INTO matches (seed, mode, deck0, deck1, winner, created_at) VALUES (1, 'bot', 'u-old', 'x', 0, '2020-01-01 00:00:00')").run().lastInsertRowid);
    first
      .prepare(
        `INSERT INTO match_seats (match_id, seat, controller, deck_id, deck_hash, leader, opp_leader, opp_controller, went_first, won, mulligan, format, queue, played_at)
         VALUES (?, 0, 'human', 'u-old', ?, 'ST01-001', 'ST02-001', 'bot', 1, 1, 0, 'egb', 'casual', '2020-01-01 00:00:00')`,
      )
      .run(match, deckHash(oldList));
    first.close();

    const db = openDb(file);
    const deck = getDeck(db, 'u-old')!;
    const v = deckVersions(db, deck);
    expect(v.total).toBe(2);
    expect(v.versions[0]).toMatchObject({ number: 2, current: true, games: 0, savedAt: expect.any(String) });
    expect(v.versions[1]).toMatchObject({ number: 1, current: false, games: 1, wins: 1, winRate: 1, savedAt: null });
    expect(v.versions[0].diff).toEqual({
      leader: null,
      added: [{ id: 'ST01-002', before: 0, after: 4, delta: 4 }],
      removed: [{ id: 'ST01-003', before: 4, after: 0, delta: -4 }],
    });
    db.close();
  });
});
