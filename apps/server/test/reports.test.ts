import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createSession, type Role, setUserRole, upsertGoogleUser } from '../src/auth/store';
import { type DB, openDb } from '../src/db';
import type { Lobby } from '../src/online/lobby';
import { seed } from '../src/seed';

function setup(now?: () => number) {
  const db = openDb(':memory:');
  seed(db);
  const app = buildApp(db, { server: { cardImages: true }, onlineRateLimit: 1e9, botDelayMs: 0, now });
  return { db, app, lobby: (app as unknown as { onlineLobby: Lobby }).onlineLobby };
}
type App = ReturnType<typeof buildApp>;

let n = 0;
function login(db: DB, role: Role = 'player') {
  const u = upsertGoogleUser(db, { sub: `rsub-${++n}`, email: `r${n}@example.com`, emailVerified: true, name: `R${n}`, picture: null });
  setUserRole(db, u.id, role);
  return { id: u.id, headers: { cookie: `gg_session=${createSession(db, u.id)}`, 'x-deck-owner': `rbrowser-${n}-0123456789abcdef` } };
}
type Who = ReturnType<typeof login>;

const req = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who?: { headers: Record<string, string> }, payload?: object) =>
  app.inject({ method, url, headers: who?.headers ?? {}, payload });

/** Um jogo de torneio decidido por desistência de `loser`; devolve a partida gravada. */
async function playTournamentGame(app: App, lobby: Lobby, tId: string, m: { id: number; p1: { userId: string }; p2: { userId: string } }, ps: Who[], loser: string) {
  const who = (userId: string) => ps.find((p) => p.id === userId)!;
  const a = (await req(app, 'POST', `/api/tournaments/${tId}/matches/${m.id}/play`, who(m.p1.userId))).json();
  const b = (await req(app, 'POST', `/api/tournaments/${tId}/matches/${m.id}/play`, who(m.p2.userId))).json();
  const room = lobby.get(a.roomId)!;
  const token = loser === m.p1.userId ? a.token : b.token;
  await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: token, seq: 0, action: { type: 'concede', player: room.seatOf(token)! } } });
  return room.info(0).result!.matchId!;
}

