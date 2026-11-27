// Tipos e ajudantes que a mesa (`Table`, em ./Table.tsx) e os componentes em volta dela dividem: o modo da
// mesa, o arrasto, as folhas e os painéis abertos, e o texto das perguntas do motor no idioma da interface.

import { cardDef, type GameState, type MsgList, type MsgParts, type PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { type Translate, useTryT } from '../../i18n';
import { msgText } from '../../game/engineText';

/**
 * Modo 'don': DON!! ativos marcados para anexar de uma vez (modelo do OPTCG Sim). `picked` guarda a posição dos
 * DON!! marcados na fileira: tocar no 3º marca os 3 primeiros. O Líder e os Personagens que podem receber DON!!
 * ficam destacados e o toque num deles anexa todos os marcados; a faixa central mostra quantos são.
 */
export type Mode = null | { kind: 'attack'; attacker: string } | { kind: 'don'; picked: number[] };
/** attached = DON!! anexado numa carta, arrastado de volta para a área de custo (detachDon). */
export type DragKind = 'hand' | 'attacker' | 'don' | 'attached';
export interface Drag {
  kind: DragKind;
  uid: string | null;
  x: number;
  y: number;
  /** Carta (uid), 'field' ou 'hand' sob o dedo, se for um destino válido. */
  over: string | null;
  /** Posição na mão onde a carta arrastada vai entrar (reorganizar). */
  insert?: number;
  /** Quantos DON!! estão sendo arrastados juntos. */
  count?: number;
  /** Posições na fileira dos DON!! arrastados (ficam apagados enquanto o arrasto dura). */
  dons?: number[];
}
export type Sheet = null | 'menu' | 'log' | 'hand' | 'coach' | 'layout' | { trash: PlayerId };
/** Painel lateral no desktop: do Streamer (histórico, partidas, decklists) ou de quem joga (histórico, a própria decklist). */
export type Panel = null | 'log' | 'matches' | 'deck' | 'coach';

export type TryT = ReturnType<typeof useTryT>;
/** Campos que o motor passa a mandar junto das perguntas e das habilidades: a chave do texto no dicionário e os parâmetros. */
export interface Keyed {
  promptKey?: string;
  promptParams?: Record<string, string | number>;
  promptParts?: MsgParts;
}
export interface KeyedOptions {
  optionKeys?: (string | null)[];
  optionParts?: (MsgList | null)[];
}
export interface KeyedLabel {
  labelKey?: string;
  labelParams?: Record<string, string | number>;
}

/**
 * Texto de uma pergunta do motor no idioma da interface: a tradução da chave (`promptKey`), quando o motor
 * a manda e o dicionário a conhece; senão o texto que veio junto (`prompt`).
 */
export function promptText(tryT: TryT, pending: { prompt: string }): string {
  const p = pending as typeof pending & Keyed & { cannot?: true };
  const text = msgText(tryT, p.promptKey, p.promptParams, p.promptParts);
  if (text === undefined) return p.prompt;
  // `confirm` com `cannot`: o motor junta "(Não dá para pagar o custo.)" ao texto, mas não à chave.
  return p.cannot ? `${text} ${tryT('engine.cannotPayCost') ?? ''}`.trim() : text;
}

/** Ordem marcada numa escolha ordenada: "1. Carta → 2. Carta". */
export function orderText(t: Translate, state: GameState, picked: string[]): string {
  return picked.map((u, i) => t('game.orderItem', { n: i + 1, name: cardDef(state, u).name })).join(' → ');
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
