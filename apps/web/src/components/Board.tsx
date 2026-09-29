import { cardDef, type GameState, MAX_CHARACTERS, type PlayerId } from '@gumgum/engine';
import { CardBack, CardView, type Highlight } from './CardView';

export interface BoardHandlers {
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  onCardDouble: (uid: string) => void;
  onHover: (uid: string | null) => void;
  onDon: (player: PlayerId) => void;
  donHighlight: (player: PlayerId) => boolean;
}

interface SideProps extends BoardHandlers {
  state: GameState;
  player: PlayerId;
  position: 'top' | 'bottom';
  revealHand: boolean;
}

function PlayerSide({ state, player, position, revealHand, ...h }: SideProps) {
  const ps = state.players[player];
  const isActive = state.activePlayer === player && state.phase !== 'mulligan';
  const trashTop = ps.trash[ps.trash.length - 1];

  const slots = Array.from({ length: MAX_CHARACTERS }, (_, i) => ps.characters[i] ?? null);

  const hand = (
    <div className="row hand-row">
      {ps.hand.map((uid) =>
        revealHand ? (
          <div key={uid} className="hand-card">
            <CardView
              state={state}
              uid={uid}
              highlight={h.highlight(uid)}
              onClick={() => h.onCard(uid)}
              onDoubleClick={() => h.onCardDouble(uid)}
              onHover={h.onHover}
            />
          </div>
        ) : (
          <div key={uid} className="hand-card">
            <CardBack small />
          </div>
        ),
      )}
      {ps.hand.length === 0 && <div className="empty-hint">Mão vazia</div>}
    </div>
  );

  const base = (
    <div className="row base-row">
      <div className="zone">
        <div className="zone-label">Vida</div>
        <div className="life-stack">
          {ps.life.map((uid, i) => (
            <div key={uid} className="life-card" style={{ ['--i' as string]: i }} />
          ))}
          <span className="life-count">{ps.life.length}</span>
        </div>
      </div>
      <div className="zone leader-zone">
        <div className="zone-label">Líder</div>
        <div className="slot">
          <CardView
            state={state}
            uid={ps.leader.uid}
            fc={ps.leader}
            highlight={h.highlight(ps.leader.uid)}
            onClick={() => h.onCard(ps.leader.uid)}
            onHover={h.onHover}
          />
        </div>
      </div>
      <div className="zone">
        <div className="zone-label">Stage</div>
        <div className="slot">
          {ps.stage ? (
            <CardView
              state={state}
              uid={ps.stage.uid}
              fc={ps.stage}
              highlight={h.highlight(ps.stage.uid)}
              onClick={() => h.onCard(ps.stage!.uid)}
              onHover={h.onHover}
            />
          ) : (
            <div className="slot-empty" />
          )}
        </div>
      </div>
      <div
        className={['zone', 'don-zone', h.donHighlight(player) ? 'hl-option clickable' : ''].join(' ')}
        onClick={() => h.onDon(player)}
        title="DON!! ativos podem ser anexados ao líder ou a personagens (+1000 no seu turno)"
      >
        <div className="zone-label">DON!!</div>
        <div className="don-tokens">
          {Array.from({ length: ps.donActive }, (_, i) => (
            <span key={`a${i}`} className="don active" />
          ))}
          {Array.from({ length: ps.donRested }, (_, i) => (
            <span key={`r${i}`} className="don rested" />
          ))}
        </div>
        <div className="don-count">
          <b>{ps.donActive}</b> ativos · {ps.donRested} virados · {ps.donDeck} no deck
        </div>
      </div>
      <div className="zone">
        <div className="zone-label">Deck</div>
        <div className="slot">
          <CardBack label={ps.deck.length} />
        </div>
      </div>
      <div className="zone">
        <div className="zone-label">Descarte ({ps.trash.length})</div>
        <div className="slot">
          {trashTop ? (
            <div className="trash-top">
              <CardView state={state} uid={trashTop} onHover={h.onHover} />
            </div>
          ) : (
            <div className="slot-empty" />
          )}
        </div>
      </div>
    </div>
  );

  const field = (
    <div className="row field-row">
      {slots.map((fc, i) => (
        <div key={fc?.uid ?? `empty${i}`} className="slot char-slot">
          {fc ? (
            <CardView
              state={state}
              uid={fc.uid}
              fc={fc}
              highlight={h.highlight(fc.uid)}
              onClick={() => h.onCard(fc.uid)}
              onHover={h.onHover}
            />
          ) : (
            <div className="slot-empty" />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <section className={['side', position, isActive ? 'active-side' : ''].join(' ')}>
      <header className="side-header">
        <span className="player-name">
          {isActive && <span className="turn-dot" />}
          {ps.name}
          {ps.isBot && <span className="tag">BOT</span>}
        </span>
        <span className="side-leader">{cardDef(state, ps.leader.uid).name}</span>
        <span className="side-stats">
          ❤ {ps.life.length} · ✋ {ps.hand.length} · 🂠 {ps.deck.length}
        </span>
      </header>
      {position === 'top' ? (
        <>
          {hand}
          {base}
          {field}
        </>
      ) : (
        <>
          {field}
          {base}
          {hand}
        </>
      )}
    </section>
  );
}

interface BoardProps extends BoardHandlers {
  state: GameState;
  bottom: PlayerId;
  revealTop: boolean;
  revealBottom: boolean;
  center: React.ReactNode;
}

export function Board({ state, bottom, revealTop, revealBottom, center, ...handlers }: BoardProps) {
  const top = (bottom === 0 ? 1 : 0) as PlayerId;
  return (
    <div className="board">
      <PlayerSide state={state} player={top} position="top" revealHand={revealTop} {...handlers} />
      <div className="center-bar">{center}</div>
      <PlayerSide state={state} player={bottom} position="bottom" revealHand={revealBottom} {...handlers} />
    </div>
  );
}
