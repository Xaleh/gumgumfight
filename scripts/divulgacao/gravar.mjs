// Grava a tela do site em alta resolução: Chromium com janela de verdade num Xvfb, capturado pelo ffmpeg
// (x11grab). O screencast do Chromium sem janela só entrega o tamanho em CSS (1280 × 720), e o zoom em CSS
// quebra a mesa (que usa unidades de viewport); com --force-device-scale-factor a mesa fica igual e nítida.
//
// O verso das cartas e a carta de DON!! do site são artes oficiais: na gravação, as duas imagens são trocadas
// pelas versões do GumGum (verso-gumgum.png e don-gumgum.png, geradas por imagens.mjs em $SAIDA).
//
// Rodar dentro do Xvfb, com o site no ar com CARD_IMAGES=off:
//   xvfb-run -a -s "-screen 0 2000x2200x24" node gravar.mjs replay <replay.json> <saida.mp4> <W> <H> <escala> <velocidade> <segundos>
//   xvfb-run -a -s "-screen 0 2000x2200x24" node gravar.mjs fluxo <home|tutorial|builder> <saida.mp4>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = process.env.SITE ?? 'http://localhost:5173/';
const SAIDA = process.env.SAIDA ?? new URL('./saida', import.meta.url).pathname;

async function open({ W, H, scale }) {
  const w = Math.round(W / scale);
  const h = Math.round(H / scale);
  const b = await chromium.launch({ headless: false, args: [`--force-device-scale-factor=${scale}`, `--window-size=${w},${h + 100}`, '--window-position=0,0', '--hide-scrollbars'] });
  const ctx = await b.newContext({ viewport: null, locale: 'pt-BR', colorScheme: 'dark' });
  await ctx.route(/card-back\.webp|don-card\.jpg/, (route) => {
    const u = route.request().url();
    if (u.includes('import')) return route.continue(); // o módulo JS do Vite, não a imagem
    route.fulfill({ contentType: 'image/png', body: readFileSync(`${SAIDA}/${u.includes('card-back') ? 'verso-gumgum.png' : 'don-gumgum.png'}`) });
  });
  const p = await ctx.newPage();
  await p.goto('about:blank');
  // Ajusta a janela para a área da página ficar exatamente com w × h.
  const cdp = await ctx.newCDPSession(p);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  for (let i = 0; i < 3; i++) {
    const [ow, oh, iw, ih] = await p.evaluate(() => [outerWidth, outerHeight, innerWidth, innerHeight]);
    if (iw === w && ih === h) break;
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: w + (ow - iw), height: h + (oh - ih) } });
    await p.waitForTimeout(400);
  }
  const [ow, oh, iw, ih] = await p.evaluate(() => [outerWidth, outerHeight, innerWidth, innerHeight]);
  return { b, p, W, H, top: Math.round((oh - ih) * scale), left: Math.round(((ow - iw) / 2) * scale) };
}

/** Começa a gravar a área da página; devolve a função que para. */
function record(s, out) {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', `${s.W}x${s.H}`,
    '-i', `${process.env.DISPLAY}+${s.left},${s.top}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  return () => new Promise((r) => { ff.on('close', r); ff.stdin.write('q'); });
}

const [, , cmd, ...args] = process.argv;

if (cmd === 'replay') {
  const [file, out, W, H, scale, speed, secs] = args;
  const s = await open({ W: +W, H: +H, scale: +scale });
  const { p } = s;
  const stop = record(s, out);
  await p.goto(SITE, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /replay/i }).first().click();
  await p.locator('.replay-sheet input[type=file]').setInputFiles(file);
  await p.locator('.replay-start').waitFor();
  await p.locator('.replay-sheet button').filter({ hasText: new RegExp(`^${String(speed).replace('.', '[.,]')}\\s*[×x]$`) }).first().click();
  await p.locator('.replay-start').click();
  await p.waitForTimeout(+secs * 1000);
  await stop();
  await s.b.close();
} else if (cmd === 'fluxo') {
  const [flow, out] = args;
  const s = await open({ W: 1920, H: 1080, scale: 1.5 });
  const { p } = s;
  const wait = (ms) => p.waitForTimeout(ms);
  await p.goto(SITE, { waitUntil: 'networkidle' });
  await wait(1200);
  const flows = {
    // Página inicial: desce até os modos de jogo e volta.
    async home() {
      const stop = record(s, out);
      await wait(1800);
      await p.evaluate(() => window.scrollTo({ top: 560, behavior: 'smooth' }));
      await wait(2600);
      await p.evaluate(() => window.scrollTo({ top: 1250, behavior: 'smooth' }));
      await wait(2600);
      await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await wait(1800);
      await stop();
    },
    // Lição 1 do tutorial, até a vitória.
    async tutorial() {
      await p.getByRole('button', { name: /Começar o tutorial/i }).first().click();
      await wait(1200);
      const stop = record(s, out);
      await wait(1500);
      await p.getByRole('button', { name: /Começar pela lição 1/i }).click();
      await wait(2800);
      for (let i = 0; i < 3; i++) {
        await p.getByRole('button', { name: /^Próximo$/ }).click();
        await wait(2200);
      }
      await p.locator('[data-uid]').filter({ hasText: 'Roronoa Zoro' }).first().click();
      await wait(1300);
      await p.getByRole('button', { name: /Atacar/ }).first().click();
      await wait(1000);
      await p.locator('[data-uid]').filter({ hasText: 'Crocodile' }).first().click();
      await wait(4500);
      await stop();
    },
    // Construtor: escolhe o Líder e adiciona 4 cópias de algumas cartas.
    async builder() {
      await p.locator('header').getByRole('button', { name: /Montar decks/ }).first().click();
      await wait(1500);
      const stop = record(s, out);
      await wait(1200);
      const cards = p.locator('.builder-catalog .card');
      await cards.filter({ hasText: 'Edward.Newgate' }).first().click();
      await wait(1600);
      for (const name of ['Sanji', 'Nami', 'Jinbe', 'Carrot', 'Franky', 'Komachiyo', 'Sai', 'Gordon']) {
        const c = cards.filter({ hasText: name }).first();
        await c.scrollIntoViewIfNeeded().catch(() => {});
        await c.hover();
        await wait(450);
        for (let k = 0; k < 4; k++) {
          await c.click();
          await wait(170);
        }
        await wait(250);
      }
      await p.mouse.move(1100, 300);
      await wait(2500);
      await stop();
    },
  };
  await flows[flow]();
  await s.b.close();
} else {
  console.error('uso: node gravar.mjs replay|fluxo …');
  process.exit(1);
}
