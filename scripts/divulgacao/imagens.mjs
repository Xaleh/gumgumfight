// Desenha as peças em HTML (modelos/) e salva em PNG/JPG com o Chromium.
//   node imagens.mjs base    verso e DON!! do GumGum, telas de abertura e fim dos trailers, legendas, planos e perfil
//   node imagens.mjs pecas   banner, post e story (usam quadros das gravações: mesa.png, mesa-vertical.png, home.png)
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const AQUI = new URL('.', import.meta.url).pathname;
const SAIDA = process.env.SAIDA ?? join(AQUI, 'saida');
const PAG = join(SAIDA, 'pagina');
mkdirSync(PAG, { recursive: true });
cpSync(join(AQUI, 'modelos'), PAG, { recursive: true });
for (const f of readdirSync(join(AQUI, '../../apps/web/public/brand'))) cpSync(join(AQUI, '../../apps/web/public/brand', f), join(PAG, f));

const b = await chromium.launch();
async function render(html, out, w, h, { scale = 1, transparent = false } = {}) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.goto(pathToFileURL(join(PAG, html)).href, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const jpg = out.endsWith('.jpg');
  await p.screenshot({ path: join(SAIDA, out), type: jpg ? 'jpeg' : 'png', quality: jpg ? 90 : undefined, omitBackground: transparent });
  await p.close();
  // Os modelos usam as peças pelos nomes da pasta de trabalho.
  if (!jpg) cpSync(join(SAIDA, out), join(PAG, out));
}

const LEGENDAS = [
  ['TREINE CONTRA O BOT', 'três níveis, qualquer deck'],
  ['JOGUE ONLINE', 'partida rápida, ranqueada e salas privadas'],
  ['TORNEIOS DA COMUNIDADE', 'suíço, top cut e mata-mata'],
  ['REVEJA CADA JOGADA', 'replays e partidas ao vivo'],
  ['GRÁTIS. SEM ANÚNCIOS.', 'e sem vender os seus dados'],
];

const etapa = process.argv[2];
if (etapa === 'base') {
  await render('back.html', 'verso-gumgum.png', 430, 601);
  cpSync(join(SAIDA, 'verso-gumgum.png'), join(PAG, 'card-back-gg.png'));
  await render('don.html', 'don-gumgum.png', 356, 500);
  cpSync(join(SAIDA, 'don-gumgum.png'), join(PAG, 'don-gg.png'));
  await render('intro169.html', 'abertura-16x9.png', 1920, 1080);
  await render('outro169.html', 'fim-16x9.png', 1920, 1080);
  await render('intro916.html', 'abertura-9x16.png', 1080, 1920);
  await render('outro916.html', 'fim-9x16.png', 1080, 1920);
  const modelo = readFileSync(join(PAG, 'legendas/modelo.html'), 'utf8');
  for (const [i, [big, small]] of LEGENDAS.entries()) {
    for (const [fmt, W, H, F] of [['16x9', 1920, 240, 78], ['9x16', 1080, 300, 74]]) {
      const html = modelo.replace('{{W}}', W).replace('{{H}}', H).replace('{{F}}', F).replace('{{S}}', 34).replace('{{BIG}}', big).replace('{{SMALL}}', small);
      writeFileSync(join(PAG, `legenda-${i + 1}-${fmt}.html`), html);
      await render(`legenda-${i + 1}-${fmt}.html`, `legenda-${i + 1}-${fmt}.png`, W, H, { transparent: true });
    }
  }
  await render('planos.html', 'planos.jpg', 1600, 900);
  await render('perfil.html', 'perfil-512.png', 512, 512);
} else if (etapa === 'pecas') {
  for (const f of ['mesa.png', 'mesa-vertical.png', 'home.png']) cpSync(join(SAIDA, f), join(PAG, f));
  if (process.env.ARTE === 'oficial') {
    // O banner usa o verso e o DON!! do próprio site (o Chromium lê a imagem pelo conteúdo, não pela extensão).
    cpSync(join(AQUI, '../../apps/web/src/assets/card-back.webp'), join(PAG, 'card-back-gg.png'));
    cpSync(join(AQUI, '../../apps/web/src/assets/don-card.jpg'), join(PAG, 'don-gg.png'));
  }
  await render('banner.html', 'banner-apoiase.jpg', 1600, 300, { scale: 2 });
  await render('post.html', 'post-inauguracao-1080.jpg', 1080, 1080);
  await render('story.html', 'story-inauguracao-1080x1920.jpg', 1080, 1920);
} else {
  console.error('uso: node imagens.mjs base|pecas');
  process.exit(1);
}
await b.close();
