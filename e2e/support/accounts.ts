// Login dos testes: a conta e a sessão são criadas direto no banco temporário (account-cli.ts, com as
// funções do servidor) e o cookie de sessão vai para o navegador. Nenhuma rota de teste na produção.

import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DB_PATH, ROOT } from './paths';

/** Os perfis de `apps/server/src/auth/store.ts` (ROLES). */
export type Role = 'player' | 'streamer' | 'organizer' | 'admin' | 'dev';

/** Cria a conta `name` (com o perfil, se dado) e deixa o navegador da página logado nela. */
export async function login(page: Page, name: string, role?: Role): Promise<{ userId: string }> {
  const cli = join(ROOT, 'e2e/support/account-cli.ts');
  const out = execFileSync('npx', ['tsx', cli, DB_PATH, name, ...(role ? [role] : [])], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const { userId, token } = JSON.parse(out.toString()) as { userId: string; token: string };
  // O mesmo cookie que o login com o Google grava (auth/routes.ts).
  await page.context().addCookies([{ name: 'gg_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  return { userId };
}
