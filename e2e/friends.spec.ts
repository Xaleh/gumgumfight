// Amigos: o convite pela folha "Amigos" deixa escolher o formato, e a mesa do Yonko é um deles.

import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { login } from './support/accounts';
import { openHome } from './support/app';
import { label } from './support/i18n';

/** As duas contas viram amigas pelas rotas (o pedido pelo código e o aceite já têm os testes do servidor). */
async function befriend(a: Page, b: Page, idOfA: string) {
  const { code } = (await (await a.request.get('/api/friends')).json()) as { code: string };
  expect((await b.request.post('/api/friends/requests', { data: { code } })).status()).toBe(201);
  expect((await a.request.post(`/api/friends/${idOfA}/accept`)).status()).toBe(200);
}

test.describe('Amigos', () => {
  test('convidar um amigo para o Yonko: escolhe o formato, o amigo entra pela faixa e a mesa chama mais amigos', async ({ page, newPlayer }) => {
    const friend = await newPlayer();
    await login(page, 'Ana Amiga');
    const { userId: friendId } = await login(friend, 'Bia Amiga');
    await befriend(page, friend, friendId);
    const third = await newPlayer();
    const { userId: thirdId } = await login(third, 'Caio Amigo');
    await befriend(page, third, thirdId);
    // O nome que os amigos veem é o apelido do jogador (nunca o da conta).
    const { friends } = (await (await page.request.get('/api/friends')).json()) as { friends: Array<{ id: string; name: string }> };
    const nameOf = (id: string) => friends.find((f) => f.id === id)!.name;
    const [friendName, thirdName] = [nameOf(friendId), nameOf(thirdId)];

    // Quem convida: Amigos → Convidar abre os formatos (1 contra 1 em cada formato e o Yonko).
    await openHome(page);
    await page.getByRole('button', { name: new RegExp(`^${label('friends.nav')}`) }).first().click();
    const sheet = page.getByRole('dialog', { name: label('friends.title') });
    await sheet.getByRole('listitem').filter({ hasText: friendName }).getByRole('button', { name: label('friends.invite'), exact: true }).click();
    const formats = sheet.getByRole('group');
    await expect(formats.getByRole('button', { name: new RegExp(`^${label('friends.inviteDuel', { format: 'Standard' })}`) })).toBeVisible();
    await expect(formats.getByRole('button', { name: new RegExp(`^${label('friends.inviteDuel', { format: label('mode.free') }).replace(/[()]/g, '\\$&')}`) })).toBeVisible();
    await formats.getByRole('button', { name: new RegExp(`^${label('friends.inviteYonko')}`) }).click();

    // Vai para a sala de espera da mesa, com o painel para chamar mais amigos.
    await expect(page.getByText(label('yonko.codeLabel'), { exact: true })).toBeVisible();
    const code = (await page.locator('.yk-code b').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const panel = page.locator('.table-friends');
    await expect(panel.getByRole('heading', { name: label('friends.tableTitle'), exact: true })).toBeVisible();

    // O amigo vê a faixa do convite na tela inicial e senta direto na mesa.
    await openHome(friend);
    const banner = friend.locator('.friend-invite');
    await expect(banner).toContainText(label('friends.inviteYonko'));
    await banner.getByRole('button', { name: label('friends.inviteJoin'), exact: true }).click();
    await expect(friend.locator('.yk-code b')).toHaveText(code);
    await expect(friend.locator('.yk-seat.me')).toBeVisible();

    // Na mesa de quem convidou aparecem os dois lugares ocupados.
    await expect(page.locator('.yk-seat:not(.empty)')).toHaveCount(2);

    // Da própria mesa, quem convidou chama mais um amigo sem sair dela: a faixa aparece para ele.
    const row = panel.getByRole('listitem').filter({ hasText: thirdName });
    await row.getByRole('button', { name: label('friends.invite'), exact: true }).click();
    await expect(row.getByRole('button', { name: label('friends.inviteSent'), exact: true })).toBeDisabled();
    await openHome(third);
    await expect(third.locator('.friend-invite')).toContainText(label('friends.inviteYonko'));

    // O toque no aviso (a notificação abre este endereço) senta na mesa sem passar pela entrada do Yonko.
    await third.goto(`/?yonko=${code}&convite=1`);
    await expect(third.locator('.yk-code b')).toHaveText(code);
    await expect(page.locator('.yk-seat:not(.empty)')).toHaveCount(3);
    expect(new URL(third.url()).search).toBe('');
  });
});
