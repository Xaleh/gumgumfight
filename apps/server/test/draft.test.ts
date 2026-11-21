// Draft no servidor: o pod de 8 (com bots nos lugares vazios), escolher e passar, o tempo de cada
// escolha, o que cada jogador vê, a retomada depois de reiniciar e o deck que sai no fim.

import { autoBuildLimited, type CardData, poolCounts, SEALED_LEADER_ID } from '@gumgum/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { type DB, getCards, openDb } from '../src/db';
import { DraftPods, type PodView } from '../src/draft/pods';
import type { Lobby } from '../src/online/lobby';
import { forgetSealedSets } from '../src/sealed/store';
import { seed } from '../src/seed';

const owner = (n: number) => ({ 'x-deck-owner': `drafter-${n}-0123456789abcdef` });
const ALICE = owner(1);
const BOB = owner(2);

function setup() {
  const db = openDb(':memory:');
  seed(db);
  let clock = Date.UTC(2026, 10, 21, 12);
  const app = buildApp(db, { server: { cardImages: true, onlineBotRooms: true }, onlineRateLimit: 1e9, botDelayMs: 0, now: () => clock });
  const pods = (app as unknown as { draftPods: DraftPods }).draftPods;
  return { db, app, pods, wait: (ms: number) => ((clock += ms), pods.tick()) };
}
type App = ReturnType<typeof buildApp>;
type Headers = Record<string, string>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, headers: Headers, payload?: unknown) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
const view = async (app: App, id: string, headers: Headers) => (await call(app, 'GET', `/api/draft/pods/${id}`, headers)).json() as PodView;
const pick = (app: App, id: string, headers: Headers, card: string) => call(app, 'POST', `/api/draft/pods/${id}/pick`, headers, { card });
/** Escolhe a primeira carta de cada booster até o draft do jogador acabar. */
async function draftAll(app: App, id: string, headers: Headers): Promise<PodView> {
  let v = await view(app, id, headers);
  for (let guard = 0; guard < 60 && v.status === 'drafting'; guard++) {
    expect(v.pack, 'com bots, o próximo booster chega na hora').not.toBeNull();
    v = (await pick(app, id, headers, v.pack![0])).json() as PodView;
  }
  return v;
}

beforeEach(() => forgetSealedSets());

