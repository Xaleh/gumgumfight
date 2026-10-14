// Desenho das peças do kit de divulgação em canvas: campeão, campanha do campeão,
// decklists do top 4 e as pizzas dos líderes. Cada peça sai em 1080 × 1350 (feed /
// carrossel do Instagram) ou 1080 × 1920 (stories), com a identidade do GumGum.
//
// As imagens chegam já carregadas (`RecapAssets`): as cartas pelo mesmo domínio
// (`/card-img/…`), para o canvas poder ser exportado. Carta sem imagem vira um bloco
// com a cor, o nome e o código.

import type { LeaderCount, RecapCard, RecapPlayer, RecapRound, TournamentRecap } from '../api';
import { CARD_RATIO, gridLayout, leaderLabel, legendRows, pieSlices } from './layout';

export type RecapFormat = 'feed' | 'story';

export const FORMAT_SIZE: Record<RecapFormat, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

/** Textos já traduzidos (no idioma da interface de quem gera o kit). */
export interface RecapTexts {
  champion: string;
  campaignTitle: string;
  leadersTitle: string;
  top8: string;
  allPlayers: string;
  othersN: (n: number) => string;
  players: (n: number) => string;
  place: (rank: number) => string;
  swissRecord: (wins: number, losses: number) => string;
  elimRecord: (wins: number, losses: number) => string;
  bracketRecord: (wins: number, losses: number) => string;
  earlyFinish: string;
  play: string;
  draw: string;
  playDrawLegend: string;
  game: (n: number) => string;
  bye: string;
  noShow: string;
  doubleNoShow: string;
  doubleLoss: string;
  late: string;
  reported: string;
  dropWin: string;
  pending: string;
  round: (r: RecapRound) => string;
  cards: (n: number) => string;
  /** Data do torneio, já formatada (null = sem data). */
  date: string | null;
  format: string;
  site: string;
}

/** Imagem pronta para desenhar: a original ou uma cópia reduzida (canvas). */
export type RecapImage = HTMLImageElement | HTMLCanvasElement;

export interface RecapAssets {
  image: (url: string | null) => RecapImage | null;
  logo: HTMLImageElement | null;
  sponsorLogo: HTMLImageElement | null;
}

export interface RecapPiece {
  /** Parte do nome do arquivo (01-campeao.png…). */
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, format: RecapFormat) => void;
}

const DISPLAY = "Bangers, 'M PLUS Rounded 1c', Impact, sans-serif";
const BODY = "Nunito, 'M PLUS Rounded 1c', system-ui, sans-serif";

