#!/usr/bin/env bash
# Preparação de uma VPS NOVA (Ubuntu 24.04/26.04, acesso root) para o GumGum Fight.
# Feito para a VPS KVM da Hostinger, mas serve para qualquer VPS Ubuntu limpa.
# Pode ser executado de novo sem problemas (por exemplo, depois de apontar mais um domínio).
#
# Uso (na VPS, como root):
#   CERTBOT_EMAIL=voce@exemplo.com bash bootstrap-hostinger.sh "ssh-ed25519 AAAA... github-actions-gumgumfight"
#
# O que ele faz:
#   1. Atualiza o Ubuntu e instala Nginx, certbot, ufw, fail2ban e sqlite3.
#   2. Cria 2 GB de swap (a VPS tem 4 GB de RAM; a swap evita o OOM em picos).
#   3. Instala Node 22 (NodeSource) e pm2, para o sistema todo.
#   4. Cria o usuário "gumgum" (sem sudo), que roda o app e recebe o deploy do GitHub Actions.
#   5. Cria ~gumgum/apps/gumgumfight/{releases,shared} e shared/deploy.env (lido a cada deploy).
#   6. Firewall: só SSH, HTTP e HTTPS. fail2ban protege o SSH.
#   7. Nginx: site para o domínio principal; os outros nomes redirecionam para ele.
#   8. HTTPS (Let's Encrypt, webroot) para todos os nomes que já apontam para esta VPS.
#      (.app é um TLD com HTTPS obrigatório nos navegadores: sem certificado o site não abre.)
#   9. pm2 sobe sozinho no boot. Backup diário do banco (7 dias) em ~gumgum/backups.
#
# Variáveis opcionais:
#   DOMAIN=gumgumfight.app             domínio principal do site
#   ALIASES="www.gumgumfight.app gumgumfight.cloud www.gumgumfight.cloud"
#                                      nomes que redirecionam para DOMAIN (só entram no HTTPS se apontarem para a VPS)
#   CERTBOT_EMAIL=                     e-mail para avisos de vencimento do Let's Encrypt (recomendado)
#   DEPLOY_USER=gumgum                 usuário que roda o app
#   PORT=3310                          porta interna do app (só em 127.0.0.1, atrás do Nginx)
#   NODE_MAJOR=22                      versão do Node (o projeto precisa de >= 22.13)
#   HARDEN_SSH=0                       1 = desliga login por senha no SSH (só se o root já tiver chave autorizada)
#   SKIP_UPGRADE=0                     1 = não roda apt-get upgrade (mais rápido ao reexecutar)
set -euo pipefail

DOMAIN="${DOMAIN:-gumgumfight.app}"
ALIASES="${ALIASES-www.gumgumfight.app gumgumfight.cloud www.gumgumfight.cloud}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
DEPLOY_USER="${DEPLOY_USER:-gumgum}"
PORT="${PORT:-3310}"
NODE_MAJOR="${NODE_MAJOR:-22}"
HARDEN_SSH="${HARDEN_SSH:-0}"
SKIP_UPGRADE="${SKIP_UPGRADE:-0}"
DEPLOY_PUBKEY="${1:-}"

HOME_DIR="/home/$DEPLOY_USER"
APP_DIR="$HOME_DIR/apps/gumgumfight"
SHARED="$APP_DIR/shared"
ENV_FILE="$SHARED/deploy.env"
WEBROOT=/var/www/certbot
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
NGINX_LINK="/etc/nginx/sites-enabled/$DOMAIN"

step() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   \033[1;31mATENÇÃO:\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}

