# GumGum Fight na VPS da Hostinger — passo a passo

Guia para colocar o site no ar numa VPS nova da Hostinger (KVM 1, Ubuntu, acesso root) com os domínios
**gumgumfight.app** (principal) e **gumgumfight.cloud** (redireciona para o principal). Tudo o que roda no servidor
é feito pelo script [`bootstrap-hostinger.sh`](bootstrap-hostinger.sh); o deploy do código continua sendo o do
GitHub Actions (push na `main`).

Dados usados neste guia (`<IP-DA-VPS>` e `<nome>.hstgr.cloud` são os valores que o hPanel mostra para a sua VPS;
não os deixe escritos neste repositório, que é público):

| Item            | Valor                              |
|-----------------|------------------------------------|
| IP da VPS       | `<IP-DA-VPS>`                  |
| Host            | `<nome>.hstgr.cloud`           |
| Acesso inicial  | `ssh root@<IP-DA-VPS>`         |
| Domínio do site | `gumgumfight.app`                  |
| Redireciona     | `www.gumgumfight.app`, `gumgumfight.cloud`, `www.gumgumfight.cloud` |
| Usuário do app  | `gumgum` (criado pelo script)      |
| Porta interna   | `3310` (só em 127.0.0.1, atrás do Nginx) |

> **Importante:** o `.app` é um TLD com HTTPS obrigatório (vem na lista de HSTS dos navegadores). Sem certificado
> válido o site **não abre** no Chrome/Firefox/Safari. Por isso o DNS (passo 1) precisa estar certo antes de rodar
> o script, que só consegue emitir o certificado quando o domínio já aponta para a VPS.

## 1. DNS (painel da Hostinger)

Os dois domínios usam os nameservers da própria Hostinger (`apollo.dns-parking.com` / `athena.dns-parking.com`),
então os registros são editados no hPanel, sem trocar nameserver:

1. hPanel → **Domínios** → `gumgumfight.app` → **DNS / Nameservers** (aba *Gerenciar registros DNS*).
2. Apague o registro **A** de `@` que aponta para o estacionamento (hoje: `2.57.91.91`) e qualquer **CNAME** de `www`.
3. Crie:

   | Tipo | Nome  | Aponta para       | TTL   |
   |------|-------|-------------------|-------|
   | A    | `@`   | `<IP-DA-VPS>` | 3600  |
   | A    | `www` | `<IP-DA-VPS>` | 3600  |

4. Repita para `gumgumfight.cloud` (mesmos dois registros).
5. Espere a propagação (normalmente minutos, pode levar até 1 h). Confira na sua máquina:
   ```bash
   nslookup gumgumfight.app
   nslookup www.gumgumfight.cloud
   ```
   Os dois devem responder `<IP-DA-VPS>`.

Não precisa criar registro para `<nome>.hstgr.cloud` (já existe) nem registros AAAA.

## 2. Chave de deploy (na sua máquina)

Uma chave só para o GitHub Actions entrar na VPS como o usuário `gumgum`:

```bash
ssh-keygen -t ed25519 -f gumgum_deploy -N "" -C github-actions-gumgumfight
cat gumgum_deploy.pub     # a pública vai para o script (passo 3)
cat gumgum_deploy         # a privada vai para o secret DEPLOY_SSH_KEY (passo 4)
```

## 3. Preparar a VPS (uma vez, como root)

