// Formatos oficiais e legalidade das cartas.
//
//  - Extra Grand Battle (Extra Regulation): vale toda carta lançada, menos as banidas.
//  - Standard: além das banidas, só vale o que não rotacionou. As cartas com o ícone
//    de bloco ① (a "fruta" com o número 1: OP-01 a OP-04 e ST-01 a ST-09) saíram do
//    Standard em 1º/04/2026, exceto as da lista de "Block Number Updates" da Bandai
//    (Super Parallel/Manga com bloco X e cartas tratadas como bloco ④).
//
// Desde 1º/04/2026 a lista de banidas e de pares proibidos é a mesma nos dois formatos.
// Fontes: en.onepiece-cardgame.com/news/restriction.html (último aviso: restriction-2611.html) e
// en.onepiece-cardgame.com/news/blockicon-card.html. Para atualizar, é só mexer aqui.
//
// Spoilers (cartas anunciadas que ainda não foram lançadas) não são de formato nenhum:
// valem na fila casual e, se quem cria escolher, nas salas privadas e nos treinos contra
// o bot (ver `PlayMode` e `spoilerIssues`); nunca na ranqueada. Fora do Livre, "+ spoilers"
// quer dizer só a próxima coleção a ser lançada (`nextSpoilerSet`): hoje "Standard + EB05";
// quando a EB05 sai, passa sozinho a "Standard + OP18". As outras coleções, só no Livre.
//
// All Blue é um formato da comunidade, no estilo Pauper: só valem cartas comuns (C), incomuns
// (UC), raras (R) e promocionais (P); SR e SEC ficam de fora, e o Líder é livre. Como não é
// formato da Bandai, as banidas, os pares proibidos e a rotação NÃO se aplicam: a lista de
// banidas dele é própria (`ALL_BLUE_BANNED`, vazia até o meta pedir). Tem fila casual, sala
// privada, treino e torneio, mas não tem ranqueada (`hasRanked`) nem entra nas estatísticas
// do construído (`countsInStats`). A raridade vem do catálogo: `cardLegality` e `formatIssues`
// recebem as cartas, e carta sem raridade conhecida fica de fora até ser corrigida.
//
// Livre ("vale tudo") não é formato oficial: vale toda carta, inclusive as banidas, os
// pares proibidos e os spoilers. Só existe nos torneios, nas salas privadas e contra o
// bot, e as partidas não entram nas estatísticas (ver `countsInStats`).

import type { CardData, DeckList } from './types';

/** Formatos com fila e selo no deck: os dois oficiais da Bandai e o All Blue (da comunidade). */
export type FormatId = 'standard' | 'egb' | 'allblue';

/**
 * Formato de uma partida: um dos formatos de deck construído, o Livre (torneios, salas privadas e
 * bot) ou o Selado (`sealed`: o deck sai dos boosters abertos; regras em `sealed.ts`).
 */
export type PlayFormat = FormatId | 'free' | 'sealed';

/**
 * O Luffy de 6 cores dos eventos Sealed Battle: sem número na carta, por isso o id é nosso. "This
 * Leader can only be used in designated events": só vale no Selado (e no Livre, que vale tudo).
 */
export const SEALED_LEADER_ID = 'SEALED-001';

export const FORMATS: ReadonlyArray<{ id: FormatId; label: string }> = [
  { id: 'standard', label: 'Standard' },
  { id: 'egb', label: 'Extra Grand Battle' },
  { id: 'allblue', label: 'All Blue' },
];

/** Formatos oficiais da Bandai: os da ranqueada e das estatísticas. */
export const OFFICIAL_FORMATS: ReadonlyArray<{ id: FormatId; label: string }> = FORMATS.filter((f) => f.id !== 'allblue');
export const isOfficialFormat = (v: unknown): boolean => OFFICIAL_FORMATS.some((f) => f.id === v);
/** Se o formato tem fila ranqueada (o All Blue começa só no casual). */
export const hasRanked = (f: PlayFormat): boolean => isOfficialFormat(f);

export const isFormat = (v: unknown): v is FormatId => FORMATS.some((f) => f.id === v);
/** Formato de deck construído que quem cria a partida pode pedir (o Selado tem as rotas dele). */
export const isPlayFormat = (v: unknown): v is Exclude<PlayFormat, 'sealed'> => v === 'free' || isFormat(v);
export const formatLabel = (f: PlayFormat): string => (f === 'free' ? 'Livre' : f === 'sealed' ? 'Selado' : (FORMATS.find((x) => x.id === f)?.label ?? f));

