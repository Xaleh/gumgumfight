// Mesa de Yonko (todos contra todos): cada lugar é um playmat na cor do Líder (Vida empilhada, deck, descarte
// e DON!! em cartas, como na mesa de dois), os oponentes no alto, a faixa de ação no meio, a mesa de quem joga
// embaixo com a mão em leque, e ao lado a carta em destaque e o registro. No celular os oponentes viram abas,
// com uma mesa aberta por vez.
//
// É uma tela própria, não uma adaptação da mesa de dois jogadores (`GameScreen`), mas divide com ela os gestos
// (`useTableGestures`: o clique, o toque longo que abre a carta, e arrastar a carta da mão para o campo, o
// atacante até o alvo e um DON!! até uma carta) e as animações (`useBoardMotion`: cartas e DON!! voando, a vitrine
// no centro, o impacto do ataque), que seguem a opção "Animações" do jogador: completas, suaves ou desligadas. A mesa recebe
// o jogo de fora: a partida local contra bots (`useYonkoGame`, em `LocalYonkoTable`) ou a mesa online
// (`useYonkoOnline`, em `YonkoOnline.tsx`).

import {
  type Action,
  cancelAllowed,
  cardDef,
  cardImage,
  cardStatuses,
  counterValue,
  type FieldCard,
  type GameState,
  getCost,
  getPower,
  HIDDEN_CARD,
  legalActions,
  locate,
  MAX_CHARACTERS,
  type Pending,
  playCost,
  playError,
  type PlayerId,
  type PlayerState,
} from '@gumgum/engine';
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { abilityCostLabel, abilityText, abilityTitle } from '../game/abilityText';
import { listText, logText, msgText, winReasonText } from '../game/engineText';
import { useMatchAudio } from '../game/useMatchAudio';
import { useYonkoGame, type YonkoSetup } from '../game/useYonkoGame';
import { useBoardSize } from '../hooks/useBoardSize';
import { type Translate, useT, useTryT } from '../i18n';
import { AnimationsSeg, cardText, useSettings, VolumeControl } from '../settings';
import { CardTextInfo } from './CardInfo';
import { CardView, type Highlight, PickOrderContext } from './CardView';
import { Icon } from './Icons';
import { useBoardMotion } from './Motion';
import { askText, type Confirm, hasCost } from './table/Prompt';
import type { Drag } from './table/shared';
import { useTableGestures } from './table/useTableGestures';

type TryT = ReturnType<typeof useTryT>;
/** O que a mesa precisa do jogo: a visão de quem joga, a jogada e o último erro. */
export interface TableGame {
  state: GameState;
  dispatch: (action: Action) => void;
  error: string | null;
  /** Segura os bots enquanto a pessoa lê o registro ou uma carta (só na mesa local). */
  setPaused?: (paused: boolean) => void;
  /** A última jogada aplicada, de quem for (só na mesa local): a habilidade ativada ganha o destaque no centro. */
  lastAction?: Action;
}

/** Na mesa online: o relógio e a conexão de cada jogador (para os painéis e a ordem dos turnos). */
export interface SeatStatus {
  /** Tempo que resta, já formatado ("21:10"); sem relógio, nada. */
  clock?: string;
  /** Menos de 2 minutos. */
  low?: boolean;
  /** O relógio dele está correndo agora. */
  ticking?: boolean;
  /** Sem conexão com a mesa. */
  away?: boolean;
}

export interface TableExtras {
  /** O texto da pílula do topo ("Yonko · mesa ABC123"). */
  pill?: string;
  status?: (id: PlayerId) => SeatStatus;
  /** Aviso na faixa do meio (conexão caiu, tentando de novo…). */
  notice?: string | null;
  /** No fim: sem "Jogar de novo" (quem não criou a mesa espera), com este aviso no lugar. */
  rematchNote?: string;
}

const COLOR_VAR: Record<string, string> = {
  red: 'var(--red)',
  green: 'var(--green)',
  blue: 'var(--blue-card)',
  purple: 'var(--purple)',
  black: 'var(--yk-black)',
  yellow: 'var(--yellow)',
};

const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** A cor do lugar: a primeira cor do Líder. */
const seatColor = (s: GameState, id: PlayerId) => COLOR_VAR[cardDef(s, s.players[id].leader.uid).colors[0] ?? 'red'] ?? 'var(--red)';

/** Os lugares na ordem dos turnos, a partir de quem começou. */
const seatOrder = (s: GameState): PlayerId[] => s.players.map((_, i) => (s.firstPlayer + i) % s.players.length);

/** Vida com que o jogador começou (a impressa no Líder mais a da mesa). */
const startingLife = (s: GameState, id: PlayerId) => (cardDef(s, s.players[id].leader.uid).life ?? 5) + (s.table?.extraLife ?? 0);

/** Vida de agora; durante a preparação (a Vida ainda não foi posta), a que o jogador vai ter. */
const lifeNow = (s: GameState, id: PlayerId) => (s.phase === 'mulligan' && !s.players[id].out ? startingLife(s, id) : s.players[id].life.length);

const donOnField = (ps: PlayerState) => ps.donActive + ps.donRested + [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])].reduce((n, c) => n + c.don, 0);

/** Texto de uma pergunta do motor no idioma da interface (ver `GameScreen`). */
function promptText(tryT: TryT, pending: { prompt: string; promptKey?: string; promptParams?: Record<string, string | number>; promptParts?: Parameters<typeof msgText>[3]; cannot?: true }): string {
  const text = msgText(tryT, pending.promptKey, pending.promptParams, pending.promptParts);
  if (text === undefined) return pending.prompt;
  return pending.cannot ? `${text} ${tryT('engine.cannotPayCost') ?? ''}`.trim() : text;
}

/** As opções de uma escolha `option` no idioma da interface. */
function optionLabels(tryT: TryT, pending: Extract<Pending, { kind: 'option' }>): string[] {
  return pending.options.map((text, i) => {
    const parts = pending.optionParts?.[i];
    const key = pending.optionKeys?.[i];
    return (parts ? listText(tryT, parts) : undefined) ?? (key ? tryT(key, pending.promptParams) : undefined) ?? text;
  });
}

/** As duas respostas de uma pergunta de sim ou não: "Pagar e usar" só quando há custo; no "comprar até N", comprar ou parar. */
const confirmLabels = (t: Translate, p: Confirm) => ({
  yes: p.drawUpTo ? t('game.drawOne') : hasCost(p) ? t('game.payAndUse') : t('game.useEffect'),
  no: p.drawUpTo ? t('game.stop') : t('game.dontUse'),
});

interface Btn {
  label: string;
  onClick: () => void;
  kind?: 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
}

interface BannerView {
  icon: 'swords' | 'shield' | 'bot' | 'crown' | 'deck' | 'check' | 'eye';
  text: ReactNode;
  sub?: ReactNode;
  chip?: string;
  buttons: Btn[];
  /** Cartas mostradas na própria faixa (opções fora da mesa: deck, descarte, Vida). */
  tray?: string[];
  /** O jogador da vez é quem está na tela (a faixa fica em destaque). */
  mine: boolean;
  /** A mesa espera outra pessoa (ou um bot): a faixa mostra os três pontinhos. */
  waiting?: boolean;
  /** A pergunta abre numa janela (a carta da Vida, usar um efeito): o botão do olho a recolhe para olhar a mesa. */
  peek?: boolean;
}

/**
 * Carta da mesa: `CardView` num invólucro que segura o menu de contexto do toque longo. O toque longo (abre a
 * carta para ler) e o arrasto são da mesa inteira (`useTableGestures`, em `YonkoTable`).
 */
function TableCard({
  s,
  uid,
  fc,
  highlight,
  onClick,
  onHover,
  drag,
}: {
  s: GameState;
  uid: string;
  fc?: FieldCard;
  highlight: Highlight;
  onClick?: () => void;
  onHover: (uid: string | null) => void;
  /** Arrastável: 'hand' (jogar, ou usar de Counter) ou 'attacker' (atacar). */
  drag?: 'hand' | 'attacker';
}) {
  return (
    <span className="yk-card" onContextMenu={(e) => e.preventDefault()}>
      <CardView state={s} uid={uid} fc={fc} highlight={highlight} onClick={onClick} onHover={onHover} drag={drag} />
    </span>
  );
}

/** O Líder do lugar num medalhão, recortado no rosto, com o anel na cor do lugar (sem imagens, a inicial). */
function Avatar({ s, id, className }: { s: GameState; id: PlayerId; className?: string }) {
  const { showImages } = useSettings();
  const [failed, setFailed] = useState(false);
  const uid = s.players[id].leader.uid;
  const image = s.cards[uid] ? cardImage(s, uid) : undefined;
  return (
    <span className={['yk-av', className ?? ''].join(' ')} style={vars({ '--pc': seatColor(s, id) })} aria-hidden="true">
      {showImages && image && !failed ? <img src={image} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} /> : s.players[id].name.slice(0, 1)}
    </span>
  );
}

