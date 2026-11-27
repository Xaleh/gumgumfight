// A mesa da partida: o componente `Table`, que as telas de entrada (../GameScreen.tsx) abrem para a partida contra o
// bot, online, o replay, quem assiste, a transmissão e as lições do tutorial.

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
  HIDDEN_CARD,
  legalActions,
  locate,
  type PlayerId,
  zoneOf,
} from '@gumgum/engine';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isAdmin, isTeam, type LiveRoom, type RoomDecks, seesHands } from '../../api';
import { BotReport } from '../BotFeedback';
import { CoachPanel } from '../CoachPanel';
import { useAuth } from '../../auth';
import { usePreloadCardImages } from '../../game/preloadImages';
import { useBoardSize } from '../../hooks/useBoardSize';
import { feedbackMarks } from '../../game/botReport';
import { describeReplayAction } from '../../game/replayCue';
import { audio } from '../../audio';
import { useT, useTryT } from '../../i18n';
import { enteredWithoutRush } from '../../game/freshCharacter';
import { useMatchAudio } from '../../game/useMatchAudio';
import { type OnlineGame } from '../../game/useOnlineGame';
import { useSettings } from '../../settings';
import { Board, HandFan, handIsKnown, vars } from '../Board';
import { WideBoard } from '../WideBoard';
import { BoardLayoutEditor } from '../BoardLayoutEditor';
import { effectiveLayout, panelWidth } from '../../game/boardLayout';
import { LateralBoard } from '../LateralBoard';
import { StaticCardZoom } from '../CardInfo';
import { QueueChip } from '../QueueDock';
import { CardView, type Highlight, PickOrderContext } from '../CardView';
import { DiceRoll } from '../DiceRoll';
import { GameResult } from '../GameResult';
import { Icon } from '../Icons';
import { useBoardMotion } from '../Motion';
import { ReplayBar } from '../ReplayBar';
import { PlayHighlight } from '../PlayHighlight';
import { ReplayCue } from '../ReplayCue';
import { ReportModal } from '../ReportModal';
import {
  BroadcastTag,
  ChatBar,
  ChatBubbles,
  HandsSharedTag,
  OnlineBanner,
  OnlineClock,
  OnlineResultInfo,
  OnlineStatus,
  SpectatorBar,
  SpectatorCount,
} from '../Online';
import { CallJudgeSheet, JudgePanel, PauseBanner } from '../Judge';
import { type Drag, type Mode, type Panel, promptText, type Sheet, useMediaQuery } from './shared';
import { AttackArrow, BattleInfo, CenterBand, CoachTipPill, DonBar } from './CenterBand';
import { CancelButton, DecisionButton, TargetRequest, targetsOnTable, UndoPill } from './decisions';
import { Prompt } from './Prompt';
import { CardDetail, CardZoom, HoverTip, RevealedCards, SheetFrame } from './CardZoom';
import { LogPanel } from './LogPanel';
import { TableMenu } from './TableMenu';
import { TableSidePanels } from './TableSidePanels';
import { useBotCoach } from './useBotCoach';
import { useHandOrder } from './useHandOrder';
import { useOpenHands } from './useOpenHands';
import { useTableGestures } from './useTableGestures';
import { useTableNotices } from './useTableNotices';
import { useTableShortcuts } from './useTableShortcuts';
import type { TableBroadcast, TableEmbed, TableGame, TableKind, TableTutorial } from '../GameScreen';

/** Decklist de um jogador no fim da partida: desenhada em canvas, fora do bundle principal (junto com o kit de divulgação). */
const MatchDeck = lazy(() => import('../MatchDeck'));

/** Para onde o botão de sair da mesa leva: o torneio, o menu ou a tela anterior (ex.: a lista "Assistir"). */
export type ExitTo = 'tournament' | 'menu' | 'back';

