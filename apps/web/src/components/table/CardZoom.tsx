// A carta ampliada, com as ações dela (jogar, atacar, ativar, anexar DON!!, usar como Counter), o detalhe ao passar
// o mouse, a moldura das folhas (lixo, mão, menu) e o aviso das cartas reveladas.

import {
  type Action,
  type CardDef,
  cardDef,
  cardStatuses,
  counterValue,
  type GameState,
  getCost,
  getPower,
  locate,
} from '@gumgum/engine';
import { type ReactNode, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { abilityCostLabel, abilityText, abilityTitle } from '../../game/abilityText';
import { useT, useTryT } from '../../i18n';
import { cardText, useSettings } from '../../settings';
import { CardHoverPreview, CardTextInfo } from '../CardInfo';
import { CardView, StaticCard } from '../CardView';
import type { KeyedLabel } from './shared';

// ------------------------------------------------------------------ zoom da carta

export function CardZoom(props: {
  state: GameState;
  uid: string;
  legal: Action[];
  /** Etapa de Counter: confirma o uso desta carta como Counter. */
  onCounter?: () => void;
  /** Etapa de Counter: outras cartas do jogador que podem receber o valor de Counter (o Líder ou 1 Personagem, 7-1-3-1-1). */
  counterTargets?: string[];
  onCounterTo: (target: string) => void;
  onClose: () => void;
  onDispatch: (a: Action) => void;
  /** DON!! marcados na fileira: o botão de anexar passa a anexar todos eles nesta carta. */
  donCount: number;
  /** Mostra também "Anexar todos os N DON!!" (fora do tutorial, que ensina um DON!! de cada vez). */
  attachAll?: boolean;
  onAttachDons: (target: string, count: number) => void;
  onAttackMode: (attacker: string) => void;
}) {
  const { state, uid, legal } = props;
  const { locale } = useSettings();
  const t = useT();
  const tryT = useTryT();
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  const play = legal.find((a) => a.type === 'playCard' && a.uid === uid);
  const activates = legal.filter((a): a is Extract<Action, { type: 'activate' }> => a.type === 'activate' && a.uid === uid);
  const canAttack = legal.some((a) => a.type === 'attack' && a.attacker === uid);
  const attach = legal.find((a) => a.type === 'attachDon' && a.target === uid);
  // DON!! anexados neste turno e ainda não usados podem voltar para a área de custo.
  const detach = legal.find((a) => a.type === 'detachDon' && a.target === uid);
  const loose = loc?.fc.donLoose ?? 0;
  const owner = state.cards[uid].owner;
  const donActive = state.players[owner].donActive;
  const isEvent = def.category === 'event';
  // Eventos: usar a carta (ou o Counter dela) é o texto dela, destacado sobre a carta.
  const eventPlay = isEvent ? play : undefined;
  const eventCounter = isEvent ? props.onCounter : undefined;
  const hasActions = Boolean((play && !eventPlay) || canAttack || attach || detach || (props.onCounter && !eventCounter));
  const counter = counterValue(state, uid);
  const eventText = isEvent ? cardText(def, locale).text : '';
  // Habilidades ativáveis viram painéis brilhantes (modelo Pokémon TCG Pocket): em tela larga ficam ao lado da
  // carta, ligados a ela pela borda ciano; em tela estreita, sobre a parte de baixo da carta. Com painel na tela, o
  // fundo escurece mais e as ações secundárias (DON!!) viram botões discretos para não competir.
  const hasPlates = activates.length > 0 || Boolean(eventPlay) || Boolean(eventCounter);
  const color = def.colors[0] ?? 'red';

  return (
    <div className={['modal-backdrop', 'zoom-backdrop', hasPlates ? 'dim' : ''].join(' ')} onClick={props.onClose}>
      <div className={['zoom', hasPlates ? 'with-plates' : ''].join(' ')} onClick={(e) => e.stopPropagation()}>
        <button className="zoom-close" onClick={props.onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <div className="zoom-card">
          <CardView state={state} uid={uid} fc={loc?.fc} />
        </div>
        {hasPlates && (
          <div className={['zoom-plates', `c-${color}`].join(' ')}>
            {eventCounter && (
              <button className="ability-plate counter" data-hotkey="confirm" onClick={eventCounter}>
                <div className="plate-title">
                  <span className="plate-icon">🛡</span>
                  {t('game.useEventCounter')}
                  {counter > 0 && <span className="plate-chip">+{counter}</span>}
                </div>
                <p className="plate-text">{eventText}</p>
                <span className="plate-tap">{t('game.tapToUse')}</span>
              </button>
            )}
            {eventPlay && (
              <button className="ability-plate" data-hotkey="confirm" onClick={() => props.onDispatch(eventPlay)}>
                <div className="plate-title">
                  <span className="plate-icon">✦</span>
                  {t('game.useEvent')}
                  <span className="plate-chip">{t('game.costN', { n: def.cost ?? '' })}</span>
                </div>
                <p className="plate-text">{eventText}</p>
                <span className="plate-tap">{t('game.tapToUse')}</span>
              </button>
            )}
            {activates.map((a) => {
              const ability = def.abilities[a.ability];
              // Rótulo curto da habilidade: a chave do motor (`labelKey`), quando há; senão o título de sempre.
              const keyed = ability as typeof ability & KeyedLabel;
              const title = tryT(keyed.labelKey, keyed.labelParams) ?? abilityTitle(ability, locale);
              return (
                <button key={a.ability} className="ability-plate" onClick={() => props.onDispatch(a)}>
                  <div className="plate-title">
                    <span className="plate-icon">✦</span>
                    {title}
                    {abilityCostLabel(ability).map((c) => (
                      <span key={c} className="plate-chip">
                        {c}
                      </span>
                    ))}
                    {ability.oncePerTurn && <span className="plate-chip soft">{t('game.oncePerTurn')}</span>}
                  </div>
                  <p className="plate-text">{abilityText(def, a.ability, locale)}</p>
                  <span className="plate-tap">{t('game.tapToActivate')}</span>
                </button>
              );
            })}
          </div>
        )}
        {hasActions && (
          <div className="zoom-actions">
            {props.onCounter && !eventCounter && (
              <button className="btn primary big" data-hotkey="confirm" onClick={props.onCounter}>
                {t('game.useAsCounter')}
                {counter > 0 && <span className="cost-chip">+{counter}</span>}
              </button>
            )}
            {/* O Counter vai para o atacado; dá também para dar o bônus a outra carta (acaba no fim da batalha). */}
            {props.onCounter && !eventCounter && Boolean(props.counterTargets?.length) && (
              <div className="counter-other">
                <small>{t('game.orGiveTo')}</small>
                {props.counterTargets!.map((target) => (
                  <button
                    key={target}
                    className="btn small quiet"
                    onClick={() => props.onCounterTo(target)}
                    title={t('game.giveCounterTitle', { name: cardDef(state, target).name })}
                  >
                    {cardDef(state, target).name} <small>({getPower(state, target)})</small>
                  </button>
                ))}
              </div>
            )}
            {play && !eventPlay && (
              <button className="btn primary big" data-hotkey="confirm" onClick={() => props.onDispatch(play)}>
                {t('game.play')} <span className="cost-chip">{def.cost}</span>
              </button>
            )}
            {canAttack && (
              <button className="btn attack big" onClick={() => props.onAttackMode(uid)}>
                {t('game.attack')} <span className="cost-chip">{getPower(state, uid)}</span>
              </button>
            )}
            {attach && (
              <button
                className={hasPlates ? 'btn small quiet' : 'btn don big'}
                onClick={() => (props.donCount > 1 ? props.onAttachDons(uid, props.donCount) : props.onDispatch(attach))}
              >
                {props.donCount > 1 ? t('game.attachDons', { n: props.donCount }) : t('game.attachOneDon')}{' '}
                <small>{t('game.donActiveCount', { n: state.players[owner].donActive })}</small>
              </button>
            )}
            {/* Todos os DON!! ativos de uma vez nesta carta (some quando o botão de cima já faz isso). */}
            {attach && props.attachAll && donActive > Math.max(1, props.donCount) && (
              <button className={hasPlates ? 'btn small quiet' : 'btn don big'} onClick={() => props.onAttachDons(uid, donActive)}>
                {t('game.attachAllDons', { n: donActive })}
              </button>
            )}
            {detach && (
              <button
                className={hasPlates ? 'btn small quiet' : 'btn don big'}
                onClick={() => props.onDispatch(detach)}
                title={t('game.detachDonTitle')}
              >
                {t('game.detachOneDon')} <small>({t('game.donCanReturn', { n: loose })})</small>
              </button>
            )}
          </div>
        )}
        <div className="zoom-text">
          <CardTextInfo
            def={def}
            power={loc ? getPower(state, uid) : undefined}
            cost={loc && def.category !== 'leader' ? getCost(state, uid) : undefined}
            statuses={loc ? cardStatuses(state, uid) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

/** Mesa larga, hover "junto da carta": a carta ampliada ao lado da carta sob o mouse (a mesma caixa dos nomes no histórico). */
export function HoverTip({ state, uid }: { state: GameState; uid: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setAnchor(document.querySelector<HTMLElement>(`.mat .card[data-uid="${CSS.escape(uid)}"]`));
  }, [uid]);
  if (!anchor) return null;
  return createPortal(<CardHoverPreview card={cardDef(state, uid)} anchor={anchor} />, document.body);
}

export function CardDetail({ state, uid }: { state: GameState; uid: string | null }) {
  const t = useT();
  if (!uid) {
    return <div className="detail empty">{t('game.detailEmpty')}</div>;
  }
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  return (
    <div className="detail">
      <div className="detail-card">
        <CardView state={state} uid={uid} fc={loc?.fc} />
      </div>
      <CardTextInfo
        def={def}
        power={loc ? getPower(state, uid) : undefined}
        cost={loc && def.category !== 'leader' ? getCost(state, uid) : undefined}
        statuses={loc ? cardStatuses(state, uid) : undefined}
      />
    </div>
  );
}

// ------------------------------------------------------------------ folhas

export function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Linha do histórico com cartas reveladas, para o aviso na mesa. */
export interface RevealLine {
  text: string;
  cards: CardDef[];
  /** Quantas vezes a mesma linha se repetiu antes de o aviso ser fechado (ex.: duas buscas seguidas da mesma carta). */
  count: number;
}

/** Junta as revelações novas às do aviso aberto: a linha repetida vira uma só, com as cartas lado a lado e "×N". */
export function mergeReveals(open: RevealLine[], lines: RevealLine[]): RevealLine[] {
  const out = [...open];
  for (const line of lines) {
    const i = out.findIndex((l) => l.text === line.text);
    if (i < 0) out.push(line);
    else out[i] = { ...out[i], cards: [...out[i].cards, ...line.cards], count: out[i].count + line.count };
  }
  return out;
}

/** Cartas reveladas pelo oponente: a carta inteira (toque para ler) e a linha do histórico. */
export function RevealedCards({ lines, onCard, onClose }: { lines: RevealLine[]; onCard: (def: CardDef) => void; onClose: () => void }) {
  const t = useT();
  const n = lines.reduce((sum, l) => sum + l.cards.length, 0);
  return (
    <div className="modal-backdrop reveal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-label={t('game.revealedTitle', { n })} onClick={(e) => e.stopPropagation()}>
        <div className="modal-kicker">{t('game.revealedTitle', { n })}</div>
        {lines.map((line, i) => (
          <div key={i} className="reveal-line">
            <div className="modal-feature reveal-cards">
              {line.cards.map((def, j) => (
                <StaticCard key={j} card={def} onClick={() => onCard(def)} />
              ))}
            </div>
            <p className="small">
              {line.text}
              {line.count > 1 && <b className="reveal-times">×{line.count}</b>}
            </p>
          </div>
        ))}
        <p className="muted small">{t('game.tapCardToRead')}</p>
        <div className="btn-row center">
          <button className="btn primary big" onClick={onClose} autoFocus>
            {t('game.revealedOk')}
          </button>
        </div>
      </div>
    </div>
  );
}
