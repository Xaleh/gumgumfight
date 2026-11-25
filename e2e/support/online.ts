// Passos das partidas online (fila casual e ranqueada) com dois navegadores.

import { expect, type Page } from '@playwright/test';
import { label } from './i18n';
import type { MessageKey } from '../../apps/web/src/i18n/pt-BR';

/** Menu → card da fila (Partida rápida ou Ranqueada) → confirma o deck equipado. */
export async function joinQueue(page: Page, queue: 'casual' | 'ranked') {
  const card = page.getByRole('article', { name: label(queue === 'casual' ? 'menu.casual' : 'menu.ranked'), exact: true });
  await card.getByRole('button', { name: label('menu.findMatch'), exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: label('menu.findMatch'), exact: true }).click();
}

/** O botão de encerrar o turno: habilitado só para quem está com o turno. */
export const endTurn = (page: Page) => page.getByRole('button', { name: label('game.endTurn'), exact: true });

/**
 * Da sala aberta ao primeiro turno: os dois pulam a animação dos dados, quem venceu o sorteio joga
 * primeiro e os dois mantêm a mão. Devolve [quem começa, o outro].
 */
export async function playToFirstTurn(a: Page, b: Page): Promise<[Page, Page]> {
  const steps: MessageKey[] = ['dice.skip', 'dice.playFirst', 'game.playFirst', 'game.keepHand'];
  let first: Page | null = null;
  await expect(async () => {
    for (const page of [a, b]) {
      for (const key of steps) {
        const button = page.getByRole('button', { name: label(key), exact: true });
        if (await button.isVisible()) await button.click({ timeout: 2_000 }).catch(() => {});
      }
    }
    if (await endTurn(a).isEnabled()) first = a;
    else if (await endTurn(b).isEnabled()) first = b;
    expect(first, 'alguém com o turno').not.toBeNull();
  }).toPass({ timeout: 60_000 });
  return first === a ? [a, b] : [b, a];
}

/**
 * A mão de cada lado na tela de `page`: a própria com as cartas de verdade e a do oponente só com
 * referências escondidas (`~…`, de view.ts) e o verso das cartas.
 */
export async function expectHiddenOpponentHand(page: Page) {
  const own = page.locator('.hand.bottom [data-hand-uid]');
  const opp = page.locator('.hand.top [data-hand-uid]');
  await expect(opp).toHaveCount(5);
  for (const uid of await opp.evaluateAll((els) => els.map((e) => e.getAttribute('data-hand-uid') ?? ''))) {
    expect(uid, 'carta da mão do oponente').toMatch(/^~/);
  }
  await expect(page.locator('.hand.top .card:not(.back)')).toHaveCount(0);
  expect(await own.count()).toBeGreaterThanOrEqual(5);
  for (const uid of await own.evaluateAll((els) => els.map((e) => e.getAttribute('data-hand-uid') ?? ''))) {
    expect(uid, 'carta da própria mão').not.toMatch(/^~/);
  }
}

/** Desiste pelo menu da mesa (a confirmação do navegador é aceita). */
export async function concede(page: Page) {
  await page.getByRole('button', { name: label('game.menuLabel'), exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: label('game.concede'), exact: true }).click();
}

/** A tela de fim de partida com o resultado esperado e o botão de saída (no torneio, "Voltar ao torneio"). */
export async function expectResult(page: Page, result: 'victory' | 'defeat', exit: MessageKey = 'result.exit') {
  await expect(page.getByText(label(result === 'victory' ? 'result.victory' : 'result.defeat'), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: label(exit), exact: true })).toBeVisible();
}
