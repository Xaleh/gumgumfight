import { cardDef, cardImage, type GameState, HIDDEN_REF, MAX_CHARACTERS, type PlayerId } from '@gumgum/engine';
import type { CSSProperties, ReactNode } from 'react';
import { useT } from '../i18n';
import { CardBack, CardView, type Highlight, JollyRoger } from './CardView';

export interface BoardHandlers {
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  onCardDouble: (uid: string) => void;
  onHover: (uid: string | null) => void;
  /** Toque no i-ésimo DON!! ativo (marca/desmarca para anexar vários). */
  onDon: (player: PlayerId, index: number) => void;
  /** Posições na fileira dos DON!! ativos marcados (ou arrastados). */
  donPicked: (player: PlayerId) => number[];
  donHighlight: (player: PlayerId) => boolean;
  /** Um DON!! anexado está sendo arrastado de volta e já está sobre a fileira deste jogador. */
  donDrop: (player: PlayerId) => boolean;
  /** Abre a lista do descarte de um jogador. */
  onTrash: (player: PlayerId) => void;
  /** Cartas da mão que podem ser arrastadas para a mesa. */
  canDragHand: (uid: string) => boolean;
  /** Personagens/Líder que podem ser arrastados até um alvo de ataque. */
  canDragAttacker: (uid: string) => boolean;
  /** DON!! que podem ser arrastados até uma carta. */
  canDragDon: (player: PlayerId) => boolean;
  /** Carta cujo DON!! anexado pode ser arrastado de volta para a área de custo (detachDon). */
  canDragAttached: (uid: string) => boolean;
  /** Algo arrastado pode ser solto na mesa deste jogador (jogar carta). */
  fieldDrop: (player: PlayerId) => boolean;
}

