// Fluxo de turno: começo do turno, Renovação, compra e DON!!, fim do turno e as durações dos efeitos.

import type { GameState, PlayerId } from '../types';
import { FAR_TURN } from './constants';
import { lg, log } from './messages';
import { alivePlayers, isMultiplayer, nextPlayer, opponentsOf } from './table';
import { cardDef, getCost, leaderRule, locate } from './queries';
import { conditionsMet } from './conditions';
import { totalDonOnField } from './options';
import { pushAbilities } from './triggers';
import { drawCards } from './zones';
import { checkDefeat, eliminate } from './defeat';

export function startTurn(state: GameState) {
  const ps = state.players[state.activePlayer];
  const others = opponentsOf(state, state.activePlayer).map((o) => state.players[o]);
  state.phase = 'main';
  if (isMultiplayer(state)) {
    state.turnsTaken ??= state.players.map(() => 0);
    state.turnsTaken[ps.id] = (state.turnsTaken[ps.id] ?? 0) + 1;
    turnExpiries(state, ps.id);
  }
  state.modifiers = state.modifiers.filter((m) => !(m.duration === 'untilYourNextTurn' && (m.untilTurn ?? 0) <= state.turn));
  log(state, ps.id, lg('turnStart', `— Turno ${state.turn}: ${ps.name} —`, { n: state.turn, player: ps.name }));

  // Refresh Phase (6-2-2, Q&A OP11-040): primeiro ativam os "at the start of your turn" do jogador
  // do turno e os "at the start of your opponent's turn" do outro (mesmo lote: os do jogador do
  // turno primeiro). Só depois que resolverem (com as escolhas) os DON!! voltam, tudo fica ativo,
  // vem o Draw e o DON!! Phase (frame `refresh`).
  const queued = [
    ...[ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])].flatMap((fc) => pushAbilities(state, fc.uid, 'startOfTurn')),
    ...others.flatMap((other) =>
      [other.leader, ...other.characters, ...(other.stage ? [other.stage] : [])].flatMap((fc) => pushAbilities(state, fc.uid, 'startOfOpponentTurn')),
    ),
  ];
  if (queued.length) state.stack.push({ kind: 'refresh' });
  else refreshDrawDon(state);
}

/** Resto do Refresh Phase, Draw e DON!! Phase; depois, os "at the start of your Main Phase" (6-5-1). */
export function refreshDrawDon(state: GameState) {
  const ps = state.players[state.activePlayer];
  // "rested DON!! cards will not become active": só DON!! que já estavam virados na área de custo (os
  // dados a cartas voltam virados agora e desviram).
  const keep = Math.min(ps.donRested, (state.donSkipRefresh ?? []).filter((d) => d.player === ps.id).reduce((n, d) => n + d.count, 0));
  state.donSkipRefresh = (state.donSkipRefresh ?? []).filter((d) => d.player !== ps.id);
  // Refresh: DON!! anexados voltam à área de custo e tudo fica ativo.
  const fieldCards = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])];
  for (const fc of fieldCards) {
    ps.donRested += fc.don;
    fc.don = 0;
    delete fc.donLoose;
    // "will not become active in your (opponent's) next Refresh Phase": vale para esta Renovação e acaba aqui.
    const skip = state.modifiers.some((m) => m.uid === fc.uid && m.kind === 'skipRefresh') || noRefreshByAura(state, fc.uid);
    if (!skip) fc.rested = false;
    else if (fc.rested) (state.refreshSkipped ??= []).push(fc.uid);
  }
  state.modifiers = state.modifiers.filter((m) => !(m.kind === 'skipRefresh' && fieldCards.some((fc) => fc.uid === m.uid)));
  ps.donActive += ps.donRested - keep;
  ps.donRested = keep;

  // Draw: o primeiro jogador não compra no primeiro turno. DON!!: 2 por turno (1 no primeiro turno do
  // primeiro jogador). Na mesa de Yonko, cada um escolheu a própria largada (`curve`): 1 DON!! e a
  // compra, ou 2 DON!! sem comprar.
  const curve = isMultiplayer(state) && (state.turnsTaken?.[ps.id] ?? 0) <= 1 ? state.curve?.[ps.id] : undefined;
  const skipDraw = curve ? curve === 'even' : state.turn === 1;
  if (!skipDraw) drawCards(state, ps.id, 1);

  const n = Math.min(curve ? (curve === 'odd' ? 1 : 2) : state.turn === 1 ? 1 : 2, ps.donDeck);
  const hadDon = totalDonOnField(ps) > 0;
  ps.donDeck -= n;
  ps.donActive += n;
  if (n && hadDon && leaderRule(state, ps.id, 'donPhaseToLeader')) {
    ps.donActive--;
    ps.leader.don++;
  }
  checkDefeat(state);
  // (Mesa com mais de dois: o jogador da vez pode ter sido eliminado pelo deck vazio.)
  if (state.phase === 'gameover' || ps.out) return;

  // "your opponent rests 1 of their active DON!! cards at the start of their next Main Phase" (PRB02-005).
  const toRest = (state.donRestAtMain ?? []).filter((d) => d.player === ps.id).reduce((k, d) => k + d.count, 0);
  if (toRest) {
    state.donRestAtMain = (state.donRestAtMain ?? []).filter((d) => d.player !== ps.id);
    const k = Math.min(toRest, ps.donActive);
    ps.donActive -= k;
    ps.donRested += k;
    if (k) log(state, ps.id, lg('restDonAtMain', `${ps.name} vira ${k} DON!! ativo(s) no início da Fase Principal.`, { player: ps.name, n: k }));
  }
  // Main Phase: antes de qualquer ação, ativam os "at the start of your Main Phase" (6-5-1).
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) pushAbilities(state, fc.uid, 'startOfMainPhase');
}

