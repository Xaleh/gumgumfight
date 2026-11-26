// Cancelar a ação em andamento: o checkpoint de antes da ação e quando ele ainda pode ser restaurado.

import { visibleCards } from '../view';
import type { Checkpoint, GameState, PlayerId, StateSnapshot } from '../types';
import { lg, log } from './messages';
import { cardDef, locate } from './queries';
import { isIdle } from './options';
import { cloneState } from './apply';

/** Quem pode ver cartas: cada jogador (pelo lugar) e, por último, os espectadores. */
const viewersOf = (state: GameState): Array<PlayerId | null> => [...state.players.map((ps) => ps.id), null];

/**
 * `state` é o estado de antes da ação de `player`, que o motor nunca muda: o checkpoint só
 * aponta para ele (a cópia fica para a hora de restaurar, que é rara).
 */
export function makeCheckpoint(state: GameState): Checkpoint {
  const { defs: _defs, cards: _cards, log: _log, actionCount: _n, cancel: _cancel, checkpoint: _cp, ...snap } = state;
  return { seen: viewersOf(state).map((v) => [...visibleCards(state, v)]), snap: snap as StateSnapshot };
}

/**
 * Depois de cada ação de `actor`: a ação em andamento continua cancelável só enquanto o
 * motor espera uma escolha de quem a começou (o oponente ainda não decidiu nada) e nenhuma
 * carta escondida apareceu (busca no deck, carta comprada, Vida olhada, mão do oponente
 * revelada…). Conta como revelada uma carta que ficou visível para alguém e que quem começou
 * a ação ainda não via: uma carta da própria mão jogada ou descartada não é informação nova
 * para ele, e cancelar só o prejudica. Revelou algo: o checkpoint some e fica só o motivo.
 */
export function settleCancel(state: GameState, actor: PlayerId) {
  const info = state.cancel;
  if (!info) return;
  const choosing = state.phase !== 'gameover' && state.pending !== null && state.pending.player === info.player && actor === info.player;
  // Pagou um custo e a ação terminou na própria vez: dá para desfazer até a próxima ação.
  const done = !choosing && Boolean(info.paid) && actor === info.player && isIdle(state) && state.activePlayer === info.player;
  if ((!choosing && !done) || (done && info.blocked)) {
    delete state.cancel;
    delete state.checkpoint;
    return;
  }
  if (done) info.done = true;
  else delete info.done;
  const cp = state.checkpoint;
  if (!cp) return;
  const actorSaw = new Set(cp.seen[info.player]);
  const revealed = viewersOf(state).some((v, i) => {
    const before = new Set(cp.seen[i]);
    for (const uid of visibleCards(state, v)) if (!before.has(uid) && !actorSaw.has(uid)) return true;
    return false;
  });
  if (revealed && done) {
    delete state.cancel;
    delete state.checkpoint;
  } else if (revealed) {
    info.blocked = 'revealed';
    delete state.checkpoint;
  }
}

/** Algo escondido foi lido pelo jogador que começou a ação: ela não pode mais ser cancelada. */
export function markRevealed(state: GameState) {
  if (!state.cancel) return;
  state.cancel.blocked = 'revealed';
  delete state.checkpoint;
}

export function restoreCheckpoint(state: GameState, p: PlayerId) {
  const cp = state.checkpoint!;
  const info = state.cancel!;
  delete state.checkpoint;
  delete state.cancel;
  // Campos criados depois do checkpoint (contadores, fila de efeitos…) também voltam ao que eram.
  const kept = new Set(['defs', 'cards', 'log', 'actionCount', ...Object.keys(cp.snap)]);
  for (const k of Object.keys(state)) if (!kept.has(k)) delete (state as unknown as Record<string, unknown>)[k];
  Object.assign(state, cloneState(cp.snap));
  const name = (uid: string) => cardDef(state, uid).name;
  const a = info.action;
  const player = state.players[p].name;
  const [key, what, card] =
    a.type === 'playCard'
      ? ['cancelPlay', `a jogada de ${name(a.uid)} (a carta volta para a mão)`, name(a.uid)]
      : a.type === 'activate'
        ? ['cancelActivate', `a ativação de ${name(a.uid)}`, name(a.uid)]
        : a.type === 'attachDon'
          ? ['cancelAttachDon', `o DON!! anexado a ${name(a.target)}`, name(a.target)]
          : a.type === 'attack'
            ? ['cancelAttack', `o ataque de ${name(a.attacker)}`, name(a.attacker)]
            : a.type === 'endTurn'
              ? ['cancelEndTurn', 'o fim do turno']
              : ['cancelAction', 'a ação'];
  const named = a.type === 'playCard' || a.type === 'activate' ? a.uid : a.type === 'attachDon' ? a.target : a.type === 'attack' ? a.attacker : undefined;
  log(state, p, lg(key, `${player} cancela ${what}.`, { player, ...(card !== undefined ? { card } : {}) }), named !== undefined ? { cards: [named] } : undefined);
}

/** Motivo pelo qual `player` não pode cancelar a ação em andamento, ou null se puder. */
export function cancelError(state: GameState, player: PlayerId): string | null {
  if (state.phase === 'gameover') return 'A partida já terminou.';
  const c = state.cancel;
  const open = c?.done ? isIdle(state) && state.activePlayer === player : state.pending?.player === player;
  if (!c || c.player !== player || !open) return 'Não há ação para cancelar.';
  if (c.blocked === 'revealed') return 'Não dá mais para cancelar: uma carta foi revelada.';
  return null;
}

export function cancelAllowed(state: GameState, player: PlayerId): boolean {
  return cancelError(state, player) === null;
}

/** Motivo pelo qual não dá para devolver 1 DON!! de `target` à área de custo, ou null se der. */
export function detachDonError(state: GameState, player: PlayerId, target: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível devolver DON!! agora.';
  const loc = locate(state, target);
  if (!loc || loc.player !== player || loc.zone === 'stage') return 'Alvo inválido.';
  if (!(loc.fc.donLoose ?? 0)) {
    return loc.fc.don > 0 ? 'Esse DON!! já foi usado neste turno: fica até a Renovação.' : 'Esta carta não tem DON!! anexado.';
  }
  return null;
}
