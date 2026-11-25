// O deck provável de um Líder para o bot deduzir a mão do oponente (D2, `stats/handguess.ts`).

import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { type DB, openDb } from '../src/db';
import { seed } from '../src/seed';
import { HAND_GUESS_MIN_GAMES, HandGuesses } from '../src/stats/handguess';
import { ensurePlayer } from '../src/stats/store';

const KID = 'ST02-001';
const OWNERS = ['alice-0123456789abcdef', 'bob-0123456789abcdef00', 'carol-0123456789abcdef', 'dave-0123456789abcdef0'];

function setup() {
  const db = openDb(':memory:');
  seed(db);
  return db;
}

/** Grava `games` partidas de pessoas com o Líder do Kid e a lista dada (direto no banco, como `recordMatch` grava). */
function kidGames(db: DB, owner: string, games: number, cards: Array<{ id: string; count: number }>) {
  const player = ensurePlayer(db, owner);
  const hash = `h-${owner.slice(0, 5)}`;
  db.prepare('INSERT OR IGNORE INTO deck_lists (hash, leader, cards) VALUES (?, ?, ?)').run(hash, KID, JSON.stringify(cards));
  for (let i = 0; i < games; i++) {
    const id = Number(db.prepare("INSERT INTO matches (seed, mode, deck0, deck1, winner, turns, reason) VALUES (1, 'online', 'a', 'b', 0, 9, 'life')").run().lastInsertRowid);
    db.prepare(
      `INSERT INTO match_seats (match_id, seat, controller, player_id, deck_hash, leader, opp_leader, opp_controller, went_first, won, mulligan, format, queue, played_at)
       VALUES (?, 0, 'human', ?, ?, ?, 'ST01-001', 'human', 1, 1, 0, 'egb', 'casual', datetime('now'))`,
    ).run(id, player.id, hash, KID);
  }
}

describe('deck provável do Líder', () => {
  it('sem estatísticas, vem do deck pronto do mesmo Líder; Líder desconhecido não tem deck provável', () => {
    const db = setup();
    const guesses = new HandGuesses(db);
    const g = guesses.forLeader(KID, OWNERS[0])!;
    expect(g.source).toBe('deck:st02-kid');
    expect(g.cards.find((c) => c.id === 'ST02-008')).toMatchObject({ count: 4, counter: 2000 });
    expect(g.cards.find((c) => c.id === 'ST02-015')?.event).toEqual({ cost: 1, power: 2000 });
    expect(guesses.forLeader('XX99-001', OWNERS[0])).toBeNull();
    expect(guesses.forLeader('../x', OWNERS[0])).toBeNull();
    expect(guesses.forLeader(null, OWNERS[0])).toBeNull();
  });

  it('com partidas de jogadores suficientes, vem das estatísticas, sem as partidas do próprio oponente', () => {
    const db = setup();
    const list = [
      { id: 'ST02-008', count: 4 },
      { id: 'ST01-012', count: 2 },
    ];
    const per = Math.ceil(HAND_GUESS_MIN_GAMES / 3);
    for (const o of OWNERS.slice(1)) kidGames(db, o, per, list);
    // O próprio oponente joga uma lista estranha: ela não entra no deck provável contra ele.
    kidGames(db, OWNERS[0], 50, [{ id: 'ST02-004', count: 4 }]);
    const g = new HandGuesses(db).forLeader(KID, OWNERS[0])!;
    expect(g.source).toBe('stats');
    expect(g.cards.map((c) => c.id).sort()).toEqual(['ST01-012', 'ST02-008']);
    expect(g.cards.find((c) => c.id === 'ST01-012')).toMatchObject({ count: 2, rush: { cost: 5, power: 6000 } });
  });

  it('com poucos jogadores (sem contar o oponente), cai no deck pronto', () => {
    const db = setup();
    for (const o of OWNERS.slice(0, 3)) kidGames(db, o, HAND_GUESS_MIN_GAMES, [{ id: 'ST02-008', count: 4 }]);
    // Contra o terceiro sobram dois jogadores: não basta.
    expect(new HandGuesses(db).forLeader(KID, OWNERS[2])!.source).toBe('deck:st02-kid');
    // Contra quem não jogou com o Líder, são três: vale.
    expect(new HandGuesses(db).forLeader(KID, OWNERS[3])!.source).toBe('stats');
    // Sem dono conhecido, as estatísticas não entram (podem ser as listas de quem está jogando).
    expect(new HandGuesses(db).forLeader(KID, null)!.source).toBe('deck:st02-kid');
  });

  it('fica guardado por uma hora', () => {
    const db = setup();
    let now = 0;
    const guesses = new HandGuesses(db, () => now);
    expect(guesses.forLeader(KID, OWNERS[3])!.source).toBe('deck:st02-kid');
    for (const o of OWNERS.slice(0, 3)) kidGames(db, o, HAND_GUESS_MIN_GAMES, [{ id: 'ST02-008', count: 4 }]);
    expect(guesses.forLeader(KID, OWNERS[3])!.source).toBe('deck:st02-kid');
    now += 61 * 60 * 1000;
    expect(guesses.forLeader(KID, OWNERS[3])!.source).toBe('stats');
  });

  it('GET /api/bot/hand-guess devolve o deck provável (sem as partidas de quem pede)', async () => {
    const db = setup();
    const app = buildApp(db);
    const r = await app.inject({ url: `/api/bot/hand-guess?leader=${KID}`, headers: { 'x-deck-owner': OWNERS[0] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().guess).toMatchObject({ leader: KID, source: 'deck:st02-kid' });
    expect((await app.inject('/api/bot/hand-guess')).json()).toEqual({ guess: null });
  });
});
