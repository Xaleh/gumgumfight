// Nomes e tipos das cartas como na lista oficial (src/source-fixes.ts): a optcgapi corta e
// formata nomes e tipos de outro jeito, e os efeitos que citam nomes deixam de achar as cartas.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { hasName, hasType, matchesFilter } from '../src/engine';
import { fixCard } from '../src/errata';
import { applySourceFixes, SOURCE_FIXES } from '../src/source-fixes';
import type { CardData } from '../src/types';

const DATA = join(__dirname, '../../../data/cards');
const repoCards: CardData[] = readdirSync(DATA)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(DATA, f), 'utf8')) as { cards: CardData[] }).cards);

/** A carta como a optcgapi a entrega. */
const fromApi = (id: string, name: string, types: string[], category: CardData['category'] = 'character'): CardData => ({
  id,
  name,
  category,
  colors: ['blue'],
  types,
  text: '',
});

describe('tabela de correções da fonte', () => {
  it('cada entrada põe o nome e os tipos oficiais, e aplicar de novo não muda nada', () => {
    for (const [id, fix] of Object.entries(SOURCE_FIXES)) {
      const fixed = applySourceFixes(fromApi(id, 'Nome da API', ['Tipo da API']));
      expect(fixed.name).toBe(fix.name ?? 'Nome da API');
      expect(fixed.types).toEqual(fix.types ?? ['Tipo da API']);
      expect(applySourceFixes(fixed)).toBe(fixed);
    }
  });

  it('carta sem correção volta igual', () => {
    const c = fromApi('OP99-001', 'Qualquer', ['Navy']);
    expect(applySourceFixes(c)).toBe(c);
  });

  it('os dados de data/cards já estão corrigidos', () => {
    for (const c of repoCards) expect(fixCard(c)).toBe(c);
    expect(repoCards.find((c) => c.id === 'ST14-014')).toMatchObject({ name: 'Gum-Gum Giant Rifle', types: ['Straw Hat Crew'] });
  });
});

describe('efeitos que citam nomes e tipos voltam a achar as cartas', () => {
  it('[Mr.3(Galdino)] (OP16-040, OP09-056) acha os Mr.3 que a API chama de "Mr.3 (Galdino)"', () => {
    for (const id of ['OP01-085', 'OP02-065', 'OP04-070']) {
      const def = buildCardDef(fromApi(id, 'Mr.3 (Galdino)', ['Baroque Works']));
      expect(hasName(def, 'Mr.3(Galdino)')).toBe(true);
      // "other than [Mr.3(Galdino)]": a busca do OP09-056 não pode pegar outro Mr.3.
      expect(matchesFilter(def, { excludeName: 'Mr.3(Galdino)' })).toBe(false);
    }
  });

  it('[Who\'s.Who] e [Jewelry Bonney] (OP04-051, EB04-056) acham OP08-091 e PRB02-004', () => {
    expect(hasName(buildCardDef(fromApi('OP08-091', 'Whos.Who', ['Animal Kingdom Pirates'])), "Who's.Who")).toBe(true);
    expect(hasName(buildCardDef(fromApi('PRB02-004', 'Jewelry Bonney -PRB02-004', ['Supernovas'])), 'Jewelry Bonney')).toBe(true);
  });

  it('tipos: Franky OP11-012 é {Straw Hat Crew}; Linlin OP17-099 é {The Four Emperors}; Gum-Gum Giant Rifle é {Straw Hat Crew}', () => {
    const franky = buildCardDef(fromApi('OP11-012', 'Franky', ['Navy', 'SWORD']));
    expect(hasType(franky, 'Straw Hat Crew')).toBe(true);
    expect(hasType(franky, 'Navy')).toBe(false);
    expect(hasType(buildCardDef(fromApi('OP17-099', 'Charlotte Linlin', ['Special'])), 'The Four Emperors')).toBe(true);
    expect(hasType(buildCardDef(fromApi('ST14-014', 'Gum-Gum Giant Rifl', ['Straw Hat Cre'], 'event')), 'Straw Hat Crew')).toBe(true);
  });
});
