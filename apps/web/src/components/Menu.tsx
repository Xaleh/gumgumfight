import type { Action, CardData, PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, deckGroups, type DeckSummary } from '../api';
import type { GameMode, GameSetup, ReplayFile } from '../game/useGame';
import { SettingsControls } from '../settings';

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

const LAST_DECKS = 'gumgum.lastDecks';

function DeckSelect({ decks, value, onChange }: { decks: DeckSummary[]; value: string; onChange: (id: string) => void }) {
  const groups = deckGroups(decks);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {groups
        .filter(([, list]) => list.length)
        .map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((d) => (
              <option key={d.id} value={d.id} disabled={!d.valid}>
                {d.name}
                {d.valid ? '' : ` (incompleto: ${d.size}/50)`}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}

function DeckWarning({ deck }: { deck?: DeckSummary }) {
  if (!deck || !deck.unscripted) return null;
  return (
    <div className="muted small deck-warning" title="Essas cartas entram no jogo, mas sem o efeito">
      ⚙ {deck.unscripted} carta(s) sem efeito automatizado
    </div>
  );
}

export function Menu({
  onStart,
  onBuildDecks,
  onCoverage,
}: {
  onStart: (s: GameSetup) => void;
  onBuildDecks: () => void;
  onCoverage: () => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>('bot');
  const [deck0, setDeck0] = useState('');
  const [deck1, setDeck1] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
  const [loading, setLoading] = useState(false);

  // O servidor pode ainda estar subindo: tenta de novo por até ~30s antes de desistir.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = (attempt: number) => {
      api
        .decks()
        .then((d) => {
          if (cancelled) return;
          setError(null);
          setDecks(d);
          // Recupera a última escolha (se ainda for válida).
          let last: string[] = [];
          try {
            last = JSON.parse(localStorage.getItem(LAST_DECKS) ?? '[]');
          } catch {
            /* sem armazenamento */
          }
          const valid = d.filter((x) => x.valid).map((x) => x.id);
          const builtin = d.filter((x) => x.valid && x.kind === 'builtin').map((x) => x.id);
          setDeck0(valid.includes(last[0]) ? last[0] : (builtin[0] ?? valid[0] ?? ''));
          setDeck1(valid.includes(last[1]) ? last[1] : (builtin[1] ?? valid[1] ?? valid[0] ?? ''));
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 15) {
            setError('Conectando ao servidor…');
            timer = setTimeout(() => load(attempt + 1), 2000);
          } else {
            setError('Não foi possível conectar ao servidor. Veja as mensagens [server] no terminal do npm run dev.');
          }
        });
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const start = async () => {
    setLoading(true);
    try {
      localStorage.setItem(LAST_DECKS, JSON.stringify([deck0, deck1]));
    } catch {
      /* sem armazenamento */
    }
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
            <DeckSelect decks={decks} value={deck0} onChange={setDeck0} />
            <DeckWarning deck={decks.find((d) => d.id === deck0)} />
          </div>
          <div>
            <label>{mode === 'demo' ? 'Deck do Bot B' : 'Deck do bot'}</label>
            <DeckSelect decks={decks} value={deck1} onChange={setDeck1} />
            <DeckWarning deck={decks.find((d) => d.id === deck1)} />
          </div>
        </div>

        <button className="btn build-decks" onClick={onBuildDecks}>
          🃏 Montar / editar decks
        </button>

        <div className="field">
          <label>Quem começa</label>
          <select value={first} onChange={(e) => setFirst(e.target.value as typeof first)}>
            <option value="random">Sorteio</option>
            <option value="0">{mode === 'demo' ? 'Bot A' : 'Você'}</option>
            <option value="1">{mode === 'demo' ? 'Bot B' : 'Bot'}</option>
          </select>
        </div>

        <div className="field">
          <SettingsControls />
        </div>

        <button className="btn primary big" disabled={!deck0 || !deck1 || loading} onClick={start}>
          {loading ? 'Carregando…' : 'Começar partida'}
        </button>

        <button className="btn small link-btn" onClick={onCoverage}>
          📊 Cobertura das cartas (automação e tradução)
        </button>

        <details className="advanced">
          <summary>Opções de teste</summary>
          <div className="field">
            <label>Seed do embaralhamento</label>
            <div className="seed">
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
              <button className="btn small" onClick={() => setSeed(randomSeed())} title="Sortear outra">
                🎲
              </button>
            </div>
            <p className="muted small">
              Número que define a ordem dos decks e o sorteio de quem começa. A mesma seed com as mesmas jogadas repete a
              partida exatamente, o que é útil para reproduzir um problema. Para jogar normalmente, ignore este campo.
            </p>
          </div>
          <label className="replay-load">
            Carregar um replay (.json baixado durante uma partida)
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && loadReplay(e.target.files[0])} />
          </label>
        </details>

        <p className="disclaimer">
          Projeto de fã, sem fins lucrativos e sem vínculo com a Bandai, Toei Animation ou Shueisha. As traduções para
          português são automáticas e não oficiais.
        </p>
      </div>
    </div>
  );
}
