// Gravação dos vídeos: moldura vertical (1080x1920) com o app num iframe, screencast do CDP,
// marcas de tempo das falas e registro dos sons que o app tocou (para remixar depois).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:5173';
const FRAME_HTML = fs.readFileSync(path.join(__dirname, 'frame.html'), 'utf8');
const ICON = fs.readFileSync(path.join(__dirname, 'app-icon-192.png'));

// Roda dentro do iframe do app: toque visível e registro do áudio.
const APP_INIT = `(() => {
  if (location.pathname === '/__frame.html') return;
  window.__audioLog = [];
  const style = document.createElement('style');
  style.textContent = '.toast{pointer-events:none !important}.__tap{position:fixed;z-index:2147483647;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid rgba(238,111,60,.95);box-shadow:0 0 0 4px rgba(0,0,0,.15);pointer-events:none;animation:__tap .55s ease-out forwards}@keyframes __tap{0%{transform:scale(.4);opacity:1}70%{opacity:.9}100%{transform:scale(1.25);opacity:0}}';
  const add = () => document.head ? document.head.appendChild(style) : setTimeout(add, 20);
  add();
  addEventListener('pointerdown', (e) => {
    if (window.__noTap) return;
    const d = document.createElement('div'); d.className = '__tap';
    d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px';
    document.documentElement.appendChild(d); setTimeout(() => d.remove(), 700);
  }, true);
  // Hook no módulo de áudio do app (mesma instância que o app usa no Vite).
  const hook = () => import('/src/audio.ts').then(({ audio }) => {
    if (audio.__hooked) return; audio.__hooked = true;
    const log = (e) => window.__audioLog.push({ t: Date.now(), ...e });
    const play = audio.play.bind(audio), music = audio.music.bind(audio), setVolumes = audio.setVolumes.bind(audio);
    audio.play = (name, opts = {}) => { if (audio.unlocked) log({ k: 'sfx', name, gain: opts.gain ?? 1, delay: opts.delay ?? 0, pitch: opts.pitch ?? 0 }); return play(name, opts); };
    audio.music = (name) => { log({ k: 'music', name, unlocked: audio.unlocked }); return music(name); };
    audio.setVolumes = (v) => { log({ k: 'vol', ...v }); return setVolumes(v); };
    log({ k: 'vol', ...audio.volumes, init: true });
    // Destravamento: a música pedida antes começa a tocar no primeiro toque.
    const unlockWatch = () => { if (audio.unlocked) { log({ k: 'unlock', wanted: audio.wanted }); } else setTimeout(unlockWatch, 30); };
    unlockWatch();
  }).catch(() => setTimeout(hook, 200));
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => setTimeout(hook, 0)); else setTimeout(hook, 0);
})();`;

