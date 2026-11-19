// Artes alternativas: importação (linhas da optcgapi), banco (sem perder artes na importação
// parcial) e decks (a escolha é gravada, limpa e chega à partida online).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { importBodies } from '../src/card-import';
import { getCards, openDb, syncSpoilerArts, upsertCards } from '../src/db';
import { playableDeck } from '../src/online/routes';
import { artId, mapApiResponse, printLabel } from '../src/optcgapi';
import { seed } from '../src/seed';

const luffy = JSON.parse(readFileSync(join(__dirname, '../../../data/decks/st01-luffy.json'), 'utf8'));
const ALICE = { 'x-deck-owner': 'alice-0123456789abcdef' };
const IMG = 'https://optcgapi.com/media/static/Card_Images';

const row = (o: Record<string, unknown>) => ({
  card_type: 'Character',
  card_color: 'Red',
  attribute: 'Ranged',
  sub_types: 'Straw Hat Crew',
  card_text: '[On Play] Draw 1 card.',
  rarity: 'R',
  card_cost: '1',
  card_power: '2000',
  counter_amount: 1000,
  ...o,
});

/** Linhas da Nami OP01-016 como vêm da API (original, paralela, reimpressão, promos). */
const nami = [
  row({ card_set_id: 'OP01-016', card_name: 'Nami', set_name: 'Romance Dawn', set_id: 'OP-01', card_image_id: 'OP01-016', card_image: `${IMG}/OP01-016.jpg` }),
  row({ card_set_id: 'OP01-016', card_name: 'Nami (Parallel)', set_name: 'Romance Dawn', set_id: 'OP-01', card_image_id: 'OP01-016_p1', card_image: `${IMG}/OP01-016_p1.jpg` }),
  row({ card_set_id: 'OP01-016', card_name: 'Nami (OP01-016) (Reprint)', set_name: 'Premium Booster -The Best-', set_id: 'PRB-01', card_image_id: 'OP01-016_p7', card_image: `${IMG}/OP01-016_p7.jpg` }),
  row({ card_set_id: 'OP01-016', card_name: 'Nami', set_name: 'Starter Deck 31', set_id: 'ST-31', card_image_id: 'OP01-016_r1', card_image: `${IMG}/OP01-016_r1.jpg` }),
  row({ card_set_id: 'OP01-016', card_name: 'Nami (Gift Collection 2023)', set_name: 'One Piece Promotion Cards', set_id: 'P', card_image_id: 'OP01-016_pr2', card_image: `${IMG}/Nami_Gift_Collection_2023_img.jpg` }),
  row({ card_set_id: 'OP01-016', card_name: 'Nami (OP01-016) (Manga)', set_name: 'Premium Booster -The Best-', set_id: 'PRB-01', card_image_id: 'OP01-016_p8', card_image: `${IMG}/OP01-016_p8.jpg` }),
  row({ card_set_id: 'OP01-016', card_name: 'Nami (SP)', set_name: 'Awakening of the New Era', set_id: 'OP-05', card_image_id: 'OP01-016_p2', card_image: `${IMG}/OP01-016_p2.jpg` }),
  // Sem imagem na fonte: fica de fora.
  row({ card_set_id: 'OP01-016', card_name: 'Nami (Tournament Pack)', set_name: 'One Piece Promotion Cards', set_id: 'P', card_image_id: 'OP01-016_pr1', card_image: null }),
];

