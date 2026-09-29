import type { CardData, CardDef, Keyword } from '../types';
import { CARD_SCRIPTS } from './scripts';

const KEYWORD_PATTERNS: Array<[Keyword, RegExp]> = [
  ['rush', /\[Rush\]/i],
  ['blocker', /\[Blocker\]/i],
  ['doubleAttack', /\[Double Attack\]/i],
  ['banish', /\[Banish\]/i],
];

/**
 * Palavras-chave "incondicionais" detectadas no texto: só conta se a palavra-chave
 * aparece no início de uma linha (ex.: "[Blocker] (After your opponent declares...)").
 * Palavras-chave condicionais ("[DON!! x2] This Character gains [Rush]") exigem script.
 */
export function detectKeywords(text: string): Keyword[] {
  const lines = text.split(/\n|<br\s*\/?>/i).map((l) => l.trim());
  const found: Keyword[] = [];
  for (const [kw, re] of KEYWORD_PATTERNS) {
    if (lines.some((l) => re.test(l) && l.search(re) === 0)) found.push(kw);
  }
  return found;
}

export function buildCardDef(data: CardData): CardDef {
  const script = CARD_SCRIPTS[data.id];
  return {
    ...data,
    keywords: script?.keywords ?? detectKeywords(data.text ?? ''),
    abilities: script?.abilities ?? [],
    scripted: Boolean(script),
  };
}

export function hasScript(cardId: string): boolean {
  return cardId in CARD_SCRIPTS;
}

export { CARD_SCRIPTS };
