// Vídeo 7: trailer (partida, importação, montagem e torneio ao vivo).
const G = require('../lib/game.cjs');
const { setup, call } = require('../lib/tour.cjs');
const LIST = '1xOP09-001\n4xOP09-006\n4xOP09-010\n4xOP09-011\n4xOP09-012\n2xOP09-013\n4xOP09-014\n4xOP09-015\n4xOP09-016\n4xOP09-020\n2xST23-001\n2xST23-002\n4xST23-003\n4xST23-004\n4xST23-005';
const SEGS = [
  { id: 't1', say: 'GumGum Fight: o One Piece Card Game direto no navegador, no celular ou no computador.', caption: '', min: 5.5 },
  { id: 't2', say: 'Treine contra o bot, ou jogue online: partidas casuais, ranqueadas, ou em salas com os amigos.', caption: 'Contra o bot ou online ⚔️', min: 12 },
  { id: 't3', say: 'Já tem um deck? Cole a lista e importe. O Líder e as cartas são reconhecidos na hora.', caption: 'Importe seu deck em segundos 📋', min: 9 },
  { id: 't4', say: 'Ou monte do zero: escolha o Líder e toque nas cartas do catálogo. A curva de custo e a validação aparecem enquanto você monta.', caption: 'Monte do zero, com curva e validação 🛠️', min: 13 },
  { id: 't5', say: 'E tem torneios da comunidade, com rodadas, relógio e lobby ao vivo. Os jogadores confirmam que estão prontos, o organizador inicia a rodada.', caption: 'Torneios com lobby ao vivo 🏆', min: 12 },
  { id: 't6', say: 'E as mesas vão sendo preenchidas em tempo real, conforme cada um entra na sua sala.', caption: 'Mesas sendo preenchidas em tempo real', min: 10 },
  { id: 't7', say: 'GumGum Fight. Monte sua tripulação e venha jogar!', caption: '', min: 4.5 },
];
async function prepare() {
  const T = await setup({ name: 'Copa GumGum' });
  await call(T.org.tok, 'POST', `/api/tournaments/${T.id}/start`, { begin: false });
  const lobby = await call(T.org.tok, 'GET', `/api/tournaments/${T.id}/lobby`);
  T.tables = lobby.tables;
  T.tok = Object.fromEntries(T.players.map((p) => [p.id, p.tok]));
  return T;
}
const TITLE = `<img src="/icons/app-icon-192.png"><div class="k">ONE PIECE CARD GAME NO NAVEGADOR</div><div class="h">GUMGUM FIGHT</div><div class="s">Partidas · Decks · Torneios</div>`;
const END = `<img src="/icons/app-icon-192.png"><div class="h">GUMGUM FIGHT</div><div class="s">Monte sua tripulação e venha jogar!</div><div class="u">gumgumfight.app</div>`;

async function run(S) {
  const [t1, t2, t3, t4, t5, t6, t7] = SEGS;
  const T = S.prepared;
  await S.page.evaluate(() => window.$title('Trailer'));
  await S.card(TITLE);
  await S.seg(t1, async () => { await S.sleep(300); });
  await S.seg(t2, async () => {
    await S.card(null);
    await S.sleep(600);
    await G.chooseFirst(S, 'Você');
    await S.tap(S.role('button', { name: 'Batalhar!' }));
    await G.keepHand(S);
    await S.tap(S.role('button', { name: 'Auto' }), { force: true });
  });
  await S.seg(t3, async () => {
    await S.reloadApp('/');
    await S.sleep(1200);
    await S.tap(S.role('button', { name: 'Montar decks' }).first());
    await S.tap(S.role('button', { name: 'Importar lista' }));
    await S.sleep(400);
    await S.tap(S.$('textarea'));
    await S.$('textarea').fill(LIST);
    await S.sleep(1300);
    await S.tap(S.role('button', { name: /Importar \d+ cartas/ }));
    await S.sleep(500);
    await S.tap(S.role('button', { name: /\/50/ }));
  });
  await S.seg(t4, async () => {
    await S.tap(S.role('button', { name: 'Decks' }));
    await S.tap(S.role('button', { name: /Novo deck/ }));
    await S.sleep(700);
    await S.tap(S.$('.grid-cell').filter({ hasText: 'OP01-001' }).first().locator('.card'));
    await S.sleep(700);
    const idx = await S.$('.grid-cell').evaluateAll((els) => els.map((e, i) => (/dim/.test(e.querySelector('.card')?.className ?? '') || /leader/i.test(e.innerText) ? -1 : i)).filter((i) => i >= 0).slice(0, 7));
    for (const i of idx) {
      const c = S.$('.grid-cell').nth(i).locator('.card');
      await S.tap(c, { after: 220 });
      await S.tap(c, { after: 220 });
    }
    await S.tap(S.role('button', { name: /\/50/ }));
    await S.sleep(500);
    await S.tap(S.role('button', { name: /Grade/ }));
  });
  await S.seg(t5, async () => {
    await S.ctx.addCookies([{ name: 'gg_session', value: T.org.tok, domain: 'localhost', path: '/' }]);
    await S.reloadApp(`/?torneio=${T.id}&lobby=1`);
    await S.sleep(2500);
    for (const m of T.tables) for (const s of ['p1', 'p2']) {
      await call(T.tok[m[s].userId], 'PUT', `/api/tournaments/${T.id}/matches/${m.id}/ready`, { ready: true });
      await S.sleep(450);
    }
    await S.sleep(2600);
    await S.scrollBy(-400);
    await S.tap(S.role('button', { name: /Iniciar rodada/ }));
    const ok = S.role('button', { name: /^(Iniciar|Confirmar|Sim)/ }).last();
    if (await ok.isVisible().catch(() => false)) await S.tap(ok);
  });
  await S.seg(t6, async () => {
    for (const [k, m] of T.tables.entries()) {
      for (const s of ['p1', 'p2']) {
        await call(T.tok[m[s].userId], 'POST', `/api/tournaments/${T.id}/matches/${m.id}/play`, {});
        await S.sleep(1000);
      }
      if (k >= 1) await S.scrollBy(190);
    }
  });
  await S.card(END);
  await S.cap('');
  await S.seg(t7);
}
module.exports = { id: 'trailer', title: 'Trailer', SEGS, run, prepare };
