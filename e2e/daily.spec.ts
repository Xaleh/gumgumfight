// Desafio do dia no celular: o painel (objetivo, enunciado, resultado) flutua em cima da mesa. Recolhido, é uma
// barra só e a mesa começa abaixo dela, sem cobrir a mão, o Líder e o deck do oponente; aberto, fica por cima.
// O painel de "Gravar jogando" do editor de desafios (Administração) é o mesmo.

import type { Locator, Page } from '@playwright/test';
import { login } from './support/accounts';
import { openHome } from './support/app';
import { expect, test } from './support/fixtures';
import { label } from './support/i18n';

const panel = (page: Page) => page.locator('.coach-float .daily-panel');
const toggle = (page: Page) => panel(page).getByRole('button', { name: label('tutorial.collapse'), exact: true });
const box = async (target: Locator) => (await target.boundingBox())!;
/** A barra acaba antes de a mesa começar (e, com ela, o menu, a faixa e o Líder do oponente). */
async function boardBelowPanel(page: Page) {
  const bottom = await panel(page).evaluate((el) => el.getBoundingClientRect().bottom);
  for (const part of ['.board-col', '.top-strip', '.side.top .leader-zone .card']) expect((await box(page.locator(part).first())).y, part).toBeGreaterThanOrEqual(bottom);
}

test('desafio do dia: o painel recolhido não cobre o lado do oponente @iphone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'no desktop o painel fica ao lado da mesa');
  await page.goto('/?desafio');
  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect(panel(page).locator('.coach-title')).toHaveText(new RegExp(`^(${label('daily.goal.lethal.title')}|${label('daily.goal.survive.title')})$`));

  await expect(() => boardBelowPanel(page)).toPass();
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
  await expect(() => boardBelowPanel(page)).toPass();
});

test('editor de desafios: o painel de gravar jogando também recolhe numa barra @iphone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'no desktop o painel fica ao lado da mesa');
  await login(page, 'Chefe', 'admin');
  await openHome(page);
  await page.getByRole('button', { name: label('topbar.openMenu'), exact: true }).click();
  await page.getByRole('button', { name: label('menu.navAdmin'), exact: true }).first().click();
  await page.getByRole('button', { name: label('daily.title'), exact: true }).first().click();
  await page.getByRole('button', { name: label('daily.admin.duplicate'), exact: true }).first().click();
  await page.getByRole('button', { name: label('daily.admin.toTable'), exact: true }).click();

  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect(() => boardBelowPanel(page)).toPass();
  expect((await box(panel(page))).height).toBeLessThan(90);
  // Aberto pela seta, os botões de gravar aparecem; a mesa não muda de tamanho.
  const board = await box(page.locator('.board-col'));
  await toggle(page).click();
  await expect(panel(page).getByRole('button', { name: label('daily.admin.useSolution'), exact: true })).toBeVisible();
  expect(await box(page.locator('.board-col'))).toEqual(board);
  // "Tentar de novo" recomeça a tentativa e devolve a barra.
  await panel(page).getByRole('button', { name: label('daily.retry'), exact: true }).click();
  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect(() => boardBelowPanel(page)).toPass();
});
