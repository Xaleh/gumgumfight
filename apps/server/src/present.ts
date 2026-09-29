// Prepara as cartas para enviar ao navegador: anexa traduções e aplica a
// configuração de imagens.

import { type CardData, translateToPt } from '@gumgum/engine';
import type { TranslationRow } from './db';
import type { ServerOptions } from './config';

export type ApiCard = CardData & { provisional?: boolean };

export function ptTranslation(card: CardData, manual?: TranslationRow): NonNullable<CardData['i18n']>['pt'] {
  if (manual) return { text: manual.text, trigger: manual.trigger ?? undefined, source: 'manual' };
  const text = translateToPt(card.text ?? '');
  const trigger = card.trigger ? translateToPt(card.trigger) : null;
  return {
    text: text.text,
    trigger: trigger?.text,
    source: text.complete && (trigger?.complete ?? true) ? 'auto' : 'partial',
  };
}

export function presentCards(cards: ApiCard[], manual: Map<string, TranslationRow>, opts: ServerOptions): ApiCard[] {
  return cards.map((c) => {
    const out: ApiCard = { ...c, i18n: { ...c.i18n, pt: ptTranslation(c, manual.get(c.id)) } };
    if (!opts.cardImages) delete out.imageUrl;
    return out;
  });
}
