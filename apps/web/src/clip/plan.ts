// Tempo de cada quadro do trecho do replay (vídeo e GIF): a carta em destaque fica mais tempo
// na tela, como na transmissão; o vídeo para no limite dos Reels.

import type { ClipFrame } from '@gumgum/engine';

/** Tamanho do vídeo vertical (Reels, Stories, TikTok). */
export const CLIP_SIZE = { width: 1080, height: 1920 } as const;
/** O GIF sai menor (fica leve para mandar no chat). */
export const GIF_SIZE = { width: 360, height: 640 } as const;
/** Duração máxima do trecho: a dos Reels. */
export const MAX_CLIP_MS = 90_000;

export const FRAME_MS = {
  first: 1500,
  highlight: 2600,
  battle: 1300,
  normal: 900,
  end: 3500,
} as const;

/** Quanto tempo o quadro fica na tela. */
export function frameMs(f: ClipFrame, first: boolean): number {
  if (f.phase === 'gameover') return FRAME_MS.end;
  if (first) return FRAME_MS.first;
  if (f.highlight) return FRAME_MS.highlight;
  if (f.battle) return FRAME_MS.battle;
  return FRAME_MS.normal;
}

export interface ClipPlan {
  steps: Array<{ frame: ClipFrame; ms: number }>;
  totalMs: number;
  /** O trecho passou do limite e foi cortado no fim. */
  cut: boolean;
}

/** Os quadros com o tempo de cada um, até `maxMs`. */
export function clipPlan(frames: ClipFrame[], maxMs = MAX_CLIP_MS): ClipPlan {
  const steps: ClipPlan['steps'] = [];
  let totalMs = 0;
  for (const [i, frame] of frames.entries()) {
    const ms = frameMs(frame, i === 0);
    if (steps.length && totalMs + ms > maxMs) return { steps, totalMs, cut: true };
    steps.push({ frame, ms });
    totalMs += ms;
  }
  return { steps, totalMs, cut: false };
}

/** Nome do arquivo baixado. */
export const clipFileName = (from: number, to: number, ext: string) => `gumgum-trecho-${from}-${to}.${ext}`;
