// Vídeo 1: como alterar o apelido.
const G = require('../lib/game.cjs');
const SEGS = [
  { id: 'a1', say: 'Quer mudar o nome que aparece para os seus oponentes no GumGum Fight? É rapidinho!', caption: 'Mude o nome que os oponentes veem' },
  { id: 'a2', say: 'Na tela inicial, toque no botão Apelido, logo abaixo do título.', caption: 'Toque em <b>Apelido ✎</b> na tela inicial' },
  { id: 'a3', say: 'As configurações abrem com o campo Apelido no topo. Apague o nome atual e digite o novo, com duas a vinte e quatro letras.', caption: 'Digite o novo apelido (2 a 24 letras)' },
  { id: 'a4', say: 'Agora é só tocar em Salvar.', caption: 'Toque em <b>Salvar</b>' },
  { id: 'a5', say: 'Feche a janela e pronto: o novo apelido já aparece na tela inicial.', caption: 'Pronto! O apelido já aparece no início' },
  { id: 'a6', say: 'E é esse nome que o seu oponente vê nas partidas online, contra o bot e no ranking.', caption: 'É o nome que o oponente vê nas partidas' },
  { id: 'a7', say: 'Dá para trocar também no menu da partida, ou nas Configurações do menu principal. Bons jogos!', caption: 'Também no <b>menu da partida</b> e em <b>Configurações</b>' },
];
async function run(S) {
  const [a1, a2, a3, a4, a5, a6, a7] = SEGS;
  await S.seg(a1, async () => { await S.sleep(600); });
  await S.seg(a2, async () => { await S.sleep(900); await S.tap(S.$('.nickname-link')); });
  await S.seg(a3, async () => {
    const input = S.$('.settings-sheet .nickname input');
    await S.sleep(800);
    await input.click();
    await input.press('Control+A'); await input.press('Backspace');
    await S.sleep(300);
    await S.type(input, 'Capitão Gum', 110);
  });
  await S.seg(a4, async () => { await S.tap(S.$('.settings-sheet .nickname button[type=submit]')); });
  await S.seg(a5, async () => { await S.sleep(500); await S.tap(S.$('.settings-sheet .zoom-close')); });
  await S.seg(a6, async () => {
    await G.chooseFirst(S, 'Bot');
    await S.tap(S.role('button', { name: 'Batalhar!' }));
    await G.keepHand(S);
    await S.sleep(2200);
  });
  await S.seg(a7, async () => {
    await G.gameMenu(S);
    await S.scrollTo(S.$('.nickname-setting'));
  });
}
module.exports = { id: 'apelido', title: 'Como mudar o apelido', SEGS, run };
