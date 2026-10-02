// Normalização dos textos das cartas (usada na importação e na tradução).

const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/**
 * Normaliza o texto para a forma das cartas impressas:
 *  - "Straw Hat Crew" type -> {Straw Hat Crew} type, inclusive em listas
 *    ("Supernovas" or "Navy" type -> {Supernovas} or {Navy} type);
 *  - custo de DON!! "(3) (You may rest…)" -> "③ (You may rest…)".
 */
export const normalizeTypeQuotes = (text: string) =>
  text
    .replace(/"([^"\n]+)"((?:\s*(?:,\s*(?:or|and)?|or|and)\s*(?:"[^"\n]+"|\{[^}\n]+\}))*\s+type)/g, (_m, first: string, rest: string) =>
      `{${first}}${rest.replace(/"([^"\n]+)"/g, '{$1}')}`,
    )
    .replace(/\((\d{1,2})\)(?=\s*\(You may rest the specified)/g, (m, n: string) => CIRCLED[Number(n)] ?? m)
    // Algumas cartas trazem o tipo entre colchetes: "[Supernovas] type" -> "{Supernovas} type".
    .replace(/\[([^\]\n]+)\]((?:\s*(?:,|or|and)\s*\[[^\]\n]+\])*\s+type)/g, (_m, first: string, rest: string) =>
      `{${first}}${rest.replace(/\[([^\]\n]+)\]/g, '{$1}')}`,
    )
    // "[Straw Hat Crew], [Kid Pirates], or {Heart Pirates} type": lista com vírgulas (um "[Nome] or {Tipo}" sozinho é nome + tipo).
    .replace(/\[([^\]\n]+)\]((?:,\s*\[[^\]\n]+\])+,\s*(?:or|and)\s*\{[^}\n]+\}\s+type)/g, (_m, first: string, rest: string) =>
      `{${first}}${rest.replace(/\[([^\]\n]+)\]/g, '{$1}')}`,
    );
