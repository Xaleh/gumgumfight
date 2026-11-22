import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUBE_COLORS, cubeCardsNeeded, cubeColor, cubeEligible, type CubeShape, DEFAULT_CUBE_SHAPE, openCubeBoosters, pickCube } from '../src/cube';
import { createDraft, DRAFT_ROUNDS, DRAFT_SEATS, draftChoice, draftDone, draftPack, draftPick, draftPicks } from '../src/draft';
import { cubeIdOf, cubeKey, isCube, playModeLabel } from '../src/formats';
import { boosterSize } from '../src/sealed';
import type { CardData } from '../src/types';

const DATA = join(__dirname, '../../../data');
const all: CardData[] = readdirSync(join(DATA, 'cards')).flatMap((f) => JSON.parse(readFileSync(join(DATA, 'cards', f), 'utf8')).cards as CardData[]);
const byId = new Map(all.map((c) => [c.id, c]));
const eligible = all.filter(cubeEligible);
const KEY = cubeKey('t1');

describe('Cubo: a chave do modo', () => {
  it('"CUBE:T1" no lugar da coleção, e o nome do modo é "Draft Cubo"', () => {
    expect(KEY).toBe('CUBE:T1');
    expect(isCube(KEY)).toBe(true);
    expect(isCube('OP01')).toBe(false);
    expect(isCube('OP01+OP02')).toBe(false);
    expect(isCube(null)).toBe(false);
    expect(cubeIdOf(KEY)).toBe('T1');
    expect(playModeLabel({ format: 'sealed', sealedSet: KEY, sealedPod: 'abc' })).toBe('Draft Cubo');
    expect(playModeLabel({ format: 'sealed', sealedSet: 'OP01', sealedPod: 'abc' })).toBe('Draft OP01');
  });
});

describe('Cubo: boosters do pod', () => {
  const ids = eligible.slice(0, 400).map((c) => c.id);

  it('8 assentos x 4 rodadas x 12 cartas, sem repetir carta no pod', () => {
    expect(cubeCardsNeeded(DRAFT_SEATS, DRAFT_ROUNDS)).toBe(384);
    const b = openCubeBoosters(ids, 7, DRAFT_SEATS, DRAFT_ROUNDS, KEY);
    expect(b.packs).toHaveLength(4);
    expect(b.packs.every((r) => r.length === 8 && r.every((p) => p.length === boosterSize()))).toBe(true);
    const dealt = b.packs.flat(2);
    expect(new Set(dealt).size).toBe(384);
    expect(dealt.every((id) => ids.includes(id))).toBe(true);
    expect(b.sets.flat().every((s) => s === KEY)).toBe(true);
  });

  it('a mesma seed dá os mesmos boosters; outra seed, outros', () => {
    const b = openCubeBoosters(ids, [1, 2, 3, 4], 8, 4, KEY);
    expect(openCubeBoosters(ids, [1, 2, 3, 4], 8, 4, KEY)).toEqual(b);
    expect(openCubeBoosters(ids, [1, 2, 3, 5], 8, 4, KEY)).not.toEqual(b);
  });

  it('lista repetida conta uma vez, e Cubo pequeno demais para o pod é recusado', () => {
    expect(() => openCubeBoosters([...ids.slice(0, 300), ...ids.slice(0, 300)], 1, 8, 4, KEY)).toThrow(/300 cartas/);
    expect(openCubeBoosters(ids.slice(0, 48), 1, 1, 4, KEY).packs.flat(2)).toHaveLength(48);
  });

  it('o draft do Cubo corre como qualquer draft, e cada carta fica com um só jogador', () => {
    let s = createDraft(openCubeBoosters(ids, 11, DRAFT_SEATS, DRAFT_ROUNDS, KEY));
    for (let guard = 0; guard < 2000 && !draftDone(s); guard++) {
      const seat = s.queues.findIndex((q) => q.length);
      s = draftPick(s, seat, draftPack(s, seat)![0]);
    }
    expect(draftDone(s)).toBe(true);
    const picks = Array.from({ length: 8 }, (_, seat) => draftPicks(s, seat));
    expect(picks.every((p) => p.length === 48)).toBe(true);
    expect(new Set(picks.flat()).size).toBe(384);
  });
});