/** Regras de cartas de uma partida: o formato e se aceita spoilers (o Livre sempre aceita). */
export interface PlayMode {
  format: PlayFormat;
  spoilers: boolean;
  /** Com spoilers (fora do Livre), a coleção aceita: a próxima a ser lançada quando a sala ou o torneio foi criado. */
  spoilerSet?: string;
  /**
   * No Selado, a coleção dos boosters: os dois decks precisam sair dela. No Pack Rush, a chave das
   * coleções escolhidas ("OP01+OP05", `rushKey`): os dois decks precisam ser da mesma escolha.
   */
  sealedSet?: string;
}

/**
 * Formatos de quem cria um torneio, uma sala privada ou um treino contra o bot. Com a escolha
 * dos spoilers, cada formato tem a versão pura e a "+ spoilers"; o Livre sempre aceita.
 */
export const PLAY_FORMATS: ReadonlyArray<PlayFormat> = ['standard', 'egb', 'allblue', 'free'];

/** Regras pedidas por quem cria, normalizadas: o Livre sempre aceita spoilers. */
export const playMode = (format: PlayFormat, spoilers: boolean): PlayMode => ({ format, spoilers: format === 'free' || format === 'sealed' || spoilers });

/**
 * Nome das regras de cartas: "Standard", "Standard + EB05" (a coleção de spoiler aceita),
 * "Standard + spoilers" (sem saber qual), "Livre (vale tudo)"…
 */
export const playModeLabel = (m: { format: PlayFormat; spoilers?: boolean; spoilerSet?: string | null; sealedSet?: string | null }): string =>
  m.format === 'sealed' ? (m.sealedSet?.includes('+') ? `Pack Rush ${m.sealedSet.split('+').join(' + ')}` : `Selado${m.sealedSet ? ` ${m.sealedSet}` : ''}`) : m.format === 'free' ? 'Livre (vale tudo)' : m.spoilers ? `${formatLabel(m.format)} + ${m.spoilerSet || 'spoilers'}` : formatLabel(m.format);

/**
 * Se a partida entra nas estatísticas: só Standard e EGB puros. Fica de fora o Livre, o
 * All Blue (para não misturar com o meta do construído), o torneio que aceita spoilers
 * (`spoilerMode`) e a partida com carta de spoiler em algum deck (`spoilerCards`): a coleção
 * ainda pode estar incompleta.
 */
export const countsInStats = (format: PlayFormat, opts: { spoilerMode?: boolean; spoilerCards?: boolean } = {}): boolean =>
  isOfficialFormat(format) && !opts.spoilerMode && !opts.spoilerCards;

/** Cartas banidas nos formatos oficiais (Standard e EGB). `since` = data em que a proibição passa a valer. */
export const BANNED_CARDS: ReadonlyArray<{ id: string; name: string; since?: string }> = [
  { id: 'OP03-040', name: 'Nami' },
  { id: 'OP06-047', name: 'Charlotte Pudding' },
  { id: 'OP06-086', name: 'Gecko Moria' },
  { id: 'OP06-116', name: 'Reject' },
  { id: 'ST10-001', name: 'Trafalgar Law' },
  { id: 'OP14-020', name: 'Dracule Mihawk', since: '2026-10-12' },
];

/** Pares que não podem estar juntos no mesmo deck (Líder incluso), nos formatos oficiais. */
export const BANNED_PAIRS: ReadonlyArray<{ cards: [string, string]; since?: string }> = [
  { cards: ['OP11-040', 'OP11-067'] },
  { cards: ['OP11-040', 'OP08-069'] },
  { cards: ['OP07-115', 'EB04-058'] },
  // Jewelry Bonney (EB05, vermelha) com os Líderes vermelho/verde Luffy e Law.
  { cards: ['EB05-001', 'OP13-001'], since: '2026-11-27' },
  { cards: ['EB05-001', 'OP01-002'], since: '2026-11-27' },
];

/** Coleções cujas cartas têm o ícone de bloco ①. */
const BLOCK_1_SET = /^(OP0[1-4]|ST0[1-9])-/;

