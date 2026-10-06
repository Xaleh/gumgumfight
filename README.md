# GumGum Fight

Simulador de **One Piece Card Game** no navegador, inspirado no [Duels.ink](https://duels.ink/) (Lorcana).

> **Status:** partidas contra um bot, bot x bot, replays, **multiplayer online** (salas privadas, fila casual e
> ranqueada) e **torneios** (suíço e eliminação simples). Cartas importadas da [optcgapi.com](https://optcgapi.com/documentation),
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
| `ADMIN_EMAILS`  | (vazio)                       | E-mails (separados por vírgula) das contas Google que viram Admin ao entrar |
| `ONLINE_BOT_ROOMS` | `on`                       | Treino online contra o bot do servidor (teste do modo espectador); `off` desliga |

O backup é só copiar o arquivo `.db`.

## Deploy automático (GitHub Actions)

O workflow `.github/workflows/ci-deploy.yml` roda os testes em todo push. Em push na **main** (ou em "Run workflow"),
ele publica o site no servidor de produção:

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
2. **Domínio:** aponte o domínio do site para o servidor.
3. **No servidor**, rode `deploy/setup-vm.sh` com a chave pública de deploy. O script cria as pastas, instala o
   Node 22 se preciso, configura o proxy (ou mostra os campos para o Nginx Proxy Manager), gera o HTTPS com
   certbot e autoriza a chave:
   ```bash
   bash setup-vm.sh "COLE AQUI O CONTEÚDO DE gumgum_deploy.pub"
   ```
   Variáveis opcionais: `DOMAIN`, `PORT`, `CERTBOT_EMAIL` (veja o início do script).
4. **No GitHub** → Settings → Secrets and variables → Actions → *New repository secret*:

   | Secret               | Valor                                                  |
   |----------------------|--------------------------------------------------------|
   | `DEPLOY_HOST`        | endereço do servidor                                   |
   | `DEPLOY_USER`        | usuário SSH do deploy                                  |
   | `DEPLOY_SSH_KEY`     | conteúdo do arquivo `gumgum_deploy` (chave privada)    |
   | `DEPLOY_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 <endereço do servidor>` |

   Use sempre **Secrets** (nunca *Variables*, que ficam visíveis para quem lê o repositório).
   A exceção é a Variable `GOOGLE_CLIENT_ID` do login com Google, que é pública (veja [Contas](#contas-login-com-google)).
5. **No GitHub** → Settings → General → *Default branch*: `main`.
6. **Primeiro deploy:** Actions → "CI e deploy" → *Run workflow* (branch `main`), com `import_sets` = `ST-01 ST-02`
   para já importar as cartas reais. Depois disso, todo push na `main` publica sozinho.

Enquanto os secrets não existirem, o job de deploy é pulado com um aviso (os testes continuam rodando).

### Operação (no servidor)

```bash
pm2 logs gumgumfight        # logs
pm2 restart gumgumfight     # reiniciar
```

Para importar mais coleções, use `import-cards.mjs` do release atual com o `DB_PATH` do banco compartilhado
(para `--spoilers`, informe também `DATA_DIR=<release>/data`; o app no pm2 já recebe essa variável);
para desligar as imagens, defina `CARD_IMAGES=off` no ambiente do app e recarregue-o no pm2.

## Montando decks

No menu, **Montar / editar decks** abre o construtor:

1. **Novo deck** → escolha o Líder (o catálogo mostra só Líderes até você escolher um).
2. Clique nas cartas para adicionar e use o botão direito (ou os botões −/+ na lista) para remover. Por padrão
   aparecem só cartas com a cor do Líder. Dá para filtrar por nome/texto, cor, tipo, custo e coleção.
3. O painel à direita mostra o total, a curva de custo, os Counters e os problemas do deck. **Salvar** grava
   no banco. Decks incompletos ficam salvos como rascunho e aparecem desabilitados no menu.

Regras verificadas: 1 Líder, exatamente 50 cartas, no máximo 4 cópias por número e toda carta com ao menos uma
cor do Líder. Cartas cujo efeito ainda não é automatizado aparecem com ⚙: elas entram no jogo, mas sem o efeito.
Decks prontos (`data/decks`) não são alterados: ao mexer em um, o construtor cria uma cópia.

### Formatos

A partida é sempre num formato, escolhido no menu, e os dois decks precisam valer nele (contra o bot, bot x bot,
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
(bot ou jogador), ordem do turno, período, tier e "só as minhas partidas". A opção "Bots (simulações)" mostra as
partidas bot x bot, que ficam fora das estatísticas de pessoas.

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

No menu, a aba **Online** tem a fila **casual**, a **ranqueada** e as **salas privadas** (criar uma sala gera um código de
6 letras e um link `/?sala=CÓDIGO` para enviar a quem vai jogar). Quem recarrega a página ou troca de aparelho encontra
"Voltar à partida" no mesmo menu.

- **O servidor é a autoridade.** Ele guarda o estado completo e aplica as ações com o motor; cada jogador recebe só a
  própria visão (`packages/engine/src/view.ts`): mão do oponente, decks e Vida virada para baixo chegam como cartas
  escondidas, sem seed nem RNG. Os ids das cartas viram apelidos aleatórios por partida, porque os ids do motor seguem a
  ordem da lista do deck. Uma ação com uma carta fora de vista é recusada.
- **Embaralhamento:** as partidas online usam um RNG de 128 bits (sfc32) com seed do `crypto`. A seed de 32 bits das
  partidas locais poderia ser descoberta por força bruta a partir da mão inicial. Replays e estatísticas antigos não mudam.
- **Relógio:** cada jogador tem **17:30** na partida inteira. O tempo só corre quando a ação ou a decisão (incluindo
  mulligan, Blocker, Counter e escolhas de efeitos) é daquele jogador. Sem tempo, ele perde. Se o jogador da vez ficar
  2 minutos desconectado, perde por abandono.
- **Ranqueada:** só com login Google e sem modo manual: decks com cartas ⚙ (efeito ainda não automatizado) não entram na
  fila, e as ferramentas manuais ficam bloqueadas. O pareamento junta recompensas parecidas e a faixa abre com o tempo de
  espera. No casual e nas salas privadas as ferramentas manuais funcionam, e o que é feito com elas aparece no log do
  oponente (cartas movidas entre zonas escondidas aparecem como "uma carta").
- **Sem desfazer, Auto ou pausa** no online. Mensagens rápidas (emotes de uma lista fixa), revanche nas salas privadas e
  o replay completo para baixar no fim.
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
- **Treino contra o bot no servidor (fase de testes):** em **Contra o bot**, a opção **Jogar no servidor** cria uma
  partida online em que o servidor joga pelo bot (decidindo só com a visão do bot). Ela aparece na lista para assistir,
  então dá para testar o modo espectador sem um segundo jogador. Entra nas estatísticas como partida contra o bot.
  Quando o modo espectador estiver aprovado, `ONLINE_BOT_ROOMS=off` tira a opção do menu e essas salas da lista,
  deixando só as partidas multiplayer.

### Perfis (Player, Streamer, Organizador, Admin)

Cada conta Google tem um perfil (coluna `users.role`): **Player** (padrão: joga e assiste sem ver as mãos),
**Streamer** (assiste vendo as mãos), **Organizador** (cria torneios e gerencia os que criou) ou **Admin** (tudo
isso, gerencia qualquer torneio e muda os perfis em **Perfis das contas**, no menu). Sem login, a pessoa assiste
como Player.

O primeiro admin vem da variável `ADMIN_EMAILS`: quem entra com um desses e-mails (verificado pelo Google) vira Admin
no login. Em produção, crie a *Variable* `ADMIN_EMAILS` no GitHub (como a `GOOGLE_CLIENT_ID`); o próximo deploy a grava
em `shared/deploy.env`. Quem já estava logado precisa sair e entrar de novo. Um admin não muda o próprio perfil.

## Torneios

Em **Torneios** (no menu), contas com perfil **Organizador** ou **Admin** criam torneios; qualquer conta Google se
inscreve. O organizador que criou o torneio gerencia o dele; um Admin gerencia qualquer um.

- **Criação:** nome, descrição e regras, formato (Standard ou Extra Grand Battle), estrutura, limite de jogadores e
  início previsto. Dá para editar tudo enquanto as inscrições estão abertas.
- **Estruturas:**
  - **Suíço:** todos jogam todas as rodadas, contra quem tem a mesma pontuação e sem repetir confrontos. Vitória vale
    3 pontos, empate 1, e o bye (número ímpar de jogadores) conta como vitória e vai para o último colocado que ainda
    não teve um. Desempate por OMW (% de vitórias dos oponentes, mínimo de 33%) e OOMW. O número de rodadas é
    escolhido pelo organizador ou, em branco, calculado no início (⌈log₂ jogadores⌉).
  - **Eliminação simples:** chave sorteada no início, do tamanho da próxima potência de 2; as vagas que sobram viram
    byes para os primeiros cabeças de chave. Não há empate.
- **Inscrição:** com um deck válido no formato. A lista fica **congelada** na inscrição (mudar o deck depois não muda
  o do torneio; inscreva-o de novo para trocar). Os outros jogadores veem só o Líder; as listas completas ficam
  visíveis para o organizador e, quando o torneio termina, para todos.
- **Partidas:** cada jogador clica em **Jogar partida** na página do torneio; quem entra primeiro espera o oponente
  na sala online (fila `tournament`, com relógio e regras das partidas online). O resultado entra sozinho no
  torneio quando a partida termina, e a partida aparece em **Assistir partidas** com o nome do torneio. Entra nas
  estatísticas na fila **Torneio**.
- **Organização:** o organizador lança ou corrige qualquer resultado da rodada atual (W.O., queda de conexão,
  partida jogada fora do site), tira jogadores e gera a próxima rodada quando todas as partidas têm resultado.
  Depois da última rodada (ou da final), o mesmo botão encerra o torneio; **Encerrar agora** termina antes.
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
   autorizadas**, inclua `https://gumgumfight.duckdns.org`, `http://localhost:5173` e `http://localhost` (o botão do
   Google exige as duas formas do localhost). Não é preciso URI de redirecionamento nem a chave secreta.
3. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). Ele não é segredo: vai para todo navegador.
   - **Desenvolvimento:** crie um arquivo `.env` na raiz do projeto com `GOOGLE_CLIENT_ID=...` (o arquivo é ignorado
     pelo git) e reinicie o `npm run dev`.
   - **Produção:** no GitHub → Settings → Secrets and variables → Actions → aba **Variables** → *New repository
     variable* `GOOGLE_CLIENT_ID`. O próximo deploy grava o valor em `shared/deploy.env` na VM.

Sem `GOOGLE_CLIENT_ID`, o botão não aparece e `POST /api/auth/google` responde 503.

## Efeitos automáticos e modo manual

Toda carta da base é jogável:

- **Efeito automatizado:** cartas com script (`packages/engine/src/cards/scripts.ts`) resolvem tudo sozinhas.
- **Modo manual** (cartas com ⚙): o motor lê os momentos marcados no texto ([On Play], [When Attacking],
  [Activate: Main], [Main], [Counter], [Trigger], [On K.O.], [End of Your Turn]…). Na hora certa, o jogo pausa,
  mostra o efeito no painel lateral e libera as **ferramentas manuais**: comprar, nocautear, mover cartas entre
  mão, campo, deck, descarte e Vida, virar/desvirar, ±poder, DON!!, ver o topo do deck e o descarte. O jogador
  aplica o efeito e clica em **Concluir**. As ferramentas também ficam disponíveis no próprio turno, para
  efeitos contínuos. Toda operação passa pelo motor, então nenhuma carta some nem duplica.
- **Cobertura:** a tela "📊 Cobertura das cartas" (no menu) e `GET /api/coverage` mostram, por coleção,
  quantas cartas são automáticas, quantas são manuais e como está a tradução.

Para checar a robustez depois de importar coleções novas (decks aleatórios de toda a base, bot x bot):

```bash
npm run simulate:all -w @gumgum/engine -- caminho/para/cards.json 300   # ou a URL de /api/cards
```

## Como jogar

- **Mulligan:** no início, mantenha ou troque a mão (uma vez).
- **Jogar carta:** clique duplo numa carta destacada em verde na mão, ou selecione e use o painel "Ações".
- **DON!!:** clique na área de DON!! e depois no líder/personagem para anexar (+1000 de poder no seu turno).
- **Atacar:** selecione o líder ou um personagem ativo, clique em "⚔ Atacar" e escolha o alvo (líder ou personagem virado).
- **Defesa:** quando for atacado, o jogo pede Blocker, Counter e [Trigger] quando aplicável.
- **Desfazer** volta para antes da sua última ação. **Replay** baixa um `.json` com todas as ações.
- Em **Opções de teste** (no menu), a **seed** controla o embaralhamento: a mesma seed com as mesmas jogadas
  reproduz a mesma partida. Um replay carregado ali funciona como um "roteiro" que se joga sozinho.

## Estrutura

```
packages/engine   Motor de regras em TypeScript puro (sem dependências), bot e testes
apps/server       API Fastify + SQLite (node:sqlite); serve a interface compilada em produção
apps/web          Interface React + Vite
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

Ainda **não** implementado: [On K.O.] com escolhas complexas, efeitos de substituição, [End of Your Turn],
custos DON!! −X em cartas reais, cartas com efeitos fora da DSL (aparecem com o aviso "efeito ainda não automatizado").

## Dados das cartas

As cartas vêm da [optcgapi.com](https://optcgapi.com/documentation) e ficam salvas no SQLite local. O jogo não
consulta a API durante as partidas.

```bash
npm run cards:import                      # ST-01 e ST-02 (os decks de teste)
npm run cards:import -- ST-03 OP-01       # coleções específicas (ST-xx = starter deck, OP/EB/PRB = boosters)
npm run cards:import -- --all             # tudo
npm run cards:import -- --dry-run ST-01   # mostra o resultado sem gravar
npm run cards:import -- --file resp.json  # importa uma resposta da API salva em arquivo (sem rede)
```

- Versões com arte alternativa (mesmo ID) são unificadas; cartas DON!! são ignoradas.
- **Limpeza:** o importador remove do nome a versão de impressão ("(Parallel)", "(025)", "(OP01-060)"…),
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

Cada jogador escolhe "Português" ou "English" no menu ou durante a partida (a escolha fica salva no navegador).

- **Tradução automática:** feita por regras em `packages/engine/src/i18n/pt.ts`. Os textos do jogo seguem modelos
  fixos, então a maior parte é traduzida sem serviço externo. Trechos não reconhecidos ficam em inglês e a carta é
  marcada como "tradução parcial". O painel da carta sempre tem o link "ver original".
- **Traduções revisadas:** `data/translations/pt.json` (`{ "cards": { "OP01-001": { "text": "...", "trigger": "..." } } }`)
  tem prioridade sobre a automática. `GET /api/translations/pending` lista as cartas com tradução parcial, para revisão.
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
| PUT    | `/api/admin/users/:id/role` | Muda o perfil (`{ role: player \| streamer \| organizer \| admin }`; só Admin) |
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
| POST   | `/api/online/bot` | Treino contra o bot do servidor (`{ deckId, botDeckId \| random, format }`; desligado com `ONLINE_BOT_ROOMS=off`) |
| GET    | `/api/online/live` | Partidas para assistir (`{ rooms, hands }`; `hands`: quem pede pode ver as mãos) |
| GET    | `/api/online/watch/:code` | Sala privada pelo código, para assistir |
| GET    | `/api/online/rooms/:id` | Resumo de uma sala (jogadores, turno, espectadores) |
| GET    | `/api/online/rooms/:id/watch?hands=1` | Canal SSE do espectador (`hands=1`: só Streamer e Admin) |
| GET    | `/api/tournaments` | Torneios (`{ tournaments, canCreate }`) |
| GET    | `/api/tournaments/:id` | Torneio completo: inscritos, rodadas, classificação e o que quem pede pode fazer |
| POST   | `/api/tournaments` | Cria (`{ name, description, format, structure: swiss \| single, rounds, maxPlayers, startsAt }`; Organizador e Admin) |
| PUT / DELETE | `/api/tournaments/:id` | Edita (só com inscrições abertas) / apaga (organizador do torneio ou Admin) |
| POST / DELETE | `/api/tournaments/:id/register` | Inscreve ou troca o deck (`{ deckId }`) / cancela a inscrição ou desiste |
| POST   | `/api/tournaments/:id/start` · `/next` · `/finish` | Começa, gera a próxima rodada (ou encerra depois da última) e encerra antes |
| PUT    | `/api/tournaments/:id/matches/:matchId/result` | Resultado da rodada atual (`{ result: p1 \| p2 \| draw \| null }`) |
| POST   | `/api/tournaments/:id/players/:userId/drop` | Tira um jogador (organizador) |
| POST   | `/api/tournaments/:id/matches/:matchId/play` | Abre ou entra na sala online da partida (`{ roomId, token }`) |

Filtros de `/api/stats` e `/api/stats/cards`: `format` (standard, egb), `queue` (casual, ranked, tournament), `opponent` (bot,
human), `by` (human = padrão, bot = simulações), `tiers` (ids separados por vírgula), `leader`, `oppLeader`,
`first` (first, second), `days`, `mine=1` e `deck`.

## Aviso

Projeto de fã, sem fins lucrativos e sem vínculo com Bandai, Toei Animation ou Shueisha. One Piece e
One Piece Card Game são marcas de seus respectivos donos.
