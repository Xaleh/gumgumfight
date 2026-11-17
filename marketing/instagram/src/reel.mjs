// Gera os Reels (MP4 1080x1920, 30 fps) a partir de cenas em HTML com animações CSS.
//   node marketing/instagram/src/reel.mjs            → todos
//   node marketing/instagram/src/reel.mjs reel-02    → só os que têm "reel-02" no nome
// Cada quadro é desenhado no Chromium (as animações são avançadas à mão, então o vídeo sai
// liso em qualquer máquina) e o ffmpeg junta tudo. Os trechos de partida vêm de
// src/clips/ (partida.mp4 é gravado com record.mjs; a pasta não vai para o git).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SRC = dirname(fileURLToPath(import.meta.url));
const KIT = join(SRC, '..');
const ICONS = JSON.parse(readFileSync(join(SRC, 'icons.json'), 'utf8'));
const FPS = 30;
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


// ------------------------------------------------ série "Mihawk aprende a jogar"
// Vídeos de apoio para intercalar com as gravações do cosplay: telas do app sem texto por cima,
// cartelas e encerramentos. Os roteiros estão em mihawk/README.md.
const MIHAWK = 'mihawk.mp4';
/** Trecho de partida limpo, em tela cheia. */
const raw = (start, dur, file = MIHAWK) => ({ dur, clip: { file, start, width: 1080 }, cls: 'deep', html: '<img data-clip class="full" alt="">' });
/** Captura de tela alta, rolando de `from` a `to` (px). */
const scroll = (img, from, to, dur) => ({ dur, cls: 'deep', html: `<img class="scroll" src="shots/${img}" style="--from:${from}px;--to:${to}px;animation-duration:${dur}s" alt="">` });
/** Captura de tela parada (1080x1920), aproximando `to` vezes no ponto (cx, cy) e levando-o para o centro do quadro. */
function zoom(img, dur, to, cx = 540, cy = 960) {
  // O deslocamento é limitado para a imagem nunca descobrir as bordas do quadro.
  const shift = (center, size) => Math.min(center * (to - 1), Math.max((size - center) * (1 - to), size / 2 - center));
  const style = `--zt:${to};--tx:${shift(cx, 1080).toFixed(1)}px;--ty:${shift(cy, 1920).toFixed(1)}px;transform-origin:${cx}px ${cy}px;animation-duration:${dur}s`;
  return { dur, cls: 'deep', html: `<img class="zoom" src="shots/${img}" style="${style}" alt="">` };
}
const timeCard = (text) => ({
  dur: 2,
  cls: 'deep',
  html: `<div class="layer col center" style="justify-content:center;padding:0 70px 200px">${a('up', 0.08, `<div class="h h2" style="font-size:150px">${text}</div>`)}</div>`,
});
const episodeEnd = (n, title, next) => ({
  dur: 3,
  cls: 'deep burst spin vignette',
  html: `<div class="layer col center" style="--by:44%;padding:0 70px 230px;justify-content:center;gap:30px">
    ${a('up', 0.05, `<div class="eyebrow" style="font-size:38px">Mihawk aprende a jogar</div>`)}
    ${a('pop', 0.15, `<div class="h h1 y">Ep. ${n}</div>`)}
    ${a('up', 0.35, `<div class="lead" style="font-size:56px">${title}</div>`)}
    ${a('up', 0.7, `<div class="chip" style="font-size:36px">${next}</div>`, 'margin-top:24px')}
    ${a('pop', 0.9, `<div class="btn" style="font-size:58px">${URL_TEXT}</div>`, 'margin-top:14px')}
    ${a('up', 1.1, `<img src="logo.svg" style="height:84px;margin-top:34px" alt="">`)}
  </div>`,
});
const LEAGUES = [['Yonkou', '฿ 250.001+'], ['Shichibukai', '฿ 100.001+'], ['Supernova', '฿ 50.001+'], ['Novo Mundo', '฿ 20.001+'], ['Paradise', '฿ 5.001+'], ['East Blue', '฿ 0']];
const leagues = () => ({
  dur: 4.5,
  cls: 'deep burst spin',
  html: `<div class="layer col" style="--by:50%;padding:260px 80px 0;gap:26px">
    ${a('up', 0.05, `<div class="eyebrow" style="font-size:36px">Ranqueada</div>`)}
    ${a('pop', 0.12, `<div class="h h3">As <em>seis ligas</em></div>`)}
    <div class="ladder big" style="margin-top:34px">
      ${LEAGUES.map(([name, bounty], i) => a('up', 0.4 + (LEAGUES.length - 1 - i) * 0.32, `<div class="${name === 'Shichibukai' ? 'top' : name === 'East Blue' ? 'here' : ''}">${name}${name === 'East Blue' ? ' <i>você está aqui</i>' : ''}${name === 'Shichibukai' ? ' <i>o antigo título</i>' : ''} <span>${bounty}</span></div>`)).join('')}
    </div>
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
  'mihawk/videos/insert-banido': [{
    dur: 2.5,
    cls: 'deep burst spin vignette',
    html: `<div class="layer col center" style="--by:46%;justify-content:center;padding:0 80px 220px">
      ${a('pop', 0.04, `<div class="notice"><div class="k">Lista de banidas</div><div class="t">Líder<br>Dracule Mihawk</div><div class="s">OP14-020 · todos os formatos<br>desde 12/10/2026</div></div>`)}
      ${a('stamp', 0.75, `<div class="stamp">Banido</div>`, 'position:absolute;left:0;right:0;top:985px;display:flex;justify-content:center')}
    </div>`,
  }],
  'mihawk/videos/app-01-abrindo': [scroll('mihawk-pan-inicio.jpg', 0, -700, 4)],
  'mihawk/videos/app-02-deck-do-buggy': [zoom('mihawk-deck-buggy.jpg', 3.5, 1.08, 540, 690)],
  'mihawk/videos/app-03-carta-crocodile-e-mihawk': [zoom('mihawk-deck.jpg', 4, 2.3, 666, 1322)],
  'mihawk/videos/app-04-tutorial': [scroll('pan-aprender.jpg', 0, -760, 2.8), zoom('mihawk-licao1.jpg', 2.6, 1.08, 540, 230)],
  'mihawk/videos/app-05-bot-facil': [zoom('mihawk-bot.jpg', 3.5, 1.09, 540, 800)],
  'mihawk/videos/app-06-partida-inicio': [raw(0.4, 6)],
  'mihawk/videos/app-07-partida-ataques': [raw(35.4, 7.2)],
  'mihawk/videos/app-08-partida-zoro': [raw(30.6, 4.8)],
  'mihawk/videos/app-09-partida-fim': [raw(180.3, 5.5), zoom('mihawk-resultado.jpg', 2.6, 1.06, 540, 420)],
  'mihawk/videos/app-10-cartaz-east-blue': [zoom('mihawk-cartaz.jpg', 4, 1.9, 290, 400)],
  'mihawk/videos/app-11-sala-privada': [zoom('mihawk-sala.jpg', 4, 1.09, 540, 700)],
  'mihawk/videos/insert-57-minutos-depois': [timeCard('57 minutos<br><em>depois…</em>')],
  'mihawk/videos/insert-algum-tempo-depois': [timeCard('Algum tempo<br><em>depois…</em>')],
  'mihawk/videos/insert-ligas': [leagues()],
  'mihawk/videos/fim-ep1': [episodeEnd(1, 'Banido', 'No próximo: o tutorial')],
  'mihawk/videos/fim-ep2': [episodeEnd(2, 'O aluno', 'No próximo: Mihawk joga de Buggy')],
  'mihawk/videos/fim-ep3': [episodeEnd(3, 'Ordens do palhaço', 'No próximo: a ranqueada')],
  'mihawk/videos/fim-ep4': [episodeEnd(4, 'Shichibukai no East Blue', 'No próximo: o desafio')],
  'mihawk/videos/fim-ep5': [episodeEnd(5, 'Um oponente digno', 'Aprenda você também')],
  'mihawk/videos/fim-desafie-o-mihawk': [{
    dur: 3.5,
    cls: 'burst spin vignette',
    html: `<div class="layer col center" style="--by:44%;padding:0 70px 230px;justify-content:center;gap:36px">
      ${a('up', 0.05, `<div class="eyebrow" style="font-size:38px">Procura-se um oponente digno</div>`)}
      ${a('pop', 0.15, `<div class="h h1">Desafie<br>o <em>Mihawk</em></div>`)}
      ${a('up', 0.5, `<div class="lead" style="max-width:860px">Sala privada no GumGum Fight.<br>O código sai nos stories.</div>`)}
      ${a('pop', 0.85, `<div class="btn" style="font-size:58px">${URL_TEXT}</div>`, 'margin-top:14px')}
      ${a('up', 1.1, `<img src="logo.svg" style="height:84px;margin-top:34px" alt="">`)}
    </div>`,
  }],
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
/* Cartela "Banido": aviso em papel e carimbo. */
.notice { width: 900px; background: #f6e7c1; border: 10px solid var(--brown); border-radius: 26px; padding: 64px 40px 330px; color: var(--brown); text-align: center; box-shadow: 16px 20px 0 var(--ink); transform: rotate(-3deg); }
.notice .k { font-weight: 900; font-size: 38px; letter-spacing: 8px; text-transform: uppercase; }
.notice .t { font-family: Bangers, sans-serif; font-size: 126px; line-height: 1; margin: 26px 0 30px; white-space: nowrap; }
.notice .s { font-weight: 800; font-size: 40px; line-height: 1.35; }
.stamp { font-family: Bangers, sans-serif; font-size: 190px; line-height: 1; letter-spacing: 8px; color: var(--red); border: 18px solid var(--red); border-radius: 28px; padding: 14px 44px 4px; transform: rotate(-13deg); background: rgba(246, 231, 193, 0.82); text-transform: uppercase; }
.a-stamp { animation: stamp 0.16s cubic-bezier(0.4, 0, 0.9, 0.3) both; animation-delay: var(--d, 0s); }
@keyframes stamp { from { opacity: 0; transform: scale(2.6); } to { opacity: 1; transform: none; } }
@keyframes up { from { opacity: 0; transform: translateY(70px); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(60deg); } }
@keyframes pan { from { transform: translateY(var(--from)); } to { transform: translateY(var(--to)); } }
img.scroll { position: absolute; left: 0; top: 0; width: 1080px; animation: pan cubic-bezier(0.45, 0, 0.55, 1) both; }
img.zoom { position: absolute; inset: 0; width: 1080px; height: 1920px; animation: zoom cubic-bezier(0.3, 0, 0.3, 1) both; }
@keyframes zoom { from { transform: none; } to { transform: translate(var(--tx), var(--ty)) scale(var(--zt)); } }
.ladder.big > div > div { font-size: 54px; padding: 26px 34px; border-radius: 30px; }
.ladder.big > div > div span { font-size: 40px; }
.ladder.big i { font-style: normal; font-weight: 800; font-size: 28px; padding: 6px 16px; border-radius: 999px; background: var(--red); color: var(--cream); margin-left: 10px; vertical-align: middle; }
.ladder.big .top i { background: var(--brown); }
.ladder.big .here { border-color: var(--red); }
`;

const filters = process.argv.slice(2);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

for (const [name, scenes] of Object.entries(reels)) {
  if (filters.length && !filters.some((f) => name.includes(f))) continue;
  const tmp = mkdtempSync(join(tmpdir(), 'ggf-reel-'));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="kit.css"><style>${css}</style></head><body>
${scenes.map((s, i) => `<section class="slide story scene ${s.cls}" id="s${i}">${s.html}</section>`).join('\n')}</body></html>`;
  const file = join(SRC, `.reel-${name.replace(/\//g, '-')}.html`);
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
      execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(scene.clip.start), '-t', String(scene.dur + 0.2), '-i', join(SRC, 'clips', scene.clip.file ?? 'partida.mp4'), '-vf', `fps=${FPS},scale=${scene.clip.width}:-2:flags=lanczos`, '-q:v', '2', join(dir, '%05d.jpg')]);
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
  // Um nome com pasta ("mihawk/videos/x") sai nessa pasta do kit; sem pasta, em reels/.
  const target = join(KIT, name.includes('/') ? '' : 'reels', `${name}.mp4`);
  mkdirSync(dirname(target), { recursive: true });
  // Trilha muda: o áudio é escolhido no próprio Instagram.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, '%06d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', target]);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(file);
  console.log(name, 'pronto');
}
await browser.close();
