import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { HttpError } from '../src/card-import';
import { type DB, openDb, pendingSpoilers, upsertCards } from '../src/db';
import { seedSpoilers, type SpoilerFile } from '../src/seed';
import { setCodes, syncSpoilers } from '../src/spoiler-sync';

const BASE = 'https://api.test/api';

const spoilerFile: SpoilerFile = {
  set: 'OP18',
  source: 'optcgleaks.com',
  url: 'https://optcgleaks.com/',
  cards: [
    {
      id: 'OP18-001',
      name: 'Karoo',
      category: 'character',
      colors: ['red'],
      cost: 1,
      power: 2000,
      counter: 1000,
      types: ['Alabasta'],
      text: '[On Play] Draw 1 card.',
      imageUrl: 'https://leaks.test/OP18-001.webp',
    },
    { id: 'op18-022', name: 'Monkey.D.Luffy', category: 'leader', colors: ['green'], life: 5, power: 5000, types: [], text: '' },
    { id: 'EB05-001', name: 'Nami', category: 'leader', colors: ['blue'], life: 5, power: 5000, types: [], text: '' },
    { id: 'OP18', name: 'Sem número', category: 'character' } as SpoilerFile['cards'][number],
  ],
};

function setup(file: SpoilerFile = spoilerFile): { db: DB; dir: string } {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'spoilers-'));
  writeFileSync(join(dir, 'op18.json'), JSON.stringify(file));
  return { db, dir };
}

/** Linha no formato da optcgapi. */
const apiRow = (id: string, name: string, setId: string) => ({
  card_set_id: id,
  card_image_id: id,
  card_name: name,
  set_id: setId,
  card_type: 'Character',
  card_color: 'Red',
  card_cost: '1',
  card_power: '2000',
  counter_amount: '1000',
  sub_types: 'Alabasta',
  card_text: '[On Play] Draw 1 card.',
  card_image: `https://optcgapi.test/${id}.jpg`,
});

/** API falsa: rota -> resposta; o resto responde 404. */
function fakeApi(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url.replace(BASE, ''));
    const body = routes[url.replace(BASE, '')];
    if (body === undefined) throw new HttpError(url, 404, 'Not Found');
    return body;
  };
  return { fetchJson, calls };
}

describe('cartas de spoiler', () => {
  it('grava as cartas como provisórias, com a fonte, e recusa as sem número', async () => {
    const { db, dir } = setup();
    const r = seedSpoilers(db, dir);
    expect(r).toMatchObject({ written: 3, official: 0, removed: 0, invalid: ['op18.json: OP18'] });
    expect(pendingSpoilers(db)).toEqual(['EB05-001', 'OP18-001', 'OP18-022']);

    const card = (await buildApp(db, { server: { cardImages: true } }).inject('/api/cards/OP18-001')).json();
    expect(card).toMatchObject({
      provisional: true,
      set: 'OP18',
      imageUrl: 'https://leaks.test/OP18-001.webp',
      spoiler: { source: 'optcgleaks.com', url: 'https://optcgleaks.com/' },
    });
    expect(card.i18n.pt.text).toBeTruthy();
  });

  it('nunca sobrescreve uma carta que já veio da API', () => {
    const { db, dir } = setup();
    upsertCards(db, [{ id: 'OP18-001', name: 'Karoo', category: 'character', colors: ['red'], types: [], text: 'oficial' }], {
      provisional: false,
      source: 'api:test',
    });
    expect(seedSpoilers(db, dir)).toMatchObject({ written: 2, official: 1 });
    expect(pendingSpoilers(db)).not.toContain('OP18-001');
  });

  it('remove as cartas que saíram do arquivo', () => {
    const { db, dir } = setup();
    seedSpoilers(db, dir);
    writeFileSync(join(dir, 'op18.json'), JSON.stringify({ ...spoilerFile, cards: spoilerFile.cards.slice(0, 1) }));
    expect(seedSpoilers(db, dir).removed).toBe(2);
    expect(pendingSpoilers(db)).toEqual(['OP18-001']);
  });

  it('separa os ids de coleção da API', () => {
    expect(setCodes('OP-18')).toEqual(['OP18']);
    expect(setCodes('OP14-EB04')).toEqual(['OP14', 'EB04']);
    expect(setCodes('ST-29')).toEqual(['ST29']);
  });
});

