// Pilha de resolução: `run` resolve os frames até a pilha esvaziar ou alguém precisar decidir.

import type { EffectStep, GameState, PlayerId } from '../types';
import { MAX_CHARACTERS, type PlayFrame } from './constants';
import { lg, log, pr, promptOf } from './messages';
import { cardDef, leaderRule, ownerOf } from './queries';
import { forgetCard } from './options';
import { finishStartOfGame } from './setup';
import { endTurn, refreshDrawDon } from './turn';
import { emit, nextTriggered, pushAbilities, queueDelayed } from './triggers';
import { stepBattle, stepDamage } from './battle';
import { stepEffect } from './effects';
import { removeCharacter } from './removal';
import { limboToTrash } from './zones';
import { checkDefeat, gameOver } from './defeat';

export function run(state: GameState) {
  let guard = 0;
  while (!state.pending && (state.stack.length || state.triggered?.length) && state.phase !== 'gameover') {
    if (++guard > 5000) {
      // Laço infinito (11-1): o motor não sabe pará-lo, então a partida termina empatada.
      state.stack = [];
      state.triggered = [];
      gameOver(state, null, lg('winInfiniteLoop', 'Laço infinito na resolução de efeitos.'));
      break;
    }
    // Efeitos disparados entram na pilha um de cada vez, quando chega a vez deles (8-6).
    if (nextTriggered(state)) continue;
    if (!state.stack.length) break;
    const frame = state.stack[state.stack.length - 1];
    switch (frame.kind) {
      case 'effect':
        stepEffect(state, frame);
        break;
      case 'battle':
        stepBattle(state);
        break;
      case 'damage':
        stepDamage(state, frame);
        break;
      case 'play':
        stepPlay(state, frame);
        break;
      case 'endTurn':
        // "… at the end of this turn" (6-6-1-2): depois de todos os [End of …] e do que eles
        // dispararam. Os criados agora (por um [End of Your Turn] ou por outro efeito adiado)
        // também resolvem nesta End Phase, não no fim do turno seguinte.
        if (state.delayed?.length) {
          queueDelayed(state, state.delayed);
          state.delayed = [];
          break;
        }
        state.stack.pop();
        endTurn(state);
        break;
      case 'refresh':
        state.stack.pop();
        refreshDrawDon(state);
        break;
      case 'startGame':
        state.stack.pop();
        finishStartOfGame(state);
        break;
    }
    checkDefeat(state);
    // Mesa com mais de dois: um efeito que pede uma decisão a quem já saiu da mesa (eliminado no
    // meio do efeito) não segue.
    const waiting = state.pending as GameState['pending'];
    if (waiting && state.players[waiting.player]?.out) {
      state.pending = null;
      const top = state.stack[state.stack.length - 1];
      if (top?.kind === 'effect') {
        state.stack.pop();
        if (top.trigger) limboToTrash(state, top.source);
      }
    }
  }
}

export function pushEffect(state: GameState, source: string, controller: PlayerId, steps: EffectStep[]) {
  if (steps.length) state.stack.push({ kind: 'effect', source, controller, steps: [...steps], i: 0 }); // cópia: passos podem ser inseridos durante a resolução
}

function stepPlay(state: GameState, frame: PlayFrame) {
  const owner = ownerOf(state, frame.uid);
  const ps = state.players[owner];
  if (ps.characters.length >= MAX_CHARACTERS) {
    if (!frame.replaceChoice) {
      state.pending = {
        kind: 'selectTargets',
        player: owner,
        options: ps.characters.map((c) => c.uid),
        min: 1,
        max: 1,
        ...promptOf(pr('characterAreaFull', 'Área de personagens cheia: escolha um personagem para descartar.')),
        intent: 'discard',
        source: frame.uid,
      };
      return;
    }
    const out = frame.replaceChoice[0];
    const fc = ps.characters.find((c) => c.uid === out)!;
    ps.donRested += fc.don;
    removeCharacter(state, out);
    ps.trash.push(out);
    log(state, owner, lg('trashedForRoom', `${cardDef(state, out).name} é descartado para abrir espaço.`, { card: cardDef(state, out).name }), { cards: [out] });
  }
  const rested = Boolean(frame.rested) || Boolean(leaderRule(state, owner, 'playRested'));
  forgetCard(state, frame.uid);
  ps.characters.push({ uid: frame.uid, rested, don: 0, playedOnTurn: state.turn });
  state.stack.pop();
  pushAbilities(state, frame.uid, 'onPlay');
  emit(state, {
    kind: 'characterPlayed',
    player: owner,
    card: frame.uid,
    from: frame.from,
    byEffect: frame.byEffect,
    fromHand: frame.fromHand,
    byCharacterEffect: frame.byCharacterEffect,
  });
}
