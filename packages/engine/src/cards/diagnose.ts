// Diagnóstico do leitor automático para as ferramentas de Dev (tela de Cobertura): em cada linha
// que o leitor não entendeu, a parte do leitor que recusou, o trecho onde ele parou e um padrão
// para juntar linhas parecidas de cartas diferentes (ensinar uma frase ao leitor resolve todas).

/** Parte do leitor que recusou a linha. */
export type GapStage =
  | 'clause' // uma oração do efeito ("K.O. up to 1 …")
  | 'condition' // "If …", "This effect can be activated when …"
  | 'search' // "Look at N cards …; reveal …" e o resto da busca
  | 'cost' // o custo antes dos dois-pontos
  | 'static' // efeito contínuo (linha sem momento)
  | 'header' // marcações do começo da linha ([On Play], [DON!! x1]…)
  | 'timing' // momento que não vale para a categoria (ex.: [Main] num Personagem)
  | 'keyword' // palavra-chave com texto depois
  | 'empty' // momento sem efeito
  | 'unknown'; // o leitor recusou sem dizer onde

export interface LineDiagnosis {
  /** A linha como está no texto da carta ("[Trigger] …" para o [Trigger]). */
  line: string;
  ok: boolean;
  stage?: GapStage;
  /** Trecho onde o leitor parou (já com o texto limpo: sem lembretes entre parênteses). */
  fragment?: string;
  /** `fragment` com números, nomes, tipos, atributos e cores trocados por marcadores. */
  pattern?: string;
}

const STAGES: ReadonlyArray<readonly [RegExp, GapStage]> = [
  [/^clause: /, 'clause'],
  [/^cond: /, 'condition'],
  [/^search(?: tail)?: /, 'search'],
  [/^cost: /, 'cost'],
  [/^static: /, 'static'],
  [/^header: /, 'header'],
  [/^keyword\+texto: /, 'keyword'],
  [/^timing /, 'timing'],
];

// Entre colchetes, o que não é nome de carta continua no padrão.
const KEPT_BRACKETS =
  /^(?:Blocker|Rush(?::\s?Character)?|Double Attack|Banish|Unblockable|Trigger|Counter|On Play|When Attacking|On K\.O\.|On Block|Activate:\s?Main|Main|Once Per Turn|Your Turn|Opponent's Turn|End of Your Turn|End of Your Opponent's Turn|On Your Opponent's Attack|DON!! x\d+)$/i;

/** Padrão de um trecho: "Give up to 1 of [Nami] …" e "Give up to 2 of [Zoro] …" caem juntos. */
export function gapPattern(fragment: string): string {
  return fragment
    .replace(/\[([^\]]+)\]/g, (m, inner: string) => (KEPT_BRACKETS.test(inner) ? m : '[X]'))
    .replace(/\{[^}]+\}/g, '{T}')
    .replace(/"[^"]+"/g, '"X"')
    .replace(/[①-⑩]/g, 'N')
    .replace(/\d+(?:,\d{3})*/g, 'N')
    .replace(/\b(?:red|green|blue|purple|black|yellow)\b/gi, '<color>')
    .replace(/\s+/g, ' ')
    .replace(/[\s.]+$/, '')
    .trim();
}

/** Monta o diagnóstico de uma linha a partir da falha que o leitor registrou (null = entendida). */
export function lineDiagnosis(line: string, failure: string | null): LineDiagnosis {
  if (failure === null) return { line, ok: true };
  let stage: GapStage = 'unknown';
  let fragment = line;
  if (failure === 'vazio') stage = 'empty';
  else if (failure !== 'desconhecido') {
    const known = STAGES.find(([re]) => re.test(failure));
    if (known) {
      stage = known[1];
      fragment = failure.replace(known[0], '');
    } else fragment = failure;
  }
  return { line, ok: false, stage, fragment, pattern: gapPattern(fragment) };
}
