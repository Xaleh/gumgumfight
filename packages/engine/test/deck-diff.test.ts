import { describe, expect, it } from 'vitest';
import { deckListDiff } from '../src';

describe('deckListDiff (versões do deck)', () => {
  it('lista o que entrou e o que saiu, com as cópias de antes e de depois', () => {
    const before = { leader: 'OP01-001', cards: [{ id: 'OP01-002', count: 4 }, { id: 'OP01-003', count: 2 }, { id: 'OP01-004', count: 4 }] };
    const after = { leader: 'OP01-001', cards: [{ id: 'OP01-002', count: 4 }, { id: 'OP01-003', count: 4 }, { id: 'OP01-005', count: 2 }] };
    const d = deckListDiff(before, after);
    expect(d.leader).toBeNull();
    expect(d.added).toEqual([
      { id: 'OP01-003', before: 2, after: 4, delta: 2 },
      { id: 'OP01-005', before: 0, after: 2, delta: 2 },
    ]);
    expect(d.removed).toEqual([{ id: 'OP01-004', before: 4, after: 0, delta: -4 }]);
  });

  it('soma linhas repetidas da mesma carta e ignora a ordem', () => {
    const before = { leader: 'L', cards: [{ id: 'B', count: 2 }, { id: 'A', count: 1 }, { id: 'A', count: 1 }] };
    const after = { leader: 'L', cards: [{ id: 'A', count: 2 }, { id: 'B', count: 2 }] };
    expect(deckListDiff(before, after)).toEqual({ leader: null, added: [], removed: [] });
  });

  it('marca a troca de Líder e trata a primeira versão como tudo novo', () => {
    expect(deckListDiff({ leader: 'L1', cards: [] }, { leader: 'L2', cards: [] }).leader).toEqual({ before: 'L1', after: 'L2' });
    const first = deckListDiff(null, { leader: 'L', cards: [{ id: 'X', count: 3 }] });
    expect(first.leader).toBeNull();
    expect(first.added).toEqual([{ id: 'X', before: 0, after: 3, delta: 3 }]);
  });
});
