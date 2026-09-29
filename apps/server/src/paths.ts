import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(here, '../../..');
export const DATA_DIR = join(ROOT, 'data');
export const WEB_DIST = join(ROOT, 'apps/web/dist');
export const DB_PATH = process.env.DB_PATH ?? join(ROOT, 'apps/server/var/gumgum.db');
