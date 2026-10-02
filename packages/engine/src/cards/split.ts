// Divisão do texto das cartas em efeitos e habilidades manuais (sem script).

import type { Ability, AbilityTiming, CardData, Keyword } from '../types';

const KEYWORD_PATTERNS: Array<[Keyword, RegExp]> = [
  ['rush', /\[Rush\]/i],
  ['blocker', /\[Blocker\]/i],
  ['doubleAttack', /\[Double Attack\]/i],
  ['banish', /\[Banish\]/i],
  ['rushCharacter', /\[Rush: ?Character\]/i],
  ['unblockable', /\[Unblockable\]/i],
];

/** Marcações que podem iniciar um efeito novo. */
const EFFECT_START =
  /(?<=^|[.)]\s*|\n)\s*(?=\[(?:DON!! ?[x×]\d+|On Play|When Attacking|Activate: ?Main|Main|Counter|On K\.O\.|On Block|End of Your Turn|Your Turn|Opponent's Turn|Once Per Turn|Rush|Rush: ?Character|Blocker|Double Attack|Banish|Unblockable|On Your Opponent's Attack)\])/;

/**
 * Separa o texto em efeitos. A API não usa quebras de linha
 * ("[Rush] (…) [DON!! x2] [When Attacking] …"): um efeito novo começa numa marcação
 * logo após o fim de uma frase. Marcações no meio da frase ("cannot activate
 * [Blocker]", "this card's [Main] effect") não quebram.
 */
export function splitEffects(text: string): string[] {
  return text
    .split(/\n|<br\s*\/?>/i)
    .flatMap((line) => line.split(new RegExp(EFFECT_START.source, 'gi')))
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Palavras-chave "incondicionais" detectadas no texto: só conta se a palavra-chave
 * aparece no início de uma linha (ex.: "[Blocker] (After your opponent declares...)").
 * Palavras-chave condicionais ("[DON!! x2] This Character gains [Rush]") exigem script.
 */
export function detectKeywords(text: string): Keyword[] {
  const lines = splitEffects(text);
  const found: Keyword[] = [];
  for (const [kw, re] of KEYWORD_PATTERNS) {
    if (lines.some((l) => re.test(l) && l.search(re) === 0)) found.push(kw);
  }
  return found;
}

/** Marcações de momento → quando o motor pausa para o jogador aplicar o efeito. */
const TIMING_TAGS: Array<[RegExp, AbilityTiming]> = [
  [/\[Activate: ?Main\]/i, 'activateMain'],
  [/\[On Play\]/i, 'onPlay'],
  [/\[When Attacking\]/i, 'whenAttacking'],
  [/\[On K\.O\.\]/i, 'onKO'],
  [/\[On Block\]/i, 'onBlock'],
  [/\[End of Your Turn\]/i, 'endOfTurn'],
  [/\[Counter\]/i, 'counter'],
  [/\[Main\]/i, 'main'],
];

/** Só palavras-chave e lembretes, sem efeito a aplicar ("[Blocker] (After your...)"). */
export const KEYWORD_ONLY = /^(\[(Rush|Blocker|Double Attack|Banish|Rush: ?Character|Unblockable)\]\s*(\([^)]*\))?\s*)+$|^\([^()]*\)$/i;

/**
 * Habilidade manual para uma linha de efeito: no momento marcado ([On Play], [When Attacking]...),
 * o motor pausa e o jogador aplica o efeito com as ferramentas manuais. Linhas sem momento
 * (efeitos contínuos) viram 'static', só informativas.
 */
export function manualAbility(line: string, category: CardData['category']): Ability {
  const found = TIMING_TAGS.find(([re]) => re.test(line));
  // [Main] e [Counter] só valem como momento em eventos.
  let timing: AbilityTiming = found ? found[1] : 'static';
  if ((timing === 'main' || timing === 'counter') && category !== 'event') timing = 'static';
  const don = line.match(/\[DON!! x(\d+)\]/i);
  return {
    timing,
    manual: true,
    text: line,
    don: don ? Number(don[1]) : undefined,
    oncePerTurn: /\[Once Per Turn\]/i.test(line) || undefined,
    yourTurn: /\[Your Turn\]/i.test(line) || undefined,
    opponentsTurn: /\[Opponent's Turn\]/i.test(line) || undefined,
    label: timing === 'activateMain' ? 'Ativar efeito (manual)' : undefined,
    steps: timing === 'static' ? [] : [{ do: 'manual', text: line }],
  };
}

export function manualTrigger(trigger: string): Ability {
  return { timing: 'trigger', manual: true, text: trigger, steps: [{ do: 'manual', text: trigger }] };
}

/** Todas as habilidades da carta resolvidas manualmente. */
export function manualAbilities(card: Pick<CardData, 'category' | 'text' | 'trigger'>): Ability[] {
  const abilities = splitEffects(card.text ?? '')
    .filter((line) => !KEYWORD_ONLY.test(line))
    .map((line) => manualAbility(line, card.category));
  if (card.trigger?.trim()) abilities.push(manualTrigger(card.trigger));
  return abilities;
}
