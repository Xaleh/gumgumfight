// Desenho de um quadro do trecho do replay (vídeo e GIF) em canvas vertical (1080 × 1920),
// com a identidade do GumGum: o oponente em cima, o jogador de baixo embaixo, a batalha
// marcada e a carta em destaque ampliada no meio, como na tela de transmissão.
//
// O quadro (`ClipFrame`, do motor) só tem o que um espectador vê: mão, deck e Vida virada
// aparecem como quantidade ou verso. As imagens das cartas chegam pelo mesmo domínio
// (`/card-img/…`), para o canvas poder ser gravado.

import type { ClipCard, ClipFrame, ClipSide, HighlightKind, PlayerId } from '@gumgum/engine';
import type { RecapImage } from '../recap/assets';

export interface ClipTexts {
  turn: (n: number) => string;
  turnOf: (name: string) => string;
  mulligan: string;
  highlight: (kind: HighlightKind, name: string) => string;
  won: (name: string) => string;
  attacks: string;
  life: string;
  hand: string;
  deck: string;
  trash: string;
  don: string;
  site: string;
}

export interface ClipAssets {
  image: (url: string | undefined) => RecapImage | null;
  back: RecapImage | null;
  logo: HTMLImageElement | null;
}

const DISPLAY = "Bangers, 'M PLUS Rounded 1c', Impact, sans-serif";
const BODY = "Nunito, 'M PLUS Rounded 1c', system-ui, sans-serif";
const C = {
  bgTop: '#163a5a',
  bgMid: '#0f2a44',
  bgBottom: '#0a1a2b',
  cream: '#fdf5e0',
  muted: 'rgba(253, 245, 224, 0.72)',
  yellow: '#f7cd48',
  red: '#c9322b',
  orange: '#ee6f3c',
  panel: 'rgba(253, 245, 224, 0.08)',
  line: 'rgba(253, 245, 224, 0.16)',
  neutral: '#66758c',
};
const CARD_COLORS: Record<string, string> = {
  red: '#d23b2e',
  green: '#239062',
  blue: '#2f6db5',
  purple: '#7d3c98',
  black: '#2c2c34',
  yellow: '#d3a80d',
};
const KIND_COLOR: Record<HighlightKind, string> = { play: C.yellow, counter: '#36c8ff', activate: C.orange };
/** Altura / largura de uma carta. */
const RATIO = 838 / 600;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rr = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: { size: number; family?: string; weight?: number; color?: string; align?: CanvasTextAlign; maxW?: number; stroke?: number },
) {
  let size = o.size;
  const font = () => `${o.weight ?? 800} ${size}px ${o.family ?? BODY}`;
  ctx.font = font();
  while (o.maxW && size > o.size * 0.5 && ctx.measureText(s).width > o.maxW) {
    size -= 2;
    ctx.font = font();
  }
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  if (o.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.stroke;
    ctx.strokeStyle = 'rgba(10, 20, 35, 0.9)';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color ?? C.cream;
  ctx.fillText(s, x, y);
}

function colorFill(ctx: CanvasRenderingContext2D, colors: string[], r: Rect): CanvasGradient | string {
  const list = (colors.length ? colors : ['']).map((k) => CARD_COLORS[k] ?? C.neutral);
  if (list.length === 1) return list[0];
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  list.forEach((col, i) => g.addColorStop(i / (list.length - 1), col));
  return g;
}

/** Carta virada para cima (arte ou bloco com a cor e o nome), em pé em `r`. */
function cardFace(ctx: CanvasRenderingContext2D, card: ClipCard, r: Rect, assets: ClipAssets) {
  const img = assets.image(card.image);
  ctx.save();
  roundRect(ctx, r, r.w * 0.05);
  ctx.clip();
  if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
  else {
    ctx.fillStyle = colorFill(ctx, card.colors, r);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(r.x, r.y + r.h * 0.6, r.w, r.h * 0.4);
    text(ctx, card.name, r.x + r.w / 2, r.y + r.h * 0.72, { size: Math.round(r.w * 0.13), align: 'center', maxW: r.w * 0.9 });
    text(ctx, card.cardId, r.x + r.w / 2, r.y + r.h * 0.86, { size: Math.round(r.w * 0.1), align: 'center', color: C.muted, weight: 700 });
  }
  ctx.restore();
}

/** Verso de carta (Vida, deck). */
function cardBack(ctx: CanvasRenderingContext2D, r: Rect, assets: ClipAssets) {
  ctx.save();
  roundRect(ctx, r, r.w * 0.05);
  ctx.clip();
  if (assets.back) ctx.drawImage(assets.back, r.x, r.y, r.w, r.h);
  else {
    ctx.fillStyle = '#3d1308';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

function badge(ctx: CanvasRenderingContext2D, label: string, cx: number, cy: number, size: number, bg: string, fg = C.cream) {
  ctx.font = `900 ${size}px ${BODY}`;
  const w = Math.max(size * 1.6, ctx.measureText(label).width + size * 0.9);
  const r = { x: cx - w / 2, y: cy - size * 0.75, w, h: size * 1.5 };
  roundRect(ctx, r, r.h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, label, cx, cy + 1, { size, weight: 900, color: fg, align: 'center' });
}

/**
 * Carta em campo no espaço `slot` (em pé). Virada (rested) gira 90° e encolhe para caber.
 * Devolve o centro, para a seta da batalha.
 */
function fieldCard(ctx: CanvasRenderingContext2D, card: ClipCard, slot: Rect, assets: ClipAssets, mark?: string): { x: number; y: number } {
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;
  ctx.save();
  let face = slot;
  if (card.rested) {
    // Deitada: a altura da carta vira a largura do espaço.
    const w = slot.w / RATIO;
    const h = slot.w;
    face = { x: -w / 2, y: -h / 2, w, h };
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 2);
  }
  if (mark) {
    ctx.shadowColor = mark;
    ctx.shadowBlur = 36;
    roundRect(ctx, face, face.w * 0.05);
    ctx.lineWidth = 8;
    ctx.strokeStyle = mark;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  cardFace(ctx, card, face, assets);
  ctx.restore();
  const bottom = card.rested ? cy + slot.w / RATIO / 2 : slot.y + slot.h;
  if (card.power !== undefined) badge(ctx, String(card.power), cx, bottom - 26, 28, 'rgba(10, 20, 35, 0.85)');
  if (card.don) badge(ctx, `+${card.don}`, slot.x + slot.w - 22, (card.rested ? cy - slot.w / RATIO / 2 : slot.y) + 26, 24, C.yellow, '#3d1308');
  return { x: cx, y: cy };
}

/** Distribui `n` cartas de largura até `maxW` numa faixa de largura `width` centrada em `cx`. */
export function rowSlots(n: number, cx: number, y: number, width: number, maxW: number, gap = 16): Rect[] {
  if (!n) return [];
  const w = Math.min(maxW, (width - gap * (n - 1)) / n);
  const total = n * w + (n - 1) * gap;
  return Array.from({ length: n }, (_, i) => ({ x: cx - total / 2 + i * (w + gap), y, w, h: w * RATIO }));
}

interface Placed {
  [uid: string]: { x: number; y: number };
}

/** Lado de um jogador. `top`: o de cima (Personagens embaixo, perto do meio). */
function drawSide(ctx: CanvasRenderingContext2D, W: number, side: ClipSide, top: boolean, y0: number, h: number, tx: ClipTexts, assets: ClipAssets, frame: ClipFrame, placed: Placed) {
  const statsH = 70;
  const statsY = top ? y0 : y0 + h - statsH;
  // Faixa com o nome e as quantidades.
  roundRect(ctx, { x: 40, y: statsY, w: W - 80, h: statsH }, 20);
  ctx.fillStyle = C.panel;
  ctx.fill();
  text(ctx, side.name, 70, statsY + statsH / 2, { size: 40, family: DISPLAY, weight: 400, maxW: 360 });
  const stats = `${tx.life} ${side.life}   ${tx.hand} ${side.hand}   ${tx.deck} ${side.deck}   ${tx.don} ${side.donActive}/${side.donActive + side.donRested}`;
  text(ctx, stats, W - 70, statsY + statsH / 2, { size: 28, align: 'right', color: C.muted, maxW: 560 });

  const body = { y: top ? y0 + statsH + 16 : y0, h: h - statsH - 16 };
  const rowH = body.h / 2 - 8;
  const leaderRowY = top ? body.y : body.y + rowH + 16;
  const charRowY = top ? body.y + rowH + 16 : body.y;
  const mark = (uid: string) => (frame.battle?.attacker === uid ? C.orange : frame.battle?.target === uid ? C.red : undefined);

  // Líder no meio; Vida à esquerda; Stage e descarte à direita.
  const leaderW = rowH / RATIO;
  const leaderSlot = { x: W / 2 - leaderW / 2, y: leaderRowY, w: leaderW, h: rowH };
  placed[side.leader.uid] = fieldCard(ctx, side.leader, leaderSlot, assets, mark(side.leader.uid));

  const smallW = rowH * 0.72 / RATIO;
  const smallH = smallW * RATIO;
  const smallY = leaderRowY + (rowH - smallH) / 2;
  // Vida: os versos empilhados, as viradas para cima por cima, e o número.
  const lifeX = 80;
  // As viradas para cima ficam por cima da pilha (a Vida tem no máximo um punhado de cartas à vista).
  const shown = Math.min(side.life, 6);
  const ups = side.lifeFaceUp.slice(-shown);
  for (let i = 0; i < shown; i++) {
    const r = { x: lifeX + i * 10, y: smallY + i * 6, w: smallW, h: smallH };
    const up = ups[i - (shown - ups.length)];
    if (up) cardFace(ctx, up, r, assets);
    else cardBack(ctx, r, assets);
  }
  if (!side.life) {
    roundRect(ctx, { x: lifeX, y: smallY, w: smallW, h: smallH }, 10);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  badge(ctx, `${tx.life} ${side.life}`, lifeX + smallW / 2 + 25, smallY + smallH + 30, 26, side.life ? C.red : C.neutral);

  const rightX = W - 80 - smallW;
  if (side.stage) placed[side.stage.uid] = fieldCard(ctx, side.stage, { x: rightX - smallW - 24, y: smallY, w: smallW, h: smallH }, assets, mark(side.stage.uid));
  if (side.trashTop) {
    ctx.globalAlpha = 0.85;
    cardFace(ctx, side.trashTop, { x: rightX, y: smallY, w: smallW, h: smallH }, assets);
    ctx.globalAlpha = 1;
  } else {
    roundRect(ctx, { x: rightX, y: smallY, w: smallW, h: smallH }, 10);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  badge(ctx, `${tx.trash} ${side.trash}`, rightX + smallW / 2, smallY + smallH + 30, 26, 'rgba(10, 20, 35, 0.85)');

  // Personagens.
  const slots = rowSlots(side.characters.length, W / 2, charRowY, W - 100, rowH / RATIO);
  side.characters.forEach((c, i) => {
    const s = slots[i];
    // Carta mais baixa que a faixa (muitos Personagens): fica no meio dela.
    const slot = { ...s, y: charRowY + (rowH - s.h) / 2 };
    placed[c.uid] = fieldCard(ctx, c, slot, assets, mark(c.uid));
  });
}

function arrow(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 60) return;
  const end = { x: to.x - Math.cos(ang) * 60, y: to.y - Math.sin(ang) * 60 };
  const start = { x: from.x + Math.cos(ang) * 60, y: from.y + Math.sin(ang) * 60 };
  ctx.save();
  ctx.strokeStyle = C.orange;
  ctx.fillStyle = C.orange;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x + Math.cos(ang) * 34, end.y + Math.sin(ang) * 34);
  ctx.lineTo(end.x + Math.cos(ang + 2.4) * 34, end.y + Math.sin(ang + 2.4) * 34);
  ctx.lineTo(end.x + Math.cos(ang - 2.4) * 34, end.y + Math.sin(ang - 2.4) * 34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Áreas do quadro (em 1080 × 1920; o desenho escala para outro tamanho). */
export const CLIP_AREAS = {
  header: { y: 0, h: 200 },
  top: { y: 210, h: 640 },
  middle: { y: 860, h: 200 },
  bottom: { y: 1070, h: 640 },
  footer: { y: 1720, h: 200 },
} as const;

/** Desenha o quadro inteiro. `bottom`: o jogador de baixo. O canvas pode ter outro tamanho (o desenho escala). */
export function drawClipFrame(ctx: CanvasRenderingContext2D, frame: ClipFrame, bottom: PlayerId, tx: ClipTexts, assets: ClipAssets) {
  const W = 1080;
  const H = 1920;
  ctx.save();
  ctx.setTransform(ctx.canvas.width / W, 0, 0, ctx.canvas.height / H, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(0.5, C.bgMid);
  bg.addColorStop(1, C.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Cabeçalho: logo e turno.
  const A = CLIP_AREAS;
  if (assets.logo) {
    const h = 78;
    const w = (assets.logo.naturalWidth / assets.logo.naturalHeight) * h || 320;
    ctx.drawImage(assets.logo, 50, A.header.y + 90 - h / 2, w, h);
  }
  const turnLabel = frame.phase === 'mulligan' ? tx.mulligan : tx.turn(frame.turn);
  text(ctx, turnLabel, W - 50, A.header.y + 90, { size: 64, family: DISPLAY, weight: 400, align: 'right', color: C.yellow, stroke: 8 });

  const topP = (1 - bottom) as PlayerId;
  const placed: Placed = {};
  drawSide(ctx, W, frame.players[topP], true, A.top.y, A.top.h, tx, assets, frame, placed);
  drawSide(ctx, W, frame.players[bottom], false, A.bottom.y, A.bottom.h, tx, assets, frame, placed);

  // Meio: de quem é a vez, ou o ataque.
  const mid = A.middle.y + A.middle.h / 2;
  ctx.fillStyle = 'rgba(253, 245, 224, 0.12)';
  ctx.fillRect(60, mid - 2, W - 120, 4);
  const midLabel = frame.battle ? tx.attacks : frame.phase === 'main' ? tx.turnOf(frame.players[frame.activePlayer].name) : '';
  if (midLabel) {
    ctx.font = `400 54px ${DISPLAY}`;
    const w = Math.min(W - 160, ctx.measureText(midLabel).width + 80);
    roundRect(ctx, { x: W / 2 - w / 2, y: mid - 46, w, h: 92 }, 46);
    ctx.fillStyle = frame.battle ? C.red : 'rgba(10, 20, 35, 0.9)';
    ctx.fill();
    text(ctx, midLabel, W / 2, mid + 2, { size: 54, family: DISPLAY, weight: 400, align: 'center', maxW: w - 60 });
  }
  if (frame.battle) {
    const a = placed[frame.battle.attacker];
    const b = placed[frame.battle.target];
    if (a && b) arrow(ctx, a, b);
  }

  // Destaque: a carta grande no meio, sobre a mesa escurecida.
  if (frame.highlight) {
    const h = frame.highlight;
    ctx.fillStyle = 'rgba(5, 12, 22, 0.62)';
    ctx.fillRect(0, A.top.y, W, A.bottom.y + A.bottom.h - A.top.y);
    const cw = 560;
    const ch = cw * RATIO;
    const r = { x: W / 2 - cw / 2, y: H / 2 - ch / 2 + 40, w: cw, h: ch };
    ctx.save();
    ctx.shadowColor = KIND_COLOR[h.kind];
    ctx.shadowBlur = 70;
    roundRect(ctx, r, cw * 0.05);
    ctx.fillStyle = KIND_COLOR[h.kind];
    ctx.fill();
    ctx.restore();
    cardFace(ctx, h.card, r, assets);
    text(ctx, tx.highlight(h.kind, frame.players[h.player].name), W / 2, r.y - 70, {
      size: 76,
      family: DISPLAY,
      weight: 400,
      align: 'center',
      color: KIND_COLOR[h.kind],
      maxW: W - 120,
      stroke: 10,
    });
  }

  // Fim de jogo.
  if (frame.winner !== null) {
    ctx.fillStyle = 'rgba(5, 12, 22, 0.55)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, tx.won(frame.players[frame.winner].name), W / 2, H / 2, { size: 110, family: DISPLAY, weight: 400, align: 'center', color: C.yellow, maxW: W - 100, stroke: 14 });
  }

  text(ctx, tx.site, W / 2, A.footer.y + 60, { size: 34, weight: 900, align: 'center', color: C.muted });
  ctx.restore();
}

/** As imagens que os quadros usam (para carregar antes de gravar). */
export function clipImages(frames: ClipFrame[]): string[] {
  const out = new Set<string>();
  const add = (c: ClipCard | null | undefined) => c?.image && out.add(c.image);
  for (const f of frames) {
    for (const s of f.players) {
      add(s.leader);
      add(s.stage);
      add(s.trashTop);
      s.characters.forEach(add);
      s.lifeFaceUp.forEach(add);
    }
    add(f.highlight?.card);
  }
  return [...out];
}
