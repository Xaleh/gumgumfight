// Leitor automático de efeitos: transforma o texto oficial (em inglês) em passos da DSL.
//
// Os textos de One Piece Card Game seguem modelos fixos ("K.O. up to 1 of your opponent's
// Characters with a cost of 3 or less."). Cada linha de efeito só vira automática se for
// reconhecida POR INTEIRO; qualquer trecho desconhecido faz a linha cair no modo manual.
// Scripts escritos à mão (scripts.ts) têm prioridade sobre o leitor.

import { normalizeTypeQuotes } from '../text';
import type {
  Ability,
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
};

const TIMINGS: Record<string, AbilityTiming> = {
  'activate: main': 'activateMain',
  'on play': 'onPlay',
  'when attacking': 'whenAttacking',
  'on k.o.': 'onKO',
  'on block': 'onBlock',
  'end of your turn': 'endOfTurn',
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

function clean(raw: string): string {
  return stripReminders(normalizeTypeQuotes(raw))
    .replace(/DON!! ?[−–-] ?(\d+)/g, 'DON!! -$1')
    // A API às vezes perde o sinal de menos: "DON!! 1:" = "DON!! −1:".
    .replace(/DON!! (\d+)(?=\s*:)/g, 'DON!! -$1')
    .replace(/DON!! -?(\d+),\s*(?=You may)/g, 'DON!! -$1 ')
    .replace(/\[Activate: ?Main\]/gi, '[Activate: Main]')
    .replace(/\bYou can (?=trash|rest|place|return|add)/g, 'You may ')
    .replace(/\{Supernova\}/g, '{Supernovas}')
    .replace(/’/g, "'");
}

function sentencesOf(body: string): string[] {
  return body
    .split(/(?<=[a-z0-9)\]}'"]\.)\s+(?=[A-Z[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const capitalizeFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const typesOf = (list: string) => [...list.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const TYPE_LIST = /^((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})*) type\s*/i;

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
    } else if ((m = rest.match(/^\s*other than this (?:card|Character|Leader)/i)) && onField) {
      (spec as TargetSpec).excludeSelf = true;
    } else if ((m = rest.match(/^\s*other than \[([^\]]+)\]/i))) {
      spec.excludeName = m[1];
    } else if ((m = rest.match(/^\s*with a type including "([^"]+)"/i))) {
      spec.typeIncludes = m[1];
    } else if ((m = rest.match(/^\s*(?:and )?a \[Trigger\]/i)) && !onField) {
      (spec as CardFilter).hasTrigger = true;
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
  let p = phrase.trim().replace(/\.$/, '');
  if (/^this (character|card|leader|stage)$/i.test(p)) return 'self';
  if (/^your leader$/i.test(p)) return 'ownLeader';
  if (/^(?:that|the selected) (character|card|leader|leader or character)$/i.test(p) || /^it$/i.test(p)) return 'chosen';
  if (/^(?:this|your) Leader or 1 of your Characters$/i.test(p)) return { side: 'own', kinds: ['leader', 'character'], upTo: 1 };
  if (/^your Leader or \d+ of your Characters$/i.test(p)) return { side: 'own', kinds: ['leader', 'character'], upTo: 1 };
  if (/^your Leader and all of your Characters$/i.test(p)) return { side: 'own', kinds: ['leader', 'character'], upTo: 99, all: true };
  const named = p.match(/^your \[([^\]]+)\] Leader$/i);
  if (named) return { side: 'own', kinds: ['leader'], upTo: 1, name: named[1] };

  const spec: TargetSpec = { side: 'any', kinds: [], upTo: 1 };
  let m: RegExpMatchArray | null;
  let quantified = false;
  if ((m = p.match(/^up to (?:a total of )?(\d+) (?:of )?/i))) {
    spec.upTo = Number(m[1]);
    quantified = true;
  } else if ((m = p.match(/^all (?:of )?/i))) {
    spec.all = true;
    spec.upTo = 99;
    quantified = true;
  } else if ((m = p.match(/^(\d+) of (?=your )/i))) {
    spec.upTo = Number(m[1]);
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
    else if ((m = p.match(/^active /i))) spec.rested = false;
    else if ((m = p.match(/^\[(Rush|Blocker|Double Attack|Banish)\] /i))) spec.keyword = KEYWORDS[m[1].toLowerCase()];
    else if ((m = p.match(/^\[([^\]]+)\]\s*/))) spec.name = m[1];
    else break;
    p = p.slice(m[0].length);
  }

  // Substantivo.
  if ((m = p.match(/^(?:Leader (?:or|and) Character cards?|Leaders? and Characters|Leaders? or Characters?)/i))) {
    spec.kinds = ['leader', 'character'];
  } else if ((m = p.match(/^Leader or Stage cards?/i))) {
    spec.kinds = ['leader', 'stage'];
  } else if ((m = p.match(/^(?:Character cards?|Characters?)/i))) {
    spec.kinds = ['character'];
  } else if ((m = p.match(/^Leaders?/i))) {
    spec.kinds = ['leader'];
  } else if ((m = p.match(/^Stages?/i))) {
    spec.kinds = ['stage'];
  } else if (spec.name) {
    // "[Charlotte Linlin] cards" pode ser o Líder com esse nome; "[Pacifista]" sozinho, só Personagens.
    m = p.match(/^(?:cards?)?/i);
    spec.kinds = m![0] && spec.side === 'own' ? ['leader', 'character'] : ['character'];
  } else {
    return null;
  }
  p = p.slice(m![0].length);
  if (applyTrailing(p, spec, true) === null) return null;
  // Sem dono nem "your": só "Character(s)" pode ser de qualquer jogador.
  if (spec.side === 'any' && spec.kinds.some((k) => k !== 'character')) return null;
  return spec;
}

