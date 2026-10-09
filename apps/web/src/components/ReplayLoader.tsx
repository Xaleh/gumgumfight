import { cardDef, createGame, type PlayerId, ReplayCursor } from '@gumgum/engine';
import { useRef, useState } from 'react';
import { type GameSetup, REPLAY_SPEEDS } from '../game/useGame';

interface Summary {
  players: { name: string; leader: string }[];
  first: PlayerId;
  turns: number;
  actions: number;
  over: boolean;
  winner: PlayerId | null;
  reason?: string;
  failed: { index: number; message: string } | null;
}

/** Refaz a partida inteira uma vez: confere o roteiro e tira o resumo. */
function summarize(setup: GameSetup): Summary {
  const cursor = new ReplayCursor(createGame(setup.config), setup.script ?? []);
  const s = cursor.seek(cursor.actions.length);
  return {
    players: s.players.map((p) => ({ name: p.name, leader: `${cardDef(s, p.leader.uid).name} (${s.cards[p.leader.uid].cardId})` })),
    first: s.firstPlayer,
    turns: s.turn,
    actions: cursor.actions.length,
    over: s.phase === 'gameover',
    winner: s.winner,
    reason: s.winReason ?? undefined,
    failed: cursor.failed,
  };
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Assistir a um replay: carrega o .json (escolher ou arrastar), mostra o resumo da partida e
 * começa no modo automático ou passo a passo, na velocidade escolhida.
 */
export function ReplayLoader({
  load,
  onStart,
  onClose,
}: {
  /** Lê o arquivo e monta a partida (decks, cartas e o roteiro convertido para a versão atual). */
  load: (file: File) => Promise<GameSetup>;
  onStart: (setup: GameSetup) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ setup: GameSetup; summary: Summary; file: string; date: number } | null>(null);
  const [mode, setMode] = useState<'auto' | 'step'>('auto');
  const [speed, setSpeed] = useState(1);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const open = async (file: File) => {
    setBusy(true);
    setError(null);
    setLoaded(null);
    try {
      const setup = await load(file);
      setLoaded({ setup, summary: summarize(setup), file: file.name, date: file.lastModified });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sum = loaded?.summary;
  const name = (p: PlayerId) => sum?.players[p].name ?? '';
  const result = !sum
    ? ''
    : !sum.over
      ? 'A partida não terminou: o replay acaba antes do fim.'
      : sum.winner === null
        ? 'Empate.'
        : `${name(sum.winner)} venceu.${sum.reason ? ` ${sum.reason}` : ''}`;

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet replay-sheet" role="dialog" aria-modal="true" aria-label="Assistir replay" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>Assistir replay</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <label
            className={['replay-drop', over ? 'over' : '', loaded ? 'small' : ''].join(' ')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) void open(f);
            }}
          >
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Limpa para dar para escolher o mesmo arquivo de novo.
                e.target.value = '';
                if (f) void open(f);
              }}
            />
            <b>{busy ? 'Carregando…' : loaded ? 'Trocar o arquivo' : 'Escolher o arquivo .json do replay'}</b>
            <span>ou arraste o arquivo para cá</span>
          </label>
          {!loaded && !error && (
            <p className="muted small">
              O replay é baixado no fim de cada partida (⤓ Baixar replay) ou pelo menu da partida. Ele traz a seed e todas as ações: a
              partida é refeita aqui, do começo ao fim.
            </p>
          )}
          {error && <div className="error">{error}</div>}

          {loaded && sum && (
            <>
              <div className="replay-summary">
                <div className="replay-vs">
                  {sum.players.map((p, i) => (
                    <div key={i} className={`replay-player p${i}`}>
                      <b>{p.name}</b>
                      <span>{p.leader}</span>
                    </div>
                  ))}
                </div>
                <dl className="replay-facts">
                  <dt>Ações</dt>
                  <dd>{sum.actions}</dd>
                  <dt>Turnos</dt>
                  <dd>{sum.turns}</dd>
                  <dt>Quem começou</dt>
                  <dd>{name(sum.first)}</dd>
                  <dt>Arquivo</dt>
                  <dd title={loaded.file}>{fmtDate(loaded.date)}</dd>
                </dl>
                {sum.failed && (
                  <p className="error small">
                    O jogo atual recusa a ação {sum.failed.index + 1} ({sum.failed.message}). O replay para ali: as regras ou as cartas
                    mudaram desde a gravação.
                  </p>
                )}
                <details className="replay-spoiler">
                  <summary>Ver o resultado</summary>
                  <p>{result}</p>
                </details>
              </div>

              <div className="mode-field">
                <span className="mode-field-label" id="replay-mode-label">
                  Como assistir
                </span>
                <div className="seg small" role="group" aria-labelledby="replay-mode-label">
                  {(
                    [
                      ['auto', '▶ Automático'],
                      ['step', '▶| Passo a passo'],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={v} type="button" className={mode === v ? 'on' : ''} aria-pressed={mode === v} onClick={() => setMode(v)}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="muted small">
                  {mode === 'auto'
                    ? 'A partida roda sozinha. Dá para pausar, voltar e avançar a qualquer momento.'
                    : 'Você avança uma ação por vez com ▶| (ou a seta →) e volta com ◀ (ou ←).'}
                </p>
              </div>

              <div className="mode-field">
                <span className="mode-field-label" id="replay-speed-label">
                  Velocidade
                </span>
                <div className="seg small" role="group" aria-labelledby="replay-speed-label">
                  {REPLAY_SPEEDS.map((v) => (
                    <button key={v} type="button" className={speed === v ? 'on' : ''} aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                      {v}×
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="btn primary big replay-start"
                onClick={() => onStart({ ...loaded.setup, replayStart: { paused: mode === 'step', speed } })}
              >
                Assistir ao replay
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
