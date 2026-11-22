import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { type CardSearchContext, hasSearchCode, matchesCardQuery, parseCardQuery, toggleSearchCode } from '../src/cardSearch';

const card = (over: Partial<CardData>): CardData => ({
  id: 'OP01-001',
  name: 'Carta',
  category: 'character',
  colors: ['red'],
  types: [],
  text: '',
  ...over,
});

const BLOCKER = '[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)';

const CARDS = [
  card({ id: 'OP01-006', name: 'Otama', cost: 1, power: 0, counter: 2000, rarity: 'UC', attributes: ['Special'], types: ['Land of Wano'], text: "[On Play] Give up to 1 of your opponent's Characters −2000 power during this turn." }),
  card({ id: 'OP01-013', name: 'Sanji', cost: 2, power: 4000, counter: 2000, rarity: 'R', attributes: ['Strike'], types: ['Straw Hat Crew'], text: '[DON!! x2] This Character gains [Rush]. (This card can attack on the turn in which it is played.)' }),
  card({ id: 'OP01-016', name: 'Nami', cost: 1, power: 2000, counter: 1000, rarity: 'R', attributes: ['Special'], types: ['East Blue', 'Straw Hat Crew'], text: '[On Play] Look at 5 cards from the top of your deck.' }),
  card({ id: 'OP01-025', name: 'Roronoa Zoro', cost: 3, power: 5000, counter: 0, rarity: 'SR', attributes: ['Slash'], types: ['Supernovas', 'Straw Hat Crew'], text: '[Rush] (This card can attack on the turn in which it is played.)' }),
  card({ id: 'OP01-026', name: 'Gum-Gum Fire-Fist Pistol Red Hawk', category: 'event', cost: 2, rarity: 'R', types: ['Straw Hat Crew'], text: "[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle.", trigger: '[Trigger] K.O. up to 1 of your opponent\'s Characters with 4000 power or less.' }),
  card({ id: 'OP01-001', name: 'Roronoa Zoro', category: 'leader', rarity: 'L', life: 5, power: 5000, attributes: ['Slash'], types: ['Supernovas', 'Straw Hat Crew'], text: '[DON!! x1] [Your Turn] All of your Characters gain +1000 power.' }),
  card({ id: 'OP02-001', name: 'Edward.Newgate', category: 'leader', rarity: 'L', life: 6, power: 6000, attributes: ['Special'], types: ['The Four Emperors', 'Whitebeard Pirates'], text: '[End of Your Turn] Add 1 card from the top of your Life cards to your hand.' }),
  card({ id: 'ST02-007', name: 'Jewelry Bonney', colors: ['green'], cost: 1, power: 1000, counter: 1000, rarity: 'C', attributes: ['Special'], types: ['Supernovas', 'Bonney Pirates'], text: '[Activate: Main] You may rest 1 of your DON!! cards and this Character: Look at 5 cards from the top of your deck.' }),
  card({ id: 'ST03-004', name: 'Gecko Moria', colors: ['blue'], cost: 4, power: 5000, counter: 1000, rarity: 'C', attributes: ['Special'], types: ['The Seven Warlords of the Sea', 'Thriller Bark Pirates'], text: '' }),
  card({ id: 'ST04-011', name: 'Black Maria', colors: ['purple'], cost: 3, power: 2000, counter: 1000, rarity: 'C', attributes: ['Special'], types: ['Animal Kingdom Pirates'], text: `${BLOCKER} [On Play] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): Draw 1 card.` }),
  card({ id: 'OP09-093', name: 'Marshall.D.Teach', colors: ['black'], cost: 10, power: 12000, rarity: 'SR', attributes: ['Special'], types: ['The Four Emperors', 'Blackbeard Pirates'], text: BLOCKER }),
  card({ id: 'OP06-022', name: 'Yamato', colors: ['green', 'yellow'], category: 'leader', rarity: 'L', life: 4, power: 5000, attributes: ['Strike'], types: ['Land of Wano'], text: '[Double Attack] (This card deals 2 damage.)' }),
  card({ id: 'P-041', name: 'Monkey.D.Luffy', cost: 5, power: 6000, counter: 0, rarity: 'P', attributes: ['Strike'], types: ['Supernovas', 'Straw Hat Crew'], text: "[When Attacking] Your opponent cannot activate a [Blocker] Character that has 2000 or less power during this battle." }),
  card({ id: 'OP18-023', name: 'Koby', colors: ['red', 'blue'], cost: 4, power: 5000, counter: 1000, rarity: 'UC', attributes: ['Strike'], types: ['Navy', 'East Blue'], text: '[On K.O.] Draw 1 card.', spoiler: { source: 'optcgleaks.com' } as CardData['spoiler'] }),
];

