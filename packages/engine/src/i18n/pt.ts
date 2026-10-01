// Tradução automática (baseada em regras) dos textos das cartas para português.
//
// Os textos de One Piece Card Game seguem modelos bem fixos ("K.O. up to 1 of your
// opponent's Characters with a cost of 3 or less."), então um conjunto de regras de
// frases cobre boa parte das cartas sem depender de serviço externo. O que não for
// reconhecido fica em inglês e o resultado é marcado como parcial; traduções manuais
// (data/translations/pt.json) sempre têm prioridade.

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
    /\(When this card deals damage, the target card is trashed without activating its Trigger\.\)/g,
    '(Quando esta carta causa dano, a carta de Vida vai para o descarte sem ativar seu [Trigger].)',
  ],
  [
    /\(You may rest the specified number of DON!! cards in your cost area\.\)/g,
    '(Você pode virar a quantidade indicada de DON!! da sua área de custo.)',
  ],
  [
    /\(You may return the specified number of DON!! cards from your field to your DON!! deck\.\)/g,
    '(Você pode devolver a quantidade indicada de DON!! do seu campo para o seu deck de DON!!.)',
  ],
];

const plural = (n: string | number, one: string, many: string) => (Number(n) === 1 ? one : many);
const manyTargets = (who: string) => {
  if (/Leaders and Characters/i.test(who)) return true;
  const n = who.match(/up to (\d+)/i);
  return n ? Number(n[1]) > 1 : /\b(cards|Characters)\b/.test(who) && !/\b1 of\b/.test(who);
};

type Rule = [RegExp, string | ((...m: string[]) => string)];

/** Regras de frase inteira (verbo no início). Aplicadas uma vez, na ordem. */
const SENTENCES: Rule[] = [
  [/^Draw (\d+) cards?\.?$/i, (_, n) => `Compre ${n} ${plural(n, 'carta', 'cartas')}.`],
  [
    /^Give (.+?) up to (\d+) rested DON!! cards?\.?$/i,
    (_, who, n) => `Dê até ${n} DON!! ${plural(n, 'virado', 'virados')} a ${who}.`,
  ],
  [
    /^Give up to (\d+) rested DON!! cards? to (.+?)\.?$/i,
    (_, n, who) => `Dê até ${n} DON!! ${plural(n, 'virado', 'virados')} a ${who}.`,
  ],
  [/^K\.O\. (.+?)\.?$/, (_, who) => `Nocauteie (K.O.) ${who}.`],
  [/^Rest (.+?)\.?$/, (_, who) => `Vire ${who}.`],
  [/^Set (.+?) as active\.?$/i, (_, who) => `Deixe ${who} ativo.`],
  [/^Return (.+?) to (?:the owner's|its owner's) hand\.?$/i, (_, who) => `Devolva ${who} à mão do dono.`],
  [/^Play (.+?) from your hand\.?$/i, (_, what) => `Jogue ${what} da sua mão.`],
  [/^Play this card\.?$/i, 'Jogue esta carta.'],
  [/^Add this card to your hand\.?$/i, 'Adicione esta carta à sua mão.'],
  [/^Activate this card's \[Main\] effect\.?$/i, 'Ative o efeito [Principal] desta carta.'],
  [
    /^Trash (\d+) cards? from your hand\.?$/i,
    (_, n) => `Descarte ${n} ${plural(n, 'carta', 'cartas')} da sua mão.`,
  ],
  [
    /^Add up to (\d+) DON!! cards? from your DON!! deck and (?:set (?:it|them) as active|rest (?:it|them))\.?$/i,
    (m, n) =>
      `Adicione até ${n} DON!! do seu deck de DON!! ${/active/i.test(m) ? 'como ativo' : 'virado'}${Number(n) > 1 ? 's' : ''}.`,
  ],
  [
    /^Look at (\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to your hand\.?$/i,
    (_, n, m, what) => `Olhe as ${n} cartas do topo do seu deck; revele até ${m} ${what} e adicione à sua mão.`,
  ],
  [/^Place the rest at the bottom of your deck in any order\.?$/i, 'Coloque o resto no fundo do seu deck em qualquer ordem.'],
  [/^Trash the rest\.?$/i, 'Descarte o resto.'],
  [
    /^Your opponent cannot activate a \[Blocker\] Character that has (\d+) or more power during this battle\.?$/i,
    (_, n) => `Seu oponente não pode ativar um Personagem com [Blocker] que tenha ${n} ou mais de poder durante esta batalha.`,
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
  [/up to (\d+) of your opponent's DON!! cards/gi, (_, n) => `até ${n} DON!! do oponente`],
  [/up to (\d+) of your DON!! cards/gi, (_, n) => `até ${n} dos seus DON!!`],
  [/up to (\d+) of your Characters/gi, (_, n) => `até ${n} dos seus Personagens`],
  [/up to (\d+) (\{[^}]+\}) type Character cards?/gi, (_, n, t) => `até ${n} ${plural(n, 'Personagem', 'Personagens')} do tipo ${t}`],
  [/up to (\d+) (\{[^}]+\}) type cards?/gi, (_, n, t) => `até ${n} ${plural(n, 'carta', 'cartas')} do tipo ${t}`],
  [/(\{[^}]+\}) type cards/gi, (_, t) => `cartas do tipo ${t}`],
  [/(\{[^}]+\}) type card/gi, (_, t) => `carta do tipo ${t}`],
  [/up to (\d+) Characters?/gi, (_, n) => `até ${n} ${plural(n, 'Personagem', 'Personagens')}`],
  [/this Leader or 1 of your Characters/gi, 'este Líder ou 1 dos seus Personagens'],
  [/your Leader or 1 of your Characters/gi, 'seu Líder ou 1 dos seus Personagens'],
  [/with a cost of (\d+) or less/gi, (_, n) => `com custo ${n} ou menos`],
  [/with a cost of (\d+) or more/gi, (_, n) => `com custo ${n} ou mais`],
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
];

