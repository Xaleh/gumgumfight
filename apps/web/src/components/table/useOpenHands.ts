// Visão do Streamer: as mãos minimizadas dos jogadores, que abrem em leque ao clicar.

import type { PlayerId } from '@gumgum/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineGame } from '../../game/useOnlineGame';

export function useOpenHands(online: OnlineGame | undefined, spectator: { canHands: boolean; onToggleHands: () => void } | undefined) {
  /**
   * Visão do Streamer: as mãos abertas no leque (as duas podem ficar abertas ao mesmo tempo) e as que
   * estão virando de volta antes de sumir.
   */
  const [openHands, setOpenHands] = useState<PlayerId[]>([]);
  const [closingHands, setClosingHands] = useState<PlayerId[]>([]);
  const openHandsRef = useRef(openHands);
  openHandsRef.current = openHands;
  const closeTimers = useRef<Partial<Record<PlayerId, ReturnType<typeof setTimeout>>>>({});
  const closeHand = useCallback((p: PlayerId) => {
    setOpenHands((o) => o.filter((x) => x !== p));
    setClosingHands((c) => (c.includes(p) ? c : [...c, p]));
    clearTimeout(closeTimers.current[p]);
    closeTimers.current[p] = setTimeout(() => setClosingHands((c) => c.filter((x) => x !== p)), 480);
  }, []);
  const closeHands = useCallback(() => openHandsRef.current.forEach(closeHand), [closeHand]);
  useEffect(() => () => Object.values(closeTimers.current).forEach(clearTimeout), []);
  /**
   * Visão do Streamer: clique na mão minimizada de um jogador abre o leque dela (a do outro continua
   * como está, para ver as duas juntas); outro clique na mesma mão fecha o leque.
   * Se o servidor ainda não manda as mãos, o mesmo clique liga "Ver mãos" (a mesa passa a ser a
   * atrasada) e o leque abre quando as cartas chegarem.
   */
  const toggleHand = (p: PlayerId) => {
    if (openHands.includes(p)) return closeHand(p);
    clearTimeout(closeTimers.current[p]);
    setClosingHands((c) => c.filter((x) => x !== p));
    setOpenHands((o) => [...o, p]);
    if (online && !online.hands && spectator?.canHands) spectator.onToggleHands();
  };
  // "Ver mãos" desligado no canto: os leques abertos viram de volta e somem.
  const hadHands = useRef(Boolean(online?.hands));
  useEffect(() => {
    const has = Boolean(online?.hands);
    if (hadHands.current && !has) closeHands();
    hadHands.current = has;
  }, [online?.hands, closeHands]);
  /** Os leques na tela: os abertos e os que estão virando de volta. */
  const fanPlayers = ([0, 1] as PlayerId[]).filter((p) => openHands.includes(p) || closingHands.includes(p));
  return { openHands, toggleHand, fanPlayers };
}
