import { useEffect, useState } from 'react';
import type { OnlineSeat, WatchTarget } from './api';
import { useAuth } from './auth';
import { Admin } from './components/Admin';
import { Coverage } from './components/Coverage';
import { DeckBuilder } from './components/DeckBuilder';
import { GameScreen, OnlineGameScreen, WatchGameScreen } from './components/GameScreen';
import { Menu } from './components/Menu';
import { Stats } from './components/Stats';
import { Watch } from './components/Watch';
import type { GameSetup } from './game/useGame';

type Screen =
  | { name: 'menu' }
  | { name: 'builder' }
  | { name: 'coverage' }
  | { name: 'stats' }
  | { name: 'admin' }
  | { name: 'watch-list' }
  | { name: 'watch'; target: WatchTarget }
  | { name: 'game'; setup: GameSetup; key: number }
  | { name: 'online'; seat: OnlineSeat };

/** Partida online aberta nesta aba: ao recarregar a página, volta direto para ela. */
const OPEN_MATCH = 'gumgum.openMatch';

function savedScreen(): Screen {
  try {
    const s = JSON.parse(sessionStorage.getItem(OPEN_MATCH) ?? 'null') as Screen | null;
    if (s?.name === 'online' && typeof s.seat?.roomId === 'string' && typeof s.seat.token === 'string') return s;
    if (s?.name === 'watch' && typeof s.target?.roomId === 'string') return { name: 'watch', target: { roomId: s.target.roomId, hands: Boolean(s.target.hands) } };
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
  if (screen.name === 'builder') return <DeckBuilder onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'coverage') return <Coverage onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'stats') return <Stats onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'admin') return <Admin onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'watch-list') {
    return <Watch onExit={() => setScreen({ name: 'menu' })} onWatch={(target) => setScreen({ name: 'watch', target })} />;
  }
  if (screen.name === 'watch') {
    return (
      <WatchGameScreen
        key={screen.target.roomId}
        target={screen.target}
        canHands={role === 'streamer' || role === 'admin'}
        onExit={() => setScreen({ name: 'watch-list' })}
        onSwitch={(target) => setScreen({ name: 'watch', target })}
      />
    );
  }
  if (screen.name === 'online') {
    return (
      <OnlineGameScreen
        key={screen.seat.roomId}
        seat={screen.seat}
        onExit={() => setScreen({ name: 'menu' })}
        onSwitch={(seat) => setScreen({ name: 'online', seat })}
      />
    );
  }
  if (screen.name === 'game') {
    const { setup } = screen;
    return (
      <GameScreen
        key={screen.key}
        setup={setup}
        onExit={() => setScreen({ name: 'menu' })}
        onRematch={
          setup.mode === 'replay'
            ? undefined
            : () =>
                setScreen({
                  name: 'game',
                  key: Date.now(),
                  setup: { ...setup, config: { ...setup.config, seed: Math.floor(Math.random() * 1_000_000) } },
                })
        }
      />
    );
  }
  return (
    <Menu
      onStart={(setup) => setScreen({ name: 'game', setup, key: Date.now() })}
      onBuildDecks={() => setScreen({ name: 'builder' })}
      onCoverage={() => setScreen({ name: 'coverage' })}
      onStats={() => setScreen({ name: 'stats' })}
      onOnline={(seat) => setScreen({ name: 'online', seat })}
      onWatch={() => setScreen({ name: 'watch-list' })}
      onAdmin={role === 'admin' ? () => setScreen({ name: 'admin' }) : undefined}
    />
  );
}
