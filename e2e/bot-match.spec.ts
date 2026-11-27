// Partida contra o bot no navegador: do menu ao fim de jogo.

import { readFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';
import { expectGameOver, startBotMatch } from './support/app';
import { label } from './support/i18n';

test.describe('partida contra o bot', () => {
  test('do menu ao fim, com o bot jogando pelos dois lados (Auto) @iphone', async ({ page }) => {
    // Uma partida inteira com as esperas das animações leva cerca de 2 minutos.
    test.setTimeout(6 * 60_000);
    await startBotMatch(page);
    await page.getByRole('button', { name: label('game.auto'), exact: true }).click();
    await expectGameOver(page, 5 * 60_000);
    // O replay baixado no fim de jogo tem a partida inteira.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: label('result.download'), exact: true }).click(),
    ]);
    const replay = JSON.parse(await readFile((await download.path())!, 'utf8')) as { format: string; actions: unknown[] };
    expect(replay.format).toBe('gumgumfight-replay');
    expect(replay.actions.length).toBeGreaterThan(20);
    // E o jogador volta ao menu.
    await page.getByRole('button', { name: label('result.exit'), exact: true }).click();
    await expect(page.getByRole('button', { name: label('menu.battle'), exact: true })).toBeVisible();
  });

  test('desistir pelo menu da mesa encerra a partida @iphone', async ({ page }) => {
    await startBotMatch(page);
    await page.getByRole('button', { name: label('game.menuLabel'), exact: true }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: label('game.concede'), exact: true }).click();
    await expectGameOver(page);
    await expect(page.getByText(label('result.defeat'), { exact: true })).toBeVisible();
  });
});
