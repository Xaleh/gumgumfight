import { useState } from 'react';
import { Coverage } from './components/Coverage';
import { DeckBuilder } from './components/DeckBuilder';
import { GameScreen } from './components/GameScreen';
import { Menu } from './components/Menu';
import { Stats } from './components/Stats';
import type { GameSetup } from './game/useGame';

type Screen =
  | { name: 'menu' }
  | { name: 'builder' }
  | { name: 'coverage' }
  | { name: 'stats' }
  | { name: 'game'; setup: GameSetup; key: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  if (screen.name === 'builder') return <DeckBuilder onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'coverage') return <Coverage onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'stats') return <Stats onExit={() => setScreen({ name: 'menu' })} />;
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
    />
  );
}