describe('Draft: o pod', () => {
  it('quem cria ocupa o primeiro lugar; outros entram pelo código; quem criou começa e os bots completam os 8', async () => {
    const { app } = setup();
    const created = await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['op01'] });
    expect(created.statusCode).toBe(201);
    const pod = created.json() as PodView;
    expect(pod).toMatchObject({ sets: 'OP01', status: 'waiting', host: true, you: 0, capacity: 8, rounds: 4, pack: null, poolId: null });
    expect(pod.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(pod.seats).toHaveLength(1);

    const joined = (await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code.toLowerCase() })).json() as PodView;
    expect(joined).toMatchObject({ id: pod.id, host: false, you: 1 });
    expect(joined.seats.map((s) => s.you)).toEqual([false, true]);
    // Só quem criou começa.
    expect((await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, BOB)).json().errorCode).toBe('draftHostOnly');
    const started = (await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE)).json() as PodView;
    expect(started.status).toBe('drafting');
    expect(started.seats).toHaveLength(8);
    expect(started.seats.map((s) => s.bot)).toEqual([false, false, true, true, true, true, true, true]);
    expect(started.pack).toHaveLength(12);
    expect(started).toMatchObject({ round: 1, packSet: 'OP01', passTo: joined.seats[1].name });
    expect(started.timeLeft).toBe(46_000);
    // Depois de começar, ninguém mais entra; quem já está, volta.
    expect((await call(app, 'POST', '/api/draft/pods/join', owner(3), { code: pod.code })).json().errorCode).toBe('draftPodStarted');
    expect((await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code })).json()).toMatchObject({ id: pod.id, you: 1, status: 'drafting' });
    expect((await call(app, 'GET', '/api/draft/active', BOB)).json().pod).toMatchObject({ id: pod.id, status: 'drafting' });
  });

  it('com os 8 lugares ocupados por pessoas, o draft começa sozinho', async () => {
    const { app } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', owner(1), { sets: ['OP01'] })).json() as PodView;
    for (let n = 2; n <= 7; n++) expect(((await call(app, 'POST', '/api/draft/pods/join', owner(n), { code: pod.code })).json() as PodView).status).toBe('waiting');
    const last = (await call(app, 'POST', '/api/draft/pods/join', owner(8), { code: pod.code })).json() as PodView;
    expect(last.status).toBe('drafting');
    expect(last.seats.every((s) => !s.bot)).toBe(true);
    expect((await call(app, 'POST', '/api/draft/pods/join', owner(9), { code: pod.code })).json().errorCode).toBe('draftPodStarted');
  });

  it('um jogador por pod; sair da espera libera o lugar e passa o pod adiante', async () => {
    const { app } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    expect((await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP02'] })).json()).toMatchObject({ errorCode: 'draftAlreadyInPod', errorParams: { code: pod.code } });
    await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code });
    expect((await call(app, 'POST', `/api/draft/pods/${pod.id}/leave`, ALICE)).statusCode).toBe(204);
    // Bob vira quem criou; Alice não vê mais o pod.
    expect(await view(app, pod.id, BOB)).toMatchObject({ host: true, you: 0 });
    expect((await call(app, 'GET', `/api/draft/pods/${pod.id}`, ALICE)).statusCode).toBe(404);
    await call(app, 'POST', `/api/draft/pods/${pod.id}/leave`, BOB);
    expect((await call(app, 'POST', '/api/draft/pods/join', ALICE, { code: pod.code })).json().errorCode).toBe('draftPodNotFound');
  });

  it('recusa coleção fora do Selado, código inválido e pedido sem dono', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['ST01'] })).json().errorCode).toBe('sealedSetUnavailable');
    expect((await call(app, 'POST', '/api/draft/pods', ALICE, {})).json().errorCode).toBe('sealedSetUnavailable');
    expect((await call(app, 'POST', '/api/draft/pods/join', ALICE, { code: 'x' })).json().errorCode).toBe('draftBadCode');
    expect((await call(app, 'POST', '/api/draft/pods/join', ALICE, { code: 'ZZZZZZ' })).json().errorCode).toBe('draftPodNotFound');
    expect((await call(app, 'POST', '/api/draft/pods', {}, { sets: ['OP01'] })).json().errorCode).toBe('noOwner');
  });
});

