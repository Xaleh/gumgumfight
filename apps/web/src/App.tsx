import { useEffect, useState } from 'react';
import { isAdmin, isDev, type OnlineSeat, type WatchTarget } from './api';
import { useAuth } from './auth';
import { Admin } from './components/Admin';
import { Coverage } from './components/Coverage';
import { DeckBuilder } from './components/DeckBuilder';
import { GameScreen, OnlineGameScreen, WatchGameScreen } from './components/GameScreen';
import { Menu } from './components/Menu';
import { Stats } from './components/Stats';
import { Tournaments } from './components/Tournaments';
import { Watch } from './components/Watch';
import type { GameSetup } from './game/useGame';

type Screen =
  | { name: 'menu' }
  | { name: 'builder' }
  | { name: 'coverage' }
  | { name: 'stats' }
  | { name: 'admin' }
  | { name: 'watch-list' }
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
  const role = useAuth().user?.role;
  const dev = isDev(role);
  if (screen.name === 'builder') return <DeckBuilder onExit={() => setScreen({ name: 'menu' })} />;
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
