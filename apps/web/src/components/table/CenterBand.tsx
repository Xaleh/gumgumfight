// A faixa central da mesa, entre os dois lados: o turno, a dica da vez, o confronto da batalha e "Encerrar turno"
// (ou o botão de decisão). Também a dica do treinador, a barra dos DON!! marcados e a seta do ataque.

import { type Action, cardDef, type GameState, getPower, type PlayerId } from '@gumgum/engine';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { coachTip } from '../../game/tutorial/coachTips';
import { type Translate, useT, useTryT } from '../../i18n';
import { Icon } from '../Icons';
import type { Drag, Mode } from './shared';

// ------------------------------------------------------------------ dicas do treinador

/** Treino contra o bot com "Dicas do treinador": uma dica curta para o momento (some ao fechar até mudar). */
export function CoachTipPill({ state, human }: { state: GameState; human: PlayerId }) {
  const t = useT();
  const tryT = useTryT();
  const tip = useMemo(() => coachTip(state, human), [state, human]);
  const id = tip ? `${tip.key}|${state.turn}|${state.pending?.kind ?? ''}` : '';
  const [closed, setClosed] = useState<string | null>(null);
  if (!tip || closed === id) return null;
  return (
    <div className="coach-tip" role="status">
      <span className="coach-tip-ico" aria-hidden="true">
        <Icon name="learn" size={16} />
      </span>
      <span>{tryT(`coach.tip.${tip.key}`, tip.params) ?? tip.key}</span>
      <button type="button" className="coach-tip-close" onClick={() => setClosed(id)} aria-label={t('common.close')}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ faixa central

export function CenterBand(props: {
  state: GameState;
  human: PlayerId | null;
  /** Espectador de partida online: sem botão de pausa e com "pensando" para os dois. */
  watching?: boolean;
  /** Espectador Streamer/Admin: o olho mostra ou esconde as mãos dos jogadores. */
  hands?: { on: boolean; onToggle: () => void };
  /** Visão do Streamer (desktop): as mãos abrem clicando nelas, então a faixa fica sem o olho. */
  streamer?: boolean;
  acting: PlayerId | null;
  mode: Mode;
  /** DON!! marcados: contador e barra de ações (DonBar), no lugar da dica. */
  donBar?: ReactNode;
  paused: boolean;
  canEnd: boolean;
  onEnd: () => void;
  onCancelMode: () => void;
  onTogglePause: () => void;
  /** Pedido de um efeito que escolhe alvos: fica no meio da faixa, no lugar da dica (TargetRequest). */
  request?: ReactNode;
  /** Blocker/Counter ou escolha de alvos do jogador: o botão de decisão toma o lugar de "Encerrar turno". */
  decision?: ReactNode;
  /** Tela larga: o botão de decisão vai para o meio da faixa, maior, ao lado do confronto/pedido. */
  wide?: boolean;
  /** É o seu turno e a jogada está com você: o círculo do turno e "Encerrar turno" pulsam. */
  pulse?: boolean;
}) {
  const { state, human, mode, acting, watching } = props;
  const t = useT();
  const b = state.battle;
  const mineTurn = human === null ? state.activePlayer === 0 : state.activePlayer === human;
  const centerDecision = Boolean(props.wide && props.decision);

  let middle: ReactNode = null;
  if (props.request) middle = props.request;
  else if (b) middle = <BattleInfo state={state} human={human} />;
  else if (mode?.kind === 'attack')
    middle = (
      <button className="hint-pill" onClick={props.onCancelMode}>
        {t('game.pickAttackTarget')} <small>{t('game.tapToCancel')}</small>
      </button>
    );
  else if (mode?.kind === 'don' && props.donBar) middle = props.donBar;
  else if (props.paused) middle = <span className="hint-pill">{t('game.paused')}</span>;
  else if (acting !== null && acting !== human && (state.players[acting].isBot || human !== null || watching) && state.phase === 'main')
    middle = (
      <span className="hint-pill thinking">
        {t('game.thinking', { name: state.players[acting].name })}
        <span className="dots" />
      </span>
    );
  else if (state.pending?.kind === 'chooseFirst' && acting !== null && acting !== human)
    middle = (
      <span className="hint-pill thinking">
        {t('game.wonRollChoosing', { name: state.players[acting].name })}
        <span className="dots" />
      </span>
    );
  else if (state.phase === 'mulligan' && (human !== null || watching) && acting !== null && acting !== human)
    middle = (
      <span className="hint-pill thinking">
        {t(state.pending?.kind === 'mulligan' ? 'game.choosingHand' : 'game.preparingStart', { name: state.players[acting].name })}
        <span className="dots" />
      </span>
    );
  else if (props.canEnd)
    middle = <span className="hint-pill soft">{state.turn <= 2 ? t('game.firstTurnHint') : t('game.tapToAct')}</span>;

  const [endTurn1, endTurn2 = ''] = t('game.endTurn').split('\n');

  return (
    <>
        <div
          className={['turn-chip', mineTurn ? 'mine' : 'theirs', props.pulse ? 'pulse' : ''].join(' ')}
          title={mineTurn ? t('game.yourTurnTitle') : t('game.opponentTurnTitle')}
        >
          <small>{t('game.turn')}</small>
          <b>{state.phase === 'mulligan' ? '—' : state.turn}</b>
        </div>
        <div className={['band-middle', centerDecision ? 'with-decision' : ''].join(' ')}>
          {middle}
          {centerDecision && props.decision}
        </div>
        {centerDecision ? (
          <span className="end-turn placeholder" aria-hidden="true" />
        ) : props.decision ? (
          props.decision
        ) : human !== null ? (
          <button className={['end-turn', props.pulse && props.canEnd ? 'pulse' : ''].join(' ')} disabled={!props.canEnd} onClick={props.onEnd}>
            {endTurn1}
            <br />
            {endTurn2}
          </button>
        ) : watching && props.hands ? (
          <button
            className={['end-turn', 'watching', 'hands-toggle', props.hands.on ? 'on' : ''].join(' ')}
            onClick={props.hands.onToggle}
            aria-pressed={props.hands.on}
            title={props.hands.on ? t('game.hideHands') : t('game.showHands')}
          >
            <EyeIcon closed={!props.hands.on} />
          </button>
        ) : watching && props.streamer ? (
          <span className="end-turn placeholder" aria-hidden="true" />
        ) : watching ? (
          <span className="end-turn watching" title={t('game.watching')}>
            👁
          </span>
        ) : (
          <button className="end-turn" onClick={props.onTogglePause}>
            {props.paused ? '▶' : '❚❚'}
          </button>
        )}
    </>
  );
}

/**
 * DON!! marcados na fileira: quantos são e onde tocar para anexá-los (o Líder ou um Personagem, que ficam
 * destacados na mesa), como no OPTCG Sim. Sem arrastar, no celular.
 */
export function DonBar(props: { count: number; onCancel: () => void }) {
  const { count } = props;
  const t = useT();
  // Em tela estreita (.brief) os textos encurtam para a barra caber numa linha entre o turno e "Encerrar turno".
  const counter = (
    <span className="don-bar-count">
      <span className="don-card mini" aria-hidden="true" />
      <b>{count}</b>
      <span className="full">{t('game.donSelected', { n: count })}</span>
      <span className="brief">DON!!</span>
    </span>
  );
  return (
    <div className="don-bar" role="group" aria-label={t('game.donAttachLabel')}>
      {counter}
      <span className="don-bar-hint">
        <span className="full">{t('game.donTapTarget')}</span>
        <span className="brief">{t('game.donTapTargetShort')}</span>
      </span>
      <button className="don-bar-btn cancel" onClick={props.onCancel} aria-label={t('common.cancel')}>
        ✕
      </button>
    </div>
  );
}

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {closed && <path d="M4 4l16 16" />}
    </svg>
  );
}

