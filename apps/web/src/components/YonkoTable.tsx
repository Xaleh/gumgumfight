// Mesa de Yonko (todos contra todos): os três oponentes em painéis compactos no alto, a mesa de quem joga
// embaixo, a faixa de ação no meio e, ao lado, a ordem dos turnos, o registro e a carta em destaque. No
// celular os oponentes viram abas, com uma mesa aberta por vez.
//
// É uma tela própria, não uma adaptação da mesa de dois jogadores (`GameScreen`): aqui tudo é por clique
// (sem arrastar e sem as animações de voo). A mesa recebe o jogo de fora: a partida local contra bots
// (`useYonkoGame`, em `LocalYonkoTable`) ou a mesa online (`useYonkoOnline`, em `YonkoOnline.tsx`).

import {
  type Action,
  cancelAllowed,
  cardDef,
  cardStatuses,
  counterValue,
  type FieldCard,
  type GameState,
  getCost,
  getPower,
  HIDDEN_CARD,
  legalActions,
  locate,
  type Pending,
  playCost,
  playError,
  type PlayerId,
  type PlayerState,
} from '@gumgum/engine';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { abilityCostLabel, abilityText, abilityTitle } from '../game/abilityText';
import { listText, logText, msgText, winReasonText } from '../game/engineText';
import { useYonkoGame, type YonkoSetup } from '../game/useYonkoGame';
import { useLongPress } from '../hooks/useLongPress';
import { type Translate, useLocale, useT, useTryT } from '../i18n';
import { CardTextInfo } from './CardInfo';
import { CardView, type Highlight, PickOrderContext } from './CardView';
import { Icon } from './Icons';

type TryT = ReturnType<typeof useTryT>;
/** O que a mesa precisa do jogo: a visão de quem joga, a jogada e o último erro. */
export interface TableGame {
  state: GameState;
  dispatch: (action: Action) => void;
  error: string | null;
  /** Segura os bots enquanto a pessoa lê o registro ou uma carta (só na mesa local). */
  setPaused?: (paused: boolean) => void;
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
  /** O texto já descreve a batalha (bloqueio, Counter): a linha da batalha não se repete. */
  battle?: boolean;
}

/** Carta da mesa: `CardView` com o toque longo (celular) abrindo a carta para ler. */
function TableCard({
  s,
  uid,
  fc,
  highlight,
  onClick,
  onInspect,
  onHover,
}: {
  s: GameState;
  uid: string;
  fc?: FieldCard;
  highlight: Highlight;
  onClick?: () => void;
  onInspect: (uid: string) => void;
  onHover: (uid: string | null) => void;
}) {
  const press = useLongPress<HTMLSpanElement>(() => onInspect(uid));
  return (
    <span
      className="yk-card"
      {...press.handlers}
      onClickCapture={(e) => {
        // O clique que vem depois de um toque longo é do toque: a carta já abriu para ler.
        if (press.consume()) e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CardView state={s} uid={uid} fc={fc} highlight={highlight} onClick={onClick} onHover={onHover} />
    </span>
  );
}

/** Marcadores de Vida: os que restam cheios (os virados para cima em azul) e os perdidos vazados. */
function LifePips({ s, id }: { s: GameState; id: PlayerId }) {
  const ps = s.players[id];
  const now = lifeNow(s, id);
  const total = Math.max(startingLife(s, id), now);
  const faceUp = (ps.lifeFaceUp ?? []).filter((u) => ps.life.includes(u)).length;
  return (
    <span className="yk-pips" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i >= now ? 'x' : i >= now - faceUp ? 'b' : ''} />
      ))}
    </span>
  );
}

function Slots({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: Math.max(0, n) }, (_, i) => (
        <span key={i} className="yk-slot" />
      ))}
    </>
  );
}

interface CardHandlers {
  highlight: (uid: string) => Highlight;
  onCard: (uid: string) => void;
  onInspect: (uid: string) => void;
  onHover: (uid: string | null) => void;
}

/** O relógio e a conexão de um jogador, no canto do painel dele (só na mesa online). */
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

