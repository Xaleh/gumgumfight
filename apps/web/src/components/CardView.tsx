import {
  buildCardDef,
  type CardData,
  type CardDef,
  cardDef,
  type FieldCard,
  type GameState,
  getPower,
  HIDDEN_CARD,
  hasKeyword,
  type Keyword,
} from '@gumgum/engine';
import { type ReactNode, useMemo, useState } from 'react';
import { useSettings } from '../settings';

/** 'disabled': carta mostrada numa escolha, mas que não pode ser escolhida. */
export type Highlight = 'option' | 'selected' | 'attacker' | 'target' | 'playable' | 'ready' | 'disabled' | null;

const KEYWORD_LABEL: Record<Keyword, string> = {
  rush: 'Rush',
  blocker: 'Blocker',
  doubleAttack: 'Double Attack',
  banish: 'Banish',
  rushCharacter: 'Rush: Character',
  unblockable: 'Unblockable',
};

const CATEGORY_LABEL = { leader: 'LÍDER', character: 'PERSONAGEM', event: 'EVENTO', stage: 'STAGE' };

interface Props {
  state: GameState;
  uid: string;
  fc?: FieldCard;
  highlight?: Highlight;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onHover?: (uid: string | null) => void;
  /** Arrastável na mesa: 'hand' (jogar) ou 'attacker' (atacar). */
  drag?: 'hand' | 'attacker';
  /** Os DON!! anexados são desenhados pela mesa (cartas por baixo). */
  hideDon?: boolean;
}

export function CardView({ state, uid, fc, highlight, onClick, onDoubleClick, onHover, drag, hideDon }: Props) {
  const def = cardDef(state, uid);
  const { showImages } = useSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const withImage = showImages && Boolean(def.imageUrl) && !imageFailed;
  const power = fc ? getPower(state, uid) : def.power;
  const delta = fc && def.power !== undefined && power !== undefined ? power - def.power : 0;
  const keywords = (Object.keys(KEYWORD_LABEL) as Keyword[]).filter((k) =>
    fc ? hasKeyword(state, uid, k) : def.keywords.includes(k),
  );

  // Carta que este jogador não vê (partida online): só o verso.
  if (def.id === HIDDEN_CARD) {
    return (
      <div className={['card', 'back', highlight ? `hl-${highlight}` : '', onClick ? 'clickable' : ''].join(' ')} onClick={onClick} data-uid={uid}>
        <div className="back-emblem">
          <JollyRoger />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        'card',
        `c-${def.colors[0] ?? 'red'}`,
        def.colors.length > 1 ? `c2-${def.colors[1]}` : '',
        fc?.rested ? 'rested' : '',
        highlight ? `hl-${highlight}` : '',
        onClick ? 'clickable' : '',
        withImage ? 'with-image' : '',
      ].join(' ')}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => onHover?.(uid)}
      onMouseLeave={() => onHover?.(null)}
      title={def.name}
      data-uid={uid}
      data-drag={drag}
    >
      {withImage && (
        <>
          <img
            className="card-img"
            src={def.imageUrl}
            alt={def.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
          {delta !== 0 && power !== undefined && (
            <span className={['img-power', delta > 0 ? 'up' : 'down'].join(' ')}>{power}</span>
          )}
          {fc && fc.don > 0 && !hideDon && <div className="don-badge">DON!! ×{fc.don}</div>}
        </>
      )}
      {/* Enquanto a imagem carrega, a face desenhada fica por baixo. */}
      {(!withImage || !imageLoaded) && (
        <CardFace def={def} power={power} delta={delta} keywords={keywords} fc={withImage || hideDon ? undefined : fc} />
      )}
      {def.manual && (
        <span className="manual-badge" title="Efeito ainda não automatizado: resolvido com as ferramentas manuais">
          ⚙
        </span>
      )}
      <SpoilerTag card={def} />
    </div>
  );
}

