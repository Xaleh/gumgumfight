# GumGum Fight

Simulador de **One Piece Card Game** no navegador, inspirado no [Duels.ink](https://duels.ink/) (Lorcana).

> **Status:** partidas contra um bot, replays, **multiplayer online** (salas privadas, fila casual e
> ranqueada) e **torneios** (suíço com top cut e eliminação simples, com melhor de 3 e de 5). Cartas importadas da [optcgapi.com](https://optcgapi.com/documentation),
> com textos em português (tradução automática) ou inglês e imagens opcionais. Interface em **seis idiomas**
> (🇧🇷 português do Brasil, 🇬🇧 inglês, 🇪🇸 espanhol, 🇯🇵 japonês, 🇫🇷 francês e 🇩🇪 alemão), escolhidos pela bandeira.

## Requisitos

- Node.js 22.13 ou mais recente (recomendado: a LTS atual)
- Nenhum serviço externo nem módulo nativo: o banco é um arquivo SQLite local, usando o SQLite embutido no Node (`node:sqlite`)

## Rodando em desenvolvimento

```bash
npm install
npm run dev
```

- Interface: http://localhost:5173 (Vite, com recarga automática)
- API: http://localhost:3001 (Fastify + SQLite)

Na primeira execução o servidor cria o banco `apps/server/var/gumgum.db` e carrega as cartas e os decks de `data/`.
O Vite só sobe depois que a API responde em `/api/health`.

### Problemas comuns

- **`http proxy error ... ECONNREFUSED`**: a API (porta 3001) não está no ar. Procure no terminal as linhas `[server]`,
  que mostram o motivo real.
- **`No such built-in module: node:sqlite`**: o Node é antigo demais. Atualize para 22.13+.
- **`ExperimentalWarning: SQLite is an experimental feature`**: aviso do Node 22, pode ser ignorado.
- **`A porta 3001 já está em uso`**: outro processo está usando a porta (por exemplo, um `npm run dev` antigo).

## Rodando no seu servidor (produção)

O comando `npm run build:release` gera `release/`, um pacote autocontido (servidor empacotado com esbuild, interface
e dados). O pacote não tem módulos nativos, então funciona em x64 e ARM, e só precisa de **Node ≥ 22.13** (sem `npm install`):

```bash
npm ci && npm run build:release
DB_PATH=/caminho/gumgum.db WEB_DIST=$PWD/release/web DATA_DIR=$PWD/release/data PORT=3310 node release/server/index.mjs
```

| Variável        | Padrão                        | Descrição                                   |
|-----------------|-------------------------------|---------------------------------------------|
| `PORT`          | `3001`                        | Porta HTTP                                  |
| `HOST`          | `0.0.0.0`                     | Interface de rede (`127.0.0.1` atrás do Nginx) |
| `DB_PATH`       | `apps/server/var/gumgum.db`   | Arquivo SQLite                              |
| `WEB_DIST`      | `apps/web/dist`               | Interface compilada                         |
| `DATA_DIR`      | `data`                        | Decks prontos, cartas provisórias e traduções |
| `CARD_IMAGES`   | `on`                          | `off` desliga as imagens oficiais das cartas |
| `CARD_API_BASE` | `https://optcgapi.com/api`    | API usada pelo importador                   |
| `CARD_SOURCES`  | `optcgapi`                    | Fontes das cartas lançadas, em ordem de prioridade (ex.: `cardkaizoku,optcgapi`; veja [Cadeia de fontes](#cadeia-de-fontes)) |
| `SPOILER_SOURCES` | `optcgleaks`                | Fontes dos spoilers, em ordem de prioridade (ex.: `cardkaizoku,optcgleaks`) |
| `CARD_CDN_URL`  | (vazio)                       | Endereço público da CDN própria das imagens (ex.: `https://cards.gumgumfight.cloud`); vazio = imagens direto das fontes (veja [CDN própria](#cdn-própria-das-imagens-cloudflare-r2)) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | (vazio) | Conta (o Account ID ou o endpoint S3 inteiro), bucket e token do Cloudflare R2 da CDN (segredos: só no `deploy.env`) |
| `R2_ENDPOINT`   | (vazio)                       | Só para bucket com jurisdição (ex.: `https://<id>.eu.r2.cloudflarestorage.com`) |
| `CARD_IMAGE_SOURCES` | `bandai-en,bandai-asia,bandai-jp` | Listas oficiais da Bandai onde procurar a imagem das cartas sem imagem, em ordem (com a CDN ligada); `off` desliga |
| `SPOILER_SYNC`  | `6`                           | Horas entre as buscas dos spoilers na API oficial; `off` desliga |
| `GLOBAL_STATS_API_KEY` | (vazio) | Chave da OPTCG Logpose API (meta global do TCG Matchmaking; veja [Meta global](#meta-global-tcg-matchmaking)); vazio = escopo Global desligado (segredo: só no `deploy.env`) |
| `GLOBAL_STATS_CLIENT` | `gumgum` | O `x-client-name` cadastrado junto com a chave |
| `GLOBAL_STATS_API_URL` | `https://optcg-api.vercel.app` | Endereço da API |
| `GLOBAL_STATS_SYNC` | `6` | Horas entre as buscas das filas do TCG Matchmaking; `off` desliga |
| `GOOGLE_CLIENT_ID` | (vazio)                    | Client ID do login com Google; vazio = login desligado |
| `ADMIN_EMAILS`  | (vazio)                       | E-mails (separados por vírgula) das contas Google que viram Admin ao entrar (um Dev continua Dev) |
| `ONLINE_BOT_ROOMS` | `on`                       | Transmitir o treino contra o bot (o servidor joga pelo bot; exige login); `off` desliga |
| `ONLINE_MAX_ROOMS` | `400`                      | Salas online ativas ao mesmo tempo no servidor (acima disso, 503); cada sala custa memória e CPU |
| `ONLINE_MAX_BOT_ROOMS` | `100`                  | Treinos contra o bot transmitidos ao mesmo tempo (o servidor joga pelo bot); acima disso o treino roda no navegador |
| `PUSH`          | `on`                          | Notificações no celular (Web Push); `off` desliga e some a opção nas configurações |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | (gerado) | Par de chaves das notificações (base64url). Sem elas, o servidor gera um na primeira vez e guarda no banco |
| `VAPID_SUBJECT` | `https://gumgumfight.app`     | Contato do servidor para os serviços de push (`mailto:` ou `https:`) |
| `PM2_MAX_MEMORY` | `1500M` (só no `deploy.env` da VM) | Memória a partir da qual o pm2 reinicia o app |
| `SUPPORT_PIX_KEY` / `SUPPORT_PIX_NAME` / `SUPPORT_PIX_CITY` | (vazio) | Pix do "Doe um Cafezim": chave (de preferência aleatória), nome e cidade de quem recebe |
| `SUPPORT_MONTHLY_URL` | (vazio) | Página da campanha mensal na Apoia.se (Grumete, Tripulante, Capitão, Almirante) |
| `APOIASE_API_KEY` / `APOIASE_API_SECRET` | (vazio) | Chave e segredo da API da Apoia.se: o plano vem de lá pelo e-mail da conta (segredos: só no `deploy.env`) |
| `APOIASE_SYNC` | `6` | Horas entre as reconsultas de quem tem plano da Apoia.se; `off` desliga |
| `SUPPORT_COFFEE_URL` | (vazio) | Opcional: página de doação com cartão (ex.: Ko-fi, para público de fora do Brasil) |
| `SUPPORT_GOAL_BRL` | (vazio) | Custo mensal do site, mostrado como meta no "Apoiar o projeto" |
| `SUPPORT_CONTACT_URL` | (vazio) | Contato para lojas que querem patrocinar (`mailto:` ou link) |
| `KOFI_WEBHOOK_TOKEN` | (vazio) | Opcional: token do webhook do Ko-fi; vazio = desligado (segredo: só no `deploy.env`) |
| `INTERNAL_TOKEN` | (vazio) | Token da consulta de plano entre homologação e produção (igual nos dois; segredo) |
| `ACCESS` | `open` | `supporters`: o site só abre para apoiadores Tripulante ou acima e admins (homologação) |
| `SUPPORT_SOURCE_URL` | (vazio) | Com `ACCESS=supporters`: site onde o plano é consultado (a produção) |
| `PARTNER_IPS` | (vazio; só no `deploy.env` da VM) | IPs dos servidores de apps parceiros, separados por vírgula: ficam fora do limite por IP do Nginx (o app limita cada token) |
| `REPLAY_EMBED_ORIGINS` | (vazio) | Sites que podem pôr o replay embutido (`/replay/<id>`) num iframe, separados por vírgula (ex.: `https://sweetapp.com.br`); vazio = só o próprio site |
| `REPLAY_LINK_SECRET` | (gerado) | Segredo das assinaturas dos links de replay; sem ele, o servidor gera um na primeira vez e guarda no banco (trocar invalida os links abertos) |

Sem nenhuma variável de apoio, o item "Apoiar o projeto" não aparece e as estatísticas ficam todas abertas, como
antes. Com o apoio configurado, as Estatísticas Pro (ranqueada, torneios e filtro por faixa) passam a exigir o plano
Tripulante. Detalhes, planos e o passo a passo estão em [`docs/apoio/`](docs/apoio/README.md).

O backup é só copiar o arquivo `.db`.

## Deploy automático (GitHub Actions)

O workflow `.github/workflows/ci-deploy.yml` roda os testes em todo push e publica em dois ambientes:

| Branch   | Environment (GitHub) | Site                               | Servidor                                   |
|----------|----------------------|------------------------------------|--------------------------------------------|
| `main`   | `production`         | https://gumgumfight.app            | VPS da Hostinger (`deploy/bootstrap-hostinger.sh`) |
| `hmg`    | `homologacao`        | https://gumgumfight.duckdns.org    | servidor de testes (`deploy/setup-vm.sh`)  |

**Fluxo:** cada branch de trabalho é mesclado na **`hmg`** (push → deploy na homologação); depois de testado em
`gumgumfight.duckdns.org`, a `hmg` é mesclada na **`main`** (push → deploy na produção). "Run workflow" em
qualquer outro branch publica aquele branch na homologação, para testar sem mesclar (o próximo push na `hmg`
sobrescreve). Em cada deploy o workflow:

1. Monta o pacote e o testa (sobe o servidor e consulta a API) antes de enviar.
2. Copia o pacote por SSH para uma pasta de releases no servidor e troca o link `current`.
3. Recarrega o app no pm2 e confere `/api/health`. **Se falhar, volta sozinho para a versão anterior.**
4. Mantém os 5 últimos releases. O banco fica numa pasta compartilhada e sobrevive aos deploys.

O app fica atrás de um proxy reverso (Nginx no host ou Nginx Proxy Manager em Docker), sem porta exposta
diretamente. Os outros apps do servidor não são tocados: o deploy usa um Node ≥ 22.13 próprio (via nvm, se o
Node padrão for mais antigo) e um site separado no proxy.

### Configuração inicial (uma vez)

1. **Chave de deploy dedicada** (na sua máquina, não use a chave principal do servidor):
   ```bash
   ssh-keygen -t ed25519 -f gumgum_deploy -N "" -C github-actions-gumgumfight
   ```
2. **Domínio:** aponte o domínio do site (registros A de `@` e `www`) para o IP do servidor.
3. **No servidor**, rode um dos scripts com a chave pública de deploy:
   - **VPS nova e só para este site** (ex.: a VPS KVM da Hostinger, Ubuntu limpo, como root): `deploy/bootstrap-hostinger.sh`
     faz tudo — atualiza o sistema, instala Node 22, pm2, Nginx, HTTPS (Let's Encrypt), firewall, fail2ban, swap,
     cria o usuário `gumgum` que recebe o deploy, um backup diário do banco e um watchdog que reinicia o Nginx se
     o site parar de responder. O passo a passo completo, com o DNS
     da Hostinger e os valores dos secrets, está em [`deploy/HOSTINGER.md`](deploy/HOSTINGER.md).
     ```bash
     CERTBOT_EMAIL=voce@exemplo.com bash bootstrap-hostinger.sh "COLE AQUI O CONTEÚDO DE gumgum_deploy.pub"
     ```
   - **Servidor que já roda outros apps** (Nginx ou Nginx Proxy Manager, pm2 já instalado), como o usuário que roda
     o pm2: `deploy/setup-vm.sh`. Ele cria as pastas, instala o Node 22 via nvm se preciso (sem trocar o padrão),
     configura o site no proxy, gera o HTTPS com certbot e autoriza a chave:
     ```bash
     bash setup-vm.sh "COLE AQUI O CONTEÚDO DE gumgum_deploy.pub"
     ```
   Variáveis opcionais: `DOMAIN`, `PORT`, `CERTBOT_EMAIL` (veja o início de cada script).
4. **No GitHub** → Settings → **Environments** → *New environment*: crie `production` e `homologacao`. Em cada um,
   *Environment secrets* com os dados **daquele** servidor (use uma chave de deploy por servidor):

   | Secret               | Valor                                                  |
   |----------------------|--------------------------------------------------------|
   | `DEPLOY_HOST`        | endereço do servidor                                   |
   | `DEPLOY_USER`        | usuário SSH do deploy                                  |
   | `DEPLOY_SSH_KEY`     | conteúdo do arquivo `gumgum_deploy` (chave privada)    |
   | `DEPLOY_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 <endereço do servidor>` |

   Use sempre **Secrets** (nunca *Variables*, que ficam visíveis para quem lê o repositório).
   A exceção é a Variable `GOOGLE_CLIENT_ID` do login com Google, que é pública (veja [Contas](#contas-login-com-google)).
   Secrets e Variables cadastrados no **repositório** valem para os dois ambientes; os do Environment têm
   prioridade. (Se o servidor de testes já estava nos *Repository secrets*, basta criar os secrets do
   Environment `production` para a VPS nova: a homologação continua usando os do repositório.)
5. **No GitHub** → Settings → General → *Default branch*: `main`. Crie o branch `hmg` a partir da `main`
   (`git checkout -b hmg main && git push -u origin hmg`). Recomendado, em *Branches → Branch protection*:
   proteger `main` para receber mudanças só por pull request.
6. **Primeiro deploy:** Actions → "CI e deploy" → *Run workflow* (branch `main` para a produção, `hmg` para a
   homologação), com `import_sets` = `ST-01 ST-02` para já importar as cartas reais num servidor novo. Depois
   disso, todo push na `main` ou na `hmg` publica sozinho no ambiente correspondente.

Enquanto os secrets de um ambiente não existirem, o deploy nele é pulado com um aviso (os testes continuam rodando).
Cada ambiente tem o seu banco: decks, contas e partidas da homologação não vão para a produção.

### Operação (no servidor)

```bash
pm2 logs gumgumfight        # logs
pm2 restart gumgumfight     # reiniciar
```

(Na VPS preparada pelo `bootstrap-hostinger.sh`, o app roda no usuário `gumgum`: como root, use
`sudo -u gumgum pm2 logs gumgumfight`, ou entre com `ssh gumgum@<IP>`.)

Para importar mais coleções, use `import-cards.mjs` do release atual com o `DB_PATH` do banco compartilhado
(para `--spoilers`, informe também `DATA_DIR=<release>/data`; o app no pm2 já recebe essa variável);
para desligar as imagens, defina `CARD_IMAGES=off` no ambiente do app e recarregue-o no pm2.

## Montando decks

Na barra do topo (ou no menu ☰, no celular), **Montar decks** abre o construtor:

1. **Novo deck** → escolha o Líder (o catálogo mostra só Líderes até você escolher um). Os decks salvos (seus,
   da comunidade e prontos) ficam no menu suspenso do cabeçalho, com busca por nome ou Líder.
2. Clique nas cartas para adicionar e use o botão direito (ou os botões −/+ na lista) para remover. Por padrão
   aparecem só cartas com a cor do Líder. Dá para filtrar por nome/texto, cor, tipo, custo e coleção (no
   celular, atrás do botão **Filtros**; a busca e os filtros ficam presos no topo enquanto o catálogo rola).
   Com o mouse sobre uma carta (no catálogo, no Líder ou na lista do deck), ela aparece ampliada ao lado, com
   o texto do efeito; no toque, segure o dedo na carta para abri-la ampliada.
3. O painel à direita mostra o total, a curva de custo, os Counters e os problemas do deck. **Salvar** grava
   no banco. Decks incompletos ficam salvos como rascunho e aparecem desabilitados no menu.

Regras verificadas: 1 Líder, exatamente 50 cartas, no máximo 4 cópias por número e toda carta com ao menos uma
cor do Líder. Cartas cujo efeito ainda não é automatizado aparecem com ⚙: elas entram no jogo, mas sem o efeito.
Decks prontos (`data/decks`) não são alterados: ao mexer em um, o construtor cria uma cópia.

### Formatos

A partida é sempre num formato, escolhido no menu, e os dois decks precisam valer nele (contra o bot,
filas e salas online; quem entra numa sala privada joga no formato dela). O servidor confere de novo antes de
começar uma partida online e antes de gravar uma partida nas estatísticas.

- **Extra Grand Battle (EGB):** todas as cartas lançadas, menos as banidas.
- **Standard:** além das banidas, ficam de fora as cartas com o ícone de bloco ① (OP-01 a OP-04 e ST-01 a ST-09),
  que rotacionaram em 1º/04/2026, salvo as exceções oficiais (bloco X e cartas tratadas como bloco ④).

As cartas banidas (com data de início, quando a proibição ainda não vale), os pares proibidos e as exceções da
rotação ficam em `packages/engine/src/formats.ts`: atualizar a lista é só mexer lá. A data de início conta a partir da
meia-noite no horário de Brasília. Para uma carta voltar ao jogo, basta tirá-la da lista.

Nos torneios, o deck precisa valer **no início do torneio**: com data de início marcada depois de um banimento, a
inscrição com a carta já é recusada (e adiar o início para depois do banimento é recusado se algum inscrito tiver a
carta). Se a carta entrar na lista depois da inscrição, o jogador vê o aviso para trocar de deck e o organizador vê
quem está nessa situação; o início à mão é bloqueado até resolver, e no início automático essas inscrições são
canceladas (com aviso por notificação). O construtor mostra em quais
formatos o deck vale, marca no catálogo as cartas banidas (🚫) e rotacionadas (①), e o menu desabilita os decks que
não valem no formato escolhido.

**Spoilers** (cartas anunciadas e ainda não lançadas, veja [Spoilers](#spoilers-coleções-ainda-não-lançadas)) não fazem
parte de formato nenhum: valem na fila casual, mas **nunca na ranqueada**, que só aceita cartas já lançadas. Nos
torneios, nas salas privadas e no treino contra o bot, quem cria escolhe entre cinco opções:

| Opção | Banidas | Rotacionadas (bloco ①) | Spoilers | Estatísticas e meta |
|---|---|---|---|---|
| **Extra Grand Battle** | não | sim | não | sim |
| **Extra Grand Battle + EB05** (próxima coleção) | não | sim | só a próxima coleção | não |
| **Standard** | não | não | não | sim |
| **Standard + EB05** (próxima coleção) | não | não | só a próxima coleção | não |
| **Livre (vale tudo)** | sim | sim | sim | não |

Fora do Livre, "+ spoilers" quer dizer **só a próxima coleção a ser lançada**, e as telas mostram o nome dela no lugar
de "spoilers" ("Standard + EB05"). A próxima coleção sai sozinha dos arquivos `data/spoilers` (campo `release`): entre as
coleções que ainda têm cartas de spoiler no banco, a de lançamento mais cedo (starters e promos sem data não contam).
Quando ela é lançada e a [sincronização](#spoilers-coleções-ainda-não-lançadas) troca as cartas pelas oficiais, a
seguinte assume (hoje EB05; depois, OP18). As outras coleções de spoiler só valem no Livre (e na fila casual). A sala
privada guarda a coleção de quando foi criada, e o torneio grava a dele ao começar (o histórico continua dizendo
"+ EB05"); antes de começar, vale a próxima de agora. O servidor informa a coleção em `/api/config` (`spoilerSet`).

O **Livre** não é formato oficial: vale toda carta, inclusive as banidas e os pares proibidos. É só por diversão e não
existe nas filas. No menu, o formato (Standard ou EGB) vale para todos os modos, e as salas privadas e o treino contra
o bot têm a escolha **Cartas**: lançadas, + a próxima coleção (ex.: "+ EB05") ou Livre. Quem entra numa sala privada joga nas regras de quem a
criou. O servidor confere na fila ranqueada, na sala privada e na inscrição do torneio; o construtor avisa quando o
deck tem spoilers e o menu desabilita a ranqueada para ele.

Quem entra com a conta Google (veja [Contas](#contas-login-com-google)) edita os próprios decks em qualquer aparelho.
Sem login, cada navegador recebe um código aleatório (guardado no navegador) e só ele pode editar ou apagar os decks
que criou; limpar os dados do site faz perder a edição deles. Decks de outros jogadores aparecem em "Decks da
comunidade": dá para jogar com eles e duplicá-los.
**Exportar/Importar lista** usa o formato de texto da comunidade (`4xOP01-016`, uma carta por linha).

## Estatísticas

No menu, **📈 Estatísticas** mostra vitórias por Líder, por matchup (Líder x Líder) e por carta, com filtros por
formato (Standard ou Extra Grand Battle, escolhido no menu antes da partida), fila (casual ou ranqueada), oponente
(bot ou jogador), ordem do turno, período, tier e "só as minhas partidas". Partidas bot x bot gravadas por versões
antigas ficam fora das estatísticas de pessoas (só pelo filtro `by=bot` da API).

Só entram **Standard e EGB puros**: as partidas no Livre, nas salas, treinos e torneios com spoilers e as que têm
alguma carta de spoiler num dos decks (a coleção ainda pode estar incompleta) são gravadas, com replay, mas ficam de
fora das estatísticas (`match_seats.listed = 0`) e do meta dos torneios.

- **Coleta confiável:** no fim da partida o navegador envia o replay (seed, listas e ações). O servidor refaz a
  partida com o motor e só grava o que a simulação confirma; um replay que não confere é recusado (422). Assim, a
  mão inicial, as cartas compradas e jogadas e o vencedor nunca vêm do navegador.
- **Modelo de dados** (`apps/server/src/db.ts`): `matches` guarda a partida e o replay (permite recalcular tudo);
  `match_seats` é a tabela de fatos, uma linha por lado com todas as dimensões dos filtros (formato, fila, quem
  controla cada lado, Líderes, tier na hora da partida, quem começou, mulligan, vitória); `match_cards` tem, por
  carta do deck, as cópias, quantas estavam na mão mantida, quantas passaram pela mão e quantas vezes foi jogada;
  `deck_lists` guarda cada lista exata (hash), já que o deck salvo pode mudar depois; `players` tem o perfil de
  cada navegador e a recompensa.
- **Inspirado no Duels.ink:** resumo do meta em frases (mais jogado, melhor taxa entre Líderes com amostra suficiente,
  muito jogados mas perdendo, vantagem de quem começa), aba **Tendência** (participação semanal de cada Líder, quem
  sobe e quem cai), matriz de matchups com o espelho na diagonal (taxa de quem começou) e um **mínimo de partidas**
  para uma linha aparecer (como o mínimo de exibição deles).
- **Cartas:** vitórias com a carta no deck, o **lift** (vitórias com a carta no deck menos as do Líder em geral), na mão inicial, comprada, não comprada e jogada, e o "Δ comprada"
  (vitórias quando comprada menos quando não comprada), que mostra se a carta ajuda quando aparece.
- **Tiers e recompensa:** cada jogador tem uma recompensa em Beries; o tier é a faixa em que ela está
  (`apps/server/src/stats/catalog.ts`: East Blue até ฿ 5.000, Paradise até ฿ 20.000, Novo Mundo, Supernova,
  Shichibukai e Yonkou). Na ranqueada a recompensa sobe e desce no estilo Elo (vencer quem vale mais rende mais).
  O tier gravado é o da hora da partida. Partidas enviadas pelo navegador são sempre casuais; as online são gravadas
  pelo próprio servidor de partidas (modo `online`), o único que grava a ranqueada.
- O jogador é a conta Google ou, sem login, o navegador (o mesmo código de dono dos decks). O nome do cartaz de
  "WANTED" é o nome público e pode ser trocado na tela de estatísticas (o nome da conta Google não aparece para os outros).

### Meta global (TCG Matchmaking)

Com `GLOBAL_STATS_API_KEY` configurada, a tela de Estatísticas ganha o escopo **🌍 Global**: as filas ranqueadas do
**TCG Matchmaking** (a ranqueada por Discord do OPTCGSim, a maior fonte de partidas online do jogo), publicadas
pela **OPTCG Logpose API** do Matheus (`https://optcg-api.vercel.app/docs`). É aberto a todo mundo, sem plano.

- **Filtros no lugar do nome das filas:** a API chama as filas de "LW Standard 1Billion", "OP17" etc.; a tela mostra
  três escolhas e monta o nome a partir delas (`apps/web/src/globalQueues.ts`). **Período:** últimos 7 dias (as filas
  "LW", Last Week, uma janela móvel), a temporada (OP17, o total acumulado) ou a fila especial; **formato:** Standard ou
  Extra Grand Battle (o Extra Regulation deles); **recompensa dos jogadores:** todos, 1 bilhão+ ou 2 bilhões+ (o
  rating de lá). Só aparecem as opções que existem para o resto da escolha, e uma combinação que não existe cai na
  mais próxima.
- **Abas:** **Líderes** (com a posição por partidas e a seta de subiu/desceu, mais a variação da taxa de vitória),
  **Por Líder** (como o "By leader" do OPlay: escolha com busca, arte, números principais e os matchups em artes, com
  as vitórias começando e como segundo, o espelho e a contagem de favoráveis, equilibrados e desfavoráveis; clicar
  num adversário abre a página dele), **Matchups**, **Tendência** e **Comparar** (o mesmo Líder aqui e lá,
  participação e vitórias, com a diferença em pontos). "Aqui" é o que quem pede vê (Geral, ou Pro com o plano), no
  formato equivalente da fila (Extra Regulation = EGB; a Special Queue não compara). Quem começou só é conhecido numa
  parte das partidas, então as contagens de primeiro e de segundo vêm separadas.
- **O navegador nunca fala com a API deles.** O servidor busca a cada `GLOBAL_STATS_SYNC` horas (padrão 6; a API
  entrega uma URL assinada de 1 h do JSON de cada fila, baixada na hora e nunca guardada), grava o último JSON de
  cada fila (`global_stats_queues`) e um resumo diário dos Líderes (`global_stats_history`), e as rotas
  `GET /api/stats/global` (Líderes, a matriz dos 10 mais jogados e a posição anterior), `/global/matchups?leader=`
  (os matchups de um Líder; a fila inteira teria milhares de pares), `/global/trend` e `/global/compare`
  (`apps/server/src/stats/global-routes.ts`) só leem o banco. Se `lastModified` não mudou, o JSON não é baixado de
  novo. Com a API fora do ar, a tela continua com o último instantâneo (a data aparece no rodapé).
- **Subiu/desceu:** a posição de hoje é comparada com o resumo de 7 dias antes; enquanto a fila não tem uma semana de
  coleta, com o resumo diferente mais recente (a data aparece acima da tabela). Resumos iguais ao atual (a API não
  mudou) não contam.
- **Tendência própria:** a API só tem a foto atual. Numa fila "LW", cada semana é o último resumo dela (a janela de
  7 dias); numa fila da temporada, as partidas da semana são a diferença entre o resumo do fim da semana e o do fim
  da anterior. Um admin força uma rodada do sync com `POST /api/admin/stats/global/sync`.
- A aba **Por Líder** existe também nas estatísticas daqui, com as mesmas artes e números, a quantidade de listas e
  um atalho para as cartas do Líder. Aqui, onde temos as listas de cada partida, ela ganha também **Cartas no deck**
  (a fração das partidas do Líder com a carta e as barras de 1 a 4 cópias), o **Deck médio** (as cartas mais usadas,
  com as cópias mais comuns, até 50) e os **Decks populares** (as listas mais jogadas, com vitórias, partidas e
  jogadores), cada um com **Abrir no construtor** (`GET /api/stats/decks?leader=`, `apps/server/src/stats/decks.ts`).
  Cada lista pesa pelas partidas que jogou. No Global essas partes não existem: o TCG Matchmaking não publica as listas.

## Multiplayer online

A tela inicial tem um card para cada modo: **Ranqueada**, **Partida rápida** (casual), **Sala privada** (criar uma
sala gera um código de 6 letras e um link `/?sala=CÓDIGO` para enviar a quem vai jogar), **Contra o bot** e
**Torneios**. Todos usam o **deck equipado** e o formato escolhidos na faixa acima dos cards. Quem recarrega a página ou
troca de aparelho encontra "Voltar à partida" no topo da mesma tela.

Os cards mostram ao vivo quantas partidas estão em andamento e quantas pessoas estão na fila de cada modo, e o
cabeçalho mostra quantas pessoas estão conectadas. Esses números vêm de `GET /api/online/stats` (só contagens, sem
nomes), que a tela inicial consulta a cada 10 s enquanto a aba está visível (como toda consulta periódica do app,
sem sobrepor pedidos e espaçando as tentativas quando o servidor não responde; `apps/web/src/poll.ts`). Essa consulta também é o sinal de
presença: quem fecha a tela inicial sai dos "conectados" depois de 30 s. Jogadores conectados a uma partida, quem
está na fila e os espectadores também contam.

- **O servidor é a autoridade.** Ele guarda o estado completo e aplica as ações com o motor; cada jogador recebe só a
  própria visão (`packages/engine/src/view.ts`): mão do oponente, decks e Vida virada para baixo chegam como cartas
  escondidas, sem seed nem RNG. Os ids das cartas viram apelidos aleatórios por partida, porque os ids do motor seguem a
  ordem da lista do deck. Uma ação com uma carta fora de vista é recusada.
- **Pular uma etapa também conta algo.** As decisões que dependem de informação escondida abrem sempre para o dono,
  mesmo quando só há uma resposta: a etapa de Counter (sem Counter na mão), a carta que sai da Vida (sem [Trigger]),
  as perguntas "pagar X?" cujo custo lê a mão (sem carta que sirva) e as escolhas na mão ou no deck (sem carta válida).
  O oponente e o espectador veem a mesma decisão e o mesmo log nos dois casos, e o bot responde a elas depois de um
  tempo aleatório, para a pressa não contar o que ele tinha.
- **Embaralhamento:** as partidas online usam um RNG de 128 bits (sfc32) com seed do `crypto`. A seed de 32 bits das
  partidas locais poderia ser descoberta por força bruta a partir da mão inicial. Replays e estatísticas antigos não mudam.
- **Relógio:** cada jogador tem **17:30** na partida inteira. O tempo só corre quando a ação ou a decisão (incluindo
  mulligan, Blocker, Counter e escolhas de efeitos) é daquele jogador. Sem tempo, ele perde. Se o jogador da vez ficar
  2 minutos desconectado, perde por abandono.
- **Ranqueada:** só com login Google e só com decks sem cartas ⚙ (efeito ainda não automatizado). O pareamento junta
  recompensas parecidas e a faixa abre com o tempo de espera.
- **Sem desfazer, Auto ou pausa** no online. Chat da partida (mensagens curtas, com palavrões censurados no servidor, e
  emotes de uma lista fixa; em Configurações dá para esconder o que o oponente manda), revanche nas salas privadas e
  o replay completo para baixar no fim.
- **Decklist do oponente:** no resumo do fim de qualquer partida (bot ou online; em replays e para quem assiste, um
  botão por jogador), um botão abre a lista completa do deck adversário como imagem (a mesma peça das decklists do kit de divulgação dos
  torneios, 1080×1350) para baixar e compartilhar, e em texto para copiar e importar no construtor de decks. **Nas partidas
  de torneio, não:** o fim da partida não revela a mão nem o deck do oponente, o botão não aparece e o replay não sai da
  sala; as listas (e os replays, na página do torneio) só se abrem quando o torneio termina.
- **Proteção contra abuso:** abrir salas não exige login, então há tetos: salas ativas no servidor
  (`ONLINE_MAX_ROOMS`), salas de treino contra o bot (`ONLINE_MAX_BOT_ROOMS`), e por IP (16 salas ou lugares na fila
  ao mesmo tempo e 60 criações a cada 10 min; `apps/server/src/online/lobby.ts`, `DEFAULT_LIMITS`). O Nginx dos scripts
  de deploy ainda limita `/api/` a 30 requisições/s por IP (rajada de 100) e 64 conexões simultâneas por IP.
- **Cache:** o torneio completo (`GET /api/tournaments/:id`, consultado a cada 5 s por jogador), as estatísticas e a
  lista de partidas para assistir (`GET /api/online/live`, a cada 5 s) ficam em cache no servidor, invalidado a cada
  mudança, e saem com `ETag` (o navegador recebe 304 quando nada mudou).
- **Espectadores:** o estado de cada jogada é calculado e serializado uma vez por visão e enviado como está a todos
  os espectadores com a mesma visão (fan-out compartilhado): 100 espectadores numa sala custam o mesmo que 1.
- **Transporte:** SSE (`EventSource`) do servidor para o navegador e POST para as ações. Funciona atrás do Nginx / Nginx
  Proxy Manager sem configuração extra (header `X-Accel-Buffering: no` e um `ping` a cada 20 s, abaixo do
  `proxy_read_timeout` de 60 s).
- **Deploy no meio de uma partida:** as salas ficam gravadas na tabela `live_matches` (seed, decks e ações). O processo
  novo refaz cada partida com o motor e os navegadores reconectam sozinhos; o tempo fora do ar não conta para ninguém.
- Código: `apps/server/src/online/` (`room.ts`: uma partida e o relógio; `lobby.ts`: salas, filas e gravação;
  `routes.ts`: rotas e SSE) e `apps/web/src/game/useOnlineGame.ts` (canal e ações).

### Modo espectador

No menu, **Assistir partidas** lista as partidas online em andamento (ranqueadas primeiro), atualizada a cada 5 s.
Qualquer pessoa assiste, com ou sem login. Salas privadas não aparecem na lista: para assisti-las é preciso o código
da sala. Jogadores e espectadores veem quantas pessoas estão assistindo (👁); na revanche de uma sala privada, os
espectadores seguem para a partida nova.

- **O que o espectador vê:** a visão pública da mesa (`viewFor` com `viewer = null`): campo, descarte, Vida virada para
  cima, cartas reveladas e o log público. Mãos, decks e Vida virada para baixo chegam escondidas.
- **Ver mãos (Streamer e Admin, só em torneio e em sala privada liberada):** nas partidas de torneio e nas salas
  privadas em que quem criou marcou **Liberar as mãos para transmissão** (no card de Sala privada), a lista e a mesa
  têm o botão **Ver mãos**, que mostra as mãos dos dois jogadores (decks e Vida continuam escondidos). Assim um streamer
  combina uma partida entre dois amigos e transmite com as mãos. Os dois jogadores veem o aviso "📡 Mãos liberadas" na
  mesa, e a revanche mantém a escolha. Fora disso, ninguém vê a mão do oponente. O servidor confere o perfil da conta,
  a partida e recusa para quem está jogando a própria partida. Com as mãos, a mesa chega **atrasada** (ações, relógio, chat, emotes e resultado): o atraso escolhido nas
  opções do modo transmissão (padrão 3 min, **nunca menos de 1 min**), para a partida poder ir para uma live sem o
  oponente ver a mão do outro pela transmissão; a mesa mostra o aviso "⏱ N min de atraso". Sem as mãos, ao vivo.
  Exceção: o organizador (ou um admin) pode marcar no torneio **Mãos ao vivo na transmissão**; nas partidas desse
  torneio vale o atraso escolhido pelo streamer, até nenhum (as mãos saem ao vivo). A decisão é do organizador: serve
  para eventos em que os jogadores não assistem à live durante a partida. Salas privadas continuam com o mínimo de 1 min.
- **Interagir assistindo:** quem assiste toca numa carta à vista para ampliá-la e ler o efeito (no computador, passar
  o mouse mostra a carta no painel lateral), abre o descarte dos dois jogadores e o histórico, e o botão **Chat** da
  faixa do espectador esconde ou mostra as mensagens e emotes dos jogadores só para si (lembrado no navegador).
- **Modo transmissão (OBS, Streamer e Admin):** em **Assistir partidas**, o painel **Modo transmissão** cria um link
  secreto (`/?transmissao=<chave>`) para colocar no OBS como **Fonte de navegador** (1920 × 1080). A fonte do OBS não
  tem o login do Google: a chave faz esse papel, só para assistir. Cada partida da lista ganha o botão **📡 Transmitir**,
  o campo do código de sala privada também (essas salas não aparecem na lista), e o menu de qualquer partida aberta
  (jogando ou assistindo) tem **📡 Transmitir esta partida**: a tela de transmissão
  troca para ela sozinha (consulta a escolha a cada 3 s). Opções do painel:
  - **Atraso** (sem atraso, 1, 2, 3, 5 ou 10 min);
  - **mãos dos jogadores** nas partidas de torneio e salas privadas liberadas que ele assiste (sempre com pelo menos
    1 min de atraso, salvo nos torneios com **Mãos ao vivo na transmissão**, em que vale o atraso escolhido, até
    nenhum; nas outras partidas, a mão do oponente nunca aparece);
  - **a própria mão** nas partidas que ele joga (a do oponente nunca aparece; vale o atraso escolhido, até nenhum);
  - **atraso nas partidas de torneio** mesmo sem as mãos (sem essa opção, sem mãos é ao vivo);
  - **chat dos jogadores** na live.

  A tela não tem menus nem botões, mostra o tipo de partida (ou o torneio), o atraso e quantos assistem, e põe em
  destaque, grande e por alguns segundos, a carta que acabou de ser jogada, usada no Counter ou que ativou um efeito.
  Mudar a partida ou uma opção reconecta a tela; na revanche de uma sala privada, ela segue para a partida nova.
  **Gerar novo link** invalida o anterior; a conta que perde o perfil perde o link.
- **Transmitir o treino contra o bot:** em **Contra o bot**, quem entrou com o Google pode marcar **Transmitir esta
  partida**. A partida roda no servidor, que joga pelo bot (decidindo só com a visão do bot), e aparece na lista para
  assistir. "Quem começa" vale como no treino local; a seed e o desfazer ficam só no treino no navegador. Entra nas
  estatísticas como partida contra o bot. Com a transmissão lotada (`ONLINE_MAX_BOT_ROOMS`), o treino roda no
  navegador, com um aviso na mesa. `ONLINE_BOT_ROOMS=off` tira a opção do menu e essas salas da lista.

### Perfis (Player, Streamer, Organizador, Admin, Dev)

Cada conta Google tem um perfil (coluna `users.role`): **Player** (padrão: joga e assiste sem ver as mãos),
**Streamer** (assiste vendo as mãos, com atraso, e usa o modo transmissão), **Organizador** (cria torneios e gerencia os que criou), **Admin** (tudo
isso, gerencia qualquer torneio, muda os perfis e vê os relatos de partidas em **Administração**, no menu) ou **Dev** (tudo do Admin e as
funções de desenvolvimento). Sem login, a pessoa assiste como Player.

O primeiro admin vem da variável `ADMIN_EMAILS`: quem entra com um desses e-mails (verificado pelo Google) vira Admin
no login (um Dev continua Dev). Em produção, crie a *Variable* `ADMIN_EMAILS` no GitHub (como a `GOOGLE_CLIENT_ID`);
o próximo deploy a grava em `shared/deploy.env`. Quem já estava logado precisa sair e entrar de novo. Um admin não
muda o próprio perfil, exceto para se promover a Dev.

### Funções de desenvolvimento (só Dev)

Para o público em geral o app esconde o que serve só ao desenvolvimento. Essas funções aparecem apenas para o perfil
**Dev**:

- A tela **Cobertura das cartas** (o endpoint `GET /api/coverage` continua público).
- **Opções de teste** no menu (seed do embaralhamento). Baixar e assistir a um replay é para todos (um jogador pode
  mandar o replay a um Dev ao relatar um problema).

## Torneios

Em **Torneios** (no menu), contas com perfil **Organizador** ou **Admin** criam torneios; qualquer conta Google se
inscreve. O organizador que criou o torneio gerencia o dele; um Admin gerencia qualquer um.

- **Criação:** nome, descrição e regras, formato (Standard, Extra Grand Battle ou Livre) e se aceita spoilers (veja
  [Formatos](#formatos); o Livre sempre aceita), estrutura, limite de jogadores e
  início previsto. Dá para editar tudo enquanto as inscrições estão abertas.
- **Check-in, início automático e W.O. por ausência** (torneios com data de início; ligado por padrão ao criar):
  - O **check-in** abre 30 minutos antes do início, na página do torneio e num atalho no alto da tela inicial, para
    quem está inscrito.
  - Na hora marcada o torneio **começa sozinho**: a rodada 1 é sorteada entre todos os inscritos e a sala de cada mesa
    fica pronta para os dois jogadores (o atalho da tela inicial vira **Entrar na sala**). O organizador ainda pode
    começar antes à mão.
  - Em cada rodada, cada jogador tem a **tolerância escolhida pelo organizador** (1 a 60 minutos; padrão 5) para
    entrar na sala. Quem não entra **perde por W.O.** e sai do torneio; se nenhum dos dois entra, **os dois perdem**
    (W.O. duplo: na chave, a mesa seguinte fica com bye). Na rodada 1, o check-in feito antes já vale como presença.
    Depois do primeiro jogo de uma série a tolerância não corre mais (o organizador lança o placar, se precisar).
  - Durante o torneio, a tela inicial mostra a sua partida da rodada (mesa, oponente e prazo) com o atalho para a
    sala, ou avisa que você espera a próxima rodada.
- **Não há empate** (como no One Piece TCG): toda partida tem um vencedor.
- **Tempo:** cada jogador tem 17min30s por jogo, que só corre na vez dele, e quem zera o tempo perde. Por isso as
  regras oficiais de tempo esgotado (turnos extras e o desempate por Vida, cartas no deck, Personagens e última
  Vida comprada) não se aplicam aqui.
- **Estruturas:**
  - **Suíço:** todos jogam todas as rodadas, contra quem tem a mesma pontuação e sem repetir confrontos. Vitória vale
    3 pontos, e o bye (número ímpar de jogadores) conta como vitória e vai para o último colocado que ainda não teve
    um. Desempates na ordem das regras oficiais da Bandai: OMW (% de vitórias dos oponentes, mínimo de 33% por
    oponente), OOMW (média do OMW dos oponentes) e sorteio (a ordem sorteada no início do torneio). O número de rodadas é escolhido pelo
    organizador ou, em branco, calculado no início (⌈log₂ jogadores⌉). As partidas do suíço são jogo único ou melhor
    de 3.
  - **Top cut (opcional, no suíço):** depois da última rodada, os melhores colocados (Top 2 a Top 64; quem desistiu
    fica de fora) vão para uma eliminação simples semeada pela classificação (1º x último do corte, e o 1º e o 2º só
    se cruzam na final).
  - **Eliminação simples:** chave sorteada no início, do tamanho da próxima potência de 2; as vagas que sobram viram
    byes para os primeiros cabeças de chave.
- **Melhor de 3 / melhor de 5 na eliminatória:** o organizador escolhe a partir de qual fase (toda a eliminatória,
  rodada de 32, oitavas, quartas, semifinal ou final) as partidas passam a ser melhor de 3 e melhor de 5. Ex.: melhor
  de 3 a partir das quartas e melhor de 5 na final.
- **Inscrição:** com um deck válido no formato (e sem spoilers, salvo nos torneios que aceitam spoilers, e aí só da próxima coleção a ser lançada; no Livre, todos). A lista fica **congelada** na inscrição (mudar o deck depois não muda
  o do torneio; inscreva-o de novo para trocar, só enquanto as inscrições estão abertas: depois que o torneio começa,
  ninguém troca nem o deck nem a lista). Enquanto as inscrições estão abertas, os outros jogadores **não veem** qual
  deck cada um inscreveu (só o organizador, um Admin e o próprio jogador); quando o torneio começa, o Líder de cada um
  aparece para todos. As listas completas ficam visíveis para o organizador e, quando o torneio termina, para todos.
- **Partidas:** cada jogador clica em **Jogar partida** na página do torneio; quem entra primeiro espera o oponente
  na sala online (fila `tournament`, com relógio e regras das partidas online). Numa melhor de N, cada jogo é uma
  sala: o placar da série soma sozinho, quem perdeu um jogo começa o seguinte e a tela de fim de jogo tem o botão do
  próximo jogo. A partida aparece em **Assistir partidas** com o nome do torneio e a fase. Cada jogo entra nas
  estatísticas na fila **Torneio**.
- **Organização:** o organizador lança o placar de qualquer partida (W.O., queda de conexão, partida jogada fora do
  site), tira jogadores e avança: próxima rodada do suíço, início do top cut, próxima fase da chave e, depois da
  final, o encerramento. **Encerrar agora** termina antes.
- **Auditoria:** todo jogo disputado nas salas fica gravado com o replay. Em cada partida da aba Rodadas, **Jogos
  gravados** lista os jogos (inclusive os que não contaram no placar) e o organizador e os Judges podem
  **assistir ao replay** ou abrir as **📜 Jogadas** do jogo (o que cada jogador escolheu, veja abaixo); os dois jogadores
  também podem assistir ao replay, mas só quando o torneio termina (o replay traz as duas listas, e as
  listas ficam fechadas até o fim: no resumo do fim de cada jogo não há "Decklist do oponente" nem "Baixar replay"). Ao fim de qualquer partida (contra o bot, online, ranqueada ou de torneio), o jogador logado
  pode **relatar um bug** (botão ⚑ abaixo de "Baixar replay"): a carta, a interação que deu problema, o que deveria ter
  acontecido e se quer ser avisado da correção. O relato, com o replay, aparece na aba **Relatos** do torneio para o
  organizador e em **Administração → Relatos de partidas** para Admin e Dev, que o resolvem com uma nota; quem pediu o
  aviso recebe uma notificação.
- **Judge e organizador na mesa:** o organizador escolhe os Judges do torneio pelo apelido (sem Judge escolhido, ele
  mesmo faz o papel; Admin e Dev também podem). Para agir numa partida, entre pela página do torneio ou pelo lobby em
  **⚖ Entrar como Judge** (quem abrir a mesa pela lista "Ao vivo" ganha o mesmo botão na faixa do espectador). O
  painel do Judge, no canto da mesa, tem o guia **"O que posso fazer como Judge?"**:
  - **⏸ Pausar** congela a partida (relógio parado, nenhuma jogada aceita, o chat continua). Os jogadores também
    podem **⚖ Chamar o Judge**: escolhem com um toque o que aconteceu (uma carta não fez o que devia, escolhi e não
    aconteceu o esperado, cliquei errado, a partida travou, dúvida de regra, problema com o oponente), tocam na linha
    do histórico da jogada do problema e, se quiserem, escrevem uma frase. O Judge e o organizador recebem a
    notificação, e o chamado aparece no topo do painel do Judge com **📜 Ver a jogada** (a lista abre na jogada
    apontada, em destaque).
  - **📜 Jogadas e escolhas** (não pausa a partida): cada jogada, da mais recente para a mais antiga, com a pergunta
    que estava aberta, o efeito que a abriu, as opções que havia (✔ no que o jogador escolheu), as cartas vistas e o que
    aconteceu depois, inclusive as cartas escondidas. Uma escolha que não gerou nenhuma linha no histórico fica
    marcada. Serve para saber se o problema foi do app ou do jogador (ex.: o efeito pedia um Personagem de 4000 do
    descarte: o Perospero estava entre as opções? Ele foi o escolhido? Ele voltou ao campo?). Há filtro por carta ou
    jogador e "Só escolhas e respostas". Depois do jogo, o mesmo vale em **📜 Jogadas**, em Jogos gravados.
  - **🛠 Modo manual** (pausa a partida; os jogadores não confirmam nada e cada correção pede o motivo, que vai para
    as Ocorrências do torneio):
    - **Voltar jogada:** "Escolher a jogada para voltar" abre as jogadas da partida inteira; "Voltar para antes desta"
      desfaz a jogada e todas as seguintes (a partida é refeita até ali, com as mesmas compras e embaralhamentos).
      Depois de retomar, o jogador refaz a jogada.
    - **No lugar do jogador:** responde a pergunta aberta (escolher os alvos, bloquear ou não, usar ou não Counter,
      sim/não, uma opção, a carta da Vida, concluir um efeito manual) ou encerra o turno, quando o app travou ou não
      ofereceu a opção certa. A resposta fica marcada nas jogadas como dada pelo Judge.
    - **Corrigir a mesa** pelo lado de cada jogador: comprar, embaralhar, mover uma carta entre as zonas, K.O., virar e
      desvirar, ±1000 de poder e DON!!.
  - **▶ Retomar** libera a partida (e sai do modo manual): o Judge fecha o chamado escolhendo o desfecho, sem precisar
    escrever (sem problema no app / erro do jogador, jogada refeita / erro do app, com ou sem correção na mesa /
    dúvida de regra / conduta / outro, este com o relato). Depois de voltar jogadas ou corrigir a mesa, "erro do app"
    já vem marcado. **Erro do app abre sozinho um chamado de ajuste da plataforma** em Administração → Relatos de
    partidas (e na aba Relatos do torneio) assim que o jogo termina, com o replay, a jogada apontada, o relato do
    jogador e o que o Judge fez. **Warnings** valem o torneio
    inteiro; só o organizador elimina. Tudo fica na aba **Ocorrências** do torneio.
- **Correção de resultados:** um placar lançado errado pode ser corrigido em qualquer rodada, inclusive passadas (a
  classificação é recalculada). Na chave, corrigir quem venceu troca o jogador da partida seguinte, desde que ela
  ainda não tenha começado (senão, corrija ou zere antes a partida seguinte). Resultados do suíço não mudam depois
  que o top cut começa, porque ele foi semeado por eles.
- **Meta dos torneios:** a aba **Meta** da lista de torneios é um painel público com os torneios encerrados
  (filtro por formato e período): totais, último torneio com o campeão, próximos torneios, Líderes em destaque
  (taxa de vitória, inscrições e títulos), distribuição do meta, ranking de jogadores e torneios recentes
  (`GET /api/tournaments/meta?format=&days=`, em `apps/server/src/tournaments/meta.ts`). Usa só o que a página de
  cada torneio já mostra depois do fim; as vitórias contam séries, sem bye, derrota dupla e espelho.
- **Desistência:** o jogador (ou o organizador) pode tirá-lo do torneio; a partida pendente dele na rodada atual vai
  para o oponente e ele não é mais pareado.

## Contas (login com Google)

O único login é com a conta Google, pelo botão oficial do [Google Identity Services](https://developers.google.com/identity/gsi/web).
Não há senha nem cadastro: o botão entrega ao navegador um ID token assinado pelo Google, o servidor confere a
assinatura (com as chaves públicas do Google), o emissor, o Client ID e a validade, e abre uma sessão de 60 dias num
cookie `HttpOnly` / `SameSite=Lax` (e `Secure` em HTTPS). O banco guarda só o id da conta Google, nome, e-mail e foto
(`users`) e o hash do token de cada sessão (`sessions`). O login é opcional: sem ele tudo continua funcionando como antes.

- **No primeiro login**, os decks e o perfil de estatísticas criados naquele navegador passam para a conta. Se a conta
  já tinha perfil, as partidas do navegador vão para ele.
- **Foto da conta**: no menu da conta, "Trocar foto" (ou o clique no avatar) envia uma imagem própria no lugar da
  foto do Google. O navegador recorta o centro e reduz para 256×256 JPEG antes de enviar; o servidor aceita JPEG, PNG
  ou WebP (até 256 KB, tipo conferido pelos primeiros bytes) e guarda a imagem em `users.custom_picture`. Só o
  próprio usuário e os admins a veem (`/api/users/:id/picture`). "Usar a foto do Google" volta para a original.
- **Sair** apaga a sessão. Os decks continuam na conta (no navegador, aparecem como "da comunidade" até entrar de novo).
- Código: `apps/server/src/auth/` (verificação do token, sessões e rotas) e `apps/web/src/auth.tsx` (botão e estado).

### Configurar o Client ID (uma vez)

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie (ou escolha) um projeto e
   configure a **tela de consentimento OAuth** (tipo *Externo*; só os escopos básicos: e-mail, perfil e openid).
2. **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**. Em **Origens JavaScript
   autorizadas**, inclua `https://gumgumfight.app`, `https://gumgumfight.duckdns.org`, `http://localhost:5173` e `http://localhost` (o botão do
   Google exige as duas formas do localhost). Não é preciso URI de redirecionamento nem a chave secreta.
3. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). Ele não é segredo: vai para todo navegador.
   - **Desenvolvimento:** crie um arquivo `.env` na raiz do projeto com `GOOGLE_CLIENT_ID=...` (o arquivo é ignorado
     pelo git) e reinicie o `npm run dev`.
   - **Produção e homologação:** no GitHub → Settings → Secrets and variables → Actions → aba **Variables** → *New
     repository variable* `GOOGLE_CLIENT_ID` (vale para os dois ambientes; para usar um Client ID diferente em um
     deles, cadastre a Variable no Environment). O próximo deploy grava o valor em `shared/deploy.env` na VM.

Sem `GOOGLE_CLIENT_ID`, o botão não aparece e `POST /api/auth/google` responde 503.

## API para parceiros (apps que agem em nome do usuário)

Um app parceiro (um construtor de decks, por exemplo) pode criar e atualizar os decks do usuário, ler as partidas e
os replays dele e consultar as estatísticas pessoais, com autorização dele. A identidade vem num **token de acesso**
enviado em `Authorization: Bearer <token>`: o token sempre aponta para uma conta Google e carrega **scopes** que
limitam o que ele pode fazer. Sem login nada muda; quem não vincula nada também não. Código em
`apps/server/src/partners/` (tokens e middleware, OAuth, webhook, partidas) e na tela "Apps conectados"
(`apps/web/src/components/ConnectedApps.tsx`).

### Deep link do construtor (sem vínculo)

`https://gumgumfight.app/?deck=<lista>&name=<nome>&format=<standard|egb>` abre o construtor já preenchido, como
deck novo **não salvo** (um link pode vir de qualquer lugar, então nada é gravado até o usuário clicar em Salvar):

- `deck`: o texto do "Exportar lista" (`1xOP01-001`, uma carta por linha, Líder incluído) em UTF-8, codificado em
  **base64url** sem `=`. Os números das cartas são os da optcgapi, sem sufixo de arte alternativa (`_p1`, `_r1`).
- `name` (opcional): nome sugerido, até 60 caracteres. `format` (opcional): só muda o aviso.
- Base64 inválido ou lista vazia: o construtor abre normalmente, com um aviso. Linhas não reconhecidas aparecem como
  no "Importar lista". Decodificador e testes: `apps/web/src/deeplink.ts`, `apps/web/test/deeplink.test.ts`.

### Tokens e scopes

Em ⚙️ Configurações → **Apps conectados** (só com login), o usuário gera um **token pessoal** (`ggf_pat_…`, até 10
ativos por conta), vê o que cada app pode fazer e quando foi usado pela última vez, e revoga. O token aparece uma
única vez; no banco fica só o `sha256`. Sair do site não revoga os tokens. Scopes (`profile` é sempre concedido):

| Scope | Libera |
|---|---|
| `profile` | `GET /api/auth/me` (só `{ user: { id, role: 'player' }, player: { id, name, bounty, tier } }`: nunca e-mail, nome ou foto do Google) e `GET /api/players/me` |
| `decks:read` | `GET /api/decks?mine=1` (os próprios, com `updatedAt`, `deckHash` e a validação por formato), `GET /api/decks/:id` (os próprios e os prontos) |
| `decks:write` | `POST /api/decks`, `PUT /api/decks/:id`, `DELETE /api/decks/:id` (só os próprios) |
| `matches:read` | `GET /api/players/me/matches`, `GET /api/matches/:id`, `GET /api/matches/:id/replay` e `POST /api/matches/:id/replay-link` (só partidas que o usuário jogou) |
| `stats:read` | `GET /api/stats*` (com `mine=1`, as próprias; sem ele, as consultas públicas de sempre) |

Regras do token, em qualquer rota:

- É uma **allowlist**: só as rotas acima aceitam token (`config: { scope }` no Fastify). Qualquer outra (admin, login,
  partidas online, torneios, `PUT /api/players/me`, `POST /api/matches`, os próprios `/api/tokens`…) responde
  **403 `token_not_allowed`**. Scope faltando: **403 `insufficient_scope`** (o scope que faltou vem em `errorParams`).
  Token inexistente, revogado, expirado ou um refresh usado como Bearer: **401 `invalid_token`**.
- Através de token, **toda conta age como Player**: o perfil real (admin, organizador, streamer) não vale. Cookie e
  `x-deck-owner` são ignorados na requisição com token.
- **120 requisições por minuto por token** (429 `rate_limited` com `Retry-After`). O header `Authorization` nunca vai
  para o log.
- Erros no mesmo formato de sempre: `{ error, errorCode }`.

Rotas específicas para apps:

- `GET /api/players/me/matches?since=<ISO>&limit=50&cursor=<id>`: partidas do jogador, mais novas primeiro
  (`limit` até 100; `cursor` = `id` do último item da página anterior; `nextCursor` vem na resposta). Cada item:
  `id, playedAt, mode, queue, format, seat, won, wentFirst, mulligan, turns, leader, oppLeader, oppController, deckId,
  deckHash, tier, bountyBefore, bountyAfter, tournamentId`. Nunca o nome nem o id do oponente.
- `GET /api/matches/:id`: resumo com `winner, turns, reasonKey, firstPlayer, replayVersion, you` (seu assento) e
  `seats[]` (`seat, leader, deckHash, cards[]` com `id, copies, opening, drawn, played`). O lado do oponente vem com
  `cards: null`, salvo em torneio já encerrado. O replay (`/replay`) traz `winner` e `reasonKey` no arquivo.
- `PUT /api/decks/:id` aceita `expectedUpdatedAt` no corpo (ou o header `If-Unmodified-Since`): se o deck mudou no
  site depois dessa data, responde **409 `deck_conflict`** com a versão atual em `current` (lista, `updatedAt` e
  resumo), em vez de sobrescrever. `POST` e `PUT` devolvem `updatedAt` (UTC, `AAAA-MM-DD HH:MM:SS`; mande-o de volta
  igual, ou em ISO) e `deckHash` (sha256 de `LÍDER|4xOP01-016|…` com as cartas em ordem alfabética, 16 hex: o mesmo
  das partidas, para casar deck e partida).

### OAuth (botão "Vincular" no app)

O mesmo resultado dos tokens pessoais, sem copiar e colar: **authorization code + PKCE (S256)**, access token de 1 h
(`ggf_at_…`) e refresh token de 90 dias com rotação (`ggf_rt_…`). O app precisa estar cadastrado
(`npm run oauth:client -- add <id> "<nome>" --redirect <uri> [--scopes "…"] [--webhook <url>]`; o `client_secret`
aparece uma vez; `list`, `secret`, `webhook` e `remove` completam o comando).

1. O app manda o usuário para `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256`.
   `redirect_uri` é comparada por igualdade exata com as cadastradas; `state` é obrigatório. `client_id` ou
   `redirect_uri` errados: página de erro, sem redirecionar; outros erros voltam com `?error=…&state=…`.
2. A tela de consentimento (uma tela do site; sem login, mostra o botão do Google) lista o que o app poderá fazer.
   **Permitir** gera um code de uso único, válido por 5 min, e volta para `redirect_uri?code=…&state=…`; **Cancelar**
   volta com `error=access_denied`. Quem já autorizou o app com os mesmos scopes pula a tela.
3. O backend do app chama `POST /api/oauth/token` (`application/x-www-form-urlencoded` ou JSON; credenciais no
   corpo ou em `Authorization: Basic`) com `grant_type=authorization_code, code, redirect_uri, client_id,
   client_secret, code_verifier` e recebe `{ access_token, token_type: 'Bearer', expires_in: 3600, refresh_token, scope }`.
   Usar o code duas vezes revoga os tokens do primeiro uso. 10 tentativas por minuto por cliente.
4. Renovação: `grant_type=refresh_token` devolve um par novo e o refresh usado deixa de valer; usar de novo um refresh
   já trocado revoga toda a cadeia daquele app para aquela conta (sinal de vazamento).
5. `POST /api/oauth/revoke` (`token, client_id, client_secret`) quando o usuário desvincula no app; 200 sempre.
   Na tela "Apps conectados" o app aparece com os scopes e "Revogar" apaga todos os tokens dele para a conta.

A API não tem CORS de propósito: o app chama o site do backend dele, nunca do navegador.

### Webhook "partida terminada"

Para apps cadastrados com `--webhook <url>` (só `https://` em produção), quando uma partida de um usuário que
autorizou o app (com `matches:read`) é gravada, o servidor faz `POST <url>` com
`{ event: 'match.finished', id, createdAt, userId, matchId, queue, format, won }` e os headers `X-GGF-Timestamp`
(segundos Unix) e `X-GGF-Signature` (`sha256=` + HMAC-SHA256 com o `webhook_secret` sobre `<timestamp>.<corpo>`).
O aviso é só um sinal: os dados vêm pelas rotas acima, com o token do usuário. Entrega depois da resposta, timeout de
5 s, sem seguir redirecionamentos; sem 2xx, tenta de novo 1 min e 10 min depois (em memória) e desiste com um log.
Tokens pessoais não recebem webhook.

### Replay embutido (iframe)

O app parceiro mostra o replay de uma partida dentro da página dele (histórico de partidas, página do deck) com a
mesa do GumGum Fight num iframe, sem reimplementar nada:

1. O backend do app chama `POST /api/matches/:id/replay-link` (token com `matches:read`; mesmas regras do
   `/replay`: só partidas que o usuário jogou, e de torneio só depois do fim). Corpo opcional:
   `{ lang: 'pt-BR', layout: 'tablet' | 'lateral', embed: true }`. Resposta **201**
   `{ url, token, matchId, expiresAt }`.
2. A página do app põe a `url` num iframe:
   `<iframe src="https://gumgumfight.app/replay/123?t=…&embed=1&lang=pt-BR" allow="fullscreen"></iframe>`.

O link (`t`) é assinado com HMAC-SHA256, vale **1 hora** e serve só para aquela partida, sem sessão: quem tiver o
link vê o replay até ele expirar, então gere um por exibição em vez de guardar. Expirado: `replay_link_expired`;
mexido ou de outra partida: `replay_link_invalid` (a página mostra o erro). Parâmetros da página:

- `embed=1`: sem o menu da mesa e sem os botões de sair e de baixar o replay (sem ele, a página funciona sozinha e
  "Voltar" leva ao site).
- `lang`: idioma da interface (`pt-BR`, `en`, `es`, `fr`, `de`, `ja`; `pt` e `en-US` também valem).
- `layout` (telas largas): `tablet` (a mesa em pé, com a Vida na lateral) ou `lateral` (jogadores à esquerda e à
  direita), como na visão do Streamer; sem ele, a mesa de sempre com o histórico ao lado.
- `autoplay=1`: começa rodando; sem ele, parado no início (passo a passo), com a barra do replay.

Só `/replay/*` pode ir para um iframe, e só nos sites de `REPLAY_EMBED_ORIGINS`
(`Content-Security-Policy: frame-ancestors 'self' <origens>`); o resto do site responde `frame-ancestors 'none'`
e `X-Frame-Options: DENY`. Imagens, CSS e textos vêm do nosso domínio; o replay chega com as definições só das
cartas usadas (`GET /api/replay/:id?t=`), então não há CORS. Na homologação só para apoiadores, o replay com link
assinado abre sem login.

**postMessage** (os dois lados conferem a origem): a página do app manda para o iframe
`{ type: 'seek', pos }` (posição = número de ações já aplicadas, de 0 ao total), `{ type: 'play' }` e
`{ type: 'pause' }`; o player responde para a janela-mãe, com `source: 'gumgumfight-replay'`,
`{ type: 'ready', pos, total }` ao abrir, `{ type: 'pos', pos, total }` a cada ação e `{ type: 'ended' }` no fim.

```js
const frame = document.querySelector('iframe');
addEventListener('message', (e) => {
  if (e.origin !== 'https://gumgumfight.app' || e.data?.source !== 'gumgumfight-replay') return;
  if (e.data.type === 'pos') progresso.value = e.data.pos / e.data.total;
});
frame.contentWindow.postMessage({ type: 'seek', pos: 40 }, 'https://gumgumfight.app');
```

Código: `apps/server/src/partners/replay-link.ts` (token, rotas e CSP), `apps/web/src/embed.ts` (endereço e
protocolo), `apps/web/src/components/ReplayEmbed.tsx` e `apps/web/src/game/useEmbedBridge.ts`. Testes em
`apps/server/test/partners.test.ts` e `apps/web/test/embed.test.ts`.

## Efeitos automáticos e cartas ainda não automatizadas

Toda carta da base é jogável:

- **Efeito automatizado:** cartas com script (`packages/engine/src/cards/scripts.ts`) resolvem tudo sozinhas.
- **Ainda não automatizado** (cartas com ⚙): o motor lê os momentos marcados no texto ([On Play], [When Attacking],
  [Activate: Main], [Main], [Counter], [Trigger], [On K.O.], [End of Your Turn]…). Na hora certa, o jogo pausa,
  mostra o efeito e avisa que ele ainda não é automático; a partida segue sem aplicá-lo (botão **Continuar**).
  O construtor de decks marca essas cartas, e elas não entram na ranqueada. (As antigas ferramentas manuais para
  aplicar o efeito à mão foram retiradas: a interface não as tem mais e o servidor recusa a ação `manual` nas
  partidas online para qualquer perfil; o motor ainda a aceita só para os testes.)
- **Cobertura:** a tela "📊 Cobertura das cartas" (no menu, só para o perfil Dev) e `GET /api/coverage` mostram, por coleção,
  quantas cartas são automáticas, quantas são manuais e como está a tradução. Na tela, só para o Dev:
  - **Coleções:** tocar numa coleção mostra as cartas ⚙ linha por linha (✓ entendida, ✗ não entendida) com o trecho
    onde o leitor automático parou destacado.
  - **Frases que faltam:** as frases que o leitor não entende na base inteira, com números, nomes e tipos trocados por
    marcadores, da que resolveria mais cartas para a que resolveria menos. Ensinar uma frase ao leitor
    (`packages/engine/src/cards/parser.ts`) automatiza todas as cartas da linha.
  - **Novas ⚙:** as cartas que entraram com efeito parcial ou manual (spoilers e `cards:import`) desde a última vez que o
    Dev marcou como vistas. O item do menu mostra quantas são ("Cobertura das cartas · 3 novas ⚙"). Texto que muda
    numa carta ⚙ (spoiler virando oficial com outra redação) a deixa nova de novo.
  - **Textos para o motor:** em cada carta ⚙ (ou pelo número de qualquer carta), o botão "Texto para o motor" abre um
    editor: o texto oficial e o que o leitor faz com ele de um lado; do outro, uma redação equivalente em inglês que o
    leitor entende, com a prévia ao vivo (cada linha ✓/✗, a situação da carta e a tradução gerada do que o leitor leu,
    para conferir que diz o mesmo que a carta). Gravar vale na hora, sem deploy, para partidas novas; a carta continua
    mostrando o texto oficial. Fica o histórico (quem e quando). Se o texto oficial mudar (errata, fonte nova), o texto
    para o motor deixa de valer até o Dev revisar. Só resolve o que o leitor já sabe fazer: mecânica nova continua
    precisando de código, e carta com script (`scripts.ts`) não usa texto para o motor.
  Fora do texto para o motor, uma carta deixa de ser ⚙ quando o leitor, um script (`scripts.ts`) ou uma correção de
  texto (`errata.ts`, `SOURCE_TEXT_FIXES`) passa a cobri-la, no próximo deploy.

Para checar a robustez depois de importar coleções novas (decks aleatórios de toda a base, simulações bot x bot
na linha de comando):

```bash
npm run simulate:all -w @gumgum/engine -- caminho/para/cards.json 300   # ou a URL de /api/cards
```

## Aprender a jogar (tutorial)

Para quem nunca jogou One Piece Card Game: **Aprender** no menu (ou o convite "Primeira vez aqui?" na home) abre a
**Rota do Aprendiz**, com 14 lições curtas em 4 capítulos (Fundamentos, O turno, Combate e Domínio). As lições rodam
na mesa de verdade, com cenários prontos montados pelo motor: um treinador explica cada passo, destaca as áreas da mesa
e pede uma jogada, travando as outras até a hora certa. Há também a anatomia da carta (toque e descubra), quizzes, um
glossário de termos e uma partida final contra o bot fácil com dicas. Não precisa de login; o progresso fica no
navegador e é guardado também no servidor (por conta ou por navegador). Quem termina as 14 lições ganha o título
**Aprendiz da Grand Line** (mostrado só no hub do tutorial). Fora das lições: **Dicas do treinador** nas partidas contra
o bot (opção nas Configurações, desligada por padrão), palavras-chave clicáveis no texto das cartas e, para a
administração, o funil anônimo das lições (onde as pessoas desistem). Detalhes e como escrever uma lição nova:
[`docs/tutorial.md`](docs/tutorial.md).

## Como jogar

- **Mulligan:** no início, mantenha ou troque a mão (uma vez).
- **Jogar carta:** clique duplo numa carta destacada em verde na mão, ou selecione e use o painel "Ações".
- **DON!!:** clique na área de DON!! e depois no líder/personagem para anexar (+1000 de poder no seu turno).
- **Atacar:** selecione o líder ou um personagem ativo, clique em "⚔ Atacar" e escolha o alvo (líder ou personagem virado).
- **Defesa:** quando for atacado, o jogo pede Blocker, Counter e [Trigger] quando aplicável.
- **Desfazer** volta para antes da sua última ação. **Replay** baixa um `.json` com a seed, as listas dos decks e todas as ações.
- **Assistir replay** (no topo da página inicial e no menu): carregue o `.json` (escolher ou arrastar), veja o resumo
  (jogadores, Líderes, ações, turnos e, se quiser, o resultado) e assista no modo **automático** ou **passo a passo**.
  A barra de baixo tem ⏮ início, ◀ ação anterior, ▶/❚❚, ▶| próxima ação, ⏭ fim, a barra de progresso (pula para
  qualquer ação) e a velocidade (0.25× a 8×; em 8× sem animações). Atalhos: espaço, ← →, Home, End, + e −.
  Antes de cada ação, a mesa mostra o **clique/seleção do jogador** (contorno nas cartas e nos DON!! tocados, o toque e
  uma legenda como "Luffy: Atacar Zoro com Nami" ou "Nami: Não usar Counter"); a barra repete a frase por escrito. No
  passo a passo, o contorno fica parado na "Próxima ação" até você avançar. Para ver só a mesa, desligue "Cliques no
  replay" (nas configurações, ao abrir o replay ou no botão 👆 da barra).
  Replays antigos continuam abrindo (são convertidos para a versão atual); os que não trazem as listas precisam
  que os decks ainda existam.
- Em **Opções de teste** (no menu, só para o perfil Dev), a **seed** controla o embaralhamento: a mesma seed com as mesmas jogadas
  reproduz a mesma partida.

### Idiomas

A interface inteira (menu, mesa, construtor de decks, online, torneios, estatísticas, configurações e mensagens de erro)
está em **português do Brasil, inglês, espanhol, japonês, francês e alemão**. A troca é pela **bandeira** 🇧🇷 🇬🇧 🇪🇸 🇯🇵 🇫🇷 🇩🇪,
na barra superior (ou na gaveta ☰ no celular), em **⚙️ Configurações** e no menu da partida. Na primeira visita o app segue
o idioma do navegador (desconhecido → inglês); a escolha fica guardada neste navegador.

O **texto das cartas** sai traduzido só em português (tradução automática revisável, ver abaixo); nos demais idiomas aparece o
original em inglês, como nas cartas oficiais. Nomes de cartas, DON!!, Blocker, Rush, Counter, Trigger e K.O. não se traduzem.

## Estrutura

A documentação técnica completa do produto (stacks, banco, cartas, partidas, torneios, transmissão ao vivo,
infraestrutura e capacidade da VPS, com medições) está em [`docs/documentacao-tecnica.md`](docs/documentacao-tecnica.md).

```
packages/engine   Motor de regras em TypeScript puro (sem dependências), bot e testes
apps/server       API Fastify + SQLite (node:sqlite); serve a interface compilada em produção
apps/web          Interface React + Vite
apps/web/public   Marca: favicon, logos do header (brand/) e ícones do app (icons/, manifest.webmanifest)
data/cards        Cartas provisórias (JSON)
data/decks        Listas dos decks
```

### Motor de regras (`packages/engine`)

- `applyAction(estado, ação) → novo estado`: função pura. O estado é JSON serializável e o RNG tem seed,
  então partidas são determinísticas e reproduzíveis.
- Efeitos, batalhas e dano são *frames* numa pilha. Quando um jogador precisa decidir algo (alvo, bloqueio,
  counter, trigger), o motor para em `state.pending` até a próxima ação.
- `legalActions(estado, jogador)` lista as ações possíveis (usada pela interface e pelo bot).
- Os efeitos das cartas são **dados**, escritos com uma DSL em `src/cards/scripts.ts`:

```ts
'ST01-015': { // Gum-Gum Jet Pistol
  abilities: [
    { timing: 'main', steps: [{ do: 'ko', target: { side: 'opponent', kinds: ['character'], upTo: 1, maxPower: 6000 } }] },
    { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
  ],
},
```

Como o motor é independente da interface, o mesmo código roda no servidor nas partidas online, com o servidor como
autoridade; `viewFor(estado, jogador, apelidos)` gera a visão de cada jogador, sem as cartas escondidas.

### Regras implementadas

- Preparação: deck de 50, 10 DON!!, 5 cartas na mão, mulligan, Vida conforme o líder
- Fases: Refresh (DON!! anexados voltam e tudo desvira), Draw (o primeiro jogador não compra no turno 1),
  DON!! (+2, ou +1 no primeiro turno), Main, End
- Ninguém ataca no próprio primeiro turno; personagens só atacam no turno seguinte, exceto com [Rush]
- Batalha: When Attacking, Blocker, Counter (personagens e eventos [Counter]), dano, [Trigger], K.O.
- Palavras-chave: Rush, Blocker, Double Attack, Banish, [DON!! xN], [Once Per Turn], [Activate: Main], [On Play]
- Limite de 5 personagens (substituição), Stage único
- Derrota: dano sem Vida, ou deck vazio
- Efeitos de substituição ("instead"), [End of Your Turn], custos DON!! −X, Vida virada para cima

As regras oficiais resumidas, o catálogo de interações (com os rulings da Bandai), as divergências conhecidas do motor
e o mapa das primitivas da DSL estão em [`docs/rules/`](docs/rules/README.md). Os efeitos automáticos disparados
resolvem em fila, como na regra 8-6 (primeiro os do jogador do turno, cada um depois do efeito que o disparou, e o
dono escolhe a ordem entre os seus). As divergências que ainda faltam corrigir estão em
[`docs/rules/divergencias.md`](docs/rules/divergencias.md), e as formas de efeito sem primitiva em
[`docs/rules/mapeamento-dsl.md`](docs/rules/mapeamento-dsl.md).

## Dados das cartas

As cartas vêm da [optcgapi.com](https://optcgapi.com/documentation) (e, se configurado, de outras fontes: veja
[Cadeia de fontes](#cadeia-de-fontes)) e ficam salvas no SQLite local. O jogo não consulta a API durante as partidas.

```bash
npm run cards:import                      # ST-01 e ST-02 (os decks de teste)
npm run cards:import -- ST-03 OP-01 P     # coleções específicas (ST-xx = starter deck, OP/EB/PRB = boosters, P = promocionais)
npm run cards:import -- --all             # tudo (coleções, starter decks e promocionais P-xxx)
npm run cards:import -- --dry-run ST-01   # mostra o resultado sem gravar
npm run cards:import -- --file resp.json  # importa uma resposta da optcgapi salva em arquivo (sem rede, só a optcgapi)
```

- Versões com arte alternativa (mesmo ID) são unificadas; cartas DON!! são ignoradas. Promo reimpressa em starter deck
  que a API manda com o número da imagem ("P-029_r1") entra com o número da carta ("P-029"); reimpressões promocionais de
  cartas de coleção e líderes só de evento (P-700, P-800, P-900) ficam de fora.
- **Limpeza:** o importador remove do nome a versão de impressão ("(Parallel)", "(025)", "(OP01-060)"…) e o evento das
  promos ("(One Piece Film Red)", "[Winner]"),
  separa do texto as notas de errata/reimpressão (campo `notes`), converte `"X" type` para `{X} type` e
  reconhece "Also treat this card's name as [X]" (campo `aliases`).
- **Tipos:** a API junta vários tipos com espaço ("Heart Pirates Supernovas"). O importador separa pelo maior
  tipo conhecido em `data/card-types.json` mais os tipos citados nos textos. Inclua tipos novos nessa lista.
- A resposta original de cada carta fica guardada (coluna `raw`) para poder remapear sem baixar de novo.
- Antes da primeira importação, o jogo usa dados **provisórios** de `data/cards` (escritos de memória). Eles nunca
  sobrescrevem cartas vindas da API.
- Os scripts de efeito (`packages/engine/src/cards/scripts.ts`) precisam ser conferidos contra o texto oficial.

### Cadeia de fontes

Cada carta pode vir de mais de uma fonte, numa ordem de prioridade definida no `deploy.env` (homologação e produção
precisam da mesma cadeia, senão as bases ficam diferentes):

```bash
CARD_SOURCES=cardkaizoku,optcgapi        # cartas lançadas (padrão: optcgapi)
SPOILER_SOURCES=cardkaizoku,optcgleaks   # spoilers (padrão: optcgleaks)
```

Fontes disponíveis: `optcgapi` (oficiais), `optcgleaks` (spoilers) e `cardkaizoku` (as duas). O `sweetapp` entra na
frente quando o adaptador existir. Os adaptadores ficam em `apps/server/src/card-sources/`.

- **Por carta:** vale a primeira fonte da cadeia que tem a carta (gravada em `cards.source`, ex.: `api:cardkaizoku.com`).
  Campo **vazio** (atributo `""`, Vida do Líder, tipo cortado) é completado pela fonte seguinte; valor **diferente** não é
  misturado: vale o da fonte de maior prioridade.
- **Exceções do Cardkaizoku** (já errou contador, cor e poder): custo, poder, contador, Vida e cores vêm da fonte seguinte
  sempre que ela tem a carta. O texto dele só substitui o da fonte seguinte se o leitor de efeitos entender pelo menos
  tanto quanto (texto fora do padrão não pode derrubar a automação). O símbolo "➀" do site vira "①" e "DON!! −1" vira
  "DON!! -1".
- **Imagens:** o CDN do Cardkaizoku recusa links de fora, então a imagem (e as artes alternativas) vem da primeira fonte
  que tem imagem. Carta que só o Cardkaizoku tem aparece desenhada em HTML.
- **Lançada ou anunciada:** o Cardkaizoku mistura as duas. Como fonte oficial ele só traz coleções que outra fonte oficial
  (ou o banco) já tem, e promocionais que outra fonte tem ou que já estão à venda (com produto no TCGplayer). O resto
  (OP18, EB05, ST37, ST38, promos japonesas sem versão em inglês) entra pela cadeia de spoilers.
- **Relatório:** a importação mostra, por coleção, quantas cartas vieram de cada fonte, quantos campos foram completados e as
  divergências por campo. O detalhe carta a carta fica em `card-source-diff.json`, na pasta do banco (`apps/server/var/`
  ou `shared/` na VM), uma seção por importação (`official`, `official:sync`, `spoiler:OP18`…).
- Para trocar a cadeia de uma coleção sem risco: `CARD_SOURCES=cardkaizoku,optcgapi npm run cards:import -- --dry-run OP-05`
  e compare as contagens de automação; depois rode sem `--dry-run`. Na VM, o "Run workflow" do GitHub aceita `--all`
  em "Coleções para importar".
- **Termos de uso:** os termos do Cardkaizoku pedem autorização por escrito para reproduzir o conteúdo do site. Peça antes
  de ligar a fonte na produção.

### Spoilers (coleções ainda não lançadas)

A optcgapi só publica uma coleção depois do lançamento. As cartas já anunciadas (hoje EB05 e OP18; com o Cardkaizoku na cadeia,
também ST37, ST38 e promocionais ainda sem versão em inglês) entram no jogo como **spoilers**, com a etiqueta **SPOILER**, e viram cartas oficiais sozinhas
quando a API publica a coleção.

Cada coleção futura tem um arquivo `data/spoilers/<coleção>.json`:

```json
{
  "set": "OP18",
  "title": "The Dominance of God (OP-18)",
  "release": "2026-11-20",
  "feed": true,
  "source": "optcgleaks.com",
  "url": "https://optcgleaks.com/op18",
  "cards": []
}
```

`release` (data de lançamento) define a ordem das coleções: a de data mais cedo que ainda tem cartas de spoiler é a
"próxima coleção" dos modos "+ spoilers" fora do Livre (veja [Formatos](#formatos)). Arquivo sem `release` (starters,
promos) nunca é a próxima coleção.

- **Busca automática** (`"feed": true`; arquivos antigos com `"feed": "optcgleaks"` também valem): o servidor baixa as
  cartas reveladas das fontes de `SPOILER_SOURCES`, juntadas pela [cadeia](#cadeia-de-fontes):
  - [optcgleaks.com](https://optcgleaks.com/) (`https://images.optcgleaks.com/<coleção>/<coleção>.json`), com textos em
    inglês e imagens. Ficam de fora as cartas ainda sem número ("EB05-XXX") e as reimpressões de outras coleções.
  - [cardkaizoku.com](https://www.cardkaizoku.com/spoilers) (`https://cdn.cardkaizoku.com/manifest.json` aponta o arquivo
    com todas as cartas do site), sem imagens. Carta com o texto ainda não revelado fica de fora.

  Uma carta que sai de todas as fontes sai do banco; uma resposta vazia, ou uma rodada em que alguma fonte falhou, não
  apaga nada. Uma fonte que não tem a coleção (404) não conta como erro. Para acompanhar uma coleção nova, basta criar o
  arquivo dela. O arquivo `p.json` acompanha as promocionais: as que já são oficiais no banco não viram spoiler.
- **Cartas escritas à mão** (`cards`): mesmos campos de `data/cards` (`CardData`) e têm prioridade sobre as baixadas,
  para corrigir um erro do site ou incluir uma carta de outra fonte. `source`/`url` do arquivo valem para essas cartas;
  cada uma pode ter o seu `"spoiler": { "source": "...", "url": "..." }`. Cartas sem número, nome ou categoria são ignoradas
  e aparecem no log. Uma carta apagada do arquivo sai do banco.
- **Troca automática:** ao iniciar e a cada `SPOILER_SYNC` horas, o servidor primeiro baixa os spoilers e depois procura as
  coleções na API (`/allSets/`, `/allDecks/` e, se a coleção ainda não estiver listada, `/sets/card/<id>/`; promocionais em
  `/allPromos/`). Quando a coleção sai, ela é importada inteira, passando pela cadeia de `CARD_SOURCES`: os dados e a
  imagem oficiais substituem os do spoiler e a etiqueta some. Os decks
  continuam iguais, porque o número da carta não muda. Coleções já oficiais não são mais buscadas no site de spoilers.
  Para fazer tudo na hora: `npm run cards:import -- --spoilers`.
- Uma carta que já veio da API nunca é sobrescrita por um spoiler, então não é preciso limpar os arquivos depois do lançamento.
- No construtor de decks, o filtro de coleção tem a opção "Só spoilers" e marca as coleções com "(spoilers)".
- Deck com spoiler não entra na ranqueada nem em torneio, sala privada ou treino sem spoilers (veja [Formatos](#formatos)),
  e a partida com ele não conta nas estatísticas. Com spoilers, fora do Livre, só vale a próxima coleção a ser
  lançada (veja [Formatos](#formatos)). Na carta, a etiqueta **SPOILER** fica junto das tags de efeito, abaixo do poder.
  Quando a coleção sai e a etiqueta some, o mesmo deck passa a valer em todo lugar.
- O [cardkaizoku.com](https://www.cardkaizoku.com/spoilers) costuma revelar antes e tem promocionais que as outras fontes não
  têm, mas errou contador, cor e poder em algumas e as imagens dele só abrem no próprio site. Por isso fica desligado por
  padrão e, quando ligado, esses campos e a imagem vêm da fonte seguinte (veja [Cadeia de fontes](#cadeia-de-fontes)).

### Imagens

Com `CARD_IMAGES=on` (padrão), o navegador carrega as imagens direto das URLs informadas pela API, e cada jogador
pode desligá-las nas configurações. Com `CARD_IMAGES=off`, o servidor remove as URLs de todas as respostas e o
jogo usa só as cartas desenhadas em HTML (nome, custo, poder, texto). Se uma imagem falhar ao carregar, a carta
desenhada é usada automaticamente.

### CDN própria das imagens (Cloudflare R2)

Com a CDN configurada, cada imagem é baixada **uma vez** da fonte (optcgapi, optcgleaks), gravada num bucket do
Cloudflare R2 e a carta passa a apontar para lá. O jogo deixa de depender dos sites de terceiros para mostrar as
imagens, e o parceiro SweetApp pode usar a mesma CDN. Código em `apps/server/src/card-cdn/`.

- **Endereços:** `<CARD_CDN_URL>/<coleção>/<idioma>/<arte>.<ext>?v=<hash>` (ex.: `/OP01/en/OP01-016_p1.jpg?v=3f2a…`). A
  chave de uma arte não muda; o `?v=` é o hash do conteúdo e muda quando a imagem muda, então o cache é de um ano
  (`immutable`).
- **Índice para parceiros:** `<CARD_CDN_URL>/index.json` (`schemaVersion: 1`): número da carta → nome, coleção, `spoiler`,
  imagem principal e artes, só das cartas que já estão na CDN. Atualizado a cada rodada que copia ou reaproveita imagens.
- **Quando copia:** no fim de toda importação (`cards:import`), em cada rodada da sincronização dos spoilers (até 500
  imagens novas por rodada) e à mão com `npm run cards:import -- --images` (use para a primeira carga, ~5 mil imagens).
  Reimportar uma carta não baixa a imagem de novo (tabela `card_images`: endereço de origem → objeto no bucket).
- **Nunca copia** de origens fora da lista do `/card-img/` (optcgapi, optcgleaks): imagens do Cardkaizoku ficam de fora
  pelos termos de uso do site. Uma imagem que falha fica com o endereço original e é tentada de novo na próxima rodada.
- O kit de divulgação dos torneios continua usando `/card-img/` (origem `cdn`), com o cache do Nginx.

**Imagens oficiais da Bandai** (`card-cdn/official.ts`): carta sem imagem em nenhuma fonte de dados (promos japonesas,
cartas que só o Cardkaizoku tem) ou com um desenho provisório (o SVG que a optcgapi manda em algumas promos de evento)
procura a imagem nas listas oficiais, na ordem de `CARD_IMAGE_SOURCES`: inglês (`en.onepiece-cardgame.com`), inglês
da Ásia (`asia-en.onepiece-cardgame.com`) e japonês (`www.onepiece-cardgame.com`).

- Só as coleções das cartas que faltam são consultadas (promocionais: as séries "Promotion card" e "Other Product
  Card"), cada uma no máximo uma vez por dia, com 1 s entre as páginas. O que a lista mostra fica guardado
  (`card_official_images`): reimportar a carta não consulta a Bandai de novo.
- A primeira região que tem a carta vence. A impressão base vira a imagem; as outras (`_p1`…) viram artes, com o
  produto de origem como rótulo. Imagem japonesa vai para a CDN como `/P/jp/P-152.png` e a carta ganha `imageLang: "jp"`.
- Desenho provisório recusado fica registrado (não é baixado de novo) e, na rodada seguinte, a carta procura a oficial.
- Tudo roda junto da cópia para a CDN (importação, sincronização dos spoilers e `--images`).

**Imagens que vêm por fora** (`card-cdn/local.ts`): promos que nenhuma fonte tem (as da China, por exemplo) entram de
uma pasta de PNG/JPEG/WebP:

```bash
npm run cards:import -- --images-from ./promos-cn --images-lang cn --images-label "Promo China"
```

- Nome do arquivo: `<número da carta>[_<sufixo>].png` (ou `.jpg`, `.webp`), ex.: `P-123.png` para a impressão base e
  `P-123_cn1.png` para uma variante. A carta precisa já existir no banco; arquivo com nome fora do padrão, de carta
  desconhecida, que não é imagem ou acima de 4 MB é ignorado (com aviso). `--images-lang` é o idioma da chave na CDN
  (padrão `cn`); `--images-label` é o rótulo das artes (opcional).
- Chave no bucket: `<coleção>/<idioma>/<nome>.<ext>` (ex.: `/P/cn/P-123.png`), com o mesmo cache de um ano e `?v=`.
  Rodar de novo com a mesma pasta não sobe nada; um arquivo que mudou sobe e troca o `?v=`.
- A impressão base vira a imagem da carta quando ela não tem nenhuma (a carta ganha `imageLang`); se a carta já tem
  imagem (fonte de dados ou lista oficial da Bandai), vira arte alternativa, como as variantes. O id da arte é o nome
  do arquivo (`P-123_cn1`), e `P-123_cn` para a base.
- O que entrou fica em `card_local_images` e é reaplicado em toda rodada da CDN: reimportar a carta ou sincronizar os
  spoilers não desfaz nada. O `index.json` dos parceiros passa a listar essas imagens na mesma rodada.

**Configuração no Cloudflare (uma vez):**

1. O domínio público do bucket precisa estar no Cloudflare. O `gumgumfight.app` usa o DNS da Hostinger; o caminho mais
   simples é levar só o `gumgumfight.cloud` para o Cloudflare (plano grátis: trocar os nameservers na Hostinger e
   recriar os registros A de `@` e `www` para a VPS) e usar `cards.gumgumfight.cloud`.
2. **R2 → Create bucket** (ex.: `ggf-cards`). Em **Settings → Custom Domains**, conecte `cards.gumgumfight.cloud`.
3. Em **Settings → CORS policy**, libere leitura (`GET`, `HEAD`) para `https://gumgumfight.app`,
   `https://gumgumfight.duckdns.org` e as origens dos parceiros (SweetApp).
4. **R2 → Manage API tokens → Create API token** com *Object Read & Write* só nesse bucket. Guarde o Access Key ID e o
   Secret (aparecem uma vez) e o Account ID.
5. No `shared/deploy.env` da VPS (homologação e produção):
   ```bash
   CARD_CDN_URL=https://cards.gumgumfight.cloud
   R2_ACCOUNT_ID=<account id>
   R2_BUCKET=ggf-cards
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret>
   ```
   Rode `deploy/bootstrap-hostinger.sh` de novo (cria a rota `/card-img/cdn/` no Nginx) e faça a primeira carga pelo
   "Run workflow" do GitHub com `--images` em "Coleções para importar" (o deploy já lê o `deploy.env`). Na VPS, à mão:
   `cd ~/apps/gumgumfight && set -a && . shared/deploy.env && set +a && DB_PATH=shared/gumgum.db node current/server/import-cards.mjs --images`.

### Artes alternativas

A importação guarda as outras impressões de cada carta (Parallel, Alternate Art, SP, Manga, promos) em `arts`; as
reimpressões com a mesma ilustração ficam de fora. No construtor de decks, **Aplicar artes alternativas** põe a primeira
arte alternativa em todas as cartas do deck que têm uma, e o ícone de paleta na linha da carta (ou o botão **Arte** do
Líder) abre o seletor para trocar uma por uma. A escolha é salva no deck (`decks.arts`), não muda o deck nas
estatísticas e aparece na mesa para os dois jogadores (o oponente só vê a arte das cartas que estão à vista).
Com `CARD_IMAGES=off`, as artes somem junto com as imagens.

### Textos em português

Cada jogador escolhe "Português" ou "English" em **⚙️ Configurações** (modal no menu) ou no menu da partida (a escolha
fica salva no navegador).

### Tema escuro

Em **⚙️ Configurações** (modal aberto pelo botão no menu, ou no menu da partida), "Tema" alterna entre **Automático** (segue o tema do aparelho,
inclusive quando ele muda), **Claro** e **Escuro**. A escolha fica salva no navegador e é aplicada antes da página
carregar, sem piscar o tema claro. As cores das cartas, dos DON!! e dos dados não mudam com o tema.

- **Tradução automática:** feita por regras em `packages/engine/src/i18n/pt.ts`. Os textos do jogo seguem modelos
  fixos, então a maior parte é traduzida sem serviço externo. Trechos não reconhecidos ficam em inglês e a carta é
  marcada como "tradução parcial". O painel da carta sempre tem o link "ver original".
- **Traduções revisadas:** `data/translations/pt.json` (`{ "cards": { "OP01-001": { "text": "...", "trigger": "..." } } }`)
  tem prioridade sobre a automática. `GET /api/translations/pending` lista as cartas com tradução parcial, para revisão.
  `npm run translations:check -w @gumgum/server` traduz a base inteira e lista as traduções parciais e as suspeitas
  (número, nome, tipo ou palavra-chave que só aparece de um lado), para conferir depois de cada coleção nova.
- Nomes de cartas, tipos ({Straw Hat Crew}) e palavras-chave (Rush, Blocker, Counter, Trigger...) ficam no original,
  como nas cartas físicas.

### Som

O jogo tem efeitos sonoros (cartas, DON!!, ataques, dano, dados, chat e o resultado) e duas músicas originais:
"Brisa do Leste" no menu e "Valsa do Mar" na partida. Em **⚙️ Configurações** há um volume para os efeitos e outro para a música,
com botão de mudo, guardados no navegador. O som só começa depois do primeiro toque na página (regra dos
navegadores) e, no iPhone, respeita a chave de silencioso. Os efeitos são CC0 (Kenney e OpenGameArt) e a música foi
composta para o projeto: veja `apps/web/src/assets/audio/CREDITS.md`.

### No celular (app instalado, tela acesa e notificações)

O site é um PWA: dá para instalar na tela de início e ele abre em tela cheia, como um aplicativo, sem passar por loja.

- **Instalar:** no celular, o menu inicial mostra um convite. No Chrome/Android, o botão **Instalar** abre o pedido do
  navegador; no iPhone/iPad, o convite ensina o caminho (Compartilhar → "Adicionar à Tela de Início"). "Agora não"
  esconde o convite por 30 dias. A opção **Instalar o app** em **⚙️ Configurações** fica sempre disponível.
- **Tela sempre acesa** (ligada por padrão, em **⚙️ Configurações** e no menu da partida): enquanto você joga, assiste
  ou vê um replay, a tela do celular não apaga (Wake Lock). No menu, a tela apaga normalmente.
- **Notificações** (desligadas por padrão; só ligam quando a pessoa ativa em **⚙️ Configurações** e aceita o pedido
  do navegador): avisos no celular com o app em segundo plano ou fechado. Dá para escolher os tipos:
  - **Partidas online:** o oponente entrou na sala que você criou (ou a fila encontrou uma partida) e chegou a sua vez
    (no máximo um aviso a cada 30 s). O app conta ao servidor quando sai da tela; com ele na tela, nada é enviado.
  - **Torneios:** check-in aberto (para quem ainda não confirmou), rodada nova (com o oponente e o prazo de
    tolerância, ou o aviso de bye) e oponente esperando você na sala.

  Tocar no aviso abre o app direto na partida ou na página do torneio. Desligar cancela a inscrição deste navegador no
  servidor. No iPhone/iPad, as notificações só funcionam com o app instalado na tela de início (iOS 16.4 ou mais novo).
  Os textos saem no idioma escolhido no app.

O service worker (`/sw.js`, gerado a partir de `apps/web/src/service-worker.js` pelo plugin em `vite.config.ts`)
guarda a casca do app para abrir rápido e sem internet (a página sempre é buscada primeiro na rede, então um deploy
aparece na hora) e mostra as notificações. As notificações não dependem de serviço pago: o servidor assina e cifra
cada mensagem (VAPID e RFC 8291, em `apps/server/src/push/`) e a entrega ao serviço de push do navegador (Google,
Mozilla, Microsoft ou Apple). As chaves nascem sozinhas no banco; não há nada para configurar no deploy.

## Testes

```bash
npm test                                   # regras, tradução, importador, API, 200 partidas bot x bot e as lições do tutorial
npm run simulate -w @gumgum/engine -- 500  # estatísticas de N partidas bot x bot
npm run typecheck
```

## API

A interface web usa a mesma API HTTP do servidor; a tabela completa de rotas, com quem pode chamar cada uma
(público, navegador, sessão, dono, organizador, Judge, Streamer, Admin, token de parceiro), está no
[Apêndice B da documentação técnica](docs/documentacao-tecnica.md#b-rotas-da-api). As rotas que qualquer um
pode chamar sem login nem token:

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Verificação de saúde |
| GET | `/api/config` | Configurações públicas (imagens ligadas? Client ID do Google, chave pública das notificações) |
| GET | `/api/cards?set=` · `/api/cards/:id` | Cartas (opcionalmente por coleção) |
| GET | `/api/decks` · `/api/decks/:id` | Decks prontos e da comunidade, com validação por formato; `mine=1` filtra os seus (navegador ou conta) |
| GET | `/api/stats/meta` · `/api/stats` · `/api/stats/trend?weeks=` · `/api/stats/cards?leader=` | Estatísticas gerais: filtros, totais, Líderes, matchups, tendência semanal e cartas de um Líder |
| GET | `/api/stats/decks?leader=` | Decks de um Líder (mesmos filtros de `/api/stats`): cartas no deck, deck médio e decks populares |
| GET | `/api/stats/global?queue=` · `/api/stats/global/trend?queue=&weeks=` · `/api/stats/global/compare?queue=&format=` | Meta global (TCG Matchmaking): Líderes e matchups de uma fila, tendência e a comparação com as partidas daqui (404 sem a chave) |
| GET | `/api/online/stats` · `/api/online/live` · `/api/online/rooms/:id` | Contadores do menu, partidas para assistir e o resumo de uma sala |
| GET | `/api/tournaments` · `/api/tournaments/:id` | Torneios e o detalhe de um torneio (o que quem pede pode fazer vem na resposta) |
| GET | `/api/sponsors` · `/api/support` · `/api/support/supporters` | Lojas parceiras, apoio ao projeto e lista pública de apoiadores |

Filtros de `/api/stats` e `/api/stats/cards`: `format` (standard, egb), `queue` (casual, ranked, tournament), `opponent` (bot,
human), `by` (human = padrão, bot = simulações bot x bot de versões antigas), `tiers` (ids separados por vírgula), `leader`, `oppLeader`,
`first` (first, second), `days`, `mine=1` e `deck`. Com o apoio configurado, a ranqueada e os torneios (`queue`) só saem para quem tem o
plano Tripulante, salvo com `mine=1`.

Para apps parceiros (tokens e OAuth), veja [API para parceiros](#api-para-parceiros-apps-que-agem-em-nome-do-usuário).

## Aviso

Projeto de fã, sem fins lucrativos e sem vínculo com Bandai, Toei Animation ou Shueisha. One Piece e
One Piece Card Game são marcas de seus respectivos donos.