# ---------------------------------------------------------------- checagens
[ "$(id -u)" = 0 ] || die "Rode como root: sudo bash $0 ..."
grep -qi ubuntu /etc/os-release 2>/dev/null || die "Este script foi feito para Ubuntu."
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || die "DOMAIN inválido: $DOMAIN"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT inválida: $PORT"
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "DEPLOY_USER inválido: $DEPLOY_USER"
if [ -n "$DEPLOY_PUBKEY" ]; then
  [[ "$DEPLOY_PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\  ]] || die "O argumento não parece uma chave pública SSH."
fi

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
MY_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
info "IP público desta VPS: $MY_IP"

# ---------------------------------------------------------------- pacotes
step "Pacotes do sistema"
apt-get update -qq
if [ "$SKIP_UPGRADE" != 1 ]; then
  info "Atualizando o Ubuntu (pode demorar alguns minutos)…"
  apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade >/dev/null
fi
apt-get -y -qq install nginx certbot ufw fail2ban sqlite3 curl ca-certificates gnupg git >/dev/null
info "ok"

# ---------------------------------------------------------------- swap
step "Swap"
if swapon --show --noheadings | grep -q .; then
  info "Já existe: $(swapon --show --noheadings | awk '{print $1, $3}' | head -1)"
else
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-gumgum-swap.conf
  info "Criados 2 GB em /swapfile."
fi

# ---------------------------------------------------------------- Node + pm2
step "Node $NODE_MAJOR e pm2"
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  info "Node já instalado: $(command -v node) ($(node -v))"
else
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > /etc/apt/preferences.d/nodesource
  apt-get update -qq && apt-get -y -qq install nodejs >/dev/null
  info "Instalado: $(node -v)"
fi
NODE_BIN="$(command -v node)"
node_ok "$NODE_BIN" || die "$NODE_BIN é $("$NODE_BIN" -v); o GumGum Fight precisa de Node >= 22.13."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g --silent pm2 >/dev/null
fi
PM2_BIN="$(command -v pm2)"
info "pm2: $PM2_BIN ($("$PM2_BIN" -v 2>/dev/null | tail -1))"

# ---------------------------------------------------------------- usuário do app
step "Usuário $DEPLOY_USER"
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  info "Já existe."
else
  adduser --disabled-password --gecos "GumGum Fight" "$DEPLOY_USER" >/dev/null
  info "Criado (sem senha e sem sudo: só roda o app e recebe o deploy)."
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH" && chmod 600 "$AUTH" && chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
if [ -n "$DEPLOY_PUBKEY" ]; then
  if grep -qF "$DEPLOY_PUBKEY" "$AUTH"; then info "Chave de deploy já autorizada."
  else printf '%s\n' "$DEPLOY_PUBKEY" >> "$AUTH"; info "Chave de deploy (GitHub Actions) autorizada."; fi
else
  warn "Nenhuma chave de deploy informada. Passe a chave pública como argumento (ou rode de novo depois)."
fi
# As chaves que abrem o root também abrem o usuário do app (para você entrar como $DEPLOY_USER sem senha).
if [ -s /root/.ssh/authorized_keys ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^(ssh-|ecdsa-) ]] || continue
    grep -qF "$line" "$AUTH" || printf '%s\n' "$line" >> "$AUTH"
  done < /root/.ssh/authorized_keys
fi

# ---------------------------------------------------------------- pastas + deploy.env
step "Pastas em $APP_DIR"
# Todas as pastas do caminho precisam ser do usuário: o deploy cria o link "current" dentro de $APP_DIR.
install -d "$HOME_DIR/apps" "$APP_DIR" "$APP_DIR/releases" "$SHARED" "$HOME_DIR/backups"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/apps" "$APP_DIR" "$APP_DIR/releases" "$SHARED" "$HOME_DIR/backups"
# Preserva o que já estava em deploy.env (preenchido pelos deploys).
get_env() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }
CARD_IMAGES="$(get_env CARD_IMAGES)"; CARD_IMAGES="${CARD_IMAGES:-on}"
GOOGLE_CLIENT_ID="$(get_env GOOGLE_CLIENT_ID)"
ADMIN_EMAILS="$(get_env ADMIN_EMAILS)"
ONLINE_BOT_ROOMS="$(get_env ONLINE_BOT_ROOMS)"; ONLINE_BOT_ROOMS="${ONLINE_BOT_ROOMS:-on}"
cat > "$ENV_FILE" <<EOF
# Gerado por deploy/bootstrap-hostinger.sh — lido a cada deploy (deploy/remote-deploy.sh e ecosystem.config.cjs).
PORT=$PORT
# Só a própria VPS: o Nginx faz o proxy.
HOST=127.0.0.1
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
chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"
info "Configuração salva em $ENV_FILE"

# ---------------------------------------------------------------- firewall + fail2ban
step "Firewall (ufw) e fail2ban"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
info "ufw: liberados só SSH (22), HTTP (80) e HTTPS (443)."
systemctl enable --now fail2ban >/dev/null 2>&1 || true
info "fail2ban ativo (bloqueia IPs que erram a senha do SSH repetidamente)."

# ---------------------------------------------------------------- Nginx
step "Nginx: $DOMAIN"
install -d -m 755 "$WEBROOT"
rm -f /etc/nginx/sites-enabled/default

