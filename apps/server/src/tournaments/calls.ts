// Chamado de Judge: o texto do chamado de ajuste da plataforma (o relato que Admin e Dev recebem quando o
// Judge fecha um chamado como erro do app). Junta o que o jogador relatou, a jogada apontada (com a
// pergunta aberta, as opções e o que aconteceu), o que o Judge fez na mesa e o desfecho.

import type { Action, GameState } from '@gumgum/engine';
import type { JudgePlay, JudgePlays } from '../online/room';
import type { CallFix, CallOutcome, CallReason, TournamentCall, TournamentIntervention } from './store';

/** O motivo do jogador, no texto do relato (os relatos ficam em português, como o painel de Admin). */
const REASON_TEXT: Record<CallReason, string> = {
  effect: 'uma carta não fez o que devia',
  choice: 'escolheu uma carta ou opção e não aconteceu o esperado',
  misclick: 'clicou errado e quer voltar a jogada',
  stuck: 'a partida travou',
  rules: 'dúvida de regra',
  conduct: 'problema com o oponente',
  other: 'outro',
};

const OUTCOME_TEXT: Record<CallOutcome, string> = {
  no_issue: 'sem problema no app (escolha do jogador)',
  misclick: 'erro do jogador, jogada refeita',
  app_fixed: 'erro do app, mesa corrigida pelo Judge',
  app_unfixed: 'erro do app, sem correção na mesa',
  rules: 'dúvida de regra',
  conduct: 'conduta',
  other: 'outro',
};

/** "Nome (número)" de uma carta da partida. */
function cardLabel(state: GameState, uid: string | undefined): string | null {
  const c = uid ? state.cards[uid] : undefined;
  if (!c) return null;
  return `${state.defs[c.cardId]?.name ?? '?'} (${c.cardId})`;
}

/** A ação em poucas palavras, com os nomes das cartas. */
function actionText(state: GameState, a: Action): string {
  const name = (uid: string) => cardLabel(state, uid) ?? '?';
  switch (a.type) {
    case 'playCard':
      return `jogou ${name(a.uid)}`;
    case 'activate':
      return `ativou ${name(a.uid)}`;
    case 'attack':
      return `atacou ${name(a.target)} com ${name(a.attacker)}`;
    case 'attachDon':
      return `deu 1 DON!! a ${name(a.target)}`;
    case 'detachDon':
      return `devolveu 1 DON!! de ${name(a.target)}`;
    case 'choose':
      return a.uids.length ? `escolheu ${a.uids.map(name).join(', ')}` : 'não escolheu nenhuma carta';
    case 'answer':
      return a.yes ? 'respondeu sim' : 'respondeu não';
    case 'counter':
      return `usou o Counter ${name(a.uid)}`;
    case 'option':
      return `escolheu a opção ${a.index + 1}`;
    case 'pass':
      return 'passou';
    case 'endTurn':
      return 'encerrou o turno';
    case 'judge':
      return `correção do Judge: ${a.op.op}${'uid' in a.op ? ` ${name(a.op.uid)}` : ''}${a.op.op === 'move' ? ` → ${a.op.to}` : ''}`;
    default:
      return a.type;
  }
}

/** Uma jogada com a pergunta que estava aberta e as linhas do log que ela gerou. */
function playText(state: GameState, names: [string, string], p: JudgePlay): string {
  const parts = [`#${p.count + 1} (turno ${p.turn}, ${names[p.player]}): ${actionText(state, p.action)}`];
  const q = p.pending;
  if (q && 'source' in q) {
    const prompt = 'prompt' in q && q.prompt ? `: "${q.prompt}"` : q.kind === 'manual' ? `: "${q.text}"` : '';
    parts.push(`pergunta de ${cardLabel(state, q.source) ?? '?'}${prompt}`);
  }
  if (q && (q.kind === 'selectTargets' || q.kind === 'block' || q.kind === 'counter') && q.options.length) {
    parts.push(`opções: ${q.options.map((u) => cardLabel(state, u) ?? '?').join(', ')}`);
  }
  if (q?.kind === 'option') parts.push(`opções: ${q.options.join(' / ')}`);
  parts.push(p.lines.length ? `histórico: ${p.lines.map((e) => e.secret ?? e.text).join(' | ')}` : 'histórico: (nenhuma linha)');
  return parts.join('; ');
}

/** A carta mais provável do problema: a que abriu a pergunta da jogada, a da ação ou a corrigida pelo Judge. */
function suspectCard(state: GameState, play: JudgePlay | undefined, fixes: TournamentIntervention[]): string | null {
  const q = play?.pending;
  if (q && 'source' in q) return cardLabel(state, q.source);
  const a = play?.action;
  if (a && 'uid' in a) return cardLabel(state, a.uid);
  for (const f of fixes) {
    const op = (f.payload as { op?: { uid?: string } } | null)?.op;
    if (op?.uid) return cardLabel(state, op.uid);
  }
  return null;
}

/**
 * A jogada apontada por quem chamou o Judge e as seguintes (o que aconteceu depois dela, onde o efeito
 * devia ter agido), em texto: guardado no chamado, porque o Judge pode desfazê-las.
 */
export function pointedText(state: GameState, plays: JudgePlays, count: number): string | null {
  const play = plays.plays.find((p) => p.count === count);
  if (!play) return null;
  const after = plays.plays.filter((p) => p.count > count && p.action.type !== 'judge').slice(0, 3);
  return [`Jogada apontada: ${playText(state, plays.names, play)}`, ...after.map((p) => `Depois: ${playText(state, plays.names, p)}`)].join('\n');
}

/**
 * O chamado de ajuste da plataforma: o que Admin e Dev precisam para achar e corrigir a carta.
 * `fixes` = as intervenções do Judge desde que o chamado abriu (desfazer e correções).
 */
export function fixTicket(input: {
  call: TournamentCall;
  outcome: CallOutcome;
  note: string | null;
  judgeName: string;
  callerName: string;
  where: string;
  state: GameState;
  plays: JudgePlays;
  fixes: TournamentIntervention[];
}): CallFix {
  const { call, state, plays, fixes } = input;
  const play = call.play !== null ? plays.plays.find((p) => p.count === call.play) : undefined;
  const lines = [`⚖ Chamado de ajuste aberto pelo Judge ${input.judgeName} (${input.where}). Desfecho: ${OUTCOME_TEXT[input.outcome]}.`];
  if (call.reason) lines.push(`Relato de ${input.callerName}: ${REASON_TEXT[call.reason]}${call.details ? `. "${call.details}"` : ''}.`);
  // A jogada como estava ao chamar (o Judge pode tê-la desfeito depois).
  if (call.playText) lines.push(call.playText);
  const undone = fixes.filter((f) => f.kind === 'undo').reduce((n, f) => n + (f.removed?.length ?? 0), 0);
  const corrections = fixes.filter((f) => f.kind === 'judge_action').map((f) => actionText(state, f.payload as Action));
  if (undone) lines.push(`O Judge voltou ${undone} jogada(s).`);
  if (corrections.length) lines.push(`Correções do Judge: ${corrections.join('; ')}.`);
  if (input.note) lines.push(`Relato do Judge: ${input.note}`);
  return { text: lines.join('\n'), card: suspectCard(state, play, fixes.filter((f) => f.kind === 'judge_action')), play: call.play };
}
