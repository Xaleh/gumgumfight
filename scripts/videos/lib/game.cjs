// Ajudas da mesa (partida contra o bot e online).
async function chooseFirst(S, who) {
  await S.scrollTo(S.role('button', { name: 'Batalhar!' }));
  await S.tap(S.role('button', { name: who, exact: true }).last(), { after: 250 });
}
/** Sorteio com dados: joga e segue (ganhando, escolhe jogar primeiro). */
async function dice(S, { roll = true } = {}) {
  if (roll) await S.tap(S.role('button', { name: /Jogar dados/ }), { timeout: 20000 });
  const next = S.role('button', { name: /^(Continuar|Jogar primeiro)$/ }).first();
  await next.waitFor({ timeout: 30000 });
  await S.sleep(900);
  await S.tap(next);
}
async function keepHand(S) {
  await S.tap(S.role('button', { name: 'Manter mão' }), { timeout: 30000 });
}
async function gameMenu(S) {
  await S.tap(S.role('button', { name: 'Menu da partida' }), { force: true, after: 700 });
}
async function closeSheet(S) {
  await S.tap(S.$('.sheet .zoom-close, .sheet-head button[aria-label="Fechar"]').first(), { force: true, after: 500 });
}
/** Marca/desmarca uma opção (checkbox) do menu da partida pelo texto. */
async function toggleCheck(S, label) {
  const l = S.$('label.check').filter({ hasText: label }).first();
  await S.scrollTo(l);
  await S.tap(l, { force: true });
}
async function endTurn(S) {
  const b = S.role('button', { name: /Encerrar/ });
  await b.waitFor({ timeout: 60000 });
  await S.tap(b, { force: true });
}
/** Espera a etapa de Counter, resolvendo sozinho o que aparecer antes (Trigger, Blocker...). */
async function waitCounter(S, { timeout = 90000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await S.text('ETAPA DE COUNTER').isVisible().catch(() => false)) return true;
    const end = S.role('button', { name: /Encerrar/ });
    if (await end.isEnabled().catch(() => false) && await S.$('.hand-card .card.hl-playable, .end-turn.ready').count().catch(() => 0) >= 0) {
      // nada
    }
    for (const name of [/^Não usar$/, /^Não ativar/, /^Não bloquear/, /^Pular$/]) {
      const b = S.role('button', { name }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ force: true }).catch(() => {}); break; }
    }
    await S.sleep(300);
  }
  return false;
}
module.exports = { chooseFirst, dice, keepHand, gameMenu, closeSheet, toggleCheck, endTurn, waitCounter };
