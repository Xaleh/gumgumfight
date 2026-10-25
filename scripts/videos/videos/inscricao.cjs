// Vídeo 8: inscrição num torneio, escolha do deck e check-in.
const { setup } = require('../lib/tour.cjs');
const SEGS = [
  { id: 'i1', say: 'Quer participar de um torneio no GumGum Fight? A inscrição é feita com a sua conta Google: entre com ela pelo menu.', caption: 'Inscrição com a conta Google (menu ☰)' },
  { id: 'i2', say: 'Na tela inicial, toque em Ver torneios e escolha um torneio com as inscrições abertas.', caption: 'Toque em <b>Ver torneios</b>' },
  { id: 'i3', say: 'A página do torneio mostra o formato, a data de início, o check-in e quantos jogadores já se inscreveram.', caption: 'Formato, início e inscritos' },
  { id: 'i4', say: 'Na parte de Inscrição, toque em Escolher deck. Dá para usar um dos seus decks, um favorito ou um deck pronto.', caption: 'Toque em <b>Escolher deck</b>' },
  { id: 'i5', say: 'Toque no deck e confirme em Usar este deck. Se ele não valer no formato do torneio, o app avisa.', caption: 'Escolha e toque em <b>Usar este deck</b>' },
  { id: 'i6', say: 'Agora é só tocar em Inscrever-se. Pronto: o seu nome já aparece na lista de inscritos.', caption: 'Toque em <b>Inscrever-se</b> ✅', min: 8 },
  { id: 'i7', say: 'Atenção: a lista do deck fica congelada como estava na inscrição. Se mudar o deck depois, inscreva de novo com Trocar deck.', caption: 'Mudou o deck? Use <b>Trocar deck</b>' },
  { id: 'i8', say: 'Quando o check-in abrir, toque em Fazer check-in para confirmar a presença. Sem ele, você pode perder por W.O.', caption: 'Toque em <b>Fazer check-in</b>' },
  { id: 'i9', say: 'Na hora do torneio, a sua sala aparece nesta página e na tela inicial. Boa sorte!', caption: 'A sala aparece aqui e na tela inicial. Boa sorte! 🏆' },
];
async function beforeLoad(ctx) {
  const T = await setup({ name: 'Copa GumGum', checkIn: true, me: 'CapitaoGum' });
  await ctx.addCookies([{ name: 'gg_session', value: T.me.tok, domain: 'localhost', path: '/' }]);
  ctx.__tour = T;
}
async function run(S) {
  const [i1, i2, i3, i4, i5, i6, i7, i8, i9] = SEGS;
  await S.seg(i1, async () => {
    await S.sleep(900);
    await S.tap(S.role('button', { name: 'Abrir menu' }));
    await S.sleep(1800);
    await S.tap(S.role('button', { name: 'Fechar menu' }), { force: true });
  });
  await S.seg(i2, async () => {
    await S.scrollTo(S.role('button', { name: 'Ver torneios' }));
    await S.tap(S.role('button', { name: 'Ver torneios' }));
    await S.sleep(700);
    await S.tap(S.text('Copa GumGum').first());
  });
  await S.seg(i3, async () => { await S.sleep(600); });
  await S.seg(i4, async () => {
    const pick = S.$('button').filter({ hasText: 'Escolher deck' }).first();
    await S.scrollTo(pick);
    await S.tap(pick);
    await S.sleep(900);
    await S.tap(S.$('button').filter({ hasText: 'Meus decks' }).first());
  });
  await S.seg(i5, async () => {
    const tile = S.$('button').filter({ hasText: 'Shanks do Capitão' }).first();
    await S.scrollTo(tile);
    await S.sleep(500);
    await S.tap(tile);
    await S.sleep(700);
    await S.tap(S.role('button', { name: 'Usar este deck' }));
  });
  await S.seg(i6, async () => {
    await S.sleep(500);
    await S.tap(S.role('button', { name: 'Inscrever-se' }));
    await S.sleep(1500);
    await S.scrollTo(S.text('CapitaoGum').last());
  });
  await S.seg(i7, async () => {
    await S.scrollTo(S.text('Sua inscrição', { exact: false }).first(), 'start');
  });
  await S.seg(i8, async () => { await S.sleep(500); await S.tap(S.role('button', { name: /Fazer check-in/ })); });
  await S.seg(i9);
}
module.exports = { id: 'inscricao', title: 'Inscrição em torneio', SEGS, run, beforeLoad };
