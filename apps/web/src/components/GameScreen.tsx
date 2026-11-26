import {
  type Action,
  actingPlayer,
  type BotLevel,
  cancelAllowed,
  type CardData,
  type CardDef,
  cardDef,
  counterTargets,
  counterValue,
  eventCounterPower,
  type GameConfig,
  type GameState,
  HIDDEN_CARD,
  legalActions,
  locate,
  type PlayerId,
  spoilerRule,
  zoneOf,
} from '@gumgum/engine';
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CoachEntry, currentSpoilerSet, isAdmin, isTeam, type LiveRoom, modeLabel, type OnlineSeat, type RoomDecks, type WatchTarget, whyNotPlayable } from '../api';
import { BotReport } from './BotFeedback';
import { CoachPanel } from './CoachPanel';
import { useAuth } from '../auth';
import { usePreloadCardImages } from '../game/preloadImages';
import { useBoardSize } from '../hooks/useBoardSize';
import { buildReport, type CoachMark, feedbackMarks, sameMark } from '../game/botReport';
import { describeReplayAction } from '../game/replayCue';
import type { EmbedLayout } from '../embed';
import { useEmbedBridge } from '../game/useEmbedBridge';
import { buildSetup } from '../game/setup';
import { type GameSetup, useGame } from '../game/useGame';
import { audio } from '../audio';
import { hasKey, type MessageKey, useT, useTryT } from '../i18n';
import { fmtNumber } from '../i18n/format';
import { logText } from '../game/engineText';
import { enteredWithoutRush } from '../game/freshCharacter';
import { useMatchAudio } from '../game/useMatchAudio';
import { type OnlineGame, useOnlineGame } from '../game/useOnlineGame';
import { type Shortcut, useShortcuts } from '../game/shortcuts';
import { PLAYMATS, SettingsControls, useSettings } from '../settings';
import { Board, HandFan, handIsKnown, vars } from './Board';
import { WideBoard } from './WideBoard';
import { BoardLayoutEditor } from './BoardLayoutEditor';
import { effectiveLayout, panelWidth } from '../game/boardLayout';
import { LateralBoard } from './LateralBoard';
import { StaticCardZoom } from './CardInfo';
import { CardView, type Highlight, PickOrderContext } from './CardView';
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
import { type Drag, type DragKind, type Mode, type Panel, promptText, type Sheet, useMediaQuery } from './table/shared';
import { AttackArrow, BattleInfo, CenterBand, CoachTipPill, DonBar } from './table/CenterBand';
import { CancelButton, DecisionButton, TargetRequest, targetsOnTable, UndoPill } from './table/decisions';
import { Prompt } from './table/Prompt';
import { CardDetail, CardZoom, HoverTip, mergeReveals, RevealedCards, type RevealLine, SheetFrame } from './table/CardZoom';
import { LogPanel } from './table/LogPanel';

/** Decklist de um jogador no fim da partida: desenhada em canvas, fora do bundle principal (junto com o kit de divulgação). */
const MatchDeck = lazy(() => import('./MatchDeck'));

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

const LONG_PRESS_MS = 420;
const DRAG_THRESHOLD = 9;
/** Quanto puxar a carta da mão para cima até ela "sair" (arrastar). */
const HAND_PULL = 22;
/** Com o mouse, deslizar a carta da mão para os lados já começa a arrastá-la (reordenar ou jogar). */
const HAND_SLIDE = 14;

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
  /** Bot do Time (navegador): as explicações das jogadas do bot (painel do treinador). */
  coach?: CoachEntry[];
  /**
   * Mostra a frente das cartas da mão do oponente que a visão traz abertas (desafio do dia com a mão no enunciado);
   * as que vêm escondidas continuam de verso.
   */
  openOpponentHand?: boolean;
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
    // O treino do Selado não é gravado: o servidor só aceita decks construídos nesta rota, e o Selado fica fora das estatísticas.
    // O sandbox de regras também não: a mesa foi montada à mão e não é uma partida.
    if (game.state.phase !== 'gameover' || saved.current || setup.mode === 'replay' || setup.mode === 'sandbox' || setup.format === 'sealed') return;
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
      onRematch?.({ ...next, spoilers: setup.spoilers, botLevel: setup.botLevel, botPersonality: setup.botPersonality, botProfile: setup.botProfile, botHandGuess: setup.botHandGuess });
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
        botLevel={setup.botLevel}
        botDeckId={setup.deckIds[1]}
        botDeckName={setup.config.players[1].deck.name}
        ownDeck={human !== null ? ownDeck : undefined}
        onExit={onExit}
        onRematch={onRematch && (setup.mode === 'bot' && confirmDeck ? () => setConfirming(true) : () => onRematch())}
        startNotice={setup.notice}
        embed={embed}
        exitTo={setup.mode === 'sandbox' ? 'back' : undefined}
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
  /** Texto do botão de sair (padrão: "Sair da lição"). */
  exitLabel?: string;
}

