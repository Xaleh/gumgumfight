import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import type { DeckSummary } from '../src/api';
import { deckNumbers, deckState, deckTime, initialTab, inTab, matchesColors, matchesQuery, sortDecks, topCards } from '../src/deckLibrary';

const deck = (over: Partial<DeckSummary>): DeckSummary => ({
  id: 'x',
  name: 'Deck',
  kind: 'user',
  leader: 'ST01-001',
  leaderName: 'Monkey.D.Luffy',
  leaderImage: null,
  colors: ['red'],
  size: 50,
  valid: true,
  errors: [],
  formats: { standard: [], egb: [] },
  unscripted: 0,
  updatedAt: '2026-10-01 12:00:00',
  mine: true,
  ...over,
});

const NONE = new Map<string, number>();

describe('abas, busca e cores', () => {
  const mine = deck({ id: 'a', name: 'Zoro Santoryu', leaderName: 'Roronoa Zoro', leader: 'OP01-001' });
  const other = deck({ id: 'b', mine: false, colors: ['purple'], favorite: true, games: 12 });
  const builtin = deck({ id: 'c', kind: 'builtin', mine: false, colors: ['green', 'red'], lastPlayedAt: '2026-10-20 10:00:00' });

  it('separa meus, comunidade, prontos, favoritos e recentes', () => {
    const tab = (d: DeckSummary) => (['recent', 'favorites', 'mine', 'community', 'builtin'] as const).filter((t) => inTab(d, t, NONE));
    expect(tab(mine)).toEqual(['mine']);
    expect(tab(other)).toEqual(['favorites', 'community']);
    expect(tab(builtin)).toEqual(['recent', 'builtin']);
    // Um deck escolhido neste navegador também é recente.
    expect(inTab(mine, 'recent', new Map([['a', Date.now()]]))).toBe(true);
  });

  it('busca no nome e no Líder (nome e número), sem diferenciar maiúsculas', () => {
    expect(matchesQuery(mine, 'santoryu')).toBe(true);
    expect(matchesQuery(mine, 'ZORO')).toBe(true);
    expect(matchesQuery(mine, 'op01')).toBe(true);
    expect(matchesQuery(mine, 'nami')).toBe(false);
    expect(matchesQuery(mine, '  ')).toBe(true);
  });

  it('filtra por qualquer uma das cores escolhidas', () => {
    expect(matchesColors(builtin, ['green'])).toBe(true);
    expect(matchesColors(builtin, ['blue', 'red'])).toBe(true);
    expect(matchesColors(other, ['red'])).toBe(false);
    expect(matchesColors(other, [])).toBe(true);
  });

  it('abre em Recentes quando há, senão Meus decks, senão Prontos', () => {
    expect(initialTab([mine, other, builtin], NONE)).toBe('recent');
    expect(initialTab([mine, other], NONE)).toBe('mine');
    expect(initialTab([other], NONE)).toBe('builtin');
  });
});

describe('ordenação', () => {
  const a = deck({ id: 'a', name: 'Beta', colors: ['yellow'], updatedAt: '2026-10-02 00:00:00', games: 1 });
  const b = deck({ id: 'b', name: 'Alfa', colors: ['red'], updatedAt: '2026-10-01 00:00:00', games: 9, lastPlayedAt: '2026-10-05 00:00:00' });
  const c = deck({ id: 'c', name: 'Gama', colors: ['blue'], updatedAt: '2026-10-03 00:00:00' });
  const ids = (ds: DeckSummary[]) => ds.map((d) => d.id);

  it('por nome, cor, partidas e edição', () => {
    expect(ids(sortDecks([a, b, c], 'name', NONE))).toEqual(['b', 'a', 'c']);
    expect(ids(sortDecks([a, b, c], 'color', NONE))).toEqual(['b', 'c', 'a']);
    expect(ids(sortDecks([a, b, c], 'games', NONE))).toEqual(['b', 'a', 'c']);
    expect(ids(sortDecks([a, b, c], 'updated', NONE))).toEqual(['c', 'a', 'b']);
  });

  it('usados por último: a partida no servidor ou a escolha neste navegador, a mais nova', () => {
    expect(ids(sortDecks([a, b, c], 'recent', NONE))).toEqual(['b', 'c', 'a']);
    const local = new Map([['a', deckTime('2026-10-06 00:00:00')]]);
    expect(ids(sortDecks([a, b, c], 'recent', local))).toEqual(['a', 'b', 'c']);
  });
});

describe('estado e números do deck', () => {
  it('rascunho, Standard, só EGB ou proibido', () => {
    expect(deckState(deck({ valid: false, size: 38 }))).toBe('draft');
    expect(deckState(deck({}))).toBe('standard');
    expect(deckState(deck({ formats: { standard: ['rotacionada'], egb: [] } }))).toBe('egb');
    expect(deckState(deck({ formats: { standard: ['banida'], egb: ['banida'] } }))).toBe('banned');
  });

  it('curva, counters, tipos e as cartas principais', () => {
    const cards = JSON.parse(readFileSync(join(__dirname, '../../../data/cards/st01.json'), 'utf8')).cards as CardData[];
    const byId = new Map(cards.map((c) => [c.id, c]));
    const list = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8')).cards as Array<{ id: string; count: number }>;
    const n = deckNumbers(list, byId);
    expect(n.total).toBe(50);
    expect(n.curve.reduce((s, x) => s + x, 0)).toBe(50);
    expect(n.byCategory.character + n.byCategory.event + n.byCategory.stage).toBe(50);
    expect(n.counter1000 + n.counter2000).toBeGreaterThan(0);
    const top = topCards(list, byId, 3);
    expect(top).toHaveLength(3);
    expect(top.every((c, i) => i === 0 || c.count <= top[i - 1].count)).toBe(true);
  });
});
