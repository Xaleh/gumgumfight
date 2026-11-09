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
      '[Ao Jogar] O custo de até 1 Personagem do oponente sem efeito base passa a ser 0 durante este turno.',
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
      '[Turno do Oponente] Se este Personagem estiver virado, os seus Personagens ativos com custo base 5 não podem ser nocauteados por efeitos.',
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
      '[Ao Jogar] Você pode descartar este Personagem: Se o seu Líder tiver o tipo {Land of Wano}, compre 1 carta e até 1 dos seus Personagens [Kouzuki Momonosuke] recebe +20 de custo durante este turno.',
    );
  });

  // O substantivo do alvo com nome diz o que o efeito alcança: "carta sua [X]" para um efeito só de
  // Líder fazia o jogador procurar o Personagem [Nico Robin] (que o motor, certo, não oferecia).
  it('OP09-106 Nico Olvia: "up to 1 of your [Nico Robin] Leader" é "o seu Líder", não "carta sua"', () => {
    expect(pt('OP09-106', '[On Play] Up to 1 of your [Nico Robin] Leader gains +3000 power during this turn.')).toBe(
      '[Ao Jogar] O seu Líder [Nico Robin] recebe +3000 de poder durante este turno.',
    );
  });

  it('alvo com nome: "[X] Characters" é "dos seus Personagens"; "[X] cards" (Líder ou Personagem) é "das suas cartas"', () => {
    expect(pt('PX-001', '[On Play] Up to 1 of your [Nico Robin] Characters gains +3000 power during this turn.')).toBe(
      '[Ao Jogar] Até 1 dos seus Personagens [Nico Robin] recebe +3000 de poder durante este turno.',
    );
    expect(pt('PX-002', '[On Play] Up to 1 of your [Nico Robin] cards gains +3000 power during this turn.')).toBe(
      '[Ao Jogar] Até 1 das suas cartas [Nico Robin] recebe +3000 de poder durante este turno.',
    );
  });
});

