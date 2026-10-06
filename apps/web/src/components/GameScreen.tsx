import {
  type Action,
  actingPlayer,
  cardDef,
  counterValue,
  type GameState,
  getPower,
  HIDDEN_CARD,
  legalActions,
  locate,
  manualAllowed,
  type PlayerId,
  translateToPt,
  zoneOf,
} from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, type OnlineSeat, type WatchTarget } from '../api';
import { type GameSetup, useGame } from '../game/useGame';
import { type OnlineGame, useOnlineGame } from '../game/useOnlineGame';
import { cardText, SettingsControls, useSettings } from '../settings';
import { Board } from './Board';
import { CardTextInfo } from './CardInfo';
import { CardView, type Highlight } from './CardView';
import { DiceRoll } from './DiceRoll';
import { ErrorBoundary } from './ErrorBoundary';
import { GameResult } from './GameResult';
import { ManualTools } from './ManualTools';
import { useBoardMotion } from './Motion';
import {
  EmoteBar,
  EmoteBubbles,
  OnlineBanner,
  OnlineResultInfo,
  OnlineStatus,
  OnlineWaiting,
  SpectatorBar,
  SpectatorCount,
  seriesAfter,
} from './Online';

/** Modo 'don': `count` DON!! ativos escolhidos para anexar de uma vez. */
type Mode = null | { kind: 'attack'; attacker: string } | { kind: 'don'; count: number };
type DragKind = 'hand' | 'attacker' | 'don';
interface Drag {
  kind: DragKind;
  uid: string | null;
  x: number;
  y: number;
  /** Carta (uid), 'field' ou 'hand' sob o dedo, se for um destino válido. */
  over: string | null;
  /** Posição na mão onde a carta arrastada vai entrar (reorganizar). */
  insert?: number;
  /** Quantos DON!! estão sendo arrastados juntos. */
  count?: number;
}
type Sheet = null | 'menu' | 'log' | 'tools' | 'hand' | { trash: PlayerId };

