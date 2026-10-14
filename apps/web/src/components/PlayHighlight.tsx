// Destaque da carta jogada (tela de transmissão): a carta que acabou de entrar em jogo, ser
// usada no Counter ou ativar um efeito aparece grande por alguns segundos, do lado de quem a
// usou, para quem assiste à live ver o que aconteceu sem precisar ler o histórico.

import { type Action, cardDef, type GameState, HIDDEN_CARD, type PlayerId } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import { type MessageKey, useT } from '../i18n';
import { CardView } from './CardView';

/** Quanto tempo a carta fica na tela. */
const HOLD_MS = 2800;

export type PlayKind = 'play' | 'counter' | 'activate';

const LABEL: Record<PlayKind, MessageKey> = {
  play: 'broadcast.played',
  counter: 'broadcast.countered',
  activate: 'broadcast.activated',
};

/** A carta que a ação pôs em evidência (null se a ação não mostra carta, ou se a carta não está à vista). */
export function playedCard(state: GameState, action: Action): { uid: string; player: PlayerId; kind: PlayKind } | null {
  const hit =
    action.type === 'playCard'
      ? { uid: action.uid, kind: 'play' as const }
      : action.type === 'counter'
        ? { uid: action.uid, kind: 'counter' as const }
        : action.type === 'activate'
          ? { uid: action.uid, kind: 'activate' as const }
          : null;
  if (!hit || !state.cards[hit.uid] || cardDef(state, hit.uid).id === HIDDEN_CARD) return null;
  return { ...hit, player: action.player };
}

interface Shown {
  uid: string;
  player: PlayerId;
  kind: PlayKind;
  key: number;
}

/** A carta da última ação, ampliada; `bottom`: o jogador de baixo da mesa (a carta fica do lado de quem jogou). */
export function PlayHighlight({ state, lastAction, bottom }: { state: GameState; lastAction: Action | undefined; bottom: PlayerId }) {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  // A mesa que chega ao conectar não vira destaque: só as ações que acontecem com a tela aberta.
  const seen = useRef(state.actionCount);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (state.actionCount === seen.current) return;
    seen.current = state.actionCount;
    const hit = lastAction ? playedCard(state, lastAction) : null;
    if (!hit) return;
    const key = state.actionCount;
    clearTimeout(timer.current);
    setShown({ ...hit, key });
    timer.current = setTimeout(() => setShown((s) => (s?.key === key ? null : s)), HOLD_MS);
  }, [state, lastAction]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // A carta pode sair da vista (voltou para a mão, para o deck): o destaque some junto.
  if (!shown || !state.cards[shown.uid] || cardDef(state, shown.uid).id === HIDDEN_CARD) return null;
  return (
    <div key={shown.key} className={['play-highlight', shown.player === bottom ? 'bottom' : 'top', shown.kind].join(' ')} aria-live="polite">
      <span className="play-highlight-label">{t(LABEL[shown.kind], { name: state.players[shown.player].name })}</span>
      <div className="play-highlight-card">
        <CardView state={state} uid={shown.uid} eager />
      </div>
    </div>
  );
}
