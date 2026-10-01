import { describe, expect, it } from 'vitest';
import { extractNotes, mapApiCard, normalizeTypeQuotes, splitTrigger, splitTypes, typeVocabulary } from '../src/optcgapi';

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
  });
});
