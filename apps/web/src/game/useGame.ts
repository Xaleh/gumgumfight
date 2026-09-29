import {
  type Action,
  actingPlayer,
  applyAction,
  chooseBotAction,
  createGame,
  type GameConfig,
  type GameState,
  type PlayerId,
} from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';

export type GameMode = 'bot' | 'demo' | 'replay';

export interface GameSetup {
  mode: GameMode;
  config: GameConfig;
  deckIds: [string, string];
  /** Ações gravadas (modo replay / roteiro). */
  script?: Action[];
}

export interface ReplayFile {
  format: 'gumgumfight-replay';
  version: 1;
  seed: number;
  firstPlayer: PlayerId;
  names: [string, string];
  deckIds: [string, string];
  actions: Action[];
}

interface Entry {
  state: GameState;
  action: Action | null;
}

const MAX_HISTORY = 400;

export function useGame(setup: GameSetup) {
  const [entries, setEntries] = useState<Entry[]>(() => [{ state: createGame(setup.config), action: null }]);
  const state = entries[entries.length - 1].state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef<Action[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);

  const human: PlayerId | null = setup.mode === 'bot' ? 0 : null;

  const dispatch = useCallback((action: Action) => {
    try {
      const next = applyAction(stateRef.current, action);
      stateRef.current = next;
      actionsRef.current = [...actionsRef.current, action];
      setEntries((h) => [...h.slice(-MAX_HISTORY), { state: next, action }]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Volta para antes da última ação do jogador humano. */
  const undo = useCallback(() => {
    if (human === null) return;
    setEntries((h) => {
      const copy = [...h];
      let removed = 0;
      while (copy.length > 1 && copy[copy.length - 1].action?.player !== human) {
        copy.pop();
        removed++;
      }
      if (copy.length > 1) {
        copy.pop();
        removed++;
      }
      actionsRef.current = actionsRef.current.slice(0, actionsRef.current.length - removed);
      stateRef.current = copy[copy.length - 1].state;
      return copy;
    });
    setError(null);
  }, [human]);

  const canUndo = human !== null && entries.some((e) => e.action?.player === human);

  // Bots e replay agem sozinhos, com um pequeno atraso para a jogada ser visível.
  useEffect(() => {
    if (state.phase === 'gameover' || paused) return;
    const p = actingPlayer(state);
    if (p === null) return;
    let next: Action | undefined;
    if (setup.mode === 'replay') {
      next = setup.script?.[actionsRef.current.length];
    } else if (state.players[p].isBot) {
      next = chooseBotAction(state, p);
    }
    if (!next) return;
    const delay = (state.pending ? 500 : 800) / speed;
    const t = setTimeout(() => dispatch(next!), delay);
    return () => clearTimeout(t);
  }, [state, paused, speed, setup, dispatch]);

  const exportReplay = useCallback((): ReplayFile => {
    const first = entries[0].state;
    return {
      format: 'gumgumfight-replay',
      version: 1,
      seed: first.seed,
      firstPlayer: first.firstPlayer,
      names: [first.players[0].name, first.players[1].name],
      deckIds: setup.deckIds,
      actions: actionsRef.current,
    };
  }, [entries, setup.deckIds]);

  return { state, dispatch, error, setError, human, paused, setPaused, speed, setSpeed, undo, canUndo, exportReplay };
}
