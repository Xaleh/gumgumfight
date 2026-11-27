// Mesa local do Yonko (todos contra todos, contra três bots): da tela inicial ao primeiro turno de quem joga.

import { expect, test } from './support/fixtures';
import { openHome } from './support/app';
import { label } from './support/i18n';

test.describe('Yonko', () => {
  test('mesa local: a preparação, um turno de quem joga e a vez dos bots @iphone', async ({ page }) => {
    // Quem joga pode ser o último da ordem: até três turnos de bot (com as animações) antes do primeiro dele.
    test.setTimeout(4 * 60_000);
    let crashed = false;
    page.on('crash', () => {
      crashed = true;
    });
    await openHome(page);
    await page.getByRole('button', { name: label('yonko.homeAction'), exact: true }).click();
    await page.getByRole('button', { name: label('yonko.start'), exact: true }).click();

    // A mesa: a de quem joga e a de um oponente (no desktop, as três; no celular, uma aba aberta por vez).
    await expect(page.getByRole('region', { name: label('yonko.yourTable'), exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: new RegExp(`^${label('yonko.tableOf', { name: '' })}`) }).first()).toBeVisible();

    // As opções da mesa: a escolha das animações vale na hora (a mesa leva `anim-off`). A partida corre com as
    // animações completas (a faixa de troca de turno atravessando a mesa) e o jogador as desliga no fim.
    const animationsOff = async () => {
      await page.getByRole('button', { name: label('yonko.tableOptions'), exact: true }).click();
      const options = page.getByRole('dialog', { name: label('yonko.tableOptions'), exact: true });
      await options.getByRole('button', { name: label('settings.animOff'), exact: true }).click();
      await expect(page.locator('.yk.anim-off')).toBeVisible();
      await options.getByRole('button', { name: label('yonko.close'), exact: true }).click();
      await expect(options).toBeHidden();
    };
    // A preparação (largada e mão inicial) e o que os bots perguntarem (bloquear, Counter): sempre o botão em
    // destaque da faixa de ação, até "Encerrar turno" acender.
    const endTurn = page.getByRole('button', { name: label('yonko.endTurn'), exact: true });
    const answer = page.locator('.yk-banner .yk-btn.primary').first();
    const deadline = Date.now() + 3 * 60_000;
    while (!(await endTurn.isEnabled({ timeout: 1_000 }).catch(() => false))) {
      expect(crashed, 'a página da mesa caiu').toBe(false);
      expect(Date.now(), '"Encerrar turno" não acendeu').toBeLessThan(deadline);
      if (await answer.isEnabled({ timeout: 300 }).catch(() => false)) await answer.click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }

    // O turno de quem joga: a faixa diz que é a vez dele; encerrar passa a vez para um bot.
    await expect(page.getByText(label('yonko.yourTurn'), { exact: true })).toBeVisible();
    await endTurn.click();
    await expect(endTurn).toBeDisabled();

    // Na vez do bot a faixa de troca de turno atravessa a mesa e sai. Era nela que a página caía no WebKit de Linux
    // (ver "Queda da mesa no WebKit de Linux" em docs/plano-testes-e2e.md).
    const sweep = page.locator('.turn-banner.sweep');
    await sweep.waitFor({ state: 'visible', timeout: 30_000 });
    await sweep.waitFor({ state: 'hidden' });
    expect(crashed, 'a página da mesa caiu').toBe(false);

    await animationsOff();
  });
});
