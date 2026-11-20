// Busca do catálogo de cartas (construtor de decks): o campo de texto aceita atalhos além do
// texto livre. Sem React, para poder testar.
//
// Números (com faixas: `c3+` 3 ou mais, `c3-` até 3, `c2-4` de 2 a 4)
//   c3            custo 3
//   c2000         Counter +2000 (a partir de 1000, ou com 4 dígitos, é Counter); c0000 ou sc = sem Counter
//   p5000 ou p5   poder 5000
//   v4 ou l4      Líder com 4 de vida
// Carta
//   red, azul, r  cor (r g b p k y; duas cores = carta com as duas)
//   char event stage leader      categoria
//   slash strike ranged special wisdom   atributo
//   sr sec uc rare common promo  raridade (ou r:sr, r:l…)
//   op05 st10     coleção (ou s:p)
// Efeito
//   blocker rush banish double unblockable trigger   palavra-chave que a carta tem
//   onplay onko whenattacking main activate counter…  momento do efeito
//   don2, don-2   [DON!! x2], DON!! −2
//   vanilla       sem efeito
// Deck
//   indeck        já está no deck
//   banned legal rotated   situação no Standard
//   new           ainda não lançada (spoiler)
// Operadores
//   -blocker      exclui o que casar
//   "straw hat"   frase exata (fora das aspas, cada palavra é procurada separada, em qualquer ordem)
//   n:luffy t:supernovas   só no nome, só no tipo
//
// Como os atalhos se combinam: o que a carta só tem um (custo, Counter, poder, vida, categoria,
// raridade, coleção) soma dentro do mesmo tipo (c3 c4 = custo 3 ou 4); todo o resto precisa
// valer junto (c3 c2000 blocker = custo 3, Counter +2000 e [Blocker]).
//
// Uma palavra que é atalho continua achando o nome ou tipo de que faz parte quando vem colada
// na palavra vizinha: "east blue" traz o tipo East Blue, "black maria" traz a Black Maria.

import { type CardData, cardLegality, type Color, detectKeywords, type Keyword } from '@gumgum/engine';

/** O que a busca precisa saber de fora da carta. */
export interface CardSearchContext {
  /** A carta está no deck em edição (para `indeck`). */
  inDeck?: (id: string) => boolean;
  /** Data de referência das proibições (para `banned`/`legal`); o padrão é agora. */
  now?: Date;
}

type Test = (card: CardData, ctx: CardSearchContext) => boolean;
/** Tipos de filtro em que a carta só tem um valor: atalhos do mesmo grupo somam. */
type Group = 'cost' | 'counter' | 'power' | 'life' | 'category' | 'rarity' | 'set';

interface Term {
  negate: boolean;
  group?: Group;
  test: Test;
}

export interface CardQuery {
  terms: Term[];
  /** A busca pede Líderes (`leader`, `v4`): o catálogo os mostra mesmo fora da escolha de Líder. */
  wantsLeaders: boolean;
}

/** Minúsculas e sem acentos, para "lider" achar "Líder". */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------------------
// Texto da carta, preparado uma vez por carta
// ---------------------------------------------------------------------------

interface Indexed {
  all: string;
  name: string;
  types: string;
  /** Nome e tipos: onde uma palavra de atalho pode ser, na verdade, parte de um nome. */
  title: string;
  keywords: Set<Keyword>;
}

const KEYWORD_TAG: Record<Keyword, string> = {
  rush: 'Rush',
  blocker: 'Blocker',
  doubleAttack: 'Double Attack',
  banish: 'Banish',
  rushCharacter: 'Rush: ?Character',
  unblockable: 'Unblockable',
};

/** "[DON!! x1] This Character gains [Rush]": a carta dá a palavra-chave a si mesma, sob condição. */
const selfGain = (tag: string) => new RegExp(`\\bthis (?:character|leader|card) (?:also )?gains? [^.:\\n]*?\\[${tag}\\]`, 'i');
const SELF_GAIN = (Object.keys(KEYWORD_TAG) as Keyword[]).map((kw) => [kw, selfGain(KEYWORD_TAG[kw])] as const);