interface CardHandlers {
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  onInspect: (uid: string) => void;
  onHover: (uid: string | null) => void;
}

/** O que está sendo arrastado pode ser solto aqui? (para o destaque da mesa de quem joga) */
type DropState = null | 'ok' | 'over';

/**
 * A Vida empilhada como na mesa de dois (cartas deitadas, as viradas para cima com a frente à mostra) e, por
 * cima, o contador. Durante a preparação a Vida ainda não foi posta: fica o contorno com a Vida que o jogador
 * vai ter.
 */
function LifeStack({ s, id, h, t }: { s: GameState; id: PlayerId; h: CardHandlers; t: Translate }) {
  const ps = s.players[id];
  const now = lifeNow(s, id);
  const max = Math.max(startingLife(s, id), now);
  const n = ps.life.length;
  return (
    <div className="yk-life" title={t('yonko.life', { n: now, max })}>
      <div className="yk-life-stack" key={`stack-${n}`} data-anchor={`life-${id}`} style={vars({ '--n': Math.max(n, 1) })}>
        {ps.life.map((uid, i) => {
          if (!ps.lifeFaceUp?.includes(uid)) return <div key={i} className="life-card" style={vars({ '--i': i })} />;
          const image = cardImage(s, uid);
          return (
            <div
              key={i}
              className="life-card face-up"
              title={cardDef(s, uid).name}
              style={vars({ '--i': i, ...(image ? { '--face': `url("${image}")` } : {}) })}
              onClick={() => h.onInspect(uid)}
              onMouseEnter={() => h.onHover(uid)}
              onMouseLeave={() => h.onHover(null)}
            />
          );
        })}
        {n === 0 && <span className="yk-life-empty" />}
      </div>
      <span key={`hearts-${now}`} className={['yk-hearts', now === 0 ? 'zero' : now <= 2 ? 'low' : ''].join(' ')}>
        <Icon name="heart" size={12} />
        <b>{now}</b>
        <small>/{max}</small>
      </span>
    </div>
  );
}

/** O deck de DON!!, os DON!! em campo em cartas (ativos em pé, virados deitados) e a conta dos ativos. */
function DonRow({ ps, t, draggable, dragging }: { ps: PlayerState; t: Translate; draggable?: boolean; dragging?: number[] }) {
  const total = ps.donActive + ps.donRested;
  return (
    <div className="yk-don" title={t('yonko.donTitle')}>
      <span className="yk-dondeck" data-anchor={`dondeck-${ps.id}`}>
        <span className={['don-card', ps.donDeck > 0 ? 'back' : 'empty'].join(' ')} />
        <b className="yk-count">{ps.donDeck}</b>
      </span>
      <span className="yk-don-cards" data-anchor={`don-${ps.id}`} style={vars({ '--n': Math.max(total, 1) })}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={['don-card', i >= ps.donActive ? 'rested' : '', dragging?.includes(i) ? 'dragging' : ''].join(' ')}
            {...(draggable && i < ps.donActive ? { 'data-drag': 'don', 'data-don': i } : {})}
          />
        ))}
      </span>
      <span className="yk-don-count" aria-label={t('yonko.don', { n: donOnField(ps), active: ps.donActive })}>
        <b>{ps.donActive}</b>
        <small>/{total}</small>
      </span>
    </div>
  );
}

/** O deck (verso com a conta) e o descarte (a carta de cima; o toque abre a lista). */
function Piles({ s, id, h, t, onTrash }: { s: GameState; id: PlayerId; h: CardHandlers; t: Translate; onTrash: (id: PlayerId) => void }) {
  const ps = s.players[id];
  const top = ps.trash[ps.trash.length - 1];
  return (
    <div className="yk-piles">
      <span className="yk-pile" data-anchor={`deck-${id}`} title={t('board.deckTitle', { n: ps.deck.length })}>
        {ps.deck.length > 0 ? <span className="card back" /> : <span className="yk-slot" />}
        <b className="yk-count">{ps.deck.length}</b>
      </span>
      <span
        className="yk-pile pile"
        role="button"
        tabIndex={0}
        data-anchor={`trash-${id}`}
        title={t('board.trashTitle', { n: ps.trash.length })}
        onClick={() => onTrash(id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTrash(id);
          }
        }}
      >
        {top && s.cards[top] ? <CardView state={s} uid={top} onHover={h.onHover} /> : <span className="yk-slot">{t('board.trashSlot')}</span>}
        <b className="yk-count">{ps.trash.length}</b>
      </span>
    </div>
  );
}

/** A mão de um oponente: um leque de versos com a conta (as cartas compradas e jogadas voam daqui). */
function HandFan({ id, n, title }: { id: PlayerId; n: number; title: string }) {
  const shown = Math.min(n, 7);
  return (
    <span className="yk-fan" data-anchor={`hand-${id}`} title={title}>
      <span className="yk-fan-cards" aria-hidden="true">
        {Array.from({ length: shown }, (_, i) => (
          <i key={i} style={vars({ '--o': i - (shown - 1) / 2 })} />
        ))}
      </span>
      <b>{n}</b>
    </span>
  );
}

/** O relógio e a conexão de um jogador, na placa dele (só na mesa online). */
function SeatClock({ status, t }: { status?: SeatStatus; t: Translate }) {
  if (!status) return null;
  return (
    <>
      {status.away && <span className="yk-tag away">{t('yonko.away')}</span>}
      {status.clock && (
        <span className={['yk-clock', status.low ? 'low' : '', status.ticking ? 'ticking' : ''].join(' ')} title={t('yonko.clockTitle')}>
          <Icon name="clock" size={13} /> {status.clock}
        </span>
      )}
    </>
  );
}

/** Os Personagens nos cinco lugares do campo (os vazios ficam marcados). */
function FieldRow({ ps, card }: { ps: PlayerState; card: (fc: FieldCard) => ReactNode }) {
  return (
    <div className="yk-row">
      {Array.from({ length: Math.max(MAX_CHARACTERS, ps.characters.length) }, (_, i) => {
        const fc = ps.characters[i];
        return (
          <span key={fc?.uid ?? `empty-${i}`} className="yk-cell">
            {fc ? card(fc) : <span className="yk-slot" />}
          </span>
        );
      })}
    </div>
  );
}

/** Playmat de um oponente: tudo o que é informação pública dele. */
function Opponent({
  s,
  id,
  index,
  place,
  h,
  targeted,
  attacked,
  playing,
  hidden,
  t,
  status,
  onTrash,
}: {
  s: GameState;
  id: PlayerId;
  /** Posição entre os oponentes (para a entrada em cascata). */
  index: number;
  status?: SeatStatus;
  /** Posição na ordem dos turnos (1 = quem começou). */
  place: number;
  h: CardHandlers;
  /** Há um alvo válido nesta mesa, ou ela é a atacada. */
  targeted: boolean;
  /** É a mesa atacada na batalha em curso. */
  attacked: boolean;
  playing: boolean;
  /** No celular: outra aba está aberta. */
  hidden: boolean;
  t: Translate;
  onTrash: (id: PlayerId) => void;
}) {
  const ps = s.players[id];
  const leader = cardDef(s, ps.leader.uid);
  const card = (fc: FieldCard) => (
    <div key={fc.uid} className="field-card">
      <TableCard s={s} uid={fc.uid} fc={fc} highlight={h.highlight(fc.uid)} onClick={() => h.onCard(fc.uid)} onHover={h.onHover} />
    </div>
  );
  return (
    <section
      className={['yk-mat', 'yk-opp', attacked ? 'focus' : targeted ? 'aim' : '', playing ? 'playing' : '', ps.out ? 'out' : '', hidden ? 'tab-off' : ''].join(' ')}
      style={vars({ '--pc': seatColor(s, id), '--i': index })}
      aria-label={t('yonko.tableOf', { name: ps.name })}
    >
      <header className="yk-plate">
        <span className="yk-ord">{t('yonko.place', { n: place })}</span>
        <b className="yk-name">{ps.name}</b>
        <span className="yk-leader-name">{leader.name}</span>
        {ps.out ? <span className="yk-tag out">{t('yonko.tagOut')}</span> : targeted ? <span className="yk-tag">{t('yonko.tagTarget')}</span> : playing ? <span className="yk-tag turn">{t('yonko.tagTurn')}</span> : null}
        {!ps.out && <SeatClock status={status} t={t} />}
        {!ps.out && <HandFan id={id} n={ps.hand.length} title={t('yonko.hand', { n: ps.hand.length })} />}
      </header>
      {ps.out ? (
        <div className="yk-out-note">
          <b>{t('yonko.tagOut')}</b>
          <p>{t('yonko.outNote')}</p>
        </div>
      ) : (
        <>
          <div className="yk-mat-top">
            <LifeStack s={s} id={id} h={h} t={t} />
            <span className="yk-cell">{card(ps.leader)}</span>
            <span className="yk-cell">{ps.stage ? card(ps.stage) : <span className="yk-slot stage">{t('yonko.stage')}</span>}</span>
            <div className="yk-res">
              <DonRow ps={ps} t={t} />
              <Piles s={s} id={id} h={h} t={t} onTrash={onTrash} />
            </div>
          </div>
          <FieldRow ps={ps} card={card} />
        </>
      )}
    </section>
  );
}

