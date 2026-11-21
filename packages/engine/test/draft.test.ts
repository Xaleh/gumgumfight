import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDraft, DRAFT_ROUNDS, DRAFT_SEATS, draftChoice, draftDone, draftPack, draftPassTo, draftPick, draftPicked, draftPicks, draftPickSeconds, type DraftState } from '../src/draft';
import { autoBuildLimited, boosterCards, boosterSize, openDraftBoosters, poolCounts, validateLimitedDeck } from '../src/sealed';
import type { CardData } from '../src/types';

const DATA = join(__dirname, '../../../data');
const all: CardData[] = readdirSync(join(DATA, 'cards')).flatMap((f) => JSON.parse(readFileSync(join(DATA, 'cards', f), 'utf8')).cards as CardData[]);
const byId = new Map(all.map((c) => [c.id, c]));
const op01 = { set: 'OP01', cards: boosterCards(all, 'OP01') };
const op02 = { set: 'OP02', cards: boosterCards(all, 'OP02') };
const start = (seed = 1, sources = [op01]) => createDraft(openDraftBoosters(sources, seed, DRAFT_SEATS, DRAFT_ROUNDS));
/** Todos escolhem a primeira carta do booster, até o draft acabar. */
function playOut(s: DraftState, choose: (pack: string[], seat: number, s: DraftState) => string = (pack) => pack[0]): DraftState {
  for (let guard = 0; guard < 2000 && !draftDone(s); guard++) {
    const seat = s.queues.findIndex((q) => q.length);
    s = draftPick(s, seat, choose(draftPack(s, seat)!, seat, s));
  }
  return s;
}

describe('Draft: boosters do pod', () => {
  it('8 assentos x 4 rodadas, um booster de 12 por assento em cada rodada', () => {
    const b = openDraftBoosters([op01], 3, DRAFT_SEATS, DRAFT_ROUNDS);
    expect(b.packs).toHaveLength(4);
    expect(b.packs.every((r) => r.length === 8 && r.every((p) => p.length === boosterSize() && new Set(p).size === p.length))).toBe(true);
    expect(b.sets.flat().every((s) => s === 'OP01')).toBe(true);
    expect(openDraftBoosters([op01], 3, 8, 4)).toEqual(b);
    expect(openDraftBoosters([op01], 4, 8, 4)).not.toEqual(b);
  });

  it('Pack Rush draft: a coleção de cada booster é sorteada entre as escolhidas', () => {
    const b = openDraftBoosters([op01, op02], 9, DRAFT_SEATS, DRAFT_ROUNDS);
    expect(new Set(b.sets.flat())).toEqual(new Set(['OP01', 'OP02']));
    b.packs.forEach((round, r) => round.forEach((pack, seat) => expect(pack.every((id) => id.startsWith(`${b.sets[r][seat]}-`))).toBe(true)));
    // Numa mesma rodada, os assentos podem abrir coleções diferentes.
    expect(b.sets.some((round) => new Set(round).size > 1)).toBe(true);
  });
});

