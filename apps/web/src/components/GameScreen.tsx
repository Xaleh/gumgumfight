import {
  type Action,
  actingPlayer,
  cancelAllowed,
  type CardData,
  type CardDef,
  cardDef,
  cardStatuses,
  counterTargets,
  counterValue,
  type GameConfig,
  type GameState,
  getCost,
  getPower,
  HIDDEN_CARD,
  legalActions,
  locate,
  type MsgList,
  type MsgParts,
  type Pending,
  type PlayerId,
  spoilerRule,
  translateToPt,
  zoneOf,
} from '@gumgum/engine';
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, currentSpoilerSet, isAdmin, type LiveRoom, modeLabel, type OnlineSeat, type RoomDecks, type WatchTarget, whyNotPlayable } from '../api';
import { useAuth } from '../auth';
import { abilityCostLabel, abilityText, abilityTitle } from '../game/abilityText';
import { describeReplayAction } from '../game/replayCue';
import { coachTip } from '../game/tutorial/coachTips';
import type { EmbedLayout } from '../embed';
import { useEmbedBridge } from '../game/useEmbedBridge';
import { buildSetup } from '../game/setup';
import { type GameSetup, useGame } from '../game/useGame';
import { audio } from '../audio';
import { type Translate, useT, useTryT } from '../i18n';
import { listText, logText, msgText } from '../game/engineText';
import { useMatchAudio } from '../game/useMatchAudio';
import { type OnlineGame, useOnlineGame } from '../game/useOnlineGame';
import { cardText, PLAYMATS, SettingsControls, useSettings } from '../settings';
import { Board, HandFan, handIsKnown } from './Board';
import { LateralBoard } from './LateralBoard';
import { CardHoverPreview, CardTextInfo, StaticCardZoom } from './CardInfo';
import { CardView, type Highlight, StaticCard } from './CardView';
import { DeckConfirm } from './DeckConfirm';
import { DiceRoll } from './DiceRoll';
import { ErrorBoundary } from './ErrorBoundary';
import { GameResult } from './GameResult';
import { Icon } from './Icons';
import { useBoardMotion } from './Motion';
import { ReplayBar, type ReplayControls } from './ReplayBar';
import { PlayHighlight } from './PlayHighlight';
import { ReplayCue } from './ReplayCue';
import { ReportModal } from './ReportModal';
import { DeckListPanel, DeckPanel, MatchesPanel } from './StreamerPanel';

/** Decklist de um jogador no fim da partida: desenhada em canvas, fora do bundle principal (junto com o kit de divulgação). */
const MatchDeck = lazy(() => import('./MatchDeck'));
import {
  BroadcastIdle,
  BroadcastTag,
  ChatBar,
  ChatBubbles,
  HandsSharedTag,
  OnlineBanner,
  OnlineClock,
  OnlineResultInfo,
  OnlineStatus,
  OnlineWaiting,
  SpectatorBar,
  SpectatorCount,
  seriesAfter,
} from './Online';
import { CallJudgeSheet, JudgePanel, PauseBanner } from './Judge';

/**
 * Linhas do histórico que viram aviso na mesa (ver `notice` em GameScreen): pela chave do motor
 * (`LogEntry.key`); linhas sem chave (estados salvos antes das chaves) pelo texto em português.
 */
const NOTICE_KEYS = new Set([
  'log.conditionFails',
  'log.lapsedCondition',
  'log.lapsedConditionTagged',
  'log.onKoConditionFails',
  'log.cannotBlockCannotRest',
  'log.cannotBlock',
  'log.cannotBeRestedActive',
  'log.cannotBeRestedByOpponent',
  'log.retarget',
]);
const NOTICE_RE = /a condição não vale|não pode bloquear|não pode ser virada|não pode ativar \[Blocker\]|o ataque passa a mirar/;
const isNotice = (e: { key?: string; text: string }) => (e.key ? NOTICE_KEYS.has(e.key) : NOTICE_RE.test(e.text));

/**
 * Modo 'don': DON!! ativos marcados para anexar de uma vez (modelo do OPTCG Sim). `picked` guarda a posição dos
 * DON!! marcados na fileira: tocar no 3º marca os 3 primeiros. O Líder e os Personagens que podem receber DON!!
 * ficam destacados e o toque num deles anexa todos os marcados; a faixa central mostra quantos são.
 */
type Mode = null | { kind: 'attack'; attacker: string } | { kind: 'don'; picked: number[] };
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
/** Painel lateral no desktop: do Streamer (histórico, partidas, decklists) ou de quem joga (histórico, a própria decklist). */
type Panel = null | 'log' | 'matches' | 'deck';

type TryT = ReturnType<typeof useTryT>;
/** Campos que o motor passa a mandar junto das perguntas e das habilidades: a chave do texto no dicionário e os parâmetros. */
interface Keyed {
  promptKey?: string;
  promptParams?: Record<string, string | number>;
  promptParts?: MsgParts;
}
interface KeyedOptions {
  optionKeys?: (string | null)[];
  optionParts?: (MsgList | null)[];
}
interface KeyedLabel {
  labelKey?: string;
  labelParams?: Record<string, string | number>;
}

/**
 * Texto de uma pergunta do motor no idioma da interface: a tradução da chave (`promptKey`), quando o motor
 * a manda e o dicionário a conhece; senão o texto que veio junto (`prompt`).
 */
function promptText(tryT: TryT, pending: { prompt: string }): string {
  const p = pending as typeof pending & Keyed & { cannot?: true };
  const text = msgText(tryT, p.promptKey, p.promptParams, p.promptParts);
  if (text === undefined) return p.prompt;
  // `confirm` com `cannot`: o motor junta "(Não dá para pagar o custo.)" ao texto, mas não à chave.
  return p.cannot ? `${text} ${tryT('engine.cannotPayCost') ?? ''}`.trim() : text;
}

/** Ordem marcada numa escolha ordenada: "1. Carta → 2. Carta". */
function orderText(t: Translate, state: GameState, picked: string[]): string {
  return picked.map((u, i) => t('game.orderItem', { n: i + 1, name: cardDef(state, u).name })).join(' → ');
}

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
export interface TableGame {
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
  /** Replay: posição no roteiro, para avançar, voltar e pular. */
  replay?: ReplayControls;
  /** Replay: a última mudança foi um pulo (sem animação). */
  jumped?: boolean;
}

type TableKind = GameSetup['mode'] | 'online';

/** Replay embutido num app parceiro (`/replay/<id>`, ver `embed.ts`). */
export interface TableEmbed {
  /** embed=1: sem o menu da mesa nem os botões de sair e de baixar o replay. */
  bare: boolean;
  /** Telas largas: a mesa em pé (tablet) ou lateral, como na visão do Streamer. */
  layout?: EmbedLayout;
  /** Origens que podem mandar comandos por postMessage (as do servidor). */
  origins: string[];
}

