// A mesa larga do desktop: cada metade com os Personagens (e a Vida numa coluna ao lado), a fileira do
// Líder (área de custo, Stage, Deck, Descarte) e, se o jogador quiser, uma fileira de DON!! própria; as
// mãos nos cantos, fora da mesa; o hover e o histórico nas laterais ou no painel. O que fica onde, e de
// que tamanho, vem do layout escolhido em Configurações › Layout da mesa (`game/boardLayout.ts`).
//
// Reaproveita as zonas da mesa em coluna (`Board.tsx`), com o mesmo markup: o CSS das cartas, as
// âncoras das animações (`data-anchor`) e os alvos do arrasto (`data-drop`, `.don-row.bottom`,
// `.hand.bottom`) continuam os mesmos.

import { MAX_CHARACTERS, type GameState, type PlayerId } from '@gumgum/engine';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { baseOrder, type BaseItem, type EffectiveLayout, measureLayout, SIZE_K } from '../game/boardLayout';
import { useT } from '../i18n';
import {
  type BoardHandlers,
  DeckPile,
  DonCards,
  DonDeck,
  DonRow,
  DonStats,
  FieldCard,
  Hand,
  HandFan,
  LeaderZone,
  LifeZone,
  MiniHand,
  PlayerBanner,
  StageZone,
  TrashPile,
  vars,
} from './Board';

export interface WideBoardProps extends BoardHandlers {
  state: GameState;
  bottom: PlayerId;
  revealTop: boolean;
  revealBottom: boolean;
  layout: EffectiveLayout;
  /** Botões do canto superior esquerdo (menu, histórico, Auto). */
  corner?: ReactNode;
  /** Botões perto da sua mesa (chat online). */
  tools?: ReactNode;
  /** A faixa do meio: turno, confronto, Encerrar turno (CenterBand). */
  center: ReactNode;
  bannerExtra?: (player: PlayerId) => ReactNode;
  handOrder?: string[];
  lifted?: string | null;
  ghost?: string | null;
  onExpandHand?: () => void;
  onSortHand?: () => void;
  turnPulse?: boolean;
  handHint?: ReactNode;
  /** Hover grande ao lado da mesa (à esquerda) e histórico ao lado da mesa (à direita). */
  sideLeft?: ReactNode;
  sideRight?: ReactNode;
  /** Carta ampliada por cima do centro da mesa. */
  overlay?: ReactNode;
  /** Prévia (editor): a mesa não responde a cliques. */
  inert?: boolean;
}

type ZoneHandlers = Pick<BoardHandlers, 'canDragAttached' | 'onCard' | 'highlight' | 'onHover' | 'canDragAttacker'>;

function Half({
  state,
  player,
  position,
  layout,
  h,
}: {
  state: GameState;
  player: PlayerId;
  position: 'top' | 'bottom';
  layout: EffectiveLayout;
  h: BoardHandlers;
}) {
  const t = useT();
  const ps = state.players[player];
  const top = position === 'top';
  const isActive = state.activePlayer === player && state.phase === 'main';
  const slots = Array.from({ length: MAX_CHARACTERS }, (_, i) => ps.characters[i] ?? null);
  const lifeCol = layout.life.position === 'base' ? null : (layout.life.position === 'col-left') !== top ? 'left' : 'right';
  // Quem joga vê a fileira da esquerda para a direita; a do oponente é a mesma, invertida (espelho).
  let order = baseOrder(layout);
  if (top) order = order.slice().reverse();
  const at = order.indexOf('leader');
  const left = order.slice(0, at);
  const right = order.slice(at + 1);
  // O deck de DON!! na ponta de fora da área de custo (a borda da mesa) ou na de dentro.
  const deckOuter = layout.donDeck.position === 'outer';
  const donGroup = (edge: 'left' | 'right' | 'row') => {
    const deckLeft = edge === 'row' ? deckOuter !== top : edge === 'left' ? deckOuter : !deckOuter;
    const deck = <DonDeck key="deck" state={state} player={player} />;
    const cost = (
      <div key="cost" className="wm-cost">
        <DonCards state={state} player={player} h={h} />
        <DonStats state={state} player={player} />
      </div>
    );
    return (
      <DonRow
        key="DON"
        state={state}
        player={player}
        position={position}
        className={edge === 'row' ? `wm-don-rowfull ${deckLeft ? 'deck-left' : 'deck-right'}` : 'wm-don-group'}
        h={h}
      >
        {deckLeft ? [deck, cost] : [cost, deck]}
      </DonRow>
    );
  };
  const zh: ZoneHandlers = h;
  const item = (id: BaseItem, edge: 'left' | 'right') => {
    switch (id) {
      case 'DON':
        return donGroup(edge);
      case 'stage':
        return <StageZone key="stage" state={state} player={player} h={zh} />;
      case 'deck':
        return (
          <div key="deck" className="wm-deck">
            <small className="wm-label">{t('layout.deckLabel')}</small>
            <DeckPile state={state} player={player} />
          </div>
        );
      case 'trash':
        return (
          <div key="trash" className="wm-trash">
            <small className="wm-label">{t('layout.trashLabel')}</small>
            <TrashPile state={state} player={player} h={h} />
          </div>
        );
      case 'life':
        return (
          <div key="life" className="wm-life-base">
            <LifeZone state={state} player={player} h={h} />
          </div>
        );
      default:
        return null;
    }
  };
  return (
    <section
      className={[
        'wm-half',
        position,
        isActive ? 'active-side' : '',
        h.fieldDrop(player) ? 'drop-ok' : '',
        layout.don.position === 'row' ? 'with-don' : '',
      ].join(' ')}
    >
      {lifeCol === 'left' && (
        <div className="wm-lcol">
          <LifeZone state={state} player={player} h={h} />
        </div>
      )}
      <div className="field-row wm-field">
        {slots.map((fc, i) => (
          <div key={fc?.uid ?? `empty${i}`} className="slot">
            {fc ? <FieldCard state={state} uid={fc.uid} fc={fc} h={zh} /> : <div className="slot-empty" />}
          </div>
        ))}
      </div>
      {lifeCol === 'right' && (
        <div className="wm-rcol">
          <LifeZone state={state} player={player} h={h} />
        </div>
      )}
      <div className="wm-base">
        <div className="wm-base-l">{left.map((id) => item(id, 'left'))}</div>
        <LeaderZone state={state} player={player} h={zh} />
        <div className="wm-base-r">{right.map((id) => item(id, 'right'))}</div>
      </div>
      {layout.don.position === 'row' && donGroup('row')}
    </section>
  );
}

