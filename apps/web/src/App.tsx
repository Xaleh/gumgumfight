import { useState } from 'react';
import { DeckBuilder } from './components/DeckBuilder';
import { GameScreen } from './components/GameScreen';
import { Menu } from './components/Menu';
import type { GameSetup } from './game/useGame';

type Screen = { name: 'menu' } | { name: 'builder' } | { name: 'game'; setup: GameSetup; key: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  if (screen.name === 'builder') return <DeckBuilder onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'game') {
    return <GameScreen key={screen.key} setup={screen.setup} onExit={() => setScreen({ name: 'menu' })} />;
  }
  return (
    <Menu
      onStart={(setup) => setScreen({ name: 'game', setup, key: Date.now() })}
      onBuildDecks={() => setScreen({ name: 'builder' })}
    />
  );
}
