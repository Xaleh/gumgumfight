// Torneio do começo ao fim pela tela: o organizador cria, dois jogadores se inscrevem pelo link de convite,
// a rodada abre, a partida é jogada na sala online do torneio, o resultado entra sozinho e o torneio termina
// com a classificação para os dois.

import { login } from './support/accounts';
import { openHome } from './support/app';
import { expect, test } from './support/fixtures';
import { label, t } from './support/i18n';
import { concede, expectResult, playToFirstTurn } from './support/online';
import { createTournament, inviteUrl, markReady, openLobbyChat, register } from './support/tournament';

test('torneio suíço: criar, inscrever, jogar a rodada e encerrar @iphone', async ({ page: organizer, newPlayer }) => {
  test.setTimeout(3 * 60_000);
  const ana = await newPlayer();
  const bia = await newPlayer();
  await login(organizer, 'Org E2E', 'organizer');
  await login(ana, 'Ana Torneio');
  await login(bia, 'Bia Torneio');

  // O organizador cria o torneio (suíço, Standard, sem data: começa à mão).
  await openHome(organizer);
  const id = await createTournament(organizer, `Torneio E2E ${Date.now()}`);

  // Os jogadores entram pelo link de convite e se inscrevem com decks prontos diferentes.
  await register(ana, id, 'Kid Roxo/Vermelho (ST10)');
  await register(bia, id, 'Luffy Roxo/Vermelho (ST10)');

  // O organizador fecha as inscrições e começa (a confirmação do navegador é aceita).
  await organizer.goto(inviteUrl(id));
  await expect(organizer.getByRole('button', { name: label('tour.tabPlayers', { n: 2 }), exact: true })).toBeVisible();
  organizer.once('dialog', (d) => d.accept());
  await organizer.getByRole('button', { name: label('tour.start'), exact: true }).click();

  // Os dois marcam "Estou pronto" e o organizador abre a rodada com a mesa pronta.
  await markReady(ana, id);
  await markReady(bia, id);
  const begin = organizer.getByRole('button', { name: label('tour.beginRound', { ready: 1, tables: 1 }), exact: true });
  await expect(begin).toBeVisible({ timeout: 20_000 });
  organizer.once('dialog', (d) => d.accept());
  await begin.click();

  // Cada um entra na sala da mesa e joga; quem não começou desiste.
  for (const p of [ana, bia]) await p.getByRole('button', { name: label('tour.playMatch'), exact: true }).click({ timeout: 20_000 });
  const [winner, loser] = await playToFirstTurn(ana, bia);
  await concede(loser);
  await expectResult(winner, 'victory', 'game.backToTournament');
  await expectResult(loser, 'defeat', 'game.backToTournament');

  // O resultado entra sozinho no torneio (sem o organizador lançar o placar).
  for (const p of [winner, loser]) await p.getByRole('button', { name: label('game.backToTournament'), exact: true }).click();
  await expect(winner.locator('.tour-my-result')).toHaveText(`${label('tour.resultWin')} ${label('tour.waitNextRound')}`, { timeout: 20_000 });
  await expect(loser.locator('.tour-my-result')).toHaveText(`${label('tour.resultLoss')} ${label('tour.waitNextRound')}`);

  // Última rodada: o organizador encerra e a classificação final aparece para os dois.
  const finish = organizer.getByRole('button', { name: label('tour.nextFinish'), exact: true });
  organizer.once('dialog', (d) => d.accept());
  await finish.click();
  for (const [p, rank, wins, losses] of [
    [winner, 1, 1, 0],
    [loser, 2, 0, 1],
  ] as const) {
    await p.goto(inviteUrl(id));
    await expect(p.getByText(t('tour.finishedPlaceSwiss', { rank: t('tour.ordinal', { n: rank }), wins, losses }), { exact: true })).toBeVisible();
  }
});

test('inscrição pelo link de convite no celular @iphone', async ({ page: organizer, newPlayer }) => {
  const player = await newPlayer();
  await login(organizer, 'Org Celular', 'organizer');
  await login(player, 'Caio Celular');
  await openHome(organizer);
  const id = await createTournament(organizer, `Torneio Celular ${Date.now()}`);
  await register(player, id, 'Luffy Roxo/Vermelho (ST10)');
  // O deck inscrito aparece para o jogador; o organizador vê o inscrito.
  await expect(player.getByText('Luffy Roxo/Vermelho (ST10)').first()).toBeVisible();
  await organizer.goto(inviteUrl(id));
  await expect(organizer.getByRole('button', { name: label('tour.tabPlayers', { n: 1 }), exact: true })).toBeVisible();
});

