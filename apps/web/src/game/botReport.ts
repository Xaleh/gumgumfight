// Relatório de uma partida contra o Bot do Time: o texto (markdown) que a mesa monta conforme o jogador do Time
// toca nos passos que o bot errou no painel do treinador. Vai para o servidor no fim da partida e, num pacote com o
// guia, o perfil do deck e o replay, para uma conversa com o Claude melhorar o perfil (docs/plano-bot-time.md).
//
// Função pura: recebe as explicações do bot, as marcações e textos já traduzidos, e devolve o texto. A mesa usa o
// mesmo texto na prévia do painel e no fim da partida.

import type { Action } from '@gumgum/engine';
import type { CoachEntry, FeedbackMark } from '../api';

/** Um passo da jogada do bot marcado como errado. */
export interface CoachMark {
  /** Posição da decisão no replay (o começo da linha do turno, ou a resposta). */
  index: number;
  /** Qual passo da linha (0 = o primeiro); numa resposta, sempre 0. */
  step: number;
  /** "O certo era": índice da alternativa que o bot considerou (opcional). */
  alt?: number;
  /** "Por quê" (opcional). */
  why?: string;
}

/**
 * As alternativas que se distinguem por extenso: sem as que têm o mesmo texto da linha escolhida (duas cópias da mesma
 * carta, DON!! anexado de outro jeito) nem de uma alternativa anterior. Devolve o índice original de cada uma.
 */
export function distinctAlternatives(e: CoachEntry, describe: (a: Action) => string): Array<{ i: number; text: string; score: number }> {
  const seen = new Set([e.actions.map(describe).join(' → ')]);
  const out: Array<{ i: number; text: string; score: number }> = [];
  e.alternatives.forEach((alt, i) => {
    const text = alt.actions.map(describe).join(' → ');
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ i, text, score: alt.score });
  });
  return out;
}

export const sameMark = (a: Pick<CoachMark, 'index' | 'step'>, b: Pick<CoachMark, 'index' | 'step'>) => a.index === b.index && a.step === b.step;

/** Textos do relatório (chaves `report.*`), traduzidos por quem chama. */
export type ReportText = (key: string, params?: Record<string, string | number>) => string;

export interface ReportInput {
  entries: CoachEntry[];
  marks: CoachMark[];
  tr: ReportText;
  /** Uma jogada por extenso ("Atacar Kid com Zoro"), com os nomes das cartas. */
  describe: (a: Action) => string;
  /** Nome de um termo da avaliação ("sua mão"). */
  termLabel: (key: string) => string;
  /** Número formatado no idioma (para as notas e os termos). */
  num: (n: number) => string;
  bot: { deckId: string | null; deckName?: string | null; leaderName: string; leaderId: string };
  opponent: { name: string; leaderName: string; leaderId: string };
  /** `botWon`: null = empate; ausente = a partida não terminou. */
  result: { turn: number; over: boolean; botWon?: boolean | null };
  matchId?: number | null;
  level?: string | null;
  rating?: number;
  comment?: string;
}

const signed = (n: number, num: (n: number) => string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`;

export function buildReport(r: ReportInput): string {
  const { tr } = r;
  const out: string[] = [`# ${tr('report.title')}`, ''];
  const deck = r.bot.deckName ? `${r.bot.deckName} (${r.bot.deckId ?? '?'})` : (r.bot.deckId ?? '?');
  out.push(`- ${tr('report.botDeck', { deck, leader: r.bot.leaderName, id: r.bot.leaderId })}`);
  out.push(`- ${tr('report.opponent', { name: r.opponent.name, leader: r.opponent.leaderName, id: r.opponent.leaderId })}`);
  const res = r.result;
  out.push(
    `- ${
      !res.over
        ? tr('report.resultOngoing', { n: res.turn })
        : res.botWon === null || res.botWon === undefined
          ? tr('report.resultDraw', { n: res.turn })
          : res.botWon
            ? tr('report.resultWon', { n: res.turn })
            : tr('report.resultLost', { n: res.turn })
    }`,
  );
  if (r.matchId) out.push(`- ${tr('report.match', { id: r.matchId })}`);
  if (r.level) out.push(`- ${tr('report.level', { level: r.level })}`);
  if (r.rating) out.push(`- ${tr('report.rating', { stars: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating), n: r.rating })}`);

  const byIndex = new Map(r.entries.map((e) => [e.index, e]));
  const marks = [...r.marks].filter((m) => byIndex.has(m.index)).sort((a, b) => a.index - b.index || a.step - b.step);
  out.push('', `## ${tr('report.wrongTitle', { n: marks.length })}`, '');
  if (!marks.length) out.push(tr('report.none'));
  marks.forEach((m, i) => {
    const e = byIndex.get(m.index)!;
    const line = e.actions.map(r.describe);
    const step = Math.min(m.step, Math.max(0, line.length - 1));
    out.push(
      `### ${
        e.kind === 'turn'
          ? tr('report.itemTurnLine', { i: i + 1, turn: e.turn, step: step + 1, total: line.length })
          : tr('report.itemAnswer', { i: i + 1, turn: e.turn })
      }`,
      '',
    );
    out.push(`- ${tr('report.wrongPlay', { play: `**${line[step] ?? '?'}**` })}`);
    if (line.length > 1) out.push(`- ${tr('report.fullLine', { line: line.map((s, k) => (k === step ? `**${s}**` : s)).join(' → ') })}`);
    const alts = distinctAlternatives(e, r.describe);
    const alt = alts.find((a) => a.i === m.alt);
    if (alt) out.push(`- ${tr('report.rightWas', { line: alt.text })}`);
    if (m.why?.trim()) out.push(`- ${tr('report.why', { text: m.why.trim() })}`);
    if (e.terms.length) out.push(`- ${tr('report.weighed', { terms: e.terms.map((t) => `${r.termLabel(t.key)} ${signed(t.delta, r.num)}`).join('; ') })}`);
    if (alts.length) out.push(`- ${tr('report.considered', { lines: alts.map((a) => `${a.text} (${r.num(a.score)})`).join('; ') })}`);
    out.push(`- ${tr('report.position', { index: m.index, score: r.num(e.score) })}`, '');
  });
  if (r.comment?.trim()) out.push(`## ${tr('report.commentTitle')}`, '', r.comment.trim(), '');
  return out.join('\n').trim() + '\n';
}

/** As marcações no formato do servidor (a posição exata vem do replay; o texto vai no relatório). */
export function feedbackMarks(marks: CoachMark[], entries: CoachEntry[], describe: (a: Action) => string): FeedbackMark[] {
  return marks.map((m) => {
    const e = entries.find((x) => x.index === m.index);
    const alt = m.alt !== undefined && e ? distinctAlternatives(e, describe).find((a) => a.i === m.alt) : undefined;
    return {
      index: m.index,
      step: m.step,
      ...(alt ? { expected: alt.text } : {}),
      ...(m.why?.trim() ? { comment: m.why.trim() } : {}),
    };
  });
}
