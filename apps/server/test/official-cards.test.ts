import { describe, expect, it } from 'vitest';
import type { CardData } from '@gumgum/engine';
import { diffWithOfficial, mergeOfficial, officialSeries, parseOfficialCardList } from '../src/official-cards';

const entry = (id: string, name: string, types: string, attribute?: string) => `
  <dl class="modalCol" id="${id}">
    <dt><div class="infoCol"><span>${id}</span></div><div class="cardName">${name}</div></dt>
    <dd><div class="backCol">${attribute ? `<div class="attribute"><h3>Attribute</h3><img src="/images/cardlist/attribute/ico_type02.png?v" alt="${attribute}"><i>${attribute}</i></div>` : ''}<div class="feature"><h3>Type</h3>${types}</div></div></dd>
  </dl>`;

describe('lista oficial de cartas', () => {
  it('lê as coleções e as cartas (nome, tipos, entidades HTML e o tipo em japonês da ST11-005)', () => {
    const page = `
      <select><option value="569014" >ST-14</option><option value="569011" >ST-11</option></select>
      ${entry('ST14-014', 'Gum-Gum Giant Rifle', 'Straw Hat Crew')}
      ${entry('OP08-091', 'Who&#039;s.Who', 'Animal Kingdom Pirates')}
      ${entry('ST11-005', 'I&#039;m invincible', '音楽/FILM')}
      ${entry('OP01-001_p1', 'Roronoa Zoro (alternativa)', 'Supernovas')}`;
    expect(officialSeries(page)).toEqual(['569014', '569011']);
    const cards = parseOfficialCardList(page);
    expect(cards.get('ST14-014')).toEqual({ name: 'Gum-Gum Giant Rifle', types: ['Straw Hat Crew'] });
    expect(cards.get('OP08-091')?.name).toBe("Who's.Who");
    expect(cards.get('ST11-005')?.types).toEqual(['Music', 'FILM']);
    expect(cards.get('OP01-001')).toMatchObject({ name: 'Roronoa Zoro (alternativa)', variant: true });
  });

  it('a versão normal vence reimpressões de outras páginas (ST23-004 x ST23-004_r1)', () => {
    const reprint = parseOfficialCardList(entry('ST23-004_r1', 'Monkey.D.Luffy', 'Animal/Straw Hat Crew'));
    const original = parseOfficialCardList(entry('ST23-004', 'Monkey.D.Luffy', 'FILM/Supernovas/Straw Hat Crew'));
    expect(mergeOfficial([reprint, original]).get('ST23-004')?.types).toEqual(['FILM', 'Supernovas', 'Straw Hat Crew']);
  });

  it('aponta nome e tipos diferentes (ordem dos tipos e aspas curvas não contam)', () => {
    const official = parseOfficialCardList(entry('ST14-014', 'Gum-Gum Giant Rifle', 'Straw Hat Crew') + entry('OP02-035', 'Trafalgar Law', 'FILM/Supernovas/Heart Pirates'));
    const api = (id: string, name: string, types: string[]): CardData => ({ id, name, category: 'event', colors: ['red'], types, text: '' });
    expect(diffWithOfficial([api('ST14-014', 'Gum-Gum Giant Rifl', ['Straw Hat Cre']), api('OP02-035', 'Trafalgar Law', ['Heart Pirates', 'Supernovas', 'FILM'])], official)).toEqual([
      { id: 'ST14-014', name: { api: 'Gum-Gum Giant Rifl', official: 'Gum-Gum Giant Rifle' }, types: { api: ['Straw Hat Cre'], official: ['Straw Hat Crew'] } },
    ]);
  });

  it('lê o atributo e aponta a carta que a API traz sem atributo (OP15-023 Arlong, card 70 do Trello)', () => {
    const official = parseOfficialCardList(entry('OP15-023', 'Arlong', 'Fish-Man/East Blue/Arlong Pirates', 'Slash') + entry('OP15-001', 'Um Evento', 'Navy'));
    expect(official.get('OP15-023')).toEqual({ name: 'Arlong', types: ['Fish-Man', 'East Blue', 'Arlong Pirates'], attribute: 'Slash' });
    expect(official.get('OP15-001')?.attribute).toBeUndefined();
    const api = (id: string, attributes: string[]): CardData => ({ id, name: 'Arlong', category: 'character', colors: ['green'], types: ['Fish-Man', 'East Blue', 'Arlong Pirates'], attributes, text: '' });
    expect(diffWithOfficial([api('OP15-023', [])], official)).toEqual([{ id: 'OP15-023', attributes: { api: [], official: ['Slash'] } }]);
    expect(diffWithOfficial([api('OP15-023', ['Slash'])], official)).toEqual([]);
  });
});