const C = {
  bgTop: '#163a5a',
  bgBottom: '#0a1a2b',
  cream: '#fdf5e0',
  muted: 'rgba(253, 245, 224, 0.72)',
  faint: 'rgba(253, 245, 224, 0.5)',
  yellow: '#f7cd48',
  red: '#c9322b',
  orange: '#ee6f3c',
  brown: '#3d1308',
  panel: 'rgba(253, 245, 224, 0.07)',
  panelLine: 'rgba(253, 245, 224, 0.14)',
  win: '#2fbf7a',
  loss: '#e5484d',
  bye: '#5b86b0',
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

/** Margens seguras: nos stories, o Instagram cobre o topo e a base com a própria interface. */
const SAFE: Record<RecapFormat, { top: number; bottom: number }> = {
  feed: { top: 44, bottom: 40 },
  story: { top: 170, bottom: 200 },
};

const SIDE = 56;
const DECK_GAP = 14;
/** Largura máxima de uma carta na decklist (4 colunas, o mínimo da grade): as cartas só
 *  usadas ali podem ser reduzidas a isso antes de desenhar, sem perder qualidade. */
export const DECK_TILE_MAX_W = Math.ceil((FORMAT_SIZE.feed.width - SIDE * 2 - 3 * DECK_GAP) / 4);

// ------------------------------------------------------------------ utilitários

interface Area {
  top: number;
  bottom: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface TextOpts {
  size: number;
  family?: string;
  weight?: number | string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Largura máxima: a fonte diminui até `min` e, se ainda não couber, o texto ganha reticências. */
  maxW?: number;
  min?: number;
  stroke?: { color: string; width: number };
}

const setFont = (ctx: CanvasRenderingContext2D, o: TextOpts, size: number) => {
  ctx.font = `${o.weight ?? ''} ${size}px ${o.family ?? BODY}`.trim();
};

/** Tamanho em que o texto cabe em `maxW` (deixa a fonte do contexto nesse tamanho). */
function fitSize(ctx: CanvasRenderingContext2D, text: string, o: TextOpts): number {
  let size = o.size;
  const min = o.min ?? Math.round(o.size * 0.55);
  setFont(ctx, o, size);
  if (!o.maxW) return size;
  while (size > min && ctx.measureText(text).width > o.maxW) {
    size = Math.max(min, size - Math.max(1, Math.round(size * 0.05)));
    setFont(ctx, o, size);
  }
  return size;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join('').trimEnd()}…`).width > maxW) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/** Escreve uma linha de texto; devolve a largura ocupada. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts): number {
  fitSize(ctx, s, o);
  const out = o.maxW ? ellipsize(ctx, s, o.maxW) : s;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  if (o.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.stroke.width;
    ctx.strokeStyle = o.stroke.color;
    ctx.strokeText(out, x, y);
  }
  ctx.fillStyle = o.color ?? C.cream;
  ctx.fillText(out, x, y);
  return ctx.measureText(out).width;
}

/** Quebra o texto em até `lines` linhas que cabem em `maxW` (a última com reticências). */
function wrap(ctx: CanvasRenderingContext2D, s: string, maxW: number, lines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) line = next;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = ellipsize(ctx, `${kept[lines - 1]} ${out.slice(lines).join(' ')}`, maxW);
  return kept;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Recorte da imagem (`src`, em frações da imagem) com a proporção do destino, centralizado. */
function cover(img: RecapImage, src: Rect, dest: Rect): Rect {
  const iw = ('naturalWidth' in img && img.naturalWidth) || img.width;
  const ih = ('naturalHeight' in img && img.naturalHeight) || img.height;
  let sw = src.w * iw;
  let sh = src.h * ih;
  const cx = (src.x + src.w / 2) * iw;
  const cy = (src.y + src.h / 2) * ih;
  const aspect = dest.w / dest.h;
  if (sw / sh > aspect) sw = sh * aspect;
  else sh = sw / aspect;
  return { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
}

const drawCovered = (ctx: CanvasRenderingContext2D, img: RecapImage, src: Rect, dest: Rect) => {
  const s = cover(img, src, dest);
  ctx.drawImage(img, s.x, s.y, s.w, s.h, dest.x, dest.y, dest.w, dest.h);
};

/** Região da arte do personagem numa carta (o terço de cima, sem o nome e o texto). */
const FACE: Rect = { x: 0.08, y: 0.05, w: 0.84, h: 0.5 };
/** Recorte quadrado do rosto (círculos da campanha e da legenda). */
const FACE_SQUARE: Rect = { x: 0.2, y: 0.07, w: 0.6, h: 0.43 };

/** Fundo com as cores da carta (para cartas sem imagem e fatias sem arte). */
function colorFill(ctx: CanvasRenderingContext2D, c: RecapCard | null, r: Rect): CanvasGradient | string {
  const colors = (c?.colors.length ? c.colors : ['']).map((k) => CARD_COLORS[k] ?? C.neutral);
  if (colors.length === 1) return colors[0];
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  colors.forEach((col, i) => g.addColorStop(i / (colors.length - 1), col));
  return g;
}

/** Carta inteira (arte ou bloco com nome e código), com cantos arredondados. */
function drawCard(ctx: CanvasRenderingContext2D, card: RecapCard, img: RecapImage | null, r: Rect) {
  const radius = r.w * 0.045;
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.clip();
  if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
  else {
    ctx.fillStyle = colorFill(ctx, card, r);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(r.x, r.y + r.h * 0.62, r.w, r.h * 0.38);
    const pad = r.w * 0.08;
    if (card.cost !== null) {
      ctx.beginPath();
      ctx.arc(r.x + pad + r.w * 0.11, r.y + pad + r.w * 0.11, r.w * 0.11, 0, Math.PI * 2);
      ctx.fillStyle = C.cream;
      ctx.fill();
      text(ctx, String(card.cost), r.x + pad + r.w * 0.11, r.y + pad + r.w * 0.11, {
        size: r.w * 0.15,
        family: DISPLAY,
        color: C.brown,
        align: 'center',
        baseline: 'middle',
      });
    }
    const size = Math.max(10, r.w * 0.12);
    ctx.font = `900 ${size}px ${BODY}`;
    const lines = wrap(ctx, card.name, r.w - pad * 2, 3);
    lines.forEach((l, i) =>
      text(ctx, l, r.x + r.w / 2, r.y + r.h * 0.68 + i * size * 1.15, { size, weight: 900, align: 'center', baseline: 'top', color: C.cream }),
    );
  }
  ctx.restore();
}

/** Rosto do líder num círculo, com aro. */
function drawFace(ctx: CanvasRenderingContext2D, card: RecapCard | null, img: RecapImage | null, cx: number, cy: number, d: number, ring = C.cream) {
  const dest = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) drawCovered(ctx, img, FACE_SQUARE, dest);
  else {
    ctx.fillStyle = colorFill(ctx, card, dest);
    ctx.fillRect(dest.x, dest.y, d, d);
    if (card) text(ctx, card.name.slice(0, 1), cx, cy, { size: d * 0.5, family: DISPLAY, align: 'center', baseline: 'middle' });
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, d * 0.05);
  ctx.strokeStyle = ring;
  ctx.stroke();
}

// ------------------------------------------------------------------ moldura comum

function background(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bgTop);
  g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Raios de sol saindo do alto (clima de abertura de anime), bem sutis.
  const cx = W / 2;
  const cy = H * 0.3;
  const rays = 28;
  const far = Math.hypot(W, H);
  ctx.fillStyle = 'rgba(253, 245, 224, 0.035)';
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 1) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * far, cy + Math.sin(a0) * far);
    ctx.lineTo(cx + Math.cos(a1) * far, cy + Math.sin(a1) * far);
    ctx.closePath();
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.75);
  glow.addColorStop(0, 'rgba(247, 205, 72, 0.16)');
  glow.addColorStop(1, 'rgba(247, 205, 72, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Faixas da marca na base.
  ctx.fillStyle = C.yellow;
  ctx.fillRect(0, H - 18, W, 10);
  ctx.fillStyle = C.red;
  ctx.fillRect(0, H - 8, W, 8);
}

/** Cabeçalho: logo do GumGum, loja patrocinadora, nome do torneio e a linha com data e jogadores. Devolve onde o conteúdo começa. */
function header(ctx: CanvasRenderingContext2D, W: number, format: RecapFormat, recap: TournamentRecap, tx: RecapTexts, assets: RecapAssets): number {
  const y0 = SAFE[format].top;
  const logoH = 62;
  let logoW = 0;
  if (assets.logo) {
    logoW = (logoH * (assets.logo.naturalWidth || assets.logo.width)) / (assets.logo.naturalHeight || assets.logo.height || 1);
    ctx.drawImage(assets.logo, SIDE - 6, y0, logoW, logoH);
  } else {
    logoW = text(ctx, 'GumGum Fight', SIDE, y0 + 48, { size: 48, family: DISPLAY, color: C.yellow });
  }
  const sp = recap.tournament.sponsor;
  if (sp) {
    const maxW = Math.min(280, W - SIDE * 2 - logoW - 30);
    const boxH = 88;
    const pad = 10;
    let boxW = maxW;
    const logo = assets.sponsorLogo;
    if (logo) {
      const ratio = (logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height || 1);
      boxW = Math.min(maxW, (boxH - pad * 2) * ratio + pad * 2);
    }
    const x = W - SIDE - boxW;
    const y = y0 - 13;
    roundRect(ctx, x, y, boxW, boxH, 14);
    ctx.fillStyle = C.cream;
    ctx.fill();
    if (logo) {
      const ratio = (logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height || 1);
      let w = boxW - pad * 2;
      let h = w / ratio;
      if (h > boxH - pad * 2) {
        h = boxH - pad * 2;
        w = h * ratio;
      }
      ctx.drawImage(logo, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
    } else {
      text(ctx, sp.name, x + boxW / 2, y + boxH / 2, { size: 30, weight: 900, color: C.brown, align: 'center', baseline: 'middle', maxW: boxW - pad * 2 });
    }
  }
  let y = y0 + logoH + 78;
  text(ctx, recap.tournament.name, W / 2, y, {
    size: 70,
    family: DISPLAY,
    color: C.cream,
    align: 'center',
    maxW: W - SIDE * 2,
    min: 40,
    stroke: { color: 'rgba(0, 0, 0, 0.35)', width: 8 },
  });
  y += 46;
  const line = [tx.date, tx.format, tx.players(recap.tournament.players)].filter(Boolean).join('  ·  ');
  text(ctx, line, W / 2, y, { size: 30, weight: 800, color: C.muted, align: 'center', maxW: W - SIDE * 2 });
  y += 26;
  ctx.fillStyle = C.yellow;
  roundRect(ctx, W / 2 - 60, y, 120, 6, 3);
  ctx.fill();
  return y + 34;
}

function footer(ctx: CanvasRenderingContext2D, W: number, H: number, format: RecapFormat, tx: RecapTexts): number {
  const y = H - SAFE[format].bottom - 8;
  text(ctx, tx.site, W / 2, y, { size: 26, weight: 800, color: C.faint, align: 'center' });
  return y - 44;
}

/** Fundo, cabeçalho e rodapé; devolve a área livre para o conteúdo. */
function frame(ctx: CanvasRenderingContext2D, format: RecapFormat, recap: TournamentRecap, tx: RecapTexts, assets: RecapAssets): Area {
  const { width: W, height: H } = FORMAT_SIZE[format];
  background(ctx, W, H);
  const top = header(ctx, W, format, recap, tx, assets);
  const bottom = footer(ctx, W, H, format, tx);
  return { top, bottom };
}

/** Título da peça (amarelo, com contorno) e subtítulo; devolve onde o resto começa. */
function title(ctx: CanvasRenderingContext2D, W: number, y: number, main: string, sub: string | null, size = 66): number {
  text(ctx, main, W / 2, y + size * 0.85, {
    size,
    family: DISPLAY,
    color: C.yellow,
    align: 'center',
    maxW: W - SIDE * 2,
    stroke: { color: C.brown, width: 10 },
  });
  let out = y + size * 0.85 + 16;
  if (sub) {
    out += 30;
    text(ctx, sub, W / 2, out, { size: 32, weight: 800, color: C.cream, align: 'center', maxW: W - SIDE * 2 });
    out += 16;
  }
  return out + 14;
}

const recordOf = (p: RecapPlayer, structure: TournamentRecap['tournament']['structure'], tx: RecapTexts) =>
  [
    p.swiss && tx.swissRecord(p.swiss.wins + p.swiss.byes, p.swiss.losses),
    p.elim && (structure === 'swiss' ? tx.elimRecord : tx.bracketRecord)(p.elim.wins + p.elim.byes, p.elim.losses),
  ]
    .filter(Boolean)
    .join('  ·  ');

// ------------------------------------------------------------------ peças

function drawChampion(ctx: CanvasRenderingContext2D, format: RecapFormat, recap: TournamentRecap, tx: RecapTexts, assets: RecapAssets) {
  const { width: W } = FORMAT_SIZE[format];
  const area = frame(ctx, format, recap, tx, assets);
  const ch = recap.champion!;
  const kickerH = 112;
  const after = 26 + 92 + 50 + 64 + (recap.tournament.earlyFinish ? 48 : 0);
  const avail = area.bottom - area.top;
  const cardH = Math.max(280, Math.min(format === 'story' ? 820 : 600, avail - kickerH - after - 20));
  const cardW = cardH / CARD_RATIO;
  const total = kickerH + cardH + after;
  let y = area.top + Math.max(0, (avail - total) / 2);

  text(ctx, tx.champion, W / 2, y + 92, { size: 112, family: DISPLAY, color: C.yellow, align: 'center', maxW: W - SIDE * 2, stroke: { color: C.brown, width: 14 } });
  // Estrelas dos dois lados do título.
  ctx.font = `112px ${DISPLAY}`;
  const half = Math.min(ctx.measureText(tx.champion).width, W - SIDE * 2) / 2;
  for (const side of [-1, 1]) star(ctx, W / 2 + side * (half + 48), y + 56, 26, C.yellow);
  y += kickerH;

  const card = { x: (W - cardW) / 2, y, w: cardW, h: cardH };
  ctx.save();
  ctx.shadowColor = 'rgba(247, 205, 72, 0.55)';
  ctx.shadowBlur = 70;
  roundRect(ctx, card.x - 10, card.y - 10, card.w + 20, card.h + 20, card.w * 0.06);
  ctx.fillStyle = C.cream;
  ctx.fill();
  ctx.restore();
  drawCard(ctx, ch.leader, assets.image(ch.leader.image), card);
  y += cardH + 26;

  text(ctx, ch.name, W / 2, y + 80, { size: 92, family: DISPLAY, color: C.cream, align: 'center', maxW: W - SIDE * 2, min: 48, stroke: { color: 'rgba(0,0,0,0.4)', width: 10 } });
  y += 92;
  text(ctx, leaderLabel(ch.leader), W / 2, y + 36, { size: 36, weight: 800, color: C.muted, align: 'center', maxW: W - SIDE * 2 });
  y += 50;
  const record = recordOf(ch, recap.tournament.structure, tx);
  if (record) text(ctx, record, W / 2, y + 46, { size: 44, weight: 900, color: C.yellow, align: 'center', maxW: W - SIDE * 2 });
  y += 64;
  if (recap.tournament.earlyFinish) text(ctx, tx.earlyFinish, W / 2, y + 34, { size: 28, weight: 700, color: C.orange, align: 'center', maxW: W - SIDE * 2 });
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.brown;
  ctx.stroke();
}

const OUTCOME_COLOR: Record<RecapRound['outcome'], string> = { win: C.win, loss: C.loss, bye: C.bye, none: C.neutral, pending: C.neutral };

function drawCampaign(ctx: CanvasRenderingContext2D, format: RecapFormat, recap: TournamentRecap, tx: RecapTexts, assets: RecapAssets) {
  const { width: W } = FORMAT_SIZE[format];
  const area = frame(ctx, format, recap, tx, assets);
  const ch = recap.champion!;
  let y = title(ctx, W, area.top, tx.campaignTitle, `${ch.name}  ·  ${leaderLabel(ch.leader)}`, 64);
  const legendH = 40;
  const rows = recap.campaign;
  const gap = 10;
  const avail = area.bottom - legendH - y;
  const rowH = Math.max(52, Math.min(format === 'story' ? 150 : 124, (avail - gap * (rows.length - 1)) / Math.max(1, rows.length)));
  const used = rows.length * rowH + (rows.length - 1) * gap;
  y += Math.max(0, (avail - used) / 2);
  const s = Math.max(0.55, Math.min(1.1, rowH / 108));

  // Colunas: rodada | rosto | oponente | jogos | placar. Os jogos ocupam o que a série mais longa pedir.
  const x0 = SIDE;
  const x1 = W - SIDE;
  const labelW = 168 * Math.max(0.8, s);
  const faceD = Math.min(rowH - 18, 92);
  const scoreW = 112 * Math.max(0.8, s);
  const chipW = 70 * s;
  const chipGap = 8 * s;
  const maxGames = Math.max(1, ...rows.map((r) => Math.max(r.games.length, r.how === 'game' ? 1 : 0)));
  const tagW = 230 * s;
  const gamesW = Math.max(tagW, maxGames * chipW + (maxGames - 1) * chipGap);

  for (const r of rows) {
    const color = OUTCOME_COLOR[r.outcome];
    roundRect(ctx, x0, y, x1 - x0, rowH, 18 * s);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.panelLine;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, x0, y, x1 - x0, rowH, 18 * s);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x0, y, 10, rowH);
    ctx.restore();

    const mid = y + rowH / 2;
    roundLabel(ctx, tx.round(r), x0 + 28, mid, labelW - 34, 28 * s);
    const faceX = x0 + labelW + faceD / 2;
    const leader = r.opponent?.leader ?? null;
    if (r.opponent) drawFace(ctx, leader, assets.image(leader?.image ?? null), faceX, mid, faceD);
    const nameX = faceX + faceD / 2 + 18;
    const scoreX = x1 - 18 - scoreW;
    const gamesX = scoreX - 18 - gamesW;
    const nameW = gamesX - 14 - nameX;
    if (r.opponent) {
      text(ctx, r.opponent.name, nameX, mid - 4 * s, { size: 30 * s, weight: 900, color: C.cream, maxW: nameW, min: 16 });
      text(ctx, leaderLabel(r.opponent.leader), nameX, mid + 28 * s, { size: 23 * s, weight: 700, color: C.muted, maxW: nameW, min: 13 });
    } else {
      text(ctx, r.how === 'late' ? tx.late : tx.bye, nameX - faceD - 18, mid, { size: 30 * s, weight: 900, color: C.muted, baseline: 'middle', maxW: nameW + faceD });
    }

    // Jogos: um selo por jogo com play/draw, verde se venceu, vermelho se perdeu.
    const chipH = Math.min(rowH - 22, 70 * s);
    if (r.games.length) {
      let cx = gamesX + gamesW - (r.games.length * chipW + (r.games.length - 1) * chipGap);
      for (const g of r.games) {
        roundRect(ctx, cx, mid - chipH / 2, chipW, chipH, 12 * s);
        ctx.fillStyle = g.won === null ? C.neutral : g.won ? C.win : C.loss;
        ctx.fill();
        text(ctx, tx.game(g.game), cx + chipW / 2, mid - chipH * 0.12, { size: 19 * s, weight: 900, color: C.cream, align: 'center', maxW: chipW - 6 });
        text(ctx, g.first === null ? '—' : g.first ? tx.play : tx.draw, cx + chipW / 2, mid + chipH * 0.3, {
          size: 17 * s,
          weight: 900,
          color: C.cream,
          align: 'center',
          maxW: chipW - 8,
          min: 9,
        });
        cx += chipW + chipGap;
      }
    } else {
      const tag =
        r.how === 'noshow'
          ? r.outcome === 'none'
            ? tx.doubleNoShow
            : tx.noShow
          : r.how === 'drop'
            ? tx.dropWin
            : r.how === 'bye' || r.how === 'late'
              ? null
              : r.outcome === 'pending'
                ? tx.pending
                : r.outcome === 'none'
                  ? tx.doubleLoss
                  : tx.reported;
      if (tag) text(ctx, tag, gamesX + gamesW, mid, { size: 22 * s, weight: 800, color: C.muted, align: 'right', baseline: 'middle', maxW: gamesW });
    }

    const pillH = Math.min(rowH - 22, 66 * s);
    roundRect(ctx, scoreX, mid - pillH / 2, scoreW, pillH, pillH / 2);
    ctx.fillStyle = color;
    ctx.fill();
    const score =
      r.outcome === 'bye' ? 'BYE' : r.outcome === 'pending' || r.how === 'late' ? '—' : r.outcome === 'none' ? (r.how === 'noshow' ? 'W.O.' : '0-0') : `${r.score[0]}-${r.score[1]}`;
    text(ctx, score, scoreX + scoreW / 2, mid + 2, { size: 40 * s, family: DISPLAY, color: C.cream, align: 'center', baseline: 'middle', maxW: scoreW - 16 });
    y += rowH + gap;
  }
  if (rows.some((r) => r.games.length)) {
    text(ctx, tx.playDrawLegend, W / 2, area.bottom - 6, { size: 24, weight: 700, color: C.faint, align: 'center', maxW: W - SIDE * 2 });
  }
}

/** Rótulo da rodada: numa linha ou, se não couber ("Quartas de final"), em duas. */
function roundLabel(ctx: CanvasRenderingContext2D, label: string, x: number, mid: number, maxW: number, size: number) {
  const o = { size, weight: 900, color: C.cream, baseline: 'middle' as const };
  setFont(ctx, o, size);
  const words = label.split(' ');
  if (ctx.measureText(label).width <= maxW || words.length < 2) {
    text(ctx, label, x, mid, { ...o, maxW });
    return;
  }
  // Divide onde as duas linhas ficam mais parecidas.
  let best = 1;
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const w = Math.max(ctx.measureText(words.slice(0, i).join(' ')).width, ctx.measureText(words.slice(i).join(' ')).width);
    if (w < bestW) [best, bestW] = [i, w];
  }
  const lineSize = Math.min(size, size * 0.92);
  text(ctx, words.slice(0, best).join(' '), x, mid - lineSize * 0.58, { ...o, size: lineSize, maxW });
  text(ctx, words.slice(best).join(' '), x, mid + lineSize * 0.58, { ...o, size: lineSize, maxW });
}

function drawDeck(ctx: CanvasRenderingContext2D, format: RecapFormat, recap: TournamentRecap, tx: RecapTexts, assets: RecapAssets, p: RecapPlayer) {
  const { width: W } = FORMAT_SIZE[format];
  const area = frame(ctx, format, recap, tx, assets);
  let y = area.top;
  // Em Nunito: a Bangers não tem "º", "ʳᵉ"…
  text(ctx, tx.place(p.rank).toLocaleUpperCase(), W / 2, y + 50, { size: 50, weight: 900, color: C.yellow, align: 'center', stroke: { color: C.brown, width: 9 } });
  y += 64;
  text(ctx, p.name, W / 2, y + 66, { size: 78, family: DISPLAY, color: C.cream, align: 'center', maxW: W - SIDE * 2, min: 40, stroke: { color: 'rgba(0,0,0,0.4)', width: 9 } });
  y += 82;
  const total = p.cards.reduce((n, c) => n + c.count, 0);
  const deckName = p.deckName && p.deckName.trim() !== p.leader.name ? p.deckName.trim() : null;
  text(ctx, [leaderLabel(p.leader), deckName, tx.cards(total)].filter(Boolean).join('  ·  '), W / 2, y + 30, {
    size: 30,
    weight: 800,
    color: C.muted,
    align: 'center',
    maxW: W - SIDE * 2,
  });
  y += 56;

  const tiles: Array<{ card: RecapCard; count: number | null }> = [{ card: p.leader, count: null }, ...p.cards.map((c) => ({ card: c, count: c.count }))];
  const labelH = 32;
  const gap = DECK_GAP;
  const g = gridLayout(tiles.length, W - SIDE * 2, area.bottom - y, { gap, labelH });
  const x0 = (W - g.gridW) / 2;
  y += Math.max(0, (area.bottom - y - g.gridH) / 2);
  tiles.forEach((t, i) => {
    const col = i % g.cols;
    const row = Math.floor(i / g.cols);
    const x = x0 + col * (g.tileW + gap);
    const ty = y + row * (g.tileH + gap);
    const r = { x, y: ty, w: g.tileW, h: g.cardH };
    if (t.count === null) {
      // O líder vem primeiro, com moldura amarela.
      roundRect(ctx, x - 5, ty - 5, g.tileW + 10, g.cardH + 10, g.tileW * 0.07);
      ctx.fillStyle = C.yellow;
      ctx.fill();
    }
    drawCard(ctx, t.card, assets.image(t.card.image), r);
    if (t.count !== null) {
      const br = Math.max(14, g.tileW * 0.15);
      const bx = x + g.tileW - br * 0.85;
      const by = ty + br * 0.85;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = C.yellow;
      ctx.fill();
      ctx.lineWidth = Math.max(3, br * 0.16);
      ctx.strokeStyle = C.brown;
      ctx.stroke();
      text(ctx, String(t.count), bx, by + br * 0.08, { size: br * 1.35, family: DISPLAY, color: C.brown, align: 'center', baseline: 'middle' });
    }
    text(ctx, t.card.id, x + g.tileW / 2, ty + g.cardH + labelH * 0.72, {
      size: Math.min(24, Math.max(12, g.tileW * 0.13)),
      weight: 800,
      color: C.cream,
      align: 'center',
      maxW: g.tileW,
      min: 10,
    });
  });
}

/** Caixa que contém a fatia (para centralizar a arte do líder nela). */
function sliceBox(cx: number, cy: number, r: number, start: number, end: number): Rect {
  const xs = [cx];
  const ys = [cy];
  const steps = Math.max(2, Math.ceil(((end - start) / (Math.PI * 2)) * 72));
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    xs.push(cx + Math.cos(a) * r);
    ys.push(cy + Math.sin(a) * r);
  }
  if (end - start >= Math.PI * 2 - 1e-6) return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

function drawLeaders(
  ctx: CanvasRenderingContext2D,
  format: RecapFormat,
  recap: TournamentRecap,
  tx: RecapTexts,
  assets: RecapAssets,
  entries: LeaderCount[],
  subtitle: string,
) {
  const { width: W } = FORMAT_SIZE[format];
  const area = frame(ctx, format, recap, tx, assets);
  const total = entries.reduce((n, e) => n + e.count, 0);
  let y = title(ctx, W, area.top, tx.leadersTitle, `${subtitle}  ·  ${tx.players(total)}`, 64);
  const legend = legendRows(entries, 15);
  const legendCount = legend.shown.length + (legend.rest ? 1 : 0);
  const stacked = format === 'story';
  const availH = area.bottom - y;

  let cx: number;
  let cy: number;
  let r: number;
  let lx: number;
  let ly: number;
  let lw: number;
  let rowH: number;
  let cols = 1;
  if (stacked) {
    cols = legendCount > 8 ? 2 : 1;
    const legendRowsN = Math.ceil(legendCount / cols);
    rowH = Math.min(58, Math.max(40, (availH * 0.42) / Math.max(1, legendRowsN)));
    const legendH = legendRowsN * rowH;
    r = Math.min((W - SIDE * 2) / 2, (availH - legendH - 40) / 2);
    cx = W / 2;
    cy = y + r + 6;
    lw = (W - SIDE * 2 - (cols - 1) * 30) / cols;
    lx = SIDE;
    ly = cy + r + 40;
  } else {
    lw = 430;
    r = Math.min((W - SIDE * 2 - lw - 36) / 2, (availH - 10) / 2);
    cx = SIDE + r;
    cy = y + availH / 2;
    lx = W - SIDE - lw;
    rowH = Math.min(58, Math.max(36, (availH - 10) / Math.max(1, legendCount)));
    ly = cy - (legendCount * rowH) / 2;
  }

  // Pizza: cada fatia mostra a arte do líder, com borda escura entre as fatias.
  const slices = pieSlices(entries);
  for (const sl of slices) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, sl.start, sl.end);
    ctx.closePath();
    ctx.clip();
    const box = sliceBox(cx, cy, r, sl.start, sl.end);
    const img = sl.leader ? assets.image(sl.leader.image) : null;
    if (img) drawCovered(ctx, img, FACE, box);
    else {
      ctx.fillStyle = sl.leader ? colorFill(ctx, sl.leader, box) : C.neutral;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      if (!sl.leader) {
        // "Outros": listras diagonais.
        ctx.strokeStyle = 'rgba(253, 245, 224, 0.18)';
        ctx.lineWidth = 6;
        for (let d = -2 * r; d < 2 * r; d += 22) {
          ctx.beginPath();
          ctx.moveTo(cx + d - r, cy - r);
          ctx.lineTo(cx + d + r, cy + r);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  if (slices.length > 1) {
    ctx.strokeStyle = '#0b0b0f';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    for (const sl of slices) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sl.start) * r, cy + Math.sin(sl.start) * r);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 10;
  ctx.strokeStyle = C.cream;
  ctx.stroke();
  // Quantidade nas fatias grandes.
  for (const sl of slices) {
    if ((sl.end - sl.start) / (Math.PI * 2) < 0.06) continue;
    const a = (sl.start + sl.end) / 2;
    const rr = slices.length === 1 ? 0 : r * 0.64;
    text(ctx, String(sl.count), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, {
      size: Math.max(30, r * 0.16),
      family: DISPLAY,
      color: C.cream,
      align: 'center',
      baseline: 'middle',
      stroke: { color: '#0b0b0f', width: 9 },
    });
  }

  // Legenda em ordem decrescente: "Nome (coleção)" e a quantidade.
  const items: Array<{ leader: RecapCard | null; label: string; count: number }> = [
    ...legend.shown.map((e) => ({ leader: e.leader, label: leaderLabel(e.leader), count: e.count })),
    ...(legend.rest ? [{ leader: null, label: tx.othersN(legend.rest.leaders), count: legend.rest.count }] : []),
  ];
  const perCol = Math.ceil(items.length / cols);
  items.forEach((it, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = lx + col * (lw + 30);
    const iy = ly + row * rowH + rowH / 2;
    const d = Math.min(44, rowH - 8);
    if (it.leader) drawFace(ctx, it.leader, assets.image(it.leader.image), x + d / 2, iy, d, C.cream);
    else {
      ctx.beginPath();
      ctx.arc(x + d / 2, iy, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = C.neutral;
      ctx.fill();
    }
    const pct = total ? Math.round((it.count / total) * 100) : 0;
    const countText = `${it.count}`;
    const right = x + lw;
    const cw = text(ctx, countText, right, iy, { size: Math.min(30, rowH * 0.55), weight: 900, color: C.yellow, align: 'right', baseline: 'middle' });
    const pw = text(ctx, `${pct}%`, right - cw - 12, iy, { size: Math.min(22, rowH * 0.42), weight: 800, color: C.faint, align: 'right', baseline: 'middle' });
    text(ctx, it.label, x + d + 14, iy, {
      size: Math.min(27, rowH * 0.5),
      weight: 800,
      color: C.cream,
      baseline: 'middle',
      maxW: lw - d - 14 - cw - pw - 30,
      min: 13,
    });
  });
}

/** As peças do kit, na ordem do carrossel. */
export function recapPieces(
  recap: TournamentRecap,
  tx: RecapTexts,
  assets: RecapAssets,
  labels: { champion: string; campaign: string; deck: (rank: number) => string; leadersTop8: string; leadersAll: string },
): RecapPiece[] {
  const out: RecapPiece[] = [];
  if (recap.champion) {
    out.push({ id: 'campeao', label: labels.champion, draw: (ctx, f) => drawChampion(ctx, f, recap, tx, assets) });
    if (recap.campaign.length) out.push({ id: 'campanha', label: labels.campaign, draw: (ctx, f) => drawCampaign(ctx, f, recap, tx, assets) });
  }
  for (const p of recap.top) out.push({ id: `decklist-${p.rank}`, label: labels.deck(p.rank), draw: (ctx, f) => drawDeck(ctx, f, recap, tx, assets, p) });
  // Com até 8 inscritos, o top 8 é o torneio inteiro: uma pizza só.
  if (recap.tournament.players > 8) {
    out.push({ id: 'lideres-top8', label: labels.leadersTop8, draw: (ctx, f) => drawLeaders(ctx, f, recap, tx, assets, recap.leadersTop8, tx.top8) });
  }
  if (recap.leadersAll.length) {
    out.push({ id: 'lideres-todos', label: labels.leadersAll, draw: (ctx, f) => drawLeaders(ctx, f, recap, tx, assets, recap.leadersAll, tx.allPlayers) });
  }
  return out;
}
