import { describe, expect, it } from 'vitest';
import { validateDeck } from '../src/deck';
import { cardBlock, cardLegality, formatIssues, legalFormats, spoilerCards, spoilerIssues, tournamentFormatLabel } from '../src/formats';
import type { CardData, DeckList } from '../src/types';
import { cards, luffy } from './helpers';

const byId = new Map<string, CardData>(cards.map((c) => [c.id, c]));
const NOW = new Date('2026-10-03T12:00:00Z');

describe('formatos (Standard e Extra Grand Battle)', () => {
  it('bloco ①: OP-01 a OP-04 e ST-01 a ST-09', () => {
    expect(cardBlock('OP01-001')).toBe(1);
    expect(cardBlock('OP04-119')).toBe(1);
    expect(cardBlock('ST09-001')).toBe(1);
    expect(cardBlock('ST10-002')).toBeNull();
    expect(cardBlock('OP05-001')).toBeNull();
    expect(cardBlock('EB01-001')).toBeNull();
  });

  it('cartas do bloco ① rotacionaram no Standard, mas valem no EGB', () => {
    expect(cardLegality('OP01-001', 'standard', NOW)).toBe('rotated');
    expect(cardLegality('ST01-012', 'standard', NOW)).toBe('rotated');
    expect(cardLegality('OP01-001', 'egb', NOW)).toBe('legal');
    expect(cardLegality('OP05-060', 'standard', NOW)).toBe('legal');
  });

  it('exceções oficiais do bloco ① continuam no Standard', () => {
    for (const id of ['OP01-016', 'OP01-120', 'OP02-013', 'OP03-122', 'OP04-083', 'ST01-011', 'OP04-096']) {
      expect(cardLegality(id, 'standard', NOW)).toBe('legal');
    }
  });

  it('cartas banidas não valem em nenhum formato', () => {
    for (const f of ['standard', 'egb'] as const) {
      expect(cardLegality('ST10-001', f, NOW)).toBe('banned');
      expect(cardLegality('OP06-047', f, NOW)).toBe('banned');
      // Banida e de bloco ①: o motivo mostrado é a proibição.
      expect(cardLegality('OP03-040', f, NOW)).toBe('banned');
    }
  });

  it('proibição com data marcada só vale a partir da data', () => {
    expect(cardLegality('OP14-020', 'egb', new Date('2026-10-11T12:00:00Z'))).toBe('legal');
    expect(cardLegality('OP14-020', 'egb', new Date('2026-10-12T12:00:00Z'))).toBe('banned');
  });

  it('pares proibidos não podem estar juntos (Líder incluso)', () => {
    const deck = { leader: 'OP11-040', cards: [{ id: 'OP11-067', count: 4 }] };
    expect(formatIssues(deck, 'egb', NOW).map((i) => i.message)).toEqual([expect.stringMatching(/OP11-040 e OP11-067/)]);
    expect(formatIssues({ leader: 'OP11-040', cards: [{ id: 'OP11-070', count: 4 }] }, 'egb', NOW)).toEqual([]);
  });

  it('o deck do ST-01 só vale no EGB', () => {
    expect(legalFormats(luffy, NOW)).toEqual(['egb']);
    expect(validateDeck(luffy, byId).valid).toBe(true);
    expect(validateDeck(luffy, byId, { format: 'egb', now: NOW }).valid).toBe(true);
    const std = validateDeck(luffy, byId, { format: 'standard', now: NOW });
    expect(std.valid).toBe(false);
    expect(std.issues.find((i) => i.cardId === 'ST01-001')?.message).toMatch(/rotacionou: não vale no Standard/);
    // ST01-011 (Brook) é exceção: não aparece entre os problemas.
    expect(std.issues.some((i) => i.cardId === 'ST01-011')).toBe(false);
  });

  it('carta banida invalida o deck nos dois formatos', () => {
    const d: DeckList = { ...luffy, cards: [...luffy.cards.slice(1), { id: 'ST10-001', count: 1 }] };
    for (const format of ['standard', 'egb'] as const) {
      const r = formatIssues(d, format, NOW);
      expect(r.some((i) => i.cardId === 'ST10-001' && /banida/.test(i.message))).toBe(true);
    }
  });
});

describe('spoilers (cartas ainda não lançadas)', () => {
  const deck = { leader: 'OP99-001', cards: [{ id: 'ST01-002', count: 4 }, { id: 'OP99-010', count: 4 }, { id: 'OP99-011', count: 4 }, { id: 'OP99-012', count: 4 }] };
  const spoiler = { spoiler: { source: 'teste' } };
  const pool = new Map<string, Pick<CardData, 'spoiler'>>([
    ['OP99-001', spoiler],
    ['ST01-002', {}],
    ['OP99-010', spoiler],
    ['OP99-011', spoiler],
    ['OP99-012', spoiler],
  ]);

  it('não são de formato nenhum: Standard e EGB só olham banidas e rotação', () => {
    expect(formatIssues(deck, 'egb', NOW)).toEqual([]);
  });

  it('lista as cartas de spoiler (Líder incluso) num aviso só', () => {
    expect(spoilerCards(deck, pool)).toEqual(['OP99-001', 'OP99-010', 'OP99-011', 'OP99-012']);
    const [issue, ...rest] = spoilerIssues(deck, pool);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ code: 'rules.spoiler', params: { n: 4, ids: 'OP99-001, OP99-010, OP99-011…' }, cardId: 'OP99-001' });
    expect(issue.message).toMatch(/^Cartas ainda não lançadas \(spoilers\): OP99-001, OP99-010, OP99-011…\. /);
    expect(spoilerIssues({ leader: 'ST01-002', cards: [] }, pool)).toEqual([]);
  });

  it('nome do formato de torneio com spoilers', () => {
    expect(tournamentFormatLabel({ format: 'egb', spoilers: true })).toBe('Todas as cartas + spoilers');
    expect(tournamentFormatLabel({ format: 'standard' })).toBe('Standard');
  });
});