Copie o script para a VPS e rode-o com a chave pública do passo 2 e o seu e-mail (avisos do Let's Encrypt):

```bash
# na sua máquina, a partir da raiz do repositório
scp deploy/bootstrap-hostinger.sh root@<IP-DA-VPS>:/root/
ssh root@<IP-DA-VPS>
```

```bash
# na VPS
CERTBOT_EMAIL=voce@exemplo.com bash /root/bootstrap-hostinger.sh "ssh-ed25519 AAAA...cole a chave pública inteira..."
```

(Alternativa sem `scp`, depois que este arquivo estiver na `main`:
`curl -fsSL https://raw.githubusercontent.com/Xaleh/gumgumfight/main/deploy/bootstrap-hostinger.sh -o /root/bootstrap-hostinger.sh`.)

O script leva alguns minutos (atualiza o Ubuntu) e, no fim, imprime um resumo com o estado do DNS/HTTPS e os
**valores exatos dos secrets** do passo 4, inclusive a linha de `DEPLOY_KNOWN_HOSTS`. O que ele faz:

- Ubuntu atualizado; Nginx, certbot, ufw, fail2ban, sqlite3; 2 GB de swap.
- Node 22 + pm2 (sistema todo), usuário `gumgum` sem sudo, pastas `~gumgum/apps/gumgumfight/{releases,shared}` e
  `shared/deploy.env` (o mesmo formato que o `setup-vm.sh` gera).
- Firewall: só 22, 80 e 443. fail2ban no SSH.
- Nginx: `gumgumfight.app` → app; os outros nomes redirecionam (301) para `https://gumgumfight.app`.
- Certificado Let's Encrypt para todos os nomes que já apontam para a VPS, com renovação automática.
- pm2 sobe sozinho no boot; backup diário do banco (7 cópias rotativas) em `~gumgum/backups`.

Pode rodar de novo quantas vezes quiser: por exemplo, se o DNS do `.cloud` propagar depois, rode de novo e ele
inclui o nome no certificado (`SKIP_UPGRADE=1` pula o `apt upgrade` e fica rápido).

Teste o acesso do deploy, da sua máquina:

```bash
ssh -i gumgum_deploy gumgum@<IP-DA-VPS> 'echo ok'
```

## 4. Secrets no GitHub

A VPS da Hostinger é a **produção** (branch `main`); o servidor antigo (`gumgumfight.duckdns.org`) fica como
**homologação** (branch `hmg`). Cada um tem os seus secrets num *Environment* do GitHub.

GitHub → repositório → **Settings → Environments → New environment** → nome `production` → **Add environment secret**:

| Secret               | Valor                                                                 |
|----------------------|-----------------------------------------------------------------------|
| `DEPLOY_HOST`        | `<IP-DA-VPS>`                                                     |
| `DEPLOY_USER`        | `gumgum`                                                              |
| `DEPLOY_SSH_KEY`     | conteúdo inteiro do arquivo `gumgum_deploy` (chave **privada**)       |
| `DEPLOY_KNOWN_HOSTS` | a linha impressa pelo script, ou a saída de `ssh-keyscan -t ed25519 <IP-DA-VPS>` |

Sempre em **Secrets** (nunca em Variables). Crie também o Environment `homologacao`: se os secrets do servidor
antigo já estão em *Repository secrets*, não precisa cadastrar nada nele (os do repositório valem como padrão e
os do Environment `production` têm prioridade na `main`). Opcional, em **Variables**: `GOOGLE_CLIENT_ID` (login
com Google) e `ADMIN_EMAILS` (contas que viram Admin) — veja o README.

## 5. Primeiro deploy

GitHub → **Actions → "CI e deploy" → Run workflow** (branch `main`), com `import_sets` = `ST-01 ST-02` para já
importar as cartas reais (o banco da VPS nova começa vazio; o da homologação não é copiado). O workflow testa o
pacote, envia por SSH, ativa no pm2, confere `/api/health` e, por fim, acessa `https://gumgumfight.app/api/health`.

Daí em diante o fluxo é: branch de trabalho → merge na `hmg` (deploy em `gumgumfight.duckdns.org`) → testou →
merge na `main` (deploy em `gumgumfight.app`).

Se o último passo ("Verifica o site público") falhar, o app está no ar na VPS mas o HTTPS não: rode o
`bootstrap-hostinger.sh` de novo e leia o aviso do certbot.

## 6. Login com Google (opcional)

No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), nas **Origens JavaScript
autorizadas** do Client ID, use `https://gumgumfight.app` (o `www` e o `.cloud` redirecionam, não precisam entrar).
Cadastre o Client ID na Variable `GOOGLE_CLIENT_ID` do GitHub e rode um deploy.

## 7. Apoio ao projeto (opcional)

Os valores ficam só no `deploy.env` da VM (chaves e tokens são segredos: nunca no repositório nem nas Variables do
GitHub). Na produção:

```bash
ssh gumgum@<IP-DA-VPS>
nano ~/apps/gumgumfight/shared/deploy.env
```

```ini
# "Doe um Cafezim" (Pix)
SUPPORT_PIX_KEY=<chave-aleatoria>
SUPPORT_PIX_NAME=Seu Nome
SUPPORT_PIX_CITY=Sua Cidade
# Apoio mensal na Apoia.se
SUPPORT_MONTHLY_URL=https://apoia.se/<sua-campanha>
APOIASE_API_KEY=<x-api-key enviada pela Apoia.se>
APOIASE_API_SECRET=<segredo (Bearer) enviado pela Apoia.se>
# Meta do mês e contato das lojas
SUPPORT_GOAL_BRL=120
SUPPORT_CONTACT_URL=mailto:<seu-email>
# Consulta de plano pela homologação (o mesmo texto nos dois servidores)
INTERNAL_TOKEN=<texto aleatório longo>
```

Para aplicar sem esperar o próximo deploy:

```bash
pm2 startOrReload ~/apps/gumgumfight/current/deploy/ecosystem.config.cjs --update-env && pm2 save
```

Com a chave da Apoia.se, o site consulta o apoio no login, no botão "Já apoio: verificar" e a cada 6 horas
(`APOIASE_SYNC=off` desliga a rodada periódica). O passo a passo completo está em
[`docs/apoio/README.md`](../docs/apoio/README.md).

Na homologação (`gumgumfight.duckdns.org`), para abrir o site só para apoiadores:

