// Passos do torneio pela tela: o organizador cria e conduz, os jogadores entram pelo link de convite.

import { expect, type Page } from '@playwright/test';
import { label } from './i18n';

/** O link de convite do torneio (o mesmo que "Copiar convite" põe na área de transferência). */
export const inviteUrl = (id: string) => `/?torneio=${encodeURIComponent(id)}`;

/**
 * Abre o lobby do torneio (o link do aviso de chamado de Judge) com o chat à vista: na tela larga ele
 * é a coluna ao lado; na estreita, a barra de baixo, que este passo abre. Devolve o painel do chat.
 */
export async function openLobbyChat(page: Page, id: string) {
  await page.goto(`${inviteUrl(id)}&lobby=1`);
  const chat = page.getByRole('complementary', { name: label('lobbyChat.title'), exact: true });
  await expect(chat).toBeVisible();
  const bar = chat.getByRole('button', { name: label('lobbyChat.title') });
  if (await bar.isVisible()) await bar.click();
  await expect(chat.locator('.lobby-chat-log')).toBeVisible();
  return chat;
}

/** Menu → Torneios → Criar torneio (suíço, Standard, sem data: o organizador começa à mão). Devolve o id. */
export async function createTournament(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: label('menu.navTournaments'), exact: true }).first().click();
  await page.getByRole('button', { name: label('tour.create'), exact: true }).click();
  await page.getByLabel(label('tour.name'), { exact: true }).fill(name);
  await page.getByRole('button', { name: label('tour.createSubmit'), exact: true }).click();
  await expect(page.getByRole('button', { name: label('tour.start'), exact: true })).toBeVisible();
  // O id vem da lista pública (a tela não põe o torneio na URL).
  const { tournaments } = (await (await page.request.get('/api/tournaments')).json()) as { tournaments: Array<{ id: string; name: string }> };
  const id = tournaments.find((t) => t.name === name)?.id;
  expect(id, `torneio "${name}" na lista`).toBeTruthy();
  return id!;
}

/** Pelo link de convite: escolhe o deck pronto `deck` (o nome no seletor) e se inscreve. */
export async function register(page: Page, id: string, deck: string) {
  await page.goto(inviteUrl(id));
  await page.getByRole('button', { name: label('tour.deckLabel', { format: 'Standard' }), exact: true }).click();
  const picker = page.getByRole('dialog', { name: label('decks.choose'), exact: true });
  // Dois cliques num deck: escolhe e fecha o seletor.
  await picker.getByRole('button', { name: deck }).dblclick();
  await expect(picker).toBeHidden();
  await page.getByRole('button', { name: label('tour.register'), exact: true }).click();
  await expect(page.getByRole('button', { name: label('tour.cancelRegistration'), exact: true })).toBeVisible();
}

/** O jogador abre o torneio pelo convite e marca "Estou pronto" para a rodada. */
export async function markReady(page: Page, id: string) {
  await page.goto(inviteUrl(id));
  await page.getByRole('button', { name: label('tour.readyBtn'), exact: true }).click();
  await expect(page.getByRole('button', { name: label('tour.readyOn'), exact: true })).toBeVisible();
}