/** Nome de cada nível do bot (o relatório do Bot do Time cita o nível). */
const BOT_LEVEL_LABEL: Record<BotLevel, MessageKey> = { easy: 'menu.botEasy', normal: 'menu.botNormal', hard: 'menu.botHard', team: 'menu.botTeam' };

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
  botLevel,
  botDeckId,
  botDeckName,
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
  /** Partida contra o bot no navegador: o nível do bot (online vem da sala). */
  botLevel?: BotLevel;
  /** Partida contra o bot no navegador: o deck que o bot joga (online vem da sala). */
  botDeckId?: string;
  botDeckName?: string;
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
      // [Trigger] do oponente: com as animações completas a carta já aparece no centro da mesa.
      if (e.key === 'log.triggerActivated' && showy) return [];
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
  const { quickCounter: quickCounterOn, confirmActions, donQuickPick, shortcuts, animations, replayCues, coachTips, locale, streamerLayout, streamerPlaymat, sidePanel, showImages, boardStyle, boardLayout, update: updateSettings } = useSettings();
  /**
   * "Confirmar ações" desligado: a escolha de alvos sai assim que estiver completa (sem o botão "Confirmar") e o
   * Counter é usado no toque. No tutorial as lições descrevem o botão: ali a confirmação fica sempre.
   */
  const quickChoice = !confirmActions && !tutorial;
  const quickCounter = quickCounterOn || quickChoice;
  /** Atalhos de teclado (ver `onShortcut`). No tutorial as lições descrevem os toques; na transmissão ninguém joga. */
  const shortcutsOn = shortcuts && !tutorial && !broadcast;
  /** Visão do Streamer: a mesa lateral (jogadores à esquerda e à direita, vista de cima) é o padrão; o menu troca para a mesa em pé. */
  const lateral = streamer && (embed?.layout ? embed.layout === 'lateral' : streamerLayout === 'lateral');
  /** Visão do Streamer: as mãos minimizadas abrem ao clicar quando são conhecidas (no replay, as duas). */
  const canOpenHands = Boolean(online?.hands || spectator?.canHands || kind === 'replay');
  const bare = Boolean(embed?.bare);
  /**
   * Quem joga no desktop escolhe a mesa em Configurações › Layout da mesa: a clássica (o padrão) ou a mesa
   * larga, bloco a bloco. Streamer, transmissão, tutorial e replay embutido ficam sempre com a clássica.
   */
  const layoutChoice = wide && !streamer && !broadcast && !tutorial && !embed;
  const wideBoard = layoutChoice && boardStyle === 'custom';
  const layout = useMemo(() => effectiveLayout(boardLayout), [boardLayout]);
  // Só a opção do app decide: muitos celulares ligam "reduzir movimento" sozinhos
  // (economia de bateria) e as animações e os dados sumiriam sem o jogador saber por quê.
  const animate = animations !== 'off';
  /** Animações completas: com as paradas no centro da mesa e a faixa animada de troca de turno (ver `Animations`). */
  const showy = animations === 'full';
  // Cartas voando entre as zonas (mais rápidas com o bot acelerado).
  const allActions = game.actions();
  // Replay: os pulos (voltar, ir para uma ação) e a velocidade máxima mudam a mesa sem animação.
  const replay = game.replay;
  // Tamanho da mesa para o CSS (--bw/--bh, deitada ou em pé), medido só quando muda.
  const boardCol = useRef<HTMLDivElement>(null);
  useBoardSize(boardCol);
  const motion = useBoardMotion(state, {
    enabled: animate && !game.jumped && !(replay && game.speed >= 8),
    tempo: Math.min(1.3, Math.max(0.35, 1 / game.speed)),
    lastAction: allActions[allActions.length - 1],
    lang: locale,
    calm: !showy,
  });
  // As imagens das cartas já conhecidas baixam antes de a carta aparecer (e voar) na mesa.
  usePreloadCardImages(state, showImages);
  // Sons da mesa e música da partida (os mesmos pontos que as animações; valem sem elas também).
  useMatchAudio(state, {
    enabled: !game.jumped && !(replay && game.speed >= 8),
    animate: showy && !game.jumped,
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
  /** Na mesa larga o histórico e o hover só moram no painel se o layout os puser lá; sem nada nele, o painel fecha. */
  const panelLogOn = !wideBoard || layout.panelOn;
  /** O painel na tela agora (no celular não há painel: o histórico abre numa folha). */
  const shownPanel = streamer || playerPanel ? (panel === 'log' && !panelLogOn ? null : panel) : null;
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
  /** Sandbox de regras: a mesma pessoa joga os dois lados (mãos abertas, sem replay nem relato de partida). */
  const sandbox = kind === 'sandbox';
  const [showBotHand, setShowBotHand] = useState(kind === 'replay' || sandbox || watching);
  const [banner, setBanner] = useState<{ text: string; kicker: string; mine: boolean; key: number } | null>(null);
  const [showResult, setShowResult] = useState(false);
  // Relato de bug: só para quem jogou (não no replay, no tutorial nem para quem assiste) e com a partida gravada no servidor.
  const [reporting, setReporting] = useState(false);
  /** Decklist aberta no resumo do fim (o jogador cujo deck aparece). */
  const [deckOf, setDeckOf] = useState<PlayerId | null>(null);
  const recorded = isOnline ? (online?.room?.result?.matchId ?? null) : (matchId ?? null);
  const reportMatch = human !== null && !watching && !tutorial && !broadcast && kind !== 'replay' && !sandbox ? recorded : null;
  // Bot do Time: a nota e as marcações, para quem é do Time, numa partida contra o bot (no navegador ou na sala do servidor).
  const botMatch = kind === 'bot' || online?.room?.queue === 'bot';
  const effectiveBotLevel: BotLevel | undefined = isOnline ? online?.room?.botLevel : botLevel;
  /** Passos das jogadas do bot marcados como errados (painel do treinador); viram o relatório da partida. */
  const [marks, setMarks] = useState<CoachMark[]>([]);
  const toggleMark = useCallback(
    (index: number, step: number) =>
      setMarks((list) => (list.some((m) => sameMark(m, { index, step })) ? list.filter((m) => !sameMark(m, { index, step })) : [...list, { index, step }])),
    [],
  );
  const updateMark = useCallback(
    (index: number, step: number, patch: Partial<Pick<CoachMark, 'alt' | 'why'>>) =>
      setMarks((list) => list.map((m) => (sameMark(m, { index, step }) ? { ...m, ...patch } : m))),
    [],
  );
  const coachEntries = (isOnline ? online?.coach : game.coach) ?? [];
  const reportCards = useMemo(
    () =>
      Object.values(state.defs)
        .map((d) => ({ id: d.id, name: d.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.defs],
  );
  /** Históricos na tela com a pesquisa (a lupa) aberta: enquanto houver um, os atalhos de teclado não valem. */
  const [logSearches, setLogSearches] = useState(0);
  const onLogSearching = useCallback((on: boolean) => setLogSearches((n) => Math.max(0, n + (on ? 1 : -1))), []);
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
  // Escolha em que a ordem importa: cada carta marcada mostra uma tag com o número da sua vez.
  const pickOrder = useMemo(
    () => (myPending?.kind === 'selectTargets' && myPending.ordered ? new Map(picked.map((u, i) => [u, i + 1])) : null),
    [myPending, picked],
  );
  const legal = useMemo(() => (human !== null ? legalActions(state, human) : []), [state, human]);
  const myTurnIdle =
    human !== null && !game.auto && !pending && state.activePlayer === human && state.phase === 'main' && !state.stack.length;
  const acting = actingPlayer(state);
  // Espectador com a visão de um jogador (o streamer que transmite a própria partida): a mão dele embaixo.
  const bottom: PlayerId = human ?? online?.room?.pov ?? 0;
  // Trecho do replay em vídeo/GIF (F2): não no replay embutido nem no tutorial.
  const noClip = Boolean(embed) || Boolean(tutorial);
  const clipInitial = replay?.initial;
  const clipScript = replay?.script;
  const clipSource = useMemo(
    () => (clipInitial && clipScript && !noClip ? { initial: clipInitial, actions: clipScript, bottom } : undefined),
    [clipInitial, clipScript, noClip, bottom],
  );
  const { user } = useAuth();
  /** Painel do treinador: no treino contra o Bot do Time, para quem é do Time. */
  const coachOn = botMatch && isTeam(user) && effectiveBotLevel === 'team' && human !== null && !watching && kind !== 'replay' && !tutorial;
  /** O relatório da partida (markdown) com as jogadas marcadas; `rating`/`comment` vêm do bloco do fim da partida. */
  const buildBotReport = useCallback(
    (rating = 0, comment = '') => {
      if (human === null) return '';
      const botSeat: PlayerId = human === 0 ? 1 : 0;
      const leaderOf = (p: PlayerId) => {
        const uid = state.players[p].leader.uid;
        return { leaderName: state.cards[uid] ? cardDef(state, uid).name : '?', leaderId: state.cards[uid]?.cardId ?? '?' };
      };
      const tr = (key: string, params?: Record<string, string | number>) => (hasKey(key) ? t(key, params) : key);
      return buildReport({
        entries: coachEntries,
        marks,
        tr,
        describe: (a) => describeReplayAction(state, a, locale).title,
        termLabel: (key) => tr(`coach.term.${key}`),
        num: (n) => fmtNumber(n, locale),
        bot: {
          deckId: (isOnline ? online?.room?.botDeckId : botDeckId) ?? null,
          deckName: (isOnline ? online?.room?.botDeckName : botDeckName) ?? null,
          ...leaderOf(botSeat),
        },
        opponent: { name: state.players[human].name, ...leaderOf(human) },
        result: { turn: state.turn, over: state.phase === 'gameover', ...(state.phase === 'gameover' ? { botWon: state.winner === null ? null : state.winner === botSeat } : {}) },
        matchId: reportMatch,
        level: effectiveBotLevel ? t(BOT_LEVEL_LABEL[effectiveBotLevel]) : null,
        rating,
        comment,
      });
    },
    [human, state, coachEntries, marks, t, locale, isOnline, online?.room?.botDeckId, online?.room?.botDeckName, botDeckId, botDeckName, reportMatch, effectiveBotLevel],
  );
  const coachReport = useMemo(() => (coachOn ? buildBotReport() : ''), [coachOn, buildBotReport]);
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
  /** Os atalhos de teclado estão valendo agora: o Esc passa a ser o deles (`onShortcut`). */
  const shortcutsLive = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !shortcutsLive.current) {
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

  // Atalhos: a carta escolhida num turno não fica valendo para o A, o H e o X do turno seguinte.
  useEffect(() => {
    if (shortcutsOn) setSelected(null);
  }, [turnKey, shortcutsOn]);

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
  /**
   * No seu turno, o Líder e os Personagens em pé que não têm o que fazer (não atacam nem têm habilidade para
   * ativar: acabaram de entrar, é o primeiro turno, um efeito proíbe) ficam apagados, para os que ainda podem
   * agir saltarem à vista. A lista vem das ações legais; enquanto a jogada não está com você (um ataque em
   * andamento, um efeito resolvendo) vale a última deste turno, para a mesa não piscar a cada ataque.
   *
   * No turno do oponente (e, para quem assiste ou vê um replay, no de qualquer jogador) ficam apagados os
   * Personagens dele que entraram em campo neste turno e não atacam nele; os com [Rush] não (ver
   * `enteredWithoutRush`).
   */
  const actable = useMemo(() => {
    if (!myTurnIdle) return null;
    const out = new Set<string>();
    for (const a of legal) {
      if (a.type === 'attack') out.add(a.attacker);
      else if (a.type === 'activate') out.add(a.uid);
    }
    return out;
  }, [myTurnIdle, legal]);
  const lastActable = useRef<{ turn: number; uids: Set<string> } | null>(null);
  if (actable) lastActable.current = { turn: state.turn, uids: actable };
  const canActNow = actable ?? (lastActable.current?.turn === state.turn ? lastActable.current.uids : null);
  const inert = (uid: string): Highlight => {
    if (state.phase !== 'main') return null;
    if (state.activePlayer !== human) return enteredWithoutRush(state, uid) ? 'inert' : null;
    if (!canActNow || canActNow.has(uid)) return null;
    const at = locate(state, uid);
    return at && at.player === human && at.zone !== 'stage' && !at.fc.rested ? 'inert' : null;
  };
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
    return t(`game.hintTargets${where}${ordered}${quickChoice ? 'Quick' : ''}` as const);
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
      return inert(uid);
    }
    if (myPending) {
      if (myPending.kind === 'selectTargets') {
        if (picked.includes(uid)) return 'selected';
        if (myPending.options.includes(uid)) return 'option';
        if (myPending.shown?.includes(uid)) return 'disabled';
      }
      if (myPending.kind === 'counter' && picked.includes(uid)) return 'selected';
      // Etapa de Counter: o valor de cada carta salta à vista pela cor (+1000 azul, +2000 ou mais vermelho). O
      // Evento [Counter] vai em roxo com o poder que o efeito dá agora (ou tira do oponente); o que não é de
      // poder (devolver à mão, virar…) fica com o destaque comum.
      if (myPending.kind === 'counter' && myPending.options.includes(uid)) {
        const value = counterValue(state, uid);
        if (value > 0) return value >= 2000 ? 'counter2' : 'counter1';
        return eventCounterPower(state, uid) !== 0 ? 'counterEvent' : 'option';
      }
      if (myPending.kind === 'block' && myPending.options.includes(uid)) return 'option';
    }
    if (state.battle) {
      if (uid === state.battle.attacker) return 'attacker';
      if (uid === state.battle.target) return 'target';
    }
    if (mode?.kind === 'attack') {
      if (uid === mode.attacker) return 'selected';
      if (has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) return 'option';
      return inert(uid);
    }
    // DON!! marcados: quem pode recebê-los brilha; o resto da mesa segue com os destaques normais.
    if (mode?.kind === 'don' && canReceiveDon(uid)) return 'option';
    // Tela estreita: a carta tocada abre por cima da mesa e o contorno não aparece; com os atalhos, a tecla escolhe sem abrir.
    if (uid === selected && !wide && !shortcutsOn) return null;
    if (uid === selected) return 'selected';
    if (canPlay(uid)) return 'playable';
    if (canAttackWith(uid)) return 'ready';
    return inert(uid);
  };

  const onCard = (uid: string) => {
    if (myPending) {
      if (myPending.kind === 'selectTargets' && myPending.options.includes(uid)) {
        const p = picked;
        const next = p.includes(uid) ? p.filter((x) => x !== uid) : myPending.max === 1 ? [uid] : p.length < myPending.max ? [...p, uid] : p;
        setPicked(next);
        // Sem "Confirmar ações": a escolha completa (todos os alvos que dá para marcar) sai na hora. Com menos
        // do que o máximo ("até 2", marcou 1), o botão de confirmar continua valendo.
        if (quickChoice && next.length > p.length && next.length === Math.min(myPending.max, myPending.options.length)) {
          dispatch({ type: 'choose', player: human!, uids: next });
        }
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

  // ------------------------------------------------------------ atalhos de teclado

  const gameRef = useRef<HTMLDivElement>(null);
  /**
   * Janelas por cima da mesa com as próprias teclas (o menu, o histórico, o resumo do fim, o relato, a carta
   * ampliada do histórico, as cartas reveladas…): enquanto uma delas está aberta, os atalhos não valem. Com a
   * pesquisa do histórico (a lupa) aberta também não, mesmo com o foco fora do campo.
   */
  const covered =
    logSearches > 0 ||
    intro ||
    reporting ||
    calling ||
    deckOf !== null ||
    logCard !== null ||
    deckCard !== null ||
    reveals.length > 0 ||
    (over && showResult) ||
    sheet === 'menu' ||
    sheet === 'layout' ||
    sheet === 'log' ||
    sheet === 'coach';
  const shortcutsActive = shortcutsOn && !covered;
  shortcutsLive.current = shortcutsActive;
  /**
   * Atalhos de teclado (opção "Atalhos de teclado"; a lista para quem joga está em `ShortcutsHelp`).
   *
   * As teclas de carta (Q W E R T e L) escolhem a carta sem abri-la; A, H e X agem sobre a carta escolhida (ou a
   * aberta). Numa escolha de alvo (ataque, efeito, bloqueio, DON!! marcados) a tecla vale como o toque na carta,
   * e passa para a do oponente quando a sua não é uma opção. Enter, o cancelar do Esc e os números numa lista de
   * opções e o M ("Ver a mesa") apertam o botão que está na tela (`data-hotkey`), para valerem só quando ele vale e
   * com as mesmas proteções.
   */
  const onShortcut = (s: Shortcut): boolean => {
    const click = (selector: string) => {
      const button = gameRef.current?.querySelector<HTMLButtonElement>(`${selector}:not(:disabled)`);
      button?.click();
      return Boolean(button);
    };
    const top: PlayerId = bottom === 0 ? 1 : 0;
    const marking = human !== null && myTurnIdle && has((a) => a.type === 'attachDon') ? state.players[human].donActive : 0;
    const markDons = (count: number) => {
      audio.play('don-pick', { pitch: Math.min(6, count - 1) });
      setMode({ kind: 'don', picked: Array.from({ length: count }, (_, i) => i) });
    };
    /** A carta sobre a qual o A, o H e o X agem: a aberta, ou a escolhida pela tecla ou pelo clique. */
    const card = zoom ?? selected;
    switch (s.kind) {
      case 'endTurn':
        if (!myTurnIdle) return false;
        dispatch({ type: 'endTurn', player: human! });
        setMode(null);
        setSelected(null);
        setZoom(null);
        setSheet(null);
        return true;
      case 'confirm':
        // Vale para o que está por cima: a carta aberta, a folha da mão ou, sem nada aberto, a pergunta ou a faixa central.
        if (zoom) return click('.zoom [data-hotkey~="confirm"]');
        if (sheet) return sheet === 'hand' && click('.sheet [data-hotkey~="confirm"]');
        return click('[data-hotkey~="confirm"]');
      case 'cancel':
        if (zoom || sheet || mode) {
          setMode(null);
          setSelected(null);
          setZoom(null);
          setSheet(null);
          return true;
        }
        setSelected(null);
        return click('[data-hotkey~="cancel"]') || selected !== null;
      case 'trash': {
        const player = s.opponent ? top : bottom;
        const open = sheet !== null && typeof sheet === 'object' && sheet.trash === player;
        setZoom(null);
        setSheet(open ? null : { trash: player });
        return true;
      }
      case 'number': {
        if (zoom || sheet) return false;
        // Pergunta com uma lista de opções (qual DON!! devolver, que efeito usar…): o número escolhe a opção.
        const options = gameRef.current?.querySelectorAll<HTMLButtonElement>('[data-hotkey~="option"]');
        if (options?.length) {
          options[s.n - 1]?.click();
          return s.n <= options.length;
        }
        if (marking === 0) return false;
        markDons(Math.min(s.n, marking));
        return true;
      }
      case 'attachAll':
        if (sheet || !myTurnIdle) return false;
        if (card && canReceiveDon(card)) {
          attachDons(card, state.players[human!].donActive);
          setMode(null);
          setZoom(null);
          return true;
        }
        // Sem carta escolhida: marca todos, e a tecla da carta os anexa.
        if (marking === 0) return false;
        markDons(marking);
        return true;
      case 'peek':
        // "Ver a mesa" da pergunta aberta, ou "Voltar à pergunta" quando ela já está recolhida.
        return !zoom && !sheet && click('[data-hotkey~="peek"]');
      case 'attack':
        if (sheet || !card || !canAttackWith(card)) return false;
        setMode({ kind: 'attack', attacker: card });
        setZoom(null);
        return true;
      case 'ability': {
        if (sheet) return false;
        if (zoom) return click('.zoom .ability-plate');
        if (!selected || !myTurnIdle) return false;
        const abilities = legal.filter((a) => a.type === 'activate' && a.uid === selected);
        if (abilities.length === 0) return false;
        // Mais de uma habilidade: a carta abre para a escolha.
        if (abilities.length > 1) setZoom(selected);
        else {
          dispatch(abilities[0]);
          setSelected(null);
        }
        return true;
      }
      case 'card': {
        if (sheet) return false;
        const at = (p: PlayerId) => (s.slot === 'leader' ? state.players[p].leader.uid : (state.players[p].characters[s.slot]?.uid ?? null));
        /** A carta é um dos alvos que o jogo espera agora (de um efeito, do bloqueio, do ataque ou dos DON!! marcados). */
        const choosable = (uid: string | null): uid is string =>
          uid !== null &&
          (((myPending?.kind === 'selectTargets' || myPending?.kind === 'block') && myPending.options.includes(uid)) ||
            (mode?.kind === 'attack' && has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) ||
            (mode?.kind === 'don' && canReceiveDon(uid)));
        const mine = at(bottom);
        const theirs = at(top);
        const uid = s.opponent || (choosable(theirs) && !choosable(mine)) ? theirs : mine;
        if (uid === null) return false;
        if (choosable(uid)) {
          setZoom(null);
          onCard(uid);
          return true;
        }
        // Fora de uma escolha a tecla só escolhe a carta (o toque também sai do modo de ataque); de novo, abre ou fecha a carta.
        if (mode?.kind === 'attack') setMode(null);
        setZoom(uid === selected && zoom !== uid ? uid : null);
        setSelected(uid);
        return true;
      }
    }
  };
  useShortcuts(shortcutsActive, human !== null, onShortcut);

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
    // Na mão, a faixa que a carta erguida deixa a descoberto (o `::after` de `.hand-card.peek`) vale como a carta.
    const inHand = el.matches('[data-hand-uid]') ? el.querySelector<HTMLElement>('[data-uid]') : null;
    const dragEl = el.closest<HTMLElement>('[data-drag]') ?? (inHand?.dataset.drag ? inHand : null);
    const cardEl = el.closest<HTMLElement>('[data-uid]') ?? inHand;
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
        if (el.closest('.bottom-strip, [data-drop="hand"]')) return { over: 'hand', insert: handSlot(x) };
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
            className={['round-btn', 'log-btn', shownPanel === 'log' ? 'on' : ''].join(' ')}
            onClick={() => (panelLogOn ? setPanel(panel === 'log' ? null : 'log') : setSheet('log'))}
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
    !broadcast && (!wide || (online && !watching) || coachOn) ? (
      <>
        {!wide && (
          <button className="round-btn log-btn" onClick={() => setSheet('log')} aria-label={t('game.logLabel')} title={t('game.log')}>
            <Icon name="history" size={20} />
            {logNew > 0 && <span className="corner-badge">{logNew > 99 ? '99+' : logNew}</span>}
          </button>
        )}
        {/*
          Painel do treinador (marcar jogada errada do bot): em toda mesa, ao lado do chat. No desktop com o painel
          lateral ele abre a aba do painel; na mesa larga sem painel lateral (onde a aba não tinha como abrir), a folha.
        */}
        {coachOn && (
          <button
            className={['round-btn', 'coach-btn', shownPanel === 'coach' ? 'on' : ''].join(' ')}
            onClick={() => (playerPanel && panelLogOn ? setPanel(panel === 'coach' ? null : 'coach') : setSheet('coach'))}
            aria-label={t('coach.panel')}
            aria-pressed={shownPanel === 'coach'}
            title={t('coach.panel')}
          >
            <Icon name="bot" size={20} />
            {coachEntries.length > 0 && <span className="corner-badge">{coachEntries.length > 99 ? '99+' : coachEntries.length}</span>}
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
    <PickOrderContext.Provider value={pickOrder}>
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
        playerPanel && !shownPanel ? 'no-panel' : '',
        wideBoard ? 'wide-board' : '',
      ].join(' ')}
      style={wideBoard ? vars({ '--panel-w': `${panelWidth(layout)}px` }) : undefined}
      ref={gameRef}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="board-col" ref={boardCol}>
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
        ) : wideBoard ? (
          <WideBoard
            state={state}
            bottom={bottom}
            revealBottom={!handsSecret}
            revealTop={(showBotHand || Boolean(game.openOpponentHand)) && !handsSecret}
            layout={layout}
            corner={corner}
            tools={sideTools}
            bannerExtra={online ? (p) => <OnlineBanner online={online} player={p} /> : undefined}
            handOrder={handView}
            onExpandHand={human !== null && !handsSecret ? () => setSheet('hand') : undefined}
            onSortHand={human !== null && !handsSecret && myHand.length > 1 ? sortHand : undefined}
            turnPulse={animate && myTurnIdle}
            handHint={handHint}
            lifted={lifted}
            ghost={drag?.kind === 'hand' ? drag.uid : null}
            center={centerBand}
            sideLeft={layout.sideHover ? <CardDetail state={state} uid={detailUid} /> : undefined}
            sideRight={layout.sideLog ? <LogPanel state={state} fresh={replay?.logFrom} onCardZoom={setLogCard} onSearching={onLogSearching} /> : undefined}
            overlay={layout.hover.show && layout.hover.position === 'center' && hovered ? <CardDetail state={state} uid={hovered} /> : undefined}
            {...handlers}
          />
        ) : (
        <Board
          state={state}
          bottom={bottom}
          revealBottom={!handsSecret}
          revealTop={(showBotHand || Boolean(game.openOpponentHand)) && !handsSecret}
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
          <div key={banner.key} className={['turn-banner', banner.mine ? 'mine' : 'theirs', showy ? 'sweep' : ''].join(' ')}>
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
          quick={quickChoice}
          onCard={onCard}
          highlight={highlight}
        />

        <AttackArrow state={state} drag={drag} mode={mode} hovered={hovered} legal={legal} />

        {wideBoard && layout.hover.show && layout.hover.position === 'tooltip' && hovered && !drag && <HoverTip state={state} uid={hovered} />}

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
            attachAll={!tutorial}
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
              <button className="btn" onClick={() => (streamer || (playerPanel && panelLogOn) ? openPanel('log') : setSheet('log'))}>
                {t('game.logBtn')}
              </button>
              {layoutChoice && (
                <button className="btn" onClick={() => setSheet('layout')}>
                  {t('game.layoutBtn')}
                </button>
              )}
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
              {sandbox && onRematch && (
                <button
                  className="btn"
                  onClick={() => {
                    setSheet(null);
                    onRematch();
                  }}
                >
                  {t('sandbox.restart')}
                </button>
              )}
              {(over || replay) && !tutorial && !sandbox && (
                <button className="btn" onClick={game.downloadReplay}>
                  {t('game.downloadReplay')}
                </button>
              )}
              {callJudge && (
                <button className="btn judge-call" onClick={callJudge}>
                  {t('judge.call')}
                </button>
              )}
              {human !== null && state.phase === 'main' && !tutorial && !sandbox && (
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
                {tutorial ? (tutorial.exitLabel ?? t('tutorial.exitLesson')) : sandbox ? t('sandbox.backToEditor') : toTournament ? t('game.exitToTournament') : exitTo === 'back' ? t('game.exitBack') : t('game.exitToMenu')}
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
            {(kind === 'bot' || sandbox) && !tutorial && (
              <label className="check">
                <input type="checkbox" checked={showBotHand} onChange={(e) => setShowBotHand(e.target.checked)} /> {t('game.showBotHand')}
              </label>
            )}
            <div className="sheet-section">
              <SettingsControls />
            </div>
          </SheetFrame>
        )}

        {sheet === 'layout' && <BoardLayoutEditor state={state} onClose={() => setSheet(null)} />}

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
            <LogPanel state={state} fresh={replay?.logFrom} onCardZoom={setLogCard} onSearching={onLogSearching} />
          </SheetFrame>
        )}
        {sheet === 'coach' && coachOn && (
          <SheetFrame title={t('coach.panel')} onClose={() => setSheet(null)}>
            <CoachPanel state={state} entries={coachEntries} marks={marks} report={coachReport} onToggle={toggleMark} onUpdate={updateMark} />
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
            human={sandbox ? null : human}
            actions={game.actions()}
            onExit={bare ? undefined : onExit}
            exitLabel={sandbox ? t('sandbox.backToEditor') : toTournament ? t('game.backToTournament') : exitTo === 'back' ? t('common.back') : t('game.backToMenu')}
            onRematch={
              replay
                ? () => {
                    replay.seek(0);
                    game.setPaused(() => false);
                  }
                : onRematch
            }
            rematchLabel={
              (replay ? t('game.watchAgain') : sandbox ? t('sandbox.restart') : rematchLabel) ??
              (online && human !== null ? (online.room?.rematch[human] ? t('game.waitingOpponent') : t('game.askRematch')) : undefined)
            }
            onReplay={online?.room?.tournament || bare || sandbox ? undefined : game.downloadReplay}
            onLog={() => setSheet('log')}
            onClose={replay ? () => setShowResult(false) : undefined}
            extra={online ? <OnlineResultInfo online={online} /> : undefined}
            onReport={reportMatch !== null ? () => setReporting(true) : undefined}
            onDeck={setDeckOf}
            feedback={
              coachOn ? (
                <BotReport
                  matchId={reportMatch}
                  level={effectiveBotLevel}
                  marks={feedbackMarks(marks, coachEntries, (a) => describeReplayAction(state, a, locale).title)}
                  build={buildBotReport}
                />
              ) : undefined
            }
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
              {tutorial.exitLabel ?? t('tutorial.exitLesson')}
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
          {panel === 'log' && <LogPanel state={state} onCardZoom={setLogCard} onSearching={onLogSearching} />}
          {panel === 'matches' && spectator?.onSwitchRoom && <MatchesPanel currentId={spectator.roomId ?? null} onWatch={spectator.onSwitchRoom} />}
          {panel === 'deck' && spectator?.roomId && <DeckPanel roomId={spectator.roomId} onZoom={setDeckCard} />}
        </aside>
      )}
      {playerPanel && shownPanel && (
        <aside className="side-panel tabbed-panel player-panel" aria-label={t('game.panelLabel')}>
          <div className="panel-tabs">
            <div className="seg small" role="tablist">
              <button type="button" role="tab" aria-selected={panel !== 'deck' && panel !== 'coach'} className={panel !== 'deck' && panel !== 'coach' ? 'on' : ''} onClick={() => setPanel('log')}>
                {t('game.log')}
              </button>
              {loadOwnDeck && (
                <button type="button" role="tab" aria-selected={panel === 'deck'} className={panel === 'deck' ? 'on' : ''} onClick={() => setPanel('deck')}>
                  {t('game.decklist')}
                </button>
              )}
              {coachOn && (
                <button type="button" role="tab" aria-selected={panel === 'coach'} className={panel === 'coach' ? 'on' : ''} onClick={() => setPanel('coach')}>
                  {t('coach.panel')}
                  {coachEntries.length > 0 && <span className="dk-count">{coachEntries.length}</span>}
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
                {sandbox ? t('sandbox.backToEditor') : toTournament ? t('game.sideTournament') : exitTo === 'back' ? t('game.sideBack') : t('game.sideMenu')}
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
          ) : panel === 'coach' && coachOn ? (
            <CoachPanel state={state} entries={coachEntries} marks={marks} report={coachReport} onToggle={toggleMark} onUpdate={updateMark} />
          ) : (
            <>
              {(!wideBoard || (layout.hover.show && layout.hover.position === 'panel')) && <CardDetail state={state} uid={detailUid} />}
              {(!wideBoard || (layout.log.show && layout.log.position === 'panel')) && <LogPanel state={state} fresh={replay?.logFrom} onCardZoom={setLogCard} onSearching={onLogSearching} />}
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
          clip={clipSource}
        />
      )}
    </div>
    </PickOrderContext.Provider>
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
