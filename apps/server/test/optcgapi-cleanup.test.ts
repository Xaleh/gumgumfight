import { describe, expect, it } from 'vitest';
import { extractNotes, mapApiCard, normalizeTypeQuotes, repairMissingAttribute, splitTrigger, splitTypes, typeVocabulary } from '../src/optcgapi';

describe('limpeza dos dados da optcgapi', () => {
  it('separa notas de errata/reimpressão do texto do efeito', () => {
    const r = extractNotes(
      "[On Play] Draw 1 card. This card has been officially errata'd.DISCLAIMER: This card is a reprint of the pre-existing card in the OP01 set. The main difference between this card and the original print is the inclusion of \"EN\".",
    );
    expect(r.text).toBe('[On Play] Draw 1 card.');
    expect(r.notes).toHaveLength(2);
  });

  it('só separa o [Trigger] que abre uma linha ou vem depois do fim de uma frase', () => {
    expect(splitTrigger('[On Play] You may trash 1 card with a [Trigger] from your hand: Draw 3 cards.')).toEqual({
      text: '[On Play] You may trash 1 card with a [Trigger] from your hand: Draw 3 cards.',
    });
    expect(splitTrigger('[Main] K.O. up to 1 Character with a cost of 3 or less and a [Trigger].\n[Trigger] Draw 1 card.')).toEqual({
      text: '[Main] K.O. up to 1 Character with a cost of 3 or less and a [Trigger].',
      trigger: 'Draw 1 card.',
    });
    expect(splitTrigger('[Counter] Draw 1 card. [Trigger] Play this card.')).toEqual({ text: '[Counter] Draw 1 card.', trigger: 'Play this card.' });
    // Sem colchetes, numa linha própria.
    expect(splitTrigger('[On Play] Draw 1 card.\nTrigger Play this card.')).toEqual({ text: '[On Play] Draw 1 card.', trigger: 'Play this card.' });
    expect(splitTrigger('[On Play] Trigger the effect.')).toEqual({ text: '[On Play] Trigger the effect.' });
  });

  it('converte listas de tipos entre colchetes com ", or" sem confundir com nomes', () => {
    expect(normalizeTypeQuotes('reveal up to 1 [Straw Hat Crew], [Kid Pirates], or {Heart Pirates} type card')).toBe(
      'reveal up to 1 {Straw Hat Crew}, {Kid Pirates}, or {Heart Pirates} type card',
    );
    expect(normalizeTypeQuotes('reveal up to 1 [Sanji] or {Big Mom Pirates} type card')).toBe('reveal up to 1 [Sanji] or {Big Mom Pirates} type card');
  });

  it('preenche o atributo "Slash" que a API perde nas cartas verdes', () => {
    expect(repairMissingAttribute('If your Leader has the attribute, draw 1 card.', ['green'])).toBe('If your Leader has the "Slash" attribute, draw 1 card.');
    expect(repairMissingAttribute('rest your attribute Leader', ['green'])).toBe('rest your "Slash" attribute Leader');
    expect(repairMissingAttribute('your "Slash" attribute Characters', ['green'])).toBe('your "Slash" attribute Characters');
    expect(repairMissingAttribute('If your Leader has the attribute', ['red'])).toBe('If your Leader has the attribute');
    expect(repairMissingAttribute('cannot be K.O.\'d in battle by attribute cards', ['yellow'], 'OP08-114')).toBe('cannot be K.O.\'d in battle by "Slash" attribute cards');
  });

  it('converte "X" type para {X} type', () => {
    expect(normalizeTypeQuotes('reveal up to 1 "Straw Hat Crew" type card')).toBe('reveal up to 1 {Straw Hat Crew} type card');
  });

  it('separa tipos juntados com espaço pelo maior tipo conhecido', () => {
    const vocab = new Set(['Animal', 'Animal Kingdom Pirates', 'Straw Hat Crew', 'Land of Wano', 'Kouzuki Clan', 'Former Whitebeard Pirates', 'Whitebeard Pirates']);
    expect(splitTypes('Animal Straw Hat Crew', vocab)).toEqual(['Animal', 'Straw Hat Crew']);
    expect(splitTypes('Animal Kingdom Pirates', vocab)).toEqual(['Animal Kingdom Pirates']);
    expect(splitTypes('Land of Wano Kouzuki Clan', vocab)).toEqual(['Land of Wano', 'Kouzuki Clan']);
    expect(splitTypes('Former Whitebeard Pirates Land of Wano', vocab)).toEqual(['Former Whitebeard Pirates', 'Land of Wano']);
    expect(splitTypes('Supernovas/Heart Pirates', vocab)).toEqual(['Supernovas', 'Heart Pirates']);
    expect(splitTypes('5000', vocab)).toEqual([]);
    expect(splitTypes('Tipo Novo Desconhecido', vocab)).toEqual(['Tipo Novo Desconhecido']);
  });

  it('o vocabulário inclui tipos citados nos textos', () => {
    const v = typeVocabulary([{ card_text: 'Play up to 1 {Heart Pirates} type card and 1 "Minks" type card.' }], ['Navy']);
    expect([...v].sort()).toEqual(['Heart Pirates', 'Minks', 'Navy']);
  });

  it('mapeia tudo junto: notas, aspas, tipos e apelidos', () => {
    const card = mapApiCard(
      {
        card_set_id: 'OP01-121',
        card_name: 'Yamato',
        card_type: 'Character',
        card_color: 'Green',
        card_cost: '5',
        card_power: '6000',
        sub_types: 'Land of Wano Kouzuki Clan',
        card_text: "Also treat this card's name as [Kouzuki Oden] according to the rules. [On Play] Play up to 1 \"Land of Wano\" type card. This card has been officially errata'd.",
      },
      new Set(['Land of Wano', 'Kouzuki Clan']),
    )!;
    expect(card.types).toEqual(['Land of Wano', 'Kouzuki Clan']);
    expect(card.aliases).toEqual(['Kouzuki Oden']);
    expect(card.notes).toEqual(["This card has been officially errata'd."]);
    expect(card.text).toContain('{Land of Wano} type');
    expect(card.text).not.toContain('errata');
  });
});

