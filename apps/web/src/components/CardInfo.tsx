import { buildCardDef, type CardData, type CardDef, type CardStatus } from '@gumgum/engine';
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type MessageKey, useT } from '../i18n';
import { cardText, useSettings } from '../settings';
import { StaticCard, StatusTag } from './CardView';

const CATEGORY: Record<CardDef['category'], MessageKey> = {
  leader: 'card.cat.leader',
  character: 'card.cat.character',
  event: 'card.cat.event',
  stage: 'card.cat.stage',
};

/**
 * Mensagem com elementos no lugar dos `{nome}` (links, negrito, código): passe `t(chave)` sem parâmetros
 * e os elementos em `slots`. Parâmetros sem elemento ficam como estão.
 */
export function fillSlots(message: string, slots: Record<string, ReactNode>): ReactNode {
  return message.split(/\{(\w+)\}/).map((part, i) => <Fragment key={i}>{i % 2 ? (part in slots ? slots[part] : `{${part}}`) : part}</Fragment>);
}

/** Nome, atributos e texto da carta no idioma escolhido (com "ver original"); `statuses` = efeitos temporários em campo. */
export function CardTextInfo({ def, power, cost, statuses }: { def: CardDef; power?: number; cost?: number; statuses?: CardStatus[] }) {
  const { locale } = useSettings();
  const t = useT();
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => setShowOriginal(false), [def.id]);
  const shown = cardText(def, showOriginal ? 'en' : locale);
  const translated = locale === 'pt-BR' && shown.source !== 'original';

  return (
    <div className="detail-text">
      <div className="detail-name">{def.name}</div>
      <div className="muted small">
        {def.id} · {t(CATEGORY[def.category])} · {def.types.join(' / ')}
        {def.attributes?.length ? ` · ${def.attributes.join('/')}` : ''}
      </div>
      <div className="detail-stats">
        {def.cost !== undefined && (
          <span>
            {cost !== undefined && cost !== def.cost
              ? t('card.costNPrinted', { n: cost, printed: def.cost })
              : t('card.costN', { n: cost ?? def.cost })}
          </span>
        )}
        {def.life !== undefined && <span>{t('card.lifeN', { n: def.life })}</span>}
        {def.power !== undefined && (
          <span>
            {power !== undefined && power !== def.power
              ? t('card.powerNBase', { n: power, base: def.power })
              : t('card.powerN', { n: power ?? def.power })}
          </span>
        )}
        {def.counter ? <span>{t('card.counterN', { n: def.counter })}</span> : null}
      </div>
      {statuses && statuses.length > 0 && (
        <ul className="detail-statuses" aria-label={t('card.activeEffects')}>
          {statuses.map((s, i) => (
            <li key={i}>
              <StatusTag status={s} />
              <span>
                {s.text} <span className="muted">{s.until}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shown.text && <p className="effect">{shown.text}</p>}
      {shown.trigger && (
        <p className="effect trigger">
          <b>{t('card.trigger')}</b> {shown.trigger}
        </p>
      )}
      {locale === 'pt-BR' && (def.text || def.trigger) && (
        <p className="small muted translation-note">
          {translated && shown.source === 'partial' && <>{t('card.translationPartial')} </>}
          {translated && shown.source === 'auto' && <>{t('card.translationAuto')} </>}
          {translated && shown.source === 'manual' && <>{t('card.translationManual')} </>}
          <a onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? t('card.seeTranslated') : t('card.seeOriginal')}</a>
        </p>
      )}
      {def.spoiler && (
        <p className="spoiler-note small">
          {fillSlots(t('card.spoilerNote'), {
            spoiler: <b>{t('card.spoilerWord')}</b>,
            source: def.spoiler.url ? (
              <a href={def.spoiler.url} target="_blank" rel="noreferrer noopener">
                {def.spoiler.source}
              </a>
            ) : (
              def.spoiler.source
            ),
          })}
        </p>
      )}
      {def.manual && (
        <p className="warn small">
          {def.abilities.some((a) => !a.manual && a.steps.length) ? t('card.manualPartial') : t('card.manualAll')}
        </p>
      )}
    </div>
  );
}

/** Painel de detalhes para uma carta fora de partida (construtor de deck). */
export function CardInfo({ card, emptyHint }: { card: CardData | null; emptyHint?: string }) {
  const t = useT();
  const def = useMemo(() => (card ? buildCardDef(card) : null), [card]);
  if (!def) return <div className="detail empty">{emptyHint ?? t('card.hoverHint')}</div>;
  return (
    <div className="detail">
      <div className="detail-card">
        <StaticCard card={card!} />
      </div>
      <CardTextInfo def={def} />
    </div>
  );
}

/** Carta ampliada em modal, com o texto do efeito (toque longo no construtor de deck). Fecha no fundo, no ✕ ou com Esc. */
export function StaticCardZoom({ card, onClose, className }: { card: CardData; onClose: () => void; className?: string }) {
  const t = useT();
  const def = useMemo(() => buildCardDef(card), [card]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={['modal-backdrop zoom-backdrop', className ?? ''].join(' ')} onClick={onClose}>
      <div className="zoom" role="dialog" aria-label={def.name} onClick={(e) => e.stopPropagation()}>
        <button className="zoom-close" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <div className="zoom-card">
          <StaticCard card={card} />
        </div>
        <div className="zoom-text">
          <CardTextInfo def={def} />
        </div>
      </div>
    </div>
  );
}

/**
 * Popover com a carta ampliada e o texto do efeito, ao lado do elemento sob o mouse (construtor de deck).
 * Fica à direita da carta quando cabe, senão à esquerda, sempre dentro da tela; não captura o mouse.
 */
export function CardHoverPreview({ card, anchor }: { card: CardData; anchor: HTMLElement }) {
  const def = useMemo(() => buildCardDef(card), [card]);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 14;
    const pad = 8;
    let left = a.right + gap;
    if (left + w > vw - pad) left = a.left - gap - w;
    // Não cabe de nenhum lado (tela estreita): centraliza sobre a carta.
    if (left < pad) left = Math.max(pad, Math.min(vw - w - pad, a.left + a.width / 2 - w / 2));
    const top = Math.max(pad, Math.min(vh - h - pad, a.top + a.height / 2 - h / 2));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [card, anchor]);
  if (!anchor.isConnected) return null;
  return (
    <div className="card-hover" ref={ref} role="tooltip" aria-live="polite">
      <div className="detail-card">
        <StaticCard card={card} />
      </div>
      <CardTextInfo def={def} />
    </div>
  );
}
