// `test` dos testes de ponta a ponta: igual ao do Playwright, mas falha se a página lançar um erro
// não tratado (o ErrorBoundary esconderia isso atrás de "Algo deu errado").

import { expect, test as base } from '@playwright/test';

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
      await use(errors);
      expect(errors, 'erros não tratados na página').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
