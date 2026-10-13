import {
  type Action,
  actingPlayer,
  actionFromView,
  applyAction,
  type BotLevel,
  chooseBotAction,
  chooseSimpleBotAction,
  createGame,
  type DeckList,
  type GameConfig,
  type GameState,
  hiddenDecision,
  identityAliases,
  type PlayerId,
  REPLAY_VERSION,
  ReplayCursor,
  viewFor,
} from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormatId } from '../api';
import { t } from '../i18n';
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
  /** Nível do bot (padrão `hard`). */
  botLevel?: BotLevel;
  /** Replay: começa pausado (passo a passo) ou rodando, e em que velocidade. */
  replayStart?: { paused: boolean; speed: number };
  /** Aviso mostrado na mesa ao começar (ex.: a transmissão não abriu e o treino roda no navegador). */
  notice?: string;
}

export interface ReplayFile {
  format: 'gumgumfight-replay';
  /**
   * 2: a etapa de Counter e a carta da Vida sempre geram uma ação (`pass` / `answer`).
   * 3: "pagar X?" sem como pagar e escolhas na mão ou no deck sem opção também (`answer` / `choose`).
   * 4: efeitos disparados resolvem em fila (CR 8-6) e a ordem entre efeitos simultâneos do mesmo
   *    jogador gera uma ação (`option`).
   * 5: DON!! −X pergunta quais DON!! devolver quando há mais de uma forma (`option`).
   * 6: escolha de alvos sem "up to" exige o máximo possível (8-4-4-1); a gravada com menos é completada.
   * 7: todas as substituições ("… instead") são oferecidas, em toda remoção do campo (`answer`); a
   *    pergunta que o roteiro antigo não tem é recusada.
   * 8: "rest … DON!! cards or Characters" oferece a substituição de rest (`answer`), recusada nos antigos.
   * 9: a Vida inicial com a carta do topo do deck por baixo e o "at the start of the game" do Líder
   *    depois da escolha de quem começa, com escolha (`choose`); os antigos usam `legacySetup`.
   * 10: "draw up to N cards" pergunta antes de cada carta se compra (`answer`); nos antigos, sim.
   * 11: auditoria das cartas: "up to N" nos passos de Vida e em "give up to N rested DON!!", "rest N of your
   *    cards" com DON!!, "your opponent's cards" com DON!!, "reveal … play up to 1", "you may deal 1 damage" e topo ou fundo da Vida
   *    perguntam (`option`/`answer`); nos antigos, a resposta que o motor dava sozinho (`upgradeReplayActions`).
   */
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  seed: number;
  /** Partidas online: seed de 128 bits. */
  seed128?: number[];
  /** As listas exatas usadas (online sempre; no navegador, nos replays baixados desde o card 73). */
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
  /** Replay: a mesa pulou para esta posição (voltou ou avançou mais de uma ação), sem animação. */
  jump?: boolean;
}

const MAX_HISTORY = 400;

/**
 * Jogada do bot a partir da visão dele (como no servidor): ele não enxerga a mão nem o deck do humano.
 * Se a tradução de volta falhar (não deveria), o bot heurístico decide pelo estado completo para a
 * partida não travar.
 */
function botAction(state: GameState, p: PlayerId, level: BotLevel): Action {
  const aliases = identityAliases(state);
  const real = actionFromView(state, aliases, chooseBotAction(viewFor(state, p, aliases), p, level));
  return typeof real === 'string' ? chooseSimpleBotAction(state, p) : real;
}
/** Faixa de tempo (ms) do bot nas decisões que escondem informação (Counter, carta da Vida). */
const HIDDEN_DECISION_MS = [800, 2000] as const;


/** Velocidades oferecidas no replay (a partida contra o bot usa as do meio). */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

