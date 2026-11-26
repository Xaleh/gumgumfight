// Mesa local do Yonko (todos contra todos, contra três bots): da tela inicial ao primeiro turno de quem joga.

import { expect, test } from './support/fixtures';
import { openHome } from './support/app';
import { label } from './support/i18n';

// DIAGNÓSTICO (temporário): no WebKit do CI a página da mesa cai. As três variantes dizem se a queda vem das
// animações (completas, suaves) ou da mesa em si (desligadas).
for (const animations of ['full', 'soft', 'off'] as const) {
  test.describe(`Yonko (animações ${animations})`, () => {
    test(`mesa local: a preparação, um turno de quem joga e a vez dos bots @iphone`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'desktop' && animations !== 'full', 'no desktop, só as animações completas');
      test.setTimeout(4 * 60_000);
      const t0 = Date.now();
      const log = (what: string) => console.log(`[yonko ${testInfo.project.name} ${animations}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);
      let crashed = false;
      page.on('crash', () => {
        crashed = true;
        log('CRASH');
      });
      await page.addInitScript((a) => {
        try {
          localStorage.setItem('gumgum.settings', JSON.stringify({ animations: a }));
        } catch {
          /* sem armazenamento */
        }
      }, animations);
      await openHome(page);
      await page.getByRole('button', { name: label('yonko.homeAction'), exact: true }).click();
      log('entrada');
      await page.getByRole('button', { name: label('yonko.start'), exact: true }).click();
      await expect(page.getByRole('region', { name: label('yonko.yourTable'), exact: true })).toBeVisible();
      log('mesa');

      const endTurn = page.getByRole('button', { name: label('yonko.endTurn'), exact: true });
      const answer = page.locator('.yk-banner .yk-btn.primary');
      const banner = page.locator('.yk-banner-text');
      let last = '';
      const deadline = Date.now() + 3 * 60_000;
      for (;;) {
        if (crashed) throw new Error('a página caiu');
        if (Date.now() > deadline) throw new Error('"Encerrar turno" não acendeu');
        if (await endTurn.isEnabled({ timeout: 1_000 }).catch(() => false)) break;
        const text = ((await banner.textContent({ timeout: 1_000 }).catch(() => '')) ?? '').slice(0, 70);
        if (text !== last) {
          last = text;
          log(`faixa: ${text}`);
        }
        if (await answer.first().isEnabled({ timeout: 300 }).catch(() => false)) await answer.first().click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(400).catch(() => undefined);
      }
      log('minha vez');

      await expect(page.getByText(label('yonko.yourTurn'), { exact: true })).toBeVisible();
      await endTurn.click();
      await expect(endTurn).toBeDisabled();
      log('turno encerrado');
      // Os bots jogam um pouco (compras, cartas, ataques).
      for (let i = 0; i < 20 && !crashed; i++) {
        const text = ((await banner.textContent({ timeout: 1_000 }).catch(() => '')) ?? '').slice(0, 70);
        if (text !== last) {
          last = text;
          log(`faixa: ${text}`);
        }
        if (await answer.first().isEnabled({ timeout: 300 }).catch(() => false)) await answer.first().click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(400).catch(() => undefined);
      }
      if (crashed) throw new Error('a página caiu');
      log('fim');
    });
  });
}
