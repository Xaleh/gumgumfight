import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, setSupporter, upsertGoogleUser } from '../src/auth/store';
import { type DB, getCards, openDb } from '../src/db';
import { dataVersion } from '../src/cache';
import { seed } from '../src/seed';
import { bountyDelta, tierFor } from '../src/stats/catalog';
import { deckHash, deriveMatch } from '../src/stats/derive';
import { findPlayer, recordMatch } from '../src/stats/store';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const BOB = { 'x-deck-owner': 'bob-0123456789abcdef00' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  // Apoio configurado: as Estatísticas Pro (ranqueada, torneios, faixas) exigem o plano.
  return { db, app: buildApp(db, { server: { cardImages: true, support: { coffeeUrl: 'https://ko-fi.com/x' } } }) };
}

/** Sessão de um apoiador Tripulante (Estatísticas Pro: ranqueada, torneios e faixas). */
let supporters = 0;
function proViewer(db: DB) {
  const u = upsertGoogleUser(db, { sub: `pro-${++supporters}`, email: `pro${supporters}@example.com`, emailVerified: true, name: 'Pro', picture: null });
  setSupporter(db, u.id, 'tripulante', null);
  return { cookie: `gg_session=${createSession(db, u.id)}` };
}

async function decksAndCards(app: ReturnType<typeof buildApp>, ids: [string, string]) {
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

describe('recompensa e tiers', () => {
  it('faixas de recompensa', () => {
    expect(tierFor(0).id).toBe('east-blue');
    expect(tierFor(5_000).id).toBe('east-blue');
    expect(tierFor(5_001).id).toBe('paradise');
    expect(tierFor(20_000).id).toBe('paradise');
    expect(tierFor(10_000_000).id).toBe('emperor');
  });

  it('vencer quem vale mais rende mais; a recompensa nunca fica negativa', () => {
    expect(bountyDelta(10_000, 10_000, true)).toBe(1_000);
    expect(bountyDelta(10_000, 10_000, false)).toBe(-1_000);
    expect(bountyDelta(10_000, 30_000, true)).toBeGreaterThan(1_000);
    expect(bountyDelta(30_000, 10_000, true)).toBeLessThan(1_000);
    expect(bountyDelta(300, 0, false)).toBe(-300);
  });

  it('empate vale meio ponto: nada entre iguais, ganha quem vale menos', () => {
    expect(bountyDelta(10_000, 10_000, 'draw')).toBe(0);
    expect(bountyDelta(10_000, 30_000, 'draw')).toBeGreaterThan(0);
    expect(bountyDelta(30_000, 10_000, 'draw')).toBeLessThan(0);
  });
});

describe('fatos da partida', () => {
  it('a simulação do replay reproduz a partida e conta as cartas', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 7);
    const facts = deriveMatch(r, getCards(db, cards.map((c) => c.id)));
    expect(facts.winner).toBe(r.winner);
    expect(facts.turns).toBe(r.turns);
    for (const p of [0, 1] as const) {
      const seat = facts.seats[p];
      const rows = [...seat.cards.values()];
      expect(rows.reduce((s, c) => s + c.copies, 0)).toBe(50);
      expect(rows.reduce((s, c) => s + c.opening, 0)).toBe(5);
      for (const c of rows) {
        expect(c.drawn).toBeGreaterThanOrEqual(c.opening);
        expect(c.drawn).toBeLessThanOrEqual(c.copies);
      }
      expect(seat.deckHash).toBe(deckHash(decks[p]));
    }
  });

  it('o hash da lista ignora ordem e nome', () => {
    const a = { leader: 'L', cards: [{ id: 'X', count: 2 }, { id: 'Y', count: 4 }] };
    const b = { leader: 'L', cards: [{ id: 'Y', count: 4 }, { id: 'X', count: 1 }, { id: 'X', count: 1 }] };
    expect(deckHash(a)).toBe(deckHash(b));
    expect(deckHash(a)).not.toBe(deckHash({ ...a, leader: 'M' }));
  });
});

