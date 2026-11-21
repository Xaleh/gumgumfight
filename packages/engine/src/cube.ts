// Cubo: uma lista fixa de cartas, uma cópia de cada, de todas as coleções. No Draft Cubo os
// boosters saem dela (sem vaga de raridade e sem repetir carta no pod) e o resto é o Draft
// (`draft.ts`): pod, rodízio e deck de 40 com qualquer Líder do jogo.
//
// A lista de uma temporada vem das cartas mais usadas (`pickCube`): tantas por cor, com tetos de
// Eventos e Stages e faixas de custo, para o booster ter carta jogável em todas as fases da partida.
// Líderes não entram (o Líder é livre) nem cartas com efeito que o jogo ainda não aplica sozinho.

import { needsManual } from './cards';
import { nextRandom } from './rng';
import { boosterSize, holderOf } from './sealed';
import type { CardData, Color } from './types';

/** Quantas cartas um pod tira do Cubo. */
export const cubeCardsNeeded = (seats: number, rounds: number, size = boosterSize()): number => seats * rounds * size;

/**
 * Boosters de um Draft Cubo: a lista é embaralhada e repartida, então nenhuma carta aparece duas
 * vezes no pod. Devolve `packs[rodada][assento]`, no formato de `openDraftBoosters`.
 */
export function openCubeBoosters(
  cardIds: readonly string[],
  seed: number | readonly number[],
  seats: number,
  rounds: number,
  key: string,
  size = boosterSize(),
): { sets: string[][]; packs: string[][][] } {
  const deck = [...new Set(cardIds)];
  if (deck.length < cubeCardsNeeded(seats, rounds, size)) throw new Error(`O Cubo tem ${deck.length} cartas; o pod precisa de ${cubeCardsNeeded(seats, rounds, size)}.`);
  const holder = holderOf(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(holder) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let at = 0;
  const packs = Array.from({ length: rounds }, () => Array.from({ length: seats }, () => deck.slice(at, (at += size))));
  return { sets: packs.map((r) => r.map(() => key)), packs };
}

export const CUBE_COLORS: readonly Color[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

/** A cor em que a carta conta no Cubo: a primeira (as poucas cartas de duas cores entram por ela). */
export const cubeColor = (card: Pick<CardData, 'colors'>): Color | undefined => card.colors[0];

/** O formato da lista: cartas por cor, tetos do que não é Personagem e faixas de custo. */
export interface CubeShape {
  perColor: number;
  maxEvents: number;
  maxStages: number;
  /** Por cor: de `min` a `max` cartas com custo até `upTo` (e acima da faixa anterior). */
  bands: ReadonlyArray<{ upTo: number; min: number; max: number }>;
}

export const DEFAULT_CUBE_SHAPE: CubeShape = {
  perColor: 70,
  maxEvents: 14,
  maxStages: 2,
  bands: [
    { upTo: 2, min: 18, max: 26 },
    { upTo: 4, min: 20, max: 28 },
    { upTo: 6, min: 10, max: 18 },
    { upTo: Infinity, min: 4, max: 10 },
  ],
};

export interface CubePick {
  id: string;
  color: Color;
  /** O uso que pôs a carta na lista (0 a 1). */
  usage: number;
}

/** Se a carta pode estar num Cubo: não é Líder e o jogo aplica o efeito dela sozinho. */
export const cubeEligible = (card: CardData): boolean => card.category !== 'leader' && !needsManual(card) && card.colors.length > 0;

/**
 * Escolhe a lista do Cubo: as mais usadas de cada cor, dentro do formato. Primeiro garante o
 * mínimo de cada faixa de custo, depois completa pela ordem de uso sem estourar os tetos; se uma
 * cor não tem cartas usadas o bastante, os tetos cedem (faixas primeiro, depois Eventos e Stages).
 * `usage`: o uso de cada carta (0 a 1); carta fora do catálogo ou que não pode estar no Cubo é ignorada.
 */
export function pickCube(usage: ReadonlyMap<string, number>, cards: ReadonlyMap<string, CardData>, shape: CubeShape = DEFAULT_CUBE_SHAPE): CubePick[] {
  const out: CubePick[] = [];
  const bandOf = (c: CardData) => shape.bands.findIndex((b) => (c.cost ?? 0) <= b.upTo);
  for (const color of CUBE_COLORS) {
    const pool = [...usage]
      .map(([id, use]) => ({ card: cards.get(id), use }))
      .filter((x): x is { card: CardData; use: number } => Boolean(x.card) && cubeEligible(x.card!) && cubeColor(x.card!) === color && x.use > 0)
      .sort((a, b) => b.use - a.use || a.card.id.localeCompare(b.card.id));
    const taken = new Set<string>();
    const inBand = shape.bands.map(() => 0);
    let events = 0;
    let stages = 0;
    const take = (x: { card: CardData; use: number }) => {
      taken.add(x.card.id);
      inBand[bandOf(x.card)]++;
      if (x.card.category === 'event') events++;
      if (x.card.category === 'stage') stages++;
    };
    const fits = (c: CardData, caps: boolean) => !caps || ((c.category !== 'event' || events < shape.maxEvents) && (c.category !== 'stage' || stages < shape.maxStages));
    // 1) o mínimo de cada faixa de custo
    shape.bands.forEach((band, i) => {
      for (const x of pool) {
        if (inBand[i] >= band.min || taken.size >= shape.perColor) break;
        if (!taken.has(x.card.id) && bandOf(x.card) === i && fits(x.card, true)) take(x);
      }
    });
    // 2) completa pelo uso, dentro dos tetos; 3) sem o teto das faixas; 4) sem teto nenhum
    for (const [bands, caps] of [
      [true, true],
      [false, true],
      [false, false],
    ] as const) {
      for (const x of pool) {
        if (taken.size >= shape.perColor) break;
        if (taken.has(x.card.id) || !fits(x.card, caps)) continue;
        if (bands && inBand[bandOf(x.card)] >= shape.bands[bandOf(x.card)].max) continue;
        take(x);
      }
    }
    out.push(...pool.filter((x) => taken.has(x.card.id)).map((x) => ({ id: x.card.id, color, usage: x.use })));
  }
  return out;
}
