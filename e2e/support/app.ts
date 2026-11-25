// Passos comuns dos fluxos: abrir o app e chegar às telas pelo caminho de um jogador.

import { expect, type Page } from '@playwright/test';
import { label } from './i18n';

/** Abre o app no menu inicial, como na primeira visita (cada teste tem um navegador limpo). */
export async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: label('menu.battle'), exact: true })).toBeVisible();
}

/**
 * Menu → partida contra o bot no nível fácil, com o jogador começando (sem o sorteio), até a mão
 * inicial ser mantida. Devolve com a partida no primeiro turno do jogador.
 */
export async function startBotMatch(page: Page) {
  await openHome(page);
  await page.getByRole('button', { name: label('menu.botEasy'), exact: true }).click();
  await page.getByRole('button', { name: label('menu.you'), exact: true }).click();
  await page.getByRole('button', { name: label('menu.battle'), exact: true }).click();
  // Confirmação do deck equipado.
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading', { name: label('deckConfirm.title') })).toBeVisible();
  await confirm.getByRole('button', { name: label('menu.battle'), exact: true }).click();
  // Mulligan.
  await page.getByRole('button', { name: label('game.keepHand'), exact: true }).click();
  await expect(page.getByRole('button', { name: label('game.keepHand'), exact: true })).toBeHidden();
}

/** A tela de fim de partida (vitória ou derrota) com os botões de sempre. */
export async function expectGameOver(page: Page, timeout?: number) {
  await expect(page.getByRole('button', { name: label('result.rematch'), exact: true })).toBeVisible({ timeout });
  await expect(page.getByText(new RegExp(`^(${label('result.victory')}|${label('result.defeat')})$`))).toBeVisible();
  await expect(page.getByRole('button', { name: label('result.exit'), exact: true })).toBeVisible();
}