describe('Draft: escolher e passar', () => {
  it('cada um só vê o próprio booster e as próprias escolhas; dos outros, quem já escolheu', async () => {
    const { app } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code });
    const a0 = (await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE)).json() as PodView;
    const b0 = await view(app, pod.id, BOB);
    expect(a0.pack).not.toEqual(b0.pack);
    // Do pod, Bob recebe só o booster dele: nenhum outro booster nem as escolhas dos outros vão junto.
    expect(Object.keys(b0).sort()).toEqual(Object.keys(a0).sort());
    expect(b0.picks.flat()).toEqual([]);
    expect(b0.seats.every((seat) => Object.keys(seat).sort().join() === 'away,bot,choosing,name,picked,you')).toBe(true);
    // Quem não está no pod não vê nada.
    expect((await call(app, 'GET', `/api/draft/pods/${pod.id}`, owner(3))).statusCode).toBe(404);
    expect((await pick(app, pod.id, owner(3), a0.pack![0])).statusCode).toBe(404);

    // Alice escolhe: as outras 11 vão para Bob (à esquerda dela), atrás do booster que ele ainda tem.
    const a1 = (await pick(app, pod.id, ALICE, a0.pack![2])).json() as PodView;
    expect(a1.picks[0]).toEqual([a0.pack![2]]);
    expect(a1.seats[0]).toMatchObject({ picked: 1 });
    // Os bots já escolheram e passaram: o booster que chegou a Alice veio do Bot à direita dela.
    expect(a1.pack).toHaveLength(11);
    const b1 = await view(app, pod.id, BOB);
    expect(b1.pack).toEqual(b0.pack);
    expect(b1.seats[0].picked).toBe(1);
    expect(b1.seats.slice(2).every((s) => s.bot && s.picked >= 1)).toBe(true);
    // Bob escolhe do dele e recebe o que Alice passou.
    const b2 = (await pick(app, pod.id, BOB, b0.pack![0])).json() as PodView;
    expect(b2.pack).toEqual(a0.pack!.filter((id) => id !== a0.pack![2]));
    // Carta que não está no booster da mão é recusada.
    expect((await pick(app, pod.id, BOB, b0.pack![0])).json().errorCode).toBe('draftCardNotInPack');
    expect((await pick(app, pod.id, BOB, 'OP02-001')).json().errorCode).toBe('draftCardNotInPack');
  });

  it('sozinho com 7 bots: 48 escolhas em 4 rodadas, e o deck sai como um deck selado', async () => {
    const { app, db } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    const mid = await view(app, pod.id, ALICE);
    expect(mid.round).toBe(1);
    const done = await draftAll(app, pod.id, ALICE);
    expect(done).toMatchObject({ status: 'done', pack: null, timeLeft: null });
    expect(done.picks.map((r) => r.length)).toEqual([12, 12, 12, 12]);
    expect(done.poolId).toBeTruthy();
    expect((await call(app, 'GET', '/api/draft/active', ALICE)).json().pod).toBeNull();

    const pool = (await call(app, 'GET', `/api/sealed/pools/${done.poolId}`, ALICE)).json();
    expect(pool).toMatchObject({ set: 'OP01', draft: true, ready: false, size: 0 });
    expect(pool.packs).toEqual(done.picks);
    // Monta com o "Montar sozinho" e salva: mesmas regras do Selado.
    const counts = poolCounts(pool.packs);
    const catalog = new Map((getCards(db, [...counts.keys(), SEALED_LEADER_ID]) as CardData[]).map((c) => [c.id, c]));
    const saved = await call(app, 'PUT', `/api/sealed/pools/${done.poolId}/deck`, ALICE, autoBuildLimited(counts, catalog));
    expect(saved.json()).toMatchObject({ ready: true, size: 40 });
    // Líder de fora não vale no Draft de uma coleção.
    const refused = await call(app, 'PUT', `/api/sealed/pools/${done.poolId}/deck`, ALICE, { ...autoBuildLimited(counts, catalog), leader: 'ST10-001' });
    expect(refused.json().errorParams.issueCode).toBe('rules.leaderNotInPool');

    // O oponente do treino é um dos bots que draftaram na mesma mesa.
    const bot = (await call(app, 'POST', `/api/sealed/pools/${done.poolId}/bot`, ALICE)).json();
    expect(bot.name).toBe('Draft OP01');
    expect(bot.cards.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(40);
    const mine = new Set(done.picks.flat());
    // As cartas do bot não são as que Alice pegou: cada carta do pod foi para um lugar só.
    const opened = (await call(app, 'GET', `/api/sealed/pools/${done.poolId}`, ALICE)).json().packs.flat() as string[];
    expect(opened.every((id) => mine.has(id))).toBe(true);
  });

  it('Pack Rush draft: boosters de várias coleções e qualquer Líder do jogo', async () => {
    const { app, db } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP02', 'OP01'] })).json() as PodView;
    expect(pod.sets).toBe('OP01+OP02');
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    const first = await view(app, pod.id, ALICE);
    expect(['OP01', 'OP02']).toContain(first.packSet);
    expect(first.pack!.every((id) => id.startsWith(`${first.packSet}-`))).toBe(true);
    const done = await draftAll(app, pod.id, ALICE);
    expect(new Set(done.picks.flat().map((id) => id.split('-')[0]))).toEqual(new Set(['OP01', 'OP02']));
    const pool = (await call(app, 'GET', `/api/sealed/pools/${done.poolId}`, ALICE)).json();
    expect(pool).toMatchObject({ set: 'OP01+OP02', draft: true });
    const counts = poolCounts(pool.packs);
    const catalog = new Map((getCards(db, [...counts.keys(), SEALED_LEADER_ID, 'ST10-001']) as CardData[]).map((c) => [c.id, c]));
    const saved = await call(app, 'PUT', `/api/sealed/pools/${done.poolId}/deck`, ALICE, autoBuildLimited(counts, catalog, 'ST10-001'));
    expect(saved.json()).toMatchObject({ ready: true, leader: 'ST10-001' });
  });
});

