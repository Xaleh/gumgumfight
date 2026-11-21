import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import type { DeckSummary } from '../src/api';
import { allBlueLegal, deckNumbers, deckState, deckTime, initialTab, inTab, matchesColors, matchesQuery, quickSwap, sortDecks, topCards } from '../src/deckLibrary';

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

  it('escolhendo o próprio deck, abre em Meus decks sempre que a pessoa tem algum', () => {
    expect(initialTab([mine, other, builtin], NONE)).toBe('mine');
    // Mesmo com um deck pronto equipado e usado há pouco.
    expect(initialTab([mine, other, builtin], NONE, 'c')).toBe('mine');
    expect(initialTab([mine, other], NONE, 'b')).toBe('mine');
  });

  it('sem deck próprio: a aba do deck escolhido, senão Recentes, senão Prontos', () => {
    expect(initialTab([other, builtin], NONE, 'b')).toBe('favorites');
    expect(initialTab([other, builtin], NONE)).toBe('recent');
    expect(initialTab([other], NONE)).toBe('builtin');
  });

  it('deck do oponente do treino: a aba do deck escolhido, senão Recentes, senão Meus decks', () => {
    expect(initialTab([mine, other, builtin], NONE, 'c', false)).toBe('recent');
    expect(initialTab([mine, other, builtin], NONE, undefined, false)).toBe('recent');
    expect(initialTab([mine, other], NONE, undefined, false)).toBe('mine');
  });
});

describe('troca rápida', () => {
  const m1 = deck({ id: 'm1', name: 'Meu 1', lastPlayedAt: '2026-10-05 00:00:00' });
  const m2 = deck({ id: 'm2', name: 'Meu 2', updatedAt: '2026-10-09 00:00:00' });
  const m3 = deck({ id: 'm3', name: 'Meu 3', lastPlayedAt: '2026-10-08 00:00:00' });
  const m4 = deck({ id: 'm4', name: 'Meu 4', valid: false });
  const community = deck({ id: 'o', mine: false, lastPlayedAt: '2026-10-20 00:00:00' });
  const builtin = deck({ id: 'p', kind: 'builtin', mine: false, lastPlayedAt: '2026-10-21 00:00:00' });
  const valid = (d: DeckSummary) => d.valid;
  const ids = (ds: DeckSummary[]) => ds.map((d) => d.id);

  it('só os decks de quem vai jogar, o usado por último antes, sem o escolhido nem os que não valem', () => {
    expect(ids(quickSwap([m1, m2, m3, m4, community, builtin], NONE, 'p', valid))).toEqual(['m3', 'm1', 'm2']);
    expect(ids(quickSwap([m1, m2, m3, m4, community, builtin], NONE, 'm3', valid))).toEqual(['m1', 'm2']);
    expect(ids(quickSwap([m1, m2, m3, community, builtin], NONE, 'p', valid, 2))).toEqual(['m3', 'm1']);
  });

  it('a escolha neste navegador conta como uso', () => {
    const local = new Map([['m2', deckTime('2026-10-30 00:00:00')]]);
    expect(ids(quickSwap([m1, m2, m3, community, builtin], local, 'p', valid))).toEqual(['m2', 'm3', 'm1']);
  });

  it('quem não montou nenhum deck vê os usados por último', () => {
    const fresh = deck({ id: 'q', kind: 'builtin', mine: false });
    expect(ids(quickSwap([community, builtin, fresh], NONE, 'q', valid))).toEqual(['p', 'o']);
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

  it('por Líder: os do mesmo Líder juntos, o editado por último antes', () => {
    const zoro = { leader: 'ST01-002', leaderName: 'Roronoa Zoro' };
    const z1 = deck({ id: 'z1', ...zoro, updatedAt: '2026-10-04 00:00:00' });
    const z2 = deck({ id: 'z2', ...zoro, updatedAt: '2026-10-06 00:00:00' });
    const luffy2 = deck({ id: 'l2', leader: 'OP05-060', updatedAt: '2026-10-09 00:00:00' });
    expect(ids(sortDecks([z1, a, luffy2, b, z2, c], 'leader', NONE))).toEqual(['l2', 'c', 'a', 'b', 'z2', 'z1']);
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

  it('All Blue: o deck que só vale nele não aparece como proibido', () => {
    const formats = (allblue: string[]) => ({ standard: ['banida'], egb: ['banida'], allblue });
    expect(deckState(deck({ formats: formats([]) }))).toBe('allblue');
    expect(deckState(deck({ formats: formats(['SR']) }))).toBe('banned');
    // Vale num formato oficial: o selo continua o oficial, e `allBlueLegal` diz se também vale no All Blue.
    const both = deck({ formats: { standard: [], egb: [], allblue: [] } });
    expect(deckState(both)).toBe('standard');
    expect(allBlueLegal(both)).toBe(true);
    expect(allBlueLegal(deck({ formats: { standard: [], egb: [], allblue: ['SR'] } }))).toBe(false);
    expect(allBlueLegal(deck({ valid: false, formats: formats([]) }))).toBe(false);
    // Servidor antigo: sem o formato no resumo, não vale.
    expect(allBlueLegal(deck({ formats: { standard: [], egb: [] } as never }))).toBe(false);
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
