// A tela virando como página (screenTurn.ts): entrar numa seção a partir do menu e voltar dela. No desktop a
// tela é um livro aberto e só a metade direita vira; no celular a tela inteira é a folha. Só com as animações
// completas: com as suaves e as desligadas a tela troca na hora.

import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { openHome } from './support/app';
import { label } from './support/i18n';
import { joinQueue } from './support/online';

/** A camada da virada: existe só enquanto a folha está no ar. */
const turning = (page: Page) => page.locator('.screen-turn');
const home = (page: Page) => page.getByRole('button', { name: label('menu.battle'), exact: true });
const learnTitle = (page: Page) => page.getByRole('heading', { name: label('tutorial.heroTitle') });

/** Conta as camadas de virada criadas a partir de agora. */
async function countTurns(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { turns: number };
    w.turns = 0;
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n instanceof Element && n.classList.contains('screen-turn')) w.turns++;
    }).observe(document.body, { childList: true });
  });
  return () => page.evaluate(() => (window as unknown as { turns: number }).turns);
}

test.describe('a tela vira como página', () => {
  test('do menu para Aprender e de volta @iphone', async ({ page }) => {
    await openHome(page);
    const turns = await countTurns(page);
    await page.getByRole('button', { name: label('menu.learnStart'), exact: true }).click();
    await expect(learnTitle(page)).toBeVisible();
    await expect(turning(page)).toHaveCount(0);
    expect(await turns()).toBe(1);
    // Depois da virada a tela de verdade responde: o Voltar funciona e vira a página para trás.
    await page.getByRole('button', { name: label('common.back'), exact: true }).click();
    await expect(home(page)).toBeVisible();
    await expect(turning(page)).toHaveCount(0);
    expect(await turns()).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('as outras seções do menu também viram, e entrar numa partida não', async ({ page }) => {
    await openHome(page);
    const turns = await countTurns(page);
    // Pelos links do rodapé: o menu está rolado até o fim quando a página vira.
    const nav = page.getByRole('navigation', { name: label('menu.footerNav') });
    for (const [i, section] of (['menu.navStats', 'menu.navTournaments', 'menu.navDecks'] as const).entries()) {
      await nav.getByRole('button', { name: label(section), exact: true }).click();
      await expect(home(page)).toBeHidden();
      await expect(turning(page)).toHaveCount(0);
      expect(await turns()).toBe(2 * i + 1);
      // O primeiro botão do cabeçalho de cada seção é o de voltar ao menu (o texto muda de uma para outra).
      await page.getByRole('banner').getByRole('button').first().click();
      await expect(home(page)).toBeVisible();
      await expect(turning(page)).toHaveCount(0);
      expect(await turns()).toBe(2 * i + 2);
    }
    // A confirmação do deck e a mesa abrem na hora.
    await home(page).click();
    await page.getByRole('dialog').getByRole('button', { name: label('menu.battle'), exact: true }).click();
    await expect(page.locator('.game')).toBeVisible();
    expect(await turns()).toBe(6);
  });

  test('com a busca por oponente aberta: a tela que só pergunta não vira, e a busca acompanha a virada', async ({ page }) => {
    await openHome(page);
    await joinQueue(page, 'casual');
    await page.getByRole('dialog', { name: label('menu.onlineSearching') }).getByRole('button', { name: label('wait.minimize'), exact: true }).click();
    const pill = page.getByRole('button', { name: new RegExp(`^${label('wait.pill')}`) });
    const leave = page.getByRole('alertdialog', { name: label('wait.leaveTitle') });
    const turns = await countTurns(page);
    // O construtor pede para sair da fila antes: a tela não trocou, então nada vira.
    await page.getByRole('button', { name: label('menu.navDecks'), exact: true }).first().click();
    await leave.getByRole('button', { name: label('wait.leaveStay'), exact: true }).click();
    await expect(home(page)).toBeVisible();
    expect(await turns()).toBe(0);
    // As estatísticas mantêm a fila: a tela vira e a busca minimizada continua lá.
    await page.getByRole('button', { name: label('menu.myStats'), exact: true }).click();
    await expect(page.getByRole('button', { name: label('stats.backMenu'), exact: true })).toBeVisible();
    await expect(turning(page)).toHaveCount(0);
    expect(await turns()).toBe(1);
    await expect(pill).toBeVisible();
    // Sai da fila (o teste seguinte não é pareado com quem ficou): o "Sair da fila e abrir" troca a tela na hora.
    await page.getByRole('button', { name: label('stats.backMenu'), exact: true }).click();
    await expect(home(page)).toBeVisible();
    await page.getByRole('button', { name: label('menu.navDecks'), exact: true }).first().click();
    await leave.getByRole('button', { name: label('wait.leaveGo'), exact: true }).click();
    await expect(page.getByRole('button', { name: label('deck.backMenu'), exact: true })).toBeVisible();
    expect(await turns()).toBe(2);
    await expect
      .poll(async () => ((await (await page.request.get('/api/online/stats')).json()) as { queue: { casual: Record<string, number> } }).queue.casual.standard)
      .toBe(0);
  });

  for (const animations of ['soft', 'off'] as const) {
    test(`animações ${animations === 'soft' ? 'suaves' : 'desligadas'}: a tela troca na hora`, async ({ page }) => {
      await page.addInitScript((a) => localStorage.setItem('gumgum.settings', JSON.stringify({ animations: a })), animations);
      await openHome(page);
      const turns = await countTurns(page);
      await page.getByRole('button', { name: label('menu.learnStart'), exact: true }).click();
      await expect(learnTitle(page)).toBeVisible();
      await page.getByRole('button', { name: label('common.back'), exact: true }).click();
      await expect(home(page)).toBeVisible();
      expect(await turns()).toBe(0);
    });
  }
});
