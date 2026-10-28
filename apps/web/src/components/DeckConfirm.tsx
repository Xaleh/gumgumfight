// PROTÓTIPO (textos fixos em português, sem i18n): confirmação do deck antes de entrar na partida.

import { type CardData } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type DeckSummary } from '../api';
import { deckNumbers, type DeckNumbers } from '../deckLibrary';
import { CostCurve, LeaderBanner } from './DeckTile';
import { DeckViewer } from './DeckViewer';
import { Icon } from './Icons';

export function DeckConfirm({
  kicker,
  deck,
  why,
  recent,
  opponent,
  confirmLabel,
  onSwap,
  onChange,
  onConfirm,
  onCancel,
}: {
  kicker: string;
  deck: DeckSummary;
  /** Por que o deck não vale neste modo (null: vale). */
  why: string | null;
  /** Outros decks recentes que valem neste modo (troca rápida). */
  recent: DeckSummary[];
  /** Treino: o deck do oponente ("Aleatório" sem deck). */
  opponent?: { deck?: DeckSummary; label: string };
  confirmLabel: string;
  onSwap: (id: string) => void;
  onChange: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [numbers, setNumbers] = useState<DeckNumbers | null>(null);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    let stop = false;
    setNumbers(null);
    api.deck(deck.id).then(
      (r) => !stop && setNumbers(deckNumbers(r.deck.cards, new Map(r.cards.map((c) => [c.id, c as CardData])))),
      () => undefined,
    );
    return () => {
      stop = true;
    };
  }, [deck.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewing) return;
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !why) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm, why, viewing]);

  return (
    <div className="modal-backdrop page-sheet" onClick={onCancel}>
      <div className="modal-card deck-confirm" role="dialog" aria-modal="true" aria-labelledby="deck-confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kicker">{kicker}</div>
        <h2 id="deck-confirm-title">Jogar com este deck?</h2>

        <div className="dc-main">
          <LeaderBanner deck={deck} big />
          <div className="dc-info">
            <b className="dc-name">{deck.name}</b>
            <div className={['dc-check', why ? 'bad' : 'ok'].join(' ')}>
              {why ? <>🚫 {why}</> : <><Icon name="check" size={14} stroke={3} /> Vale neste modo</>}
            </div>
            {numbers ? (
              <>
                <CostCurve curve={numbers.curve} />
                <div className="muted small">
                  {numbers.byCategory.character} personagens · {numbers.byCategory.event} eventos · {numbers.counter1000 + numbers.counter2000} com counter
                </div>
              </>
            ) : (
              <p className="muted small">Carregando…</p>
            )}
            <button type="button" className="dk-link" onClick={() => setViewing(true)}>
              Ver lista completa
            </button>
          </div>
        </div>

        {opponent && (
          <div className="dc-vs">
            <span className="dc-vs-tag">VS</span>
            {opponent.deck ? <LeaderBanner deck={opponent.deck} /> : <span className="dk-banner random"><span className="dk-banner-name">?</span></span>}
            <span className="small">
              Robô · <b>{opponent.label}</b>
            </span>
          </div>
        )}

        {recent.length > 0 && (
          <div className="dc-recent">
            <div className="dk-label">Trocar rápido</div>
            <div className="dc-recent-row">
              {recent.map((d) => (
                <button key={d.id} type="button" className="dc-recent-tile" onClick={() => onSwap(d.id)} title={d.name}>
                  <LeaderBanner deck={d} />
                  <span className="dc-recent-name">{d.name}</span>
                </button>
              ))}
              <button type="button" className="dc-recent-tile more" onClick={onChange}>
                <span className="dc-more-ico">
                  <Icon name="deck" size={20} />
                </span>
                <span className="dc-recent-name">Todos os decks…</span>
              </button>
            </div>
          </div>
        )}

        <div className="btn-row center dc-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn primary big" disabled={Boolean(why)} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
        <label className="check dc-skip">
          <input type="checkbox" /> Não perguntar de novo (dá para reativar nas configurações)
        </label>
      </div>
      {viewing && (
        <div onClick={(e) => e.stopPropagation()}>
          <DeckViewer deckId={deck.id} onClose={() => setViewing(false)} onPlay={onConfirm} playDisabled={why} />
        </div>
      )}
    </div>
  );
}