/** Cartas de bloco ① que continuam valendo no Standard (bloco X ou tratadas como bloco ④). */
export const STANDARD_BLOCK_1_EXCEPTIONS: ReadonlySet<string> = new Set([
  // Bloco X (reimpressas como Super Parallel / Manga): valem sem prazo.
  'OP01-016', // Nami
  'OP01-120', // Shanks
  'OP02-013', // Portgas.D.Ace
  'OP03-122', // Sogeking
  'OP04-083', // Sabo
  // Tratadas como bloco ④ (lista "Cards Eligible for Use Under Block Number ④"): valem até 31/03/2029.
  'OP01-039', // Killer
  'OP01-055', // You Can Be My Samurai!!
  'OP02-005', // Curly Dadan
  'OP02-068', // Gum-Gum Rain
  'OP03-008', // Buggy
  'OP03-044', // Kaya
  'OP03-048', // Nojiko
  'OP03-072', // Gum-Gum Jet Gatling
  'OP03-097', // Six King Pistol
  'OP04-016', // Bad Manners Kick Course
  'OP04-077', // Ideo
  'OP04-096', // Corrida Coliseum
  'ST01-011', // Brook
  'ST02-007', // Jewelry Bonney
  'ST06-008', // Hina
]);

/**
 * Data de hoje no horário de Brasília (AAAA-MM-DD), para as proibições com data marcada:
 * "a partir de 12/10" vale da meia-noite de 12/10 em Brasília (UTC−3, sem horário de verão
 * desde 2019), e não das 21h do dia 11, como seria em UTC.
 */
const BRASILIA_OFFSET_MS = 3 * 3_600_000;
/** A data (AAAA-MM-DD) no horário de Brasília: também vale para o dia de lançamento de uma coleção. */
export const brasiliaDate = (now: Date = new Date()) => new Date(now.getTime() - BRASILIA_OFFSET_MS).toISOString().slice(0, 10);
const today = brasiliaDate;
const inEffect = (since: string | undefined, now: Date) => !since || since <= today(now);

/** Número de bloco impresso na carta, quando dá para saber pelo número da coleção. */
export function cardBlock(id: string): number | null {
  return BLOCK_1_SET.test(id) ? 1 : null;
}

// ---------------------------------------------------------------------------
// All Blue
// ---------------------------------------------------------------------------

/** Raridades que valem no All Blue (o Líder é livre). */
export const ALL_BLUE_RARITIES: ReadonlySet<string> = new Set(['C', 'UC', 'R', 'P']);

/**
 * Banidas do All Blue: lista própria, vazia no lançamento. A lista da Bandai não vale aqui; uma
 * carta só entra se desbalancear o formato. `since` = data em que a proibição passa a valer.
 */
export const ALL_BLUE_BANNED: ReadonlyArray<{ id: string; name: string; since?: string }> = [];

const RARITY_NAMES: Record<string, string> = {
  COMMON: 'C',
  UNCOMMON: 'UC',
  RARE: 'R',
  'SUPER RARE': 'SR',
  'SECRET RARE': 'SEC',
  LEADER: 'L',
  PROMO: 'P',
  PR: 'P',
};

/**
 * Raridade da carta no código curto (C, UC, R, SR, SEC, L, P); null = desconhecida. As fontes
 * mandam "PR" e "P" para promo; "SP", "TR" e "?" são de impressões especiais, não da carta.
 */
export function rarityCode(rarity: string | undefined | null): string | null {
  const r = (rarity ?? '').trim().toUpperCase();
  const code = RARITY_NAMES[r] ?? r;
  return ['C', 'UC', 'R', 'SR', 'SEC', 'L', 'P'].includes(code) ? code : null;
}

/** O que as regras de formato leem de uma carta além do número. */
export type FormatCard = Pick<CardData, 'rarity' | 'category'>;
/** Catálogo para as regras que dependem da carta (a raridade, no All Blue). */
export type FormatCards = ReadonlyMap<string, FormatCard> | Readonly<Record<string, FormatCard>>;

const cardIn = (cards: FormatCards | undefined, id: string): FormatCard | undefined =>
  cards instanceof Map ? cards.get(id) : (cards as Readonly<Record<string, FormatCard>> | undefined)?.[id];

/**
 * `rarity`: a raridade da carta não vale no formato (SR e SEC no All Blue) ou não é conhecida
 * (sem a carta do catálogo, não dá para liberar). `eventOnly`: carta só de evento (o Luffy de 6
 * cores do Selado), fora de todo formato de deck construído.
 */
