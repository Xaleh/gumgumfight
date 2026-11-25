// Gravação do trecho do replay: o vídeo vertical sai do próprio canvas (MediaRecorder: MP4 onde
// o navegador grava, como o Safari e o Chrome recente; senão WebM) e o GIF do codificador
// `gif.ts`. Tudo no navegador, a partir dos quadros públicos do motor (`clipFrames`).

import type { ClipFrame, PlayerId } from '@gumgum/engine';
import { proxiedImageUrl } from '@gumgum/engine';
import cardBackUrl from '../assets/card-back.webp';
import { loadFonts, loadImage, loadLogo, type RecapImage, release, shrink } from '../recap/assets';
import { type ClipAssets, type ClipTexts, clipImages, drawClipFrame } from './draw';
import { encodeGif, type GifFrame } from './gif';
import { CLIP_SIZE, type ClipPlan, GIF_SIZE } from './plan';

/** Formatos de vídeo, na ordem de preferência (MP4 abre em qualquer lugar; WebM no resto). */
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** O formato de vídeo que este navegador grava do canvas (null: não grava). */
export function videoType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export const videoExt = (type: string) => (type.startsWith('video/mp4') ? 'mp4' : 'webm');

/** Imagens, verso e logo carregados antes de desenhar (o canvas não espera por eles). */
export async function loadClipAssets(frames: ClipFrame[]): Promise<ClipAssets> {
  await loadFonts();
  const urls = clipImages(frames);
  const images = new Map<string, RecapImage>();
  await Promise.all(
    urls.map(async (url) => {
      const same = proxiedImageUrl(url);
      const img = same ? await loadImage(same) : null;
      // A carta em destaque tem 560 px de largura no quadro; o resto é menor.
      if (img) images.set(url, shrink(img, 600));
    }),
  );
  const [back, logo] = await Promise.all([loadImage(cardBackUrl), loadLogo()]);
  return { image: (url) => (url ? (images.get(url) ?? null) : null), back, logo };
}

export interface ClipJob {
  plan: ClipPlan;
  bottom: PlayerId;
  texts: ClipTexts;
  assets: ClipAssets;
  /** De 0 a 1. */
  onProgress: (p: number) => void;
  signal: AbortSignal;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** Grava o vídeo em tempo real: cada quadro fica no canvas pelo tempo dele. */
export async function recordVideo(job: ClipJob, type: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CLIP_SIZE.width;
  canvas.height = CLIP_SIZE.height;
  const ctx = canvas.getContext('2d')!;
  // O quadro é desenhado uma vez numa cópia; o canvas gravado só a repete (alguns navegadores só
  // gravam quando o canvas muda, e o desenho inteiro é pesado para 30 vezes por segundo).
  const frame = document.createElement('canvas');
  frame.width = canvas.width;
  frame.height = canvas.height;
  const fctx = frame.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  const paint = () => ctx.drawImage(frame, 0, 0);
  const ticker = setInterval(paint, 1000 / 30);
  try {
    let elapsed = 0;
    for (const [i, step] of job.plan.steps.entries()) {
      drawClipFrame(fctx, step.frame, job.bottom, job.texts, job.assets);
      paint();
      if (i === 0) recorder.start(1000);
      await wait(step.ms, job.signal);
      elapsed += step.ms;
      job.onProgress(elapsed / job.plan.totalMs);
    }
  } finally {
    clearInterval(ticker);
    if (recorder.state !== 'inactive') recorder.stop();
    for (const t of stream.getTracks()) t.stop();
  }
  await stopped;
  release(canvas);
  release(frame);
  return new Blob(chunks, { type: type.split(';')[0] });
}

/** Monta o GIF (menor, 360 × 640), quadro a quadro, sem travar a página. */
export async function makeGif(job: ClipJob): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = GIF_SIZE.width;
  canvas.height = GIF_SIZE.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: GifFrame[] = [];
  for (const [i, step] of job.plan.steps.entries()) {
    if (job.signal.aborted) throw new DOMException('aborted', 'AbortError');
    drawClipFrame(ctx, step.frame, job.bottom, job.texts, job.assets);
    frames.push({ rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, delayMs: step.ms });
    job.onProgress((0.6 * (i + 1)) / job.plan.steps.length);
    await wait(0, job.signal);
  }
  release(canvas);
  const data = encodeGif(frames, GIF_SIZE.width, GIF_SIZE.height);
  job.onProgress(1);
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
}