// ---------------------------------------------------------------------------
// Filtros de cartas fora do campo (mão, deck, descarte)
// ---------------------------------------------------------------------------

export function parseCardFilter(phrase: string): { upTo: number; filter: CardFilter } | null {
  let p = phrase.trim();
  let upTo = 1;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^up to (\d+) /i)) || (m = p.match(/^(\d+) /))) {
    upTo = Number(m[1]);
    p = p.slice(m[0].length);
  } else if ((m = p.match(/^an? /i))) {
    p = p.slice(m[0].length);
  }
  const filter: CardFilter = {};
  for (let guard = 0; guard < 4; guard++) {
    if ((m = p.match(/^(red|green|blue|purple|black|yellow) /i))) filter.color = m[1].toLowerCase() as Color;
    else if ((m = p.match(TYPE_LIST))) filter.hasAnyType = typesOf(m[1]);
    else if ((m = p.match(/^\[([^\]]+)\]\s*/))) filter.name = m[1];
    else break;
    p = p.slice(m[0].length);
  }
  if ((m = p.match(/^(Character|Event|Stage)(?: cards?|s)?/i))) {
    filter.category = m[1].toLowerCase() as CardCategory;
  } else if ((m = p.match(/^cards?/i))) {
    // qualquer categoria
  } else if (filter.name || filter.hasAnyType) {
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
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^you have (\d+) or more Characters$/i))) return { minCharacters: Number(m[1]) };
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
  if (/^your Leader is multicolored$/i.test(t)) return { leaderMulticolor: true };
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
    const what = m[1].replace(/^an? /i, '');
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
  if ((m = t.match(/^your Leader's type includes "([^"]+)"$/i))) return { leaderHasType: m[1] };
  // "If that card is a Character, that Character …": o passo seguinte já só vale para Personagens.
  if (/^that card is a Character$/i.test(t)) return {};
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

const CLAUSES: ClauseRule[] = [
  [
    // "K.O. up to 1 … with a cost of 3 or less and up to 1 … with a cost of 2 or less"
    /^K\.O\. (up to \d+ .+?) and (up to \d+ .+)$/i,
    (m) => {
      const a = parseTarget(m[1]);
      const b = parseTarget(m[2]);
      return onlyCharacters(a) && onlyCharacters(b) ? [{ do: 'ko', target: a }, { do: 'ko', target: b }] : null;
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
    /^Give up to (\d+) rested DON!! cards? to (.+)$/i,
    (m) => withTarget(m[2], (target) => ({ do: 'giveRestedDon', target, count: Number(m[1]) })),
  ],
  [
    /^Give (.+?) up to (\d+) rested DON!! cards?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'giveRestedDon', target, count: Number(m[2]) })),
  ],
  [
    new RegExp(`^Give (.+?) [−-](\\d+) power ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: -Number(m[2]), duration: durationOf(m[3]) })),
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
    new RegExp(`^(.+?) gains? \\[(Rush|Blocker|Double Attack|Banish)\\] ${DUR}$`, 'i'),
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
  [/^Draw (?:up to )?(\d+) cards?$/i, (m) => [{ do: 'draw', count: Number(m[1]) }]],
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
    /^Reveal 1 card from the top of your deck and play (up to 1 .+)$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'revealTop' }, { do: 'playRevealed', filter: f.filter }];
    },
  ],
  [/^play (?:that|the revealed) card( rested)?$/i, (m) => [m[1] ? { do: 'playRevealed', rested: true } : { do: 'playRevealed' }]],
  [/^place (?:the revealed card|the rest|that card) at the bottom of your deck$/i, () => [{ do: 'revealedToBottom' }]],
  [/^Play this Character card from your trash( rested)?$/i, () => [{ do: 'playThis' }]],
  [
    new RegExp(`^(.+?) cannot be rested ${DUR}$`, 'i'),
    (m) => withTarget(m[1], (target) => ({ do: 'cannotBeRested', target, duration: durationOf(m[2]) }), true),
  ],
  [
    /^add up to (\d+) cards? from the top of your opponent's Life cards to the owner's hand$/i,
    (m) => [{ do: 'opponentLifeToHand', count: Number(m[1]) }],
  ],
  [
    /^your opponent places (\d+) cards? from their hand at the bottom of their deck$/i,
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
    /^Add (up to \d+ .+?) from your hand to the top of your Life cards(?: face-(?:up|down))?$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      return f && [{ do: 'handToLife', upTo: f.upTo, filter: f.filter }];
    },
  ],

  [
    /^(.+?) will not become active in your opponent's next Refresh Phase$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'skipRefresh', target }), true),
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
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'nextOpponentTurn' }), true),
  ],
  [
    /^(.+?) cannot attack during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'turn' }), true),
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
  [/^Add this card to your hand$/i, () => [{ do: 'addThisToHand' }]],
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
    /^Add (.+?) to the top of (?:the owner's|your) Life cards(?: face-up)?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'fieldToLife', target }), true),
  ],
  [
    /^Add (.+?) to the top or bottom of (?:the owner's|your|your opponent's) Life cards(?: face-up)?$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'fieldToLife', target, choose: true }), true),
  ],
  [
    // Efeito opcional sem custo: "you may draw 1 card" → pergunta antes.
    /^you may (.+)$/i,
    (m) => {
      const rest = parseClause(m[1]);
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
    /^(.+?) gains? \[(Rush|Blocker|Double Attack|Banish)\] and \+(\d+) power during this (turn|battle)$/i,
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
    /^Look at (\d+) cards from the top of your deck and (?:return|place) them (?:at|to) the top or bottom of the deck in any order$/i,
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

/** Corpo de um efeito (depois das marcações e do custo). */
export function parseBody(body: string): EffectStep[] | null {
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
  for (let i = 0; i < sentences.length; i++) {
    let s = sentences[i].replace(/\.$/, '').replace(/^Then,\s*/i, '');
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
      s.match(/^Look at (?:up to )?(\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to your hand$/i) ??
      s.match(/^Look at (\d+) cards from the top of your deck; (play) up to (\d+) (.+?)$/i);
    if (look) {
      const play = look[2] === 'play';
      if (play) look.splice(2, 1);
      const f = parseCardFilter(look[3]);
      let next = sentences[i + 1] ?? '';
      // "Then, place the rest at the bottom of your deck in any order and play up to 1 [X] from your hand."
      const tail = next.match(/^(Then, place the rest at the bottom of your deck in any order) and (.+?)\.?$/i);
      let extra: EffectStep[] | null = null;
      if (tail) {
        extra = parseClause(tail[2]);
        if (!extra) return fail(`search tail: ${tail[2]}`);
        next = `${tail[1]}.`;
      }
      const rest = /^Then, place the rest at the bottom of your deck in any order\.?$/i.test(next)
        ? 'bottom'
        : /^Then, trash the rest\.?$/i.test(next)
          ? 'trash'
          : /^Then, place the rest at the top or bottom of the deck in any order\.?$/i.test(next)
            ? 'topOrBottom'
            : null;
      if (!f || !rest) return fail(`search: ${s} | ${next}`);
      const search: EffectStep = { do: 'search', look: Number(look[1]), upTo: Number(look[2]), filter: f.filter, rest };
      if (play) search.play = true;
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
    if (ifYouDo) {
      // Estende o trecho do último "you may" para incluir o "If you do, …".
      const opt = [...steps.slice(0, before)].reverse().find((st) => st.do === 'payCost' && st.scope !== undefined);
      if (opt && opt.do === 'payCost') opt.scope! += steps.length - before;
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
    else if (/^(trigger|end of your opponent's turn)$/.test(t)) return null; // ainda não suportados
    else break; // nome de carta no início da frase
    rest = rest.slice(m[0].length);
  }
  return { h, rest: rest.trim() };
}

/** Uma parte do custo ("rest this Character", "trash 1 card from your hand"...). */
function parseCostPart(part: string, cost: AbilityCost): boolean {
  let m: RegExpMatchArray | null;
  if (/^rest this (?:Character|Stage|card|Leader)$/i.test(part)) cost.restSelf = true;
  else if (/^trash this (?:Character|Stage|card)$/i.test(part)) cost.trashSelf = true;
  else if (/^place this Character at the bottom of (?:the owner's|your) deck$/i.test(part)) cost.selfToBottom = true;
  else if ((m = part.match(/^return (\d+) DON!! cards? from your field to your DON!! deck$/i))) cost.donMinus = Number(m[1]);
  else if ((m = part.match(/^rest (\d+) of your active DON!! cards?$/i))) cost.restDon = (cost.restDon ?? 0) + Number(m[1]);
  else if (/^rest your (?:1 )?Leader$/i.test(part)) cost.restOwn = { count: 1, spec: { side: 'own', kinds: ['leader'], upTo: 1 } };
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
    if (!spec || typeof spec !== 'object') return false;
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
  else if ((m = part.match(/^place (\d+) cards? from your hand at the bottom of your deck$/i))) cost.handToBottom = Number(m[1]);
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
      .replace(/ and this (Character|Stage|card)$/i, ' and rest this $1')
      .split(/ and (?=(?:rest|trash|add|place|return|turn|reveal) )/i);
    for (const part of parts) if (!parseCostPart(part.trim(), cost)) return null;
  }
  return { cost, body };
}

/** "When …" de habilidades que reagem a acontecimentos. */
function parseEvent(text: string): GameEvent | null {
  const t = text.trim().replace(/’/g, "'");
  if (/^a DON!! card on your field is returned to your DON!! deck(?: by your effect)?$/i.test(t)) return { kind: 'donReturned' };
  if (/^this Character becomes rested$/i.test(t)) return { kind: 'selfRested' };
  if (/^a Character is K\.?O\.?'d$/i.test(t)) return { kind: 'characterKO', whose: 'any' };
  if (/^(?:your opponent's Character|one of your opponent's Characters) is K\.?O\.?'d$/i.test(t)) {
    return { kind: 'characterKO', whose: 'opponent' };
  }
  if (/^you activate an Event$/i.test(t)) return { kind: 'eventActivated', who: 'self' };
  if (/^your opponent activates an Event$/i.test(t)) return { kind: 'eventActivated', who: 'opponent' };
  if (/^your opponent activates a \[Blocker\]$/i.test(t)) return { kind: 'blockerActivated', who: 'opponent' };
  if (/^this (?:Character|Leader)'s attack deals damage to your opponent's Life$/i.test(t)) return { kind: 'attackDamage' };
  if (/^this Character battles and K\.O\.'s your opponent's Character$/i.test(t)) return { kind: 'battleKO' };
  return null;
}

const POWER_SELF = /^this (?:Character|card|Leader) gains \+(\d+) power$/i;

function parseStatic(h: Header, body: string): Ability[] | null {
  const sentences = sentencesOf(body);
  if (sentences.length !== 1) return null;
  let s = sentences[0].replace(/\.$/, '');
  // Regras de construção / nome alternativo: não são efeitos de jogo (tratados na importação e no deck).
  if (/^Also treat this card's name as \[[^\]]+\] according to the rules$/i.test(s)) return [];
  if (/^Under the rules of this game, you may have any number of this card in your deck$/i.test(s)) return [];
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
  // "If this Character would be K.O.'d (in battle / by an effect / by your opponent's effect), you may X instead."
  const repl = s.match(
    /^If (this Character|your .+?|any of your Characters) would (be K\.O\.'d or (?:would )?be removed from the field|be K\.O\.'d|be removed from the field)( in battle| by an effect| by your opponent's effect)?(?: during this turn)?, you may (.+) instead$/i,
  );
  if (repl) {
    let who: Replacement['who'] = 'self';
    if (!/^this Character$/i.test(repl[1])) {
      const spec = parseTarget(repl[1].replace(/^any of your Characters$/i, 'your Characters'));
      if (!spec || typeof spec !== 'object' || spec.side !== 'own') return null;
      who = { ...spec, upTo: 99 };
    }
    const cost: AbilityCost = {};
    for (const part of repl[4].split(/ and (?=(?:rest|trash|add|place|return|turn|reveal) )/i)) if (!parseCostPart(part.trim(), cost)) return null;
    const event: Replacement['event'] = /or/i.test(repl[2]) ? 'koOrRemoval' : /removed/i.test(repl[2]) ? 'removal' : 'ko';
    const by: Replacement['by'] = !repl[3] ? 'any' : /battle/i.test(repl[3]) ? 'battle' : /opponent/i.test(repl[3]) ? 'opponentEffect' : 'effect';
    const ab: Ability = { ...base, timing: 'replace', replace: { who, event, by }, cost, steps: [] };
    if (h.oncePerTurn) ab.oncePerTurn = true;
    return [ab];
  }
  const when = s.match(/^When ([^,]+), (.+)$/i);
  // "[Opponent's Turn] When this Character is K.O.'d, …" = [On K.O.] restrito ao turno.
  if (when && /^this Character is K\.O\.'d$/i.test(when[1])) {
    const steps = parseBody(when[2]);
    if (!steps) return null;
    const ab: Ability = { ...base, timing: 'onKO', steps };
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
  const ifm = s.match(/^If ([^,]+), (.+)$/i);
  const tailIf = !ifm && s.match(/^(this (?:Character|card|Leader) gains .+?) if (.+)$/i);
  if (ifm || tailIf) {
    const cond = parseCondition(ifm ? ifm[1] : (tailIf as RegExpMatchArray)[2]);
    if (!cond) return null;
    base.condition = cond;
    s = ifm ? ifm[2] : (tailIf as RegExpMatchArray)[1];
  }
  if ((m = s.match(POWER_SELF))) return [{ ...base, staticPower: Number(m[1]) }];
  m = s.match(
    /^this (?:Character|Leader) gains \+(\d+) power for every (\d+ )?(?:of your )?(rested DON!! cards|cards? in your hand|cards? in your trash|Events? in your trash)$/i,
  );
  if (m) {
    const what = /DON/i.test(m[3]) ? 'restedDon' : /hand/i.test(m[3]) ? 'hand' : /Event/i.test(m[3]) ? 'trashEvents' : 'trash';
    return [{ ...base, powerPer: { power: Number(m[1]), every: Number(m[2] ?? 1), what } }];
  }
  if ((m = s.match(/^this (?:Character|card|Leader) gains \[(Rush|Blocker|Double Attack|Banish)\]$/i))) {
    return [{ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] }];
  }
  if (/^this Character can also attack (?:your opponent's )?active Characters$/i.test(s)) {
    return [{ ...base, staticCanAttackActive: true }];
  }
  if (/^this Character cannot be K\.O\.'d in battle$/i.test(s)) return [{ ...base, staticNoBattleKO: true }];
  if (/^this Character cannot be K\.O\.'d by effects$/i.test(s)) return [{ ...base, staticNoEffectKO: true }];
  if ((m = s.match(/^this Character cannot be K\.O\.'d in battle by "?(\w+)"? attribute (?:Characters|cards)$/i))) {
    return [{ ...base, noBattleKOVsAttribute: m[1] }];
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
  if ((m = s.match(/^give this (?:Leader|Character) [−-](\d+) power$/i))) return [{ ...base, staticPower: -Number(m[1]) }];
  if ((m = s.match(/^this Character gains \+(\d+) cost$/i))) return [{ ...base, staticCost: Number(m[1]) }];
  if ((m = s.match(/^this Character gains \[(Rush|Blocker|Double Attack|Banish)\] and \+(\d+) (cost|power)$/i))) {
    const second = m[3].toLowerCase() === 'cost' ? { staticCost: Number(m[2]) } : { staticPower: Number(m[2]) };
    return [{ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] }, { ...base, ...second }];
  }
  m = s.match(
    /^(?:all of )?your ((?:\{[^}]+\})(?:\s*(?:,|or|and)\s*\{[^}]+\})* type )?(Leaders? and Characters|Leader or Character cards|Characters|Leader) gains? \+(\d+) power$/i,
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
  const { h, rest } = parsedHeader;
  if (!rest) return h.keywords.length && !h.timings.length ? [] : fail('vazio');
  if (h.keywords.length) return fail(`keyword+texto: ${rest}`);
  if (!h.timings.length) return parseStatic(h, rest) ?? fail(`static: ${rest}`);
  const eventTiming = h.timings.some((t) => t === 'main' || t === 'counter');
  if (eventTiming !== (category === 'event')) return fail(`timing ${h.timings.join('/')} em ${category}`);
  const pc = parseCost(rest);
  if (!pc) return fail(`cost: ${rest.slice(0, rest.indexOf(':'))}`);
  const steps = parseBody(pc.body);
  if (!steps) return null;
  return h.timings.map((timing) => {
    const ab: Ability = { timing, steps };
    if (h.don) ab.don = h.don;
    if (h.oncePerTurn) ab.oncePerTurn = true;
    if (h.yourTurn) ab.yourTurn = true;
    if (h.opponentsTurn) ab.opponentsTurn = true;
    if (pc.cost && Object.keys(pc.cost).length) {
      if (timing === 'activateMain') ab.cost = pc.cost;
      else ab.steps = [{ do: 'payCost', cost: pc.cost }, ...steps];
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
    if (/^•/.test(line) && lines.length) lines[lines.length - 1] += ` ${line}`;
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
