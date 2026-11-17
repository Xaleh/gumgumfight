// Gera os Reels (MP4 1080x1920, 30 fps) a partir de cenas em HTML com animações CSS.
//   node marketing/instagram/src/reel.mjs            → todos
//   node marketing/instagram/src/reel.mjs reel-02    → só os que têm "reel-02" no nome
// Cada quadro é desenhado no Chromium (as animações são avançadas à mão, então o vídeo sai
// liso em qualquer máquina) e o ffmpeg junta tudo. Os trechos de partida vêm de
// src/clips/partida.mp4, gravado com record.mjs (o arquivo não vai para o git).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, '..', 'reels');
const ICONS = JSON.parse(readFileSync(join(SRC, 'icons.json'), 'utf8'));
const FPS = 30;
const CLIP = join(SRC, 'clips', 'partida.mp4');
const URL_TEXT = 'gumgumfight.app';

const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
/** Anima a entrada de um bloco: `pop` (salta) ou `up` (sobe), começando em `d` segundos. */
const a = (kind, d, html, style = '') => `<div class="a-${kind}" style="--d:${d}s;${style}">${html}</div>`;

/** Cena com título em cima e o celular embaixo; a tela do celular é um clipe ou uma rolagem. */
function phoneScene({ dur, eyebrow, title, lead, clip, pan, deep = true }) {
  const screen = pan
    ? `<img class="pan" src="shots/${pan.img}" style="--from:${pan.from}px;--to:${pan.to}px;animation-duration:${dur}s" alt="">`
    : '<img data-clip alt="">';
  return {
    dur,
    clip: clip && { start: clip, width: 720 },
    cls: `${deep ? 'deep ' : ''}burst spin`,
    html: `<div class="layer col center" style="padding:250px 70px 0;gap:18px">
      ${a('up', 0.05, `<div class="eyebrow">${eyebrow}</div>`)}
      ${a('pop', 0.12, `<div class="h h3">${title}</div>`)}
      ${a('up', 0.3, `<div class="lead sm" style="max-width:900px">${lead}</div>`)}
      ${a('pop', 0.2, `<div class="phone" style="--pw:640px;--rot:-2deg"><div>${screen}</div></div>`, 'margin-top:34px')}
    </div>`,
  };
}

function modeScene({ color, ico, tag, title, lead }) {
  return {
    dur: 2.3,
    cls: 'deep burst spin',
    html: `<div class="layer col" style="padding:0 70px 180px;justify-content:center">
      ${a('pop', 0.02, `<div class="mode col" style="--c:${color};gap:30px">
        <div class="ico">${icon(ico)}</div>
        <div class="tag" style="margin-top:10px">${tag}</div>
        <div class="h h2" style="margin-top:-6px">${title}</div>
        <div class="lead" style="margin-top:8px">${lead}</div>
      </div>`)}
    </div>`,
  };
}

const intro = (eyebrow, title, dur = 2.5) => ({
  dur,
  cls: 'burst spin vignette',
  html: `<div class="layer col center" style="--by:42%;padding:0 70px 160px;justify-content:center;gap:0">
    ${a('pop', 0.05, `<img src="mark.svg" style="height:520px;filter:drop-shadow(14px 18px 0 #1f0904)" alt="">`)}
    ${a('up', 0.45, `<div class="eyebrow" style="font-size:38px">${eyebrow}</div>`, 'margin-top:60px')}
    ${a('pop', 0.6, `<div class="h h1">${title}</div>`, 'margin-top:26px')}
  </div>`,
});

const outro = (dur = 3.2) => ({
  dur,
  cls: 'burst spin vignette',
  html: `<div class="layer col center" style="--by:44%;padding:0 70px 200px;justify-content:center;gap:44px">
    ${a('pop', 0.05, `<div class="h h1 y">Bora<br>jogar?</div>`)}
    ${a('up', 0.4, `<div class="lead" style="max-width:820px">No navegador, de graça,<br>no celular ou no PC.</div>`)}
    ${a('pop', 0.65, `<div class="btn">${URL_TEXT}</div>`)}
    ${a('up', 0.95, `<div class="chip">Link na bio</div>`)}
    ${a('up', 1.1, `<img src="logo.svg" style="height:92px;margin-top:40px" alt="">`)}
  </div>`,
});

/** Trecho de partida em tela cheia, com uma legenda no topo. */
const fullClip = (start, dur, caption) => ({
  dur,
  clip: { start, width: 1080 },
  cls: 'deep',
  html: `<img data-clip class="full" alt=""><div class="scrim"></div>
    <div class="layer col" style="padding:255px 60px 0;gap:20px;align-items:flex-start">
      ${a('up', 0.05, `<img src="logo.svg" style="height:84px" alt="">`)}
      ${caption ? a('pop', 0.2, `<div class="h h4 y">${caption}</div>`, 'margin-top:8px') : ''}
    </div>`,
});

