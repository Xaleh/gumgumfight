// Mão de teste do construtor (e da espera por oponente, `WaitHandTest.tsx`): sorteia a mão inicial do deck, faz o
// mulligan e as compras dos primeiros turnos, e mostra as chances calculadas no motor
// (`packages/engine/src/handtest.ts`). É só simulação local: nada vai para o servidor nem decide partida.

import {
  canMulligan,
  type CardData,
  copiesWhere,
  counterChances,
  deckSize,
  drawTestCard,
  drawTestHand,
  HAND_SIZE,
  HAND_TEST_TURNS,
  mulliganTestHand,
  type TestHand,
  testHandCards,
  testHandTurn,
  turnChances,
} from '@gumgum/engine';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { StaticCard } from './CardView';

const pct = (p: number) => {
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v < 100 && v > 99) return '>99%';
  return `${Math.round(v)}%`;
};

const newSeed = () => Math.floor(Math.random() * 4294967296) | 0;

export function HandTestPanel({
  cards,
  byId,
  shown,
  onHover,
  onLongPress,
  onOpen,
}: {
  cards: Array<{ id: string; count: number }>;
  byId: Map<string, CardData>;
  shown: (card: CardData) => CardData;
  onHover?: (card: CardData | null, anchor?: HTMLElement) => void;
  onLongPress: (card: CardData) => void;
  /** Clique numa carta da mão (a espera por oponente abre a carta ampliada; o construtor mostra ao passar o mouse). */
  onOpen?: (card: CardData) => void;
}) {
  const t = useT();
  const deck = useMemo(() => ({ cards }), [cards]);
  const size = deckSize(deck);
  const signature = useMemo(() => cards.map((c) => `${c.id}:${c.count}`).join(','), [cards]);
  const [hand, setHand] = useState<TestHand | null>(null);
  const [first, setFirst] = useState(true);
  const [mulligan, setMulligan] = useState(true);
  const [cost, setCost] = useState(2);
  const [key, setKey] = useState('');

  // O deck mudou: mão nova, com as cartas de agora.
  useEffect(() => {
    setHand(size >= HAND_SIZE ? drawTestHand(deck, newSeed()) : null);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyOptions = useMemo(
    () =>
      cards
        .map((c) => ({ ...c, card: byId.get(c.id) }))
        .filter((c) => c.card)
        .sort((a, b) => (a.card!.cost ?? 0) - (b.card!.cost ?? 0) || a.card!.name.localeCompare(b.card!.name)),
    [cards, byId],
  );
  const keyId = keyOptions.some((c) => c.id === key) ? key : '';

  const costCopies = useMemo(() => copiesWhere(deck, byId, (c) => c.category === 'character' && c.cost === cost), [deck, byId, cost]);
  const costOdds = useMemo(() => turnChances(size, costCopies, { mulligan }), [size, costCopies, mulligan]);
  const keyCopies = keyOptions.find((c) => c.id === keyId)?.count ?? 0;
  const keyOdds = useMemo(() => turnChances(size, keyCopies, { mulligan }), [size, keyCopies, mulligan]);
  const counter = useMemo(() => counterChances(deck, byId), [deck, byId]);

  if (size < HAND_SIZE) return <div className="muted small hand-test">{t('decks.hand.tooSmall', { n: HAND_SIZE })}</div>;

  const inHand = hand ? testHandCards(hand) : [];
  const turns = Array.from({ length: HAND_TEST_TURNS }, (_, i) => i + 1);
  const row = (odds: { first: number[]; second: number[] }) => (first ? odds.first : odds.second);
  const table = (odds: { first: number[]; second: number[] }) => (
    <div className="ht-table turns" role="table" style={{ '--turns': HAND_TEST_TURNS } as CSSProperties}>
      <div className="ht-tr" role="row">
        <span role="columnheader">{t('decks.hand.turn')}</span>
        {turns.map((n) => (
          <span key={n} role="columnheader">
            {n}
          </span>
        ))}
      </div>
      <div className="ht-tr" role="row">
        <span role="rowheader" />
        {row(odds).map((p, i) => (
          <b key={i} role="cell">
            {pct(p)}
          </b>
        ))}
      </div>
    </div>
  );

  return (
    <div className="hand-test">
      <div className="btn-row ht-actions">
        <button type="button" className="btn small primary" onClick={() => setHand(drawTestHand(deck, newSeed()))}>
          {t('decks.hand.new')}
        </button>
        <button type="button" className="btn small" disabled={!hand || !canMulligan(hand)} onClick={() => hand && setHand(mulliganTestHand(hand))}>
          {t('decks.hand.mulligan')}
        </button>
        <button type="button" className="btn small" disabled={!hand || hand.drawn >= hand.order.length} onClick={() => hand && setHand(drawTestCard(hand))}>
          {t('decks.hand.draw')}
        </button>
      </div>
      {hand && (
        <>
          <div className="small muted">
            {t('decks.hand.status', { turn: testHandTurn(hand, first), n: inHand.length, left: hand.order.length - hand.drawn })}
            {hand.mulliganed ? ` · ${t('decks.hand.mulliganed')}` : ''}
          </div>
          <div className="ht-hand">
            {inHand.map((id, i) => {
              const card = byId.get(id);
              if (!card) return null;
              const face = shown(card);
              return <StaticCard key={`${i}-${id}`} card={face} onHover={onHover} onLongPress={onLongPress} onClick={onOpen && (() => onOpen(face))} />;
            })}
          </div>
        </>
      )}

      <h4 className="ht-title">{t('decks.hand.odds')}</h4>
      <div className="ht-options">
        <div className="seg small" role="group" aria-label={t('decks.hand.orderLabel')}>
          <button type="button" className={first ? 'on' : ''} aria-pressed={first} onClick={() => setFirst(true)}>
            {t('decks.hand.goingFirst')}
          </button>
          <button type="button" className={!first ? 'on' : ''} aria-pressed={!first} onClick={() => setFirst(false)}>
            {t('decks.hand.goingSecond')}
          </button>
        </div>
        <label className="check small">
          <input type="checkbox" checked={mulligan} onChange={(e) => setMulligan(e.target.checked)} /> {t('decks.hand.withMulligan')}
        </label>
      </div>

      <section className="ht-block">
        <div className="ht-head">
          <span>{t('decks.hand.costTitle')}</span>
          <select value={cost} onChange={(e) => setCost(Number(e.target.value))} aria-label={t('decks.hand.costLabel')}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <small className="muted">{t('decks.hand.copies', { n: costCopies })}</small>
        </div>
        {table(costOdds)}
      </section>

      <section className="ht-block">
        <div className="ht-head">
          <span>{t('decks.hand.keyTitle')}</span>
          <select value={keyId} onChange={(e) => setKey(e.target.value)} aria-label={t('decks.hand.keyLabel')}>
            <option value="">{t('decks.hand.keyPick')}</option>
            {keyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.count}× {c.card!.name} ({c.id})
              </option>
            ))}
          </select>
        </div>
        {keyId ? table(keyOdds) : null}
      </section>

      <section className="ht-block">
        <div className="ht-head">
          <span>{t('decks.hand.counterTitle')}</span>
          <small className="muted">{t('decks.hand.counterAverage', { value: Math.round(counter.average / 100) * 100 })}</small>
        </div>
        <div className="ht-table" role="table">
          <div className="ht-tr" role="row">
            {counter.atLeast.map((c) => (
              <span key={c.value} role="columnheader">
                {t('decks.hand.counterAtLeast', { value: c.value })}
              </span>
            ))}
          </div>
          <div className="ht-tr" role="row">
            {counter.atLeast.map((c) => (
              <b key={c.value} role="cell">
                {pct(c.chance)}
              </b>
            ))}
          </div>
        </div>
      </section>

      <p className="small muted">{t('decks.hand.note')}</p>
    </div>
  );
}
