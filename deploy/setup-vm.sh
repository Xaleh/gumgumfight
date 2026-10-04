#!/usr/bin/env bash
# Preparação única da VM para o GumGum Fight. Pode ser executado de novo sem problemas.
# Não altera os outros apps: não troca o Node padrão, não mexe em outros sites do Nginx.
#
# Uso (na VM, como o usuário que roda o pm2, ex.: ubuntu):
#   bash setup-vm.sh "ssh-ed25519 AAAA... github-actions-gumgumfight"
#
# Funciona com Nginx instalado no host ou com o Nginx Proxy Manager (Docker): detecta sozinho.
#
# Variáveis opcionais: DOMAIN (gumgumfight.duckdns.org), PORT (3310),
#   PROXY (auto | nginx | npm | none), CERTBOT_EMAIL (só no modo nginx), GUMGUM_APP_DIR.
set -euo pipefail

DOMAIN="${DOMAIN:-gumgumfight.duckdns.org}"
PORT="${PORT:-3310}"
APP_DIR="${GUMGUM_APP_DIR:-$HOME/apps/gumgumfight}"
DEPLOY_PUBKEY="${1:-}"

step() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}

# ---------------------------------------------------------------- pastas
step "Pastas em $APP_DIR"
mkdir -p "$APP_DIR/releases" "$APP_DIR/shared"
info "ok"

# ---------------------------------------------------------------- Node
step "Node >= 22.13 (só para o GumGum Fight)"
NODE_BIN=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
  info "Usando o Node já instalado: $NODE_BIN ($("$NODE_BIN" -v))"
else
  info "Node atual: $(node -v 2>/dev/null || echo 'não encontrado'). Instalando Node 22 via nvm, sem trocar o padrão."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    # PROFILE=/dev/null: não altera .bashrc; os outros apps continuam com o Node de sempre.
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash >/dev/null
  fi
  set +u
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  DEFAULT_BEFORE="$(nvm version default 2>/dev/null || true)"
  nvm install 22 --no-progress >/dev/null
  # Se já havia um Node padrão no nvm, mantém ele como padrão.
  if [ -n "$DEFAULT_BEFORE" ] && [ "$DEFAULT_BEFORE" != "N/A" ]; then nvm alias default "$DEFAULT_BEFORE" >/dev/null; fi
  NODE_BIN="$(nvm which 22)"
  set -u
  info "Instalado: $NODE_BIN ($("$NODE_BIN" -v))"
fi
node_ok "$NODE_BIN" || die "Não foi possível obter Node >= 22.13."

