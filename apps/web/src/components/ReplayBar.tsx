import type { GameState } from '@gumgum/engine';
import { type ReactNode, useEffect, useRef } from 'react';
import { REPLAY_SPEEDS } from '../game/useGame';

/** Posição no replay e como mudá-la (de `useGame`). */
export interface ReplayControls {
  /** Quantas ações já foram aplicadas. */
  pos: number;
  /** Ações no roteiro. */
  total: number;
  /** Última posição alcançável (menor que `total` se o motor recusou uma ação). */
  end: number;
  seek: (n: number) => void;
  /** Primeira linha do histórico escrita pela ação atual (null no início). */
  logFrom: number | null;
}

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);
const ICONS = {
  start: svg(
    <>
      <rect x="4" y="5" width="2.6" height="14" rx="1" />
      <polygon points="20 5 8 12 20 19" />
    </>,
  ),
  back: svg(<polygon points="17 5 6 12 17 19" />),
  play: svg(<polygon points="7 4 20 12 7 20" />),
  pause: svg(
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>,
  ),
  next: svg(<polygon points="7 5 18 12 7 19" />),
  end: svg(
    <>
      <polygon points="4 5 16 12 4 19" />
      <rect x="17.4" y="5" width="2.6" height="14" rx="1" />
    </>,
  ),
};

const speedLabel = (v: number) => `${v}×`;

/**
 * Controles do replay: automático (▶) ou passo a passo (◀ ▶|), ir ao início ou ao fim, pular para
 * qualquer ação pela barra e mudar a velocidade. Atalhos: espaço, ← →, Home, End, + e −.
 */
export function ReplayBar({
  replay,
  state,
  paused,
  setPaused,
  speed,
  setSpeed,
}: {
  replay: ReplayControls;
  state: GameState;
  paused: boolean;
  setPaused: (f: (p: boolean) => boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
}) {
  const { pos, total, end, seek } = replay;
  const atEnd = pos >= end || state.phase === 'gameover';
  const playing = !paused && !atEnd;

  /** Passo a passo: avançar ou voltar uma ação pausa o automático. */
  const step = (d: number) => {
    setPaused(() => true);
    seek(pos + d);
  };
  const toggle = () => {
    if (atEnd) {
      // No fim, ▶ assiste de novo desde o começo.
      seek(0);
      setPaused(() => false);
    } else setPaused((p) => !p);
  };
  const shiftSpeed = (d: number) => {
    const i = REPLAY_SPEEDS.findIndex((v) => v >= speed);
    const next = REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, (i < 0 ? REPLAY_SPEEDS.length - 1 : i) + d))];
    setSpeed(next);
  };

  // Atalhos de teclado (fora de campos de texto e listas).
  const keys = useRef({ toggle, step, shiftSpeed, seek, end });
  keys.current = { toggle, step, shiftSpeed, seek, end };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = keys.current;
      switch (e.key) {
        case ' ':
          // Num botão focado, o espaço aperta o botão.
          if (t?.tagName === 'BUTTON') return;
          k.toggle();
          break;
        case 'ArrowRight':
          k.step(1);
          break;
        case 'ArrowLeft':
          k.step(-1);
          break;
        case 'Home':
          k.seek(0);
          break;
        case 'End':
          k.seek(k.end);
          break;
        case '+':
        case '=':
          k.shiftSpeed(1);
          break;
        case '-':
          k.shiftSpeed(-1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="replay-bar" role="toolbar" aria-label="Controles do replay">
      <input
        className="replay-seek"
        type="range"
        min={0}
        max={total}
        value={pos}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Posição no replay"
        aria-valuetext={`Ação ${pos} de ${total}`}
        style={{ ['--fill' as string]: `${total ? (pos / total) * 100 : 0}%` }}
      />
      <div className="replay-row">
        <div className="replay-info">
          <span>
            Ação <b>{pos}</b>/{total}
          </span>
          <span className="replay-turn">{state.phase === 'gameover' ? 'Fim de jogo' : state.phase === 'mulligan' ? 'Mulligan' : `Turno ${state.turn}`}</span>
        </div>
        <div className="replay-btns">
          <button type="button" onClick={() => seek(0)} disabled={pos === 0} title="Início (Home)" aria-label="Voltar ao início">
            {ICONS.start}
          </button>
          <button type="button" onClick={() => step(-1)} disabled={pos === 0} title="Ação anterior (←)" aria-label="Ação anterior">
            {ICONS.back}
          </button>
          <button
            type="button"
            className="replay-play"
            onClick={toggle}
            title={playing ? 'Pausar (espaço)' : atEnd ? 'Assistir de novo (espaço)' : 'Automático (espaço)'}
            aria-label={playing ? 'Pausar' : atEnd ? 'Assistir de novo' : 'Reproduzir automaticamente'}
          >
            {playing ? ICONS.pause : ICONS.play}
          </button>
          <button type="button" onClick={() => step(1)} disabled={atEnd} title="Próxima ação (→)" aria-label="Próxima ação">
            {ICONS.next}
          </button>
          <button type="button" onClick={() => seek(end)} disabled={atEnd} title="Fim (End)" aria-label="Ir para o fim">
            {ICONS.end}
          </button>
        </div>
        <label className="replay-speed" title="Velocidade (+ e −)">
          <span>Velocidade</span>
          <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {REPLAY_SPEEDS.map((v) => (
              <option key={v} value={v}>
                {speedLabel(v)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!playing && !atEnd && <p className="replay-hint">Passo a passo: use ▶| (ou →) para ver a próxima ação, ou ▶ para rodar sozinho.</p>}
    </div>
  );
}
