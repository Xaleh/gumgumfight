// Mesa local do Yonko (todos contra todos, contra três bots): da tela inicial ao primeiro turno de quem joga.

import { expect, test } from './support/fixtures';
import { openHome } from './support/app';
import { label } from './support/i18n';

test.describe('Yonko', () => {
  test('mesa local: a preparação, um turno de quem joga e a vez dos bots @iphone', async ({ page }) => {
    // Quem joga pode ser o último da ordem: até três turnos de bot (com as animações) antes do primeiro dele.
    test.setTimeout(4 * 60_000);
    await openHome(page);
    await page.getByRole('button', { name: label('yonko.homeAction'), exact: true }).click();
    await page.getByRole('button', { name: label('yonko.start'), exact: true }).click();

    // A mesa: a de quem joga e, no desktop, as três dos oponentes (no celular, uma aba aberta por vez).
    await expect(page.getByRole('region', { name: label('yonko.yourTable'), exact: true })).toBeVisible();
    const tables = page.getByRole('region', { name: new RegExp(`^${label('yonko.tableOf', { name: '' })}`) });
    await expect(tables.first()).toBeVisible();

    // A preparação (largada e mão inicial) e o que os bots perguntarem (bloquear, Counter): sempre o botão em
    // destaque da faixa de ação, até "Encerrar turno" acender.
    const endTurn = page.getByRole('button', { name: label('yonko.endTurn'), exact: true });
    const answer = page.locator('.yk-banner .yk-btn.primary');
    await expect(async () => {
      if (await endTurn.isEnabled()) return;
      if (await answer.first().isEnabled().catch(() => false)) await answer.first().click({ timeout: 1_000 }).catch(() => undefined);
      expect(await endTurn.isEnabled()).toBe(true);
    }).toPass({ timeout: 3 * 60_000, intervals: [400] });

    // O turno de quem joga: a faixa diz que é a vez dele; encerrar passa a vez para um bot.
    await expect(page.getByText(label('yonko.yourTurn'), { exact: true })).toBeVisible();
    await endTurn.click();
    await expect(endTurn).toBeDisabled();

    // As opções da mesa abrem com a escolha das animações, e desligá-las vale na hora.
    await page.getByRole('button', { name: label('yonko.tableOptions'), exact: true }).click();
    const options = page.getByRole('dialog', { name: label('yonko.tableOptions'), exact: true });
    await options.getByRole('button', { name: label('settings.animOff'), exact: true }).click();
    await expect(page.locator('.yk.anim-off')).toBeVisible();
    await options.getByRole('button', { name: label('yonko.close'), exact: true }).click();
    await expect(options).toBeHidden();
  });
});