/**
 * O confronto da batalha em curso: o poder do atacante e o do alvo, se o ataque acerta e o que falta para acertar
 * (quem ataca) ou para defender (quem é atacado).
 */
export function battleClash(state: GameState, human: PlayerId | null, t: Translate): { atk: number; def: number; hits: boolean; status: string } {
  const b = state.battle!;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const defender = state.cards[b.target].owner;
  const hits = atk >= def;
  let status: string;
  if (human !== null && defender === human) status = hits ? t('game.needToDefend', { n: atk - def + 1000 }) : t('game.defendedBang');
  else status = hits ? t('game.attackWillHit') : t('game.needToHit', { n: def - atk });
  return { atk, def, hits, status: b.blocked ? t('game.blockedStatus', { status }) : status };
}

/** Poder do atacante contra o alvo, com o que falta para defender (como o "Dano previsto" do Pocket). */
export function BattleInfo({ state, human }: { state: GameState; human: PlayerId | null }) {
  const t = useT();
  const b = state.battle!;
  const { atk, def, hits, status } = battleClash(state, human, t);
  // Etapa da batalha (a visão do oponente também traz o tipo da escolha pendente).
  // A carta do [Trigger] em resolução está fora das áreas (nem Vida nem descarte): aparece aqui.
  const trigger = state.limbo?.find((u) => state.cards[u]);
  const step =
    state.pending?.kind === 'block'
      ? t('game.stepBlock')
      : state.pending?.kind === 'counter'
        ? t('game.stepCounter')
        : trigger
          ? t('game.stepTrigger', { name: cardDef(state, trigger).name })
          : state.stack.some((f) => f.kind === 'damage')
            ? t('game.stepDamage')
            : t('game.stepAttack');
  return (
    <div className="battle-info">
      <div key={step} className="battle-step">
        {step}
      </div>
      <div className="battle-row">
        <span className="pow atk">
          <em>{cardDef(state, b.attacker).name}</em>
          <b key={atk}>{atk}</b>
        </span>
        <span className="vs">⚔</span>
        <span className="pow def">
          <em>{cardDef(state, b.target).name}</em>
          <b key={def}>{def}</b>
        </span>
      </div>
      <div className={['battle-status', hits ? 'hit' : 'safe'].join(' ')}>{status}</div>
    </div>
  );
}

