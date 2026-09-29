import { useState } from 'react';
import { GameScreen } from './components/GameScreen';
import { Menu } from './components/Menu';
import type { GameSetup } from './game/useGame';

export function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [gameKey, setGameKey] = useState(0);
  if (!setup) {
    return (
      <Menu
        onStart={(s) => {
          setSetup(s);
          setGameKey((k) => k + 1);
        }}
      />
    );
  }
  return <GameScreen key={gameKey} setup={setup} onExit={() => setSetup(null)} />;
}