/** Etiqueta das cartas anunciadas que ainda não saíram na API oficial. */
export function SpoilerTag({ card }: { card: CardData }) {
  if (!card.spoiler) return null;
  return (
    <span className="spoiler-tag" title={`Spoiler (${card.spoiler.source}): a carta ainda não foi lançada oficialmente`}>
      SPOILER
    </span>
  );
}

function CardFace({
  def,
  power,
  delta,
  keywords,
  fc,
}: {
  def: CardDef;
  power: number | undefined;
  delta: number;
  keywords: Keyword[];
  fc?: FieldCard;
}) {
  return (
    <>
      <div className="card-top">
        {def.category === 'leader' ? (
          <span className="badge life-badge" title="Vida">
            {def.life}
          </span>
        ) : (
          <span className="badge cost-badge" title="Custo">
            {def.cost}
          </span>
        )}
        <span className="card-cat">{CATEGORY_LABEL[def.category]}</span>
      </div>
      <div className="card-body">
        <div className="card-name">{def.name}</div>
        <div className="card-types">{def.types.join(' / ')}</div>
        {keywords.length > 0 && (
          <div className="card-kws">
            {keywords.map((k) => (
              <span key={k} className="kw">
                {KEYWORD_LABEL[k]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="card-bottom">
        {power !== undefined && (
          <span className={['power', delta > 0 ? 'up' : delta < 0 ? 'down' : ''].join(' ')}>{power}</span>
        )}
        {def.counter ? <span className="counter-badge">+{def.counter / 1000}k</span> : null}
      </div>
      {fc && fc.don > 0 && <div className="don-badge">DON!! ×{fc.don}</div>}
    </>
  );
}

/** Carta fora de uma partida (construtor de deck, painel de detalhes). */
export function StaticCard({
  card,
  highlight,
  dimmed,
  badge,
  onClick,
  onContextMenu,
  onHover,
}: {
  card: CardData;
  highlight?: Highlight;
  dimmed?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  onContextMenu?: () => void;
  onHover?: (card: CardData | null) => void;
}) {
  const def = useMemo(() => buildCardDef(card), [card]);
  const { showImages } = useSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const withImage = showImages && Boolean(def.imageUrl) && !imageFailed;
  return (
    <div
      className={[
        'card',
        `c-${def.colors[0] ?? 'red'}`,
        highlight ? `hl-${highlight}` : '',
        onClick ? 'clickable' : '',
        withImage ? 'with-image' : '',
        dimmed ? 'dimmed' : '',
      ].join(' ')}
      onClick={onClick}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu();
            }
          : undefined
      }
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      title={def.name}
    >
      {withImage && (
        <img
          className="card-img"
          src={def.imageUrl}
          alt={def.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageFailed(true)}
        />
      )}
      {(!withImage || !imageLoaded) && <CardFace def={def} power={def.power} delta={0} keywords={def.keywords} />}
      <SpoilerTag card={card} />
      {badge}
    </div>
  );
}

export function CardBack({ label, small }: { label?: string | number; small?: boolean }) {
  return (
    <div className={['card', 'back', small ? 'small' : ''].join(' ')}>
      <div className="back-emblem">
        <JollyRoger />
      </div>
      {label !== undefined && <div className="back-label">{label}</div>}
    </div>
  );
}

/** Caveira com chapéu de palha (verso das cartas e mesa). */
export function JollyRoger() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 44 56 20M8 20l48 24" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="32" cy="34" rx="15" ry="14" fill="currentColor" />
      <rect x="25" y="42" width="14" height="9" rx="3" fill="currentColor" />
      <circle cx="26.5" cy="34" r="4" fill="var(--back-bg, #1c3d63)" />
      <circle cx="37.5" cy="34" r="4" fill="var(--back-bg, #1c3d63)" />
      <path d="M17 25c2-9 28-9 30 0" fill="#f2c14e" />
      <ellipse cx="32" cy="25.5" rx="22" ry="4.5" fill="#f2c14e" />
      <rect x="17" y="21.5" width="30" height="3.5" fill="#d1402f" />
    </svg>
  );
}
