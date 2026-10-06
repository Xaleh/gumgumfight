// Texto de uma habilidade para a interface: o trecho da carta a que ela corresponde.
//
// As habilidades derivadas do texto trazem o trecho em `text`; as roteirizadas
// (scripts.ts) só têm o rótulo curto. Para essas, o trecho é procurado no texto da
// carta pelo marcador de momento ("[Activate: Main]" etc.), na ordem em que aparece.

import { type Ability, type CardDef, translateToPt } from '@gumgum/engine';
import type { CardLang } from '../settings';

const MARKERS: Partial<Record<Ability['timing'], RegExp>> = {
  activateMain: /^\[Activate: ?Main\]/i,
  onPlay: /^\[On Play\]/i,
  whenAttacking: /^\[When Attacking\]/i,
  onKO: /^\[On K\.O\.\]/i,
  trigger: /^\[Trigger\]/i,
};

const STARTERS = /\[(?:Activate: ?Main|On Play|When Attacking|On K\.O\.|Trigger|Blocker|Rush|Double Attack|Banish|Counter|Main|End of Your Turn|On Your Opponent's Attack|On Block)\]/gi;
/** Os mesmos marcadores na tradução para português (i18n/pt.ts). */
const STARTERS_PT = /\[(?:Ativar: ?Principal|Ao Jogar|Ao Atacar|Ao ser Nocauteado|Trigger|Blocker|Rush|Double Attack|Banish|Counter|Principal|Fim do Seu Turno|Ao Ataque do Oponente|Ao Bloquear)\]/gi;
const MARKERS_PT: Partial<Record<Ability['timing'], RegExp>> = {
  activateMain: /^\[Ativar: ?Principal\]/i,
  onPlay: /^\[Ao Jogar\]/i,
  whenAttacking: /^\[Ao Atacar\]/i,
  onKO: /^\[Ao ser Nocauteado\]/i,
  trigger: /^\[Trigger\]/i,
};

/**
 * Trechos do texto da carta, um por habilidade marcada ("[On Play] …", "[Activate: Main] …").
 * Só conta o marcador que começa uma frase: "[On Play] effects are negated" no meio de um
 * texto faz parte da habilidade anterior.
 */
export function textSegments(text: string, starters: RegExp = STARTERS): string[] {
  const cuts = [0];
  for (const m of text.matchAll(starters)) {
    const i = m.index ?? 0;
    const before = text.slice(0, i).trimEnd();
    // Corta só no começo de uma frase (depois de ponto, parêntese ou quebra de linha).
    if (i > 0 && before && !/[.)\n]$/.test(before)) continue;
    if (i > 0) cuts.push(i);
  }
  cuts.push(text.length);
  const out: string[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    for (const part of text.slice(cuts[k], cuts[k + 1]).split('\n')) if (part.trim()) out.push(part.trim());
  }
  return out;
}

/** Trecho em inglês da habilidade `index` da carta (ou o texto todo, se não der para separar). */
export function abilitySource(def: CardDef, index: number): string {
  const a = def.abilities[index];
  if (!a) return def.text;
  if (a.text?.trim()) return a.text.trim();
  const marker = MARKERS[a.timing];
  const segments = textSegments(def.text);
  if (marker) {
    // A n-ésima habilidade com esse momento corresponde ao n-ésimo trecho com esse marcador.
    const nth = def.abilities.slice(0, index).filter((x) => x.timing === a.timing).length;
    const matching = segments.filter((s) => marker.test(s));
    if (matching[nth]) return matching[nth];
    if (matching[0]) return matching[0];
  }
  return def.text;
}

/** Texto da habilidade no idioma escolhido, sem os marcadores do início (ficam no título e nos chips). */
export function abilityText(def: CardDef, index: number, lang: CardLang): string {
  const src = abilitySource(def, index);
  let out = src;
  if (lang === 'pt') {
    const pt = def.i18n?.pt?.text;
    const a = def.abilities[index];
    const marker = a && MARKERS_PT[a.timing];
    if (pt && src === def.text) out = pt;
    else if (pt && marker) {
      // O trecho correspondente na tradução da carta inteira (melhor que traduzir o pedaço solto).
      const nth = def.abilities.slice(0, index).filter((x) => x.timing === a.timing).length;
      const matching = textSegments(pt, STARTERS_PT).filter((seg) => marker.test(seg));
      out = matching[nth] ?? matching[0] ?? translateToPt(src).text;
    } else out = translateToPt(src).text;
  }
  return out.replace(/^(\s*\[[^\]]+\])+\s*/, '').trim() || out;
}

/** Título da habilidade: o rótulo curto ou o momento ("[Ativar: Principal]"). */
export function abilityTitle(a: Ability, lang: CardLang): string {
  if (a.label) return a.label;
  const en: Partial<Record<Ability['timing'], string>> = { activateMain: '[Activate: Main]', onPlay: '[On Play]', whenAttacking: '[When Attacking]', onKO: '[On K.O.]', trigger: '[Trigger]' };
  const pt: Partial<Record<Ability['timing'], string>> = { activateMain: '[Ativar: Principal]', onPlay: '[Ao Jogar]', whenAttacking: '[Ao Atacar]', onKO: '[Ao ser Nocauteado]', trigger: '[Trigger]' };
  return (lang === 'pt' ? pt : en)[a.timing] ?? 'Ativar efeito';
}

/** Custo da habilidade em poucas palavras ("②", "DON!! −1", "Virar", "Descartar 1"). */
export function abilityCostLabel(a: Ability): string[] {
  const c = a.cost;
  const out: string[] = [];
  if (a.don) out.push(`DON!! ×${a.don}`);
  if (!c) return out;
  if (c.restDon) out.push('①②③④⑤⑥⑦⑧⑨⑩'[c.restDon - 1] ?? `${c.restDon} DON!!`);
  if (c.donMinus) out.push(`DON!! −${c.donMinus}`);
  if (c.restSelf) out.push('Virar');
  if (c.koSelf) out.push('K.O. esta carta');
  if (c.trashFromHand) out.push(`Descartar ${c.trashFromHand}`);
  if (c.handToBottom) out.push(`${c.handToBottom} ao fundo do deck`);
  if (c.lifeToHand) out.push(`${c.lifeToHand} Vida → mão`);
  if (c.leaderPowerMinus) out.push(`Líder −${c.leaderPowerMinus}`);
  if (c.returnGivenDon) out.push(`Devolver ${c.returnGivenDon} DON!!`);
  if (c.restCharacters) out.push(`Virar ${c.restCharacters} Personagem(ns)`);
  return out;
}
