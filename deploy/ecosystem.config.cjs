// Configuração do pm2 para o GumGum Fight na VM.
// Lida a cada deploy (pm2 startOrReload), a partir do release recém-ativado.
// Porta, Node e opções vêm de <APP_DIR>/shared/deploy.env, criado por deploy/setup-vm.sh.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const APP_DIR = process.env.GUMGUM_APP_DIR || path.join(os.homedir(), 'apps', 'gumgumfight');
const SHARED = path.join(APP_DIR, 'shared');
// Caminho estável via symlink "current": o pm2 guarda este caminho e, a cada
// reload, o Node resolve o symlink para o release ativo naquele momento.
// (O pm2 não troca o caminho do script num reload, então ele não pode ser o do release.)
const RELEASE = path.join(APP_DIR, 'current');

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv(path.join(SHARED, 'deploy.env'));

module.exports = {
  apps: [
    {
      name: 'gumgumfight',
      cwd: RELEASE,
      script: path.join(RELEASE, 'server', 'index.mjs'),
      interpreter: env.NODE_BIN || 'node',
      node_args: '--disable-warning=ExperimentalWarning',
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      time: true,
      env: {
        NODE_ENV: 'production',
        // 127.0.0.1 (Nginx no host) ou 0.0.0.0 (Nginx Proxy Manager em Docker, protegido pelo firewall)
        HOST: env.HOST || '127.0.0.1',
        PORT: env.PORT || '3310',
        DB_PATH: path.join(SHARED, 'gumgum.db'),
        WEB_DIST: path.join(RELEASE, 'web'),
        DATA_DIR: path.join(RELEASE, 'data'),
        CARD_IMAGES: env.CARD_IMAGES || 'on',
      },
    },
  ],
};
