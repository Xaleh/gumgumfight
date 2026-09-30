#!/usr/bin/env bash
# Monta release/: um pacote autocontido que só precisa de Node >= 22.13 para rodar.
#   node release/server/index.mjs        (com DB_PATH, WEB_DIST e DATA_DIR definidos)
# Não há módulos nativos, então o mesmo pacote roda em x64 e ARM (VM da Oracle).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf release
npm run build -w @gumgum/web

npx esbuild \
  apps/server/src/index.ts apps/server/src/import-cards.ts apps/server/src/seed-cli.ts \
  --bundle --platform=node --target=node22 --format=esm \
  --outdir=release/server --out-extension:.js=.mjs \
  --banner:js="import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" \
  --log-level=warning

cp -r apps/web/dist release/web
cp -r data release/data
mkdir -p release/deploy
cp deploy/remote-deploy.sh deploy/ecosystem.config.cjs release/deploy/
(git rev-parse HEAD 2>/dev/null || echo dev) > release/VERSION

echo "release/ pronto ($(du -sh release | cut -f1))"