interface SideProps extends BoardHandlers {
  state: GameState;
  player: PlayerId;
  position: 'top' | 'bottom';
  /** Botões ao lado do deck e do lixo (histórico, chat). */
  tools?: ReactNode;
  /**
   * Visão do Streamer (desktop, tela inteira): a Vida sai da linha do Líder e vira uma coluna grande
   * numa ponta do campo e os DON!! ficam na outra, como no playmat (Vida à esquerda e DON!! à direita
   * de quem está embaixo; o oponente espelhado). Sem a fileira de DON!! na pilha vertical, as cartas crescem.
   */
  lifeAside?: boolean;
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function PlayerSide({ state, player, position, tools, lifeAside, ...h }: SideProps) {
  const t = useT();
  const ps = state.players[player];
  const isActive = state.activePlayer === player && state.phase === 'main';
  const trashTop = ps.trash[ps.trash.length - 1];
  const slots = Array.from({ length: MAX_CHARACTERS }, (_, i) => ps.characters[i] ?? null);
  const maxLife = cardDef(state, ps.leader.uid).life ?? ps.life.length;

  const fieldCard = (uid: string, fc: (typeof ps.characters)[number]) => {
    // DON!! anexados neste turno e ainda não usados podem ser arrastados de volta para a fileira de DON!!.
    const loose = fc.donLoose ?? 0;
    const draggable = loose > 0 && h.canDragAttached(uid);
    return (
      <div key={uid} className="enter field-card">
        {fc.don > 0 && (
          <div
            className={['attached-don', draggable ? 'loose' : ''].join(' ')}
            title={draggable ? t('board.attachedDonLoose', { n: fc.don, loose }) : t('board.attachedDon', { n: fc.don })}
            data-uid={uid}
            data-drag={draggable ? 'attached' : undefined}
            onClick={() => h.onCard(uid)}
          >
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
  };

  const life = (
    <div className="zone life-zone" title={t('board.lifeTitle', { n: ps.life.length })}>
      <div className="life-stack" key={ps.life.length} data-anchor={`life-${player}`} style={vars({ '--n': ps.life.length })}>
        {ps.life.map((uid, i) => {
          // Vida virada para cima é pública (3-10-2-1): mostra a carta.
          if (!ps.lifeFaceUp?.includes(uid)) return <div key={uid} className="life-card" style={vars({ '--i': i })} />;
          const def = cardDef(state, uid);
          const image = cardImage(state, uid);
          return (
            <div
              key={uid}
              className="life-card face-up"
              title={t('board.lifeFaceUpTitle', { name: def.name })}
              style={vars({ '--i': i, ...(image ? { '--face': `url("${image}")` } : {}) })}
              onMouseEnter={() => h.onHover(uid)}
              onMouseLeave={() => h.onHover(null)}
            />
          );
        })}
      </div>
      <span className={['life-count', ps.life.length === 0 ? 'zero' : ''].join(' ')}>
        ♥ {ps.life.length}
        <small>/{Math.max(maxLife, ps.life.length)}</small>
      </span>
    </div>
  );

  const stage = (
    <div className="zone stage-zone">
      {ps.stage ? fieldCard(ps.stage.uid, ps.stage) : <div className="slot-empty">{t('board.stageSlot')}</div>}
    </div>
  );

  const leader = (
    <div className={['zone', 'leader-zone', isActive ? 'active' : ''].join(' ')}>
      {fieldCard(ps.leader.uid, ps.leader)}
    </div>
  );

  const canDragDon = h.canDragDon(player);
  const donGlow = h.donHighlight(player);
  const donDrop = h.donDrop(player);
  const picked = h.donPicked(player);
  const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
  const onField = ps.donActive + ps.donRested;
  const don = (
    <div
      className={['don-row', position, donGlow ? 'glow' : '', donDrop ? 'drop' : ''].join(' ')}
      title={t('board.donTitle', { deck: ps.donDeck, active: ps.donActive, rested: ps.donRested, attached })}
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
              picked.includes(i) ? 'picked' : donGlow ? 'hl-option' : '',
              canDragDon ? 'clickable' : '',
            ].join(' ')}
            data-drag={canDragDon ? 'don' : undefined}
            data-don={i}
            onClick={() => h.onDon(player, i)}
          />
        ))}
        {Array.from({ length: ps.donRested }, (_, i) => (
          <span key={`r${i}`} className="don-card rested" />
        ))}
      </div>
      <dl className="don-stats" aria-label="DON!!">
        <div>
          <dt>{t('board.donDeck')}</dt>
          <dd>{ps.donDeck}</dd>
        </div>
        <div className="act">
          <dt>{t('board.donActive')}</dt>
          <dd>{ps.donActive}</dd>
        </div>
        <div className="rest">
          <dt>{t('board.donRested')}</dt>
          <dd>{ps.donRested}</dd>
        </div>
        <div className="att">
          <dt>{t('board.donAttached')}</dt>
          <dd>{attached}</dd>
        </div>
      </dl>
    </div>
  );

  const piles = (
    <div className="zone piles">
      <div className="pile" title={t('board.deckTitle', { n: ps.deck.length })} data-anchor={`deck-${player}`}>
        <CardBack />
        <span className="pile-count">{ps.deck.length}</span>
      </div>
      <div
        className="pile clickable"
        data-anchor={`trash-${player}`}
        onClick={() => h.onTrash(player)}
        title={t('board.trashTitle', { n: ps.trash.length })}
      >
        {trashTop ? <CardView state={state} uid={trashTop} /> : <div className="slot-empty">{t('board.trashSlot')}</div>}
        <span className="pile-count">{ps.trash.length}</span>
      </div>
    </div>
  );

  const base = (
    <div className="base-row">
      {position === 'bottom' ? (
        <>
          <div className="base-side left">
            {!lifeAside && life}
            {stage}
          </div>
          {leader}
          <div className="base-side right">
            {piles}
            {tools && <div className="side-tools">{tools}</div>}
          </div>
        </>
      ) : (
        <>
          <div className="base-side left">{piles}</div>
          {leader}
          <div className="base-side right">
            {stage}
            {!lifeAside && life}
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

  const main =
    position === 'top' ? (
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
    );

  return (
    <section
      className={['side', position, isActive ? 'active-side' : '', h.fieldDrop(player) ? 'drop-ok' : '', lifeAside ? 'life-aside' : ''].join(' ')}
      data-drop={position === 'bottom' ? 'field' : undefined}
    >
      {lifeAside ? (
        <>
          {position === 'bottom' ? <div className="life-col">{life}</div> : <div className="don-col">{don}</div>}
          <div className="side-main">
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
          </div>
          {position === 'bottom' ? <div className="don-col">{don}</div> : <div className="life-col">{life}</div>}
        </>
      ) : (
        main
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

/** Coração das faixas de Vida (cheio = Vida que resta; vazio = perdida). */
export function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21.3 3.9 13.4C1.4 10.9 1.6 6.6 4.4 4.6 6.9 2.8 10.2 3.4 12 5.8c1.8-2.4 5.1-3 7.6-1.2 2.8 2 3 6.3.5 8.8L12 21.3z" />
    </svg>
  );
}

/** O servidor mandou as cartas desta mão? (sem elas o leque só viraria versos) */
export function handIsKnown(state: GameState, player: PlayerId): boolean {
  return state.players[player].hand.every((uid) => !uid.startsWith(HIDDEN_REF));
}

/**
 * Mão minimizada (visão do Streamer): uma pilha pequena de versos com a conta de cartas. Clicando, as
 * cartas viram e aparecem grandes (ver `HandFan`); clicando de novo, voltam a ficar escondidas.
 */
export function MiniHand({
  state,
  player,
  position,
  open,
  canOpen,
  onToggle,
}: {
  state: GameState;
  player: PlayerId;
  position: 'top' | 'bottom';
  /** As cartas desta mão estão abertas no leque. */
  open: boolean;
  /** Dá para abrir (o servidor manda as mãos, ou dá para pedir). */
  canOpen: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const ps = state.players[player];
  const n = ps.hand.length;
  const stack = Math.min(n, 7);
  const title = !canOpen ? t('watch.noHandsHint') : open ? t('board.hideHand') : t('board.showHandOf', { name: ps.name });
  return (
    <div className={['mini-hand', position, open ? 'open' : '', canOpen ? '' : 'locked'].join(' ')} data-anchor={`hand-${player}`}>
      <button type="button" className="mini-hand-btn" onClick={onToggle} disabled={!canOpen} aria-expanded={open} aria-label={title} title={title}>
        <span className="mini-stack" style={vars({ '--n': Math.max(stack, 1) })}>
          {Array.from({ length: stack }, (_, i) => (
            <span key={i} className="mini-card" style={vars({ '--i': i })} />
          ))}
          {n === 0 && <span className="mini-card empty" />}
        </span>
        <span className="mini-count">
          <b>{t('board.handCount', { n })}</b>
          <small>{open ? t('board.hideHand') : t('board.showHand')}</small>
        </span>
      </button>
    </div>
  );
}

/**
 * Leque aberto de uma mão (visão do Streamer): as cartas viram do verso para a frente, uma a uma, no
 * mesmo leque da mão do jogador (`.hand-card`), na borda de baixo. A do oponente fica na borda de cima,
 * com o leque girado 180° (cartas de cabeça para baixo), como se ele segurasse a mão do outro lado da
 * mesa. `closing`: a virada de volta antes de sumir.
 */
export function HandFan({
  state,
  player,
  position,
  closing,
  ...h
}: Pick<BoardHandlers, 'highlight' | 'onCard' | 'onCardDouble' | 'onHover'> & {
  state: GameState;
  player: PlayerId;
  position: 'top' | 'bottom';
  closing?: boolean;
}) {
  const t = useT();
  const ps = state.players[player];
  const hand = ps.hand;
  const n = hand.length;
  return (
    <div className={['hand-fan', position, closing ? 'closing' : ''].join(' ')} role="group" aria-label={t('board.showHandOf', { name: ps.name })}>
      <div className="fan-hand" style={vars({ '--n': Math.max(n, 1) })}>
        {hand.map((uid, i) => {
          const offset = i - (n - 1) / 2;
          return (
            <div key={uid} className="hand-card" style={vars({ '--o': offset, '--a': Math.abs(offset), '--z': i, '--i': i })}>
              <div className="fan-flip">
                <div className="fan-face back">
                  <CardBack />
                </div>
                <div className="fan-face front">
                  <CardView
                    state={state}
                    uid={uid}
                    highlight={h.highlight(uid)}
                    onClick={() => h.onCard(uid)}
                    onDoubleClick={() => h.onCardDouble(uid)}
                    onHover={h.onHover}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {n === 0 && <span className="hand-fan-empty">{t('board.handEmpty')}</span>}
      </div>
    </div>
  );
}

/** Faixa do jogador: nome, Líder, Vida e mão. */
export function PlayerBanner({
  state,
  player,
  align,
  pulse,
  extra,
}: {
  state: GameState;
  player: PlayerId;
  align: 'left' | 'right';
  /** Seu turno, jogada com você: a faixa pulsa para lembrar de quem é o turno. */
  pulse?: boolean;
  /** Online: relógio e conexão do jogador. */
  extra?: ReactNode;
}) {
  const t = useT();
  const ps = state.players[player];
  const max = Math.max(cardDef(state, ps.leader.uid).life ?? 0, ps.life.length);
  const isActive = state.activePlayer === player && state.phase === 'main';
  return (
    <div className={['banner', align, isActive ? 'active' : '', isActive && pulse ? 'pulse' : ''].join(' ')}>
      <div className="banner-life" title={t('board.lifeTitle', { n: ps.life.length })} aria-label={t('board.lifeTitle', { n: ps.life.length })}>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={i < ps.life.length ? 'on' : ''}>
            <HeartIcon />
          </span>
        ))}
      </div>
      <div className="banner-name">
        {ps.name}
        {ps.isBot && <span className="tag">{t('board.bot')}</span>}
        <small>{t('board.handCount', { n: ps.hand.length })}</small>
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
  /** Ordena a mão por custo (só a exibição). */
  onSortHand?: () => void;
  /** É o seu turno e a jogada está com você: a sua faixa pulsa. */
  turnPulse?: boolean;
  /** Dica curta sobre a mão (ex.: como usar um Counter), logo acima do leque. */
  handHint?: ReactNode;
  bottom: PlayerId;
  revealTop: boolean;
  revealBottom: boolean;
  /** Botões do canto superior esquerdo (menu, Auto). */
  corner: ReactNode;
  /** Botões ao lado do seu deck e lixo, perto de onde o olho fica (histórico, chat). */
  sideTools?: ReactNode;
  center: ReactNode;
  /** Conteúdo a mais na faixa de cada jogador (partidas online). */
  bannerExtra?: (player: PlayerId) => ReactNode;
  /**
   * Visão do Streamer: as mãos ficam minimizadas (pilha de versos com a conta) e abrem num leque
   * grande só quando clicadas (`open` = de quem é o leque aberto).
   */
  miniHands?: { open: PlayerId | null; canOpen: boolean; onToggle: (player: PlayerId) => void };
  /** Visão do Streamer: a Vida grande na lateral do campo (ver `PlayerSide`). */
  lifeAside?: boolean;
}

export function Board({
  state,
  bottom,
  revealTop,
  revealBottom,
  corner,
  sideTools,
  center,
  handOrder,
  lifted,
  ghost,
  onExpandHand,
  onSortHand,
  turnPulse,
  handHint,
  bannerExtra,
  miniHands,
  lifeAside,
  ...handlers
}: BoardProps) {
  const t = useT();
  const top = (bottom === 0 ? 1 : 0) as PlayerId;
  const miniHand = (player: PlayerId, position: 'top' | 'bottom') =>
    miniHands && (
      <MiniHand
        state={state}
        player={player}
        position={position}
        open={miniHands.open === player}
        canOpen={miniHands.canOpen}
        onToggle={() => miniHands.onToggle(player)}
      />
    );
  return (
    <div className="mat">
      <div className="top-strip">
        <div className="corner">{corner}</div>
        {miniHands ? miniHand(top, 'top') : <Hand state={state} player={top} reveal={revealTop} position="top" {...handlers} />}
        <PlayerBanner state={state} player={top} align="right" extra={bannerExtra?.(top)} />
      </div>
      {/* A arena inteira aceita cartas arrastadas da mão (jogar ou usar Counter). */}
      <div className="arena" data-drop="field" data-anchor="arena">
        <div className="arena-deco" aria-hidden="true">
          <div className="wheel">
            <JollyRoger />
          </div>
        </div>
        <PlayerSide state={state} player={top} position="top" lifeAside={lifeAside} {...handlers} />
        <div className="center-band" data-drop="field">
          {center}
        </div>
        <PlayerSide state={state} player={bottom} position="bottom" tools={sideTools} lifeAside={lifeAside} {...handlers} />
      </div>
      <div className="bottom-strip">
        <div className="my-bar">
          <PlayerBanner state={state} player={bottom} align="left" pulse={turnPulse} extra={bannerExtra?.(bottom)} />
        </div>
        {handHint && !miniHands && <div className="hand-hint">{handHint}</div>}
        {!miniHands && state.players[bottom].hand.length > 0 && (onExpandHand || onSortHand) && (
          <div className="hand-tools">
            {onSortHand && (
              <button className="hand-expand sort" onClick={onSortHand} title={t('board.sortTitle')}>
                {t('board.sort')}
              </button>
            )}
            {onExpandHand && (
              <button className="hand-expand" onClick={onExpandHand} title={t('board.expandTitle')}>
                {t('board.expand')} <b>{state.players[bottom].hand.length}</b>
              </button>
            )}
          </div>
        )}
        {miniHands ? (
          miniHand(bottom, 'bottom')
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
        )}
      </div>
    </div>
  );
}
