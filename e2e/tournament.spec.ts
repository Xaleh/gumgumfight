// Torneio do começo ao fim pela tela: o organizador cria, dois jogadores se inscrevem pelo link de convite,
// a rodada abre, a partida é jogada na sala online do torneio, o resultado entra sozinho e o torneio termina
// com a classificação para os dois.

import { login } from './support/accounts';
import { openHome } from './support/app';
import { expect, test } from './support/fixtures';
import { label, t } from './support/i18n';
import { concede, expectResult, playToFirstTurn } from './support/online';
import { createTournament, inviteUrl, markReady, register } from './support/tournament';

test('torneio suíço: criar, inscrever, jogar a rodada e encerrar', async ({ page: organizer, newPlayer }) => {
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
