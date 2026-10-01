import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCardDef, hasType } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb, upsertCards, upsertTranslations } from '../src/db';
import { mapApiResponse, normalizeSetId, setEndpoint } from '../src/optcgapi';
import { seed } from '../src/seed';

const sample = JSON.parse(readFileSync(join(__dirname, 'fixtures/optcgapi-sample.json'), 'utf8'));

describe('mapeamento da optcgapi', () => {
  const { cards, ignored } = mapApiResponse(sample);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

  it('remove artes alternativas duplicadas e ignora DON!!', () => {
    expect(cards.map((c) => c.id).sort()).toEqual(['ST01-001', 'ST01-006', 'ST01-013', 'ST01-015']);
    expect(ignored).toBe(1);
    expect(byId['ST01-001'].imageUrl).toBe('https://example.test/ST01-001.png');
    expect(byId['ST01-001'].name).toBe('Monkey.D.Luffy');
  });

  it('mapeia campos numéricos, líder e counter', () => {
    expect(byId['ST01-001']).toMatchObject({ category: 'leader', life: 5, power: 5000, cost: undefined, colors: ['red'] });
    expect(byId['ST01-013'].counter).toBeUndefined();
    expect(byId['ST01-006'].counter).toBe(1000);
    expect(byId['ST01-015'].cost).toBe(4);
  });

  it('separa o [Trigger] embutido no texto e converte <br>', () => {
    expect(byId['ST01-015'].text).toBe("[Main] K.O. up to 1 of your opponent's Characters with 6000 power or less.");
    expect(byId['ST01-015'].trigger).toBe("Activate this card's [Main] effect.");
  });

  it('tipos separados por espaço ainda funcionam no motor', () => {
    expect(hasType(buildCardDef(byId['ST01-013']), 'Straw Hat Crew')).toBe(true);
    expect(hasType(buildCardDef(byId['ST01-015']), 'Straw Hat Crew')).toBe(true);
    expect(hasType(buildCardDef(byId['ST01-006']), 'Hat Crew S')).toBe(false);
  });

  it('palavras-chave vindas do texto', () => {
    expect(buildCardDef({ ...byId['ST01-006'], id: 'X-1' }).keywords).toEqual(['blocker']);
  });

  it('monta as URLs dos endpoints', () => {
    expect(normalizeSetId('st01')).toBe('ST-01');
    expect(setEndpoint('https://optcgapi.com/api', 'ST01')).toBe('https://optcgapi.com/api/decks/ST-01/');
    expect(setEndpoint('https://optcgapi.com/api', 'OP-05')).toBe('https://optcgapi.com/api/sets/OP-05/');
  });
});

describe('API', () => {
  function setup(cardImages: boolean) {
    const db = openDb(':memory:');
    seed(db);
    const { cards, raw } = mapApiResponse(sample);
    upsertCards(db, cards, { provisional: false, source: 'api:test', raw });
    return buildApp(db, { server: { cardImages } });
  }

  it('entrega tradução em português junto com a carta', async () => {
    const app = setup(true);
    const card = (await app.inject('/api/cards/ST01-015')).json();
    expect(card.provisional).toBe(false);
    expect(card.i18n.pt).toEqual({
      text: '[Principal] Nocauteie (K.O.) até 1 Personagem do oponente com 6000 de poder ou menos.',
      trigger: 'Ative o efeito [Principal] desta carta.',
      source: 'auto',
    });
    expect(card.imageUrl).toBe('https://example.test/ST01-015.png');
  });

  it('CARD_IMAGES=off remove as URLs de imagem de todas as respostas', async () => {
    const app = setup(false);
    expect((await app.inject('/api/config')).json()).toMatchObject({ cardImages: false });
    const deck = (await app.inject('/api/decks/st01-luffy')).json();
    expect(deck.cards.length).toBeGreaterThan(0);
    expect(deck.cards.some((c: { imageUrl?: string }) => c.imageUrl)).toBe(false);
    const all = (await app.inject('/api/cards')).json();
    expect(all.some((c: { imageUrl?: string }) => c.imageUrl)).toBe(false);
  });

  it('tradução manual tem prioridade', async () => {
    const db = openDb(':memory:');
    seed(db);
    upsertTranslations(db, 'pt', [{ id: 'ST01-013', text: 'Texto revisado.' }]);
    const app = buildApp(db, { server: { cardImages: true } });
    const card = (await app.inject('/api/cards/ST01-013')).json();
    expect(card.i18n.pt).toEqual({ text: 'Texto revisado.', source: 'manual' });
  });

  it('lista traduções pendentes', async () => {
    const db = openDb(':memory:');
    upsertCards(db, [{ id: 'T-1', name: 'X', category: 'event', colors: ['red'], types: [], text: '[Main] Swap the hands of both players.' }], {
      provisional: false,
      source: 't',
    });
    const pending = (await buildApp(db, { server: { cardImages: true } }).inject('/api/translations/pending')).json();
    expect(pending.map((p: { id: string }) => p.id)).toEqual(['T-1']);
  });
});
