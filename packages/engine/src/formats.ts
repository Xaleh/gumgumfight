// Formatos oficiais e legalidade das cartas.
//
//  - Extra Grand Battle (Extra Regulation): vale toda carta lançada, menos as banidas.
//  - Standard: além das banidas, só vale o que não rotacionou. As cartas com o ícone
//    de bloco ① (a "fruta" com o número 1: OP-01 a OP-04 e ST-01 a ST-09) saíram do
//    Standard em 1º/04/2026, exceto as da lista de "Block Number Updates" da Bandai
//    (Super Parallel/Manga com bloco X e cartas tratadas como bloco ④).
//
// Desde 1º/04/2026 a lista de banidas e de pares proibidos é a mesma nos dois formatos.
// Fontes: en.onepiece-cardgame.com/news/restriction-261001.html e
// en.onepiece-cardgame.com/news/blockicon-card.html. Para atualizar, é só mexer aqui.

import type { DeckList } from './types';

export type FormatId = 'standard' | 'egb';

export const FORMATS: ReadonlyArray<{ id: FormatId; label: string }> = [
  { id: 'standard', label: 'Standard' },
  { id: 'egb', label: 'Extra Grand Battle' },
];

export const isFormat = (v: unknown): v is FormatId => FORMATS.some((f) => f.id === v);
export const formatLabel = (f: FormatId): string => FORMATS.find((x) => x.id === f)?.label ?? f;

/** Cartas banidas em todos os formatos. `since` = data em que a proibição passa a valer. */
export const BANNED_CARDS: ReadonlyArray<{ id: string; name: string; since?: string }> = [
  { id: 'OP03-040', name: 'Nami' },
  { id: 'OP06-047', name: 'Charlotte Pudding' },
  { id: 'OP06-086', name: 'Gecko Moria' },
  { id: 'OP06-116', name: 'Reject' },
  { id: 'ST10-001', name: 'Trafalgar Law' },
  { id: 'OP14-020', name: 'Dracule Mihawk', since: '2026-10-12' },
];

/** Pares que não podem estar juntos no mesmo deck (Líder incluso), em todos os formatos. */
export const BANNED_PAIRS: ReadonlyArray<{ cards: [string, string]; since?: string }> = [
  { cards: ['OP11-040', 'OP11-067'] },
  { cards: ['OP11-040', 'OP08-069'] },
  { cards: ['OP07-115', 'EB04-058'] },
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
  // Tratadas como bloco ④: valem até 31/03/2029.
  'OP01-039', // Killer
  'OP01-055', // You Can Be My Samurai!!
  'OP03-072', // Gum-Gum Jet Gatling
  'OP03-097', // Six King Pistol
  'OP04-016', // Bad Manners Kick Course
  'OP04-077', // Ideo
  'OP04-096', // Corrida Coliseum
  'ST01-011', // Brook
  'ST02-007', // Jewelry Bonney
]);

/** Data de hoje (AAAA-MM-DD, UTC), para as proibições com data marcada. */
const today = (now: Date) => now.toISOString().slice(0, 10);
const inEffect = (since: string | undefined, now: Date) => !since || since <= today(now);

/** Número de bloco impresso na carta, quando dá para saber pelo número da coleção. */
export function cardBlock(id: string): number | null {
  return BLOCK_1_SET.test(id) ? 1 : null;
}

export type CardLegality = 'legal' | 'banned' | 'rotated';

export function cardLegality(id: string, format: FormatId, now = new Date()): CardLegality {
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

/** Motivos de o deck não valer no formato (vazio = permitido). Só olha os números das cartas. */
export function formatIssues(deck: Pick<DeckList, 'leader' | 'cards'>, format: FormatId, now = new Date()): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const ids = [...new Set([deck.leader, ...deck.cards.map((c) => c.id)].filter(Boolean))];
  const label = formatLabel(format);
  for (const id of ids) {
    const legality = cardLegality(id, format, now);
    if (legality === 'banned') {
      issues.push({ message: `${id} está banida (não vale em nenhum formato).`, code: 'rules.banned', params: { id }, cardId: id });
    } else if (legality === 'rotated') {
      issues.push({ message: `${id} tem o bloco ① e rotacionou: não vale no ${label}.`, code: 'rules.rotated', params: { id, format: label }, cardId: id });
    }
  }
  const has = new Set(ids);
  for (const { cards: [a, b], since } of BANNED_PAIRS) {
    if (has.has(a) && has.has(b) && inEffect(since, now)) {
      issues.push({ message: `${a} e ${b} não podem ser usadas juntas no mesmo deck.`, code: 'rules.bannedPair', params: { a, b }, cardId: b });
    }
  }
  return issues;
}

/** Formatos em que o deck pode ser usado. */
export function legalFormats(deck: Pick<DeckList, 'leader' | 'cards'>, now = new Date()): FormatId[] {
  return FORMATS.filter((f) => formatIssues(deck, f.id, now).length === 0).map((f) => f.id);
}
