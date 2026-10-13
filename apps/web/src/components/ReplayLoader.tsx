import { cardDef, createGame, type PlayerId, type PromptParams, ReplayCursor } from '@gumgum/engine';
import { useRef, useState } from 'react';
import { winReasonText } from '../game/engineText';
import { type GameSetup, REPLAY_SPEEDS } from '../game/useGame';
import { useLocale, useT, useTryT } from '../i18n';
import { fmtDateTime } from '../i18n/format';
import { useSettings } from '../settings';

interface Summary {
  players: { name: string; leader: string }[];
  first: PlayerId;
  turns: number;
  actions: number;
  over: boolean;
  winner: PlayerId | null;
  reason?: string;
  /** `reason` como chave do motor (`log.win*`), para traduzir. */
  reasonKey?: string;
  reasonParams?: PromptParams;
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
    reasonKey: s.winReasonKey,
    reasonParams: s.winReasonParams,
    failed: cursor.failed,
  };
}

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
  const t = useT();
  const tryT = useTryT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ setup: GameSetup; summary: Summary; file: string; date: number } | null>(null);
  const [mode, setMode] = useState<'auto' | 'step'>('auto');
  const [speed, setSpeed] = useState(1);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // "Cliques do jogador" é a mesma configuração do menu (fica guardada neste navegador).
  const { replayCues, update } = useSettings();

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
      ? t('replay.notFinished')
      : sum.winner === null
        ? t('replay.drawResult')
        : `${t('replay.wonResult', { name: name(sum.winner) })}${sum.reason ? ` ${winReasonText(tryT, { winReason: sum.reason, winReasonKey: sum.reasonKey, winReasonParams: sum.reasonParams })}` : ''}`;

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet replay-sheet" role="dialog" aria-modal="true" aria-label={t('replay.title')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('replay.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
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
            <b>{busy ? t('common.loading') : loaded ? t('replay.changeFile') : t('replay.chooseFile')}</b>
            <span>{t('replay.dropHint')}</span>
          </label>
          {!loaded && !error && (
            <p className="muted small">{t('replay.intro')}</p>
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
                  <dt>{t('replay.actions')}</dt>
                  <dd>{sum.actions}</dd>
                  <dt>{t('replay.turns')}</dt>
                  <dd>{sum.turns}</dd>
                  <dt>{t('replay.firstPlayer')}</dt>
                  <dd>{name(sum.first)}</dd>
                  <dt>{t('replay.file')}</dt>
                  <dd title={loaded.file}>{fmtDateTime(loaded.date, locale)}</dd>
                </dl>
                {sum.failed && (
                  <p className="error small">{t('replay.failed', { n: sum.failed.index + 1, message: sum.failed.message })}</p>
                )}
                <details className="replay-spoiler">
                  <summary>{t('replay.showResult')}</summary>
                  <p>{result}</p>
                </details>
              </div>

              <div className="mode-field">
                <span className="mode-field-label" id="replay-mode-label">
                  {t('replay.howToWatch')}
                </span>
                <div className="seg small" role="group" aria-labelledby="replay-mode-label">
                  {(
                    [
                      ['auto', t('replay.modeAuto')],
                      ['step', t('replay.modeStep')],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={v} type="button" className={mode === v ? 'on' : ''} aria-pressed={mode === v} onClick={() => setMode(v)}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="muted small">
                  {mode === 'auto'
                    ? t('replay.modeAutoHint')
                    : t('replay.modeStepHint')}
                </p>
              </div>

              <div className="mode-field">
                <span className="mode-field-label" id="replay-speed-label">
                  {t('replay.speed')}
                </span>
                <div className="seg small" role="group" aria-labelledby="replay-speed-label">
                  {REPLAY_SPEEDS.map((v) => (
                    <button key={v} type="button" className={speed === v ? 'on' : ''} aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                      {v}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="mode-field">
                <span className="mode-field-label" id="replay-cues-label">
                  {t('replay.cues')}
                </span>
                <div className="seg small" role="group" aria-labelledby="replay-cues-label">
                  {(
                    [
                      [true, t('replay.show')],
                      [false, t('replay.hide')],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={String(v)} type="button" className={replayCues === v ? 'on' : ''} aria-pressed={replayCues === v} onClick={() => update({ replayCues: v })}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="muted small">
                  {replayCues
                    ? t('replay.cuesOnHint')
                    : t('replay.cuesOffHint')}
                </p>
              </div>

              <button
                type="button"
                className="btn primary big replay-start"
                onClick={() => onStart({ ...loaded.setup, replayStart: { paused: mode === 'step', speed } })}
              >
                {t('replay.start')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
