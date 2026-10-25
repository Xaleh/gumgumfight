// Vídeo 6: Counter com confirmação (padrão) e sem confirmação.
const G = require('../lib/game.cjs');
const SEGS = [
  { id: 'f1', say: 'Na etapa de Counter, você usa cartas da mão para dar mais poder a quem está sendo atacado. E o GumGum Fight tem dois jeitos de fazer isso.', caption: 'Etapa de Counter: dois modos' },
  { id: 'f2', say: 'No modo padrão, você toca nas cartas para marcar os Counters. Dá para marcar várias, e desmarcar se mudar de ideia.', caption: 'Padrão: toque para <b>marcar</b> os Counters' },
  { id: 'f3', say: 'Quando estiver tudo certo, confirme no botão, e os Counters são usados de uma vez.', caption: 'Confirme no botão <b>Usar Counter</b>' },
  { id: 'f4', say: 'Quer mais agilidade? Ligue a opção Counter sem confirmação, nas configurações ou no menu da partida.', caption: 'Ligue <b>Counter sem confirmação</b>' },
  { id: 'f5', say: 'Agora, quando o oponente atacar...', caption: 'No próximo ataque...', min: 3 },
  { id: 'f6', say: 'É só tocar na carta, ou arrastar até a mesa, e o Counter é usado na hora. Mais rápido, mas sem volta!', caption: 'Um toque e o Counter já foi usado ⚡' },
  { id: 'f7', say: 'Escolha o modo que combina com o seu jeito de jogar!', caption: 'Escolha o seu modo 😉' },
];
async function run(S) {
  const [f1, f2, f3, f4, f5, f6, f7] = SEGS;
  const opts = () => S.$('.hand-card .card.hl-option');
  await S.seg(f1, async () => {
    await S.sleep(300);
    await G.chooseFirst(S, 'Bot');
    await S.tap(S.role('button', { name: 'Batalhar!' }));
    await G.keepHand(S);
    await S.text('Primeiro turno').waitFor({ timeout: 30000 }).catch(() => {});
    await S.sleep(800);
    await G.endTurn(S);
    await G.waitCounter(S);
  });
  await S.badge('COM CONFIRMAÇÃO');
  await S.seg(f2, async () => {
    await G.waitCounter(S);
    await S.sleep(500);
    const idx = await S.$('.hand-card').evaluateAll((els) => els.map((e, i) => (e.querySelector('.card.hl-option') ? i : -1)).filter((i) => i >= 0));
    const card = (k) => S.$('.hand-card').nth(idx[Math.min(k, idx.length - 1)]).locator('.card');
    if (idx.length > 1) {
      await S.tap(card(0), { force: true, after: 900 });
      await S.tap(card(1), { force: true, after: 900 });
      await S.tap(card(1), { force: true, after: 900 });
      await S.tap(card(1), { force: true, after: 600 });
    } else {
      await S.tap(card(0), { force: true, after: 1000 });
      await S.tap(card(0), { force: true, after: 1000 });
      await S.tap(card(0), { force: true, after: 600 });
    }
  });
  await S.seg(f3, async () => {
    await S.sleep(600);
    await S.tap(S.role('button', { name: /Usar Counter/ }).first(), { force: true });
  });
  await S.seg(f4, async () => {
    await S.badge(null);
    await S.sleep(800);
    await G.gameMenu(S);
    await G.toggleCheck(S, 'Counter sem confirmação');
    await S.sleep(500);
    await S.scrollTo(S.role('button', { name: '2×' }));
    await S.tap(S.role('button', { name: '2×' }), { force: true });
    await G.closeSheet(S);
  });
  await S.badge('SEM CONFIRMAÇÃO', 'red');
  await S.seg(f5, async () => {
    // termina o turno 4 e espera o próximo ataque do bot
    const end = S.role('button', { name: /Encerrar/ });
    for (let i = 0; i < 60 && !(await end.isEnabled().catch(() => false)); i++) await S.sleep(250);
    await G.endTurn(S);
    await G.waitCounter(S, { timeout: 120000 });
  });
  await S.seg(f6, async () => {
    await S.sleep(500);
    await S.tap(opts().nth(0), { force: true });
  });
  await S.seg(f7, async () => { await S.badge(null); });
}
module.exports = { id: 'counter', title: 'Counter sem confirmação', SEGS, run };
