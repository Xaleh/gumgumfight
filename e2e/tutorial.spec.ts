// As lições sem mesa do tutorial são um gibi que se folheia (PageBook): em tela larga, um livro aberto
// em que só a folha da direita vira; no celular, uma página só. A página vira pelos botões do treinador ou
// puxando a ponta da folha, e segue a opção "Animações".

import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { openHome } from './support/app';
import { label } from './support/i18n';

/** O livro de verdade (fora dele ficam as cópias paradas da virada e a página seguinte escondida). */
const book = (page: Page) => page.locator('.gibi > .gibi-pages:not(.peek)');
const title = (page: Page) => book(page).locator('.coach-title');
const next = (page: Page) => book(page).getByRole('button', { name: label('tutorial.next'), exact: true });
/** A camada da virada: existe só enquanto a folha está no ar. */
const turning = (page: Page) => page.locator('.gibi-turn');
const step = (id: 'intro' | 'onPlay' | 'whenAttacking') => label(`tutorial.keywords.${id}.title`);

/** Menu → Aprender → a lição das palavras-chave (sem mesa, 14 passos). `animations`: a opção do jogador. */
async function openKeywords(page: Page, animations?: 'soft' | 'off') {
  if (animations) await page.addInitScript((a) => localStorage.setItem('gumgum.settings', JSON.stringify({ animations: a })), animations);
  await openHome(page);
  await page.getByRole('button', { name: label('menu.learnStart'), exact: true }).click();
  await page.getByRole('button', { name: new RegExp(label('tutorial.keywords.name')) }).click();
  await expect(title(page)).toHaveText(step('intro'));
}

/** Puxa a ponta da folha (a faixa na borda de fora) até uma fração da largura do livro e solta. */
async function pull(page: Page, grip: 'next' | 'back', toX: number) {
  const box = (await book(page).boundingBox())!;
  const from = (await page.locator(`.gibi-grip.${grip}`).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * 0.7, { steps: 12 });
  await expect(turning(page)).toBeVisible();
  // Um instante parado: soltar vale pelo lugar em que a folha está, e não pelo embalo do mouse.
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(turning(page)).toHaveCount(0);
}

test.describe('gibi das lições sem mesa', () => {
  test('livro aberto: a página vira pelo botão e puxando a ponta', async ({ page }) => {
    await openKeywords(page);
    await expect(page.locator('.gibi.spread')).toBeVisible();
    // Sem figura no passo, a página da esquerda é a folha de rosto da lição.
    await expect(book(page).locator('.lesson-plate')).toBeVisible();

    await next(page).click();
    await expect(turning(page)).toBeVisible();
    await expect(title(page)).toHaveText(step('onPlay'));
    await expect(turning(page)).toHaveCount(0);
    await expect(book(page).locator('.lesson-card')).toBeVisible();

    // Puxada curta: a folha volta para o lugar e o passo não muda.
    await pull(page, 'next', 0.9);
    await expect(title(page)).toHaveText(step('onPlay'));
    // Puxada até o outro lado: passa a página. E a ponta da esquerda volta.
    await pull(page, 'next', 0.3);
    await expect(title(page)).toHaveText(step('whenAttacking'));
    await pull(page, 'back', 0.7);
    await expect(title(page)).toHaveText(step('onPlay'));
    // A cópia da página seguinte (montada só para a virada) não fica na tela.
    await expect(page.locator('.gibi-pages.peek')).toHaveCount(0);
  });

  test('página única no celular, sem estourar a largura da tela @iphone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'no desktop o livro abre em duas páginas');
    await openKeywords(page);
    await expect(page.locator('.gibi')).not.toHaveClass(/spread/);
    await next(page).click();
    await expect(turning(page)).toBeVisible();
    await expect(title(page)).toHaveText(step('onPlay'));
    await expect(turning(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  for (const animations of ['soft', 'off'] as const) {
    test(`animações ${animations === 'soft' ? 'suaves' : 'desligadas'}: a página troca sem a dobra e sem pontas para puxar`, async ({ page }) => {
      await openKeywords(page, animations);
      await page.evaluate(() => {
        const w = window as unknown as { turns: number };
        w.turns = 0;
        new MutationObserver((list) => {
          for (const m of list) for (const n of m.addedNodes) if (n instanceof Element && n.classList.contains('gibi-turn')) w.turns++;
        }).observe(document.body, { childList: true, subtree: true });
      });
      await expect(page.locator('.gibi-grip')).toHaveCount(0);
      await next(page).click();
      await expect(title(page)).toHaveText(step('onPlay'));
      expect(await page.evaluate(() => (window as unknown as { turns: number }).turns)).toBe(0);
    });
  }
});