async function session({ prepare, id, title, settings = {}, localStorage: extraLs = {}, cookies = [], startPath = '/', beforeLoad, durations = {} }) {
  const outDir = path.join(ROOT, 'out', id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
  });
  if (cookies.length) await ctx.addCookies(cookies);
  await ctx.grantPermissions(['notifications'], { origin: BASE });
  await ctx.route(BASE + '/__frame.html', (r) => r.fulfill({ contentType: 'text/html', body: FRAME_HTML }));
  await ctx.route(BASE + '/icons/app-icon-192.png', (r) => r.fulfill({ contentType: 'image/png', body: ICON }));
  const ls = { 'gumgum.settings': JSON.stringify({ locale: 'pt-BR', theme: 'light', ...settings }), ...extraLs };
  await ctx.addInitScript((ls) => {
    if (sessionStorage.getItem('__lsdone')) return;
    sessionStorage.setItem('__lsdone', '1');
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  }, ls);
  await ctx.addInitScript(APP_INIT);
  if (beforeLoad) await beforeLoad(ctx);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE + '/__frame.html');
  await page.evaluate((t) => window.$title(t), title);
  await page.evaluate((src) => { document.getElementById('app').src = src; }, BASE + startPath);
  const frameEl = await page.waitForSelector('#app');
  let app = await frameEl.contentFrame();
  await app.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.fonts.ready);

  const prepared = prepare ? await prepare({ browser, ctx, page }) : undefined;
  // Screencast
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let writing = Promise.resolve();
  cdp.on('Page.screencastFrame', (f) => {
    const n = frames.length;
    const file = path.join(outDir, 'frames', `${String(n).padStart(6, '0')}.jpg`);
    frames.push({ file, t: f.metadata.timestamp });
    writing = writing.then(() => fs.promises.writeFile(file, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const t0 = Date.now() / 1000;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });

  const marks = [];
  const now = () => Date.now() / 1000 - t0;
  const sleep = (ms) => page.waitForTimeout(ms);
  const segs = [];

  const S = {
    page, ctx, browser, sleep, now, prepared,
    get app() { return app; },
    /** Locator dentro do app. */
    $: (sel) => app.locator(sel),
    role: (role, opts) => app.getByRole(role, opts),
    text: (t, opts) => app.getByText(t, opts),
    cap: (html) => page.evaluate((h) => window.$cap(h), html),
    badge: (text, kind) => page.evaluate(([t, k]) => window.$badge(t, k), [text, kind]),
    note: (n) => page.evaluate((n) => window.$note(n), n),
    card: (html) => page.evaluate((h) => window.$card(h), html),
    lock: (on) => page.evaluate((o) => window.$lock(o), on),
    mark: (name) => marks.push({ name, t: now() }),
    /**
     * Um trecho narrado: legenda na tela, ações e espera até a fala acabar (+ folga).
     * `durations[id]` vem do áudio gerado; sem ele, uma estimativa pelo texto.
     */
    seg: async (seg, fn) => {
      const start = now();
      const narrated = durations[seg.id] !== undefined;
      if (!narrated && seg.say) await S.cap(`<small>${seg.say}</small>`);
      else if (seg.caption !== undefined) await S.cap(seg.caption);
      const dur = narrated ? durations[seg.id] : Math.max(2.5, seg.say.split(/\s+/).length / 2.3 + 0.8);
      if (fn) await fn();
      const elapsed = now() - start;
      const minEnd = Math.max(dur + (seg.pad ?? 0.45), seg.min ?? 0);
      if (elapsed < minEnd) await sleep((minEnd - elapsed) * 1000);
      segs.push({ id: seg.id, start, end: now(), audio: dur });
    },
    async finish(tail = 0.6) {
      await sleep(tail * 1000);
      const end = now();
      await cdp.send('Page.stopScreencast').catch(() => {});
      await writing;
      // Áudio registrado no app (relógio de parede → segundos do vídeo).
      let audioLog = [];
      for (const f of page.frames()) {
        const l = await f.evaluate(() => window.__audioLog || null).catch(() => null);
        if (l) audioLog = audioLog.concat(l);
      }
      audioLog = audioLog.map((e) => ({ ...e, t: e.t / 1000 - t0 })).sort((a, b) => a.t - b.t);
      fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ end, frames: frames.map((f) => ({ file: path.basename(f.file), t: f.t - t0 })), segs, marks, audio: audioLog }, null, 1));
      await browser.close();
      console.log(`[${id}] ${frames.length} frames, ${end.toFixed(1)}s, segs: ${segs.map((s) => s.id + '@' + s.start.toFixed(1)).join(' ')}`);
    },
    /** Recarrega o app (por exemplo depois de mudar algo no localStorage). */
    async reloadApp(p = startPath) {
      await page.evaluate((src) => { document.getElementById('app').src = src; }, BASE + p + (p.includes('?') ? '&' : '?') + 'r=' + Date.now());
      await sleep(400);
      app = await (await page.$('#app')).contentFrame();
      await app.waitForLoadState('domcontentloaded');
    },
    /** Toque num elemento (clique com o indicador visual). */
    async tap(loc, opts = {}) {
      await loc.waitFor({ state: 'visible', timeout: opts.timeout ?? 15000 });
      await loc.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {});
      await loc.click({ timeout: opts.timeout ?? 15000, force: opts.force, position: opts.position });
      if (opts.after !== 0) await sleep(opts.after ?? 350);
    },
    /** Digita como uma pessoa. */
    async type(loc, text, delay = 95) {
      await loc.click();
      await loc.pressSequentially(text, { delay });
    },
    /** Rola suavemente o elemento até o centro da tela do app. */
    async scrollTo(loc, block = 'center') {
      await loc.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
      await sleep(700);
    },
    async scrollBy(y) {
      await app.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), y);
      await sleep(700);
    },
  };
  return S;
}

module.exports = { session, BASE, ROOT };
