import { describe, expect, it } from 'vitest';
import { translateCardPt } from '../src/i18n/render';
import type { CardData } from '../src/types';
import { cards } from './helpers';

const card = (text: string, extra: Partial<CardData> = {}): CardData => ({
  id: 'T-1',
  name: 'Teste',
  category: 'character',
  colors: ['red'],
  cost: 3,
  power: 4000,
  types: [],
  text,
  ...extra,
});

describe('tradução gerada a partir dos passos do motor', () => {
  it('todas as cartas dos decks iniciais ficam completas', () => {
    const partial = cards.filter((c) => !translateCardPt(c).complete).map((c) => `${c.id}: ${translateCardPt(c).text}`);
    expect(partial).toEqual([]);
  });

  it('descreve alvos, condições e custos', () => {
    expect(translateCardPt(card("[On Play] K.O. up to 1 of your opponent's rested Characters with a cost of 3 or less.")).text).toBe(
      '[Ao Jogar] Nocauteie (K.O.) até 1 Personagem virado do oponente com custo 3 ou menos.',
    );
    expect(
      translateCardPt(card('[On Play] If your opponent has 3 or less Life cards, draw 2 cards and trash 2 cards from your hand.')).text,
    ).toBe('[Ao Jogar] Se o oponente tiver 3 ou menos cartas de Vida, compre 2 cartas e descarte 2 cartas da sua mão.');
    expect(
      translateCardPt(card('[Activate: Main] [Once Per Turn] ③ (You may rest the specified number of DON!! cards in your cost area.) You may trash 1 card from your hand: Set this Leader as active.', { category: 'leader' })).text,
    ).toBe('[Ativar: Principal] [Uma Vez por Turno] ③ Você pode descartar 1 carta da sua mão: Deixe este Líder ativo.');
  });

  it('busca sem "reveal" (OP16-021, OP16-119) não manda revelar; com "reveal", manda', () => {
    expect(
      translateCardPt(
        card('[On Play] Look at 3 cards from the top of your deck; add up to 1 card to the top of your Life cards. Then, place the rest at the bottom of your deck in any order.'),
      ).text,
    ).toBe('[Ao Jogar] Olhe as 3 cartas do topo do seu deck; coloque até 1 carta no topo da sua Vida. Depois, coloque o resto no fundo do seu deck em qualquer ordem.');
    expect(
      translateCardPt(
        card(
          '[On Play] If your Leader has the {Whitebeard Pirates} type, look at 3 cards from the top of your deck and add up to 1 card to your hand. Then, place the rest at the bottom of your deck in any order.',
        ),
      ).text,
    ).toBe(
      '[Ao Jogar] Se o seu Líder tiver o tipo {Whitebeard Pirates}, olhe as 3 cartas do topo do seu deck; adicione até 1 carta à sua mão. Depois, coloque o resto no fundo do seu deck em qualquer ordem.',
    );
    expect(
      translateCardPt(
        card('[On Play] Look at 5 cards from the top of your deck; reveal up to 1 {Okama} type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.'),
      ).text,
    ).toBe('[Ao Jogar] Olhe as 5 cartas do topo do seu deck; revele até 1 carta do tipo {Okama} e adicione à sua mão. Depois, coloque o resto no fundo do seu deck em qualquer ordem.');
    // Corgy OP03-083: "trash up to 2 cards" descarta (não "revele … e adicione à sua mão").
    expect(translateCardPt(card('[On Play] Look at 5 cards from the top of your deck and trash up to 2 cards. Then, place the rest at the bottom of your deck in any order.')).text).toBe(
      '[Ao Jogar] Olhe as 5 cartas do topo do seu deck; descarte até 2 cartas. Depois, coloque o resto no fundo do seu deck em qualquer ordem.',
    );
  });

  it('linhas não reconhecidas usam o tradutor por regras', () => {
    const r = translateCardPt(card('[On Play] Draw 1 card.\n[When Attacking] Swap the universe.'));
    expect(r.text.split('\n')[0]).toBe('[Ao Jogar] Compre 1 carta.');
    expect(r.complete).toBe(false);
  });
});
