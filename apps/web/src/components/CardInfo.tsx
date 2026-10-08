import { buildCardDef, type CardData, type CardDef, type CardStatus } from '@gumgum/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cardText, useSettings } from '../settings';
import { StaticCard, StatusTag } from './CardView';

const CATEGORY = { leader: 'Líder', character: 'Personagem', event: 'Evento', stage: 'Stage' };

/** Nome, atributos e texto da carta no idioma escolhido (com "ver original"); `statuses` = efeitos temporários em campo. */
export function CardTextInfo({ def, power, cost, statuses }: { def: CardDef; power?: number; cost?: number; statuses?: CardStatus[] }) {
  const { lang } = useSettings();
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => setShowOriginal(false), [def.id]);
  const shown = cardText(def, showOriginal ? 'en' : lang);
  const translated = lang === 'pt' && shown.source !== 'original';

  return (
    <div className="detail-text">
      <div className="detail-name">{def.name}</div>
      <div className="muted small">
        {def.id} · {CATEGORY[def.category]} · {def.types.join(' / ')}
        {def.attributes?.length ? ` · ${def.attributes.join('/')}` : ''}
      </div>
      <div className="detail-stats">
        {def.cost !== undefined && (
          <span>
            Custo {cost ?? def.cost}
            {cost !== undefined && cost !== def.cost ? ` (impresso ${def.cost})` : ''}
          </span>
        )}
        {def.life !== undefined && <span>Vida {def.life}</span>}
        {def.power !== undefined && (
          <span>
            Poder {power ?? def.power}
            {power !== undefined && power !== def.power ? ` (base ${def.power})` : ''}
          </span>
        )}
        {def.counter ? <span>Counter +{def.counter}</span> : null}
      </div>
      {statuses && statuses.length > 0 && (
        <ul className="detail-statuses" aria-label="Efeitos ativos">
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
          <b>[Trigger]</b> {shown.trigger}
        </p>
      )}
      {lang === 'pt' && (def.text || def.trigger) && (
        <p className="small muted translation-note">
          {translated && shown.source === 'partial' && '⚠ Tradução automática parcial. '}
          {translated && shown.source === 'auto' && 'Tradução automática. '}
          {translated && shown.source === 'manual' && 'Tradução revisada. '}
          <a onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? 'ver em português' : 'ver original (inglês)'}</a>
        </p>
      )}
      {def.spoiler && (
        <p className="spoiler-note small">
          🔍 <b>Spoiler</b>: carta anunciada que ainda não foi lançada oficialmente. Dados de{' '}
          {def.spoiler.url ? (
            <a href={def.spoiler.url} target="_blank" rel="noreferrer noopener">
              {def.spoiler.source}
            </a>
          ) : (
            def.spoiler.source
          )}
          ; podem mudar até o lançamento, quando a carta oficial substitui esta.
        </p>
      )}
      {def.manual && (
        <p className="warn small">
          {def.abilities.some((a) => !a.manual && a.steps.length)
            ? '⚠ Parte do efeito ainda não é automática (⚙ não é aplicada).'
            : '⚠ Efeito ainda não automatizado.'}
        </p>
      )}
    </div>
  );
}

/** Painel de detalhes para uma carta fora de partida (construtor de deck). */
export function CardInfo({ card, emptyHint }: { card: CardData | null; emptyHint?: string }) {
  const def = useMemo(() => (card ? buildCardDef(card) : null), [card]);
  if (!def) return <div className="detail empty">{emptyHint ?? 'Passe o mouse sobre uma carta para ver os detalhes.'}</div>;
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
export function StaticCardZoom({ card, onClose }: { card: CardData; onClose: () => void }) {
  const def = useMemo(() => buildCardDef(card), [card]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop zoom-backdrop" onClick={onClose}>
      <div className="zoom" role="dialog" aria-label={def.name} onClick={(e) => e.stopPropagation()}>
        <button className="zoom-close" onClick={onClose} aria-label="Fechar">
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
