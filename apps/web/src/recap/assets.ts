// Imagens, fontes e logo prontos para desenhar em canvas (kit de divulgação e decklist do
// oponente no fim da partida), e o PNG de um canvas.

/** Imagem pronta para desenhar: a original ou uma cópia reduzida (canvas). */
export type RecapImage = HTMLImageElement | HTMLCanvasElement;

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Cópia reduzida para a largura `maxW`. Cada carta decodificada em tamanho cheio (600 × 838)
 * ocupa ~2 MB; com dezenas delas o iPhone fica sem memória e o iOS recarrega a página.
 */
export function shrink(img: HTMLImageElement, maxW: number): RecapImage {
  if (img.naturalWidth <= maxW) return img;
  const canvas = document.createElement('canvas');
  canvas.width = maxW;
  canvas.height = Math.round((img.naturalHeight * maxW) / img.naturalWidth);
  const ctx = canvas.getContext('2d');
  if (!ctx) return img;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Solta a memória do canvas na hora (o Safari do iOS só a devolve quando o coletor passa). */
export function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Logo do GumGum: o SVG ganha largura e altura (sem elas, alguns navegadores não o desenham no canvas). */
export async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    const svg = await (await fetch('/brand/header-logo-dark-bg.svg')).text();
    const sized = svg.replace('<svg ', '<svg width="1854" height="448" ');
    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/** Fontes da marca prontas antes de desenhar (o canvas não espera por elas). */
export async function loadFonts() {
  try {
    await Promise.all(['64px Bangers', '900 32px Nunito', '800 32px Nunito', '700 32px Nunito'].map((f) => document.fonts.load(f)));
  } catch {
    // Sem as fontes, o canvas usa as alternativas da pilha.
  }
}

export const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality));
