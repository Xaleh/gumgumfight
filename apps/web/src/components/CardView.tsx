import {
  buildCardDef,
  type CardData,
  type CardDef,
  cardDef,
  type CardStatus,
  cardStatuses,
  type FieldCard,
  type GameState,
  costInHand,
  getCost,
  getPower,
  HIDDEN_CARD,
  hasKeyword,
  type Keyword,
} from '@gumgum/engine';
import { type ReactNode, useMemo, useState } from 'react';
import { useLongPress } from '../hooks/useLongPress';
import { type MessageKey, useT, useTryT } from '../i18n';
import { useSettings } from '../settings';

/** 'disabled': carta mostrada numa escolha, mas que não pode ser escolhida. */
export type Highlight = 'option' | 'selected' | 'attacker' | 'target' | 'playable' | 'ready' | 'disabled' | null;

// Nomes oficiais das palavras-chave, em inglês como no jogo (não se traduzem).
const KEYWORD_LABEL: Record<Keyword, string> = {
  rush: 'Rush',
  blocker: 'Blocker',
  doubleAttack: 'Double Attack',
  banish: 'Banish',
  rushCharacter: 'Rush: Character',
  unblockable: 'Unblockable',
};

const CATEGORY_LABEL: Record<CardDef['category'], MessageKey> = {
  leader: 'card.catUpper.leader',
  character: 'card.catUpper.character',
  event: 'card.catUpper.event',
  stage: 'card.catUpper.stage',
};

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
  /** Carrega a imagem na hora (cartas voando na animação da mesa). */
  eager?: boolean;
}

export function CardView({ state, uid, fc, highlight, onClick, onDoubleClick, onHover, drag, hideDon, eager }: Props) {
  const def = cardDef(state, uid);
  const { showImages } = useSettings();
  const t = useT();
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const withImage = showImages && Boolean(def.imageUrl) && !imageFailed;
  const power = fc ? getPower(state, uid) : def.power;
  const delta = fc && def.power !== undefined && power !== undefined ? power - def.power : 0;
  // Custo atual em campo ("gains +12 cost", auras de custo): a carta mostra o valor que vale para os efeitos.
  // Na mão, o custo que a carta tem agora ("give this card in your hand −3 cost"): é o que vale para jogá-la e para
  // efeitos "play … with a cost of N or less".
  const inHand = !fc && state.cards[uid] !== undefined && state.players[state.cards[uid].owner]?.hand.includes(uid);
  const cost =
    def.cost !== undefined && def.category !== 'leader' ? (fc ? getCost(state, uid) : inHand ? costInHand(state, uid) : def.cost) : def.cost;
  const costDelta = (fc || inHand) && def.cost !== undefined && cost !== undefined ? cost - def.cost : 0;
  const keywords = (Object.keys(KEYWORD_LABEL) as Keyword[]).filter((k) =>
    fc ? hasKeyword(state, uid, k) : def.keywords.includes(k),
  );
  // Marcadores dos efeitos temporários (não ataca, não vira, ganhou [Blocker]…): só em campo.
  const statuses = fc ? cardStatuses(state, uid).filter((s) => s.onCard) : [];

  // Carta que este jogador não vê (partida online): só o verso.
  if (def.id === HIDDEN_CARD) {
    return (
      <div
        className={['card', 'back', highlight ? `hl-${highlight}` : '', onClick ? 'clickable' : ''].join(' ')}
        onClick={onClick}
        data-uid={uid}
      />
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
            loading={eager ? 'eager' : 'lazy'}
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
          {delta !== 0 && power !== undefined && (
            <span className={['img-power', delta > 0 ? 'up' : 'down'].join(' ')}>{power}</span>
          )}
          {costDelta !== 0 && cost !== undefined && (
            <span className={['img-cost', costDelta > 0 ? 'up' : 'down'].join(' ')} title={t('card.costNowTitle', { n: cost, printed: def.cost })}>
              {cost}
            </span>
          )}
          {fc && fc.don > 0 && !hideDon && <div className="don-badge">DON!! ×{fc.don}</div>}
        </>
      )}
      {/* Enquanto a imagem carrega, a face desenhada fica por baixo. */}
      {(!withImage || !imageLoaded) && (
        <CardFace def={def} power={power} delta={delta} cost={cost} costDelta={costDelta} keywords={keywords} fc={withImage || hideDon ? undefined : fc} />
      )}
      {def.manual && (
        <span className="manual-badge" title={t('card.manualTitle')}>
          ⚙
        </span>
      )}
      <StatusMarkers statuses={statuses} />
      <SpoilerTag card={def} />
    </div>
  );
}