export function Table({
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
  const { notice, setNotice, reveals, setReveals } = useTableNotices({ game, tryT, startNotice, tutorial: Boolean(tutorial), broadcast: Boolean(broadcast), spectator });
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
  const { openHands, toggleHand, fanPlayers } = useOpenHands(online, spectator);
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
  /**
   * Mesa lateral: a logo de quem transmite (perfis Streamer, Organizador e Admin) no centro do playmat, no lugar da padrão.
   * Vale só para a tela desta conta; o replay embutido num app parceiro fica sempre com a padrão.
   */
  const playmatLogo = lateral && !embed ? (user?.playmatLogo ?? null) : null;
  /** Painel do treinador: no treino contra o Bot do Time, para quem é do Time. */
  const coachOn = botMatch && isTeam(user) && effectiveBotLevel === 'team' && human !== null && !watching && kind !== 'replay' && !tutorial;
  const { marks, toggleMark, updateMark, coachEntries, buildBotReport, coachReport } = useBotCoach({
    game, t, locale, isOnline, online, botDeckId, botDeckName, reportMatch, effectiveBotLevel, coachOn,
  });
  /** Streamer, Organizador e Admin mandam a partida aberta para a tela de transmissão (menu da partida). */
  const canBroadcast = Boolean(online?.room && !broadcast && !tutorial && user && seesHands(user.role));
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

  // As mãos ficam viradas até o vencedor do sorteio escolher quem começa: ver a mão pesaria na escolha.
  const handsSecret = state.pending?.kind === 'chooseFirst';
  const myHand = state.players[bottom].hand;
  const { orderedHand, reorder, sortHand, setHandOrder } = useHandOrder(state, myHand);
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
  useTableShortcuts(shortcutsActive, {
    gameRef, state, human, bottom, myTurnIdle, has, legal, myPending, mode, zoom, selected, sheet,
    dispatch, setMode, setSelected, setZoom, setSheet, canReceiveDon, canAttackWith, attachDons, onCard,
  });

  // ------------------------------------------------------------ gestos: toque longo e arrastar

  /** Soltou o que arrastava num destino válido: joga, ataca, anexa ou devolve o DON!!, ou reordena a mão. */
  const onDrop = (d: Drag) => {
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

  const { onPointerDown, onClickCapture } = useTableGestures({ mode, dropValid, onCard, onDrop, setDrag, setLifted, setZoom, setMode });

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
      {/* Replay aberto por quem espera na fila: a busca minimizada (ao assistir, ela fica na barra do espectador). */}
      {!(spectator && online) && <QueueChip />}
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
        playmatLogo ? 'custom-logo' : '',
        streamer && panel ? 'with-panel' : '',
        playerPanel && !shownPanel ? 'no-panel' : '',
        wideBoard ? 'wide-board' : '',
      ].join(' ')}
      style={wideBoard ? vars({ '--panel-w': `${panelWidth(layout)}px` }) : playmatLogo ? vars({ '--lat-logo': `url("${playmatLogo}")` }) : undefined}
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
          <TableMenu
            game={game}
            kind={kind}
            tutorial={tutorial}
            embed={embed}
            spectator={spectator}
            onExit={onExit}
            onRematch={onRematch}
            exitTo={exitTo}
            streamer={streamer}
            lateral={lateral}
            playerPanel={playerPanel}
            panelLogOn={panelLogOn}
            layoutChoice={layoutChoice}
            hasOwnDeck={Boolean(loadOwnDeck)}
            canBroadcast={canBroadcast}
            sendToBroadcast={sendToBroadcast}
            callJudge={callJudge}
            showBotHand={showBotHand}
            setShowBotHand={setShowBotHand}
            setSheet={setSheet}
            openPanel={openPanel}
          />
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

      <TableSidePanels
        game={game}
        kind={kind}
        wide={wide}
        tutorial={tutorial}
        broadcast={Boolean(broadcast)}
        streamer={streamer}
        playerPanel={playerPanel}
        panel={panel}
        shownPanel={shownPanel}
        setPanel={setPanel}
        spectator={spectator}
        onExit={onExit}
        exitTo={exitTo}
        bare={bare}
        callJudge={callJudge}
        loadOwnDeck={loadOwnDeck}
        detailUid={detailUid}
        setLogCard={setLogCard}
        onLogSearching={onLogSearching}
        setDeckCard={setDeckCard}
        coachOn={coachOn}
        coachEntries={coachEntries}
        marks={marks}
        coachReport={coachReport}
        toggleMark={toggleMark}
        updateMark={updateMark}
        wideBoard={wideBoard}
        layout={layout}
      />

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
