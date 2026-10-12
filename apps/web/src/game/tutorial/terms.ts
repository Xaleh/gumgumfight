// Termos do texto das cartas que viram link para o glossário do tutorial. Reconhece as
// palavras-chave em inglês, como impressas, e as da tradução para o português.

/** Pedaço do texto: texto comum ou um termo do glossário (`term` = id em GLOSSARY). */
export type TermPart = { text: string; term?: string };

const TERMS: Array<[RegExp, string]> = [
  [/^\[(on play|ao jogar)\]$/i, 'onPlay'],
  [/^\[(when attacking|ao atacar)\]$/i, 'whenAttacking'],
  [/^\[(activate: ?main|ativar: ?principal)\]$/i, 'activateMain'],
  [/^\[(once per turn|uma vez por turno)\]$/i, 'oncePerTurn'],
  [/^\[blocker\]$/i, 'blocker'],
  [/^\[rush\]$/i, 'rush'],
  [/^\[double attack\]$/i, 'doubleAttack'],
  [/^\[banish\]$/i, 'banish'],
  [/^\[counter\]$/i, 'counter'],
  [/^\[trigger\]$/i, 'trigger'],
  [/^\[don!! ?[x×] ?\d+\]$/i, 'donX'],
  [/^don!! ?[−-] ?\d+$/i, 'donMinus'],
];

/** O id do glossário de um pedaço como "[Blocker]" ou "DON!! −4", ou null. */
export function termOf(token: string): string | null {
  const s = token.trim();
  for (const [re, id] of TERMS) if (re.test(s)) return id;
  return null;
}

/** Divide o texto da carta em pedaços, marcando os termos que o glossário explica. */
export function splitTerms(text: string): TermPart[] {
  return text
    .split(/(\[[^\]\n]{1,40}\]|DON!! ?[−-] ?\d+)/)
    .filter((p) => p !== '')
    .map((p) => {
      const term = termOf(p);
      return term ? { text: p, term } : { text: p };
    });
}
