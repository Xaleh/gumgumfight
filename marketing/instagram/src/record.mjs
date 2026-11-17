// Grava uma partida de treino (o modo Auto joga pelos dois lados) em 1080x1920 e salva em
// src/clips/partida.mp4, de onde o reel.mjs tira os trechos.
//   npm run dev                                   (em outro terminal)
//   node marketing/instagram/src/record.mjs [segundos=110] [url=http://localhost:5173/]
// Depois de regravar, confira os tempos dos trechos em reel.mjs (`clip` e `fullClip`).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SRC = dirname(fileURLToPath(import.meta.url));
const SECONDS = Number(process.argv[2] || 110);
const APP = process.argv[3] || 'http://localhost:5173/';
const W = 432, H = 768, SCALE = 2.5; // tela de celular 9:16 → 1080x1920

const { chromium } = require('playwright');
// O fator de escala vai na linha de comando do Chromium: só assim o screencast sai em 1080x1920.
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${W},${H}`] });
const context = await browser.newContext({ viewport: null, colorScheme: 'dark', locale: 'pt-BR' });
const page = await context.newPage();
await page.goto(APP, { waitUntil: 'networkidle' });
const start = page.getByRole('button', { name: /batalhar/i });
await start.first().scrollIntoViewIfNeeded();
await start.first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: /batalhar/i }).last().click();
await page.waitForTimeout(2500);

const tmp = mkdtempSync(join(tmpdir(), 'ggf-rec-'));
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', (frame) => {
  const name = `f${String(frames.length).padStart(6, '0')}.jpg`;
  writeFileSync(join(tmp, name), Buffer.from(frame.data, 'base64'));
  frames.push({ name, t: frame.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1, maxWidth: W * SCALE, maxHeight: H * SCALE });
const t0 = Date.now();

await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Pular' }).click(); // pula a rolagem dos dados
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const keep = page.getByRole('button', { name: 'Manter mão' });
  if (await keep.count()) { await page.waitForTimeout(2200); await keep.click(); break; }
  const first = page.getByRole('button', { name: 'Jogar primeiro' }); // quando você ganha o sorteio
  if (await first.count()) await first.click();
}
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Auto' }).click({ timeout: 5000 });
while (Date.now() - t0 < SECONDS * 1000) await page.waitForTimeout(1000);
await cdp.send('Page.stopScreencast');
await browser.close();

// Os quadros chegam em intervalos irregulares: a lista leva a duração de cada um e o ffmpeg iguala em 30 fps.
const list = frames.map((f, i) => `file '${f.name}'\nduration ${(i + 1 < frames.length ? frames[i + 1].t - f.t : 0.04).toFixed(4)}`).join('\n');
writeFileSync(join(tmp, 'list.txt'), `${list}\nfile '${frames.at(-1).name}'\n`);
mkdirSync(join(SRC, 'clips'), { recursive: true });
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-vf', 'fps=30,scale=1080:1920:flags=lanczos',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', join(SRC, 'clips', 'partida.mp4')]);
rmSync(tmp, { recursive: true, force: true });
console.log(`${frames.length} quadros → src/clips/partida.mp4`);