/** Até quantas vezes a mesa aperta a conta quando, mesmo assim, algo passou da tela. */
const FIT_PASSES = 4;

export function WideBoard({
  state,
  bottom,
  revealTop,
  revealBottom,
  layout,
  corner,
  tools,
  center,
  bannerExtra,
  handOrder,
  lifted,
  ghost,
  onExpandHand,
  onSortHand,
  turnPulse,
  handHint,
  sideLeft,
  sideRight,
  overlay,
  inert,
  ...handlers
}: WideBoardProps) {
  const t = useT();
  const top = (bottom === 0 ? 1 : 0) as PlayerId;
  const m = measureLayout(layout);
  const root = useRef<HTMLDivElement>(null);
  /** Rede de segurança: fator que aperta `rows`/`cols` quando a mesa medida passou da tela. */
  const [fit, setFit] = useState({ rows: 1, cols: 1, pass: 0 });
  const fitKey = `${JSON.stringify(layout)}|${state.players[bottom].hand.length}|${state.players[top].hand.length}`;
  const lastKey = useRef(fitKey);
  if (lastKey.current !== fitKey) {
    lastKey.current = fitKey;
    if (fit.pass !== 0) setFit({ rows: 1, cols: 1, pass: 0 });
  }
  // Depois dos layout effects do pai: a coluna da mesa já mediu e gravou --bw/--bh (useBoardSize), que o
  // --cw usa; antes disso a conta sairia do tamanho da janela inteira e apertaria à toa.
  useEffect(() => {
    const el = root.current;
    const col = el?.parentElement;
    if (!el || !col) return;
    // A coluna ainda sem medida (montada depois do useBoardSize dela): mede aqui, senão o --cw sairia da janela inteira.
    if (!col.style.getPropertyValue('--bh')) {
      col.style.setProperty('--bw', `${col.clientWidth}px`);
      col.style.setProperty('--bh', `${col.clientHeight}px`);
      col.toggleAttribute('data-landscape', col.clientWidth >= col.clientHeight);
      setFit((f) => ({ ...f }));
      return;
    }
    // Sem espaço de verdade (a caixa ainda sem altura, uma aba escondida), não há o que medir.
    if (fit.pass >= FIT_PASSES || el.clientHeight < 120 || el.clientWidth < 240) return;
    const overH = el.scrollHeight - el.clientHeight;
    const overW = el.scrollWidth - el.clientWidth;
    if (overH <= 1 && overW <= 1) return;
    // Aperta na proporção do que passou (no máximo o dobro por vez).
    const by = (over: number, size: number) => Math.min(2, 1 + over / size) * 1.02;
    setFit((f) => ({
      rows: overH > 1 ? f.rows * by(overH, el.clientHeight) : f.rows,
      cols: overW > 1 ? f.cols * by(overW, el.clientWidth) : f.cols,
      pass: f.pass + 1,
    }));
  });
  // A janela mudou de tamanho: a conta recomeça do zero.
  useLayoutEffect(() => {
    const el = root.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFit((f) => (f.pass === 0 ? f : { rows: 1, cols: 1, pass: 0 })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Mão recolhida: aberta no leque grande ao clicar na pilha. */
  const [fanOpen, setFanOpen] = useState(false);
  const [fanClosing, setFanClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const toggleFan = () => {
    if (fanOpen) {
      setFanOpen(false);
      setFanClosing(true);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setFanClosing(false), 480);
    } else {
      clearTimeout(closeTimer.current);
      setFanClosing(false);
      setFanOpen(true);
    }
  };

  const myHand = layout.hand.collapsed ? (
    <MiniHand state={state} player={bottom} position="bottom" open={fanOpen} canOpen={revealBottom} onToggle={toggleFan} />
  ) : (
    <Hand
      state={state}
      player={bottom}
      reveal={revealBottom}
      position="bottom"
      order={handOrder}
      lifted={lifted}
      ghost={ghost}
      {...handlers}
    />
  );
  const nHand = state.players[bottom].hand.length;
  const handBar = (
    <div className="wm-hand-bar">
      {handHint && !layout.hand.collapsed && <div className="hand-hint wm-hand-hint">{handHint}</div>}
      {!layout.hand.collapsed && nHand > 0 && (onExpandHand || onSortHand) && (
        <div className="hand-tools wm-hand-tools">
          {onSortHand && (
            <button className="hand-expand sort" onClick={onSortHand} title={t('board.sortTitle')}>
              {t('board.sort')}
            </button>
          )}
          {onExpandHand && (
            <button className="hand-expand" onClick={onExpandHand} title={t('board.expandTitle')}>
              {t('board.expand')} <b>{nHand}</b>
            </button>
          )}
        </div>
      )}
    </div>
  );
  const myHandBlock = (where: 'corner' | 'bottom') => (
    <div className={['wm-hand', 'mine', where === 'bottom' ? 'bottom' : layout.hand.position].join(' ')} data-drop="hand">
      {handBar}
      <div className="wm-hand-box">{myHand}</div>
    </div>
  );
  const oppHand = (
    <div className="wm-hand opp">
      <Hand state={state} player={top} reveal={revealTop} position="top" {...handlers} />
    </div>
  );

  const handBottom = layout.hand.position === 'bottom';
  const sides = m.side > 0;
  // A mão do oponente sempre em cima: no canto oposto ao da sua; com a sua embaixo da mesa, à direita.
  const oppSide: 'left' | 'right' = layout.hand.position === 'corner-right' ? 'left' : 'right';
  const sideArea = (where: 'left' | 'right') => {
    const mine = (where === 'left' && layout.hand.position === 'corner-left') || (where === 'right' && layout.hand.position === 'corner-right');
    const middle = where === 'left' ? sideLeft : sideRight;
    return (
      <div className={['wm-side', where, mine ? 'with-hand' : ''].join(' ')}>
        {oppSide === where && oppHand}
        <div className={['wm-middle', mine ? '' : 'centered'].join(' ')}>{middle}</div>
        {mine && myHandBlock('corner')}
      </div>
    );
  };

  const style = vars({
    '--rows': m.rows * fit.rows,
    '--cols': m.cols * fit.cols,
    '--fixed': `${m.fixedPx}px`,
    '--bwu': m.boardW,
    '--side': m.side,
    '--k-don': SIZE_K[layout.don.size],
    '--k-hand': SIZE_K[layout.hand.size],
    '--k-life': SIZE_K[layout.life.size],
    '--k-leader': SIZE_K[layout.leader.size],
    '--k-stage': SIZE_K[layout.stage.size],
    '--k-trash': SIZE_K[layout.trash.size],
    '--k-dondeck': SIZE_K[layout.donDeck.size],
    '--k-deck': SIZE_K[layout.deck.size],
    '--k-hover': SIZE_K[layout.hover.size],
    '--k-log': SIZE_K[layout.log.size],
  });

  return (
    <div ref={root} className={['mat', 'wide-mat', inert ? 'inert' : ''].join(' ')} style={style}>
      {corner && <div className="corner">{corner}</div>}
      <div className="wm-col">
        {handBottom && !sides && <div className="wm-strip top">{oppHand}</div>}
        <div className="wm-board" data-drop="field" data-anchor="arena">
          <Half state={state} player={top} position="top" layout={layout} h={handlers} />
          <div className="wm-center">
            <PlayerBanner state={state} player={top} align="left" extra={bannerExtra?.(top)} />
            <div className="center-band" data-drop="field">
              {center}
            </div>
            <PlayerBanner state={state} player={bottom} align="right" pulse={turnPulse} extra={bannerExtra?.(bottom)} />
          </div>
          <Half state={state} player={bottom} position="bottom" layout={layout} h={handlers} />
          {tools && <div className="side-tools wm-tools">{tools}</div>}
        </div>
        {handBottom && <div className="wm-strip bottom">{myHandBlock('bottom')}</div>}
      </div>
      {sides && sideArea('left')}
      {sides && sideArea('right')}
      {layout.hand.collapsed && (fanOpen || fanClosing) && revealBottom && (
        <HandFan state={state} player={bottom} position="bottom" closing={!fanOpen} {...handlers} />
      )}
      {overlay && <div className="wm-overlay">{overlay}</div>}
    </div>
  );
}
