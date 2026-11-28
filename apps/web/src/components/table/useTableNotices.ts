// Os avisos da mesa que saem do histórico: a linha que explica por que algo não aconteceu (`notice`) e as cartas
// que o oponente revelou (`reveals`).

import type { CardDef } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import { logText } from '../../game/engineText';
import { useSettings } from '../../settings';
import type { TableGame } from '../GameScreen';
import { mergeReveals, type RevealLine } from './CardZoom';
import type { TryT } from './shared';

/**
 * Linhas do histórico que viram aviso na mesa (ver `notice` abaixo): pela chave do motor
 * (`LogEntry.key`); linhas sem chave (estados salvos antes das chaves) pelo texto em português.
 */
const NOTICE_KEYS = new Set([
  'log.conditionFails',
  'log.lapsedCondition',
  'log.lapsedConditionTagged',
  'log.onKoConditionFails',
  'log.cannotBlockCannotRest',
  'log.cannotBlock',
  'log.cannotBeRestedActive',
  'log.cannotBeRestedByOpponent',
  'log.retarget',
]);
const NOTICE_RE = /a condição não vale|não pode bloquear|não pode ser virada|não pode ativar \[Blocker\]|o ataque passa a mirar/;
/** A linha do histórico explica por que algo não aconteceu? (A mesa de Yonko usa a mesma lista: `useYonkoNotices`.) */
export const isNotice = (e: { key?: string; text: string }) => (e.key ? NOTICE_KEYS.has(e.key) : NOTICE_RE.test(e.text));

export function useTableNotices({
  game,
  tryT,
  startNotice,
  tutorial,
  broadcast,
  spectator,
}: {
  game: TableGame;
  tryT: TryT;
  /** Aviso na mesa ao começar (some sozinho em 10 s). */
  startNotice?: string;
  /** Lição do tutorial e tela de transmissão: sem as cartas reveladas. */
  tutorial: boolean;
  broadcast: boolean;
  /** Quem assiste (o objeto do modo espectador, como a mesa o recebe): vê as revelações dos dois lados. */
  spectator: object | undefined;
}) {
  const { state, human } = game;
  const { animations } = useSettings();
  /** Animações completas: o [Trigger] do oponente já aparece no centro da mesa. */
  const showy = animations === 'full';
  /**
   * Aviso curto na mesa para as linhas do histórico que explicam por que algo não aconteceu
   * (condição de efeito que não vale, [Blocker] que não pode bloquear, carta que não pode ser
   * virada). No celular o histórico fica atrás de um botão, e sem o aviso parece que o jogo ignorou a jogada.
   */
  const [notice, setNotice] = useState<string | null>(startNotice ?? null);
  useEffect(() => {
    if (!startNotice) return;
    const t = setTimeout(() => setNotice((n) => (n === startNotice ? null : n)), 10_000);
    return () => clearTimeout(t);
  }, [startNotice]);
  const noticeSeen = useRef(state.log.length);
  useEffect(() => {
    // Replay: num pulo, as linhas puladas não viram aviso.
    if (game.jumped) {
      noticeSeen.current = state.log.length;
      return;
    }
    if (noticeSeen.current > state.log.length) noticeSeen.current = 0; // desfazer / replay
    const fresh = state.log.slice(noticeSeen.current);
    noticeSeen.current = state.log.length;
    const hit = [...fresh].reverse().find(isNotice);
    if (!hit) return;
    setNotice(logText(tryT, hit));
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [state.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Cartas que o oponente revelou (busca no deck, carta da mão, topo do deck…): aparecem na mesa até o
   * jogador fechar. Sem isso só o histórico dizia qual carta foi, e a carta some na mão do oponente.
   * O [Trigger] do oponente também aparece aqui quando as animações estão desligadas.
   * Não aparece para quem escolheu a carta (já a viu), no tutorial, no replay nem na tela de transmissão
   * (ninguém fecha). Para quem assiste (o streamer) aparecem as revelações dos dois lados, e somem
   * sozinhas depois de um tempo.
   */
  const [reveals, setReveals] = useState<RevealLine[]>([]);
  const revealSeen = useRef(state.log.length);
  useEffect(() => {
    if (revealSeen.current > state.log.length) {
      revealSeen.current = state.log.length; // desfazer / replay: nada de avisos antigos
      setReveals([]);
      return;
    }
    const fresh = state.log.slice(revealSeen.current);
    revealSeen.current = state.log.length;
    if (game.jumped || tutorial || broadcast || (human === null && !spectator)) return;
    const lines = fresh.flatMap((e): RevealLine[] => {
      if (!e.revealed?.length || e.revealedBy === human) return [];
      // [Trigger] do oponente: com as animações completas a carta já aparece no centro da mesa.
      if (e.key === 'log.triggerActivated' && showy) return [];
      const cards = e.revealed.map((id) => state.defs[id]).filter((d): d is CardDef => Boolean(d));
      return cards.length ? [{ text: logText(tryT, e), cards, count: 1 }] : [];
    });
    if (lines.length) setReveals((r) => mergeReveals(r, lines));
  }, [state.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Quem assiste não precisa clicar: o aviso some sozinho (o streamer pode fechar antes).
  useEffect(() => {
    if (!spectator || reveals.length === 0) return;
    const timer = setTimeout(() => setReveals([]), 12_000);
    return () => clearTimeout(timer);
  }, [spectator, reveals]);
  return { notice, setNotice, reveals, setReveals };
}
