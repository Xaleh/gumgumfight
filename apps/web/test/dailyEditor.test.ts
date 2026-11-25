import { buildChallenge, type CardData, type DeckList, runChallenge } from '@gumgum/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCard, attackOptions, donUsed, draftProblems, emptyDraft, removeCard, setDeck, specOf, updateField, updateSide, usedCopies } from '../src/game/dailyEditor';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = ['st01', 'st03'].flatMap((s) => load(`cards/${s}.json`).cards);
const luffy: DeckList = load('decks/st01-luffy.json');
const croc: DeckList = load('decks/st03-crocodile.json');

describe('editor de desafios: rascunho', () => {
  it('monta o mesmo desafio "isca" do catálogo, e o motor monta a mesa', () => {
    let d = emptyDraft(101);
    d = setDeck(d, 0, 'st01-luffy');
    d = setDeck(d, 1, 'st03-crocodile');
    expect(draftProblems(d)).toEqual([]);
    d = addCard(d, 0, 'characters', 'ST01-013');
    d = addCard(d, 0, 'characters', 'ST01-003');
    d = updateSide(d, 0, { donActive: 2, lifeCount: 3 });
    d = addCard(d, 1, 'characters', 'ST03-008');
    d = addCard(d, 1, 'life', 'ST03-009');
    d = updateSide(d, 1, { donRested: 6 });
    const spec = specOf(d)!;
    expect(spec).toEqual({
      goal: 'lethal',
      level: 1,
      decks: ['st01-luffy', 'st03-crocodile'],
      seed: 101,
      revealHand: true,
      scenario: {
        turn: 7,
        active: 0,
        sides: [
          { characters: ['ST01-013', 'ST01-003'], life: 3, donActive: 2 },
          { characters: ['ST03-008'], life: ['ST03-009'], donRested: 6 },
        ],
      },
    });
    const start = buildChallenge({ seed: 101, cards, players: [{ name: 'a', deck: luffy }, { name: 'b', deck: croc }] }, { ...spec, id: 'x' });
    expect(start.players[1].characters).toHaveLength(1);
    expect(runChallenge(start, { ...spec, id: 'x' }, []).status).toBe('playing');
  });

  it('cópias usadas, Personagens com estado, DON!! e limites', () => {
    let d = setDeck(emptyDraft(1), 0, 'st01-luffy');
    for (let i = 0; i < 6; i++) d = addCard(d, 0, 'characters', 'ST01-013');
    expect(d.sides[0].characters).toHaveLength(5);
    d = addCard(d, 0, 'hand', 'ST01-013');
    expect(usedCopies(d.sides[0], 'ST01-013')).toBe(6);
    d = updateField(d, 0, 'characters', 1, { rested: true, don: 2, fresh: true });
    d = updateSide(d, 0, { donActive: 9 });
    expect(donUsed(d.sides[0])).toBe(11);
    d = setDeck(d, 1, 'st03-crocodile');
    expect(draftProblems(d)).toEqual(['don0']);
    expect(specOf(d)!.scenario.sides[0].characters![1]).toEqual({ id: 'ST01-013', rested: true, fresh: true, don: 2 });
    d = removeCard(d, 0, 'characters', 0);
    expect(d.sides[0].characters).toHaveLength(4);
    // Trocar o deck limpa as cartas postas.
    expect(setDeck(d, 0, 'st03-crocodile').sides[0].characters).toEqual([]);
  });

  it('o roteiro do "sobreviva" usa as cartas da mesa e perde o ataque quando a carta sai', () => {
    let d = { ...emptyDraft(1), goal: 'survive' as const };
    d = setDeck(setDeck(d, 0, 'st01-luffy'), 1, 'st03-crocodile');
    expect(draftProblems(d)).toEqual(['attacks']);
    d = addCard(d, 1, 'characters', 'ST03-012');
    d = addCard(d, 0, 'characters', 'ST01-006');
    expect(attackOptions(d)).toEqual({ attackers: ['leader', 'ST03-012'], targets: ['leader', 'ST01-006'] });
    d = { ...d, attacks: [{ attacker: 'ST03-012', target: 'leader' }, { attacker: 'leader', target: 'ST01-006' }] };
    const spec = specOf(d)!;
    expect(spec.scenario.active).toBe(1);
    expect(spec.revealHand).toBeUndefined();
    expect(spec.attacks).toHaveLength(2);
    d = removeCard(d, 1, 'characters', 0);
    expect(d.attacks).toEqual([{ attacker: 'leader', target: 'ST01-006' }]);
  });
});

describe('editor de desafios: editar, duplicar e prever a fila', () => {
  it('o rascunho de um desafio salvo volta ao mesmo desafio (todos os do catálogo)', async () => {
    const { DAILY_CATALOG } = await import('../../server/src/daily/catalog');
    const { draftFromSpec, specOf } = await import('../src/game/dailyEditor');
    for (const c of DAILY_CATALOG) {
      const { id: _id, solution: _s, wrong: _w, ...spec } = c;
      expect(specOf(draftFromSpec(spec, 'nota')), c.id).toEqual({ ...spec, level: spec.level ?? 1 });
    }
  });

  it('previsão dos dias da fila pula as datas fixas', async () => {
    const { forecastDays } = await import('../src/game/dailyEditor');
    expect(forecastDays('2026-12-30', 4, ['2026-12-31', '2027-01-02'])).toEqual(['2026-12-30', '2027-01-01', '2027-01-03', '2027-01-04']);
  });
});

describe('editor de desafios: quando a gravação deixa de valer', () => {
  it('dificuldade, nota e mão revelada não mexem na mesa; turno, cartas e semente mexem', async () => {
    const { addCard, boardKey, emptyDraft, setDeck } = await import('../src/game/dailyEditor');
    const d = setDeck(setDeck(emptyDraft(5), 0, 'st01-luffy'), 1, 'st03-crocodile');
    const k = boardKey(d);
    expect(boardKey({ ...d, level: 3, note: 'x', revealHand: false })).toBe(k);
    expect(boardKey({ ...d, turn: 8 })).not.toBe(k);
    expect(boardKey({ ...d, seed: 6 })).not.toBe(k);
    expect(boardKey(addCard(d, 0, 'hand', 'ST01-013'))).not.toBe(k);
  });
});
