import type { CardData, CardDef } from '../types';
import { parseCard } from './parser';
import { CARD_SCRIPTS } from './scripts';
import { detectKeywords, KEYWORD_ONLY, splitEffects } from './split';

export function buildCardDef(data: CardData): CardDef {
  const script = CARD_SCRIPTS[data.id];
  if (script) {
    return {
      ...data,
      keywords: script.keywords ?? detectKeywords(data.text ?? ''),
      abilities: script.abilities,
      scripted: true,
      manual: script.abilities.some((a) => a.manual),
    };
  }
  // Sem script: o leitor automático; o que ele não reconhecer fica manual.
  const parsed = parseCard(data);
  return {
    ...data,
    keywords: parsed.keywords,
    abilities: parsed.abilities,
    scripted: parsed.unparsed.length === 0 && parsed.abilities.length > 0,
    manual: parsed.unparsed.length > 0,
  };
}

export function hasScript(cardId: string): boolean {
  return cardId in CARD_SCRIPTS;
}

export type AutomationStatus = 'vanilla' | 'scripted' | 'auto' | 'partial' | 'manual';

/**
 * Situação de automação de uma carta (para relatórios de cobertura):
 * scripted = script escrito à mão; auto = lida por completo pelo leitor automático;
 * partial = parte dos efeitos automática, parte manual; manual = nada reconhecido.
 */
export function automationStatus(card: CardData): AutomationStatus {
  const key = `${card.id}\u0000${card.text}\u0000${card.trigger ?? ''}`;
  let status = statusCache.get(key);
  if (!status) {
    status = computeStatus(card);
    if (statusCache.size > 20000) statusCache.clear();
    statusCache.set(key, status);
  }
  return status;
}

/** A carta tem algum efeito que o jogador precisa aplicar à mão? */
export function needsManual(card: CardData): boolean {
  const st = automationStatus(card);
  return st === 'partial' || st === 'manual';
}

const statusCache = new Map<string, AutomationStatus>();

function computeStatus(card: CardData): AutomationStatus {
  if (hasScript(card.id)) return 'scripted';
  const meaningful = splitEffects(card.text ?? '').some((l) => !KEYWORD_ONLY.test(l)) || Boolean(card.trigger?.trim());
  if (!meaningful) return 'vanilla';
  const parsed = parseCard(card);
  const lines = parsed.abilities.length;
  if (!parsed.unparsed.length) return 'auto';
  return parsed.unparsed.length < lines ? 'partial' : 'manual';
}

export { CARD_SCRIPTS };
export { detectKeywords, manualAbilities, splitEffects } from './split';
export { parseBody, parseCard, parseCardFilter, parseCondition, parseTarget, type ParsedCard } from './parser';