# Quais nomes já apontam para esta VPS? Só esses podem entrar no certificado.
dns_ip() { getent ahostsv4 "$1" 2>/dev/null | awk 'NR==1{print $1}'; }
CERT_NAMES=()
MAIN_OK=0
if [ "$(dns_ip "$DOMAIN")" = "$MY_IP" ]; then CERT_NAMES+=("$DOMAIN"); MAIN_OK=1
else warn "$DOMAIN aponta para '$(dns_ip "$DOMAIN")' (esperado: $MY_IP). Corrija o DNS e rode o script de novo."; fi
ALIAS_OK=()
for a in $ALIASES; do
  if [ "$(dns_ip "$a")" = "$MY_IP" ]; then CERT_NAMES+=("$a"); ALIAS_OK+=("$a")
  else info "$a ainda não aponta para esta VPS (só HTTP com redirecionamento por enquanto)."; fi
done

# "http2 on" existe a partir do nginx 1.25.1; antes disso é "listen ... http2".
NGX_VER="$(nginx -v 2>&1 | sed -n 's/.*nginx\/\([0-9.]*\).*/\1/p')"
if printf '%s\n1.25.1\n' "$NGX_VER" | sort -V | head -1 | grep -qx '1.25.1'; then
  LISTEN_SSL=$'    listen 443 ssl;\n    listen [::]:443 ssl;\n    http2 on;'
else
  LISTEN_SSL=$'    listen 443 ssl http2;\n    listen [::]:443 ssl http2;'
fi

PROXY_BLOCK="$(cat <<EOF
    client_max_body_size 2m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # SSE (partidas online): o app manda um ping a cada 20 s e pede para não bufferizar.
        proxy_buffering off;
        proxy_read_timeout 90s;
    }
EOF
)"

write_http_only() {
  {
    echo "# GumGum Fight — gerado por deploy/bootstrap-hostinger.sh (ainda SEM certificado; rode o script de novo)"
    if [ -n "$ALIASES" ]; then
      cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $ALIASES;
    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 301 http://$DOMAIN\$request_uri; }
}
EOF
    fi
    cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
$PROXY_BLOCK
}
EOF
  } > "$NGINX_CONF"
}

write_https() {
  local cert_dir="/etc/letsencrypt/live/$DOMAIN"
  local ssl
  ssl="$(cat <<EOF
    ssl_certificate $cert_dir/fullchain.pem;
    ssl_certificate_key $cert_dir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
EOF
)"
  {
    cat <<EOF
# GumGum Fight — gerado por deploy/bootstrap-hostinger.sh
# HTTP: só o desafio do Let's Encrypt; todo o resto vai para HTTPS no domínio principal.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN $ALIASES;
    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 301 https://$DOMAIN\$request_uri; }
}
EOF
    if [ "${#ALIAS_OK[@]}" -gt 0 ]; then
      cat <<EOF

# Outros nomes com certificado: redirecionam para o domínio principal.
server {
$LISTEN_SSL
    server_name ${ALIAS_OK[*]};
$ssl
    return 301 https://$DOMAIN\$request_uri;
}
EOF
    fi
    cat <<EOF

server {
$LISTEN_SSL
    server_name $DOMAIN;
$ssl
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

$PROXY_BLOCK
}
EOF
  } > "$NGINX_CONF"
}

apply_nginx() {
  ln -sfn "$NGINX_CONF" "$NGINX_LINK"
  if ! nginx -t 2>/tmp/gumgum-nginx-test.log; then
    cat /tmp/gumgum-nginx-test.log >&2
    die "nginx -t falhou (arquivo: $NGINX_CONF)."
  fi
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
}

write_http_only
apply_nginx
info "Site HTTP no ar (responde 502 até o primeiro deploy)."

# ---------------------------------------------------------------- HTTPS
step "HTTPS (Let's Encrypt)"
HTTPS_OK=0
if [ "$MAIN_OK" = 1 ]; then
  EMAIL_ARGS=(--register-unsafely-without-email)
  [ -n "$CERTBOT_EMAIL" ] && EMAIL_ARGS=(-m "$CERTBOT_EMAIL" --no-eff-email)
  D_ARGS=()
  for n in "${CERT_NAMES[@]}"; do D_ARGS+=(-d "$n"); done
  info "Pedindo certificado para: ${CERT_NAMES[*]}"
  if certbot certonly --webroot -w "$WEBROOT" --cert-name "$DOMAIN" "${D_ARGS[@]}" --expand \
      --keep-until-expiring --non-interactive --agree-tos "${EMAIL_ARGS[@]}" >/tmp/gumgum-certbot.log 2>&1; then
    HTTPS_OK=1
  else
    cat /tmp/gumgum-certbot.log >&2
    warn "certbot falhou. O site fica só em HTTP (o .app NÃO abre sem HTTPS). Confira o DNS e rode o script de novo."
  fi
  if [ "$HTTPS_OK" = 1 ]; then
    install -d /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    write_https
    apply_nginx
    info "HTTPS ativo para: ${CERT_NAMES[*]} (renovação automática pelo certbot.timer)."
  fi
