// As janelas de escolha da mesa de Yonko, no desenho da mesa de dois (`table/Prompt.tsx`) com os botões desta
// mesa: a largada, a mão inicial, uma pergunta com opções e a escolha entre cartas que não estão na mesa (o topo
// do deck, o descarte, a Vida). Todas recolhem em "Ver a mesa" (a faixa de ação fica com as mesmas respostas) e,
// numa batalha, levam embaixo quem ataca quem (`PromptBackdrop`).

import { cardDef, type GameState, type Pending, type PlayerId } from '@gumgum/engine';
import type { ReactNode } from 'react';
import type { Translate } from '../i18n';
import { CardView, type Highlight } from './CardView';
import { PromptBackdrop, useSkipGuard } from './table/Prompt';
import { orderText } from './table/shared';

type Option = Extract<Pending, { kind: 'option' }>;
type Select = Extract<Pending, { kind: 'selectTargets' }>;

/** A carta que pergunta, em miniatura, com o nome (o toque abre a carta para ler). */
function Source({ s, uid, onCard }: { s: GameState; uid: string; onCard: (uid: string) => void }) {
  if (!s.cards[uid]) return null;
  return (
    <div className="yk-modal-source">
      <span className="source-thumb">
        <CardView state={s} uid={uid} onClick={() => onCard(uid)} />
      </span>
      <span>{cardDef(s, uid).name}</span>
    </div>
  );
}

