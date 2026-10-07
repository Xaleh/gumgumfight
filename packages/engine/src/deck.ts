// Regras de construção de deck e formato de lista em texto.
//
// Regras (One Piece Card Game):
//  - 1 Líder, fora do deck principal;
//  - deck principal com exatamente 50 cartas (sem Líderes);
//  - no máximo 4 cópias do mesmo número de carta;
//  - cada carta precisa ter ao menos uma cor em comum com o Líder;
//  - com um formato informado, cartas banidas, pares proibidos e (no Standard)
//    cartas rotacionadas também invalidam o deck (veja formats.ts).

import { buildCardDef, needsManual } from './cards';
import { DECK_SIZE, hasType } from './engine';
import { type FormatId, formatIssues } from './formats';
import type { CardData, DeckList, LeaderRule } from './types';

export const MAX_COPIES = 4;

/** "Under the rules of this game, you may have any number of this card in your deck." */
export function anyNumberAllowed(card: Pick<CardData, 'text'>): boolean {
  return /you may have any number of this card in your deck/i.test(card.text ?? '');
}

export interface DeckIssue {
  level: 'error' | 'warning';
  message: string;
  cardId?: string;
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
  format?: FormatId;
  /** Data usada nas proibições com data marcada (padrão: agora). */
  now?: Date;
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
  if (!deck.leader) issues.push({ level: 'error', message: 'Escolha um Líder.' });
  else if (!leader) issues.push({ level: 'error', message: `Líder desconhecido: ${deck.leader}.`, cardId: deck.leader });
  else if (leader.category !== 'leader') {
    issues.push({ level: 'error', message: `${leader.name} não é um Líder.`, cardId: leader.id });
  } else if (needsManual(leader)) unscripted.add(leader.id);

  if (total !== DECK_SIZE) {
    issues.push({
      level: 'error',
      message:
        total < DECK_SIZE
          ? `O deck tem ${total} cartas; faltam ${DECK_SIZE - total}.`
          : `O deck tem ${total} cartas; sobram ${total - DECK_SIZE}.`,
    });
  }

  const counts = new Map<string, number>();
  for (const entry of deck.cards) counts.set(entry.id, (counts.get(entry.id) ?? 0) + entry.count);

  for (const [id, count] of counts) {
    const card = get(id);
    if (!card) {
      issues.push({ level: 'error', message: `Carta desconhecida: ${id}.`, cardId: id });
      continue;
    }
    if (count < 1) issues.push({ level: 'error', message: `Quantidade inválida de ${card.name}.`, cardId: id });
    if (card.category === 'leader') {
      issues.push({ level: 'error', message: `${card.name} é um Líder e não pode ir no deck.`, cardId: id });
    }
    if (count > MAX_COPIES && !anyNumberAllowed(card)) {
      issues.push({ level: 'error', message: `${card.name} (${id}): máximo de ${MAX_COPIES} cópias.`, cardId: id });
    }
    const broken = leader?.category === 'leader' ? leaderRuleBroken(leader, card) : undefined;
    if (broken?.kind === 'deckMaxCost') {
      issues.push({
        level: 'error',
        message: `${card.name} (${id}): o Líder não permite ${broken.category === 'event' ? 'Eventos' : 'cartas'} com custo ${broken.cost + 1} ou mais.`,
        cardId: id,
      });
    } else if (broken?.kind === 'deckOnlyType') {
      issues.push({ level: 'error', message: `${card.name} (${id}): o Líder só permite cartas do tipo {${broken.type}}.`, cardId: id });
    }
    if (leader?.category === 'leader' && !isColorCompatible(leader, card)) {
      issues.push({ level: 'error', message: `${card.name} (${id}) não tem a cor do Líder.`, cardId: id });
    }
    if (needsManual(card)) unscripted.add(id);
  }

  if (options.format) {
    for (const i of formatIssues(deck, options.format, options.now)) issues.push({ level: 'error', ...i });
  }

  if (unscripted.size) {
    issues.push({
      level: 'warning',
      message: `${unscripted.size} carta(s) com efeito ainda não automatizado (aplicado à mão, com as ferramentas manuais).`,
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
 * Linhas vazias e comentários (#, //) são ignorados.
 */
export function parseDeckList(
  text: string,
  cards?: Map<string, CardData>,
): { leader?: string; cards: Array<{ id: string; count: number }>; errors: string[] } {
  const errors: string[] = [];
  const out = new Map<string, number>();
  let leader: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(#|\/\/).*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[xX×]?\s*([A-Za-z]+\d*-\d+)\b/) ?? line.match(/^([A-Za-z]+\d*-\d+)\s*[xX×]?\s*(\d+)?$/);
    if (!m) {
      errors.push(`Linha não reconhecida: "${rawLine.trim()}"`);
      continue;
    }
    const [count, id] = /^\d+$/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2] ?? 1), m[1]];
    const cardId = id.toUpperCase();
    const card = cards?.get(cardId);
    if (cards && !card) {
      errors.push(`Carta não encontrada no banco: ${cardId}`);
      continue;
    }
    if (card?.category === 'leader') {
      if (leader && leader !== cardId) errors.push(`Mais de um Líder na lista: ${leader} e ${cardId}`);
      leader = cardId;
      continue;
    }
    out.set(cardId, (out.get(cardId) ?? 0) + count);
  }
  return { leader, cards: [...out].map(([id, count]) => ({ id, count })), errors };
}

export function formatDeckList(deck: Pick<DeckList, 'leader' | 'cards'>): string {
  const lines = deck.leader ? [`1x${deck.leader}`] : [];
  for (const c of deck.cards) lines.push(`${c.count}x${c.id}`);
  return lines.join('\n');
}