```ini
ACCESS=supporters
SUPPORT_SOURCE_URL=https://gumgumfight.app
INTERNAL_TOKEN=<o mesmo da produção>
```

Rodar o `setup-vm.sh` de novo mantém essas linhas.

## 8. API para parceiros (opcional)

Apps parceiros (ex.: um construtor de decks) agem em nome do usuário com tokens de acesso (`Authorization: Bearer`;
ver "API para parceiros" no `README.md`). Dois ajustes na VPS:

1. **Cliente OAuth** (o botão "Vincular" no app): cadastre o app pela linha de comando, no servidor, e passe o
   `client_secret` (e o `webhook_secret`, se houver) por um canal seguro. Eles aparecem uma vez só:

   ```bash
   cd ~/apps/gumgumfight/current/server
   DB_PATH=~/apps/gumgumfight/shared/gumgum.db node oauth-client-cli.mjs add sweetapp "sweetapp" \
     --redirect https://sweetapp.example/integrations/ggf/callback --webhook https://sweetapp.example/integrations/ggf/webhook
   DB_PATH=~/apps/gumgumfight/shared/gumgum.db node oauth-client-cli.mjs list
   ```

2. **IP do parceiro fora do limite por IP do Nginx**: todas as chamadas do app saem do servidor dele, então os
   usuários dele somados contariam como um IP só contra os 30 req/s. Coloque o IP (ou os IPs, separados por
   vírgula) em `PARTNER_IPS` no `deploy.env` e rode o bootstrap de novo (`SKIP_UPGRADE=1 bash
   /root/bootstrap-hostinger.sh`), que regenera `/etc/nginx/conf.d/gumgumfight-limits.conf`. A partir daí, o limite
   que vale para esse IP é o do app: 120 requisições por minuto por token.

## Operação

```bash
ssh gumgum@<IP-DA-VPS>            # as chaves que abrem o root também abrem o gumgum
pm2 logs gumgumfight                  # logs
pm2 restart gumgumfight               # reiniciar
ls ~/apps/gumgumfight/releases        # últimos 5 releases; "current" aponta para o ativo
ls ~/backups                          # gumgum-1.db … gumgum-7.db (um por dia da semana)
```

Como root: `sudo -u gumgum pm2 logs gumgumfight`. Banco: `/home/gumgum/apps/gumgumfight/shared/gumgum.db`
(para restaurar um backup: `pm2 stop gumgumfight`, copie o arquivo por cima, `pm2 start gumgumfight`).

Mudar opções do app (`CARD_IMAGES`, `ONLINE_BOT_ROOMS`): edite `shared/deploy.env` e rode
`pm2 startOrReload ~/apps/gumgumfight/current/deploy/ecosystem.config.cjs --update-env`.

Imagens das cartas pelo mesmo domínio (`/card-img/`, usadas pelo kit de divulgação dos torneios): o bootstrap
configura o Nginx com cache em disco (`/var/cache/nginx/gumgum-cards`, até 2 GB). Numa VPS configurada antes disso,
rode o bootstrap de novo (`SKIP_UPGRADE=1 bash /root/bootstrap-hostinger.sh`) para ligar o cache; enquanto isso, o
próprio app atende `/card-img/` buscando na origem.

## Segurança (recomendado depois que tudo funcionar)

1. **Chave SSH para o root.** No hPanel → VPS → *Configurações → Chaves SSH*, adicione a chave pública da sua
   máquina (ou `ssh-copy-id root@<IP-DA-VPS>`). Teste `ssh root@<IP-DA-VPS>` sem senha.
2. **Desligar login por senha:** `HARDEN_SSH=1 SKIP_UPGRADE=1 bash /root/bootstrap-hostinger.sh`. O script só
   faz isso se o root já tiver uma chave autorizada (para você não ficar trancado para fora).
3. **Firewall da Hostinger** (hPanel → VPS → Firewall): é opcional, o `ufw` já está ativo na VPS. Se ativar o da
   Hostinger, libere as portas 22, 80 e 443.
4. O backup semanal da Hostinger continua valendo para a VPS inteira.

## Problemas comuns

- **Navegador diz que `gumgumfight.app` não é seguro / não abre:** o certificado não foi emitido (DNS errado na
  hora do script). Confira o `nslookup`, rode o script de novo.
- **`certbot` falha com "Timeout during connect":** a porta 80 está bloqueada (firewall da Hostinger) ou o DNS ainda
  aponta para o IP antigo.
- **Deploy falha em "Envia o pacote" (Permission denied):** a chave pública passada ao script não é o par da
  `DEPLOY_SSH_KEY`, ou `DEPLOY_USER` não é `gumgum`.
- **Deploy falha em "Host key verification failed":** `DEPLOY_KNOWN_HOSTS` errado; use a linha que o script imprime.
- **502 Bad Gateway:** o app não está rodando; `pm2 logs gumgumfight` mostra o motivo.
