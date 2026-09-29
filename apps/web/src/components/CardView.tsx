import { cardDef, type FieldCard, type GameState, getPower, hasKeyword, type Keyword } from '@gumgum/engine';
import { useState } from 'react';
import { useSettings } from '../settings';

export type Highlight = 'option' | 'selected' | 'attacker' | 'target' | 'playable' | null;

const KEYWORD_LABEL: Record<Keyword, string> = {
  rush: 'Rush',
  blocker: 'Blocker',
  doubleAttack: 'Double Attack',
  banish: 'Banish',
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
}

export function CardView({ state, uid, fc, highlight, onClick, onDoubleClick, onHover }: Props) {
  const def = cardDef(state, uid);
  const { showImages } = useSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const withImage = showImages && Boolean(def.imageUrl) && !imageFailed;
  const power = fc ? getPower(state, uid) : def.power;
  const delta = fc && def.power !== undefined && power !== undefined ? power - def.power : 0;
  const keywords = (Object.keys(KEYWORD_LABEL) as Keyword[]).filter((k) =>
    fc ? hasKeyword(state, uid, k) : def.keywords.includes(k),
  );

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
            onError={() => setImageFailed(true)}
          />
          {delta !== 0 && power !== undefined && (
            <span className={['img-power', delta > 0 ? 'up' : 'down'].join(' ')}>{power}</span>
          )}
          {fc && fc.don > 0 && <div className="don-badge">DON!! ×{fc.don}</div>}
        </>
      )}
      {!withImage && <CardFace def={def} power={power} delta={delta} keywords={keywords} fc={fc} />}
    </div>
  );
}

function CardFace({
  def,
  power,
  delta,
  keywords,
  fc,
}: {
  def: ReturnType<typeof cardDef>;
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

export function CardBack({ label, small }: { label?: string | number; small?: boolean }) {
  return (
    <div className={['card', 'back', small ? 'small' : ''].join(' ')}>
      <div className="back-emblem">☠</div>
      {label !== undefined && <div className="back-label">{label}</div>}
    </div>
  );
}