export function useGame(setup: GameSetup) {
  /** Estado inicial da partida (para exportar o replay). */
  const startRef = useRef<GameState | null>(null);
  /** Replay: posição no roteiro, com avançar, voltar e pular para qualquer ação. */
  const cursorRef = useRef<ReplayCursor | null>(null);
  /** Replay (automático): quando (`performance.now()`) a próxima ação do roteiro será aplicada; null se nada está agendado. */
  const dueRef = useRef<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>(() => {
    const initial = createGame(setup.config);
    startRef.current = initial;
    if (setup.mode === 'replay') cursorRef.current = new ReplayCursor(initial, setup.script ?? []);
    return [{ state: initial, action: null }];
  });
  const state = entries[entries.length - 1].state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef<Action[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(setup.replayStart?.paused ?? false);
  const [speed, setSpeed] = useState(setup.replayStart?.speed ?? 1);
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

  /** Replay: vai para a posição `n` do roteiro (0 = início da partida). */
  const seek = useCallback((n: number) => {
    const c = cursorRef.current;
    if (!c) return;
    const before = c.pos;
    const next = c.seek(n);
    // O motivo aparece só onde o replay para (o motor recusou a ação seguinte).
    const failure = c.failed && c.pos === c.failed.index ? t('replay.stopsAt', { n: c.failed.index + 1, message: c.failed.message }) : null;
    if (c.pos === before) {
      if (failure) setError(failure);
      return;
    }
    stateRef.current = next;
    actionsRef.current = c.actions.slice(0, c.pos);
    setEntries([{ state: next, action: c.actions[c.pos - 1] ?? null, jump: c.pos !== before + 1 }]);
    setError(failure || null);
  }, []);

  // Bots e replay agem sozinhos, com um pequeno atraso para a jogada ser visível.
  useEffect(() => {
    dueRef.current = null;
    if (state.phase === 'gameover' || paused || hold) return;
    const cursor = cursorRef.current;
    const p = actingPlayer(state);
    let next: Action | undefined;
    if (cursor) {
      if (cursor.pos < cursor.end) next = cursor.actions[cursor.pos];
    } else if (p !== null && (state.players[p].isBot || (auto && p === human))) {
      next = botAction(state, p, setup.botLevel ?? 'hard');
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
    // No replay, depois de as cartas pousarem ainda há tempo de ver o clique do jogador (ReplayCue).
    const delay = Math.max(base / speed, motionWait() + 120 + (cursor ? 420 / speed : 0));
    // A mesa mostra o clique do jogador (ReplayCue) sincronizado com este momento.
    if (cursor) dueRef.current = performance.now() + delay;
    const t = setTimeout(() => (cursor ? seek(cursor.pos + 1) : dispatch(next!)), delay);
    return () => {
      clearTimeout(t);
      dueRef.current = null;
    };
  }, [state, paused, hold, speed, setup, dispatch, seek, auto, human]);
  const dueAt = useCallback(() => dueRef.current, []);

  const exportReplay = useCallback((): ReplayFile => {
    const first = startRef.current!;
    const { config } = setup;
    return {
      format: 'gumgumfight-replay',
      // Um replay antigo (preparação antiga) continua com a versão 8 ao ser exportado de novo.
      version: first.legacySetup ? 8 : REPLAY_VERSION,
      seed: first.seed,
      ...(config.seed128 ? { seed128: config.seed128 } : {}),
      // As listas vão junto: o replay abre mesmo se o deck for apagado ou for de outra conta.
      decks: [config.players[0].deck, config.players[1].deck],
      firstPlayer: config.firstPlayer ?? stateRef.current.firstPlayer,
      ...(first.rollWinner !== undefined ? { chooseFirst: true } : {}),
      names: [first.players[0].name, first.players[1].name],
      deckIds: setup.deckIds,
      // No replay, o roteiro inteiro (não só até a posição atual).
      actions: cursorRef.current ? [...cursorRef.current.actions] : actionsRef.current,
    };
  }, [setup]);

  /** Todas as ações da partida até agora (para as estatísticas do fim de jogo). */
  const actions = useCallback(() => actionsRef.current, []);

  const cursor = cursorRef.current;
  const replay = cursor
    ? {
        pos: cursor.pos,
        total: cursor.actions.length,
        end: cursor.end,
        seek,
        // Linhas do histórico que a ação atual escreveu (a partir desta).
        logFrom: cursor.previous ? cursor.previous.log.length : null,
        // A próxima ação do roteiro: a mesa mostra o clique/seleção do jogador antes de aplicá-la.
        next: cursor.pos < cursor.end ? cursor.actions[cursor.pos] : undefined,
        dueAt,
      }
    : undefined;

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
    replay,
    jumped: entries[entries.length - 1].jump ?? false,
  };
}