const RESIDUE =
  /\b(the|your|of|up to|gains?|with|cards?|opponent's|this|and|from|power|cost|less|more|during|may|you|if|then|character|characters|leader|rest|play|give|draw|trash|select|set|active|look|reveal|place|add|return|when|each|all|can|cannot|instead)\b/i;

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
  const then = s.match(/^Then,\s*(.+)$/i);
  if (then) {
    const rest = translateSentence(then[1]);
    return `Depois, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  for (const [re, rep] of SENTENCES) {
    const m = s.match(re);
    if (m) {
      const replaced = typeof rep === 'string' ? rep : rep(...(m as unknown as string[]));
      return capitalize(applyPhrases(replaced));
    }
  }
  return capitalize(applyPhrases(s));
}

/** Traduz um trecho sem tags: separa custo ("X: Y"), frases e condicionais. */
function translateBody(body: string): string {
  // Custo de ativação: "You may rest this Character: Give ..." / "① You may ...: ..."
  const cost = body.match(/^(You may [^:]+?):\s*(.*)$/);
  if (cost) return `${applyPhrases(cost[1])}: ${translateBody(cost[2])}`;

  // Condicional no início da frase.
  const cond = body.match(/^(If [^,]+,)\s*(.*)$/);
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
  const lead = line.match(/^((?:\s*(?:\[[^\]]+\]|[①-⑩]|DON!! ?[−-]\d+))*)\s*(.*)$/)!;
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
  let src = text.replace(/<br\s*\/?>/gi, '\n');
  for (const [re, rep] of REMINDERS) {
    src = src.replace(re, () => {
      saved.push(rep);
      return `§${saved.length - 1}§`;
    });
  }
  let out = src
    .split('\n')
    .map((line) => {
      const parts = line.split(/(§\d+§)/);
      return parts.map((p) => (/^§\d+§$/.test(p) ? p : p.trim() ? translateLine(p.trim()) : p)).join(' ').replace(/\s+/g, ' ').trim();
    })
    .join('\n');
  // Tags soltas no meio do texto (ex.: "Activate this card's [Main] effect" já tratado).
  for (const [re, rep] of TAGS) out = out.replace(re, rep);

  const check = out.replace(/\[[^\]]*\]|\{[^}]*\}|§\d+§/g, '');
  out = out.replace(/§(\d+)§/g, (_, i) => saved[Number(i)]).replace(/\)\s+:/g, '):');
  return { text: out, complete: !RESIDUE.test(check) };
}
