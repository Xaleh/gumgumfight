// Revisão das traduções automáticas (08/10/2026): casos achados ao passar a base inteira
// (2.513 cartas com texto) por `translateCardPt` e comparar com o texto em inglês.
// Cada caso é uma carta real com o texto da optcgapi.

import { describe, expect, it } from 'vitest';
import { translateCardPt } from '../src/i18n/render';
import { parseCard } from '../src/cards/parser';
import type { CardData } from '../src/types';

function card(id: string, text: string, category: CardData['category'] = 'character'): Pick<CardData, 'category' | 'text' | 'trigger'> & { id: string } {
  return { id, category, text };
}

function pt(id: string, text: string, category: CardData['category'] = 'character'): string {
  const t = translateCardPt(card(id, text, category));
  expect(t.complete, `${id}: ${t.text}`).toBe(true);
  return t.text;
}

describe('tradução: números internos do leitor não aparecem no texto', () => {
  it('OP17-119 Loki: "your opponent\'s Characters with a total cost of 4 or less" não vira "até 99"', () => {
    const text = pt(
      'OP17-119',
      "This Character gains +12 cost, and if it is your opponent's turn, this Character gains +3000 power.\n[On Play] K.O. your opponent's Characters with a total cost of 4 or less.",
    );
    expect(text).not.toMatch(/99/);
    expect(text).toContain('[Ao Jogar] Nocauteie (K.O.) Personagens do oponente com custo somado de 4 ou menos.');
  });

  it('OP17-119 Loki: os +3000 só valem no turno do oponente', () => {
    const text = pt(
      'OP17-119',
      "This Character gains +12 cost, and if it is your opponent's turn, this Character gains +3000 power.\n[On Play] K.O. your opponent's Characters with a total cost of 4 or less.",
    );
    expect(text.split('\n')[0]).toBe('Este Personagem recebe +12 de custo. [Turno do Oponente] Este Personagem recebe +3000 de poder.');
  });

  it('OP13-028 Shanks: "Set all of your DON!! cards as active"', () => {
    expect(pt('OP13-028', '[On Play] Set all of your DON!! cards as active. Then, you cannot play cards from your hand during this turn.')).toBe(
      '[Ao Jogar] Deixe todos os seus DON!! ativos. Depois, você não pode jogar cartas da sua mão neste turno.',
    );
  });

  it('OP03-091 Helmeppo: "Set the cost of … to 0"', () => {
    expect(pt('OP03-091', "[On Play] Set the cost of up to 1 of your opponent's Characters with no base effect to 0 during this turn.")).toBe(
      '[Ao Jogar] O custo de até 1 Personagem do oponente sem efeito passa a ser 0 durante este turno.',
    );
  });

  it('OP06-035 Hody Jones: "Rest up to a total of 2 of your opponent\'s Characters or DON!! cards" não repete o passo', () => {
    expect(pt('OP06-035', "[On Play] Rest up to a total of 2 of your opponent's Characters or DON!! cards.")).toBe(
      '[Ao Jogar] Vire até 2 Personagens ou DON!! do oponente, no total.',
    );
  });
});

describe('tradução: condições', () => {
  it('OP07-050 Boa Sandersonia: condição com dois tipos mantém os dois (no texto e no motor)', () => {
    const text =
      "[On Play] If you have 2 or more {Amazon Lily} or {Kuja Pirates} type Characters on your field, return up to 1 of your opponent's Characters with a cost of 3 or less to the owner's hand.";
    expect(pt('OP07-050', text)).toBe(
      '[Ao Jogar] Se você tiver 2 ou mais Personagens do tipo {Amazon Lily} ou {Kuja Pirates}, devolva até 1 Personagem do oponente com custo 3 ou menos à mão do dono.',
    );
    const def = parseCard({ id: 'OP07-050', name: 'Boa Sandersonia', category: 'character', color: ['green'], cost: 4, power: 5000, types: ['Kuja Pirates'], text } as unknown as CardData);
    expect(def.abilities[0].steps[0].if).toEqual({ minTypedCharacters: { count: 2, type: 'Amazon Lily', types: ['Amazon Lily', 'Kuja Pirates'] } });
  });

  it('OP12-102 Shirahoshi: "no other [Shirahoshi] with a base cost of 2" guarda o custo', () => {
    const text = '[Opponent\'s Turn] If you have no other [Shirahoshi] with a base cost of 2, all of your {Neptunian} type Characters gain +2000 power.';
    expect(pt('OP12-102', text)).toBe(
      '[Turno do Oponente] Se você não tiver outro Personagem [Shirahoshi] com custo base 2, os seus Personagens do tipo {Neptunian} recebem +2000 de poder.',
    );
    const def = parseCard({ id: 'OP12-102', name: 'Shirahoshi', category: 'character', color: ['green'], cost: 2, power: 0, types: ['Neptunian'], text } as unknown as CardData);
    expect(def.abilities[0].condition).toEqual({ noOtherNamed: 'Shirahoshi', noOtherNamedBaseCost: 2 });
  });

  it('EB02-056 Vegapunk: "if your opponent has 2 or less Characters" sem "se não o oponente"', () => {
    expect(pt('EB02-056', '[On Play] If your opponent has 2 or less Characters, trash 1 card from your hand.')).toBe(
      '[Ao Jogar] Se o oponente tiver 2 ou menos Personagens, descarte 1 carta da sua mão.',
    );
  });

  it('OP04-119 Rosinante: aura "with a base cost of 5" (custo exato)', () => {
    expect(pt('OP04-119', "[Opponent's Turn] If this Character is rested, your active Characters with a base cost of 5 cannot be K.O.'d by effects.")).toBe(
      '[Turno do Oponente] Se este Personagem estiver virado, os seus Personagens com custo base 5 não podem ser nocauteados por efeitos.',
    );
  });
});