export type CardLegality = 'legal' | 'banned' | 'rotated' | 'rarity' | 'eventOnly';

/**
 * Se a carta vale no formato. `card` (a carta do catálogo) só é lido no All Blue, que depende da
 * raridade; nos formatos oficiais basta o número.
 */
export function cardLegality(id: string, format: PlayFormat, now = new Date(), card?: FormatCard): CardLegality {
  // No Selado não há lista de restrições: vale o que saiu nos boosters (conferido em `sealed.ts`).
  if (format === 'free' || format === 'sealed') return 'legal';
  if (id === SEALED_LEADER_ID) return 'eventOnly';
  if (format === 'allblue') {
    if (ALL_BLUE_BANNED.some((b) => b.id === id && inEffect(b.since, now))) return 'banned';
    if (card?.category === 'leader') return 'legal';
    const rarity = rarityCode(card?.rarity);
    return rarity === 'L' || (rarity !== null && ALL_BLUE_RARITIES.has(rarity)) ? 'legal' : 'rarity';
  }
  if (BANNED_CARDS.some((b) => b.id === id && inEffect(b.since, now))) return 'banned';
  if (format === 'standard' && cardBlock(id) === 1 && !STANDARD_BLOCK_1_EXCEPTIONS.has(id)) return 'rotated';
  return 'legal';
}

/** Parâmetros das chaves de tradução dos avisos (`{nome}` na mensagem). */
export type RuleParams = Record<string, string | number>;

export interface FormatIssue {
  /** Texto em português (logs, servidor e clientes antigos). */
  message: string;
  /** Chave de tradução (`rules.…`); em português a mensagem equivale a `message`. */
  code: string;
  params: RuleParams;
  cardId?: string;
}

/**
 * Motivos de o deck não valer no formato (vazio = permitido). Nos formatos oficiais só olha os
 * números das cartas; no All Blue lê a raridade em `cards` (o catálogo), e carta que não está
 * nele ou não tem raridade conhecida não vale.
 */
export function formatIssues(deck: Pick<DeckList, 'leader' | 'cards'>, format: PlayFormat, now = new Date(), cards?: FormatCards): FormatIssue[] {
  if (format === 'free' || format === 'sealed') return [];
  const issues: FormatIssue[] = [];
  const ids = [...new Set([deck.leader, ...deck.cards.map((c) => c.id)].filter(Boolean))];
  const label = formatLabel(format);
  for (const id of ids) {
    const card = cardIn(cards, id);
    const legality = cardLegality(id, format, now, card);
    if (legality === 'eventOnly') {
      issues.push({ message: `${id} só pode ser usada no Selado.`, code: 'rules.eventOnly', params: { id }, cardId: id });
    } else if (legality === 'banned' && format === 'allblue') {
      issues.push({ message: `${id} está banida no ${label}.`, code: 'rules.bannedIn', params: { id, format: label }, cardId: id });
    } else if (legality === 'banned') {
      issues.push({ message: `${id} está banida (não vale no Standard nem no Extra Grand Battle).`, code: 'rules.banned', params: { id }, cardId: id });
    } else if (legality === 'rotated') {
      issues.push({ message: `${id} tem o bloco ① e rotacionou: não vale no ${label}.`, code: 'rules.rotated', params: { id, format: label }, cardId: id });
    } else if (legality === 'rarity') {
      const rarity = rarityCode(card?.rarity);
      issues.push(
        rarity
          ? { message: `${id} é ${rarity}: não vale no ${label} (só C, UC, R e promo).`, code: 'rules.rarity', params: { id, rarity, format: label }, cardId: id }
          : { message: `${id} não tem raridade conhecida: não vale no ${label}.`, code: 'rules.rarityUnknown', params: { id, format: label }, cardId: id },
      );
    }
  }
  // As banidas e os pares proibidos da Bandai não valem no All Blue.
  if (format === 'allblue') return issues;
  const has = new Set(ids);
  for (const { cards: [a, b], since } of BANNED_PAIRS) {
    if (has.has(a) && has.has(b) && inEffect(since, now)) {
      issues.push({ message: `${a} e ${b} não podem ser usadas juntas no mesmo deck.`, code: 'rules.bannedPair', params: { a, b }, cardId: b });
    }
  }
  return issues;
}

