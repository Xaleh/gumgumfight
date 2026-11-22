// Regras de construção de deck e formato de lista em texto.
//
// Regras (One Piece Card Game):
//  - 1 Líder, fora do deck principal;
//  - deck principal com exatamente 50 cartas (sem Líderes);
//  - no máximo 4 cópias do mesmo número de carta;
//  - cada carta precisa ter ao menos uma cor em comum com o Líder;
//  - com um formato informado, cartas banidas, pares proibidos e (no Standard)
//    cartas rotacionadas também invalidam o deck (veja formats.ts).
// O Yonko (mesa de todos contra todos) tem as suas: 60 cartas, uma cópia de cada (`validateYonkoDeck`).

import { buildCardDef, needsManual } from './cards';
import { DECK_SIZE, hasType, YONKO_DECK_SIZE } from './engine';
import { formatIssues, type PlayFormat, type RuleParams } from './formats';
import { nextRandom } from './rng';
import type { CardData, DeckList, GameState, LeaderRule, PlayerId } from './types';
import { HIDDEN_CARD, HIDDEN_REF } from './view';

export const MAX_COPIES = 4;

/** "Under the rules of this game, you may have any number of this card in your deck." */
export function anyNumberAllowed(card: Pick<CardData, 'text'>): boolean {
  return /you may have any number of this card in your deck/i.test(card.text ?? '');
}

export interface DeckIssue {
  level: 'error' | 'warning';
  /** Texto em português (logs, servidor e clientes antigos). */
  message: string;
  /** Chave de tradução (`rules.…`) e os parâmetros dela; em português a mensagem equivale a `message`. */
  code: string;
  params: RuleParams;
  cardId?: string;
}

/** Problema numa linha da lista em texto (`parseDeckList`), com a chave de tradução. */
export interface DeckListError {
  message: string;
  code: string;
  params: RuleParams;
}

export interface DeckReport {
  valid: boolean;
  total: number;
  issues: DeckIssue[];
  /** Cartas cujo efeito ainda não é automatizado pelo motor. */
  unscripted: string[];
}

export function deckSize(deck: Pick<DeckList, 'cards'>): number {
  return deck.cards.reduce((s, c) => s + c.count, 0);
}

export function isColorCompatible(leader: CardData, card: CardData): boolean {
  return card.colors.some((c) => leader.colors.includes(c));
}

/**
 * Regras de construção do Líder ("you cannot include cards with a cost of 5 or more in your deck",
 * "you can only include {East Blue} type cards in your deck").
 */
const leaderRuleCache = new WeakMap<CardData, ReturnType<typeof buildCardDef>['abilities']>();

/** A regra de construção do Líder que a carta descumpre (nenhuma: `undefined`). */
export function leaderRuleBroken(leader: CardData, card: CardData): LeaderRule | undefined {
  let abilities = leaderRuleCache.get(leader);
  if (!abilities) leaderRuleCache.set(leader, (abilities = buildCardDef(leader).abilities));
  for (const a of abilities) {
    const r = a.rule;
    if (r?.kind === 'deckMaxCost' && (!r.category || card.category === r.category) && (card.cost ?? 0) > r.cost) return r;
    if (r?.kind === 'deckOnlyType' && !hasType(card, r.type)) return r;
  }
  return undefined;
}

export function leaderAllows(leader: CardData, card: CardData): boolean {
  return !leaderRuleBroken(leader, card);
}

export interface ValidateOptions {
  /** Formato da partida: sem ele, só as regras de construção são conferidas. */
  format?: PlayFormat;
  /** Data usada nas proibições com data marcada (padrão: agora). */
  now?: Date;
  /** Tamanho do deck (padrão: `DECK_SIZE`). */
  size?: number;
  /**
   * Máximo de cópias de cada carta (padrão: `MAX_COPIES`). Quando informado, vale para toda carta, inclusive
   * as que dizem "you may have any number of this card in your deck" (o limite é do formato, não da carta).
   */
  maxCopies?: number;
}

/**
 * Deck do Yonko (Four Emperors): 60 cartas, uma cópia de cada. A carta é o número dela ("the unique set code in
 * the corner"): duas cartas de mesmo nome e números diferentes cabem juntas; duas artes do mesmo número, não
 * (a lista do deck já junta as artes num número só). O resto é o de sempre: só cartas da cor do Líder.
 */
export function validateYonkoDeck(deck: DeckList, cards: Map<string, CardData> | Record<string, CardData>, options: ValidateOptions = {}): DeckReport {
  return validateDeck(deck, cards, { ...options, size: YONKO_DECK_SIZE, maxCopies: 1 });
}

/**
 * O deck que vai para a mesa do Yonko: um deck de 60 que fecha as regras do formato vai como está; um deck
 * comum completo (50) vira o deck de teste de `yonkoDeckFrom`. `test` diz qual dos dois. `null`: o deck não
 * serve (incompleto, ou sem cartas que cheguem para 60).
 */
