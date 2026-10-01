import type { Ability, AbilityTiming, CardData, CardDef, Keyword } from '../types';
import { CARD_SCRIPTS } from './scripts';

const KEYWORD_PATTERNS: Array<[Keyword, RegExp]> = [
  ['rush', /\[Rush\]/i],
  ['blocker', /\[Blocker\]/i],
  ['doubleAttack', /\[Double Attack\]/i],
  ['banish', /\[Banish\]/i],
];

/** Marcações que podem iniciar um efeito novo. */
const EFFECT_START =
  /(?<=^|[.)]\s*|\n)\s*(?=\[(?:DON!! x\d+|On Play|When Attacking|Activate: ?Main|Main|Counter|On K\.O\.|On Block|End of Your Turn|Your Turn|Opponent's Turn|Once Per Turn|Rush|Blocker|Double Attack|Banish|On Your Opponent's Attack)\])/;

/**
 * Separa o texto em efeitos. A API não usa quebras de linha
 * ("[Rush] (…) [DON!! x2] [When Attacking] …"): um efeito novo começa numa marcação
 * logo após o fim de uma frase. Marcações no meio da frase ("cannot activate
 * [Blocker]", "this card's [Main] effect") não quebram.
 */
export function splitEffects(text: string): string[] {
  return text
    .split(/\n|<br\s*\/?>/i)
    .flatMap((line) => line.split(new RegExp(EFFECT_START.source, 'g')))
    .map((l) => l.trim())
    .filter(Boolean);
}

const splitLines = splitEffects;

/**
 * Palavras-chave "incondicionais" detectadas no texto: só conta se a palavra-chave
 * aparece no início de uma linha (ex.: "[Blocker] (After your opponent declares...)").
 * Palavras-chave condicionais ("[DON!! x2] This Character gains [Rush]") exigem script.
 */
export function detectKeywords(text: string): Keyword[] {
  const lines = splitLines(text);
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
const KEYWORD_ONLY = /^(\[(Rush|Blocker|Double Attack|Banish)\]\s*(\([^)]*\))?\s*)+$/i;

/**
 * Habilidades manuais derivadas do texto de uma carta sem script: em cada momento
 * marcado no texto ([On Play], [When Attacking]...), o motor pausa e o jogador
 * aplica o efeito com as ferramentas manuais. Linhas sem momento (efeitos contínuos
 * como "[DON!! x1] This Character gains +1000 power") viram 'static', só informativas.
 */
export function manualAbilities(card: Pick<CardData, 'category' | 'text' | 'trigger'>): Ability[] {
  const abilities: Ability[] = [];
  for (const line of splitLines(card.text ?? '')) {
    if (KEYWORD_ONLY.test(line)) continue;
    const found = TIMING_TAGS.find(([re]) => re.test(line));
    // [Main] e [Counter] só valem como momento em eventos.
    let timing: AbilityTiming = found ? found[1] : 'static';
    if ((timing === 'main' || timing === 'counter') && card.category !== 'event') timing = 'static';
    const don = line.match(/\[DON!! x(\d+)\]/i);
    abilities.push({
      timing,
      manual: true,
      text: line,
      don: don ? Number(don[1]) : undefined,
      oncePerTurn: /\[Once Per Turn\]/i.test(line) || undefined,
      yourTurn: /\[Your Turn\]/i.test(line) || undefined,
      opponentsTurn: /\[Opponent's Turn\]/i.test(line) || undefined,
      label: timing === 'activateMain' ? 'Ativar efeito (manual)' : undefined,
      steps: timing === 'static' ? [] : [{ do: 'manual', text: line }],
    });
  }
  if (card.trigger?.trim()) {
    abilities.push({ timing: 'trigger', manual: true, text: card.trigger, steps: [{ do: 'manual', text: card.trigger }] });
  }
  return abilities;
}

export function buildCardDef(data: CardData): CardDef {
  const script = CARD_SCRIPTS[data.id];
  const abilities = script?.abilities ?? manualAbilities(data);
  return {
    ...data,
    keywords: script?.keywords ?? detectKeywords(data.text ?? ''),
    abilities,
    scripted: Boolean(script),
    manual: abilities.some((a) => a.manual),
  };
}

export function hasScript(cardId: string): boolean {
  return cardId in CARD_SCRIPTS;
}

/** Situação de automação de uma carta (para relatórios de cobertura). */
export function automationStatus(card: CardData): 'vanilla' | 'scripted' | 'manual' {
  if (hasScript(card.id)) return 'scripted';
  const meaningful = splitLines(card.text ?? '').some((l) => !KEYWORD_ONLY.test(l)) || Boolean(card.trigger?.trim());
  return meaningful ? 'manual' : 'vanilla';
}

export { CARD_SCRIPTS };