describe('tradução: frases estáticas e custos', () => {
  it('OP03-108 Cracker: duas frases estáticas com a mesma condição viram uma', () => {
    expect(pt('OP03-108', '[DON!! x1] If you have less Life cards than your opponent, this Character gains [Double Attack] and +1000 power.')).toBe(
      '[DON!! x1] Se você tiver menos cartas de Vida que o oponente, este Personagem ganha [Double Attack] e recebe +1000 de poder.',
    );
  });

  it('EB04-048 Rob Lucci: "for every 5 cards" no plural', () => {
    expect(pt('EB04-048', 'If your Leader\'s type includes "CP", this Character gains +1000 power and -2 cost for every 5 cards in your trash.')).toBe(
      'Se o seu Líder tiver um tipo que inclua "CP", este Personagem recebe −2 de custo para cada 5 cartas no seu descarte e recebe +1000 de poder para cada 5 cartas no seu descarte.',
    );
  });

  it('OP12-070 Sanji: devolver DON!! como substituição, por extenso', () => {
    expect(pt('OP12-070', "If this Character would be removed from the field by your opponent's effect, you may return 1 DON!! card from your field to your DON!! deck instead.")).toBe(
      'Se este Personagem for removido do campo por um efeito do oponente, você pode devolver 1 DON!! do seu campo ao seu deck de DON!! em vez disso.',
    );
  });

  it('EB05-061 Nami: "by your opponent" é "pelo oponente", não "por um efeito do oponente" (vale para K.O. em batalha)', () => {
    expect(
      pt(
        'EB05-061',
        '[Once Per Turn] If your Character with 6000 base power or less would be removed from the field by your opponent, you may add 1 card from the top of your Life cards to your hand instead.',
      ),
    ).toBe(
      '[Uma Vez por Turno] Se um Personagem seu com 6000 de poder base ou menos for removido do campo pelo oponente, você pode colocar 1 carta do topo da sua Vida na mão em vez disso.',
    );
  });

  it('OP14-070 Buffalo: "DON!!" não fica minúsculo no meio da frase', () => {
    expect(pt('OP14-070', "When this Character becomes rested by your opponent's Character's effect, you may return 1 DON!! card from your field to your DON!! deck. If you do, set this Character as active.")).toBe(
      'Quando este Personagem for virado pelo efeito de um Personagem do oponente, DON!! −1: Deixe este Personagem ativo.',
    );
  });

  it('OP13-005 Inazuma: "ao seu Líder"', () => {
    expect(pt('OP13-005', '[On Play] Give up to 1 rested DON!! card to your Leader.')).toBe('[Ao Jogar] Dê até 1 DON!! virado ao seu Líder.');
  });
});

describe('tradução: listas de nomes e alvos com nome', () => {
  it('ST13-006 Curly.Dadan: "up to 1 each of [A], [B], and [C]"', () => {
    expect(pt('ST13-006', '[On Play] Play up to 1 each of [Sabo], [Portgas.D.Ace], and [Monkey.D.Luffy] with a cost of 2 from your hand.')).toBe(
      '[Ao Jogar] Jogue até 1 [Sabo], até 1 [Portgas.D.Ace] e até 1 [Monkey.D.Luffy] com custo 2 da sua mão.',
    );
  });

  it('OP16-087 Shinobu: "up to 1 of your [Kouzuki Momonosuke] gains +20 cost" é lido e traduzido', () => {
    expect(
      pt('OP16-087', '[On Play] You may trash this Character: If your Leader has the {Land of Wano} type, draw 1 card and up to 1 of your [Kouzuki Momonosuke] gains +20 cost during this turn.'),
    ).toBe(
      '[Ao Jogar] Você pode descartar este Personagem: Se o seu Líder tiver o tipo {Land of Wano}, compre 1 carta e até 1 carta sua [Kouzuki Momonosuke] recebe +20 de custo durante este turno.',
    );
  });
});
