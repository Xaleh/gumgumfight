// Mão de teste na espera por oponente (fila e sala privada): a mesma do construtor (`HandTest.tsx`), com o deck
// com que o jogador espera. Simulação local: a mão sorteada aqui não tem nada a ver com a da partida que vem.

import { type CardData, type DeckList, withArt } from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { StaticCardZoom } from './CardInfo';
import { HandTestPanel } from './HandTest';

export interface WaitDeck {
  deck: Pick<DeckList, 'name' | 'leader' | 'cards' | 'arts'>;
  cards: CardData[];
}

/** O deck da espera, carregado uma vez (`failed`: sem rede, ou o deck foi apagado). */
export function useWaitDeck(deckId: string | null): { data: WaitDeck | null; failed: boolean } {
  const [state, setState] = useState<{ id: string; data: WaitDeck | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!deckId) return;
    let stop = false;
    api.deck(deckId).then(
      (r) => !stop && setState({ id: deckId, data: { deck: r.deck, cards: r.cards }, failed: false }),
      () => !stop && setState({ id: deckId, data: null, failed: true }),
    );
    return () => {
      stop = true;
    };
  }, [deckId]);
  return state && state.id === deckId ? { data: state.data, failed: state.failed } : { data: null, failed: false };
}

/** Folha da mão de teste. `status`: uma linha no alto (na fila, o tempo de busca). */
export function WaitHandSheet({ deck, failed, status, onClose }: { deck: WaitDeck | null; failed: boolean; status?: string; onClose: () => void }) {
  const t = useT();
  const [zoom, setZoom] = useState<CardData | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  const byId = useMemo(() => new Map((deck?.cards ?? []).map((c) => [c.id, c])), [deck]);
  const shown = useCallback((card: CardData) => withArt(card, deck?.deck.arts?.[card.id]), [deck]);
  useEffect(() => {
    // Com a carta ampliada aberta, o Esc fecha só ela (`StaticCardZoom`).
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !zoom && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoom]);
  const title = deck ? t('wait.handTestTitle', { deck: deck.deck.name }) : t('wait.handTest');
  return (
    <>
      <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
        <div className="sheet wait-hand-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <div className="sheet-head">
            <h3>{title}</h3>
            <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
          <div className="sheet-body">
            {status && (
              <p className="wait-hand-status" role="status">
                {status}
              </p>
            )}
            {deck ? (
              <HandTestPanel cards={deck.deck.cards} byId={byId} shown={shown} onLongPress={setZoom} onOpen={setZoom} />
            ) : (
              <p className={failed ? 'error' : 'muted small'}>{failed ? t('wait.handFailed') : t('common.loading')}</p>
            )}
          </div>
        </div>
      </div>
      {zoom && <StaticCardZoom card={zoom} className="dk-zoom" onClose={closeZoom} />}
    </>
  );
}
