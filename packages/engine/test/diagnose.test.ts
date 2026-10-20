import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { automationStatus, diagnoseCard, gapPattern, parseCard } from '../src/cards';
import type { CardData } from '../src/types';

const char = (id: string, text: string, trigger?: string): CardData => ({
  id,
  name: id,
  category: 'character',
  colors: ['red'],
  cost: 3,
  power: 4000,
  types: [],
  text,
  ...(trigger ? { trigger } : {}),
});

describe('diagnóstico do leitor (lacunas para o Dev)', () => {
  it('marca cada linha e diz onde o leitor parou', () => {
    const card = char('DG-001', "[On Play] Draw 1 card.\n[When Attacking] Give up to 1o of your opponent's Characters -1 cost during this turn.");
    const d = diagnoseCard(card);
    expect(d.status).toBe('partial');
    expect(d.lines.map((l) => l.ok)).toEqual([true, false]);
    expect(d.lines[1]).toMatchObject({
      stage: 'clause',
      fragment: "Give up to 1o of your opponent's Characters -1 cost during this turn",
      pattern: "Give up to No of your opponent's Characters -N cost during this turn",
    });
  });

  it('inclui o [Trigger] e a linha sem momento', () => {
    const d = diagnoseCard(char('DG-002', '[Blocker]\nThis Character gains +1000 power in a new way.', 'Do something unusual with this card.'));
    expect(d.status).toBe('manual');
    expect(d.lines.map((l) => [l.ok, l.stage])).toEqual([
      [false, 'static'],
      [false, 'clause'],
    ]);
    expect(d.lines[1].line).toBe('[Trigger] Do something unusual with this card.');
  });

  it('carta automática, com script ou sem efeito: nada a mostrar', () => {
    expect(diagnoseCard(char('DG-003', '[On Play] Draw 1 card.'))).toEqual({ status: 'auto', lines: [{ line: '[On Play] Draw 1 card.', ok: true }] });
    expect(diagnoseCard(char('DG-004', '[Blocker]')).lines).toEqual([]);
  });

  it('o padrão junta frases que só mudam número, nome, tipo, atributo e cor', () => {
    const a = gapPattern('Swap up to 2 of [Nami] and {Straw Hat Crew} type "Slash" red Characters with 5000 power or less');
    const b = gapPattern('Swap up to 1 of [Zoro] and {Navy} type "Strike" blue Characters with 10,000 power or less.');
    expect(a).toBe(b);
    expect(a).toBe('Swap up to N of [X] and {T} type "X" <color> Characters with N power or less');
    // Palavras-chave e momentos entre colchetes ficam.
    expect(gapPattern('gains [Blocker] and [DON!! x2] until [End of Your Turn]')).toBe('gains [Blocker] and [DON!! xN] until [End of Your Turn]');
  });

  it('as linhas recusadas são as mesmas que viram manuais na partida (base inteira e fixtures)', () => {
    const data = join(__dirname, '../../../data/cards');
    const fixtures = join(__dirname, 'fixtures');
    const all: CardData[] = [
      ...readdirSync(data).flatMap((f) => JSON.parse(readFileSync(join(data, f), 'utf8')).cards as CardData[]),
      ...readdirSync(fixtures).flatMap((f) => (JSON.parse(readFileSync(join(fixtures, f), 'utf8')).cards ?? []) as CardData[]),
    ].filter((c) => c?.id && c.category);
    for (const c of all) {
      const d = diagnoseCard(c);
      expect(d.status).toBe(automationStatus(c));
      if (d.status === 'scripted' || d.status === 'vanilla') continue;
      const refused = d.lines.filter((l) => !l.ok).map((l) => l.line);
      expect(refused, c.id).toEqual(parseCard(c).unparsed);
    }
  });
});