describe('importação das artes alternativas', () => {
  it('junta as artes de todas as linhas, sem a original, as reimpressões e as sem imagem', () => {
    const { cards } = mapApiResponse(nami);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 'OP01-016', name: 'Nami', imageUrl: `${IMG}/OP01-016.jpg` });
    expect(cards[0].arts).toEqual([
      { id: 'OP01-016_p1', imageUrl: `${IMG}/OP01-016_p1.jpg`, label: 'Parallel' },
      { id: 'OP01-016_p2', imageUrl: `${IMG}/OP01-016_p2.jpg`, label: 'SP' },
      { id: 'OP01-016_p8', imageUrl: `${IMG}/OP01-016_p8.jpg`, label: 'Manga' },
      { id: 'Nami_Gift_Collection_2023_img', imageUrl: `${IMG}/Nami_Gift_Collection_2023_img.jpg`, label: 'Gift Collection 2023' },
    ]);
  });

  it('carta sem outra imagem não ganha lista de artes', () => {
    const { cards } = mapApiResponse([nami[0], nami[3]]);
    expect(cards[0].arts).toBeUndefined();
  });

  it('rótulo e identificador da arte', () => {
    expect(printLabel('Shanks (Parallel) (Manga) (Alternate Art)')).toBe('Parallel · Manga · Alternate Art');
    expect(printLabel('Monkey.D.Luffy (119) (SP) (Gold)')).toBe('SP · Gold');
    expect(printLabel('Nami - OP01-016 (Ultra Deck: The Three Captains)')).toBe('Ultra Deck: The Three Captains');
    expect(printLabel('Nami', 'Starter Deck 31: RED Monkey.D.Luffy')).toBe('Starter Deck 31: RED Monkey.D.Luffy');
    expect(printLabel('Shanks [Serial Number]', 'One Piece Promotion Cards')).toBe('Promo');
    expect(artId(`${IMG}/OP01-016_p1.jpg`)).toBe('OP01-016_p1');
    expect(artId(`${IMG}/Nami_-_OP01-016_Alternate_Art_img.jpg`)).toBe('Nami_-_OP01-016_Alternate_Art_img');
  });

  it('a importação parcial (sincronização dos spoilers) não apaga as artes já gravadas', () => {
    const db = openDb(':memory:');
    importBodies(db, [nami], 'teste');
    // Só a coleção nova, em que a carta foi reimpressa com outra arte.
    const newSet = row({ card_set_id: 'OP01-016', card_name: 'Nami (Full Art)', set_name: 'Nova', set_id: 'OP-20', card_image_id: 'OP01-016_p9', card_image: `${IMG}/OP01-016_p9.jpg` });
    importBodies(db, [[nami[0], newSet]], 'teste');
    expect(getCards(db, ['OP01-016'])[0].arts?.map((a) => a.id)).toEqual(['OP01-016_p9', 'OP01-016_p1', 'OP01-016_p2', 'OP01-016_p8', 'Nami_Gift_Collection_2023_img']);
  });
});

