// Vídeo 5: notificações (permissão e avisos simulados).
const { setup, call } = require('../lib/tour.cjs');
const SEGS = [
  { id: 'e1', say: 'Com as notificações ligadas, o GumGum Fight te avisa no celular, mesmo com o app fechado.', caption: 'Avisos no celular, mesmo com o app fechado 🔔' },
  { id: 'e2', say: 'Abra o menu, toque em Configurações e ligue a opção Notificações.', caption: '☰ Menu → Configurações → <b>Notificações</b>' },
  { id: 'e3', say: 'O navegador vai pedir permissão. Toque em Permitir.', caption: 'Toque em <b>Permitir</b>' },
  { id: 'e4', say: 'Depois, escolha o que quer receber. Partidas online: quando o oponente entra na sala e quando chega a sua vez. E torneios: check-in aberto, rodada nova e oponente esperando por você.', caption: 'Escolha: <b>Partidas online</b> e <b>Torneios</b>' },
  { id: 'e5', say: 'Veja um exemplo simulado de como os avisos chegam, com o app fechado.', caption: 'Exemplo simulado 👇', min: 13 },
  { id: 'e6', say: 'Tocando no aviso, o app abre direto na partida, ou na página do torneio.', caption: 'Toque no aviso e vá direto ao ponto' },
  { id: 'e7', say: 'No iPhone, as notificações funcionam com o app instalado na tela de início. Veja a opção Instalar o app, nas configurações.', caption: 'iPhone: instale o app na tela de início 📲' },
];
// Push simulado: o navegador de teste não tem serviço de push.
const PUSH_MOCK = `(() => {
  if (location.pathname === '/__frame.html') return;
  let subscribed = !!sessionStorage.getItem('__perm');
  const sub = { endpoint: 'https://push.example/demo', options: { applicationServerKey: null },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'demo', auth: 'demo' } }; }, unsubscribe: async () => { subscribed = false; return true; } };
  const reg = { pushManager: { getSubscription: async () => (subscribed ? sub : null), subscribe: async () => { subscribed = true; return sub; } } };
  try { Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg) }); } catch {}
  let perm = sessionStorage.getItem('__perm') || 'default';
  try { Object.defineProperty(Notification, 'permission', { get: () => perm, configurable: true }); } catch {}
  Notification.requestPermission = async () => { perm = await window.parent.$perm(); sessionStorage.setItem('__perm', perm); return perm; };
})();`;
async function beforeLoad(ctx) {
  await ctx.addInitScript(PUSH_MOCK);
  await ctx.route('**/api/push/subscription', (r) => r.fulfill({ status: 204, body: '' }));
}
async function prepare() {
  const T = await setup({ name: 'Copa GumGum' });
  await call(T.org.tok, 'POST', `/api/tournaments/${T.id}/start`, { begin: true });
  return T;
}
async function run(S) {
  const [e1, e2, e3, e4, e5, e6, e7] = SEGS;
  const T = S.prepared;
  await S.seg(e1, async () => { await S.sleep(500); });
  await S.seg(e2, async () => {
    await S.tap(S.role('button', { name: 'Abrir menu' }));
    await S.tap(S.role('button', { name: 'Configurações' }).first());
    await S.scrollTo(S.$('.option-row').filter({ hasText: 'Notificações' }).first());
    await S.sleep(500);
    await S.tap(S.$('.option-row').filter({ hasText: 'Notificações' }).first().locator('.switch'));
  });
  await S.seg(e3, async () => { await S.sleep(1300); await S.tap(S.page.locator('#perm .allow')); });
  await S.seg(e4, async () => {
    await S.sleep(600);
    await S.scrollTo(S.$('.option-row').filter({ hasText: 'Torneios' }).first());
  });
  await S.seg(e5, async () => {
    await S.tap(S.$('.settings-sheet .zoom-close'));
    await S.lock(true);
    await S.sleep(1500);
    await S.note({ title: 'Partida encontrada!', body: 'NamiNavegadora entrou. Toque para jogar.', ms: 0 });
    await S.sleep(2800);
    await S.note({ title: 'Sua vez!', body: 'NamiNavegadora está esperando a sua jogada.', ms: 0 });
    await S.sleep(2800);
    await S.note({ title: 'Copa GumGum', body: 'O check-in está aberto: confirme sua presença antes do início.', ms: 0 });
    await S.sleep(2800);
    await S.note({ title: 'Copa GumGum', body: 'Rodada 1: a rodada começou! Entre na sala contra ZoroSemRumo.', ms: 0 });
  });
  await S.seg(e6, async () => {
    await S.sleep(800);
    await S.tap(S.page.locator('.note').first(), { force: true });
    await S.page.evaluate(() => window.$clearNotes());
    await S.reloadApp(`/?torneio=${T.id}`);
    await S.sleep(1200);
    await S.lock(false);
  });
  await S.seg(e7, async () => {
    await S.tap(S.role('button', { name: /Menu/ }).first());
    await S.sleep(600);
    await S.tap(S.role('button', { name: 'Abrir menu' }));
    await S.tap(S.role('button', { name: 'Configurações' }).first());
    await S.scrollTo(S.$('.option-row').filter({ hasText: 'Instalar o app' }).first());
  });
}
module.exports = { id: 'notificacoes', title: 'Notificações', SEGS, run, beforeLoad, prepare };