test('chat do lobby: inscrito e organizador conversam, o visitante só lê e o organizador apaga @iphone', async ({ page: organizer, newPlayer }) => {
  const ana = await newPlayer();
  const visitor = await newPlayer();
  await login(organizer, 'Org Chat', 'organizer');
  await login(ana, 'Ana Chat');
  await openHome(organizer);
  const id = await createTournament(organizer, `Torneio Chat ${Date.now()}`);
  await register(ana, id, 'Luffy Roxo/Vermelho (ST10)');

  const send = async (chat: Awaited<ReturnType<typeof openLobbyChat>>, text: string) => {
    await chat.getByLabel(label('lobbyChat.messageLabel'), { exact: true }).fill(text);
    await chat.getByRole('button', { name: label('online.send'), exact: true }).click();
    // Quem manda vê a mensagem na hora (a resposta do envio já traz a conversa).
    await expect(chat.locator('.lobby-chat-msg.mine').filter({ hasText: text })).toBeVisible();
  };

  // A inscrita escreve; o organizador, que abre o lobby depois, encontra a mensagem e responde.
  const anaChat = await openLobbyChat(ana, id);
  await expect(anaChat.getByText(label('lobbyChat.empty'), { exact: true })).toBeVisible();
  await send(anaChat, 'Oi, que horas começa?');
  const orgChat = await openLobbyChat(organizer, id);
  await expect(orgChat.locator('.lobby-chat-msg').filter({ hasText: 'Oi, que horas começa?' })).toBeVisible();
  await send(orgChat, 'Em dez minutos!');
  // A resposta chega para ela sozinha (o lobby consulta o chat de poucos em poucos segundos), com o papel de quem escreveu.
  const reply = anaChat.locator('.lobby-chat-msg').filter({ hasText: 'Em dez minutos!' });
  await expect(reply).toBeVisible();
  await expect(reply.locator('.lobby-chat-role')).toHaveText(label('tour.interventionRole.organizer'));

  // Quem não tem conta lê a conversa e não tem onde escrever.
  const visitorChat = await openLobbyChat(visitor, id);
  await expect(visitorChat.locator('.lobby-chat-msg')).toHaveCount(2);
  await expect(visitorChat.getByText(label('lobbyChat.loginHint'), { exact: true })).toBeVisible();
  await expect(visitorChat.getByLabel(label('lobbyChat.messageLabel'), { exact: true })).toHaveCount(0);

  // A inscrita só apaga a própria mensagem; o organizador apaga a dela, e ela some para todos.
  await expect(anaChat.getByRole('button', { name: label('lobbyChat.remove'), exact: true })).toHaveCount(1);
  organizer.once('dialog', (d) => d.accept());
  await orgChat.locator('.lobby-chat-msg').filter({ hasText: 'Oi, que horas começa?' }).getByRole('button', { name: label('lobbyChat.remove'), exact: true }).click();
  for (const chat of [orgChat, anaChat, visitorChat]) {
    await expect(chat.locator('.lobby-chat-msg')).toHaveCount(1);
    await expect(chat.locator('.lobby-chat-msg')).toContainText('Em dez minutos!');
  }
});

test('chat do lobby no celular: a barra de baixo conta as mensagens que chegam com ele fechado @iphone', async ({ page: organizer, newPlayer }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'na tela larga o chat é uma coluna sempre aberta');
  const ana = await newPlayer();
  await login(organizer, 'Org Barra', 'organizer');
  await login(ana, 'Ana Barra');
  await openHome(organizer);
  const id = await createTournament(organizer, `Torneio Barra ${Date.now()}`);
  await register(ana, id, 'Luffy Roxo/Vermelho (ST10)');

  await ana.goto(`${inviteUrl(id)}&lobby=1`);
  const bar = ana.getByRole('complementary', { name: label('lobbyChat.title'), exact: true }).getByRole('button', { name: label('lobbyChat.title') });
  await expect(bar).toContainText(label('lobbyChat.empty'));
  const orgChat = await openLobbyChat(organizer, id);
  await orgChat.getByLabel(label('lobbyChat.messageLabel'), { exact: true }).fill('Check-in aberto!');
  await orgChat.getByRole('button', { name: label('online.send'), exact: true }).click();
  // A barra mostra a última mensagem e quantas chegaram; abrir a conversa zera a contagem.
  await expect(bar).toContainText('Check-in aberto!');
  await expect(ana.getByLabel(label('lobbyChat.unread', { n: 1 }), { exact: true })).toHaveText('1');
  await bar.click();
  await expect(ana.locator('.lobby-chat-msg')).toContainText('Check-in aberto!');
  await ana.getByRole('button', { name: label('online.closeChatLabel'), exact: true }).click();
  await expect(bar).toBeVisible();
  await expect(ana.locator('.lobby-chat-badge')).toHaveCount(0);
});
