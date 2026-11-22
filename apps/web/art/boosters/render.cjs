// Fotografa os SVGs desta pasta com as fontes do app e grava os PNGs (fundo transparente) na pasta
// indicada: `node render.cjs <pasta de saída>`. Precisa do Playwright com o Chromium instalado.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

(async () => {
  const out = process.argv[2] || '.';
  const names = ['rush', 'cube', 'draft'];
  const svgs = names.map((n) => `<div id="${n}">${readFileSync(join(__dirname, `${n}.svg`), 'utf8')}</div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Nunito:wght@800;900&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:transparent}div{display:inline-block;line-height:0}</style></head><body>${svgs}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1900, height: 1040 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  console.log('fontes:', await page.evaluate(() => [document.fonts.check('40px Bangers'), document.fonts.check('900 20px Nunito')]));
  for (const n of names) await page.locator(`#${n}`).screenshot({ path: join(out, `${n}.png`), omitBackground: true });
  await browser.close();
})();