// ------------------------------------------------------------------ seta de ataque

/**
 * Seta do atacante até o alvo: durante a batalha, enquanto o jogador arrasta um
 * atacante (segue o dedo) e, no modo de ataque, até o alvo sob o mouse.
 */
export function AttackArrow({
  state,
  drag,
  mode,
  hovered,
  legal,
}: {
  state: GameState;
  drag: Drag | null;
  mode: Mode;
  hovered: string | null;
  legal: Action[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [path, setPath] = useState<{ d: string; key: string } | null>(null);
  const [, setTick] = useState(0);

  let from: string | null = null;
  let to: string | { x: number; y: number } | null = null;
  let kind = 'battle';
  if (drag?.kind === 'attacker' && drag.uid) {
    from = drag.uid;
    to = drag.over ?? { x: drag.x, y: drag.y };
    kind = drag.over ? 'aim locked' : 'aim';
  } else if (state.battle) {
    from = state.battle.attacker;
    to = state.battle.target;
  } else if (mode?.kind === 'attack' && hovered) {
    const ok = legal.some((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === hovered);
    if (ok) {
      from = mode.attacker;
      to = hovered;
      kind = 'aim locked';
    }
  }

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Mede as cartas depois do layout; refaz quando a animação de entrada termina.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || !from || !to) {
      if (path) setPath(null);
      return;
    }
    const base = svg.getBoundingClientRect();
    // Sempre a carta em si (`.card`): o emblema de DON!! anexado também leva o `data-uid` da carta
    // e vem antes dela no DOM, o que puxava a seta para fora do centro.
    const center = (uid: string) => {
      const el = document.querySelector<HTMLElement>(`.mat .card[data-uid="${CSS.escape(uid)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    };
    const a = center(from);
    const b = typeof to === 'string' ? center(to) : { x: to.x - base.left, y: to.y - base.top };
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;
    // Curva suave: ponto de controle deslocado para o lado.
    const bend = Math.min(60, len * 0.18);
    const cx = (a.x + b.x) / 2 - (dy / len) * bend;
    const cy = (a.y + b.y) / 2 + (dx / len) * bend;
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (d !== path?.d) setPath({ d, key: `${from}>${typeof to === 'string' ? to : 'ptr'}` });
  });

  // A carta atacante pode estar animando (virar): mede de novo logo depois.
  useEffect(() => {
    if (!from) return;
    const t = setTimeout(() => setTick((x) => x + 1), 380);
    return () => clearTimeout(t);
  }, [from, typeof to === 'string' ? to : null]);

  return (
    <svg ref={svgRef} className={['attack-arrow', kind].join(' ')} aria-hidden="true">
      <defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 L2.5 5 Z" fill="#ff4d2e" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
        </marker>
      </defs>
      {path && from && to && (
        <g key={path.key}>
          <path className="arrow-shadow" d={path.d} />
          <path className="arrow-line" d={path.d} markerEnd="url(#arrow-head)" />
        </g>
      )}
    </svg>
  );
}
