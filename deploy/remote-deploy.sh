#!/usr/bin/env bash
# Ativa um release na VM. Chamado pelo GitHub Actions a cada deploy:
#   bash <release>/deploy/remote-deploy.sh <diretório do release>
# Variável opcional: IMPORT_SETS="ST-01 ST-02" importa cartas da optcgapi depois do deploy.
# Variável opcional: GOOGLE_CLIENT_ID (login com Google) é gravado em shared/deploy.env.
set -euo pipefail

RELEASE_DIR="$(cd "${1:?informe o diretório do release}" && pwd -P)"
APP_DIR="${GUMGUM_APP_DIR:-$HOME/apps/gumgumfight}"
SHARED="$APP_DIR/shared"
ENV_FILE="$SHARED/deploy.env"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERRO: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "Falta $ENV_FILE. Rode deploy/setup-vm.sh na VM primeiro."

# Client ID vindo do GitHub (vars.GOOGLE_CLIENT_ID): fica salvo para os próximos reloads do pm2.
NEW_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
if [ -n "$NEW_GOOGLE_CLIENT_ID" ]; then
  [[ "$NEW_GOOGLE_CLIENT_ID" =~ ^[A-Za-z0-9.-]+$ ]] || die "GOOGLE_CLIENT_ID inválido."
  { grep -v '^GOOGLE_CLIENT_ID=' "$ENV_FILE" || true; echo "GOOGLE_CLIENT_ID=$NEW_GOOGLE_CLIENT_ID"; } > "$ENV_FILE.tmp"
  mv -f "$ENV_FILE.tmp" "$ENV_FILE"
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
PORT="${PORT:-3310}"
case "${HOST:-127.0.0.1}" in 0.0.0.0 | 127.0.0.1 | "") CHECK_HOST=127.0.0.1 ;; *) CHECK_HOST="$HOST" ;; esac
NODE_BIN="${NODE_BIN:-node}"
PM2_BIN="${PM2_BIN:-pm2}"
# O pm2 é um script Node: garante que o Node dele esteja no PATH (instalações via nvm).
export PATH="$(dirname "$PM2_BIN"):$PATH"

"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "$NODE_BIN é $("$NODE_BIN" -v); o GumGum Fight precisa de Node >= 22.13."

if [ -n "${IMPORT_SETS:-}" ] && ! [[ "$IMPORT_SETS" =~ ^[A-Za-z0-9\ -]+$ ]]; then
  die "IMPORT_SETS inválido: $IMPORT_SETS"
fi

PREVIOUS="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
log "Ativando $(cat "$RELEASE_DIR/VERSION" 2>/dev/null || basename "$RELEASE_DIR")"

activate() {
  ln -sfn "$1" "$APP_DIR/current.tmp"
  mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
  "$PM2_BIN" startOrReload "$1/deploy/ecosystem.config.cjs" --update-env >/dev/null
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS "http://$CHECK_HOST:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

activate "$RELEASE_DIR"
if ! healthy; then
  log "A nova versão não respondeu em /api/health. Últimas linhas do log:"
  "$PM2_BIN" logs gumgumfight --lines 40 --nostream || true
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE_DIR" ]; then
    log "Voltando para a versão anterior: $PREVIOUS"
    activate "$PREVIOUS"
    healthy && log "Versão anterior restaurada." || log "A versão anterior também não respondeu!"
  fi
  die "Deploy falhou."
fi
"$PM2_BIN" save >/dev/null
log "Online em $CHECK_HOST:$PORT"

if [ -n "${IMPORT_SETS:-}" ]; then
  log "Importando cartas: $IMPORT_SETS"
  # shellcheck disable=SC2086  # separação em palavras é intencional (lista de coleções)
  if ! DB_PATH="$SHARED/gumgum.db" "$NODE_BIN" --disable-warning=ExperimentalWarning \
    "$RELEASE_DIR/server/import-cards.mjs" $IMPORT_SETS; then
    log "AVISO: a importação de cartas falhou (o site continua no ar com as cartas anteriores)."
  fi
fi

# Mantém só os últimos releases (nunca apaga o ativo).
ACTIVE="$(readlink -f "$APP_DIR/current")"
find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP_RELEASES + 1))" \
  | cut -d' ' -f2- | while read -r old; do
    [ "$(readlink -f "$old")" = "$ACTIVE" ] || rm -rf "$old"
  done
find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -name '*.tgz' -delete
log "Deploy concluído."