// A resposta de uma coleção só (o que a sincronização dos spoilers baixa no lançamento) traz as
// cartas antigas reimpressas nela com arte nova (SP) sem a impressão original: foi assim que a
// optcgapi publicou o OP-17 (EB04-007_p2, OP12-056_p2, ST27-005_p1…).
describe('carta antiga reimpressa numa coleção nova (SP)', () => {
  const zoro = [
    row({ card_set_id: 'EB04-007', card_name: 'Roronoa Zoro', set_name: 'Extra Booster 04', set_id: 'OP15-EB04', card_image_id: 'EB04-007', card_image: `${IMG}/EB04-007_TLnEm4i.jpg` }),
    row({ card_set_id: 'EB04-007', card_name: 'Roronoa Zoro (Alternate Art)', set_name: 'Extra Booster 04', set_id: 'OP15-EB04', card_image_id: 'EB04-007_p1', card_image: `${IMG}/EB04-007_p1.jpg` }),
  ];
  /** A coleção nova: uma carta dela, a SP do Zoro e a reimpressão da Nami com a mesma ilustração. */
  const newSet = [
    row({ card_set_id: 'OP17-001', card_name: 'Edward.Newgate', set_name: "The World's Strongest Warriors", set_id: 'OP-17', card_image_id: 'OP17-001', card_image: `${IMG}/OP17-001.jpg` }),
    row({ card_set_id: 'EB04-007', card_name: 'Roronoa Zoro (EB04-007) (SP)', set_name: "The World's Strongest Warriors", set_id: 'OP-17', card_image_id: 'EB04-007_p2', card_image: `${IMG}/EB04-007_p2.jpg`, card_text: '[On Play] Draw 2 cards.' }),
    row({ card_set_id: 'OP01-016', card_name: 'Nami', set_name: "The World's Strongest Warriors", set_id: 'OP-17', card_image_id: 'OP01-016_r2', card_image: `${IMG}/OP01-016_r2.jpg` }),
  ];

  it('a resposta marca as cartas que só vieram como impressão de outra coleção', () => {
    const { cards, artOnly } = mapApiResponse(newSet);
    expect([...artOnly].sort()).toEqual(['EB04-007', 'OP01-016']);
    // Todas as artes ficam em `arts` (a imagem que sobrou não é a da carta); a reimpressão não é arte.
    expect(cards.find((c) => c.id === 'EB04-007')!.arts).toEqual([{ id: 'EB04-007_p2', imageUrl: `${IMG}/EB04-007_p2.jpg`, label: 'SP' }]);
    expect(cards.find((c) => c.id === 'OP01-016')!.arts).toBeUndefined();
    // Com a impressão original na resposta (importação completa), nada é "só arte".
    expect(mapApiResponse([...zoro, ...nami, ...newSet]).artOnly.size).toBe(0);
  });

  it('a carta que já é oficial só ganha a arte: imagem, texto e artes de antes continuam', () => {
    const db = openDb(':memory:');
    importBodies(db, [[...zoro, ...nami]], 'api:teste');
    const before = getCards(db, ['EB04-007', 'OP01-016']);
    importBodies(db, [newSet], 'api:teste');
    const [z, n, newgate] = getCards(db, ['EB04-007', 'OP01-016', 'OP17-001']);
    expect(z).toMatchObject({ imageUrl: `${IMG}/EB04-007_TLnEm4i.jpg`, text: '[On Play] Draw 1 card.' });
    expect(z.arts?.map((a) => a.id)).toEqual(['EB04-007_p1', 'EB04-007_p2']);
    expect(z.arts?.[1]).toEqual({ id: 'EB04-007_p2', imageUrl: `${IMG}/EB04-007_p2.jpg`, label: 'SP' });
    expect(n).toEqual(before[1]);
    expect(newgate.imageUrl).toBe(`${IMG}/OP17-001.jpg`);
    // Importar de novo não repete a arte.
    importBodies(db, [newSet], 'api:teste');
    expect(getCards(db, ['EB04-007'])[0].arts?.map((a) => a.id)).toEqual(['EB04-007_p1', 'EB04-007_p2']);
  });

  it('com a imagem já na CDN própria, a arte que é a própria imagem da carta não entra', () => {
    const db = openDb(':memory:');
    // P-084 só tem a impressão "_p1" na optcgapi: é a imagem da carta (já copiada para a CDN).
    upsertCards(db, [{ id: 'P-084', name: 'Buggy', category: 'character', colors: ['blue'], cost: 1, power: 2000, types: [], text: '', set: 'P', imageUrl: 'https://cards.test/P/en/P-084_p1.jpg?v=abc' }], { provisional: false, source: 'api:teste' });
    importBodies(db, [[row({ card_set_id: 'P-084', card_name: 'Buggy (SP)', set_name: 'Nova', set_id: 'OP-17', card_image_id: 'P-084_p1', card_image: `${IMG}/P-084_p1.jpg` })]], 'api:teste');
    expect(getCards(db, ['P-084'])[0]).toMatchObject({ imageUrl: 'https://cards.test/P/en/P-084_p1.jpg?v=abc' });
    expect(getCards(db, ['P-084'])[0].arts).toBeUndefined();
  });

  it('a carta que o banco não tem (ou só como provisória) entra inteira, com a impressão que veio como imagem', () => {
    const db = openDb(':memory:');
    upsertCards(db, [{ id: 'OP01-016', name: 'Nami (de memória)', category: 'character', colors: ['red'], cost: 1, power: 2000, types: [], text: '', set: 'OP01' }], { provisional: true, source: 'fixture:op01.json' });
    importBodies(db, [newSet], 'api:teste');
    const [z, n] = getCards(db, ['EB04-007', 'OP01-016']);
    expect(z).toMatchObject({ provisional: false, imageUrl: `${IMG}/EB04-007_p2.jpg`, text: '[On Play] Draw 2 cards.' });
    expect(z.arts).toBeUndefined();
    expect(n).toMatchObject({ provisional: false, name: 'Nami', imageUrl: `${IMG}/OP01-016_r2.jpg` });
  });
});