/** Formatos em que o deck pode ser usado (`cards`: o catálogo, para o All Blue). */
export function legalFormats(deck: Pick<DeckList, 'leader' | 'cards'>, now = new Date(), cards?: FormatCards): FormatId[] {
  return FORMATS.filter((f) => formatIssues(deck, f.id, now, cards).length === 0).map((f) => f.id);
}

/** Coleção pelo número da carta ("OP18-001" → "OP18"). */
export const cardSet = (id: string): string => id.split('-')[0];

/**
 * Próxima coleção a ser lançada: entre as que ainda têm cartas de spoiler (`withSpoilers`), a de
 * lançamento mais cedo (`release`, AAAA-MM-DD; sem data = promocionais e afins, nunca contam).
 * Quando a coleção sai e as cartas viram oficiais, a seguinte assume sozinha. null = nenhuma.
 */
export function nextSpoilerSet(sets: ReadonlyArray<{ set: string; release?: string }>, withSpoilers: ReadonlySet<string>): string | null {
  const next = sets
    .filter((s) => s.release && withSpoilers.has(s.set.toUpperCase()))
    .sort((a, b) => a.release!.localeCompare(b.release!) || a.set.localeCompare(b.set))[0];
  return next ? next.set.toUpperCase() : null;
}

/**
 * Quais cartas de spoiler a partida aceita: todas (fila casual e Livre), só as da próxima coleção a
 * ser lançada (Standard ou EGB + spoilers: torneios, salas privadas e treinos) ou nenhuma.
 */
export type SpoilerRule = 'all' | 'next' | 'none';

/** Regra de spoilers de um torneio, sala privada ou treino: o Livre aceita todas; com spoilers, só a próxima coleção. */
export const spoilerRule = (m: { format: PlayFormat; spoilers?: boolean }): SpoilerRule =>
  m.format === 'free' || m.format === 'sealed' ? 'all' : m.spoilers ? 'next' : 'none';

/** Das cartas de spoiler, as que a regra não aceita (`nextSet`: a próxima coleção, para `next`). */
export const barredSpoilers = (ids: readonly string[], rule: SpoilerRule, nextSet: string | null = null): string[] =>
  rule === 'all' ? [] : rule === 'next' ? ids.filter((id) => cardSet(id) !== nextSet) : [...ids];

/** Cartas de spoiler do deck (Líder incluso), na ordem em que aparecem. */
export function spoilerCards(deck: Pick<DeckList, 'leader' | 'cards'>, cards: ReadonlyMap<string, Pick<CardData, 'spoiler'>>): string[] {
  const ids = [...new Set([deck.leader, ...deck.cards.map((c) => c.id)].filter(Boolean))];
  return ids.filter((id) => cards.get(id)?.spoiler);
}

/** Onde as cartas de spoiler valem (o fim dos avisos). */
const SPOILER_WHERE = 'só valem na fila casual e nas salas privadas, treinos contra o bot e torneios com spoilers';

/**
 * Motivo de o deck não valer pela regra de spoilers (`none`: ranqueada e torneios, salas privadas
 * e treinos sem spoilers; `next`: com spoilers, só a próxima coleção, `nextSet`); vazio = nenhuma
 * carta barrada. Um aviso só, com as primeiras cartas.
 */
export function spoilerIssues(
  deck: Pick<DeckList, 'leader' | 'cards'>,
  cards: ReadonlyMap<string, Pick<CardData, 'spoiler'>>,
  rule: SpoilerRule = 'none',
  nextSet: string | null = null,
): FormatIssue[] {
  const all = barredSpoilers(spoilerCards(deck, cards), rule, nextSet);
  if (!all.length) return [];
  const n = all.length;
  const ids = all.slice(0, 3).join(', ') + (n > 3 ? '…' : '');
  if (rule === 'next') {
    const set = nextSet ?? '—';
    const what = n === 1 ? 'Carta de spoiler de outra coleção' : 'Cartas de spoiler de outras coleções';
    return [
      {
        message: `${what}: ${ids}. Com spoilers, fora do Livre, só vale a próxima coleção a ser lançada (${set}); as demais, só no Livre.`,
        code: 'rules.spoilerNotNext',
        params: { n, ids, set },
        cardId: all[0],
      },
    ];
  }
  const what = n === 1 ? 'Carta ainda não lançada (spoiler)' : 'Cartas ainda não lançadas (spoilers)';
  return [{ message: `${what}: ${ids}. Spoilers ${SPOILER_WHERE}.`, code: 'rules.spoiler', params: { n, ids }, cardId: all[0] }];
}