describe('Draft: tempo de escolha', () => {
  it('quem deixa o tempo acabar tem a carta escolhida pelo servidor; depois de duas vezes, sem a tela aberta, o lugar escolhe sozinho', async () => {
    const { app, wait } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code });
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    // Bob escolhe na hora; Alice some. Antes do prazo dela nada acontece.
    const b0 = await view(app, pod.id, BOB);
    await pick(app, pod.id, BOB, b0.pack![0]);
    wait(45_000);
    expect((await view(app, pod.id, BOB)).seats[0]).toMatchObject({ picked: 0, choosing: true });
    // 46 s com 12 cartas: a escolha de Alice sai sozinha e o booster dela chega a Bob.
    wait(1_500);
    const b1 = await view(app, pod.id, BOB);
    expect(b1.seats[0]).toMatchObject({ picked: 1, away: false });
    expect(b1.pack).toHaveLength(11);
    await pick(app, pod.id, BOB, b1.pack![0]);
    // Segunda vez seguida (43 s com 11 cartas) e sem consultar o pod: Alice passa a escolher sozinha.
    wait(44_000);
    const b2 = await view(app, pod.id, BOB);
    expect(b2.seats[0]).toMatchObject({ away: true });
    expect(b2.seats[0].picked).toBeGreaterThanOrEqual(2);
    // Daí em diante ela não segura mais a mesa: Bob escolhe e o próximo booster dela já chega.
    const v = (await pick(app, pod.id, BOB, b2.pack![0])).json() as PodView;
    expect(v.pack).not.toBeNull();
    // Alice volta: deixa de escolher sozinha.
    const a = await view(app, pod.id, ALICE);
    expect(a.seats[0].away).toBe(false);
  });

  it('quem está com a tela aberta, só devagar, continua escolhendo (nunca vira ausente)', async () => {
    const { app, wait } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    // A tela consulta o pod o tempo todo, mas a pessoa não escolhe: três prazos seguidos.
    for (let i = 0; i < 3; i++) {
      for (let t = 0; t < 47; t += 5) {
        wait(5_000);
        await view(app, pod.id, ALICE);
      }
    }
    const v = await view(app, pod.id, ALICE);
    expect(v.seats[0].away).toBe(false);
    expect(v.seats[0].picked).toBeGreaterThanOrEqual(3);
    expect(v.pack).not.toBeNull();
  });

  it('escolher a tempo zera a contagem de ausências', async () => {
    const { app, wait } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    const v0 = (await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE)).json() as PodView;
    wait(47_000); // 1ª ausência
    let v = await view(app, pod.id, ALICE);
    expect(v.seats[0].picked).toBe(1);
    expect(v0.pack).toContain(v.picks[0][0]);
    v = (await pick(app, pod.id, ALICE, v.pack![0])).json() as PodView; // escolheu: zera
    wait(41_000); // nova ausência, mas é a 1ª de novo
    expect((await view(app, pod.id, ALICE)).seats[0]).toMatchObject({ picked: 3, away: false });
  });

  it('sair no meio do draft: o lugar escolhe sozinho até o fim e o deck fica guardado', async () => {
    const { app } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code });
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    await call(app, 'POST', `/api/draft/pods/${pod.id}/leave`, BOB);
    const done = await draftAll(app, pod.id, ALICE);
    expect(done.status).toBe('done');
    const pools = (await call(app, 'GET', '/api/sealed/pools', BOB)).json();
    expect(pools).toMatchObject([{ set: 'OP01', draft: true }]);
  });
});

