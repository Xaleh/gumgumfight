// A mesa com o mouse e o teclado: arrastar (DON!!, a mão, uma carta para o campo, um ataque), segurar o
// clique numa carta e os atalhos de teclado. Os outros fluxos jogam com o Auto e só clicam em botões; estes
// passam pelos gestos e pelas teclas de quem joga.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { startBotMatch } from './support/app';
import { label } from './support/i18n';

const myLeader = (page: Page) => page.locator('.side.bottom .leader-zone .card');
const theirLeader = (page: Page) => page.locator('.side.top .leader-zone .card');
/** Os DON!! ativos do jogador, na fileira. */
const myDons = (page: Page) => page.locator('.don-row.bottom .don-card[data-don]');
const attachedDon = (page: Page) => page.locator('.side.bottom .leader-zone .attached-don');
const handCards = (page: Page) => page.locator('.hand.bottom .hand-card');
const handOrder = (page: Page) => handCards(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.handUid ?? ''));
const zoom = (page: Page) => page.locator('.zoom');
const endTurn = (page: Page) => page.getByRole('button', { name: new RegExp(`^${label('game.endTurn').split('\n').join('\\s*')}$`) });
/**
 * Se dá para encerrar o turno agora. Enquanto o jogo pergunta algo (escolher um alvo, por exemplo) o botão nem
 * está na tela, e `isEnabled()` sem prazo ficaria esperando por ele até estourar o tempo da ação, com erro.
 */
const canEndTurn = (page: Page) => endTurn(page).isEnabled({ timeout: 500 }).catch(() => false);

/**
 * O meio de um elemento na tela (ou um ponto dentro dele, em fração da largura e da altura), depois de ele parar
 * de se mexer e de nada estar por cima desse ponto (as cartas e os DON!! chegam voando no começo do turno).
 */
