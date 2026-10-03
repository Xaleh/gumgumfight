# GumGum Fight

Simulador de **One Piece Card Game** no navegador, inspirado no [Duels.ink](https://duels.ink/) (Lorcana).

> **Status: Fase 1, protótipo solo.** Dois decks iniciais (Luffy vermelho ST01 e Kid verde ST02), partidas
> contra um bot, modo demonstração bot x bot e replays. Cartas importadas da [optcgapi.com](https://optcgapi.com/documentation),
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
5. **No GitHub** → Settings → General → *Default branch*: `main`.
6. **Primeiro deploy:** Actions → "CI e deploy" → *Run workflow* (branch `main`), com `import_sets` = `ST-01 ST-02`
   para já importar as cartas reais. Depois disso, todo push na `main` publica sozinho.

Enquanto os secrets não existirem, o job de deploy é pulado com um aviso (os testes continuam rodando).

### Operação (no servidor)

```bash
pm2 logs gumgumfight        # logs
pm2 restart gumgumfight     # reiniciar
```

Para importar mais coleções, use `import-cards.mjs` do release atual com o `DB_PATH` do banco compartilhado;
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

Não há login: cada navegador recebe um código aleatório (guardado no navegador) e só ele pode editar ou apagar os
decks que criou. Decks de outros jogadores aparecem em "Decks da comunidade": dá para jogar com eles e duplicá-los.
Limpar os dados do site no navegador faz perder a edição dos próprios decks.
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
  O tier gravado é o da hora da partida. Partidas enviadas pelo navegador são sempre casuais: a ranqueada será
  gravada pelo servidor de partidas online (com `recordMatch`), que será a autoridade.
- Sem login, o jogador é o navegador (o mesmo código de dono dos decks). O nome do cartaz de "WANTED" pode ser trocado
  na tela de estatísticas.

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

Como o motor é independente da interface, o mesmo código vai rodar no servidor quando entrar o multiplayer
online, com o servidor como autoridade para esconder mão e deck.

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
| GET    | `/api/config`      | Configurações públicas (imagens ligadas?)   |
| GET    | `/api/cards?set=`  | Lista cartas (opcionalmente por coleção)    |
| GET    | `/api/cards/:id`   | Uma carta                                   |
| GET    | `/api/decks`       | Lista decks, com validação                  |
| GET    | `/api/decks/:id`   | Deck + definições das cartas usadas         |
| POST   | `/api/decks`       | Cria um deck (`{ name, leader, cards }`)    |
| PUT    | `/api/decks/:id`   | Atualiza um deck do jogador                 |
| DELETE | `/api/decks/:id`   | Apaga um deck do jogador                    |
| POST   | `/api/matches`     | Envia o replay de uma partida (verificado pelo servidor) |
| GET    | `/api/matches`     | Últimas partidas                            |
| GET    | `/api/players/me`  | Perfil do navegador (nome, recompensa, tier) |
| PUT    | `/api/players/me`  | Troca o nome (`{ name }`)                   |
| GET    | `/api/stats/meta`  | Opções dos filtros: formatos, filas, tiers, Líderes |
| GET    | `/api/stats`       | Totais, Líderes e matchups (filtros na query) |
| GET    | `/api/stats/trend?weeks=` | Uso e vitórias por Líder em cada semana (padrão 6) |
| GET    | `/api/stats/cards?leader=` | Desempenho das cartas de um Líder (ou `deck=` hash da lista) |
| GET    | `/api/translations/pending` | Cartas com tradução automática parcial |

Filtros de `/api/stats` e `/api/stats/cards`: `format` (standard, egb), `queue` (casual, ranked), `opponent` (bot,
human), `by` (human = padrão, bot = simulações), `tiers` (ids separados por vírgula), `leader`, `oppLeader`,
`first` (first, second), `days`, `mine=1` e `deck`.

## Aviso

Projeto de fã, sem fins lucrativos e sem vínculo com Bandai, Toei Animation ou Shueisha. One Piece e
One Piece Card Game são marcas de seus respectivos donos.