describe('Draft: retomada e partidas', () => {
  it('o draft em andamento continua depois de o servidor reiniciar', async () => {
    const { app, db } = setup();
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    const v0 = (await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE)).json() as PodView;
    const v1 = (await pick(app, pod.id, ALICE, v0.pack![0])).json() as PodView;
    // Outro processo, o mesmo banco.
    const again = new DraftPods({ db, now: () => Date.UTC(2026, 10, 21, 13) });
    // O dono gravado no pod (o servidor não guarda o código do navegador como veio).
    const alice = again.get(pod.id)!.seats[0].ownerHash!;
    const resumed = again.view(again.get(pod.id)!, alice)!;
    expect(resumed).toMatchObject({ status: 'drafting', round: 1, picks: v1.picks, pack: v1.pack });
    // O tempo fora do ar não conta: o prazo recomeça.
    expect(resumed.timeLeft).toBe(43_000);
    expect(again.pick(again.get(pod.id)!, alice, resumed.pack![0])).toBeNull();
  });

  it('sala privada: só se enfrentam decks do mesmo pod', async () => {
    const { app, db } = setup();
    const lobby = (app as unknown as { onlineLobby: Lobby }).onlineLobby;
    const build = async (headers: Headers, poolId: string) => {
      const pool = (await call(app, 'GET', `/api/sealed/pools/${poolId}`, headers)).json();
      const counts = poolCounts(pool.packs);
      const catalog = new Map((getCards(db, [...counts.keys(), SEALED_LEADER_ID]) as CardData[]).map((c) => [c.id, c]));
      expect((await call(app, 'PUT', `/api/sealed/pools/${poolId}/deck`, headers, autoBuildLimited(counts, catalog))).json().ready).toBe(true);
    };
    // Alice e Bob draftam juntos (6 bots); cada um escolhe na sua vez até o fim.
    const pod = (await call(app, 'POST', '/api/draft/pods', ALICE, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', '/api/draft/pods/join', BOB, { code: pod.code });
    await call(app, 'POST', `/api/draft/pods/${pod.id}/start`, ALICE);
    let a = await view(app, pod.id, ALICE);
    for (let guard = 0; guard < 200 && a.status === 'drafting'; guard++) {
      for (const who of [ALICE, BOB]) {
        const v = await view(app, pod.id, who);
        if (v.pack) await pick(app, pod.id, who, v.pack[0]);
      }
      a = await view(app, pod.id, ALICE);
    }
    const b = await view(app, pod.id, BOB);
    expect([a.status, b.status]).toEqual(['done', 'done']);
    await build(ALICE, a.poolId!);
    await build(BOB, b.poolId!);

    const room = await call(app, 'POST', '/api/online/rooms', ALICE, { deckId: a.poolId, format: 'sealed' });
    expect(room.statusCode).toBe(201);
    const { code, roomId } = room.json();
    expect(lobby.get(roomId)!.data).toMatchObject({ format: 'sealed', sealedSet: 'OP01', sealedPod: pod.id });
    // Deck de Selado da mesma coleção não entra numa sala de Draft.
    const carol = owner(3);
    const sealed = (await call(app, 'POST', '/api/sealed/pools', carol, { set: 'OP01' })).json();
    await build(carol, sealed.id);
    expect((await call(app, 'POST', '/api/online/rooms/join', carol, { code, deckId: sealed.id })).json().errorCode).toBe('sealedRoomIsDraft');
    // Quem draftou junto entra.
    expect((await call(app, 'POST', '/api/online/rooms/join', BOB, { code, deckId: b.poolId })).statusCode).toBe(200);
    expect(lobby.get(roomId)!.data.seats.map((s) => s.deck.name)).toEqual(['Draft OP01', 'Draft OP01']);
    expect(lobby.summary(lobby.get(roomId)!)).toMatchObject({ format: 'sealed', sealedPod: pod.id });

    // E o contrário: deck de Draft não entra numa sala de Selado comum.
    const dave = owner(4);
    const other = (await call(app, 'POST', '/api/draft/pods', dave, { sets: ['OP01'] })).json() as PodView;
    await call(app, 'POST', `/api/draft/pods/${other.id}/start`, dave);
    const d = await draftAll(app, other.id, dave);
    await build(dave, d.poolId!);
    const plain = (await call(app, 'POST', '/api/online/rooms', carol, { deckId: sealed.id, format: 'sealed' })).json();
    expect((await call(app, 'POST', '/api/online/rooms/join', dave, { code: plain.code, deckId: d.poolId })).json().errorCode).toBe('sealedRoomNotDraft');
  });
});
