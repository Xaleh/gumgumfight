// Erratas oficiais (docs/rules/divergencias.md, DV-34): a tabela de src/errata.ts corrige o texto
// das cartas, uma vez só, e o leitor automático lê o texto corrigido.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyErrata, ERRATA } from '../src/errata';
import type { CardData } from '../src/types';

const DATA = join(__dirname, '../../../data/cards');
const repoCards: CardData[] = readdirSync(DATA)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(DATA, f), 'utf8')) as { cards: CardData[] }).cards);

const card = (id: string, text: string, extra: Partial<CardData> = {}): CardData => ({
  id,
  name: id,
  category: 'character',
  colors: ['red'],
  types: [],
  text,
  ...extra,
});

describe('tabela de erratas', () => {
  it('troca cada trecho antigo pelo novo e é idempotente', () => {
    for (const e of ERRATA) {
      for (const [from, to] of e.text ?? []) {
        const fixed = applyErrata(card(e.id, `Antes. ${from}. Depois.`));
        expect(fixed.text).toBe(`Antes. ${to}. Depois.`);
        expect(applyErrata(fixed)).toBe(fixed);
      }
      for (const [from, to] of e.types ?? []) {
        const fixed = applyErrata(card(e.id, '', { types: ['Outro', from] }));
        expect(fixed.types).toEqual(to ? ['Outro', to] : ['Outro']);
        expect(applyErrata(fixed)).toBe(fixed);
      }
    }
  });

  it('carta sem errata (ou já corrigida na fonte) volta igual', () => {
    const c = card('OP99-001', 'Draw 1 card.');
    expect(applyErrata(c)).toBe(c);
    const fixed = card('ST02-013', '[DON!! x1] [End of Your Turn] Set this Character as active.');
    expect(applyErrata(fixed)).toBe(fixed);
  });

  it('os dados de data/cards já trazem o texto corrigido', () => {
    for (const c of repoCards) expect(applyErrata(c)).toBe(c);
    expect(repoCards.find((c) => c.id === 'OP02-002')?.text).toContain('any of your Characters is given a DON!! card');
  });
});

describe('o leitor automático lê o texto corrigido', () => {
  const def = (c: CardData) => buildCardDef(c);

  it('Garp OP02-002 e Magellan OP02-071 continuam automáticos com a nova redação', () => {
    const garp = def(card('OP02-002', "[Your Turn] When this Leader or 1 of your Characters is given a DON!! card, give up to 1 of your opponent's Characters with a cost of 7 or less -1 cost during this turn.", { category: 'leader' }));
    expect(garp.manual).toBe(false);
    expect(garp.abilities[0]).toMatchObject({ timing: 'event', event: { kind: 'donGiven' } });
    const magellan = def(card('OP02-071', '[Your Turn] [Once Per Turn] When a DON!! card on your field is returned to your DON!! deck, this Leader gains +1000 power during this turn.', { category: 'leader' }));
    expect(magellan.manual).toBe(false);
    expect(magellan.abilities[0]).toMatchObject({ timing: 'event', event: { kind: 'donReturned' } });
  });

  it('Nami OP01-016 busca qualquer carta {Straw Hat Crew}, não só Personagem', () => {
    const nami = def(card('OP01-016', '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 {Straw Hat Crew} type Character card other than [Nami] and add it to your hand. Then, place the rest at the bottom of your deck in any order.'));
    const search = nami.abilities[0].steps[0] as { do: string; filter: { category?: string } };
    expect(search.do).toBe('search');
    expect(search.filter.category).toBeUndefined();
  });

  it('"If there is a Character with a cost of 8 or more" (ST14-014, OP16-081) olha os dois lados', () => {
    const rifle = def(card('ST14-014', '[Counter] If you have a Character with a cost of 8 or more, up to 1 of your Leader or Character cards gains +3000 power during this battle.', { category: 'event' }));
    expect(rifle.abilities[0].steps[0].if).toEqual({ anyCharacterCost: { min: 8 } });
    const otama = def(card('OP16-081', "[Activate: Main] You may rest this Character: If you have a Character with a cost of 8 or more, give up to 1 of your opponent's Characters 2000 power during this turn."));
    expect(otama.abilities[0].steps[0]).toMatchObject({ do: 'power', amount: -2000, if: { anyCharacterCost: { min: 8 } } });
  });

  it('o [Counter] de Go All the Way to the Top!! (OP13-077) vale durante a batalha', () => {
    const go = def(card('OP13-077', '[Counter] Your Leader gains +3000 power during this turn.', { category: 'event' }));
    expect(go.abilities[0].steps[0]).toMatchObject({ do: 'power', duration: 'battle' });
  });

  it('tipos corrigidos: Hyouzou OP06-034 é {Merfolk}; Law OP14-009 deixa de ser Seven Warlords', () => {
    expect(applyErrata(card('OP06-034', '', { types: ['Fish-Man'] })).types).toEqual(['Merfolk']);
    expect(applyErrata(card('OP14-009', '', { types: ['Heart Pirates', 'Supernovas', 'The Seven Warlords of the Sea'] })).types).toEqual(['Heart Pirates', 'Supernovas']);
  });
});
