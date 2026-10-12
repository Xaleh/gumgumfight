import { useEffect, useState } from 'react';
import { api, isAdmin, isDev, type OnlineSeat, type WatchTarget } from './api';
import { audio } from './audio';
import { useAuth } from './auth';
import { Admin } from './components/Admin';
import { Coverage } from './components/Coverage';
import { DeckBuilder } from './components/DeckBuilder';
import { GameScreen, OnlineGameScreen, WatchGameScreen } from './components/GameScreen';
import { Learn } from './components/Learn';
import { Lesson } from './components/Lesson';
import { Menu } from './components/Menu';
import { Stats } from './components/Stats';
import { Tournaments } from './components/Tournaments';
import { Watch } from './components/Watch';
import { syncTutorialProgress } from './game/tutorial/progress';
import type { GameSetup } from './game/useGame';
import { usePushSync, useWakeLock } from './pwa';
import { useSettings } from './settings';

type Screen =
  | { name: 'menu' }
  | { name: 'builder' }
  | { name: 'coverage' }
  | { name: 'stats' }
  | { name: 'admin' }
  | { name: 'watch-list' }
  /** Tutorial "Aprender a jogar": a lista de lições e uma lição aberta. */
  | { name: 'learn' }
  | { name: 'lesson'; id: string }
  /** `tournament`: veio da página de um torneio (e volta para ela); `home`: veio do "Ao vivo agora" do menu. */
  | { name: 'watch'; target: WatchTarget; tournament?: string; home?: boolean }
  | { name: 'tournaments'; id?: string }
  /** `back`: tela para onde "Voltar" leva (replay aberto da página de um torneio ou da administração). */
  | { name: 'game'; setup: GameSetup; key: number; back?: Screen }
  | { name: 'online'; seat: OnlineSeat; tournament?: string };

/** Partida online aberta nesta aba: ao recarregar a página, volta direto para ela. */
const OPEN_MATCH = 'gumgum.openMatch';

function savedScreen(): Screen {
  try {
    const s = JSON.parse(sessionStorage.getItem(OPEN_MATCH) ?? 'null') as Screen | null;
    const tournament = s && 'tournament' in s && typeof s.tournament === 'string' ? s.tournament : undefined;
    if (s?.name === 'online' && typeof s.seat?.roomId === 'string' && typeof s.seat.token === 'string') {
      return { name: 'online', seat: { roomId: s.seat.roomId, token: s.seat.token }, tournament };
    }
    if (s?.name === 'watch' && typeof s.target?.roomId === 'string') {
      return { name: 'watch', target: { roomId: s.target.roomId, hands: Boolean(s.target.hands) }, tournament };
    }
  } catch {
    /* sem armazenamento */
  }
  return { name: 'menu' };
}

/** Parâmetros dos endereços abertos pelas notificações: a partida online e a página do torneio. */
const ROOM_PARAM = 'partida';
const TOURNAMENT_PARAM = 'torneio';

