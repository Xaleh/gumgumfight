// DIAGNÓSTICO (temporário, sai no commit seguinte): confirma no WebKit do CI o que derrubava a mesa.
// Cada variante roda a mesa de dois com as animações completas e o bot jogando pelos dois lados por 25 s, com um
// CSS injetado por cima do app. O teste não reprova quando a página cai: só registra no log o que aconteceu.

import { expect, test } from './support/fixtures';
import { startBotMatch } from './support/app';
import { label } from './support/i18n';

const frames = (middle: string, ends: string) => `
@keyframes tb-sweep {
  0% { transform: translateX(-70%) skewX(-14deg); opacity: 0; ${ends} }
  14% { transform: translateX(2%) skewX(0deg); opacity: 1; ${ends ? 'filter: blur(0);' : ''} }
  20%, 78% { transform: none; opacity: 1; ${middle} }
  100% { transform: translateX(70%) skewX(14deg); opacity: 0; ${ends} }
}`;
const NO_BACKDROP = '.turn-banner.sweep .tb-stripe { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';

const VARIANTS: Record<string, string> = {
  // O CSS do app como está (blur(0) nos quadros do meio).
  atual: '',
  // O tb-sweep de antes do commit 2158bcc: `filter: none` nos quadros de 20% e 78%.
  'quadros-antigos': frames('filter: none;', 'filter: blur(10px);'),
  // O mesmo, sem o backdrop-filter da faixa.
  'quadros-antigos-sem-backdrop': frames('filter: none;', 'filter: blur(10px);') + NO_BACKDROP,
  // Sem filter na animação, com o backdrop-filter da faixa.
  'sem-filter-animado': frames('', ''),
};

for (const [name, css] of Object.entries(VARIANTS)) {
  test(`DIAGNÓSTICO mesa de dois (${name}): 25 s de Auto com as animações completas @iphone`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'só no iphone');
    test.setTimeout(2 * 60_000);
    const t0 = Date.now();
    const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
    const log = (what: string) => console.log(`[diag ${name} tentativa ${testInfo.retry + 1}] +${secs()}s ${what}`);
    let crashedAt: string | null = null;
    page.on('crash', () => {
      crashedAt = secs();
    });
    if (css) {
      await page.addInitScript((content) => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = content;
          document.head.append(style);
        });
      }, css);
    }
    await startBotMatch(page);
    // Confere que o CSS injetado vale: os quadros do tb-sweep que a página enxerga.
    const seen = await page
      .evaluate(() => {
        let last = '';
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSKeyframesRule && rule.name === 'tb-sweep') last = rule.cssText;
          } catch {
            /* folha de outra origem */
          }
        }
        return last.replace(/\s+/g, ' ');
      })
      .catch((e: Error) => `(falhou: ${e.message.slice(0, 80)})`);
    log(`tb-sweep em uso: ${seen}`);
    await page
      .getByRole('button', { name: label('game.auto'), exact: true })
      .click({ timeout: 5_000 })
      .catch((e: Error) => log(`sem Auto: ${e.message.slice(0, 80)}`));
    let banners = 0;
    for (let i = 0; i < 50 && crashedAt === null; i++) {
      banners += await page.locator('.turn-banner.sweep').count().catch(() => 0);
      await page.waitForTimeout(500).catch(() => undefined);
    }
    log(`RESULTADO: ${crashedAt === null ? 'não caiu' : `CAIU aos ${crashedAt}s`} (faixa vista em ${banners} de 50 olhadas)`);
    expect(true).toBe(true);
  });
}
