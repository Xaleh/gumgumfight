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
  EffectStep,
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
};

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

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

  const spec: TargetSpec = { side: 'any', kinds: [], upTo: 1 };
  let m: RegExpMatchArray | null;
  let quantified = false;
  if ((m = p.match(/^up to (\d+) (?:of )?/i))) {
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
    else if ((m = p.match(/^rested /i))) spec.rested = true;
    else if ((m = p.match(/^active /i))) spec.rested = false;
    else if ((m = p.match(/^\[(Rush|Blocker|Double Attack|Banish)\] /i))) spec.keyword = KEYWORDS[m[1].toLowerCase()];
    else if ((m = p.match(/^\[([^\]]+)\]\s*/))) spec.name = m[1];
    else break;
    p = p.slice(m[0].length);
  }

  // Substantivo.
  if ((m = p.match(/^(?:Leader or Character cards?|Leaders? and Characters|Leaders? or Characters?)/i))) {
    spec.kinds = ['leader', 'character'];
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
  if ((m = t.match(/^you have (\d+) or more rested Characters$/i))) return { minRestedCharacters: Number(m[1]) };
  if ((m = t.match(/^your opponent has (\d+) or more rested Characters$/i))) return { opponentMinRestedCharacters: Number(m[1]) };
  if ((m = t.match(/^your Leader's type includes "([^"]+)"$/i))) return { leaderHasType: m[1] };
  // "If that card is a Character, that Character …": o passo seguinte já só vale para Personagens.
  if (/^that card is a Character$/i.test(t)) return {};
  // Várias condições: "If your Leader has the {X} type and you have 2 or less Life cards"
  const parts = t.split(/ and (?=you |your |there )/i);
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

const durationOf = (d: string): 'turn' | 'battle' => (/battle/i.test(d) ? 'battle' : 'turn');

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
  [/^K\.O\. (.+)$/i, (m) => withTarget(m[1], (target) => ({ do: 'ko', target }), true)],
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
    /^Give (.+?) [−-](\d+) power during this (turn|battle)$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: -Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    // Sem sinal: a API perde o "−" ("Give … 2000 power" = −2000). "Give" nunca dá poder positivo.
    /^Give (.+?) (\d+) power during this (turn|battle)$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: -Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    /^Give (.+?) [−-]?(\d+) cost during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cost', target, amount: -Number(m[2]), duration: 'turn' }), true),
  ],
  [
    /^(.+?) gains? \+(\d+) power during this (turn|battle)$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: Number(m[2]), duration: durationOf(m[3]) })),
  ],
  [
    /^(.+?) gains? \[(Rush|Blocker|Double Attack|Banish)\] during this turn$/i,
    (m) =>
      withTarget(m[1], (target) => ({ do: 'gainKeyword', target, keyword: KEYWORDS[m[2].toLowerCase()], duration: 'turn' })),
  ],
  [
    /^Draw (\d+) cards? and trash (\d+) cards? from your hand$/i,
    (m) => [
      { do: 'draw', count: Number(m[1]) },
      { do: 'trashFromHand', count: Number(m[2]) },
    ],
  ],
  [/^Draw (\d+) cards?$/i, (m) => [{ do: 'draw', count: Number(m[1]) }]],
  [/^Draw a card$/i, () => [{ do: 'draw', count: 1 }]],
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
    /^(.+?) cannot attack until the end of your opponent's next turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'nextOpponentTurn' }), true),
  ],
  [
    /^(.+?) cannot attack during this turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'cannotAttack', target, duration: 'turn' }), true),
  ],
  [
    /^(.+?) gains? \+(\d+) power until the end of your opponent's next turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: Number(m[2]), duration: 'nextOpponentTurn' })),
  ],
  [
    /^Give (.+?) [−-]?(\d+) power until the end of your opponent's next turn$/i,
    (m) => withTarget(m[1], (target) => ({ do: 'power', target, amount: -Number(m[2]), duration: 'nextOpponentTurn' })),
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
    /^Add up to (\d+) cards? from the top of your deck to the top of your Life cards$/i,
    (m) => [{ do: 'addLifeFromDeck', count: Number(m[1]) }],
  ],
  [
    /^Trash up to (\d+) cards? from the top of your opponent's Life cards$/i,
    (m) => [{ do: 'trashLife', side: 'opponent', count: Number(m[1]) }],
  ],
  [
    /^Play (.+?) from your (hand|deck|trash)( rested)?$/i,
    (m) => {
      const f = parseCardFilter(m[1]);
      if (!f) return null;
      const step: EffectStep = { do: 'playFrom', from: m[2].toLowerCase() as 'hand' | 'deck' | 'trash', upTo: f.upTo, filter: f.filter };
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
    /^(.+?) cannot be K\.O\.'d (in battle )?during this turn$/i,
    (m) => withTarget(m[1], (target) => (m[2] ? { do: 'cannotBeKO', target, duration: 'turn', inBattle: true } : { do: 'cannotBeKO', target, duration: 'turn' })),
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
    const first = parseClause(c.slice(0, at));
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
  const sentences = sentencesOf(body);
  if (!sentences.length) return null;
  const steps: EffectStep[] = [];
  for (let i = 0; i < sentences.length; i++) {
    let s = sentences[i].replace(/\.$/, '').replace(/^Then,\s*/i, '');
    // "Look at N cards…; reveal up to M … and add it to your hand. Then, place the rest at the bottom…"
    const look =
      s.match(/^Look at (\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to your hand$/i) ??
      s.match(/^Look at (\d+) cards from the top of your deck; (play) up to (\d+) (.+?)$/i);
    if (look) {
      const play = look[2] === 'play';
      if (play) look.splice(2, 1);
      const f = parseCardFilter(look[3]);
      const next = sentences[i + 1] ?? '';
      const rest = /^Then, place the rest at the bottom of your deck in any order\.?$/i.test(next)
        ? 'bottom'
        : /^Then, trash the rest\.?$/i.test(next)
          ? 'trash'
          : null;
      if (!f || !rest) return null;
      const search: EffectStep = { do: 'search', look: Number(look[1]), upTo: Number(look[2]), filter: f.filter, rest };
      if (play) search.play = true;
      steps.push(search);
      i++;
      continue;
    }
    let cond: Condition | undefined;
    const ifm = s.match(/^If ([^,]+), (.+)$/i);
    if (ifm) {
      const c = parseCondition(ifm[1]);
      if (!c) return null;
      cond = c;
      s = ifm[2];
    }
    for (const clause of s.split(/, then /i)) {
      const parsed = parseClause(clause);
      if (!parsed) return null;
      steps.push(...(cond && Object.keys(cond).length ? parsed.map((st) => ({ ...st, if: { ...cond, ...st.if } })) : parsed));
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
    else if (/^(on your opponent's attack|trigger|end of your opponent's turn)$/.test(t)) return null; // ainda não suportados
    else break; // nome de carta no início da frase
    rest = rest.slice(m[0].length);
  }
  return { h, rest: rest.trim() };
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
  if ((m = c.match(/^You may add (\d+) cards? from (?:the top of )?your Life (?:area|cards) to your hand$/i))) {
    cost.lifeToHand = Number(m[1]);
    c = '';
  }
  if ((m = c.match(/^You may rest (\d+) of your Characters$/i))) {
    cost.restCharacters = Number(m[1]);
    c = '';
  }
  if ((m = c.match(/^You may place (\d+) cards? from your hand at the bottom of your deck$/i))) {
    cost.handToBottom = Number(m[1]);
    c = '';
  }
  if ((m = c.match(/^You may rest (\d+) of your DON!! cards?$/i))) {
    cost.restDon = (cost.restDon ?? 0) + Number(m[1]);
    c = '';
  }
  if (c) {
    // "You may trash 1 card from your hand and rest this Character" = mesma coisa na outra ordem.
    const swapped = c.match(/^You may (trash .+? from your hand) and rest this (Character|Stage|card|Leader)$/i);
    if (swapped) c = `You may rest this ${swapped[2]} and ${swapped[1]}`;
    const rs = c.match(/^You may rest this (?:Character|Stage|card|Leader)(?: and (.+))?$/i);
    const trash = (rs ? rs[1] : c.replace(/^You may /i, ''))?.match(/^trash (\d+) (.+?) from your hand$/i);
    if (rs) cost.restSelf = true;
    if (rs ? rs[1] : true) {
      if (!trash) return null;
      cost.trashFromHand = Number(trash[1]);
      if (!/^cards?$/i.test(trash[2])) {
        const f = parseCardFilter(`1 ${trash[2]}`);
        if (!f) return null;
        cost.trashFilter = f.filter;
      }
    }
  }
  return { cost, body };
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
  if ((m = s.match(/^this (?:Character|card|Leader) gains \[(Rush|Blocker|Double Attack|Banish)\]$/i))) {
    return [{ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] }];
  }
  if (/^this Character can also attack your opponent's active Characters$/i.test(s)) {
    return [{ ...base, staticCanAttackActive: true }];
  }
  if (/^this Character cannot be K\.O\.'d in battle$/i.test(s)) return [{ ...base, staticNoBattleKO: true }];
  if (/^this Character cannot be K\.O\.'d by effects$/i.test(s)) return [{ ...base, staticNoEffectKO: true }];
  if ((m = s.match(/^this Character cannot be K\.O\.'d in battle by "?(\w+)"? attribute (?:Characters|cards)$/i))) {
    return [{ ...base, noBattleKOVsAttribute: m[1] }];
  }
  if (/^this (?:Leader|Character) cannot attack$/i.test(s)) return [{ ...base, staticCannotAttack: true }];
  if ((m = s.match(/^this Character gains \+(\d+) cost$/i))) return [{ ...base, staticCost: Number(m[1]) }];
  if ((m = s.match(/^this Character gains \[(Rush|Blocker|Double Attack|Banish)\] and \+(\d+) cost$/i))) {
    return [{ ...base, staticKeyword: KEYWORDS[m[1].toLowerCase()] }, { ...base, staticCost: Number(m[2]) }];
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

function parseLine(raw: string, category: CardCategory): Ability[] | null {
  const parsedHeader = parseHeader(clean(raw));
  if (!parsedHeader) return null;
  const { h, rest } = parsedHeader;
  if (!rest) return h.keywords.length && !h.timings.length ? [] : null;
  if (h.keywords.length) return null;
  if (!h.timings.length) return parseStatic(h, rest);
  const eventTiming = h.timings.some((t) => t === 'main' || t === 'counter');
  if (eventTiming !== (category === 'event')) return null;
  const pc = parseCost(rest);
  if (!pc) return null;
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

/** Lê os efeitos da carta. Linhas não reconhecidas viram habilidades manuais. */
export function parseCard(card: Pick<CardData, 'category' | 'text' | 'trigger'>): ParsedCard {
  const keywords = detectKeywords(card.text ?? '');
  const abilities: Ability[] = [];
  const unparsed: string[] = [];
  for (const line of splitEffects(card.text ?? '')) {
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
    const pc = parseCost(clean(trigger));
    const body = pc && parseBody(pc.body);
    const steps = body && (pc.cost && Object.keys(pc.cost).length ? [{ do: 'payCost', cost: pc.cost } as EffectStep, ...body] : body);
    if (steps) abilities.push({ timing: 'trigger', steps });
    else {
      abilities.push(manualTrigger(trigger));
      unparsed.push(`[Trigger] ${trigger}`);
    }
  }
  return { keywords, abilities, unparsed };
}