const reels = {
  'reel-01-apresentacao': [
    intro('One Piece Card Game', 'Direto do<br><em>navegador</em>'),
    phoneScene({ dur: 4, eyebrow: 'Treino', title: 'Treine contra o <em>bot</em>', lead: 'Qualquer deck, sem fila e sem pressa.', clip: 54.4 }),
    phoneScene({ dur: 3.8, eyebrow: 'Online', title: 'Jogue <em>online</em>', lead: 'Casual, ranqueada ou sala privada com os amigos.', pan: { img: 'pan-modos.jpg', from: 0, to: -1250 }, deep: false }),
    phoneScene({ dur: 3.6, eyebrow: 'Decks', title: 'Monte <em>seus decks</em>', lead: 'Mais de 3.000 cartas e decks prontos.', pan: { img: 'pan-decks.jpg', from: -180, to: -1150 } }),
    phoneScene({ dur: 3.6, eyebrow: 'Nunca jogou?', title: 'Aprenda em <em>14 lições</em>', lead: 'Na mesa de verdade, sem login.', pan: { img: 'pan-aprender.jpg', from: 0, to: -900 }, deep: false }),
    outro(3.4),
  ],
  'reel-02-partida': [
    fullClip(47.2, 3.1, 'Seu turno!'),
    fullClip(54.3, 4.3, 'Ataque, counter...'),
    fullClip(68.4, 4.8, '...e vida a menos'),
    outro(3.0),
  ],
  'reel-03-modos-de-jogo': [
    intro('Escolha seu modo', '<em>5 jeitos</em><br>de jogar', 2.2),
    modeScene({ color: '#e0523f', ico: 'trophy', tag: 'Competitivo', title: 'Ranqueada', lead: 'Vale bounty. De East Blue até Yonkou.' }),
    modeScene({ color: '#2fae78', ico: 'swords', tag: 'Casual', title: 'Partida rápida', lead: 'Sem bounty em jogo. Ideal para testar um deck novo.' }),
    modeScene({ color: '#4d8fe0', ico: 'key', tag: 'Com amigos', title: 'Sala privada', lead: 'Crie uma sala e mande o código.' }),
    modeScene({ color: '#a765c9', ico: 'bot', tag: 'Treino', title: 'Contra o bot', lead: 'Qualquer deck, sem fila e sem pressa.' }),
    modeScene({ color: '#e6bb1e', ico: 'crown', tag: 'Eventos', title: 'Torneios', lead: 'Suíço, mata-mata e melhor de 3 ou de 5.' }),
    outro(3.0),
  ],
};

const css = `
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0b1726; }
.scene { position: absolute; inset: 0; display: none; height: 1920px; }
.scene.on { display: block; }
.scene.burst::before { inset: -60%; }
.spin::before { animation: spin 40s linear both; }
.phone img.pan { animation: pan linear both; top: 0; }
img.full { position: absolute; inset: 0; width: 1080px; height: 1920px; }
.scrim { position: absolute; inset: 0 0 auto 0; height: 640px; background: linear-gradient(#0b1726 0%, rgba(11, 23, 38, 0.88) 45%, transparent 100%); z-index: 1; }
.a-pop { animation: pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.25) both; animation-delay: var(--d, 0s); }
.a-up { animation: up 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: var(--d, 0s); }
@keyframes pop { 0% { opacity: 0; transform: scale(0.6) rotate(-6deg); } 100% { opacity: 1; transform: none; } }
@keyframes up { from { opacity: 0; transform: translateY(70px); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(60deg); } }
@keyframes pan { from { transform: translateY(var(--from)); } to { transform: translateY(var(--to)); } }
`;

const filters = process.argv.slice(2);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
mkdirSync(OUT, { recursive: true });

for (const [name, scenes] of Object.entries(reels)) {
  if (filters.length && !filters.some((f) => name.includes(f))) continue;
  const tmp = mkdtempSync(join(tmpdir(), 'ggf-reel-'));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="kit.css"><style>${css}</style></head><body>
${scenes.map((s, i) => `<section class="slide story scene ${s.cls}" id="s${i}">${s.html}</section>`).join('\n')}</body></html>`;
  const file = join(SRC, `.${name}.html`);
  writeFileSync(file, html);
  await tab.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  let n = 0;
  for (const [i, scene] of scenes.entries()) {
    const frames = Math.round(scene.dur * FPS);
    let clipFrames = [];
    if (scene.clip) {
      const dir = join(tmp, `clip${i}`);
      mkdirSync(dir);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(scene.clip.start), '-t', String(scene.dur + 0.2), '-i', CLIP, '-vf', `fps=${FPS},scale=${scene.clip.width}:-2:flags=lanczos`, '-q:v', '2', join(dir, '%05d.jpg')]);
      clipFrames = readdirSync(dir).sort().map((f) => pathToFileURL(join(dir, f)).href);
    }
    await tab.evaluate((id) => { document.querySelectorAll('.scene').forEach((s) => s.classList.toggle('on', s.id === id)); }, `s${i}`);
    for (let f = 0; f < frames; f++) {
      await tab.evaluate(async ({ t, src }) => {
        const img = document.querySelector('.scene.on [data-clip]');
        if (img && src) { img.src = src; await img.decode(); }
        for (const anim of document.getAnimations()) { anim.pause(); anim.currentTime = t; }
      }, { t: (f / FPS) * 1000, src: clipFrames[Math.min(f, clipFrames.length - 1)] });
      await tab.screenshot({ path: join(tmp, `${String(n++).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 94 });
    }
    console.log(name, `cena ${i + 1}/${scenes.length}`);
  }
  // Trilha muda: o áudio é escolhido no próprio Instagram.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, '%06d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', join(OUT, `${name}.mp4`)]);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(file);
  console.log(name, 'pronto');
}
await browser.close();
