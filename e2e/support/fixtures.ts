// `test` dos testes de ponta a ponta: igual ao do Playwright, mas falha se a página lançar um erro
// não tratado (o ErrorBoundary esconderia isso atrás de "Algo deu errado"). Quando um teste falha, o
// log mostra o endereço e as animações em andamento (um clique que espera o elemento parar de se mexer),
// ou avisa que a página caiu, já que o trace fica num artefato.

import { expect, type Page, test as base } from '@playwright/test';

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      let crashed = false;
      page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
      // O processo da página caiu (visto no WebKit do CI, na mesa): sem isso, aparece como um clique que não acontece.
      page.on('crash', () => {
        crashed = true;
        console.log(`[e2e] a página caiu (crash do navegador) em ${testInfo.titlePath.join(' › ')}`);
      });
      await use(errors);
      if (testInfo.status !== testInfo.expectedStatus) {
        console.log(`[e2e] ${testInfo.titlePath.join(' › ')}\n${crashed ? '  a página tinha caído' : await diagnose(page)}`);
      }
      expect(errors, 'erros não tratados na página').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Endereço e animações em andamento na página (alvo, nome, estado, repetições). */
async function diagnose(page: Page): Promise<string> {
  if (page.isClosed()) return '  (página fechada)';
  const animations = await page
    .evaluate(() =>
      document.getAnimations().map((a) => {
        const effect = a.effect as KeyframeEffect | null;
        const el = effect?.target as Element | null;
        const name = 'animationName' in a ? (a as CSSAnimation).animationName : 'transitionProperty' in a ? (a as CSSTransition).transitionProperty : a.id;
        const timing = effect?.getComputedTiming();
        return `${el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : '?'} ${name} ${a.playState} iterações=${timing?.iterations}`;
      }),
    )
    .catch((e: Error) => [`(falhou: ${e.message})`]);
  return [`  url: ${page.url()}`, `  animações (${animations.length}):`, ...animations.slice(0, 40).map((a) => `    ${a}`)].join('\n');
}
