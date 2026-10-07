// Leitor automático de efeitos: transforma o texto oficial (em inglês) em passos da DSL.
//
// Os textos de One Piece Card Game seguem modelos fixos ("K.O. up to 1 of your opponent's
// Characters with a cost of 3 or less."). Cada linha de efeito só vira automática se for
// reconhecida POR INTEIRO; qualquer trecho desconhecido faz a linha cair no modo manual.
// Scripts escritos à mão (scripts.ts) têm prioridade sobre o leitor.

import { normalizeTypeQuotes } from '../text';
import type {
  Ability,
  LeaderRule,
  AbilityCost,
  AbilityTiming,
  CardCategory,
  CardData,
  CardFilter,
  Color,
  Condition,
  Duration,
  EffectStep,
  GameEvent,
  Replacement,
  RestrictionKind,
  Keyword,
  TargetRef,
  TargetSpec,
} from '../types';
import { detectKeywords, KEYWORD_ONLY, manualAbility, manualTrigger, splitEffects } from './split';

export interface ParsedCard {
  keywords: Keyword[];
  abilities: Ability[];
  /** Linhas de efeito não reconhecidas (resolvidas no modo manual). */
  unparsed: string[];
}

const KEYWORDS: Record<string, Keyword> = {
  rush: 'rush',
  blocker: 'blocker',
  'double attack': 'doubleAttack',
  banish: 'banish',
  'rush: character': 'rushCharacter',
  'rush:character': 'rushCharacter',
  unblockable: 'unblockable',
};

const TIMINGS: Record<string, AbilityTiming> = {
  'activate: main': 'activateMain',
  'on play': 'onPlay',
  'when attacking': 'whenAttacking',
  'on k.o.': 'onKO',
  'on block': 'onBlock',
  'end of your turn': 'endOfTurn',
  "end of your opponent's turn": 'endOfOpponentTurn',
  main: 'main',
  counter: 'counter',
  "on your opponent's attack": 'onOpponentAttack',
};

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** Diagnóstico: o primeiro trecho não reconhecido (usado só por ferramentas de análise). */
let failure: string | null = null;
const fail = (what: string): null => {
  failure ??= what;
  return null;
};

// ---------------------------------------------------------------------------
// Limpeza do texto
// ---------------------------------------------------------------------------

/** Remove lembretes entre parênteses, preservando o que estiver entre colchetes ("[Monkey.D.Luffy (…)]"). */
function stripReminders(s: string): string {
  let out = '';
  let depth = 0;
  let bracket = 0;
  for (const ch of s) {
    if (!depth && ch === '[') bracket++;
    if (!depth && ch === ']' && bracket) bracket--;
    if (!bracket && ch === '(') {
      depth++;
      continue;
    }
    if (!bracket && ch === ')' && depth) {
      depth--;
      continue;
    }
    if (!depth) out += ch;
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,:;])/g, '$1')
    .trim();
}

const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩';

/** Normaliza o texto da API (tipos, lembretes, sinais de DON!!) antes da leitura. */
export function cleanEffectText(raw: string): string {
  return clean(raw);
}

function clean(raw: string): string {
  const fixed = raw
    // "(Slash) attribute": o atributo entre parênteses não é lembrete.
    .replace(/\((Slash|Strike|Ranged|Special|Wisdom)\) attribute/g, '"$1" attribute')
    // "[When Attacking ① (…)", "[When Attacking] [1] (…)", "[When Attacking] 2 (…)": custo de DON!! virados mal formatado.
    .replace(/\[When Attacking ([①-⑩])/g, '[When Attacking] $1')
    // "gains and +10000 power during this battle. (This card deals 2 damage.)": falta o [Double Attack].
    .replace(/gains and (\+\d+ power during this battle)\.\s*\(This card deals 2 damage\.\)/g, 'gains [Double Attack] and $1.')
    // "[End of Your Turn] (1): …": custo de DON!! virados sem o símbolo.
    .replace(/(\]\s*)\((\d)\)(?=\s*:)/g, (_, pre: string, n: string) => `${pre}${CIRCLED_DIGITS[Number(n) - 1]}`)
    // "[DON!! x1] [This Character gains [Blocker]. (…)": colchete a mais antes do efeito.
    .replace(/\[This Character gains \[(\w+)\]\./g, 'This Character gains [$1].')
    .replace(/(?:\[(\d)\]|(?<=\] )(\d)) (?=\(You may rest the specified)/g, (_, a, b) => `${CIRCLED_DIGITS[Number(a ?? b) - 1]} `);
  return stripReminders(normalizeTypeQuotes(fixed))
    .replace(/DON!! ?[−–-] ?(\d+)/g, 'DON!! -$1')
    // A API às vezes perde o sinal de menos: "DON!! 1:" = "DON!! −1:".
    .replace(/DON!! (\d+)(?=\s*:)/g, 'DON!! -$1')
    .replace(/DON!! -?(\d+),\s*(?=[Yy]ou may)/g, 'DON!! -$1 ')
    .replace(/–(?=\d)/g, '-')
    // "If a Character is rested by your effect, …" é uma reação.
    .replace(/\bIf a Character is rested by your effect,/g, 'When a Character is rested by your effect,')
    .replace(/(\w)-(\d+) (power|cost)\b/g, '$1 -$2 $3')
    .replace(/\.(?=(?:If|When|Your|This|All) )/g, '. ')
    .replace(/look at (\d+) cards from the top of your deck, reveal up to/gi, 'look at $1 cards from the top of your deck; reveal up to')
    .replace(/(you have \d+ or (?:less|more) cards in your hand) and (a Character with)/gi, '$1 and you have $2')
    .replace(
      /reveal 1 card from the top of your deck, play (up to \d+ .+?), and place the rest at the top or bottom of your deck/gi,
      'reveal 1 card from the top of your deck and play $1. Then, place the rest at the top or bottom of your deck',
    )
    .replace(
      /Select (up to 1 of your .+?)\. If the selected Character attacks during this turn, your opponent cannot activate \[Blocker\]/gi,
      'Select $1. Your opponent cannot activate [Blocker] if that Leader or Character attacks during this turn',
    )
    .replace(/\[Activate: ?Main\]/gi, '[Activate: Main]')
    .replace(/\[DON!! ?[x×] ?(\d+)\]/gi, '[DON!! x$1]')
    .replace(/\[On your Opponent's Attack\]/g, "[On Your Opponent's Attack]")
    .replace(/\bYou can (?=trash|rest|place|return|add)/g, 'You may ')
    .replace(/\{Supernova\}/g, '{Supernovas}')
    .replace(/\bPiratess\b/g, 'Pirates')
    // "Play up to 1 X card from your hand with a cost equal to or less than …" → "… with a cost … from your hand"
    .replace(/( cards?) from your hand (with a cost equal to or less than the number of DON!! cards on your field)/g, '$1 $2 from your hand')
    // Erro da API: "-1 cost tot your opponent's during this turn".
    .replace(/ tot your opponent's (?=during)/g, ' ')
    .replace(/Select your Leader or 1 of your (.+?)\. Change the attack target to the selected card/g, 'Change the attack target to this Leader or one of your $1')
    .replace(
      /[Yy]ou may trash any number of (.+?) from your hand\. (This Leader|This Character|Your Leader or 1 of your Characters) gains \+(\d+) power during this (battle|turn) for every card trashed/g,
      'Trash any number of $1 from your hand for +$3 power to $2 during this $4 each',
    )
    .replace(/ is K\.O\.'d add /g, " is K.O.'d, add ")
    .replace(/\bK\.O'd\b/g, "K.O.'d")
    .replace(/ instead of that Character being K\.O\.'d/g, ' instead')
    .replace(
      /select your opponent's rested Leader and up to (\d+) Character card\. The selected cards will not become active in your opponent's next Refresh Phase/gi,
      "your opponent's rested Leader will not become active in your opponent's next Refresh Phase. Then, up to $1 of your opponent's rested Characters will not become active in your opponent's next Refresh Phase",
    )
    .replace(
      /Select (\d+) of (your .+?)\. Swap the base power of the selected (?:Characters|cards) with each other (during this (?:turn|battle))/gi,
      'Swap the base power of $1 of $2 with each other $3',
    )
    .replace(
      /you may rest any number of your DON!! cards\. For every DON!! card rested this way, (.+?) gains \+(\d+) power during this battle/gi,
      'rest any number of your DON!! cards for +$2 power to $1',
    )
    .replace(/, or when your opponent plays a Character using a Character's effect/g, " or your opponent plays a Character using a Character's effect")
    .replace(
      /look at (\d+) cards from the top of your deck and add up to (\d+) (.+?) to the top of your Life cards face-up/gi,
      'look at $1 cards from the top of your deck; reveal up to $2 $3 and add it to the top of your Life cards face-up',
    )
    .replace(/(\{[^}]+\} type (?:Character )?cards?) or "([^"]+)"/g, '$1 or [$2]')
    .replace(
      /look at (\d+) cards from the top of your deck and add up to (\d+) cards? to your hand/gi,
      'look at $1 cards from the top of your deck; reveal up to $2 card and add it to your hand',
    )
    // "up to 1 of your Leader with a type including "X" or up to 1 of your Characters with a type including "X""
    .replace(
      /up to (\d+) of your Leader with a type including "([^"]+)" or up to \1 of your Characters? with a type including "\2"/gi,
      'up to $1 of your Leader or Character cards with a type including "$2"',
    )
    // Erros de digitação da API.
    .replace(/\bAd up to\b/g, 'Add up to')
    .replace(/\bSAtage\b/g, 'Stage')
    .replace(/\btour opponent's\b/g, "your opponent's")
    .replace(/ poser\b/g, ' power')
    .replace(/\bCharactes\b/g, 'Characters')
    .replace(/\bK\.O up to\b/g, 'K.O. up to')
    .replace(/ (?:N|1)ith a cost\b/g, ' with a cost')
    .replace(/\ba cost (\d+) or (less|more)\b/g, 'a cost of $1 or $2')
    .replace(/\bcost or (\d+) or (less|more)\b/g, 'cost of $1 or $2')
    .replace(/\bthe rest a the bottom\b/g, 'the rest at the bottom')
    .replace(/ from their trash at bottom of their deck/g, ' from their trash at the bottom of their deck')
    .replace(/\bplace them as the top or bottom of the deck\b/g, 'place them at the top or bottom of the deck')
    .replace(/\btype include "/g, 'type includes "')
    .replace(/\bgains Rush during\b/g, 'gains [Rush] during')
    .replace(/\bthis Character has played on this turn\b/g, 'this Character was played on this turn')
    .replace(/\bplaces (\d+) cards? from your hand at the bottom of their deck\b/g, 'places $1 cards from their hand at the bottom of their deck')
    .replace(/\bexcept this Character\b/g, 'other than this Character')
    .replace(/\bDraw (\d+) cards? when your opponent activates an Event\.?$/, 'When your opponent activates an Event, draw $1 card.')
    .replace(/(your Leader) has (\d+) power or more and the (\{[^}]+\}) type\b/g, '$1 has the $3 type and your Leader has $2 power or more')
    .replace(/\[Rush Character\]/g, '[Rush: Character]')
    // "Look at the top 5 cards of your deck"
    .replace(/\bLook at the top (\d+) cards of your deck\b/gi, 'Look at $1 cards from the top of your deck')
    .replace(/\b(?:they|your opponent must) place (\d+) cards? from their hand/g, 'your opponent places $1 cards from their hand')
    .replace(/(your Leader has the \{[^}]+\} type) and is active\b/g, '$1 and your Leader is active')
    .replace(/(your Leader has the \{[^}]+\} type) and have /g, '$1 and you have ')
    .replace(/(you have \d+ or (?:more|less) DON!! cards on your field) and (\d+ or (?:more|less) cards in your hand)/g, '$1 and you have $2')
    .replace(/\bgive -(\d+) power during this turn to (up to .+?)(?=\.|$)/g, 'give $2 -$1 power during this turn')
    .replace(/(Look at \d+ cards from the top of your deck); add up to (\d+) cards? to the top of your Life cards\b/g, '$1; reveal up to $2 card and add it to the top of your Life cards')
    // Lote final: textos com estrutura diferente do padrão.
    .replace(/(Look at \d+ cards from the top of your deck) and play up to/gi, '$1; play up to')
    .replace(/reveal (?:up to )?a total of (?:up to )?(\d+)/gi, 'reveal up to $1')
    .replace(/(your Leader is \[[^\]]+\]), (\[[^\]]+\]),? or (\[[^\]]+\])/g, '$1 or $2 or $3')
    .replace(/and rest it, look at/g, 'and rest it. Then, look at')
    .replace(/ or less life from your hand/g, ' or less from your hand')
    .replace(/\bKO'd\b/g, "K.O.'d")
    .replace(/\byou can discard\b/g, 'you may trash')
    .replace(/\bIf you have an? (green |red |blue |purple |black |yellow )?Character other than (\[[^\]]+\]) that would be removed/g, 'If your $1Characters other than $2 would be removed')
    .replace(/\byour Character (\[[^\]]+\]) would\b/g, 'your $1 would')
    .replace(/^(If [^,]+?) (give this (?:card|Character)\b)/, '$1, $2')
    .replace(
      /play up to (\d+) (\[[^\]]+\]) from your hand with a cost of (\d+) or more that is equal to or less than the number of DON!! cards on your opponent's field/g,
      "play up to $1 $2 with a cost of $3 or more with a cost equal to or less than the number of DON!! cards on your opponent's field from your hand",
    )
    .replace(/\] Rest (\d+) of your DON!! cards and you may rest this Character:/g, '] You may rest $1 of your DON!! cards and rest this Character:')
    .replace(/face-up: Your opponent trashes/g, 'face-up. If you do, your opponent trashes')
    .replace(
      /You may place this (Character|card) and (\d+) (.+?) from your (trash|hand) at the bottom of your deck in any order:/g,
      "You may place this $1 at the bottom of the owner's deck and place $2 $3 from your $4 at the bottom of your deck:",
    )
    .replace(/ type, and this Character was played/g, ' type and this Character was played')
    .replace(
      /Then, if the selected card attacks during this turn, your opponent cannot activate \[Blocker\]/g,
      'Then, your opponent cannot activate [Blocker] if that Leader or Character attacks during this turn',
    )
    .replace(/\bgive (\d+) of your active DON!! cards to/g, 'give $1 active DON!! cards to')
    .replace(/to your Leader with a type including "([^"]+)" or 1 Character with a type including "\1"/g, 'to up to 1 of your Leader or Character cards with a type including "$1"')
    .replace(
      /Give up to (\d+) rested DON!! cards? to its owner's Leader or 1 of their Characters/g,
      "Give up to $1 of your opponent's rested DON!! cards to up to 1 of your opponent's Leader or Character cards",
    )
    .replace(/set your Leader (\[[^\]]+\]) as active/g, 'set your $1 Leader as active')
    .replace(/play up to 1 (\[[^\]]+\]), up to 1 (\[[^\]]+\]),? and up to 1 (\[[^\]]+\]),? with a cost of (\d+) or less from your trash/g, 'play up to 1 each of $1, $2 and $3 with a cost of $4 or less from your trash')
    .replace(/ in any order of the owner's choosing/g, ' in any order')
    .replace(/Return up to (\d+) card with a cost/g, 'Return up to $1 Character with a cost')
    .replace(/\[Usopp from/g, '[Usopp] from')
    .replace(/^Kurozumi Clan type Characters other than your (\[[^\]]+\])/, 'All of your {Kurozumi Clan} type Characters other than $1')
    .replace(
      /If this Character would leave the field, you may (.+?) instead\. If there is a (\[[^\]]+\]) Character, this effect is negated\./,
      "If there is no $2 Character and this Character would be K.O.'d or be removed from the field, you may $1 instead.",
    )
    .replace(/^If (your Leader has the \{[^}]+\} type), (you have)/, 'If $1 and $2')
    .replace(/you may (trash \d+ cards? from your hand) to activate this effect\. /g, 'you may $1. If you do, ')
    .replace(/Select your Leader and 1 Character\. Swap the base power of the selected cards with each other/g, 'Swap the base power of your Leader and 1 Character with each other')
    .replace(
      /Choose (up to \d+ .+?) and (up to \d+ .+?) from your trash\. Play 1 card and play the other card rested/g,
      'Play $1 from your trash. Then, play $2 from your trash rested',
    )
    .replace(
      /reveal up to \d+ (.+?) from your hand\. Play 1 of the revealed cards and play the other card rested if it has a cost of (\d+) or less/g,
      'play up to 1 $1 from your hand. Then, play up to 1 $1 with a cost of $2 or less from your hand rested',
    )
    .replace(/the opponent's Character you battled with/g, 'that Character')
    // Spoilers (traduções de fãs): erros de digitação e frases fora do padrão oficial.
    .replace(/\bCharacetr\b/g, 'Character')
    .replace(/\brest your Leader (\[[^\]]+\])/g, 'rest your $1 Leader')
    .replace(/, they trash (\d+) cards? from their hand/g, ', your opponent trashes $1 cards from their hand')
    .replace(/ during this turn, and return it to (?:their|the owner's) hand/g, " during this turn. Then, return that Character to the owner's hand")
    .replace(/\bcost of O\b/g, 'cost of 0')
    .replace(/\bup to one\b/gi, 'up to 1')
    .replace(/\b(your opponent's|your|their) characters\b/g, '$1 Characters')
    .replace(/\btrash (\d+) from your hand\b/g, 'trash $1 card from your hand')
    .replace(/\bDON!! Card each\b/g, 'DON!! card each')
    .replace(/ and add (them|it) to your hand, then place the rest\b/g, ' and add $1 to your hand. Then, place the rest')
    // "{Land of Wano] type": colchete trocado no fim do tipo.
    .replace(/\{([^}\]]+)\]/g, '{$1}')
    .replace(/\} types cards\b/g, '} type cards')
    // "reveal up to 1 card with the type {X}" → "reveal up to 1 {X} type card"
    .replace(/\b(\d+) cards? with the type (\{[^}]+\})/g, '$1 $2 type card')
    .replace(/\bThen, place the remaining cards into the trash\b/g, 'Then, trash the rest')
    .replace(/\bup to (\d+) of your Leader or up to \1 of your Characters\b/g, 'up to $1 of your Leader or Character cards')
    .replace(/’/g, "'");
}

function sentencesOf(body: string): string[] {
  const out: string[] = [];
  for (const piece of body.split(/(?<=[a-z0-9)\]}'"]\.)\s+(?=[A-Z[])/)) {
    // "[Dr. Hogback]": o ponto dentro de um nome não termina a frase.
    const prev = out[out.length - 1];
    if (prev !== undefined && (prev.match(/\[/g)?.length ?? 0) > (prev.match(/\]/g)?.length ?? 0)) out[out.length - 1] = `${prev} ${piece}`;
    else out.push(piece);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

const capitalizeFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const typesOf = (list: string) => [...list.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const TYPE_LIST = /^((?:\{[^}]+\})(?:\s*(?:,\s*(?:or|and)?|or|and)\s*\{[^}]+\})*) type\s*/i;

// ---------------------------------------------------------------------------
// Alvos em campo
// ---------------------------------------------------------------------------

/** Restrições no fim da frase ("with a cost of 3 or less", "other than this card"...). */
function applyTrailing(p: string, spec: TargetSpec | CardFilter, onField: boolean): string | null {
  let rest = p;
  let m: RegExpMatchArray | null;
  for (let guard = 0; rest && guard < 10; guard++) {
    if ((m = rest.match(/^\s*on your field/i)) && onField) {
      (spec as TargetSpec).side = 'own';
    } else if ((m = rest.match(/^\s*with a (base )?cost of (\d+) or less(?: (?:than|other than) \[([^\]]+)\])?/i))) {
      spec.maxCost = Number(m[2]);
      // "or less than [Gecko Moria]": erro da API para "or less other than [Gecko Moria]".
      if (m[3]) spec.excludeName = m[3];
      if (m[1] && onField) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with a cost equal to or less than the (?:number|total) of (your opponent's|your|your and your opponent's) Life cards/i)) && onField) {
      (spec as TargetSpec).maxCostDynamic = /and/i.test(m[1]) ? 'totalLife' : /opponent/i.test(m[1]) ? 'opponentLife' : 'ownLife';
    } else if ((m = rest.match(/^\s*with a (base )?cost of (\d+) to (\d+)/i))) {
      spec.minCost = Number(m[2]);
      spec.maxCost = Number(m[3]);
      if (m[1] && onField) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with a (base )?cost of (\d+) or more/i))) {
      spec.minCost = Number(m[2]);
      if (m[1] && onField) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with a (base )?cost of (\d+)(?! or)/i))) {
      spec.minCost = spec.maxCost = Number(m[2]);
      if (m[1] && onField) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with (?:a )?(base )?power of (\d+) or less|^\s*with (\d+) (base )?power or less/i)) && onField) {
      (spec as TargetSpec).maxPower = Number(m[2] ?? m[3]);
      if (m[1] || m[4]) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with (?:a )?(base )?power of (\d+) or more|^\s*with (\d+) (base )?power or more/i)) && onField) {
      (spec as TargetSpec).minPower = Number(m[2] ?? m[3]);
      if (m[1] || m[4]) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*(?:that has|with) (\d+|a) (?:or more )?DON!! cards? given/i)) && onField) {
      (spec as TargetSpec).minDon = m[1] === 'a' ? 1 : Number(m[1]);
    } else if ((m = rest.match(/^\s*with a total (power|cost) of (\d+) or less/i)) && onField) {
      if (/power/i.test(m[1])) (spec as TargetSpec).totalMaxPower = Number(m[2]);
      else (spec as TargetSpec).totalMaxCost = Number(m[2]);
    } else if ((m = rest.match(/^\s*with no base effect/i)) && onField) {
      (spec as TargetSpec).noEffect = true;
    } else if ((m = rest.match(/^\s*(?:and )?(?:with )?different card names/i)) && !onField) {
      (spec as CardFilter).distinctNames = true;
    } else if ((m = rest.match(/^\s*and a total cost of (\d+) or less/i)) && !onField) {
      (spec as CardFilter).totalMaxCost = Number(m[1]);
    } else if ((m = rest.match(/^\s*and a cost of (\d+)(?! or)/i))) {
      spec.minCost = spec.maxCost = Number(m[1]);
    } else if ((m = rest.match(/^\s*and a type including "([^"]+)"/i))) {
      spec.typeIncludes = m[1];
    } else if ((m = rest.match(/^\s*with (\d+) to (\d+) power/i)) && !onField) {
      spec.minPower = Number(m[1]);
      spec.maxPower = Number(m[2]);
    } else if ((m = rest.match(/^\s*and (\d+) power(?! or)/i)) && !onField) {
      spec.minPower = spec.maxPower = Number(m[1]);
    } else if ((m = rest.match(/^\s*with a power of (\d+) or (less|more)/i)) && !onField) {
      if (/less/i.test(m[2])) spec.maxPower = Number(m[1]);
      else spec.minPower = Number(m[1]);
    } else if ((m = rest.match(/^\s*with a (base )?power of (\d+)(?! or)/i)) && onField) {
      (spec as TargetSpec).minPower = (spec as TargetSpec).maxPower = Number(m[2]);
      if (m[1]) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with a cost equal to or less than your number of Life cards/i)) && onField) {
      (spec as TargetSpec).maxCostDynamic = 'ownLife';
    } else if ((m = rest.match(/^\s*on (?:their|your opponent's) field/i)) && onField && (spec as TargetSpec).side === 'opponent') {
      // "all of your opponent's Characters on their field"
    } else if ((m = rest.match(/^\s*other than "([^"]+)"/i))) {
      spec.excludeName = m[1];
    } else if ((m = rest.match(/^\s*with (\d+) (base )?power(?! or)/i)) && onField) {
      (spec as TargetSpec).minPower = (spec as TargetSpec).maxPower = Number(m[1]);
      if (m[2]) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*other than this (?:card|Character|Leader)/i)) && onField) {
      (spec as TargetSpec).excludeSelf = true;
    } else if ((m = rest.match(/^\s*other than \[([^\]]+)\]/i))) {
      spec.excludeName = m[1];
    } else if ((m = rest.match(/^\s*with a type including "([^"]+)"/i))) {
      spec.typeIncludes = m[1];
    } else if ((m = rest.match(/^\s*with a cost equal to or less than the number of DON!! cards on your opponent's field/i)) && !onField) {
      (spec as CardFilter).maxCostOppDon = true;
    } else if ((m = rest.match(/^\s*with a cost equal to or less than the number of DON!! cards on your field/i)) && !onField) {
      (spec as CardFilter).maxCostDon = true;
    } else if ((m = rest.match(/^\s*(?:and )?without an? \[(On Play|When Attacking)\] effect/i)) && onField) {
      (spec as TargetSpec).withoutTiming = /Play/i.test(m[1]) ? 'onPlay' : 'whenAttacking';
    } else if ((m = rest.match(/^\s*and the ((?:\{[^}]+\})(?:\s*(?:,|or)\s*\{[^}]+\})*) type/i))) {
      spec.hasAnyType = typesOf(m[1]);
    } else if ((m = rest.match(/^\s*and a (base )?cost of (\d+) or (less|more)/i))) {
      if (/less/i.test(m[3])) spec.maxCost = Number(m[2]);
      else spec.minCost = Number(m[2]);
      if (m[1] && onField) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*that is either \[([^\]]+)\] or has the "(\w+)" attribute/i)) && !onField) {
      (spec as CardFilter).orName = m[1];
      (spec as CardFilter).attribute = m[2];
    } else if ((m = rest.match(/^\s*or \[([^\]]+)\]/i)) && !onField) {
      (spec as CardFilter).orName = m[1];
    } else if ((m = rest.match(/^\s*and (\d+) (base )?power or (more|less)/i))) {
      if (/more/i.test(m[3])) spec.minPower = Number(m[1]);
      else spec.maxPower = Number(m[1]);
      if (m[2] && onField) (spec as TargetSpec).base = true;
    } else if ((m = rest.match(/^\s*with different card names/i)) && !onField) {
      (spec as CardFilter).distinctNames = true;
    } else if ((m = rest.match(/^\s*and (?=with )/i))) {
      // "without an [On Play] effect and with a cost of 8 or less"
    } else if ((m = rest.match(/^\s*(?:and |with )?an? \[Trigger\]/i))) {
      spec.hasTrigger = true;
    } else if ((m = rest.match(/^\s*with both the ((?:\{[^}]+\})(?:,?\s*and\s*\{[^}]+\})+) types?/i))) {
      // "with both the {Animal} and {Alabasta} types" / "… type"
      spec.hasAllTypes = typesOf(m[1]);
    } else if ((m = rest.match(/^\s*with both the \{([^}]+)\} type and (?=an? |the |\d)/i))) {
      // "with both the {Revolutionary Army} type and a [Trigger]"
      spec.hasAnyType = [m[1]];
    } else if ((m = rest.match(/^\s*(?:and |with )?the "(\w+)" or "(\w+)" attribute/i))) {
      (spec as CardFilter).either = [{ attribute: m[1] }, { attribute: m[2] }];
    } else if ((m = rest.match(/^\s*(?:and |with )?the "(\w+)" attribute/i))) {
      spec.attribute = m[1];
    } else if ((m = rest.match(/^\s*(?:and )?without (?:an? )?\[(Rush|Blocker|Double Attack|Banish)\]/i))) {
      spec.withoutKeyword = KEYWORDS[m[1].toLowerCase()];
    } else if ((m = rest.match(/^\s*with (\d+) base power or (less|more)/i)) && !onField) {
      if (/less/i.test(m[2])) (spec as CardFilter).maxPower = Number(m[1]);
      else (spec as CardFilter).minPower = Number(m[1]);
    } else if ((m = rest.match(/^\s*with (\d+) power or less/i)) && !onField) {
      (spec as CardFilter).maxPower = Number(m[1]);
    } else if ((m = rest.match(/^\s*with (\d+) power or more/i)) && !onField) {
      (spec as CardFilter).minPower = Number(m[1]);
    } else if ((m = rest.match(/^\s*with (\d+) power(?! or)/i)) && !onField) {
      (spec as CardFilter).minPower = (spec as CardFilter).maxPower = Number(m[1]);
    } else if ((m = rest.match(/^\s*(?:and|with) no base effect/i)) && !onField) {
      (spec as CardFilter).noEffect = true;
    } else {
      return null;
    }
    rest = rest.slice(m[0].length);
  }
  return rest.trim() ? null : '';
}

