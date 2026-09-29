import type { Action, CardData, PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type DeckSummary } from '../api';
import type { GameMode, GameSetup, ReplayFile } from '../game/useGame';

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

async function buildSetup(
  mode: GameMode,
  deckIds: [string, string],
  names: [string, string],
  seed: number,
  firstPlayer?: PlayerId,
  script?: Action[],
): Promise<GameSetup> {
  const [a, b] = await Promise.all(deckIds.map((id) => api.deck(id)));
  const cards = new Map<string, CardData>();
  for (const c of [...a.cards, ...b.cards]) cards.set(c.id, c);
  return {
    mode,
    deckIds,
    script,
    config: {
      seed,
      firstPlayer,
      cards: [...cards.values()],
      players: [
        { name: names[0], deck: a.deck, isBot: mode === 'demo' },
        { name: names[1], deck: b.deck, isBot: mode !== 'replay' },
      ],
    },
  };
}

export function Menu({ onStart }: { onStart: (s: GameSetup) => void }) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>('bot');
  const [deck0, setDeck0] = useState('');
  const [deck1, setDeck1] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .decks()
      .then((d) => {
        setDecks(d);
        setDeck0(d[0]?.id ?? '');
        setDeck1(d[1]?.id ?? d[0]?.id ?? '');
      })
      .catch(() => setError('Não foi possível conectar ao servidor. Ele está rodando? (npm run dev)'));
  }, []);

  const start = async () => {
    setLoading(true);
    try {
      const names: [string, string] = mode === 'demo' ? ['Bot A', 'Bot B'] : ['Você', 'Bot'];
      onStart(await buildSetup(mode, [deck0, deck1], names, seed, first === 'random' ? undefined : (Number(first) as PlayerId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  const loadReplay = async (file: File) => {
    try {
      const r = JSON.parse(await file.text()) as ReplayFile;
      if (r.format !== 'gumgumfight-replay') throw new Error('Arquivo não é um replay do GumGum Fight.');
      onStart(await buildSetup('replay', r.deckIds, r.names, r.seed, r.firstPlayer, r.actions));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="menu">
      <div className="menu-box">
        <h1 className="logo">
          GumGum <span>Fight</span>
        </h1>
        <p className="tagline">Simulador de One Piece Card Game no navegador</p>

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Modo</label>
          <div className="seg">
            <button className={mode === 'bot' ? 'on' : ''} onClick={() => setMode('bot')}>
              Contra o bot
            </button>
            <button className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')}>
              Bot x Bot (demonstração)
            </button>
          </div>
        </div>

        <div className="field two">
          <div>
            <label>{mode === 'demo' ? 'Deck do Bot A' : 'Seu deck'}</label>
            <select value={deck0} onChange={(e) => setDeck0(e.target.value)}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{mode === 'demo' ? 'Deck do Bot B' : 'Deck do bot'}</label>
            <select value={deck1} onChange={(e) => setDeck1(e.target.value)}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field two">
          <div>
            <label title="A mesma seed gera o mesmo embaralhamento — útil para repetir um cenário de teste">
              Seed (roteiro)
            </label>
            <div className="seed">
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
              <button className="btn small" onClick={() => setSeed(randomSeed())} title="Nova seed">
                🎲
              </button>
            </div>
          </div>
          <div>
            <label>Quem começa</label>
            <select value={first} onChange={(e) => setFirst(e.target.value as typeof first)}>
              <option value="random">Sorteio</option>
              <option value="0">{mode === 'demo' ? 'Bot A' : 'Você'}</option>
              <option value="1">{mode === 'demo' ? 'Bot B' : 'Bot'}</option>
            </select>
          </div>
        </div>

        <button className="btn primary big" disabled={!deck0 || !deck1 || loading} onClick={start}>
          {loading ? 'Carregando…' : 'Começar partida'}
        </button>

        <label className="replay-load">
          ou carregar um replay/roteiro (.json)
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && loadReplay(e.target.files[0])} />
        </label>

        <p className="disclaimer">
          Projeto de fã, sem fins lucrativos e sem vínculo com a Bandai, Toei Animation ou Shueisha. Os dados das cartas
          desta versão são provisórios.
        </p>
      </div>
    </div>
  );
}