else
  info "Pulado: $DOMAIN ainda não aponta para esta VPS."
fi

# ---------------------------------------------------------------- pm2 no boot
step "pm2 no boot (usuário $DEPLOY_USER)"
env PATH="$PATH:$(dirname "$NODE_BIN")" "$PM2_BIN" startup systemd -u "$DEPLOY_USER" --hp "$HOME_DIR" >/dev/null 2>&1 \
  || warn "pm2 startup falhou; rode manualmente: pm2 startup systemd -u $DEPLOY_USER --hp $HOME_DIR"
info "Serviço pm2-$DEPLOY_USER habilitado."

# ---------------------------------------------------------------- backup diário do banco
step "Backup diário do banco"
cat > /etc/cron.d/gumgumfight-backup <<EOF
# Cópia consistente do SQLite, uma por dia da semana (7 cópias rotativas) em $HOME_DIR/backups.
15 4 * * * $DEPLOY_USER [ -f $SHARED/gumgum.db ] && sqlite3 $SHARED/gumgum.db ".backup '$HOME_DIR/backups/gumgum-\$(date +\\%u).db'"
EOF
chmod 644 /etc/cron.d/gumgumfight-backup
info "Todo dia às 04:15 em $HOME_DIR/backups (além do backup semanal da Hostinger)."

# ---------------------------------------------------------------- SSH (opcional)
if [ "$HARDEN_SSH" = 1 ]; then
  step "SSH: desligando login por senha"
  if [ -s /root/.ssh/authorized_keys ]; then
    printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\nKbdInteractiveAuthentication no\n' \
      > /etc/ssh/sshd_config.d/90-gumgum-hardening.conf
    if sshd -t 2>/dev/null; then systemctl reload ssh 2>/dev/null || systemctl reload sshd; info "Só chaves SSH a partir de agora."
    else rm -f /etc/ssh/sshd_config.d/90-gumgum-hardening.conf; warn "sshd -t falhou; nada foi alterado."; fi
  else
    warn "root não tem chave em /root/.ssh/authorized_keys: NÃO desliguei a senha (você ficaria trancado para fora)."
  fi
fi

# ---------------------------------------------------------------- resumo
step "Pronto!"
KNOWN_HOSTS="$(ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null | sed "s/^127\.0\.0\.1/$MY_IP/")"
cat <<EOF
   DNS (painel da Hostinger → Domínios → DNS): registro A de "@" e "www" → $MY_IP
     $DOMAIN  →  $([ "$MAIN_OK" = 1 ] && echo "ok" || echo "AINDA NÃO (aponta para '$(dns_ip "$DOMAIN")')")
EOF
for a in $ALIASES; do
  printf '     %s  →  %s\n' "$a" "$([ "$(dns_ip "$a")" = "$MY_IP" ] && echo ok || echo "ainda não")"
done
cat <<EOF
   HTTPS: $([ "$HTTPS_OK" = 1 ] && echo "ativo (https://$DOMAIN)" || echo "pendente — corrija o DNS e rode o script de novo")

   Secrets no GitHub (Settings → Secrets and variables → Actions → aba Secrets):
     DEPLOY_HOST         = $MY_IP
     DEPLOY_USER         = $DEPLOY_USER
     DEPLOY_SSH_KEY      = conteúdo do arquivo gumgum_deploy (chave PRIVADA, gerada na sua máquina)
     DEPLOY_KNOWN_HOSTS  = ${KNOWN_HOSTS:-"(rode: ssh-keyscan -t ed25519 $MY_IP)"}

   Teste o acesso do deploy, da sua máquina:  ssh -i gumgum_deploy $DEPLOY_USER@$MY_IP 'echo ok'
   Depois: GitHub → Actions → "CI e deploy" → Run workflow (main), import_sets = "ST-01 ST-02".
   O site fica em https://$DOMAIN. Logs: sudo -u $DEPLOY_USER pm2 logs gumgumfight
EOF