const search = (query: string, ctx: CardSearchContext = {}, aliases?: Record<string, string>) => {
  const q = parseCardQuery(query, aliases);
  return CARDS.filter((c) => matchesCardQuery(c, q, ctx)).map((c) => c.id);
};

describe('custo e Counter', () => {
  it('c<número> filtra o custo', () => {
    expect(search('c1')).toEqual(['OP01-006', 'OP01-016', 'ST02-007']);
    expect(search('c10')).toEqual(['OP09-093']);
    expect(search('c9')).toEqual([]);
  });

  it('c1000 e c2000 filtram o Counter', () => {
    expect(search('c2000')).toEqual(['OP01-006', 'OP01-013']);
    expect(search('c1000')).toEqual(['OP01-016', 'ST02-007', 'ST03-004', 'ST04-011', 'OP18-023']);
  });

  it('custo e Counter juntos se combinam, em qualquer ordem', () => {
    expect(search('c1 c2000')).toEqual(['OP01-006']);
    expect(search('c2000 c1')).toEqual(['OP01-006']);
    expect(search('c3 c2000')).toEqual([]);
  });

  it('atalhos do mesmo tipo somam', () => {
    expect(search('c1 c2')).toEqual(['OP01-006', 'OP01-013', 'OP01-016', 'OP01-026', 'ST02-007']);
    expect(search('c1 c2 c2000')).toEqual(['OP01-006', 'OP01-013']);
  });

  it('faixas: c3+ (3 ou mais), c3- (até 3), c2-4 (de 2 a 4)', () => {
    expect(search('c4+')).toEqual(['ST03-004', 'OP09-093', 'P-041', 'OP18-023']);
    expect(search('c1-')).toEqual(['OP01-006', 'OP01-016', 'ST02-007']);
    expect(search('c3-4')).toEqual(['OP01-025', 'ST03-004', 'ST04-011', 'OP18-023']);
    expect(search('c1000+ c3-4')).toEqual(['ST03-004', 'ST04-011', 'OP18-023']);
  });

  it('c0000 e sc trazem as cartas sem Counter', () => {
    const none = ['OP01-025', 'OP01-026', 'OP01-001', 'OP02-001', 'OP09-093', 'OP06-022', 'P-041'];
    expect(search('c0000')).toEqual(none);
    expect(search('sc')).toEqual(none);
    expect(search('sc char')).toEqual(['OP01-025', 'OP09-093', 'P-041']);
    // c0 continua sendo custo 0.
    expect(search('c0')).toEqual([]);
  });

  it('carta sem custo não entra no filtro de custo', () => {
    expect(search('c5-')).not.toContain('OP01-001');
  });
});

describe('poder e vida', () => {
  it('p5000 filtra o poder, e p5 é o mesmo', () => {
    const five = ['OP01-025', 'OP01-001', 'ST03-004', 'OP06-022', 'OP18-023'];
    expect(search('p5000')).toEqual(five);
    expect(search('p5')).toEqual(five);
    expect(search('p0')).toEqual(['OP01-006']);
  });

  it('faixas de poder', () => {
    expect(search('p6000+')).toEqual(['OP02-001', 'OP09-093', 'P-041']);
    expect(search('p6+')).toEqual(['OP02-001', 'OP09-093', 'P-041']);
    expect(search('p1000-2000')).toEqual(['OP01-016', 'ST02-007', 'ST04-011']);
    // Evento não tem poder.
    expect(search('p4000-')).not.toContain('OP01-026');
  });

  it('v4 (ou l4) filtra a vida do Líder e pede Líderes ao catálogo', () => {
    expect(search('v4')).toEqual(['OP06-022']);
    expect(search('l5+')).toEqual(['OP01-001', 'OP02-001']);
    expect(parseCardQuery('v4').wantsLeaders).toBe(true);
    expect(parseCardQuery('leader').wantsLeaders).toBe(true);
    expect(parseCardQuery('c3').wantsLeaders).toBe(false);
    expect(parseCardQuery('-leader').wantsLeaders).toBe(false);
  });
});

