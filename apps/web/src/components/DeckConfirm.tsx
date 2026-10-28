// Confirmação do deck antes de entrar na partida (filas, sala privada, treino contra o bot e
// revanche): o deck que vai ser usado, se ele vale nas regras do modo, a curva e a troca rápida
// pelos recentes ou pelo seletor completo. Desligável nas configurações (`confirmDeck`).

import { type CardData } from '@gumgum/engine';
import { useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary } from '../api';
import { deckNumbers, type DeckNumbers, lastUsed, localRecent, rememberDeck, sortDecks } from '../deckLibrary';
import { useT } from '../i18n';
import { useSettings } from '../settings';
import { DeckPicker } from './DeckPicker';
import { CostCurve, LeaderBanner, useFavoriteToggle } from './DeckTile';
import { DeckViewer } from './DeckViewer';
import { Icon } from './Icons';

/** Quantos decks recentes aparecem na troca rápida. */
const QUICK_SWAP = 3;

export function DeckConfirm({
  kicker,
  deckId,
  decks: given,
  whyFor,
  confirmLabel,
  opponent,
  onConfirm,
  onCancel,
  onFavorite,
}: {
  /** O modo e as regras ("Ranqueada · Standard"). */
  kicker: string;
  /** Deck sugerido (o equipado, ou o da partida que terminou). */
  deckId: string;
  /** Decks para trocar; sem eles, a lista é carregada aqui. */
  decks?: DeckSummary[];
  /** Por que o deck não vale neste modo (null: vale). */
  whyFor: (d: DeckSummary) => string | null;
  confirmLabel: string;
  /** Treino contra o bot: o deck do oponente (sem `deckId`, o sorteado). */
  opponent?: { deckId?: string; label: string };
  onConfirm: (deckId: string) => void;
  onCancel: () => void;
  /** Favoritar no seletor completo (sem ele, só nesta lista). */
  onFavorite?: (d: DeckSummary) => void;
}) {
  const t = useT();
  const settings = useSettings();
  const [loaded, setLoaded] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toggleLocal = useFavoriteToggle(setLoaded, setError);
  const decks = given ?? loaded;
  const [selected, setSelected] = useState(deckId);
  const [numbers, setNumbers] = useState<DeckNumbers | null>(null);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);

  useEffect(() => {
    if (given) return;
    let stop = false;
    api.decks().then(
      (d) => !stop && setLoaded(d),
      (e: unknown) => !stop && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      stop = true;
    };
  }, [given]);

  // Resumo do deck escolhido (curva e counters).
  useEffect(() => {
    let stop = false;
    setNumbers(null);
    api.deck(selected).then(
      (r) => !stop && setNumbers(deckNumbers(r.deck.cards, new Map(r.cards.map((c) => [c.id, c as CardData])))),
      () => undefined,
    );
    return () => {
      stop = true;
    };
  }, [selected]);

  // Esc cancela (o seletor e o visualizador abertos por cima fecham antes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !picking && !viewing && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, picking, viewing]);

  const current = decks.find((d) => d.id === selected);
  const why = current ? whyFor(current) : null;
  const rival = opponent?.deckId ? decks.find((d) => d.id === opponent.deckId) : undefined;
  const recent = useMemo(() => {
    const local = new Map(localRecent());
    return sortDecks(
      decks.filter((d) => d.id !== selected && lastUsed(d, local) > 0 && !whyFor(d)),
      'recent',
      local,
    ).slice(0, QUICK_SWAP);
  }, [decks, selected, whyFor]);

  const confirm = () => {
    if (dontAsk) settings.update({ confirmDeck: false });
    rememberDeck(selected);
    onConfirm(selected);
  };

  return (
    <div className="modal-backdrop page-sheet" onClick={onCancel}>
      <div className="modal-card deck-confirm" role="dialog" aria-modal="true" aria-labelledby="deck-confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kicker">{kicker}</div>
        <h2 id="deck-confirm-title">{t('deckConfirm.title')}</h2>
        {error && <div className="error">{error}</div>}

        {current ? (
          <div className="dc-main">
            <LeaderBanner deck={current} big />
            <div className="dc-info">
              <b className="dc-name">{current.name}</b>
              <div className={['dc-check', why ? 'bad' : 'ok'].join(' ')}>
                {why ? (
                  <span>🚫 {why}</span>
                ) : (
                  <>
                    <Icon name="check" size={14} stroke={3} />
                    {t('deckConfirm.valid')}
                  </>
                )}
              </div>
              {numbers ? (
                <>
                  <CostCurve curve={numbers.curve} />
                  <div className="muted small">{t('decks.counters', { c1: numbers.counter1000, c2: numbers.counter2000 })}</div>
                  <button type="button" className="dk-link" onClick={() => setViewing(true)}>
                    {t('decks.viewFullList', { n: numbers.total })}
                  </button>
                </>
              ) : (
                <p className="muted small">{t('decks.loading')}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="muted">{decks.length ? t('decks.pickHint') : t('common.loading')}</p>
        )}

        {opponent && (
          <div className="dc-vs">
            <span className="dc-vs-tag">VS</span>
            {rival ? (
              <LeaderBanner deck={rival} />
            ) : (
              <span className="dk-banner random">
                <span className="dk-banner-name">?</span>
              </span>
            )}
            <span className="small">
              {t('menu.botName')} · <b>{opponent.label}</b>
            </span>
          </div>
        )}

        <div className="dc-recent">
          <div className="dk-label">{t('deckConfirm.quickSwap')}</div>
          <div className="dc-recent-row">
            {recent.map((d) => (
              <button key={d.id} type="button" className="dc-recent-tile" onClick={() => setSelected(d.id)} title={d.name}>
                <LeaderBanner deck={d} />
                <span className="dc-recent-name">{d.name}</span>
              </button>
            ))}
            <button type="button" className="dc-recent-tile more" onClick={() => setPicking(true)} disabled={!decks.length}>
              <span className="dc-more-ico">
                <Icon name="deck" size={20} />
              </span>
              <span className="dc-recent-name">{t('deckConfirm.allDecks')}</span>
            </button>
          </div>
        </div>

        <div className="btn-row center dc-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {/* Com o foco aqui ao abrir, Enter confirma. */}
          <button type="button" className="btn primary big" disabled={!current || Boolean(why)} onClick={confirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
        <label className="check dc-skip">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          {t('deckConfirm.dontAsk')}
        </label>
      </div>

      {picking && (
        <div onClick={(e) => e.stopPropagation()}>
          <DeckPicker
            title={t('deckConfirm.title')}
            context={kicker}
            decks={decks}
            value={selected}
            canUse={(d) => !whyFor(d)}
            whyNot={whyFor}
            onPick={(id) => {
              setSelected(id);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
            onFavorite={onFavorite ?? toggleLocal}
          />
        </div>
      )}
      {viewing && current && (
        <div onClick={(e) => e.stopPropagation()}>
          <DeckViewer
            deckId={current.id}
            onClose={() => setViewing(false)}
            onPlay={() => {
              setViewing(false);
              confirm();
            }}
            playDisabled={why}
          />
        </div>
      )}
    </div>
  );
}
