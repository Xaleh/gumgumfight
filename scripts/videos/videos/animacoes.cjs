// Vídeo 2: animações ligadas e desligadas.
const G = require('../lib/game.cjs');
const SEGS = [
  { id: 'b1', say: 'Vamos ver a diferença que as animações fazem na mesa do GumGum Fight.', caption: 'Animações: ligadas ou desligadas?' },
  { id: 'b2', say: 'Com elas ligadas, o sorteio de quem começa é feito com dados. Dá até para chacoalhar antes de jogar!', caption: 'Sorteio inicial com dados 🎲' },
  { id: 'b3', say: 'Na partida, as cartas voam pela mesa, os ataques ganham efeito, e uma faixa anuncia de quem é o turno.', caption: 'Cartas voando, ataques e faixa de turno', min: 14 },
  { id: 'b4', say: 'Prefere uma mesa mais rápida e leve? Abra o menu da partida e desmarque Animações.', caption: 'Menu da partida → desmarque <b>Animações</b>' },
  { id: 'b5', say: 'Pronto! Agora cada jogada aparece na hora, sem voo e sem faixa de turno. Ótimo para celulares mais simples, ou para quem gosta de jogar rápido.', caption: 'Sem animações: tudo aparece na hora', min: 14 },
  { id: 'b6', say: 'Essa opção também fica nas Configurações, no menu da tela inicial, e vale para todas as partidas.', caption: 'Também em <b>☰ Menu → Configurações</b>' },
];
async function run(S) {
  const [b1, b2, b3, b4, b5, b6] = SEGS;
  await S.badge('COM ANIMAÇÕES');
  await S.seg(b1, async () => {
    await S.sleep(800);
    await G.chooseFirst(S, 'Sorteio');
    await S.tap(S.role('button', { name: 'Batalhar!' }));
  });
  await S.seg(b2, async () => { await G.dice(S); await G.keepHand(S); });
  await S.seg(b3, async () => { await S.sleep(500); await S.tap(S.role('button', { name: 'Auto' }), { force: true }); });
  await S.seg(b4, async () => {
    await S.badge(null);
    await G.gameMenu(S);
    await G.toggleCheck(S, 'Animações');
    await S.sleep(600);
    await G.closeSheet(S);
  });
  await S.badge('SEM ANIMAÇÕES', 'off');
  await S.seg(b5);
  await S.seg(b6, async () => {
    await S.badge(null);
    await G.gameMenu(S);
    await S.tap(S.role('button', { name: /Sair para o menu/ }), { force: true });
    const confirm = S.role('button', { name: /^(Sair|Sim|Confirmar)/ }).first();
    if (await confirm.isVisible().catch(() => false)) await S.tap(confirm, { force: true });
    await S.sleep(800);
    await S.tap(S.role('button', { name: 'Abrir menu' }));
    await S.tap(S.role('button', { name: 'Configurações' }).first());
    await S.scrollTo(S.$('.option-row').filter({ hasText: 'Animações' }).first());
  });
}
module.exports = { id: 'animacoes', title: 'Animações na mesa', SEGS, run };
