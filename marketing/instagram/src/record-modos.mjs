// Grava os modos novos (Selado, Pack Rush, Draft, Draft Cubo e All Blue) em 1080x1920 e salva em
// src/clips/modos-*.mp4, de onde o reel.mjs tira as amostras, os Reels e os stories.
//   npm run dev                                   (em outro terminal)
//   npm run cards:import -- --all                 (o Cubo e o Pack Rush precisam de todas as coleções)
//   node marketing/instagram/src/record-modos.mjs [modo…]
// Modos: selado, selado-deck, packrush, draft, cubo, allblue. Sem argumento, grava todos.
//
// A abertura de booster é pesada demais para gravar em tempo real (sai travada). Por isso a página
// roda em câmera lenta: temporizadores e animações CSS ficam WARP vezes mais lentos durante a
// gravação, e o vídeo é acelerado WARP vezes no fim. O resultado sai liso e na velocidade normal.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MODOS_OUT || join(SRC, 'clips');
const APP = process.env.APP_URL || 'http://localhost:5173/';
const WARP = Number(process.env.WARP || 4);
const W = 432, H = 768, SCALE = 2.5; // tela de celular 9:16 → 1080x1920

/** Roda dentro da página, antes do app: deixa o tempo `k` vezes mais lento. */
function slowDown(k) {
  const timeout = window.setTimeout, interval = window.setInterval;
  window.setTimeout = (fn, ms, ...rest) => timeout(fn, (ms || 0) * k, ...rest);
  window.setInterval = (fn, ms, ...rest) => interval(fn, (ms || 0) * k, ...rest);
  const sweep = () => { for (const anim of document.getAnimations()) { try { if (anim.playbackRate !== 1 / k) anim.playbackRate = 1 / k; } catch { /* animação já encerrada */ } } };
  for (const event of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(event, sweep, true);
  const loop = () => { sweep(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  // Rolagem suave feita com temporizador, para acompanhar a câmera lenta (a do navegador não acompanha).
  window.__scroll = (dy, ms) => new Promise((done) => {
    const steps = Math.max(1, Math.round(ms / 16)), y0 = scrollY;
    let i = 0;
    const id = window.setInterval(() => {
      const t = ++i / steps;
      scrollTo(0, y0 + dy * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
      if (i >= steps) { clearInterval(id); done(); }
    }, 16);
  });
}

const { chromium } = require('playwright');

/** Abre o app num navegador novo. `storage` preenche o localStorage antes de o app carregar. */
async function open(storage = {}) {
  // O fator de escala vai na linha de comando do Chromium: só assim o screencast sai em 1080x1920.
  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${W},${H}`] });
  const context = await browser.newContext({ viewport: null, colorScheme: 'dark', locale: 'pt-BR' });
  await context.addInitScript(slowDown, WARP);
  await context.addInitScript((items) => { if (!localStorage.getItem('gumgum.owner')) for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }, storage);
  const page = await context.newPage();
  page.setDefaultTimeout(9000 * WARP);
  /** Espera `ms` no tempo do vídeo. */
  page.w = (ms) => page.waitForTimeout(ms * WARP);
  page.scroll = (dy, ms = 900) => page.evaluate(([y, t]) => window.__scroll(y, t), [dy, ms]);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.w(300);
  // O Yonko ainda não é divulgado: o cartão dele some da tela inicial durante a gravação.
  await page.evaluate(() => { for (const card of document.querySelectorAll('.mode-grid.special > article')) if (/Yonko/.test(card.querySelector('h3')?.innerText || '')) card.style.display = 'none'; });
  return { browser, context, page };
}

/** Começa a gravar; `stop()` monta `modos-<name>.mp4` a 30 fps, já na velocidade normal. */
async function record(context, page, name) {
  const dir = mkdtempSync(join(tmpdir(), 'ggf-modos-'));
  const cdp = await context.newCDPSession(page);
  const frames = [], marks = [];
  let live = true;
  cdp.on('Page.screencastFrame', (frame) => {
    if (!live) return;
    const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(frame.data, 'base64'));
    frames.push({ file, t: frame.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1, maxWidth: W * SCALE, maxHeight: H * SCALE });
  const t0 = Date.now();
  return {
    /** Anota o segundo do vídeo em que algo acontece, para acertar os cortes no reel.mjs. */
    mark: (label) => marks.push(`${((Date.now() - t0) / 1000 / WARP).toFixed(1)} ${label}`),
    async stop() {
      live = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      // Os quadros chegam em intervalos irregulares: a lista leva a duração de cada um.
      const list = frames.map((f, i) => `file '${f.file}'\nduration ${(i + 1 < frames.length ? frames[i + 1].t - f.t : 0.04).toFixed(4)}`).join('\n');
      writeFileSync(join(dir, 'list.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
      mkdirSync(OUT, { recursive: true });
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', `setpts=PTS/${WARP},fps=30,scale=1080:1920:flags=lanczos`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', join(OUT, `modos-${name}.mp4`)]);
      rmSync(dir, { recursive: true, force: true });
      console.log(`modos-${name}.mp4: ${((frames.at(-1).t - frames[0].t) / WARP).toFixed(1)} s · ${marks.join(' | ')}`);
    },
  };
}

const button = (page, name, exact) => page.getByRole('button', { name, exact });
/** Rola até o elemento ficar a `offset` px do topo. */
async function scrollTo(page, locator, offset = 500, ms = 1000) {
  const top = await locator.first().evaluate((el) => el.getBoundingClientRect().top);
  await page.scroll(top - offset, ms);
}

/** Abre o primeiro booster com a cena inteira, vira as cartas e abre os que faltam. */
async function openBoosters(page, rec, flips = 3) {
  await button(page, 'Abrir o primeiro').waitFor();
  await page.w(1600);
  await button(page, 'Abrir o primeiro').click();
  rec.mark('cena');
  await button(page, 'Revelar tudo').waitFor();
  await page.w(800);
  rec.mark('mesa');
  for (let i = 0; i < flips; i++) { await page.locator('.po-card:not(.shown):not(.hit)').first().click(); await page.w(480); }
  const highlight = page.locator('.po-card.hit:not(.shown)');
  if (await highlight.count()) { await highlight.first().click(); rec.mark('destaque'); await page.w(1100); }
  await button(page, 'Revelar tudo').click().catch(() => {});
  rec.mark('revelar');
  await page.w(2000);
  await button(page, 'Continuar').click();
  await page.w(1300);
  await button(page, /que faltam/).click();
  rec.mark('faltam');
  for (let i = 0; i < 60 && (await page.locator('.po').count()); i++) {
    await page.w(700);
    const next = button(page, 'Continuar');
    if (await next.count()) { await page.w(900); await next.click().catch(() => {}); }
  }
  rec.mark('abertos');
  await page.w(1400);
}

/** Abre os 6 boosters pulando as animações (para chegar logo à montagem do deck). */
async function skipBoosters(page) {
  const dismiss = async () => { for (let i = 0; i < 3; i++) { const next = button(page, 'Continuar'); if (await next.count()) { await next.click(); await page.w(250); } } };
  await button(page, 'Abrir o primeiro').waitFor();
  await button(page, 'Abrir o primeiro').click();
  await page.w(250);
  await button(page, 'Pular').click().catch(() => {});
  await page.w(300);
  await dismiss();
  await button(page, /que faltam/).click();
  await page.w(250);
  await button(page, 'Pular').click().catch(() => {});
  await page.w(400);
  await dismiss();
  await button(page, 'Montar o deck').waitFor();
}

/** Escolhe a carta de índice `index` do booster do Draft e confirma. */
async function pick(page, index) {
  const cells = page.locator('.draft-pack .grid-cell');
  const count = await cells.count();
  if (!count) return;
  await cells.nth(Math.min(index, count - 1)).locator('> *').first().click();
  await page.w(650);
  await page.locator('.draft-confirm .mode-btn').click();
}

/** Faz as escolhas de `indexes`, esperando o booster seguinte chegar entre uma e outra. */
async function picks(page, rec, indexes) {
  for (const [i, index] of indexes.entries()) {
    const before = await page.locator('.draft-pack .grid-cell').count();
    await pick(page, index);
    rec.mark(`escolha${i + 1}`);
    for (let j = 0; j < 40; j++) { await page.w(250); const now = await page.locator('.draft-pack .grid-cell').count(); if (now && now !== before) break; }
    await page.w(900);
  }
}

/** Começa a partida (dados, mão inicial e modo Auto) e deixa rolar por `seconds` segundos de vídeo. */
async function play(page, rec, seconds) {
  await button(page, 'Pular').waitFor();
  await page.w(1500);
  await button(page, 'Pular').click();
  rec.mark('dados');
  for (let i = 0; i < 20; i++) {
    await page.w(500);
    if (await button(page, 'Manter mão').count()) { await page.w(1600); await button(page, 'Manter mão').click(); break; }
    if (await button(page, 'Jogar primeiro').count()) await button(page, 'Jogar primeiro').click();
  }
  rec.mark('mao');
  await page.w(900);
  await button(page, 'Auto').click();
  const end = Date.now() + seconds * 1000 * WARP;
  while (Date.now() < end) {
    await page.w(400);
    const ok = button(page, 'Entendi'); // aviso de carta revelada: o modo Auto não fecha sozinho
    if (await ok.count()) { await page.w(700); await ok.first().click({ timeout: 2000 }).catch(() => {}); }
  }
}

// Cada gravação usa um "dono" próprio (o id que o app guarda no navegador), para os decks selados
// de uma não aparecerem na outra.
const owner = (letter) => ({ 'gumgum.owner': letter.repeat(48) });

const modes = {
  /** Selado: escolha da coleção e abertura dos 6 boosters. */
  async selado() {
    const { browser, context, page } = await open(owner('a'));
    await button(page, 'Abrir boosters').click();
    await page.w(700);
    const rec = await record(context, page, 'selado');
    await page.w(1200);
    await page.scroll(900, 1400); await page.w(300); await page.scroll(-900, 900); await page.w(300);
    const set = button(page, /^OP09 /);
    await scrollTo(page, set, 800, 700); await page.w(300);
    await set.click(); rec.mark('colecao'); await page.w(800);
    await scrollTo(page, button(page, /^Abrir 6 boosters/), 1000, 900); await page.w(500);
    await button(page, /^Abrir 6 boosters/).click(); rec.mark('abrir6');
    await openBoosters(page, rec, 4);
    await rec.stop();
    await browser.close();
  },
  /** Selado: montagem do deck ("Montar sozinho") e partida contra o bot. */
  async 'selado-deck'() {
    const { browser, context, page } = await open(owner('b'));
    await button(page, 'Abrir boosters').click();
    await page.w(500);
    const set = button(page, /^OP09 /);
    await set.scrollIntoViewIfNeeded(); await set.click(); await page.w(200);
    await button(page, /^Abrir 6 boosters/).click();
    await skipBoosters(page);
    await scrollTo(page, button(page, 'Montar o deck'), 700, 300); await page.w(400);
    const rec = await record(context, page, 'selado-deck');
    await page.w(900);
    await button(page, 'Montar o deck').click(); rec.mark('montar'); await page.w(1700);
    await page.scroll(650, 1300); await page.w(500);
    await scrollTo(page, button(page, 'Montar sozinho'), 1100, 1200); await page.w(700);
    await button(page, 'Montar sozinho').first().click(); rec.mark('sozinho'); await page.w(2200);
    await page.scroll(-1500, 1500); rec.mark('lista'); await page.w(1200);
    await scrollTo(page, button(page, 'Contra o bot'), 900, 1500); await page.w(800);
    await button(page, 'Contra o bot').click(); rec.mark('bot');
    await play(page, rec, 16);
    await rec.stop();
    await browser.close();
  },
  /** Pack Rush: cinco coleções marcadas e os boosters sorteados entre elas. */
  async packrush() {
    const { browser, context, page } = await open(owner('c'));
    await button(page, 'Abrir boosters').click();
    await page.w(700);
    const rec = await record(context, page, 'packrush');
    await page.w(1100);
    await button(page, 'Pack Rush', true).click(); rec.mark('packrush'); await page.w(1100);
    for (const code of ['OP13', 'OP09', 'OP05', 'OP01', 'EB01']) {
      const set = button(page, new RegExp(`^${code} `));
      await scrollTo(page, set, 800, 550); await page.w(200);
      await set.click(); rec.mark(code); await page.w(380);
    }
    await scrollTo(page, button(page, /^Abrir 6 boosters/), 1000, 900); await page.w(700);
    await button(page, /^Abrir 6 boosters/).click(); rec.mark('abrir6');
    await openBoosters(page, rec, 3);
    await rec.stop();
    await browser.close();
  },
  /** Draft: pod com 7 bots, seis escolhas e, no fim, a montagem do deck (em modos-draft-fim.mp4). */
  async draft() {
    const { browser, context, page } = await open(owner('d'));
    await button(page, 'Draftar').click();
    await page.w(700);
    const rec = await record(context, page, 'draft');
    await page.w(1300);
    await page.scroll(520, 1000); await page.w(400); await page.scroll(-520, 800); await page.w(400);
    await scrollTo(page, button(page, 'Criar pod de Draft'), 1100, 1100); await page.w(600);
    await button(page, 'Criar pod de Draft').click(); rec.mark('pod');
    await button(page, /Começar com/).waitFor(); await page.w(2200);
    await button(page, /Começar com/).click(); rec.mark('comecar');
    await page.locator('.draft-pack .grid-cell').first().waitFor(); await page.w(2000);
    await picks(page, rec, [1, 4, 0, 2, 3, 1]);
    await page.scroll(1300, 1400); rec.mark('escolhas'); await page.w(1500); await page.scroll(-1300, 1000); await page.w(600);
    await rec.stop();
    // As outras 42 escolhas, sem gravar (até 5 minutos e meio).
    for (const limit = Date.now() + 330000; Date.now() < limit && !(await page.getByText('Draft concluído').count()); ) {
      await pick(page, 0).catch(() => {});
      await page.waitForTimeout(700);
    }
    if (await page.getByText('Draft concluído').count()) {
      await page.w(500);
      const end = await record(context, page, 'draft-fim');
      await page.w(1600);
      await page.locator('.sealed-open-row .mode-btn').first().click(); end.mark('montar'); await page.w(1800);
      await scrollTo(page, button(page, 'Montar sozinho'), 1100, 1200); await page.w(600);
      await button(page, 'Montar sozinho').first().click(); end.mark('sozinho'); await page.w(2200);
      await page.scroll(-1400, 1400); await page.w(1200);
      await end.stop();
    } else console.log('O draft não terminou a tempo: modos-draft-fim.mp4 não foi gravado.');
    await browser.close();
  },
  /** Draft Cubo: a lista do Cubo GumGum, o pod e quatro escolhas. */
  async cubo() {
    const { browser, context, page } = await open(owner('e'));
    await button(page, 'Draftar').click();
    await page.w(700);
    const rec = await record(context, page, 'cubo');
    await page.w(1000);
    await button(page, 'Cubo', true).click(); rec.mark('cubo'); await page.w(1800);
    await scrollTo(page, button(page, 'Ver a lista'), 900, 800); await page.w(400);
    await button(page, 'Ver a lista').click(); rec.mark('lista'); await page.w(1500);
    await page.scroll(1500, 2200); await page.w(600);
    await page.keyboard.press('Escape'); await page.w(600);
    const create = button(page, /Criar pod de Draft Cubo/);
    await scrollTo(page, create, 1000, 1000); await page.w(600);
    await create.click(); rec.mark('pod');
    await button(page, /Começar com/).waitFor(); await page.w(1500);
    await button(page, /Começar com/).click(); rec.mark('comecar');
    await page.locator('.draft-pack .grid-cell').first().waitFor(); await page.w(2200);
    await picks(page, rec, [2, 0, 5, 1]);
    await rec.stop();
    await browser.close();
  },
  /** All Blue: troca de formato, escolha de um deck pronto e partida contra o bot. */
  async allblue() {
    // Começa no EGB com um deck que não vale no All Blue, para a troca de formato aparecer no vídeo.
    const { browser, context, page } = await open({ ...owner('f'), 'gumgum.format': 'egb', 'gumgum.lastDecks': JSON.stringify(['st10-kid', 'allblue-kid']) });
    await scrollTo(page, page.locator('.deck-strip'), 520, 300); await page.w(500);
    const rec = await record(context, page, 'allblue');
    await page.w(1200);
    await page.locator('.deck-strip').getByRole('button', { name: 'All Blue' }).click(); rec.mark('formato'); await page.w(1900);
    await button(page, 'Trocar deck').click(); rec.mark('decks'); await page.w(1300);
    await page.locator('input[aria-label*="Buscar deck"], input[placeholder*="Buscar deck"]').first().pressSequentially('All Blue', { delay: 70 * WARP });
    await page.w(1200);
    // No seletor, o toque no deck só o seleciona; "Usar este deck" é que equipa.
    await button(page, /Luffy Vermelho \(All B/).first().click(); rec.mark('deck'); await page.w(900);
    await button(page, 'Usar este deck').first().click(); rec.mark('usar'); await page.w(1700);
    await scrollTo(page, page.getByText('Contra o bot', { exact: true }), 420, 1400); await page.w(900);
    await button(page, /batalhar/i).first().click(); rec.mark('batalhar'); await page.w(1500);
    await button(page, /batalhar/i).last().click(); rec.mark('confirmar');
    await play(page, rec, 12);
    await rec.stop();
    await browser.close();
  },
};

const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(modes)) {
  if (!modes[name]) { console.error(`Modo desconhecido: ${name}. Use: ${Object.keys(modes).join(', ')}.`); process.exit(1); }
  await modes[name]();
}