/** A moldura das janelas: o fundo (com a batalha embaixo), o título e o rodapé com "Ver a mesa" e "Desfazer". */
function Frame({
  s,
  me,
  t,
  label,
  className,
  children,
  onPeek,
  onCancel,
}: {
  s: GameState;
  me: PlayerId;
  t: Translate;
  label: string;
  className?: string;
  children: ReactNode;
  onPeek: () => void;
  onCancel?: () => void;
}) {
  return (
    <PromptBackdrop className="yk-reveal-back yk-modal-back" state={s} human={me}>
      <div className={['yk-modal', className ?? ''].join(' ')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
        <div className="yk-modal-foot">
          <button type="button" className="yk-btn" onClick={onPeek} title={t('game.peekTitle')}>
            {t('game.peek')}
          </button>
          {onCancel && (
            <button type="button" className="yk-btn cancel" onClick={onCancel}>
              {t('yonko.undo')}
            </button>
          )}
        </div>
      </div>
    </PromptBackdrop>
  );
}

/** A curva de DON!! de cada largada, turno a turno: 1, 3, 5, 7, 9, 10 ou 2, 4, 6, 8, 10. */
const CURVES = [
  [1, 3, 5, 7, 9, 10],
  [2, 4, 6, 8, 10],
];

/**
 * A largada (regra do formato): duas escolhas lado a lado, cada uma com a curva de DON!! que ela dá nos turnos
 * seguintes. A primeira opção do motor é a curva ímpar (1 DON!! e a compra); a segunda, a par (2 DON!! sem comprar).
 */
export function CurveModal({ s, me, t, labels, place, onPick, onPeek }: { s: GameState; me: PlayerId; t: Translate; labels: string[]; place: number; onPick: (index: number) => void; onPeek: () => void }) {
  return (
    <Frame s={s} me={me} t={t} label={t('yonko.curve')} className="pick-curve" onPeek={onPeek}>
      <div className="yk-modal-kicker">{t('yonko.curveKicker', { n: place })}</div>
      <h3>{t('yonko.curve')}</h3>
      <p className="muted small">{t('yonko.curveHint')}</p>
      <div className="yk-curves">
        {labels.map((label, index) => (
          <button key={index} type="button" className={['yk-btn', 'yk-curve', index === 0 ? 'primary' : ''].join(' ')} onClick={() => onPick(index)}>
            <span className="yk-curve-row" aria-hidden="true">
              {(CURVES[index] ?? []).map((n, turn) => (
                <i key={turn}>{n}</i>
              ))}
            </span>
            <b>{label}</b>
          </button>
        ))}
      </div>
    </Frame>
  );
}

/** A mão inicial, com as cartas à vista (o toque abre a carta para ler): manter ou trocar. */
export function MulliganModal({
  s,
  me,
  t,
  place,
  onAnswer,
  onCard,
  onPeek,
}: {
  s: GameState;
  me: PlayerId;
  t: Translate;
  place: number;
  onAnswer: (redraw: boolean) => void;
  onCard: (uid: string) => void;
  onPeek: () => void;
}) {
  return (
    <Frame s={s} me={me} t={t} label={t('game.openingHand')} className="wide" onPeek={onPeek}>
      <div className="yk-modal-kicker">{t('yonko.curveKicker', { n: place })}</div>
      <h3>{t('game.openingHand')}</h3>
      <div className="yk-modal-cards deal">
        {s.players[me].hand.map((uid, i) => (
          <span key={uid} style={{ animationDelay: `${i * 70}ms` }}>
            <CardView state={s} uid={uid} onClick={() => onCard(uid)} />
          </span>
        ))}
      </div>
      <p className="muted small">{t('game.mulliganHint')}</p>
      <div className="yk-modal-answers">
        <button type="button" className="yk-btn primary" onClick={() => onAnswer(false)}>
          {t('game.keepHand')}
        </button>
        <button type="button" className="yk-btn" onClick={() => onAnswer(true)}>
          {t('game.redrawHand')}
        </button>
      </div>
    </Frame>
  );
}

/**
 * Uma pergunta com opções (qual efeito usar, a ordem dos efeitos que ativaram juntos, de qual oponente…): a carta
 * que pergunta, as cartas que a pergunta mostra (o topo do deck de alguém, por exemplo) e uma opção por linha.
 */
export function OptionModal({
  s,
  me,
  t,
  pending,
  prompt,
  labels,
  onPick,
  onCard,
  onPeek,
  onCancel,
}: {
  s: GameState;
  me: PlayerId;
  t: Translate;
  pending: Option;
  prompt: string;
  labels: string[];
  onPick: (index: number) => void;
  onCard: (uid: string) => void;
  onPeek: () => void;
  onCancel?: () => void;
}) {
  return (
    <Frame s={s} me={me} t={t} label={prompt} onPeek={onPeek} onCancel={onCancel}>
      <Source s={s} uid={pending.source} onCard={onCard} />
      {pending.shown?.length ? (
        <div className="yk-modal-cards feature">
          {pending.shown.map((uid) => (
            <CardView key={uid} state={s} uid={uid} onClick={() => onCard(uid)} />
          ))}
        </div>
      ) : null}
      <h3>{prompt}</h3>
      {pending.shown?.length ? <p className="muted small">{t('game.tapCardToRead')}</p> : null}
      <div className="yk-modal-options">
        {labels.map((label, index) => (
          <button key={index} type="button" className={['yk-btn', index === 0 ? 'primary' : ''].join(' ')} onClick={() => onPick(index)}>
            {label}
          </button>
        ))}
      </div>
    </Frame>
  );
}

/**
 * A escolha entre cartas que não estão na mesa (a busca no deck, o descarte, a Vida): todas as cartas olhadas
 * aparecem, e as que não podem ser escolhidas ficam apagadas. "Não escolher" fica longe do "Confirmar" e pede o
 * segundo toque (`useSkipGuard`); numa escolha ordenada, a ordem marcada vai escrita embaixo.
 */
export function PickModal({
  s,
  me,
  t,
  pending,
  prompt,
  cards,
  picked,
  quick,
  highlight,
  onCard,
  onRead,
  onChoose,
  onPeek,
  onCancel,
}: {
  s: GameState;
  me: PlayerId;
  t: Translate;
  pending: Select;
  prompt: string;
  /** As cartas da janela: as mostradas pela busca, ou as opções fora da mesa. */
  cards: string[];
  picked: string[];
  /** "Confirmar ações" desligado: a escolha completa sai no toque. */
  quick: boolean;
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  /** A carta de origem aberta para ler. */
  onRead: (uid: string) => void;
  onChoose: (uids: string[]) => void;
  onPeek: () => void;
  onCancel?: () => void;
}) {
  const skip = useSkipGuard(pending);
  const blocked = cards.filter((u) => !pending.options.includes(u)).length;
  const hint =
    pending.max === 0
      ? cards.length
        ? t('game.tapToRead')
        : t('game.opponentSeesChoice')
      : pending.ordered
        ? t('game.tapInOrder')
        : pending.max === 1
          ? t(quick ? 'game.tapOneQuick' : 'game.tapOneConfirm')
          : t('game.tapToChoose');
  return (
    <Frame s={s} me={me} t={t} label={prompt} className={cards.length > 4 ? 'wide' : ''} onPeek={onPeek} onCancel={onCancel}>
      <Source s={s} uid={pending.source} onCard={onRead} />
      <h3>{prompt}</h3>
      <p className="muted small">
        {pending.max > 0 && cards.length > 1 && `${t('game.optionsCount', { n: pending.options.length })} `}
        {hint}
        {blocked > 0 && pending.max > 0 && ` ${t('game.dimmedUnavailable')}`}
      </p>
      <div className="yk-modal-cards">
        {cards.map((uid) => (
          <CardView key={uid} state={s} uid={uid} highlight={highlight(uid)} onClick={() => onCard(uid)} />
        ))}
      </div>
      {pending.ordered && picked.length > 0 && <p className="muted small">{t('game.order', { order: orderText(t, s, picked) })}</p>}
      <div className="yk-modal-answers">
        {pending.max > 0 &&
          pending.min === 0 &&
          (pending.ordered ? (
            <button type="button" className="yk-btn skip" onClick={() => onChoose([])}>
              {t('game.keepOrder')}
            </button>
          ) : (
            <button type="button" className={['yk-btn', 'skip', skip.armed ? 'armed' : ''].join(' ')} onClick={() => skip.press(() => onChoose([]))}>
              {skip.armed ? t('game.skipChoiceArmed') : t('game.skipChoice')}
              {skip.armed && <small>{t('game.skipChoiceArmedSub')}</small>}
            </button>
          ))}
        {pending.max === 0 ? (
          <button type="button" className="yk-btn primary" onClick={() => onChoose([])}>
            {t('game.continue')}
          </button>
        ) : (
          <button
            type="button"
            className="yk-btn primary"
            // Sem nada marcado, "Confirmar" seria outro jeito de seguir sem escolher: só o "Não escolher" faz isso.
            disabled={picked.length < Math.min(pending.min, pending.options.length) || (picked.length === 0 && pending.options.length > 0)}
            onClick={() => onChoose(picked)}
          >
            {pending.max > 1 ? t('game.confirmCount', { n: picked.length, max: pending.max }) : t('game.confirm')}
          </button>
        )}
      </div>
    </Frame>
  );
}