describe('características da carta', () => {
  it('cor por nome, em português e por letra', () => {
    expect(search('green')).toEqual(['ST02-007', 'OP06-022']);
    expect(search('verde')).toEqual(['ST02-007', 'OP06-022']);
    expect(search('g')).toEqual(['ST02-007', 'OP06-022']);
    // Convenção dos card games: u é azul, b é preto.
    expect(search('r')).toEqual(search('red'));
    expect(search('u')).toEqual(['ST03-004', 'OP18-023']);
    expect(search('p')).toEqual(['ST04-011']);
    expect(search('b')).toEqual(['OP09-093']);
    expect(search('y')).toEqual(['OP06-022']);
    expect(search('g y')).toEqual(['OP06-022']);
  });

  it('duas cores trazem só as cartas com as duas', () => {
    expect(search('red blue')).toEqual(['OP18-023']);
    expect(search('green yellow')).toEqual(['OP06-022']);
  });

  it('nomes de cor e de categoria no idioma em vigor', () => {
    const aliases = { Rouge: 'red', Bleu: 'blue', Événements: 'event' };
    expect(search('rouge bleu', {}, aliases)).toEqual(['OP18-023']);
    expect(search('evenements', {}, aliases)).toEqual(['OP01-026']);
  });

  it('categoria', () => {
    expect(search('event')).toEqual(['OP01-026']);
    expect(search('evento')).toEqual(['OP01-026']);
    expect(search('lider')).toEqual(['OP01-001', 'OP02-001', 'OP06-022']);
    expect(search('event leader')).toEqual(['OP01-026', 'OP01-001', 'OP02-001', 'OP06-022']);
    expect(search('char c10')).toEqual(['OP09-093']);
  });

  it('atributo (a carta precisa ter todos os pedidos)', () => {
    expect(search('slash')).toEqual(['OP01-025', 'OP01-001']);
    expect(search('strike c4+')).toEqual(['P-041', 'OP18-023']);
    expect(search('slash strike')).toEqual([]);
  });

  it('raridade', () => {
    expect(search('sr')).toEqual(['OP01-025', 'OP09-093']);
    expect(search('uc')).toEqual(['OP01-006', 'OP18-023']);
    expect(search('common')).toEqual(['ST02-007', 'ST03-004', 'ST04-011']);
    expect(search('promo')).toEqual(['P-041']);
    expect(search('r:l')).toEqual(['OP01-001', 'OP02-001', 'OP06-022']);
    expect(search('sr uc')).toEqual(['OP01-006', 'OP01-025', 'OP09-093', 'OP18-023']);
  });

  it('coleção', () => {
    expect(search('st02')).toEqual(['ST02-007']);
    expect(search('st02 st03')).toEqual(['ST02-007', 'ST03-004']);
    expect(search('s:p')).toEqual(['P-041']);
    expect(search('op01 c1')).toEqual(['OP01-006', 'OP01-016']);
  });
});