# ---------------------------------------------------------------- pm2
step "pm2"
PM2_BIN="$(command -v pm2 || true)"
if [ -z "$PM2_BIN" ]; then
  for f in "$HOME"/.nvm/versions/node/*/bin/pm2 /usr/local/bin/pm2 /usr/bin/pm2; do
    [ -x "$f" ] && PM2_BIN="$f" && break
  done
fi
[ -n "$PM2_BIN" ] || die "pm2 não encontrado. Rode este script na mesma conta que já usa o pm2."
info "Usando $PM2_BIN"

# ---------------------------------------------------------------- porta
step "Porta $PORT"
if ss -ltnH "( sport = :$PORT )" 2>/dev/null | grep -q .; then
  if "$PM2_BIN" describe gumgumfight >/dev/null 2>&1; then
    info "Em uso pelo próprio GumGum Fight (ok)."
  else
    die "A porta $PORT já está em uso por outro programa. Rode de novo com PORT=<outra porta>."
  fi
else
  info "Livre."
fi

# ---------------------------------------------------------------- chave de deploy
# Vem antes do proxy: assim o acesso do GitHub Actions fica pronto mesmo se o resto precisar de ajuste.
step "Chave SSH do GitHub Actions"
if [ -n "$DEPLOY_PUBKEY" ]; then
  [[ "$DEPLOY_PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\  ]] || die "O argumento não parece uma chave pública SSH."
  install -m 700 -d "$HOME/.ssh"
  touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
  if grep -qF "$DEPLOY_PUBKEY" "$HOME/.ssh/authorized_keys"; then
    info "Já autorizada."
  else
    printf '%s\n' "$DEPLOY_PUBKEY" >> "$HOME/.ssh/authorized_keys"
    info "Adicionada a ~/.ssh/authorized_keys."
  fi
else
  info "Nenhuma chave informada (pulei). Passe a chave pública como argumento para autorizá-la."
fi

# ---------------------------------------------------------------- proxy reverso
step "Proxy reverso"
docker_cmd() { if docker info >/dev/null 2>&1; then docker "$@"; else sudo docker "$@"; fi; }
NPM_CONTAINER=""
if command -v docker >/dev/null 2>&1; then
  NPM_CONTAINER="$(docker_cmd ps --format '{{.Names}} {{.Image}}' 2>/dev/null \
    | awk 'tolower($2) ~ /nginx-proxy-manager/ {print $1; exit}' || true)"
fi
PROXY="${PROXY:-auto}"
if [ "$PROXY" = auto ]; then
  if [ -n "$NPM_CONTAINER" ]; then PROXY=npm
  elif command -v nginx >/dev/null 2>&1; then PROXY=nginx
  else PROXY=none; fi
fi
info "Modo: $PROXY${NPM_CONTAINER:+ (container: $NPM_CONTAINER)}"

BIND_HOST=127.0.0.1
FORWARD_HOST=127.0.0.1
if [ "$PROXY" = npm ]; then
  [ -n "$NPM_CONTAINER" ] || die "PROXY=npm, mas nenhum container do Nginx Proxy Manager está rodando."
  NET_MODE="$(docker_cmd inspect -f '{{.HostConfig.NetworkMode}}' "$NPM_CONTAINER")"
  if [ "$NET_MODE" = host ]; then
    info "O Nginx Proxy Manager usa a rede do host: basta apontar para 127.0.0.1."
  else
    # O container acessa a VM pelo gateway da rede Docker dele.
    NET_ID="$(docker_cmd inspect -f '{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}' "$NPM_CONTAINER" | awk '{print $1}')"
    FORWARD_HOST="$(docker_cmd network inspect -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' "$NET_ID" | awk '{print $1}')"
    SUBNET="$(docker_cmd network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$NET_ID" | awk '{print $1}')"
    [ -n "$FORWARD_HOST" ] && [ -n "$SUBNET" ] || die "Não consegui descobrir a rede Docker do $NPM_CONTAINER."
    BIND_HOST=0.0.0.0
    info "Rede Docker $SUBNET → o app vai escutar na porta $PORT e o proxy acessa via $FORWARD_HOST."
    # Imagens Ubuntu da Oracle rejeitam no iptables tudo que não foi liberado: libera só a porta
    # do app e só para a rede Docker do proxy (de fora da VM a porta continua fechada).
    if sudo iptables -C INPUT -s "$SUBNET" -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
      info "Firewall: regra já existe."
    else
      sudo iptables -I INPUT -s "$SUBNET" -p tcp --dport "$PORT" -j ACCEPT
      if command -v netfilter-persistent >/dev/null 2>&1; then
        sudo netfilter-persistent save >/dev/null 2>&1 || true
      elif [ -d /etc/iptables ]; then
        sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
      fi
      info "Firewall: liberada a porta $PORT apenas para $SUBNET (regra salva)."
    fi
  fi
fi

ENV_FILE="$APP_DIR/shared/deploy.env"
CARD_IMAGES="on"
[ -f "$ENV_FILE" ] && CARD_IMAGES="$(sed -n 's/^CARD_IMAGES=//p' "$ENV_FILE" | tail -1)" && CARD_IMAGES="${CARD_IMAGES:-on}"
GOOGLE_CLIENT_ID=""
[ -f "$ENV_FILE" ] && GOOGLE_CLIENT_ID="$(sed -n 's/^GOOGLE_CLIENT_ID=//p' "$ENV_FILE" | tail -1)"
ADMIN_EMAILS=""
[ -f "$ENV_FILE" ] && ADMIN_EMAILS="$(sed -n 's/^ADMIN_EMAILS=//p' "$ENV_FILE" | tail -1)"
ONLINE_BOT_ROOMS="on"
[ -f "$ENV_FILE" ] && ONLINE_BOT_ROOMS="$(sed -n 's/^ONLINE_BOT_ROOMS=//p' "$ENV_FILE" | tail -1)" && ONLINE_BOT_ROOMS="${ONLINE_BOT_ROOMS:-on}"
cat > "$ENV_FILE" <<EOF
# Gerado por deploy/setup-vm.sh — lido a cada deploy.
PORT=$PORT
# Interface em que o app escuta (127.0.0.1 = só a própria VM; 0.0.0.0 = também a rede Docker do proxy)
HOST=$BIND_HOST
NODE_BIN=$NODE_BIN
PM2_BIN=$PM2_BIN
# on | off (off: o site não mostra imagens oficiais das cartas)
CARD_IMAGES=$CARD_IMAGES
# Login com Google (preenchido pelo deploy a partir da Variable GOOGLE_CLIENT_ID do GitHub)
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
# Contas Google que viram Admin ao entrar (preenchido pelo deploy a partir da Variable ADMIN_EMAILS do GitHub)
ADMIN_EMAILS=$ADMIN_EMAILS
# on | off (off: desliga o treino online contra o bot do servidor)
ONLINE_BOT_ROOMS=$ONLINE_BOT_ROOMS
EOF
info "Configuração salva em $ENV_FILE"

# ---------------------------------------------------------------- modo nginx (Nginx no host)
if [ "$PROXY" = nginx ]; then
  step "Nginx: site $DOMAIN"
  if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
    CONF="/etc/nginx/sites-available/$DOMAIN"
    LINK="/etc/nginx/sites-enabled/$DOMAIN"
  else
    CONF="/etc/nginx/conf.d/$DOMAIN.conf"
    LINK=""
  fi

  if [ -f "$CONF" ] && grep -q "managed by Certbot" "$CONF"; then
    info "$CONF já existe com HTTPS configurado: mantido como está."
    grep -q "127.0.0.1:$PORT" "$CONF" || info "ATENÇÃO: o arquivo não aponta para a porta $PORT. Ajuste o proxy_pass manualmente."
  else
    sudo tee "$CONF" >/dev/null <<EOF
# GumGum Fight — gerado por deploy/setup-vm.sh
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 2m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
    [ -n "$LINK" ] && sudo ln -sfn "$CONF" "$LINK"
    if ! sudo nginx -t 2>/tmp/gumgum-nginx-test.log; then
      cat /tmp/gumgum-nginx-test.log >&2
      sudo rm -f "$CONF" ${LINK:+"$LINK"}
      die "nginx -t falhou; o arquivo novo foi removido e nada foi recarregado."
    fi
    sudo systemctl reload nginx
    info "Site criado em $CONF e Nginx recarregado."
  fi

  step "HTTPS (Let's Encrypt)"
  if ! command -v certbot >/dev/null 2>&1; then
    info "Instalando certbot…"
    sudo apt-get update -qq && sudo apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  fi
  MY_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
  if [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; then
    info "ATENÇÃO: $DOMAIN aponta para '${DNS_IP:-nada}', mas esta VM é $MY_IP. Corrija no DuckDNS e rode de novo."
  elif sudo certbot certificates 2>/dev/null | grep -q "Domains: .*$DOMAIN"; then
    info "Certificado já existe."
    sudo certbot install --nginx --cert-name "$DOMAIN" --redirect --non-interactive >/dev/null 2>&1 || true
  else
    EMAIL_ARGS=(--register-unsafely-without-email)
    [ -n "${CERTBOT_EMAIL:-}" ] && EMAIL_ARGS=(-m "$CERTBOT_EMAIL")
    if sudo certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos "${EMAIL_ARGS[@]}"; then
      info "HTTPS ativo."
    else
      info "ATENÇÃO: certbot falhou; o site funciona por HTTP. Veja a mensagem acima e rode de novo."
    fi
  fi
fi

# ---------------------------------------------------------------- pm2 no boot
if ! systemctl list-unit-files 2>/dev/null | grep -q "^pm2-$USER"; then
  info "Dica: 'pm2 startup' não parece configurado; rode-o para os apps voltarem após reiniciar a VM."
fi

step "Pronto!"
MY_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "<IP da VM>")"
if [ "$PROXY" = npm ]; then
  cat <<EOF
   Falta criar o site no Nginx Proxy Manager (painel em http://$MY_IP:81):
     Hosts → Proxy Hosts → Add Proxy Host
       Domain Names ........ $DOMAIN
       Scheme .............. http
       Forward Hostname/IP . $FORWARD_HOST
       Forward Port ........ $PORT
       [x] Block Common Exploits   [x] Websockets Support
     Aba SSL: "Request a new SSL Certificate", marque Force SSL e HTTP/2, aceite os termos → Save
   (Se os Proxy Hosts dos seus outros apps usam outro endereço em Forward Hostname,
    por exemplo o IP privado da VM, use o mesmo padrão.)

   Depois do primeiro deploy, teste de dentro do proxy:
     sudo docker exec $NPM_CONTAINER curl -fsS http://$FORWARD_HOST:$PORT/api/health
EOF
elif [ "$PROXY" = none ]; then
  cat <<EOF
   Nenhum proxy reverso detectado. Configure o seu para encaminhar $DOMAIN → http://127.0.0.1:$PORT
EOF
fi
cat <<EOF

   Secrets no GitHub (Settings → Secrets and variables → Actions):
     DEPLOY_HOST         = $MY_IP
     DEPLOY_USER         = $USER
     DEPLOY_SSH_KEY      = conteúdo da chave PRIVADA de deploy
     DEPLOY_KNOWN_HOSTS  = saída de: ssh-keyscan -t ed25519 $MY_IP
   Depois, um push na main (ou "Run workflow") publica o site em https://$DOMAIN
EOF
