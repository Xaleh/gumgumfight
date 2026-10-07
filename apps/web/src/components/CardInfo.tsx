import { buildCardDef, type CardData, type CardDef, type CardStatus } from '@gumgum/engine';
import { useEffect, useMemo, useState } from 'react';
import { cardText, useSettings } from '../settings';
import { StaticCard, StatusTag } from './CardView';

const CATEGORY = { leader: 'Líder', character: 'Personagem', event: 'Evento', stage: 'Stage' };

/** Nome, atributos e texto da carta no idioma escolhido (com "ver original"); `statuses` = efeitos temporários em campo. */
export function CardTextInfo({ def, power, statuses }: { def: CardDef; power?: number; statuses?: CardStatus[] }) {
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
        {def.cost !== undefined && <span>Custo {def.cost}</span>}
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
            ? '⚠ Parte do efeito ainda não é automática (⚙ aplicada à mão).'
            : '⚠ Efeito ainda não automatizado.'}
        </p>
      )}
    </div>
  );
}

/** Painel de detalhes para uma carta fora de partida (construtor de deck). */
export function CardInfo({ card }: { card: CardData | null }) {
  const def = useMemo(() => (card ? buildCardDef(card) : null), [card]);
  if (!def) return <div className="detail empty">Passe o mouse sobre uma carta para ver os detalhes.</div>;
  return (
    <div className="detail">
      <div className="detail-card">
        <StaticCard card={card!} />
      </div>
      <CardTextInfo def={def} />
    </div>
  );
}
