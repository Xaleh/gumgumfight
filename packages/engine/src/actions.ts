import {
  activateError,
  attackError,
  cardDef,
  isIdle,
  opponent,
  playError,
} from './engine';
import type { Action, GameState, PlayerId } from './types';

/**
 * Lista as ações legais do jogador no estado atual.
 * Para escolhas de alvos, lista apenas escolhas de 0 ou 1 alvo (suficiente para bots;
 * a interface permite múltipla seleção por conta própria).
 */
export function legalActions(state: GameState, player: PlayerId): Action[] {
  if (state.phase === 'gameover') return [];
  const pending = state.pending;
  if (pending) {
    if (pending.player !== player) return [];
    switch (pending.kind) {
      case 'mulligan':
        return [
          { type: 'mulligan', player, redraw: false },
          { type: 'mulligan', player, redraw: true },
        ];
      case 'selectTargets': {
        const out: Action[] = [];
        if (pending.min === 0) out.push({ type: 'choose', player, uids: [] });
        if (pending.min > 1) {
          // Escolha obrigatória de várias cartas: uma combinação basta como exemplo.
          out.push({ type: 'choose', player, uids: pending.options.slice(0, pending.min) });
          return out;
        }
        for (const uid of pending.options) out.push({ type: 'choose', player, uids: [uid] });
        return out;
      }
      case 'block':
        return [
          { type: 'choose', player, uids: [] },
          ...pending.options.map((uid): Action => ({ type: 'choose', player, uids: [uid] })),
        ];
      case 'counter':
        return [
          { type: 'pass', player },
          ...pending.options.map((uid): Action => ({ type: 'counter', player, uid })),
        ];
      case 'chooseFirst':
      case 'trigger':
      case 'confirm':
        return [
          { type: 'answer', player, yes: true },
          { type: 'answer', player, yes: false },
        ];
      case 'option':
        return pending.options.map((_, index): Action => ({ type: 'option', player, index }));
      case 'manual':
        // As ferramentas manuais ficam fora da lista (são livres); aqui só a confirmação.
        return [{ type: 'manualDone', player }];
    }
  }

  if (!isIdle(state) || state.activePlayer !== player) return [];
  const ps = state.players[player];
  const out: Action[] = [];

  for (const uid of ps.hand) if (!playError(state, player, uid)) out.push({ type: 'playCard', player, uid });

  const field = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])];
  for (const fc of field) {
    cardDef(state, fc.uid).abilities.forEach((a, i) => {
      if (a.timing === 'activateMain' && !activateError(state, player, fc.uid, i)) {
        out.push({ type: 'activate', player, uid: fc.uid, ability: i });
      }
    });
  }

  if (ps.donActive > 0) {
    for (const fc of [ps.leader, ...ps.characters]) out.push({ type: 'attachDon', player, target: fc.uid });
  }

  const opp = state.players[opponent(player)];
  const targets = [opp.leader.uid, ...opp.characters.map((c) => c.uid)];
  for (const fc of [ps.leader, ...ps.characters]) {
    for (const t of targets) {
      if (!attackError(state, player, fc.uid, t)) out.push({ type: 'attack', player, attacker: fc.uid, target: t });
    }
  }

  out.push({ type: 'endTurn', player });
  return out;
}

/** Quem precisa agir agora (jogador com escolha pendente ou jogador ativo). */
export function actingPlayer(state: GameState): PlayerId | null {
  if (state.phase === 'gameover') return null;
  if (state.pending) return state.pending.player;
  return state.activePlayer;
}
