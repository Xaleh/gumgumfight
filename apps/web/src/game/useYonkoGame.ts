// Mesa de Yonko no navegador: uma pessoa contra bots simples. O motor roda aqui mesmo (sem servidor), e
// cada bot decide pela visão do próprio lugar. A sala online para quatro pessoas é a fase 2 do plano
// (docs/plano-modos-de-jogo.md, seção 4).

import {
  type Action,
  actingPlayer,
  applyAction,
  chooseSimpleBotAction,
  createGame,
  type GameConfig,
  type GameState,
  hiddenDecision,
  identityAliases,
  legalActions,
  type PlayerId,
  viewFor,
} from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motionWait } from './motion';

export interface YonkoSetup {
  config: GameConfig;
  /** O lugar de quem joga neste navegador (os outros são bots). */
  human: PlayerId;
  /** O deck (do menu) de onde saiu o deck de cada lugar, para "Jogar de novo". */
  deckIds: string[];
}

/** Espera antes de cada jogada de bot (ms): dá para acompanhar a mesa sem ela se arrastar. */
const BOT_MS = 650;
/** Counter, carta da Vida e outras decisões que escondem informação: um tempo que não denuncia a mão. */
const BOT_HIDDEN_MS = [700, 1300] as const;

export function useYonkoGame(setup: YonkoSetup) {
  const [full, setFull] = useState<GameState>(() => createGame(setup.config));
  const ref = useRef(full);
  ref.current = full;
  const [error, setError] = useState<string | null>(null);
  /** As jogadas dos bots esperam (a pessoa abriu o registro ou uma carta para ler). */
  const [paused, setPaused] = useState(false);
  /** A última jogada aplicada, de quem for (a mesa destaca a habilidade ativada). */
  const [lastAction, setLastAction] = useState<Action | undefined>(undefined);

  const dispatch = useCallback((action: Action) => {
    try {
      const next = applyAction(ref.current, action);
      ref.current = next;
      setFull(next);
      setLastAction(action);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (full.phase === 'gameover' || paused) return;
    const seat = actingPlayer(full);
    if (seat === null || !full.players[seat].isBot) return;
    const think = hiddenDecision(full.pending) ? BOT_HIDDEN_MS[0] + Math.random() * (BOT_HIDDEN_MS[1] - BOT_HIDDEN_MS[0]) : full.pending ? BOT_MS * 0.7 : BOT_MS;
    // Com as animações ligadas, o bot espera as cartas da jogada anterior pousarem (`holdMotion`, em Motion.tsx).
    const delay = Math.max(think, motionWait() + 180);
    const timer = setTimeout(() => {
      // O bot só enxerga o que o lugar dele enxerga.
      const view = viewFor(full, seat, identityAliases(full));
      let action: Action | undefined;
      try {
        action = chooseSimpleBotAction(view, seat);
      } catch {
        // Uma situação que o bot simples não sabe jogar: qualquer ação legal, para a mesa não parar.
        action = legalActions(view, seat).find((a) => a.type !== 'cancel');
      }
      if (action) dispatch(action);
    }, delay);
    return () => clearTimeout(timer);
  }, [full, paused, dispatch]);

  // A mesa é desenhada pela visão de quem joga: as mãos dos bots e as linhas secretas do registro ficam de fora.
  const state = useMemo(() => viewFor(full, setup.human, identityAliases(full)), [full, setup.human]);

  return { state, dispatch, error, setError, paused, setPaused, lastAction };
}
