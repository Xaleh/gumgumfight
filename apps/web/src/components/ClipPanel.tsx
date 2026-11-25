// Trecho do replay em vídeo vertical ou GIF (roadmap F2): marca o início e o fim na barra do replay
// e baixa o "jogada da semana" pronto para Reels. Os quadros vêm do motor (`clipFrames`) e só têm o
// que um espectador vê; o desenho e a gravação ficam em `clip/`.

import { type Action, clipFrames, type GameState, type PlayerId } from '@gumgum/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipTexts } from '../clip/draw';
import { clipFileName, clipPlan, MAX_CLIP_MS } from '../clip/plan';
import { loadClipAssets, makeGif, recordVideo, videoExt, videoType } from '../clip/record';
import { type Translate, useT } from '../i18n';
import { errorText } from '../recap/assets';
import { saveFile } from '../recap/export';

/** De onde sai o trecho: o começo da partida e o roteiro inteiro do replay. */
export interface ClipSource {
  initial: GameState;
  actions: readonly Action[];
  /** O jogador de baixo da mesa (fica embaixo no vídeo também). */
  bottom: PlayerId;
}

export interface ClipRange {
  from: number;
  to: number | null;
}

type Busy = { kind: 'loading' | 'video' | 'gif'; p: number };

function clipTexts(t: Translate): ClipTexts {
  return {
    turn: (n) => t('clip.turn', { n }),
    turnOf: (name) => t('clip.turnOf', { name }),
    mulligan: t('replay.mulligan'),
    highlight: (kind, name) => t(kind === 'play' ? 'broadcast.played' : kind === 'counter' ? 'broadcast.countered' : 'broadcast.activated', { name }),
    won: (name) => t('clip.won', { name }),
    attacks: t('clip.attacks'),
    life: t('clip.life'),
    hand: t('clip.hand'),
    deck: t('clip.deck'),
    trash: t('clip.trash'),
    don: t('clip.don'),
    site: typeof location !== 'undefined' ? location.host : 'gumgumfight.app',
  };
}

export function ClipPanel({
  source,
  pos,
  range,
  setRange,
  onClose,
}: {
  source: ClipSource;
  /** Posição atual do replay. */
  pos: number;
  range: ClipRange;
  setRange: (r: ClipRange) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const type = useMemo(() => videoType(), []);

  const from = range.to === null ? range.from : Math.min(range.from, range.to);
  const to = range.to === null ? null : Math.max(range.from, range.to);
  const plan = useMemo(() => (to === null ? null : clipPlan(clipFrames(source.initial, source.actions, from, to))), [source, from, to]);

  const run = async (kind: 'video' | 'gif') => {
    if (!plan || to === null) return;
    const ctl = new AbortController();
    abort.current?.abort();
    abort.current = ctl;
    setError(null);
    setBusy({ kind: 'loading', p: 0 });
    try {
      const assets = await loadClipAssets(plan.steps.map((s) => s.frame));
      if (ctl.signal.aborted) return;
      setBusy({ kind, p: 0 });
      const job = { plan, bottom: source.bottom, texts: clipTexts(t), assets, signal: ctl.signal, onProgress: (p: number) => setBusy({ kind, p }) };
      if (kind === 'video' && type) saveFile(await recordVideo(job, type), clipFileName(from, to, videoExt(type)));
      else saveFile(await makeGif(job), clipFileName(from, to, 'gif'));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorText(e));
    } finally {
      if (abort.current === ctl) {
        abort.current = null;
        setBusy(null);
      }
    }
  };

  const pct = (p: number) => Math.round(p * 100);
  return (
    <div className="clip-panel" role="group" aria-label={t('clip.title')}>
      <div className="clip-head">
        <b>{t('clip.title')}</b>
        <button type="button" className="btn small" onClick={onClose} disabled={Boolean(busy)}>
          {t('clip.close')}
        </button>
      </div>
      <div className="clip-marks">
        <button type="button" className="btn small" onClick={() => setRange({ from: pos, to: range.to })} disabled={Boolean(busy)}>
          {t('clip.markStart', { n: pos })}
        </button>
        <button type="button" className="btn small" onClick={() => setRange({ from: range.from, to: pos })} disabled={Boolean(busy) || pos === range.from}>
          {t('clip.markEnd', { n: pos })}
        </button>
      </div>
      {plan && to !== null ? (
        <p className="clip-range">
          {t('clip.range', { from, to, s: Math.round(plan.totalMs / 1000) })}
          {plan.cut && <em> {t('clip.cut', { s: MAX_CLIP_MS / 1000 })}</em>}
        </p>
      ) : (
        <p className="clip-hint">{t('clip.hint')}</p>
      )}
      <p className="clip-hint">{t('clip.privacy')}</p>
      {busy ? (
        <div className="clip-busy">
          <progress max={1} value={busy.kind === 'loading' ? undefined : busy.p} />
          <span>{busy.kind === 'loading' ? t('clip.loading') : busy.kind === 'video' ? t('clip.recording', { p: pct(busy.p) }) : t('clip.building', { p: pct(busy.p) })}</span>
          {busy.kind === 'video' && <span className="clip-hint">{t('clip.keepOpen')}</span>}
          <button type="button" className="btn small" onClick={() => abort.current?.abort()}>
            {t('clip.cancel')}
          </button>
        </div>
      ) : (
        <div className="clip-actions">
          <button type="button" className="btn small primary" onClick={() => run('video')} disabled={!plan || !type}>
            {t('clip.video')}
          </button>
          <button type="button" className="btn small" onClick={() => run('gif')} disabled={!plan}>
            {t('clip.gif')}
          </button>
        </div>
      )}
      {!type && <p className="clip-hint">{t('clip.noVideo')}</p>}
      {error && <p className="clip-error">{t('clip.error', { message: error })}</p>}
    </div>
  );
}