describe('artes vindas de um site de spoilers (provisórias)', () => {
  const leaksArt = { id: 'op18-021a', imageUrl: 'https://images.optcgleaks.com/op18/images/op18-021a.webp', label: 'Alternate Art', spoiler: 'OP18' };
  const franky = (extra: Partial<CardData> = {}): CardData => ({ id: 'OP18-021', name: 'Franky', category: 'leader', colors: ['green', 'purple'], life: 4, power: 5000, types: [], text: '', set: 'OP18', imageUrl: 'https://images.optcgleaks.com/op18/images/op18-021_v2.webp', ...extra });
  const official = (arts?: CardData['arts']) => franky({ imageUrl: `${IMG}/OP18-021.jpg`, ...(arts ? { arts } : {}) });

  it('a importação oficial com as artes da carta tira as do site de spoilers', () => {
    const db = openDb(':memory:');
    upsertCards(db, [franky({ arts: [leaksArt] })], { provisional: true, source: 'spoiler:feed:optcgleaks.com' });
    upsertCards(db, [official([{ id: 'OP18-021_p1', imageUrl: `${IMG}/OP18-021_p1.jpg`, label: 'Alternate Art' }])], { provisional: false, source: 'api:teste' });
    expect(getCards(db, ['OP18-021'])[0].arts).toEqual([{ id: 'OP18-021_p1', imageUrl: `${IMG}/OP18-021_p1.jpg`, label: 'Alternate Art' }]);
  });

  it('enquanto a fonte oficial não tem as artes, as do site continuam; quando chegam, saem', () => {
    const db = openDb(':memory:');
    upsertCards(db, [franky({ arts: [leaksArt] })], { provisional: true, source: 'spoiler:feed:optcgleaks.com' });
    // A coleção sai na API só com as impressões normais.
    upsertCards(db, [official()], { provisional: false, source: 'api:teste' });
    expect(getCards(db, ['OP18-021'])[0]).toMatchObject({ provisional: false, imageUrl: `${IMG}/OP18-021.jpg`, arts: [leaksArt] });
    // Reimportar sem arte nova não muda nada.
    upsertCards(db, [official()], { provisional: false, source: 'api:teste' });
    expect(getCards(db, ['OP18-021'])[0].arts).toEqual([leaksArt]);
    // Depois a API publica as paralelas.
    upsertCards(db, [official([{ id: 'OP18-021_p1', imageUrl: `${IMG}/OP18-021_p1.jpg`, label: 'Alternate Art' }])], { provisional: false, source: 'api:teste' });
    expect(getCards(db, ['OP18-021'])[0].arts?.map((a) => a.id)).toEqual(['OP18-021_p1']);
  });

  it('carta antiga: a SP oficial que chega na coleção nova tira a do site; as artes oficiais de antes ficam', () => {
    const db = openDb(':memory:');
    const loki = [
      row({ card_set_id: 'OP17-119', card_name: 'Loki', set_name: 'OP17', set_id: 'OP-17', card_image_id: 'OP17-119', card_image: `${IMG}/OP17-119.jpg` }),
      row({ card_set_id: 'OP17-119', card_name: 'Loki (Alternate Art)', set_name: 'OP17', set_id: 'OP-17', card_image_id: 'OP17-119_p1', card_image: `${IMG}/OP17-119_p1.jpg` }),
    ];
    importBodies(db, [loki], 'api:teste');
    const amano = { id: 'op17-119ya_v2', imageUrl: 'https://images.optcgleaks.com/op18/images/op17-119ya_v2.webp', label: 'Yoshitaka Amano Alternate Art', spoiler: 'OP18' };
    expect(syncSpoilerArts(db, 'OP18', new Map([['OP17-119', [amano]]]))).toEqual({ cards: 1, added: 1, removed: 0 });
    expect(getCards(db, ['OP17-119'])[0].arts?.map((a) => a.id)).toEqual(['OP17-119_p1', 'op17-119ya_v2']);
    // Reimportar a coleção da carta (sem arte nova) não tira a do site.
    importBodies(db, [loki], 'api:teste');
    expect(getCards(db, ['OP17-119'])[0].arts?.map((a) => a.id)).toEqual(['OP17-119_p1', 'op17-119ya_v2']);
    // A coleção nova sai na API com a impressão oficial.
    importBodies(db, [[row({ card_set_id: 'OP17-119', card_name: 'Loki (OP17-119) (SP)', set_name: 'OP18', set_id: 'OP-18', card_image_id: 'OP17-119_p3', card_image: `${IMG}/OP17-119_p3.jpg` })]], 'api:teste');
    const card = getCards(db, ['OP17-119'])[0];
    expect(card.imageUrl).toBe(`${IMG}/OP17-119.jpg`);
    expect(card.arts?.map((a) => a.id)).toEqual(['OP17-119_p1', 'OP17-119_p3']);
  });

  it('syncSpoilerArts: não repete, guarda o endereço já trocado pela CDN e tira o que saiu do feed', () => {
    const db = openDb(':memory:');
    upsertCards(db, [official([{ id: 'OP18-021_p1', imageUrl: `${IMG}/OP18-021_p1.jpg` }])].map((c) => ({ ...c, id: 'OP13-012', set: 'OP13' })), { provisional: false, source: 'api:teste' });
    const sp = { id: 'op13-012spv2', imageUrl: 'https://images.optcgleaks.com/op18/images/op13-012spv2.webp', label: 'SP', spoiler: 'OP18' };
    const extra = new Map([['OP13-012', [sp]], ['OP99-001', [sp]]]);
    // Carta que não está no banco fica de fora.
    expect(syncSpoilerArts(db, 'OP18', extra, { prune: true })).toEqual({ cards: 1, added: 1, removed: 0 });
    expect(syncSpoilerArts(db, 'OP18', extra, { prune: true })).toEqual({ cards: 0, added: 0, removed: 0 });
    // A CDN própria troca o endereço; a rodada seguinte não o desfaz.
    const stored = getCards(db, ['OP13-012'])[0];
    const onCdn = { ...stored, arts: stored.arts!.map((a) => (a.spoiler ? { ...a, imageUrl: 'https://cards.test/OP13/en/op13-012spv2.webp?v=1' } : a)) };
    db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(onCdn), 'OP13-012');
    expect(syncSpoilerArts(db, 'OP18', extra, { prune: true }).cards).toBe(0);
    expect(getCards(db, ['OP13-012'])[0].arts?.[1].imageUrl).toBe('https://cards.test/OP13/en/op13-012spv2.webp?v=1');
    // O feed de outra coleção não mexe nas artes desta; sem `prune`, nada sai.
    expect(syncSpoilerArts(db, 'EB06', new Map(), { prune: true }).cards).toBe(0);
    expect(syncSpoilerArts(db, 'OP18', new Map()).cards).toBe(0);
    // O site trocou o arquivo: a antiga sai e a nova entra; a arte oficial fica.
    const renamed = { ...sp, id: 'op13-012spv3', imageUrl: 'https://images.optcgleaks.com/op18/images/op13-012spv3.webp' };
    expect(syncSpoilerArts(db, 'OP18', new Map([['OP13-012', [renamed]]]), { prune: true })).toEqual({ cards: 1, added: 1, removed: 1 });
    expect(getCards(db, ['OP13-012'])[0].arts?.map((a) => a.id)).toEqual(['OP18-021_p1', 'op13-012spv3']);
    // O site tirou a carta das reimpressões: a arte sai.
    expect(syncSpoilerArts(db, 'OP18', new Map(), { prune: true })).toEqual({ cards: 1, added: 0, removed: 1 });
    expect(getCards(db, ['OP13-012'])[0].arts?.map((a) => a.id)).toEqual(['OP18-021_p1']);
  });
});