/**
 * Tags no topo da carta, uma por efeito temporário, no estilo do aviso "−1 Vida" (Bangers), cada tipo com a
 * sua cor (`tag-<kind>`, palavras-chave `tag-kw-<keyword>`). O texto completo e a duração ficam no tooltip.
 */
export function StatusTag({ status, title }: { status: CardStatus; title?: boolean }) {
  const tryT = useTryT();
  const cls = ['status-tag', `tag-${status.kind}`, status.keyword ? `tag-kw-${status.keyword}` : '', status.tone].join(' ');
  return (
    <span className={cls} title={title ? `${statusText(status, tryT)} (${statusUntil(status, tryT)})` : undefined}>
      <span className="tag-icon">{status.icon}</span>
      {tryT(status.tagKey, status.tagParams) ?? status.tag}
    </span>
  );
}

type TryTranslate = ReturnType<typeof useTryT>;
/** Texto do estado no idioma da interface (o motor manda o português e a chave `status.…`). */
export const statusText = (s: CardStatus, tryT: TryTranslate) => tryT(s.textKey, s.textParams) ?? s.text;
/** Até quando o estado vale, no idioma da interface. */
export const statusUntil = (s: CardStatus, tryT: TryTranslate) => tryT(s.untilKey, s.untilParams) ?? s.until;

function StatusMarkers({ statuses }: { statuses: CardStatus[] }) {
  const t = useT();
  if (!statuses.length) return null;
  return (
    <div className="card-status" aria-label={t('card.activeEffects')}>
      {statuses.map((s, i) => (
        <StatusTag key={i} status={s} title />
      ))}
    </div>
  );
}

/** Etiqueta das cartas anunciadas que ainda não saíram na API oficial. */
export function SpoilerTag({ card }: { card: CardData }) {
  const t = useT();
  if (!card.spoiler) return null;
  return (
    <span className="spoiler-tag" title={t('card.spoilerTitle', { source: card.spoiler.source })}>
      {t('card.spoilerBadge')}
    </span>
  );
}

function CardFace({
  def,
  power,
  delta,
  cost,
  costDelta = 0,
  keywords,
  fc,
}: {
  def: CardDef;
  power: number | undefined;
  delta: number;
  /** Custo atual (em campo) ou impresso. */
  cost?: number;
  costDelta?: number;
  keywords: Keyword[];
  fc?: FieldCard;
}) {
  const t = useT();
  return (
    <>
      <div className="card-top">
        {def.category === 'leader' ? (
          <span className="badge life-badge" title={t('card.life')}>
            {def.life}
          </span>
        ) : (
          <span
            className={['badge', 'cost-badge', costDelta > 0 ? 'up' : costDelta < 0 ? 'down' : ''].join(' ')}
            title={costDelta !== 0 ? t('card.costNowTitle', { n: cost, printed: def.cost }) : t('card.cost')}
          >
            {cost ?? def.cost}
          </span>
        )}
        <span className="card-cat">{t(CATEGORY_LABEL[def.category])}</span>
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
  onLongPress,
}: {
  card: CardData;
  highlight?: Highlight;
  dimmed?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  onContextMenu?: () => void;
  /** `anchor` = o elemento da carta, para posicionar um popover ao lado dela. */
  onHover?: (card: CardData | null, anchor?: HTMLElement) => void;
  /** Toque longo (dedo/caneta): abre a carta ampliada; o clique seguinte é ignorado. */
  onLongPress?: (card: CardData) => void;
}) {
  const def = useMemo(() => buildCardDef(card), [card]);
  const { showImages } = useSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const withImage = showImages && Boolean(def.imageUrl) && !imageFailed;
  const press = useLongPress<HTMLDivElement>(onLongPress ? () => onLongPress(card) : undefined);
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
      {...press.handlers}
      onClick={
        onClick
          ? () => {
              if (press.consume()) return;
              onClick();
            }
          : undefined
      }
      onContextMenu={
        onContextMenu || onLongPress
          ? (e) => {
              e.preventDefault();
              // No toque não existe botão direito: o menu de contexto é só o navegador reagindo ao dedo parado.
              if (press.isTouch()) return;
              onContextMenu?.();
            }
          : undefined
      }
      onMouseEnter={(e) => onHover?.(card, e.currentTarget)}
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
      {label !== undefined && <div className="back-label">{label}</div>}
    </div>
  );
}

/** Caveira com chapéu de palha (mesa). */
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
