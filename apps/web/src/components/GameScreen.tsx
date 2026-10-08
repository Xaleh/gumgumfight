import {
  type Action,
  actingPlayer,
  cancelAllowed,
  cardDef,
  cardStatuses,
  counterTargets,
  counterValue,
  type GameState,
  getCost,
  getPower,
  HIDDEN_CARD,
  legalActions,
  locate,
  type Pending,
  type PlayerId,
  translateToPt,
  zoneOf,
} from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, type OnlineSeat, type WatchTarget } from '../api';
import { abilityCostLabel, abilityText, abilityTitle } from '../game/abilityText';
import { type GameSetup, useGame } from '../game/useGame';
import { type OnlineGame, useOnlineGame } from '../game/useOnlineGame';
import { cardText, SettingsControls, useSettings } from '../settings';
import { Board } from './Board';
import { CardTextInfo } from './CardInfo';
import { CardView, type Highlight } from './CardView';
import { DiceRoll } from './DiceRoll';
import { ErrorBoundary } from './ErrorBoundary';
import { GameResult } from './GameResult';
import { useBoardMotion } from './Motion';
import {
  EmoteBar,
  EmoteBubbles,
  OnlineBanner,
  OnlineClock,
  OnlineResultInfo,
  OnlineStatus,
  OnlineWaiting,
  SpectatorBar,
  SpectatorCount,
  seriesAfter,
} from './Online';

/** Linhas do histórico que viram aviso na mesa (ver `notice` em GameScreen). */
const NOTICE_RE = /a condição não vale|não pode bloquear|não pode ser virada|não pode ativar \[Blocker\]/;

/**
 * Modo 'don': DON!! ativos marcados para anexar de uma vez (modelo do OPTCG Sim). `picked` guarda a posição de
 * cada DON!! tocado na fileira, para marcar exatamente ele. Sem `step`, a faixa central mostra a barra de ações
 * (Anexar ao Líder / a um Personagem / Cancelar) e a mesa segue normal; com `step: 'character'`, só os
 * Personagens que podem receber DON!! ficam destacados e o toque num deles anexa.
 */
type Mode = null | { kind: 'attack'; attacker: string } | { kind: 'don'; picked: number[]; step?: 'character' };
/** attached = DON!! anexado numa carta, arrastado de volta para a área de custo (detachDon). */
type DragKind = 'hand' | 'attacker' | 'don' | 'attached';
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
  /** Posições na fileira dos DON!! arrastados (ficam apagados enquanto o arrasto dura). */
  dons?: number[];
}
type Sheet = null | 'menu' | 'log' | 'hand' | { trash: PlayerId };

const LONG_PRESS_MS = 420;
const DRAG_THRESHOLD = 9;
/** Quanto puxar a carta da mão para cima até ela "sair" (arrastar). */
const HAND_PULL = 22;
/** Com o mouse, deslizar a carta da mão para os lados já começa a arrastá-la (reordenar ou jogar). */
const HAND_SLIDE = 14;

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

