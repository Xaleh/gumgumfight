import { cardDef, type GameState, MAX_CHARACTERS, type PlayerId } from '@gumgum/engine';
import type { CSSProperties, ReactNode } from 'react';
import { CardBack, CardView, type Highlight, JollyRoger } from './CardView';

export interface BoardHandlers {
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  onCardDouble: (uid: string) => void;
  onHover: (uid: string | null) => void;
  /** Toque no i-ésimo DON!! ativo (marca/desmarca para anexar vários). */
  onDon: (player: PlayerId, index: number) => void;
  /** Quantos DON!! ativos estão marcados (os primeiros da fileira). */
  donPicked: (player: PlayerId) => number;
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
    <div key={uid} className="enter field-card">
      {fc.don > 0 && (
        <div className="attached-don" title={`${fc.don} DON!! anexado(s)`}>
          {Array.from({ length: Math.min(fc.don, 4) }, (_, i) => (
            <span key={i} className="don-card flat" style={vars({ '--k': i })} />
          ))}
          <b>+{fc.don}</b>
        </div>
      )}
      <CardView
        state={state}
        uid={uid}
        fc={fc}
        hideDon
        highlight={h.highlight(uid)}
        onClick={() => h.onCard(uid)}
        onHover={h.onHover}
        drag={h.canDragAttacker(uid) ? 'attacker' : undefined}
      />
    </div>
  );

  const life = (
    <div className="zone life-zone" title={`Vida: ${ps.life.length}`}>
      <div className="life-stack" key={ps.life.length} data-anchor={`life-${player}`}>
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

  const canDragDon = h.canDragDon(player);
  const donGlow = h.donHighlight(player);
  const picked = h.donPicked(player);
  const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
  const onField = ps.donActive + ps.donRested;
  const don = (
    <div
      className={['don-row', position, donGlow ? 'glow' : ''].join(' ')}
      title={`DON!!: ${ps.donDeck} no deck, ${ps.donActive} ativos, ${ps.donRested} virados, ${attached} anexados`}
    >
      {/* Deck de DON!! fixo à esquerda; os DON!! entram à direita dele. */}
      <div className="don-deck" data-anchor={`dondeck-${player}`}>
        {ps.donDeck > 0 ? <span className="don-card back" /> : <span className="don-card empty" />}
        <span className="pile-count">{ps.donDeck}</span>
      </div>
      <div className="don-cards" style={vars({ '--n': Math.max(onField, 1) })} data-anchor={`don-${player}`}>
        {Array.from({ length: ps.donActive }, (_, i) => (
          <span
            key={`a${i}`}
            className={[
              'don-card',
              i < picked ? 'picked' : donGlow ? 'hl-option' : '',
              canDragDon ? 'clickable' : '',
            ].join(' ')}
            data-drag={canDragDon ? 'don' : undefined}
            onClick={() => h.onDon(player, i)}
          />
        ))}
        {Array.from({ length: ps.donRested }, (_, i) => (
          <span key={`r${i}`} className="don-card rested" />
        ))}
      </div>
      <dl className="don-stats" aria-label="DON!!">
        <div>
          <dt>Deck</dt>
          <dd>{ps.donDeck}</dd>
        </div>
        <div className="act">
          <dt>Ativos</dt>
          <dd>{ps.donActive}</dd>
        </div>
        <div className="rest">
          <dt>Virados</dt>
          <dd>{ps.donRested}</dd>
        </div>
        <div className="att">
          <dt>Anexados</dt>
          <dd>{attached}</dd>
        </div>
      </dl>
    </div>
  );

  const piles = (
    <div className="zone piles">
      <div className="pile" title={`Deck: ${ps.deck.length} cartas`} data-anchor={`deck-${player}`}>
        <CardBack />
        <span className="pile-count">{ps.deck.length}</span>
      </div>
      <div
        className="pile clickable"
        data-anchor={`trash-${player}`}
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
          <div className="base-side right">{piles}</div>
        </>
      ) : (
        <>
          <div className="base-side left">{piles}</div>
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
          {don}
          {base}
          {field}
        </>
      ) : (
        <>
          {field}
          {base}
          {don}
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
  order,
  lifted,
  ghost,
  ...h
}: Pick<BoardHandlers, 'highlight' | 'onCard' | 'onCardDouble' | 'onHover' | 'canDragHand'> & {
  state: GameState;
  player: PlayerId;
  reveal: boolean;
  position: 'top' | 'bottom';
  /** Ordem escolhida pelo jogador (só muda a exibição). */
  order?: string[];
  /** Carta erguida sob o dedo. */
  lifted?: string | null;
  /** Carta sendo arrastada (fica apagada no lugar onde vai cair). */
  ghost?: string | null;
}) {
  const hand = order ?? state.players[player].hand;
  const n = hand.length;
  return (
    <div className={['hand', position].join(' ')} style={vars({ '--n': n })} data-anchor={`hand-${player}`}>
      {hand.map((uid, i) => {
        const offset = i - (n - 1) / 2;
        return (
          <div
            key={uid}
            className={['hand-card', uid === lifted ? 'lifted' : '', uid === ghost ? 'ghosted' : ''].join(' ')}
            data-hand-uid={uid}
            style={vars({ '--o': offset, '--a': Math.abs(offset), '--z': i })}
          >
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
export function PlayerBanner({
  state,
  player,
  align,
  extra,
}: {
  state: GameState;
  player: PlayerId;
  align: 'left' | 'right';
  /** Online: relógio e conexão do jogador. */
  extra?: ReactNode;
}) {
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
      {extra}
    </div>
  );
}

interface BoardProps extends BoardHandlers {
  state: GameState;
  handOrder?: string[];
  lifted?: string | null;
  ghost?: string | null;
  /** Abre a mão inteira em tamanho grande (mãos com muitas cartas). */
  onExpandHand?: () => void;
  bottom: PlayerId;
  revealTop: boolean;
  revealBottom: boolean;
  /** Botões do canto superior esquerdo (menu, Auto). */
  corner: ReactNode;
  center: ReactNode;
  /** Conteúdo a mais na faixa de cada jogador (partidas online). */
  bannerExtra?: (player: PlayerId) => ReactNode;
}

export function Board({
  state,
  bottom,
  revealTop,
  revealBottom,
  corner,
  center,
  handOrder,
  lifted,
  ghost,
  onExpandHand,
  bannerExtra,
  ...handlers
}: BoardProps) {
  const top = (bottom === 0 ? 1 : 0) as PlayerId;
  return (
    <div className="mat">
      <div className="top-strip">
        <div className="corner">{corner}</div>
        <Hand state={state} player={top} reveal={revealTop} position="top" {...handlers} />
        <PlayerBanner state={state} player={top} align="right" extra={bannerExtra?.(top)} />
      </div>
      {/* A arena inteira aceita cartas arrastadas da mão (jogar ou usar Counter). */}
      <div className="arena" data-drop="field" data-anchor="arena">
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
        <div className="my-bar">
          <PlayerBanner state={state} player={bottom} align="left" extra={bannerExtra?.(bottom)} />
        </div>
        {onExpandHand && state.players[bottom].hand.length > 0 && (
          <button className="hand-expand" onClick={onExpandHand} title="Ver todas as cartas da mão em tamanho grande">
            ⤢ Ver mão <b>{state.players[bottom].hand.length}</b>
          </button>
        )}
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
      </div>
    </div>
  );
}
