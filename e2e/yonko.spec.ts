// Mesa local do Yonko (todos contra todos, contra três bots): da tela inicial ao primeiro turno de quem joga.

import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { openHome, startBotMatch } from './support/app';
import { label } from './support/i18n';

// DIAGNÓSTICO (temporário), rodada 2: no WebKit do CI a página cai com as animações completas (com as suaves e
// as desligadas, não). Cada variante tira uma parte das completas com CSS, para achar qual delas derruba a página.
const VARIANTS: Record<string, string> = {
  completas: '',
  'sem-faixa-de-turno': '.turn-banner { display: none !important; }',
  'sem-camada-de-voo': '.motion-layer { display: none !important; }',
  'sem-animacao-css': '.yk *, .yk *::before, .yk *::after { animation: none !important; transition: none !important; }',
  'sem-enfeites': '.yk-mat::after, .yk-end::after { display: none !important; } .yk-dots i, .yk-hearts, .yk-av { animation: none !important; }',
};

function watchCrash(page: Page, testInfo: TestInfo, tag: string) {
  const t0 = Date.now();
  const state = { crashed: false };
  const log = (what: string) => console.log(`[${tag} ${testInfo.project.name}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);
  page.on('crash', () => {
    state.crashed = true;
    log('CRASH');
  });
  return { state, log };
}

for (const [name, css] of Object.entries(VARIANTS)) {
  test.describe(`Yonko (${name})`, () => {
    test(`mesa local: a preparação, um turno de quem joga e a vez dos bots @iphone`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'desktop' && name !== 'completas', 'no desktop, só as animações completas');
      test.setTimeout(4 * 60_000);
      const { state, log } = watchCrash(page, testInfo, `yonko ${name}`);
      await openHome(page);
      if (css) await page.addStyleTag({ content: css });
      await page.getByRole('button', { name: label('yonko.homeAction'), exact: true }).click();
      await page.getByRole('button', { name: label('yonko.start'), exact: true }).click();
      await expect(page.getByRole('region', { name: label('yonko.yourTable'), exact: true })).toBeVisible();
      log('mesa');

      const endTurn = page.getByRole('button', { name: label('yonko.endTurn'), exact: true });
      const answer = page.locator('.yk-banner .yk-btn.primary');
      const banner = page.locator('.yk-banner-text');
      let last = '';
      const step = async () => {
        const text = ((await banner.textContent({ timeout: 1_000 }).catch(() => '')) ?? '').slice(0, 60);
        if (text !== last) {
          last = text;
          const flights = await page.locator('.motion-layer > *').count().catch(() => -1);
          log(`faixa: ${text} | voos ${flights}`);
        }
        if (await answer.first().isEnabled({ timeout: 300 }).catch(() => false)) await answer.first().click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(400).catch(() => undefined);
      };
      const deadline = Date.now() + 3 * 60_000;
      for (;;) {
        if (state.crashed) throw new Error('a página caiu');
        if (Date.now() > deadline) throw new Error('"Encerrar turno" não acendeu');
        if (await endTurn.isEnabled({ timeout: 1_000 }).catch(() => false)) break;
        await step();
      }
      log('minha vez');
      await endTurn.click();
      await expect(endTurn).toBeDisabled();
      log('turno encerrado');
      // Os bots jogam um pouco (compras, cartas, ataques).
      for (let i = 0; i < 20 && !state.crashed; i++) await step();
      if (state.crashed) throw new Error('a página caiu');
      log('fim');
    });
  });
}

// A mesa de dois, com as animações completas e o bot jogando pelos dois lados: cai do mesmo jeito no WebKit?
test('DIAGNÓSTICO mesa de dois: 40 s de Auto com as animações completas @iphone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'só no iphone');
  test.setTimeout(3 * 60_000);
  const { state, log } = watchCrash(page, testInfo, 'mesa de dois');
  await startBotMatch(page);
  log('mesa');
  const auto = page.getByRole('button', { name: label('game.auto'), exact: true });
  log(`botão Auto: ${await auto.count()}`);
  await auto.click({ timeout: 5_000 }).catch((e: Error) => log(`sem Auto: ${e.message.slice(0, 80)}`));
  for (let i = 0; i < 40 && !state.crashed; i++) {
    await page.waitForTimeout(1_000).catch(() => undefined);
    if (i % 5 === 4) log(`voos ${await page.locator('.motion-layer > *').count().catch(() => -1)}`);
  }
  if (state.crashed) throw new Error('a página caiu');
  log('fim');
});