describe('Cubo: a escolha da lista (pickCube)', () => {
  // Uso de mentira: cai conforme a posição da carta no catálogo, todas com algum uso.
  const usage = new Map(all.map((c, i) => [c.id, 1 - i / (all.length + 1)]));
  const small: CubeShape = { perColor: 20, maxEvents: 4, maxStages: 1, bands: [{ upTo: 2, min: 5, max: 8 }, { upTo: 4, min: 5, max: 9 }, { upTo: 6, min: 2, max: 6 }, { upTo: Infinity, min: 1, max: 3 }] };
  const picks = pickCube(usage, byId, small);
  const of = (color: string) => picks.filter((p) => p.color === color).map((p) => byId.get(p.id)!);

  it('tantas por cor, sem Líder, sem carta repetida e na ordem de uso', () => {
    for (const color of CUBE_COLORS) {
      const mine = picks.filter((p) => p.color === color);
      expect(mine.length, color).toBe(20);
      expect(mine.every((p) => cubeColor(byId.get(p.id)!) === color)).toBe(true);
      expect(mine.map((p) => p.usage)).toEqual([...mine.map((p) => p.usage)].sort((a, b) => b - a));
    }
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
    expect(picks.every((p) => byId.get(p.id)!.category !== 'leader')).toBe(true);
  });

  it('respeita os tetos de Eventos e Stages e o mínimo de cada faixa de custo', () => {
    for (const color of CUBE_COLORS) {
      const mine = of(color);
      expect(mine.filter((c) => c.category === 'event').length, `${color} eventos`).toBeLessThanOrEqual(4);
      expect(mine.filter((c) => c.category === 'stage').length, `${color} stages`).toBeLessThanOrEqual(1);
      const band = (lo: number, hi: number) => mine.filter((c) => (c.cost ?? 0) > lo && (c.cost ?? 0) <= hi).length;
      expect(band(-1, 2), `${color} custo 0-2`).toBeGreaterThanOrEqual(5);
      expect(band(2, 4), `${color} custo 3-4`).toBeGreaterThanOrEqual(5);
      expect(band(-1, 2), `${color} custo 0-2`).toBeLessThanOrEqual(8);
    }
  });

  it('a carta mais usada da cor entra; carta sem uso, desconhecida ou Líder fica de fora', () => {
    const red = eligible.filter((c) => cubeColor(c) === 'red');
    const leader = all.find((c) => c.category === 'leader')!;
    const only = pickCube(new Map([[red[0].id, 0.5], [red[1].id, 0], ['XX99-999', 0.9], [leader.id, 0.9]]), byId, small);
    expect(only.map((p) => p.id)).toEqual([red[0].id]);
  });

  it('cor sem cartas usadas o bastante: os tetos cedem para completar a lista', () => {
    const events = eligible.filter((c) => cubeColor(c) === 'red' && c.category === 'event').slice(0, 6);
    const tight: CubeShape = { ...small, perColor: 6, maxEvents: 2 };
    const got = pickCube(new Map(events.map((c, i) => [c.id, 0.9 - i / 10])), byId, tight);
    expect(got).toHaveLength(Math.min(6, events.length));
  });

  it('o formato padrão é 70 por cor (420 cartas) e as faixas cabem nele', () => {
    expect(DEFAULT_CUBE_SHAPE.perColor * CUBE_COLORS.length).toBe(420);
    expect(DEFAULT_CUBE_SHAPE.bands.reduce((n, b) => n + b.min, 0)).toBeLessThanOrEqual(70);
    expect(DEFAULT_CUBE_SHAPE.bands.reduce((n, b) => n + b.max, 0)).toBeGreaterThanOrEqual(70);
  });
});

describe('Cubo: a escolha dos bots', () => {
  it('com o uso das cartas, o bot prefere a mais usada entre cartas parecidas', () => {
    const chars = eligible.filter((c) => c.category === 'character' && c.cost === 2 && c.power === 3000 && !c.text.trim()).slice(0, 2);
    const pack = chars.length === 2 ? chars.map((c) => c.id) : eligible.slice(0, 2).map((c) => c.id);
    expect(draftChoice(pack, [], byId, undefined, new Map([[pack[1], 0.3]]))).toBe(pack[1]);
    expect(draftChoice(pack, [], byId, undefined, new Map([[pack[0], 0.3]]))).toBe(pack[0]);
  });
});