export function yonkoTableDeck(deck: DeckList, cards: Iterable<CardData>, seed: number): { deck: DeckList; test: boolean } | null {
  const byId = new Map<string, CardData>();
  for (const c of cards) byId.set(c.id, c);
  if (validateYonkoDeck(deck, byId).valid) return { deck, test: false };
  if (!validateDeck(deck, byId).valid) return null;
  const made = yonkoDeckFrom(deck, byId.values(), seed);
  return made ? { deck: made, test: true } : null;
}

/**
 * Deck de Yonko montado a partir de um deck comum, para experimentar a mesa enquanto o construtor não monta os
 * de 60: o Líder do deck e uma cópia de cada carta dele, completado até 60 com cartas sorteadas de `cards` que
 * o Líder aceita (cor e regra do Líder), sem Líderes e sem cartas de efeito ainda não automatizado. O sorteio
 * sai da `seed`: mesma seed, mesmo deck. `null` quando não há cartas diferentes que cheguem para 60.
 */
export function yonkoDeckFrom(deck: Pick<DeckList, 'leader' | 'cards' | 'name' | 'id'> & { arts?: DeckList['arts'] }, cards: Iterable<CardData>, seed: number): DeckList | null {
  const byId = new Map<string, CardData>();
  for (const c of cards) byId.set(c.id, c);
  const leader = byId.get(deck.leader);
  if (!leader || leader.category !== 'leader') return null;
  const fits = (c: CardData | undefined): c is CardData => Boolean(c && c.category !== 'leader' && isColorCompatible(leader, c) && leaderAllows(leader, c));
  const picked: string[] = [];
  for (const entry of deck.cards) {
    if (picked.length < YONKO_DECK_SIZE && !picked.includes(entry.id) && fits(byId.get(entry.id))) picked.push(entry.id);
  }
  const pool = [...byId.values()]
    .filter((c) => fits(c) && !picked.includes(c.id) && !needsManual(c))
    .map((c) => c.id)
    .sort();
  if (picked.length + pool.length < YONKO_DECK_SIZE) return null;
  const rng = { rng: seed | 0 };
  while (picked.length < YONKO_DECK_SIZE) picked.push(pool.splice(Math.floor(nextRandom(rng) * pool.length), 1)[0]);
  return {
    id: deck.id,
    name: deck.name,
    leader: deck.leader,
    cards: picked.map((id) => ({ id, count: 1 })),
    ...(deck.arts ? { arts: deck.arts } : {}),
  };
}

export function validateDeck(
  deck: DeckList,
  cards: Map<string, CardData> | Record<string, CardData>,
  options: ValidateOptions = {},
): DeckReport {
  const get = (id: string) => (cards instanceof Map ? cards.get(id) : cards[id]);
  const issues: DeckIssue[] = [];
  const unscripted = new Set<string>();
  const total = deckSize(deck);

  const leader = deck.leader ? get(deck.leader) : undefined;
  /** Erro de construção: texto em português, chave `rules.<code>` e parâmetros. */
  const error = (message: string, code: string, params: RuleParams = {}, cardId?: string) =>
    issues.push({ level: 'error', message, code: `rules.${code}`, params, ...(cardId ? { cardId } : {}) });

  if (!deck.leader) error('Escolha um Líder.', 'pickLeader');
  else if (!leader) error(`Líder desconhecido: ${deck.leader}.`, 'unknownLeader', { id: deck.leader }, deck.leader);
  else if (leader.category !== 'leader') {
    error(`${leader.name} não é um Líder.`, 'notLeader', { name: leader.name }, leader.id);
  } else if (needsManual(leader)) unscripted.add(leader.id);

  const size = options.size ?? DECK_SIZE;
  if (total < size) {
    error(`O deck tem ${total} cartas; faltam ${size - total}.`, 'tooFewCards', { total, missing: size - total });
  } else if (total > size) {
    error(`O deck tem ${total} cartas; sobram ${total - size}.`, 'tooManyCards', { total, extra: total - size });
  }

  const counts = new Map<string, number>();
  for (const entry of deck.cards) counts.set(entry.id, (counts.get(entry.id) ?? 0) + entry.count);

  for (const [id, count] of counts) {
    const card = get(id);
    if (!card) {
      error(`Carta desconhecida: ${id}.`, 'unknownCard', { id }, id);
      continue;
    }
    const name = card.name;
    if (count < 1) error(`Quantidade inválida de ${name}.`, 'badCount', { name }, id);
    if (card.category === 'leader') error(`${name} é um Líder e não pode ir no deck.`, 'leaderInDeck', { name }, id);
    if (options.maxCopies !== undefined ? count > options.maxCopies : count > MAX_COPIES && !anyNumberAllowed(card)) {
      const n = options.maxCopies ?? MAX_COPIES;
      error(`${name} (${id}): máximo de ${n} ${n === 1 ? 'cópia' : 'cópias'}.`, 'maxCopies', { name, id, n }, id);
    }
    const broken = leader?.category === 'leader' ? leaderRuleBroken(leader, card) : undefined;
    if (broken?.kind === 'deckMaxCost') {
      const events = broken.category === 'event';
      error(
        `${name} (${id}): o Líder não permite ${events ? 'Eventos' : 'cartas'} com custo ${broken.cost + 1} ou mais.`,
        events ? 'leaderMaxCostEvents' : 'leaderMaxCost',
        { name, id, cost: broken.cost + 1 },
        id,
      );
    } else if (broken?.kind === 'deckOnlyType') {
      error(`${name} (${id}): o Líder só permite cartas do tipo {${broken.type}}.`, 'leaderOnlyType', { name, id, type: broken.type }, id);
    }
    if (leader?.category === 'leader' && !isColorCompatible(leader, card)) {
      error(`${name} (${id}) não tem a cor do Líder.`, 'leaderColor', { name, id }, id);
    }
    if (needsManual(card)) unscripted.add(id);
  }

  if (options.format) {
    for (const i of formatIssues(deck, options.format, options.now, cards)) issues.push({ level: 'error', ...i });
  }

  if (unscripted.size) {
    issues.push({
      level: 'warning',
      message: `${unscripted.size} carta(s) com efeito ainda não automatizado (aplicado à mão, com as ferramentas manuais).`,
      code: 'rules.unscripted',
      params: { n: unscripted.size },
    });
  }

  return { valid: !issues.some((i) => i.level === 'error'), total, issues, unscripted: [...unscripted] };
}

