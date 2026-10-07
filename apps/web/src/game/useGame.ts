import {
  type Action,
  actingPlayer,
  applyAction,
  chooseBotAction,
  createGame,
  type DeckList,
  type GameConfig,
  type GameState,
  hiddenDecision,
  type PlayerId,
  REPLAY_VERSION,
} from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormatId } from '../api';
import { motionWait } from './motion';

export type GameMode = 'bot' | 'replay';

export interface GameSetup {
  mode: GameMode;
  config: GameConfig;
  deckIds: [string, string];
  /** Formato escolhido no menu (vai para as estatísticas). */
  format: FormatId;
  /** Ações gravadas (modo replay / roteiro). */
  script?: Action[];
}

export interface ReplayFile {
  format: 'gumgumfight-replay';
  /**
   * 2: a etapa de Counter e a carta da Vida sempre geram uma ação (`pass` / `answer`).
   * 3: "pagar X?" sem como pagar e escolhas na mão ou no deck sem opção também (`answer` / `choose`).
   * 4: efeitos disparados resolvem em fila (CR 8-6) e a ordem entre efeitos simultâneos do mesmo
   *    jogador gera uma ação (`option`).
   */
  version: 1 | 2 | 3 | 4;
  seed: number;
  /** Partidas online: seed de 128 bits e as listas exatas usadas. */
  seed128?: number[];
  decks?: [DeckList, DeckList];
  firstPlayer: PlayerId;
  /** O vencedor do sorteio escolheu quem começa: `firstPlayer` é só informativo. */
  chooseFirst?: boolean;
  names: [string, string];
  deckIds: [string, string];
  actions: Action[];
}

interface Entry {
  state: GameState;
  action: Action | null;
}

const MAX_HISTORY = 400;
/** Faixa de tempo (ms) do bot nas decisões que escondem informação (Counter, carta da Vida). */
const HIDDEN_DECISION_MS = [800, 2000] as const;


export function useGame(setup: GameSetup) {
  const [entries, setEntries] = useState<Entry[]>(() => [{ state: createGame(setup.config), action: null }]);
  const state = entries[entries.length - 1].state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef<Action[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  /** "Auto": o bot joga pelo humano até o modo ser desligado. */
  const [auto, setAuto] = useState(false);
  /** A mesa segura o bot (sorteio inicial na tela). */
  const [hold, setHold] = useState(false);

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
    if (state.phase === 'gameover' || paused || hold) return;
    const p = actingPlayer(state);
    if (p === null) return;
    let next: Action | undefined;
    if (setup.mode === 'replay') {
      next = setup.script?.[actionsRef.current.length];
    } else if (state.players[p].isBot || (auto && p === human)) {
      next = chooseBotAction(state, p);
    }
    if (!next) return;
    // Espera as cartas pousarem antes da próxima jogada.
    // A escolha de quem começa demora um pouco mais (dá tempo de ver quem venceu o sorteio).
    // Counter, carta da Vida, "pagar X?" e escolhas na mão ou no deck: tempo aleatório, para a
    // pressa (ou a demora) do bot não contar se ele tinha o que usar.
    const kind = state.pending?.kind;
    const base =
      setup.mode !== 'replay' && hiddenDecision(state.pending)
        ? HIDDEN_DECISION_MS[0] + Math.random() * (HIDDEN_DECISION_MS[1] - HIDDEN_DECISION_MS[0])
        : kind === 'chooseFirst'
          ? 1300
          : state.pending
            ? 500
            : 800;
    const delay = Math.max(base / speed, motionWait() + 120);
    const t = setTimeout(() => dispatch(next!), delay);
    return () => clearTimeout(t);
  }, [state, paused, hold, speed, setup, dispatch, auto, human]);

  const exportReplay = useCallback((): ReplayFile => {
    const first = entries[0].state;
    return {
      format: 'gumgumfight-replay',
      version: REPLAY_VERSION,
      seed: first.seed,
      firstPlayer: entries[entries.length - 1].state.firstPlayer,
      ...(first.rollWinner !== undefined ? { chooseFirst: true } : {}),
      names: [first.players[0].name, first.players[1].name],
      deckIds: setup.deckIds,
      actions: actionsRef.current,
    };
  }, [entries, setup.deckIds]);

  /** Todas as ações da partida até agora (para as estatísticas do fim de jogo). */
  const actions = useCallback(() => actionsRef.current, []);

  return {
    state,
    dispatch,
    error,
    setError,
    human,
    paused,
    setPaused,
    speed,
    setSpeed,
    auto,
    setAuto,
    setHold,
    undo,
    canUndo,
    exportReplay,
    actions,
  };
}
