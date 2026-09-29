import { cardDef, type FieldCard, type GameState, getPower, hasKeyword, type Keyword } from '@gumgum/engine';

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
      ].join(' ')}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => onHover?.(uid)}
      onMouseLeave={() => onHover?.(null)}
      title={def.name}
    >
      {def.imageUrl ? <img className="card-img" src={def.imageUrl} alt={def.name} loading="lazy" /> : null}
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
    </div>
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
