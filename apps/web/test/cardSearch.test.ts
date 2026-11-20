import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { matchesCardQuery, parseCardQuery } from '../src/cardSearch';

const card = (over: Partial<CardData>): CardData => ({
  id: 'OP01-001',
  name: 'Carta',
  category: 'character',
  colors: ['red'],
  types: [],
  text: '',
  ...over,
});

const CARDS = [
  card({ id: 'OP01-006', name: 'Otama', cost: 1, counter: 2000, types: ['Land of Wano'] }),
  card({ id: 'OP01-013', name: 'Sanji', cost: 2, counter: 2000, types: ['Straw Hat Crew'] }),
  card({ id: 'OP01-016', name: 'Nami', cost: 1, counter: 1000, types: ['Straw Hat Crew'], text: 'Look at 5 cards from the top of your deck.' }),
  card({ id: 'OP01-025', name: 'Roronoa Zoro', cost: 3, counter: 0, types: ['Straw Hat Crew'] }),
  card({ id: 'OP01-026', name: 'Gum-Gum Fire-Fist Pistol Red Hawk', category: 'event', cost: 2 }),
  card({ id: 'OP01-001', name: 'Roronoa Zoro', category: 'leader', life: 5, power: 5000 }),
];

const search = (query: string) => {
  const q = parseCardQuery(query);
  return CARDS.filter((c) => matchesCardQuery(c, q)).map((c) => c.id);
};

describe('atalhos da busca de cartas', () => {
  it('c<número> filtra o custo', () => {
    expect(search('c1')).toEqual(['OP01-006', 'OP01-016']);
    expect(search('c3')).toEqual(['OP01-025']);
    expect(search('c9')).toEqual([]);
  });

  it('c1000 e c2000 filtram o Counter', () => {
    expect(search('c2000')).toEqual(['OP01-006', 'OP01-013']);
    expect(search('c1000')).toEqual(['OP01-016']);
  });

  it('custo e Counter juntos se combinam, em qualquer ordem', () => {
    expect(search('c1 c2000')).toEqual(['OP01-006']);
    expect(search('c2000 c1')).toEqual(['OP01-006']);
    expect(search('c3 c2000')).toEqual([]);
  });

  it('atalhos do mesmo tipo somam', () => {
    expect(search('c1 c2')).toEqual(['OP01-006', 'OP01-013', 'OP01-016', 'OP01-026']);
    expect(search('c1000 c2000')).toEqual(['OP01-006', 'OP01-013', 'OP01-016']);
    expect(search('c1 c2 c2000')).toEqual(['OP01-006', 'OP01-013']);
  });

  it('aceita maiúsculas e espaços sobrando', () => {
    expect(search('  C1   C2000 ')).toEqual(['OP01-006']);
  });

  it('o resto continua sendo busca por texto, junto com os atalhos', () => {
    expect(search('straw hat')).toEqual(['OP01-013', 'OP01-016', 'OP01-025']);
    expect(search('straw hat c2000')).toEqual(['OP01-013']);
    expect(search('c1 straw hat')).toEqual(['OP01-016']);
    expect(search('straw c2000 hat')).toEqual(['OP01-013']);
    expect(search('op01-02')).toEqual(['OP01-025', 'OP01-026']);
  });

  it('carta sem custo ou sem Counter não entra no filtro correspondente', () => {
    expect(search('c2')).not.toContain('OP01-001');
    expect(search('c2000 zoro')).toEqual([]);
  });

  it('só é atalho a palavra inteira no formato c<número>', () => {
    expect(parseCardQuery('c c3x xc3 c-3')).toEqual({ costs: [], counters: [], text: 'c c3x xc3 c-3' });
    expect(parseCardQuery('c0 c10 c1000')).toEqual({ costs: [0, 10], counters: [1000], text: '' });
  });

  it('busca vazia aceita tudo', () => {
    expect(search('')).toHaveLength(CARDS.length);
  });
});
