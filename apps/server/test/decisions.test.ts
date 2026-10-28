// Extrator de decisões dos replays (docs/bot-tempo.md, seção 11): refaz a partida gravada e emite as decisões
// do lado humano, com a escolha do bot na mesma visão.

import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction as chooseBotAction, createGame, type DeckList } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { createSession, upsertGoogleUser } from '../src/auth/store';
import { finishTournament, listMatches, registerPlayer, setMatchScore, startTournament } from '../src/tournaments/store';
import { extractMatch, formatSummary, selectMatches, summarize, topRankedPlayers, tournamentInfo } from '../src/decisions/extract';
import { agreement, collectSamples, defenseByLife, initialTheta, spsa, weightsOf } from '../src/decisions/tune';
import { BOT_WEIGHTS } from '@gumgum/engine';
import { seed } from '../src/seed';

const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return { db, app: buildApp(db, { server: { cardImages: true } }) };
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

describe('extrator de decisões', () => {
  it('refaz a partida gravada e emite as decisões do lado humano, com a escolha do bot', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 11);
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches',
      headers: ALICE,
      payload: { mode: 'bot', format: 'egb', seed: r.seed, deckIds: ['st01-luffy', 'st02-kid'], decks, actions: r.actions },
    });
    expect(res.json()).toMatchObject({ winner: r.winner });
    const matchId = res.json().id as number;

    expect(selectMatches(db)).toEqual([matchId]);
    expect(selectMatches(db, { queue: 'ranked' })).toEqual([]);
    expect(topRankedPlayers(db, 5)).toEqual([]); // ninguém jogou ranqueada

    const { records, turns, error } = extractMatch(db, matchId, { bot: 'normal', budgetMs: 30 });
    expect(error).toBeUndefined();
    // Um turno inteiro por turno do lado humano (a partir do 3º), com o que ele fez e o que o bot faria.
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((t) => t.seat === 0 && t.turn > 2 && t.bot && t.human.donLeft >= 0)).toBe(true);
    expect(turns.map((t) => t.turn)).toEqual([...new Set(turns.map((t) => t.turn))]);
    const played = turns.flatMap((t) => t.human.played);
    expect(played.length).toBe(records.filter((d) => d.kind === 'main' && d.chosen.type === 'playCard' && d.turn > 2).length);
    // Só o lado humano (assento 0): cada ação dele no replay vira um registro.
    const humanActions = r.actions.filter((a) => a.player === 0);
    expect(records.length).toBe(humanActions.length);
    expect(records.every((d) => d.seat === 0 && d.player && d.won === (r.winner === 0))).toBe(true);
    expect(records.map((d) => d.index)).toEqual(r.actions.map((a, i) => (a.player === 0 ? i : -1)).filter((i) => i >= 0));
    const kinds = new Set(records.map((d) => d.kind));
    expect(kinds.has('main')).toBe(true);
    expect(kinds.has('mulligan')).toBe(true);
    // O bot decidiu em todas (e a descrição é por número de carta).
    expect(records.every((d) => d.bot && typeof d.agree === 'boolean')).toBe(true);
    const play = records.find((d) => d.chosen.type === 'playCard');
    expect(play?.chosen.card).toMatch(/^ST01-/);
    const counter = records.find((d) => d.kind === 'counter');
    if (counter) {
      expect(counter.battle).toMatchObject({ targetIsLeader: expect.any(Boolean), need: expect.any(Number) });
      expect(counter.counters).toBeGreaterThanOrEqual(0);
      if (counter.chosen.type === 'counter') expect(counter.chosenValue).toBeGreaterThan(0);
    }

    const s = summarize(records, 1, 0, turns);
    expect(s.decisions).toBe(records.length);
    expect(s.kinds.main.n).toBeGreaterThan(0);
    expect(s.turns?.n).toBe(turns.length);
    const text = formatSummary(s);
    expect(text).toContain('Partidas: 1 (0 não refizeram)');
    expect(text).toContain('Turnos inteiros');
  });

  it('mão inicial no mulligan, colocação no torneio, Counter com o custo da carta e o filtro de torneio', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const r = playOut(decks, cards, 12);
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches',
      headers: ALICE,
      payload: { mode: 'bot', format: 'egb', seed: r.seed, decks, actions: r.actions },
    });
    const matchId = res.json().id as number;
    const { records } = extractMatch(db, matchId, { placements: new Map([['ninguem', 1]]) });
    const mull = records.find((d) => d.kind === 'mulligan')!;
    const o = mull.opening!;
    expect(o.le2 + o.c3 + o.c4 + o.ge5 + o.events).toBeLessThanOrEqual(5);
    expect(o.counter).toBeGreaterThanOrEqual(0);
    // Sem login o registro não tem conta, e a colocação fica de fora.
    expect(records.every((d) => d.placement === undefined)).toBe(true);
    const used = records.filter((d) => d.kind === 'counter' && d.chosen.type === 'counter');
    for (const d of used) expect(d).toMatchObject({ chosenCost: expect.any(Number), chosenCategory: expect.any(String), donNext: expect.any(Number) });
    const s = summarize(records, 1, 0);
    expect(Object.values(s.mulligan).reduce((n, row) => n + row.n, 0)).toBe(1);
    expect(formatSummary(s)).toContain('Mulligan por Personagens de custo');

    expect(tournamentInfo(db, 'latest')).toBeNull();
    expect(tournamentInfo(db, 'nao-existe')).toBeNull();
    expect(selectMatches(db, { tournament: 'nao-existe' })).toEqual([]);
  });

  it('torneio: só os jogos dele, com a colocação final de cada conta', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    const [ana, bia] = ['ana', 'bia'].map((n) => upsertGoogleUser(db, { sub: n, email: `${n}@example.com`, emailVerified: true, name: n, picture: null }));
    db.prepare("INSERT INTO tournaments (id, name, format, structure, organizer_id) VALUES ('t-1', 'Domingo', 'egb', 'single', ?)").run(ana.id);
    registerPlayer(db, 't-1', ana.id, 'Ana', null, decks[0]);
    registerPlayer(db, 't-1', bia.id, 'Bia', null, decks[1]);
    startTournament(db, 't-1', [ana.id, bia.id], 1, { round: 1, stage: 'elim', bestOf: 1, pairings: [{ p1: ana.id, p2: bia.id }] }, '2026-10-25T15:00:00Z');
    const series = listMatches(db, 't-1')[0];
    setMatchScore(db, 't-1', series.id, 1, [0, 1], bia.id); // Bia vence a final
    finishTournament(db, 't-1');

    // A partida da Ana (gravada com a conta dela) entra no torneio; outra partida dela, não.
    const r = playOut(decks, cards, 11);
    const cookie = { cookie: `gg_session=${createSession(db, ana.id)}` };
    const post = async () =>
      (await app.inject({ method: 'POST', url: '/api/matches', headers: cookie, payload: { mode: 'bot', format: 'egb', seed: r.seed, decks, actions: r.actions } })).json().id as number;
    const inside = await post();
    const outside = await post();
    db.prepare("INSERT INTO tournament_games (tournament_id, match_id, game, stats_match_id, played_at) VALUES ('t-1', ?, 1, ?, '2026-10-25T15:10:00Z')").run(series.id, inside);

    const t = tournamentInfo(db, 'latest')!;
    expect(t).toMatchObject({ id: 't-1', name: 'Domingo', players: 2 });
    expect(t.placements.get(bia.id)).toBe(1);
    expect(t.placements.get(ana.id)).toBe(2);
    expect(selectMatches(db, { tournament: 't-1' })).toEqual([inside]);
    expect(selectMatches(db).sort()).toEqual([inside, outside].sort());
    const { records } = extractMatch(db, inside, { placements: t.placements });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((d) => d.user === ana.id && d.placement === 2)).toBe(true);
    // O ajuste por imitação filtra pela colocação: só a campeã, que não tem partida gravada aqui.
    expect(collectSamples(db, [inside], { kinds: ['counter', 'block'], max: 50, placements: t.placements, maxPlacement: 1 }).samples).toEqual([]);
  });

  it('ajuste por imitação: guarda as posições de defesa e mede a concordância com o humano', async () => {
    const { db, app } = setup();
    const { decks, cards } = await decksAndCards(app, ['st01-luffy', 'st02-kid']);
    for (const seed of [11, 12, 13]) {
      const r = playOut(decks, cards, seed);
      await app.inject({ method: 'POST', url: '/api/matches', headers: ALICE, payload: { mode: 'bot', format: 'egb', seed: r.seed, decks, actions: r.actions } });
    }
    const { samples, failed } = collectSamples(db, selectMatches(db), { kinds: ['counter', 'block'], max: 40 });
    expect(failed).toBe(0);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((x) => (x.kind === 'counter' || x.kind === 'block') && x.view.log.length === 0)).toBe(true);
    // O lado "humano" destas partidas é o bot fácil: o bot normal concorda com ele numa parte das posições.
    const a = agreement(samples, BOT_WEIGHTS, 'normal');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
    const byLife = defenseByLife(samples, BOT_WEIGHTS, 'normal');
    expect(Object.values(byLife).every((row) => row.human <= row.n && row.bot <= row.n)).toBe(true);
    // Uma rodada de SPSA anda o θ e devolve pesos válidos (Vida crescente).
    let rng = 7;
    const theta = spsa(samples, initialTheta(), { rounds: 1, batch: 10, level: 'normal', random: () => ((rng = (rng * 16807) % 2147483647) / 2147483647) });
    const w = weightsOf(theta);
    expect(w.life).toHaveLength(6);
    expect(w.life.every((v, i) => i === 0 || v > w.life[i - 1])).toBe(true);
  });

  it('o lado do bot não gera decisões, e uma partida sem replay é pulada', () => {
    const { db } = setup();
    expect(extractMatch(db, 999)).toMatchObject({ records: [], error: 'sem replay' });
  });
});