export function App() {
  const [screen, setScreen] = useState<Screen>(savedScreen);
  useEffect(() => {
    try {
      if (screen.name === 'online' || screen.name === 'watch') sessionStorage.setItem(OPEN_MATCH, JSON.stringify(screen));
      else sessionStorage.removeItem(OPEN_MATCH);
    } catch {
      /* sem armazenamento */
    }
  }, [screen]);
  // Música do menu em toda tela fora da mesa (a mesa troca para a música da partida ao abrir).
  const inMatch = screen.name === 'game' || screen.name === 'online' || screen.name === 'watch' || screen.name === 'lesson';
  useEffect(() => {
    if (!inMatch) audio.music('menu');
  }, [inMatch]);
  const settings = useSettings();
  const user = useAuth().user;
  const role = user?.role;
  // Progresso do tutorial: junta navegador e servidor ao abrir e quando a conta muda.
  useEffect(() => {
    void syncTutorialProgress();
  }, [user?.id]);
  // Na mesa (jogando, assistindo ou vendo um replay), a tela do celular não apaga.
  useWakeLock(inMatch && settings.keepAwake);
  usePushSync({
    serverKey: settings.pushKey,
    enabled: settings.notify,
    prefs: { locale: settings.locale, matches: settings.notifyMatches, tournaments: settings.notifyTournaments },
    userId: user?.id ?? null,
    onRevoked: () => settings.update({ notify: false }),
  });

  // Toque numa notificação: abre a partida online (se ainda estiver aberta) ou a página do
  // torneio. Com o app fechado, o endereço chega na URL; com ele aberto, numa mensagem do service worker.
  useEffect(() => {
    const open = (href: string) => {
      const url = new URL(href, location.origin);
      const room = url.searchParams.get(ROOM_PARAM);
      const tournament = url.searchParams.get(TOURNAMENT_PARAM);
      if (room) {
        api.online
          .active()
          .then((rooms) => {
            const r = rooms.find((x) => x.roomId === room);
            if (r) setScreen((s) => (s.name === 'online' && s.seat.roomId === r.roomId ? s : { name: 'online', seat: { roomId: r.roomId, token: r.token } }));
          })
          .catch(() => undefined);
      } else if (tournament) setScreen({ name: 'tournaments', id: tournament });
    };
    const here = new URL(location.href);
    if (here.searchParams.has(ROOM_PARAM) || here.searchParams.has(TOURNAMENT_PARAM)) {
      open(here.href);
      here.searchParams.delete(ROOM_PARAM);
      here.searchParams.delete(TOURNAMENT_PARAM);
      history.replaceState(null, '', here.toString());
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'gumgum:open' && typeof e.data.url === 'string') open(e.data.url);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
  const dev = isDev(role);
  if (screen.name === 'builder') return <DeckBuilder onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'learn') return <Learn onExit={() => setScreen({ name: 'menu' })} onLesson={(id) => setScreen({ name: 'lesson', id })} />;
  if (screen.name === 'lesson') {
    return (
      <Lesson
        key={screen.id}
        id={screen.id}
        onHub={() => setScreen({ name: 'learn' })}
        onLesson={(id) => setScreen({ name: 'lesson', id })}
        onBuildDecks={() => setScreen({ name: 'builder' })}
      />
    );
  }
  if (screen.name === 'coverage' && dev) return <Coverage onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'stats') return <Stats onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'admin' && isAdmin(role)) {
    return (
      <Admin
        onExit={() => setScreen({ name: 'menu' })}
        onReplay={(setup) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'admin' } })}
      />
    );
  }
  if (screen.name === 'tournaments') {
    return (
      <Tournaments
        initialId={screen.id}
        onExit={() => setScreen({ name: 'menu' })}
        onPlay={(seat, tournament) => setScreen({ name: 'online', seat, tournament })}
        onWatch={(target, tournament) => setScreen({ name: 'watch', target, tournament })}
        onReplay={(setup, tournament) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'tournaments', id: tournament } })}
      />
    );
  }
  if (screen.name === 'watch-list') {
    return <Watch onExit={() => setScreen({ name: 'menu' })} onWatch={(target) => setScreen({ name: 'watch', target })} />;
  }
  if (screen.name === 'watch') {
    return (
      <WatchGameScreen
        key={screen.target.roomId}
        target={screen.target}
        canHands={role === 'streamer' || isAdmin(role)}
        onExit={() =>
          setScreen(screen.tournament ? { name: 'tournaments', id: screen.tournament } : screen.home ? { name: 'menu' } : { name: 'watch-list' })
        }
        onSwitch={(target) => setScreen({ name: 'watch', target, tournament: screen.tournament, home: screen.home })}
      />
    );
  }
  if (screen.name === 'online') {
    return (
      <OnlineGameScreen
        key={screen.seat.roomId}
        seat={screen.seat}
        onExit={() => setScreen(screen.tournament ? { name: 'tournaments', id: screen.tournament } : { name: 'menu' })}
        onSwitch={(seat) => setScreen({ name: 'online', seat, tournament: screen.tournament })}
      />
    );
  }
  if (screen.name === 'game') {
    const { setup } = screen;
    return (
      <GameScreen
        key={screen.key}
        setup={setup}
        onExit={() => setScreen(screen.back ?? { name: 'menu' })}
        onRematch={
          setup.mode === 'replay'
            ? undefined
            : () =>
                setScreen({
                  name: 'game',
                  key: Date.now(),
                  setup: { ...setup, notice: undefined, config: { ...setup.config, seed: Math.floor(Math.random() * 1_000_000) } },
                })
        }
      />
    );
  }
  return (
    <Menu
      onStart={(setup) => setScreen({ name: 'game', setup, key: Date.now() })}
      onBuildDecks={() => setScreen({ name: 'builder' })}
      onLearn={() => setScreen({ name: 'learn' })}
      onCoverage={dev ? () => setScreen({ name: 'coverage' }) : undefined}
      onStats={() => setScreen({ name: 'stats' })}
      onOnline={(seat) => setScreen({ name: 'online', seat })}
      onWatch={() => setScreen({ name: 'watch-list' })}
      onWatchRoom={(target) => setScreen({ name: 'watch', target, home: true })}
      onTournaments={(id) => setScreen({ name: 'tournaments', id })}
      onTournamentMatch={(seat, tournament) => setScreen({ name: 'online', seat, tournament })}
      onAdmin={isAdmin(role) ? () => setScreen({ name: 'admin' }) : undefined}
      dev={dev}
    />
  );
}
