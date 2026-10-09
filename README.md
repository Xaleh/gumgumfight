# GumGum Fight

Simulador de **One Piece Card Game** no navegador, inspirado no [Duels.ink](https://duels.ink/) (Lorcana).

> **Status:** partidas contra um bot, replays, **multiplayer online** (salas privadas, fila casual e
> ranqueada) e **torneios** (suíço com top cut e eliminação simples, com melhor de 3 e de 5). Cartas importadas da [optcgapi.com](https://optcgapi.com/documentation),
> com textos em português (tradução automática) ou inglês e imagens opcionais.

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
| `SPOILER_SYNC`  | `6`                           | Horas entre as buscas dos spoilers na API oficial; `off` desliga |
| `GOOGLE_CLIENT_ID` | (vazio)                    | Client ID do login com Google; vazio = login desligado |
| `ADMIN_EMAILS`  | (vazio)                       | E-mails (separados por vírgula) das contas Google que viram Admin ao entrar (um Dev continua Dev) |
| `ONLINE_BOT_ROOMS` | `on`                       | Transmitir o treino contra o bot (o servidor joga pelo bot; exige login); `off` desliga |
| `ONLINE_MAX_ROOMS` | `400`                      | Salas online ativas ao mesmo tempo no servidor (acima disso, 503); cada sala custa memória e CPU |
| `ONLINE_MAX_BOT_ROOMS` | `100`                  | Treinos contra o bot transmitidos ao mesmo tempo (o servidor joga pelo bot); acima disso o treino roda no navegador |
| `PM2_MAX_MEMORY` | `1500M` (só no `deploy.env` da VM) | Memória a partir da qual o pm2 reinicia o app |

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
     cria o usuário `gumgum` que recebe o deploy e um backup diário do banco. O passo a passo completo, com o DNS
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
rotação ficam em `packages/engine/src/formats.ts`: atualizar a lista é só mexer lá. O construtor mostra em quais
formatos o deck vale, marca no catálogo as cartas banidas (🚫) e rotacionadas (①), e o menu desabilita os decks que
não valem no formato escolhido.

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

## Multiplayer online

A tela inicial tem um card para cada modo: **Ranqueada**, **Partida rápida** (casual), **Sala privada** (criar uma
sala gera um código de 6 letras e um link `/?sala=CÓDIGO` para enviar a quem vai jogar), **Contra o bot** e
**Torneios**. Todos usam o **deck equipado** e o formato escolhidos na faixa acima dos cards. Quem recarrega a página ou
troca de aparelho encontra "Voltar à partida" no topo da mesma tela.

Os cards mostram ao vivo quantas partidas estão em andamento e quantas pessoas estão na fila de cada modo, e o
cabeçalho mostra quantas pessoas estão conectadas. Esses números vêm de `GET /api/online/stats` (só contagens, sem
nomes), que a tela inicial consulta a cada 10 s enquanto a aba está visível. Essa consulta também é o sinal de
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
- **Sem desfazer, Auto ou pausa** no online. Mensagens rápidas (emotes de uma lista fixa), revanche nas salas privadas e
  o replay completo para baixar no fim.
- **Proteção contra abuso:** abrir salas não exige login, então há tetos: salas ativas no servidor
  (`ONLINE_MAX_ROOMS`), salas de treino contra o bot (`ONLINE_MAX_BOT_ROOMS`), e por IP (16 salas ou lugares na fila
  ao mesmo tempo e 60 criações a cada 10 min; `apps/server/src/online/lobby.ts`, `DEFAULT_LIMITS`). O Nginx dos scripts
  de deploy ainda limita `/api/` a 30 requisições/s por IP (rajada de 100) e 64 conexões simultâneas por IP.
- **Cache:** o torneio completo (`GET /api/tournaments/:id`, consultado a cada 5 s por jogador) e as estatísticas
  ficam em cache no servidor, invalidado a cada gravação, e saem com `ETag` (o navegador recebe 304 quando nada mudou).
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
- **Ver mãos (Streamer e Admin):** a lista e a mesa têm o botão **Ver mãos**, que mostra as mãos dos dois jogadores
  (decks e Vida continuam escondidos). O servidor confere o perfil da conta e recusa para quem está jogando a própria
  partida.
- **Transmitir o treino contra o bot:** em **Contra o bot**, quem entrou com o Google pode marcar **Transmitir esta
  partida**. A partida roda no servidor, que joga pelo bot (decidindo só com a visão do bot), e aparece na lista para
  assistir. "Quem começa" vale como no treino local; a seed e o desfazer ficam só no treino no navegador. Entra nas
  estatísticas como partida contra o bot. Com a transmissão lotada (`ONLINE_MAX_BOT_ROOMS`), o treino roda no
  navegador, com um aviso na mesa. `ONLINE_BOT_ROOMS=off` tira a opção do menu e essas salas da lista.

### Perfis (Player, Streamer, Organizador, Admin, Dev)

Cada conta Google tem um perfil (coluna `users.role`): **Player** (padrão: joga e assiste sem ver as mãos),
**Streamer** (assiste vendo as mãos), **Organizador** (cria torneios e gerencia os que criou), **Admin** (tudo
isso, gerencia qualquer torneio e muda os perfis em **Perfis das contas**, no menu) ou **Dev** (tudo do Admin e as
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

- **Criação:** nome, descrição e regras, formato (Standard ou Extra Grand Battle), estrutura, limite de jogadores e
  início previsto. Dá para editar tudo enquanto as inscrições estão abertas.
- **Check-in, início automático e W.O. por ausência** (torneios com data de início; ligado por padrão ao criar):
  - O **check-in** abre 30 minutos antes do início, na página do torneio e num atalho no alto da tela inicial, para
    quem está inscrito.
  - Na hora marcada o torneio **começa sozinho**: a rodada 1 é sorteada entre todos os inscritos e a sala de cada mesa
    fica pronta para os dois jogadores (o atalho da tela inicial vira **Entrar na sala**). O organizador ainda pode
    começar antes à mão.
  - Em cada rodada, cada jogador tem **5 minutos** para entrar na sala. Quem não entra **perde por W.O.** e sai do
    torneio; se nenhum dos dois entra, **os dois perdem** (W.O. duplo: na chave, a mesa seguinte fica com bye). Na
    rodada 1, o check-in feito antes já vale como presença. Depois do primeiro jogo de uma série a tolerância não corre
    mais (o organizador lança o placar, se precisar).
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
- **Inscrição:** com um deck válido no formato. A lista fica **congelada** na inscrição (mudar o deck depois não muda
  o do torneio; inscreva-o de novo para trocar). Os outros jogadores veem só o Líder; as listas completas ficam
  visíveis para o organizador e, quando o torneio termina, para todos.
- **Partidas:** cada jogador clica em **Jogar partida** na página do torneio; quem entra primeiro espera o oponente
  na sala online (fila `tournament`, com relógio e regras das partidas online). Numa melhor de N, cada jogo é uma
  sala: o placar da série soma sozinho, quem perdeu um jogo começa o seguinte e a tela de fim de jogo tem o botão do
  próximo jogo. A partida aparece em **Assistir partidas** com o nome do torneio e a fase. Cada jogo entra nas
  estatísticas na fila **Torneio**.
- **Organização:** o organizador lança o placar de qualquer partida (W.O., queda de conexão, partida jogada fora do
  site), tira jogadores e avança: próxima rodada do suíço, início do top cut, próxima fase da chave e, depois da
  final, o encerramento. **Encerrar agora** termina antes.
- **Correção de resultados:** um placar lançado errado pode ser corrigido em qualquer rodada, inclusive passadas (a
  classificação é recalculada). Na chave, corrigir quem venceu troca o jogador da partida seguinte, desde que ela
  ainda não tenha começado (senão, corrija ou zere antes a partida seguinte). Resultados do suíço não mudam depois
  que o top cut começa, porque ele foi semeado por eles.
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
  quantas cartas são automáticas, quantas são manuais e como está a tradução.

Para checar a robustez depois de importar coleções novas (decks aleatórios de toda a base, simulações bot x bot
na linha de comando):

```bash
npm run simulate:all -w @gumgum/engine -- caminho/para/cards.json 300   # ou a URL de /api/cards
```

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
  Replays antigos continuam abrindo (são convertidos para a versão atual); os que não trazem as listas precisam
  que os decks ainda existam.
- Em **Opções de teste** (no menu, só para o perfil Dev), a **seed** controla o embaralhamento: a mesma seed com as mesmas jogadas
  reproduz a mesma partida.

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

As cartas vêm da [optcgapi.com](https://optcgapi.com/documentation) e ficam salvas no SQLite local. O jogo não
consulta a API durante as partidas.

```bash
npm run cards:import                      # ST-01 e ST-02 (os decks de teste)
npm run cards:import -- ST-03 OP-01       # coleções específicas (ST-xx = starter deck, OP/EB/PRB = boosters)
npm run cards:import -- --all             # tudo (coleções, starter decks e promocionais P-xxx)
npm run cards:import -- --dry-run ST-01   # mostra o resultado sem gravar
npm run cards:import -- --file resp.json  # importa uma resposta da API salva em arquivo (sem rede)
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

### Spoilers (coleções ainda não lançadas)

A optcgapi só publica uma coleção depois do lançamento. As cartas já anunciadas (hoje EB05 e OP18) entram no jogo como
**spoilers**, com a etiqueta **SPOILER**, e viram cartas oficiais sozinhas quando a API publica a coleção.

Cada coleção futura tem um arquivo `data/spoilers/<coleção>.json`:

```json
{
  "set": "OP18",
  "title": "The Dominance of God (OP-18)",
  "feed": "optcgleaks",
  "source": "optcgleaks.com",
  "url": "https://optcgleaks.com/op18",
  "cards": []
}
```

- **Busca automática** (`"feed": "optcgleaks"`): o servidor baixa as cartas reveladas de
  [optcgleaks.com](https://optcgleaks.com/) (`https://images.optcgleaks.com/<coleção>/<coleção>.json`), com textos em
  inglês e imagens. Ficam de fora as cartas ainda sem número ("EB05-XXX") e as reimpressões de outras coleções. Uma carta
  que sai do site sai do banco; uma resposta vazia ou com erro não apaga nada. Para acompanhar uma coleção nova, basta
  criar o arquivo dela.
- **Cartas escritas à mão** (`cards`): mesmos campos de `data/cards` (`CardData`) e têm prioridade sobre as baixadas,
  para corrigir um erro do site ou incluir uma carta de outra fonte. `source`/`url` do arquivo valem para essas cartas;
  cada uma pode ter o seu `"spoiler": { "source": "...", "url": "..." }`. Cartas sem número, nome ou categoria são ignoradas
  e aparecem no log. Uma carta apagada do arquivo sai do banco.
- **Troca automática:** ao iniciar e a cada `SPOILER_SYNC` horas, o servidor primeiro baixa os spoilers e depois procura as
  coleções na API (`/allSets/`, `/allDecks/` e, se a coleção ainda não estiver listada, `/sets/card/<id>/`). Quando a
  coleção sai, ela é importada inteira: os dados e a imagem oficiais substituem os do spoiler e a etiqueta some. Os decks
  continuam iguais, porque o número da carta não muda. Coleções já oficiais não são mais buscadas no site de spoilers.
  Para fazer tudo na hora: `npm run cards:import -- --spoilers`.
- Uma carta que já veio da API nunca é sobrescrita por um spoiler, então não é preciso limpar os arquivos depois do lançamento.
- No construtor de decks, o filtro de coleção tem a opção "Só spoilers" e marca as coleções com "(spoilers)".
- O [cardkaizoku.com](https://www.cardkaizoku.com/spoilers) tem as mesmas cartas, mas errou contador, cor e poder em algumas
  e as imagens dele só abrem no próprio site; por isso não é usado na busca automática.

### Imagens

Com `CARD_IMAGES=on` (padrão), o navegador carrega as imagens direto das URLs informadas pela API, e cada jogador
pode desligá-las nas configurações. Com `CARD_IMAGES=off`, o servidor remove as URLs de todas as respostas e o
jogo usa só as cartas desenhadas em HTML (nome, custo, poder, texto). Se uma imagem falhar ao carregar, a carta
desenhada é usada automaticamente.

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

## Testes

```bash
npm test                                   # regras, tradução, importador, API e 200 partidas bot x bot
npm run simulate -w @gumgum/engine -- 500  # estatísticas de N partidas bot x bot
npm run typecheck
```

## API

| Método | Rota               | Descrição                                   |
|--------|--------------------|---------------------------------------------|
| GET    | `/api/health`      | Verificação de saúde                        |
| GET    | `/api/config`      | Configurações públicas (imagens ligadas? Client ID do Google) |
| GET    | `/api/auth/me`     | Usuário logado (`{ user }` com `role`; `null` sem sessão) |
| GET    | `/api/admin/users?q=` | Contas e perfis (só Admin)               |
| PUT    | `/api/admin/users/:id/role` | Muda o perfil (`{ role: player \| streamer \| organizer \| admin \| dev }`; só Admin; a si mesmo, só para `dev`) |
| POST   | `/api/auth/google` | Login: `{ credential }` (ID token do Google); abre a sessão em cookie |
| POST   | `/api/auth/logout` | Sai (apaga a sessão)                        |
| GET    | `/api/cards?set=`  | Lista cartas (opcionalmente por coleção)    |
| GET    | `/api/cards/:id`   | Uma carta                                   |
| GET    | `/api/decks`       | Lista decks, com validação                  |
| GET    | `/api/decks/:id`   | Deck + definições das cartas usadas         |
| POST   | `/api/decks`       | Cria um deck (`{ name, leader, cards }`)    |
| PUT    | `/api/decks/:id`   | Atualiza um deck do jogador                 |
| DELETE | `/api/decks/:id`   | Apaga um deck do jogador                    |
| POST   | `/api/matches`     | Envia o replay de uma partida (verificado pelo servidor) |
| GET    | `/api/matches`     | Últimas partidas                            |
| GET    | `/api/players/me`  | Perfil do jogador: conta ou navegador (nome, recompensa, tier) |
| PUT    | `/api/players/me`  | Troca o nome (`{ name }`)                   |
| GET    | `/api/stats/meta`  | Opções dos filtros: formatos, filas, tiers, Líderes |
| GET    | `/api/stats`       | Totais, Líderes e matchups (filtros na query) |
| GET    | `/api/stats/trend?weeks=` | Uso e vitórias por Líder em cada semana (padrão 6) |
| GET    | `/api/stats/cards?leader=` | Desempenho das cartas de um Líder (ou `deck=` hash da lista) |
| GET    | `/api/translations/pending` | Cartas com tradução automática parcial |
| GET    | `/api/online/active` | Partidas online em andamento do jogador (com o token do assento) |
| POST   | `/api/online/rooms` | Cria uma sala privada (`{ deckId, format }`) |
| POST   | `/api/online/rooms/join` | Entra numa sala (`{ code, deckId }`) |
| POST   | `/api/online/queue` | Entra na fila (`{ deckId, format, queue: casual \| ranked }`) |
| GET / DELETE | `/api/online/queue/:ticket` | Consulta a fila / sai dela |
| GET    | `/api/online/rooms/:id/events?t=` | Canal SSE: visão do jogador, relógios, presença, emotes |
| POST   | `/api/online/rooms/:id/action` | Ação (`{ t, seq, action }`; `seq` = `actionCount` da visão) |
| POST   | `/api/online/rooms/:id/emote` · `/rematch` · `/leave` | Emote, revanche (salas privadas) e cancelar a sala |
| GET    | `/api/online/rooms/:id/replay` | Replay completo (só depois do fim) |
| POST   | `/api/online/bot` | Treino contra o bot transmitido, só com login (`{ deckId, botDeckId \| random, format, first? }`, `first`: 0 = jogador, 1 = bot, ausente = sorteio; 401 sem login; desligado com `ONLINE_BOT_ROOMS=off`) |
| GET    | `/api/online/live` | Partidas para assistir (`{ rooms, hands }`; `hands`: quem pede pode ver as mãos) |
| GET    | `/api/online/watch/:code` | Sala privada pelo código, para assistir |
| GET    | `/api/online/rooms/:id` | Resumo de uma sala (jogadores, turno, espectadores) |
| GET    | `/api/online/rooms/:id/watch?hands=1` | Canal SSE do espectador (`hands=1`: só Streamer e Admin) |
| GET    | `/api/tournaments` | Torneios (`{ tournaments, canCreate }`) |
| GET    | `/api/tournaments/:id` | Torneio completo: inscritos, rodadas, classificação e o que quem pede pode fazer |
| POST   | `/api/tournaments` | Cria (`{ name, description, format, structure: swiss \| single, rounds, swissBestOf: 1 \| 3, topCut, bo3From, bo5From, maxPlayers, startsAt }`; Organizador e Admin) |
| PUT / DELETE | `/api/tournaments/:id` | Edita (só com inscrições abertas) / apaga (organizador do torneio ou Admin) |
| POST / DELETE | `/api/tournaments/:id/register` | Inscreve ou troca o deck (`{ deckId }`) / cancela a inscrição ou desiste |
| POST   | `/api/tournaments/:id/start` · `/next` · `/finish` | Começa, avança (rodada do suíço, top cut, próxima fase ou encerramento) e encerra antes |
| PUT    | `/api/tournaments/:id/matches/:matchId/result` | Placar da série (`{ wins: [p1, p2] }` ou `{ result: p1 \| p2 }`); rodadas passadas também |
| POST   | `/api/tournaments/:id/players/:userId/drop` | Tira um jogador (organizador) |
| POST   | `/api/tournaments/:id/matches/:matchId/play` | Abre ou entra na sala online do jogo atual da série (`{ roomId, token }`) |

Filtros de `/api/stats` e `/api/stats/cards`: `format` (standard, egb), `queue` (casual, ranked, tournament), `opponent` (bot,
human), `by` (human = padrão, bot = simulações bot x bot de versões antigas), `tiers` (ids separados por vírgula), `leader`, `oppLeader`,
`first` (first, second), `days`, `mine=1` e `deck`.

## Aviso

Projeto de fã, sem fins lucrativos e sem vínculo com Bandai, Toei Animation ou Shueisha. One Piece e
One Piece Card Game são marcas de seus respectivos donos.