const indexed = new WeakMap<CardData, Indexed>();

function index(card: CardData): Indexed {
  let entry = indexed.get(card);
  if (!entry) {
    const name = norm([card.name, ...(card.aliases ?? [])].join(' / '));
    const types = norm(card.types.join(' / '));
    const pt = card.i18n?.pt;
    const keywords = new Set(detectKeywords(card.text));
    for (const [kw, re] of SELF_GAIN) if (re.test(card.text)) keywords.add(kw);
    entry = {
      all: norm(`${card.id} ${name} ${types} ${card.text} ${card.trigger ?? ''} ${pt?.text ?? ''} ${pt?.trigger ?? ''}`),
      name,
      types,
      title: `${name} / ${types}`,
      keywords,
    };
    indexed.set(card, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Atalhos por palavra
// ---------------------------------------------------------------------------

interface Shortcut {
  group?: Group;
  test: Test;
  /** Só Líderes têm isso: a busca passa a mostrá-los. */
  leaders?: boolean;
}

const WORDS = new Map<string, Shortcut>();
const def = (names: string, shortcut: Shortcut) => {
  for (const name of names.split(' ')) WORDS.set(name, shortcut);
};

const color = (c: Color): Shortcut => ({ test: (card) => card.colors.includes(c) });
// Uma letra: r g b p y, mais k para preto (b é azul) e u, o azul de quem vem de outros card games.
def('red vermelho r', color('red'));
def('green verde g', color('green'));
def('blue azul b u', color('blue'));
def('purple roxo p', color('purple'));
def('black preto k', color('black'));
def('yellow amarelo y', color('yellow'));

const category = (c: CardData['category']): Shortcut => ({ group: 'category', test: (card) => card.category === c, leaders: c === 'leader' });
def('char chars character characters personagem personagens', category('character'));
def('event events evento eventos', category('event'));
def('stage stages', category('stage'));
def('leader leaders lider lideres', category('leader'));

for (const attribute of ['Slash', 'Strike', 'Ranged', 'Special', 'Wisdom']) {
  def(attribute.toLowerCase(), { test: (card) => card.attributes?.includes(attribute) ?? false });
}

const rarity = (...codes: string[]): Shortcut => ({ group: 'rarity', test: (card) => codes.includes(card.rarity ?? '') });
def('sr', rarity('SR'));
def('sec', rarity('SEC'));
def('uc uncommon incomum', rarity('UC'));
def('rare rara', rarity('R'));
def('common comum', rarity('C'));
def('promo', rarity('PR', 'P'));

const keyword = (kw: Keyword): Shortcut => ({ test: (card) => index(card).keywords.has(kw) });
def('blocker', keyword('blocker'));
def('rush', keyword('rush'));
def('banish', keyword('banish'));
def('double doubleattack', keyword('doubleAttack'));
def('unblockable', keyword('unblockable'));
def('rushchar', keyword('rushCharacter'));
def('trigger', { test: (card) => Boolean(card.trigger) });

const tag = (re: RegExp): Shortcut => ({ test: (card) => re.test(card.text) });
def('onplay', tag(/\[On Play\]/i));
def('onko', tag(/\[On K\.O\.\]/i));
def('whenattacking attacking', tag(/\[When Attacking\]/i));
def('main', tag(/\[Main\]/i));
def('activate', tag(/\[Activate: ?Main\]/i));
def('counter', tag(/\[Counter\]/i));
def('onblock', tag(/\[On Block\]/i));
def('endofturn eot', tag(/\[End of Your Turn\]/i));
def('yourturn', tag(/\[Your Turn\]/i));
def('oppturn', tag(/\[Opponent's Turn\]/i));
def('onoppattack', tag(/\[On Your Opponent's Attack\]/i));
def('onceperturn opt', tag(/\[Once Per Turn\]/i));

def('vanilla', { test: (card) => !card.text.trim() && !card.trigger });
def('sc nocounter', { group: 'counter', test: (card) => !card.counter });

def('indeck nodeck', { test: (card, ctx) => ctx.inDeck?.(card.id) ?? false });
const legality = (status: ReturnType<typeof cardLegality>): Shortcut => ({ test: (card, ctx) => cardLegality(card.id, 'standard', ctx.now) === status });
def('banned banida banidas', legality('banned'));
def('legal', legality('legal'));
def('rotated rotacionada rotacionadas', legality('rotated'));
def('new nova novas spoiler spoilers', { test: (card) => Boolean(card.spoiler) });

const cardSet = (card: CardData) => (card.set ?? card.id.split('-')[0] ?? '').toLowerCase();
const inSet = (code: string): Shortcut => ({ group: 'set', test: (card) => cardSet(card) === code });
/** Código de coleção digitado inteiro (op05, st10, eb01, prb01); as outras, como a P, vão por `s:p`. */
const SET_CODE = /^(?:op|st|eb|prb)\d{2}$/;

// ---------------------------------------------------------------------------
// Atalhos com número
// ---------------------------------------------------------------------------

/** `c3`, `c3+` (3 ou mais), `c3-` (até 3), `c2-4` (de 2 a 4); idem para p (poder) e v/l (vida). */
const NUMERIC = /^([cpvl])(\d+)(?:([+-])|-(\d+))?$/;
/** A partir deste número, `c<número>` é Counter (+1000, +2000); abaixo, é custo. */
const COUNTER_MIN = 1000;

function numeric(word: string): Shortcut | null {
  const m = NUMERIC.exec(word);
  if (!m) return null;
  const [, letter, digits, open, upper] = m;
  let lo = Number(digits);
  let hi = upper !== undefined ? Number(upper) : open === '+' ? Infinity : lo;
  if (open === '-') lo = -Infinity;
  const between = (n: number | undefined) => n !== undefined && n >= lo && n <= hi;
  if (letter === 'c') {
    // c0000 = Counter 0, ou seja, sem Counter.
    const isCounter = digits!.length >= 4 || Number(digits) >= COUNTER_MIN || (upper !== undefined && Number(upper) >= COUNTER_MIN);
    return isCounter ? { group: 'counter', test: (card) => between(card.counter ?? 0) } : { group: 'cost', test: (card) => between(card.cost) };
  }
  if (letter === 'p') {
    // p5 = 5000: o poder vem sempre em milhares.
    const scale = (n: number) => (Number.isFinite(n) && n < 100 ? n * 1000 : n);
    lo = scale(lo);
    hi = scale(hi);
    return { group: 'power', test: (card) => between(card.power) };
  }
  return { group: 'life', test: (card) => between(card.life), leaders: true };
}

/** `don2` = [DON!! x2]; `don-2` = custo de devolver 2 DON!! (DON!! −2). */
const DON = /^don(-?)(\d+)$/;

function don(word: string): Shortcut | null {
  const m = DON.exec(word);
  if (!m) return null;
  return tag(m[1] ? new RegExp(`DON!! ?[-−]${m[2]}(?!\\d)`) : new RegExp(`\\[DON!! ?[x×]${m[2]}\\]`, 'i'));
}

// ---------------------------------------------------------------------------
// Leitura da busca
// ---------------------------------------------------------------------------

/** Um pedaço da busca: palavra solta, "frase entre aspas" ou `n:`/`t:`/`r:`/`s:` com valor. */
interface Token {
  negate: boolean;
  key?: string;
  quoted: boolean;
  value: string;
}

const TOKEN = /-?(?:[a-z]:)?"[^"]*"?|\S+/gi;
const KEYED = /^([ntrs]):(.*)$/;

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  for (const [piece] of query.matchAll(TOKEN)) {
    let raw = norm(piece);
    // "-" só exclui diante de uma palavra: "-2000" continua sendo texto.
    const negate = /^-["\p{L}]/u.test(raw);
    if (negate) raw = raw.slice(1);
    const keyed = KEYED.exec(raw);
    const body = keyed ? keyed[2]! : raw;
    const quoted = body.startsWith('"');
    const value = quoted ? body.replace(/^"|"$/g, '').trim() : body;
    if (value) tokens.push({ negate, key: keyed?.[1], quoted, value });
  }
  return tokens;
}

const text = (field: 'all' | 'name' | 'types', value: string): Test => (card) => index(card)[field].includes(value);

/**
 * `aliases`: palavras a mais que valem por um atalho (palavra -> atalho), como os nomes das cores
 * e das categorias no idioma em vigor ("rouge" -> "red").
 */
export function parseCardQuery(query: string, aliases: Record<string, string> = {}): CardQuery {
  const alias = new Map(Object.entries(aliases).map(([word, to]) => [norm(word), to]));
  const tokens = tokenize(query);
  const terms: Term[] = [];
  let wantsLeaders = false;
  /** A palavra do vizinho, se for uma palavra solta (com que este atalho pode formar um nome). */
  const neighbor = (i: number) => {
    const t = tokens[i];
    return t && !t.negate && !t.key && !t.quoted ? t.value : null;
  };

  tokens.forEach((token, i) => {
    const { negate, key, quoted, value } = token;
    let shortcut: Shortcut | null = null;
    let test: Test | null = null;
    if (key === 'n') test = text('name', value);
    else if (key === 't') test = text('types', value);
    else if (key === 'r') shortcut = rarity(value.toUpperCase());
    else if (key === 's') shortcut = inSet(value);
    else if (quoted) test = text('all', value);
    else {
      const word = alias.get(value) ?? value;
      const fixed = numeric(word) ?? don(word);
      const named = fixed ? null : (WORDS.get(word) ?? (SET_CODE.test(word) ? inSet(word) : null));
      shortcut = fixed ?? named;
      if (named && !negate) {
        // "east blue": `blue` é atalho, mas colado em `east` também é o tipo East Blue.
        const before = neighbor(i - 1);
        const after = neighbor(i + 1);
        const phrases = [before && `${before} ${value}`, after && `${value} ${after}`].filter((p): p is string => Boolean(p));
        if (phrases.length) {
          const filter = named.test;
          shortcut = { ...named, test: (card, ctx) => filter(card, ctx) || phrases.some((p) => index(card).title.includes(p)) };
        }
      }
      if (!shortcut) test = text('all', value);
    }
    if (shortcut) {
      terms.push({ negate, group: shortcut.group, test: shortcut.test });
      if (shortcut.leaders && !negate) wantsLeaders = true;
    } else if (test) terms.push({ negate, test });
  });
  return { terms, wantsLeaders };
}

export function matchesCardQuery(card: CardData, q: CardQuery, ctx: CardSearchContext = {}): boolean {
  let groups: Map<Group, boolean> | undefined;
  for (const term of q.terms) {
    const hit = term.test(card, ctx);
    if (term.negate) {
      if (hit) return false;
    } else if (term.group) {
      groups ??= new Map();
      groups.set(term.group, hit || groups.get(term.group) === true);
    } else if (!hit) return false;
  }
  if (groups) for (const ok of groups.values()) if (!ok) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Painel de atalhos: pôr e tirar um atalho da busca
// ---------------------------------------------------------------------------

const padded = (query: string) => ` ${query.trim().replace(/\s+/g, ' ')} `;

/** O atalho já está escrito na busca (como palavra inteira). */
export const hasSearchCode = (query: string, code: string) => padded(query).toLowerCase().includes(` ${code} `);

/** Põe o atalho no fim da busca, ou tira se já estiver lá. */
export function toggleSearchCode(query: string, code: string): string {
  const q = padded(query);
  const at = q.toLowerCase().indexOf(` ${code} `);
  return (at < 0 ? `${q}${code}` : `${q.slice(0, at)} ${q.slice(at + code.length + 2)}`).trim();
}
