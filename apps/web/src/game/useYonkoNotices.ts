// Os avisos da mesa de Yonko que saem do registro, como na mesa de dois (`table/useTableNotices`): a linha curta que
// explica o que acabou de acontecer (ou por que não aconteceu) e as cartas que outro jogador revelou. Cada aviso
// leva o jogador da linha, para a mesa pintar com a cor do lugar dele.

import type { CardDef, GameState, PlayerId } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import { isNotice } from '../components/table/useTableNotices';
import type { TryT } from '../components/table/shared';
import { logText } from './engineText';

export interface YonkoNotice {
  text: string;
  /** De quem é a linha (a cor do lugar); `null`: uma linha da mesa. */
  player: PlayerId | null;
}

export interface YonkoReveal extends YonkoNotice {
  cards: CardDef[];
  /** Quantas vezes a mesma linha se repetiu antes de o aviso ser fechado. */
  count: number;
}

/** Quanto tempo o aviso curto fica na mesa (ms). */
const NOTICE_MS = 6000;

/**
 * `notice`: a última linha que explica por que algo não aconteceu (a condição que não vale, o [Blocker] que não
 * pode bloquear…) ou para quem valeu um efeito escrito para "o oponente" (`log.effectHits`): some sozinha.
 * `reveals`: as cartas que outro jogador revelou (a busca no deck, uma carta da mão, o topo do deck…), até quem
 * joga fechar; não entram as que ele mesmo escolheu (já viu) nem, com as animações completas, o [Trigger] de um
 * oponente (a carta já aparece no centro da mesa).
 */
export function useYonkoNotices(s: GameState, me: PlayerId, tryT: TryT, showy: boolean) {
  const [notice, setNotice] = useState<YonkoNotice | null>(null);
  const [reveals, setReveals] = useState<YonkoReveal[]>([]);
  const seen = useRef(s.log.length);

  useEffect(() => {
    // Partida nova na mesma mesa (o registro recomeça): nada de avisos antigos.
    if (seen.current > s.log.length) {
      seen.current = s.log.length;
      setNotice(null);
      setReveals([]);
      return;
    }
    const fresh = s.log.slice(seen.current);
    seen.current = s.log.length;
    if (!fresh.length) return;

    const lines = fresh.flatMap((e): YonkoReveal[] => {
      if (!e.revealed?.length || e.revealedBy === me) return [];
      if (e.key === 'log.triggerActivated' && showy) return [];
      const cards = e.revealed.map((id) => s.defs[id]).filter((d): d is CardDef => Boolean(d));
      return cards.length ? [{ text: logText(tryT, e), player: e.player, cards, count: 1 }] : [];
    });
    if (lines.length) {
      setReveals((open) => {
        const out = [...open];
        for (const line of lines) {
          const i = out.findIndex((l) => l.text === line.text);
          if (i < 0) out.push(line);
          else out[i] = { ...out[i], cards: [...out[i].cards, ...line.cards], count: out[i].count + 1 };
        }
        return out;
      });
    }

    const hit = [...fresh].reverse().find((e) => isNotice(e) || e.key === 'log.effectHits');
    if (!hit) return;
    setNotice({ text: logText(tryT, hit), player: hit.player });
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [s.log.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { notice, setNotice, reveals, setReveals };
}