describe('nomes', () => {
  it('remove a versão de impressão anexada ao nome', async () => {
    const { cleanName } = await import('../src/optcgapi');
    expect(cleanName('Roronoa Zoro (025)')).toBe('Roronoa Zoro');
    expect(cleanName('Nami (Parallel)')).toBe('Nami');
    expect(cleanName('Kaido (Alternate Art) (094)')).toBe('Kaido');
    expect(cleanName('Shanks (SP)')).toBe('Shanks');
    expect(cleanName('Monkey.D.Luffy (Jolly Roger Foil)')).toBe('Monkey.D.Luffy');
    expect(cleanName('Eustass"Captain"Kid')).toBe('Eustass"Captain"Kid');
  });
});

describe('nomes com parênteses oficiais', () => {
  it('mantém parênteses que fazem parte do nome e remove códigos/acabamentos', async () => {
    const { cleanName } = await import('../src/optcgapi');
    expect(cleanName('Mr.1(Daz.Bonez)')).toBe('Mr.1(Daz.Bonez)');
    expect(cleanName('Mr.1(Daz.Bonez) (Reprint)')).toBe('Mr.1(Daz.Bonez)');
    expect(cleanName('Miss Doublefinger(Zala)')).toBe('Miss Doublefinger(Zala)');
    expect(cleanName('Charlotte Katakuri (OP03-112)')).toBe('Charlotte Katakuri');
    expect(cleanName('Uta (P-041)')).toBe('Uta');
    expect(cleanName('Nami (Gold-Stamped Signature)')).toBe('Nami');
    expect(cleanName('Sabo (TR)')).toBe('Sabo');
    expect(cleanName('Boa Hancock - OP14-041')).toBe('Boa Hancock');
    expect(cleanName('Brook - ST01-011 (Reprint)')).toBe('Brook');
  });

  it('remove das promos o evento ou produto em que saíram', async () => {
    const { cleanName } = await import('../src/optcgapi');
    expect(cleanName('Koby (One Piece Film Red)')).toBe('Koby');
    expect(cleanName('Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]')).toBe('Monkey.D.Luffy');
    expect(cleanName('Uta - P-011 (Premium Card Collection -Uta-)')).toBe('Uta');
    expect(cleanName('Fleeting Lullaby (Starter Deck 11: Uta Deck Battle)')).toBe('Fleeting Lullaby');
    expect(cleanName('Jinbe (Seven Warlords of the Sea Binder Set)')).toBe('Jinbe');
    expect(cleanName('Monkey.D.Luffy (Gen Con 2023)')).toBe('Monkey.D.Luffy');
    expect(cleanName('Mr.3 (Galdino) - P-148 (Premium Card Collection -Live Action Edition Vol.2 Baroque Works-)')).toBe('Mr.3 (Galdino)');
  });
});

