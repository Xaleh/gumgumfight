// Derrota, eliminação (mesa de mais de dois) e fim de jogo.

import type { GameState, PlayerId, PlayerState } from '../types';
import { lg, log, msgOf, type Prompt } from './messages';
import { alivePlayers, isMultiplayer, opponent, turnOrder } from './table';
import { leaderRule } from './queries';
import { continueSetup } from './setup';
import { drawCards, limboToTrash } from './zones';

/**
 * Derrota de `losers` (ao mesmo tempo). Com dois jogadores: um perde e o outro vence; os dois juntos,
 * empate (9-2-1). Numa mesa maior, quem perde é eliminado (`removePlayer`) e a mesa segue; a partida
 * acaba quando sobra um (ele vence) ou quando todos os que restavam caem juntos (empate). `by`: quem
 * deu o golpe final (leva a recompensa da mesa).
 */
export function eliminate(state: GameState, losers: PlayerId[], reason: (ps: PlayerState) => Prompt, both: Prompt, by?: PlayerId) {
  if (!isMultiplayer(state)) {
    if (losers.length === 2) gameOver(state, null, both);
    else if (losers.length === 1) gameOver(state, opponent(losers[0]), reason(state.players[losers[0]]));
    return;
  }
  const alive = alivePlayers(state).map((ps) => ps.id);
  const falling = turnOrder(state, state.activePlayer).filter((id) => losers.includes(id));
  if (!falling.length) return;
  const left = alive.filter((id) => !falling.includes(id));
  // Os que restavam caem juntos: ninguém vence.
  if (!left.length) {
    state.eliminated = [...(state.eliminated ?? []), ...falling];
    gameOver(state, null, falling.length === 1 ? reason(state.players[falling[0]]) : lg('winAllOut', 'Todos os jogadores que restavam foram derrotados ao mesmo tempo.'));
    return;
  }
  // O último a cair fica com a mesa como estava (é o fim da partida); os outros saem dela.
  const last = left.length === 1 ? falling[falling.length - 1] : undefined;
  for (const id of falling) {
    if (id === last) (state.eliminated ??= []).push(id);
    else removePlayer(state, id, reason(state.players[id]), by);
  }
  if (last !== undefined) gameOver(state, left[0], reason(state.players[last]));
}

/**
 * Tira um jogador da mesa (com mais de dois): as cartas dele saem do jogo e os efeitos dele acabam.
 * A batalha em que ele estava termina; os efeitos de outros jogadores que o tinham como oponente seguem
 * sem achar nada do lado dele. Se era a vez dele, o turno fecha e passa para o próximo.
 */