/** Banco com os decks prontos e artes para o Líder e uma carta do ST-01. */
function withArts() {
  const db = openDb(':memory:');
  seed(db);
  const arts: Record<string, CardData['arts']> = {
    'ST01-001': [
      { id: 'ST01-001_p1', imageUrl: `${IMG}/ST01-001_p1.jpg`, label: 'Parallel' },
      { id: 'ST01-001_p2', imageUrl: `${IMG}/ST01-001_p2.jpg`, label: 'Manga' },
    ],
    'ST01-012': [{ id: 'ST01-012_p1', imageUrl: `${IMG}/ST01-012_p1.jpg`, label: 'Wanted Poster' }],
  };
  const cards = getCards(db, Object.keys(arts)).map((c) => ({ ...c, imageUrl: `${IMG}/${c.id}.jpg`, arts: arts[c.id] }) as CardData);
  upsertCards(db, cards, { provisional: false, source: 'teste' });
  return db;
}

describe('artes nos decks', () => {
  it('grava a escolha, descarta o que não existe e devolve o Líder com a arte', async () => {
    const db = withArts();
    const a = buildApp(db, { server: { cardImages: true } });
    const arts = { 'ST01-001': 'ST01-001_p2', 'ST01-012': 'ST01-012_p1', 'ST01-002': 'inventada', 'OP01-016': 'OP01-016_p1' };
    const created = await a.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'Com artes', leader: 'ST01-001', cards: luffy.cards, arts } });
    expect(created.statusCode).toBe(201);
    expect(created.json().leaderImage).toBe(`${IMG}/ST01-001_p2.jpg`);

    const full = (await a.inject(`/api/decks/${created.json().id}`)).json();
    expect(full.deck.arts).toEqual({ 'ST01-001': 'ST01-001_p2', 'ST01-012': 'ST01-012_p1' });
    expect(full.cards.find((c: CardData) => c.id === 'ST01-012').arts).toHaveLength(1);

    // A escolha chega à partida online (e à inscrição em torneio, que usa o mesmo deck).
    const deck = playableDeck(db, created.json().id, 'egb');
    expect(deck).toMatchObject({ arts: { 'ST01-001': 'ST01-001_p2', 'ST01-012': 'ST01-012_p1' } });

    // Sem artes no corpo: voltam as normais.
    const cleared = await a.inject({ method: 'PUT', url: `/api/decks/${created.json().id}`, headers: ALICE, payload: { name: 'Com artes', leader: 'ST01-001', cards: luffy.cards } });
    expect(cleared.json().leaderImage).toBe(`${IMG}/ST01-001.jpg`);
    expect((await a.inject(`/api/decks/${created.json().id}`)).json().deck.arts).toBeUndefined();
  });

  it('com as imagens desligadas, as artes também somem', async () => {
    const db = withArts();
    const a = buildApp(db, { server: { cardImages: false } });
    const created = await a.inject({ method: 'POST', url: '/api/decks', headers: ALICE, payload: { name: 'X', leader: 'ST01-001', cards: luffy.cards, arts: { 'ST01-001': 'ST01-001_p1' } } });
    expect(created.json().leaderImage).toBeNull();
    const full = (await a.inject(`/api/decks/${created.json().id}`)).json();
    expect(full.cards.some((c: CardData) => c.arts || c.imageUrl)).toBe(false);
  });
});