/**
 * Lê uma lista em texto, no formato usado pela comunidade (o Líder é reconhecido
 * quando `cards` é informado):
 *   1xST01-001      (o Líder também pode vir na lista)
 *   4xST01-002
 *   4 ST01-013
 *   4 OP14-013_v1 Monkey.D.Luffy   (sufixo de versão/arte ignorado; o nome depois do número também)
 * Linhas vazias e comentários (#, //) são ignorados.
 * `errors` traz os problemas em português; `errorDetails`, na mesma ordem, as chaves de tradução.
 */
export function parseDeckList(
  text: string,
  cards?: Map<string, CardData>,
): { leader?: string; cards: Array<{ id: string; count: number }>; errors: string[]; errorDetails: DeckListError[] } {
  const errorDetails: DeckListError[] = [];
  const fail = (message: string, code: string, params: RuleParams) => errorDetails.push({ message, code: `rules.${code}`, params });
  const out = new Map<string, number>();
  let leader: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(#|\/\/).*$/, '').trim();
    if (!line) continue;
    const m =
      line.match(/^(\d+)\s*[xX×]?\s*([A-Za-z]+\d*-\d+)(?:_[A-Za-z]+\d*)?\b/) ??
      line.match(/^([A-Za-z]+\d*-\d+)(?:_[A-Za-z]+\d*)?\s*[xX×]?\s*(\d+)?$/);
    if (!m) {
      fail(`Linha não reconhecida: "${rawLine.trim()}"`, 'listBadLine', { line: rawLine.trim() });
      continue;
    }
    const [count, id] = /^\d+$/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2] ?? 1), m[1]];
    const cardId = id.toUpperCase();
    const card = cards?.get(cardId);
    if (cards && !card) {
      fail(`Carta não encontrada no banco: ${cardId}`, 'listUnknownCard', { id: cardId });
      continue;
    }
    if (card?.category === 'leader') {
      if (leader && leader !== cardId) fail(`Mais de um Líder na lista: ${leader} e ${cardId}`, 'listTwoLeaders', { a: leader, b: cardId });
      leader = cardId;
      continue;
    }
    out.set(cardId, (out.get(cardId) ?? 0) + count);
  }
  return { leader, cards: [...out].map(([id, count]) => ({ id, count })), errors: errorDetails.map((e) => e.message), errorDetails };
}

export function formatDeckList(deck: Pick<DeckList, 'leader' | 'cards'>): string {
  const lines = deck.leader ? [`1x${deck.leader}`] : [];
  for (const c of deck.cards) lines.push(`${c.count}x${c.id}`);
  return lines.join('\n');
}

/**
 * A lista do deck de um jogador refeita a partir das cartas da partida (Líder fora, as demais
 * por número, em ordem). Serve para ver a lista do oponente no fim: a visão de cada jogador só
 * traz todas as cartas com a partida encerrada. Antes disso (ou num estado incompleto) alguma
 * carta do jogador ainda está escondida e a resposta é null.
 */
export function deckOfPlayer(state: Pick<GameState, 'cards' | 'players'>, player: PlayerId): Pick<DeckList, 'leader' | 'cards'> | null {
  const ps = state.players[player];
  const leaderUid = ps.leader.uid;
  const counts = new Map<string, number>();
  let leader: string | null = null;
  for (const c of Object.values(state.cards)) {
    if (c.uid === HIDDEN_REF || c.owner !== player) continue;
    if (c.cardId === HIDDEN_CARD) return null;
    if (c.uid === leaderUid) leader = c.cardId;
    else counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
  }
  if (!leader) return null;
  return { leader, cards: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({ id, count })) };
}
