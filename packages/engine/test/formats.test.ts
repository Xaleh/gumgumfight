import { describe, expect, it } from 'vitest';
import { validateDeck } from '../src/deck';
import {
  barredSpoilers,
  cardBlock,
  cardLegality,
  countsInStats,
  formatIssues,
  legalFormats,
  playMode,
  playModeLabel,
  spoilerCards,
  spoilerIssues,
  nextSpoilerSet,
  spoilerRule,
} from '../src/formats';
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
    // Bloco X (Super Parallel).
    for (const id of ['OP01-016', 'OP01-120', 'OP02-013', 'OP03-122', 'OP04-083']) {
      expect(cardLegality(id, 'standard', NOW)).toBe('legal');
    }
    // Tratadas como bloco ④: as 15 da lista da Bandai.
    const block4 = ['OP01-039', 'OP01-055', 'OP02-005', 'OP02-068', 'OP03-008', 'OP03-044', 'OP03-048', 'OP03-072', 'OP03-097', 'OP04-016', 'OP04-077', 'OP04-096', 'ST01-011', 'ST02-007', 'ST06-008'];
    for (const id of block4) {
      expect(cardLegality(id, 'standard', NOW)).toBe('legal');
    }
    // Reimpressão com o mesmo número não muda a vizinha: as demais cartas da coleção seguem rotacionadas.
    expect(cardLegality('OP02-004', 'standard', NOW)).toBe('rotated');
    expect(cardLegality('ST06-007', 'standard', NOW)).toBe('rotated');
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
    // A data é a de Brasília (UTC−3): 23h59 do dia 11 ainda vale; meia-noite do dia 12 já não.
    expect(cardLegality('OP14-020', 'egb', new Date('2026-10-12T02:59:00Z'))).toBe('legal');
    expect(cardLegality('OP14-020', 'egb', new Date('2026-10-12T03:00:00Z'))).toBe('banned');
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

  it('com spoilers (fora do Livre), só a próxima coleção a ser lançada; o Livre aceita todas', () => {
    const files = [
      { set: 'OP18', release: '2026-11-20' },
      { set: 'EB05', release: '2026-10-30' },
      { set: 'ST37' },
      { set: 'P' },
    ];
    expect(nextSpoilerSet(files, new Set(['EB05', 'OP18', 'ST37', 'P']))).toBe('EB05');
    // A EB05 saiu (as cartas viraram oficiais): a OP18 assume sozinha.
    expect(nextSpoilerSet(files, new Set(['OP18', 'ST37', 'P']))).toBe('OP18');
    // Sem data de lançamento (starters e promos) nunca é a próxima coleção.
    expect(nextSpoilerSet(files, new Set(['ST37', 'P']))).toBeNull();

    expect(spoilerRule({ format: 'egb', spoilers: false })).toBe('none');
    expect(spoilerRule({ format: 'standard', spoilers: true })).toBe('next');
    expect(spoilerRule({ format: 'free', spoilers: true })).toBe('all');
    expect(barredSpoilers(['EB05-001', 'OP18-001'], 'next', 'EB05')).toEqual(['OP18-001']);
    expect(barredSpoilers(['EB05-001', 'OP18-001'], 'next', null)).toEqual(['EB05-001', 'OP18-001']);
    expect(barredSpoilers(['EB05-001', 'OP18-001'], 'none')).toEqual(['EB05-001', 'OP18-001']);
    expect(barredSpoilers(['EB05-001', 'OP18-001'], 'all')).toEqual([]);

    const mixed = new Map<string, Pick<CardData, 'spoiler'>>([
      ['EB05-001', spoiler],
      ['OP18-001', spoiler],
    ]);
    const deck = { leader: 'EB05-001', cards: [{ id: 'OP18-001', count: 4 }] };
    const [issue, ...rest] = spoilerIssues(deck, mixed, 'next', 'EB05');
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ code: 'rules.spoilerNotNext', params: { n: 1, ids: 'OP18-001', set: 'EB05' }, cardId: 'OP18-001' });
    expect(spoilerIssues({ leader: 'EB05-001', cards: [] }, mixed, 'next', 'EB05')).toEqual([]);
    expect(spoilerIssues({ leader: 'EB05-001', cards: [] }, mixed)).toHaveLength(1);

    expect(playModeLabel({ format: 'standard', spoilers: true, spoilerSet: 'EB05' })).toBe('Standard + EB05');
    expect(playModeLabel({ format: 'standard', spoilers: true })).toBe('Standard + spoilers');
    expect(playModeLabel({ format: 'free', spoilers: true, spoilerSet: 'EB05' })).toBe('Livre (vale tudo)');
  });

  it('nome das regras de cartas (torneios, salas privadas e bot)', () => {
    const modes = [playMode('egb', false), playMode('egb', true), playMode('standard', false), playMode('standard', true), playMode('free', false)];
    expect(modes.map(playModeLabel)).toEqual([
      'Extra Grand Battle',
      'Extra Grand Battle + spoilers',
      'Standard',
      'Standard + spoilers',
      'Livre (vale tudo)',
    ]);
    expect(playModeLabel({ format: 'standard' })).toBe('Standard');
  });
});

describe('Livre (vale tudo)', () => {
  it('aceita cartas banidas, rotacionadas e pares proibidos', () => {
    expect(cardLegality('ST10-001', 'free', NOW)).toBe('legal');
    expect(cardLegality('OP01-001', 'free', NOW)).toBe('legal');
    expect(formatIssues({ leader: 'OP11-040', cards: [{ id: 'OP11-067', count: 4 }, { id: 'ST10-001', count: 1 }] }, 'free', NOW)).toEqual([]);
    const d: DeckList = { ...luffy, cards: [...luffy.cards.slice(1), { id: 'ST10-001', count: 1 }] };
    expect(validateDeck(d, byId, { format: 'free', now: NOW }).valid).toBe(validateDeck(d, byId).valid);
  });

  it('sempre aceita spoilers e não é formato oficial', () => {
    expect(playMode('free', false)).toEqual({ format: 'free', spoilers: true });
    expect(playMode('standard', true)).toEqual({ format: 'standard', spoilers: true });
    expect(legalFormats({ leader: 'ST10-001', cards: [] }, NOW)).toEqual([]);
  });
});

describe('estatísticas: só Standard e EGB puros', () => {
  it('fora o Livre, os torneios com spoilers e as partidas com carta de spoiler', () => {
    expect(countsInStats('standard')).toBe(true);
    expect(countsInStats('egb', { spoilerMode: false, spoilerCards: false })).toBe(true);
    expect(countsInStats('free')).toBe(false);
    expect(countsInStats('egb', { spoilerMode: true })).toBe(false);
    expect(countsInStats('standard', { spoilerCards: true })).toBe(false);
  });
});
