// Prepara as cartas para enviar ao navegador: anexa traduções e aplica a
// configuração de imagens.

import { type CardData, translateCardPt } from '@gumgum/engine';
import type { TranslationRow } from './db';
import type { ServerOptions } from './config';

export type ApiCard = CardData & { provisional?: boolean };

/** Traduções automáticas já calculadas (o texto da carta não muda entre pedidos). */
const cache = new Map<string, NonNullable<NonNullable<CardData['i18n']>['pt']>>();

export function ptTranslation(card: CardData, manual?: TranslationRow): NonNullable<CardData['i18n']>['pt'] {
  if (manual) return { text: manual.text, trigger: manual.trigger ?? undefined, source: 'manual' };
  // Linhas que o motor automatiza são descritas a partir dos passos; as demais, por regras de frase.
  const key = `${card.id}\u0000${card.text}\u0000${card.trigger ?? ''}`;
  let pt = cache.get(key);
  if (!pt) {
    const t = translateCardPt(card);
    pt = { text: t.text, trigger: t.trigger, source: t.complete ? 'auto' : 'partial' };
    if (cache.size > 20000) cache.clear();
    cache.set(key, pt);
  }
  return pt;
}

export function presentCards(cards: ApiCard[], manual: Map<string, TranslationRow>, opts: ServerOptions): ApiCard[] {
  return cards.map((c) => {
    const out: ApiCard = { ...c, i18n: { ...c.i18n, pt: ptTranslation(c, manual.get(c.id)) } };
    if (!opts.cardImages) delete out.imageUrl;
    return out;
  });
}
