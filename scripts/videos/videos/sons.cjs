// Vídeo 4: música e efeitos sonoros (o som do vídeo segue os controles do app).
const G = require('../lib/game.cjs');
const SEGS = [
  { id: 'd1', say: 'O GumGum Fight tem trilha sonora original e efeitos para cada jogada. E você controla os dois separadamente.', caption: 'Música e efeitos com controles separados 🎵', min: 9 },
  { id: 'd2', say: 'Durante a partida, abra o menu da mesa e desça até Efeitos sonoros e Música.', caption: 'Menu da partida → <b>Efeitos sonoros</b> e <b>Música</b>' },
  { id: 'd3', say: 'Arraste a barra da música para baixar ou aumentar o volume.', caption: 'Arraste a barra para ajustar o volume' },
  { id: 'd4', say: 'Toque no alto-falante para silenciar na hora. Tocando de novo, o som volta no volume de antes.', caption: 'Toque no <b>🔊</b> para silenciar' },
  { id: 'd5', say: 'Os efeitos sonoros funcionam do mesmo jeito: cartas, DON, ataques, dados e o resultado da partida.', caption: 'Efeitos: cartas, DON!!, ataques e dados' },
  { id: 'd6', say: 'Por exemplo: música desligada e só os efeitos ligados.', caption: 'Exemplo: só os efeitos 🔈', min: 8 },
  { id: 'd7', say: 'Na tela inicial, os mesmos controles ficam em Configurações, no menu. A escolha fica salva neste aparelho.', caption: 'Também em <b>☰ Menu → Configurações</b>' },
];
/** Arrasta um controle deslizante (range) até a fração `to`, aos poucos. */
async function drag(S, input, to, steps = 18) {
  const box = await input.boundingBox();
  const val = Number(await input.inputValue()) / 100;
  const pad = 8;
  const x = (f) => box.x + pad + (box.width - 2 * pad) * f;
  const y = box.y + box.height / 2;
  const m = S.page.mouse;
  await m.move(x(val), y); await m.down();
  for (let i = 1; i <= steps; i++) { await m.move(x(val + (to - val) * (i / steps)), y); await S.sleep(35); }
  await m.up();
  await S.sleep(300);
}
async function run(S) {
  const [d1, d2, d3, d4, d5, d6, d7] = SEGS;
  const vol = (i) => S.$('.volume-setting input[type=range]').nth(i);
  const mute = (i) => S.$('.volume-setting .volume-mute').nth(i);
  await S.seg(d1, async () => {
    await S.sleep(300);
    await G.chooseFirst(S, 'Você');
    await S.tap(S.role('button', { name: 'Batalhar!' }));
    await G.keepHand(S);
    await S.tap(S.role('button', { name: 'Auto' }), { force: true });
  });
  await S.seg(d2, async () => {
    await G.gameMenu(S);
    await S.scrollTo(S.$('.volume-setting').last());
  });
  await S.seg(d3, async () => { await drag(S, vol(1), 0.12); await S.sleep(1400); await drag(S, vol(1), 0.75); });
  await S.seg(d4, async () => { await S.sleep(500); await S.tap(mute(1)); await S.sleep(2600); await S.tap(mute(1)); });
  await S.seg(d5, async () => { await drag(S, vol(0), 0.35); await S.sleep(700); await drag(S, vol(0), 0.9); });
  await S.seg(d6, async () => { await S.tap(mute(1)); await S.sleep(800); await G.closeSheet(S); });
  await S.seg(d7, async () => {
    await G.gameMenu(S);
    await S.tap(S.role('button', { name: /Sair para o menu/ }), { force: true });
    await S.sleep(800);
    await S.tap(S.role('button', { name: 'Abrir menu' }));
    await S.tap(S.role('button', { name: 'Configurações' }).first());
    await S.scrollTo(S.$('.option-row').filter({ hasText: 'Música' }).first());
  });
}
module.exports = { id: 'sons', title: 'Sons e música', SEGS, run };