export function parseTarget(phrase: string): TargetRef | null {
  const base = parseTargetBase(phrase);
  if (base) return base;
  // "up to 3 of your {X} type Characters or Characters with a [Trigger]",
  // "up to 1 of your [Luffy] Characters or up to 1 of your Characters with a type including "Y", with 8000 power or more"
  const m = phrase.trim().replace(/,$/, '').match(/^up to (\d+) of your (.+?) or (?:up to \1 of your )?(.+?)(?:, (with .+))?$/i);
  if (!m) return null;
  const a = parseTargetBase(`up to ${m[1]} of your ${m[2]}`);
  const b = parseTargetBase(`up to ${m[1]} of your ${m[3]}`);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
  if (a.kinds.join() !== 'character' || b.kinds.join() !== 'character') return null;
  const part = (t: TargetSpec): Partial<TargetSpec> => {
    const { side: _s, kinds: _k, upTo: _u, ...rest } = t;
    return rest;
  };
  const spec: TargetSpec = { side: 'own', kinds: ['character'], upTo: Number(m[1]), either: [part(a), part(b)] };
  if (m[4] && applyTrailing(m[4], spec, true) === null) return null;
  return spec;
}

function parseTargetBase(phrase: string): TargetRef | null {
  let p = phrase.trim().replace(/\.$/, '');
  if (/^this (character|card|leader|stage)$/i.test(p)) return 'self';
  if (/^your leader$/i.test(p)) return 'ownLeader';
  if (/^(?:that|the selected) (character|card|leader|leader or character)$/i.test(p) || /^it$/i.test(p)) return 'chosen';
  // Sem "up to": escolha obrigatória (8-4-4-1).
  if (/^(?:this|your) Leader or 1 of your Characters$/i.test(p)) return { side: 'own', kinds: ['leader', 'character'], upTo: 1, required: true };
  if (/^your Leader or \d+ of your Characters$/i.test(p)) return { side: 'own', kinds: ['leader', 'character'], upTo: 1, required: true };
  if (/^your Leader and all of your Characters$/i.test(p)) return { side: 'own', kinds: ['leader', 'character'], upTo: 99, all: true };
  // "Your opponent's rested Leader or up to 1 of your opponent's Characters other than [X]"
  const leadOr = p.match(/^your opponent's (rested )?Leader or up to (\d+) of your opponent's Characters(.*)$/i);
  if (leadOr) {
    const chars = parseTargetBase(`up to ${leadOr[2]} of your opponent's Characters${leadOr[3]}`);
    if (!chars || typeof chars !== 'object') return null;
    const { side: _s, upTo: _u, kinds: _k, ...charFilter } = chars;
    return {
      side: 'opponent',
      kinds: ['leader', 'character'],
      upTo: Number(leadOr[2]),
      either: [{ kinds: ['leader'], ...(leadOr[1] ? { rested: true } : {}) }, { kinds: ['character'], ...charFilter }],
    };
  }
  // "all of your [Donquixote Rosinante] and {Heart Pirates} type Characters"
  const nameAndType = p.match(/^all of your \[([^\]]+)\] and \{([^}]+)\} type Characters$/i);
  if (nameAndType) {
    return { side: 'own', kinds: ['character'], upTo: 99, all: true, either: [{ name: nameAndType[1] }, { hasAnyType: [nameAndType[2]] }] };
  }
  if (/^your opponent's Leader and all of (?:their|your opponent's) Characters$/i.test(p)) {
    return { side: 'opponent', kinds: ['leader', 'character'], upTo: 99, all: true };
  }
  const orNamed = p.match(/^up to (\d+) of your Characters or \[([^\]]+)\]$/i);
  if (orNamed) return { side: 'own', kinds: ['leader', 'character'], upTo: Number(orNamed[1]), leaderOnlyNamed: orNamed[2] };
  const named = p.match(/^your \[([^\]]+)\] Leader$/i);
  if (named) return { side: 'own', kinds: ['leader'], upTo: 1, name: named[1] };

  const spec: TargetSpec = { side: 'any', kinds: [], upTo: 1 };
  let m: RegExpMatchArray | null;
  let quantified = false;
  if ((m = p.match(/^up to (?:a total of )?(\d+) (?:of )?/i))) {
    spec.upTo = Number(m[1]);
    quantified = true;
  } else if ((m = p.match(/^(?:all|each) (?:of )?/i))) {
    spec.all = true;
    spec.upTo = 99;
    quantified = true;
  } else if ((m = p.match(/^(\d+) of (?=your )/i))) {
    // "return 1 of your Characters": sem "up to", escolhe o máximo possível até N (8-4-4-1).
    spec.upTo = Number(m[1]);
    spec.required = true;
    quantified = true;
  }
  if (m) p = p.slice(m[0].length);
  if ((m = p.match(/^your opponent's /i))) spec.side = 'opponent';
  else if ((m = p.match(/^your /i))) spec.side = 'own';
  else if (!quantified) return null;
  if (m) p = p.slice(m[0].length);

  // Qualificadores antes do substantivo.
  for (let guard = 0; guard < 5; guard++) {
    if ((m = p.match(TYPE_LIST))) spec.hasAnyType = typesOf(m[1]);
    else if ((m = p.match(/^(red|green|blue|purple|black|yellow) /i))) spec.color = m[1].toLowerCase() as Color;
    else if ((m = p.match(/^rested /i))) spec.rested = true;
    else if ((m = p.match(/^(\d+) cost (?=Characters?\b)/i))) spec.minCost = spec.maxCost = Number(m[1]);
    else if ((m = p.match(/^active /i))) spec.rested = false;
    else if ((m = p.match(/^\[(Rush|Blocker|Double Attack|Banish|Unblockable)\] /i))) spec.keyword = KEYWORDS[m[1].toLowerCase()];
    else if ((m = p.match(/^\[([^\]]+)\] (?:or|and) \[([^\]]+)\]\s*/))) spec.names = [m[1], m[2]];
    else if ((m = p.match(/^"(\w+)" attribute\s*/i))) spec.attribute = m[1];
    else if ((m = p.match(/^\[([^\]]+)\]\s*/))) spec.name = m[1];
    else break;
    p = p.slice(m[0].length);
  }

  // Substantivo.
  if ((m = p.match(/^(?:Leader (?:or|and) Character cards?|Leaders? and Characters|Leaders? or Characters?)/i))) {
    spec.kinds = ['leader', 'character'];
  } else if ((m = p.match(/^cards\b/i)) && spec.side !== 'any' && !spec.name) {
    // "Rest up to 1 of your opponent's cards"
    spec.kinds = ['leader', 'character', 'stage'];
  } else if ((m = p.match(/^Characters? or Stages?/i))) {
    spec.kinds = ['character', 'stage'];
  } else if ((m = p.match(/^Leader or Stage cards?/i))) {
    spec.kinds = ['leader', 'stage'];
  } else if ((m = p.match(/^(?:Character cards?|Characters?)/i))) {
    spec.kinds = ['character'];
  } else if ((m = p.match(/^Leaders?/i))) {
    spec.kinds = ['leader'];
  } else if ((m = p.match(/^Stages?(?: cards?)?/i))) {
    spec.kinds = ['stage'];
  } else if (spec.name || spec.names) {
    // "[Charlotte Linlin] cards" e "up to 1 of your [Shanks]": com dono, o nome vale para qualquer carta
    // em campo com esse nome, Líder incluído (regra 2-1). Sem dono ("play up to 1 [Pacifista]"), só Personagens.
    m = p.match(/^(?:cards?)?/i);
    spec.kinds = spec.side === 'any' ? ['character'] : ['leader', 'character'];
  } else {
    return null;
  }
  // "Your Characters with a cost of 7 or less cannot be K.O.'d": sem quantidade, o plural vale para todos.
  if (!quantified && /^Characters$/i.test(m![0])) {
    spec.all = true;
    spec.upTo = 99;
  }
  p = p.slice(m![0].length);
  if (applyTrailing(p, spec, true) === null) return null;
  // "with a total cost of 4 or less": o jogador escolhe quais (não são todas).
  if (spec.all && (spec.totalMaxCost !== undefined || spec.totalMaxPower !== undefined)) spec.all = false;
  // Sem dono nem "your": só "Character(s)" (ou "Stage") pode ser de qualquer jogador.
  if (spec.side === 'any' && spec.kinds.some((k) => k !== 'character' && k !== 'stage')) return null;
  return spec;
}

// ---------------------------------------------------------------------------
// Filtros de cartas fora do campo (mão, deck, descarte)
// ---------------------------------------------------------------------------

export function parseCardFilter(phrase: string): { upTo: number; filter: CardFilter } | null {
  const base = parseCardFilterBase(phrase);
  if (base) return base;
  // "up to 1 "Slash" attribute card or green Event", "1 Character card with 1000 power or less or up to 1 Event card"
  const t = phrase.trim();
  const q = t.match(/^((?:up to )?\d+ |)/)![1];
  const body = t.slice(q.length);
  for (const at of [...body.matchAll(/ or /g)].map((x) => x.index!)) {
    const a = parseCardFilterBase(`${q}${body.slice(0, at)}`);
    const second = body.slice(at + 4).replace(/^up to \d+ /i, '');
    const b = a && parseCardFilterBase(`${q}${second}`);
    if (a && b) return { upTo: a.upTo, filter: { either: [a.filter, b.filter] } };
  }
  return null;
}

function parseCardFilterBase(phrase: string): { upTo: number; filter: CardFilter } | null {
  let p = phrase.trim();
  let upTo = 1;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^up to (\d+) /i)) || (m = p.match(/^(\d+) /))) {
    upTo = Number(m[1]);
    p = p.slice(m[0].length);
  } else if ((m = p.match(/^an? /i))) {
    p = p.slice(m[0].length);
  }
  // "up to 1 of your Character cards … from your trash"
  if ((m = p.match(/^of your (?=.*\b(?:cards?|Characters?|Events?|Stages?)\b)/i))) p = p.slice(m[0].length);
  const filter: CardFilter = {};
  for (let guard = 0; guard < 4; guard++) {
    if ((m = p.match(/^(red|green|blue|purple|black|yellow) /i))) filter.color = m[1].toLowerCase() as Color;
    else if ((m = p.match(/^((?:\{[^}]+\})(?:\s*(?:,|or)\s*\{[^}]+\})*) type or "(\w+)" attribute\s*/i))) {
      filter.hasAnyType = typesOf(m[1]);
      filter.orAttribute = m[2];
    } else if ((m = p.match(/^"(\w+)" attribute\s*/i))) filter.attribute = m[1];
    else if ((m = p.match(TYPE_LIST))) filter.hasAnyType = typesOf(m[1]);
    else if ((m = p.match(/^((?:\[[^\]]+\],? )+(?:or|and) \[[^\]]+\])\s*/))) filter.names = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
    else if ((m = p.match(/^\[([^\]]+)\]\s*/))) filter.name = m[1];
    else break;
    p = p.slice(m[0].length);
  }
  if ((m = p.match(/^(Character|Event|Stage)(?: cards?|s)?/i))) {
    filter.category = m[1].toLowerCase() as CardCategory;
  } else if ((m = p.match(/^cards?/i))) {
    // qualquer categoria
  } else if (filter.name || filter.names || filter.hasAnyType || filter.attribute) {
    m = p.match(/^/);
  } else {
    return null;
  }
  p = p.slice(m![0].length);
  if (applyTrailing(p, filter, false) === null) return null;
  return { upTo, filter };
}

// ---------------------------------------------------------------------------
// Condições
// ---------------------------------------------------------------------------

