import { fixCard } from '../errata';
import type { CardData, CardDef } from '../types';
import { type LineDiagnosis, lineDiagnosis } from './diagnose';
import { diagnoseLine, diagnoseTrigger, effectLines, parseCard } from './parser';
import { CARD_SCRIPTS } from './scripts';
import { detectKeywords, KEYWORD_ONLY, splitEffects } from './split';

export function buildCardDef(card: CardData): CardDef {
  // Nome e tipos oficiais e a errata oficial valem sobre o que a base de cartas trouxer.
  const data = fixCard(card);
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

export interface CardDiagnosis {
  status: AutomationStatus;
  /** As linhas de efeito e o [Trigger], na ordem da carta (vazio para script e sem efeito). */
  lines: LineDiagnosis[];
}

/**
 * Linha por linha, o que o leitor automático entendeu e onde parou (ferramentas de Dev).
 * Usa as mesmas linhas de `parseCard`: uma linha recusada aqui é uma habilidade manual na partida.
 */
export function diagnoseCard(card: CardData): CardDiagnosis {
  const status = automationStatus(card);
  if (status === 'scripted' || status === 'vanilla') return { status, lines: [] };
  const lines: LineDiagnosis[] = [];
  for (const line of effectLines(card.text ?? '')) {
    if (!KEYWORD_ONLY.test(line)) lines.push(lineDiagnosis(line, diagnoseLine(line, card.category)));
  }
  const trigger = card.trigger?.trim();
  if (trigger) lines.push(lineDiagnosis(`[Trigger] ${trigger}`, diagnoseTrigger(trigger)));
  return { status, lines };
}

export { CARD_SCRIPTS };
export { gapPattern, type GapStage, type LineDiagnosis } from './diagnose';
export { detectKeywords, manualAbilities, splitEffects } from './split';
export { diagnoseLine, parseBody, parseCard, parseCardFilter, parseCondition, parseTarget, type ParsedCard } from './parser';
