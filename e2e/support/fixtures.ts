// `test` dos testes de ponta a ponta: igual ao do Playwright, mas falha se uma página lançar um erro
// não tratado (o ErrorBoundary esconderia isso atrás de "Algo deu errado"). Quando um teste falha, o
// log mostra o endereço e as animações em andamento (um clique que espera o elemento parar de se mexer),
// ou avisa que a página caiu, já que o trace fica num artefato.
//
// `newPlayer()` abre mais um navegador (outro contexto: outro dono de navegador, outros cookies), com as
// mesmas opções do projeto (tela, idioma, toque), para os fluxos com dois jogadores.

import { type BrowserContextOptions, expect, type Page, test as base, type TestInfo } from '@playwright/test';

interface Watched {
  page: Page;
  errors: string[];
  crashed: boolean;
}

/** Guarda os erros não tratados e a queda da página. */
function watch(page: Page, label: string, testInfo: TestInfo): Watched {
  const w: Watched = { page, errors: [], crashed: false };
  page.on('pageerror', (e) => w.errors.push(`${label}: ${e.stack ?? e.message}`));
  // O processo da página caiu (visto no WebKit do CI, na mesa): sem isso, aparece como um clique que não acontece.
  page.on('crash', () => {
    w.crashed = true;
    console.log(`[e2e] a página ${label} caiu (crash do navegador) em ${testInfo.titlePath.join(' › ')}`);
  });
  return w;
}

/** No fim do teste: o diagnóstico, se falhou, e nenhum erro não tratado em nenhuma página. */
async function settle(watched: Watched[], testInfo: TestInfo) {
  if (testInfo.status !== testInfo.expectedStatus) {
    const lines = [];
    for (const [i, w] of watched.entries()) lines.push(`  página ${i + 1}:`, w.crashed ? '    caiu' : await diagnose(w.page));
    console.log(`[e2e] ${testInfo.titlePath.join(' › ')}\n${lines.join('\n')}`);
  }
  expect(watched.flatMap((w) => w.errors), 'erros não tratados na página').toEqual([]);
}

/** As opções de contexto do projeto (iPhone, desktop…), para os navegadores a mais. */
function projectContext(testInfo: TestInfo): BrowserContextOptions {
  const use = testInfo.project.use;
  const keys = ['baseURL', 'locale', 'timezoneId', 'viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'serviceWorkers'] as const;
  return Object.fromEntries(keys.filter((k) => use[k] !== undefined).map((k) => [k, use[k]])) as BrowserContextOptions;
}

export const test = base.extend<{ pageErrors: string[]; newPlayer: () => Promise<Page> }>({
  pageErrors: [
    async ({ page }, use, testInfo) => {
      const w = watch(page, '1', testInfo);
      await use(w.errors);
      await settle([w], testInfo);
    },
    { auto: true },
  ],
  newPlayer: async ({ browser }, use, testInfo) => {
    const watched: Watched[] = [];
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async () => {
      const context = await browser.newContext(projectContext(testInfo));
      contexts.push(context);
      const page = await context.newPage();
      watched.push(watch(page, String(watched.length + 2), testInfo));
      return page;
    });
    await settle(watched, testInfo);
    for (const c of contexts) await c.close();
  },
});

export { expect };

/** Endereço e animações em andamento na página (alvo, nome, estado, repetições). */
async function diagnose(page: Page): Promise<string> {
  if (page.isClosed()) return '    (página fechada)';
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
  return [`    url: ${page.url()}`, `    animações (${animations.length}):`, ...animations.slice(0, 40).map((a) => `      ${a}`)].join('\n');
}