describe('reimpressões e artes alternativas', () => {
  const row = (o: Record<string, unknown>) => ({
    card_type: 'Character',
    card_color: 'Purple',
    attribute: 'Strike',
    sub_types: 'Straw Hat Crew',
    card_text: '[On Play] Draw 1 card.',
    rarity: 'R',
    ...o,
  });

  it('a linha "(Reprint)" com Counter 0 não apaga o Counter da impressão original', async () => {
    const { mapApiResponse } = await import('../src/optcgapi');
    const original = row({ card_set_id: 'OP05-070', card_name: 'Fra-Nosuke', set_id: 'OP-05', card_image_id: 'OP05-070', counter_amount: 2000, card_power: '4000', card_cost: '5' });
    const reprint = row({ card_set_id: 'OP05-070', card_name: 'Fra-Nosuke (Reprint)', set_id: 'ST-26', card_image_id: 'OP05-070_r2', counter_amount: 0, card_power: '4000', card_cost: '5' });
    for (const rows of [[original, reprint], [reprint, original]]) {
      const { cards } = mapApiResponse(rows);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ id: 'OP05-070', name: 'Fra-Nosuke', counter: 2000, power: 4000, cost: 5 });
    }
  });

  it('decide por maioria quando a impressão original está errada (Chopper OP08-001)', async () => {
    const { mapApiResponse } = await import('../src/optcgapi');
    const rows = [
      row({ card_set_id: 'OP08-001', card_name: 'Tony Tony.Chopper (001)', card_type: 'Leader', set_id: 'OP-08', card_image_id: 'OP08-001', card_power: '4', life: '1', card_text: '[Activate: Main] Draw 1 card.' }),
      row({ card_set_id: 'OP08-001', card_name: 'Tony Tony.Chopper (001) (Parallel)', card_type: 'Leader', set_id: 'OP-08', card_image_id: 'OP08-001_p1', card_power: '5000', life: '4', card_text: '[Activate: Main] Draw 1 card. ' }),
      row({ card_set_id: 'OP08-001', card_name: 'Tony Tony.Chopper (SPR)', card_type: 'Leader', set_id: 'EB-02', card_image_id: 'OP08-001_p2', card_power: '5000', life: '4', card_text: '[Activate: Main] Draw 1 card. ' }),
    ];
    const { cards } = mapApiResponse(rows);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 'OP08-001', name: 'Tony Tony.Chopper', category: 'leader', power: 5000, life: 4 });
  });

  it('empate fica com a impressão original e o texto vem sempre dela', async () => {
    const { mapApiResponse } = await import('../src/optcgapi');
    const rows = [
      row({ card_set_id: 'OP09-095', card_name: 'Laffitte (Reprint)', set_id: 'ST-27', card_image_id: 'OP09-095_r1', counter_amount: 0, card_power: '1000', card_cost: '1', card_text: '[On Play] Draw 1 card. (reprint)' }),
      row({ card_set_id: 'OP09-095', card_name: 'Laffitte', set_id: 'OP-09', card_image_id: 'OP09-095', counter_amount: 1000, card_power: '1000', card_cost: '1' }),
    ];
    const { cards } = mapApiResponse(rows);
    expect(cards[0]).toMatchObject({ id: 'OP09-095', counter: 1000, text: '[On Play] Draw 1 card.' });
  });

  it('o texto vem da versão que o leitor de efeitos entende melhor (Smoker OP02-093)', async () => {
    const { mapApiResponse } = await import('../src/optcgapi');
    const broken = "[DON!! x1] [Activate:Main] [Once Per Turn] Give up to 1o of your opponent's Characters -1 cost during this turn.";
    const good = "[DON!! x1] [Activate: Main] [Once Per Turn] Give up to 1 of your opponent's Characters -1 cost during this turn.";
    const rows = [
      row({ card_set_id: 'OP02-093', card_name: 'Smoker (093)', card_type: 'Leader', set_id: 'OP-02', card_image_id: 'OP02-093', card_power: '5000', life: '5', card_text: broken }),
      row({ card_set_id: 'OP02-093', card_name: 'Smoker (093) (Alternate Art)', card_type: 'Leader', set_id: 'OP-02', card_image_id: 'OP02-093_p1', card_power: '5000', life: '5', card_text: broken }),
      row({ card_set_id: 'OP02-093', card_name: 'Smoker (OP02-093)', card_type: 'Leader', set_id: 'ST-19', card_image_id: 'OP02-093_p2', card_power: '5000', life: '5', card_text: good }),
    ];
    const { cards } = mapApiResponse(rows);
    expect(cards[0]).toMatchObject({ id: 'OP02-093', name: 'Smoker', text: good });
  });

  it('a versão que traz o [Trigger] vence a que não traz (Smoothie OP03-110)', async () => {
    const { mapApiResponse } = await import('../src/optcgapi');
    const body = '[When Attacking] You may add 1 card from the top or bottom of your Life cards to your hand: This Character gains +2000 power during this battle.';
    const rows = [
      row({ card_set_id: 'OP03-110', card_name: 'Charlotte Smoothie', set_id: 'OP-03', card_image_id: 'OP03-110', counter_amount: 1000, card_power: '7000', card_cost: '5', card_text: body }),
      row({ card_set_id: 'OP03-110', card_name: 'Charlotte Smoothie (Full Art)', set_id: 'PRB-01', card_image_id: 'OP03-110_p4', counter_amount: 1000, card_power: '7000', card_cost: '5', card_text: body }),
      row({ card_set_id: 'OP03-110', card_name: 'Charlotte Smoothie', set_id: 'ST-20', card_image_id: 'OP03-110_r1', counter_amount: 1000, card_power: '7000', card_cost: '5', card_text: `${body}\n\n[Trigger] You may trash 1 card from your hand: Play this card.` }),
    ];
    const { cards } = mapApiResponse(rows);
    expect(cards[0]).toMatchObject({ id: 'OP03-110', text: body, trigger: 'You may trash 1 card from your hand: Play this card.' });
  });

  it('importBodies junta as linhas de todos os corpos antes de escolher', async () => {
    const { importBodies } = await import('../src/card-import');
    const { listCards, openDb } = await import('../src/db');
    const db = openDb(':memory:');
    const original = row({ card_set_id: 'OP05-066', card_name: 'Jinbe', set_id: 'OP-05', card_image_id: 'OP05-066', counter_amount: 1000, card_power: '5000', card_cost: '4' });
    const reprint = row({ card_set_id: 'OP05-066', card_name: 'Jinbe (Reprint)', set_id: 'ST-26', card_image_id: 'OP05-066_r1', counter_amount: 0, card_power: '5000', card_cost: '4' });
    importBodies(db, [[original], [reprint]], 'teste');
    expect(listCards(db).map((c) => [c.id, c.counter])).toEqual([['OP05-066', 1000]]);
  });
});