describe('efeitos', () => {
  it('palavra-chave: só a carta que tem, não a que cita', () => {
    expect(search('blocker')).toEqual(['ST04-011', 'OP09-093']);
    // A promo do Luffy cita [Blocker] no texto, mas não é Blocker.
    expect(search('"blocker"')).toEqual(['ST04-011', 'OP09-093', 'P-041']);
    expect(search('double')).toEqual(['OP06-022']);
  });

  it('palavra-chave que a carta dá a si mesma sob condição também conta', () => {
    expect(search('rush')).toEqual(['OP01-013', 'OP01-025']);
  });

  it('trigger traz as cartas com [Trigger]', () => {
    expect(search('trigger')).toEqual(['OP01-026']);
  });

  it('momento do efeito', () => {
    expect(search('onplay')).toEqual(['OP01-006', 'OP01-016', 'ST04-011']);
    expect(search('onko')).toEqual(['OP18-023']);
    expect(search('whenattacking')).toEqual(['P-041']);
    expect(search('counter')).toEqual(['OP01-026']);
    expect(search('activate')).toEqual(['ST02-007']);
    expect(search('endofturn')).toEqual(['OP02-001']);
    expect(search('yourturn')).toEqual(['OP01-001']);
  });

  it('don2 e don-1', () => {
    expect(search('don2')).toEqual(['OP01-013']);
    expect(search('don1')).toEqual(['OP01-001']);
    expect(search('don-1')).toEqual(['ST04-011']);
    expect(search('don-2')).toEqual([]);
  });

  it('vanilla: sem efeito', () => {
    expect(search('vanilla')).toEqual(['ST03-004']);
  });
});

describe('ligados ao deck', () => {
  it('indeck usa o deck em edição', () => {
    const inDeck = (id: string) => id === 'OP01-016' || id === 'OP01-001';
    expect(search('indeck', { inDeck })).toEqual(['OP01-016', 'OP01-001']);
    expect(search('-indeck c1', { inDeck })).toEqual(['OP01-006', 'ST02-007']);
    expect(search('indeck')).toEqual([]);
  });

  it('banned, legal e rotated olham o Standard', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    // ST10-001 está banida; o bloco ① (OP01) rotacionou, menos as exceções (a Nami OP01-016).
    const cards = [card({ id: 'ST10-001' }), card({ id: 'OP01-006' }), card({ id: 'OP01-016' }), card({ id: 'OP09-093' })];
    const ids = (query: string) => cards.filter((c) => matchesCardQuery(c, parseCardQuery(query), { now })).map((c) => c.id);
    expect(ids('banned')).toEqual(['ST10-001']);
    expect(ids('banida')).toEqual(['ST10-001']);
    expect(ids('rotated')).toEqual(['OP01-006']);
    expect(ids('legal')).toEqual(['OP01-016', 'OP09-093']);
    expect(ids('-legal')).toEqual(['ST10-001', 'OP01-006']);
  });

  it('allblue traz o que vale no All Blue: C, UC, R, promo e os Líderes', () => {
    const ids = (query: string) => CARDS.filter((c) => matchesCardQuery(c, parseCardQuery(query))).map((c) => c.id);
    const out = CARDS.filter((c) => c.rarity === 'SR' || c.rarity === 'SEC').map((c) => c.id);
    expect(out.length).toBeGreaterThan(0);
    expect(ids('-allblue leader char event stage').sort()).toEqual([...out].sort());
    expect(ids('allblue sr')).toEqual([]);
    // Os Líderes entram na busca quando pedidos; no All Blue todos valem.
    expect(ids('allblue leader')).toEqual(CARDS.filter((c) => c.category === 'leader').map((c) => c.id));
    // A promo vale; a banida pela Bandai também (a lista dela não se aplica ao All Blue).
    expect(ids('allblue promo')).toEqual(['P-041']);
    expect(matchesCardQuery(card({ id: 'OP06-116', rarity: 'R', category: 'event' }), parseCardQuery('allblue'))).toBe(true);
  });

  it('new traz as cartas ainda não lançadas', () => {
    expect(search('new')).toEqual(['OP18-023']);
    expect(search('spoiler')).toEqual(['OP18-023']);
  });
});