async function point(target: Locator, fx = 0.5, fy = 0.5) {
  const size = (await target.boundingBox())!;
  await target.hover({ trial: true, position: { x: size.width * fx, y: size.height * fy } });
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Arrasta com o mouse de um ponto a outro, em passos (o arrasto só começa depois de o mouse andar um pouco). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

/**
 * Joga até o jogador ter, no próprio turno, uma carta da mão que dá para jogar: encerra o turno enquanto não
 * tem e responde ao que o jogo perguntar no meio (não bloquear, não usar Counter, confirmar) pelo botão de
 * confirmar que estiver na tela.
 */
async function untilPlayable(page: Page): Promise<Locator> {
  const playable = page.locator('.hand.bottom .card.hl-playable');
  const confirm = page.locator('[data-hotkey~="confirm"]:not(:disabled)');
  await expect(async () => {
    if (await canEndTurn(page)) {
      if ((await playable.count()) > 0) return;
      await endTurn(page).click();
    } else if ((await confirm.count()) > 0) await confirm.first().click({ timeout: 2000 });
    throw new Error('ainda sem carta para jogar');
  }).toPass({ timeout: 90_000, intervals: [400] });
  return playable.first();
}

test.describe('a mesa com o mouse e o teclado', () => {
  test('arrastar um DON!! até o Líder anexa, e arrastar de volta devolve', async ({ page }) => {
    await startBotMatch(page);
    await expect(myDons(page)).toHaveCount(1);
    await drag(page, await point(myDons(page).first()), await point(myLeader(page)));
    await expect(attachedDon(page)).toBeVisible();
    await expect(myDons(page)).toHaveCount(0);
    // O DON!! anexado neste turno e ainda não usado volta para a fileira.
    await drag(page, await point(attachedDon(page)), await point(page.locator('.don-row.bottom')));
    await expect(myDons(page)).toHaveCount(1);
    await expect(attachedDon(page)).toBeHidden();
  });

  test('segurar o clique numa carta abre a carta ampliada, e o Esc fecha', async ({ page }) => {
    await startBotMatch(page);
    const at = await point(myLeader(page));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // Sem soltar: é o toque longo que abre.
    await expect(zoom(page)).toBeVisible();
    await page.mouse.up();
    await expect(zoom(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(zoom(page)).toBeHidden();
  });

  test('arrastar uma carta dentro da mão muda a ordem da mão', async ({ page }) => {
    await startBotMatch(page);
    const before = await handOrder(page);
    expect(before.length).toBeGreaterThan(2);
    // A primeira carta (a ponta esquerda dela, que as outras não cobrem) vai para o fim da mão.
    await drag(page, await point(handCards(page).first(), 0.15, 0.3), await point(handCards(page).last(), 0.7, 0.3));
    await expect.poll(() => handOrder(page)).toEqual([...before.slice(1), before[0]]);
  });

  test('arrastar uma carta da mão para o campo joga a carta, e arrastar o Líder até o Líder do oponente ataca', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await startBotMatch(page);
    const card = await untilPlayable(page);
    const uid = await card.getAttribute('data-uid');
    const inHand = page.locator(`.hand.bottom [data-hand-uid="${uid}"]`);
    await expect(inHand).toHaveCount(1);
    await drag(page, await point(card, 0.3, 0.2), await point(page.locator('.side.bottom')));
    await expect(inHand).toHaveCount(0);
    // O ataque: o Líder vira (fica "rested") assim que o ataque é declarado.
    await expect(async () => {
      // A carta jogada pode perguntar algo antes (um [Ao Jogar], o alvo de um Evento): responde pelo botão de
      // confirmar. Enquanto a pergunta está na tela o "Encerrar turno" não existe.
      const confirm = page.locator('[data-hotkey~="confirm"]:not(:disabled)');
      if (!(await canEndTurn(page)) && (await confirm.count()) > 0) await confirm.first().click({ timeout: 2000 });
      await expect(endTurn(page)).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await expect(myLeader(page)).not.toHaveClass(/\brested\b/);
    await drag(page, await point(myLeader(page)), await point(theirLeader(page)));
    await expect(myLeader(page)).toHaveClass(/\brested\b/);
  });

  test('atalhos de teclado: marcar DON!!, escolher o Líder, anexar, abrir o descarte e encerrar o turno', async ({ page }) => {
    await startBotMatch(page);
    // Os atalhos vêm desligados: liga nas configurações do menu da partida.
    await page.getByRole('button', { name: label('game.menuLabel'), exact: true }).click();
    await page.getByLabel(label('settings.shortcuts'), { exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel(label('settings.shortcuts'), { exact: true })).toBeHidden();

    // 1: marca um DON!!; Esc: desmarca. (Os atalhos passam a valer logo depois de o menu fechar: a primeira
    // tecla é repetida até pegar; marcar de novo o mesmo DON!! não muda nada.)
    await expect(async () => {
      await page.keyboard.press('1');
      await expect(page.locator('.don-row.bottom .don-card.picked')).toHaveCount(1, { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.don-row.bottom .don-card.picked')).toHaveCount(0);

    // L: escolhe o Líder sem abrir a carta; X: anexa nele todos os DON!! ativos.
    await page.keyboard.press('l');
    await expect(myLeader(page)).toHaveClass(/\bhl-selected\b/);
    await expect(zoom(page)).toBeHidden();
    await page.keyboard.press('x');
    await expect(attachedDon(page)).toBeVisible();
    await expect(myDons(page)).toHaveCount(0);

    // Shift+L: o Líder do oponente.
    await page.keyboard.press('Shift+L');
    await expect(theirLeader(page)).toHaveClass(/\bhl-selected\b/);

    // D: o descarte (vazio no primeiro turno); Esc fecha.
    await page.keyboard.press('d');
    await expect(page.getByText(label('game.trashEmpty'), { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(label('game.trashEmpty'), { exact: true })).toBeHidden();

    // Espaço: encerra o turno.
    await expect(page.locator('.side.bottom')).toHaveClass(/\bactive-side\b/);
    await page.keyboard.press('Space');
    await expect(page.locator('.side.bottom')).not.toHaveClass(/\bactive-side\b/);
  });
});

test.describe('a pergunta no meio de um ataque', () => {
  /**
   * Uma mesa do Sandbox (as mesmas cartas sempre, a mesma pessoa nos dois lados): o Líder do lado A, com 2 DON!!,
   * ataca a Jewelry Bonney, que no ataque do oponente pergunta se usa o efeito dela.
   */
  const spec = {
    turn: 3,
    active: 0,
    sides: [
      { leader: { id: 'ST01-001', don: 2 }, donActive: 3 },
      { leader: { id: 'OP07-019' }, donActive: 3 },
    ],
  };

  test('a janela da pergunta diz embaixo quem ataca quem e com quanto poder', async ({ page }) => {
    await page.goto(`/?sandbox=${Buffer.from(JSON.stringify(spec)).toString('base64url')}`);
    await page.getByRole('button', { name: label('sandbox.play'), exact: true }).click();
    await drag(page, await point(myLeader(page)), await point(theirLeader(page)));

    // A pergunta cobre a mesa; a batalha vem embaixo dela, na visão de quem responde (o lado B, o alvo).
    await expect(page.getByRole('button', { name: label('game.payAndUse'), exact: true })).toBeVisible();
    const battle = page.getByRole('group', {
      name: label('log.attacks', { card: 'Monkey.D.Luffy', power: 7000, target: 'Jewelry Bonney', targetPower: 5000 }),
      exact: true,
    });
    await expect(battle).toBeVisible();
    await expect(battle.getByText(label('game.promptAttacker', { who: label('sandbox.sideA') }), { exact: true })).toBeVisible();
    await expect(battle.getByText(label('game.promptTarget', { who: label('menu.you') }), { exact: true })).toBeVisible();
    await expect(battle.getByText(label('game.needToDefend', { n: 3000 }), { exact: true })).toBeVisible();

    // "Ver a mesa" recolhe a janela e a batalha com ela (a mesa já mostra o confronto); a volta traz as duas.
    await page.getByRole('button', { name: label('game.peek'), exact: true }).click();
    await expect(battle).toBeHidden();
    await page.getByRole('button', { name: label('game.backToQuestion'), exact: true }).click();
    await expect(battle).toBeVisible();
  });
});