describe('promocionais (allPromos)', () => {
  const promo = (o: Record<string, unknown>) => ({
    card_type: 'Character',
    card_color: 'Red',
    card_cost: '3',
    card_power: '4000',
    counter_amount: 1000,
    attribute: 'Strike',
    sub_types: 'Navy',
    card_text: '[On Play] Draw 1 card.',
    set_id: 'P',
    set_name: 'One Piece Promotion Cards',
    rarity: 'P',
    ...o,
  });

  it('a importação completa lê também a lista de promos', async () => {
    const { allEndpoints } = await import('../src/optcgapi');
    expect(allEndpoints('https://x/api')).toContain('https://x/api/allPromos/');
  });

  it('o número com sufixo da reimpressão em starter deck vira o número da carta', async () => {
    const { baseCardId, mapApiResponse } = await import('../src/optcgapi');
    expect(baseCardId('P-029_r1')).toBe('P-029');
    expect(baseCardId('P-057_p1')).toBe('P-057');
    expect(baseCardId('OP01-001')).toBe('OP01-001');
    const rows = [
      promo({ card_set_id: 'P-029_r1', card_name: 'Bartolomeo', set_id: 'ST-16', set_name: 'Uta', card_image_id: 'P-029_r1', card_image: 'r1.jpg' }),
      promo({ card_set_id: 'P-029', card_name: 'Bartolomeo (CS 2023 Event Pack Finalist Ver.)', card_image_id: 'P-029', card_image: null }),
    ];
    const { cards } = mapApiResponse(rows);
    expect(cards).toHaveLength(1);
    // A linha principal (da lista de promos) não tem imagem: fica a da reimpressão.
    expect(cards[0]).toMatchObject({ id: 'P-029', name: 'Bartolomeo', set: 'P', imageUrl: 'r1.jpg' });
  });

  it('ignora a reimpressão promocional de carta de coleção e os líderes só de evento', async () => {
    const { mapApiResponse } = await import('../src/optcgapi');
    const rows = [
      promo({ card_set_id: 'OP09-077', card_name: 'Gum-Gum Lightning', set_id: 'OP09', card_image_id: 'OP09-077', card_type: 'Event', card_text: '[Main] Draw 2 cards.' }),
      promo({ card_set_id: 'OP09-077', card_name: 'Gum-Gum Lightning (Premium Card Collection -Best Selection Vol. 4-)', set_id: 'OP09', card_image_id: 'OP09-077', card_type: 'Event', card_text: '[Main] Draw 1 card.' }),
      promo({ card_set_id: 'P-700', card_name: 'Monkey.D.Luffy (Release Event Leader)', card_type: 'Leader', card_image_id: 'P-700', life: '5', card_text: 'This Leader can only be used in designated events according to the rules.' }),
    ];
    // A primeira linha não é da lista de promos (set_name da coleção).
    rows[0].set_name = 'Emperors in the New World';
    const { cards, ignored } = mapApiResponse(rows);
    expect(cards.map((c) => [c.id, c.text])).toEqual([['OP09-077', '[Main] Draw 2 cards.']]);
    expect(ignored).toBe(2);
  });

  it('o banco troca os números antigos com sufixo nos decks e apaga as cartas antigas', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { getDeck, listCards, openDb, upsertCards, upsertDeck } = await import('../src/db');
    const file = join(mkdtempSync(join(tmpdir(), 'gg-')), 'db.sqlite');
    const db = openDb(file);
    const card = { id: 'P-029_r1', name: 'Bartolomeo', category: 'character' as const, colors: ['green' as const], types: [], text: '' };
    upsertCards(db, [card, { ...card, id: 'P-029' }], { provisional: true, source: 'teste' });
    upsertDeck(db, { id: 'd', name: 'D', leader: 'ST11-001', cards: [{ id: 'P-029_r1', count: 2 }, { id: 'P-029', count: 2 }, { id: 'ST16-001', count: 4 }] }, 'user');
    db.close();
    const again = openDb(file);
    expect(listCards(again).map((c) => c.id)).toEqual(['P-029']);
    expect(getDeck(again, 'd')?.cards).toEqual([{ id: 'P-029', count: 4 }, { id: 'ST16-001', count: 4 }]);
    again.close();
  });
});
