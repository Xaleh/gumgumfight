// optcgleaks.com como fonte de spoilers da cadeia: o mapeamento continua em ../spoiler-feed.ts.

import type { CardArt, CardData } from '@gumgum/engine';
import type { FetchJson } from '../card-import';
import { fetchOptcgLeaksSet, OPTCGLEAKS, optcgLeaksPageUrl } from '../spoiler-feed';
import type { CardSource } from './chain';

export function optcgleaksSource(fetchJson: FetchJson): CardSource {
  return {
    id: 'optcgleaks',
    host: OPTCGLEAKS,
    pageUrl: optcgLeaksPageUrl,
    async fetch({ sets }) {
      // O site só tem um arquivo por coleção (sem coleções, nada a buscar) e não tem promocionais
      // (o endereço de uma coleção que não existe responde 403, não 404).
      const cards: CardData[] = [];
      const extraArts = new Map<string, CardArt[]>();
      for (const set of (sets ?? []).filter((s) => !/^P-?$/i.test(s))) {
        const got = await fetchOptcgLeaksSet(set, fetchJson);
        cards.push(...got.cards);
        for (const [id, arts] of got.extraArts) extraArts.set(id, [...(extraArts.get(id) ?? []), ...arts]);
      }
      return { cards, extraArts };
    },
  };
}
