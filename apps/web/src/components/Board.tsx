import { cardDef, type GameState, MAX_CHARACTERS, type PlayerId } from '@gumgum/engine';
import type { CSSProperties, ReactNode } from 'react';
import { CardBack, CardView, type Highlight, JollyRoger } from './CardView';

export interface BoardHandlers {
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  onCardDouble: (uid: string) => void;
  onHover: (uid: string | null) => void;
  onDon: (player: PlayerId) => void;
  donHighlight: (player: PlayerId) => boolean;
  /** Abre a lista do descarte de um jogador. */
  onTrash: (player: PlayerId) => void;
  /** Cartas da mão que podem ser arrastadas para a mesa. */
  canDragHand: (uid: string) => boolean;
  /** Personagens/Líder que podem ser arrastados até um alvo de ataque. */
  canDragAttacker: (uid: string) => boolean;
  /** DON!! que podem ser arrastados até uma carta. */
  canDragDon: (player: PlayerId) => boolean;
  /** Algo arrastado pode ser solto na mesa deste jogador (jogar carta). */
  fieldDrop: (player: PlayerId) => boolean;
}

interface SideProps extends BoardHandlers {
  state: GameState;
  player: PlayerId;
  position: 'top' | 'bottom';
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function PlayerSide({ state, player, position, ...h }: SideProps) {
  const ps = state.players[player];
  const isActive = state.activePlayer === player && state.phase === 'main';
  const trashTop = ps.trash[ps.trash.length - 1];
  const slots = Array.from({ length: MAX_CHARACTERS }, (_, i) => ps.characters[i] ?? null);
  const maxLife = cardDef(state, ps.leader.uid).life ?? ps.life.length;

  const fieldCard = (uid: string, fc: (typeof ps.characters)[number]) => (
    <div key={uid} className="enter">
      <CardView
        state={state}
        uid={uid}
        fc={fc}
        highlight={h.highlight(uid)}
        onClick={() => h.onCard(uid)}
        onHover={h.onHover}
        drag={h.canDragAttacker(uid) ? 'attacker' : undefined}
      />
    </div>
  );

  const life = (
    <div className="zone life-zone" title={`Vida: ${ps.life.length}`}>
      <div className="life-stack" key={ps.life.length}>
        {ps.life.map((uid, i) => (
          <div key={uid} className="life-card" style={vars({ '--i': i })} />
        ))}
      </div>
      <span className={['life-count', ps.life.length === 0 ? 'zero' : ''].join(' ')}>
        ♥ {ps.life.length}
        <small>/{Math.max(maxLife, ps.life.length)}</small>
      </span>
    </div>
  );

  const stage = (
    <div className="zone stage-zone">
      {ps.stage ? fieldCard(ps.stage.uid, ps.stage) : <div className="slot-empty">Stage</div>}
    </div>
  );

  const leader = (
    <div className={['zone', 'leader-zone', isActive ? 'active' : ''].join(' ')}>
      {fieldCard(ps.leader.uid, ps.leader)}
    </div>
  );

  const don = (
    <div
      className={['zone', 'don-zone', h.donHighlight(player) ? 'hl-option clickable' : ''].join(' ')}
      onClick={() => h.onDon(player)}
      data-drag={h.canDragDon(player) ? 'don' : undefined}
      title="DON!! ativos: arraste (ou toque e escolha) até o Líder ou um Personagem para dar +1000 no seu turno"
    >
      <div className="don-coin">
        <span>DON!!</span>
        <b>{ps.donActive}</b>
      </div>
      <div className="don-pips">
        {Array.from({ length: Math.min(ps.donActive + ps.donRested, 10) }, (_, i) => (
          <span key={i} className={i < ps.donActive ? 'on' : ''} />
        ))}
      </div>
      <div className="don-sub">
        {ps.donRested} virado{ps.donRested === 1 ? '' : 's'} · {ps.donDeck} no deck
      </div>
    </div>
  );

  const piles = (
    <div className="zone piles">
      <div className="pile" title={`Deck: ${ps.deck.length} cartas`}>
        <CardBack />
        <span className="pile-count">{ps.deck.length}</span>
      </div>
      <div
        className="pile clickable"
        onClick={() => h.onTrash(player)}
        title={`Descarte: ${ps.trash.length} cartas (toque para ver)`}
      >
        {trashTop ? <CardView state={state} uid={trashTop} /> : <div className="slot-empty">Lixo</div>}
        <span className="pile-count">{ps.trash.length}</span>
      </div>
    </div>
  );

  const base = (
    <div className="base-row">
      {position === 'bottom' ? (
        <>
          <div className="base-side left">
            {life}
            {stage}
          </div>
          {leader}
          <div className="base-side right">
            {don}
            {piles}
          </div>
        </>
      ) : (
        <>
          <div className="base-side left">
            {piles}
            {don}
          </div>
          {leader}
          <div className="base-side right">
            {stage}
            {life}
          </div>
        </>
      )}
    </div>
  );

  const field = (
    <div className="field-row">
      {slots.map((fc, i) => (
        <div key={fc?.uid ?? `empty${i}`} className="slot">
          {fc ? fieldCard(fc.uid, fc) : <div className="slot-empty" />}
        </div>
      ))}
    </div>
  );

  return (
    <section
      className={['side', position, isActive ? 'active-side' : '', h.fieldDrop(player) ? 'drop-ok' : ''].join(' ')}
      data-drop={position === 'bottom' ? 'field' : undefined}
    >
      {position === 'top' ? (
        <>
          {base}
          {field}
        </>
      ) : (
        <>
          {field}
          {base}
        </>
      )}
    </section>
  );
}

/** Mão em leque (a do jogador de baixo fica grande; a de cima, pequena no topo). */
export function Hand({
  state,
  player,
  reveal,
  position,
  ...h
}: Pick<BoardHandlers, 'highlight' | 'onCard' | 'onCardDouble' | 'onHover' | 'canDragHand'> & {
  state: GameState;
  player: PlayerId;
  reveal: boolean;
  position: 'top' | 'bottom';
}) {
  const hand = state.players[player].hand;
  const n = hand.length;
  return (
    <div className={['hand', position].join(' ')} style={vars({ '--n': n })}>
      {hand.map((uid, i) => {
        const offset = i - (n - 1) / 2;
        return (
          <div key={uid} className="hand-card" style={vars({ '--o': offset, '--a': Math.abs(offset), '--z': i })}>
            {reveal ? (
              <CardView
                state={state}
                uid={uid}
                highlight={h.highlight(uid)}
                onClick={() => h.onCard(uid)}
                onDoubleClick={() => h.onCardDouble(uid)}
                onHover={h.onHover}
                drag={h.canDragHand(uid) ? 'hand' : undefined}
              />
            ) : (
              <CardBack />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Faixa do jogador: nome, Líder, Vida e mão. */
export function PlayerBanner({ state, player, align }: { state: GameState; player: PlayerId; align: 'left' | 'right' }) {
  const ps = state.players[player];
  const max = Math.max(cardDef(state, ps.leader.uid).life ?? 0, ps.life.length);
  const isActive = state.activePlayer === player && state.phase === 'main';
  return (
    <div className={['banner', align, isActive ? 'active' : ''].join(' ')}>
      <div className="banner-life" title={`Vida: ${ps.life.length}`}>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={i < ps.life.length ? 'on' : ''} />
        ))}
      </div>
      <div className="banner-name">
        {ps.name}
        {ps.isBot && <span className="tag">BOT</span>}
        <small>✋ {ps.hand.length}</small>
      </div>
    </div>
  );
}

interface BoardProps extends BoardHandlers {
  state: GameState;
  bottom: PlayerId;
  revealTop: boolean;
  revealBottom: boolean;
  /** Botões do canto superior esquerdo (menu, Auto). */
  corner: ReactNode;
  center: ReactNode;
}

export function Board({ state, bottom, revealTop, revealBottom, corner, center, ...handlers }: BoardProps) {
  const top = (bottom === 0 ? 1 : 0) as PlayerId;
  return (
    <div className="mat">
      <div className="top-strip">
        <div className="corner">{corner}</div>
        <Hand state={state} player={top} reveal={revealTop} position="top" {...handlers} />
        <PlayerBanner state={state} player={top} align="right" />
      </div>
      <div className="arena">
        <div className="arena-deco" aria-hidden="true">
          <div className="wheel">
            <JollyRoger />
          </div>
        </div>
        <PlayerSide state={state} player={top} position="top" {...handlers} />
        <div className="center-band" data-drop="field">
          {center}
        </div>
        <PlayerSide state={state} player={bottom} position="bottom" {...handlers} />
      </div>
      <div className="bottom-strip">
        <PlayerBanner state={state} player={bottom} align="left" />
        <Hand state={state} player={bottom} reveal={revealBottom} position="bottom" {...handlers} />
      </div>
    </div>
  );
}
