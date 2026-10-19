// Replay embutido: a ponte postMessage com a página do parceiro que abriu o iframe (protocolo em
// `embed.ts`). Recebe `seek`/`play`/`pause` só da janela-mãe e das origens liberadas pelo servidor;
// avisa `ready`, `pos` e `ended` para essas mesmas origens (o navegador descarta as outras).

import type { GameState } from '@gumgum/engine';
import { useEffect, useRef } from 'react';
import type { ReplayControls } from '../components/ReplayBar';
import { EMBED_SOURCE, type EmbedEvent, embedOriginAllowed, parseEmbedCommand } from '../embed';

interface BridgeGame {
  state: GameState;
  replay?: ReplayControls;
  setPaused: (f: (p: boolean) => boolean) => void;
}

/** `origins` null: fora de um iframe de parceiro (nada a fazer). */
export function useEmbedBridge(game: BridgeGame, origins: readonly string[] | null) {
  const latest = useRef(game);
  latest.current = game;
  const framed = origins !== null && typeof window !== 'undefined' && window.parent !== window;
  const targets = useRef<string[]>([]);
  targets.current = framed ? [...new Set([...origins!, location.origin])] : [];

  const post = (msg: EmbedEvent) => {
    for (const o of targets.current) window.parent.postMessage({ source: EMBED_SOURCE, ...msg }, o);
  };
  const postRef = useRef(post);
  postRef.current = post;

  useEffect(() => {
    if (!framed) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !embedOriginAllowed(e.origin, targets.current, location.origin)) return;
      const cmd = parseEmbedCommand(e.data);
      const { replay, setPaused, state } = latest.current;
      if (!cmd || !replay) return;
      if (cmd.type === 'seek') replay.seek(Math.min(cmd.pos, replay.end));
      else if (cmd.type === 'pause') setPaused(() => true);
      else {
        // No fim, play assiste de novo desde o começo (como o ▶ da barra).
        if (replay.pos >= replay.end || state.phase === 'gameover') replay.seek(0);
        setPaused(() => false);
      }
    };
    window.addEventListener('message', onMessage);
    postRef.current({ type: 'ready', pos: latest.current.replay?.pos ?? 0, total: latest.current.replay?.total ?? 0 });
    return () => window.removeEventListener('message', onMessage);
  }, [framed]);

  const pos = game.replay?.pos ?? 0;
  const total = game.replay?.total ?? 0;
  const atEnd = Boolean(game.replay) && (pos >= (game.replay?.end ?? 0) || game.state.phase === 'gameover');
  const first = useRef(true);
  useEffect(() => {
    if (!framed) return;
    // A primeira posição já foi no `ready`.
    if (first.current) {
      first.current = false;
      return;
    }
    postRef.current({ type: 'pos', pos, total });
  }, [framed, pos, total]);
  useEffect(() => {
    if (framed && atEnd) postRef.current({ type: 'ended' });
  }, [framed, atEnd]);
}