describe('operadores', () => {
  it('-atalho e -palavra excluem', () => {
    expect(search('c3 -blocker')).toEqual(['OP01-025']);
    expect(search('supernovas -zoro')).toEqual(['ST02-007', 'P-041']);
    expect(search('-char -leader')).toEqual(['OP01-026']);
    expect(search('c1 -c2000')).toEqual(['OP01-016', 'ST02-007']);
  });

  it('"-" só exclui diante de uma palavra', () => {
    // "−2000" do texto da Otama usa o sinal tipográfico; "-1" sozinho continua sendo texto.
    expect(search('-1')).toEqual(CARDS.filter((c) => /-1/.test(`${c.id} ${c.text}`)).map((c) => c.id));
  });

  it('palavras soltas valem em qualquer ordem; entre aspas, a frase exata', () => {
    expect(search('hat straw c2000')).toEqual(['OP01-013']);
    expect(search('"hat straw"')).toEqual([]);
    expect(search('"straw hat" c2000')).toEqual(['OP01-013']);
    expect(search('straw c2000 hat')).toEqual(['OP01-013']);
    // Aspas ainda abertas (digitando) já valem.
    expect(search('"gecko mor')).toEqual(['ST03-004']);
  });

  it('n: só no nome, t: só no tipo', () => {
    expect(search('moria')).toEqual(['ST03-004']);
    expect(search('blackbeard')).toEqual(['OP09-093']);
    expect(search('n:blackbeard')).toEqual([]);
    expect(search('t:blackbeard')).toEqual(['OP09-093']);
    expect(search('n:zoro')).toEqual(['OP01-025', 'OP01-001']);
    expect(search('t:"four emperors"')).toEqual(['OP02-001', 'OP09-093']);
    expect(search('-t:"straw hat" c1')).toEqual(['OP01-006', 'ST02-007']);
  });

  it('busca por número e sem acento', () => {
    expect(search('op01-02')).toEqual(['OP01-025', 'OP01-026']);
    expect(search('ROROnoa')).toEqual(['OP01-025', 'OP01-001']);
  });
});

describe('palavra de atalho que faz parte de um nome', () => {
  it('colada na palavra vizinha, continua achando o nome ou o tipo', () => {
    // "blue" é cor, mas "east blue" é um tipo: traz a Nami vermelha e o Koby.
    expect(search('east blue')).toEqual(['OP01-016', 'OP18-023']);
    // A Black Maria é roxa.
    expect(search('black maria')).toEqual(['ST04-011']);
    expect(search('red hawk')).toEqual(['OP01-026']);
    expect(search('east blue c4')).toEqual(['OP18-023']);
  });

  it('sozinha, é só o atalho', () => {
    expect(search('black')).toEqual(['OP09-093']);
    expect(search('blue')).toEqual(['ST03-004', 'OP18-023']);
  });
});

describe('o que não é atalho', () => {
  it('só a palavra inteira no formato do atalho', () => {
    expect(search('c c3x xc3')).toEqual([]);
    expect(parseCardQuery('c3x').terms).toHaveLength(1);
  });

  it('busca vazia aceita tudo', () => {
    expect(search('')).toHaveLength(CARDS.length);
    expect(search('   ')).toHaveLength(CARDS.length);
    expect(search('n: -')).toHaveLength(CARDS.filter((c) => `${c.id} ${c.text}`.includes('-')).length);
  });
});

describe('painel de atalhos', () => {
  it('põe o atalho no fim da busca e tira se já estiver lá', () => {
    expect(toggleSearchCode('', 'c3')).toBe('c3');
    expect(toggleSearchCode('luffy  ', 'c3')).toBe('luffy c3');
    expect(toggleSearchCode('luffy c3 red', 'c3')).toBe('luffy red');
    expect(toggleSearchCode('C3', 'c3')).toBe('');
    expect(toggleSearchCode('c3 "straw hat" red', '"straw hat"')).toBe('c3 red');
  });

  it('só conta o atalho como palavra inteira', () => {
    expect(hasSearchCode('c3+ red', 'c3')).toBe(false);
    expect(hasSearchCode('c3+ red', 'c3+')).toBe(true);
    expect(hasSearchCode('-blocker', 'blocker')).toBe(false);
    expect(toggleSearchCode('c3+', 'c3')).toBe('c3+ c3');
  });
});
