// Partidas online com dois navegadores: fila → partida → fim, na casual (sem conta) e na ranqueada
// (com duas contas de teste). O servidor é a autoridade: os dois lados veem a mesma partida pelo SSE.

import type { Page } from '@playwright/test';
import { login } from './support/accounts';
import { openHome } from './support/app';
import { expect, test } from './support/fixtures';
import { label } from './support/i18n';
import { concede, endTurn, expectHiddenOpponentHand, expectResult, joinQueue, playToFirstTurn } from './support/online';

test.describe('fila online', () => {
  test('casual: fila, turnos, volta depois de recarregar e desistência', async ({ page, newPlayer }) => {
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

  test('ranqueada: duas contas, desistência e bounty', async ({ page, newPlayer }) => {
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
