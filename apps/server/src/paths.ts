import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(here, '../../..');
// Em produção (bundle em release/), DATA_DIR e WEB_DIST vêm de variáveis de ambiente.
export const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
export const WEB_DIST = process.env.WEB_DIST ?? join(ROOT, 'apps/web/dist');
/** Pasta onde o usuário rodou o comando (o npm troca o cwd ao entrar no workspace). */
export const USER_CWD = process.env.INIT_CWD ?? process.cwd();
export const fromUserCwd = (p: string) => (isAbsolute(p) || p === ':memory:' ? p : resolve(USER_CWD, p));

export const DB_PATH = process.env.DB_PATH ? fromUserCwd(process.env.DB_PATH) : join(ROOT, 'apps/server/var/gumgum.db');
