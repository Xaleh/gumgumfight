// Partidas online com dois navegadores: fila → partida → fim, na casual (sem conta) e na ranqueada
// (com duas contas de teste). O servidor é a autoridade: os dois lados veem a mesma partida pelo SSE.

import type { Page } from '@playwright/test';
import { login } from './support/accounts';
import { openHome } from './support/app';
import { expect, test } from './support/fixtures';
import { label } from './support/i18n';
import { concede, endTurn, expectHiddenOpponentHand, expectResult, joinQueue, playToFirstTurn } from './support/online';
import { addSpoilers, NEW_SPOILERS, removeSpoilers } from './support/spoilers';

test.describe('fila online', () => {
  test('casual: fila, turnos, volta depois de recarregar e desistência @iphone', async ({ page, newPlayer }) => {
    const other = await newPlayer();
    await openHome(page);
    await openHome(other);
    await joinQueue(page, 'casual');
    await joinQueue(other, 'casual');

    const [first, second] = await playToFirstTurn(page, other);
    // Cada um vê a própria mão; a do oponente chega ao navegador só como referências escondidas.
    await expectHiddenOpponentHand(first);
    await expectHiddenOpponentHand(second);
    await expect(endTurn(second)).toBeDisabled();

    // O turno passa para o outro navegador.
    await endTurn(first).click();
    await expect(endTurn(second)).toBeEnabled();
    await expect(endTurn(first)).toBeDisabled();

    // Recarregar a página no meio da partida volta para a mesma sala, ainda com o turno.
    await second.reload();
    await expect(endTurn(second)).toBeEnabled({ timeout: 30_000 });
    await expectHiddenOpponentHand(second);

    await concede(second);
    await expectResult(second, 'defeat');
    await expectResult(first, 'victory');

    // Os dois voltam ao menu.
    for (const p of [first, second]) {
      await p.getByRole('button', { name: label('result.exit'), exact: true }).click();
      await expect(p.getByRole('button', { name: label('menu.battle'), exact: true })).toBeVisible();
    }
  });

  test('a busca acompanha o jogador: dicas, mão de teste, minimizada em outra tela e a partida que chega @iphone', async ({ page, newPlayer }) => {
    const other = await newPlayer();
    await openHome(page);
    await joinQueue(page, 'casual');

    // A janela da espera: o cartão de dicas troca pelo botão.
    const wait = page.getByRole('dialog', { name: label('menu.onlineSearching') });
    const tip = wait.getByRole('region', { name: label('wait.tipsLabel'), exact: true }).locator('p');
    await expect(tip).toBeVisible();
    // O cartão abre numa dica de regra, com a ilustração dela.
    await expect(wait.locator('svg.tip-art')).toBeVisible();
    const firstTip = (await tip.textContent()) ?? '';
    await wait.getByRole('button', { name: label('wait.next'), exact: true }).click();
    await expect(tip).not.toHaveText(firstTip);

    // Mão de teste com o deck da fila: 5 cartas, e "Comprar" traz mais uma.
    await wait.getByRole('button', { name: label('wait.handTest'), exact: true }).click();
    const hand = page.getByRole('dialog', { name: label('wait.handTest') });
    await expect(hand.locator('.ht-hand .card')).toHaveCount(5);
    await hand.getByRole('button', { name: label('decks.hand.draw'), exact: true }).click();
    await expect(hand.locator('.ht-hand .card')).toHaveCount(6);
    await hand.getByRole('button', { name: label('common.close'), exact: true }).click();

    // Minimizada, a busca segue na tela inicial, com os outros modos desligados.
    await wait.getByRole('button', { name: label('wait.minimize'), exact: true }).click();
    const pill = page.getByRole('button', { name: new RegExp(`^${label('wait.pill')}`) });
    await expect(pill).toBeVisible();
    await expect(page.getByRole('button', { name: label('menu.battle'), exact: true })).toBeDisabled();

    // Uma tela onde se edita algo pergunta antes; "Continuar na fila" fica onde estava.
    await page.getByRole('button', { name: label('menu.navDecks'), exact: true }).first().click();
    const leave = page.getByRole('alertdialog', { name: label('wait.leaveTitle') });
    await leave.getByRole('button', { name: label('wait.leaveStay'), exact: true }).click();
    await expect(leave).toBeHidden();
    await expect(pill).toBeVisible();

    // Numa tela de navegar (estatísticas), a busca continua.
    await page.getByRole('button', { name: label('menu.myStats'), exact: true }).click();
    await expect(page.getByRole('button', { name: label('stats.backMenu'), exact: true })).toBeVisible();
    await expect(pill).toBeVisible();

    // O oponente entra na fila: quem estava nas estatísticas é levado para a mesa.
    await openHome(other);
    await joinQueue(other, 'casual');
    const [first, second] = await playToFirstTurn(page, other);
    await expect(pill).toBeHidden();
    await concede(second);
    await expectResult(second, 'defeat');
    await expectResult(first, 'victory');
  });

  test('sair da fila ao abrir o construtor de decks', async ({ page }) => {
    await openHome(page);
    await joinQueue(page, 'casual');
    await page.getByRole('dialog', { name: label('menu.onlineSearching') }).getByRole('button', { name: label('wait.minimize'), exact: true }).click();
    await page.getByRole('button', { name: label('menu.navDecks'), exact: true }).first().click();
    await page.getByRole('alertdialog', { name: label('wait.leaveTitle') }).getByRole('button', { name: label('wait.leaveGo'), exact: true }).click();
    await expect(page.getByRole('button', { name: label('deck.backMenu'), exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${label('wait.pill')}`) })).toBeHidden();
    // O servidor não tem mais ninguém na fila (o próximo teste não é pareado com quem saiu).
    await expect
      .poll(async () => ((await (await page.request.get('/api/online/stats')).json()) as { queue: { casual: Record<string, number> } }).queue.casual.standard)
      .toBe(0);
  });

  test('spoilers novos se alternam com as dicas na espera, e a carta abre ampliada @iphone', async ({ page }) => {
    addSpoilers();
    try {
      await openHome(page);
      await joinQueue(page, 'casual');
      const wait = page.getByRole('dialog', { name: label('menu.onlineSearching') });
      const tips = wait.getByRole('region', { name: label('wait.tipsLabel'), exact: true });
      const next = wait.getByRole('button', { name: label('wait.next'), exact: true });
      const spoiler = tips.getByText(label('wait.kickerSpoiler'), { exact: true });

      // O cartão abre numa dica de regra; o item seguinte é o spoiler mais novo, e depois dele vem outra dica.
      await expect(tips.locator('p')).toBeVisible();
      await expect(spoiler).toBeHidden();
      for (const name of NEW_SPOILERS) {
        await next.click();
        await expect(spoiler).toBeVisible();
        await expect(tips.locator('.wait-tip-name')).toContainText(name);
        await expect(tips.getByText(label('wait.spoilerToday'), { exact: false })).toBeVisible();
        if (name !== NEW_SPOILERS.at(-1)) {
          await next.click();
          await expect(spoiler).toBeHidden();
        }
      }

      // A carta abre ampliada, com o texto; o Esc fecha só ela, e a busca continua na janela.
      const last = NEW_SPOILERS.at(-1)!;
      await tips.getByRole('button', { name: label('wait.spoilerView', { name: last }), exact: true }).click();
      const zoom = page.getByRole('dialog', { name: last, exact: true });
      await expect(zoom.getByText('EB99-002', { exact: false })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(zoom).toBeHidden();
      await expect(wait).toBeVisible();
      await wait.getByRole('button', { name: label('common.cancel'), exact: true }).click();
      await expect(wait).toBeHidden();
    } finally {
      removeSpoilers();
      // Se o teste parou no meio, não deixa ninguém na fila para o teste seguinte ser pareado com ele.
      await page.goto('about:blank').catch(() => undefined);
    }
  });

  test('ranqueada: duas contas, desistência e bounty @iphone', async ({ page, newPlayer }) => {
    const other = await newPlayer();
    await login(page, 'Ana E2E');
    await login(other, 'Bia E2E');
    await openHome(page);
    await openHome(other);
    // Logado, a ranqueada fica liberada.
    for (const p of [page, other]) {
      const ranked = p.getByRole('article', { name: label('menu.ranked'), exact: true });
      await expect(ranked.getByRole('button', { name: label('menu.findMatch'), exact: true })).toBeEnabled();
    }
    const bounty = async (p: Page) => ((await (await p.request.get('/api/players/me')).json()) as { bounty: number } | null)?.bounty ?? 0;
    const before = [await bounty(page), await bounty(other)];

    await joinQueue(page, 'ranked');
    await joinQueue(other, 'ranked');
    const [first, second] = await playToFirstTurn(page, other);
    await concede(second);
    await expectResult(first, 'victory');
    await expectResult(second, 'defeat');

    // A partida conta para o bounty: quem venceu ganha.
    const winner = first === page ? 0 : 1;
    await expect.poll(async () => (await bounty(first)) - before[winner]).toBeGreaterThan(0);
  });
});
