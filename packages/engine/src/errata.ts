// Erratas oficiais da Bandai aplicadas ao texto das cartas.
//
// A errata vale para todos os formatos e vence o texto impresso. A base de cartas vem da
// optcgapi.com (e dos JSON de data/cards), que nem sempre traz o texto corrigido; esta tabela
// corrige o que falta. Cada correção troca um trecho exato (ou um tipo): se o trecho não está
// no texto (a fonte já veio corrigida, ou mudou de redação), nada acontece. Aplicar duas
// vezes dá o mesmo resultado.
//
// Fontes: https://en.onepiece-cardgame.com/rules/errata_card/ e os avisos em News/Topics
// (links em cada entrada). Rotina de atualização: docs/rules/manutencao.md.
//
// Erratas que a fonte já traz corrigidas (conferido em 07/10/2026) e por isso não estão aqui:
// OP01-051, OP01-112, OP03-047, OP03-054, OP07-097, OP09-058, OP15-023, o "up to" em massa de
// OP-01 e ST-01 a ST-04, e OP13-119 (a errata só vale para a impressão "Wanted Poster").

import type { CardData } from './types';

export interface Errata {
  id: string;
  /** Data do aviso oficial (AAAA-MM-DD). */
  date: string;
  source: string;
  /** Trocas de trecho no texto principal: [antes, depois]. */
  text?: Array<[string, string]>;
  /** Trocas de trecho no texto do [Trigger]. */
  trigger?: Array<[string, string]>;
  /** Tipos: [antes, depois]; depois vazio = remove o tipo. */
  types?: Array<[string, string]>;
}

const ERRATA_PAGE = 'https://en.onepiece-cardgame.com/rules/errata_card/';

export const ERRATA: readonly Errata[] = [
  {
    id: 'OP01-002', // Trafalgar Law (Líder)
    date: '2023-02-17',
    source: ERRATA_PAGE,
    text: [['return 1 of your Characters to your hand', "return 1 of your Characters to the owner's hand"]],
  },
  {
    id: 'OP01-003', // Monkey.D.Luffy (Líder): o tipo é {Supernovas}
    date: '2023-02-17',
    source: ERRATA_PAGE,
    text: [['{Supernova} or', '{Supernovas} or']],
  },
  {
    id: 'OP01-016', // Nami: qualquer carta {Straw Hat Crew}, não só Personagem
    date: '2023-02-17',
    source: ERRATA_PAGE,
    text: [['{Straw Hat Crew} type Character card other than [Nami]', '{Straw Hat Crew} type card other than [Nami]']],
  },
  {
    id: 'OP02-002', // Monkey.D.Garp (Líder)
    date: '2023-03-03',
    source: ERRATA_PAGE,
    text: [['When this Leader or 1 of your Characters is given', 'When this Leader or any of your Characters is given']],
  },
  {
    id: 'OP02-071', // Magellan (Líder)
    date: '2023-04-21',
    source: ERRATA_PAGE,
    text: [['When a DON!! card on your field is returned', 'When a DON!! card on the field is returned']],
  },
  {
    id: 'OP05-032', // Pica: a substituição exige virar 1 Personagem (não "up to")
    date: '2023-12-08',
    source: ERRATA_PAGE,
    text: [['you may rest up to 1 of your Characters with a cost of 3 or more', 'you may rest 1 of your Characters with a cost of 3 or more']],
  },
  {
    id: 'OP06-034', // Hyouzou
    date: '2024-12-06',
    source: ERRATA_PAGE,
    types: [['Fish-Man', 'Merfolk']],
  },
  {
    id: 'OP13-077', // Go All the Way to the Top!!
    date: '2025-10-24',
    source: 'https://en.onepiece-cardgame.com/topics/notice_op13.php',
    text: [['gains +3000 power during this turn', 'gains +3000 power during this battle']],
  },
  {
    id: 'OP14-009', // Trafalgar Law
    date: '2025-12-19',
    source: 'https://en.onepiece-cardgame.com/topics/notice-op14-009.php',
    types: [['The Seven Warlords of the Sea', '']],
  },
  {
    id: 'OP16-081', // Otama ("−2000": a fonte perdeu o sinal)
    date: '2026-05-29',
    source: 'https://en.onepiece-cardgame.com/news/notice-op16.html',
    text: [
      ['If you have a Character with a cost of 8 or more', 'If there is a Character with a cost of 8 or more'],
      ["opponent's Characters 2000 power", "opponent's Characters -2000 power"],
    ],
  },
  {
    id: 'ST02-013', // Eustass"Captain"Kid
    date: '2023-03-31',
    source: ERRATA_PAGE,
    text: [['Set this card as active', 'Set this Character as active']],
  },
  {
    id: 'ST04-001', // Kaido (Líder)
    date: '2022-09-26',
    source: 'https://en.onepiece-cardgame.com/rules/announcements/st01-04.php',
    text: [["Trash up to 1 of your opponent's Life cards", "Trash up to 1 of your opponent's cards from the top of their Life cards"]],
  },
  {
    id: 'ST14-014', // Gum-Gum Giant Rifle
    date: '2024-08-16',
    source: ERRATA_PAGE,
    text: [['If you have a Character with a cost of 8 or more', 'If there is a Character with a cost of 8 or more']],
  },
];

const BY_ID = new Map(ERRATA.map((e) => [e.id, e]));

export function errataFor(id: string): Errata | undefined {
  return BY_ID.get(id);
}

function patch(text: string, swaps: Array<[string, string]> | undefined): string {
  let out = text;
  for (const [from, to] of swaps ?? []) if (out.includes(from) && !out.includes(to)) out = out.split(from).join(to);
  return out;
}

/** A carta com a errata oficial aplicada (o mesmo objeto, se não houver nada a corrigir). */
export function applyErrata<T extends CardData>(card: T): T {
  const e = BY_ID.get(card.id);
  if (!e) return card;
  const text = patch(card.text ?? '', e.text);
  const trigger = card.trigger === undefined ? undefined : patch(card.trigger, e.trigger);
  const types = e.types
    ? [...new Set((card.types ?? []).flatMap((t) => {
        const swap = e.types!.find(([from]) => from === t);
        return swap ? (swap[1] ? [swap[1]] : []) : [t];
      }))]
    : card.types;
  const sameTypes = types.length === card.types.length && types.every((t, i) => t === card.types[i]);
  if (text === (card.text ?? '') && trigger === card.trigger && sameTypes) return card;
  return { ...card, text, ...(trigger !== undefined ? { trigger } : {}), types: sameTypes ? card.types : types };
}
