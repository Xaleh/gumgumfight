// Desafio do dia no celular: o painel (objetivo, enunciado, resultado) flutua em cima da mesa. Recolhido, é uma
// barra só e a mesa começa abaixo dela, sem cobrir a mão, o Líder e o deck do oponente; aberto, fica por cima.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { label } from './support/i18n';

const panel = (page: Page) => page.locator('.coach-float .daily-panel');
const toggle = (page: Page) => panel(page).getByRole('button', { name: label('tutorial.collapse'), exact: true });
const box = async (target: Locator) => (await target.boundingBox())!;

test('desafio do dia: o painel recolhido não cobre o lado do oponente @iphone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'no desktop o painel fica ao lado da mesa');
  await page.goto('/?desafio');
  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect(panel(page).locator('.coach-title')).toHaveText(new RegExp(`^(${label('daily.goal.lethal.title')}|${label('daily.goal.survive.title')})$`));

  /** A barra acaba antes de a mesa começar (e, com ela, o menu, a faixa e o Líder do oponente). */
  const boardBelowPanel = async () => {
    const bottom = await panel(page).evaluate((el) => el.getBoundingClientRect().bottom);
    for (const part of ['.board-col', '.top-strip', '.side.top .leader-zone .card']) expect((await box(page.locator(part).first())).y, part).toBeGreaterThanOrEqual(bottom);
    return bottom;
  };
  await expect(boardBelowPanel).toPass();
  // Uma barra, não um cartão: sobra a tela para a mesa.
  expect((await box(panel(page))).height).toBeLessThan(90);

  // Aberto, o painel fica por cima e a mesa não muda de tamanho; recolhido de novo, volta a caber acima dela.
  const board = await box(page.locator('.board-col'));
  await toggle(page).click();
  await expect(panel(page)).not.toHaveClass(/collapsed/);
  await expect(panel(page).getByRole('button', { name: label('daily.exit'), exact: true })).toBeAttached();
  expect(await box(page.locator('.board-col'))).toEqual(board);
  await toggle(page).click();
  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect(boardBelowPanel).toPass();
});
