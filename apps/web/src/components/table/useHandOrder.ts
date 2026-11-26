// A ordem em que o jogador vê a própria mão (só exibição: o motor não sabe dela).

import { cardDef, type GameState } from '@gumgum/engine';
import { useMemo, useState } from 'react';

export function useHandOrder(state: GameState, myHand: string[]) {
  /** Ordem da mão escolhida pelo jogador (só exibição). */
  const [handOrder, setHandOrder] = useState<string[]>([]);
  // Mão na ordem do jogador: cartas novas entram no fim.
  const orderedHand = useMemo(() => {
    const inHand = new Set(myHand);
    const kept = handOrder.filter((u) => inHand.has(u));
    const keptSet = new Set(kept);
    return [...kept, ...myHand.filter((u) => !keptSet.has(u))];
  }, [handOrder, myHand]);
  const reorder = (uid: string, index: number) => {
    const rest = orderedHand.filter((u) => u !== uid);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, uid);
    return rest;
  };
  /** Ordena a mão por custo (Eventos e Stages depois dos Personagens de mesmo custo) e nome; só exibição. */
  const sortHand = () => {
    const rank = (uid: string) => {
      const d = cardDef(state, uid);
      return [d.cost ?? 0, d.category === 'character' ? 0 : d.category === 'event' ? 1 : 2, d.name] as const;
    };
    setHandOrder(
      [...myHand].sort((a, b) => {
        const [ca, ka, na] = rank(a);
        const [cb, kb, nb] = rank(b);
        return ca - cb || ka - kb || na.localeCompare(nb);
      }),
    );
  };
  return { orderedHand, reorder, sortHand, setHandOrder };
}