/** Registro da partida: cada linha com a cor do jogador, e a troca de turno como divisória. */
function Log({ s, tryT }: { s: GameState; tryT: TryT }) {
  const end = useRef<HTMLDivElement>(null);
  const lines = s.log.slice(-120);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [s.log.length]);
  return (
    <div className="yk-log" role="log">
      {lines.map((e, i) => {
        const text = logText(tryT, e);
        return (
          <p key={s.log.length - lines.length + i} style={e.player !== null ? vars({ '--pc': seatColor(s, e.player) }) : undefined} className={e.player === null ? (/^\s*[—–-]{1,2}\s/.test(text) ? 'sys turn' : 'sys') : ''}>
            {e.player === null ? text.replace(/^\s*[—–-]{1,2}\s*|\s*[—–-]{1,2}\s*$/g, '') : text}
          </p>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** A carta em destaque: o texto dela e, em campo, o poder e o custo de agora. */
function CardPanel({ s, uid, t }: { s: GameState; uid: string | null; t: Translate }) {
  const def = uid && s.cards[uid] ? cardDef(s, uid) : null;
  if (!uid || !def || def.id === HIDDEN_CARD) {
    return (
      <div className="yk-card-panel empty">
        <span className="yk-card-ghost" aria-hidden="true" />
        <p className="muted small">{t('yonko.cardHint')}</p>
      </div>
    );
  }
  const onField = Boolean(locate(s, uid));
  return (
    <div className="yk-card-panel" key={uid}>
      <span className="yk-card-big">
        <CardView state={s} uid={uid} />
      </span>
      <CardTextInfo def={def} power={onField ? getPower(s, uid) : undefined} cost={onField ? getCost(s, uid) : undefined} statuses={onField ? cardStatuses(s, uid) : undefined} />
    </div>
  );
}

/** Fim da partida: quem venceu e a classificação pela ordem de queda. */
function Result({
  s,
  me,
  t,
  tryT,
  onExit,
  onRematch,
  rematchNote,
  onClose,
}: {
  s: GameState;
  me: PlayerId;
  t: Translate;
  tryT: TryT;
  onExit: () => void;
  onRematch?: () => void;
  rematchNote?: string;
  onClose: () => void;
}) {
  const fallen = [...(s.eliminated ?? [])].reverse();
  const ranked = [...(s.winner !== null ? [s.winner] : []), ...fallen.filter((id) => id !== s.winner)];
  // "You win the game" encerra a mesa com gente ainda de pé: esses ficam sem posição.
  const standing = s.players.map((ps) => ps.id).filter((id) => !ranked.includes(id));
  const title = s.winner === null ? t('yonko.resultDraw') : s.winner === me ? t('yonko.resultWin') : t('yonko.resultLose', { name: s.players[s.winner].name });
  const row = (id: PlayerId, place: string, note: string, i: number) => (
    <li key={id} className={[id === me ? 'me' : '', id === s.winner ? 'first' : ''].join(' ')} style={vars({ '--pc': seatColor(s, id), '--i': i })}>
      <span className="yk-ord">{place}</span>
      <Avatar s={s} id={id} />
      <b>{id === me ? t('yonko.you') : s.players[id].name}</b>
      <span className="muted">{note}</span>
    </li>
  );
  return (
    <div className="yk-result-back" onClick={onClose}>
      <div className={['yk-result', s.winner === me ? 'won' : ''].join(' ')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {s.winner !== null && (
          <div className="yk-result-crown" style={vars({ '--pc': seatColor(s, s.winner) })}>
            <span className="yk-result-rays" aria-hidden="true" />
            <Avatar s={s} id={s.winner} />
            <span className="yk-result-icon" aria-hidden="true">
              <Icon name="crown" size={26} />
            </span>
          </div>
        )}
        <h2>{title}</h2>
        {s.winReason && <p className="muted">{winReasonText(tryT, s)}</p>}
        <ol className="yk-ranking">
          {ranked.map((id, i) => row(id, t('yonko.place', { n: i + 1 }), cardDef(s, s.players[id].leader.uid).name, i))}
          {standing.map((id, i) => row(id, '–', t('yonko.resultStanding'), ranked.length + i))}
        </ol>
        {rematchNote && <p className="muted small">{rematchNote}</p>}
        <div className="yk-result-actions">
          {onRematch && (
            <button type="button" className="yk-btn primary" onClick={onRematch}>
              {t('yonko.rematch')}
            </button>
          )}
          <button type="button" className="yk-btn" onClick={onExit}>
            {t('yonko.exit')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A pergunta de sim ou não do motor (usar um efeito, pagar um custo), no desenho da mesa de dois (`Prompt`, o caso
 * `confirm` no desktop): a carta que pergunta ao lado (o clique abre para ler), o nome, a pergunta sem o nome
 * repetido, o custo numa linha à parte e o texto da carta; as duas respostas do mesmo tamanho, e "Ver a mesa" e
 * "Desfazer" num rodapé discreto. Sem como pagar o custo a pergunta abre mesmo assim (para os oponentes não
 * deduzirem a mão), só com "Não usar".
 */
function AskEffect({
  s,
  pending,
  t,
  tryT,
  onAnswer,
  onPeek,
  onCard,
  onCancel,
}: {
  s: GameState;
  pending: Confirm;
  t: Translate;
  tryT: TryT;
  onAnswer: (yes: boolean) => void;
  onPeek: () => void;
  onCard: (uid: string) => void;
  onCancel?: () => void;
}) {
  const { locale } = useSettings();
  const def = s.cards[pending.source] ? cardDef(s, pending.source) : null;
  const ask = askText(tryT, pending, def?.name);
  const labels = confirmLabels(t, pending);
  const text = def ? cardText(def, locale).text : null;
  return (
    <div className="modal-backdrop ask-backdrop yk-ask-back">
      <div className={`modal-card ask yk-ask c-${def?.colors[0] ?? 'red'}`} role="dialog" aria-modal="true" aria-label={ask.question}>
        <div className="ask-main">
          {def && (
            <div className="ask-art">
              <CardView state={s} uid={pending.source} onClick={() => onCard(pending.source)} />
            </div>
          )}
          <div className="ask-body">
            {def && <div className="ask-name">{def.name}</div>}
            <h3>{ask.question}</h3>
            {ask.cost && (
              <p className="ask-cost">
                <b>{t('card.cost')}</b>
                {ask.cost}
              </p>
            )}
            {pending.cannot && (
              <p className="ask-cannot">
                {ask.cannot && <b>{ask.cannot}</b>}
                {t('game.opponentSeesQuestion')}
              </p>
            )}
            {text && <p className="ask-text">{text}</p>}
            <div className="ask-answers">
              {!pending.cannot && (
                <button type="button" className="yk-btn primary" onClick={() => onAnswer(true)}>
                  {labels.yes}
                </button>
              )}
              <button type="button" className={['yk-btn', pending.cannot ? 'primary' : ''].join(' ')} onClick={() => onAnswer(false)}>
                {labels.no}
              </button>
            </div>
          </div>
        </div>
        <div className="ask-foot">
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
    </div>
  );
}

/**
 * A carta que saiu da Vida, grande no centro da mesa, com o [Trigger] dela (quando há) e a escolha: ativar ou
 * levar para a mão. Toda carta que sai da Vida passa por aqui, com ou sem [Trigger]: os oponentes só veem que uma
 * carta da Vida está sendo olhada. "Ver a mesa" recolhe a janela; a faixa de ação fica com os mesmos botões.
 */
function LifeReveal({ s, uid, trigger, t, onAnswer, onPeek }: { s: GameState; uid: string; trigger: boolean; t: Translate; onAnswer: (yes: boolean) => void; onPeek: () => void }) {
  const { locale } = useSettings();
  const def = cardDef(s, uid);
  const text = def.abilities.some((a) => a.timing === 'trigger') ? cardText(def, locale).trigger : null;
  const title = text ? t('game.triggerRevealed') : t('game.lifeCard');
  return (
    <div className="yk-reveal-back">
      <div className={['yk-reveal', text ? 'trigger' : ''].join(' ')} role="dialog" aria-modal="true" aria-label={`${title}: ${def.name}`}>
        <div className="yk-reveal-kicker">{title}</div>
        <div className="yk-reveal-card" key={uid}>
          <span className="yk-reveal-rays" aria-hidden="true" />
          <CardView state={s} uid={uid} />
        </div>
        <h3>{def.name}</h3>
        {text ? <p className="yk-reveal-text">{text}</p> : <p className="muted small">{t('game.noTriggerHint')}</p>}
        <div className="yk-reveal-actions">
          {trigger && (
            <button type="button" className="yk-btn primary" onClick={() => onAnswer(true)}>
              {t('game.activateTrigger')}
            </button>
          )}
          <button type="button" className={['yk-btn', trigger ? '' : 'primary'].join(' ')} onClick={() => onAnswer(false)}>
            {trigger ? (
              <>
                {t('game.noActivate')} <small>{t('game.goesToHand')}</small>
              </>
            ) : (
              t('game.putInHand')
            )}
          </button>
        </div>
        <button type="button" className="yk-reveal-peek" onClick={onPeek} title={t('game.peekTitle')}>
          {t('game.peek')}
        </button>
      </div>
    </div>
  );
}

/**
 * A seta do ataque, do atacante ao alvo: durante a batalha e, com um atacante escolhido, até o alvo sob o
 * mouse. Atravessa as mesas, então fica por cima do tabuleiro inteiro. Com um dos dois fora da tela (no
 * celular, a mesa de outra aba), não aparece.
 */
function BattleArrow({ from, to, point, aim }: { from: string | null; to: string | null; point?: { x: number; y: number }; aim: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [path, setPath] = useState<{ d: string; key: string } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const onResize = () => setTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Mede as cartas depois do layout (a cada desenho da mesa: as cartas mudam de lugar a cada jogada).
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !from || (!to && !point)) {
      if (path) setPath(null);
      return;
    }
    const base = svg.getBoundingClientRect();
    const center = (uid: string) => {
      const el = document.querySelector<HTMLElement>(`.yk-board .field-card .card[data-uid="${CSS.escape(uid)}"]`);
      const r = el?.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return null;
      return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    };
    const a = center(from);
    const b = to ? center(to) : point ? { x: point.x - base.left, y: point.y - base.top } : null;
    const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    if (!a || !b || len < 12) {
      if (path) setPath(null);
      return;
    }
    // Curva suave: ponto de controle deslocado para o lado.
    const bend = Math.min(70, len * 0.16);
    const cx = (a.x + b.x) / 2 - ((b.y - a.y) / len) * bend;
    const cy = (a.y + b.y) / 2 + ((b.x - a.x) / len) * bend;
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (d !== path?.d) setPath({ d, key: `${from}>${to ?? 'ptr'}` });
  });

  // A carta atacante vira ao atacar e as cartas voam ao pousar: mede de novo logo depois.
  useEffect(() => {
    if (!from) return;
    const timers = [200, 420, 900].map((ms) => setTimeout(() => setTick((n) => n + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [from, to]);

  return (
    <svg ref={svgRef} className={['attack-arrow', 'yk-arrow', aim ? (to ? 'aim locked' : 'aim') : 'battle'].join(' ')} aria-hidden="true">
      <defs>
        <marker id="yk-arrow-head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 L2.5 5 Z" fill="#ff4d2e" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
        </marker>
      </defs>
      {path && (
        <g key={path.key}>
          <path className="arrow-shadow" d={path.d} />
          <path className="arrow-line" d={path.d} markerEnd="url(#yk-arrow-head)" />
        </g>
      )}
    </svg>
  );
}

/** A partida local: uma pessoa contra bots, no navegador. */
export function LocalYonkoTable({ setup, onExit, onRematch }: { setup: YonkoSetup; onExit: () => void; onRematch: () => void }) {
  const game = useYonkoGame(setup);
  return <YonkoTable game={game} me={setup.human} onExit={onExit} onRematch={onRematch} />;
}

type Sheet = null | 'log' | 'card' | 'options' | { trash: PlayerId };

export function YonkoTable({
  game,
  me,
  onExit,
  onRematch,
  extras = {},
}: {
  game: TableGame;
  /** O jogador de quem está na tela. */
  me: PlayerId;
  onExit: () => void;
  onRematch?: () => void;
  extras?: TableExtras;
}) {
  const { state: s, dispatch } = game;
  const t = useT();
  const tryT = useTryT();
  const { locale, animations } = useSettings();
  const mine = s.players[me];

  // Só a opção do app decide (como na mesa de dois): `off` troca a mesa na hora, `soft` tira as paradas no
  // centro e os efeitos de enfeite, `full` mostra tudo.
  const animate = animations !== 'off';
  const showy = animations === 'full';
  const board = useRef<HTMLDivElement>(null);
  useBoardSize(board);
  const motion = useBoardMotion(s, { enabled: animate, tempo: 0.85, lastAction: game.lastAction, lang: locale, calm: !showy, root: '.yk' });
  useMatchAudio(s, { enabled: true, animate: showy, tempo: 0.85, human: me, lastAction: game.lastAction });

  /** Carta própria selecionada (na mão ou em campo), com a vez livre. */
  const [sel, setSel] = useState<string | null>(null);
  /** Cartas marcadas numa escolha de alvos. */
  const [picked, setPicked] = useState<string[]>([]);
  /** Carta em destaque no painel (a última apontada ou tocada). */
  const [inspect, setInspect] = useState<string | null>(null);
  /** Carta sob o mouse agora (a seta do ataque aponta para ela). */
  const [hovered, setHovered] = useState<string | null>(null);
  /** Carta da mão erguida sob o mouse. */
  const [peek, setPeek] = useState<string | null>(null);
  /** Celular: a mesa de oponente aberta e a gaveta aberta. */
  const [tab, setTab] = useState<PlayerId | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  /** As cartas de uma escolha (deck, descarte) ou a carta da Vida recolhidas para olhar a mesa. */
  const [trayHidden, setTrayHidden] = useState(false);
  /** O que está sendo arrastado: uma carta da mão, um atacante ou um DON!! ativo. */
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resultOpen, setResultOpen] = useState(true);
  /** A faixa que cruza a mesa na troca de turno. */
  const [flash, setFlash] = useState<{ key: number; text: string; kicker: string; mine: boolean; color: string } | null>(null);

  const order = useMemo(() => seatOrder(s), [s.firstPlayer, s.players.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const placeOf = (id: PlayerId) => order.indexOf(id) + 1;
  /** Os oponentes na ordem em que jogam depois de quem está na tela. */
  const opponents = useMemo(() => order.slice(order.indexOf(me) + 1).concat(order.slice(0, order.indexOf(me))), [order, me]);

  const pending = s.pending;
  const myPending = pending && pending.player === me ? pending : null;
  const legal = useMemo(() => legalActions(s, me), [s, me]);
  const myTurnIdle = !pending && s.phase === 'main' && s.activePlayer === me && legal.some((a) => a.type === 'endTurn');

  // Cada ação zera as marcações; a seleção só vale enquanto a carta continua minha e a vez livre.
  useEffect(() => {
    setPicked([]);
    setSel(null);
    setTrayHidden(false);
  }, [s.actionCount]);

  // A leitura de uma carta ou do registro (celular) segura os bots.
  useEffect(() => {
    game.setPaused?.(sheet !== null);
  }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc fecha a janela aberta; sem janela, solta a carta escolhida.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sheet !== null) setSheet(null);
      else setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  // Celular: a aba acompanha a batalha (a mesa atacada, ou a de quem ataca quando o alvo é quem joga).
  const battle = s.battle && s.cards[s.battle.attacker] && s.cards[s.battle.target] ? s.battle : null;
  const attackerOwner = battle ? s.cards[battle.attacker].owner : null;
  const defender = battle ? s.cards[battle.target].owner : null;
  useEffect(() => {
    const show = defender !== null && defender !== me ? defender : attackerOwner !== null && attackerOwner !== me ? attackerOwner : null;
    if (show !== null) setTab(show);
  }, [attackerOwner, defender, me]);
  const openTab = tab !== null && !s.players[tab].out && tab !== me ? tab : (opponents.find((id) => !s.players[id].out) ?? opponents[0]);

  const round = Math.ceil(s.turn / Math.max(1, s.players.filter((ps) => !ps.out).length));

  // Troca de turno: a faixa cruza a mesa com o nome de quem joga (com as animações desligadas, não aparece).
  const turnKey = s.phase === 'main' ? s.turn : 0;
  useEffect(() => {
    if (!turnKey || !animate) return setFlash(null);
    const p = s.activePlayer;
    setFlash({ key: turnKey, text: p === me ? t('game.yourTurn') : t('game.turnOf', { name: s.players[p].name }), kicker: t('yonko.round', { n: round }), mine: p === me, color: seatColor(s, p) });
    const timer = setTimeout(() => setFlash(null), 1150);
    return () => clearTimeout(timer);
  }, [turnKey, animate]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (a: Action) => dispatch(a);
  /** Quem ataca: a carta arrastada como atacante ou a carta escolhida com um clique. */
  const attacker = drag?.kind === 'attacker' ? drag.uid : sel;
  const targets = attacker && myTurnIdle ? legal.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack' && a.attacker === attacker).map((a) => a.target) : [];
  const canPlay = (uid: string) => legal.some((a) => a.type === 'playCard' && a.uid === uid);
  const canCounter = (uid: string) => myPending?.kind === 'counter' && myPending.options.includes(uid);
  const canAttackWith = (uid: string) => myTurnIdle && legal.some((a) => a.type === 'attack' && a.attacker === uid);
  const canAttachDon = myTurnIdle && legal.some((a) => a.type === 'attachDon');

  /** Destinos válidos para o que está sendo arrastado: o campo (carta da mão), o alvo (atacante) ou a carta (DON!!). */
  const dropValid = (d: Pick<Drag, 'kind' | 'uid'>, over: string | null): boolean => {
    if (!over) return false;
    if (d.kind === 'hand') return over === 'field' && d.uid !== null && (canPlay(d.uid) || canCounter(d.uid));
    if (d.kind === 'attacker') return legal.some((a) => a.type === 'attack' && a.attacker === d.uid && a.target === over);
    if (d.kind === 'don') return legal.some((a) => a.type === 'attachDon' && a.target === over);
    return false;
  };
  const canAct = (uid: string) => legal.some((a) => (a.type === 'attack' && a.attacker === uid) || (a.type === 'activate' && a.uid === uid));

  const select = myPending?.kind === 'selectTargets' ? myPending : null;
  const pickOrder = useMemo(() => (select?.ordered ? new Map(picked.map((u, i) => [u, i + 1])) : null), [select?.ordered, picked]);

  const highlight = (uid: string): Highlight => {
    if (drag) {
      if (uid === drag.uid) return 'selected';
      if (drag.kind === 'attacker') return dropValid(drag, uid) ? 'target' : null;
      if (drag.kind === 'don') return dropValid(drag, uid) ? 'option' : null;
    }
    if (select) return picked.includes(uid) ? 'selected' : select.options.includes(uid) ? 'option' : select.shown?.includes(uid) ? 'disabled' : null;
    if (myPending?.kind === 'block') return myPending.options.includes(uid) ? 'option' : battle?.attacker === uid ? 'attacker' : battle?.target === uid ? 'target' : null;
    if (myPending?.kind === 'counter' && myPending.options.includes(uid)) {
      if (cardDef(s, uid).category === 'event') return 'counterEvent';
      return counterValue(s, uid) >= 2000 ? 'counter2' : 'counter1';
    }
    if (battle) return battle.attacker === uid ? 'attacker' : battle.target === uid ? 'target' : null;
    if (!myTurnIdle) return null;
    if (sel === uid) return 'selected';
    if (targets.includes(uid)) return 'target';
    if (mine.hand.includes(uid)) return canPlay(uid) ? 'playable' : null;
    return canAct(uid) ? 'ready' : null;
  };

  /** No toque não há mouse para apontar: a carta que não tem o que fazer agora abre para ler. */
  const read = (uid: string) => {
    if (window.matchMedia?.('(hover: none)').matches) inspectCard(uid);
  };
  const onCard = (uid: string) => {
    if (s.cards[uid] && cardDef(s, uid).id !== HIDDEN_CARD) setInspect(uid);
    if (select) {
      if (!select.options.includes(uid)) return read(uid);
      // Uma carta só: o toque já responde. Várias: marca e desmarca, e a faixa confirma.
      if (select.max === 1) return send({ type: 'choose', player: me, uids: [uid] });
      setPicked((p) => (p.includes(uid) ? p.filter((u) => u !== uid) : p.length < select.max ? [...p, uid] : p));
      return;
    }
    if (myPending?.kind === 'block') {
      if (myPending.options.includes(uid)) send({ type: 'choose', player: me, uids: [uid] });
      else read(uid);
      return;
    }
    if (myPending?.kind === 'counter') {
      if (myPending.options.includes(uid)) send({ type: 'counter', player: me, uid });
      else read(uid);
      return;
    }
    if (!myTurnIdle) return read(uid);
    if (sel && targets.includes(uid)) return send({ type: 'attack', player: me, attacker: sel, target: uid });
    const own = s.cards[uid]?.owner === me && (mine.hand.includes(uid) || locate(s, uid)?.player === me);
    if (!own) return read(uid);
    // O segundo toque na mesma carta da mão a joga.
    if (sel === uid && mine.hand.includes(uid) && canPlay(uid)) return send({ type: 'playCard', player: me, uid });
    setSel(sel === uid ? null : uid);
  };

  const inspectCard = (uid: string) => {
    if (!s.cards[uid] || cardDef(s, uid).id === HIDDEN_CARD) return;
    setInspect(uid);
    setSheet('card');
  };
  const onHover = (uid: string | null) => {
    setHovered(uid);
    if (uid) setInspect(uid);
  };
  const h: CardHandlers = { highlight, onCard, onInspect: inspectCard, onHover };

  /** Soltou o que arrastava num destino válido: joga a carta (ou a usa de Counter), ataca ou anexa o DON!!. */
  const onDrop = (d: Drag) => {
    if (!d.over || !dropValid(d, d.over)) return;
    if (d.kind === 'hand' && d.uid) send(canCounter(d.uid) ? { type: 'counter', player: me, uid: d.uid } : { type: 'playCard', player: me, uid: d.uid });
    else if (d.kind === 'attacker' && d.uid) send({ type: 'attack', player: me, attacker: d.uid, target: d.over });
    else if (d.kind === 'don') send({ type: 'attachDon', player: me, target: d.over });
  };
  // Os gestos da mesa de dois: o toque longo (ou o clique segurado) abre a carta; arrastar joga, ataca ou anexa.
  const gestures = useTableGestures({
    mode: null,
    dropValid,
    onCard,
    onDrop,
    setDrag,
    setLifted: () => undefined,
    setZoom: (uid) => {
      if (uid) inspectCard(uid);
    },
    setMode: () => undefined,
  });
  /** A mesa de quem joga durante o arrasto de uma carta da mão: pode soltar aqui, e já está em cima. */
  const fieldDrop: DropState = drag?.kind === 'hand' && dropValid(drag, 'field') ? (drag.over === 'field' ? 'over' : 'ok') : null;

  const name = (uid: string) => cardDef(s, uid).name;
  const who = (id: PlayerId) => (id === me ? t('yonko.you') : s.players[id].name);

  /** O que a faixa do meio mostra agora: a pergunta aberta, a carta selecionada ou de quem é a vez. */
  const banner = ((): BannerView => {
    const cancel: Btn[] = cancelAllowed(s, me) ? [{ label: t('yonko.undo'), onClick: () => send({ type: 'cancel', player: me }) }] : [];
    if (myPending) {
      const p = myPending;
      switch (p.kind) {
        case 'mulligan':
          return {
            icon: 'deck',
            mine: true,
            text: t('yonko.mulligan'),
            buttons: [
              { label: t('yonko.mulliganKeep'), kind: 'primary', onClick: () => send({ type: 'mulligan', player: me, redraw: false }) },
              { label: t('yonko.mulliganRedraw'), onClick: () => send({ type: 'mulligan', player: me, redraw: true }) },
            ],
          };
        case 'option': {
          const labels = optionLabels(tryT, p);
          return {
            icon: p.curve ? 'crown' : 'check',
            mine: true,
            text: p.curve ? t('yonko.curve') : promptText(tryT, p),
            sub: p.curve ? t('yonko.curveHint') : undefined,
            tray: p.shown,
            buttons: [...labels.map((label, index): Btn => ({ label, kind: labels.length <= 2 && index === 0 ? 'primary' : undefined, onClick: () => send({ type: 'option', player: me, index }) })), ...cancel],
          };
        }
        case 'confirm': {
          // A pergunta abre na janela `AskEffect`; a faixa fica com as mesmas respostas para quando ela está recolhida.
          const labels = confirmLabels(t, p);
          return {
            icon: 'check',
            mine: true,
            text: promptText(tryT, p),
            peek: true,
            buttons: [
              ...(p.cannot ? [] : [{ label: labels.yes, kind: 'primary' as const, onClick: () => send({ type: 'answer', player: me, yes: true }) }]),
              { label: labels.no, kind: p.cannot ? ('primary' as const) : undefined, onClick: () => send({ type: 'answer', player: me, yes: false }) },
              ...cancel,
            ],
          };
        }
        case 'selectTargets': {
          const offTable = [...new Set([...(p.shown ?? []), ...p.options])].filter((u) => !locate(s, u) && !mine.hand.includes(u));
          const n = picked.length;
          const ready = n >= p.min && n <= p.max;
          const buttons: Btn[] = [];
          if (p.max > 1) buttons.push({ label: t('yonko.confirm', { n }), kind: 'primary', disabled: !ready, onClick: () => send({ type: 'choose', player: me, uids: picked }) });
          else if (p.min === 0) buttons.push({ label: t('yonko.none'), onClick: () => send({ type: 'choose', player: me, uids: [] }) });
          return {
            icon: p.intent === 'harm' ? 'swords' : 'check',
            mine: true,
            text: promptText(tryT, p),
            chip: p.options.length ? t('yonko.options', { n: p.options.length }) : t('yonko.noOptions'),
            sub: p.max > 1 ? t('yonko.pickRange', { min: p.min, max: p.max }) : undefined,
            tray: offTable.length ? offTable : undefined,
            buttons: [...buttons, ...cancel],
          };
        }
        case 'block':
          return {
            icon: 'shield',
            mine: true,
            text: t('yonko.block', { attacker: name(battle!.attacker), power: getPower(s, battle!.attacker), target: name(battle!.target) }),
            chip: t('yonko.options', { n: p.options.length }),
            buttons: [{ label: t('yonko.noBlock'), kind: 'primary', onClick: () => send({ type: 'choose', player: me, uids: [] }) }],
          };
        case 'counter':
          return {
            icon: 'shield',
            mine: true,
            text: p.bystander
              ? t('yonko.counterBystander', { attacker: s.players[attackerOwner ?? me].name, target: s.players[defender ?? me].name })
              : t('yonko.counter', { attacker: name(battle!.attacker), power: getPower(s, battle!.attacker), target: name(battle!.target), defense: getPower(s, battle!.target) }),
            sub: p.bystander ? t('yonko.counterBystanderHint') : p.options.length ? t('yonko.counterHint') : t('yonko.counterNone'),
            buttons: [{ label: t('yonko.pass'), kind: 'primary', onClick: () => send({ type: 'pass', player: me }) }],
          };
        case 'lifeCard': {
          const trigger = legal.some((a) => a.type === 'answer' && a.yes);
          return {
            icon: 'eye',
            mine: true,
            text: t('yonko.lifeCard', { card: name(p.card) }),
            peek: true,
            buttons: [
              ...(trigger ? [{ label: t('yonko.lifeTrigger'), kind: 'primary' as const, onClick: () => send({ type: 'answer', player: me, yes: true }) }] : []),
              { label: t('yonko.lifeToHand'), kind: trigger ? undefined : ('primary' as const), onClick: () => send({ type: 'answer', player: me, yes: false }) },
            ],
          };
        }
        case 'manual':
          return { icon: 'check', mine: true, text: t('yonko.manual', { card: name(p.source) }), sub: p.text, buttons: [{ label: t('yonko.manualDone'), kind: 'primary', onClick: () => send({ type: 'manualDone', player: me }) }] };
        default:
          return { icon: 'check', mine: true, text: '', buttons: cancel };
      }
    }
    if (pending) {
      const other = who(pending.player);
      const key = pending.kind === 'counter' ? 'yonko.waitCounter' : pending.kind === 'block' ? 'yonko.waitBlock' : pending.kind === 'mulligan' || (pending.kind === 'option' && pending.curve) ? 'yonko.waitSetup' : 'yonko.waitChoice';
      return { icon: 'bot', mine: false, waiting: true, text: t(key, { name: other }), buttons: [] };
    }
    if (!myTurnIdle) {
      const active = s.players[s.activePlayer];
      return { icon: 'bot', mine: false, waiting: s.phase !== 'gameover', text: s.activePlayer === me ? t('yonko.resolving') : t('yonko.turnOf', { name: active.name }), buttons: [] };
    }
    if (sel && mine.hand.includes(sel)) {
      const why = playError(s, me, sel);
      return {
        icon: 'deck',
        mine: true,
        text: name(sel),
        sub: why ? t('yonko.cannotPlay') : t('yonko.playHint'),
        buttons: [
          { label: t('yonko.play', { cost: playCost(s, sel) }), kind: 'primary', disabled: Boolean(why), title: why ?? undefined, onClick: () => send({ type: 'playCard', player: me, uid: sel }) },
          { label: t('yonko.cancel'), onClick: () => setSel(null) },
        ],
      };
    }
    if (sel) {
      const def = cardDef(s, sel);
      const abilities = legal.filter((a): a is Extract<Action, { type: 'activate' }> => a.type === 'activate' && a.uid === sel);
      const attach = legal.some((a) => a.type === 'attachDon' && a.target === sel);
      const detach = legal.some((a) => a.type === 'detachDon' && a.target === sel);
      return {
        icon: 'swords',
        mine: true,
        text: targets.length ? t('yonko.attackWith', { card: def.name, power: getPower(s, sel) }) : def.name,
        sub: targets.length ? t('yonko.attackHint') : t('yonko.noAttack'),
        chip: targets.length ? t('yonko.targets', { n: targets.length }) : undefined,
        buttons: [
          ...abilities.map((a): Btn => {
            const ability = def.abilities[a.ability];
            const cost = abilityCostLabel(ability);
            return {
              label: `${abilityTitle(ability, locale)}${cost.length ? ` · ${cost.join(' · ')}` : ''}`,
              title: abilityText(def, a.ability, locale),
              onClick: () => send(a),
            };
          }),
          ...(attach ? [{ label: t('yonko.attachDon'), onClick: () => send({ type: 'attachDon', player: me, target: sel }) }] : []),
          ...(detach ? [{ label: t('yonko.detachDon'), onClick: () => send({ type: 'detachDon', player: me, target: sel }) }] : []),
          { label: t('yonko.cancel'), onClick: () => setSel(null) },
        ],
      };
    }
    // "Encerrar turno" tem o botão próprio, ao lado da faixa (no celular, na barra de baixo).
    return { icon: 'crown', mine: true, text: t('yonko.yourTurn'), sub: t('yonko.yourTurnHint'), buttons: cancel };
  })();

  /** A mesa de um oponente tem algo para quem joga: um alvo do ataque ou da escolha, ou é a atacada. */
  const targeted = (id: PlayerId) => {
    const ps = s.players[id];
    const uids = [ps.leader.uid, ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : [])];
    if (select) return uids.some((u) => select.options.includes(u));
    if (targets.length) return uids.some((u) => targets.includes(u));
    return defender === id;
  };

  const fieldCard = (fc: FieldCard) => (
    <div key={fc.uid} className="field-card">
      <TableCard s={s} uid={fc.uid} fc={fc} highlight={highlight(fc.uid)} onClick={() => onCard(fc.uid)} onHover={onHover} drag={canAttackWith(fc.uid) ? 'attacker' : undefined} />
    </div>
  );
  const leave = () => {
    if (s.phase === 'gameover' || window.confirm(t('yonko.leaveConfirm'))) onExit();
  };
  const endTurn = () => send({ type: 'endTurn', player: me });

  /** Quem a mesa espera agora (o medalhão da faixa do meio). */
  const actor = pending ? pending.player : s.activePlayer;

  // A batalha na faixa: o poder do atacante contra o do alvo e o que falta para acertar ou defender.
  const clash = battle
    ? (() => {
        const atk = getPower(s, battle.attacker) ?? 0;
        const def = getPower(s, battle.target) ?? 0;
        const hits = atk >= def;
        const status =
          defender === me ? (hits ? t('game.needToDefend', { n: atk - def + 1000 }) : t('game.defendedBang')) : hits ? t('game.attackWillHit') : t('game.needToHit', { n: def - atk });
        const label = t(defender === me ? 'yonko.battleMine' : 'yonko.battle', { attacker: name(battle.attacker), power: atk, target: name(battle.target), defense: def, owner: defender !== null ? s.players[defender].name : '' });
        return { atk, def, hits, status, label };
      })()
    : null;

  // A mão em leque: a carta erguida é a da faixa sob o ponteiro (as mesmas contas do leque no CSS, `.hand-card`).
  const hand = mine.hand;
  const peeked = peek !== null && hand.includes(peek) ? peek : null;
  const onHandMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const box = e.currentTarget;
    const first = box.querySelector<HTMLElement>('.hand-card');
    const n = hand.length;
    if (!first || !(e.target as HTMLElement).closest('.hand-card')) {
      if (peek !== null) setPeek(null);
      return;
    }
    const w = box.clientWidth;
    const cw = first.offsetWidth;
    const step = n > 1 ? Math.min(cw * 0.9, (w - cw - 34) / (n - 1)) : cw;
    const x = e.clientX - (box.getBoundingClientRect().left + w / 2 - cw / 2 - ((n - 1) / 2) * step);
    const uid = hand[Math.max(0, Math.min(n - 1, Math.floor(x / Math.max(step, 1))))] ?? null;
    if (uid !== peek) {
      setPeek(uid);
      onHover(uid);
    }
  };

  // A seta: a batalha em curso ou, com um atacante escolhido, o alvo sob o mouse.
  const dragAttack = !battle && drag?.kind === 'attacker' ? drag : null;
  const aimAt = !battle && !drag && sel && hovered && targets.includes(hovered) ? hovered : null;
  // A carta da Vida que saiu: a janela no centro, com o [Trigger] quando há.
  const lifeCard = myPending?.kind === 'lifeCard' && s.cards[myPending.card] ? myPending.card : null;
  const trashOf = sheet && typeof sheet === 'object' ? sheet.trash : null;
  const sheetTitle =
    sheet === 'log' ? t('yonko.log') : sheet === 'card' ? t('yonko.card') : sheet === 'options' ? t('yonko.tableOptions') : trashOf !== null ? t('game.trashOf', { name: who(trashOf), n: s.players[trashOf].trash.length }) : '';

  return (
    <PickOrderContext.Provider value={pickOrder}>
      <div className={['yk', `anim-${animations}`, s.phase === 'gameover' ? 'over' : '', drag ? 'dragging' : ''].join(' ')} onPointerDown={gestures.onPointerDown} onClickCapture={gestures.onClickCapture}>
        <header className="yk-top">
          <button type="button" className="yk-back" onClick={leave} aria-label={t('yonko.exit')}>
            <Icon name="chevron" size={18} />
          </button>
          <span className="yk-logo" aria-hidden="true">
            GUMGUM <em>FIGHT!</em>
          </span>
          <span className="yk-pill mode">{extras.pill ?? t('yonko.pillTable')}</span>
          <ol className="yk-track" aria-label={t('yonko.turnOrder')}>
            {order.map((id) => {
              const ps = s.players[id];
              const on = s.phase === 'main' && s.activePlayer === id;
              return (
                <li key={id} className={[on ? 'on' : '', ps.out ? 'out' : '', id === me ? 'me' : ''].join(' ')} style={vars({ '--pc': seatColor(s, id) })} aria-current={on ? 'step' : undefined}>
                  <Avatar s={s} id={id} />
                  <span className="yk-track-text">
                    <b>{who(id)}</b>
                    <small>
                      {ps.out ? (
                        t('yonko.tagOut')
                      ) : (
                        <>
                          <Icon name="heart" size={10} /> {lifeNow(s, id)}
                        </>
                      )}
                    </small>
                  </span>
                </li>
              );
            })}
          </ol>
          <span className="yk-sp" />
          {s.phase === 'main' && <span className="yk-pill round">{s.activePlayer === me ? t('yonko.pillTurnMine', { round }) : t('yonko.pillTurn', { round, name: s.players[s.activePlayer].name })}</span>}
          {s.phase === 'gameover' && !resultOpen && (
            <button type="button" className="yk-pill btnlike" onClick={() => setResultOpen(true)}>
              {t('yonko.showResult')}
            </button>
          )}
          <button type="button" className="yk-back gear" onClick={() => setSheet('options')} aria-label={t('yonko.tableOptions')} title={t('yonko.tableOptions')}>
            <Icon name="sliders" size={18} />
          </button>
        </header>

        <div className="yk-main">
          <div className="yk-board" ref={board} style={vars({ '--n': opponents.length })}>
            {/* O centro do tabuleiro: é para onde a carta jogada e o ataque vão na vitrine (Motion.tsx). */}
            <span className="yk-arena" data-anchor="arena" aria-hidden="true" />

            <nav className="yk-tabs" aria-label={t('yonko.opponents')}>
              <button type="button" className="yk-back" onClick={leave} aria-label={t('yonko.exit')}>
                <Icon name="chevron" size={18} />
              </button>
              {opponents.map((id) => {
                const ps = s.players[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={['tab', id === openTab ? 'on' : '', targeted(id) ? 'focus' : '', ps.out ? 'out' : '', s.phase === 'main' && s.activePlayer === id ? 'playing' : ''].join(' ')}
                    style={vars({ '--pc': seatColor(s, id) })}
                    aria-pressed={id === openTab}
                    aria-label={`${ps.name}: ${ps.out ? t('yonko.tagOut') : t('yonko.tabSummary', { life: lifeNow(s, id), hand: ps.hand.length })}`}
                    onClick={() => setTab(id)}
                  >
                    <Avatar s={s} id={id} />
                    <span className="yk-tab-text">
                      <b>{ps.name}</b>
                      <small>
                        {ps.out ? (
                          t('yonko.tagOut')
                        ) : (
                          <>
                            <span className="hp">
                              <Icon name="heart" size={10} />
                            </span>
                            {lifeNow(s, id)}
                            <Icon name="deck" size={10} />
                            {ps.hand.length}
                          </>
                        )}
                      </small>
                    </span>
                  </button>
                );
              })}
              <button type="button" className="yk-back" onClick={() => setSheet('log')} aria-label={t('yonko.log')} title={t('yonko.log')}>
                <Icon name="history" size={18} />
              </button>
              <button type="button" className="yk-back gear" onClick={() => setSheet('options')} aria-label={t('yonko.tableOptions')} title={t('yonko.tableOptions')}>
                <Icon name="sliders" size={18} />
              </button>
            </nav>

            <div className="yk-opps">
              {opponents.map((id, i) => (
                <Opponent
                  key={id}
                  s={s}
                  id={id}
                  index={i}
                  place={placeOf(id)}
                  h={h}
                  targeted={targeted(id)}
                  attacked={defender === id}
                  playing={s.phase === 'main' && s.activePlayer === id}
                  hidden={id !== openTab}
                  t={t}
                  status={extras.status?.(id)}
                  onTrash={(p) => setSheet({ trash: p })}
                />
              ))}
            </div>

            <div className="yk-center">
              <div className={['yk-banner', banner.mine ? 'mine' : '', banner.waiting ? 'waiting' : '', clash ? 'in-battle' : ''].join(' ')} style={vars({ '--pc': seatColor(s, actor) })} aria-live="polite">
                <span className="yk-banner-who">
                  <Avatar s={s} id={actor} />
                  <span className="yk-banner-icon">
                    <Icon name={banner.icon} size={14} />
                  </span>
                </span>
                <div className="yk-banner-text" key={`${s.actionCount}:${sel ?? ''}`}>
                  <p>
                    <b>{banner.text}</b>
                    {banner.waiting && (
                      <span className="yk-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                    {banner.sub && <span> {banner.sub}</span>}
                  </p>
                  {(game.error || extras.notice) && (
                    <p className="yk-error" role="alert">
                      {game.error ?? extras.notice}
                    </p>
                  )}
                </div>
                {clash && (
                  <div className={['yk-clash', clash.hits ? 'hit' : 'safe'].join(' ')} role="img" aria-label={clash.label} title={clash.label}>
                    <span className="yk-pow" style={vars({ '--pc': seatColor(s, attackerOwner!) })}>
                      <em>{name(battle!.attacker)}</em>
                      <b key={clash.atk}>{clash.atk}</b>
                    </span>
                    <span className="yk-vs">
                      <Icon name="swords" size={16} />
                    </span>
                    <span className="yk-pow" style={vars({ '--pc': seatColor(s, defender!) })}>
                      <em>{name(battle!.target)}</em>
                      <b key={clash.def}>{clash.def}</b>
                    </span>
                    <small>{clash.status}</small>
                  </div>
                )}
                <div className="yk-banner-actions">
                  {banner.chip && <span className="yk-chip">{banner.chip}</span>}
                  {(banner.tray || banner.peek) && (
                    <button type="button" className="yk-btn ghost" aria-pressed={trayHidden} onClick={() => setTrayHidden((v) => !v)} title={t('game.peekTitle')} aria-label={t('game.peekTitle')}>
                      <Icon name="eye" size={16} />
                    </button>
                  )}
                  {sel && (
                    <button type="button" className="yk-btn ghost read" onClick={() => inspectCard(sel)} aria-label={t('yonko.card')} title={t('yonko.card')}>
                      <Icon name="search" size={16} />
                    </button>
                  )}
                  {banner.buttons.map((b, i) => (
                    <button key={`${i}:${b.label}`} type="button" className={['yk-btn', b.kind ?? ''].join(' ')} disabled={b.disabled} title={b.title} onClick={b.onClick}>
                      {b.label}
                    </button>
                  ))}
                </div>
                {banner.tray && !trayHidden && (
                  <div className="yk-tray" style={vars({ '--n': banner.tray.length })}>
                    {banner.tray.map((uid) => (
                      <TableCard key={uid} s={s} uid={uid} highlight={highlight(uid)} onClick={() => onCard(uid)} onHover={onHover} />
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className={['yk-end', myTurnIdle ? 'ready' : ''].join(' ')} disabled={!myTurnIdle} onClick={endTurn}>
                {t('yonko.endTurn')}
              </button>
              {flash && s.phase === 'main' && (
                <div key={flash.key} className={['turn-banner', 'yk-flash', flash.mine ? 'mine' : 'theirs', showy ? 'sweep' : ''].join(' ')} style={vars({ '--pc': flash.color })}>
                  <div className="tb-stripe">
                    <small>{flash.kicker}</small>
                    <b>{flash.text}</b>
                  </div>
                </div>
              )}
            </div>

            <section
              className={['yk-mat', 'yk-me', s.activePlayer === me && s.phase === 'main' ? 'playing' : '', defender === me ? 'focus' : '', mine.out ? 'out' : '', fieldDrop ? `drop-${fieldDrop}` : ''].join(' ')}
              data-drop="field"
              style={vars({ '--pc': seatColor(s, me), '--i': opponents.length })}
              aria-label={t('yonko.yourTable')}
            >
              <div className="yk-me-row">
                <LifeStack s={s} id={me} h={h} t={t} />
                <span className="yk-cell">{fieldCard(mine.leader)}</span>
                <span className="yk-cell">{mine.stage ? fieldCard(mine.stage) : <span className="yk-slot stage">{t('yonko.stage')}</span>}</span>
                <FieldRow ps={mine} card={fieldCard} />
                <Piles s={s} id={me} h={h} t={t} onTrash={(p) => setSheet({ trash: p })} />
              </div>
              <div className="yk-me-foot">
                <span className="yk-plate">
                  <span className="yk-ord">{t('yonko.place', { n: placeOf(me) })}</span>
                  <b className="yk-name">{t('yonko.you')}</b>
                  {mine.out ? <span className="yk-tag out">{t('yonko.tagOut')}</span> : defender === me ? <span className="yk-tag">{t('yonko.tagTarget')}</span> : null}
                  {!mine.out && <SeatClock status={extras.status?.(me)} t={t} />}
                </span>
                <DonRow ps={mine} t={t} draggable={canAttachDon} dragging={drag?.kind === 'don' ? drag.dons : undefined} />
                <button type="button" className={['yk-end', 'small', myTurnIdle ? 'ready' : ''].join(' ')} disabled={!myTurnIdle} onClick={endTurn}>
                  {t('yonko.endTurn')}
                </button>
              </div>
            </section>

            <section className="yk-hand" data-drop="hand" aria-label={t('yonko.yourHand', { n: hand.length })}>
              <div className="yk-hand-fan" data-anchor={`hand-${me}`} style={vars({ '--n': Math.max(hand.length, 1) })} onPointerMove={onHandMove} onPointerLeave={() => setPeek(null)}>
                {hand.map((uid, i) => {
                  const offset = i - (hand.length - 1) / 2;
                  return (
                    <div
                      key={uid}
                      className={['hand-card', uid === peeked && !drag ? 'peek' : '', uid === sel ? 'sel' : '', drag?.kind === 'hand' && drag.uid === uid ? 'ghosted' : ''].join(' ')}
                      data-hand-uid={uid}
                      style={vars({ '--o': offset, '--a': Math.abs(offset), '--z': i })}
                    >
                      <TableCard s={s} uid={uid} highlight={highlight(uid)} onClick={() => onCard(uid)} onHover={() => undefined} drag="hand" />
                    </div>
                  );
                })}
              </div>
            </section>

            <BattleArrow
              from={battle?.attacker ?? dragAttack?.uid ?? (aimAt ? sel : null)}
              to={battle?.target ?? dragAttack?.over ?? aimAt}
              point={dragAttack && !dragAttack.over ? { x: dragAttack.x, y: dragAttack.y } : undefined}
              aim={!battle}
            />

            {drag && drag.kind !== 'attacker' && (
              <div className={['drag-ghost', `ghost-${drag.kind}`, drag.over && drag.over !== 'hand' ? 'over' : ''].join(' ')} style={{ left: drag.x, top: drag.y }}>
                {drag.kind === 'don' ? (
                  <div className="don-stack">
                    <span className="don-card" style={vars({ '--k': 0 })} />
                  </div>
                ) : (
                  drag.uid && s.cards[drag.uid] && <CardView state={s} uid={drag.uid} />
                )}
              </div>
            )}

          </div>

          <aside className="yk-side">
            <section className="yk-panel yk-inspect">
              <h3>{t('yonko.card')}</h3>
              <CardPanel s={s} uid={inspect} t={t} />
            </section>
            <section className="yk-panel grow">
              <h3>{t('yonko.log')}</h3>
              <Log s={s} tryT={tryT} />
            </section>
          </aside>
        </div>

        {motion.layer}

        {myPending?.kind === 'confirm' && !trayHidden && !sheet && (
          <AskEffect
            s={s}
            pending={myPending}
            t={t}
            tryT={tryT}
            onAnswer={(yes) => send({ type: 'answer', player: me, yes })}
            onPeek={() => setTrayHidden(true)}
            onCard={inspectCard}
            onCancel={cancelAllowed(s, me) ? () => send({ type: 'cancel', player: me }) : undefined}
          />
        )}

        {lifeCard && !trayHidden && !sheet && <LifeReveal s={s} uid={lifeCard} trigger={legal.some((a) => a.type === 'answer' && a.yes)} t={t} onAnswer={(yes) => send({ type: 'answer', player: me, yes })} onPeek={() => setTrayHidden(true)} />}

        {sheet && (
          <div className="yk-sheet-back" onClick={() => setSheet(null)}>
            <div className={['yk-sheet', `sheet-${typeof sheet === 'object' ? 'trash' : sheet}`].join(' ')} role="dialog" aria-modal="true" aria-label={sheetTitle} onClick={(e) => e.stopPropagation()}>
              <header>
                <h3>{sheetTitle}</h3>
                <button type="button" className="yk-back" onClick={() => setSheet(null)} aria-label={t('yonko.close')}>
                  <Icon name="close" size={18} />
                </button>
              </header>
              {sheet === 'log' ? (
                <Log s={s} tryT={tryT} />
              ) : sheet === 'card' ? (
                <CardPanel s={s} uid={inspect} t={t} />
              ) : sheet === 'options' ? (
                <div className="yk-options">
                  <div className="yk-option">
                    <b>{t('settings.animations')}</b>
                    <AnimationsSeg />
                    <p className="muted small">{t('settings.animationsHint')}</p>
                  </div>
                  <div className="yk-option row">
                    <b>{t('settings.sfx')}</b>
                    <VolumeControl kind="sfxVolume" />
                  </div>
                  <div className="yk-option row">
                    <b>{t('settings.music')}</b>
                    <VolumeControl kind="musicVolume" />
                  </div>
                </div>
              ) : trashOf !== null && s.players[trashOf].trash.length ? (
                <div className="yk-trash-grid">
                  {[...s.players[trashOf].trash].reverse().map((uid) => (
                    <TableCard key={uid} s={s} uid={uid} highlight={null} onClick={() => setInspect(uid)} onHover={onHover} />
                  ))}
                </div>
              ) : (
                <p className="muted">{t('game.trashEmpty')}</p>
              )}
            </div>
          </div>
        )}

        {s.phase === 'gameover' && resultOpen && (
          <Result s={s} me={me} t={t} tryT={tryT} onExit={onExit} onRematch={onRematch} rematchNote={extras.rematchNote} onClose={() => setResultOpen(false)} />
        )}
      </div>
    </PickOrderContext.Provider>
  );
}
