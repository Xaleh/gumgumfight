// Vídeo 3: chat nas partidas online (sala privada com um segundo jogador fora da tela).
const G = require('../lib/game.cjs');
const SEGS = [
  { id: 'c1', say: 'Nas partidas online, você pode conversar com o seu oponente pelo chat. Aqui, uma sala privada com um amigo.', caption: 'Chat nas partidas online 💬' },
  { id: 'c2', say: 'Durante a partida, toque no balão de conversa, no canto da mesa.', caption: 'Toque no <b>💬</b> da mesa' },
  { id: 'c3', say: 'Escolha uma mensagem rápida, como Olá, ou escreva o seu próprio texto e toque em Enviar.', caption: 'Mensagens rápidas ou texto livre' },
  { id: 'c4', say: 'As mensagens do oponente aparecem em balões sobre a mesa. Com o chat fechado, um número mostra quantas chegaram.', caption: 'Balões na mesa e aviso no <b>💬</b>', min: 9 },
  { id: 'c5', say: 'Quer silêncio só nesta partida? Toque em Silenciar, dentro do chat. Tocando de novo, o chat volta.', caption: '<b>Silenciar</b>: vale só para esta partida' },
  { id: 'c6', say: 'Para desligar em todas as partidas, desmarque Chat do oponente nas configurações. Desligado vale para os dois lados: você não vê o que ele manda, e também não manda nada.', caption: 'Sempre desligado: desmarque <b>Chat do oponente</b>', min: 13 },
  { id: 'c7', say: 'Jogue do jeito que for mais confortável para você!', caption: 'Bons jogos! 🏴‍☠️' },
];

/** O amigo: outro navegador, fora da gravação. */
async function friend({ browser, page }) {
  // apelido do jogador gravado
  const me = page.frames().find((f) => f.url().startsWith('http://localhost:5173/') && !f.url().includes('__frame'));
  await me.locator('.nickname-link').click();
  await me.locator('.settings-sheet .nickname input').fill('CapitaoGum');
  await me.locator('.settings-sheet .nickname button[type=submit]').click();
  await me.waitForTimeout(700);
  await me.locator('.settings-sheet .zoom-close').click();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, locale: 'pt-BR', isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { if (!localStorage.getItem('gumgum.settings')) localStorage.setItem('gumgum.settings', JSON.stringify({ locale: 'pt-BR', theme: 'light' })); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173/');
  await p.waitForTimeout(2000);
  // apelido do amigo
  await p.locator('.nickname-link').click();
  const input = p.locator('.settings-sheet .nickname input');
  await input.fill('NamiNavegadora');
  await p.locator('.settings-sheet .nickname button[type=submit]').click();
  await p.waitForTimeout(600);
  await p.locator('.settings-sheet .zoom-close').click();
  return p;
}

async function run(S) {
  const [c1, c2, c3, c4, c5, c6, c7] = SEGS;
  const B = S.prepared;
  const bPlay = async () => {
    // dados, quem começa e mão inicial do amigo
    await B.getByRole('button', { name: /Jogar dados/ }).click({ timeout: 20000 });
    const next = B.getByRole('button', { name: /^(Continuar|Jogar segundo)$/ }).first();
    await next.waitFor({ timeout: 30000 }); await B.waitForTimeout(1200); await next.click();
    await B.getByRole('button', { name: 'Manter mão' }).click({ timeout: 30000 });
  };
  const bChat = async (fn) => {
    const btn = B.getByRole('button', { name: 'Chat da partida' });
    if (!(await B.locator('.chat-panel').isVisible().catch(() => false))) await btn.click({ force: true });
    await fn();
  };
  await S.seg(c1, async () => {
    await S.sleep(500);
    await S.scrollTo(S.role('button', { name: 'Criar sala' }));
    await S.tap(S.role('button', { name: 'Criar sala' }));
    await S.sleep(1500);
    const code = (await S.app.locator('body').innerText()).match(/\b[A-Z0-9]{6}\b/)[0];
    await B.getByPlaceholder(/ABC/).fill(code);
    await B.getByRole('button', { name: 'Entrar' }).click();
    const bp = bPlay();
    await G.dice(S);
    await G.keepHand(S);
    await bp;
  });
  await S.seg(c2, async () => { await S.sleep(900); await S.tap(S.role('button', { name: 'Chat da partida' }), { force: true }); });
  await S.seg(c3, async () => {
    await S.sleep(600);
    await S.tap(S.role('button', { name: 'Olá! 👋' }));
    await S.sleep(500);
    await S.type(S.$('.chat-input'), 'Boa sorte! 🍀', 90);
    await S.tap(S.role('button', { name: 'Enviar' }));
  });
  await S.seg(c4, async () => {
    await S.sleep(400);
    await S.tap(S.$('.chat-panel .chat-head button').last(), { force: true });
    await S.sleep(800);
    await bChat(async () => {
      await B.getByRole('button', { name: 'Valeu! 🙏' }).click();
      await B.waitForTimeout(1500);
      await B.locator('.chat-input').fill('Bora! Boa partida pra nós dois 😄');
      await B.getByRole('button', { name: 'Enviar' }).click();
    });
    await S.sleep(3500);
    await S.tap(S.role('button', { name: 'Chat da partida' }), { force: true });
  });
  await S.seg(c5, async () => {
    await S.sleep(700);
    const mute = S.$('.chat-panel .chat-head button').first();
    await S.tap(mute, { force: true });
    await S.sleep(2600);
    await S.tap(mute, { force: true });
  });
  await S.seg(c6, async () => {
    await S.tap(S.$('.chat-panel .chat-head button').last(), { force: true });
    await G.gameMenu(S);
    await G.toggleCheck(S, 'Chat do oponente');
    await S.sleep(700);
    await G.closeSheet(S);
    await bChat(async () => {
      await B.locator('.chat-input').fill('Oi? Tá aí?');
      await B.getByRole('button', { name: 'Enviar' }).click();
    });
    await S.sleep(2500);
    await S.tap(S.role('button', { name: 'Chat da partida' }), { force: true });
  });
  await S.seg(c7, async () => { await S.sleep(400); await S.tap(S.$('.chat-panel .chat-head button').last(), { force: true }); });
}
module.exports = { prepare: friend, id: 'chat', title: 'Chat com o oponente', SEGS, run };
