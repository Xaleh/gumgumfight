// Tradução automática (baseada em regras) dos textos das cartas para português.
//
// Os textos de One Piece Card Game seguem modelos bem fixos ("K.O. up to 1 of your
// opponent's Characters with a cost of 3 or less."), então um conjunto de regras de
// frases cobre boa parte das cartas sem depender de serviço externo. O que não for
// reconhecido fica em inglês e o resultado é marcado como parcial; traduções manuais
// (data/translations/pt.json) sempre têm prioridade.

import { splitEffects } from '../cards/split';
import { normalizeTypeQuotes } from '../text';

export interface Translation {
  text: string;
  /** false quando sobrou trecho em inglês. */
  complete: boolean;
}

const TAGS: Array<[RegExp, string]> = [
  [/\[Activate: ?Main\]/g, '[Ativar: Principal]'],
  [/\[Main\]/g, '[Principal]'],
  [/\[On Play\]/g, '[Ao Jogar]'],
  [/\[When Attacking\]/g, '[Ao Atacar]'],
  [/\[On K\.O\.\]/g, '[Ao ser Nocauteado]'],
  [/\[On Block\]/g, '[Ao Bloquear]'],
  [/\[Once Per Turn\]/g, '[Uma Vez por Turno]'],
  [/\[Your Turn\]/g, '[Seu Turno]'],
  [/\[Opponent's Turn\]/g, '[Turno do Oponente]'],
  [/\[End of Your Turn\]/g, '[Fim do Seu Turno]'],
  [/\[On Your Opponent's Attack\]/g, '[No Ataque do Oponente]'],
];

/** Textos de lembrete das palavras-chave, traduzidos inteiros. */
const REMINDERS: Array<[RegExp, string]> = [
  [/\(This card can attack on the turn in which it is played\.\)/g, '(Esta carta pode atacar no turno em que for jogada.)'],
  [
    /\(After your opponent declares an attack, you may rest this card to make it the new target of the attack\.\)/g,
    '(Depois que o oponente declarar um ataque, você pode virar esta carta para torná-la o novo alvo do ataque.)',
  ],
  [/\(This card deals 2 damage\.\)/g, '(Esta carta causa 2 de dano.)'],
  [
    /\(This card can attack Characters on the turn in which it is played\.\)/g,
    '(Esta carta pode atacar Personagens no turno em que for jogada.)',
  ],
  [
    /\(When this card deals damage, the target card is trashed without activating its Trigger\.\)/g,
    '(Quando esta carta causa dano, a carta de Vida vai para o descarte sem ativar seu [Trigger].)',
  ],
  [
    /\(You may rest the specified number of DON!! cards in your cost area\.?\)/g,
    '(Você pode virar a quantidade indicada de DON!! da sua área de custo.)',
  ],
  [
    /\(You may return the specified number of DON!! cards from your field to your DON!! deck\.?\)/g,
    '(Você pode devolver a quantidade indicada de DON!! do seu campo para o seu deck de DON!!.)',
  ],
];

const plural = (n: string | number, one: string, many: string) => (Number(n) === 1 ? one : many);
const COLOR_PT: Record<string, string> = {
  red: 'vermelho',
  green: 'verde',
  blue: 'azul',
  purple: 'roxo',
  black: 'preto',
  yellow: 'amarelo',
};
/** Condição solta ("you have 5 or more cards in your hand") usando as mesmas regras do "If …,". */
const condPt = (cond: string) =>
  applyPhrases(`If ${cond}, `)
    .replace(/^Se /, '')
    .replace(/,\s*$/, '');
const manyTargets = (who: string) => {
  if (/Leaders and Characters/i.test(who)) return true;
  const n = who.match(/up to (\d+)/i);
  return n ? Number(n[1]) > 1 : /\b(cards|Characters)\b/.test(who) && !/\b1 of\b/.test(who);
};

type Rule = [RegExp, string | ((...m: string[]) => string)];

/** Regras de frase inteira (verbo no início). Aplicadas uma vez, na ordem. */
const SENTENCES: Rule[] = [
  [/^Draw (\d+) cards?\.?$/i, (_, n) => `Compre ${n} ${plural(n, 'carta', 'cartas')}.`],
  [/^Draw a card\.?$/i, 'Compre 1 carta.'],
  [
    /^Draw (\d+) cards? if you have (\d+) or (more|less) (cards in your hand|DON!! cards on your field|Life cards)\.?$/i,
    (_, n, m, q, what) =>
      `Compre ${n} ${plural(n, 'carta', 'cartas')} se você tiver ${m} ou ${/more/i.test(q) ? 'mais' : 'menos'} ${
        /hand/i.test(what) ? 'cartas na mão' : /DON/i.test(what) ? 'DON!! no seu campo' : 'cartas de Vida'
      }.`,
  ],
  [/^shuffle your deck\.?$/i, 'Embaralhe o seu deck.'],
  [
    /^Reveal (.+?) from your deck and add (?:it|them) to your hand\.?$/i,
    (_, what) => `Revele ${what} do seu deck e adicione à sua mão.`,
  ],
  [
    /^Your opponent trashes (\d+) cards? from their hand\.?$/i,
    (_, n) => `Seu oponente descarta ${n} ${plural(n, 'carta', 'cartas')} da mão.`,
  ],
  [
    /^(.+?) can also attack your opponent's active Characters during this turn\.?$/i,
    (_, who) => `${who} também pode atacar Personagens ativos do oponente durante este turno.`,
  ],
  [
    /^(.+?) cannot attack until the end of your opponent's next turn\.?$/i,
    (_, who) => `${who} não pode atacar até o fim do próximo turno do oponente.`,
  ],
  [
    /^(.+?) gains? an additional \+(\d+) power(?: (during this turn|during this battle))?\.?$/i,
    (_, who, n, dur) => `${who} recebe mais +${n} de poder${dur ? ` ${dur}` : ''}.`,
  ],
  [
    /^Look at (\d+) cards from the top of your deck; play (.+?)\.?$/i,
    (_, n, what) => `Olhe as ${n} cartas do topo do seu deck; jogue ${what}.`,
  ],
  [
    /^Under the rules of this game, you may have any number of this card in your deck\.?$/i,
    'Pelas regras do jogo, você pode ter qualquer quantidade desta carta no deck.',
  ],
  [
    /^Also treat this card's name as (\[[^\]]+\]) according to the rules\.?$/i,
    (_, n) => `Pelas regras, o nome desta carta também é considerado ${n}.`,
  ],
  [
    /^(.+?) cannot be K\.O\.'d in battle by "?(\w+)"? attribute (?:Characters|cards)\.?$/i,
    (_, who, attr) => `${who} não pode ser nocauteado em batalha por Personagens de atributo ${attr}.`,
  ],
  [
    /^(.+?) gains? (\[[^\]]+\]) if (.+?)\.?$/i,
    (_, who, kw, cond) => `${who} ganha ${kw} se ${condPt(cond)}.`,
  ],
  [
    /^Draw (\d+) cards? if you have (\d+) or less cards in your hand\.?$/i,
    (_, n, m) => `Compre ${n} ${plural(n, 'carta', 'cartas')} se você tiver ${m} ou menos cartas na mão.`,
  ],
  [
    /^Draw (\d+) cards? and trash (\d+) cards? from your hand\.?$/i,
    (_, n, m) => `Compre ${n} ${plural(n, 'carta', 'cartas')} e descarte ${m} ${plural(m, 'carta', 'cartas')} da sua mão.`,
  ],
  [
    /^Give (.+?) up to (\d+) rested DON!! cards?\.?$/i,
    (_, who, n) => `Dê até ${n} DON!! ${plural(n, 'virado', 'virados')} a ${who}.`,
  ],
  [
    /^Give up to (\d+) rested DON!! cards? to (.+?)\.?$/i,
    (_, n, who) => `Dê até ${n} DON!! ${plural(n, 'virado', 'virados')} a ${who}.`,
  ],
  [/^K\.O\. (.+?)\.?$/, (_, who) => `Nocauteie (K.O.) ${who}.`],
  [/^Rest (.+?)\.?$/i, (_, who) => `Vire ${who}.`],
  [/^Set (.+?) as active\.?$/i, (_, who) => `Deixe ${who} ativo.`],
  [/^Return (.+?) to (?:the owner's|its owner's) hand\.?$/i, (_, who) => `Devolva ${who} à mão do dono.`],
  [/^Play (.+?) from your hand\.?$/i, (_, what) => `Jogue ${what} da sua mão.`],
  [
    /^Play (.+?) from your deck, then shuffle your deck\.?$/i,
    (_, what) => `Jogue ${what} do seu deck e depois embaralhe o seu deck.`,
  ],
  [/^Place (.+?) at the bottom of the owner's deck\.?$/i, (_, who) => `Coloque ${who} no fundo do deck do dono.`],
  [/^Add (.+?) from your trash to your hand\.?$/i, (_, what) => `Adicione ${what} do seu descarte à sua mão.`],
  [
    /^Look at (\d+) cards from the top of your deck and return them to the top or bottom of the deck in any order\.?$/i,
    (_, n) => `Olhe as ${n} cartas do topo do seu deck e devolva-as ao topo ou ao fundo do deck, em qualquer ordem.`,
  ],
  [/^Play this card\.?$/i, 'Jogue esta carta.'],
  [/^Add this card to your hand\.?$/i, 'Adicione esta carta à sua mão.'],
  [/^Activate this card's \[(Main|Counter)\] effect\.?$/i, (_, t) => `Ative o efeito [${t}] desta carta.`],
  [
    /^Trash (\d+) cards? from your hand\.?$/i,
    (_, n) => `Descarte ${n} ${plural(n, 'carta', 'cartas')} da sua mão.`,
  ],
  [
    /^Add (up to )?(\d+) DON!! cards? from your DON!! deck and (?:set (?:it|them) as active|rest (?:it|them))\.?$/i,
    (m, upTo, n) =>
      `Adicione ${upTo ? 'até ' : ''}${n} DON!! do seu deck de DON!! ${/active/i.test(m) ? 'como ativo' : 'virado'}${Number(n) > 1 ? 's' : ''}.`,
  ],
  [
    /^Look at (\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to your hand\.?$/i,
    (_, n, m, what) => `Olhe as ${n} cartas do topo do seu deck; revele até ${m} ${what} e adicione à sua mão.`,
  ],
  [/^Place the rest at the bottom of your deck in any order\.?$/i, 'Coloque o resto no fundo do seu deck em qualquer ordem.'],
  [
    /^Look at (\d+) cards from the top of your deck and (?:return|place) them (?:at|to) the top or bottom of the deck in any order\.?$/i,
    (_, n) => `Olhe as ${n} cartas do topo do seu deck e devolva-as ao topo ou ao fundo do deck, em qualquer ordem.`,
  ],
  [/^Trash the rest\.?$/i, 'Descarte o resto.'],
  [
    /^Trash up to (\d+) of your opponent's Life cards?\.?$/i,
    (_, n) => `Descarte até ${n} ${plural(n, 'carta', 'cartas')} de Vida do oponente.`,
  ],
  [
    /^Your opponent cannot activate a \[Blocker\] Character that has (\d+) or more power during this battle\.?$/i,
    (_, n) => `Seu oponente não pode ativar um Personagem com [Blocker] que tenha ${n} ou mais de poder durante esta batalha.`,
  ],
  [
    /^Your opponent cannot activate a \[Blocker\] Character that has (\d+) or less power during this battle\.?$/i,
    (_, n) => `Seu oponente não pode ativar um Personagem com [Blocker] que tenha ${n} ou menos de poder durante esta batalha.`,
  ],
  [
    /^Your opponent cannot activate \[Blocker\] during this battle\.?$/i,
    'Seu oponente não pode ativar [Blocker] durante esta batalha.',
  ],
  [
    /^Your opponent cannot activate \[Blocker\] if that Leader or Character attacks during this turn\.?$/i,
    'Seu oponente não pode ativar [Blocker] se esse Líder ou Personagem atacar durante este turno.',
  ],
  [
    /^This Character can also attack your opponent's active Characters\.?$/i,
    'Este Personagem também pode atacar Personagens ativos do oponente.',
  ],
  [/^Select (.+?)\.?$/i, (_, who) => `Escolha ${who}.`],
  [/^(.+?) cannot be K\.O\.'d in battle\.?$/i, (_, who) => `${who} não pode ser nocauteado em batalha.`],
  [/^(.+?) cannot be K\.O\.'d by effects\.?$/i, (_, who) => `${who} não pode ser nocauteado por efeitos.`],
  [
    /^none of your Characters can be K\.O\.'d during this turn\.?$/i,
    'Nenhum dos seus Personagens pode ser nocauteado durante este turno.',
  ],
  [
    /^Give (.+?) [−-]?(\d+) (power|cost)(?: (during this turn|during this battle))?\.?$/i,
    (_, who, n, what, dur) => `Dê −${n} de ${what.toLowerCase() === 'power' ? 'poder' : 'custo'} a ${who}${dur ? ` ${dur}` : ''}.`,
  ],
  [
    /^Your opponent chooses (\d+) cards? from their hand and trashes (?:it|them)\.?$/i,
    (_, n) => `Seu oponente escolhe ${n} ${plural(n, 'carta', 'cartas')} da própria mão e ${plural(n, 'a descarta', 'as descarta')}.`,
  ],
  [/^Trash (\d+) cards? from the top of your deck\.?$/i, (_, n) => `Descarte ${n} ${plural(n, 'carta', 'cartas')} do topo do seu deck.`],
  [
    /^Add up to (\d+) cards? from the top of your deck to the top of your Life cards\.?$/i,
    (_, n) => `Adicione até ${n} ${plural(n, 'carta', 'cartas')} do topo do seu deck ao topo das suas cartas de Vida.`,
  ],
  [/^Activate this card's \[On Play\] effect\.?$/i, 'Ative o efeito [Ao Jogar] desta carta.'],
  [/^Activate this card's \[On K\.O\.\] effect\.?$/i, 'Ative o efeito [Ao ser Nocauteado] desta carta.'],
  [/^(.+?) gains? \+(\d+) cost\.?$/i, (_, who, n) => `${who} recebe +${n} de custo.`],
  [/^(.+?) cannot attack\.?$/i, (_, who) => `${who} não pode atacar.`],
  [
    /^(.+?) cannot be K\.O\.'d(?: (during this turn))?\.?$/i,
    (_, who, dur) => `${who} não pode ser nocauteado${dur ? ` ${dur}` : ''}.`,
  ],
  [
    /^(.+?) gains? \+(\d+) power(?: (during this turn|during this battle|until the end of your opponent's next turn))?\.?$/i,
    (_, who, n, dur) => `${who} ${manyTargets(who) ? 'recebem' : 'recebe'} +${n} de poder${dur ? ` ${dur}` : ''}.`,
  ],
  [/^(.+?) gains? (\[[^\]]+\])(?: (during this turn))?\.?$/i, (_, who, kw, dur) => `${who} ganha ${kw}${dur ? ` ${dur}` : ''}.`],
];

/** Regras de trechos (sujeitos, filtros, durações). Aplicadas em sequência. */
const typeList = (list: string) => list.replace(/\s+or\s+/g, ' ou ').replace(/\s+and\s+/g, ' e ');

const PHRASES: Rule[] = [
  [/If you have (\d+) or less Life cards,\s*/gi, (_, n) => `Se você tiver ${n} ou menos cartas de Vida, `],
  [/If you have (\d+) or more Characters,\s*/gi, (_, n) => `Se você tiver ${n} ou mais Personagens, `],
  [/If this Character is rested,\s*/gi, 'Se este Personagem estiver virado, '],
  [/If you have (\d+) or more DON!! cards on your field,\s*/gi, (_, n) => `Se você tiver ${n} ou mais DON!! no seu campo, `],
  [/If you have (\d+) DON!! cards on your field,\s*/gi, (_, n) => `Se você tiver ${n} DON!! no seu campo, `],
  [/If you don't have (\[[^\]]+\]),\s*/gi, (_, n) => `Se você não tiver ${n}, `],
  [/If you have (\d+) or more rested Characters,\s*/gi, (_, n) => `Se você tiver ${n} ou mais Personagens virados, `],
  [/If your opponent has (\d+) or more rested Characters,\s*/gi, (_, n) => `Se o seu oponente tiver ${n} ou mais Personagens virados, `],
  [/If you have (\d+) or (more|less) cards in your hand,\s*/gi, (_, n, q) => `Se você tiver ${n} ou ${/more/i.test(q) ? 'mais' : 'menos'} cartas na mão, `],
  [/You may add (\d+) cards? from (?:the top of )?your Life (?:area|cards) to your hand/gi, (_, n) => `Você pode colocar ${n} ${plural(n, 'carta', 'cartas')} da sua Vida na mão`],
  [/You may place (\d+) cards? from your hand at the bottom of your deck/gi, (_, n) => `Você pode colocar ${n} ${plural(n, 'carta', 'cartas')} da sua mão no fundo do deck`],
  [/You may rest (\d+) of your Characters/gi, (_, n) => `Você pode virar ${n} dos seus Personagens`],
  [/You may rest (\d+) of your DON!! cards?/gi, (_, n) => `Você pode virar ${n} dos seus DON!!`],
  [
    /You may trash (\d+) ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type cards? from your hand/gi,
    (_, n, t) => `Você pode descartar ${n} ${plural(n, 'carta', 'cartas')} do tipo ${typeList(t)} da sua mão`,
  ],
  [/All Characters other than this Character/gi, 'todos os Personagens exceto este'],
  [/all of your opponent's Characters/gi, 'todos os Personagens do oponente'],
  [/All of your Characters/gi, 'Todos os seus Personagens'],
  [/The selected Character/gi, 'O Personagem escolhido'],

  [/If your opponent has more DON!! cards on their field than you,\s*/gi, 'Se o seu oponente tiver mais DON!! no campo do que você, '],
  [/If that card is a Character,\s*/gi, 'Se essa carta for um Personagem, '],
  [/If there is a Character with a cost of (\d+)( or more| or less)?,\s*/gi, (_, n, q) => `Se houver um Personagem com custo ${n}${q ? (/more/i.test(q) ? ' ou mais' : ' ou menos') : ''}, `],
  [
    /You may trash (\d+) cards? from your hand and rest this (Character|Stage|card)/gi,
    (_, n, w) => `Você pode descartar ${n} ${plural(n, 'carta', 'cartas')} da sua mão e virar ${w === 'Stage' ? 'este Stage' : w === 'card' ? 'esta carta' : 'este Personagem'}`,
  ],
  [/up to (\d+) of your opponent's active Characters/gi, (_, n) => `até ${n} ${plural(n, 'Personagem ativo', 'Personagens ativos')} do oponente`],
  [
    /When this Character battles "?([A-Za-z]+)"? attribute Characters,\s*/gi,
    (_, attr) => `Quando este Personagem batalhar com Personagens de atributo ${attr}, `,
  ],
  [
    /You may rest this Character and trash (\d+) ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type cards? from your hand/gi,
    (_, n, t) => `Você pode virar este Personagem e descartar ${n} ${plural(n, 'carta', 'cartas')} do tipo ${typeList(t)} da sua mão`,
  ],
  [
    /All of your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Characters/gi,
    (_, t) => `Todos os seus Personagens do tipo ${typeList(t)}`,
  ],
  [/that Character/gi, 'esse Personagem'],
  [/If your Leader has the (\{[^}]+\}) type,\s*/gi, (_, t) => `Se o seu Líder tiver o tipo ${t}, `],
  [/If this Character battles your opponent's Character,\s*/gi, 'Se este Personagem batalhar com um Personagem do oponente, '],
  [/You may rest this card/gi, 'Você pode virar esta carta'],
  [/up to (\d+) of your opponent's \[Blocker\] Characters/gi, (_, n) => `até ${n} ${plural(n, 'Personagem', 'Personagens')} com [Blocker] do oponente`],
  [/up to (\d+) of your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type rested Characters/gi, (_, n, t) => `até ${n} dos seus Personagens virados do tipo ${typeList(t)}`],
  [/your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Leaders and Characters/gi, (_, t) => `seus Líderes e Personagens do tipo ${typeList(t)}`],
  [/on your field/gi, 'no seu campo'],
  [/If your Leader is \[([^\]]+)\],\s*/gi, (_, n) => `Se o seu Líder for [${n}], `],
  [/You may rest this (Character|Stage|Leader)/gi, (_, w) => `Você pode virar ${w === 'Stage' ? 'este Stage' : w === 'Leader' ? 'este Líder' : 'este Personagem'}`],
  [/You may trash (\d+) cards? from your hand/gi, (_, n) => `Você pode descartar ${n} ${plural(n, 'carta', 'cartas')} da sua mão`],
  [/up to (\d+) of your Leader or Character cards/gi, (_, n) => `até ${n} ${plural(n, 'dos seus Líderes ou Personagens', 'dos seus Líderes ou Personagens')}`],
  [/up to (\d+) (\{[^}]+\}) type Leader or Character cards?/gi, (_, n, t) => `até ${n} Líder ou Personagem do tipo ${t}`],
  [/up to (\d+) of your (\{[^}]+\}) type Leader or Character cards/gi, (_, n, t) => `até ${n} dos seus Líderes ou Personagens do tipo ${t}`],
  [/up to (\d+) of your opponent's rested Characters/gi, (_, n) => `até ${n} ${plural(n, 'Personagem virado', 'Personagens virados')} do oponente`],
  [/up to (\d+) of your opponent's Characters/gi, (_, n) => `até ${n} ${plural(n, 'Personagem', 'Personagens')} do oponente`],
  [/up to (\d+) of your opponent's Leader or Character cards/gi, (_, n) => `até ${n} ${plural(n, 'Líder ou Personagem', 'Líderes ou Personagens')} do oponente`],
  [
    /up to (\d+) of your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Character cards/gi,
    (_, n, t) => `até ${n} dos seus Personagens do tipo ${typeList(t)}`,
  ],
  [/up to (\d+) active Characters?/gi, (_, n) => `até ${n} ${plural(n, 'Personagem ativo', 'Personagens ativos')}`],
  [/up to (\d+) cards? with a cost of/gi, (_, n) => `até ${n} ${plural(n, 'carta', 'cartas')} with a cost of`],
  [
    /up to (\d+) (red|green|blue|purple|black|yellow) Character cards?/gi,
    (_, n, c) => `até ${n} ${plural(n, 'Personagem', 'Personagens')} ${COLOR_PT[c.toLowerCase()]}`,
  ],
  [/up to (\d+) Events?/gi, (_, n) => `até ${n} ${plural(n, 'Evento', 'Eventos')}`],
  [
    /up to (\d+) ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Event cards?/gi,
    (_, n, t) => `até ${n} ${plural(n, 'Evento', 'Eventos')} do tipo ${typeList(t)}`,
  ],
  [
    /((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Event card/gi,
    (_, t) => `Evento do tipo ${typeList(t)}`,
  ],
  [
    /((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Character cards?/gi,
    (_, t) => `Personagem do tipo ${typeList(t)}`,
  ],
  [/up to (\d+) Character card/gi, (_, n) => `até ${n} Personagem`],
  [/ and (até \d+ Personage)/g, (_, rest) => ` e ${rest}`],
  [/up to (\d+) of your opponent's DON!! cards/gi, (_, n) => `até ${n} DON!! do oponente`],
  [/up to (\d+) of your DON!! cards/gi, (_, n) => `até ${n} dos seus DON!!`],
  [/up to (\d+) of your Characters/gi, (_, n) => `até ${n} dos seus Personagens`],
  [/up to (\d+) ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type Character(?: cards?)?/gi, (_, n, t) => `até ${n} ${plural(n, 'Personagem', 'Personagens')} do tipo ${typeList(t)}`],
  [/up to (\d+) (\{[^}]+\}) type cards?/gi, (_, n, t) => `até ${n} ${plural(n, 'carta', 'cartas')} do tipo ${t}`],
  [/(\{[^}]+\}) type cards/gi, (_, t) => `cartas do tipo ${t}`],
  [/(\{[^}]+\}) type card/gi, (_, t) => `carta do tipo ${t}`],
  [/up to (\d+) Characters?/gi, (_, n) => `até ${n} ${plural(n, 'Personagem', 'Personagens')}`],
  [/up to (\d+) (\[[^\]]+\])(?: cards?)?/gi, (_, n, name) => `até ${n} ${name}`],
  [/this Leader or 1 of your Characters/gi, 'este Líder ou 1 dos seus Personagens'],
  [/your Leader or 1 of your Characters/gi, 'seu Líder ou 1 dos seus Personagens'],
  // "or less than [Gecko Moria]": erro do texto da API para "or less other than [Gecko Moria]".
  [/with a cost of (\d+) or less (?:than|other than) (\[[^\]]+\])/gi, (_, n, name) => `com custo ${n} ou menos, exceto ${name}`],
  [/with a cost of (\d+) or less/gi, (_, n) => `com custo ${n} ou menos`],
  [/with a cost of (\d+) or more/gi, (_, n) => `com custo ${n} ou mais`],
  [/with a (?:base )?cost of (\d+)(?! or)/gi, (_, n) => `com custo ${n}`],
  [/with (\d+) power or less/gi, (_, n) => `com ${n} de poder ou menos`],
  [/with (\d+) power or more/gi, (_, n) => `com ${n} de poder ou mais`],
  [/and \[Blocker\]/g, 'e com [Blocker]'],
  [/other than this card/gi, 'exceto esta carta'],
  [/other than (\[[^\]]+\])/gi, (_, n) => `exceto ${n}`],
  [/during this turn/gi, 'durante este turno'],
  [/during this battle/gi, 'durante esta batalha'],
  [/until the end of your opponent's next turn/gi, 'até o fim do próximo turno do oponente'],
  [/until the start of your next turn/gi, 'até o início do seu próximo turno'],
  [/this Character/gi, 'este Personagem'],
  [/this Leader/gi, 'este Líder'],
  [/this Stage/gi, 'este Stage'],
  [/this card/gi, 'esta carta'],
  [/your Leader/gi, 'seu Líder'],
  [/your opponent/gi, 'seu oponente'],
  [/that card/gi, 'essa carta'],
  [/\bIt (?=recebe|ganha)/g, 'Ele '],
  [/\bup to (\d+) /gi, (_, n) => `até ${n} `],
];

// Palavras em inglês que denunciam trecho sem tradução (limites Unicode: "Até" não é "at").
const RESIDUE_WORDS =
  "the|your|of|up to|gains?|with|cards?|opponent's|this|and|from|power|cost|less|more|during|may|you|if|then|" +
  'character|characters|leader|rest|play|give|draw|trash|select|set|active|look|reveal|place|add|return|when|each|' +
  "all|can|cannot|instead|activate|effect|hand|top|bottom|order|shuffle|than|type|owner|to|at|in|any|or|it|them|card's";
const RESIDUE = new RegExp(`(?<!\\p{L})(${RESIDUE_WORDS})(?!\\p{L})`, 'iu');

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function applyPhrases(s: string): string {
  let out = s;
  for (const [re, rep] of PHRASES) out = out.replace(re, rep as never);
  return out.replace(/\ba seu\b/g, 'ao seu').replace(/\ba seus\b/g, 'aos seus');
}

function translateSentence(sentence: string): string {
  const s = sentence.trim();
  if (!s) return s;
  const ifm = s.match(/^if ([^,]+), (.+)$/i);
  if (ifm && /^if/.test(s)) {
    const rest = translateSentence(ifm[2]);
    return `se ${condPt(ifm[1])}, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  const then = s.match(/^Then,\s*(.+)$/i);
  if (then) {
    const rest = translateSentence(then[1]);
    return `Depois, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  for (const [re, rep] of SENTENCES) {
    const m = s.match(re);
    // Um trecho capturado com ", then …" são duas ações: tratadas juntas abaixo.
    if (m && !m.slice(1).some((g) => /, then /i.test(g ?? ''))) {
      const replaced = typeof rep === 'string' ? rep : rep(...(m as unknown as string[]));
      return capitalize(applyPhrases(replaced));
    }
  }
  // "X and Y." (duas ações): só se a segunda parte começar com uma ação conhecida.
  const andPair = s.match(/^(.+?) and ((?:draw|trash|rest|K\.O\.|give|add|play|return|set|none of|place)\b.+)$/i);
  if (andPair) {
    const first = translateSentence(andPair[1]).replace(/\.$/, '');
    const second = translateSentence(andPair[2]);
    if (!RESIDUE.test(first + second)) return `${first} e ${second.charAt(0).toLowerCase()}${second.slice(1)}`;
  }
  // "X, then Y." (duas ações na mesma frase)
  const pair = s.match(/^(.+?), then (.+)$/i);
  if (pair) {
    const first = translateSentence(pair[1]).replace(/\.$/, '');
    const second = translateSentence(pair[2]);
    return `${first} e depois ${second.charAt(0).toLowerCase()}${second.slice(1)}`;
  }
  return capitalize(applyPhrases(s));
}

/** Traduz um trecho sem tags: separa custo ("X: Y"), frases e condicionais. */
function translateBody(body: string): string {
  // Custo de ativação: "You may rest this Character: Give ..." / "① You may ...: ..."
  const cost = body.match(/^(You may [^:]+?):\s*(.*)$/);
  if (cost) return `${applyPhrases(cost[1])}: ${translateBody(cost[2])}`;

  // Condicional no início da frase.
  const cond = body.match(/^((?:If|When) [^,]+,)\s*(.*)$/);
  if (cond) {
    const rest = translateBody(cond[2]);
    return applyPhrases(cond[1] + ' ') + rest.charAt(0).toLowerCase() + rest.slice(1);
  }

  // Divide em frases sem quebrar em "K.O." (a próxima frase começa com maiúscula).
  const sentences = body.split(/(?<=[a-z0-9)\]}]\.)\s+(?=[A-Z[(])/);
  return sentences.map(translateSentence).join(' ');
}

function translateLine(line: string): string {
  // Continuação depois de um custo com lembrete: "③ (lembrete): Set this Leader as active."
  const afterCost = line.match(/^:\s*(.*)$/);
  if (afterCost) return `: ${translateLine(afterCost[1])}`;
  // Tags e custos no início da linha: [On Play], [DON!! x1], ①, DON!! −1 ...
  const lead = line.match(/^((?:\s*\/?\s*(?:\[[^\]]+\]|[①-⑩]|DON!! ?[−-]\d+))*)\s*(.*)$/)!;
  let tags = lead[1].trim();
  for (const [re, rep] of TAGS) tags = tags.replace(re, rep);
  const body = lead[2];
  if (!body) return tags;
  return (tags ? `${tags} ` : '') + translateBody(body);
}

export function translateToPt(text: string): Translation {
  if (!text.trim()) return { text, complete: true };
  // Protege os lembretes (entre parênteses) já traduzidos.
  const saved: string[] = [];
  // Textos importados antes da normalização ainda podem ter "X" type e "(3) (You may rest…)".
  let src = normalizeTypeQuotes(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[Activate:Main\]/g, '[Activate: Main]')
    .replace(/\bYou can (?=trash|rest|place|return|add)/g, 'You may ')
    .replace(/\{Supernova\}/g, '{Supernovas}')
    .replace(/DON!! (\d+)(?=\s*[:(])/g, 'DON!! -$1');
  for (const [re, rep] of REMINDERS) {
    src = src.replace(re, () => {
      saved.push(rep);
      return `§${saved.length - 1}§`;
    });
  }
  let out = src
    .split('\n')
    .map((line) =>
      // Vários efeitos na mesma linha ("… during this turn. [Activate: Main] …"): traduz um por um.
      splitEffects(line)
        .map((effect) => {
          const parts = effect.split(/(§\d+§)/);
          return parts.map((p) => (/^§\d+§$/.test(p) ? p : p.trim() ? translateLine(p.trim()) : p)).join(' ');
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n');
  // Tags soltas no meio do texto (ex.: "Activate this card's [Main] effect" já tratado).
  for (const [re, rep] of TAGS) out = out.replace(re, rep);

  const check = out.replace(/\[[^\]]*\]|\{[^}]*\}|§\d+§/g, '');
  out = out.replace(/§(\d+)§/g, (_, i) => saved[Number(i)]).replace(/\)\s+:/g, '):');
  return { text: out, complete: !RESIDUE.test(check) };
}