function removePlayer(state: GameState, id: PlayerId, reason: Prompt, by?: PlayerId) {
  const ps = state.players[id];
  const pending = state.pending;
  const top = state.stack[state.stack.length - 1];
  ps.out = true;
  (state.eliminated ??= []).push(id);
  log(state, id, lg('eliminated', `${ps.name} foi eliminado. ${reason.text}`, { player: ps.name, reason: reason.text }, { reason: { items: [msgOf(reason)] } }));

  const theirs = (uid: string) => state.cards[uid]?.owner === id;
  // A batalha dele termina.
  const b = state.battle;
  if (b && (theirs(b.attacker) || theirs(b.target))) {
    state.battle = null;
    state.modifiers = state.modifiers.filter((m) => m.duration !== 'battle');
    state.stack = state.stack.filter((f) => f.kind !== 'battle');
  } else if (b) {
    if (b.after?.length) b.after = b.after.filter((d) => d.controller !== id);
    if (b.bystanders?.length) b.bystanders = b.bystanders.filter((x) => x !== id);
  }
  // Uma escolha dele estava aberta num efeito de outro jogador: esse efeito não segue.
  if (pending?.player === id && top?.kind === 'effect' && top.controller !== id && !(pending.kind === 'option' && pending.order)) {
    state.stack = state.stack.filter((f) => f !== top);
    if (top.trigger) limboToTrash(state, top.source);
  }
  state.stack = state.stack.filter(
    (f) => !((f.kind === 'effect' && f.controller === id) || (f.kind === 'damage' && f.defender === id) || (f.kind === 'play' && theirs(f.uid))),
  );
  if (state.triggered?.length) {
    state.triggered = state.triggered.filter((e) => e.controller !== id);
    if (!state.triggered.length) delete state.triggered;
  }
  if (state.delayed?.length) state.delayed = state.delayed.filter((d) => d.controller !== id);

  // As cartas saem do jogo.
  ps.characters = [];
  ps.stage = null;
  ps.hand = [];
  ps.deck = [];
  ps.trash = [];
  ps.life = [];
  delete ps.lifeFaceUp;
  ps.leader.don = 0;
  delete ps.leader.donLoose;
  ps.donDeck = 0;
  ps.donActive = 0;
  ps.donRested = 0;
  if (state.limbo?.length) state.limbo = state.limbo.filter((u) => !theirs(u));
  if (state.knownHand?.length) state.knownHand = state.knownHand.filter((u) => !theirs(u));

  // Os efeitos sobre as cartas dele, e os que esperavam um turno dele para acabar, acabam agora.
  const expired = (x: { untilStartOf?: PlayerId; untilEndOf?: PlayerId }) => x.untilStartOf === id || x.untilEndOf === id;
  state.modifiers = state.modifiers.filter((m) => !theirs(m.uid) && !expired(m));
  if (state.restrictions?.length) state.restrictions = state.restrictions.filter((r) => r.player !== id && !expired(r));
  if (state.onPlayNegated?.length) state.onPlayNegated = state.onPlayNegated.filter((n) => n.player !== id && !expired(n));
  if (state.costReductions?.length) state.costReductions = state.costReductions.filter((r) => r.player !== id);
  if (state.tempReplacements?.length) state.tempReplacements = state.tempReplacements.filter((r) => r.player !== id);
  if (state.donSkipRefresh?.length) state.donSkipRefresh = state.donSkipRefresh.filter((d) => d.player !== id);
  if (state.donRestAtMain?.length) state.donRestAtMain = state.donRestAtMain.filter((d) => d.player !== id);
  if (state.extraTurn === id) state.extraTurn = undefined;

  // Escolhas em aberto: a dele some; a de outro jogador perde as cartas que saíram do jogo.
  if (pending?.player === id) state.pending = null;
  else if (pending && (pending.kind === 'selectTargets' || pending.kind === 'block' || pending.kind === 'counter')) {
    pending.options = pending.options.filter((u) => !theirs(u));
    if (pending.kind === 'selectTargets') {
      if (pending.shown) pending.shown = pending.shown.filter((u) => !theirs(u));
      pending.max = Math.min(pending.max, pending.options.length);
      pending.min = Math.min(pending.min, pending.max);
    }
  }

  // Recompensa de quem deu o golpe final.
  const reward = state.table?.eliminationDraw ?? 0;
  if (reward > 0 && by !== undefined && by !== id && !state.players[by].out) {
    const killer = state.players[by];
    log(state, by, lg('eliminationReward', `${killer.name} compra ${reward} carta(s) por eliminar ${ps.name}.`, { player: killer.name, n: reward, target: ps.name }));
    drawCards(state, by, reward);
  }

  if (state.phase === 'mulligan') {
    // Saiu durante a preparação: ela segue com os outros.
    if (pending?.player === id && !state.stack.length) continueSetup(state);
    return;
  }
  if (state.activePlayer === id && state.phase === 'main') {
    // Era a vez dele: o que estava em resolução no turno se perde, e o turno fecha (frame `endTurn`).
    state.stack = [{ kind: 'endTurn' }];
    delete state.triggered;
    state.delayed = [];
    state.pending = null;
    state.battle = null;
  }
}

/**
 * Derrota por deck vazio (1-2-1-1-2), checada a cada passo (1-2-2). Se os dois cumprem a condição
 * ao mesmo tempo, os dois perdem: empate (9-2-1).
 */
export function checkDefeat(state: GameState) {
  if (state.phase === 'gameover' || state.phase === 'mulligan') return;
  const losers: PlayerId[] = [];
  const winners: PlayerId[] = [];
  for (const ps of alivePlayers(state)) {
    if (ps.deck.length !== 0 || leaderRule(state, ps.id, 'deckOutEndOfTurn')) continue;
    // "… you win the game instead of losing": vitória pela regra do Líder.
    (leaderRule(state, ps.id, 'deckOutWin') ? winners : losers).push(ps.id);
  }
  if (winners.length === 1) {
    const w = state.players[winners[0]];
    gameOver(state, w.id, lg('winDeckOutLeaderRule', `${w.name} ficou sem cartas no deck e vence pela regra do Líder.`, { player: w.name }));
  } else if (winners.length >= 2) {
    gameOver(state, null, lg('winBothDeckOutLeaderRule', 'Os dois ficaram sem cartas no deck e vencem pela regra do Líder.'));
  } else eliminate(
      state,
      losers,
      (ps) => lg('winDeckOut', `${ps.name} ficou sem cartas no deck.`, { player: ps.name }),
      lg('winBothDeckOut', 'Os dois ficaram sem cartas no deck.'),
    );
}

/** Fim da partida. `winner` null: empate (derrota simultânea, 9-2-1; laço infinito, 11-1). */
export function gameOver(state: GameState, winner: PlayerId | null, reason: Prompt) {
  state.phase = 'gameover';
  state.winner = winner;
  state.winReason = reason.text;
  state.winReasonKey = reason.key;
  if (reason.params) state.winReasonParams = reason.params;
  state.pending = null;
  // O motivo entra na linha do log como parte traduzível.
  const parts = { reason: { items: [msgOf(reason)] } };
  if (winner === null) log(state, null, lg('gameOverDraw', `Fim de jogo: empate! ${reason.text}`, { reason: reason.text }, parts));
  else {
    const player = state.players[winner].name;
    log(state, winner, lg('gameOverWin', `Fim de jogo: ${player} venceu! ${reason.text}`, { player, reason: reason.text }, parts));
  }
}