describe('auditoria: jogos gravados, replay e relatos', () => {
  it('torneio: todo jogo fica gravado com replay; o jogador relata e o organizador (ou admin) vê e resolve', async () => {
    const { db, app, lobby } = setup();
    const org = login(db, 'organizer');
    const otherOrg = login(db, 'organizer');
    const admin = login(db, 'admin');
    const ps = [login(db), login(db)];
    const outsider = login(db);
    const t = (await req(app, 'POST', '/api/tournaments', org, { name: 'Liga', format: 'egb', structure: 'swiss', rounds: 1 })).json();
    await req(app, 'POST', `/api/tournaments/${t.id}/register`, ps[0], { deckId: 'st01-luffy' });
    await req(app, 'POST', `/api/tournaments/${t.id}/register`, ps[1], { deckId: 'st02-kid' });
    let view = (await req(app, 'POST', `/api/tournaments/${t.id}/start`, org)).json();
    const m = view.rounds[0].matches[0];
    const statsId = await playTournamentGame(app, lobby, t.id, m, ps, m.p2.userId);

    // O jogo aparece na partida, com o replay para o organizador e para os dois jogadores (não para outros).
    view = (await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json();
    const games = view.rounds[0].matches[0].games;
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ game: 1, counted: true, statsMatchId: statsId, winner: { userId: m.p1.userId } });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, ps[1])).json().rounds[0].matches[0].games[0].statsMatchId).toBe(statsId);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, outsider)).json().rounds[0].matches[0].games[0].statsMatchId).toBeNull();
    expect(view.openReports).toBe(0);

    // Replay: quem jogou, o organizador e admins; nem anônimo, nem outro jogador ou outro organizador.
    expect((await req(app, 'GET', `/api/matches/${statsId}/replay`)).statusCode).toBe(401);
    expect((await req(app, 'GET', `/api/matches/${statsId}/replay`, outsider)).statusCode).toBe(403);
    expect((await req(app, 'GET', `/api/matches/${statsId}/replay`, otherOrg)).statusCode).toBe(403);
    const replay = (await req(app, 'GET', `/api/matches/${statsId}/replay`, ps[0])).json();
    expect(replay).toMatchObject({ format: 'gumgumfight-replay', seed: 0 });
    expect(typeof replay.version).toBe('number');
    expect(replay.names).toHaveLength(2);
    expect(replay.decks).toHaveLength(2);
    expect(Array.isArray(replay.actions)).toBe(true);
    expect((await req(app, 'GET', `/api/matches/${statsId}/replay`, org)).statusCode).toBe(200);
    expect((await req(app, 'GET', `/api/matches/${statsId}/replay`, admin)).statusCode).toBe(200);
    expect((await req(app, 'GET', `/api/matches/${statsId}`, org)).json()).toMatchObject({
      queue: 'tournament',
      tournament: { id: t.id, name: 'Liga', matchId: m.id, game: 1, round: 1, table: 1 },
    });

    // Relato: só quem jogou, com um texto.
    expect((await req(app, 'POST', `/api/matches/${statsId}/report`, outsider, { text: 'Vi de fora e achei estranho.' })).statusCode).toBe(403);
    expect((await req(app, 'POST', `/api/matches/${statsId}/report`, ps[1], { text: 'ruim' })).statusCode).toBe(400);
    const created = await req(app, 'POST', `/api/matches/${statsId}/report`, ps[1], { text: 'A carta do oponente não ativou o efeito.' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ matchId: statsId, tournamentId: t.id, reporterId: ps[1].id, resolvedAt: null, match: { queue: 'tournament' } });
    expect(created.json().reporterName).toMatch(/^Pirata /);

    // Quem vê: o organizador do torneio e admins (outro organizador não; o jogador não).
    expect((await req(app, 'GET', `/api/reports?tournament=${t.id}`, otherOrg)).statusCode).toBe(403);
    expect((await req(app, 'GET', `/api/reports?tournament=${t.id}`, ps[1])).statusCode).toBe(403);
    expect((await req(app, 'GET', `/api/reports?tournament=${t.id}`, org)).json().reports).toHaveLength(1);
    expect((await req(app, 'GET', '/api/reports', org)).json().reports).toHaveLength(1);
    expect((await req(app, 'GET', '/api/reports', otherOrg)).json().reports).toHaveLength(0);
    expect((await req(app, 'GET', '/api/reports', admin)).json().reports[0]).toMatchObject({ matchId: statsId, match: { tournament: { name: 'Liga' } } });
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().openReports).toBe(1);

    // Resolver com nota (organizador), listar resolvidos, reabrir (admin).
    const id = created.json().id;
    expect((await req(app, 'PUT', `/api/reports/${id}`, otherOrg, { resolved: true })).statusCode).toBe(403);
    const resolved = (await req(app, 'PUT', `/api/reports/${id}`, org, { resolved: true, note: 'Efeito confere com a regra.' })).json();
    expect(resolved).toMatchObject({ resolvedBy: org.id, note: 'Efeito confere com a regra.' });
    expect(resolved.resolvedAt).toBeTruthy();
    expect((await req(app, 'GET', `/api/reports?tournament=${t.id}`, org)).json().reports).toHaveLength(0);
    expect((await req(app, 'GET', `/api/reports?tournament=${t.id}&status=resolved`, org)).json().reports).toHaveLength(1);
    expect((await req(app, 'PUT', `/api/reports/${id}`, admin, { resolved: false })).json().resolvedAt).toBeNull();
    // Relatar de novo troca o texto (um relato por jogador e partida).
    await req(app, 'POST', `/api/matches/${statsId}/report`, ps[1], { text: 'Complemento: foi no turno 3.' });
    const all = (await req(app, 'GET', `/api/reports?tournament=${t.id}&status=all`, org)).json().reports;
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('Complemento: foi no turno 3.');
  });

  it('ranqueada: o jogador relata e só admins veem; casual não tem relato', async () => {
    const { db, app, lobby } = setup();
    const admin = login(db, 'admin');
    const org = login(db, 'organizer');
    const [a, b] = [login(db), login(db)];
    const play = async (queue: 'ranked' | 'casual') => {
      const qa = (await req(app, 'POST', '/api/online/queue', a, { deckId: 'st01-luffy', queue, format: 'egb' })).json();
      const qb = (await req(app, 'POST', '/api/online/queue', b, { deckId: 'st02-kid', queue, format: 'egb' })).json();
      const ma = (await app.inject(`/api/online/queue/${qa.ticket}`)).json();
      await app.inject(`/api/online/queue/${qb.ticket}`);
      expect(ma.status).toBe('matched');
      const room = lobby.get(ma.roomId)!;
      const seat = room.seatOf(ma.token)!;
      await app.inject({ method: 'POST', url: `/api/online/rooms/${room.id}/action`, payload: { t: ma.token, seq: 0, action: { type: 'concede', player: seat } } });
      return room.info(0).result!.matchId!;
    };
    const ranked = await play('ranked');
    const created = await req(app, 'POST', `/api/matches/${ranked}/report`, a, { text: 'Caiu a conexão no meio do meu turno.' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ tournamentId: null, match: { queue: 'ranked' } });
    expect((await req(app, 'GET', '/api/reports', admin)).json().reports).toHaveLength(1);
    // Organizador sem torneio não vê relatos de ranqueada; o jogador não lista relatos.
    expect((await req(app, 'GET', '/api/reports', org)).json().reports).toHaveLength(0);
    expect((await req(app, 'GET', '/api/reports', a)).statusCode).toBe(403);
    // O replay fica para quem jogou e para admins.
    expect((await req(app, 'GET', `/api/matches/${ranked}/replay`, b)).statusCode).toBe(200);
    expect((await req(app, 'GET', `/api/matches/${ranked}/replay`, org)).statusCode).toBe(403);

    const casual = await play('casual');
    const no = await req(app, 'POST', `/api/matches/${casual}/report`, a, { text: 'Só um teste de relato casual.' });
    expect(no.statusCode).toBe(400);
  });

  it('a tolerância do W.O. é escolhida pelo organizador', async () => {
    let now = Date.parse('2026-10-10T20:00:00Z');
    const { db, app } = setup(() => now);
    const org = login(db, 'organizer');
    const ps = [login(db), login(db)];
    const startsAt = '2026-10-10T20:00:00.000Z';
    const body = { name: 'Rápido', format: 'egb', structure: 'swiss', startsAt, checkIn: true };
    expect((await req(app, 'POST', '/api/tournaments', org, { ...body, toleranceMin: 0 })).statusCode).toBe(400);
    expect((await req(app, 'POST', '/api/tournaments', org, { ...body, toleranceMin: 90 })).statusCode).toBe(400);
    expect((await req(app, 'POST', '/api/tournaments', org, body)).json().toleranceMin).toBe(5);
    const t = (await req(app, 'POST', '/api/tournaments', org, { ...body, toleranceMin: 10 })).json();
    expect(t).toMatchObject({ toleranceMin: 10, toleranceMs: 600_000 });
    for (const [i, p] of ps.entries()) await req(app, 'POST', `/api/tournaments/${t.id}/register`, p, { deckId: ['st01-luffy', 'st02-kid'][i] });
    const tick = () => (app as unknown as { tournamentTick: () => { noShows: unknown[] } }).tournamentTick();
    tick();
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().deadline).toBe('2026-10-10T20:10:00.000Z');
    now += 5 * 60_000;
    expect(tick().noShows).toEqual([]);
    now += 5 * 60_000;
    expect(tick().noShows).toHaveLength(1);
    expect((await req(app, 'GET', `/api/tournaments/${t.id}`, org)).json().rounds[0].matches[0].result).toBe('none');
  });
});