/** Painel de um oponente: tudo o que é informação pública dele. */
function Opponent({
  s,
  id,
  place,
  h,
  targeted,
  playing,
  hidden,
  t,
  status,
}: {
  s: GameState;
  id: PlayerId;
  status?: SeatStatus;
  /** Posição na ordem dos turnos (1 = quem começou). */
  place: number;
  h: CardHandlers;
  /** Há um alvo válido nesta mesa, ou ela é a atacada. */
  targeted: boolean;
  playing: boolean;
  /** No celular: outra aba está aberta. */
  hidden: boolean;
  t: Translate;
}) {
  const ps = s.players[id];
  const leader = cardDef(s, ps.leader.uid);
  const card = (fc: FieldCard) => (
    <TableCard key={fc.uid} s={s} uid={fc.uid} fc={fc} highlight={h.highlight(fc.uid)} onClick={() => h.onCard(fc.uid)} onInspect={h.onInspect} onHover={h.onHover} />
  );
  return (
    <section
      className={['yk-opp', targeted ? 'focus' : '', playing ? 'playing' : '', ps.out ? 'out' : '', hidden ? 'tab-off' : ''].join(' ')}
      style={vars({ '--pc': seatColor(s, id) })}
      aria-label={t('yonko.tableOf', { name: ps.name })}
    >
      <header className="yk-opp-head">
        <span className="yk-ord">{t('yonko.place', { n: place })}</span>
        <b className="yk-name">{ps.name}</b>
        <span className="yk-leader-name">{leader.name}</span>
        {ps.out ? <span className="yk-tag out">{t('yonko.tagOut')}</span> : targeted ? <span className="yk-tag">{t('yonko.tagTarget')}</span> : playing ? <span className="yk-tag turn">{t('yonko.tagTurn')}</span> : null}
        {!ps.out && <SeatClock status={status} t={t} />}
      </header>
      {ps.out ? (
        <p className="yk-out-note">{t('yonko.outNote')}</p>
      ) : (
        <>
          <div className="yk-opp-top">
            {card(ps.leader)}
            <div className="yk-opp-info">
              <div className="yk-life">
                <span className="yk-life-label">{t('yonko.life', { n: lifeNow(s, id), max: startingLife(s, id) })}</span>
                <LifePips s={s} id={id} />
              </div>
              <div className="yk-stats">
                <span className="yk-stat" title={t('yonko.handTitle')}>
                  <Icon name="deck" size={13} /> {t('yonko.hand', { n: ps.hand.length })}
                </span>
                <span className="yk-stat">{t('yonko.don', { n: donOnField(ps), active: ps.donActive })}</span>
                <span className="yk-stat">{t('yonko.deck', { n: ps.deck.length })}</span>
                <span className="yk-stat">{t('yonko.trash', { n: ps.trash.length })}</span>
              </div>
            </div>
          </div>
          <div className="yk-row">
            {ps.characters.map(card)}
            <Slots n={5 - ps.characters.length} />
            {ps.stage && <span className="yk-stage">{card(ps.stage)}</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** Registro da partida, com a cor do jogador de cada linha. */
function Log({ s, tryT }: { s: GameState; tryT: TryT }) {
  const end = useRef<HTMLDivElement>(null);
  const lines = s.log.slice(-120);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [s.log.length]);
  return (
    <div className="yk-log" role="log">
      {lines.map((e, i) => (
        <p key={s.log.length - lines.length + i} style={e.player !== null ? vars({ '--pc': seatColor(s, e.player) }) : undefined} className={e.player === null ? 'sys' : ''}>
          {logText(tryT, e)}
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}

/** A carta em destaque: o texto dela e, em campo, o poder e o custo de agora. */
function CardPanel({ s, uid, t }: { s: GameState; uid: string | null; t: Translate }) {
  const def = uid && s.cards[uid] ? cardDef(s, uid) : null;
  if (!uid || !def || def.id === HIDDEN_CARD) return <p className="muted small">{t('yonko.cardHint')}</p>;
  const onField = Boolean(locate(s, uid));
  return (
    <div className="yk-card-panel">
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
  return (
    <div className="yk-result-back" onClick={onClose}>
      <div className="yk-result" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {s.winReason && <p className="muted">{winReasonText(tryT, s)}</p>}
        <ol className="yk-ranking">
          {ranked.map((id, i) => (
            <li key={id} className={id === me ? 'me' : ''} style={vars({ '--pc': seatColor(s, id) })}>
              <span className="yk-ord">{t('yonko.place', { n: i + 1 })}</span>
              <b>{id === me ? t('yonko.you') : s.players[id].name}</b>
              <span className="muted">{cardDef(s, s.players[id].leader.uid).name}</span>
            </li>
          ))}
          {standing.map((id) => (
            <li key={id} className={id === me ? 'me' : ''} style={vars({ '--pc': seatColor(s, id) })}>
              <span className="yk-ord">–</span>
              <b>{id === me ? t('yonko.you') : s.players[id].name}</b>
              <span className="muted">{t('yonko.resultStanding')}</span>
            </li>
          ))}
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

/** A partida local: uma pessoa contra bots, no navegador. */
export function LocalYonkoTable({ setup, onExit, onRematch }: { setup: YonkoSetup; onExit: () => void; onRematch: () => void }) {
  const game = useYonkoGame(setup);
  return <YonkoTable game={game} me={setup.human} onExit={onExit} onRematch={onRematch} />;
}

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
  const locale = useLocale();
  const mine = s.players[me];

  /** Carta própria selecionada (na mão ou em campo), com a vez livre. */
  const [sel, setSel] = useState<string | null>(null);
  /** Cartas marcadas numa escolha de alvos. */
  const [picked, setPicked] = useState<string[]>([]);
  /** Carta em destaque no painel (a última apontada ou tocada). */
  const [inspect, setInspect] = useState<string | null>(null);
  /** Celular: a mesa de oponente aberta e a gaveta aberta. */
  const [tab, setTab] = useState<PlayerId | null>(null);
  const [sheet, setSheet] = useState<null | 'log' | 'card'>(null);
  const [resultOpen, setResultOpen] = useState(true);

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
  }, [s.actionCount]);

  // A leitura de uma carta ou do registro (celular) segura os bots.
  useEffect(() => {
    game.setPaused?.(sheet !== null);
  }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Celular: a aba acompanha a batalha (a mesa atacada, ou a de quem ataca quando o alvo é quem joga).
  const battle = s.battle;
  const attackerOwner = battle && s.cards[battle.attacker] ? s.cards[battle.attacker].owner : null;
  const defender = battle && s.cards[battle.target] ? s.cards[battle.target].owner : null;
  useEffect(() => {
    const show = defender !== null && defender !== me ? defender : attackerOwner !== null && attackerOwner !== me ? attackerOwner : null;
    if (show !== null) setTab(show);
  }, [attackerOwner, defender, me]);
  const openTab = tab !== null && !s.players[tab].out && tab !== me ? tab : (opponents.find((id) => !s.players[id].out) ?? opponents[0]);

  const send = (a: Action) => dispatch(a);
  const targets = sel && myTurnIdle ? legal.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack' && a.attacker === sel).map((a) => a.target) : [];
  const canPlay = (uid: string) => legal.some((a) => a.type === 'playCard' && a.uid === uid);
  const canAct = (uid: string) => legal.some((a) => (a.type === 'attack' && a.attacker === uid) || (a.type === 'activate' && a.uid === uid));

  const select = myPending?.kind === 'selectTargets' ? myPending : null;
  const pickOrder = useMemo(() => (select?.ordered ? new Map(picked.map((u, i) => [u, i + 1])) : null), [select?.ordered, picked]);

  const highlight = (uid: string): Highlight => {
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

  const onCard = (uid: string) => {
    if (s.cards[uid] && cardDef(s, uid).id !== HIDDEN_CARD) setInspect(uid);
    if (select) {
      if (!select.options.includes(uid)) return;
      // Uma carta só: o toque já responde. Várias: marca e desmarca, e a faixa confirma.
      if (select.max === 1) return send({ type: 'choose', player: me, uids: [uid] });
      setPicked((p) => (p.includes(uid) ? p.filter((u) => u !== uid) : p.length < select.max ? [...p, uid] : p));
      return;
    }
    if (myPending?.kind === 'block') {
      if (myPending.options.includes(uid)) send({ type: 'choose', player: me, uids: [uid] });
      return;
    }
    if (myPending?.kind === 'counter') {
      if (myPending.options.includes(uid)) send({ type: 'counter', player: me, uid });
      return;
    }
    if (!myTurnIdle) return;
    if (sel && targets.includes(uid)) return send({ type: 'attack', player: me, attacker: sel, target: uid });
    const own = s.cards[uid]?.owner === me && (mine.hand.includes(uid) || locate(s, uid)?.player === me);
    if (!own) return;
    // O segundo toque na mesma carta da mão a joga.
    if (sel === uid && mine.hand.includes(uid) && canPlay(uid)) return send({ type: 'playCard', player: me, uid });
    setSel(sel === uid ? null : uid);
  };

  const inspectCard = (uid: string) => {
    if (!s.cards[uid] || cardDef(s, uid).id === HIDDEN_CARD) return;
    setInspect(uid);
    setSheet('card');
  };
  const h: CardHandlers = { highlight, onCard, onInspect: inspectCard, onHover: (uid) => uid && setInspect(uid) };

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
        case 'confirm':
          return {
            icon: 'check',
            mine: true,
            text: promptText(tryT, p),
            buttons: [
              ...(p.cannot ? [] : [{ label: t('yonko.yes'), kind: 'primary' as const, onClick: () => send({ type: 'answer', player: me, yes: true }) }]),
              { label: t('yonko.no'), onClick: () => send({ type: 'answer', player: me, yes: false }) },
              ...cancel,
            ],
          };
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
            battle: true,
            text: t('yonko.block', { attacker: name(battle!.attacker), power: getPower(s, battle!.attacker), target: name(battle!.target) }),
            chip: t('yonko.options', { n: p.options.length }),
            buttons: [{ label: t('yonko.noBlock'), kind: 'primary', onClick: () => send({ type: 'choose', player: me, uids: [] }) }],
          };
        case 'counter':
          return {
            icon: 'shield',
            mine: true,
            battle: true,
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
            tray: [p.card],
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
      return { icon: 'bot', mine: false, text: t(key, { name: other }), buttons: [] };
    }
    if (!myTurnIdle) {
      const active = s.players[s.activePlayer];
      return { icon: 'bot', mine: false, text: s.activePlayer === me ? t('yonko.resolving') : t('yonko.turnOf', { name: active.name }), buttons: [] };
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
    return { icon: 'crown', mine: true, text: t('yonko.yourTurn'), sub: t('yonko.yourTurnHint'), buttons: [...cancel, { label: t('yonko.endTurn'), kind: 'primary', onClick: () => send({ type: 'endTurn', player: me }) }] };
  })();

  /** A mesa de um oponente tem algo para quem joga: um alvo do ataque ou da escolha, ou é a atacada. */
  const targeted = (id: PlayerId) => {
    const ps = s.players[id];
    const uids = [ps.leader.uid, ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : [])];
    if (select) return uids.some((u) => select.options.includes(u));
    if (targets.length) return uids.some((u) => targets.includes(u));
    return defender === id;
  };

  const round = Math.ceil(s.turn / Math.max(1, s.players.filter((ps) => !ps.out).length));
  const fieldCard = (fc: FieldCard) => (
    <TableCard key={fc.uid} s={s} uid={fc.uid} fc={fc} highlight={highlight(fc.uid)} onClick={() => onCard(fc.uid)} onInspect={inspectCard} onHover={h.onHover} />
  );
  const leave = () => {
    if (s.phase === 'gameover' || window.confirm(t('yonko.leaveConfirm'))) onExit();
  };

  return (
    <PickOrderContext.Provider value={pickOrder}>
      <div className={['yk', s.phase === 'gameover' ? 'over' : ''].join(' ')}>
        <header className="yk-top">
          <button type="button" className="yk-back" onClick={leave} aria-label={t('yonko.exit')}>
            <Icon name="chevron" size={18} />
          </button>
          <span className="yk-logo" aria-hidden="true">
            GUMGUM <em>FIGHT!</em>
          </span>
          <span className="yk-pill mode">{extras.pill ?? t('yonko.pillTable')}</span>
          {s.phase === 'main' && <span className="yk-pill">{s.activePlayer === me ? t('yonko.pillTurnMine', { round }) : t('yonko.pillTurn', { round, name: s.players[s.activePlayer].name })}</span>}
          <span className="yk-sp" />
          {s.phase === 'gameover' && !resultOpen && (
            <button type="button" className="yk-pill btnlike" onClick={() => setResultOpen(true)}>
              {t('yonko.showResult')}
            </button>
          )}
        </header>

        <div className="yk-main">
          <div className="yk-board">
            <nav className="yk-tabs" aria-label={t('yonko.opponents')}>
              {opponents.map((id) => {
                const ps = s.players[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={[id === openTab ? 'on' : '', targeted(id) ? 'focus' : '', ps.out ? 'out' : ''].join(' ')}
                    style={vars({ '--pc': seatColor(s, id) })}
                    aria-pressed={id === openTab}
                    onClick={() => setTab(id)}
                  >
                    <span className="yk-ord">{t('yonko.place', { n: placeOf(id) })}</span>
                    <b>{ps.name}</b>
                    <small>{ps.out ? t('yonko.tagOut') : t('yonko.tabSummary', { life: lifeNow(s, id), hand: ps.hand.length })}</small>
                  </button>
                );
              })}
            </nav>

            <div className="yk-opps" style={vars({ '--n': opponents.length })}>
              {opponents.map((id) => (
                <Opponent
                  key={id}
                  s={s}
                  id={id}
                  place={placeOf(id)}
                  h={h}
                  targeted={targeted(id)}
                  playing={s.phase === 'main' && s.activePlayer === id}
                  hidden={id !== openTab}
                  t={t}
                  status={extras.status?.(id)}
                />
              ))}
            </div>

            <div className={['yk-banner', banner.mine ? 'mine' : ''].join(' ')} aria-live="polite">
              <span className="yk-banner-icon">
                <Icon name={banner.icon} size={22} />
              </span>
              <div className="yk-banner-text">
                <p>
                  <b>{banner.text}</b>
                  {banner.sub && <span> {banner.sub}</span>}
                </p>
                {battle && !banner.battle && s.cards[battle.attacker] && s.cards[battle.target] && (
                  <p className="yk-battle">
                    {t(defender === me ? 'yonko.battleMine' : 'yonko.battle', {
                      attacker: name(battle.attacker),
                      power: getPower(s, battle.attacker),
                      target: name(battle.target),
                      defense: getPower(s, battle.target),
                      owner: defender !== null ? s.players[defender].name : '',
                    })}
                  </p>
                )}
                {(game.error || extras.notice) && (
                  <p className="yk-error" role="alert">
                    {game.error ?? extras.notice}
                  </p>
                )}
                {banner.tray && (
                  <div className="yk-tray">
                    {banner.tray.map((uid) => (
                      <TableCard key={uid} s={s} uid={uid} highlight={highlight(uid)} onClick={() => onCard(uid)} onInspect={inspectCard} onHover={h.onHover} />
                    ))}
                  </div>
                )}
              </div>
              <div className="yk-banner-actions">
                {banner.chip && <span className="yk-chip">{banner.chip}</span>}
                {banner.buttons.map((b, i) => (
                  <button key={`${i}:${b.label}`} type="button" className={['yk-btn', b.kind ?? ''].join(' ')} disabled={b.disabled} title={b.title} onClick={b.onClick}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <section className={['yk-me', s.activePlayer === me && s.phase === 'main' ? 'playing' : '', defender === me ? 'focus' : ''].join(' ')} style={vars({ '--pc': seatColor(s, me) })} aria-label={t('yonko.yourTable')}>
              <div className="yk-me-side">
                <header className="yk-opp-head">
                  <span className="yk-ord">{t('yonko.place', { n: placeOf(me) })}</span>
                  <b className="yk-name">{t('yonko.you')}</b>
                  {!mine.out && <SeatClock status={extras.status?.(me)} t={t} />}
                </header>
                <div className="yk-me-leader">
                  {fieldCard(mine.leader)}
                  <div className="yk-life">
                    <span className="yk-life-label">{t('yonko.life', { n: lifeNow(s, me), max: startingLife(s, me) })}</span>
                    <LifePips s={s} id={me} />
                  </div>
                </div>
              </div>
              <div className="yk-me-field">
                <div className="yk-row">
                  {mine.characters.map(fieldCard)}
                  <Slots n={5 - mine.characters.length} />
                  <span className="yk-stage">{mine.stage ? fieldCard(mine.stage) : <span className="yk-slot stage">{t('yonko.stage')}</span>}</span>
                </div>
                <div className="yk-me-foot">
                  <span className="yk-don" title={t('yonko.donTitle')}>
                    <b>{t('yonko.donLabel', { n: donOnField(mine) })}</b>
                    <span className="yk-don-cards" aria-hidden="true">
                      {Array.from({ length: mine.donActive }, (_, i) => (
                        <i key={`a${i}`} />
                      ))}
                      {Array.from({ length: mine.donRested }, (_, i) => (
                        <i key={`r${i}`} className="r" />
                      ))}
                    </span>
                    <span className="yk-stat">{t('yonko.donActive', { n: mine.donActive })}</span>
                  </span>
                  <span className="yk-stat">{t('yonko.deck', { n: mine.deck.length })}</span>
                  <span className="yk-stat">{t('yonko.trash', { n: mine.trash.length })}</span>
                  <span className="yk-sp" />
                  <button type="button" className="yk-btn end" disabled={!myTurnIdle} onClick={() => send({ type: 'endTurn', player: me })}>
                    {t('yonko.endTurn')}
                  </button>
                </div>
              </div>
            </section>

            <section className="yk-hand" aria-label={t('yonko.yourHand', { n: mine.hand.length })}>
              <span className="yk-hand-label">{t('yonko.yourHand', { n: mine.hand.length })}</span>
              <div className="yk-hand-cards">
                {mine.hand.map((uid) => (
                  <TableCard key={uid} s={s} uid={uid} highlight={highlight(uid)} onClick={() => onCard(uid)} onInspect={inspectCard} onHover={h.onHover} />
                ))}
              </div>
            </section>
          </div>

          <aside className="yk-side">
            <section className="yk-panel">
              <h3>{t('yonko.turnOrder')}</h3>
              <ol className="yk-order">
                {order.map((id, i) => {
                  const ps = s.players[id];
                  const on = s.phase === 'main' && s.activePlayer === id;
                  return (
                    <li key={id} className={[on ? 'on' : '', ps.out ? 'out' : ''].join(' ')} style={vars({ '--pc': seatColor(s, id) })}>
                      <span className="yk-ord">{t('yonko.place', { n: i + 1 })}</span>
                      <b>{who(id)}</b>
                      {!ps.out && <SeatClock status={extras.status?.(id)} t={t} />}
                      <span className="yk-stat">{ps.out ? t('yonko.tagOut') : on ? t('yonko.playing') : t('yonko.lifeShort', { n: lifeNow(s, id) })}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
            <section className="yk-panel grow">
              <h3>{t('yonko.log')}</h3>
              <Log s={s} tryT={tryT} />
            </section>
            <section className="yk-panel">
              <h3>{t('yonko.card')}</h3>
              <CardPanel s={s} uid={inspect} t={t} />
            </section>
          </aside>
        </div>

        <nav className="yk-bottom">
          <button type="button" className="yk-btn" onClick={() => setSheet('log')}>
            {t('yonko.log')}
          </button>
          <button type="button" className="yk-btn" disabled={!inspect} onClick={() => setSheet('card')}>
            {t('yonko.card')}
          </button>
          <button type="button" className="yk-btn end" disabled={!myTurnIdle} onClick={() => send({ type: 'endTurn', player: me })}>
            {t('yonko.endTurn')}
          </button>
        </nav>

        {sheet && (
          <div className="yk-sheet-back" onClick={() => setSheet(null)}>
            <div className="yk-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <header>
                <h3>{sheet === 'log' ? t('yonko.log') : t('yonko.card')}</h3>
                <button type="button" className="yk-back" onClick={() => setSheet(null)} aria-label={t('yonko.close')}>
                  <Icon name="close" size={18} />
                </button>
              </header>
              {sheet === 'log' ? <Log s={s} tryT={tryT} /> : <CardPanel s={s} uid={inspect} t={t} />}
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
