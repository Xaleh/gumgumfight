// Abrir boosters (Selado): os 6 boosters de uma coleção, um a um e o resto de uma vez. No iPhone já
// houve bug do Safari com os boosters abertos sumindo ou fora do lugar (ver styles.css, .sealed-pack).

import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { openHome } from './support/app';
import { label, t } from './support/i18n';

const PACKS = 6;
const CARDS_PER_PACK = 12;

/** Pula as animações de abertura (como o jogador com pressa) até o contador chegar a `n` cartas. */
async function finishOpening(page: Page, n: number) {
  const skip = page.getByRole('button', { name: label('sealed.openSkip'), exact: true });
  await expect(async () => {
    if (await skip.isVisible()) await skip.click();
    await expect(page.locator('.sealed-count b')).toHaveText(String(n), { timeout: 500 });
  }).toPass({ timeout: 30_000 });
  await expect(skip).toBeHidden();
}

test('abrir os boosters do Selado @iphone', async ({ page, isMobile }) => {
  await openHome(page);
  await page.getByRole('button', { name: label('sealed.homeAction'), exact: true }).click();
  await page.getByRole('button', { name: label('sealed.open', { n: PACKS }), exact: true }).click();

  const row = page.locator('.sealed-pack-row');
  const packs = row.getByRole('button');
  await expect(packs).toHaveCount(PACKS);
  const count = page.locator('.sealed-count b');
  await expect(count).toHaveText('0');

  // Booster fechado: o primeiro toque seleciona, o segundo abre.
  await packs.nth(2).click();
  await expect(packs.nth(2)).toHaveAttribute('title', label('sealed.openPicked', { n: 3 }));
  await packs.nth(2).click();
  await finishOpening(page, CARDS_PER_PACK);
  await expect(page.locator('.sealed-reveal-card')).toHaveCount(CARDS_PER_PACK);

  // O resto de uma vez.
  await page.getByRole('button', { name: label('sealed.openAll', { n: PACKS - 1 }), exact: true }).click();
  await finishOpening(page, PACKS * CARDS_PER_PACK);
  await expect(page.getByText(t('sealed.revealed', { total: PACKS * CARDS_PER_PACK }))).toBeVisible();
  await expect(page.getByRole('button', { name: label('sealed.toBuild'), exact: true })).toBeVisible();

  // Os boosters abertos continuam desenhados, dentro da fileira e um ao lado do outro.
  await row.scrollIntoViewIfNeeded();
  const rowBox = (await row.boundingBox())!;
  const boxes = [];
  for (let i = 0; i < PACKS; i++) {
    const img = packs.nth(i).locator('img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), `imagem do booster ${i + 1}`).toBe(true);
    const box = (await img.boundingBox())!;
    expect(box.width, `largura do booster ${i + 1}`).toBeGreaterThan(20);
    expect(box.height, `altura do booster ${i + 1}`).toBeGreaterThan(box.width);
    expect(box.x).toBeGreaterThanOrEqual(rowBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(rowBox.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
    boxes.push(box);
  }
  for (let i = 1; i < PACKS; i++) expect(boxes[i].x, `booster ${i + 1} à direita do anterior`).toBeGreaterThan(boxes[i - 1].x);
  // No celular os 6 cabem numa linha só (o booster em destaque sobe uns pixels).
  if (isMobile) for (const box of boxes) expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(box.height / 2);
});