/** "all Characters with a cost of 5 or less do not become active in your and your opponent's Refresh Phases" */
export function noRefreshByAura(state: GameState, uid: string): boolean {
  if (locate(state, uid)?.zone !== 'character') return false;
  return alivePlayers(state).some((pl) =>
    [pl.leader, ...pl.characters, ...(pl.stage ? [pl.stage] : [])].some((fc) =>
      cardDef(state, fc.uid).abilities.some(
        (a) => a.timing === 'static' && a.noRefreshMaxCost !== undefined && getCost(state, uid) <= a.noRefreshMaxCost && conditionsMet(state, fc.uid, a),
      ),
    ),
  );
}

export function endTurn(state: GameState) {
  const ps = state.players[state.activePlayer];
  // Mesa com mais de dois: o turno também fecha quando o jogador da vez é eliminado no meio dele.
  if (!ps.out) log(state, ps.id, lg('endTurn', `${ps.name} encerra o turno.`, { player: ps.name }));
  state.modifiers = state.modifiers.filter(
    (m) =>
      m.duration !== 'turn' &&
      !((m.duration === 'nextOpponentTurn' || m.duration === 'endOfYourNextTurn') && (m.untilTurn ?? 0) <= state.turn),
  );
  state.usedThisTurn = [];
  state.eventsThisTurn = [];
  state.restrictions = (state.restrictions ?? []).filter((r) => (r.untilTurn ?? 0) > state.turn);
  state.costReductions = [];
  state.battledCharacter = [];
  state.refreshSkipped = [];
  state.koThisTurn = [];
  state.tempReplacements = [];
  state.handTrashedThisTurn = [];
  state.lifeRemovedThisTurn = [];
  state.onPlayNegated = (state.onPlayNegated ?? []).filter((n) => n.untilTurn > state.turn);
  // "You lose at the end of the turn in which your deck becomes 0 cards."
  const out = alivePlayers(state).filter((pl) => pl.deck.length === 0 && leaderRule(state, pl.id, 'deckOutEndOfTurn')).map((pl) => pl.id);
  if (out.length) {
    eliminate(
      state,
      out,
      (pl) => lg('winDeckOutEndOfTurn', `${pl.name} terminou o turno sem cartas no deck.`, { player: pl.name }),
      lg('winBothDeckOutEndOfTurn', 'Os dois terminaram o turno sem cartas no deck.'),
    );
    if (state.phase === 'gameover' || !isMultiplayer(state)) return;
    // O turno já está fechando: a eliminação do jogador da vez não precisa fechá-lo de novo.
    state.stack = state.stack.filter((f) => f.kind !== 'endTurn');
  }
  // "take an extra turn after this one"
  if (state.extraTurn === state.activePlayer && !ps.out) state.extraTurn = undefined;
  else state.activePlayer = nextPlayer(state, state.activePlayer);
  state.turn++;
  startTurn(state);
}

/**
 * Mesa com mais de dois, no começo do turno de `p`: os efeitos "until the start of your next turn" dele
 * acabam, e os "until the end of … next turn" que esperavam este turno passam a acabar no fim dele
 * (ver `Expiry` em types.ts).
 */
function turnExpiries(state: GameState, p: PlayerId) {
  state.modifiers = state.modifiers.filter((m) => m.untilStartOf !== p);
  if (state.restrictions?.length) state.restrictions = state.restrictions.filter((r) => r.untilStartOf !== p);
  if (state.onPlayNegated?.length) state.onPlayNegated = state.onPlayNegated.filter((n) => n.untilStartOf !== p);
  for (const x of [...state.modifiers, ...(state.restrictions ?? []), ...(state.onPlayNegated ?? [])]) {
    if (x.untilEndOf !== p) continue;
    x.untilTurn = state.turn;
    delete x.untilEndOf;
  }
}

/**
 * Até quando vale um efeito "until the end of your opponent's next turn" / "until … your next turn" de
 * `controller`. Com dois jogadores, o número do turno. Com mais, o turno de quem o encerra: "until the
 * end of your opponent's turn" vale até o seu turno recomeçar (cobre o turno de todos os oponentes).
 */
export function setExpiry(state: GameState, controller: PlayerId, x: import('../types').Expiry, duration: import('../types').Duration | undefined) {
  const mine = state.activePlayer === controller;
  if (duration === 'nextOpponentTurn') {
    if (!isMultiplayer(state)) {
      // No seu turno: acaba no fim do próximo turno (do oponente). No turno do oponente: no fim do turno seguinte a ele.
      x.untilTurn = state.turn + (mine ? 1 : 2);
    } else {
      // Manual do formato: "until the end of your opponent's turn" vale até o começo do seu turno.
      x.untilTurn = FAR_TURN;
      x.untilStartOf = controller;
    }
  } else if (duration === 'untilYourNextTurn' || duration === 'endOfYourNextTurn') {
    if (!isMultiplayer(state)) {
      // Turno em que começa o seu próximo turno.
      x.untilTurn = state.turn + (mine ? 2 : 1);
    } else {
      x.untilTurn = FAR_TURN;
      if (duration === 'untilYourNextTurn') x.untilStartOf = controller;
      else x.untilEndOf = controller;
    }
  }
}
