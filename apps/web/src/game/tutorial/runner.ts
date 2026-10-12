// Regras do andamento de uma lição, sem interface: o que o jogador pode fazer em cada passo e
// o que o oponente roteirizado faz. Usado pela tela da lição (useLesson) e pelos testes.

import { type Action, type GameState, legalActions, passiveAction } from '@gumgum/engine';
import { type Lesson, type LessonStep, ME, OPP, scriptedAttack } from './lessons';

/** O passo deixa o jogador fazer esta jogada? (Desistir e cancelar a própria ação são sempre livres.) */
export function humanAllowed(step: LessonStep | undefined, a: Action, s: GameState): boolean {
  if (a.type === 'cancel' || a.type === 'concede') return true;
  const d = step?.do;
  if (!d) return false;
  if (s.pending?.player === ME) return d.respond ? d.respond(a, s) : true;
  return d.allow ? d.allow(a, s) : false;
}

/**
 * Jogada do oponente numa lição com oponente passivo ou roteirizado (o bot de verdade fica com
 * a tela). `null` = não é a vez dele.
 */
export function opponentAction(lesson: Lesson, s: GameState): Action | null {
  const plan = lesson.board?.opponent;
  if (!plan || plan === 'bot' || s.phase === 'gameover') return null;
  const acting = s.pending ? s.pending.player : s.activePlayer;
  if (acting !== OPP) return null;
  if (plan === 'passive' || s.pending) return passiveAction(s, OPP);
  return scriptedAttack(s, plan, legalActions(s, OPP));
}

/** O passo está esperando o oponente agir (o oponente só joga durante passos de ação). */
export const opponentMayAct = (step: LessonStep | undefined) => Boolean(step?.do);
