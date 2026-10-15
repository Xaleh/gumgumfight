import { describe, expect, it } from 'vitest';
import { deckOfPlayer, formatDeckList, parseDeckList, validateDeck } from '../src/deck';
import { createGame } from '../src/engine';
import type { CardData, DeckList, GameState } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards, kid, luffy } from './helpers';

const byId = new Map<string, CardData>(cards.map((c) => [c.id, c]));

describe('validação de deck', () => {
  it('os decks iniciais são válidos', () => {
    expect(validateDeck(luffy, byId).valid).toBe(true);
    expect(validateDeck(kid, byId).valid).toBe(true);
  });

  it('exige 50 cartas', () => {
    const d: DeckList = { ...luffy, cards: luffy.cards.slice(1) };
    const r = validateDeck(d, byId);
    expect(r.valid).toBe(false);
    expect(r.issues[0].message).toMatch(/faltam 4/);
    expect(r.issues[0]).toMatchObject({ code: 'rules.tooFewCards', params: { total: 46, missing: 4 } });
  });

  it('no máximo 4 cópias', () => {
    const d: DeckList = { ...luffy, cards: [{ id: 'ST01-002', count: 5 }, ...luffy.cards.slice(1)] };
    expect(validateDeck(d, byId).issues.some((i) => /máximo de 4/.test(i.message))).toBe(true);
  });

  it('cartas precisam ter a cor do Líder', () => {
    const d: DeckList = { ...luffy, cards: [...luffy.cards.slice(1), { id: 'ST02-004', count: 4 }] };
    const r = validateDeck(d, byId);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.cardId === 'ST02-004' && /cor do Líder/.test(i.message))).toBe(true);
  });

  it('Líder não entra no deck e deck sem Líder é inválido', () => {
    const r = validateDeck({ id: 'x', name: 'x', leader: '', cards: [{ id: 'ST02-001', count: 1 }] }, byId);
    expect(r.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['Escolha um Líder.', expect.stringMatching(/é um Líder e não pode ir no deck/)]),
    );
  });

  it('avisa sobre efeitos não automatizados sem invalidar', () => {
    const extra: CardData = { id: 'ZZ01-001', name: 'Nova', category: 'character', colors: ['red'], cost: 1, power: 1000, types: [], text: '[On Play] Something new.' };
    const map = new Map(byId).set(extra.id, extra);
    const d: DeckList = { ...luffy, cards: [...luffy.cards.slice(1), { id: 'ZZ01-001', count: 4 }] };
    const r = validateDeck(d, map);
    expect(r.valid).toBe(true);
    expect(r.unscripted).toEqual(['ZZ01-001']);
    expect(r.issues.some((i) => i.level === 'warning')).toBe(true);
  });
});

describe('lista em texto', () => {
  it('ida e volta', () => {
    const text = formatDeckList(luffy);
    expect(text.split('\n')[0]).toBe('1xST01-001');
    const parsed = parseDeckList(text, byId);
    expect(parsed.errors).toEqual([]);
    expect(parsed.leader).toBe('ST01-001');
    expect(parsed.cards).toEqual(luffy.cards);
  });

  it('aceita formatos variados e soma repetidas', () => {
    const r = parseDeckList('# meu deck\n1xST01-001\n4 st01-002\nST01-013 x2\n2xST01-013\nlixo', byId);
    expect(r.leader).toBe('ST01-001');
    expect(r.cards).toEqual([
      { id: 'ST01-002', count: 4 },
      { id: 'ST01-013', count: 4 },
    ]);
    expect(r.errors).toEqual(['Linha não reconhecida: "lixo"']);
    expect(r.errorDetails).toEqual([{ message: 'Linha não reconhecida: "lixo"', code: 'rules.listBadLine', params: { line: 'lixo' } }]);
  });

  it('aponta cartas que não existem no banco', () => {
    expect(parseDeckList('4xOP99-999', byId).errors).toEqual(['Carta não encontrada no banco: OP99-999']);
  });
});

describe('deckOfPlayer: a lista refeita a partir das cartas da partida', () => {
  const byIdCards = cards;
  it('com a partida encerrada, a visão do oponente traz a lista inteira', () => {
    const state = createGame({ seed: 7, players: [{ name: 'A', deck: luffy }, { name: 'B', deck: kid }], cards: byIdCards });
    // No estado completo, as duas listas batem com os decks de origem (ordem por número).
    const sorted = (d: DeckList) => [...d.cards].sort((a, b) => a.id.localeCompare(b.id));
    expect(deckOfPlayer(state, 0)).toEqual({ leader: luffy.leader, cards: sorted(luffy) });
    expect(deckOfPlayer(state, 1)).toEqual({ leader: kid.leader, cards: sorted(kid) });
    // Em andamento, a visão de A esconde o deck e a mão de B (e o próprio deck de A, virado para baixo): sem lista.
    const aliases = createAliases(state, () => Math.random().toString(36).slice(2));
    expect(deckOfPlayer(viewFor(state, 0, aliases), 1)).toBeNull();
    expect(deckOfPlayer(viewFor(state, 0, aliases), 0)).toBeNull();
    // Encerrada: tudo visível, inclusive para quem assiste.
    const over: GameState = { ...state, phase: 'gameover', winner: 0 };
    expect(deckOfPlayer(viewFor(over, 0, aliases), 1)).toEqual({ leader: kid.leader, cards: sorted(kid) });
    expect(deckOfPlayer(viewFor(over, null, aliases), 1)).toEqual({ leader: kid.leader, cards: sorted(kid) });
    // Em texto, no formato do construtor.
    expect(formatDeckList(deckOfPlayer(over, 1)!)).toMatch(/^1xST02-001\n4x/);
  });
});