describe('API de estatísticas', () => {
  it('grava a partida verificada e responde aos filtros', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 11);
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches',
      headers: ALICE,
      payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: ['st01-luffy', 'st02-kid'], decks, actions: r.actions },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ winner: r.winner, turns: r.turns });

    const get = async (qs: string, headers = ALICE) => (await app.inject({ url: `/api/stats?${qs}`, headers })).json();
    const all = await get('');
    expect(all.summary).toMatchObject({ games: 1, wins: r.winner === 0 ? 1 : 0, players: 1 });
    expect(all.leaders).toEqual([expect.objectContaining({ leader: 'ST01-001', games: 1 })]);
    expect(all.matchups).toEqual([expect.objectContaining({ leader: 'ST01-001', oppLeader: 'ST02-001', games: 1 })]);
    expect(all.cards['ST01-001'].name).toBe('Monkey.D.Luffy');

    // O lado do bot só aparece pedindo "jogado por bots".
    expect((await get('by=bot')).leaders).toEqual([expect.objectContaining({ leader: 'ST02-001', games: 1 })]);
    expect((await get('format=standard')).summary.games).toBe(0);
    expect((await get('format=egb')).summary.games).toBe(1);
    expect((await get('queue=ranked')).summary.games).toBe(0);
    expect((await get('opponent=human')).summary.games).toBe(0);
    expect((await get('opponent=bot&tiers=east-blue,paradise')).summary.games).toBe(1);
    // O filtro por faixa é das Estatísticas Pro: sem o plano, é ignorado.
    expect((await get('tiers=paradise')).summary.games).toBe(1);
    expect((await get('tiers=paradise', { ...ALICE, ...proViewer(db) })).summary.games).toBe(0);
    expect((await get('mine=1')).summary.games).toBe(1);
    expect((await get('mine=1', BOB)).summary.games).toBe(0);
    expect((await get('days=7')).summary.games).toBe(1);

    const cardsRes = (await app.inject({ url: '/api/stats/cards?leader=ST01-001', headers: ALICE })).json();
    expect(cardsRes.rows.length).toBe(decks[0].cards.length);
    expect(cardsRes.rows.reduce((s: number, c: { openingGames: number }) => s + c.openingGames, 0)).toBeGreaterThan(0);
    expect((await app.inject('/api/stats/cards')).statusCode).toBe(400);

    // Decks do Líder: a lista jogada inteira vira as cartas no deck, o deck médio e o deck popular.
    const deckRes = (await app.inject({ url: '/api/stats/decks?leader=ST01-001', headers: ALICE })).json();
    const size = decks[0].cards.reduce((n, c) => n + c.count, 0);
    expect(deckRes).toMatchObject({ leader: 'ST01-001', games: 1, lists: 1 });
    expect(deckRes.cards).toHaveLength(new Set(decks[0].cards.map((c) => c.id)).size);
    expect(deckRes.cards.every((c: { share: number }) => c.share === 1)).toBe(true);
    expect(deckRes.average.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(Math.min(50, size));
    expect(deckRes.popular).toEqual([expect.objectContaining({ games: 1, players: 1, wins: r.winner === 0 ? 1 : 0 })]);
    expect(deckRes.cardInfo['ST01-001'].name).toBe('Monkey.D.Luffy');
    expect((await app.inject({ url: '/api/stats/decks?leader=ST02-001', headers: ALICE })).json()).toMatchObject({ games: 0, lists: 0, cards: [], popular: [] });
    expect((await app.inject('/api/stats/decks')).statusCode).toBe(400);

    const trend = (await app.inject('/api/stats/trend?weeks=4')).json();
    expect(trend.weeks).toHaveLength(4);
    expect(new Date(`${trend.weeks[3]}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(trend.rows).toEqual([expect.objectContaining({ week: trend.weeks[3], leader: 'ST01-001', games: 1 })]);
    expect(all.matchups[0]).toMatchObject({ firstGames: expect.any(Number), firstWins: expect.any(Number) });

    const meta = (await app.inject({ url: '/api/stats/meta', headers: ALICE })).json();
    expect(meta.tiers.length).toBeGreaterThan(2);
    expect(meta.me).toMatchObject({ bounty: 0, tier: 'east-blue' });
    expect(meta.myDecks).toEqual([expect.objectContaining({ leader: 'ST01-001', deckId: 'st01-luffy', games: 1 })]);
  });

  it('aceita a partida em que o vencedor do sorteio escolheu jogar segundo', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    // O vencedor escolhe jogar segundo; o resto é jogado pelo bot.
    let state = createGame({ seed: 5, chooseFirst: true, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
    const winner = state.rollWinner!;
    const actions: Action[] = [{ type: 'answer', player: winner, yes: false }];
    state = applyAction(state, actions[0]);
    while (state.phase !== 'gameover' && actions.length < 3000) {
      const a = chooseBotAction(state, actingPlayer(state)!);
      actions.push(a);
      state = applyAction(state, a);
    }
    expect(state.firstPlayer).toBe(1 - winner);
    const post = (extra: object) =>
      app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { mode: 'demo', format: 'egb', seed: 5, decks, actions, ...extra } });
    // Sem dizer que houve a escolha, o replay não confere.
    expect((await post({})).statusCode).toBe(422);
    const ok = await post({ chooseFirst: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ winner: state.winner, turns: state.turn });
  });

  it('partida empatada (sem vencedor) é gravada sem vitória para ninguém', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 9);
    const facts = { ...deriveMatch(r, cards), winner: null };
    for (const seat of facts.seats) seat.won = false;
    const hashes = ['hash-alice', 'hash-bob'];
    recordMatch(
      db,
      {
        mode: 'online',
        format: 'standard',
        queue: 'ranked',
        replay: r,
        seats: [
          { controller: 'human', ownerHash: hashes[0], deckId: null },
          { controller: 'human', ownerHash: hashes[1], deckId: null },
        ],
      },
      facts,
    );
    for (const h of hashes) expect(findPlayer(db, h)).toMatchObject({ bounty: 0, rankedGames: 1 });
    const url = '/api/stats?queue=ranked&opponent=human&tiers=east-blue';
    const stats = (await app.inject({ url, headers: proViewer(db) })).json();
    expect(stats.summary).toMatchObject({ games: 2, wins: 0 });
  });

  it('replay de partida online antiga (preparação antiga) confere com `legacySetup`', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    let state = createGame({ seed: 4, legacySetup: true, cards, players: [{ name: 'A', deck: decks[0] }, { name: 'B', deck: decks[1] }] });
    const actions: Action[] = [];
    while (state.phase !== 'gameover' && actions.length < 3000) {
      const a = chooseBotAction(state, actingPlayer(state)!);
      actions.push(a);
      state = applyAction(state, a);
    }
    const facts = deriveMatch({ seed: 4, legacySetup: true, decks, actions }, cards);
    expect(facts).toMatchObject({ winner: state.winner, turns: state.turn });
  });

  it('recusa replay adulterado ou deck inválido', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 3);
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { format: 'egb', ...payload } });
    const truncated = await post({ mode: 'bot', seed: r.seed, decks, actions: r.actions.slice(0, -1) });
    expect(truncated.statusCode).toBe(422);
    const otherSeed = await post({ mode: 'bot', seed: r.seed + 1, decks, actions: r.actions });
    expect(otherSeed.statusCode).toBe(422);
    const smallDeck = await post({ mode: 'bot', seed: r.seed, decks: [{ ...decks[0], cards: decks[0].cards.slice(1) }, decks[1]], actions: r.actions });
    expect(smallDeck.statusCode).toBe(400);
    // ST-01 e ST-02 têm o bloco ①: a partida não vale no Standard.
    const rotated = await post({ mode: 'bot', format: 'standard', seed: r.seed, decks, actions: r.actions });
    expect(rotated.statusCode).toBe(400);
    expect(rotated.json().error).toMatch(/Standard/);
    expect((await app.inject('/api/stats')).json().summary.games).toBe(0);
  });

  it('bot x bot fica fora das estatísticas de pessoas', async () => {
    const { app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 5);
    await app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { mode: 'demo', format: 'egb', seed: r.seed, decks, actions: r.actions } });
    expect((await app.inject('/api/stats')).json().summary.games).toBe(0);
    expect((await app.inject('/api/stats?by=bot')).json().summary.games).toBe(2);
  });

  it('só Standard e EGB puros entram: Livre, treino com spoilers e carta de spoiler ficam de fora', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const post = (seed: number, extra: object) => {
      const r = playOut(decks, cards, seed);
      return app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { mode: 'bot', seed, decks, actions: r.actions, ...extra } });
    };
    expect((await post(21, { format: 'free' })).statusCode).toBe(200);
    expect((await post(22, { format: 'egb', spoilers: true })).statusCode).toBe(200);
    const stats = async () => (await app.inject({ url: '/api/stats', headers: ALICE })).json();
    expect((await stats()).summary.games).toBe(0);
    expect((await app.inject({ url: '/api/stats/meta', headers: ALICE })).json().myDecks).toEqual([]);
    // Gravadas mesmo assim (replay e relatórios), só fora das estatísticas.
    expect(db.prepare('SELECT COUNT(*) AS n FROM match_seats WHERE listed = 0').get()).toEqual({ n: 4 });

    // Carta de spoiler no deck (mesmo num treino sem a opção) também fica de fora.
    db.prepare("UPDATE cards SET data = json_set(data, '$.spoiler', json('{\"source\":\"teste\"}')) WHERE id = ?").run(decks[0].cards[0].id);
    expect((await post(23, { format: 'egb' })).statusCode).toBe(200);
    expect((await stats()).summary.games).toBe(0);
    db.prepare("UPDATE cards SET data = json_remove(data, '$.spoiler') WHERE id = ?").run(decks[0].cards[0].id);
    expect((await post(24, { format: 'egb' })).statusCode).toBe(200);
    expect((await stats()).summary.games).toBe(1);
  });

  it('Estatísticas Pro: partida de torneio só entra no meta depois que o torneio termina', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 13);
    const matchId = recordMatch(
      db,
      {
        mode: 'online',
        format: 'egb',
        queue: 'tournament',
        replay: r,
        seats: [
          { controller: 'human', ownerHash: 'hash-t1', deckId: null },
          { controller: 'human', ownerHash: 'hash-t2', deckId: null },
        ],
      },
      deriveMatch(r, cards),
    );
    const org = upsertGoogleUser(db, { sub: 'org-t', email: 'org@example.com', emailVerified: true, name: 'Org', picture: null });
    db.prepare("INSERT INTO tournaments (id, name, format, structure, organizer_id, status) VALUES ('t-x', 'Copa', 'egb', 'swiss', ?, 'running')").run(org.id);
    db.prepare("INSERT INTO tournament_games (tournament_id, match_id, game, stats_match_id, played_at) VALUES ('t-x', 1, 1, ?, datetime('now'))").run(matchId);
    const pro = proViewer(db);
    const games = async (qs: string, headers: Record<string, string> = pro) =>
      (await app.inject({ url: `/api/stats?${qs}`, headers })).json().summary.games;
    expect(await games('queue=tournament')).toBe(0);
    expect(await games('')).toBe(0);
    db.prepare('UPDATE tournaments SET status = ? WHERE id = ?').run('finished', 't-x');
    // Encerrar o torneio pela rota já invalida o cache das respostas; aqui o UPDATE é direto.
    dataVersion.bump();
    expect(await games('queue=tournament')).toBe(2);
    // Sem o plano, torneio não entra nas estatísticas gerais.
    expect(await games('queue=tournament', {})).toBe(0);
  });

  it('ranqueada atualiza a recompensa e grava o tier de antes da partida', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 9);
    const facts = deriveMatch(r, cards);
    const hashes = ['hash-alice', 'hash-bob'];
    recordMatch(
      db,
      {
        mode: 'online',
        format: 'standard',
        queue: 'ranked',
        replay: r,
        seats: [
          { controller: 'human', ownerHash: hashes[0], deckId: null },
          { controller: 'human', ownerHash: hashes[1], deckId: null },
        ],
      },
      facts,
    );
    const w = facts.winner!;
    const winner = findPlayer(db, hashes[w])!;
    const loser = findPlayer(db, hashes[1 - w])!;
    expect(winner).toMatchObject({ bounty: 1_000, rankedGames: 1 });
    expect(loser).toMatchObject({ bounty: 0, rankedGames: 1 });
    const url = '/api/stats?queue=ranked&opponent=human&tiers=east-blue';
    const stats = (await app.inject({ url, headers: proViewer(db) })).json();
    expect(stats.summary).toMatchObject({ games: 2, wins: 1, matches: 1, players: 2 });
    // Sem o plano: as estatísticas gerais não mostram a ranqueada (nem com o filtro de faixa).
    expect((await app.inject(url)).json().summary.games).toBe(0);
    expect((await app.inject('/api/stats?opponent=human')).json().summary.games).toBe(0);
    // Amostra para quem não tem o plano: os Líderes mais jogados na ranqueada.
    const teaser = (await app.inject('/api/stats/teaser')).json();
    expect(teaser.total).toBe(2);
    expect(teaser.top.length).toBeGreaterThan(0);
    expect((await app.inject('/api/stats/meta')).json().pro).toBe(false);
    expect((await app.inject({ url: '/api/stats/meta', headers: proViewer(db) })).json().pro).toBe(true);
    // Servidor sem apoio configurado: tudo aberto, como antes.
    const open = buildApp(db, { server: { cardImages: true } });
    expect((await open.inject(url)).json().summary.games).toBe(2);
    expect((await open.inject('/api/stats/meta')).json()).toMatchObject({ pro: true, proGate: false });
  });
});