export function parseCondition(text: string): Condition | null {
  // "you have 0 DON!! cards on your field or 8 or more DON!! cards on your field"
  const or = text.trim().match(/^(you have) (.+?) or (\d+ or (?:more|less) .+)$/i);
  if (or) {
    const a = parseCondition(`${or[1]} ${or[2]}`);
    const b = parseCondition(`${or[1]} ${or[3]}`);
    if (a && b) return { anyOf: [a, b] };
    // "you have 0 or 3 or more DON!! cards on your field": o primeiro número usa o substantivo do segundo.
    const noun = or[3].replace(/^\d+ or (?:more|less) /i, '');
    const a2 = /^\d+$/.test(or[2]) ? parseCondition(`${or[1]} ${or[2]} ${noun}`) : null;
    if (a2 && b) return { anyOf: [a2, b] };
  }
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^you have (\d+) or more Characters$/i))) return { minCharacters: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or less Characters$/i))) {
    return { not: { opponentMatching: { count: Number(m[1]) + 1, spec: { side: 'opponent', kinds: ['character'], upTo: 99 } } } };
  }
  if (/^your Leader is active$/i.test(t)) return { leaderActive: true };
  if ((m = t.match(/^you only have Characters with a type including "([^"]+)"$/i))) return { onlyTypeIncludes: m[1] };
  if (/^you only have Characters without a Counter$/i.test(t)) return { onlyCharactersWithoutCounter: true };
  if (/^all of your DON!! cards are rested$/i.test(t)) return { allDonRested: true };
  if ((m = t.match(/^the number of DON!! cards on your field is at least (\d+) less than the number on your opponent's field$/i))) {
    return { deficit: { what: 'don', n: Number(m[1]) } };
  }
  if ((m = t.match(/^the number of cards in your hand is at least (\d+) less than the number in your opponent's hand$/i))) {
    return { deficit: { what: 'hand', n: Number(m[1]) } };
  }
  if ((m = t.match(/^the number of your Characters is at least (\d+) less than the number of your opponent's Characters$/i))) {
    return { deficit: { what: 'characters', n: Number(m[1]) } };
  }
  if ((m = t.match(/^you have \[([^\]]+)\] and \[([^\]]+)\] in your trash$/i))) return { trashHasNames: [m[1], m[2]] };
  if ((m = t.match(/^there is a Character with (\d+) base power or more$/i))) return { anyCharacterMinBasePower: Number(m[1]) };
  if (/^your opponent's Character has been K\.O\.'d during this turn$/i.test(t)) return { opponentCharacterKOThisTurn: true };
  if ((m = t.match(/^you have (\d+) \{([^}]+)\} type Characters with different card names$/i))) return { distinctTyped: { type: m[2], count: Number(m[1]) } };
  if ((m = t.match(/^you have \[([^\]]+)\] and \[([^\]]+)\] Characters with (\d+) base power$/i))) {
    return { haveNamed: [m[1], m[2]], haveNamedBasePower: Number(m[3]) };
  }
  if (/^the chosen Character has a cost equal to the number of DON!! cards given to it$/i.test(t)) return { chosenCostEqualsDon: true };
  if ((m = t.match(/^your opponent has (\d+) or more rested cards$/i))) return { opponentRestedCardsMin: Number(m[1]) };
  if ((m = t.match(/^your Leader is ((?:\[[^\]]+\] or )+\[[^\]]+\])$/i))) return { leaderNames: [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]) };
  if ((m = t.match(/^either you or your opponent has (\d+) Life cards?$/i))) {
    return { anyOf: [{ lifeMin: Number(m[1]), lifeMax: Number(m[1]) }, { opponentLifeMin: Number(m[1]), opponentLifeMax: Number(m[1]) }] };
  }
  if ((m = t.match(/^either you or your opponent has (\d+) DON!! cards on the field$/i))) {
    return { anyOf: [{ minDonOnField: Number(m[1]) }, { opponentMinDonOnField: Number(m[1]) }] };
  }
  if ((m = t.match(/^there is (?:a|no) \[([^\]]+)\] Character$/i))) {
    return /\bno\b/i.test(t) ? { not: { anyCharacterNamed: m[1] } } : { anyCharacterNamed: m[1] };
  }
  if ((m = t.match(/^you have \[([^\]]+)\] with (\d+) power or more(?: on your field)?$/i))) {
    return { ownMatching: { count: 1, spec: { side: 'own', kinds: ['character'], upTo: 99, name: m[1], minPower: Number(m[2]) } } };
  }
  if ((m = t.match(/^there are no other \[([^\]]+)\] cards$/i)) || (m = t.match(/^you have no other \[([^\]]+)\] with a base cost of \d+$/i))) {
    return { noOtherNamed: m[1] };
  }
  if ((m = t.match(/^you have no (Characters? .+)$/i))) {
    const inner = parseCondition(`you have a ${m[1].replace(/^Characters\b/, 'Character')}`);
    if (inner) return { not: inner };
  }
  if ((m = t.match(/^(?:the trashed card|the revealed card) has (a cost of .+)$/i))) {
    const f = parseCardFilter(`1 card with ${m[1]}`);
    if (f) return { chosenMatches: f.filter };
  }
  if (/^this Character is active$/i.test(t)) return { selfActive: true };
  if ((m = t.match(/^your Leader's colors include (red|green|blue|purple|black|yellow)$/i))) return { leaderColor: m[1].toLowerCase() as Color };
  if ((m = t.match(/^your Leader has (\d+) power or less$/i))) return { leaderMaxPower: Number(m[1]) };
  if ((m = t.match(/^your opponent's Leader has (\d+) power or more$/i))) return { opponentLeaderMinPower: Number(m[1]) };
  if ((m = t.match(/^you and your opponent have a total of (\d+) or more Life cards$/i))) return { totalLifeMin: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or less DON!! cards on their field$/i))) return { opponentMaxDonOnField: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) Life cards?$/i))) return { opponentLifeMin: Number(m[1]), opponentLifeMax: Number(m[1]) };
  if ((m = t.match(/^your Leader is "([^"]+)"$/i))) return { leaderName: m[1] };
  if ((m = t.match(/^your Leader's card name includes "([^"]+)"$/i))) return { leaderNameIncludes: m[1] };
  if ((m = t.match(/^your Leader has (\d+) power or more$/i))) return { leaderMinPower: Number(m[1]) };
  if (/^you have less Characters than your opponent$/i.test(t)) return { fewerCharacters: true };
  if ((m = t.match(/^there are (\d+) or more Characters with a cost of (\d+) or more$/i))) {
    return { anyCharactersWithCost: { count: Number(m[1]), cost: Number(m[2]) } };
  }
  if ((m = t.match(/^your Leader is \[([^\]]+)\] or multicolored$/i))) return { anyOf: [{ leaderName: m[1] }, { leaderMulticolor: true }] };
  if ((m = t.match(/^you have \[([^\]]+)\] on your field$/i))) return { haveCharacterNamed: m[1] };
  if ((m = t.match(/^you only have \{([^}]+)\} type Characters$/i))) return { onlyTypedCharacters: m[1] };
  if ((m = t.match(/^you have no other \[([^\]]+)\](?: Characters?)?$/i))) return { noOtherNamed: m[1] };
  if ((m = t.match(/^your Leader has the \{([^}]+)\} type or the "(\w+)" attribute$/i))) {
    return { anyOf: [{ leaderHasType: m[1] }, { leaderAttribute: m[2] }] };
  }
  if ((m = t.match(/^your Leader has the \{([^}]+)\} type or a type including "([^"]+)"$/i))) {
    return { anyOf: [{ leaderHasType: m[1] }, { leaderHasType: m[2] }] };
  }
  if ((m = t.match(/^your opponent has a Character with a cost of (\d+) or with a cost of (\d+) or more$/i))) {
    const spec = (min: number, max?: number): TargetSpec => ({ side: 'opponent', kinds: ['character'], upTo: 99, minCost: min, ...(max !== undefined ? { maxCost: max } : {}) });
    return { anyOf: [{ opponentMatching: { count: 1, spec: spec(Number(m[1]), Number(m[1])) } }, { opponentMatching: { count: 1, spec: spec(Number(m[2])) } }] };
  }
  if ((m = t.match(/^you have (\d+) Characters$/i))) return { minCharacters: Number(m[1]), maxCharacters: Number(m[1]) };
  if ((m = t.match(/^the only Characters on your field are \{([^}]+)\} type Characters$/i))) return { onlyTypedCharacters: m[1] };
  if ((m = t.match(/^you have an? \{([^}]+)\} type Character$/i))) return { minTypedCharacters: { count: 1, type: m[1] } };
  if ((m = t.match(/^you have an? \{([^}]+)\} type Character with (\d+) power or more$/i))) {
    return { ownTypedCharacterMinPower: { type: m[1], power: Number(m[2]) } };
  }
  if ((m = t.match(/^you have a total of (\d+) or less cards in your Life area and hand$/i))) return { lifeHandMax: Number(m[1]) };
  if ((m = t.match(/^your deck has (\d+) cards$/i))) return { deckMax: Number(m[1]) };
  if (/^it is your second turn or later$/i.test(t)) return { minTurn: 3 };
  if (/^this (?:Leader|Character) battles your opponent's Character during this turn$/i.test(t)) return { selfBattledCharacter: true };
  if ((m = t.match(/^you have (\d+) or less active DON!! cards$/i))) return { maxActiveDon: Number(m[1]) };
  if ((m = t.match(/^you have (\d+) or more rested DON!! cards$/i))) return { minRestedDon: Number(m[1]) };
  if ((m = t.match(/^you do not have (\d+) (.+)$/i))) {
    const inner = parseCondition(`you have ${m[1]} or more ${m[2]}`);
    return inner ? { not: inner } : null;
  }
  if ((m = t.match(/^the total cost of your Characters is (\d+) or more$/i))) return { totalCharacterCostMin: Number(m[1]) };
  if ((m = t.match(/^you have (\d+) or more Characters with a cost of (\d+) or more$/i))) {
    return { charactersWithCost: { count: Number(m[1]), cost: Number(m[2]) } };
  }
  if ((m = t.match(/^you have activated an Event with a base cost of (\d+) or more during this turn$/i))) return { activatedEventMinCost: Number(m[1]) };
  if ((m = t.match(/^your opponent's Leader has the "?(\w+)"? attribute$/i))) return { opponentLeaderAttribute: m[1] };
  if ((m = t.match(/^(?:the revealed card's|that card's) type includes "([^"]+)"$/i))) return { chosenMatches: { typeIncludes: m[1] } };
  if (/^this Character is rested$/i.test(t)) return { selfRested: true };
  if ((m = t.match(/^you have (\d+) or more DON!! cards on your field$/i))) return { minDonOnField: Number(m[1]) };
  if (/^your opponent has more DON!! cards on their field than you$/i.test(t)) return { opponentMoreDon: true };
  if ((m = t.match(/^your Leader has the \{([^}]+)\} type$/i))) return { leaderHasType: m[1] };
  if ((m = t.match(/^your Leader is \[([^\]]+)\]$/i))) return { leaderName: m[1] };
  if ((m = t.match(/^you have (\d+) or less cards in your hand$/i))) return { handMax: Number(m[1]) };
  if ((m = t.match(/^you have (\d+) or less Life cards$/i))) return { lifeMax: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or less Life cards$/i))) return { opponentLifeMax: Number(m[1]) };
  if ((m = t.match(/^you and your opponent have a total of (\d+) or less Life cards$/i))) return { totalLifeMax: Number(m[1]) };
  if ((m = t.match(/^there is a Character with a cost of (\d+)( or more| or less)?$/i))) {
    const n = Number(m[1]);
    return { anyCharacterCost: /more/i.test(m[2] ?? '') ? { min: n } : /less/i.test(m[2] ?? '') ? { max: n } : { min: n, max: n } };
  }
  if ((m = t.match(/^you don't have \[([^\]]+)\]$/i))) return { noCharacterNamed: m[1] };
  if ((m = t.match(/^there is a Character with (\d+) power or more$/i))) return { anyCharacterMinPower: Number(m[1]) };
  if (/^your Leader is multicolored$/i.test(t)) return { leaderMulticolor: true };
  if (/^your Leader is monocolored$/i.test(t)) return { leaderMonocolor: true };
  if ((m = t.match(/^your Leader has the "?(\w+)"? attribute$/i))) return { leaderAttribute: m[1] };
  if ((m = t.match(/^you have \[([^\]]+)\] and \[([^\]]+)\]$/i))) return { haveNamed: [m[1], m[2]] };
  if ((m = t.match(/^there is a Character with a cost of (\d+) or with a cost of (\d+) or more$/i))) {
    return { anyOf: [{ anyCharacterCost: { min: Number(m[1]), max: Number(m[1]) } }, { anyCharacterCost: { min: Number(m[2]) } }] };
  }
  if ((m = t.match(/^the revealed card has the chosen cost$/i))) return { revealedHasChosenCost: true };
  if (/^you have a face-up Life card$/i.test(t)) return { faceUpLifeMin: 1 };
  if ((m = t.match(/^you have (\d+) or less (.*?Characters? with .*)$/i))) {
    const spec = parseTarget(`up to 99 of your ${m[2]}`);
    if (spec && typeof spec === 'object') return { ownMatchingMax: { count: Number(m[1]), spec: { ...spec, side: 'own', upTo: 99 } } };
  }
  if ((m = t.match(/^that Character has (.+)$/i))) {
    const f = parseCardFilter(`1 Character with ${m[1]}`);
    return f ? { chosenMatches: f.filter } : null;
  }
  if ((m = t.match(/^you have (\d+) or more cards in your hand$/i))) return { handMin: Number(m[1]) };
  if (/^you have less Life cards than your opponent$/i.test(t)) return { lifeLessThanOpponent: true };
  if ((m = t.match(/^you have (\d+) or less DON!! cards on your field$/i))) return { maxDonOnField: Number(m[1]) };
  if ((m = t.match(/^you have (?:a )?\[([^\]]+)\](?: Character)?$/i))) return { haveCharacterNamed: m[1] };
  if ((m = t.match(/^you have (\d+) or more cards in your trash$/i))) return { trashMin: Number(m[1]) };
  if (/^the number of DON!! cards on your field is equal to or less than the number on your opponent's field$/i.test(t)) {
    return { donLeqOpponent: true };
  }
  if ((m = t.match(/^your Leader has the ((?:\{[^}]+\})(?:\s*(?:,|or)\s*\{[^}]+\})+) type$/i))) return { leaderHasAnyType: typesOf(m[1]) };
  if ((m = t.match(/^you have a Character with a cost of (\d+) or more$/i))) return { ownCharacterMinCost: Number(m[1]) };
  if ((m = t.match(/^you have a Character with (\d+) base power or more$/i))) return { ownCharacterMinBasePower: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or more cards in their hand$/i))) return { opponentHandMin: Number(m[1]) };
  if ((m = t.match(/^this (?:Character|Leader) has (\d+) power or more$/i))) return { selfMinPower: Number(m[1]) };
  if (/^you have any DON!! cards given$/i.test(t)) return { anyDonGiven: true };
  if (/^this Character was played on this turn$/i.test(t)) return { selfPlayedThisTurn: true };
  if ((m = t.match(/^your opponent has a Character with (\d+) power or more$/i))) return { opponentCharacterMinPower: Number(m[1]) };
  if ((m = t.match(/^you have (\d+) or more \{([^}]+)\} type Characters$/i))) {
    return { minTypedCharacters: { count: Number(m[1]), type: m[2] } };
  }
  if ((m = t.match(/^your opponent has (\d+) or more Life cards$/i))) return { opponentLifeMin: Number(m[1]) };
  if ((m = t.match(/^(?:the revealed card|that card) (?:is|has) (.+)$/i))) {
    const what = m[1].replace(/^an? (?!cost of)/i, '');
    const f = /^a cost of/i.test(what) ? parseCardFilter(`1 card with ${what}`) : parseCardFilter(`1 ${what}`);
    return f ? { chosenMatches: f.filter } : null;
  }
  if ((m = t.match(/^you have a \{([^}]+)\} type Character with a cost of (\d+) or more$/i))) {
    return { ownTypedCharacterMinCost: { type: m[1], cost: Number(m[2]) } };
  }
  if ((m = t.match(/^your opponent has a Character with a cost of (\d+) or more$/i))) return { opponentCharacterMinCost: Number(m[1]) };
  if ((m = t.match(/^your Leader has the \{([^}]+)\} type or is \[([^\]]+)\]$/i))) {
    return { leaderTypeOrName: { type: m[1], name: m[2] } };
  }
  if ((m = t.match(/^you have no other \[([^\]]+)\] Characters$/i))) return { noOtherNamed: m[1] };
  if ((m = t.match(/^you have (\d+) or less Characters$/i))) return { maxCharacters: Number(m[1]) };
  if ((m = t.match(/^you have a total of (\d+) or more given DON!! cards$/i))) return { minGivenDon: Number(m[1]) };
  if (/^your opponent has any DON!! cards given$/i.test(t)) return { opponentAnyDonGiven: true };
  if ((m = t.match(/^you have (\d+) or more active DON!! cards$/i))) return { minActiveDon: Number(m[1]) };
  if (/^you have any active DON!! cards$/i.test(t)) return { minActiveDon: 1 };
  if ((m = t.match(/^you have (\d+) or more Events in your trash$/i))) return { trashEventsMin: Number(m[1]) };
  if ((m = t.match(/^you have a Character with (\d+) power or more$/i))) return { ownCharacterMinPower: Number(m[1]) };
  if (/^the number of your Life cards is equal to or less than the number of your opponent's Life cards$/i.test(t)) {
    return { lifeLeqOpponent: true };
  }
  if ((m = t.match(/^you have (\d+) or less cards in your deck$/i))) return { deckMax: Number(m[1]) };
  if ((m = t.match(/^you have (\d+) or more rested ((?:\{[^}]+\})(?:\s*(?:,|or)\s*\{[^}]+\})*) type Characters$/i))) {
    return { minRestedTyped: { count: Number(m[1]), types: typesOf(m[2]) } };
  }
  if ((m = t.match(/^you have (\d+) or more ((?:\{[^}]+\})(?:\s*(?:,|or)\s*\{[^}]+\})+) type Characters(?: on your field)?$/i))) {
    return { minTypedCharacters: { count: Number(m[1]), type: typesOf(m[2])[0] } };
  }
  if ((m = t.match(/^your Leader is \[([^\]]+)\] or has the \{([^}]+)\} type$/i))) {
    return { leaderTypeOrName: { type: m[2], name: m[1] } };
  }
  if ((m = t.match(/^you have (\d+) DON!! cards on your field$/i))) return { minDonOnField: Number(m[1]), maxDonOnField: Number(m[1]) };
  if ((m = t.match(/^you have (\d+) Life cards$/i))) return { lifeMin: Number(m[1]), lifeMax: Number(m[1]) };
  // "You may X. If you do, Y.": Y entra no trecho pulado pela recusa (ver parseBody).
  if (/^you do$/i.test(t)) return {};
  if ((m = t.match(/^you have (\d+) cards in your hand$/i))) return { handMax: Number(m[1]), handMin: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or more DON!! cards on their field$/i))) {
    return { opponentMinDonOnField: Number(m[1]) };
  }
  if ((m = t.match(/^you have (\d+) or more Life cards$/i))) return { lifeMin: Number(m[1]) };
  if ((m = t.match(/^your opponent has a Character with (\d+) or more power$/i))) {
    return { opponentCharacterMinPower: Number(m[1]) };
  }
  if ((m = t.match(/^you have (\d+) or more rested Characters$/i))) return { minRestedCharacters: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or more rested Characters$/i))) return { opponentMinRestedCharacters: Number(m[1]) };
  // "If your Leader's type includes "CP"" / "If your Leader has a type including "CP"": CP9, CP0… contam.
  if ((m = t.match(/^your Leader(?:'s type includes| has a type including) "([^"]+)"$/i))) return { leaderTypeIncludes: m[1] };
  // "If that card is a Character, that Character …": o passo seguinte já só vale para Personagens.
  if (/^that card is a Character$/i.test(t)) return {};
  // Contagem genérica: "you have 2 or more Characters with 6000 base power", "your opponent has a Character with a [Trigger]"
  if ((m = t.match(/^(you have|your opponent has) (\d+ or more|an?) (.+)$/i)) && !/ and (?:you|your) /i.test(m[3])) {
    const count = /^an?$/i.test(m[2]) ? 1 : Number(m[2].match(/\d+/)![0]);
    const opp = /opponent/i.test(m[1]);
    const spec = parseTarget(`up to 99 of ${opp ? "your opponent's" : 'your'} ${m[3]}`);
    if (spec && typeof spec === 'object' && spec.kinds.length) {
      const { upTo: _u, side: _s, ...rest } = spec;
      const c = { count, spec: { ...rest, side: opp ? 'opponent' : 'own', upTo: 99 } as TargetSpec };
      return opp ? { opponentMatching: c } : { ownMatching: c };
    }
  }
  // Várias condições: "If your Leader has the {X} type and you have 2 or less Life cards"
  const parts = t.split(/ and (?=(?:you and your opponent |you (?!and )|your (?!opponent have)|there |this |the number))/i);
  if (parts.length > 1) {
    const all = parts.map(parseCondition);
    if (all.some((c) => c === null)) return null;
    return Object.assign({}, ...all);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ações (uma oração = um ou mais passos)
// ---------------------------------------------------------------------------

type ClauseRule = [RegExp, (m: RegExpMatchArray) => EffectStep[] | null];

const onlyCharacters = (t: TargetRef | null): t is TargetRef =>
  t !== null && (typeof t !== 'object' || t.kinds.every((k) => k === 'character'));

const withTarget = (phrase: string, make: (t: TargetRef) => EffectStep, charactersOnly = false): EffectStep[] | null => {
  const t = parseTarget(phrase);
  if (!t || (charactersOnly && !onlyCharacters(t))) return null;
  return [make(t)];
};

/**
 * "Give up to N rested DON!! cards to your Leader or 1 of your Characters": o alvo não tem "up to",
 * mas dar 0 DON!! é permitido; o motor dá o que houver a quem foi escolhido, então escolher
 * ninguém é o jeito de dar 0.
 */
const donTarget = (t: TargetRef): TargetRef => {
  if (typeof t !== 'object' || !t.required) return t;
  const { required: _r, ...rest } = t;
  return rest;
};

const durationOf = (d: string): Duration =>
  /battle/i.test(d)
    ? 'battle'
    : /opponent's next (?:turn|End Phase)/i.test(d)
      ? 'nextOpponentTurn'
      : /start of your next turn/i.test(d)
        ? 'untilYourNextTurn'
        : /end of your next turn/i.test(d)
          ? 'endOfYourNextTurn'
          : 'turn';
/** Durações escritas no fim das frases. */
const DUR =
  "(during this turn|during this battle|until the end of your opponent's next turn|until the end of your opponent's next End Phase|until the start of your next turn|until the end of your next turn)";

/**
 * Restrição a um jogador: "you cannot <body>" ou "your opponent cannot <body>", "during this turn" ou
 * "until the end of your opponent's next turn". Em `extra`, os grupos de `body` começam em m[2].
 */
function restriction(body: string, kind: RestrictionKind, extra?: (m: RegExpMatchArray) => { minCost?: number }): ClauseRule {
  return [
    new RegExp(`^(you|your opponent) cannot ${body} (during this turn|until the end of your opponent's next turn)$`, 'i'),
    (m) => [
      {
        do: 'restrict',
        kind,
        ...extra?.(m),
        ...(/opponent/i.test(m[1]) ? { opponent: true as const } : {}),
        ...(/next turn/i.test(m[m.length - 1]) ? { duration: 'nextOpponentTurn' as const } : {}),
      },
    ],
  ];
}

const CLAUSES: ClauseRule[] = [
  [/^Return up to (\d+) Stages? to the owner's hand$/i, (m) => [{ do: 'returnToHand', target: { side: 'any', kinds: ['stage'], upTo: Number(m[1]) } }]],
  [
    /^Your opponent places (\d+) Events from their trash at the bottom of their deck(?: in any order)?$/i,
    (m) => [{ do: 'opponentTrashToBottom', count: Number(m[1]), filter: { category: 'event' } }],
  ],
  [
    /^For every (.+?) on your field, (.+)$/i,
    (m) => {
      const per = parseTarget(`up to 99 of your ${m[1].replace(/ card$/i, ' cards')}`);
      const steps = parseClause(m[2]);
      if (!per || typeof per !== 'object' || steps?.length !== 1 || steps[0].do !== 'power') return null;
      return [{ ...steps[0], per: { ...per, all: true } }];
    },
  ],
  [
    /^play (up to \d+ .+?) and the same card name as the trashed card from your trash$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f ? [{ do: 'playFrom', from: 'trash', upTo: f.upTo, filter: { ...f.filter, sameNameAsChosen: true } }] : null;
    },
  ],
  [/^Change the attack target to the selected Character$/i, () => [{ do: 'redirectAttack', spec: { side: 'own', kinds: ['character'], upTo: 1 }, toChosen: true }]],
  [
    /^Change the target of the attack to (your .+)$/i,
    (m) => {
      const spec = parseTarget(m[1].replace(/^your /i, 'up to 1 of your '));
      return spec && typeof spec === 'object' ? [{ do: 'redirectAttack', spec, noLeader: true }] : null;
    },
  ],
  [
    new RegExp(`^This Character's base power becomes the same as the selected Character's power ${DUR}$`, 'i'),
    (m) => [{ do: 'basePower', target: 'self', copy: 'chosen', duration: durationOf(m[1]) }],
  ],
  [
    new RegExp(`^This Character's base power becomes the same as the power of your opponent's attacking Leader or Character ${DUR}$`, 'i'),
    (m) => [{ do: 'basePower', target: 'self', copy: 'attacker', duration: durationOf(m[1]) }],
  ],
  [
    /^Draw a card for each of (your .+)$/i,
    (m) => {
      const spec = parseTarget(m[1].replace(/^your /i, 'all of your '));
      return spec && typeof spec === 'object' ? [{ do: 'drawPerMatching', spec }] : null;
    },
  ],
  [/^trash the same number of cards from your hand$/i, () => [{ do: 'trashEventCount', from: 'hand' }]],
  [/^Trash the same number of cards from the top of your deck as you did from your hand$/i, () => [{ do: 'trashEventCount', from: 'deck' }]],
  [/^Your opponent chooses (\d+) cards? from your hand; trash that card$/i, (m) => [{ do: 'opponentPicksFromHand', count: Number(m[1]) }]],
  [/^Choose (\d+) cards? from your opponent's hand; your opponent reveals (?:that card|those cards)$/i, (m) => [{ do: 'revealOpponentHand', count: Number(m[1]) }]],
  [/^place up to (\d+) cards? from your opponent's Life area at the bottom of the owner's deck$/i, (m) => [{ do: 'opponentLifeToBottom', count: Number(m[1]) }]],
  [
    /^(Return|Place) (up to \d+ .+?) and (up to \d+ .+?) (to the owner's hand|at the bottom of the owner's deck(?: in any order)?)$/i,
    (m) => {
      const a = parseTarget(m[2]);
      const b = parseTarget(m[3]);
      if (!onlyCharacters(a) || !onlyCharacters(b)) return null;
      const verb = /hand/i.test(m[4]) ? 'returnToHand' : 'toDeckBottom';
      return [{ do: verb, target: a }, { do: verb, target: b }] as EffectStep[];
    },
  ],
  [
    /^Give your Leader and (\d+) Character up to (\d+) rested DON!! cards? each$/i,
    (m) => [
      { do: 'giveRestedDon', target: 'ownLeader', count: Number(m[2]) },
      { do: 'giveRestedDon', target: { side: 'own', kinds: ['character'], upTo: Number(m[1]) }, count: Number(m[2]) },
    ],
  ],
  [
    /^activate the \[Main\] effect of (up to 1 .+?) in your trash$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f ? [{ do: 'activateEventFromTrash', filter: { ...f.filter, category: 'event' } }] : null;
    },
  ],
  [
    /^Play (up to \d+ .+?) and (up to \d+ .+?) from your (hand or trash|hand|trash)( rested)?$/i,
    (m) => {
      const a = parseCardFilter(m[1]);
      const b = parseCardFilter(m[2]);
      if (!a || !b) return null;
      const from = (m[3].toLowerCase() === 'hand or trash' ? 'handOrTrash' : m[3].toLowerCase()) as 'hand' | 'trash' | 'handOrTrash';
      return [a, b].map((f) => ({ do: 'playFrom', from, upTo: f.upTo, filter: f.filter, ...(m[4] ? { rested: true } : {}) }) as EffectStep);
    },
  ],
  [
    new RegExp(`^Set the cost of (.+?) to 0 ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'cost', target, amount: -99, duration: durationOf(m[2]) }), true),
  ],
  [
    // "Your Leader with a type including "Baroque Works" becomes 7000 base power during this turn"
    new RegExp(`^Your Leader with a type including "([^"]+)" becomes (\\d+) base power ${DUR}$`, 'i'),
    (m) => [{ do: 'basePower', target: 'ownLeader', amount: Number(m[2]), duration: durationOf(m[3]), if: { leaderTypeIncludes: m[1] } }],
  ],
  [
    new RegExp(`^(.+?) becomes (\\d+) base power ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'basePower', target, amount: Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    // "add up to 1 card with a type including "CP" from your hand face-up to the top or bottom of your Life cards"
    /^add (up to \d+ .+?) from your hand face-(up|down) to the top or bottom of your Life cards$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      if (!f) return null;
      const step: EffectStep = { do: 'handToLife', upTo: f.upTo, filter: f.filter, choose: true };
      if (m[2].toLowerCase() === 'up') step.faceUp = true;
      return [step];
    },
  ],
  [
    new RegExp(`^(.+?) gains \\[(Double Attack|Banish|Blocker|Rush)\\], \\[(Double Attack|Banish|Blocker|Rush)\\] or \\[(Double Attack|Banish|Blocker|Rush)\\] ${DUR}$`, 'i'),
    (m) => {
      const t = parseTarget(m[1]);
      if (!t) return null;
      const kws = [m[2], m[3], m[4]];
      return [
        {
          do: 'chooseOne',
          chooser: 'self',
          options: kws.map((k) => [{ do: 'gainKeyword', target: t, keyword: KEYWORDS[k.toLowerCase()], duration: durationOf(m[5]) } as EffectStep]),
          labels: kws.map((k) => `[${k}]`),
        },
      ];
    },
  ],
  [
    new RegExp(`^negate the effect of (.+?) and that Character cannot attack ${DUR}$`, 'i'),
    (m) =>
      withTarget(m[1], (target) => ({ do: 'negate', target, duration: durationOf(m[2]) }))?.concat([
        { do: 'cannotAttack', target: 'chosen', duration: durationOf(m[2]) },
      ]) ?? null,
  ],
  [
    /^Your opponent cannot activate \[Blocker\] when the card given these DON!! cards attacks during this turn$/i,
    () => [{ do: 'noBlockerWhenAttacking', target: 'chosen' }],
  ],
  [/^your opponent cannot activate \[Blocker\] whenever your Leader attacks during this turn$/i, () => [{ do: 'noBlockerWhenAttacking', target: 'ownLeader' }]],
  [
    new RegExp(`^(.+?) gains \\[Rush: Character\\] and the "(\\w+)" attribute ${DUR}$`, 'i'),
    (m) =>
      withTarget(m[1], (target) => ({ do: 'gainKeyword', target, keyword: 'rushCharacter', duration: durationOf(m[3]) }))?.concat([
        { do: 'gainAttribute', target: 'chosen', attribute: m[2], duration: durationOf(m[3]) },
      ]) ?? null,
  ],
  [
    /^your opponent plays (up to \d+ .+?) from their hand$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f ? [{ do: 'opponentPlays', upTo: f.upTo, filter: f.filter }] : null;
    },
  ],
  [/^your opponent may add (\d+) DON!! cards? from their DON!! deck and set (?:it|them) as active$/i, (m) => [{ do: 'opponentAddDon', count: Number(m[1]) }]],
  [/^return DON!! cards from your field to your DON!! deck until you have the same number of DON!! cards on your field as your opponent$/i, () => [{ do: 'donMatchOpponent' }]],
  [
    /^at the end of this (turn|battle), (.+)$/i,
    (m) => {
      const steps = parseClause(m[2]);
      return steps && [{ do: 'delayed', steps, ...(/battle/i.test(m[1]) ? { when: 'battle' as const } : {}) }];
    },
  ],
  [
    /^place the (\d+) Character played by this effect at the bottom of the owner's deck at the end of this turn$/i,
    () => [{ do: 'delayed', steps: [{ do: 'toDeckBottom', target: 'chosen' }], keepChosen: true }],
  ],
  [
    new RegExp(`^give all of your opponent's Characters [−-]?(\\d+) power ${DUR} for every DON!! card given to that Character$`, 'i'),
    (m) => [{ do: 'powerPerDon', target: { side: 'opponent', kinds: ['character'], upTo: 99, all: true }, amount: -Number(m[1]), duration: durationOf(m[2]) }],
  ],
  [
    new RegExp(`^(.+?) gains \\+(\\d+) power ${DUR} per 1 cost on the revealed card$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'powerPerRevealedCost', target, amount: Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [/^reveal up to 1 card from the top of your Life cards$/i, () => [{ do: 'revealLifeTop' }]],
  [
    /^trash (\d+) cards? from the top of each of your and your opponent's Life cards$/i,
    (m) => [
      { do: 'trashLife', side: 'own', count: Number(m[1]) },
      { do: 'trashLife', side: 'opponent', count: Number(m[1]) },
    ],
  ],
  [/^you win the game$/i, () => [{ do: 'winGame' }]],
  [/^take an extra turn after this one$/i, () => [{ do: 'extraTurn' }]],
  [
    /^Up to (\d+) of your opponent's rested Character or DON!! cards will not become active in your opponent's next Refresh Phase$/i,
    (m) => [
      {
        do: 'chooseOne',
        chooser: 'self',
        options: [
          [{ do: 'skipRefresh', target: { side: 'opponent', kinds: ['character'], upTo: Number(m[1]), rested: true } }],
          [{ do: 'skipRefreshDon', count: Number(m[1]) }],
        ],
        labels: ['Personagem', 'DON!!'],
      },
    ],
  ],
  [/^up to (\d+) of your opponent's rested DON!! cards will not become active in your opponent's next Refresh Phase$/i, (m) => [{ do: 'skipRefreshDon', count: Number(m[1]) }]],
  [/^your opponent rests (\d+) of their active DON!! cards at the start of their next Main Phase$/i, (m) => [{ do: 'skipRefreshDon', count: Number(m[1]) }]],
  [
    /^Up to (\d+) of your opponent's rested cards will not become active in your opponent's next Refresh Phase$/i,
    (m) => [{ do: 'skipRefresh', target: { side: 'opponent', kinds: ['leader', 'character', 'stage'], upTo: Number(m[1]), rested: true } }],
  ],
  [/^Trash all of your Characters$/i, () => [{ do: 'trashTarget', target: { side: 'own', kinds: ['character'], upTo: 99, all: true } }]],
  [
    new RegExp(`^Select up to 2 of your opponent's Characters, and give 1 Character [−-]?(\\d+) power and the other [−-]?(\\d+) power ${DUR}$`, 'i'),
    (m) => [
      { do: 'power', target: { side: 'opponent', kinds: ['character'], upTo: 1 }, amount: -Number(m[1]), duration: durationOf(m[3]) },
      { do: 'power', target: { side: 'opponent', kinds: ['character'], upTo: 1 }, amount: -Number(m[2]), duration: durationOf(m[3]) },
    ],
  ],
  [
    /^Until the end of your opponent's next turn, none of the selected Characters can attack unless your opponent trashes (\d+) cards from their hand whenever they attack$/i,
    (m) => [{ do: 'attackTax', target: 'chosen', count: Number(m[1]), duration: 'nextOpponentTurn' }],
  ],
  [
    /^K\.O\. up to (\d+) of your opponent's Characters (with .+?) or your opponent's Stages (with .+)$/i,
    (m) => {
      const a = parseTarget(`up to ${m[1]} of your opponent's Characters ${m[2]}`);
      const b = parseTarget(`up to ${m[1]} of your opponent's Stages ${m[3]}`);
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
      const part = (t: TargetSpec): Partial<TargetSpec> => {
        const { side: _s, upTo: _u, ...rest } = t;
        return rest;
      };
      return [{ do: 'ko', target: { side: 'opponent', kinds: ['character', 'stage'], upTo: Number(m[1]), either: [part(a), part(b)] } }];
    },
  ],
  [
    new RegExp(`^Swap the base power of your Leader and 1 Character with each other ${DUR}$`, 'i'),
    (m) => [{ do: 'swapBasePower', spec: { side: 'any', kinds: ['character'], upTo: 1 }, duration: durationOf(m[1]), withLeader: true }],
  ],
  [
    /^Give up to (\d+) DON!! cards? from (?:its owner's|your opponent's) cost area to (?:its owner's Leader or 1 of their Characters|(\d+) of your opponent's Characters)$/i,
    (m) => [
      {
        do: 'giveRestedDon',
        target: { side: 'opponent', kinds: m[2] ? ['character'] : ['leader', 'character'], upTo: 1 },
        count: Number(m[1]),
        fromOpponent: true,
        anyState: true,
      },
    ],
  ],
  [/^return (\d+) DON!! cards? from your field to your DON!! deck$/i, (m) => [{ do: 'payCost', cost: { donMinus: Number(m[1]) } }]],
  [
    /^(.+?) and, if ([^,]+), (.+)$/i,
    (m) => {
      const first = parseClause(m[1]);
      const cond = parseCondition(m[2]);
      const second = cond && parseClause(m[3]);
      return first && second ? [...first, ...second.map((st) => ({ ...st, if: { ...st.if, ...cond } }))] : null;
    },
  ],
  [/^Return all cards in your hand to your deck and shuffle your deck$/i, () => [{ do: 'handAllToDeck', who: 'self' }]],
  [/^Your opponent returns all cards in their hand to their deck and shuffles their deck$/i, () => [{ do: 'handAllToDeck', who: 'opponent' }]],
  [/^draw cards equal to the number you returned to your deck$/i, () => [{ do: 'drawEventCount', returned: true }]],
  // P-046 Yamato: "place all cards in your hand at the bottom of your deck in any order. If you do, draw cards equal to …"
  [/^place all cards in your hand at the bottom of your deck(?: in any order)?$/i, () => [{ do: 'handAllToDeck', who: 'self', bottom: true }]],
  [/^draw cards equal to the number you placed at the bottom of your deck$/i, () => [{ do: 'drawEventCount', returned: true }]],
  [/^your opponent draws (\d+) cards?$/i, (m) => [{ do: 'opponentDraws', count: Number(m[1]) }]],
  [/^trash all cards from your hand$/i, () => [{ do: 'trashHand' }]],
  [/^you take (\d+) damage$/i, (m) => [{ do: 'takeDamage', count: Number(m[1]) }]],
  [/^Trash cards from your hand until you have (\d+) cards? in your hand$/i, (m) => [{ do: 'trashHandUntil', count: Number(m[1]) }]],
  [
    /^you and your opponent trash cards from your hands until you each have (\d+) cards? in your hands$/i,
    (m) => [{ do: 'trashHandUntil', count: Number(m[1]), both: true }],
  ],
  [
    /^Your opponent (?:returns|chooses) (\d+) of their (.+?)(?: and return)? to the owner's hand$/i,
    (m) => {
      const spec = parseTarget(`up to ${m[1]} of your ${m[2].replace(/\bCharacter\b/, 'Characters')}`);
      return spec && typeof spec === 'object' && spec.kinds.join() === 'character'
        ? [{ do: 'opponentChoosesOwn', count: Number(m[1]), spec: { ...spec, side: 'own' }, action: 'hand' }]
        : null;
    },
  ],
  [
    /^Your opponent places (\d+) of their (.+?) at the bottom of (?:the owner's|their) deck$/i,
    (m) => {
      const spec = parseTarget(`up to ${m[1]} of your ${m[2]}`);
      return spec && typeof spec === 'object' && spec.kinds.join() === 'character'
        ? [{ do: 'opponentChoosesOwn', count: Number(m[1]), spec: { ...spec, side: 'own' }, action: 'bottom' }]
        : null;
    },
  ],
  [/^Set all of your DON!! cards as active$/i, () => [{ do: 'setDonActive', count: 99 }]],
  [/^turn all of your Life cards face-down$/i, () => [{ do: 'lifeFace', count: 99, up: false }]],
  [/^(?:you may )?deal (\d+) damage to your opponent$/i, (m) => [{ do: 'takeDamage', count: Number(m[1]), opponent: true }]],
  [/^trash cards from the top of your Life cards until you have (\d+) Life cards?$/i, (m) => [{ do: 'lifeTrashUntil', count: Number(m[1]) }]],
  [/^trash this (?:Character|Stage|card)$/i, () => [{ do: 'trashSelf' }]],
  [/^the selected Character will not become active in your next Refresh Phase$/i, () => [{ do: 'skipRefresh', target: 'chosen' }]],
  [
    new RegExp(`^Give (.+?) \\+(\\d+) cost ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'cost', target, amount: Number(m[2]), duration: durationOf(m[3]) }), true),
  ],
  [
    /^Set (up to \d+ of your .+?) and your Leader as active$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'setActive', target }))?.concat([{ do: 'setActive', target: 'ownLeader' }]) ?? null,
  ],
  [
    /^Rest this Character and (up to \d+ of your opponent's .+)$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'rest', target }))?.concat([{ do: 'rest', target: 'self' }]) ?? null,
  ],
  [
    /^Your opponent trashes (\d+) cards? from their hand and reveals their hand$/i,
    (m) => [{ do: 'opponentDiscards', count: Number(m[1]) }],
  ],
  [
    /^(up to \d+ of your .+?) can attack Characters on the turn in which (?:it is|they are) played$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'gainKeyword', target, keyword: 'rushCharacter', duration: 'turn' }), true),
  ],
  [
    /^trash (\d+) of your (.+? Characters?)$/i,
    (m) => {
      const spec = parseTarget(`up to ${m[1]} of your ${m[2]}`);
      return spec && typeof spec === 'object' ? [{ do: 'trashOwn', count: Number(m[1]), spec }] : null;
    },
  ],
  [
    /^Trash (\d+) (.+?) from your hand$/i,
    (m) => {
      if (/^cards?$/i.test(m[2])) return null;
      const f = parseCardFilter(`1 ${m[2]}`);
      return f ? [{ do: 'trashFromHand', count: Number(m[1]), filter: f.filter }] : null;
    },
  ],
  [
    /^Look at (\d+) cards from the top of your deck and place them at the top of your deck in any order$/i,
    (m) => [{ do: 'arrangeTop', look: Number(m[1]), topOnly: true }],
  ],
  [/^Add this (?:Character )?card from your trash to your hand$/i, () => [{ do: 'addThisToHand' }]],
  [/^this (?:Character|Leader) will not become active in your next Refresh Phase$/i, () => [{ do: 'skipRefresh', target: 'self' }]],
  [
    /^(.+?) cannot attack until the start of your next turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'untilYourNextTurn' })),
  ],
  [
    new RegExp(`^(?:none of )?(.+?) (?:can|cannot) be K\\.O\\.'d by (?:your opponent's )?effects ${DUR}$`, 'i'),
    (m) => {
      if (!/^none of /i.test(m[0]) && !/cannot/i.test(m[0])) return null;
      const phrase = m[1].replace(/^your /i, 'all of your ');
      const byEffect = /by your opponent's effects/i.test(m[0]) ? 'opponent' : true;
      return withTarget(phrase, (target) => ({ do: 'cannotBeKO', target, duration: durationOf(m[2]), byEffect }), true);
    },
  ],
  [
    new RegExp(`^this Character cannot be K\\.O\\.'d in battle and gains \\+(\\d+) power ${DUR}$`, 'i'),
    (m) => [
      { do: 'cannotBeKO', target: 'self', duration: durationOf(m[2]), inBattle: true },
      { do: 'power', target: 'self', amount: Number(m[1]), duration: durationOf(m[2]) },
    ],
  ],
  [
    /^(?:this|the) Character(?:'s)? effect is negated during this turn$/i,
    () => [{ do: 'negate', target: 'self', duration: 'turn' }],
  ],
  [
    /^The Character played with this effect gains \[(Rush|Blocker|Double Attack|Banish|Unblockable)\] during this turn$/i,
    (m) => [{ do: 'gainKeyword', target: 'chosen', keyword: KEYWORDS[m[1].toLowerCase()], duration: 'turn' }],
  ],
  [
    new RegExp(`^Your Leader and this Character's base power becomes (\\d+) ${DUR}$`, 'i'),
    (m) => [
      { do: 'basePower', target: 'ownLeader', amount: Number(m[1]), duration: durationOf(m[2]) },
      { do: 'basePower', target: 'self', amount: Number(m[1]), duration: durationOf(m[2]) },
    ],
  ],
  [
    new RegExp(`^(all of your .+?)(?:'s|') base power becomes (\\d+) ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'basePower', target, amount: Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    // "Choose up to 1 of your opponent's Characters with a cost of 4 or less and K.O. it"
    /^Choose (up to \d+ .+?) and K\.O\. it$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'ko', target }), true),
  ],
  [
    // "K.O. or rest up to 1 …": o jogador escolhe a carta e depois o que fazer.
    /^K\.O\. or rest (up to \d+ .+)$/i,
    (m) =>
      withTarget(m[1], (target) => ({ do: 'select', target }), true)?.concat([
        { do: 'chooseOne', chooser: 'self', options: [[{ do: 'ko', target: 'chosen' }], [{ do: 'rest', target: 'chosen' }]], labels: ['K.O.', 'Virar'] },
      ]) ?? null,
  ],
  [
    // "K.O. up to 1 … or return it to the owner's hand"
    /^K\.O\. (up to \d+ .+?),? or return it to the owner's hand$/i,
    (m) =>
      withTarget(m[1], (target) => ({ do: 'select', target }), true)?.concat([
        {
          do: 'chooseOne',
          chooser: 'self',
          options: [[{ do: 'ko', target: 'chosen' }], [{ do: 'returnToHand', target: 'chosen' }]],
          labels: ['K.O.', 'Devolver à mão'],
        },
      ]) ?? null,
  ],
  [
    // "Return up to 1 Character … to the owner's hand or (place it at) the bottom of their deck"
    /^Return (up to \d+ .+?) to the owner's hand or (?:place it at )?the bottom of (?:their|the owner's) deck$/i,
    (m) =>
      withTarget(m[1], (target) => ({ do: 'select', target }), true)?.concat([
        {
          do: 'chooseOne',
          chooser: 'self',
          options: [[{ do: 'returnToHand', target: 'chosen' }], [{ do: 'toDeckBottom', target: 'chosen' }]],
          labels: ['Devolver à mão', 'Fundo do deck'],
        },
      ]) ?? null,
  ],
  [
    // "Set this Character or up to 1 of your DON!! cards as active"
    /^Set this Character or up to (\d+) of your DON!! cards? as active$/i,
    (m) => [
      {
        do: 'chooseOne',
        chooser: 'self',
        options: [[{ do: 'setActive', target: 'self' }], [{ do: 'setDonActive', count: Number(m[1]) }]],
        labels: ['Desvirar este Personagem', `Desvirar ${m[1]} DON!!`],
      },
    ],
  ],
  [
    // "Give up to 1 each of your opponent's Leader and Character cards −2000 power during this turn"
    new RegExp(`^Give up to (\\d+) each of your opponent's Leader and Character cards [−-]?(\\d+) power ${DUR}$`, 'i'),
    (m) => [
      { do: 'power', target: { side: 'opponent', kinds: ['leader'], upTo: 1 }, amount: -Number(m[2]), duration: durationOf(m[3]) },
      { do: 'power', target: { side: 'opponent', kinds: ['character'], upTo: Number(m[1]) }, amount: -Number(m[2]), duration: durationOf(m[3]) },
    ],
  ],
  [
    new RegExp(`^Negate the effect of up to (\\d+) of each of your opponent's Leader and Character cards ${DUR}$`, 'i'),
    (m) => [
      { do: 'negate', target: { side: 'opponent', kinds: ['leader'], upTo: 1 }, duration: durationOf(m[2]) },
      { do: 'negate', target: { side: 'opponent', kinds: ['character'], upTo: Number(m[1]) }, duration: durationOf(m[2]) },
    ],
  ],
  [
    /^Reveal 1 card from the top of your deck and place it at the top or bottom of your deck$/i,
    () => [{ do: 'revealTop' }, { do: 'revealedToTopOrBottom' }],
  ],
  [
    /^Look at (\d+) cards from the top of your deck,? (?:reorganize them in any order and )?place them at the top or bottom of your deck$/i,
    (m) => [{ do: 'arrangeTop', look: Number(m[1]) }],
  ],
  [
    /^Select (up to \d+ .+?) from your trash and play it or add it to the top of your Life cards face-up$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'handPlayOrLife', filter: f.filter, from: 'trash' }];
    },
  ],
  [
    /^(?:Place|Add) (.+?) (?:at|to) the top or bottom of (?:the owner's|their|your opponent's) Life cards face-(up|down)$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'fieldToLife', target, choose: true, ...(m[2].toLowerCase() === 'up' ? { faceUp: true } : {}) }), true),
  ],
  [
    /^(?:Place|Return) (.+?) at the bottom of (?:the owner's|its owner's|your|your opponent's) deck in any order$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'toDeckBottom', target }), true),
  ],
  [/^rest (\d+) of your DON!! cards?$/i, (m) => [{ do: 'payCost', cost: { restDon: Number(m[1]) } }]],
  [
    /^Place up to (\d+) cards? from your opponent's trash at the bottom of (?:the owner's|their) deck$/i,
    (m) => [{ do: 'opponentTrashToBottom', count: Number(m[1]), upTo: true, chooser: 'self' }],
  ],
  [
    // "K.O. up to 1 … with a cost of 3 or less and up to 1 … with a cost of 2 or less"
    /^K\.O\. (up to \d+ .+?) and (up to \d+ .+)$/i,
    (m) => {
      const a = parseTarget(m[1]);
      const b = parseTarget(m[2]);
      const noLeader = (t: TargetRef | null): t is TargetRef => t !== null && (typeof t !== 'object' || !t.kinds.includes('leader'));
      return noLeader(a) && noLeader(b) ? [{ do: 'ko', target: a }, { do: 'ko', target: b }] : null;
    },
  ],
  [
    /^K\.O\. (.+)$/i,
    (m) => {
      const target = parseTarget(m[1]);
      // K.O. vale para Personagens e Stages (nunca Líderes).
      if (!target || (typeof target === 'object' && target.kinds.includes('leader'))) return null;
      return [{ do: 'ko', target }];
    },
  ],
  [/^Rest up to (\d+) of your opponent's DON!! cards?$/i, (m) => [{ do: 'restOpponentDon', count: Number(m[1]) }]],
  [/^Rest (.+)$/i, (m) => withTarget(m[1], (target) => ({ do: 'rest', target }))],
  [/^Set up to (\d+) of your DON!! cards? as active$/i, (m) => [{ do: 'setDonActive', count: Number(m[1]) }]],
  [
    /^Set (up to \d+ of your .+?) and up to (\d+) of your DON!! cards? as active$/i,
    (m) => {
      const target = parseTarget(m[1]);
      return target ? [{ do: 'setActive', target }, { do: 'setDonActive', count: Number(m[2]) }] : null;
    },
  ],
  [
    /^Give (up to \d+ of your .+?|your Leader and all of your Characters) up to (\d+) rested DON!! cards? each$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'giveRestedDon', target, count: Number(m[2]) })),
  ],
  [
    // "Give up to a total of 4 of your Leader or Characters 1 rested DON!! card each"
    /^Give (up to (?:a total of )?\d+ of your .+?) (\d+) rested DON!! cards? each$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'giveRestedDon', target, count: Number(m[2]) })),
  ],
  [
    // "This Character and up to 1 of your Leader gain +1000 power during this turn" (P-036): esta carta
    // sempre, a outra é escolha (Q&A P-036: dá para dar aos dois; pago o custo, esta carta ganha).
    new RegExp(`^This (?:Character|Leader) and (up to \\d+ of your .+?) gains? \\+(\\d+) power ${DUR}$`, 'i'),
    (m) => {
      const duration = durationOf(m[3]);
      const amount = Number(m[2]);
      const other = withTarget(m[1], (target) => ({ do: 'power', target, amount, duration }));
      return other && [{ do: 'power', target: 'self', amount, duration }, ...other];
    },
  ],
  [
    // "Your Leader gains +1000 power for each of your Characters during this turn" (P-024): conta ao resolver.
    new RegExp(`^(.+?) gains? \\+(\\d+) power for each of (your .+?) ${DUR}$`, 'i'),
    (m) => {
      const spec = parseTarget(m[3].replace(/^your /i, 'all of your '));
      if (!spec || typeof spec !== 'object') return null;
      return withTarget(m[1], (target) => ({ do: 'powerPerMatching', target, amount: Number(m[2]), spec, duration: durationOf(m[4]) }));
    },
  ],
  [
    // "Your Leader with 5000 power or less and up to 2 of your Characters gain +1000 power during this turn"
    new RegExp(`^Your Leader(?: with (\\d+) power or (less|more))? and (up to \\d+ of your .+?) gains? \\+(\\d+) power ${DUR}$`, 'i'),
    (m) => {
      const duration = durationOf(m[5]);
      const amount = Number(m[4]);
      const cond: Condition | undefined = m[1] ? (/less/i.test(m[2]) ? { leaderMaxPower: Number(m[1]) } : { leaderMinPower: Number(m[1]) }) : undefined;
      const chars = withTarget(m[3], (target) => ({ do: 'power', target, amount, duration }));
      return chars && [{ do: 'power', target: 'ownLeader', amount, duration, ...(cond ? { if: cond } : {}) }, ...chars];
    },
  ],
  [
    /^place (\d+) cards? from your hand at the (top or bottom|top|bottom) of your deck(?: in any order)?$/i,
    (m) => [{ do: 'handToDeck', count: Number(m[1]), where: /or/i.test(m[2]) ? 'choose' : (m[2].toLowerCase() as 'top' | 'bottom') }],
  ],
  [/^Set (.+) as active$/i, (m) => withTarget(m[1], (target) => ({ do: 'setActive', target }))],
  [
    /^Return (.+) to (?:the owner's|its owner's|your|your opponent's) hand$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'returnToHand', target }), true),
  ],
  [
    /^Place (.+) at the bottom of (?:the owner's|its owner's|your|your opponent's) deck$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'toDeckBottom', target }), true),
  ],
  [
    /^Give up to (\d+) of your opponent's rested DON!! cards? to (.+)$/i,
    (m) => withTarget(m[2], (target) => ({ do: 'giveRestedDon', target: donTarget(target), count: Number(m[1]), fromOpponent: true })),
  ],
  [
    /^Give up to (\d+) rested DON!! cards? to (.+)$/i,
    (m) => withTarget(m[2], (target) => ({ do: 'giveRestedDon', target: donTarget(target), count: Number(m[1]) })),
  ],
  [
    /^Give (.+?) up to (\d+) rested DON!! cards?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'giveRestedDon', target: donTarget(target), count: Number(m[2]) })),
  ],
  [
    new RegExp(`^Give (.+?) [−-](\\d+) power ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: -Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    // Spoilers: "Give up to 1 Character +3000 power during this turn" (o "+" explícito é bônus).
    new RegExp(`^Give (.+?) \\+(\\d+) power ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    // Sem sinal: a API perde o "−" ("Give … 2000 power" = −2000). "Give" nunca dá poder positivo.
    new RegExp(`^Give (.+?) (\\d+) power ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: -Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    /^Give (.+?) [−-]?(\d+) cost during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cost', target, amount: -Number(m[2]), duration: 'turn' }), true),
  ],
  [
    new RegExp(`^(.+?) gains? \\+(\\d+) power ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    new RegExp(`^(.+?) gains? \\[(Rush|Blocker|Double Attack|Banish|Unblockable|Rush: Character)\\] ${DUR}$`, 'i'),
    (m) =>
      withTarget(m[1], (target) => ({ do: 'gainKeyword', target, keyword: KEYWORDS[m[2].toLowerCase()], duration: durationOf(m[3]) })),
  ],
  [
    /^Draw (\d+) cards? and trash (\d+) cards? from your hand$/i,
    (m) => [
      { do: 'draw', count: Number(m[1]) },
      { do: 'trashFromHand', count: Number(m[2]) },
    ],
  ],
  [/^Draw (\d+) cards?$/i, (m) => [{ do: 'draw', count: Number(m[1]) }]],
  // 4-5-4: uma por vez, podendo parar a qualquer momento.
  [/^Draw up to (\d+) cards?$/i, (m) => [{ do: 'draw', count: Number(m[1]), upTo: true }]],
  [/^Draw a card$/i, () => [{ do: 'draw', count: 1 }]],
  [/^Reveal 1 card from the top of your deck$/i, () => [{ do: 'revealTop' }]],
  [
    /^Trash up to (\d+) of your opponent's (.+)$/i,
    (m) => withTarget(`up to ${m[1]} of your opponent's ${m[2]}`, (target) => ({ do: 'trashTarget', target }), true),
  ],
  [/^trash (\d+) cards? from your opponent's hand$/i, (m) => [{ do: 'trashRandomFromOpponentHand', count: Number(m[1]) }]],
  [
    /^Draw (\d+) cards? and place (\d+) cards? from your hand at the bottom of your deck$/i,
    (m) => [
      { do: 'draw', count: Number(m[1]) },
      { do: 'handToDeckBottom', count: Number(m[2]) },
    ],
  ],
  [
    /^add up to (\d+) DON!! cards? as active from your DON!! deck$/i,
    (m) => [{ do: 'addDonFromDeck', count: Number(m[1]) }],
  ],
  [
    /^add (\d+) cards? from the top or bottom of your Life cards to your hand$/i,
    (m) => [{ do: 'lifeToHand', count: Number(m[1]), choose: true }],
  ],
  [
    /^Return (.+?) to the bottom of (?:the owner's|its owner's) deck$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'toDeckBottom', target }), true),
  ],
  [
    /^Reveal 1 card from the top of your deck and play (up to 1 .+?)( rested)?$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'revealTop' }, m[2] ? { do: 'playRevealed', filter: f.filter, rested: true } : { do: 'playRevealed', filter: f.filter }];
    },
  ],
  [
    /^Reveal 1 card from the top of your deck and add (up to 1 .+) to your hand$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'revealTop' }, { do: 'revealedToHand', filter: f.filter }];
    },
  ],
  [/^Look at 1 card from the top of your opponent's deck$/i, () => [{ do: 'lookOpponentTop' }]],
  [
    /^Activate up to 1 (.*?Events?.*?) from your hand$/i,
    (m) => {
      const f = parseCardFilter(`1 ${m[1]}`);
      return f ? [{ do: 'activateEventFromHand', filter: { ...f.filter, category: 'event' } }] : null;
    },
  ],
  [/^Reveal 1 card from the top of your Life cards$/i, () => [{ do: 'revealLifeTop' }]],
  [
    /^play (up to \d+ .+?) from your hand that is a different color than the returned Character$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'playFrom', from: 'hand', upTo: f.upTo, filter: f.filter, notColorOfLast: true }];
    },
  ],
  [
    /^Give up to (\d+)(?: total)? of your currently given DON!! cards to (\d+ of your .+)$/i,
    (m) => withTarget(`up to ${m[2]}`, (target) => ({ do: 'moveGivenDon', count: Number(m[1]), target })),
  ],
  [
    /^Select (up to 1 .+?) from your hand and play it or add it to the top of your Life cards face-up$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'handPlayOrLife', filter: f.filter }];
    },
  ],
  [
    new RegExp(`^Your opponent's \\[On Play\\] effects are negated ${DUR}$`, 'i'),
    (m) => [{ do: 'negateOnPlay', who: 'opponent', duration: durationOf(m[1]) }],
  ],
  [
    /^this Leader cannot attack your opponent's Characters with a base cost of (\d+) or less during this turn$/i,
    (m) => [{ do: 'cannotAttackCharacters', maxBaseCost: Number(m[1]), duration: 'turn' }],
  ],
  [/^draw cards equal to the number of cards trashed$/i, () => [{ do: 'drawEventCount' }]],
  [
    /^rest any number of your DON!! cards for \+(\d+) power to (.+)$/i,
    (m) => {
      const phrase = m[2].replace(/^this Leader or up to 1 of your (.+)$/i, 'up to 1 of your Leader or $1');
      const t = parseTarget(phrase.replace(/ Characters$/i, ' Leader or Character cards').replace(/Leader or (\{[^}]+\} type) Leader or Character cards/i, '$1 Leader or Character cards'));
      if (!t) return null;
      return [{ do: 'restDonForPower', power: Number(m[1]), target: t }];
    },
  ],
  [
    new RegExp(`^Swap the base power of (\\d+) of (your .+?) with each other ${DUR}$`, 'i'),
    (m) => {
      const spec = parseTarget(`up to ${m[1]} of ${m[2]}`);
      return spec && typeof spec === 'object' ? [{ do: 'swapBasePower', spec, duration: durationOf(m[3]) }] : null;
    },
  ],
  [/^Trash all (?:of )?your face-up Life cards$/i, () => [{ do: 'trashFaceUpLife' }]],
  [/^place the revealed card at the top of your deck$/i, () => [{ do: 'lastToDeckTop' }]],
  [/^place the rest at the top or bottom of your deck$/i, () => [{ do: 'revealedToTopOrBottom' }]],
  // "[On Play] … this Character gains [Rush]." sem duração: vale no turno em que entra.
  [/^this Character gains \[Rush\]$/i, () => [{ do: 'gainKeyword', target: 'self', keyword: 'rush', duration: 'turn' }]],
  [/^trash (\d+) cards? from the top of your Life cards$/i, (m) => [{ do: 'lifeToTrash', count: Number(m[1]) }]],
  [
    /^look at all (?:of )?your Life cards; place 1 (?:card )?at the top of your deck and place the rest back in your Life area in any order$/i,
    () => [{ do: 'lifeOneToDeckTop' }],
  ],
  [
    /^Reveal (up to \d+ .+?) from your hand and add it to the top of your Life cards(?: face-(up|down))?$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      if (!f) return null;
      const step: EffectStep = { do: 'handToLife', upTo: f.upTo, filter: f.filter };
      if (m[2]?.toLowerCase() === 'up') step.faceUp = true;
      return [step];
    },
  ],
  [
    /^Play up to 1 each of ((?:\[[^\]]+\],? )+and \[[^\]]+\])(.*?) from your (hand|trash)$/i,
    (m) => {
      const names = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
      const f = parseCardFilter(`1 Character${m[2]}`);
      if (!f) return null;
      return [{ do: 'playFrom', from: m[3].toLowerCase() as 'hand' | 'trash', upTo: names.length, filter: { ...f.filter, names, distinctNames: true } }];
    },
  ],
  [
    new RegExp(`^((?:up to \\d+|all) of your opponent's .+?) cannot activate \\[Blocker\\] ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'cannotBlock', target, duration: durationOf(m[2]) })),
  ],
  [
    new RegExp(`^Your opponent cannot activate up to (\\d+) \\[Blocker\\] Character that has (\\d+) (?:or less power|power or less) ${DUR}$`, 'i'),
    (m) => withTarget(`up to ${m[1]} of your opponent's [Blocker] Characters with ${m[2]} power or less`, (target) => ({ do: 'cannotBlock', target, duration: durationOf(m[3]) })),
  ],
  // "from their Life area" (P-009) = do topo, como no dano (4-6-2-1).
  [/^Your opponent adds (\d+) cards? from (?:the top of their Life cards|their Life area) to their hand$/i, (m) => [{ do: 'opponentLifeToHand', count: Number(m[1]) }]],
  [
    /^Your opponent places (\d+) cards? from their trash at the bottom of their deck(?: in any order)?$/i,
    (m) => [{ do: 'opponentTrashToBottom', count: Number(m[1]) }],
  ],
  [
    /^Look at all (?:of )?(your|your opponent's) Life cards and place them back in (?:your|their) Life area in any order$/i,
    (m) => [{ do: 'arrangeLife', whose: /opponent/i.test(m[1]) ? 'opponent' : 'own' }],
  ],
  [
    /^rest up to (?:a total of )?(\d+) of your opponent's (?:DON!! cards or (.+?)|(Characters) or DON!! cards)$/i,
    (m) => {
      const what = m[2] ?? m[3];
      const spec = parseTarget(`up to 1 of your opponent's ${what}`);
      if (!spec || typeof spec !== 'object') return null;
      return Array.from({ length: Number(m[1]) }, () => ({ do: 'restDonOrCharacter', spec }) as EffectStep);
    },
  ],
  [
    /^Choose a cost and reveal 1 card from the top of your opponent's deck$/i,
    () => [{ do: 'chooseCost' }, { do: 'revealOpponentTop' }],
  ],
  [
    new RegExp(`^Negate the effects? of (.+?) and give that card [−-]?(\\d+) power ${DUR}$`, 'i'),
    (m) =>
      withTarget(m[1], (target) => ({ do: 'negate', target, duration: durationOf(m[3]) }))?.concat([
        { do: 'power', target: 'chosen', amount: -Number(m[2]), duration: durationOf(m[3]) },
      ]) ?? null,
  ],
  [new RegExp(`^Negate the effects? of (.+?) ${DUR}$`, 'i'), (m) => withTarget(m[1], (target) => ({ do: 'negate', target, duration: durationOf(m[2]) }))],
  restriction('play (?:any )?Character cards(?: on (?:your|their) field)?', 'noPlayCharacters'),
  restriction('play Character cards with a base cost of (\\d+) or more', 'noPlayCharacters', (m) => ({ minCost: Number(m[2]) })),
  restriction('add Life cards to (?:your|their) hand using (?:your|their) own effects', 'noLifeToHand'),
  restriction('attack (?:a|your) Leader', 'noAttackLeader'),
  restriction('draw cards using (?:your|their) own effects', 'noDrawByEffect'),
  restriction('set DON!! cards as active using Character effects', 'noSetDonActiveByCharacter'),
  restriction('play cards from (?:your|their) hand', 'noPlayFromHand'),
  restriction('activate \\[Blocker\\]', 'noBlocker'),
  [
    /^the next time you play (.+?) from your hand during this turn, the cost will be reduced by (\d+)$/i,
    (m) => {
      const f = parseCardFilter(`1 ${m[1].replace(/^an? /i, '')}`);
      return f ? [{ do: 'nextPlayDiscount', filter: f.filter, amount: Number(m[2]) }] : null;
    },
  ],
  [
    new RegExp(`^your (?:(\\{[^}]+\\}) type |\\[([^\\]]+)\\] |(monocolored) )?Leader's base power becomes (\\d+) ${DUR}$`, 'i'),
    (m) => {
      const cond: Condition = m[1] ? { leaderHasType: m[1].slice(1, -1) } : m[2] ? { leaderName: m[2] } : m[3] ? { leaderMonocolor: true } : {};
      const step: EffectStep = { do: 'basePower', target: 'ownLeader', amount: Number(m[4]), duration: durationOf(m[5]) };
      return [Object.keys(cond).length ? { ...step, if: cond } : step];
    },
  ],
  [
    new RegExp(`^this Character's base power becomes the same as (?:the power of )?your opponent's Leader(?:'s power)? ${DUR}$`, 'i'),
    (m) => [{ do: 'basePower', target: 'self', copy: 'opponentLeader', duration: durationOf(m[1]) }],
  ],
  [
    // «Set Power to 0» (4-12) é uma redução igual ao poder atual, não um poder base 0: DON!! e +poder posteriores somam.
    new RegExp(`^Set the power of (.+?) to 0 ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'setPowerZero', target, duration: durationOf(m[2]) })),
  ],
  [
    new RegExp(`^(up to \\d+ of .+?)(?:'s|') base power becomes (\\d+) ${DUR}$`, 'i'),
    (m) =>
      withTarget(m[1].replace(/ cards$/i, ' cards').replace(/Characters$/i, 'Characters'), (target) => ({
        do: 'basePower',
        target,
        amount: Number(m[2]),
        duration: durationOf(m[3]),
      })),
  ],
  [
    /^trash any number of (.+?) from your hand for \+(\d+) power to (this Leader|this Character|your Leader or 1 of your Characters) during this (battle|turn) each$/i,
    (m) => {
      const duration: Duration = m[4].toLowerCase() === 'battle' ? 'battle' : 'turn';
      const target: TargetRef = /^this/i.test(m[3]) ? 'self' : { side: 'own', kinds: ['leader', 'character'], upTo: 1 };
      const kinds = m[1].split(/ or /i).map((k) => k.replace(/ cards?$/i, '').toLowerCase());
      if (kinds.every((k) => k === 'event' || k === 'stage' || k === 'character')) {
        return [{ do: 'trashAnyForPower', categories: kinds as Array<'event' | 'stage' | 'character'>, power: Number(m[2]), duration, target }];
      }
      const f = parseCardFilter(`1 ${m[1].replace(/cards$/i, 'card')}`);
      return f ? [{ do: 'trashAnyForPower', filter: f.filter, power: Number(m[2]), duration, target }] : null;
    },
  ],
  [
    /^(?:Select (your Leader or 1 of your .+?)\. )?Change (?:the attack target|the target of that attack) to (?:the selected card|(this Leader or (?:to )?one of your .+))$/i,
    (m) => {
      const phrase = (m[1] ?? m[2]).replace(/^this Leader or (?:to )?one of your /i, 'your Leader or 1 of your ').replace(/ Character cards?$/i, ' Characters');
      const own = phrase.match(/^your Leader or 1 of your (.+)$/i);
      const spec = own ? parseTarget(`up to 1 of your ${own[1]}`) : null;
      if (!spec || typeof spec !== 'object') return null;
      return [{ do: 'redirectAttack', spec: { ...spec, kinds: ['character'] } }];
    },
  ],
  [
    /^add up to (\d+) DON!! cards? from your DON!! deck and set (?:it|them) as active, and add up to (\d+) additional DON!! cards? and rest (?:it|them)$/i,
    (m) => [{ do: 'addDonFromDeck', count: Number(m[1]) }, { do: 'addDonFromDeck', count: Number(m[2]), rested: true }],
  ],
  [/^play (?:that|the revealed) card( rested)?$/i, (m) => [m[1] ? { do: 'playRevealed', rested: true } : { do: 'playRevealed' }]],
  [/^place (?:the revealed card|the rest|that card) at the bottom of your deck$/i, () => [{ do: 'revealedToBottom' }]],
  [/^Play this Character card from your trash( rested)?$/i, (m) => [m[1] ? { do: 'playThis', rested: true } : { do: 'playThis' }]],
  [
    new RegExp(`^(.+?) cannot be rested ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'cannotBeRested', target, duration: durationOf(m[2]) }), true),
  ],
  [
    /^add up to (\d+) cards? from the top of your opponent's Life cards to the owner's hand$/i,
    (m) => [{ do: 'opponentLifeToHand', count: Number(m[1]) }],
  ],
  [
    /^your opponent places (\d+) cards? from their hand at the bottom of their deck(?: in any order)?$/i,
    (m) => [{ do: 'opponentHandToBottom', count: Number(m[1]) }],
  ],
  [
    /^add up to (\d+) DON!! cards? as rested from your DON!! deck$/i,
    (m) => [{ do: 'addDonFromDeck', count: Number(m[1]), rested: true }],
  ],
  [
    new RegExp(`^(.+?) gains? \\+(\\d+) cost ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'cost', target, amount: Number(m[2]), duration: durationOf(m[3]) }), true),
  ],
  [
    /^Add (up to \d+ .+?) from your (hand or trash|hand|trash) to the top of your Life cards( face-(?:up|down))?$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      if (!f) return null;
      const step: EffectStep = { do: 'handToLife', upTo: f.upTo, filter: f.filter };
      if (/or/i.test(m[2])) step.fromTrash = true;
      else if (/trash/i.test(m[2])) step.trashOnly = true;
      if (/up/i.test(m[3] ?? '')) step.faceUp = true;
      return [step];
    },
  ],

  [
    /^(.+?) will not become active in (?:your opponent's|the) next Refresh Phase$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'skipRefresh', target })),
  ],
  [
    /^(.+?) at the end of this turn$/i,
    (m) => {
      const steps = parseClause(m[1]);
      return steps && [{ do: 'delayed', steps }];
    },
  ],
  [
    /^Draw (\d+) cards? and place (\d+) cards? from your hand at the bottom of your deck in any order$/i,
    (m) => [
      { do: 'draw', count: Number(m[1]) },
      { do: 'handToDeckBottom', count: Number(m[2]) },
    ],
  ],
  [
    /^(.+?) can also attack active Characters during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'canAttackActive', target, duration: 'turn' })),
  ],
  [/^Draw (?:cards?|card\(s\)) so that you have (\d+) cards in your hand$/i, (m) => [{ do: 'drawUntil', count: Number(m[1]) }]],
  [/^Trash up to (\d+) cards? from your hand$/i, (m) => [{ do: 'trashFromHand', count: Number(m[1]), upTo: true }]],
  [/^Add (\d+) cards? from the top of your Life cards to your hand$/i, (m) => [{ do: 'lifeToHand', count: Number(m[1]) }]],
  [
    /^Your opponent returns (\d+) DON!! cards? from their field to their DON!! deck$/i,
    (m) => [{ do: 'opponentReturnsDon', count: Number(m[1]) }],
  ],
  [
    /^Your opponent cannot activate the \[Blocker\] of any Character with a cost of (\d+) or less during this battle$/i,
    (m) => [{ do: 'noBlockerThisBattle', maxCost: Number(m[1]) }],
  ],
  [
    /^Your opponent trashes (\d+) cards? from their hand$/i,
    (m) => [{ do: 'opponentDiscards', count: Number(m[1]) }],
  ],
  [
    /^Reveal (up to \d+ .+?) from your deck and add (?:it|them) to your hand$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f ? [{ do: 'tutor', upTo: f.upTo, filter: f.filter }] : null;
    },
  ],
  [
    /^(.+?) can also attack your opponent's active Characters during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'canAttackActive', target, duration: 'turn' })),
  ],
  [
    /^(.+?) cannot attack until the end of your opponent's next (?:turn|End Phase)$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'nextOpponentTurn' })),
  ],
  [
    /^(.+?) cannot attack during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'turn' })),
  ],

  [
    // "Then, if …, that card gains an additional +2000 power." (Counter: vale durante a batalha)
    /^(.+?) gains? an additional \+(\d+) power(?: during this (turn|battle))?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: Number(m[2]), duration: m[3] ? durationOf(m[3]) : 'battle' })),
  ],
  [/^Trash (\d+) cards? from your hand$/i, (m) => [{ do: 'trashFromHand', count: Number(m[1]) }]],
  [
    /^Add (?:up to )?(\d+) DON!! cards? from your DON!! deck and (set (?:it|them) as active|rest (?:it|them))$/i,
    (m) => [/rest/i.test(m[2]) ? { do: 'addDonFromDeck', count: Number(m[1]), rested: true } : { do: 'addDonFromDeck', count: Number(m[1]) }],
  ],
  [/^Play this card$/i, () => [{ do: 'playThis' }]],
  // "[On K.O.] You may add this Character card to your hand" (P-071): a carta já está no trash.
  [/^Add this (?:Character )?card to your hand$/i, () => [{ do: 'addThisToHand' }]],
  [/^Activate this card's \[Main\] effect$/i, () => [{ do: 'useMainEffect' }]],
  [/^Activate this card's \[Counter\] effect$/i, () => [{ do: 'useCounterEffect' }]],
  [/^Activate this card's \[On Play\] effect$/i, () => [{ do: 'useOwnEffect', timing: 'onPlay' }]],
  [/^Activate this card's \[On K\.O\.\] effect$/i, () => [{ do: 'useOwnEffect', timing: 'onKO' }]],
  [/^Trash (\d+) cards? from the top of your deck$/i, (m) => [{ do: 'millDeck', count: Number(m[1]) }]],
  [
    /^Your opponent chooses (\d+) cards? from their hand and trashes (?:it|them)$/i,
    (m) => [{ do: 'opponentDiscards', count: Number(m[1]) }],
  ],
  [
    /^none of your Characters can be K\.O\.'d during this turn$/i,
    () => [{ do: 'cannotBeKO', target: { side: 'own', kinds: ['character'], upTo: 99, all: true }, duration: 'turn' }],
  ],
  [
    /^Add (?:up to )?(\d+) cards? from the top of your deck to the top of your Life cards$/i,
    (m) => [{ do: 'addLifeFromDeck', count: Number(m[1]) }],
  ],
  [
    /^Trash (?:up to )?(\d+) cards? from the top of your opponent's Life cards$/i,
    (m) => [{ do: 'trashLife', side: 'opponent', count: Number(m[1]) }],
  ],
  [/^Add up to (\d+) cards? from your hand to the top of your Life cards$/i, (m) => [{ do: 'handToLife', upTo: Number(m[1]) }]],
  [
    /^Add (.+?) to the top of (?:the owner's|your|your opponent's) Life cards( face-up)?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'fieldToLife', target, ...(m[2] ? { faceUp: true } : {}) }), true),
  ],
  [
    /^Add (.+?) to the top or bottom of (?:the owner's|your|your opponent's) Life cards( face-up)?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'fieldToLife', target, choose: true, ...(m[2] ? { faceUp: true } : {}) }), true),
  ],
  [
    // Efeito opcional sem custo: "you may draw 1 card" → pergunta antes.
    /^you may (.+)$/i,
    (m) => {
      // "you may trash 1 card from your hand and rest 1 of your DON!! cards": tudo é custo.
      const asCost: AbilityCost = {};
      if (m[1].split(/ and (?=(?:rest|trash|add|place|return|turn|reveal|give) )/i).every((part) => parseCostPart(part.trim(), asCost)) && Object.keys(asCost).length > 1) {
        return [{ do: 'payCost', cost: asCost, scope: 0 }];
      }
      const rest = parseClause(m[1]);
      // "you may rest 1 of your DON!! cards": o próprio custo pergunta (sem confirmar duas vezes).
      if (rest?.length === 1 && rest[0].do === 'payCost' && rest[0].scope === undefined) return [{ ...rest[0], scope: 0 }];
      // scope: se recusar, pula só estes passos (o resto do efeito continua).
      return rest && [{ do: 'payCost', cost: {}, scope: rest.length }, ...rest];
    },
  ],
  [
    /^Look at up to 1 card from the top of (your or your opponent's|your opponent's|your) Life cards,? and place it at the top or bottom of the Life cards$/i,
    (m) => [{ do: 'peekLife', whose: /or/i.test(m[1]) ? 'either' : /opponent/i.test(m[1]) ? 'opponent' : 'own' }],
  ],
  [
    /^Draw (\d+) cards?, (.+)$/i,
    (m) => {
      const rest = parseClause(m[2]);
      return rest && [{ do: 'draw', count: Number(m[1]) }, ...rest];
    },
  ],
  [
    new RegExp(`^(.+?) gains? \\[(Rush|Blocker|Double Attack|Banish|Unblockable)\\] and \\+(\\d+) power ${DUR}$`, 'i'),
    (m) => {
      const duration = durationOf(m[4]);
      const kw = withTarget(m[1], (target) => ({ do: 'gainKeyword', target, keyword: KEYWORDS[m[2].toLowerCase()], duration }));
      // O mesmo alvo recebe o poder ('chosen' = alvos do passo anterior).
      return kw && [...kw, { do: 'power', target: 'chosen', amount: Number(m[3]), duration }];
    },
  ],
  [
    /^Play (.+?) from your (hand or trash|hand|deck|trash)( rested)?$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      if (!f) return null;
      const from = (m[2].toLowerCase() === 'hand or trash' ? 'handOrTrash' : m[2].toLowerCase()) as 'hand' | 'deck' | 'trash' | 'handOrTrash';
      const step: EffectStep = { do: 'playFrom', from, upTo: f.upTo, filter: f.filter };
      if (m[3]) step.rested = true;
      return [step];
    },
  ],
  [/^shuffle your deck$/i, () => [{ do: 'shuffleDeck' }]],
  [
    /^Add (.+?) from your trash to your hand$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f ? [{ do: 'fromTrashToHand', upTo: f.upTo, filter: f.filter }] : null;
    },
  ],
  [/^Trash up to (\d+) of your opponent's Life cards?$/i, (m) => [{ do: 'trashLife', side: 'opponent', count: Number(m[1]) }]],
  // Kaido ST04-001 (texto com errata).
  [/^Trash up to (\d+) of your opponent's cards from the top of their Life cards$/i, (m) => [{ do: 'trashLife', side: 'opponent', count: Number(m[1]) }]],
  [/^Your opponent cannot activate \[Blocker\] during this battle$/i, () => [{ do: 'noBlockerThisBattle' }]],
  [
    /^Your opponent cannot activate a \[Blocker\] Character that has (\d+) or more power during this battle$/i,
    (m) => [{ do: 'noBlockerThisBattle', minPower: Number(m[1]) }],
  ],
  [
    /^Your opponent cannot activate a \[Blocker\] Character that has (\d+) or less power during this battle$/i,
    (m) => [{ do: 'noBlockerThisBattle', maxPower: Number(m[1]) }],
  ],
  [
    /^Your opponent cannot activate \[Blocker\] if that Leader or Character attacks during this turn$/i,
    () => [{ do: 'noBlockerWhenAttacking', target: 'chosen' }],
  ],
  [
    /^(.+?) cannot be K\.O\.'d (in battle )?during this (turn|battle)$/i,
    (m) =>
      withTarget(m[1], (target) =>
        m[2]
          ? { do: 'cannotBeKO', target, duration: durationOf(m[3]), inBattle: true }
          : { do: 'cannotBeKO', target, duration: durationOf(m[3]) },
      ),
  ],
  [
    /^Look at (\d+) cards from the top of your deck and (?:return|place) them (?:at|to) the top or bottom of (?:the|your) deck in any order$/i,
    (m) => [{ do: 'arrangeTop', look: Number(m[1]) }],
  ],
  [/^Select (.+)$/i, (m) => withTarget(m[1], (target) => ({ do: 'select', target }))],
];

function parseClause(clause: string): EffectStep[] | null {
  const c = clause.trim().replace(/\.$/, '');
  // "[Trigger] K.O. … and add this card to your hand."
  const addSelf = c.match(/^(.+) and add this card to your hand$/i);
  if (addSelf) {
    const first = parseClause(addSelf[1]);
    return first && [...first, { do: 'addThisToHand' }];
  }
  for (const [re, make] of CLAUSES) {
    const m = c.match(re);
    if (m) {
      const steps = make(m);
      if (steps) return steps;
    }
  }
  // Duas ações com "and": "Draw 1 card and none of your Characters can be K.O.'d during this turn"
  for (const at of [...c.matchAll(/ and /gi)].map((x) => x.index!)) {
    const first = parseClause(c.slice(0, at).replace(/,$/, ''));
    const second = first && parseClause(c.slice(at + 5));
    if (first && second) return [...first, ...second];
  }
  // Condição no fim: "draw 1 card if you have 3 or less cards in your hand"
  const tail = c.match(/^(.+?) if (.+)$/i);
  if (tail) {
    const cond = parseCondition(tail[2]);
    const steps = cond && parseClause(tail[1]);
    if (steps) return steps.map((s) => ({ ...s, if: { ...s.if, ...cond } }));
  }
  return null;
}

/**
 * Pares de frases com significado próprio. Retorna quantas frases consumiu (0 = nenhum par),
 * ou null se reconheceu o par mas não conseguiu ler as partes.
 */
function parseSpecialPair(s: string, next: string | undefined, steps: EffectStep[]): number | null {
  let m: RegExpMatchArray | null;
  // "If any of your Characters would be K.O.'d in battle during this turn, you may X instead."
  if ((m = s.match(/^If any of your Characters would be K\.O\.'d( in battle)? during this turn, you may (.+) instead$/i))) {
    const cost: AbilityCost = {};
    if (!parseCostPart(m[2], cost)) return null;
    steps.push({ do: 'tempReplace', by: m[1] ? 'battle' : 'any', cost });
    return 1;
  }
  // "If X, (you may) choose/select Y instead (of Z)": troca o alvo do passo anterior.
  if ((m = s.match(/^If ([^,]+), (?:you may )?(?:choose|select) (.+?) instead(?: of .+)?$/i)) && steps.length) {
    const cond = parseCondition(m[1]);
    const prev = steps[steps.length - 1];
    if (!cond || !('target' in prev) || typeof prev.target !== 'object') return null;
    const phrase = /^(?:up to|all) /i.test(m[2]) ? m[2] : `up to 1 of ${m[2].replace(/\bCharacter\b/, 'Characters')}`;
    const target = parseTarget(phrase);
    if (!target || typeof target !== 'object') return null;
    steps[steps.length - 1] = { ...prev, if: { ...prev.if, not: cond } } as EffectStep;
    steps.push({ ...prev, target, if: { ...prev.if, ...cond } } as EffectStep);
    return 1;
  }
  // "Your opponent may X. If they do not, Y."
  if ((m = s.match(/^Your opponent may (.+)$/i)) && next && /^If they do not, /i.test(next)) {
    const pay = m[1].match(/^trash (\d+) cards? from the top of their Life cards$/i)
      ? ['lifeTrash', m[1].match(/\d+/)![0]]
      : m[1].match(/^trash (\d+) cards? from their hand$/i)
        ? ['discard', m[1].match(/\d+/)![0]]
        : m[1].match(/^return (\d+) of their active DON!! cards? to their DON!! deck$/i)
          ? ['returnDon', m[1].match(/\d+/)![0]]
          : null;
    const otherwise = parseBody(capitalizeFirst(next.replace(/^If they do not, /i, '')));
    if (!pay || !otherwise) return null;
    steps.push({ do: 'opponentMay', pay: pay[0] as 'lifeTrash' | 'discard' | 'returnDon', count: Number(pay[1]), otherwise });
    return 2;
  }
  // "If X, you may return any number of …": a condição vale para o par.
  const pre = s.match(/^If ([^,]+), (you may (?:K\.O\.|return|place) any number of .+)$/i);
  if (pre) {
    const cond = parseCondition(pre[1]);
    if (!cond) return null;
    const before = steps.length;
    const n = parseSpecialPair(pre[2], next, steps);
    if (!n) return n;
    for (let k = before; k < steps.length; k++) steps[k] = { ...steps[k], if: { ...cond, ...steps[k].if } };
    return n;
  }
  // "you may K.O./return any number of … . X gains +N power … for every Character K.O.'d / returned Character."
  m = s.match(/^(?:you may )?(K\.O\.|return) any number of (your .+?|Characters on your field)(?: to the owner's hand)?$/i);
  const per = next?.match(new RegExp(`^(.+?) gains (?:an additional )?\\+(\\d+) power ${DUR} for every (?:Character K\\.O\\.'d|returned Character)$`, 'i'));
  if (m && per) {
    const spec = parseTarget(`up to 99 of ${m[2].replace(/^Characters on your field$/i, 'your Characters')}`);
    const target = parseTarget(per[1]);
    if (!spec || typeof spec !== 'object' || !target) return null;
    steps.push({
      do: 'anyNumberForPower',
      source: 'field',
      action: /K\.O\./i.test(m[1]) ? 'ko' : 'hand',
      spec,
      power: Number(per[2]),
      every: 1,
      target,
      duration: durationOf(per[3]),
    });
    return 2;
  }
  m = s.match(/^(?:you may )?place any number of (.+?) from your trash at the bottom of your deck in any order$/i);
  const per2 = next?.match(new RegExp(`^(.+?) gains \\+(\\d+) power ${DUR} for every (\\d+) cards placed at the bottom of your deck$`, 'i'));
  if (m && per2) {
    const f = parseCardFilter(`1 ${m[1].replace(/ cards$/i, ' card')}`);
    const target = parseTarget(per2[1]);
    if (!f || !target) return null;
    steps.push({ do: 'anyNumberForPower', source: 'trash', action: 'bottom', filter: f.filter, power: Number(per2[2]), every: Number(per2[4]), target, duration: durationOf(per2[3]) });
    return 2;
  }
  return 0;
}

/** Corpo de um efeito (depois das marcações e do custo). */
export function parseBody(body: string): EffectStep[] | null {
  // "If X, draw 1 card. If Y, you may Z instead of drawing 1 card."
  const alt = body.trim().match(/^If ([^,]+), draw (\d+) cards?\. If ([^,]+), you may (.+?) instead of drawing \2 cards?\.?$/i);
  if (alt) {
    const a = parseCondition(alt[1]);
    const b = parseCondition(alt[3]);
    const z = parseClause(alt[4]);
    if (a && b && z) {
      const n = Number(alt[2]);
      return [
        { do: 'chooseOne', chooser: 'self', options: [[{ do: 'draw', count: n }], z], labels: [`Comprar ${n} carta(s)`, 'Usar a alternativa em vez de comprar'], if: { ...a, ...b } },
        { do: 'draw', count: n, if: { ...a, not: b } },
      ];
    }
  }
  // "If X, choose one: • A • B"
  const condModal = body.match(/^If ([^,]+), (choose one:\s*•.+)$/i);
  if (condModal) {
    const c = parseCondition(condModal[1]);
    const inner = c && parseBody(capitalizeFirst(condModal[2]));
    return inner ? inner.map((st) => ({ ...st, if: { ...c, ...st.if } })) : null;
  }
  // "Choose one: • A • B ‖ Then, C": C depois da opção escolhida.
  const common = body.match(/^(.+?)\s*‖\s*(Then, .+)$/);
  if (common) {
    const first = parseBody(common[1]);
    const tail = first && parseBody(common[2].replace(/^Then,\s*/, ''));
    return first && tail ? [...first, ...tail] : null;
  }
  // "Draw 1 card, then choose one: • A • B"
  const thenModal = body.match(/^(.+?), then (choose one:\s*•.+)$/i);
  if (thenModal) {
    const first = parseBody(thenModal[1]);
    const rest = first && parseBody(capitalizeFirst(thenModal[2]));
    return first && rest ? [...first, ...rest] : null;
  }
  // "Choose one: • A • B" / "Your opponent chooses one: • A • B"
  const modal = body.match(/^(Your opponent chooses|Choose) one:\s*•\s*(.+)$/i);
  if (modal) {
    const labels = modal[2].split(/\s*•\s*/).map((o) => o.trim()).filter(Boolean);
    const options = labels.map((o) => parseBody(o));
    if (labels.length < 2 || options.some((o) => !o)) return null;
    return [{ do: 'chooseOne', chooser: /opponent/i.test(modal[1]) ? 'opponent' : 'self', options: options as EffectStep[][], labels }];
  }
  const sentences = sentencesOf(body);
  if (!sentences.length) return null;
  const steps: EffectStep[] = [];
  // "This effect can be activated when X." no meio do efeito: condição para o resto.
  let gate: Condition | undefined;
  for (let i = 0; i < sentences.length; i++) {
    let s = sentences[i].replace(/\.$/, '').replace(/^Then,\s*/i, '');
    const gateM = s.match(/^This effect can be activated when (.+)$/i);
    if (gateM) {
      const c = parseCondition(gateM[1]);
      if (!c) return fail(`cond: ${gateM[1]}`);
      gate = c;
      continue;
    }
    const before0 = steps.length;
    const special = parseSpecialPair(s, sentences[i + 1]?.replace(/\.$/, '').replace(/^Then,\s*/i, ''), steps);
    if (special === null) return null;
    if (special) {
      i += special - 1;
      if (gate) for (let k = before0; k < steps.length; k++) steps[k] = { ...steps[k], if: { ...gate, ...steps[k].if } };
      continue;
    }
    // "Look at N cards…; reveal up to M … and add it to your hand. Then, place the rest at the bottom…"
    // "…; reveal up to 1 X, add it to your hand and place the rest at the bottom of your deck in any order"
    const oneSentence = s.match(
      /^(Look at (?:up to )?\d+ cards from the top of your deck; reveal up to \d+ .+?), add (?:it|them) to your hand and (place the rest at the bottom of your deck in any order)$/i,
    );
    if (oneSentence) {
      s = `${oneSentence[1]} and add it to your hand`;
      sentences.splice(i + 1, 0, `Then, ${oneSentence[2]}.`);
    }
    const look =
      s.match(/^Look at (?:up to )?(\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to (?:your hand|the top of your Life cards(?: face-up)?)$/i) ??
      s.match(/^Look at (\d+) cards from the top of your deck; (play) up to (\d+) (.+?)$/i) ??
      s.match(/^Look at (\d+) cards from the top of your deck and (trash) up to (\d+) (cards?)$/i);
    if (look) {
      const play = look[2] === 'play';
      const toTrash = look[2] === 'trash';
      if (play || toTrash) look.splice(2, 1);
      const restedPlay = play && / rested$/i.test(look[3]);
      if (restedPlay) look[3] = look[3].replace(/ rested$/i, '');
      const f = parseCardFilter(look[3]);
      let next = sentences[i + 1] ?? '';
      // "Then, place the rest at the bottom of your deck in any order and play up to 1 [X] from your hand."
      const tail = next.match(/^(Then, (?:place the rest at the bottom of your deck in any order|trash the rest)),? and (.+?)\.?$/i);
      let extra: EffectStep[] | null = null;
      if (tail) {
        const tailIf = tail[2].match(/^if ([^,]+), (.+)$/i);
        const tailCond = tailIf && parseCondition(tailIf[1]);
        extra = tailIf ? (tailCond && parseClause(tailIf[2])?.map((st) => ({ ...st, if: { ...st.if, ...tailCond } }))) ?? null : parseClause(tail[2]);
        if (!extra) return fail(`search tail: ${tail[2]}`);
        next = `${tail[1]}.`;
      }
      const rest = /^Then, place the rest at the bottom of your deck in any order\.?$/i.test(next)
        ? 'bottom'
        : /^Then, trash the rest\.?$/i.test(next)
          ? 'trash'
          : /^Then, place the rest at the top or bottom of (?:the|your) deck in any order\.?$/i.test(next)
            ? 'topOrBottom'
            : null;
      if (!f || !rest) return fail(`search: ${s} | ${next}`);
      const search: EffectStep = { do: 'search', look: Number(look[1]), upTo: Number(look[2]), filter: f.filter, rest };
      if (play) search.play = true;
      if (restedPlay) search.rested = true;
      if (toTrash) search.toTrash = true;
      if (/Life cards face-up$/i.test(s)) search.toLife = true;
      else if (/Life cards$/i.test(s)) {
        search.toLife = true;
        search.lifeFaceDown = true;
      }
      steps.push(search);
      if (extra) steps.push(...extra);
      i++;
      continue;
    }
    let cond: Condition | undefined;
    const ifYouDo = /^If you do, /i.test(s);
    const before = steps.length;
    const ifm = s.match(/^If ([^,]+), (.+)$/i);
    if (ifm) {
      const c = parseCondition(ifm[1]);
      if (!c) return fail(`cond: ${ifm[1]}`);
      cond = c;
      s = ifm[2];
      // "If …, look at 5 cards…; reveal…": a busca com condição.
      if (/^look at /i.test(s)) {
        const sub = parseBody([capitalizeFirst(s) + '.', ...sentences.slice(i + 1)].join(' '));
        if (!sub) return null;
        const firstLen = sub.findIndex((st) => st.do !== 'search') === -1 ? sub.length : 1;
        steps.push(...sub.slice(0, firstLen).map((st) => ({ ...st, if: { ...cond, ...st.if } })), ...sub.slice(firstLen));
        return steps;
      }
    }
    const clauses = s.split(/,? and then |, then /i);
    // ", then look at N cards…; reveal…" (a busca no fim da frase usa a frase seguinte)
    const lastLook = clauses[clauses.length - 1].match(
      /^look at (?:up to )?(\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to your hand$/i,
    );
    if (lastLook && clauses.length > 1) {
      clauses.pop();
      sentences.splice(i + 1, 0, `Look at ${lastLook[1]} cards from the top of your deck; reveal up to ${lastLook[2]} ${lastLook[3]} and add it to your hand.`);
    }
    for (const clause of clauses) {
      const parsed = parseClause(clause);
      if (!parsed) return fail(`clause: ${clause}`);
      steps.push(...(cond && Object.keys(cond).length ? parsed.map((st) => ({ ...st, if: { ...cond, ...st.if } })) : parsed));
    }
    if (gate) for (let k = before; k < steps.length; k++) steps[k] = { ...steps[k], if: { ...gate, ...steps[k].if } };
    if (ifYouDo) {
      // Estende o trecho do último "you may" para incluir o "If you do, …".
      const opt = [...steps.slice(0, before)].reverse().find((st) => st.do === 'payCost' && st.scope !== undefined);
      if (opt && opt.do === 'payCost') opt.scope! += steps.length - before;
      // Sem "you may" antes: "Y" só acontece se o passo anterior afetou alguma carta.
      else for (let k = before; k < steps.length; k++) steps[k] = { ...steps[k], if: { ...steps[k].if, lastDone: true } };
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Linhas de efeito
// ---------------------------------------------------------------------------

interface Header {
  timings: AbilityTiming[];
  keywords: Keyword[];
  don?: number;
  oncePerTurn?: boolean;
  yourTurn?: boolean;
  opponentsTurn?: boolean;
}

function parseHeader(line: string): { h: Header; rest: string } | null {
  const h: Header = { timings: [], keywords: [] };
  let rest = line;
  for (;;) {
    const m = rest.match(/^\s*\/?\s*\[([^\]]+)\]\s*/);
    if (!m) break;
    const tag = m[1].trim();
    const t = tag.toLowerCase();
    const don = tag.match(/^DON!! x(\d+)$/i);
    if (don) h.don = Number(don[1]);
    else if (t === 'once per turn') h.oncePerTurn = true;
    else if (t === 'your turn') h.yourTurn = true;
    else if (t === "opponent's turn") h.opponentsTurn = true;
    else if (TIMINGS[t]) h.timings.push(TIMINGS[t]);
    else if (KEYWORDS[t]) h.keywords.push(KEYWORDS[t]);
    else if (t === 'trigger') return null; // ainda não suportado
    else break; // nome de carta no início da frase
    rest = rest.slice(m[0].length);
  }
  return { h, rest: rest.trim() };
}

/** Uma parte do custo ("rest this Character", "trash 1 card from your hand"...). */
function parseCostPart(part: string, cost: AbilityCost): boolean {
  let m: RegExpMatchArray | null;
  part = part.replace(/,$/, '').replace(/^(rest|trash|return|place|reveal) up to (\d+) /i, '$1 $2 ');
  if ((m = part.match(/^rest (\d+) of your opponent's Characters?$/i))) {
    cost.restOpponentChars = Number(m[1]);
    return true;
  }
  if ((m = part.match(/^give (?:this Character|your Leader) [−-]?(\d+) power during this turn$/i))) {
    if (/Leader/i.test(part)) cost.leaderPowerMinus = Number(m[1]);
    else cost.selfPowerMinus = Number(m[1]);
    return true;
  }
  if ((m = part.match(/^return (\d+) cards from your trash to your deck and shuffle it$/i))) {
    cost.trashToDeck = Number(m[1]);
    return true;
  }
  if ((m = part.match(/^play (\d+) (.+?) from your hand$/i))) {
    const f = parseCardFilter(`1 ${m[2]}`);
    if (!f) return false;
    cost.playFromHand = f.filter;
    return true;
  }
  if ((m = part.match(/^give (\d+) of your opponent's rested DON!! cards? to 1 of your opponent's Characters$/i))) {
    cost.giveOppDon = Number(m[1]);
    return true;
  }
  if ((m = part.match(/^place (\d+) cards? from your hand at the top of your deck$/i))) {
    cost.handToTop = Number(m[1]);
    return true;
  }
  if ((m = part.match(/^trash this Character with a cost of (\d+) or more$/i))) {
    cost.trashSelf = true;
    cost.selfMinCost = Number(m[1]);
    return true;
  }
  // "rest 1 [Corrida Coliseum]" / "rest 1 of your [Fish-Man Island]": carta com nome (Personagem ou Stage).
  if ((m = part.match(/^rest (\d+) (?:of your )?\[([^\]]+)\]$/i))) {
    cost.restOwn = { count: Number(m[1]), spec: { side: 'own', kinds: ['character', 'stage'], upTo: Number(m[1]), name: m[2] } };
    return true;
  }
  // "trash 1 {Fish-Man} type card from your hand or 1 [The Ark Noah] from your hand or field"
  if ((m = part.match(/^trash (\d+) (.+?) from your hand or (\d+) \[([^\]]+)\] from your hand or field$/i))) {
    const f = parseCardFilter(`1 ${m[2]}`);
    if (!f) return false;
    cost.either = [
      { trashFromHand: Number(m[1]), trashFilter: f.filter },
      { trashFromHand: Number(m[3]), trashFilter: { name: m[4] } },
      { trashOwn: { count: Number(m[3]), spec: { side: 'own', kinds: ['character', 'stage'], upTo: 1, name: m[4] } } },
    ];
    return true;
  }
  // "rest your Leader or 1 [X]", "rest 1 of your [X] or your [Y] Leader"
  if ((m = part.match(/^(rest) (.+?) or (your .+ Leader|\d+ .+)$/i))) {
    const a: AbilityCost = {};
    const b: AbilityCost = {};
    if (parseCostPart(`${m[1]} ${m[2]}`, a) && parseCostPart(`${m[1]} ${m[3]}`, b)) {
      cost.either = [a, b];
      return true;
    }
  }
  if (/^rest this (?:Character|Stage|card|Leader)$/i.test(part)) cost.restSelf = true;
  else if (/^trash this (?:Character|Stage|card)$/i.test(part)) cost.trashSelf = true;
  else if (/^K\.O\. this Character$/i.test(part)) cost.koSelf = true;
  else if (/^place this (?:Character|Stage|card) at the bottom of (?:the owner's|your) deck$/i.test(part)) cost.selfToBottom = true;
  else if ((m = part.match(/^return (\d+)( or more)? (?:of your active )?DON!! cards?(?: from your field)? to your DON!! deck$/i))) {
    cost.donMinus = Number(m[1]);
    if (m[2]) cost.donMinusOpen = true; // "1 or more": o jogador escolhe quantos
  }
  else if ((m = part.match(/^give your (?:1 )?active Leader [−-]?(\d+) power during this turn$/i))) cost.leaderPowerMinus = Number(m[1]);
  else if ((m = part.match(/^return (\d+) Characters? to your hand$/i))) {
    cost.returnOwn = { count: Number(m[1]), spec: { side: 'own', kinds: ['character'], upTo: Number(m[1]) } };
  }
  else if ((m = part.match(/^give that Character [−-]?(\d+) power during this turn$/i))) cost.victimPowerMinus = Number(m[1]);
  else if ((m = part.match(/^turn (\d+) of your face-up Life cards face-down$/i))) cost.lifeFace = { count: Number(m[1]), up: false };
  else if ((m = part.match(/^turn (\d+) cards? from the top or bottom of your Life cards face-(up|down)$/i))) {
    cost.lifeFace = { count: Number(m[1]), up: m[2].toLowerCase() === 'up' };
  } else if ((m = part.match(/^return (\d+) total of your currently given DON!! cards to your cost area rested$/i))) cost.returnGivenDon = Number(m[1]);
  else if ((m = part.match(/^add (\d+) of your (.+) to the top of your Life cards face-up$/i))) {
    const spec = parseTarget(`up to ${m[1]} of your ${m[2]}`);
    if (!spec || typeof spec !== 'object') return false;
    cost.ownToLife = { count: Number(m[1]), spec };
  } else if ((m = part.match(/^(\w+) (.+?) or (?:(\w+) )?(\d+ .+)$/i)) && !/^(?:Leader|Character|Stage|Event)/i.test(m[4]) && !/\b(?:Leader|Character)s? or$/i.test(m[2])) {
    // "trash 1 of your {X} type Characters or 1 card from your hand", "trash 1 card from your hand or rest 1 of your DON!! cards"
    const a: AbilityCost = {};
    const b: AbilityCost = {};
    if (!parseCostPart(`${m[1]} ${m[2]}`, a) || !parseCostPart(`${m[3] ?? m[1]} ${m[4]}`, b)) return false;
    cost.either = [a, b];
  }
  else if ((m = part.match(/^give (\d+) active DON!! cards? to (\d+ of your .+)$/i))) {
    const spec = parseTarget(`up to ${m[2]}`);
    if (!spec || typeof spec !== 'object') return false;
    cost.giveDon = { count: Number(m[1]), spec };
  } else if ((m = part.match(/^place (\d+) (?:of your (.+?)|((?:Stage|Character) .+?)) at the bottom of (?:the owner's|your) deck$/i))) {
    const spec = parseTarget(`up to ${m[1]} of your ${m[2] ?? m[3]}`);
    if (!spec || typeof spec !== 'object') return false;
    cost.ownToBottom = { count: Number(m[1]), spec };
  }
  else if ((m = part.match(/^rest (\d+) of your active DON!! cards?$/i))) cost.restDon = (cost.restDon ?? 0) + Number(m[1]);
  else if (/^rest your (?:1 )?Leader$/i.test(part)) cost.restOwn = { count: 1, spec: { side: 'own', kinds: ['leader'], upTo: 1 } };
  else if ((m = part.match(/^rest your (.+? Leader)$/i))) {
    const spec = parseTarget(`your ${m[1]}`);
    if (!spec || typeof spec !== 'object' || spec.kinds.join() !== 'leader') return false;
    cost.restOwn = { count: 1, spec };
  }
  else if ((m = part.match(/^K\.O\. (\d+) of your (.+)$/i))) {
    const spec = parseTarget(`up to ${m[1]} of your ${m[2]}`);
    if (!spec || typeof spec !== 'object') return false;
    cost.koOwn = { count: Number(m[1]), spec };
  } else if ((m = part.match(/^trash (\d+) of your (.*Characters?.*)$/i))) {
    const spec = parseTarget(`up to ${m[1]} of your ${m[2]}`);
    if (!spec || typeof spec !== 'object') return false;
    cost.trashOwn = { count: Number(m[1]), spec };
  }
  else if (/^return this Character to (?:the owner's|your) hand$/i.test(part)) cost.returnSelf = true;
  else if ((m = part.match(/^rest (\d+) of your DON!! cards?$/i))) cost.restDon = (cost.restDon ?? 0) + Number(m[1]);
  else if ((m = part.match(/^rest (\d+) of your Characters$/i))) cost.restCharacters = Number(m[1]);
  else if ((m = part.match(/^rest (\d+) of your cards$/i))) {
    cost.restOwn = { count: Number(m[1]), spec: { side: 'own', kinds: ['leader', 'character', 'stage'], upTo: 99 } };
  } else if ((m = part.match(/^(rest|return) (\d+) of your (.+?)(?: to (?:the owner's|your) hand)?$/i))) {
    const spec = parseTarget(`up to ${m[2]} of your ${m[3]}`);
    if (!spec || typeof spec !== 'object' || spec.side !== 'own') return false;
    const rest = m[1].toLowerCase() === 'rest';
    if (!rest && (!/hand/i.test(part) || spec.kinds.some((k) => k !== 'character'))) return false;
    if (rest) cost.restOwn = { count: Number(m[2]), spec };
    else cost.returnOwn = { count: Number(m[2]), spec };
  } else if ((m = part.match(/^trash (\d+) cards? from the top of your deck$/i))) cost.mill = Number(m[1]);
  else if ((m = part.match(/^(?:place|return) (\d+) (.+?) from your trash (?:at|to) the bottom of your deck(?: in any order)?$/i))) {
    const count = Number(m[1]);
    if (/^cards?$/i.test(m[2])) cost.trashToBottom = { count };
    else {
      const f = parseCardFilter(`${count} ${m[2]}`);
      if (!f) return false;
      cost.trashToBottom = { count, filter: f.filter };
    }
  } else if ((m = part.match(/^trash (\d+) cards? from the top( or bottom)? of your Life cards$/i))) {
    cost.lifeToTrash = { count: Number(m[1]), ...(m[2] ? { choose: true } : {}) };
  } else if ((m = part.match(/^turn (\d+) cards? from the top of your Life cards face-(up|down)$/i))) {
    cost.lifeFace = { count: Number(m[1]), up: m[2].toLowerCase() === 'up' };
  } else if ((m = part.match(/^reveal (\d+) (.+?) from your hand$/i))) {
    const f = parseCardFilter(`${m[1]} ${m[2]}`);
    if (!f) return false;
    cost.reveal = { count: Number(m[1]), filter: f.filter };
  }
  else if ((m = part.match(/^place (\d+) cards? from your hand at the bottom of your deck(?: in any order)?$/i))) cost.handToBottom = Number(m[1]);
  else if ((m = part.match(/^add (\d+) cards? from (the top or bottom of |the top of )?your Life (?:area|cards) to your hand$/i))) {
    cost.lifeToHand = Number(m[1]);
    if (/bottom/i.test(m[2] ?? '')) cost.lifeChoice = true;
  } else if ((m = part.match(/^trash (\d+) (.+?) from your hand$/i))) {
    cost.trashFromHand = Number(m[1]);
    if (!/^cards?$/i.test(m[2])) {
      const f = parseCardFilter(`1 ${m[2]}`);
      if (!f) return false;
      cost.trashFilter = f.filter;
    }
  } else return false;
  return true;
}

function parseCost(rest: string): { cost?: AbilityCost; body: string } | null {
  if (!/^([①-⑩]|DON!! -\d|You may )/.test(rest)) return { body: rest };
  const idx = rest.indexOf(':');
  if (idx < 0) return /^You may /.test(rest) ? { body: rest } : null;
  let c = rest.slice(0, idx).trim();
  const body = rest.slice(idx + 1).trim();
  const cost: AbilityCost = {};
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^([①-⑩])\s*/))) {
    cost.restDon = CIRCLED.indexOf(m[1]) + 1;
    c = c.slice(m[0].length);
  }
  if ((m = c.match(/^DON!! -(\d+)\s*/))) {
    cost.donMinus = Number(m[1]);
    c = c.slice(m[0].length);
  }
  // "DON!! −1 You may trash this Character:" → "You may trash this Character"
  c = c.replace(/^(?:and )?/, '');
  if (c) {
    // Partes do custo ligadas por "and": "You may rest this Character and add 1 card from …".
    const parts = c
      .replace(/^You may /i, '')
      .replace(/ and this (Character|Stage|card|Leader)(?= and |$)/i, ' and rest this $1')
      .replace(/^(rest|trash|return) this (Character|Stage|card) and (\d+ of your )/i, '$1 this $2 and $1 $3')
      .split(/ and (?=(?:rest|trash|add|place|return|turn|reveal|give|K\.O\.) )/i);
    for (const part of parts) if (!parseCostPart(part.trim().replace(/\.$/, ''), cost)) return null;
  }
  return { cost, body };
}

/** "When …" de habilidades que reagem a acontecimentos. */
function parseEvent(text: string): GameEvent | null {
  const t = text.trim().replace(/’/g, "'");
  // Errata de OP02-071: "on the field" (qualquer DON!! seu que volte ao seu deck de DON!!).
  if (/^a DON!! card on (?:your|the) field is returned to your DON!! deck(?: by your effect)?$/i.test(t)) return { kind: 'donReturned' };
  if (/^this Character becomes rested$/i.test(t)) return { kind: 'selfRested' };
  if (/^a Character is K\.?O\.?'d$/i.test(t)) return { kind: 'characterKO', whose: 'any' };
  if (/^(?:your opponent's Character|one of your opponent's Characters) is K\.?O\.?'d$/i.test(t)) {
    return { kind: 'characterKO', whose: 'opponent' };
  }
  if (/^you activate an Event$/i.test(t)) return { kind: 'eventActivated', who: 'self' };
  if (/^a \[Trigger\] activates$/i.test(t)) return { kind: 'triggerActivated', who: 'any' };
  if (/^your opponent activates \[Blocker\]$/i.test(t)) return { kind: 'blockerActivated', who: 'opponent' };
  if (/^your opponent activates (?:\[Blocker\] or an Event|an Event or \[Blocker\])$/i.test(t)) {
    return { kind: 'anyOf', events: [{ kind: 'blockerActivated', who: 'opponent' }, { kind: 'eventActivated', who: 'opponent' }] };
  }
  if (/^your opponent activates an Event or \[Trigger\]$/i.test(t)) {
    return { kind: 'anyOf', events: [{ kind: 'eventActivated', who: 'opponent' }, { kind: 'triggerActivated', who: 'opponent' }] };
  }
  if (/^you draw a card outside of your Draw Phase$/i.test(t)) return { kind: 'drawByEffect' };
  if (/^a card is added to your hand from your Life$/i.test(t)) return { kind: 'lifeToHand' };
  if (/^you deal damage to your opponent's Life$/i.test(t)) return { kind: 'damageDealt' };
  if (/^your opponent's Character is returned to the owner's hand by your effect$/i.test(t)) return { kind: 'returnedToHand', whose: 'opponent', by: 'self' };
  if (/^this Character (?:is|becomes) rested by your opponent's effect$/i.test(t)) return { kind: 'selfRested', byOpponent: true };
  if (/^this Character becomes rested by your opponent's Character's effect$/i.test(t)) return { kind: 'selfRested', byOpponent: true, byCharacter: true };
  if (/^your opponent activates an Event$/i.test(t)) return { kind: 'eventActivated', who: 'opponent' };
  if (/^your opponent activates a \[Blocker\]$/i.test(t)) return { kind: 'blockerActivated', who: 'opponent' };
  if (/^this (?:Character|Leader)'s attack deals damage to your opponent's Life$/i.test(t)) return { kind: 'attackDamage' };
  if (/^this Character battles and K\.O\.'s your opponent's Character$/i.test(t)) return { kind: 'battleKO' };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+) or more DON!! cards on your field are returned to your DON!! deck$/i))) return { kind: 'donReturned', min: Number(m[1]) };
  if (/^this Leader or (?:1|any) of your Characters is given a DON!! card$/i.test(t)) return { kind: 'donGiven' }; // "any": errata de OP02-002
  if (/^you take damage$/i.test(t)) return { kind: 'damageTaken' };
  if (/^a Character is rested by your effect$/i.test(t)) return { kind: 'restedByEffect' };
  if (/^your number of Life cards becomes 0$/i.test(t)) return { kind: 'lifeZero' };
  if ((m = t.match(/^a card is removed from (your or your opponent's|your opponent's|your) Life cards$/i))) {
    return { kind: 'lifeRemoved', whose: /or/i.test(m[1]) ? 'any' : /opponent/i.test(m[1]) ? 'opponent' : 'own' };
  }
  if ((m = t.match(/^a card is trashed from your hand by (?:your \{([^}]+)\} type card's|an) effect$/i))) {
    return m[1] ? { kind: 'handTrashedByEffect', sourceType: m[1] } : { kind: 'handTrashedByEffect' };
  }
  if (/^your opponent plays a Character using a Character's effect$/i.test(t)) return { kind: 'characterPlayed', who: 'opponent', byEffect: true };
  // "your Character with 6000 base power or more is K.O.'d", "one of your {X} type Characters with … is K.O.'d"
  if ((m = t.match(/^(?:one of )?your (.+?) (?:is|are) K\.O\.'d$/i))) {
    const f = parseCardFilter(`1 ${m[1].replace(/Characters\b/, 'Character')}`);
    return f && f.filter.category === 'character' ? { kind: 'characterKO', whose: 'own', filter: f.filter } : null;
  }
  // "When X or Y, …"
  const either = t.match(/^(.+?) or (your .+|you .+|a .+)$/i);
  if (either) {
    const a = parseEvent(either[1]);
    const b = parseEvent(either[2]);
    if (a && b) return { kind: 'anyOf', events: [a, b] };
  }
  if ((m = t.match(/^an? (.+?) is played from your trash$/i))) {
    const f = parseCardFilter(`1 ${m[1]}`);
    return f && f.filter.category === 'character' ? { kind: 'characterPlayed', who: 'self', filter: f.filter, from: 'trash' } : null;
  }
  if ((m = t.match(/^(you play|your opponent plays) (an? .+?|a Character)(?: from your hand)?$/i))) {
    const who = /opponent/i.test(m[1]) ? 'opponent' : 'self';
    if (/^a Character$/i.test(m[2])) return { kind: 'characterPlayed', who };
    const f = parseCardFilter(`1 ${m[2].replace(/^an? /i, '')}`);
    return f && f.filter.category === 'character' ? { kind: 'characterPlayed', who, filter: f.filter } : null;
  }
  if ((m = t.match(/^your Leader (with .+) attacks or is attacked$/i))) {
    const f = parseCardFilter(`1 card ${m[1]}`);
    return f ? { kind: 'leaderBattle', filter: f.filter } : null;
  }
  m = t.match(
    /^(a Character|your opponent's Character|your (.*?Characters?(?: with .+?)?)(?: card)?) is removed from the field(?: by (your|your opponent's|an) effect)?( or K\.O\.'d)?$/i,
  );
  if (m) {
    const whose = /^a Character$/i.test(m[1]) ? 'any' : /opponent/i.test(m[1]) ? 'opponent' : 'own';
    const by = !m[3] ? 'any' : /opponent/i.test(m[3]) ? 'opponent' : /^your$/i.test(m[3]) ? 'self' : 'any';
    let filter: CardFilter | undefined;
    if (m[2] && !/^Characters?$/i.test(m[2])) {
      const f = parseCardFilter(`1 ${m[2]}`);
      if (!f) return null;
      filter = f.filter;
    }
    return { kind: 'characterRemoved', whose, by, ...(filter ? { filter } : {}), ...(m[4] || !m[3] ? { orKO: true } : {}) };
  }
  return null;
}

const POWER_SELF = /^this (?:Character|card|Leader) gains \+(\d+) power$/i;

/** Regras especiais de Líder ("Under the rules of this game…", "…according to the rules"). */
function parseRule(t: string): LeaderRule[] | null {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^Under the rules of this game, your DON!! deck consists of (\d+) cards$/i))) return [{ kind: 'donDeck', size: Number(m[1]) }];
  if (/^When your deck is reduced to 0, you win the game instead of losing(?:, according to the rules)?$/i.test(t)) return [{ kind: 'deckOutWin' }];
  // P-117 Nami: "Under the rules of this game, you can only include {East Blue} type cards in your deck and when your deck is reduced to 0, …"
  if ((m = t.match(/^Under the rules of this game, you can only include \{([^}]+)\} type cards in your deck(?: and (.+))?$/i))) {
    const more = m[2] ? parseRule(m[2].charAt(0).toUpperCase() + m[2].slice(1)) : [];
    return more && [{ kind: 'deckOnlyType', type: m[1] }, ...more];
  }
  if (/^Under the rules of this game, you do not lose when your deck has 0 cards\. You lose at the end of the turn in which your deck becomes 0 cards$/i.test(t)) {
    return [{ kind: 'deckOutEndOfTurn' }];
  }
  if (/^If you have any DON!! cards on your field, 1 DON!! card placed during your DON!! Phase is given to your Leader$/i.test(t)) {
    return [{ kind: 'donPhaseToLeader' }];
  }
  if (/^Your Character cards are played rested$/i.test(t)) return [{ kind: 'playRested' }];
  if (/^Your \[On Play\] effects are negated$/i.test(t)) return [{ kind: 'ownOnPlayNegated' }];
  if (/^Your face-up Life cards are placed at the bottom of your deck instead of being added to your hand, according to the rules$/i.test(t)) {
    return [{ kind: 'faceUpLifeToDeck' }];
  }
  if ((m = t.match(/^All of your \{([^}]+)\} type Character cards without a Counter have a \+(\d+) Counter, according to the rules$/i))) {
    return [{ kind: 'counterBonus', type: m[1], amount: Number(m[2]) }];
  }
  if ((m = t.match(/^Under the rules of this game, you cannot include cards with a cost of (\d+) or more in your deck$/i))) {
    return [{ kind: 'deckMaxCost', cost: Number(m[1]) - 1 }];
  }
  m = t.match(
    /^Under the rules of this game, you cannot include Events with a cost of (\d+) or more in your deck and at the start of the game, play up to 1 \{([^}]+)\} type Stage card from your deck$/i,
  );
  if (m) return [{ kind: 'deckMaxCost', cost: Number(m[1]) - 1, category: 'event' }, { kind: 'startStage', type: m[2] }];
  return null;
}

function parseStatic(h: Header, body: string): Ability[] | null {
  const sentences = sentencesOf(body);
  const ruleOnly = parseRule(body.trim().replace(/\.$/, ''));
  if (ruleOnly && !h.don && !h.yourTurn && !h.opponentsTurn) return ruleOnly.map((r) => ({ timing: 'static', steps: [], rule: r }));
  // "This effect can be activated at the start of your turn." / "At the start of your opponent's
  // turn, …" / "… at the start of your Main Phase" (6-2-2, 6-5-1).
  const start = body.match(
    /^(?:This effect can be activated at the start of (your turn|your opponent's turn|(?:your|the) Main Phase)\. |At the start of (your turn|your opponent's turn|(?:your|the) Main Phase), )(.+)$/i,
  );
  if (start) {
    const steps = parseBody(capitalizeFirst(start[3]));
    if (!steps) return null;
    const when = (start[1] ?? start[2]).toLowerCase();
    const timing: AbilityTiming = when === 'your turn' ? 'startOfTurn' : when === "your opponent's turn" ? 'startOfOpponentTurn' : 'startOfMainPhase';
    const ab: Ability = { timing, steps };
    if (h.don) ab.don = h.don;
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  let m0: RegExpMatchArray | null;
  if ((m0 = body.trim().replace(/\.$/, '').match(/^At the end of a battle in which this Character battles your opponent's Character(?: with (.+?))?, (.+)$/i))) {
    const f = m0[1] ? parseCardFilter(`1 Character with ${m0[1]}`) : null;
    if (m0[1] && !f) return null;
    const steps = parseBody(capitalizeFirst(m0[2]));
    if (!steps) return null;
    const ab: Ability = { timing: 'battlesCharacter', ...(h.don ? { don: h.don } : {}), ...(h.yourTurn ? { yourTurn: true } : {}), steps: f ? steps.map((st) => ({ ...st, if: { ...st.if, chosenMatches: f.filter } })) : steps };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  // "When this Leader attacks or is attacked, …" = [When Attacking] + [On Your Opponent's Attack]
  const both = body.match(/^When this (?:Leader|Character) attacks or is attacked, (.+)$/i);
  if (both) {
    const steps = parseBody(capitalizeFirst(both[1]));
    if (!steps) return null;
    return (['whenAttacking', 'onOpponentAttack'] as const).map((timing) => ({ timing, steps, ...(h.don ? { don: h.don } : {}) }));
  }
  // "When this Leader attacks your opponent's Leader, if X, Y."
  const atkLeader = body.match(/^When this (?:Leader|Character) attacks your opponent's Leader, (.+)$/i);
  if (atkLeader) {
    const steps = parseBody(capitalizeFirst(atkLeader[1]));
    if (!steps) return null;
    const ab: Ability = { timing: 'whenAttacking', steps: steps.map((st) => ({ ...st, if: { ...st.if, attackingLeader: true } })) };
    if (h.don) ab.don = h.don;
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  // "When you activate an Event, you may draw 1 card if you have 4 or less cards in your hand and haven't drawn a card using this Leader's effect during this turn."
  const evDraw = body.match(
    /^When you activate an Event, you may draw (\d+) cards? if you have (\d+) or less cards in your hand and haven't drawn a card using this Leader's effect during this turn\.?$/i,
  );
  if (evDraw) {
    const ab: Ability = {
      timing: 'event',
      event: { kind: 'eventActivated', who: 'self' },
      oncePerTurn: true,
      condition: { handMax: Number(evDraw[2]) },
      steps: [{ do: 'payCost', cost: {}, scope: 1 }, { do: 'draw', count: Number(evDraw[1]) }],
    };
    if (h.don) ab.don = h.don;
    return [ab];
  }
  // "This effect can be activated when your opponent's Character attacks. If that Character has the "Slash" attribute, …"
  const oppChar = body.match(/^This effect can be activated when your opponent's Character attacks\. (?:If that Character has the "(\w+)" attribute, )?(.+)$/i);
  if (oppChar) {
    const steps = parseBody(capitalizeFirst(oppChar[2]));
    if (!steps) return null;
    const cond: Condition = { attackerCharacter: true, ...(oppChar[1] ? { attackerAttribute: oppChar[1] } : {}) };
    const ab: Ability = { timing: 'onOpponentAttack', steps: steps.map((st) => ({ ...st, if: { ...cond, ...st.if } })) };
    if (h.don) ab.don = h.don;
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  const act = body.match(/^This effect can be activated when (?!your opponent attacks\.)(.+?)\. (.+)$/i);
  if (act) return parseStatic(h, `When ${act[1]}, ${act[2].charAt(0).toLowerCase()}${act[2].slice(1)}`);
  const costWhen = body.match(/^(You may [^:]+): (When .+)$/i);
  if (costWhen) {
    const pc = parseCost(`${costWhen[1]}:`);
    const inner = pc?.cost && parseStatic(h, costWhen[2]);
    if (!inner || inner.length !== 1 || (inner[0].timing !== 'event' && inner[0].timing !== 'onKO')) return null;
    return [{ ...inner[0], steps: [{ do: 'payCost', cost: pc!.cost! }, ...inner[0].steps] }];
  }
  // "[Once Per Turn] You may trash 1 card …: Your opponent's …" sem marcação de momento: [Activate: Main].
  const actCost = h.oncePerTurn && body.match(/^(You may [^:]+): (.+)$/i);
  if (actCost) {
    const pc = parseCost(`${actCost[1]}:`);
    const steps = pc?.cost && parseBody(actCost[2]);
    if (!steps) return null;
    return [{ timing: 'activateMain', oncePerTurn: true, cost: pc!.cost!, steps }];
  }
  const opp = body.match(/^This effect can be activated when your opponent attacks\. (.+)$/i);
  if (opp) {
    const steps = parseBody(opp[1]);
    if (!steps) return null;
    const ab: Ability = { timing: 'onOpponentAttack', steps };
    if (h.don) ab.don = h.don;
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  // "When X, Y. Then, Z." (reação com várias frases)
  const whenMulti = sentences.length > 1 && body.match(/^When ([^,]+), (.+)$/i);
  if (whenMulti && /^this Character is K\.O\.'d by (?:your opponent's|an) effect$/i.test(whenMulti[1])) {
    const steps = parseBody(capitalizeFirst(whenMulti[2]));
    if (!steps) return null;
    const ab: Ability = { timing: 'onKO', steps, koBy: /opponent/i.test(whenMulti[1]) ? 'opponentEffect' : 'effect' };
    if (h.yourTurn) ab.yourTurn = true;
    if (h.opponentsTurn) ab.opponentsTurn = true;
    return [ab];
  }
  if (whenMulti) {
    const ev = parseEvent(whenMulti[1]);
    const steps = ev && parseBody(capitalizeFirst(whenMulti[2]));
    if (ev && steps) {
      const ab: Ability = { timing: 'event', event: ev, steps };
      if (h.don) ab.don = h.don;
      if (h.yourTurn) ab.yourTurn = true;
      if (h.opponentsTurn) ab.opponentsTurn = true;
      if (h.oncePerTurn) ab.oncePerTurn = true;
      return [ab];
    }
  }
  // Várias frases independentes ("All of your Characters gain +1 cost. If …, this Leader gains +1000 power.").
  if (sentences.length > 1 && !h.oncePerTurn && !sentences.some((t) => /^(Then|That|This effect)\b/i.test(t))) {
    const parts = sentences.map((t) => parseStatic(h, t));
    return parts.every((p) => p) ? parts.flatMap((p) => p!) : null;
  }
  if (sentences.length !== 1) return null;
  let s = sentences[0].replace(/\.$/, '');
  // Regras de construção / nome alternativo: não são efeitos de jogo (tratados na importação e no deck).
  if (/^Also treat this card's name as \[[^\]]+\] according to the rules$/i.test(s)) return [];
  if (/^Under the rules of this game, you may have any number of this card in your deck$/i.test(s)) return [];
  if (/^Under the rules of this game, also treat this card's name as \[[^\]]+\] and \[[^\]]+\]$/i.test(s)) return [];
  const base: Ability = { timing: 'static', steps: [] };
  if (h.don) base.don = h.don;
  if (h.yourTurn) base.yourTurn = true;
  if (h.opponentsTurn) base.opponentsTurn = true;
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^If this Character battles your opponent's Character, (.+)$/i))) {
    const steps = parseBody(m[1]);
    if (!steps) return null;
    const ab: Ability = { ...base, timing: 'battlesCharacter', steps };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  // "If your Leader has the {Navy} type and this Character would be removed …": condição + substituição.
  const condRepl = s.match(/^If (.+?) and (this Character would .+ instead)$/i);
  if (condRepl && !/^this Character would/i.test(condRepl[1])) {
    const c = parseCondition(condRepl[1]);
    const inner = c && parseStatic(h, `If ${condRepl[2]}.`);
    if (!inner || inner.length !== 1 || inner[0].timing !== 'replace') return null;
    return [{ ...inner[0], condition: { ...inner[0].condition, ...c } }];
  }
  if ((m = s.match(/^If this Character would be rested by your opponent's Character's effect, you may (.+) instead$/i))) {
    const cost: AbilityCost = {};
    if (!parseCostPart(m[1].replace(/ of your other Characters$/i, ' of your Characters'), cost)) return null;
    if (cost.restCharacters === undefined && !cost.restOwn) return null;
    const ab: Ability = { ...base, timing: 'replace', replace: { who: 'self', event: 'rest', by: 'opponentEffect' }, cost, steps: [] };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  // "If you would take damage, you may trash this Character instead."
  if ((m = s.match(/^If you would take damage, you may (.+) instead$/i))) {
    const cost: AbilityCost = {};
    if (!parseCostPart(m[1], cost)) return null;
    const ab: Ability = { ...base, timing: 'replace', replace: { who: 'self', event: 'damage', by: 'any' }, cost, steps: [] };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  // "Once per turn, this Character cannot be K.O.'d by your opponent's effects."
  if (/^Once per turn, this Character cannot be K\.O\.'d by your opponent's effects$/i.test(s)) {
    return [{ ...base, timing: 'replace', replace: { who: 'self', event: 'ko', by: 'opponentEffect' }, cost: {}, steps: [], oncePerTurn: true }];
  }
  // "… would be removed …, trash this Character and draw 1 card instead." (obrigatório)
  const forced = s.match(/^If this Character would (be removed from the field by your opponent's effect or K\.O\.'d|be K\.O\.'d), trash this Character and (.+) instead$/i);
  if (forced) {
    const steps = parseClause(forced[2]);
    if (!steps) return null;
    // "removed … by your opponent's effect or K.O.'d": o K.O. vale por qualquer causa; a remoção, só por efeito do oponente.
    const replace: Replacement = /removed/i.test(forced[1])
      ? { who: 'self', event: 'koOrRemoval', by: 'any', removalBy: 'opponentEffect' }
      : { who: 'self', event: 'ko', by: 'any' };
    return [{ ...base, timing: 'replace', replace, cost: { trashSelf: true }, steps }];
  }
  // "If this Character would be K.O.'d (in battle / by an effect / by your opponent's effect), you may X instead."
  const repl = s.match(
    /^If (this Character|your .+?|any of your Characters|one of your .+?) would (be K\.O\.'d or (?:would )?be removed from the field|be K\.O\.'d|be removed from the field)( in battle| by an effect| by your opponent's effect| by your opponent)?(?: during this turn)?, you may (.+) instead$/i,
  );
  if (repl) {
    let who: Replacement['who'] = 'self';
    if (!/^this Character$/i.test(repl[1])) {
      const spec = parseTarget(repl[1].replace(/^any of your Characters$/i, 'your Characters').replace(/^one of your /i, 'your '));
      if (!spec || typeof spec !== 'object' || spec.side !== 'own') return null;
      who = { ...spec, upTo: 99 };
    }
    const cost: AbilityCost = {};
    let extra: EffectStep[] = [];
    const actions = repl[4].replace(/^add it to the top of your Life cards face-down$/i, '');
    if (!actions) cost.victimToLife = true;
    // "trash this Character and draw 1 card": o que não é custo vira efeito.
    const [costText, ...tail] = actions.split(/ and (?=draw )/i);
    if (actions) for (const part of costText.split(/ and (?=(?:rest|trash|add|place|return|turn|reveal|give) )/i)) if (!parseCostPart(part.trim(), cost)) return null;
    if (tail.length) {
      const st = parseClause(tail.join(' and '));
      if (!st) return null;
      extra = st;
    }
    const event: Replacement['event'] = /or/i.test(repl[2]) ? 'koOrRemoval' : /removed/i.test(repl[2]) ? 'removal' : 'ko';
    const by: Replacement['by'] = !repl[3] ? 'any' : /battle/i.test(repl[3]) ? 'battle' : /opponent/i.test(repl[3]) ? 'opponentEffect' : 'effect';
    const ab: Ability = { ...base, timing: 'replace', replace: { who, event, by }, cost, steps: extra };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  const when = s.match(/^When ([^,]+), (.+)$/i);
  // "[Opponent's Turn] When this Character is K.O.'d, …" = [On K.O.] restrito ao turno.
  if (when && /^this Character is K\.O\.'d(?: by (?:your opponent's|an) effect)?$/i.test(when[1])) {
    const steps = parseBody(capitalizeFirst(when[2]));
    if (!steps) return null;
    const ab: Ability = { ...base, timing: 'onKO', steps };
    if (/opponent's effect/i.test(when[1])) ab.koBy = 'opponentEffect';
    else if (/an effect/i.test(when[1])) ab.koBy = 'effect';
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  const event = when && parseEvent(when[1]);
  if (event) {
    const steps = parseBody(when[2]);
    if (!steps) return null;
    const ab: Ability = { ...base, timing: 'event', event, steps };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  if (h.oncePerTurn) return null;
  if ((m = s.match(/^When this Character battles "?(\w+)"? attribute Characters, this Character gains \+(\d+) power during this turn$/i))) {
    return [{ ...base, battleVsAttribute: { attribute: m[1], power: Number(m[2]) } }];
  }
  if ((m = s.match(/^This Character gains \+(\d+) cost, and if it is your opponent's turn, this Character gains \+(\d+) power$/i))) {
    return [{ ...base, staticCost: Number(m[1]) }, { ...base, opponentsTurn: true, staticPower: Number(m[2]) }];
  }
  const ifm = s.match(/^If ([^,]+), (.+)$/i);
  const tailIf = !ifm && s.match(/^(this (?:Character|card|Leader) gains .+?) if (.+)$/i);
  if (ifm || tailIf) {
    const cond = parseCondition(ifm ? ifm[1] : (tailIf as RegExpMatchArray)[2]);
    if (!cond) return null;
    base.condition = cond;
    s = ifm ? ifm[2] : (tailIf as RegExpMatchArray)[1];
  }
  // "this Character gains +1000 power, and all of your … gain +2 cost": duas partes com a mesma condição.
  if (/, and (?:all of )?your /i.test(s)) {
    const parts = s.split(/, and (?=(?:all of )?your )/i).map((x) => parseStatic({ ...h }, `${x}.`));
    if (parts.every((x) => x?.length)) return parts.flatMap((x) => x!.map((ab) => ({ ...ab, ...(base.condition ? { condition: { ...base.condition, ...ab.condition } } : {}) })));
  }
  if ((m = s.match(/^this Character cannot attack unless (.+)$/i))) {
    const c = parseCondition(m[1]);
    return c ? [{ ...base, condition: { ...base.condition, not: c }, staticCannotAttack: true }] : null;
  }
  if ((m = s.match(/^your opponent cannot attack any card other than the Character \[[^\]]+\]$/i))) return [{ ...base, staticTaunt: true }];
  if (/^This card in your hand cannot be played by effects$/i.test(s)) return [{ ...base, noPlayByEffect: true }];
  if (/^This Character cannot attack a Leader on the turn in which it is played$/i.test(s)) return [{ ...base, noLeaderAttackOnPlayTurn: true }];
  if ((m = s.match(/^This Character cannot be K\.O\.'d by effects of Characters without the "(\w+)" attribute$/i))) {
    return [{ ...base, noEffectKOUnlessAttribute: m[1] }];
  }
  if ((m = s.match(/^This Character cannot be K\.O\.'d by effects of your opponent's Characters with (\d+) base power or less$/i))) {
    return [{ ...base, noEffectKOByMaxBasePower: Number(m[1]) }];
  }
  if ((m = s.match(/^this Character cannot be (K\.O\.'d or )?rested by your opponent's (?:Leader and Character )?effects(?: and gains \[(Rush|Blocker|Double Attack|Banish|Unblockable)\])?$/i))) {
    const out: Ability[] = [{ ...base, staticNoRest: true }];
    if (m[1]) out.push({ ...base, staticNoEffectKO: 'opponent' });
    if (m[2]) out.push({ ...base, staticKeyword: KEYWORDS[m[2].toLowerCase()] });
    return out;
  }
  if ((m = s.match(/^this Character cannot be K\.O\.'d in battle by "?(\w+)"? attribute (?:Characters|cards|Leaders or Characters) and gains \+(\d+) power$/i))) {
    return [{ ...base, noBattleKOVsAttribute: m[1] }, { ...base, staticPower: Number(m[2]) }];
  }
  if ((m = s.match(/^Give (red|green|blue|purple|black|yellow) Events in your hand [−-]?(\d+) cost$/i))) {
    return [{ ...base, handCostAura: { filter: { color: m[1].toLowerCase() as Color, category: 'event' }, amount: -Number(m[2]) } }];
  }
  if ((m = s.match(/^The cost of playing (.+?) from your hand will be reduced by (\d+)$/i))) {
    const f = parseCardFilter(`1 ${m[1].replace(/ cards\b/, ' card')}`);
    return f ? [{ ...base, handCostAura: { filter: f.filter, amount: -Number(m[2]) } }] : null;
  }
  if ((m = s.match(/^During the turn in which a card in your hand is trashed by an effect, give this card in your hand [−-]?(\d+) cost$/i))) {
    return [{ ...base, condition: { ...base.condition, handTrashedThisTurn: true }, handCost: -Number(m[1]) }];
  }
  if ((m = s.match(/^The counter of all of your (.+?) in your hand becomes \+(\d+)$/i))) {
    const f = parseCardFilter(`1 ${m[1].replace(/ cards\b/, ' card')}`);
    return f ? [{ ...base, handCounter: { filter: f.filter, amount: Number(m[2]), set: true } }] : null;
  }
  if ((m = s.match(/^All Character cards in your hand without a Counter have a \+(\d+) Counter$/i))) {
    return [{ ...base, handCounter: { filter: { category: 'character' }, amount: Number(m[1]), withoutCounter: true } }];
  }
  if ((m = s.match(/^this card in your hand has a \+(\d+) Counter$/i))) return [{ ...base, selfHandCounter: Number(m[1]) }];
  // "All Stage cards in your hand have a +3000 Counter" (Stages não têm Counter impresso).
  if ((m = s.match(/^All Stage cards in your hand have a \+(\d+) Counter$/i))) {
    return [{ ...base, handCounter: { filter: { category: 'stage' }, amount: Number(m[1]), set: true } }];
  }
  if ((m = s.match(/^all Characters with a cost of (\d+) or less do not become active in your and your opponent's Refresh Phases$/i))) {
    return [{ ...base, noRefreshMaxCost: Number(m[1]) }];
  }
  if ((m = s.match(/^all Characters with a cost of (\d+) or (\d+) cannot attack$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: 0, bothSides: true, exactCosts: [Number(m[1]), Number(m[2])], cannotAttack: true } }];
  }
  if ((m = s.match(/^this Character gains \+(\d+) power for each of your Characters with a different card name$/i))) {
    return [{ ...base, powerPer: { power: Number(m[1]), every: 1, what: 'distinctCharacters' } }];
  }
  m = s.match(/^this Character gains (?:\+(\d+) power and |\[(Rush|Blocker|Double Attack|Banish|Unblockable)\] and )?([+-]\d+) cost for every (\d+) cards in your trash$/i);
  if (m) {
    const out: Ability[] = [{ ...base, costPer: { cost: Number(m[3]), every: Number(m[4]), what: 'trash' } }];
    if (m[1]) out.push({ ...base, powerPer: { power: Number(m[1]), every: Number(m[4]), what: 'trash' } });
    if (m[2]) out.push({ ...base, staticKeyword: KEYWORDS[m[2].toLowerCase()] });
    return out;
  }
  if ((m = s.match(/^this Character's base power becomes the same as your Leader's base power$/i))) return [{ ...base, staticBasePower: 'leader' }];
  if ((m = s.match(/^your (?:\{([^}]+)\} type )?Leader's base power becomes (\d+)$/i))) {
    return [{ ...base, aura: { kinds: ['leader'], power: 0, basePower: Number(m[2]), ...(m[1] ? { hasAnyType: [m[1]] } : {}) } }];
  }
  if ((m = s.match(/^All of your \[([^\]]+)\] cards and this Character gain \[(Rush|Blocker|Double Attack|Banish|Unblockable)\]$/i))) {
    const kw = KEYWORDS[m[2].toLowerCase()];
    return [{ ...base, aura: { kinds: ['leader', 'character'], power: 0, names: [m[1]], keyword: kw } }, { ...base, staticKeyword: kw }];
  }
  if ((m = s.match(/^All of your \[([^\]]+)\] cards' base power and this Character's base power become (\d+)$/i))) {
    return [{ ...base, aura: { kinds: ['leader', 'character'], power: 0, names: [m[1]], basePower: Number(m[2]) } }, { ...base, staticBasePower: Number(m[2]) }];
  }
  if ((m = s.match(/^The base power of all of your Characters with a \[Trigger\] and (\d+) base power becomes (\d+)$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: 0, hasTrigger: true, minPower: Number(m[1]), maxPower: Number(m[1]), basePower: Number(m[2]) } }];
  }
  if ((m = s.match(/^Your Leader and all of your Characters that do not have a type including "([^"]+)" have their effects negated$/i))) {
    return [{ ...base, aura: { kinds: ['leader', 'character'], power: 0, notTypeIncludes: m[1], negate: true } }];
  }
  if ((m = s.match(/^your \[([^\]]+)\] and all your Characters with a type including "([^"]+)" gain \+(\d+) power$/i))) {
    return [
      { ...base, aura: { kinds: ['leader', 'character'], power: Number(m[3]), names: [m[1]] } },
      { ...base, aura: { kinds: ['character'], power: Number(m[3]), typeIncludes: m[2], excludeName: m[1] } },
    ];
  }
  if ((m = s.match(/^All of your \{([^}]+)\} type Characters other than \[([^\]]+)\] cannot be K\.O\.'d in battle$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: 0, hasAnyType: [m[1]], excludeName: m[2], noBattleKO: true } }];
  }
  if ((m = s.match(POWER_SELF))) return [{ ...base, staticPower: Number(m[1]) }];
  m = s.match(
    /^this (?:Character|Leader) gains \+(\d+) power for every (\d+ )?(?:of your )?(rested DON!! cards|cards? in your hand|cards? in your trash|Events? in your trash)$/i,
  );
  if (m) {
    const what = /DON/i.test(m[3]) ? 'restedDon' : /hand/i.test(m[3]) ? 'hand' : /Event/i.test(m[3]) ? 'trashEvents' : 'trash';
    return [{ ...base, powerPer: { power: Number(m[1]), every: Number(m[2] ?? 1), what } }];
  }
  if (/^this Character gains \[Rush: ?Character\]$/i.test(s)) return [{ ...base, staticKeyword: 'rushCharacter' }];
  if ((m = s.match(/^this (?:Character|card|Leader) gains \[(Rush|Blocker|Double Attack|Banish|Unblockable)\]$/i))) {
    return [{ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] }];
  }
  if (/^this Character can also attack (?:your opponent's )?active Characters$/i.test(s)) {
    return [{ ...base, staticCanAttackActive: true }];
  }
  if (/^this Character cannot be K\.O\.'d in battle$/i.test(s)) return [{ ...base, staticNoBattleKO: true }];
  if (/^this (?:Character|Stage) cannot be K\.O\.'d by effects$/i.test(s)) return [{ ...base, staticNoEffectKO: true }];
  // "by "Strike" attribute Leaders or Characters" (P-007) = "… attribute cards".
  if ((m = s.match(/^this Character cannot be K\.O\.'d in battle by "?(\w+)"? attribute (?:Characters|cards|Leaders or Characters)$/i))) {
    return [{ ...base, noBattleKOVsAttribute: m[1] }];
  }
  // "by Characters without the "Special" attribute" (P-025): Líder e Personagem com o atributo nocauteiam.
  if ((m = s.match(/^this Character cannot be K\.O\.'d in battle by Characters without the "?(\w+)"? attribute$/i))) {
    return [{ ...base, noBattleKOUnlessAttribute: m[1] }];
  }
  if (/^this (?:Leader|Character) cannot attack$/i.test(s)) return [{ ...base, staticCannotAttack: true }];
  if (/^this Character cannot be K\.O\.'d in battle by Leaders$/i.test(s)) return [{ ...base, noBattleKOByLeader: true }];
  if ((m = s.match(/^give all of your opponent's Characters [−-]?(\d+) cost$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: 0, side: 'opponent', cost: -Number(m[1]) } }];
  }
  if ((m = s.match(/^this Character gains \+(\d+) power and cannot be K\.O\.'d by effects$/i))) {
    return [{ ...base, staticPower: Number(m[1]) }, { ...base, staticNoEffectKO: true }];
  }
  if ((m = s.match(/^all of your Characters with a type including "([^"]+)" gain \+(\d+) power$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: Number(m[2]), typeIncludes: m[1] } as NonNullable<Ability['aura']> }];
  }
  m = s.match(/^this Character cannot be removed from the field by your opponent's effects(?: and gains (\[(?:Rush|Blocker|Double Attack|Banish|Unblockable)\]|\+\d+ power))?$/i);
  if (m) {
    const out: Ability[] = [{ ...base, staticNoRemoval: true }];
    if (m[1]?.startsWith('[')) out.push({ ...base, staticKeyword: KEYWORDS[m[1].slice(1, -1).toLowerCase()] });
    else if (m[1]) out.push({ ...base, staticPower: Number(m[1].match(/\d+/)![0]) });
    return out;
  }
  m = s.match(/^all of (your|your opponent's) ((?:(?:red|green|blue|purple|black|yellow) )?(?:\{[^}]+\} type )?)Characters cannot be removed from the field by (?:your opponent's|your) effects$/i);
  if (m) {
    const aura: NonNullable<Ability['aura']> = { kinds: ['character'], power: 0, noRemoval: true };
    if (/opponent/i.test(m[1])) aura.side = 'opponent';
    const types = typesOf(m[2]);
    if (types.length) aura.hasAnyType = types;
    const color = m[2].match(/^(red|green|blue|purple|black|yellow) /i);
    if (color) aura.color = color[1].toLowerCase() as Color;
    return [{ ...base, aura }];
  }
  if ((m = s.match(/^give this card in your hand [−-]?(\d+) cost$/i))) return [{ ...base, handCost: -Number(m[1]) }];
  if (/^this Character can attack Characters on the turn in which it is played$/i.test(s)) return [{ ...base, staticKeyword: 'rushCharacter' }];
  if ((m = s.match(/^this (?:Character|Stage) cannot be K\.O\.'d by your opponent's effects(?: and gains (?:\[(Rush|Blocker|Double Attack|Banish|Unblockable)\]|\+(\d+) power))?$/i))) {
    // Só contra efeitos do oponente: o K.O. por efeito próprio continua valendo (1-3-1).
    const out: Ability[] = [{ ...base, staticNoEffectKO: 'opponent' }];
    if (m[1]) out.push({ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] });
    if (m[2]) out.push({ ...base, staticPower: Number(m[2]) });
    return out;
  }
  // Aura com filtros: "All of your black {X} type Characters gain +1 cost", "All of your Characters with 6000 base power gain +1000 power",
  // "your Characters with a cost of 3 or less other than [X] cannot be K.O.'d by your opponent's effects"
  // "… gain [Rush] and +1000 power": uma aura para cada efeito.
  const GAIN = String.raw`(?:\+\d+ (?:power|cost)|\[(?:Rush|Blocker|Double Attack|Banish|Unblockable)\])`;
  m = s.match(new RegExp(`^(?:all of )?your (.*?Characters.*?) (?:gain (${GAIN}(?: and ${GAIN})?)|(cannot be K\\.O\\.'d by (?:your opponent's )?effects))$`, 'i'));
  if (m) {
    const spec = parseTarget(`up to 99 of your ${m[1]}`);
    if (spec && typeof spec === 'object' && spec.kinds.join() === 'character' && !spec.either && !spec.maxCostDynamic) {
      const aura: NonNullable<Ability['aura']> = { kinds: ['character'], power: 0 };
      if (spec.excludeSelf) aura.excludeSelf = true;
      if (spec.hasAnyType) aura.hasAnyType = spec.hasAnyType;
      if (spec.typeIncludes) aura.typeIncludes = spec.typeIncludes;
      if (spec.color) aura.color = spec.color;
      if (spec.minCost !== undefined) aura.minCost = spec.minCost;
      if (spec.maxCost !== undefined) aura.maxCost = spec.maxCost;
      if (spec.minPower !== undefined) aura.minPower = spec.minPower;
      if (spec.maxPower !== undefined) aura.maxPower = spec.maxPower;
      if (spec.name) aura.names = [spec.name];
      if (spec.names) aura.names = spec.names;
      if (spec.excludeName) aura.excludeName = spec.excludeName;
      if (spec.hasAllTypes) aura.hasAllTypes = spec.hasAllTypes;
      if (m[3]) return [{ ...base, aura: { ...aura, noEffectKO: /opponent/i.test(m[3]) ? 'opponent' : true } }];
      return m[2].split(/ and /).map((gain) => {
        const one: NonNullable<Ability['aura']> = { ...aura };
        if (gain.startsWith('[')) one.keyword = KEYWORDS[gain.slice(1, -1).toLowerCase()];
        else if (/cost/i.test(gain)) one.cost = Number(gain.match(/\d+/)![0]);
        else one.power = Number(gain.match(/\d+/)![0]);
        return { ...base, aura: one };
      });
    }
  }

  if ((m = s.match(/^give this (?:Leader|Character) [−-]?(\d+) power$/i))) return [{ ...base, staticPower: -Number(m[1]) }];
  if ((m = s.match(/^all of your ((?:\[[^\]]+\](?:,? and |, )?)+) cards gain \+(\d+) power$/i))) {
    const names = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
    return [{ ...base, aura: { kinds: ['leader', 'character'], power: Number(m[2]), names } }];
  }
  if ((m = s.match(/^give all of your opponent's Characters [−-]?(\d+) power$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: -Number(m[1]), side: 'opponent' } }];
  }
  // "All of your {Dressrosa} type Characters with a cost of 2 or more gain +1 cost", "... gain [Blocker]",
  // "Your {SWORD} type Characters can attack Characters on the turn in which they are played"
  m = s.match(
    /^(?:all of )?your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})* type )?Characters( with a cost of \d+ or more)? (?:gain (\+\d+ cost|\[(?:Rush|Blocker|Double Attack|Banish|Unblockable)\])|(can attack Characters on the turn in which they are played))$/i,
  );
  if (m && (m[2] || m[4] || /\[/.test(m[3] ?? ''))) {
    const aura: NonNullable<Ability['aura']> = { kinds: ['character'], power: 0 };
    if (m[1]) aura.hasAnyType = typesOf(m[1]);
    if (m[2]) aura.minCost = Number(m[2].match(/\d+/)![0]);
    if (m[4]) aura.keyword = 'rushCharacter';
    else if (/^\+/.test(m[3])) aura.cost = Number(m[3].match(/\d+/)![0]);
    else aura.keyword = KEYWORDS[m[3].slice(1, -1).toLowerCase()];
    return [{ ...base, aura }];
  }
  if ((m = s.match(/^all of your Characters gain \+(\d+) cost$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: 0, cost: Number(m[1]) } }];
  }
  if ((m = s.match(/^this Character gains \+(\d+) cost$/i))) return [{ ...base, staticCost: Number(m[1]) }];
  if ((m = s.match(/^your \[([^\]]+)\] gains \[(Rush|Blocker|Double Attack|Banish|Unblockable)\]$/i))) {
    return [{ ...base, aura: { kinds: ['character'], power: 0, names: [m[1]], keyword: KEYWORDS[m[2].toLowerCase()] } }];
  }
  if ((m = s.match(/^this Character gains \+(\d+) power and \+(\d+) cost$/i))) {
    return [{ ...base, staticPower: Number(m[1]) }, { ...base, staticCost: Number(m[2]) }];
  }
  if ((m = s.match(/^your Leader gains \[(Rush|Blocker|Double Attack|Banish|Unblockable)\](?: and \+(\d+) power)?$/i))) {
    const out: Ability[] = [{ ...base, aura: { kinds: ['leader'], power: 0, keyword: KEYWORDS[m[1].toLowerCase()] } }];
    if (m[2]) out.push({ ...base, aura: { kinds: ['leader'], power: Number(m[2]) } });
    return out;
  }
  if ((m = s.match(/^this Character gains \[(Rush|Blocker|Double Attack|Banish|Unblockable)\] and \+(\d+) (cost|power)$/i))) {
    const second = m[3].toLowerCase() === 'cost' ? { staticCost: Number(m[2]) } : { staticPower: Number(m[2]) };
    return [{ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] }, { ...base, ...second }];
  }
  m = s.match(
    /^(?:all of )?your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})* type )?(Leaders? and Characters|Leader and all of your Characters|Leader or Character cards|Characters|Leader) gains? \+(\d+) power$/i,
  );
  if (m) {
    const kinds: Array<'leader' | 'character'> = /Leader/i.test(m[2]) && /Character/i.test(m[2]) ? ['leader', 'character'] : /Leader/i.test(m[2]) ? ['leader'] : ['character'];
    const aura = { kinds, power: Number(m[3]) } as NonNullable<Ability['aura']>;
    if (m[1]) aura.hasAnyType = typesOf(m[1]);
    return [{ ...base, aura }];
  }
  return null;
}

/** Diagnóstico de uma linha não reconhecida: o primeiro trecho que falhou. */
export function diagnoseLine(raw: string, category: CardCategory): string | null {
  failure = null;
  const r = parseLine(raw, category);
  return r ? null : (failure ?? 'desconhecido');
}

function parseLine(raw: string, category: CardCategory): Ability[] | null {
  const parsedHeader = parseHeader(clean(raw));
  if (!parsedHeader) return fail(`header: ${raw.slice(0, 60)}`);
  const { h } = parsedHeader;
  let { rest } = parsedHeader;
  if (!rest) return h.keywords.length && !h.timings.length ? [] : fail('vazio');
  if (h.keywords.length) return fail(`keyword+texto: ${rest}`);
  if (!h.timings.length) return parseStatic(h, rest) ?? fail(`static: ${rest}`);
  const eventTiming = h.timings.some((t) => t === 'main' || t === 'counter');
  if (eventTiming !== (category === 'event')) return fail(`timing ${h.timings.join('/')} em ${category}`);
  // "[Activate: Main] If X, you may COST: Y" — condição para poder ativar.
  let preCond: Condition | undefined;
  const condCost = rest.match(/^If ([^,]+), (you may [^:]+:.+)$/i);
  if (condCost) {
    const c = parseCondition(condCost[1]);
    if (!c) return fail(`cond: ${condCost[1]}`);
    preCond = c;
    rest = capitalizeFirst(condCost[2]);
  }
  const pc = parseCost(rest);
  if (!pc) return fail(`cost: ${rest.slice(0, rest.indexOf(':'))}`);
  const steps = parseBody(pc.body);
  if (!steps) return null;
  return h.timings.map((timing) => {
    const ab: Ability = { timing, steps };
    if (preCond && timing === 'activateMain') ab.condition = preCond;
    else if (preCond) ab.steps = ab.steps.map((st) => ({ ...st, if: { ...preCond, ...st.if } }));
    if (h.don) ab.don = h.don;
    if (h.oncePerTurn) ab.oncePerTurn = true;
    if (h.yourTurn) ab.yourTurn = true;
    if (h.opponentsTurn) ab.opponentsTurn = true;
    if (pc.cost && Object.keys(pc.cost).length) {
      if (timing === 'activateMain') ab.cost = pc.cost;
      else ab.steps = [{ do: 'payCost', cost: pc.cost, ...(preCond ? { if: preCond } : {}) }, ...ab.steps];
    }
    return ab;
  });
}

/** Lê uma linha de efeito (null = não reconhecida). */
export function parseEffectLine(line: string, category: CardCategory): Ability[] | null {
  return parseLine(line, category);
}

/** Lê o texto do [Trigger] (null = não reconhecido). */
export function parseTriggerText(trigger: string): EffectStep[] | null {
  const pc = parseCost(clean(trigger));
  const body = pc && parseBody(pc.body);
  return body && (pc.cost && Object.keys(pc.cost).length ? [{ do: 'payCost', cost: pc.cost } as EffectStep, ...body] : body);
}

/** Linhas de efeito da carta, com as opções "• …" juntadas ao efeito anterior. */
export function effectLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of splitEffects(text)) {
    if ((/^•/.test(line) || /:\s*$/.test(lines[lines.length - 1] ?? '')) && lines.length) lines[lines.length - 1] += ` ${line}`;
    // "Choose one: • A • B\nThen, …": o "Then" vale depois de qualquer opção.
    else if (/^Then,/.test(line) && /•/.test(lines[lines.length - 1] ?? '')) lines[lines.length - 1] += ` ‖ ${line}`;
    else lines.push(line);
  }
  return lines;
}

/** Lê os efeitos da carta. Linhas não reconhecidas viram habilidades manuais. */
export function parseCard(card: Pick<CardData, 'category' | 'text' | 'trigger'>): ParsedCard {
  const keywords = detectKeywords(card.text ?? '');
  const abilities: Ability[] = [];
  const unparsed: string[] = [];
  for (const line of effectLines(card.text ?? '')) {
    if (KEYWORD_ONLY.test(line)) continue;
    const parsed = parseLine(line, card.category);
    if (parsed) abilities.push(...parsed);
    else {
      abilities.push(manualAbility(line, card.category));
      unparsed.push(line);
    }
  }
  const trigger = card.trigger?.trim();
  if (trigger) {
    // [Trigger] também pode ter custo opcional ("You may trash 1 card from your hand: Play this card.").
    const steps = parseTriggerText(trigger);
    if (steps) abilities.push({ timing: 'trigger', steps });
    else {
      abilities.push(manualTrigger(trigger));
      unparsed.push(`[Trigger] ${trigger}`);
    }
  }
  return { keywords, abilities, unparsed };
}
