// Artes alternativas: importação (linhas da optcgapi), banco (sem perder artes na importação
// parcial) e decks (a escolha é gravada, limpa e chega à partida online).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { importBodies } from '../src/card-import';
import { getCards, openDb, upsertCards } from '../src/db';
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
    const deck = playableDeck(db, created.json().id, 'egb', false);
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