/** Partida no navegador: contra o bot ou replay. */
export function GameScreen({
  setup,
  onExit,
  onRematch,
  embed,
}: {
  setup: GameSetup;
  onExit: () => void;
  /** Joga de novo (com `next`: outra partida montada aqui, com o deck trocado na confirmação). */
  onRematch?: (next?: GameSetup) => void;
  embed?: TableEmbed;
}) {
  const t = useT();
  const game = useGame(setup);
  const { confirmDeck } = useSettings();
  const [confirming, setConfirming] = useState(false);
  useEmbedBridge(game, embed ? embed.origins : null);
  // Registra o resultado no servidor (que refaz a partida a partir das ações). Replays não contam de novo.
  const saved = useRef(false);
  // Partida gravada no servidor: o relato de bug aponta para ela (e para o replay dela).
  const [matchId, setMatchId] = useState<number | null>(null);
  useEffect(() => {
    if (game.state.phase !== 'gameover' || saved.current || setup.mode === 'replay') return;
    saved.current = true;
    void api
      .saveMatch({
      mode: setup.mode,
      format: setup.format,
      ...(setup.spoilers ? { spoilers: true } : {}),
      seed: setup.config.seed,
      firstPlayer: setup.config.firstPlayer,
      chooseFirst: setup.config.chooseFirst,
      deckIds: setup.deckIds,
      decks: [setup.config.players[0].deck, setup.config.players[1].deck],
      actions: game.actions(),
      })
      .then((r) => r && setMatchId(r.id));
  }, [game.state, setup, game.actions]);
  const human = game.human;
  const ownDeck = useCallback(() => Promise.resolve(localDeck(setup.config, human ?? 0)), [setup.config, human]);
  // Revanche contra o bot: com o deck trocado na confirmação, monta a partida de novo (mesmo oponente e mesmas regras).
  const rematchWith = async (deckId: string) => {
    setConfirming(false);
    if (deckId === setup.deckIds[0]) return onRematch?.();
    try {
      const { players, firstPlayer, chooseFirst } = setup.config;
      const seed = Math.floor(Math.random() * 1_000_000);
      const names: [string, string] = [players[0].name, players[1].name];
      const next = await buildSetup('bot', [deckId, setup.deckIds[1]], names, seed, setup.format, firstPlayer, undefined, undefined, chooseFirst);
      onRematch?.({ ...next, spoilers: setup.spoilers, botLevel: setup.botLevel });
    } catch (e) {
      game.setError(e instanceof Error ? e.message : String(e));
    }
  };
  const rules = { format: setup.format, spoilers: Boolean(setup.spoilers) };
  return (
    <>
      <GameTable
        game={{ ...game, downloadReplay: () => downloadReplay(game.exportReplay()) }}
        kind={setup.mode}
        matchId={matchId}
        ownDeck={human !== null ? ownDeck : undefined}
        onExit={onExit}
        onRematch={onRematch && (setup.mode === 'bot' && confirmDeck ? () => setConfirming(true) : () => onRematch())}
        startNotice={setup.notice}
        embed={embed}
      />
      {confirming && (
        <DeckConfirm
          kicker={`${t('deckConfirm.rematch')} · ${modeLabel(rules)}`}
          deckId={setup.deckIds[0]}
          whyFor={(d) => whyNotPlayable(d, rules.format, spoilerRule(rules))}
          confirmLabel={t('result.rematch')}
          opponent={{ deckId: setup.deckIds[1], label: setup.config.players[1].deck.name ?? '' }}
          onConfirm={(id) => void rematchWith(id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

/** O deck de quem joga no navegador, do jeito do painel de decklist (as cartas já vêm na configuração). */
function localDeck(config: GameConfig, player: PlayerId): RoomDecks {
  const { name, isBot, deck } = config.players[player];
  const ids = new Set([deck.leader, ...deck.cards.map((c) => c.id)]);
  const { id: _id, ...list } = deck;
  return { players: [{ name, bot: Boolean(isBot), deck: list }], cards: config.cards.filter((c) => ids.has(c.id)) };
}

const noop = () => undefined;

/** Partida online: a mesa recebe só a visão deste jogador, vinda do servidor. */
export function OnlineGameScreen({ seat, onExit, onSwitch }: { seat: OnlineSeat; onExit: () => void; onSwitch: (s: OnlineSeat) => void }) {
  const t = useT();
  const online = useOnlineGame(seat);
  const { state, room } = online;
  const [nextError, setNextError] = useState<string | null>(null);
  const { confirmDeck } = useSettings();
  /** Revanche esperando a confirmação do deck: o deck salvo desta partida. */
  const [rematchDeck, setRematchDeck] = useState<string | null>(null);
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
  const roomRules = { format: room.format, spoilers: room.spoilers !== false };
  // Sala privada: confirma o deck antes de pedir a revanche (o pedido já feito não pergunta de novo).
  const askRematch = async () => {
    if (!confirmDeck || room.you === null || room.rematch[room.you]) return online.askRematch();
    const mine = await online.loadMyDeck().catch(() => null);
    if (mine?.deckId) setRematchDeck(mine.deckId);
    else await online.askRematch();
  };
  return (
    <>
      <GameTable
        game={{ ...game, error: game.error ?? nextError, setError: (e) => (setNextError(null), game.setError(e)) }}
        kind="online"
        online={online}
        onExit={onExit}
        onRematch={room.queue === 'private' ? () => void askRematch() : nextGame}
        rematchLabel={nextGame ? t('game.playGameN', { n: room.tournament!.game + 1 }) : undefined}
      />
      {rematchDeck && (
        <DeckConfirm
          kicker={`${t('deckConfirm.rematch')} · ${modeLabel(room)}`}
          deckId={rematchDeck}
          whyFor={(d) => whyNotPlayable(d, room.format, spoilerRule(roomRules), room.spoilerSet ?? currentSpoilerSet())}
          confirmLabel={t('game.askRematch')}
          onConfirm={(id) => {
            setRematchDeck(null);
            void online.askRematch(id === rematchDeck ? undefined : id);
          }}
          onCancel={() => setRematchDeck(null)}
        />
      )}
    </>
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
 * as duas mãos para streamer e admin, na mesa atrasada). Ninguém age; na revanche, segue
 * para a sala nova. `broadcast`: tela de transmissão (fonte do OBS), sem menus nem botões.
 */
export function WatchGameScreen({
  target,
  canHands,
  broadcast,
  onExit,
  onSwitch,
  exitTo,
}: {
  target: WatchTarget;
  canHands: boolean;
  broadcast?: TableBroadcast;
  onExit: () => void;
  /** Para onde "Sair" leva (o texto do botão); padrão: o torneio da sala, ou o menu. */
  exitTo?: ExitTo;
  onSwitch: (t: WatchTarget) => void;
}) {
  const t = useT();
  const online = useOnlineGame(target);
  const { state, room } = online;
  const userId = useAuth().user?.id;
  // Mesa de torneio aberta sem o papel de Judge (pela lista "Ao vivo", por exemplo): quem é Judge ou
  // organizador do torneio ganha o botão "Entrar como Judge" (o painel, as jogadas e o modo manual).
  const tourId = room?.tournament?.id ?? null;
  const [judgeOf, setJudgeOf] = useState<string | null>(null);
  useEffect(() => {
    if (!tourId || target.judge || !userId || broadcast) return;
    let live = true;
    api.tournaments
      .get(tourId)
      .then((d) => live && d.isJudge && setJudgeOf(tourId))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tourId, target.judge, userId, broadcast]);
  useEffect(() => {
    if (online.rematch) onSwitch({ ...target, roomId: online.rematch.roomId });
  }, [online.rematch, onSwitch, target]);
  // "Ver mãos" recusado pelo servidor: continua assistindo sem as mãos (o motivo aparece no aviso).
  useEffect(() => {
    if (online.handsRefused && target.hands) onSwitch({ ...target, hands: false });
  }, [online.handsRefused, onSwitch, target]);
  if ((!state || !room) && broadcast) {
    return online.conn === 'gone' ? <BroadcastIdle title={t('broadcast.matchOver')} text={t('broadcast.waitingHint')} /> : <BroadcastIdle title={t('common.loading')} />;
  }
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
      exitTo={exitTo}
      // As mãos dos jogadores só aparecem no torneio e nas salas privadas liberadas por quem criou; o Judge já as vê ao vivo.
      spectator={{
        canHands: canHands && Boolean(room.handsAllowed) && !target.judge,
        onToggleHands: () => onSwitch({ ...target, hands: !target.hands }),
        judge: Boolean(target.judge),
        ...(judgeOf && judgeOf === tourId && !target.judge ? { onJudge: () => onSwitch({ roomId: room.id, hands: false, judge: true }) } : {}),
        roomId: room.id,
        // Painel "Partidas": troca de sala mantendo "Ver mãos" onde ele vale (a mesma regra da tela "Assistir").
        onSwitchRoom: (r) => onSwitch({ roomId: r.id, hands: target.hands && canHands && !r.mine && Boolean(r.handsAllowed) }),
      }}
      broadcast={broadcast}
    />
  );
}

/** Tela de transmissão: `chat` = as mensagens e emotes dos jogadores aparecem na live. */
export interface TableBroadcast {
  chat: boolean;
}

/** A mesa, protegida: um erro ao desenhar não apaga a página (o jogo continua por fora). */
function GameTable(props: Parameters<typeof Table>[0]) {
  const t = useT();
  return (
    <ErrorBoundary title={t('game.crashed')} onExit={props.onExit}>
      <Table {...props} />
    </ErrorBoundary>
  );
}

/** Lição do tutorial: a mesa com o treinador (painel ao lado no desktop, balão no celular). */
export function LessonTable({ game, onExit, tutorial }: { game: TableGame; onExit: () => void; tutorial: TableTutorial }) {
  return <GameTable game={game} kind="bot" onExit={onExit} tutorial={tutorial} />;
}

/** O que a lição do tutorial pede da mesa. */
export interface TableTutorial {
  /** O treinador (texto do passo e botões). */
  coach: ReactNode;
  /** Destaques na mesa (desenhados por cima, ver `Spotlight`). */
  overlay?: ReactNode;
  /** Esconde as perguntas do motor (mulligan, alvos...) enquanto o passo é só de leitura. */
  hidePrompt?: boolean;
  /** Celular: o treinador flutua em cima ou embaixo (longe das áreas destacadas). */
  floatAt?: 'top' | 'bottom';
}

/** Para onde o botão de sair da mesa leva: o torneio, o menu ou a tela anterior (ex.: a lista "Assistir"). */
type ExitTo = 'tournament' | 'menu' | 'back';

function Table({
  game,
  kind,
  online,
  onExit,
  exitTo: exitToProp,
  onRematch,
  rematchLabel,
  spectator,
  broadcast,
  startNotice,
  tutorial,
  matchId,
  embed,
  ownDeck,
}: {
  game: TableGame;
  kind: TableKind;
  online?: OnlineGame;
  onExit: () => void;
  exitTo?: ExitTo;
  onRematch?: () => void;
  /** Texto do botão de revanche (ex.: próximo jogo da série do torneio). */
  rematchLabel?: string;
  /**
   * Modo espectador (partida online vista de fora). `judge`: entrou como Judge do torneio (painel de Judge).
   * `roomId`/`onSwitchRoom`: os painéis de decklist e de partidas de quem transmite.
   */
  spectator?: {
    canHands: boolean;
    onToggleHands: () => void;
    judge?: boolean;
    /** Quem é Judge/organizador do torneio e assiste sem o papel: entra como Judge. */
    onJudge?: () => void;
    roomId?: string;
    onSwitchRoom?: (room: LiveRoom) => void;
  };
  /** Tela de transmissão (fonte do OBS): sem menus nem botões, com o destaque da carta jogada. */
  broadcast?: TableBroadcast;
  /** Aviso na mesa ao começar (some sozinho em 10 s). */
  startNotice?: string;
  /** Lição do tutorial: treinador, destaques e menos controles (sem Auto, desfazer, replay). */
  tutorial?: TableTutorial;
  /** Partida contra o bot já gravada no servidor (o relato de bug aponta para ela; online vem da sala). */
  matchId?: number | null;
  /** Replay embutido num app parceiro. */
  embed?: TableEmbed;
  /** Partida no navegador: o deck de quem joga, para o painel de decklist (online vem da sala). */
  ownDeck?: () => Promise<RoomDecks>;
}) {
  const { state, dispatch, human } = game;
  const t = useT();
  const tryT = useTryT();
  /**
   * Aviso curto na mesa para as linhas do histórico que explicam por que algo não aconteceu
   * (condição de efeito que não vale, [Blocker] que não pode bloquear, carta que não pode ser
   * virada). No celular o histórico fica atrás de um botão, e sem o aviso parece que o jogo ignorou a jogada.
   */
  const [notice, setNotice] = useState<string | null>(startNotice ?? null);
  useEffect(() => {
    if (!startNotice) return;
    const t = setTimeout(() => setNotice((n) => (n === startNotice ? null : n)), 10_000);
    return () => clearTimeout(t);
  }, [startNotice]);
  const noticeSeen = useRef(state.log.length);
  useEffect(() => {
    // Replay: num pulo, as linhas puladas não viram aviso.
    if (game.jumped) {
      noticeSeen.current = state.log.length;
      return;
    }
    if (noticeSeen.current > state.log.length) noticeSeen.current = 0; // desfazer / replay
    const fresh = state.log.slice(noticeSeen.current);
    noticeSeen.current = state.log.length;
    const hit = [...fresh].reverse().find(isNotice);
    if (!hit) return;
    setNotice(logText(tryT, hit));
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [state.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Cartas que o oponente revelou (busca no deck, carta da mão, topo do deck…): aparecem na mesa até o
   * jogador fechar. Sem isso só o histórico dizia qual carta foi, e a carta some na mão do oponente.
   * O [Trigger] do oponente também aparece aqui quando as animações estão desligadas.
   * Não aparece para quem escolheu a carta (já a viu), no tutorial, no replay nem na tela de transmissão
   * (ninguém fecha). Para quem assiste (o streamer) aparecem as revelações dos dois lados, e somem
   * sozinhas depois de um tempo.
   */
  const [reveals, setReveals] = useState<RevealLine[]>([]);
  const revealSeen = useRef(state.log.length);
  useEffect(() => {
    if (revealSeen.current > state.log.length) {
      revealSeen.current = state.log.length; // desfazer / replay: nada de avisos antigos
      setReveals([]);
      return;
    }
    const fresh = state.log.slice(revealSeen.current);
    revealSeen.current = state.log.length;
    if (game.jumped || tutorial || broadcast || (human === null && !spectator)) return;
    const lines = fresh.flatMap((e): RevealLine[] => {
      if (!e.revealed?.length || e.revealedBy === human) return [];
      // [Trigger] do oponente: com as animações ligadas a carta já aparece no centro da mesa.
      if (e.key === 'log.triggerActivated' && animate) return [];
      const cards = e.revealed.map((id) => state.defs[id]).filter((d): d is CardDef => Boolean(d));
      return cards.length ? [{ text: logText(tryT, e), cards, count: 1 }] : [];
    });
    if (lines.length) setReveals((r) => mergeReveals(r, lines));
  }, [state.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Quem assiste não precisa clicar: o aviso some sozinho (o streamer pode fechar antes).
  useEffect(() => {
    if (!spectator || reveals.length === 0) return;
    const timer = setTimeout(() => setReveals([]), 12_000);
    return () => clearTimeout(timer);
  }, [spectator, reveals]);
  const isOnline = kind === 'online';
  const watching = Boolean(spectator);
  // Partida de torneio: "voltar" leva para a página do torneio.
  const exitTo: ExitTo = exitToProp ?? (online?.room?.tournament ? 'tournament' : 'menu');
  const toTournament = exitTo === 'tournament';
  /** "Chamar o Judge" (jogador numa partida de torneio em andamento, ainda não pausada): congela a partida até o Judge liberar. */
  // A janela do chamado: o motivo, a jogada do problema e um texto (o Judge já entra sabendo o que conferir).
  const [calling, setCalling] = useState(false);
  const callJudge =
    online && !watching && online.room?.tournament && online.room.status === 'playing' && !online.room.pause
      ? () => {
          setCalling(true);
          setSheet(null);
        }
      : undefined;
  const wide = useMediaQuery('(min-width: 1000px)');
  /**
   * Visão do Streamer (quem assiste, no desktop): a mesa em pé como num tablet, a Vida grande na
   * lateral, o histórico junto do menu e as mãos minimizadas, abertas só ao clicar (sem o olho).
   */
  // O replay embutido com `layout=` usa a mesma visão (em pé ou lateral, conforme o link).
  const streamer = (watching || Boolean(embed?.layout)) && !broadcast && wide;
  const { quickCounter, donQuickPick, animations, replayCues, coachTips, locale, streamerLayout, streamerPlaymat, sidePanel, update: updateSettings } = useSettings();
  /** Visão do Streamer: a mesa lateral (jogadores à esquerda e à direita, vista de cima) é o padrão; o menu troca para a mesa em pé. */
  const lateral = streamer && (embed?.layout ? embed.layout === 'lateral' : streamerLayout === 'lateral');
  /** Visão do Streamer: as mãos minimizadas abrem ao clicar quando são conhecidas (no replay, as duas). */
  const canOpenHands = Boolean(online?.hands || spectator?.canHands || kind === 'replay');
  const bare = Boolean(embed?.bare);
  // Só a opção do app decide: muitos celulares ligam "reduzir movimento" sozinhos
  // (economia de bateria) e as animações e os dados sumiriam sem o jogador saber por quê.
  const animate = animations;
  // Cartas voando entre as zonas (mais rápidas com o bot acelerado).
  const allActions = game.actions();
  // Replay: os pulos (voltar, ir para uma ação) e a velocidade máxima mudam a mesa sem animação.
  const replay = game.replay;
  const motion = useBoardMotion(state, {
    enabled: animate && !game.jumped && !(replay && game.speed >= 8),
    tempo: Math.min(1.3, Math.max(0.35, 1 / game.speed)),
    lastAction: allActions[allActions.length - 1],
    lang: locale,
  });
  // Sons da mesa e música da partida (os mesmos pontos que as animações; valem sem elas também).
  useMatchAudio(state, {
    enabled: !game.jumped && !(replay && game.speed >= 8),
    animate: animate && !game.jumped,
    tempo: Math.min(1.3, Math.max(0.35, 1 / game.speed)),
    human,
    lastAction: allActions[allActions.length - 1],
  });
  // Replay: o clique/seleção do jogador na próxima ação do roteiro (na mesa e na barra), para quem assiste
  // ou audita ver a decisão antes do resultado. Em 8× a mesa já muda sem animação: só a barra mostra.
  // A opção "Cliques no replay" (configurações ou o botão na barra) desliga tudo.
  const nextAction = replayCues ? replay?.next : undefined;
  const cue = useMemo(() => (nextAction ? describeReplayAction(state, nextAction, locale) : null), [state, nextAction, locale]);
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
  /**
   * Quem joga, no desktop: o painel lateral com o histórico e a própria decklist, que dá para esconder
   * para jogar com a mesa na tela toda (a escolha vale para as próximas partidas).
   */
  const playerPanel = wide && !tutorial && !broadcast && !streamer;
  /** O deck de quem joga, para a decklist do painel: online vem da sala (pelo token); no navegador, da configuração. */
  const loadOwnDeck = human === null || tutorial ? undefined : online ? (watching ? undefined : online.loadMyDeck) : ownDeck;
  /**
   * O painel lateral à direita, que encolhe a mesa: na visão do Streamer, histórico, partidas em transmissão
   * ou decklist (começa fechado); para quem joga, histórico ou a própria decklist.
   */
  const [panel, setPanelState] = useState<Panel>(() => (streamer || !sidePanel ? null : 'log'));
  const setPanel = (p: Panel) => {
    setPanelState(p);
    if (playerPanel) updateSettings({ sidePanel: p !== null });
  };
  /** O painel na tela agora (no celular não há painel: o histórico abre numa folha). */
  const shownPanel = streamer || playerPanel ? panel : null;
  const openPanel = (p: Panel) => {
    setPanel(p);
    setSheet(null);
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  /**
   * Visão do Streamer: as mãos abertas no leque (as duas podem ficar abertas ao mesmo tempo) e as que
   * estão virando de volta antes de sumir.
   */
  const [openHands, setOpenHands] = useState<PlayerId[]>([]);
  const [closingHands, setClosingHands] = useState<PlayerId[]>([]);
  const openHandsRef = useRef(openHands);
  openHandsRef.current = openHands;
  const closeTimers = useRef<Partial<Record<PlayerId, ReturnType<typeof setTimeout>>>>({});
  const closeHand = useCallback((p: PlayerId) => {
    setOpenHands((o) => o.filter((x) => x !== p));
    setClosingHands((c) => (c.includes(p) ? c : [...c, p]));
    clearTimeout(closeTimers.current[p]);
    closeTimers.current[p] = setTimeout(() => setClosingHands((c) => c.filter((x) => x !== p)), 480);
  }, []);
  const closeHands = useCallback(() => openHandsRef.current.forEach(closeHand), [closeHand]);
  useEffect(() => () => Object.values(closeTimers.current).forEach(clearTimeout), []);
  // Espectador: as mãos que o servidor manda escondidas aparecem viradas para baixo.
  const [showBotHand, setShowBotHand] = useState(kind === 'replay' || watching);
  const [banner, setBanner] = useState<{ text: string; kicker: string; mine: boolean; key: number } | null>(null);
  const [showResult, setShowResult] = useState(false);
  // Relato de bug: só para quem jogou (não no replay, no tutorial nem para quem assiste) e com a partida gravada no servidor.
  const [reporting, setReporting] = useState(false);
  /** Decklist aberta no resumo do fim (o jogador cujo deck aparece). */
  const [deckOf, setDeckOf] = useState<PlayerId | null>(null);
  const recorded = isOnline ? (online?.room?.result?.matchId ?? null) : (matchId ?? null);
  const reportMatch = human !== null && !watching && !tutorial && !broadcast && kind !== 'replay' ? recorded : null;
  const reportCards = useMemo(
    () =>
      Object.values(state.defs)
        .map((d) => ({ id: d.id, name: d.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.defs],
  );
  /** Carta citada no histórico, ampliada (toque/clique no nome). */
  const [logCard, setLogCard] = useState<CardDef | null>(null);
  /** Carta da decklist (painel de quem transmite), ampliada por cima da mesa. */
  const [deckCard, setDeckCard] = useState<CardData | null>(null);
  /**
   * Linhas do histórico já vistas: o botão de histórico do celular mostra quantas chegaram desde a última
   * vez que o painel foi aberto (no desktop o histórico fica sempre à vista no painel lateral).
   */
  const [logSeen, setLogSeen] = useState(state.log.length);
  useEffect(() => {
    if (sheet === 'log' || shownPanel === 'log' || logSeen > state.log.length) setLogSeen(state.log.length); // desfazer / replay encolhem o log
  }, [sheet, shownPanel, state.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const logNew = sheet === 'log' || shownPanel === 'log' ? 0 : Math.max(0, state.log.length - logSeen);
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
  // Espectador com a visão de um jogador (o streamer que transmite a própria partida): a mão dele embaixo.
  const bottom: PlayerId = human ?? online?.room?.pov ?? 0;
  const { user } = useAuth();
  /** Streamer e Admin mandam a partida aberta para a tela de transmissão (menu da partida). */
  const canBroadcast = Boolean(online?.room && !broadcast && !tutorial && user && (user.role === 'streamer' || isAdmin(user.role)));
  const sendToBroadcast = () =>
    api.broadcast.choose(online!.room!.id).then(
      () => {
        const msg = t('broadcast.sent');
        setSheet(null);
        setNotice(msg);
        setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
      },
      (e: unknown) => game.setError(e instanceof Error ? e.message : String(e)),
    );

  /**
   * Visão do Streamer: clique na mão minimizada de um jogador abre o leque dela (a do outro continua
   * como está, para ver as duas juntas); outro clique na mesma mão fecha o leque.
   * Se o servidor ainda não manda as mãos, o mesmo clique liga "Ver mãos" (a mesa passa a ser a
   * atrasada) e o leque abre quando as cartas chegarem.
   */
  const toggleHand = (p: PlayerId) => {
    if (openHands.includes(p)) return closeHand(p);
    clearTimeout(closeTimers.current[p]);
    setClosingHands((c) => c.filter((x) => x !== p));
    setOpenHands((o) => [...o, p]);
    if (online && !online.hands && spectator?.canHands) spectator.onToggleHands();
  };
  // "Ver mãos" desligado no canto: os leques abertos viram de volta e somem.
  const hadHands = useRef(Boolean(online?.hands));
  useEffect(() => {
    const has = Boolean(online?.hands);
    if (hadHands.current && !has) closeHands();
    hadHands.current = has;
  }, [online?.hands, closeHands]);
  /** Os leques na tela: os abertos e os que estão virando de volta. */
  const fanPlayers = ([0, 1] as PlayerId[]).filter((p) => openHands.includes(p) || closingHands.includes(p));

  // As mãos ficam viradas até o vencedor do sorteio escolher quem começa: ver a mão pesaria na escolha.
  const handsSecret = state.pending?.kind === 'chooseFirst';
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
    // Replay: num pulo, a faixa do turno anterior some e a do novo não aparece.
    if (game.jumped) {
      setBanner(null);
      return;
    }
    const p = state.activePlayer;
    const mine = human === null ? p === 0 : p === human;
    const name = state.players[p].name;
    const you = human !== null && p === human;
    const text = you ? t('game.yourTurn') : t('game.turnOf', { name });
    const kicker = state.turn === 1 ? (you ? t('game.youPlayFirst') : t('game.playsFirst', { name })) : t('game.turnN', { n: state.turn });
    setBanner({ text, kicker, mine, key: state.turn });
    const timer = setTimeout(() => setBanner(null), 1100);
    return () => clearTimeout(timer);
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
      ? t('game.cancelRevealed')
      : null;
  const cancelAction = () => {
    dispatch({ type: 'cancel', player: human! });
    setPicked([]);
    setZoom(null);
  };
  /** Habilidade paga que já terminou e ainda pode ser desfeita (clicou para pagar sem querer): a carta dela. */
  const undoAction = canCancel && !tutorial && state.cancel?.done ? state.cancel.action : null;
  const undoUid = undoAction?.type === 'activate' || undoAction?.type === 'playCard' ? undoAction.uid : null;
  const undoName = undoUid && state.cards[undoUid] ? cardDef(state, undoUid).name : null;
  const targetsInHand = targets ? targets.options.filter((u) => zoneOf(state, u) === 'hand').length : 0;
  /** Onde estão os alvos destacados (mão, mesa ou os dois), com ou sem ordem: uma frase inteira para cada caso. */
  const targetsHint = () => {
    const where = targetsInHand === targets!.options.length ? 'Hand' : targetsInHand > 0 ? 'BoardOrHand' : 'Board';
    const ordered = targets!.ordered ? 'Ordered' : '';
    return t(`game.hintTargets${where}${ordered}` as const);
  };
  const handHint =
    defense?.kind === 'block'
      ? t('game.hintBlock')
      : defense?.kind === 'counter'
        ? !defense.options.length
          ? t('game.hintCounterNone')
          : quickCounter
            ? t('game.hintCounterQuick')
            : t('game.hintCounterConfirm')
        : targets
          ? targets.max === 0
            ? t('game.hintTargetsRead')
            : targetsHint()
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
      if (myPending.kind === 'counter' && picked.includes(uid)) return 'selected';
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
    // DON!! marcados: quem pode recebê-los brilha; o resto da mesa segue com os destaques normais.
    if (mode?.kind === 'don' && canReceiveDon(uid)) return 'option';
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
        // "Counter sem confirmação" usa na hora. Sem ela, os Counters de Personagem (só o valor) são
        // marcados e vão todos de uma vez no botão de decisão; o Evento [Counter], com custo e efeito
        // próprios, abre a carta com o botão de usar.
        if (quickCounter) useCounter(uid);
        else if (cardDef(state, uid).category !== 'event') setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]));
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
    // DON!! marcados: o toque no Líder ou num Personagem anexa todos; fora deles, a carta abre como sempre.
    if (mode?.kind === 'don' && canReceiveDon(uid)) {
      attachDons(uid, mode.picked.length);
      setMode(null);
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

  /** A carta (Líder ou Personagem) pode receber DON!! agora? */
  const canReceiveDon = (uid: string) => has((a) => a.type === 'attachDon' && a.target === uid);

  /**
   * Toque num DON!! ativo: marca ou desmarca só ele (o padrão). Com "DON!! em um toque" (`donQuickPick`), marca ele
   * e os anteriores da fileira (tocar no 3º marca 3), e tocar no último marcado desmarca só ele.
   */
  const onDon = (player: PlayerId, index: number) => {
    if (player !== human || !myTurnIdle || !has((a) => a.type === 'attachDon')) return;
    const max = state.players[human].donActive;
    if (index < 0 || index >= max) return;
    const marked = mode?.kind === 'don' ? mode.picked : [];
    const cur = marked.length;
    let picked: number[];
    if (donQuickPick) {
      const count = index === cur - 1 ? index : index + 1;
      picked = Array.from({ length: count }, (_, i) => i);
    } else picked = marked.includes(index) ? marked.filter((i) => i !== index) : [...marked, index].sort((a, b) => a - b);
    // Marcar sobe um pouco o tom (uma ficha a mais na pilha); desmarcar desce.
    audio.play('don-pick', { pitch: picked.length < cur ? -3 : Math.min(6, picked.length - 1) });
    setMode(picked.length > 0 ? { kind: 'don', picked } : null);
  };

  /** DON!! marcados (na faixa central): quantos são e onde tocar. */
  const donBar = mode?.kind === 'don' && human !== null ? <DonBar count={mode.picked.length} onCancel={() => setMode(null)} /> : null;
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

  const corner = broadcast && online ? (
    <BroadcastTag online={online} />
  ) : (
    <>
      <div className="corner-row">
        {!bare && (
          <button className="round-btn" onClick={() => setSheet('menu')} aria-label={t('game.menuLabel')}>
            <span className="burger" />
          </button>
        )}
        {/* Desktop (Streamer e quem joga): o histórico abre e fecha o painel lateral, a partir do botão ao lado do menu. */}
        {(streamer || playerPanel) && (
          <button
            className={['round-btn', 'log-btn', panel === 'log' ? 'on' : ''].join(' ')}
            onClick={() => setPanel(panel === 'log' ? null : 'log')}
            aria-label={t('game.logLabel')}
            aria-pressed={panel === 'log'}
            title={t('game.log')}
          >
            <Icon name="history" size={20} />
            {logNew > 0 && <span className="corner-badge">{logNew > 99 ? '99+' : logNew}</span>}
          </button>
        )}
      </div>
      {spectator && online && <SpectatorBar online={online} canHands={spectator.canHands} onToggleHands={spectator.onToggleHands} onJudge={spectator.onJudge} />}
      {online && !watching && <SpectatorCount online={online} />}
      {online && !watching && <HandsSharedTag online={online} />}
      {human !== null && !isOnline && !tutorial && (
        <button
          className={['auto-toggle', game.auto ? 'on' : ''].join(' ')}
          onClick={() => game.setAuto((a) => !a)}
          title={t('game.autoTitle')}
        >
          <span className="knob" />
          {t('game.auto')}
        </button>
      )}
    </>
  );

  // Histórico e chat ficam ao lado do seu deck e lixo, perto de onde o olho repousa.
  const sideTools =
    !broadcast && (!wide || (online && !watching)) ? (
      <>
        {!wide && (
          <button className="round-btn log-btn" onClick={() => setSheet('log')} aria-label={t('game.logLabel')} title={t('game.log')}>
            <Icon name="history" size={20} />
            {logNew > 0 && <span className="corner-badge">{logNew > 99 ? '99+' : logNew}</span>}
          </button>
        )}
        {online && !watching && <ChatBar online={online} />}
      </>
    ) : null;

  const centerBand = (
        <CenterBand
          state={state}
          human={human}
          watching={watching}
          streamer={streamer}
          wide={wide}
          pulse={animate && myTurnIdle}
          hands={
            !streamer && spectator?.canHands && online ? { on: online.hands, onToggle: spectator.onToggleHands } : undefined
          }
          acting={acting}
          mode={mode}
          donBar={donBar}
          paused={game.paused}
          canEnd={myTurnIdle}
          onEnd={() => dispatch({ type: 'endTurn', player: human! })}
          onCancelMode={() => setMode(null)}
          onTogglePause={() => game.setPaused((p) => !p)}
          request={targets ? <TargetRequest state={state} pending={targets} picked={picked} hint={cancelHint} /> : !mode && undoName ? <UndoPill name={undoName} onUndo={cancelAction} /> : undefined}
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
              <CancelButton sub={mode.kind === 'attack' ? t('game.cancelAttackSub') : t('game.cancelDonSub')} onClick={() => setMode(null)} />
            ) : null
          }
        />
  );

  const detailUid = hovered ?? selected;

  return (
    <div
      className={[
        'game',
        wide ? 'wide' : '',
        watching || replay ? 'flip-top' : '',
        drag ? 'dragging' : '',
        replay ? 'replaying' : '',
        tutorial ? 'lesson' : '',
        broadcast ? 'broadcast' : '',
        streamer ? 'streamer' : '',
        lateral ? `lateral playmat-${streamerPlaymat}` : '',
        streamer && panel ? 'with-panel' : '',
        playerPanel && !panel ? 'no-panel' : '',
      ].join(' ')}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="board-col">
        {lateral ? (
          <LateralBoard
            state={state}
            left={bottom}
            corner={corner}
            center={centerBand}
            bannerExtra={online ? (p) => <OnlineBanner online={online} player={p} /> : undefined}
            miniHands={{ open: openHands, canOpen: canOpenHands, onToggle: toggleHand }}
            {...handlers}
          />
        ) : (
        <Board
          state={state}
          bottom={bottom}
          revealBottom={!handsSecret}
          revealTop={showBotHand && !handsSecret}
          corner={corner}
          sideTools={sideTools}
          bannerExtra={online ? (p) => <OnlineBanner online={online} player={p} /> : undefined}
          miniHands={streamer ? { open: openHands, canOpen: canOpenHands, onToggle: toggleHand } : undefined}
          lifeAside={streamer}
          handOrder={handView}
          onExpandHand={human !== null && !handsSecret ? () => setSheet('hand') : undefined}
          onSortHand={human !== null && !handsSecret && myHand.length > 1 ? sortHand : undefined}
          turnPulse={animate && myTurnIdle}
          handHint={handHint}
          lifted={lifted}
          ghost={drag?.kind === 'hand' ? drag.uid : null}
          center={centerBand}
          {...handlers}
        />
        )}

        {streamer &&
          fanPlayers.map(
            (p) =>
              handIsKnown(state, p) && (
                <HandFan
                  key={p}
                  state={state}
                  player={p}
                  position={lateral ? (p === bottom ? 'left' : 'right') : p === bottom ? 'bottom' : 'top'}
                  closing={!openHands.includes(p)}
                  highlight={highlight}
                  onCard={onCard}
                  onCardDouble={onCardDouble}
                  onHover={setHovered}
                />
              ),
          )}

        {banner && state.phase === 'main' && (
          <div key={banner.key} className={['turn-banner', banner.mine ? 'mine' : 'theirs', animate ? 'sweep' : ''].join(' ')}>
            <div className="tb-stripe">
              <small>{banner.kicker}</small>
              <b>{banner.text}</b>
            </div>
          </div>
        )}

        {motion.layer}

        {broadcast && <PlayHighlight state={state} lastAction={allActions[allActions.length - 1]} bottom={bottom} />}

        {replay && cue && game.speed < 8 && !showResult && (
          <ReplayCue
            cue={cue}
            pos={replay.pos}
            bottom={bottom}
            dueAt={replay.dueAt}
            playing={!game.paused}
            speed={game.speed}
            animate={animate}
          />
        )}

        {online && (!broadcast || broadcast.chat) && <ChatBubbles online={online} bottom={bottom} />}
        {online && <OnlineStatus online={online} />}
        {online && !broadcast && <PauseBanner online={online} />}
        {online && spectator?.judge && <JudgePanel online={online} />}
        {online && calling && !online.room?.pause && <CallJudgeSheet online={online} onClose={() => setCalling(false)} />}

        {/* Na transmissão ninguém clica para fechar o aviso: os erros ficam fora da tela. */}
        {game.error && !broadcast && (
          <div className="toast error" onClick={() => game.setError(null)}>
            {game.error}
          </div>
        )}
        {notice && (!game.error || broadcast) && (
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
          hidden={intro || motion.busy || Boolean(tutorial?.hidePrompt)}
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
          <SheetFrame title={t('game.matchSheet')} onClose={() => setSheet(null)}>
            <div className="menu-grid">
              {human !== null && !isOnline && !tutorial && (
                <button className="btn" onClick={game.undo} disabled={!game.canUndo}>
                  {t('game.undo')}
                </button>
              )}
              {!isOnline && !replay && !tutorial && (
                <button className="btn" onClick={() => game.setPaused((p) => !p)}>
                  {game.paused ? t('game.resume') : t('game.pause')}
                </button>
              )}
              <button className="btn" onClick={() => (streamer || playerPanel ? openPanel('log') : setSheet('log'))}>
                {t('game.logBtn')}
              </button>
              {playerPanel && loadOwnDeck && (
                <button className="btn" onClick={() => openPanel('deck')}>
                  {t('game.decklistBtn')}
                </button>
              )}
              {streamer && !embed?.layout && (
                <button className="btn" onClick={() => updateSettings({ streamerLayout: lateral ? 'upright' : 'lateral' })} title={t('game.layoutTitle')}>
                  {lateral ? t('game.layoutToUpright') : t('game.layoutToLateral')}
                </button>
              )}
              {streamer && spectator?.onSwitchRoom && (
                <button className="btn" onClick={() => openPanel('matches')}>
                  {t('game.matchesBtn')}
                </button>
              )}
              {streamer && spectator?.roomId && (
                <button className="btn" onClick={() => openPanel('deck')}>
                  {t('game.decklistBtn')}
                </button>
              )}
              {canBroadcast && (
                <button className="btn" onClick={sendToBroadcast}>
                  {t('broadcast.sendThis')}
                </button>
              )}
              {(over || replay) && !tutorial && (
                <button className="btn" onClick={game.downloadReplay}>
                  {t('game.downloadReplay')}
                </button>
              )}
              {callJudge && (
                <button className="btn judge-call" onClick={callJudge}>
                  {t('judge.call')}
                </button>
              )}
              {human !== null && state.phase === 'main' && !tutorial && (
                <button
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm(t('game.concedeConfirm'))) {
                      dispatch({ type: 'concede', player: human });
                      setSheet(null);
                    }
                  }}
                >
                  {t('game.concede')}
                </button>
              )}
              <button className="btn" onClick={onExit}>
                {tutorial ? t('tutorial.exitLesson') : toTournament ? t('game.exitToTournament') : exitTo === 'back' ? t('game.exitBack') : t('game.exitToMenu')}
              </button>
            </div>
            {lateral && (
              <div className="sheet-section">
                <label className="sheet-label">{t('game.playmat')}</label>
                <p className="muted small sheet-hint">{t('game.playmatHint')}</p>
                <div className="seg small playmat-pick">
                  {PLAYMATS.map((pm) => (
                    <button key={pm} className={streamerPlaymat === pm ? 'on' : ''} onClick={() => updateSettings({ streamerPlaymat: pm })}>
                      <span className={`playmat-dot playmat-${pm}`} aria-hidden />
                      {t(`game.playmat.${pm}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!isOnline && !replay && !tutorial && (
              <div className="sheet-section">
                <label className="sheet-label">{t('game.botSpeed')}</label>
                <p className="muted small sheet-hint">{t('game.botSpeedHint')}</p>
                <div className="seg small">
                  {[0.5, 1, 2, 4].map((v) => (
                    <button key={v} className={game.speed === v ? 'on' : ''} onClick={() => game.setSpeed(v)}>
                      {t('game.speedX', { v })}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {kind === 'bot' && !tutorial && (
              <label className="check">
                <input type="checkbox" checked={showBotHand} onChange={(e) => setShowBotHand(e.target.checked)} /> {t('game.showBotHand')}
              </label>
            )}
            <div className="sheet-section">
              <SettingsControls />
            </div>
          </SheetFrame>
        )}

        {sheet === 'hand' && human !== null && !handsSecret && (
          <SheetFrame title={t('game.yourHand', { n: orderedHand.length })} onClose={() => setSheet(null)}>
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
                <CancelButton sub={mode.kind === 'attack' ? t('game.cancelAttackSub') : t('game.cancelDonSub')} onClick={() => setMode(null)} />
              </div>
            )}
            <p className="muted small hand-sheet-hint">
              {myPending?.kind === 'counter'
                ? !myPending.options.length
                  ? t('game.sheetCounterNone')
                  : quickCounter
                    ? t('game.sheetCounterQuick')
                    : t('game.sheetCounterConfirm')
                : targets
                  ? t('game.sentence', { text: handHint })
                  : myPending?.kind === 'selectTargets'
                    ? promptText(tryT, myPending)
                    : t('game.sheetHandHint')}
            </p>
            {orderedHand.length > 1 && (
              <div className="btn-row center hand-sheet-tools">
                <button className="btn small" onClick={sortHand} title={t('game.sortHandTitle')}>
                  {t('game.sortHand')}
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
          <SheetFrame title={t('game.log')} onClose={() => setSheet(null)}>
            <LogPanel state={state} fresh={replay?.logFrom} onCardZoom={setLogCard} />
          </SheetFrame>
        )}

        {sheet !== null && typeof sheet === 'object' && (
          <SheetFrame
            title={t('game.trashOf', { name: state.players[sheet.trash].name, n: state.players[sheet.trash].trash.length })}
            onClose={() => setSheet(null)}
          >
            <div className="card-list">
              {[...state.players[sheet.trash].trash].reverse().map((uid) => (
                <CardView key={uid} state={state} uid={uid} onClick={() => setZoom(uid)} onHover={setHovered} />
              ))}
              {state.players[sheet.trash].trash.length === 0 && <p className="muted">{t('game.trashEmpty')}</p>}
            </div>
          </SheetFrame>
        )}

        {reveals.length > 0 && <RevealedCards lines={reveals} onCard={setLogCard} onClose={() => setReveals([])} />}

        {logCard && <StaticCardZoom card={logCard} className="log-zoom" onClose={() => setLogCard(null)} />}
        {deckCard && <StaticCardZoom card={deckCard} className="log-zoom" onClose={() => setDeckCard(null)} />}

        {tutorial?.overlay}
        {kind === 'bot' && !replay && !tutorial && coachTips && human !== null && !intro && !zoom && !logCard && !sheet && <CoachTipPill state={state} human={human} />}
        {tutorial && !wide && <div className={['coach-float', tutorial.floatAt ?? 'top'].join(' ')}>{tutorial.coach}</div>}

        {state.phase === 'gameover' && showResult && !tutorial && (
          <GameResult
            state={state}
            human={human}
            actions={game.actions()}
            onExit={bare ? undefined : onExit}
            exitLabel={toTournament ? t('game.backToTournament') : exitTo === 'back' ? t('common.back') : t('game.backToMenu')}
            onRematch={
              replay
                ? () => {
                    replay.seek(0);
                    game.setPaused(() => false);
                  }
                : onRematch
            }
            rematchLabel={
              (replay ? t('game.watchAgain') : rematchLabel) ??
              (online && human !== null ? (online.room?.rematch[human] ? t('game.waitingOpponent') : t('game.askRematch')) : undefined)
            }
            onReplay={online?.room?.tournament || bare ? undefined : game.downloadReplay}
            onLog={() => setSheet('log')}
            onClose={replay ? () => setShowResult(false) : undefined}
            extra={online ? <OnlineResultInfo online={online} /> : undefined}
            onReport={reportMatch !== null ? () => setReporting(true) : undefined}
            onDeck={setDeckOf}
          />
        )}
        {deckOf !== null && state.phase === 'gameover' && (
          <Suspense fallback={null}>
            <MatchDeck state={state} player={deckOf} onClose={() => setDeckOf(null)} />
          </Suspense>
        )}
        {reporting && reportMatch !== null && (
          <ReportModal
            matchId={reportMatch}
            tournament={online?.room?.tournament?.name ?? null}
            cards={reportCards}
            onClose={() => setReporting(false)}
          />
        )}
      </div>

      {wide && tutorial && (
        <aside className="side-panel lesson-panel">
          <div className="panel-controls">
            <button className="btn small" onClick={onExit}>
              {t('tutorial.exitLesson')}
            </button>
          </div>
          {tutorial.coach}
          <CardDetail state={state} uid={detailUid} />
        </aside>
      )}
      {wide && broadcast && (
        <aside className="side-panel">
          <LogPanel state={state} />
        </aside>
      )}
      {streamer && panel && (
        <aside className="side-panel tabbed-panel streamer-panel" aria-label={t('game.panelLabel')}>
          <div className="panel-tabs">
            <div className="seg small" role="tablist">
              <button type="button" role="tab" aria-selected={panel === 'log'} className={panel === 'log' ? 'on' : ''} onClick={() => setPanel('log')}>
                {t('game.log')}
              </button>
              {spectator?.onSwitchRoom && (
                <button type="button" role="tab" aria-selected={panel === 'matches'} className={panel === 'matches' ? 'on' : ''} onClick={() => setPanel('matches')}>
                  {t('game.matches')}
                </button>
              )}
              {spectator?.roomId && (
                <button type="button" role="tab" aria-selected={panel === 'deck'} className={panel === 'deck' ? 'on' : ''} onClick={() => setPanel('deck')}>
                  {t('game.decklist')}
                </button>
              )}
            </div>
            <button className="zoom-close static" onClick={() => setPanel(null)} aria-label={t('game.closePanel')} title={t('game.closePanel')}>
              ✕
            </button>
          </div>
          {panel === 'log' && <LogPanel state={state} onCardZoom={setLogCard} />}
          {panel === 'matches' && spectator?.onSwitchRoom && <MatchesPanel currentId={spectator.roomId ?? null} onWatch={spectator.onSwitchRoom} />}
          {panel === 'deck' && spectator?.roomId && <DeckPanel roomId={spectator.roomId} onZoom={setDeckCard} />}
        </aside>
      )}
      {playerPanel && panel && (
        <aside className="side-panel tabbed-panel player-panel" aria-label={t('game.panelLabel')}>
          <div className="panel-tabs">
            <div className="seg small" role="tablist">
              <button type="button" role="tab" aria-selected={panel !== 'deck'} className={panel !== 'deck' ? 'on' : ''} onClick={() => setPanel('log')}>
                {t('game.log')}
              </button>
              {loadOwnDeck && (
                <button type="button" role="tab" aria-selected={panel === 'deck'} className={panel === 'deck' ? 'on' : ''} onClick={() => setPanel('deck')}>
                  {t('game.decklist')}
                </button>
              )}
            </div>
            <button className="zoom-close static" onClick={() => setPanel(null)} aria-label={t('game.closePanel')} title={t('game.closePanelFull')}>
              ✕
            </button>
          </div>
          {!bare && (
            <div className="panel-controls">
              <button className="btn small" onClick={onExit}>
                {toTournament ? t('game.sideTournament') : exitTo === 'back' ? t('game.sideBack') : t('game.sideMenu')}
              </button>
              {callJudge && (
                <button className="btn small judge-call" onClick={callJudge}>
                  {t('judge.call')}
                </button>
              )}
              {human !== null && !isOnline && (
                <button className="btn small" onClick={game.undo} disabled={!game.canUndo}>
                  {t('game.undo')}
                </button>
              )}
              {/* A velocidade do bot fica só no menu da partida. */}
              {!isOnline && !replay && (
                <button className="btn small" onClick={() => game.setPaused((p) => !p)}>
                  {game.paused ? t('game.resume') : t('game.pause')}
                </button>
              )}
              {(over || replay) && (
                <button className="btn small" onClick={game.downloadReplay} title={t('game.replayTitle')}>
                  {t('game.replayBtn')}
                </button>
              )}
            </div>
          )}
          {panel === 'deck' && loadOwnDeck ? (
            <DeckListPanel load={loadOwnDeck} onZoom={setDeckCard} />
          ) : (
            <>
              <CardDetail state={state} uid={detailUid} />
              <LogPanel state={state} fresh={replay?.logFrom} onCardZoom={setLogCard} />
            </>
          )}
        </aside>
      )}

      {replay && (
        <ReplayBar
          replay={replay}
          state={state}
          paused={game.paused}
          setPaused={game.setPaused}
          speed={game.speed}
          setSpeed={game.setSpeed}
          cue={cue}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dicas do treinador

/** Treino contra o bot com "Dicas do treinador": uma dica curta para o momento (some ao fechar até mudar). */
function CoachTipPill({ state, human }: { state: GameState; human: PlayerId }) {
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

function CenterBand(props: {
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
function DonBar(props: { count: number; onCancel: () => void }) {
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
  const t = useT();
  const tryT = useTryT();
  const prompt = promptText(tryT, pending);
  const source = state.cards[pending.source] ? cardDef(state, pending.source) : null;
  // O motor costuma começar o pedido com "Nome da carta: "; o nome vai para a linha de cima.
  const prefix = source ? `${source.name}: ` : '';
  const text = prefix && prompt.startsWith(prefix) ? prompt.slice(prefix.length) : prompt;
  const order = pending.ordered && picked.length > 0 ? orderText(t, state, picked) : null;
  return (
    <div className="target-request" title={prompt}>
      {source && (
        <div className="source-thumb">
          <CardView state={state} uid={pending.source} />
        </div>
      )}
      <div className="target-text">
        {source && <small>{source.name}</small>}
        <b>
          {text}
          {pending.max > 0 && ` ${t('game.countOf', { n: picked.length, max: pending.max })}`}
        </b>
        {order && <small className="target-order">{t('game.order', { order })}</small>}
        {hint && <small className="target-hint">{hint}</small>}
      </div>
    </div>
  );
}

/**
 * Botão grande de cancelar, no lugar de "Encerrar turno": sai do modo de ataque ou de DON!! marcados
 * (nada foi para o motor ainda), ou desfaz no motor a ação em andamento (`cancel`).
 */
/** Habilidade paga que já terminou: ainda dá para voltar atrás até a próxima jogada. */
function UndoPill({ name, onUndo }: { name: string; onUndo: () => void }) {
  const t = useT();
  return (
    <button className="hint-pill undo-pill" onClick={onUndo} title={t('game.undoActionTitle')}>
      ↶ {t('game.undoPaid', { name })} <small>{t('game.undoPaidSub')}</small>
    </button>
  );
}

function CancelButton({ sub, onClick, title }: { sub: string; onClick: () => void; title?: string }) {
  const t = useT();
  return (
    <button className="end-turn defense cancel" onClick={onClick} title={title ?? t('game.cancelBack')}>
      <b>{t('common.cancel')}</b>
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
  /** Alvos já marcados (escolha de alvos) ou Counters marcados para usar de uma vez. */
  picked: string[];
  human: PlayerId;
  onDispatch: (a: Action) => void;
  /** A ação que pediu esta escolha ainda pode ser desfeita: botão Cancelar ao lado do de confirmar. */
  onCancel?: () => void;
  clock?: ReactNode;
  /** Dentro da folha da mão: botão largo. */
  sheet?: boolean;
}) {
  const t = useT();
  const tryT = useTryT();
  const d =
    pending.kind === 'selectTargets' ? targetsDecision(t, promptText(tryT, pending), pending, picked) : defenseDecision(t, state, pending, picked);
  if (!d) return null;
  const act = () => {
    for (const a of [d.action(human)].flat()) onDispatch(a);
  };
  return (
    <div className={['defense-slot', sheet ? 'in-sheet' : ''].join(' ')}>
      {onCancel && pending.kind === 'selectTargets' && (
        <button className="end-turn defense cancel side" onClick={onCancel} title={t('game.undoActionTitle')}>
          <b>{t('common.cancel')}</b>
          <small>{t('game.undoActionSub')}</small>
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
  /** Várias ações saem em sequência (os Counters marcados e o fim da etapa). */
  action: (player: PlayerId) => Action | Action[];
}

/**
 * Blocker/Counter: rótulo com o resultado previsto do ataque. Com Counters marcados, o botão usa todos
 * (o valor vai para o atacado) e já encerra a etapa, mostrando o resultado com eles somados.
 */
function defenseDecision(
  t: Translate,
  state: GameState,
  pending: Extract<Pending, { kind: 'block' | 'counter' }>,
  picked: string[] = [],
): Decision | null {
  const b = state.battle;
  if (!b) return null;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const hits = atk >= def;
  const need = atk - def + 1000;
  const counter = pending.kind === 'counter';
  const marked = counter ? picked.filter((u) => pending.options.includes(u)) : [];
  if (marked.length) {
    const amount = marked.reduce((sum, u) => sum + counterValue(state, u), 0);
    const total = def + amount;
    const result = atk >= total ? t('game.attackPasses') : t('game.defended');
    return {
      label: t('game.useCounters', { amount }),
      sub: t('game.resultSub', { result, atk, def: total }),
      title: t('game.useCountersTitle', { n: marked.length, result, atk, def: total }),
      pulse: atk < total,
      action: (player) => [...marked.map((uid): Action => ({ type: 'counter', player, uid })), { type: 'pass', player }],
    };
  }
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
  const label = !counter
    ? t('game.noBlock')
    : !hits || none
      ? t('game.finish')
      : used
        ? t('game.noMoreCounter')
        : t('game.noCounter');
  const result = hits ? t('game.attackPasses') : t('game.defended');
  return {
    label,
    sub: none && hits && !used ? t('game.noCounterInHandSub', { atk, def }) : t('game.resultSub', { result, atk, def }),
    title: !counter ? t('game.noBlockTitle', { result, atk, def }) : t('game.endCounterTitle', { result, atk, def }),
    pulse: useless,
    action: (player) => (counter ? { type: 'pass', player } : { type: 'choose', player, uids: [] }),
  };
}

/** Escolha de alvos de efeito: "Confirmar (n/máx)", "Não escolher" ou "Continuar", com o contador. */
function targetsDecision(t: Translate, prompt: string, pending: Extract<Pending, { kind: 'selectTargets' }>, picked: string[]): Decision {
  const n = picked.length;
  const { max } = pending;
  // O mínimo nunca passa do que há para escolher.
  const need = Math.min(pending.min, pending.options.length);
  if (max === 0) {
    return {
      label: t('game.continue'),
      sub: t('game.nothingToChoose'),
      title: prompt,
      pulse: true,
      action: (player) => ({ type: 'choose', player, uids: [] }),
    };
  }
  if (n === 0 && need === 0) {
    return {
      label: t('game.skipChoice'),
      sub: t('game.noneMarkedUpTo', { max }),
      title: t('game.promptSkip', { prompt }),
      pulse: false,
      action: (player) => ({ type: 'choose', player, uids: [] }),
    };
  }
  const missing = need - n;
  return {
    label: t('game.confirmCount', { n, max }),
    sub: missing > 0 ? t('game.markMore', { n: missing }) : n < max ? t('game.canMarkMore') : t('game.choiceComplete'),
    title: prompt,
    pulse: n === max,
    disabled: missing > 0,
    action: (player) => ({ type: 'choose', player, uids: picked }),
  };
}

/** Poder do atacante contra o alvo, com o que falta para defender (como o "Dano previsto" do Pocket). */
function BattleInfo({ state, human }: { state: GameState; human: PlayerId | null }) {
  const t = useT();
  const b = state.battle!;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const defender = state.cards[b.target].owner;
  const hits = atk >= def;
  const need = atk - def + 1000;
  let status: string;
  if (human !== null && defender === human) status = hits ? t('game.needToDefend', { n: need }) : t('game.defendedBang');
  else status = hits ? t('game.attackWillHit') : t('game.needToHit', { n: def - atk });
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
      <div className={['battle-status', hits ? 'hit' : 'safe'].join(' ')}>
        {b.blocked ? t('game.blockedStatus', { status }) : status}
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
  const { locale } = useSettings();
  const t = useT();
  const tryT = useTryT();
  const pending = state.pending;
  // "Ver a mesa": a janela da pergunta recolhe para um balão no topo, para olhar o campo e a mão antes de
  // responder (ex.: usar ou não um efeito quando o oponente ataca). Volta sozinha quando a situação muda.
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [pending]);
  if (props.hidden || state.phase === 'gameover' || !pending || human === null || pending.player !== human) return null;
  const peekButton = (
    <button className="btn peek" onClick={() => setPeek(true)} title={t('game.peekTitle')}>
      {t('game.peek')}
    </button>
  );
  /** Texto da pergunta no idioma da interface (chave do motor) ou o que veio do motor. */
  const prompt = 'prompt' in pending ? promptText(tryT, pending) : '';
  if (peek && (pending.kind === 'confirm' || pending.kind === 'option' || pending.kind === 'selectTargets' || pending.kind === 'lifeCard')) {
    const title = pending.kind === 'lifeCard' ? t('game.lifeCardTitle', { name: cardDef(state, pending.card).name }) : prompt;
    return (
      <PromptPill title={title} subtitle={t('game.peekSub')}>
        <div className="btn-row center">
          <button className="btn primary" onClick={() => setPeek(false)}>
            {t('game.backToQuestion')}
          </button>
        </div>
      </PromptPill>
    );
  }
  /** Botão de desfazer a ação (quando o motor permite) ou o motivo de não dar mais. */
  const cancel = onCancel ? (
    <button className="btn cancel" onClick={onCancel} title={t('game.undoActionTitle')}>
      {t('common.cancel')}
    </button>
  ) : null;
  const hint = !onCancel && cancelHint ? <p className="muted small cancel-hint">{t('game.sentence', { text: cancelHint })}</p> : null;

  switch (pending.kind) {
    case 'chooseFirst':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">{t('game.rollKicker')}</div>
            <h2>{t('game.wonRoll')}</h2>
            <p className="muted">{t('game.firstOrSecond')}</p>
            <p className="muted small">{t('game.firstOrSecondHint')}</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                {t('game.playFirst')}
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                {t('game.playSecond')}
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
            <div className="modal-kicker">
              {first ? t('game.youWillPlayFirst') : t('game.willPlayFirst', { name: state.players[state.firstPlayer].name })}
            </div>
            <h2>{t('game.openingHand')}</h2>
            <div className="mulligan-hand">
              {state.players[human].hand.map((uid, i) => (
                <div key={uid} className="deal" style={{ animationDelay: `${i * 70}ms` }}>
                  <CardView state={state} uid={uid} onClick={() => props.onCard(uid)} />
                </div>
              ))}
            </div>
            <p className="muted small">{t('game.mulliganHint')}</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: false })}>
                {t('game.keepHand')}
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: true })}>
                {t('game.redrawHand')}
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
              {t('game.continue')}
            </button>
          ) : (
            <>
              {pending.min === 0 && (
                <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
                  {t('game.skipChoice')}
                </button>
              )}
              <button
                className="btn primary"
                disabled={picked.length < pending.min}
                onClick={() => onDispatch({ type: 'choose', player: human, uids: picked })}
              >
                {pending.max > 1 ? t('game.confirmCount', { n: picked.length, max: pending.max }) : t('game.confirm')}
              </button>
            </>
          )}
        </div>
      );
      const order = pending.ordered && picked.length > 0 && (
        <p className="muted small">{t('game.order', { order: orderText(t, state, picked) })}</p>
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
              <h3>{prompt}</h3>
              <p className="muted small">
                {pending.max === 0
                  ? offBoard.length
                    ? t('game.tapToRead')
                    : t('game.opponentSeesChoice')
                  : pending.ordered
                    ? t('game.tapInOrder')
                    : pending.max === 1
                      ? t('game.tapOneConfirm')
                      : t('game.tapToChoose')}
                {blocked > 0 && ` ${t('game.dimmedUnavailable')}`}
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
        <PromptPill title={prompt} subtitle={t('game.tapHighlightedCount', { n: picked.length, max: pending.max })}>
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
      const text = locale === 'pt-BR' ? translateToPt(pending.text).text : pending.text;
      const name = cardDef(state, pending.source).name;
      return (
        <PromptPill title={t('game.manualTitle', { name })} subtitle={t('game.manualSub', { text })} clamp>
          <div className="btn-row">
            {cancel}
            <button className="btn primary" onClick={() => onDispatch({ type: 'manualDone', player: human })}>
              {t('game.continue')}
            </button>
          </div>
        </PromptPill>
      );
    }
    case 'lifeCard': {
      // Toda carta que sai da Vida passa por aqui, com ou sem [Trigger]: o oponente só vê que uma
      // carta da Vida está sendo olhada, e não pode saber qual dos dois casos é.
      const def = cardDef(state, pending.card);
      const trigger = def.abilities.some((a) => a.timing === 'trigger') ? cardText(def, locale).trigger : null;
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">{trigger ? t('game.triggerRevealed') : t('game.lifeCard')}</div>
            <div className="modal-feature">
              <CardView state={state} uid={pending.card} />
            </div>
            <h3>{def.name}</h3>
            {trigger ? (
              <p className="effect trigger">{trigger}</p>
            ) : (
              <p className="muted small">{t('game.noTriggerHint')}</p>
            )}
            <div className="btn-row center">
              {trigger && (
                <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                  {t('game.activateTrigger')}
                </button>
              )}
              <button className={`btn big${trigger ? '' : ' primary'}`} onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                {trigger ? (
                  <>
                    {t('game.noActivate')} <small>{t('game.goesToHand')}</small>
                  </>
                ) : (
                  t('game.putInHand')
                )}
              </button>
            </div>
            {trigger && <div className="btn-row center">{peekButton}</div>}
          </div>
        </div>
      );
    }
    case 'option': {
      // Cartas que a pergunta mostra (ex.: o topo do deck do oponente): a carta inteira, e toque para ler.
      // Rótulos das opções: a chave do motor (`optionKeys`), quando há; senão o texto da carta (traduzido em pt-BR).
      const { optionKeys, optionParts } = pending as typeof pending & KeyedOptions;
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            {pending.shown?.length ? (
              <div className="modal-feature">
                {pending.shown.map((uid) => (
                  <CardView key={uid} state={state} uid={uid} onClick={() => props.onCard(uid)} />
                ))}
              </div>
            ) : null}
            <h3>{prompt}</h3>
            {pending.shown?.length ? <p className="muted small">{t('game.tapCardToRead')}</p> : null}
            <div className="btn-col">
              {pending.options.map((label, index) => (
                <button
                  key={index}
                  className={`btn${index === 0 ? ' primary' : ''}`}
                  onClick={() => onDispatch({ type: 'option', player: human, index })}
                >
                  {(optionParts?.[index] ? listText(tryT, optionParts[index]!) : undefined) ??
                    tryT(optionKeys?.[index]) ??
                    (!pending.order && !pending.don && locale === 'pt-BR' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label)
                      ? translateToPt(label).text
                      : label)}
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
    }
    case 'confirm':
      // Sem como pagar o custo a pergunta abre mesmo assim (para o oponente não deduzir a mão),
      // só com "Não usar".
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{prompt}</h3>
            {pending.cannot && <p className="muted small">{t('game.opponentSeesQuestion')}</p>}
            <div className="btn-row center">
              {!pending.cannot && (
                <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                  {pending.drawUpTo ? t('game.drawOne') : t('game.payAndUse')}
                </button>
              )}
              <button className={`btn big${pending.cannot ? ' primary' : ''}`} onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                {pending.drawUpTo ? t('game.stop') : t('game.dontUse')}
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
              <button className="ability-plate counter" onClick={eventCounter}>
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
              <button className="ability-plate" onClick={() => props.onDispatch(eventPlay)}>
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
              <button className="btn primary big" onClick={props.onCounter}>
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
              <button className="btn primary big" onClick={() => props.onDispatch(play)}>
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

function CardDetail({ state, uid }: { state: GameState; uid: string | null }) {
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

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
interface RevealLine {
  text: string;
  cards: CardDef[];
  /** Quantas vezes a mesma linha se repetiu antes de o aviso ser fechado (ex.: duas buscas seguidas da mesma carta). */
  count: number;
}

/** Junta as revelações novas às do aviso aberto: a linha repetida vira uma só, com as cartas lado a lado e "×N". */
function mergeReveals(open: RevealLine[], lines: RevealLine[]): RevealLine[] {
  const out = [...open];
  for (const line of lines) {
    const i = out.findIndex((l) => l.text === line.text);
    if (i < 0) out.push(line);
    else out[i] = { ...out[i], cards: [...out[i].cards, ...line.cards], count: out[i].count + line.count };
  }
  return out;
}

/** Cartas reveladas pelo oponente: a carta inteira (toque para ler) e a linha do histórico. */
function RevealedCards({ lines, onCard, onClose }: { lines: RevealLine[]; onCard: (def: CardDef) => void; onClose: () => void }) {
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

/**
 * Histórico da partida. `fresh`: no replay, as linhas da ação atual (desta em diante) ficam destacadas.
 * Os nomes de cartas viram links: toque/clique abre a carta ampliada (`onCardZoom`); com mouse, passar por cima mostra a carta ao lado.
 */
function LogPanel({ state, fresh, onCardZoom }: { state: GameState; fresh?: number | null; onCardZoom?: (def: CardDef) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [hover, setHover] = useState<{ def: CardDef; anchor: HTMLElement } | null>(null);
  const names = useMemo(() => logCardNames(state.defs), [state.defs]);
  const tryT = useTryT();
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.log.length]);
  return (
    <>
        <div className="log" ref={ref} onScroll={() => setHover(null)}>
          {state.log.map((e, i) => (
            <div
              key={i}
              className={[
                'log-line',
                e.player === null ? '' : `p${e.player}`,
                e.text.startsWith('—') ? 'turn' : '',
                fresh != null && i >= fresh ? 'fresh' : '',
              ].join(' ')}
            >
              <LogText
                text={logText(tryT, e)}
                names={names}
                onCard={(name) => {
                  const def = resolveLogCard(state, names, name, e.player);
                  if (!def) return;
                  setHover(null);
                  onCardZoom?.(def);
                }}
                onHover={
                  canHover
                    ? (name, el) => {
                        const def = el && resolveLogCard(state, names, name, e.player);
                        setHover(def && el ? { def, anchor: el } : null);
                      }
                    : undefined
                }
              />
            </div>
          ))}
        </div>
        {/* No body: o painel lateral tem backdrop-filter, que prenderia um elemento fixo dentro dele. */}
        {canHover && hover && createPortal(<CardHoverPreview card={hover.def} anchor={hover.anchor} />, document.body)}
    </>
  );
}

interface LogNames {
  /** Todos os nomes de carta da partida, do maior para o menor, como alternativas de uma regex. */
  regex: RegExp | null;
  /** Nome → ids das cartas com esse nome (reimpressões com o mesmo nome). */
  byName: Map<string, string[]>;
}

/** Nomes das cartas conhecidas da partida, para achá-los nas linhas do histórico. */
function logCardNames(defs: GameState['defs']): LogNames {
  const byName = new Map<string, string[]>();
  for (const def of Object.values(defs)) {
    if (def.id === HIDDEN_CARD || !def.name) continue;
    const ids = byName.get(def.name);
    if (ids) ids.push(def.id);
    else byName.set(def.name, [def.id]);
  }
  // Os nomes maiores primeiro: "Monkey.D.Luffy" antes de "Luffy".
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Só nomes inteiros: nada de letra ou número colado antes ou depois.
  const regex = names.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
  return { regex, byName };
}

/** Onde a carta está vale mais que de quem é: líder antes de personagem/stage, depois descarte, depois o resto. */
const LOG_ZONE_RANK: Record<string, number> = { leader: 0, character: 1, stage: 1, trash: 2 };

/**
 * A carta por trás de um nome do histórico. Com homônimas (líder e personagem de mesmo nome, reimpressões),
 * a que está à vista na mesa; em empate, a de `player` (quem fez a jogada).
 */
function resolveLogCard(state: GameState, names: LogNames, name: string, player: PlayerId | null): CardDef | null {
  const ids = names.byName.get(name);
  if (!ids?.length) return null;
  let best = ids[0];
  if (ids.length > 1) {
    let bestScore = Infinity;
    for (const c of Object.values(state.cards)) {
      if (!ids.includes(c.cardId)) continue;
      const score = (LOG_ZONE_RANK[zoneOf(state, c.uid) ?? ''] ?? 3) * 2 + (c.owner === player ? 0 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = c.cardId;
      }
    }
  }
  return state.defs[best] ?? null;
}

/** Linha do histórico com os nomes de carta como botões. */
function LogText({
  text,
  names,
  onCard,
  onHover,
}: {
  text: string;
  names: LogNames;
  onCard: (name: string) => void;
  onHover?: (name: string, el: HTMLElement | null) => void;
}) {
  if (!names.regex) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(names.regex)) {
    const start = (m.index ?? 0) + m[1].length;
    const name = m[2];
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <button
        key={start}
        type="button"
        className="log-card"
        onClick={() => onCard(name)}
        onMouseEnter={onHover ? (e) => onHover(name, e.currentTarget) : undefined}
        onMouseLeave={onHover ? () => onHover(name, null) : undefined}
      >
        {name}
      </button>,
    );
    last = start + name.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function downloadReplay(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gumgum-replay-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
