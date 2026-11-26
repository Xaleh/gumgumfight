import { type Action, type GameConfig, type GameState, type PlayerId, spoilerRule } from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api, type CoachEntry, currentSpoilerSet, modeLabel, type OnlineSeat, type RoomDecks, type WatchTarget, whyNotPlayable } from '../api';
import { useAuth } from '../auth';
import type { EmbedLayout } from '../embed';
import { useEmbedBridge } from '../game/useEmbedBridge';
import { buildSetup } from '../game/setup';
import { type GameSetup, useGame } from '../game/useGame';
import { useT } from '../i18n';
import { useOnlineGame } from '../game/useOnlineGame';
import { useSettings } from '../settings';
import { DeckConfirm } from './DeckConfirm';
import { ErrorBoundary } from './ErrorBoundary';
import { type ReplayControls } from './ReplayBar';
import { BroadcastIdle, OnlineWaiting, seriesAfter } from './Online';
import { type ExitTo, Table } from './table/Table';

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

export type TableKind = GameSetup['mode'] | 'online';

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

export function downloadReplay(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gumgum-replay-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