describe('Draft: escolher e passar', () => {
  it('começa com um booster cheio na mão de cada assento', () => {
    const s = start();
    expect(s).toMatchObject({ seats: 8, rounds: 4, round: 0 });
    for (let seat = 0; seat < 8; seat++) {
      expect(draftPack(s, seat)).toHaveLength(12);
      expect(draftPicked(s, seat)).toBe(0);
    }
    // Os boosters das outras rodadas continuam fechados.
    expect(s.sealed.map((r) => r.length)).toEqual([0, 8, 8, 8]);
  });

  it('quem escolhe fica com a carta e passa as outras 11 ao vizinho da esquerda', () => {
    const s0 = start();
    const pack = draftPack(s0, 0)!;
    const s1 = draftPick(s0, 0, pack[3]);
    expect(draftPicks(s1, 0)).toEqual([pack[3]]);
    // Esperando o assento 7 passar o booster dele.
    expect(draftPack(s1, 0)).toBeNull();
    // O assento 1 ainda vê o próprio booster; o que chegou do 0 está na fila.
    expect(draftPack(s1, 1)).toEqual(draftPack(s0, 1));
    expect(s1.queues[1]).toHaveLength(2);
    expect(s1.queues[1][1]).toEqual(pack.filter((id) => id !== pack[3]));
    // O estado anterior não muda.
    expect(draftPack(s0, 0)).toHaveLength(12);
    expect(draftPicks(s0, 0)).toEqual([]);
  });

  it('o passe alterna: esquerda, direita, esquerda, direita', () => {
    expect([0, 1, 2, 3].map((round) => draftPassTo({ seats: 8, round }, 0))).toEqual([1, 7, 1, 7]);
    expect([0, 1].map((round) => draftPassTo({ seats: 8, round }, 7))).toEqual([0, 6]);
    // Na 2ª rodada, o booster do assento 0 vai para o 7.
    let s = start();
    while (s.round === 0) {
      const seat = s.queues.findIndex((q) => q.length);
      s = draftPick(s, seat, draftPack(s, seat)![0]);
    }
    expect(s.round).toBe(1);
    const pack = draftPack(s, 0)!;
    expect(pack).toHaveLength(12);
    s = draftPick(s, 0, pack[0]);
    expect(s.queues[7][1]).toEqual(pack.slice(1));
    expect(s.queues[1]).toHaveLength(1);
  });

  it('recusa carta fora do booster e escolha sem booster na mão', () => {
    const s0 = start();
    expect(() => draftPick(s0, 0, draftPack(s0, 1)!.find((id) => !draftPack(s0, 0)!.includes(id))!)).toThrow(/não está neste booster/);
    const s1 = draftPick(s0, 0, draftPack(s0, 0)![0]);
    expect(() => draftPick(s1, 0, draftPack(s0, 0)![1])).toThrow(/Nenhum booster/);
  });

  it('no fim cada assento tem 48 cartas (12 por rodada) e todas as 384 foram escolhidas uma vez', () => {
    const boosters = openDraftBoosters([op01], 21, DRAFT_SEATS, DRAFT_ROUNDS);
    const s = playOut(createDraft(boosters));
    expect(draftDone(s)).toBe(true);
    expect(s.round).toBe(4);
    for (let seat = 0; seat < 8; seat++) {
      expect(s.picks[seat].map((r) => r.length)).toEqual([12, 12, 12, 12]);
      expect(draftPack(s, seat)).toBeNull();
    }
    const opened = boosters.packs.flat(2).sort();
    expect(s.picks.flat(2).sort()).toEqual(opened);
    expect(opened).toHaveLength(384);
    expect(() => draftPick(s, 0, opened[0])).toThrow();
  });

  it('a ordem em que os assentos escolhem não muda o que chega a cada um', () => {
    // Cada um sempre pega a carta de menor número: o resultado só depende dos boosters e do passe.
    const lowest = (pack: string[]) => [...pack].sort()[0];
    const boosters = openDraftBoosters([op01], 5, DRAFT_SEATS, DRAFT_ROUNDS);
    const forward = playOut(createDraft(boosters), lowest);
    let s = createDraft(boosters);
    for (let guard = 0; guard < 2000 && !draftDone(s); guard++) {
      const seat = s.queues.length - 1 - [...s.queues].reverse().findIndex((q) => q.length);
      s = draftPick(s, seat, lowest(draftPack(s, seat)!));
    }
    expect(s.picks).toEqual(forward.picks);
  });

  it('o tempo de escolha cai com o booster: 46 s com 12 cartas, 13 s com a última', () => {
    expect([12, 6, 1].map(draftPickSeconds)).toEqual([46, 28, 13]);
  });
});

describe('Draft: a escolha do bot e o deck', () => {
  it('pega a melhor carta do booster e só o primeiro Líder', () => {
    const leader = all.find((c) => c.id.startsWith('OP01-') && c.category === 'leader')!;
    const other = all.find((c) => c.id.startsWith('OP02-') && c.category === 'leader')!;
    const weak = all.find((c) => c.id.startsWith('OP01-') && c.category === 'character' && c.rarity === 'C' && !c.text && (c.power ?? 0) <= 3000)!;
    const sr = all.find((c) => c.id.startsWith('OP01-') && c.category === 'character' && c.rarity === 'SR')!;
    expect(draftChoice([weak.id, sr.id], [], byId)).toBe(sr.id);
    expect(draftChoice([other.id, weak.id], [leader.id], byId)).toBe(weak.id);
    // Carta desconhecida nunca ganha de uma conhecida.
    expect(draftChoice(['XX-000', weak.id], [], byId)).toBe(weak.id);
    expect(draftChoice([weak.id], [], byId)).toBe(weak.id);
  });

  it('com o que cada assento escolheu dá para fechar um deck de 40', () => {
    const s = playOut(start(8), (pack, seat, st) => draftChoice(pack, draftPicks(st, seat), byId));
    for (let seat = 0; seat < 8; seat++) {
      const pool = poolCounts(s.picks[seat]);
      const deck = { id: 'sealed:x', name: 'Draft', ...autoBuildLimited(pool, byId) };
      const report = validateLimitedDeck(deck, byId, pool);
      expect(report.issues.filter((i) => i.level === 'error'), `assento ${seat}`).toEqual([]);
      expect(report.total).toBe(40);
    }
  });
});