const LONG_PRESS_MS = 420;
const DRAG_THRESHOLD = 9;
/** Quanto puxar a carta da mão para cima até ela "sair" (arrastar). */
const HAND_PULL = 22;

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** O que a mesa precisa de uma partida, local (useGame) ou online (useOnlineGame). */
interface TableGame {
  state: GameState;
  dispatch: (a: Action) => void;
  error: string | null;
  setError: (e: string | null) => void;
  human: PlayerId | null;
  paused: boolean;
  setPaused: (f: (p: boolean) => boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  auto: boolean;
  setAuto: (f: (a: boolean) => boolean) => void;
  /** Segura o bot (partida no navegador) enquanto o sorteio inicial está na tela. */
  setHold?: (hold: boolean) => void;
  undo: () => void;
  canUndo: boolean;
  actions: () => Action[];
  downloadReplay: () => void;
}

type TableKind = GameSetup['mode'] | 'online';

/** Partida no navegador: contra o bot, bot x bot ou replay. */
export function GameScreen({ setup, onExit, onRematch }: { setup: GameSetup; onExit: () => void; onRematch?: () => void }) {
  const game = useGame(setup);
  // Registra o resultado no servidor (que refaz a partida a partir das ações). Replays não contam de novo.
  const saved = useRef(false);
  useEffect(() => {
    if (game.state.phase !== 'gameover' || saved.current || setup.mode === 'replay') return;
    saved.current = true;
    void api.saveMatch({
      mode: setup.mode,
      format: setup.format,
      seed: setup.config.seed,
      firstPlayer: setup.config.firstPlayer,
      chooseFirst: setup.config.chooseFirst,
      deckIds: setup.deckIds,
      decks: [setup.config.players[0].deck, setup.config.players[1].deck],
      actions: game.actions(),
    });
  }, [game.state, setup, game.actions]);
  return (
    <GameTable
      game={{ ...game, downloadReplay: () => downloadReplay(game.exportReplay()) }}
      kind={setup.mode}
      onExit={onExit}
      onRematch={onRematch}
    />
  );
}

const noop = () => undefined;

/** Partida online: a mesa recebe só a visão deste jogador, vinda do servidor. */
export function OnlineGameScreen({ seat, onExit, onSwitch }: { seat: OnlineSeat; onExit: () => void; onSwitch: (s: OnlineSeat) => void }) {
  const online = useOnlineGame(seat);
  const { state, room } = online;
  const [nextError, setNextError] = useState<string | null>(null);
  // Os dois pediram revanche: vai para a sala nova.
  useEffect(() => {
    if (online.rematch?.token) onSwitch({ roomId: online.rematch.roomId, token: online.rematch.token });
  }, [online.rematch, onSwitch]);
  if (!state || !room || room.status === 'waiting') {
    return (
      <OnlineWaiting
        online={online}
        onCancel={() => {
          void online.leave();
          onExit();
        }}
      />
    );
  }
  const game: TableGame = {
    ...onlineTable,
    state,
    dispatch: online.dispatch,
    error: online.error,
    setError: online.setError,
    human: room.you,
    actions: () => online.actions,
    downloadReplay: () => void online.downloadReplay(),
  };
  // Torneio em melhor de N: se a série não acabou, o próximo jogo começa daqui.
  const series = room.tournament && room.you !== null && state.phase === 'gameover' ? seriesAfter(room.tournament, state.winner) : null;
  const nextGame =
    series && !series.decided
      ? () =>
          api.tournaments
            .play(room.tournament!.id, room.tournament!.matchId)
            .then(onSwitch)
            .catch((e) => setNextError(e instanceof Error ? e.message : String(e)))
      : undefined;
  return (
    <GameTable
      game={{ ...game, error: game.error ?? nextError, setError: (e) => (setNextError(null), game.setError(e)) }}
      kind="online"
      online={online}
      onExit={onExit}
      onRematch={room.queue === 'private' ? () => void online.askRematch() : nextGame}
      rematchLabel={nextGame ? `Jogar o jogo ${room.tournament!.game + 1}` : undefined}
    />
  );
}


/** O que a mesa online não usa (pausa, velocidade, desfazer e "Auto" são do jogo no navegador). */
const onlineTable = {
  paused: false,
  setPaused: noop,
  speed: 1,
  setSpeed: noop,
  auto: false,
  setAuto: noop,
  undo: noop,
  canUndo: false,
};

/**
 * Modo espectador: a mesa de uma partida online vista de fora (sem as mãos, ou com
 * as duas mãos para streamer e admin). Ninguém age; na revanche, segue para a sala nova.
 */
export function WatchGameScreen({
  target,
  canHands,
  onExit,
  onSwitch,
}: {
  target: WatchTarget;
  canHands: boolean;
  onExit: () => void;
  onSwitch: (t: WatchTarget) => void;
}) {
  const online = useOnlineGame(target);
  const { state, room } = online;
  useEffect(() => {
    if (online.rematch) onSwitch({ roomId: online.rematch.roomId, hands: target.hands });
  }, [online.rematch, onSwitch, target.hands]);
  // "Ver mãos" recusado pelo servidor: continua assistindo sem as mãos (o motivo aparece no aviso).
  useEffect(() => {
    if (online.handsRefused && target.hands) onSwitch({ ...target, hands: false });
  }, [online.handsRefused, onSwitch, target]);
  if (!state || !room) return <OnlineWaiting online={online} onCancel={onExit} />;
  const game: TableGame = {
    ...onlineTable,
    state,
    dispatch: noop,
    error: online.error,
    setError: online.setError,
    human: null,
    actions: () => online.actions,
    downloadReplay: () => void online.downloadReplay(),
  };
  return (
    <GameTable
      game={game}
      kind="online"
      online={online}
      onExit={onExit}
      spectator={{ canHands, onToggleHands: () => onSwitch({ ...target, hands: !target.hands }) }}
    />
  );
}

/** A mesa, protegida: um erro ao desenhar não apaga a página (o jogo continua por fora). */
function GameTable(props: Parameters<typeof Table>[0]) {
  return (
    <ErrorBoundary title="A mesa travou" onExit={props.onExit}>
      <Table {...props} />
    </ErrorBoundary>
  );
}

function Table({
  game,
  kind,
  online,
  onExit,
  onRematch,
  rematchLabel,
  spectator,
}: {
  game: TableGame;
  kind: TableKind;
  online?: OnlineGame;
  onExit: () => void;
  onRematch?: () => void;
  /** Texto do botão de revanche (ex.: próximo jogo da série do torneio). */
  rematchLabel?: string;
  /** Modo espectador (partida online vista de fora). */
  spectator?: { canHands: boolean; onToggleHands: () => void };
}) {
  const { state, dispatch, human } = game;
  const isOnline = kind === 'online';
  const watching = Boolean(spectator);
  const ranked = online?.room?.queue === 'ranked';
  // Partida de torneio: "voltar" leva para a página do torneio.
  const backTo = online?.room?.tournament ? 'torneio' : 'menu';
  const wide = useMediaQuery('(min-width: 1000px)');
  const { quickCounter, animations } = useSettings();
  // Só a opção do app decide: muitos celulares ligam "reduzir movimento" sozinhos
  // (economia de bateria) e as animações e os dados sumiriam sem o jogador saber por quê.
  const animate = animations;
  // Cartas voando entre as zonas (mais rápidas com o bot acelerado).
  const motionLayer = useBoardMotion(state, { enabled: animate, tempo: Math.min(1.3, Math.max(0.35, 1 / game.speed)) });
  // Sorteio com dados no começo da partida: só quando há sorteio (quem começa não foi
  // escolhido no menu), e não no replay nem ao voltar para uma partida em andamento.
  const [intro, setIntro] = useState(
    () =>
      animate &&
      kind !== 'replay' &&
      state.rollWinner !== undefined &&
      state.phase === 'mulligan' &&
      state.players.every((p) => !p.mulliganDone),
  );
  /** Os dados ainda rolam: o bot espera para fazer a escolha dele. */
  const [rolling, setRolling] = useState(intro);
  const { setHold } = game;
  useEffect(() => {
    setHold?.(intro && rolling);
  }, [intro, rolling, setHold]);
  const [selectedUid, setSelected] = useState<string | null>(null);
  const [hoveredUid, setHovered] = useState<string | null>(null);
  const [zoomUid, setZoom] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [pickedUids, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Espectador: as mãos que o servidor manda escondidas aparecem viradas para baixo.
  const [showBotHand, setShowBotHand] = useState(kind === 'demo' || kind === 'replay' || watching);
  const [banner, setBanner] = useState<{ text: string; kicker: string; mine: boolean; key: number } | null>(null);
  const [showResult, setShowResult] = useState(false);
  /** Ordem da mão escolhida pelo jogador (só exibição). */
  const [handOrder, setHandOrder] = useState<string[]>([]);
  /** Carta da mão erguida sob o dedo. */
  const [liftedUid, setLifted] = useState<string | null>(null);

  // Online, uma carta pode sumir da visão (voltou ao deck, foi para a mão do oponente,
  // virou Vida): a carta escolhida antes deixa de existir no estado e não pode ser lida.
  const known = (uid: string | null) => (uid !== null && state.cards[uid] ? uid : null);
  const selected = known(selectedUid);
  const hovered = known(hoveredUid);
  const zoom = known(zoomUid);
  const lifted = known(liftedUid);
  const picked = useMemo(() => pickedUids.filter((u) => state.cards[u]), [pickedUids, state]);

  const pending = state.pending;
  const myPending = pending && human !== null && pending.player === human ? pending : null;
  const legal = useMemo(() => (human !== null ? legalActions(state, human) : []), [state, human]);
  const myTurnIdle =
    human !== null && !game.auto && !pending && state.activePlayer === human && state.phase === 'main' && !state.stack.length;
  const acting = actingPlayer(state);
  const bottom: PlayerId = human ?? 0;

  // Mão na ordem do jogador: cartas novas entram no fim.
  const myHand = state.players[bottom].hand;
  const orderedHand = useMemo(() => {
    const inHand = new Set(myHand);
    const kept = handOrder.filter((u) => inHand.has(u));
    const keptSet = new Set(kept);
    return [...kept, ...myHand.filter((u) => !keptSet.has(u))];
  }, [handOrder, myHand]);
  const reorder = (uid: string, index: number) => {
    const rest = orderedHand.filter((u) => u !== uid);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, uid);
    return rest;
  };
  const handView = drag?.kind === 'hand' && drag.over === 'hand' && drag.uid && drag.insert !== undefined
    ? reorder(drag.uid, drag.insert)
    : orderedHand;

  // Limpa seleções quando a situação muda.
  useEffect(() => setPicked([]), [pending]);
  useEffect(() => {
    if (!myTurnIdle) setMode(null);
    if (mode?.kind === 'don' && human !== null) {
      const max = state.players[human].donActive;
      if (max === 0) setMode(null);
      else if (mode.count > max) setMode({ kind: 'don', count: max });
    }
  }, [myTurnIdle, state, human, mode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode(null);
        setSelected(null);
        setZoom(null);
        setSheet(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Faixa "Seu turno" / "Você joga primeiro" a cada troca de turno.
  const turnKey = state.phase === 'main' ? `${state.turn}:${state.activePlayer}` : null;
  useEffect(() => {
    if (turnKey === null) return;
    const p = state.activePlayer;
    const mine = human === null ? p === 0 : p === human;
    const name = state.players[p].name;
    const you = human !== null && p === human;
    const text = you ? 'Seu turno!' : `Turno de ${name}`;
    const kicker = state.turn === 1 ? (you ? 'Você joga primeiro' : `${name} joga primeiro`) : `Turno ${state.turn}`;
    setBanner({ text, kicker, mine, key: state.turn });
    const t = setTimeout(() => setBanner(null), 1900);
    return () => clearTimeout(t);
    // Só muda na troca de turno (não a cada ação).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, human]);

  // Mostra o resumo logo após o último golpe.
  const over = state.phase === 'gameover';
  useEffect(() => {
    if (!over) {
      setShowResult(false);
      return;
    }
    const t = setTimeout(() => setShowResult(true), 1200);
    return () => clearTimeout(t);
  }, [over]);
  const manualOk = human !== null && !ranked && manualAllowed(state, human);

  const has = useCallback((pred: (a: Action) => boolean) => legal.some(pred), [legal]);
  const canPlay = (uid: string) => myTurnIdle && has((a) => a.type === 'playCard' && a.uid === uid);
  const canAttackWith = (uid: string) => myTurnIdle && has((a) => a.type === 'attack' && a.attacker === uid);
  /** Etapa de Counter: esta carta da mão pode ser usada como Counter agora? */
  const canCounter = (uid: string) => myPending?.kind === 'counter' && myPending.options.includes(uid);
  const useCounter = (uid: string) => {
    dispatch({ type: 'counter', player: human!, uid });
    setZoom(null);
    setSelected(null);
  };

  /** Destinos válidos para o que está sendo arrastado. */
  const dropValid = (d: Pick<Drag, 'kind' | 'uid'>, over: string | null): boolean => {
    if (!over) return false;
    if (d.kind === 'hand') {
      return over === 'hand' || (over === 'field' && d.uid !== null && (canPlay(d.uid) || canCounter(d.uid)));
    }
    if (d.kind === 'attacker') return has((a) => a.type === 'attack' && a.attacker === d.uid && a.target === over);
    return has((a) => a.type === 'attachDon' && a.target === over);
  };

  const highlight = (uid: string): Highlight => {
    if (drag) {
      if (uid === drag.uid) return 'selected';
      if (drag.kind !== 'hand' && dropValid(drag, uid)) return 'option';
      return null;
    }
    if (myPending) {
      if (myPending.kind === 'selectTargets') {
        if (picked.includes(uid)) return 'selected';
        if (myPending.options.includes(uid)) return 'option';
        if (myPending.shown?.includes(uid)) return 'disabled';
      }
      if ((myPending.kind === 'block' || myPending.kind === 'counter') && myPending.options.includes(uid)) return 'option';
    }
    if (state.battle) {
      if (uid === state.battle.attacker) return 'attacker';
      if (uid === state.battle.target) return 'target';
    }
    if (mode?.kind === 'attack') {
      if (uid === mode.attacker) return 'selected';
      if (has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) return 'option';
      return null;
    }
    if (mode?.kind === 'don') {
      return has((a) => a.type === 'attachDon' && a.target === uid) ? 'option' : null;
    }
    if (uid === selected && !wide) return null;
    if (uid === selected) return 'selected';
    if (canPlay(uid)) return 'playable';
    if (canAttackWith(uid)) return 'ready';
    return null;
  };

  const onCard = (uid: string) => {
    if (myPending) {
      if (myPending.kind === 'selectTargets' && myPending.options.includes(uid)) {
        setPicked((p) =>
          p.includes(uid) ? p.filter((x) => x !== uid) : myPending.max === 1 ? [uid] : p.length < myPending.max ? [...p, uid] : p,
        );
        return;
      }
      if (myPending.kind === 'block' && myPending.options.includes(uid)) {
        dispatch({ type: 'choose', player: human!, uids: [uid] });
        return;
      }
      if (myPending.kind === 'counter' && myPending.options.includes(uid)) {
        // Sem a opção "Counter sem confirmação", abre a carta com o botão de usar.
        if (quickCounter) useCounter(uid);
        else {
          setSelected(uid);
          setZoom(uid);
        }
        return;
      }
    }
    if (mode?.kind === 'attack') {
      if (has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) {
        dispatch({ type: 'attack', player: human!, attacker: mode.attacker, target: uid });
        setSelected(null);
        setMode(null);
        return;
      }
      setMode(null);
      if (uid === mode.attacker) return;
    }
    if (mode?.kind === 'don') {
      setMode(null);
      if (has((a) => a.type === 'attachDon' && a.target === uid)) {
        attachDons(uid, mode.count);
        return;
      }
    }
    // Carta escondida (mão do oponente) não abre.
    if (state.cards[uid]?.cardId === HIDDEN_CARD) return;
    const owner = state.cards[uid]?.owner;
    if (owner !== undefined && owner !== human && zoneOf(state, uid) === 'hand' && !showBotHand) return;
    setSelected(uid);
    setZoom(uid);
  };

  const onCardDouble = (uid: string) => {
    if (canPlay(uid)) {
      dispatch({ type: 'playCard', player: human!, uid });
      setSelected(null);
      setZoom(null);
    }
  };

  /** Anexa vários DON!! ativos de uma vez (uma ação do motor para cada). */
  const attachDons = (target: string, count: number) => {
    if (human === null) return;
    const n = Math.min(count, state.players[human].donActive);
    for (let i = 0; i < n; i++) dispatch({ type: 'attachDon', player: human, target });
  };

  /** Toque num DON!! ativo: marca mais um (ou desmarca, se já estava marcado). */
  const onDon = (player: PlayerId, index: number) => {
    if (player !== human || !myTurnIdle || !has((a) => a.type === 'attachDon')) return;
    const max = state.players[human].donActive;
    setMode((m) => {
      const cur = m?.kind === 'don' ? m.count : 0;
      const next = Math.min(index < cur ? cur - 1 : cur + 1, max);
      return next > 0 ? { kind: 'don', count: next } : null;
    });
  };
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ------------------------------------------------------------ gestos: toque longo e arrastar

  const press = useRef<{
    x: number;
    y: number;
    /** Âncora do toque longo (recomeça quando o dedo anda). */
    ax: number;
    ay: number;
    uid: string | null;
    kind: DragKind | null;
    timer: ReturnType<typeof setTimeout>;
    moved: boolean;
    /** Começou na própria mão: deslizar ergue a carta sob o dedo. */
    hand: boolean;
    browsed: boolean;
  } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef<(d: Drag) => void>(() => undefined);
  const dropValidRef = useRef(dropValid);
  dropValidRef.current = dropValid;
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;

  dropRef.current = (d: Drag) => {
    if (!d.over || !dropValid(d, d.over) || human === null) return;
    if (d.kind === 'hand' && d.over === 'hand') {
      if (d.uid && d.insert !== undefined) setHandOrder(reorder(d.uid, d.insert));
      return;
    }
    if (d.kind === 'hand' && d.uid && canCounter(d.uid)) {
      if (quickCounter) useCounter(d.uid);
      else setZoom(d.uid);
      return;
    }
    if (d.kind === 'hand') dispatch({ type: 'playCard', player: human, uid: d.uid! });
    else if (d.kind === 'attacker') dispatch({ type: 'attack', player: human, attacker: d.uid!, target: d.over });
    else attachDons(d.over, d.count ?? 1);
    setMode(null);
    setSelected(null);
  };

  const armLongPress = (uid: string | null) =>
    setTimeout(() => {
      const p = press.current;
      if (!p || !uid || dragRef.current) return;
      suppressClick.current = true;
      press.current = null;
      setLifted(null);
      setZoom(uid);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target as HTMLElement;
    const dragEl = el.closest<HTMLElement>('[data-drag]');
    const cardEl = el.closest<HTMLElement>('[data-uid]');
    if (!dragEl && !cardEl) return;
    const uid = (dragEl ?? cardEl)!.dataset.uid ?? null;
    const kind = (dragEl?.dataset.drag as DragKind | undefined) ?? null;
    const hand = Boolean(cardEl && el.closest('.hand.bottom'));
    if (press.current) clearTimeout(press.current.timer);
    if (hand && uid) setLifted(uid);
    press.current = {
      x: e.clientX,
      y: e.clientY,
      ax: e.clientX,
      ay: e.clientY,
      uid,
      kind,
      timer: armLongPress(cardEl?.dataset.uid ?? null),
      moved: false,
      hand,
      browsed: false,
    };
  };

  useEffect(() => {
    /** Posição na mão sob o dedo, pelas mesmas contas do leque no CSS. */
    const handSlot = (x: number): number | undefined => {
      const box = document.querySelector<HTMLElement>('.hand.bottom');
      const card = box?.querySelector<HTMLElement>('.hand-card');
      if (!box || !card) return undefined;
      const n = box.querySelectorAll('.hand-card').length;
      const w = box.clientWidth;
      const cw = card.offsetWidth;
      const step = n > 1 ? Math.min(cw * 0.9, (w - cw - 34) / (n - 1)) : 1;
      const left = box.getBoundingClientRect().left;
      return Math.max(0, Math.min(n - 1, Math.round((x - left - w / 2) / step + (n - 1) / 2)));
    };
    const findOver = (x: number, y: number, d: Drag): Pick<Drag, 'over' | 'insert'> => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return { over: null };
      if (d.kind === 'hand') {
        if (el.closest('.bottom-strip')) return { over: 'hand', insert: handSlot(x) };
        return { over: el.closest('[data-drop="field"]') && dropValidRef.current(d, 'field') ? 'field' : null };
      }
      const uid = el.closest<HTMLElement>('[data-uid]')?.dataset.uid ?? null;
      return { over: uid && dropValidRef.current(d, uid) ? uid : null };
    };
    const startDrag = (p: NonNullable<typeof press.current>, e: PointerEvent) => {
      clearTimeout(p.timer);
      const m = modeRef.current;
      const count = p.kind === 'don' && m?.kind === 'don' ? m.count : 1;
      dragRef.current = { kind: p.kind!, uid: p.uid, x: e.clientX, y: e.clientY, over: null, count };
      setLifted(null);
      setZoom(null);
      setMode(null);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (p.hand && !dragRef.current) {
        // Na mão: puxar para cima tira a carta; para os lados, ergue a carta sob o dedo.
        if (p.kind && p.y - e.clientY > HAND_PULL) startDrag(p, e);
        else {
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) p.moved = true;
          if (Math.hypot(e.clientX - p.ax, e.clientY - p.ay) > 8) {
            clearTimeout(p.timer);
            p.ax = e.clientX;
            p.ay = e.clientY;
            const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const under = hit?.closest('.hand.bottom') ? hit.closest<HTMLElement>('[data-uid]')?.dataset.uid : undefined;
            if (under && under !== p.uid) {
              p.uid = under;
              p.browsed = true;
              setLifted(under);
            }
            p.timer = armLongPress(p.uid);
          }
          return;
        }
      } else if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
        p.moved = true;
        clearTimeout(p.timer);
        if (!p.kind) return;
        startDrag(p, e);
      }
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: e.clientX, y: e.clientY, ...findOver(e.clientX, e.clientY, d) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const p = press.current;
      if (p) clearTimeout(p.timer);
      press.current = null;
      setLifted(null);
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        setDrag(null);
        suppressClick.current = true;
        dropRef.current(d);
      } else if (p?.hand && p.browsed && p.uid) {
        // Deslizou pela mão e soltou numa carta: age como um toque nela.
        suppressClick.current = true;
        onCardRef.current(p.uid);
      }
      // O clique (se houver) chega logo depois do pointerup; depois disso, libera.
      setTimeout(() => (suppressClick.current = false), 60);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // ------------------------------------------------------------ render

  const handlers = {
    highlight,
    onCard,
    onCardDouble,
    onHover: setHovered,
    onDon,
    onTrash: (p: PlayerId) => setSheet({ trash: p }),
    donPicked: (p: PlayerId) => (p === human && drag?.kind === 'don' ? (drag.count ?? 1) : p === human && mode?.kind === 'don' ? mode.count : 0),
    donHighlight: (p: PlayerId) =>
      p === human && (mode?.kind === 'don' || (drag?.kind === 'don') || (myTurnIdle && has((a) => a.type === 'attachDon'))),
    canDragHand: (uid: string) => human !== null && state.cards[uid]?.owner === human,
    canDragAttacker: (uid: string) => canAttackWith(uid),
    canDragDon: (p: PlayerId) => p === human && myTurnIdle && has((a) => a.type === 'attachDon'),
    fieldDrop: (p: PlayerId) =>
      p === human && drag?.kind === 'hand' && drag.uid !== null && (canPlay(drag.uid) || canCounter(drag.uid)),
  };

  const corner = (
    <>
      <button className="round-btn" onClick={() => setSheet('menu')} aria-label="Menu da partida">
        <span className="burger" />
      </button>
      {online && !watching && <EmoteBar online={online} />}
      {spectator && online && <SpectatorBar online={online} canHands={spectator.canHands} onToggleHands={spectator.onToggleHands} />}
      {online && !watching && <SpectatorCount online={online} />}
      {human !== null && !isOnline && (
        <button
          className={['auto-toggle', game.auto ? 'on' : ''].join(' ')}
          onClick={() => game.setAuto((a) => !a)}
          title="O bot joga por você enquanto estiver ligado"
        >
          <span className="knob" />
          Auto
        </button>
      )}
    </>
  );

  const detailUid = hovered ?? selected;

  return (
    <div
      className={['game', wide ? 'wide' : '', watching ? 'flip-top' : '', drag ? 'dragging' : ''].join(' ')}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="board-col">
        <Board
          state={state}
          bottom={bottom}
          revealBottom
          revealTop={showBotHand}
          corner={corner}
          bannerExtra={online ? (p) => <OnlineBanner online={online} player={p} /> : undefined}
          handOrder={handView}
          onExpandHand={human !== null ? () => setSheet('hand') : undefined}
          lifted={lifted}
          ghost={drag?.kind === 'hand' ? drag.uid : null}
          center={
            <CenterBand
              state={state}
              human={human}
              watching={watching}
              hands={
                spectator?.canHands && online ? { on: online.hands, onToggle: spectator.onToggleHands } : undefined
              }
              acting={acting}
              mode={mode}
              paused={game.paused}
              canEnd={myTurnIdle}
              onEnd={() => dispatch({ type: 'endTurn', player: human! })}
              onCancelMode={() => setMode(null)}
              onTogglePause={() => game.setPaused((p) => !p)}
            />
          }
          {...handlers}
        />

        {banner && state.phase === 'main' && (
          <div key={banner.key} className={['turn-banner', banner.mine ? 'mine' : 'theirs', animate ? 'sweep' : ''].join(' ')}>
            <div className="tb-stripe">
              <small>{banner.kicker}</small>
              <b>{banner.text}</b>
            </div>
          </div>
        )}

        {motionLayer}

        {online && <EmoteBubbles online={online} bottom={bottom} />}
        {online && <OnlineStatus online={online} />}

        {game.error && (
          <div className="toast error" onClick={() => game.setError(null)}>
            {game.error}
          </div>
        )}

        {intro && (
          <DiceRoll
            state={state}
            human={human}
            onResult={() => setRolling(false)}
            onChoose={(first) => {
              dispatch({ type: 'answer', player: human!, yes: first });
              setIntro(false);
            }}
            onDone={() => setIntro(false)}
          />
        )}

        <Prompt
          hidden={intro}
          state={state}
          human={human}
          picked={picked}
          onDispatch={dispatch}
          onCard={onCard}
          highlight={highlight}
          onTools={() => setSheet('tools')}
        />

        <AttackArrow state={state} drag={drag} mode={mode} hovered={hovered} legal={legal} />

        {drag && drag.kind !== 'attacker' && (
          <div
            className={['drag-ghost', `ghost-${drag.kind}`, drag.over ? 'over' : ''].join(' ')}
            style={{ left: drag.x, top: drag.y }}
          >
            {drag.kind === 'don' ? (
              <div className="don-stack">
                {Array.from({ length: Math.min(drag.count ?? 1, 4) }, (_, i) => (
                  <span key={i} className="don-card" style={{ ['--k' as string]: i }} />
                ))}
                {(drag.count ?? 1) > 1 && <b>×{drag.count}</b>}
              </div>
            ) : known(drag.uid) && <CardView state={state} uid={drag.uid!} />}
          </div>
        )}

        {zoom && (
          <CardZoom
            state={state}
            uid={zoom}
            legal={myTurnIdle ? legal : []}
            canManual={manualOk}
            onCounter={canCounter(zoom) ? () => useCounter(zoom) : undefined}
            onClose={() => setZoom(null)}
            onDispatch={(a) => {
              dispatch(a);
              setZoom(null);
              setSelected(null);
            }}
            onAttackMode={(attacker) => {
              setMode({ kind: 'attack', attacker });
              setZoom(null);
            }}
            onTools={() => {
              setZoom(null);
              setSheet('tools');
            }}
          />
        )}

        {sheet === 'menu' && (
          <SheetFrame title="Partida" onClose={() => setSheet(null)}>
            <div className="menu-grid">
              {human !== null && !isOnline && (
                <button className="btn" onClick={game.undo} disabled={!game.canUndo}>
                  ↶ Desfazer
                </button>
              )}
              {!isOnline && (
                <button className="btn" onClick={() => game.setPaused((p) => !p)}>
                  {game.paused ? '▶ Continuar' : '❚❚ Pausar'}
                </button>
              )}
              <button className="btn" onClick={() => setSheet('log')}>
                📜 Histórico
              </button>
              {manualOk && (
                <button className="btn" onClick={() => setSheet('tools')}>
                  ⚙ Ferramentas manuais
                </button>
              )}
              {(!isOnline || over) && (
                <button className="btn" onClick={game.downloadReplay}>
                  ⤓ Baixar replay
                </button>
              )}
              {human !== null && state.phase === 'main' && (
                <button
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm('Desistir desta partida?')) {
                      dispatch({ type: 'concede', player: human });
                      setSheet(null);
                    }
                  }}
                >
                  🏳 Desistir
                </button>
              )}
              <button className="btn" onClick={onExit}>
                ← Sair para o {backTo}
              </button>
            </div>
            {!isOnline && (
              <div className="sheet-section">
                <label className="sheet-label">Velocidade do bot</label>
                <div className="seg small">
                  {[0.5, 1, 2, 4].map((v) => (
                    <button key={v} className={game.speed === v ? 'on' : ''} onClick={() => game.setSpeed(v)}>
                      {v}×
                    </button>
                  ))}
                </div>
              </div>
            )}
            {kind === 'bot' && (
              <label className="check">
                <input type="checkbox" checked={showBotHand} onChange={(e) => setShowBotHand(e.target.checked)} /> Ver a mão do bot
              </label>
            )}
            <div className="sheet-section">
              <SettingsControls compact />
            </div>
          </SheetFrame>
        )}

        {sheet === 'hand' && human !== null && (
          <SheetFrame title={`Sua mão (${orderedHand.length})`} onClose={() => setSheet(null)}>
            {state.battle && <BattleInfo state={state} human={human} />}
            <p className="muted small hand-sheet-hint">
              {myPending?.kind === 'counter'
                ? quickCounter
                  ? 'Toque numa carta destacada para usar o Counter na hora.'
                  : 'Toque numa carta destacada e confirme para usar o Counter.'
                : myPending?.kind === 'selectTargets'
                  ? myPending.prompt
                  : 'Toque numa carta para ver as ações. Segure para ler.'}
            </p>
            <div className="hand-grid">
              {orderedHand.map((uid) => (
                <CardView key={uid} state={state} uid={uid} highlight={highlight(uid)} onClick={() => onCard(uid)} />
              ))}
            </div>
          </SheetFrame>
        )}

        {sheet === 'log' && (
          <SheetFrame title="Histórico" onClose={() => setSheet(null)}>
            <LogPanel state={state} />
          </SheetFrame>
        )}

        {sheet === 'tools' && human !== null && (
          <SheetFrame title="Ferramentas manuais" onClose={() => setSheet(null)}>
            <ManualPrompt state={state} onDone={() => dispatch({ type: 'manualDone', player: human })} />
            {ranked ? (
              <p className="muted">As ferramentas manuais não são permitidas na ranqueada.</p>
            ) : manualOk ? (
              <ManualTools state={state} human={human} selected={selected} onDispatch={dispatch} onSelect={setSelected} peek={online?.peek} />
            ) : (
              <p className="muted">As ferramentas ficam disponíveis no seu turno, num efeito manual ou na etapa de Counter.</p>
            )}
          </SheetFrame>
        )}

        {sheet !== null && typeof sheet === 'object' && (
          <SheetFrame
            title={`Descarte de ${state.players[sheet.trash].name} (${state.players[sheet.trash].trash.length})`}
            onClose={() => setSheet(null)}
          >
            <div className="card-list">
              {[...state.players[sheet.trash].trash].reverse().map((uid) => (
                <CardView key={uid} state={state} uid={uid} onClick={() => setZoom(uid)} onHover={setHovered} />
              ))}
              {state.players[sheet.trash].trash.length === 0 && <p className="muted">Nenhuma carta no descarte.</p>}
            </div>
          </SheetFrame>
        )}

        {state.phase === 'gameover' && showResult && (
          <GameResult
            state={state}
            human={human}
            actions={game.actions()}
            onExit={onExit}
            exitLabel={`Voltar ao ${backTo}`}
            onRematch={onRematch}
            rematchLabel={
              rematchLabel ??
              (online && human !== null ? (online.room?.rematch[human] ? 'Aguardando o oponente…' : 'Pedir revanche') : undefined)
            }
            onReplay={game.downloadReplay}
            onLog={() => setSheet('log')}
            extra={online ? <OnlineResultInfo online={online} /> : undefined}
          />
        )}
      </div>

      {wide && (
        <aside className="side-panel">
          <div className="panel-controls">
            <button className="btn small" onClick={onExit}>
              ← {backTo === 'torneio' ? 'Torneio' : 'Menu'}
            </button>
            {human !== null && !isOnline && (
              <button className="btn small" onClick={game.undo} disabled={!game.canUndo}>
                ↶ Desfazer
              </button>
            )}
            {!isOnline && (
              <>
                <button className="btn small" onClick={() => game.setPaused((p) => !p)}>
                  {game.paused ? '▶ Continuar' : '❚❚ Pausar'}
                </button>
                <select
                  className="speed"
                  value={game.speed}
                  onChange={(e) => game.setSpeed(Number(e.target.value))}
                  title="Velocidade do bot"
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </>
            )}
            {(!isOnline || over) && (
              <button className="btn small" onClick={game.downloadReplay} title="Salvar as ações como roteiro">
                ⤓ Replay
              </button>
            )}
          </div>
          <CardDetail state={state} uid={detailUid} />
          {manualOk && pending?.kind !== 'manual' && (
            <ManualTools state={state} human={human!} selected={selected} onDispatch={dispatch} onSelect={setSelected} peek={online?.peek} />
          )}
          <LogPanel state={state} />
        </aside>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ faixa central

function CenterBand(props: {
  state: GameState;
  human: PlayerId | null;
  /** Espectador de partida online: sem botão de pausa e com "pensando" para os dois. */
  watching?: boolean;
  /** Espectador Streamer/Admin: o olho mostra ou esconde as mãos dos jogadores. */
  hands?: { on: boolean; onToggle: () => void };
  acting: PlayerId | null;
  mode: Mode;
  paused: boolean;
  canEnd: boolean;
  onEnd: () => void;
  onCancelMode: () => void;
  onTogglePause: () => void;
}) {
  const { state, human, mode, acting, watching } = props;
  const b = state.battle;
  const mineTurn = human === null ? state.activePlayer === 0 : state.activePlayer === human;

  let middle: ReactNode = null;
  if (b) middle = <BattleInfo state={state} human={human} />;
  else if (mode?.kind === 'attack')
    middle = (
      <button className="hint-pill" onClick={props.onCancelMode}>
        Escolha o alvo do ataque <small>(toque aqui para cancelar)</small>
      </button>
    );
  else if (mode?.kind === 'don')
    middle = (
      <button className="hint-pill" onClick={props.onCancelMode}>
        {mode.count} DON!! · toque no alvo ou arraste
        <small>toque aqui para cancelar</small>
      </button>
    );
  else if (props.paused) middle = <span className="hint-pill">Pausado</span>;
  else if (acting !== null && acting !== human && (state.players[acting].isBot || human !== null || watching) && state.phase === 'main')
    middle = (
      <span className="hint-pill thinking">
        {state.players[acting].name} está pensando<span className="dots" />
      </span>
    );
  else if (state.pending?.kind === 'chooseFirst' && acting !== null && acting !== human)
    middle = (
      <span className="hint-pill thinking">
        {state.players[acting].name} venceu o sorteio e está escolhendo quem começa<span className="dots" />
      </span>
    );
  else if (state.phase === 'mulligan' && (human !== null || watching) && acting !== null && acting !== human)
    middle = (
      <span className="hint-pill thinking">
        {state.players[acting].name} está escolhendo a mão inicial<span className="dots" />
      </span>
    );
  else if (props.canEnd)
    middle = (
      <span className="hint-pill soft">
        {state.turn <= 2 ? 'Primeiro turno: sem ataques. ' : ''}Toque numa carta para agir ou arraste-a.
      </span>
    );

  return (
    <>
      <div className={['turn-chip', mineTurn ? 'mine' : 'theirs'].join(' ')}>
        <small>Turno</small>
        <b>{state.phase === 'mulligan' ? '—' : state.turn}</b>
      </div>
      <div className="band-middle">{middle}</div>
      {human !== null ? (
        <button className="end-turn" disabled={!props.canEnd} onClick={props.onEnd}>
          Encerrar
          <br />
          turno
        </button>
      ) : watching && props.hands ? (
        <button
          className={['end-turn', 'watching', 'hands-toggle', props.hands.on ? 'on' : ''].join(' ')}
          onClick={props.hands.onToggle}
          aria-pressed={props.hands.on}
          title={props.hands.on ? 'Esconder as mãos dos jogadores' : 'Mostrar as mãos dos jogadores'}
        >
          <EyeIcon closed={!props.hands.on} />
        </button>
      ) : watching ? (
        <span className="end-turn watching" title="Você está assistindo">
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

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {closed && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Poder do atacante contra o alvo, com o que falta para defender (como o "Dano previsto" do Pocket). */
function BattleInfo({ state, human }: { state: GameState; human: PlayerId | null }) {
  const b = state.battle!;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const defender = state.cards[b.target].owner;
  const hits = atk >= def;
  const need = atk - def + 1000;
  let status: string;
  if (human !== null && defender === human) status = hits ? `Faltam +${need} para defender` : 'Defendido!';
  else status = hits ? 'O ataque vai acertar' : `Faltam +${def - atk} para acertar`;
  // Etapa da batalha (a visão do oponente também traz o tipo da escolha pendente).
  const step =
    state.pending?.kind === 'block'
      ? 'Etapa de Bloqueio'
      : state.pending?.kind === 'counter'
        ? 'Etapa de Counter'
        : state.stack.some((f) => f.kind === 'damage')
          ? 'Etapa de Dano'
          : 'Ataque';
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
      <div className={['battle-status', hits ? 'hit' : 'safe'].join(' ')}>
        {b.blocked ? 'Bloqueado · ' : ''}
        {status}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ seta de ataque

/**
 * Seta do atacante até o alvo: durante a batalha, enquanto o jogador arrasta um
 * atacante (segue o dedo) e, no modo de ataque, até o alvo sob o mouse.
 */
function AttackArrow({
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
    const center = (uid: string) => {
      const el = document.querySelector<HTMLElement>(`.mat [data-uid="${CSS.escape(uid)}"]`);
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
        <marker id="arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
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

// ------------------------------------------------------------------ prompts

function Prompt(props: {
  /** Ainda não aparece (sorteio inicial na tela). */
  hidden?: boolean;
  state: GameState;
  human: PlayerId | null;
  picked: string[];
  onDispatch: (a: Action) => void;
  onCard: (uid: string) => void;
  highlight: (uid: string) => Highlight;
  onTools: () => void;
}) {
  const { state, human, picked, onDispatch } = props;
  const { lang, quickCounter } = useSettings();
  const pending = state.pending;
  if (props.hidden || state.phase === 'gameover' || !pending || human === null || pending.player !== human) return null;

  switch (pending.kind) {
    case 'chooseFirst':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">Sorteio inicial</div>
            <h2>Você venceu o sorteio!</h2>
            <p className="muted">Quer jogar primeiro ou segundo?</p>
            <p className="muted small">
              Quem joga primeiro não compra carta no primeiro turno e recebe 1 DON!!; quem joga segundo compra e recebe 2 DON!!.
            </p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                Jogar primeiro
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                Jogar segundo
              </button>
            </div>
          </div>
        </div>
      );
    case 'mulligan': {
      const first = state.firstPlayer === human;
      return (
        <div className="modal-backdrop">
          <div className="modal-card mulligan">
            <div className="modal-kicker">{first ? 'Você jogará primeiro' : `${state.players[state.firstPlayer].name} jogará primeiro`}</div>
            <h2>Mão inicial</h2>
            <div className="mulligan-hand">
              {state.players[human].hand.map((uid, i) => (
                <div key={uid} className="deal" style={{ animationDelay: `${i * 70}ms` }}>
                  <CardView state={state} uid={uid} onClick={() => props.onCard(uid)} />
                </div>
              ))}
            </div>
            <p className="muted small">Toque numa carta para ler. Você pode trocar a mão uma única vez.</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: false })}>
                Manter mão
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: true })}>
                Trocar mão
              </button>
            </div>
          </div>
        </div>
      );
    }
    case 'selectTargets': {
      // Opções fora da mesa (topo do deck, descarte, Vida) aparecem dentro do prompt.
      // Numa busca, todas as cartas olhadas aparecem; as que não podem ser escolhidas ficam apagadas.
      const shown = pending.shown?.length ? pending.shown : null;
      const offBoard = shown ?? pending.options.filter((u) => ['deck', 'trash', 'life'].includes(zoneOf(state, u) ?? ''));
      const blocked = shown ? shown.filter((u) => !pending.options.includes(u)).length : 0;
      const confirm = (
        <div className="btn-row">
          {pending.max === 0 ? (
            <button className="btn primary" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
              Continuar
            </button>
          ) : (
            <>
              {pending.min === 0 && (
                <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
                  Não escolher
                </button>
              )}
              <button
                className="btn primary"
                disabled={picked.length < pending.min}
                onClick={() => onDispatch({ type: 'choose', player: human, uids: picked })}
              >
                Confirmar {pending.max > 1 ? `(${picked.length}/${pending.max})` : ''}
              </button>
            </>
          )}
        </div>
      );
      const order = pending.ordered && picked.length > 0 && (
        <p className="muted small">Ordem: {picked.map((u, i) => `${i + 1}. ${cardDef(state, u).name}`).join(' → ')}</p>
      );
      const options = (
        <div className="prompt-options">
          {offBoard.map((uid) => (
            <CardView key={uid} state={state} uid={uid} highlight={props.highlight(uid)} onClick={() => props.onCard(uid)} />
          ))}
        </div>
      );
      if (shown || offBoard.length === pending.options.length) {
        return (
          <div className="modal-backdrop">
            <div className="modal-card">
              <SourceLine state={state} uid={pending.source} />
              <h3>{pending.prompt}</h3>
              <p className="muted small">
                {pending.max === 0
                  ? 'Toque numa carta para ler.'
                  : pending.ordered
                    ? 'Toque nas cartas na ordem desejada. Segure para ler.'
                    : 'Toque nas cartas para escolher. Segure para ler.'}
                {blocked > 0 && ' As cartas apagadas não podem ser escolhidas.'}
              </p>
              {options}
              {order}
              {confirm}
            </div>
          </div>
        );
      }
      return (
        <PromptPill title={pending.prompt} subtitle={`Toque nas cartas destacadas (${picked.length}/${pending.max}).`}>
          {offBoard.length > 0 && options}
          {order}
          {confirm}
        </PromptPill>
      );
    }
    case 'block':
      return (
        <PromptPill title="Bloquear?" subtitle="Toque num Personagem com [Blocker] para receber o ataque.">
          <div className="btn-row">
            <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
              Não bloquear
            </button>
          </div>
        </PromptPill>
      );
    case 'counter':
      return (
        <PromptPill
          title="Etapa de Counter"
          subtitle={
            quickCounter
              ? 'Toque numa carta destacada da mão (ou arraste-a até a mesa) para usar o Counter na hora.'
              : 'Toque numa carta destacada da mão (ou arraste-a até a mesa) e confirme para usar o Counter.'
          }
        >
          <div className="btn-row">
            <button className="btn" onClick={props.onTools}>
              ⚙
            </button>
            <button className="btn primary" onClick={() => onDispatch({ type: 'pass', player: human })}>
              Concluir counters
            </button>
          </div>
        </PromptPill>
      );
    case 'manual': {
      const text = lang === 'pt' ? translateToPt(pending.text).text : pending.text;
      return (
        <PromptPill title={`⚙ Efeito manual: ${cardDef(state, pending.source).name}`} subtitle={text} clamp>
          <div className="btn-row">
            <button className="btn" onClick={props.onTools}>
              Ferramentas
            </button>
            <button className="btn primary" onClick={() => onDispatch({ type: 'manualDone', player: human })}>
              Concluir efeito
            </button>
          </div>
        </PromptPill>
      );
    }
    case 'trigger':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">[Trigger] revelado da Vida</div>
            <div className="modal-feature">
              <CardView state={state} uid={pending.card} />
            </div>
            <h3>{cardDef(state, pending.card).name}</h3>
            <p className="effect trigger">{cardText(cardDef(state, pending.card), lang).trigger}</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                Ativar [Trigger]
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                Adicionar à mão
              </button>
            </div>
          </div>
        </div>
      );
    case 'option':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{pending.prompt}</h3>
            <div className="btn-col">
              {pending.options.map((label, index) => (
                <button
                  key={index}
                  className={`btn${index === 0 ? ' primary' : ''}`}
                  onClick={() => onDispatch({ type: 'option', player: human, index })}
                >
                  {lang === 'pt' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label) ? translateToPt(label).text : label}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    case 'confirm':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{pending.prompt}</h3>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                Pagar e usar
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                Não usar
              </button>
            </div>
          </div>
        </div>
      );
  }
}

function SourceLine({ state, uid }: { state: GameState; uid: string }) {
  if (!state.cards[uid]) return null;
  return (
    <div className="source-line">
      <div className="source-thumb">
        <CardView state={state} uid={uid} />
      </div>
      <span>{cardDef(state, uid).name}</span>
    </div>
  );
}

function PromptPill({
  title,
  subtitle,
  clamp,
  children,
}: {
  title: string;
  subtitle?: string;
  clamp?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="prompt-pill">
      <div className="prompt-title">{title}</div>
      {subtitle && (
        <p className={['prompt-sub', clamp && !open ? 'clamp' : ''].join(' ')} onClick={() => setOpen((o) => !o)}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

function ManualPrompt({ state, onDone }: { state: GameState; onDone: () => void }) {
  const { lang } = useSettings();
  const pending = state.pending;
  if (pending?.kind !== 'manual') return null;
  const text = lang === 'pt' ? translateToPt(pending.text).text : pending.text;
  return (
    <div className="manual-box">
      <div className="prompt-title">⚙ Efeito manual: {cardDef(state, pending.source).name}</div>
      <p className="effect">{text}</p>
      <p className="muted small">
        Ainda não é automático: aplique com as ferramentas abaixo (toque numa carta da mesa e depois em ⚙ para ver as opções
        dela) e depois conclua. Se não se aplicar, só conclua.
      </p>
      <button className="btn primary" onClick={onDone}>
        Concluir efeito
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ zoom da carta

function CardZoom(props: {
  state: GameState;
  uid: string;
  legal: Action[];
  canManual: boolean;
  /** Etapa de Counter: confirma o uso desta carta como Counter. */
  onCounter?: () => void;
  onClose: () => void;
  onDispatch: (a: Action) => void;
  onAttackMode: (attacker: string) => void;
  onTools: () => void;
}) {
  const { state, uid, legal } = props;
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  const play = legal.find((a) => a.type === 'playCard' && a.uid === uid);
  const activates = legal.filter((a): a is Extract<Action, { type: 'activate' }> => a.type === 'activate' && a.uid === uid);
  const canAttack = legal.some((a) => a.type === 'attack' && a.attacker === uid);
  const attach = legal.find((a) => a.type === 'attachDon' && a.target === uid);
  const owner = state.cards[uid].owner;
  const hasActions = Boolean(play || activates.length || canAttack || attach || props.canManual || props.onCounter);
  const counter = counterValue(state, uid);

  return (
    <div className="modal-backdrop zoom-backdrop" onClick={props.onClose}>
      <div className="zoom" onClick={(e) => e.stopPropagation()}>
        <button className="zoom-close" onClick={props.onClose} aria-label="Fechar">
          ✕
        </button>
        <div className="zoom-card">
          <CardView state={state} uid={uid} fc={loc?.fc} />
        </div>
        {hasActions && (
          <div className="zoom-actions">
            {props.onCounter && (
              <button className="btn primary big" onClick={props.onCounter}>
                🛡 {def.category === 'event' ? 'Usar evento [Counter]' : 'Usar como Counter'}
                {counter > 0 && <span className="cost-chip">+{counter}</span>}
              </button>
            )}
            {play && (
              <button className="btn primary big" onClick={() => props.onDispatch(play)}>
                {def.category === 'event' ? 'Usar evento' : 'Jogar'} <span className="cost-chip">{def.cost}</span>
              </button>
            )}
            {canAttack && (
              <button className="btn attack big" onClick={() => props.onAttackMode(uid)}>
                ⚔ Atacar <span className="cost-chip">{getPower(state, uid)}</span>
              </button>
            )}
            {activates.map((a) => (
              <button key={a.ability} className="btn big" onClick={() => props.onDispatch(a)}>
                ✦ {def.abilities[a.ability].label ?? 'Ativar efeito'}
              </button>
            ))}
            {attach && (
              <button className="btn don big" onClick={() => props.onDispatch(attach)}>
                + 1 DON!! <small>({state.players[owner].donActive} ativos)</small>
              </button>
            )}
            {props.canManual && (
              <button className="btn small" onClick={props.onTools}>
                ⚙ Ferramentas manuais
              </button>
            )}
          </div>
        )}
        <div className="zoom-text">
          <CardTextInfo def={def} power={loc ? getPower(state, uid) : undefined} />
        </div>
      </div>
    </div>
  );
}

function CardDetail({ state, uid }: { state: GameState; uid: string | null }) {
  if (!uid) {
    return <div className="detail empty">Passe o mouse sobre uma carta para ver os detalhes. Clique para agir.</div>;
  }
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  return (
    <div className="detail">
      <div className="detail-card">
        <CardView state={state} uid={uid} fc={loc?.fc} />
      </div>
      <CardTextInfo def={def} power={loc ? getPower(state, uid) : undefined} />
    </div>
  );
}

// ------------------------------------------------------------------ folhas

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function LogPanel({ state }: { state: GameState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.log.length]);
  return (
    <div className="log" ref={ref}>
      {state.log.map((e, i) => (
        <div key={i} className={['log-line', e.player === null ? '' : `p${e.player}`, e.text.startsWith('—') ? 'turn' : ''].join(' ')}>
          {e.secret ?? e.text}
        </div>
      ))}
    </div>
  );
}

export function downloadReplay(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gumgum-replay-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