describe('sincronização com a API oficial', () => {
  it('coleção ainda não publicada: nada muda e o 404 não conta como erro', async () => {
    const { db, dir } = setup();
    seedSpoilers(db, dir);
    const api = fakeApi({ '/allSets/': [{ set_id: 'OP-17' }], '/allDecks/': [] });
    const r = await syncSpoilers(db, { base: BASE, fetchJson: api.fetchJson });
    expect(r).toMatchObject({ pending: ['EB05', 'OP18'], official: [], imported: 0, errors: [] });
    expect(api.calls).toEqual(['/allSets/', '/allDecks/', '/sets/card/EB05-001/', '/sets/card/OP18-001/']);
  });

  it('coleção publicada (mesmo junto com outra): importa e troca imagem e dados pelos oficiais', async () => {
    const { db, dir } = setup();
    seedSpoilers(db, dir);
    const api = fakeApi({
      '/allSets/': [{ set_id: 'OP-17' }, { set_id: 'OP18-EB05' }],
      '/allDecks/': [],
      '/sets/OP18-EB05/': [
        apiRow('OP18-001', 'Karoo', 'OP18-EB05'),
        apiRow('OP18-002', 'Carta sem spoiler', 'OP18-EB05'),
        apiRow('EB05-001', 'Nami', 'OP18-EB05'),
      ],
    });
    const r = await syncSpoilers(db, { base: BASE, fetchJson: api.fetchJson });
    expect(r).toMatchObject({ official: ['EB05-001', 'OP18-001'], imported: 3, errors: [] });
    expect(pendingSpoilers(db)).toEqual(['OP18-022']);

    const card = (await buildApp(db, { server: { cardImages: true } }).inject('/api/cards/OP18-001')).json();
    expect(card.provisional).toBe(false);
    expect(card.spoiler).toBeUndefined();
    expect(card.imageUrl).toBe('https://optcgapi.test/OP18-001.jpg');

    // Reiniciar o servidor (seed de novo) não traz o spoiler de volta.
    expect(seedSpoilers(db, dir)).toMatchObject({ official: 2, removed: 0 });
    expect(pendingSpoilers(db)).toEqual(['OP18-022']);
  });

  it('coleção fora das listas mas com cartas já publicadas: busca carta por carta', async () => {
    const { db, dir } = setup();
    seedSpoilers(db, dir);
    const api = fakeApi({
      '/allSets/': [],
      '/allDecks/': [],
      '/sets/card/OP18-001/': [apiRow('OP18-001', 'Karoo', 'OP-18')],
    });
    const r = await syncSpoilers(db, { base: BASE, fetchJson: api.fetchJson });
    expect(r.official).toEqual(['OP18-001']);
    expect(api.calls).toContain('/sets/card/OP18-022/');
    expect(pendingSpoilers(db)).toEqual(['EB05-001', 'OP18-022']);
  });

  it('falhas de rede são registradas sem derrubar a sincronização', async () => {
    const { db, dir } = setup();
    seedSpoilers(db, dir);
    const r = await syncSpoilers(db, {
      base: BASE,
      fetchJson: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(r.official).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('sem spoilers pendentes, não consulta a API', async () => {
    const api = fakeApi({});
    const r = await syncSpoilers(openDb(':memory:'), { base: BASE, fetchJson: api.fetchJson });
    expect(r.pending).toEqual([]);
    expect(api.calls).toEqual([]);
  });
});