// Auditoria das traduções (11/2026): classes de erro apontadas pelos jogadores, uma carta real de cada.
describe('tradução: auditoria de 11/2026', () => {
  it('"If one of your Characters would be removed" é "um Personagem seu", não "todos os seus Personagens" (OP16-014)', () => {
    expect(pt('OP16-014', "If one of your Characters would be removed from the field by your opponent's effect, you may K.O. this character instead.")).toBe(
      'Se um Personagem seu for removido do campo por um efeito do oponente, você pode nocautear este Personagem em vez disso.',
    );
  });

  it('a condição antes do custo fica antes do custo (OP11-100 Otohime)', () => {
    expect(pt('OP11-100', '[On Play] If your Leader is [Shirahoshi], you may turn 1 card from the top of your Life cards face-down: Draw 1 card.')).toBe(
      '[Ao Jogar] Se o seu Líder for [Shirahoshi], você pode virar para baixo 1 carta do topo da sua Vida: Compre 1 carta.',
    );
  });

  it('quantidade sem "up to" é obrigatória: sem "até" (OP01-002, P-008, P-010); com "up to", "até" (OP17-073)', () => {
    expect(pt('OP01-002', '[Main] If you have 5 Characters, return 1 of your Characters to the owner\'s hand.')).toBe(
      '[Principal] Se você tiver 5 Personagens, devolva 1 dos seus Personagens à mão do dono.',
    );
    expect(pt('P-008', "[Activate:Main] You may rest this Character: Rest 1 of your opponent's Characters with a cost of 2 or less.")).toBe(
      '[Ativar: Principal] Você pode virar este Personagem: Vire 1 Personagem do oponente com custo 2 ou menos.',
    );
    expect(pt('P-010', '[End of Your Turn] Add 1 DON!! card from your DON!! deck and set it as active.')).toBe('[Fim do Seu Turno] Adicione 1 DON!! do seu deck de DON!! ativo.');
    expect(pt('OP17-073', '[On Play] Add up to 1 DON!! card as active from your DON!! deck.')).toBe('[Ao Jogar] Adicione até 1 DON!! do seu deck de DON!! ativo.');
  });

  it('um jogador só tem um Líder: "o seu Líder", "o seu Líder do tipo {X}", "o seu Líder ou Stage" (OP04-088, OP15-033, OP10-095)', () => {
    expect(pt('OP04-088', "[Activate:Main] You may rest your 1 Leader: Give up to 1 of your opponent's Characters -4 cost during this turn.")).toBe(
      '[Ativar: Principal] Você pode virar o seu Líder: Dê −4 de custo a até 1 Personagem do oponente durante este turno.',
    );
    expect(pt('OP15-033', '[On Play] Set your {Fish-Man} type Leader as active.')).toBe('[Ao Jogar] Deixe o seu Líder do tipo {Fish-Man} ativo.');
    expect(pt('OP10-095', "[On Play] You may rest 1 of your {Dressrosa} type Leader or Stage cards: Draw 1 card.")).toBe(
      '[Ao Jogar] Você pode virar o seu Líder ou Stage do tipo {Dressrosa}: Compre 1 carta.',
    );
  });

  it('concordância: plural ("recebem", "ficam ativos", "não podem"), feminino ("nocauteada", "das suas cartas"), cores (OP08-018, OP08-022, OP02-118, OP14-029, OP07-009)', () => {
    expect(pt('OP08-018', '[Main] Up to 3 of your Characters gain +1000 power during this turn.')).toBe('[Principal] Até 3 dos seus Personagens recebem +1000 de poder durante este turno.');
    expect(pt('OP08-022', "[On Play] Up to 2 of your opponent's rested Characters with a cost of 5 or less will not become active in your opponent's next Refresh Phase.")).toBe(
      '[Ao Jogar] Até 2 Personagens virados do oponente com custo 5 ou menos não ficam ativos na próxima Fase de Renovação do oponente.',
    );
    expect(pt('OP02-118', "[Counter] Select up to 1 of your Characters. The selected Character cannot be K.O.'d during this battle.")).toBe(
      '[Counter] Escolha até 1 dos seus Personagens. O Personagem escolhido não pode ser nocauteado durante esta batalha.',
    );
    expect(pt('OP14-029', '[Activate: Main] You may rest 2 of your cards: This Character gains +2000 power during this turn.')).toBe(
      '[Ativar: Principal] Você pode virar 2 das suas cartas: Este Personagem recebe +2000 de poder durante este turno.',
    );
    expect(pt('OP07-009', '[On Play] Up to 1 of your red Characters with a cost of 1 gains [Double Attack] during this turn.')).toBe(
      '[Ao Jogar] Até 1 dos seus Personagens vermelhos com custo 1 ganha [Double Attack] durante este turno.',
    );
  });

  it('"reveal 1 card and play up to 1 …": jogar é opcional e o resto volta ao deck (OP08-052)', () => {
    expect(pt('OP08-052', '[On Play] Reveal 1 card from the top of your deck and play up to 1 Character card with a cost of 4 or less. Then, place the rest at the top or bottom of your deck.')).toBe(
      '[Ao Jogar] Revele 1 carta do topo do seu deck. Depois, se for um Personagem com custo 4 ou menos, você pode jogá-la. Depois, coloque o resto no topo ou no fundo do seu deck.',
    );
  });

  it('faixa de custo, "igual ou menor que", "exceto [A], ou [B]" e "ou" sem repetir o sujeito (OP05-091, OP05-102, OP12-086, OP13-051)', () => {
    expect(pt('OP05-091', '[On Play] Add up to 1 black Character card with a cost of 3 to 7 from your trash to your hand.')).toBe(
      '[Ao Jogar] Adicione até 1 Personagem preto com custo de 3 a 7 do seu descarte à sua mão.',
    );
    expect(pt('OP05-102', "[On Play] K.O. up to 1 of your opponent's Characters with a cost equal to or less than the number of your opponent's Life cards.")).toBe(
      '[Ao Jogar] Nocauteie (K.O.) até 1 Personagem do oponente com custo igual ou menor que o número de cartas de Vida do oponente.',
    );
    expect(pt('OP12-086', '[On Play] Look at 3 cards from the top of your deck; reveal up to 1 {Revolutionary Army} type card other than [Koala] or up to 1 [Nico Robin] and add it to your hand. Then, trash the rest.')).toBe(
      '[Ao Jogar] Olhe as 3 cartas do topo do seu deck; revele até 1 carta do tipo {Revolutionary Army} exceto [Koala], ou [Nico Robin] e adicione à sua mão. Depois, descarte o resto.',
    );
    expect(pt('OP13-051', '[On K.O.] If your Leader is [Boa Hancock] or multicolored, draw 2 cards.')).toBe('[Ao ser Nocauteado] Se o seu Líder for [Boa Hancock] ou multicolorido, compre 2 cartas.');
  });

  it('"base" nunca se perde: custo base e poder base fora do campo, "sem efeito base" (OP12-041, OP14-041, OP02-045, OP12-031)', () => {
    expect(pt('OP12-041', '[Activate: Main] [Once Per Turn] DON!! -1: Activate up to 1 {Straw Hat Crew} type Event with a base cost of 3 or less from your hand.')).toBe(
      '[Ativar: Principal] [Uma Vez por Turno] DON!! −1: Ative até 1 Evento do tipo {Straw Hat Crew} com custo base 3 ou menos da sua mão.',
    );
    expect(pt('OP14-041', "[Once Per Turn] When one of your {Amazon Lily} or {Kuja Pirates} type Characters with 5000 base power or more is K.O.'d add up to 1 card from the top of your opponent's Life cards to the owner's hand.")).toBe(
      '[Uma Vez por Turno] Quando um Personagem seu do tipo {Amazon Lily} ou {Kuja Pirates} com 5000 de poder base ou mais for nocauteado, o oponente coloca até 1 carta do topo da Vida dele na mão.',
    );
    expect(pt('OP02-045', '[Counter] Up to 1 of your Leader or Character cards gains +6000 power during this battle. Then, play up to 1 Character card with a cost of 3 or less and no base effect from your hand.', 'event')).toBe(
      '[Counter] Até 1 dos seus Líderes ou Personagens recebe +6000 de poder durante esta batalha. Depois, jogue até 1 Personagem com custo 3 ou menos e sem efeito base da sua mão.',
    );
    expect(pt('OP12-031', "[On Play] Rest up to 1 of your opponent's Characters with a base cost of 6 or less. Then, give up to 3 rested DON!! cards to your [Roronoa Zoro] Leader.")).toBe(
      '[Ao Jogar] Vire até 1 Personagem do oponente com custo base 6 ou menos. Depois, dê até 3 DON!! virados ao seu Líder [Roronoa Zoro].',
    );
  });

  it('o oponente é quem coloca a Vida dele na mão; "do seu descarte" no [On K.O.] do Marco; "e revela a mão" (OP13-108, OP16-014, OP07-090)', () => {
    expect(pt('OP13-108', '[On Play] Your opponent adds 1 card from the top of their Life cards to their hand.')).toBe('[Ao Jogar] O oponente coloca 1 carta do topo da Vida dele na mão.');
    expect(pt('OP16-014b', '[On K.O.] You may trash 1 Character card with 8000 power from your hand: Play this Character card from your trash.')).toBe(
      '[Ao ser Nocauteado] Você pode descartar 1 Personagem com 8000 de poder da sua mão: Jogue esta carta do seu descarte.',
    );
    expect(pt('OP07-090', '[On Play] Your opponent trashes 1 card from their hand and reveals their hand.')).toBe('[Ao Jogar] O oponente escolhe 1 carta da própria mão e a descarta, e depois revela a mão.');
  });
});
