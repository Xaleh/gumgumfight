// Baixa antes as imagens das cartas da partida, quando o navegador está ocioso.
//
// Sem isto a imagem só era pedida quando a carta aparecia, muitas vezes já voando (comprar uma carta,
// a vitrine no centro da mesa): ela voava em branco e a arte surgia no meio do caminho. Só entram as
// cartas que este jogador já enxerga no estado (no online, a visão dele), em ordem alfabética das URLs,
// sem dizer nada da ordem do deck.

import { cardImage, type GameState, HIDDEN_CARD } from '@gumgum/engine';
import { useEffect } from 'react';

/** Downloads ao mesmo tempo (o resto espera a vez, sem disputar a rede com a partida). */
const PARALLEL = 3;
const requested = new Set<string>();
const queue: string[] = [];
let running = 0;
let scheduled = false;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };

function schedule() {
  if (scheduled || !queue.length || running >= PARALLEL) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    pump();
  };
  const w = window as IdleWindow;
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 200);
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const url = queue.shift()!;
    running++;
    const img = new Image();
    // Os mesmos atributos do <img> da carta (CardView), para a resposta servir do cache.
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    const done = () => {
      img.onload = img.onerror = null;
      running--;
      schedule();
    };
    img.onload = done;
    img.onerror = done;
    img.src = url;
  }
}

/** Pré-carrega as imagens das cartas visíveis em `state` que ainda não foram pedidas. */
export function usePreloadCardImages(state: GameState, on: boolean) {
  useEffect(() => {
    if (!on || typeof window === 'undefined') return;
    const fresh: string[] = [];
    for (const uid of Object.keys(state.cards)) {
      if (state.defs[state.cards[uid].cardId]?.id === HIDDEN_CARD) continue;
      const url = cardImage(state, uid);
      if (url && !requested.has(url)) {
        requested.add(url);
        fresh.push(url);
      }
    }
    if (!fresh.length) return;
    queue.push(...fresh.sort());
    schedule();
  }, [state, on]);
}