/** Partida no navegador: contra o bot ou replay. */
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
  /**
   * Aviso curto na mesa para as linhas do histórico que explicam por que algo não aconteceu
   * (condição de efeito que não vale, [Blocker] que não pode bloquear, carta que não pode ser
   * virada). No celular o histórico fica atrás de um botão, e sem o aviso parece que o jogo ignorou a jogada.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeSeen = useRef(state.log.length);
  useEffect(() => {
    if (noticeSeen.current > state.log.length) noticeSeen.current = 0; // desfazer / replay
    const fresh = state.log.slice(noticeSeen.current);
    noticeSeen.current = state.log.length;
    const hit = [...fresh].reverse().find((e) => NOTICE_RE.test(e.text));
    if (!hit) return;
    setNotice(hit.text);
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [state.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOnline = kind === 'online';
  const watching = Boolean(spectator);
  // Partida de torneio: "voltar" leva para a página do torneio.
  const backTo = online?.room?.tournament ? 'torneio' : 'menu';
  const wide = useMediaQuery('(min-width: 1000px)');
  const { quickCounter, animations, lang } = useSettings();
  // Só a opção do app decide: muitos celulares ligam "reduzir movimento" sozinhos
  // (economia de bateria) e as animações e os dados sumiriam sem o jogador saber por quê.
  const animate = animations;
  // Cartas voando entre as zonas (mais rápidas com o bot acelerado).
  const allActions = game.actions();
  const motion = useBoardMotion(state, {
    enabled: animate,
    tempo: Math.min(1.3, Math.max(0.35, 1 / game.speed)),
    lastAction: allActions[allActions.length - 1],
    lang,
  });
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
  const [showBotHand, setShowBotHand] = useState(kind === 'replay' || watching);
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
  /** Ordena a mão por custo (Eventos e Stages depois dos Personagens de mesmo custo) e nome; só exibição. */
  const sortHand = () => {
    const rank = (uid: string) => {
      const d = cardDef(state, uid);
      return [d.cost ?? 0, d.category === 'character' ? 0 : d.category === 'event' ? 1 : 2, d.name] as const;
    };
    setHandOrder(
      [...myHand].sort((a, b) => {
        const [ca, ka, na] = rank(a);
        const [cb, kb, nb] = rank(b);
        return ca - cb || ka - kb || na.localeCompare(nb);
      }),
    );
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
      // DON!! que saíram da fileira (foram anexados ou virados) deixam de estar marcados.
      const picked = mode.picked.filter((i) => i < max);
      if (picked.length === 0) setMode(null);
      else if (picked.length !== mode.picked.length) setMode({ ...mode, picked });
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

  const has = useCallback((pred: (a: Action) => boolean) => legal.some(pred), [legal]);
  const canPlay = (uid: string) => myTurnIdle && has((a) => a.type === 'playCard' && a.uid === uid);
  const canAttackWith = (uid: string) => myTurnIdle && has((a) => a.type === 'attack' && a.attacker === uid);
  /** Etapa de Counter: esta carta da mão pode ser usada como Counter agora? */
  const canCounter = (uid: string) => myPending?.kind === 'counter' && myPending.options.includes(uid);
  /** Usa o Counter; sem `target`, o valor vai para o atacado (o caso comum, num clique só). */
  const useCounter = (uid: string, target?: string) => {
    dispatch({ type: 'counter', player: human!, uid, ...(target ? { target } : {}) });
    setZoom(null);
    setSelected(null);
  };
  /** Decisão de defesa (Blocker ou Counter) que é deste jogador: vira o botão grande na faixa central. */
  const defense = myPending && (myPending.kind === 'block' || myPending.kind === 'counter') && state.battle ? myPending : null;
  /**
   * Escolha de alvos de um efeito que é deste jogador, com todos os alvos na mesa ou na mão: o pedido
   * vai para a faixa central e o botão de confirmar toma o lugar de "Encerrar turno", como no Counter.
   * (Alvos fora da mesa, como o topo do deck, o descarte ou a Vida, continuam num modal com as cartas.)
   */
  const targets = myPending?.kind === 'selectTargets' && targetsOnTable(state, myPending) ? myPending : null;
  const decision = defense ?? targets;
  /**
   * A ação em andamento (habilidade, carta jogada, DON!! anexado, ataque) ainda pode ser desfeita no motor:
   * o botão Cancelar aparece ao lado de "Confirmar" e nos balões de escolha. Quando o motor já não deixa
   * (uma carta foi revelada), a interface explica em vez de só esconder o botão.
   */
  const canCancel = human !== null && cancelAllowed(state, human);
  const cancelHint =
    human !== null && myPending && state.cancel?.player === human && state.cancel.blocked === 'revealed'
      ? 'Não dá mais para cancelar: carta revelada'
      : null;
  const cancelAction = () => {
    dispatch({ type: 'cancel', player: human! });
    setPicked([]);
    setZoom(null);
  };
  const targetsInHand = targets ? targets.options.filter((u) => zoneOf(state, u) === 'hand').length : 0;
  const handHint =
    defense?.kind === 'block'
      ? 'Toque num Personagem com [Blocker] para bloquear'
      : defense?.kind === 'counter'
        ? !defense.options.length
          ? 'Nenhuma carta da mão serve como Counter agora: conclua a etapa (o oponente não sabe disso)'
          : quickCounter
            ? 'Toque numa carta destacada da mão (ou arraste-a até a mesa) para usar o Counter (toque longo: dar a outra carta)'
            : 'Toque numa carta destacada da mão (ou arraste-a até a mesa) e confirme o Counter'
        : targets
          ? targets.max === 0
            ? 'Toque numa carta destacada para ler e depois continue'
            : `Toque nas cartas destacadas ${
                targetsInHand === targets.options.length ? 'da mão' : targetsInHand > 0 ? 'da mesa ou da mão' : 'da mesa'
              }${targets.ordered ? ', na ordem desejada,' : ''} e confirme`
          : null;

  /** Destinos válidos para o que está sendo arrastado. */
  const dropValid = (d: Pick<Drag, 'kind' | 'uid'>, over: string | null): boolean => {
    if (!over) return false;
    if (d.kind === 'hand') {
      return over === 'hand' || (over === 'field' && d.uid !== null && (canPlay(d.uid) || canCounter(d.uid)));
    }
    if (d.kind === 'attacker') return has((a) => a.type === 'attack' && a.attacker === d.uid && a.target === over);
    if (d.kind === 'attached') return over === 'don' && has((a) => a.type === 'detachDon' && a.target === d.uid);
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
    if (mode?.kind === 'don' && mode.step === 'character') {
      return canReceiveDon(uid, 'character') ? 'option' : null;
    }
    // DON!! marcados sem ação escolhida: a mesa continua com os destaques normais.
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
    if (mode?.kind === 'don' && mode.step === 'character') {
      if (canReceiveDon(uid, 'character')) {
        attachDons(uid, mode.picked.length);
        setMode(null);
        return;
      }
      // Tocou fora dos alvos: volta para a barra de ações, com os DON!! ainda marcados.
      setMode({ kind: 'don', picked: mode.picked });
      return;
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

  /** A carta pode receber DON!! agora? `kind` restringe a Líder ou a Personagem. */
  const canReceiveDon = (uid: string, kind?: 'leader' | 'character') => {
    if (!has((a) => a.type === 'attachDon' && a.target === uid)) return false;
    if (!kind || human === null) return true;
    const isLeader = state.players[human].leader.uid === uid;
    return kind === 'leader' ? isLeader : !isLeader;
  };

  /** Toque num DON!! ativo: marca exatamente aquele (ou desmarca, se já estava marcado). */
  const onDon = (player: PlayerId, index: number) => {
    if (player !== human || !myTurnIdle || !has((a) => a.type === 'attachDon')) return;
    const max = state.players[human].donActive;
    if (index < 0 || index >= max) return;
    setMode((m) => {
      const cur = m?.kind === 'don' ? m.picked : [];
      const picked = cur.includes(index) ? cur.filter((i) => i !== index) : [...cur, index].sort((a, b) => a - b);
      return picked.length > 0 ? { kind: 'don', picked, step: m?.kind === 'don' ? m.step : undefined } : null;
    });
  };

  /** Barra de ações dos DON!! marcados (na faixa central): o que fazer com eles. */
  const donBar =
    mode?.kind === 'don' && human !== null
      ? (() => {
          const me = state.players[human];
          const { picked } = mode;
          const count = picked.length;
          return (
            <DonBar
              count={count}
              step={mode.step}
              canLeader={canReceiveDon(me.leader.uid, 'leader')}
              characters={me.characters.filter((c) => canReceiveDon(c.uid, 'character')).length}
              onLeader={() => {
                attachDons(me.leader.uid, count);
                setMode(null);
              }}
              onCharacter={() => setMode({ kind: 'don', picked, step: 'character' })}
              onBack={() => setMode({ kind: 'don', picked })}
              onCancel={() => setMode(null)}
            />
          );
        })()
      : null;
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
    /** Posição na fileira do DON!! ativo pressionado. */
    don?: number;
    timer: ReturnType<typeof setTimeout>;
    moved: boolean;
    /** Começou na própria mão: deslizar ergue a carta sob o dedo. */
    hand: boolean;
    browsed: boolean;
    /** Mouse: deslizar para os lados na mão arrasta a carta (no toque, folheia). */
    mouse: boolean;
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
    else if (d.kind === 'attached') dispatch({ type: 'detachDon', player: human, target: d.uid! });
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
    const don = dragEl?.dataset.don !== undefined ? Number(dragEl.dataset.don) : undefined;
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
      ...(don !== undefined ? { don } : {}),
      timer: armLongPress(cardEl?.dataset.uid ?? null),
      moved: false,
      hand,
      browsed: false,
      mouse: e.pointerType === 'mouse',
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
      if (d.kind === 'attached') {
        // DON!! anexado volta para a própria fileira de DON!! (a de baixo).
        return { over: el.closest('.don-row.bottom') && dropValidRef.current(d, 'don') ? 'don' : null };
      }
      const uid = el.closest<HTMLElement>('[data-uid]')?.dataset.uid ?? null;
      return { over: uid && dropValidRef.current(d, uid) ? uid : null };
    };
    const startDrag = (p: NonNullable<typeof press.current>, e: PointerEvent) => {
      clearTimeout(p.timer);
      const m = modeRef.current;
      // Arrastar um DON!! marcado leva todos os marcados; um DON!! sem marca vai sozinho.
      const marked = m?.kind === 'don' ? m.picked : [];
      const dons = p.kind !== 'don' ? [] : p.don !== undefined && marked.includes(p.don) ? marked : p.don !== undefined ? [p.don] : marked;
      const count = p.kind === 'don' ? Math.max(1, dons.length) : 1;
      dragRef.current = { kind: p.kind!, uid: p.uid, x: e.clientX, y: e.clientY, over: null, count, ...(dons.length ? { dons } : {}) };
      setLifted(null);
      setZoom(null);
      setMode(null);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (p.hand && !dragRef.current) {
        // Na mão: puxar para cima tira a carta; para os lados, ergue a carta sob o dedo (toque) ou, com o
        // mouse, já arrasta (soltar na própria mão reordena).
        if (p.kind && (p.y - e.clientY > HAND_PULL || (p.mouse && Math.abs(e.clientX - p.x) > HAND_SLIDE))) startDrag(p, e);
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
    donPicked: (p: PlayerId) => (p === human && drag?.kind === 'don' ? (drag.dons ?? []) : p === human && mode?.kind === 'don' ? mode.picked : []),
    donHighlight: (p: PlayerId) =>
      p === human && (mode?.kind === 'don' || drag?.kind === 'don' || (myTurnIdle && has((a) => a.type === 'attachDon'))),
    donDrop: (p: PlayerId) => p === human && drag?.kind === 'attached' && drag.over === 'don',
    canDragHand: (uid: string) => human !== null && state.cards[uid]?.owner === human,
    canDragAttacker: (uid: string) => canAttackWith(uid),
    canDragDon: (p: PlayerId) => p === human && myTurnIdle && has((a) => a.type === 'attachDon'),
    canDragAttached: (uid: string) => myTurnIdle && has((a) => a.type === 'detachDon' && a.target === uid),
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
          onSortHand={human !== null && myHand.length > 1 ? sortHand : undefined}
          turnPulse={animate && myTurnIdle}
          handHint={handHint}
          lifted={lifted}
          ghost={drag?.kind === 'hand' ? drag.uid : null}
          center={
            <CenterBand
              state={state}
              human={human}
              watching={watching}
              wide={wide}
              pulse={animate && myTurnIdle}
              hands={
                spectator?.canHands && online ? { on: online.hands, onToggle: spectator.onToggleHands } : undefined
              }
              acting={acting}
              mode={mode}
              donBar={donBar}
              paused={game.paused}
              canEnd={myTurnIdle}
              onEnd={() => dispatch({ type: 'endTurn', player: human! })}
              onCancelMode={() => setMode(null)}
              onTogglePause={() => game.setPaused((p) => !p)}
              request={targets && <TargetRequest state={state} pending={targets} picked={picked} hint={cancelHint} />}
              decision={
                decision ? (
                  <DecisionButton
                    state={state}
                    pending={decision}
                    picked={picked}
                    human={human!}
                    onDispatch={dispatch}
                    onCancel={canCancel ? cancelAction : undefined}
                    clock={online && !watching ? <OnlineClock online={online} player={human!} /> : undefined}
                  />
                ) : mode && human !== null ? (
                  <CancelButton sub={mode.kind === 'attack' ? 'o ataque' : 'os DON!!'} onClick={() => setMode(null)} />
                ) : null
              }
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

        {motion.layer}

        {online && <EmoteBubbles online={online} bottom={bottom} />}
        {online && <OnlineStatus online={online} />}

        {game.error && (
          <div className="toast error" onClick={() => game.setError(null)}>
            {game.error}
          </div>
        )}
        {notice && !game.error && (
          <div className="toast notice" role="status" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}

        {intro && (
          <DiceRoll
            state={state}
            human={human}
            remote={online ? { throws: online.diceThrows, send: online.sendDice } : undefined}
            onResult={() => setRolling(false)}
            onChoose={(first) => {
              dispatch({ type: 'answer', player: human!, yes: first });
              setIntro(false);
            }}
            onDone={() => setIntro(false)}
          />
        )}

        <Prompt
          hidden={intro || motion.busy}
          state={state}
          human={human}
          picked={picked}
          onDispatch={dispatch}
          onCancel={canCancel ? cancelAction : undefined}
          cancelHint={cancelHint}
          onCard={onCard}
          highlight={highlight}
        />

        <AttackArrow state={state} drag={drag} mode={mode} hovered={hovered} legal={legal} />

        {drag && drag.kind !== 'attacker' && (
          <div
            className={['drag-ghost', `ghost-${drag.kind}`, drag.over ? 'over' : ''].join(' ')}
            style={{ left: drag.x, top: drag.y }}
          >
            {drag.kind === 'don' || drag.kind === 'attached' ? (
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
            onCounter={canCounter(zoom) ? () => useCounter(zoom) : undefined}
            counterTargets={canCounter(zoom) && state.battle && human !== null ? counterTargets(state, human).filter((u) => u !== state.battle!.target) : undefined}
            onCounterTo={(target) => useCounter(zoom, target)}
            onClose={() => setZoom(null)}
            onDispatch={(a) => {
              dispatch(a);
              setZoom(null);
              setSelected(null);
            }}
            donCount={mode?.kind === 'don' ? mode.picked.length : 0}
            onAttachDons={(target, n) => {
              attachDons(target, n);
              setMode(null);
              setZoom(null);
              setSelected(null);
            }}
            onAttackMode={(attacker) => {
              setMode({ kind: 'attack', attacker });
              setZoom(null);
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
              <SettingsControls />
            </div>
          </SheetFrame>
        )}

        {sheet === 'hand' && human !== null && (
          <SheetFrame title={`Sua mão (${orderedHand.length})`} onClose={() => setSheet(null)}>
            {state.battle && <BattleInfo state={state} human={human} />}
            {targets && <TargetRequest state={state} pending={targets} picked={picked} hint={cancelHint} />}
            {decision && (
              <DecisionButton
                state={state}
                pending={decision}
                picked={picked}
                human={human}
                onDispatch={dispatch}
                onCancel={canCancel ? cancelAction : undefined}
                clock={online && !watching ? <OnlineClock online={online} player={human} /> : undefined}
                sheet
              />
            )}
            {mode && !decision && (
              <div className="defense-slot in-sheet">
                <CancelButton sub={mode.kind === 'attack' ? 'o ataque' : 'os DON!!'} onClick={() => setMode(null)} />
              </div>
            )}
            <p className="muted small hand-sheet-hint">
              {myPending?.kind === 'counter'
                ? !myPending.options.length
                  ? 'Nenhuma carta serve como Counter agora: conclua a etapa.'
                  : quickCounter
                    ? 'Toque numa carta destacada para usar o Counter na hora.'
                    : 'Toque numa carta destacada e confirme para usar o Counter.'
                : targets
                  ? `${handHint}.`
                  : myPending?.kind === 'selectTargets'
                    ? myPending.prompt
                    : 'Toque numa carta para ver as ações. Segure para ler. Na mesa, arraste uma carta para cima e solte-a entre as outras para mudar a ordem.'}
            </p>
            {orderedHand.length > 1 && (
              <div className="btn-row center hand-sheet-tools">
                <button className="btn small" onClick={sortHand} title="Ordena a mão por custo e nome (só a exibição)">
                  ⇅ Ordenar por custo
                </button>
              </div>
            )}
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
  const b = state.battle;
  const mineTurn = human === null ? state.activePlayer === 0 : state.activePlayer === human;
  const centerDecision = Boolean(props.wide && props.decision);

  let middle: ReactNode = null;
  if (props.request) middle = props.request;
  else if (b) middle = <BattleInfo state={state} human={human} />;
  else if (mode?.kind === 'attack')
    middle = (
      <button className="hint-pill" onClick={props.onCancelMode}>
        Escolha o alvo do ataque <small>(toque aqui para cancelar)</small>
      </button>
    );
  else if (mode?.kind === 'don' && props.donBar) middle = props.donBar;
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
        {state.players[acting].name} {state.pending?.kind === 'mulligan' ? 'está escolhendo a mão inicial' : 'está preparando o início da partida'}
        <span className="dots" />
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
      <div className={['turn-chip', mineTurn ? 'mine' : 'theirs', props.pulse ? 'pulse' : ''].join(' ')} title={mineTurn ? 'Seu turno' : 'Turno do oponente'}>
        <small>Turno</small>
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

/**
 * DON!! marcados na fileira: quantos são e o que fazer com eles, como no OPTCG Sim. Primeiro a escolha da
 * ação (Líder anexa na hora; Personagem passa a destacar os alvos), depois o alvo. Sem arrastar, no celular.
 */
function DonBar(props: {
  count: number;
  step?: 'character';
  canLeader: boolean;
  /** Quantos Personagens podem receber DON!! agora. */
  characters: number;
  onLeader: () => void;
  onCharacter: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const { count, step } = props;
  // Em tela estreita (.brief) os textos encurtam para a barra caber numa linha entre o turno e "Encerrar turno".
  const counter = (
    <span className="don-bar-count">
      <span className="don-card mini" aria-hidden="true" />
      <b>{count}</b>
      <span className="full">{count === 1 ? 'selecionado' : 'selecionados'}</span>
      <span className="brief">DON!!</span>
    </span>
  );
  if (step === 'character')
    return (
      <div className="don-bar step" role="group" aria-label="Anexar DON!! a um Personagem">
        {counter}
        <span className="don-bar-hint">
          <span className="full">Toque no Personagem que recebe</span>
          <span className="brief">Toque no Personagem</span>
        </span>
        <button className="don-bar-btn back" onClick={props.onBack}>
          Voltar
        </button>
        <button className="don-bar-btn cancel" onClick={props.onCancel} aria-label="Cancelar">
          ✕
        </button>
      </div>
    );
  return (
    <div className="don-bar" role="group" aria-label="Anexar DON!!">
      {counter}
      {props.canLeader && (
        <button className="don-bar-btn" onClick={props.onLeader} aria-label="Anexar ao Líder">
          <span className="full">Anexar ao Líder</span>
          <span className="brief">Líder</span>
        </button>
      )}
      {props.characters > 0 && (
        <button className="don-bar-btn" onClick={props.onCharacter} aria-label="Anexar a um Personagem">
          <span className="full">Anexar a um Personagem</span>
          <span className="brief">Personagem</span>
        </button>
      )}
      <button className="don-bar-btn cancel" onClick={props.onCancel} aria-label="Cancelar">
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

/** Zonas cujas cartas não ficam à vista na mesa: a escolha entre elas abre um modal com as cartas. */
const OFF_TABLE = ['deck', 'trash', 'life'];

/**
 * Escolha de alvos que dá para fazer tocando na mesa ou na mão: nenhuma carta mostrada de uma busca,
 * ao menos um alvo e todos fora do deck, do descarte e da Vida.
 */
function targetsOnTable(state: GameState, pending: Extract<Pending, { kind: 'selectTargets' }>): boolean {
  if (pending.shown?.length || pending.options.length === 0) return false;
  return pending.options.every((u) => !OFF_TABLE.includes(zoneOf(state, u) ?? ''));
}

/**
 * Pedido de um efeito que escolhe alvos na mesa, no meio da faixa central: a carta de origem em
 * miniatura, o texto do pedido com o contador e, nos efeitos em que a ordem importa, a ordem marcada.
 */
function TargetRequest({
  state,
  pending,
  picked,
  hint,
}: {
  state: GameState;
  pending: Extract<Pending, { kind: 'selectTargets' }>;
  picked: string[];
  /** Aviso curto embaixo do pedido (ex.: por que não dá mais para cancelar). */
  hint?: string | null;
}) {
  const source = state.cards[pending.source] ? cardDef(state, pending.source) : null;
  // O motor costuma começar o pedido com "Nome da carta: "; o nome vai para a linha de cima.
  const prefix = source ? `${source.name}: ` : '';
  const text = prefix && pending.prompt.startsWith(prefix) ? pending.prompt.slice(prefix.length) : pending.prompt;
  const order = pending.ordered && picked.length > 0 ? picked.map((u, i) => `${i + 1}. ${cardDef(state, u).name}`).join(' → ') : null;
  return (
    <div className="target-request" title={pending.prompt}>
      {source && (
        <div className="source-thumb">
          <CardView state={state} uid={pending.source} />
        </div>
      )}
      <div className="target-text">
        {source && <small>{source.name}</small>}
        <b>
          {text}
          {pending.max > 0 && ` (${picked.length}/${pending.max})`}
        </b>
        {order && <small className="target-order">Ordem: {order}</small>}
        {hint && <small className="target-hint">{hint}</small>}
      </div>
    </div>
  );
}

/**
 * Botão grande de cancelar, no lugar de "Encerrar turno": sai do modo de ataque ou de DON!! marcados
 * (nada foi para o motor ainda), ou desfaz no motor a ação em andamento (`cancel`).
 */
function CancelButton({ sub, onClick, title }: { sub: string; onClick: () => void; title?: string }) {
  return (
    <button className="end-turn defense cancel" onClick={onClick} title={title ?? 'Cancelar e voltar'}>
      <b>Cancelar</b>
      <small>{sub}</small>
    </button>
  );
}

/**
 * Botão grande de decisão, sempre no mesmo lugar (o de "Encerrar turno"):
 * - Blocker/Counter: "Não bloquear", "Não usar Counter", com o resultado previsto do ataque; pulsa
 *   quando nenhuma carta da mão muda o resultado.
 * - Escolha de alvos de efeito: "Confirmar (n/máx)" (desabilitado até atingir o mínimo), "Não escolher"
 *   quando nada foi marcado e nada é obrigatório, ou "Continuar"; pulsa quando a escolha já está completa.
 * Online, o relógio do jogador fica ao lado: o tempo corre aqui.
 */
function DecisionButton({
  state,
  pending,
  picked,
  human,
  onDispatch,
  onCancel,
  clock,
  sheet,
}: {
  state: GameState;
  pending: Extract<Pending, { kind: 'block' | 'counter' | 'selectTargets' }>;
  /** Alvos já marcados (escolha de alvos). */
  picked: string[];
  human: PlayerId;
  onDispatch: (a: Action) => void;
  /** A ação que pediu esta escolha ainda pode ser desfeita: botão Cancelar ao lado do de confirmar. */
  onCancel?: () => void;
  clock?: ReactNode;
  /** Dentro da folha da mão: botão largo. */
  sheet?: boolean;
}) {
  const d = pending.kind === 'selectTargets' ? targetsDecision(pending, picked) : defenseDecision(state, pending);
  if (!d) return null;
  const act = () => onDispatch(d.action(human));
  return (
    <div className={['defense-slot', sheet ? 'in-sheet' : ''].join(' ')}>
      {onCancel && pending.kind === 'selectTargets' && (
        <button className="end-turn defense cancel side" onClick={onCancel} title="Desfazer a ação e voltar ao estado anterior">
          <b>Cancelar</b>
          <small>desfaz a ação</small>
        </button>
      )}
      <button
        className={['end-turn', 'defense', d.pulse && !d.disabled ? 'pulse' : ''].join(' ')}
        onClick={act}
        disabled={d.disabled}
        title={d.title}
      >
        <b>{d.label}</b>
        <small>{d.sub}</small>
      </button>
      {clock && <span className="defense-clock">{clock}</span>}
    </div>
  );
}

interface Decision {
  label: string;
  sub: string;
  title: string;
  /** Chama o olhar: não há mais o que fazer antes de concluir. */
  pulse: boolean;
  disabled?: boolean;
  action: (player: PlayerId) => Action;
}

/** Blocker/Counter: rótulo com o resultado previsto do ataque. */
function defenseDecision(state: GameState, pending: Extract<Pending, { kind: 'block' | 'counter' }>): Decision | null {
  const b = state.battle;
  if (!b) return null;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const hits = atk >= def;
  const need = atk - def + 1000;
  const counter = pending.kind === 'counter';
  // Já houve Counter nesta batalha: o alvo carrega um bônus de poder "até o fim da batalha".
  const used = counter && state.modifiers.some((m) => m.uid === b.target && m.kind === 'power' && m.duration === 'battle');
  // Nada na mão muda o resultado: o ataque já falha, ou os Counters somados não chegam ao que falta
  // (eventos [Counter] podem ter efeitos além do valor, então contam como úteis).
  let useless = !hits;
  if (counter && hits) {
    const events = pending.options.some((u) => cardDef(state, u).category === 'event');
    const total = pending.options.reduce((sum, u) => sum + counterValue(state, u), 0);
    useless = !events && total < need;
  }
  // Sem carta de Counter na mão a etapa abre mesmo assim (senão o atacante saberia): só resta concluir.
  const none = counter && !pending.options.length;
  const label = !counter ? 'Não bloquear' : !hits || none ? 'Concluir' : used ? 'Não usar mais Counter' : 'Não usar Counter';
  const result = hits ? 'o ataque passa' : 'defendido';
  return {
    label,
    sub: none && hits && !used ? `sem Counter na mão · ${atk} ⚔ ${def}` : `${result} · ${atk} ⚔ ${def}`,
    title: !counter
      ? `Seguir sem bloquear: ${result} (${atk} contra ${def})`
      : `Encerrar a etapa de Counter: ${result} (${atk} contra ${def})`,
    pulse: useless,
    action: (player) => (counter ? { type: 'pass', player } : { type: 'choose', player, uids: [] }),
  };
}

/** Escolha de alvos de efeito: "Confirmar (n/máx)", "Não escolher" ou "Continuar", com o contador. */
function targetsDecision(pending: Extract<Pending, { kind: 'selectTargets' }>, picked: string[]): Decision {
  const n = picked.length;
  const { max } = pending;
  // O mínimo nunca passa do que há para escolher.
  const need = Math.min(pending.min, pending.options.length);
  if (max === 0) {
    return {
      label: 'Continuar',
      sub: 'nada a escolher',
      title: pending.prompt,
      pulse: true,
      action: (player) => ({ type: 'choose', player, uids: [] }),
    };
  }
  if (n === 0 && need === 0) {
    return {
      label: 'Não escolher',
      sub: `nenhuma marcada · até ${max}`,
      title: `${pending.prompt} — seguir sem escolher`,
      pulse: false,
      action: (player) => ({ type: 'choose', player, uids: [] }),
    };
  }
  const missing = need - n;
  return {
    label: `Confirmar (${n}/${max})`,
    sub: missing > 0 ? `marque mais ${missing}` : n < max ? 'pode marcar mais' : 'escolha completa',
    title: pending.prompt,
    pulse: n === max,
    disabled: missing > 0,
    action: (player) => ({ type: 'choose', player, uids: picked }),
  };
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
  // A carta do [Trigger] em resolução está fora das áreas (nem Vida nem descarte): aparece aqui.
  const trigger = state.limbo?.find((u) => state.cards[u]);
  const step =
    state.pending?.kind === 'block'
      ? 'Etapa de Bloqueio'
      : state.pending?.kind === 'counter'
        ? 'Etapa de Counter'
        : trigger
          ? `[Trigger] ${cardDef(state, trigger).name}`
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
  /** Desfaz no motor a ação que abriu esta escolha (só enquanto o motor permite). */
  onCancel?: () => void;
  /** Por que não dá mais para cancelar (ex.: carta revelada). */
  cancelHint?: string | null;
  onCard: (uid: string) => void;
  highlight: (uid: string) => Highlight;
}) {
  const { state, human, picked, onDispatch, onCancel, cancelHint } = props;
  const { lang } = useSettings();
  const pending = state.pending;
  // "Ver a mesa": a janela da pergunta recolhe para um balão no topo, para olhar o campo e a mão antes de
  // responder (ex.: usar ou não um efeito quando o oponente ataca). Volta sozinha quando a situação muda.
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [pending]);
  if (props.hidden || state.phase === 'gameover' || !pending || human === null || pending.player !== human) return null;
  const peekButton = (
    <button className="btn peek" onClick={() => setPeek(true)} title="Recolhe a pergunta para você olhar a mesa e a mão; depois volte e responda">
      👁 Ver a mesa
    </button>
  );
  if (peek && (pending.kind === 'confirm' || pending.kind === 'option' || pending.kind === 'selectTargets' || pending.kind === 'lifeCard')) {
    const title = pending.kind === 'lifeCard' ? `Carta da Vida: ${cardDef(state, pending.card).name}` : pending.prompt;
    return (
      <PromptPill title={title} subtitle="A mesa e a mão estão à vista. Toque numa carta para ler; depois volte à pergunta.">
        <div className="btn-row center">
          <button className="btn primary" onClick={() => setPeek(false)}>
            Voltar à pergunta
          </button>
        </div>
      </PromptPill>
    );
  }
  /** Botão de desfazer a ação (quando o motor permite) ou o motivo de não dar mais. */
  const cancel = onCancel ? (
    <button className="btn cancel" onClick={onCancel} title="Desfazer a ação e voltar ao estado anterior">
      Cancelar
    </button>
  ) : null;
  const hint = !onCancel && cancelHint ? <p className="muted small cancel-hint">{cancelHint}.</p> : null;

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
      const offBoard = shown ?? pending.options.filter((u) => OFF_TABLE.includes(zoneOf(state, u) ?? ''));
      const blocked = shown ? shown.filter((u) => !pending.options.includes(u)).length : 0;
      const confirm = (
        <div className="btn-row">
          {peekButton}
          {cancel}
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
                  ? offBoard.length
                    ? 'Toque numa carta para ler.'
                    : 'O oponente vê a mesma escolha, havendo carta para escolher ou não.'
                  : pending.ordered
                    ? 'Toque nas cartas na ordem desejada. Segure para ler.'
                    : pending.max === 1
                      ? 'Toque numa carta para marcá-la (tocar em outra troca a escolha) e confirme. Segure para ler.'
                      : 'Toque nas cartas para escolher. Segure para ler.'}
                {blocked > 0 && ' As cartas apagadas não podem ser escolhidas.'}
              </p>
              {options}
              {order}
              {confirm}
              {hint}
            </div>
          </div>
        );
      }
      // Alvos todos na mesa ou na mão: o pedido fica na faixa central (TargetRequest) e o botão de
      // confirmar no lugar de "Encerrar turno" (DecisionButton), como no Counter.
      if (offBoard.length === 0) return null;
      // Mistura de alvos na mesa e fora dela: o balão mostra as cartas de fora.
      return (
        <PromptPill title={pending.prompt} subtitle={`Toque nas cartas destacadas (${picked.length}/${pending.max}).`}>
          {options}
          {order}
          {confirm}
          {hint}
        </PromptPill>
      );
    }
    case 'block':
    case 'counter':
      // Blocker e Counter: o botão de concluir fica na faixa central (DecisionButton), junto do
      // confronto de poder e perto da mão; a dica de uso fica logo acima do leque.
      return null;
    case 'manual': {
      // Efeito ainda não automatizado (⚙): o jogo só avisa e segue sem aplicá-lo.
      const text = lang === 'pt' ? translateToPt(pending.text).text : pending.text;
      const name = cardDef(state, pending.source).name;
      return (
        <PromptPill title={`⚙ Efeito ainda não automático: ${name}`} subtitle={`${text} (Este efeito não é aplicado.)`} clamp>
          <div className="btn-row">
            {cancel}
            <button className="btn primary" onClick={() => onDispatch({ type: 'manualDone', player: human })}>
              Continuar
            </button>
          </div>
        </PromptPill>
      );
    }
    case 'lifeCard': {
      // Toda carta que sai da Vida passa por aqui, com ou sem [Trigger]: o oponente só vê que uma
      // carta da Vida está sendo olhada, e não pode saber qual dos dois casos é.
      const def = cardDef(state, pending.card);
      const trigger = def.abilities.some((a) => a.timing === 'trigger') ? cardText(def, lang).trigger : null;
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">{trigger ? '[Trigger] revelado da Vida' : 'Carta da Vida'}</div>
            <div className="modal-feature">
              <CardView state={state} uid={pending.card} />
            </div>
            <h3>{def.name}</h3>
            {trigger ? (
              <p className="effect trigger">{trigger}</p>
            ) : (
              <p className="muted small">Esta carta não tem [Trigger]. O oponente não sabe qual carta saiu da sua Vida.</p>
            )}
            <div className="btn-row center">
              {trigger && (
                <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                  Ativar [Trigger]
                </button>
              )}
              <button className={`btn big${trigger ? '' : ' primary'}`} onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                {trigger ? (
                  <>
                    Não ativar <small>(vai para a mão)</small>
                  </>
                ) : (
                  'Colocar na mão'
                )}
              </button>
            </div>
            {trigger && <div className="btn-row center">{peekButton}</div>}
          </div>
        </div>
      );
    }
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
                  {!pending.order && !pending.don && lang === 'pt' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label) ? translateToPt(label).text : label}
                </button>
              ))}
            </div>
            <div className="btn-row center">
              {peekButton}
              {cancel}
            </div>
            {hint}
          </div>
        </div>
      );
    case 'confirm':
      // Sem como pagar o custo a pergunta abre mesmo assim (para o oponente não deduzir a mão),
      // só com "Não usar".
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{pending.prompt}</h3>
            {pending.cannot && <p className="muted small">O oponente vê a mesma pergunta, dando para pagar ou não.</p>}
            <div className="btn-row center">
              {!pending.cannot && (
                <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                  {pending.drawUpTo ? 'Comprar 1 carta' : 'Pagar e usar'}
                </button>
              )}
              <button className={`btn big${pending.cannot ? ' primary' : ''}`} onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                {pending.drawUpTo ? 'Parar' : 'Não usar'}
              </button>
            </div>
            <div className="btn-row center">
              {peekButton}
              {cancel}
            </div>
            {hint}
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

// ------------------------------------------------------------------ zoom da carta

function CardZoom(props: {
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
  onAttachDons: (target: string, count: number) => void;
  onAttackMode: (attacker: string) => void;
}) {
  const { state, uid, legal } = props;
  const { lang } = useSettings();
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
  const isEvent = def.category === 'event';
  // Eventos: usar a carta (ou o Counter dela) é o texto dela, destacado sobre a carta.
  const eventPlay = isEvent ? play : undefined;
  const eventCounter = isEvent ? props.onCounter : undefined;
  const hasActions = Boolean((play && !eventPlay) || canAttack || attach || detach || (props.onCounter && !eventCounter));
  const counter = counterValue(state, uid);
  const eventText = isEvent ? cardText(def, lang).text : '';
  // Habilidades ativáveis viram painéis brilhantes (modelo Pokémon TCG Pocket): em tela larga ficam ao lado da
  // carta, ligados a ela pela borda ciano; em tela estreita, sobre a parte de baixo da carta. Com painel na tela, o
  // fundo escurece mais e as ações secundárias (DON!!) viram botões discretos para não competir.
  const hasPlates = activates.length > 0 || Boolean(eventPlay) || Boolean(eventCounter);
  const color = def.colors[0] ?? 'red';

  return (
    <div className={['modal-backdrop', 'zoom-backdrop', hasPlates ? 'dim' : ''].join(' ')} onClick={props.onClose}>
      <div className={['zoom', hasPlates ? 'with-plates' : ''].join(' ')} onClick={(e) => e.stopPropagation()}>
        <button className="zoom-close" onClick={props.onClose} aria-label="Fechar">
          ✕
        </button>
        <div className="zoom-card">
          <CardView state={state} uid={uid} fc={loc?.fc} />
        </div>
        {hasPlates && (
          <div className={['zoom-plates', `c-${color}`].join(' ')}>
            {eventCounter && (
              <button className="ability-plate counter" onClick={eventCounter}>
                <div className="plate-title">
                  <span className="plate-icon">🛡</span>
                  Usar evento [Counter]
                  {counter > 0 && <span className="plate-chip">+{counter}</span>}
                </div>
                <p className="plate-text">{eventText}</p>
                <span className="plate-tap">Toque para usar</span>
              </button>
            )}
            {eventPlay && (
              <button className="ability-plate" onClick={() => props.onDispatch(eventPlay)}>
                <div className="plate-title">
                  <span className="plate-icon">✦</span>
                  Usar evento
                  <span className="plate-chip">Custo {def.cost}</span>
                </div>
                <p className="plate-text">{eventText}</p>
                <span className="plate-tap">Toque para usar</span>
              </button>
            )}
            {activates.map((a) => {
              const ability = def.abilities[a.ability];
              return (
                <button key={a.ability} className="ability-plate" onClick={() => props.onDispatch(a)}>
                  <div className="plate-title">
                    <span className="plate-icon">✦</span>
                    {abilityTitle(ability, lang)}
                    {abilityCostLabel(ability).map((c) => (
                      <span key={c} className="plate-chip">
                        {c}
                      </span>
                    ))}
                    {ability.oncePerTurn && <span className="plate-chip soft">1× por turno</span>}
                  </div>
                  <p className="plate-text">{abilityText(def, a.ability, lang)}</p>
                  <span className="plate-tap">Toque para ativar</span>
                </button>
              );
            })}
          </div>
        )}
        {hasActions && (
          <div className="zoom-actions">
            {props.onCounter && !eventCounter && (
              <button className="btn primary big" onClick={props.onCounter}>
                🛡 Usar como Counter
                {counter > 0 && <span className="cost-chip">+{counter}</span>}
              </button>
            )}
            {/* O Counter vai para o atacado; dá também para dar o bônus a outra carta (acaba no fim da batalha). */}
            {props.onCounter && !eventCounter && Boolean(props.counterTargets?.length) && (
              <div className="counter-other">
                <small>ou dar a</small>
                {props.counterTargets!.map((t) => (
                  <button
                    key={t}
                    className="btn small quiet"
                    onClick={() => props.onCounterTo(t)}
                    title={`Dar o Counter a ${cardDef(state, t).name} (o bônus acaba no fim da batalha)`}
                  >
                    {cardDef(state, t).name} <small>({getPower(state, t)})</small>
                  </button>
                ))}
              </div>
            )}
            {play && !eventPlay && (
              <button className="btn primary big" onClick={() => props.onDispatch(play)}>
                Jogar <span className="cost-chip">{def.cost}</span>
              </button>
            )}
            {canAttack && (
              <button className="btn attack big" onClick={() => props.onAttackMode(uid)}>
                ⚔ Atacar <span className="cost-chip">{getPower(state, uid)}</span>
              </button>
            )}
            {attach && (
              <button
                className={hasPlates ? 'btn small quiet' : 'btn don big'}
                onClick={() => (props.donCount > 1 ? props.onAttachDons(uid, props.donCount) : props.onDispatch(attach))}
              >
                {props.donCount > 1 ? `Anexar ${props.donCount} DON!!` : '+ 1 DON!!'}{' '}
                <small>({state.players[owner].donActive} ativos)</small>
              </button>
            )}
            {detach && (
              <button
                className={hasPlates ? 'btn small quiet' : 'btn don big'}
                onClick={() => props.onDispatch(detach)}
                title="Devolve à área de custo 1 DON!! anexado neste turno e ainda não usado (até a carta atacar ou usar um efeito)"
              >
                − 1 DON!! <small>({loose === 1 ? '1 pode voltar' : `${loose} podem voltar`})</small>
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
