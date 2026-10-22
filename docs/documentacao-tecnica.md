# GumGum Fight — Documentação técnica do produto

> Documento de referência da arquitetura inteira: stacks, estrutura do código, banco de dados, cartas (oficiais e
> não oficiais), partidas, torneios, transmissão ao vivo, infraestrutura e capacidade da VPS. Os números de memória,
> CPU e banda foram **medidos** no pacote de produção (`npm run build:release`) na data abaixo; o modelo de
> capacidade usa esses números como base.
>
> Última revisão: 2026-10-08. Fonte da verdade é sempre o código; os caminhos citados são
> relativos à raiz do repositório.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Stacks e dependências](#2-stacks-e-dependências)
3. [Estrutura do repositório](#3-estrutura-do-repositório)
4. [Motor de regras (`packages/engine`)](#4-motor-de-regras-packagesengine)
5. [Backend (`apps/server`)](#5-backend-appsserver)
6. [Frontend (`apps/web`)](#6-frontend-appsweb)
7. [Banco de dados](#7-banco-de-dados)
8. [Cartas: aquisição e armazenamento](#8-cartas-aquisição-e-armazenamento)
9. [Partidas: o que é gravado, onde e em que formato](#9-partidas-o-que-é-gravado-onde-e-em-que-formato)
10. [Contas, perfis e sessões](#10-contas-perfis-e-sessões)
11. [Multiplayer online e transmissão ao vivo (espectador)](#11-multiplayer-online-e-transmissão-ao-vivo-espectador)
12. [Torneios](#12-torneios)
13. [Infraestrutura: build, CI/CD, VPS](#13-infraestrutura-build-cicd-vps)
14. [Capacidade: memória, CPU e banda (medições)](#14-capacidade-memória-cpu-e-banda-medições)
15. [Quando e como escalar a VPS](#15-quando-e-como-escalar-a-vps)
16. [Riscos e limites conhecidos](#16-riscos-e-limites-conhecidos)
17. [Apêndices](#17-apêndices)

---

## 1. Visão geral

O GumGum Fight é um simulador do **One Piece Card Game** que roda no navegador. O produto tem cinco partes:

| Parte | O que faz | Onde roda |
|---|---|---|
| **Motor de regras** | Aplica as regras do jogo: `applyAction(estado, ação) → novo estado`. Função pura, determinística, sem dependências. | No navegador (partida contra o bot, replays) **e** no servidor (partidas online, verificação de replays). |
| **Backend (API)** | Fastify + SQLite. Cartas, decks, contas, estatísticas, salas online, torneios. Em produção também entrega a interface compilada. | Um único processo Node na VPS, atrás do Nginx. |
| **Frontend** | React + Vite. Menu, construtor de decks, mesa de jogo, espectador, estatísticas, torneios, administração. | Navegador (SPA instalável como PWA: service worker com cache da casca e notificações). |
| **Importador de cartas** | Busca as cartas oficiais e os spoilers numa cadeia de fontes com prioridade (`CARD_SOURCES` / `SPOILER_SOURCES`: optcgapi.com, optcgleaks.com, cardkaizoku.com); normaliza e grava no SQLite. | CLI no servidor + sincronização periódica dentro do próprio processo da API. |
| **Deploy** | GitHub Actions monta um pacote autocontido, envia por SSH, ativa no pm2 com rollback automático. | GitHub + VPS (Hostinger, produção) + servidor de homologação. |

Princípios que explicam várias decisões do código:

- **Zero serviços externos em tempo de execução.** Nada de Postgres, Redis, fila ou CDN própria. O banco é um
  arquivo SQLite aberto pelo SQLite embutido no Node (`node:sqlite`), sem módulo nativo. Imagens das cartas vêm
  direto dos sites de origem (optcgapi / optcgleaks), não passam pela VPS.
- **O servidor é a autoridade nas partidas online.** Ele guarda o estado completo e cada navegador recebe só a
  própria visão. Estatísticas só gravam o que o motor confirma ao refazer o replay.
- **Um processo, uma máquina.** Salas, filas e presença vivem na memória do processo Node. Isso define o caminho de
  escala (seção 15).

---

## 2. Stacks e dependências

### Linguagem e runtime

| Item | Versão | Observação |
|---|---|---|
| TypeScript | `^5.6.3` | `strict`, `target ES2022`, `moduleResolution: Bundler`, `noEmit` (`tsconfig.base.json`). |
| Node.js | **≥ 22.13** (`engines` no `package.json`) | Exigido por `node:sqlite` e `process.loadEnvFile`. A VPS usa Node 22 (NodeSource). |
| npm workspaces | `packages/*`, `apps/*` | Monorepo; o motor é consumido como pacote local `@gumgum/engine` direto do `.ts` (sem build). |

### Motor (`@gumgum/engine`)

Sem dependências de produção. Dev: `vitest ^3`, `tsx ^4.19`.

### Backend (`@gumgum/server`)

| Pacote | Versão | Papel |
|---|---|---|
| `fastify` | `^5.2.0` | HTTP, roteamento, `trustProxy: true` (fica atrás do Nginx). |
| `@fastify/static` | `^8.0.3` | Entrega `apps/web/dist` em produção (`/assets/*` com cache de 1 ano, resto `no-cache`). |
| `node:sqlite` | embutido no Node 22 | Banco SQLite síncrono, `journal_mode = WAL`, `foreign_keys = ON`. |
| `node:crypto` | embutido | Hashes (dono do navegador, sessões, listas), tokens, seeds de 128 bits, verificação RS256 do Google. |
| `tsx` | `^4.19.2` | Executa TS em desenvolvimento (`tsx watch`) e nos scripts. Em produção o servidor é um bundle `esbuild`. |

### Frontend (`@gumgum/web`)

| Pacote | Versão | Papel |
|---|---|---|
| `react`, `react-dom` | `^18.3.1` | UI. Estado só com hooks e dois Contexts (`SettingsProvider`, `AuthProvider`). |
| `vite` + `@vitejs/plugin-react` | `^5.4.11` / `^4.3.4` | Dev server com proxy `/api → 127.0.0.1:3001`; build com hash nos assets. |
| CSS | arquivo único `apps/web/src/styles.css` (~7.300 linhas) | Tema claro/escuro por `data-theme` no `<html>`. Fontes Google (`Bangers`, `Nunito`). |
| Google Identity Services | script `https://accounts.google.com/gsi/client` | Botão de login (carregado sob demanda). |

Não há roteador (react-router), gerenciador de estado nem biblioteca de componentes. O PWA é o
`manifest.webmanifest` (ícones, `display: standalone`) mais um service worker escrito à mão (`/sw.js`, sem Workbox; ver
[PWA](#pwa-instalação-tela-acesa-e-notificações)).

### Ferramentas de build, teste e deploy

| Ferramenta | Uso |
|---|---|
| `esbuild ^0.24` | Empacota `apps/server/src/{index,import-cards,seed-cli}.ts` em `release/server/*.mjs` (ESM, `--platform=node --target=node22`). |
| `vitest ^3` | Testes do motor (46 arquivos, ~440 casos, inclui simulações bot x bot) e do servidor (9 arquivos: API, auth, decks, online, spoilers, stats, torneios…). |
| `concurrently`, `wait-on` | `npm run dev` sobe API e Vite; o Vite só sobe quando `/api/health` responde. |
| GitHub Actions | `.github/workflows/ci-deploy.yml`: typecheck, testes, build, smoke test do pacote, deploy por SSH. |
| pm2 | Mantém o processo no ar (`deploy/ecosystem.config.cjs`, modo `fork`, 1 instância, `max_memory_restart: 400M`). |
| Nginx + certbot | Proxy reverso, TLS (Let's Encrypt), gzip. |
| ufw, fail2ban, cron + `sqlite3` | Firewall (22/80/443), proteção do SSH, backup diário do banco. |

---

## 3. Estrutura do repositório

```
gumgumfight/
├── package.json                 workspaces, scripts (dev, test, typecheck, build:release, cards:import, db:seed)
├── tsconfig.base.json
├── packages/engine/             motor de regras (TS puro)
│   ├── src/engine.ts            createGame, applyAction (5.149 linhas)
│   ├── src/types.ts             CardData, GameState, Action, Pending, Frame, DSL de efeitos (1.400 linhas)
│   ├── src/actions.ts           legalActions, actingPlayer
│   ├── src/view.ts              viewFor (visão por jogador/espectador), apelidos, actionFromView
│   ├── src/rng.ts               mulberry32 (32 bits) e sfc32 (128 bits)
│   ├── src/replay.ts            REPLAY_VERSION, upgrade de replays antigos
│   ├── src/deck.ts              validateDeck, parse/format de listas
│   ├── src/formats.ts           Standard / Extra Grand Battle, banidas, rotação
│   ├── src/errata.ts, source-fixes.ts   correções de dados (errata oficial / erros da optcgapi)
│   ├── src/cards/parser.ts      texto da carta → habilidades (DSL) (3.180 linhas)
│   ├── src/cards/scripts.ts     scripts escritos à mão (62 cartas, prioridade sobre o parser)
│   ├── src/i18n/pt.ts, render.ts   tradução automática para português
│   ├── src/bot/simple.ts        bot heurístico (nível fácil)
│   ├── src/bot/evaluate.ts      função de avaliação do bot com busca
│   ├── src/bot/planner.ts       bot com busca (níveis normal e difícil)
│   ├── scripts/simulate*.ts     simulações bot x bot na linha de comando
│   └── test/                    46 arquivos de teste + fixtures
├── apps/server/                 API Fastify
│   ├── src/index.ts             entrypoint: abre o banco, seed, agenda sync de spoilers, listen
│   ├── src/app.ts               buildApp: rotas de cartas, decks, coverage, static; registra os módulos
│   ├── src/card-gaps.ts         lacunas do leitor para o Dev (diagnóstico, ranking das frases, cartas novas com ⚙)
│   ├── src/card-engine-texts.ts texto para o motor (Dev): prévia, gravar, apagar, histórico
│   ├── src/db.ts                schema SQLite (migrações idempotentes) e acesso a cards/decks/live_matches
│   ├── src/config.ts, env.ts, paths.ts   variáveis de ambiente e caminhos
│   ├── src/optcgapi.ts          mapeamento da optcgapi → CardData
│   ├── src/card-import.ts, import-cards.ts   CLI de importação
│   ├── src/card-sources/                     cadeia de fontes (optcgapi, optcgleaks, cardkaizoku) e resolução por carta
│   ├── src/card-cdn/                         CDN própria das imagens (Cloudflare R2, SigV4 sem SDK), index.json e
│   │                                         imagens oficiais da Bandai (official.ts: listas EN, Ásia e JP)
│   ├── src/spoiler-feed.ts, spoiler-sync.ts  optcgleaks + troca por cartas oficiais
│   ├── src/official-cards.ts, check-official.ts, check-translations.ts  scripts de conferência
│   ├── src/seed.ts, seed-cli.ts  decks prontos, cartas provisórias, traduções
│   ├── src/present.ts           ApiCard: i18n e remoção de imagens
│   ├── src/auth/                google.ts (JWKS/RS256), store.ts (users, sessions, roles), routes.ts
│   ├── src/partners/            API para parceiros: store.ts (api_tokens, oauth_clients, oauth_codes), tokens.ts (middleware Bearer, /api/tokens), oauth.ts, webhook.ts, matches.ts
│   ├── src/oauth-client-cli.ts  cadastro dos clientes OAuth (npm run oauth:client)
│   ├── src/online/              room.ts (uma partida + relógio + mesa atrasada), lobby.ts (salas, filas, presença), routes.ts (HTTP + SSE), broadcast.ts (modo transmissão)
│   ├── src/stats/               catalog.ts (tiers, Elo), derive.ts (refaz replay), store.ts (SQL), routes.ts
│   ├── src/tournaments/         pairing.ts (suíço, chave), store.ts (SQL), routes.ts
│   ├── src/push/                webpush.ts (VAPID + RFC 8291), store.ts (SQL), messages.ts (textos), routes.ts (Notifier)
│   └── test/                    9 arquivos de teste + fixtures da optcgapi/optcgleaks
├── apps/web/                    React + Vite
│   ├── src/App.tsx              seleção de tela (useState<Screen>, sem roteador)
│   ├── src/api.ts               todos os fetches, header x-deck-owner, URLs de SSE
│   ├── src/auth.tsx, settings.tsx   contexts (login; configurações, inclusive o idioma `locale`)
│   ├── src/i18n/                idiomas da interface: index.ts (t/useT, plural), pt-BR.ts (chaves), en.ts, es.ts, ja.ts, fr.ts, de.ts, format.ts
│   ├── src/components/Flags.tsx bandeiras SVG do seletor de idioma
│   ├── src/audio.ts             efeitos e música (Web Audio); src/assets/audio/ com os MP3 e CREDITS.md
│   ├── src/game/useMatchAudio.ts   sons derivados das mudanças de estado da partida
│   ├── src/game/useGame.ts      partida local (motor + bot no navegador, undo, replay)
│   ├── src/game/useOnlineGame.ts   canal SSE, reconexão, fila de ações
│   ├── src/pwa.ts               service worker, convite de instalação, Wake Lock, inscrição nas notificações
│   ├── src/service-worker.js    fonte do /sw.js (o plugin em vite.config.ts preenche versão e arquivos)
│   ├── src/components/          Menu, DeckBuilder, GameScreen (2.319 linhas), Board, Watch, Tournaments, Stats, Admin…
│   └── public/                  manifest, ícones, marca
├── data/
│   ├── cards/*.json             34 arquivos de cartas provisórias (750 cartas; ST01–ST36 parciais, OP01, OP02)
│   ├── decks/*.json             36 decks prontos (um por starter deck)
│   ├── spoilers/*.json                 coleções futuras e promos anunciadas (feed pela cadeia SPOILER_SOURCES)
│   ├── translations/pt.json     traduções revisadas (hoje vazio)
│   └── card-types.json          172 tipos conhecidos (para separar "Heart Pirates Supernovas")
├── deploy/                      bootstrap-hostinger.sh, setup-vm.sh, remote-deploy.sh, ecosystem.config.cjs, HOSTINGER.md
├── scripts/build-release.sh     monta release/
├── docs/rules/                  base de regras (CR v1.2.1), interações, divergências do motor, mapeamento da DSL
└── .github/workflows/ci-deploy.yml
```

Tamanho do código (linhas, sem testes): motor ≈ 14.400, servidor ≈ 5.600, web ≈ 12.400 (mais 7.300 de CSS).

---

## 4. Motor de regras (`packages/engine`)

### Modelo

- **Estado** (`GameState`, `types.ts:1200`): JSON puro, sem classes. Campos principais: `turn`, `firstPlayer`,
  `activePlayer`, `phase` (`mulligan | main | gameover`), `players[2]` (líder, personagens, stage, mão, deck, lixo,
  Vida, DON!! ativos/virados/no deck), `cards` (instâncias `uid → {cardId, owner}`), `defs` (definições das cartas
  usadas), `stack` (frames de efeito/batalha/dano), `pending` (decisão esperada: alvo, bloqueio, counter, carta de
  Vida, confirmação, opção, mulligan, quem começa), `modifiers`, `log`, `winner`, `winReason`, `actionCount`,
  `rng`/`rng128`.
- **`createGame(config)`** (`engine.ts:59`): recebe `seed` (32 bits) ou `seed128` (4 inteiros), `players` (nome, deck,
  `isBot`), `cards: CardData[]`, `firstPlayer?`, `chooseFirst?`, `legacySetup?`. Embaralha com Fisher–Yates.
- **`applyAction(prev, action)`** (`engine.ts:998`): clona o estado (sem clonar `defs`), aplica e devolve o novo;
  lança `IllegalActionError`. Nunca muda `prev`, então uma ação recusada não deixa rastro.
- **`legalActions(state, player)`** e **`actingPlayer(state)`** (`actions.ts`): usadas pela UI, pelo bot e pelo servidor.
- **Ações** (18 tipos): `mulligan`, `playCard`, `attachDon`, `detachDon`, `cancel`, `activate`, `attack`, `endTurn`,
  `choose`, `answer`, `counter`, `pass`, `option`, `concede`, `timeout` (só o servidor), `manual`/`manualDone`
  (`manual` só nos testes; recusada quando vem do jogador online) e `judge` (correção do Judge no modo manual de
  torneio: a mesma `ManualOp` de `manual`, pelo lado de `player`, fora da vez e com qualquer pendência, sem o
  `manualAllowed`; loga `log.judgeIntervention` com o nome `by` e apaga o `cancel`/`checkpoint` da jogada em andamento.
  Só o servidor a cria, pela rota do Judge; seção 12).
- **Determinismo**: o RNG vive dentro do estado. `mulberry32` (32 bits) nas partidas locais; `sfc32` (128 bits,
  seed do `crypto`) nas online, porque 32 bits poderiam ser descobertos por força bruta a partir da mão inicial.
- **Replays**: `REPLAY_VERSION = 11`; `upgradeReplayActions` insere respostas implícitas de versões antigas. Não há
  "verificador" no motor: verificar um replay é refazer a partida com `createGame` + `applyAction`. `ReplayCursor`
  navega por um replay (avançar, voltar, pular para a ação N): guarda o estado a cada 20 ações e refaz a partir do
  mais próximo; uma ação que o motor recusa encurta o replay (`failed`).

### Efeitos das cartas

1. `fixCard` aplica `SOURCE_FIXES` (117 correções de nome/tipo da optcgapi) e `ERRATA` (13 erratas oficiais).
2. Se existe script em `CARD_SCRIPTS[id]` (`cards/scripts.ts`, 62 cartas ST01–ST05), ele vale.
3. Senão `parseCard` (`cards/parser.ts`) traduz o texto em inglês para a DSL (`Ability { timing, steps: EffectStep[] }`,
   ~130 variantes de `EffectStep`). Uma linha só é automática se for entendida **por inteiro**.
4. `automationStatus(card)` ∈ `scripted | vanilla | auto | partial | manual`. `partial` e `manual` são as cartas com ⚙:
   jogáveis, mas o efeito pausa o jogo e segue sem aplicar; proibidas na ranqueada.
5. `diagnoseCard(card)` (ferramentas de Dev): para cada linha de `effectLines` e o [Trigger], se o leitor entendeu e,
   se não, `stage` (a parte do leitor que recusou: `clause`, `condition`, `search`, `cost`, `static`, `header`,
   `timing`, `keyword`, `empty`, `unknown`), `fragment` (o primeiro trecho recusado, de `diagnoseLine`/`diagnoseTrigger`)
   e `pattern` (`gapPattern`: números, nomes, tipos, atributos e cores trocados por marcadores, para juntar frases
   iguais de cartas diferentes). As linhas recusadas são as mesmas de `parseCard(card).unparsed` (teste em
   `diagnose.test.ts`).
6. **Texto para o motor** (`CardData.engineText = { text, trigger? }`, escrito pelo Dev): `forEngine(card)` troca
   `text`/`trigger` por ele antes de ler; `buildCardDef`, `automationStatus` e `diagnoseCard` usam `forEngine`, e o
   `CardDef` continua com o texto oficial (é o exibido). Sem `trigger` no texto para o motor, o leitor não vê [Trigger].
   O servidor põe o campo nas cartas em `listCards`/`getCards` (junção com `card_engine_texts`) só enquanto o hash do
   texto oficial for o de quando foi escrito; a tradução em português sai do texto para o motor.

### Visão por jogador (`view.ts`)

`viewFor(state, viewer, aliases, extra?)` devolve um `GameState` com: cartas fora de vista como `?`/`~` (com handle
de posição `~dono:zona:índice`), `defs` só das cartas visíveis, `seed`/`rng` zerados, `rng128` e `checkpoint`
removidos, passos de efeito do oponente esvaziados, `pending` do oponente sem opções, `log.secret` só para o dono.
`viewer = null` é o espectador (nada de mão). Os uids reais (`c1, c2…`) seguem a ordem do deck, por isso o servidor
troca cada um por um apelido aleatório (`createAliases`, HMAC-SHA256 com salt da sala). `actionFromView` traduz de
volta a ação feita sobre a visão.

### Formatos (`formats.ts`)

`standard` e `egb` (`FormatId`, os oficiais: filas, selos do deck e estatísticas) e `free`, o Livre (`PlayFormat`: só
torneios, salas privadas e treino contra o bot), em que `cardLegality`/`formatIssues` aceitam tudo. `PlayMode` =
formato + `spoilers` (`playMode` liga os spoilers no Livre); `countsInStats` diz se a partida entra nas estatísticas
(só Standard e EGB puros, sem spoilers). Banidas (6 cartas, uma com `since: 2026-10-12`), 3 pares proibidos, rotação
do bloco ① em Standard (`/^(OP0[1-4]|ST0[1-9])-/`, exceto 14 ids). `validateDeck` confere 50 cartas, 4 cópias, cor do Líder e
regras especiais do Líder.

### Tradução

`translateCardPt` monta o português a partir da DSL; o que o parser não entendeu passa por `translateToPt` (regras de
frase). Resultado `complete: boolean` → o servidor marca `i18n.pt.source = manual | auto | partial`.

### Bot (`bot/`)

Três níveis (`BotLevel`), escolhidos no menu "Contra o bot"; o servidor (treino transmitido, `queue: 'bot'`) usa o `hard`.
Todos decidem pela **visão** do jogador (`viewFor`): no navegador, `useGame.ts` monta a visão com `identityAliases`
e traduz a jogada de volta com `actionFromView`, como o servidor já fazia.

- **`easy`** (`simple.ts`): heurístico (valor = custo × 1000 + poder): joga a carta mais cara, anexa DON!! até superar
  o Líder inimigo, ataca para K.O. de custo ≥ 3 ou o Líder, bloqueia/conta só quando vale a pena. Rápido (< 1 ms);
  é o bot dos testes de simulação (`sim.ts`) e do `simulate:all`.
- **`normal`** e **`hard`** (`planner.ts` + `evaluate.ts`): simulam as jogadas com `applyAction` e comparam pela
  função de avaliação (`evaluate`, pesos em `DEFAULT_WEIGHTS`). `normal` olha uma jogada à frente; `hard` faz busca
  em feixe sobre o turno inteiro (jogadas compostas "anexar k DON!! e atacar", linhas "tudo no Líder" para achar o
  ataque fatal, vaga reservada no feixe para a melhor linha de cada número de cartas jogadas, teto de 250 ms por
  busca) e guarda a linha escolhida para as decisões seguintes enquanto a partida seguir o previsto. As escolhas
  pendentes (bloqueio, Counter, carta da Vida, alvos, opções, "pagar X?") simulam cada resposta possível. O
  oponente, na simulação, bloqueia do jeito que mais prejudica o bot e nunca usa Counter (a mão dele é escondida):
  o Counter entra como um ajuste de probabilidade pelo tamanho da mão e pela margem do ataque (`counterAdjust`;
  as cartas escondidas somam, e um ataque fatal ele defende sempre que pode, parando o acerto mais barato da linha).
  Uma vitória provável vale `winCap` vezes a chance de passar, não `win`, para a posição que sobra se o ataque
  for parado continuar pesando.
- Para a simulação funcionar na visão, os frames de efeito **do próprio jogador** vão inteiros na visão (passos,
  escolhas, alvos, com uids apelidados); os do oponente seguem só com a carta de origem.

Os conceitos de tempo que a avaliação representa e os testes de posição que os cobrem estão em
[`docs/bot-tempo.md`](bot-tempo.md). Medição: `npm run compare-bots -w @gumgum/engine -- 100 hard easy`; contra um
"humano fraco" que defende como gente (`scripts/human.ts`): `npx tsx packages/engine/scripts/vs-human.ts 200 hard`.

---

## 5. Backend (`apps/server`)

### Ciclo de vida do processo (`index.ts`)

1. `env.ts` lê `.env` (só fora de produção).
2. `openDb()` abre `DB_PATH` (padrão `apps/server/var/gumgum.db`; produção `~gumgum/apps/gumgumfight/shared/gumgum.db`),
   `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, roda as migrações (`CREATE TABLE IF NOT EXISTS` + `ALTER` condicionais).
3. `seed(db)`: cartas provisórias de `data/cards` (nunca sobrescrevem cartas da API), spoilers de `data/spoilers`,
   decks prontos de `data/decks`, traduções de `data/translations`.
4. `scheduleSpoilerSync`: 15 s após subir e depois a cada `SPOILER_SYNC` horas (padrão 6).
5. `buildApp(db)` e `listen(PORT, HOST)`. `SIGINT`/`SIGTERM` fecham o app (e os canais SSE) com limite de 1,5 s.

### Módulos e rotas

`app.ts` registra, nesta ordem: health/config, cartas, coverage, traduções pendentes, `registerBearerAuth` (hook
`onRequest` dos tokens de parceiros, antes de todas as rotas), `registerAuth`, decks,
`registerPushRoutes` (devolve o `Notifier`), `registerStatsRoutes`, `registerPartnerMatchRoutes`,
`registerTokenRoutes`, `registerOAuthRoutes`, `registerOnlineRoutes` (devolve o `Lobby`; recebe o
`Notifier`), `registerTournamentRoutes` (recebe o `Lobby` e o `Notifier`),
`/api/matches`, e por fim o static + fallback para `index.html`. A tabela completa de rotas está no
[Apêndice B](#b-rotas-da-api).

### Identidade do cliente

- **Sem login**: o navegador gera `gumgum.owner` (24 bytes aleatórios em hex) e manda em **todo** fetch no header
  `x-deck-owner`. O servidor guarda só `sha256(token)` (`owner_hash`).
- **Com login**: o cookie `gg_session` identifica a conta; o dono passa a ser `user:<id>`.
- **Com token de parceiro** (`Authorization: Bearer ggf_…`, `partners/tokens.ts`): a conta dona do token, sempre como
  Player, limitada aos scopes do token e às rotas que declaram `config.scope`; cookie e `x-deck-owner` são ignorados.
  120 req/min por token (429). Detalhes na seção 10.
- Rate limit nas ações das salas (60 ações / 10 s por assento), nos emotes (1 / 3 s) e no chat (1 / 1,5 s e 10 / min por
  assento). O chat (`Room.chat`) limpa o texto (sem controle/quebras, até 120 caracteres) e censura palavrões em PT/EN
  (`online/profanity.ts`: palavra inteira, sem acentos, com trocas de letra por número/símbolo, repetição e soletrado) antes
  de repassar; nada fica gravado.
- **Tetos de salas** (`online/lobby.ts`, `DEFAULT_LIMITS`, conferidos em `lobby.admit` antes de criar sala, entrar numa,
  entrar na fila ou abrir treino contra o bot): 400 salas ativas no servidor (`ONLINE_MAX_ROOMS`, 503 acima), 100 salas de
  bot (`ONLINE_MAX_BOT_ROOMS`, 503; o menu cai para o treino no navegador), 16 salas ou lugares na fila por IP ao mesmo tempo (429) e 60 criações por IP a cada
  10 min (429). Os IPs ficam só em memória (nunca no banco). Partidas de torneio só passam pelo teto global.
- **Rate limit por IP no Nginx** (scripts de deploy): `/api/` com 30 req/s por IP, rajada de 100, e 64 conexões
  simultâneas por IP (os canais SSE contam). Acima disso, 429 antes de chegar ao app. Os IPs dos servidores de apps
  parceiros (`PARTNER_IPS` no `deploy.env`, `geo` + `map` em `gumgumfight-limits.conf`) ficam fora desse limite: para
  eles vale o limite por token do app.

### Limites de corpo

Fastify: `bodyLimit` padrão (1 MiB). Nginx: `client_max_body_size 2m`. O maior corpo enviado é o replay de uma
partida local (`POST /api/matches`, ~7–10 KB).

### Concorrência

Tudo roda num único event loop. **`node:sqlite` é síncrono**: cada consulta bloqueia o loop enquanto dura. As
consultas de estatísticas (`GROUP BY` sobre `match_seats`/`match_cards`) e o torneio completo são as potencialmente
longas; por isso as respostas de `GET /api/stats*` e `GET /api/tournaments/:id` ficam em cache (`cache.ts`,
`ResponseCache`): a entrada vale enquanto a versão global dos dados (`dataVersion`, incrementada por toda gravação de
partida, torneio ou nome de jogador) não muda, com TTL de segurança (30 s e 5 s), e sai com `ETag` +
`Cache-Control: private, no-cache`, então o navegador manda `If-None-Match` e recebe 304 sem corpo quando nada mudou.

---

## 6. Frontend (`apps/web`)

### Telas

`App.tsx` mantém `useState<Screen>`: `menu`, `builder`, `coverage` (Dev), `stats`, `admin` (Admin), `watch-list`,
`watch`, `tournaments`, `game` (contra o bot / replay) e `online`. As telas `online` e `watch` ficam em
`sessionStorage.gumgum.openMatch` para sobreviver a recarga. Parâmetros de URL, lidos uma vez e removidos com
`history.replaceState`: `?sala=CÓDIGO` (convite de sala privada), `?partida=<sala>` e `?torneio=<id>` (abertos ao tocar
numa notificação: a partida online, se ainda estiver em `/api/online/active`, ou a página do torneio).

### Dados no navegador

| Chave | Conteúdo |
|---|---|
| `localStorage.gumgum.owner` | token do dono dos decks/perfil (sem login) |
| `localStorage.gumgum.settings` | `{locale, images, quickCounter, animations, replayCues, theme, opponentChat, sfxVolume, musicVolume, keepAwake, notify, notifyMatches, notifyTournaments}` (`lang: 'pt'\|'en'` antigo é migrado para `locale`) |
| `localStorage.gumgum.installDismissed` | quando o convite de instalação foi dispensado ("Agora não" esconde por 30 dias) |
| Cache Storage `gumgum-<versão>` | casca do app guardada pelo service worker |
| `localStorage.gumgum.lastDecks`, `gumgum.format` | últimos decks e formato escolhidos |
| `localStorage.gumgum.watchHands`, `gumgum.watchChatOff`, `gumgum.statsFilters`, `gumgum.statsMin` | preferências de espectador e estatísticas |
| `sessionStorage.gumgum.openMatch` | partida/transmissão aberta |

Nada de cache de cartas: o construtor baixa `GET /api/cards` inteiro toda vez que abre.

### Idiomas da interface (`src/i18n/`)

Seis idiomas, sem biblioteca externa: `pt-BR` (padrão e referência), `en`, `es`, `ja`, `fr`, `de`. Cada um é um arquivo
`src/i18n/<locale>.ts` exportando um objeto com **as mesmas chaves** de `pt-BR.ts` (`satisfies Messages`): faltar ou sobrar uma
chave em qualquer idioma é erro de `npm run typecheck`, que o CI roda. As chaves são `<tela>.camelCase`, agrupadas em seções
marcadas (`// ==== menu ====`): `menu`, `home`, `deck`, `card`, `online`, `watch`, `admin`, `reports`, `tour`, `stats`, `game`,
`board`, `dice`, `result`, `replay`, `ability`, `engine` (perguntas do motor), `log` (histórico da partida), `rules` (validação de
deck), `status` (estados das cartas), `errors` (erros do servidor), `labels`, `settings`.

- **Sintaxe das mensagens:** `{nome}` interpola um parâmetro; `{n|# carta|# cartas}` escolhe a forma pelo `Intl.PluralRules`
  do idioma (`one` | `other`; `#` vira o número formatado). Frases sempre inteiras, com parâmetros: nada de concatenar pedaços
  (a ordem das palavras muda em japonês e alemão).
- **Uso:** em componentes, `const t = useT()` (re-renderiza ao trocar o idioma); fora deles, `t()` do módulo (idioma em vigor).
  `tryT(chave)` devolve `undefined` quando a chave não existe: é como a interface trata o que vem **do motor** (`promptKey`/
  `promptParams`/`optionKeys` ao lado de `prompt`/`options` em `Pending`, `labelKey` em `Ability`) e **do servidor** (`errorCode`
  ao lado de `error` nas respostas 4xx/5xx; `api.ts` traduz `errors.<errorCode>` e cai no texto do servidor se não conhecer).
  Os textos em português do motor e do servidor continuam sendo gerados (replays, logs e clientes antigos).
- **Motor → interface:** cada texto que o motor gera em português ganha ao lado uma mensagem estruturada
  `Msg = { key, params?, parts? }` (`parts` = parâmetros que também são texto a traduzir, ex. a lista de custos, juntada por
  `log.listAnd`/`engine.cost.join`). Onde aparece:
  - `LogEntry.key/params/parts` (histórico, seção `log`; a linha secreta tem `secretKey…`, que `view.ts` só entrega ao dono);
  - `GameState.winReasonKey/winReasonParams` (motivo do fim de jogo, `log.win*`);
  - `Pending.promptKey/promptParams/promptParts` e `optionKeys/optionParts` (perguntas de efeito, seção `engine`);
  - `Ability.labelKey/labelParams` (rótulos de habilidades roteirizadas);
  - `StatusInfo.textKey/untilKey/tagKey` (marcadores de estado nas cartas, seção `status`);
  - `DeckIssue`/`FormatIssue.code/params` e `parseDeckList().errorDetails` (validação de deck e formato, seção `rules`).
  `apps/web/src/game/engineText.ts` (`msgText`, `logText`, `winReasonText`) traduz isso na interface; sem chave, mostra o texto.
  Os avisos da mesa (`NOTICE_KEYS` em `GameScreen.tsx`) são decididos pela chave do log, com um regex de reserva para estados
  antigos. Ainda só em português: as recusas `IllegalActionError` do motor (a interface só oferece ações legais, então só
  aparecem em corridas) e os rótulos de "Escolha um" que vêm da DSL do leitor.
- **Carga:** `pt-BR` vai no bundle principal; os outros são chunks separados (`import()` em `loadLocale`), baixados ao escolher.
  `main.tsx` carrega o idioma salvo antes do primeiro render. `I18nProvider` (dentro do `SettingsProvider`) troca o dicionário,
  ajusta `<html lang>` e o `locale` do botão do Google.
- **Escolha e detecção:** `Settings.locale`, salvo em `gumgum.settings`; na primeira visita, `detectLocale()` lê
  `navigator.languages` (pt→pt-BR, en, es, ja, fr, de; outro → en). Seletor `LocaleSeg` só com bandeiras (SVG em `Flags.tsx`,
  porque emoji de bandeira vira letras no Windows), com o nome do idioma em `title`/`aria-label`; está em Configurações, no menu
  da partida, na barra superior (`LocaleButton`) e na gaveta ☰.
- **Datas e números:** `format.ts` (`fmtDateTime`, `fmtTime`, `fmtNumber`, `fmtBerries`…) usa o idioma em vigor.
- **Texto das cartas:** `cardText(def, locale)` dá a tradução automática/manual só em `pt-BR`; nos demais, o original em inglês.
  A tabela `card_translations` e `data/translations/<lang>.json` já aceitam outros idiomas, mas só `pt` é montado hoje.
- **CSS:** `html[lang=ja]` usa `word-break: keep-all` + `overflow-wrap: anywhere`; textos de alemão e francês são mais longos,
  por isso botões e segmentos usam `min-width: 0` e quebra onde cabe, e algumas chaves têm a forma curta `.Short`.

### Partida contra o bot

Roda **inteira no navegador** (`useGame.ts`): `createGame`, `applyAction`, `chooseBotAction` com atrasos de 500–2000 ms
para parecer humano, undo com até 400 estados, replay `.json`. No fim, `POST /api/matches` envia `{mode, format,
seed, firstPlayer, chooseFirst, deckIds, decks, actions}`; o servidor refaz e grava (seção 9).

Com login, a opção **Transmitir esta partida** troca o navegador pelo servidor: `POST /api/online/bot {deckId,
botDeckId, format, first}` abre uma sala `bot` (seção 11) e a mesa vira a de uma partida online. Se o servidor
responde 503 (transmissão lotada), o menu começa o treino no navegador e a mesa mostra o aviso (`GameSetup.notice`).

**Assistir replay** (`ReplayLoader.tsx` + modo `replay` do `useGame`): o `.json` vira um `GameSetup` com o roteiro já
convertido; com `decks` no arquivo (online e, desde o card 73, também os baixados no navegador) os decks não precisam
existir. O `useGame` usa um `ReplayCursor`; a `ReplayBar` (abaixo da mesa) avança, volta e pula. Pulos e a velocidade 8×
mudam a mesa sem animação. Nada é gravado em `matches`.

**Clique/seleção no replay** (`game/replayCue.ts` + `ReplayCue.tsx`): antes de cada ação do roteiro ser aplicada, a mesa
mostra o que o jogador tocou, para quem assiste ou audita ver a decisão e não só o resultado. O replay não grava cliques à
parte: cada `Action` já diz o que foi selecionado (`playCard.uid`, `attack.attacker/target`, `choose.uids`, `option.index`,
`answer.yes`, `counter.uid/target`…), e `describeReplayAction(estado, ação)` traduz a ação de volta para o gesto, com as
palavras dos botões e das cartas que o jogador viu ("Atacar Zoro com Nami", "Não usar Counter", "Trocar mão"). Na mesa, as
cartas e os DON!! envolvidos ganham um contorno (numerado na ordem dos cliques: DON!! → carta, atacante → alvo), um toque
animado no instante em que a ação cai (`useGame` expõe `replay.dueAt`) e uma legenda junto do elemento (ou do lado da mão de
quem agiu, nas respostas sem carta na mesa: opções, sim/não, encerrar turno). A `ReplayBar` repete a mesma frase por
escrito. Pausado (passo a passo), contorno e legenda ficam parados em "Próxima ação"; em 8× só a barra mostra. A
configuração `replayCues` ("Cliques no replay", em `settings.tsx`; também na folha de abrir o replay e no botão 👆 da
`ReplayBar`) desliga tudo.

### Partida online e espectador

`useOnlineGame.ts` abre um `EventSource` (`/events?t=<token>` para jogador, `/watch[?hands=1]` para espectador),
acumula `defs` e `log` incrementalmente, envia ações por `POST /action` com `seq = actionCount` numa fila de um por vez,
mostra relógio local (`clock.remaining` − tempo desde o último snapshot). Reconexão: se o `EventSource` fecha e a
partida não acabou, espera 3 s, consulta `/api/online/active` (jogador) ou `/api/online/rooms/:id` (espectador) e
reabre; watchdog de 10 s reconecta se não chega nada há 50 s. Detalhes do protocolo na seção 11.

### Polling (todas as consultas periódicas)

| Tela | Rota | Intervalo | Condição |
|---|---|---|---|
| Menu | `GET /api/online/stats` | 10 s | aba visível (`usePoll` pausa em `document.hidden`) |
| Menu | `GET /api/tournaments` | 60 s | aba visível |
| Menu (bloco "ao vivo") | `GET /api/online/live` | 15 s | aba visível |
| Menu (bloco meta) | `GET /api/stats?days=7` | 5 min | aba visível |
| Assistir partidas | `GET /api/online/live` | 5 s | sempre, enquanto a lista está aberta |
| Fila casual/ranqueada | `GET /api/online/queue/:ticket` | 1,5 s | enquanto está na fila |
| Página do torneio | `GET /api/tournaments/:id` | 5 s | torneio `running` (304 sem corpo quando nada mudou) |
| Partida online | `ping` SSE (servidor → cliente) | 20 s | canal aberto |

### Imagens

`<img src={cardImage(state, uid)} loading="lazy" referrerPolicy="no-referrer">`; se falhar, a carta é desenhada em HTML/CSS.
`cardImage` (`packages/engine/src/art.ts`) usa a arte alternativa da instância (`CardInstance.art`, preenchida por
`createGame` a partir de `DeckList.arts`) ou `def.imageUrl`. `viewFor` só copia `art` das cartas visíveis.
As URLs apontam para `https://optcgapi.com/media/static/Card_Images/<ID>.jpg` (oficiais) e
`https://images.optcgleaks.com/<set>/images/<id>.webp` (spoilers). **Esse tráfego não passa pela VPS.**

### Áudio

`audio.ts` (Web Audio API) tem dois canais com volume próprio, efeitos e música, ligados às configurações
`sfxVolume` e `musicVolume`. O primeiro toque ou tecla destrava o áudio (os navegadores exigem um gesto) e
pré-carrega os efeitos; a música só é baixada quando pedida e toca num `AudioBufferSourceNode` em loop (emenda
sem corte), com crossfade na troca. `game/useMatchAudio.ts` deriva os sons da diferença entre o estado anterior e o
novo da partida (como `Motion.tsx` faz com as animações), então valem para a partida contra o bot, online,
espectador e replay (mudos nos pulos e no replay em 8×); `App.tsx` toca a música do menu fora da mesa e a mesa troca
para a da partida. Os arquivos (MP3) ficam em `assets/audio`, com a origem e a licença de cada um em
`assets/audio/CREDITS.md`: efeitos CC0 do Kenney e do OpenGameArt e duas músicas originais ("Brisa do Leste" no menu,
"Valsa do Mar" na partida) geradas em MIDI por `scripts/audio/compose.py` e renderizadas com FluidSynth;
`scripts/audio/sfx.py` refaz a conversão dos efeitos.

### PWA: instalação, tela acesa e notificações

- **Service worker** (`src/service-worker.js` → `/sw.js`, registrado em `main.tsx`). O plugin `gumgum-service-worker`
  de `vite.config.ts` gera o arquivo na compilação com a versão (hash dos nomes do bundle) e a lista do precache
  (`index.html`, JS de entrada, CSS, imagens, ícones e manifest; os dicionários dos outros idiomas entram no cache quando
  usados, os áudios ficam com o cache HTTP). Página: rede primeiro, cópia guardada sem conexão. `/assets/*` e
  `/icons/*`: cache primeiro. `/api/*` nunca passa pelo cache. Versão nova: `skipWaiting` + `clients.claim` e os caches
  `gumgum-*` antigos são apagados. Em `npm run dev` o `/sw.js` é servido sem cache nenhum (só as notificações).
- **Instalação** (`components/Install.tsx`): `beforeinstallprompt` é guardado em `pwa.ts` (sem a mini barra do
  navegador) e vira o botão **Instalar**; no iPhone/iPad, instruções com o ícone de Compartilhar. A faixa aparece no
  menu inicial só em telas de toque e fora do app instalado (`display-mode: standalone`); a opção em Configurações
  sempre existe.
- **Tela acesa** (`useWakeLock` em `App.tsx`): `navigator.wakeLock.request('screen')` nas telas `game`, `online` e
  `watch` com `keepAwake` ligado; pedida de novo no `visibilitychange` (o navegador solta a trava em segundo plano).
- **Notificações** (desligadas por padrão). Ligar em Configurações pede `Notification.requestPermission()` (num toque),
  inscreve com `pushManager.subscribe` usando a chave VAPID de `/api/config` e manda a inscrição com o idioma e os
  tipos escolhidos (`PUT /api/push/subscription`). `usePushSync` (em `App.tsx`) reenvia quando muda o idioma, a conta
  ou os tipos; desligar (ou a permissão revogada no navegador) cancela a inscrição aqui e no servidor. No `push`, o
  service worker não mostra o aviso se o app estiver visível (no Safari mostra sempre: o WebKit cancela inscrições que
  recebem push sem notificação, e o servidor já evita esses envios); no clique, foca a janela aberta e manda
  `gumgum:open` com o endereço, ou abre uma nova.

### Build

`vite build` → `apps/web/dist`: `index.html` + `assets/index-<hash>.js` (845 KB, **260 KB gzip**) +
`assets/index-<hash>.css` (127 KB, 28 KB gzip) + imagens locais (verso da carta 26 KB, DON!! 38 KB) + áudio
(46 efeitos, 340 KB ao todo, baixados no primeiro toque; músicas de 800 KB e 585 KB e três vinhetas de 33 a 46 KB,
baixadas quando tocam) + `public/`.

---

## 7. Banco de dados

### Tecnologia

- **SQLite**, arquivo único, via `node:sqlite` (`DatabaseSync`). `journal_mode = WAL` (leituras não bloqueiam escritas;
  cria `gumgum.db-wal` e `gumgum.db-shm` ao lado), `foreign_keys = ON`.
- Caminho: `DB_PATH`. Em produção `/home/gumgum/apps/gumgumfight/shared/gumgum.db`, fora da pasta do release, por
  isso sobrevive a deploys.
- **Migrações**: não há ferramenta; `db.ts` roda `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ADD COLUMN` quando a
  coluna não existe (`PRAGMA table_info`). Toda SQL fica em 4 arquivos: `db.ts`, `stats/store.ts`, `auth/store.ts`,
  `tournaments/store.ts` (o comentário do `db.ts` diz que uma migração para Postgres mexeria só neles).
- **Backup**: cron diário às 04:15 (`sqlite3 ... ".backup"`, 7 cópias rotativas em `~gumgum/backups/gumgum-<dia>.db`)
  mais o backup semanal da Hostinger. Restaurar = parar o pm2, copiar o arquivo, subir.
- **Transações**: `transaction(db, fn)` (BEGIN/COMMIT/ROLLBACK) nas gravações compostas (importar cartas, gravar
  partida, iniciar torneio, migrar dados do navegador para a conta).

### Tabelas (27)

| Tabela | Chave | Conteúdo | Quem escreve |
|---|---|---|---|
| `cards` | `id` (ex. `OP01-001`) | `set_code`, `name`, `category`, **`data` (JSON `CardData`)**, `provisional` (0/1), `source`, `raw` (JSON da API), `updated_at`. Índice `cards_set`. | importador, seed, sync de spoilers |
| `card_translations` | `(card_id, lang)` | `text`, `trigger` revisados à mão | seed (de `data/translations`) |
| `card_engine_texts` | `card_id` | Texto para o motor: `text`, `trigger`, `base_key` (hash do texto oficial quando foi escrito; diferente = não vale), `author_id`, `author_name`, `updated_at` | `PUT/DELETE /api/dev/engine-texts/:id` |
| `card_engine_text_history` | `id` | Cada gravação (`action = set`, com o texto) e remoção (`remove`) do texto para o motor, com quem e quando | idem |
| `card_gaps` | `card_id` | Cartas ⚙ (efeito parcial ou manual): `text_key` (hash do texto quando entrou), `first_seen`, `reviewed_at` (null = nova para o Dev). Na criação da tabela, as ⚙ que o banco já tinha entram como vistas | `recordCardGaps` (ao subir o servidor, na sincronização dos spoilers e no `cards:import`), `POST /api/dev/card-gaps/reviewed` |
| `decks` | `id` (`st01-luffy`, `u-xxxxxxxx`) | `name`, `leader`, **`cards` (JSON `[{id,count}]`)**, `kind` (`builtin`/`user`), `owner_hash`, `updated_at` | seed (builtin), `POST/PUT /api/decks` |
| `users` | `id` (`u-` + 12 hex) | `google_sub` (único), `email`, `name`, `picture`, `role` (`player/streamer/organizer/admin/dev`), `created_at`, `last_login_at` | login Google, admin |
| `sessions` | `token_hash` | `user_id`, `created_at`, `expires_at` (60 dias) | login/logout |
| `broadcasts` | `user_id` | `key` (único: segredo do link do OBS, guardado como está para o streamer copiar de novo), `room_id` (partida na transmissão), opções `delay_s` (0–600), `hands_players`, `hands_own`, `delay_tournaments`, `chat` (0/1), `rev` (sobe a cada troca), `updated_at` | `/api/broadcast/*` |
| `players` | `id` (`p-` + 12 hex) | `owner_hash` (único: `sha256(navegador)` ou `user:<id>`), `name` (público, "Pirata XXXX"), `bounty` (Beries), `ranked_games` | primeira partida/consulta, ranqueada, `PUT /api/players/me` |
| `deck_lists` | `hash` (16 hex) | `leader`, `cards` (JSON) — lista **exata** e imutável usada numa partida | gravação de partida |
| `matches` | `id` autoincrement | `seed`, `mode`, `deck0`, `deck1`, `winner`, `turns`, `reason`, `format`, `queue`, `first_player`, **`replay` (JSON; nas online, com os `engineTexts` do começo da partida, para refazê-la depois com as mesmas regras)**, `created_at` | gravação de partida |
| `match_seats` | `(match_id, seat)` | tabela de **fatos** das estatísticas (uma linha por lado): `controller`, `player_id`, `deck_id`, `deck_hash`, `leader`, `opp_leader`, `opp_controller`, `tier`, `bounty_before/after`, `went_first`, `won`, `mulligan`, `format`, `queue`, `played_at`, `listed` (0 = fora das estatísticas: Livre ou spoilers). Índices `seats_dims`, `seats_matchup`, `seats_player`. | gravação de partida |
| `match_cards` | `(match_id, seat, card_id)` `WITHOUT ROWID` | `copies`, `opening`, `drawn`, `played` por carta do deck. Índice `match_cards_card`. | gravação de partida |
| `live_matches` | `id` (sala) | **`data` (JSON `RoomData`)**: tudo para refazer uma sala online após reinício (inclui `engineTexts`, os textos para o motor do começo da partida, para refazer e derivar as estatísticas com as mesmas regras) | lobby (a cada ação) |
| `push_subscriptions` | `endpoint` | `p256dh`, `auth` (chaves do navegador), `owner_hash` (navegador), `user_id` (conta, se logado), `locale`, `matches`, `tournaments` (avisos escolhidos). Índices por dono e por conta. | `PUT/DELETE /api/push/subscription`; apagada quando o serviço de push responde 404/410 |
| `server_keys` | `name` | `value`: par de chaves VAPID gerado na primeira vez (`vapid`) | servidor |
| `tournaments` | `id` (`t-` + 10 hex) | configuração, `status`, `round`, `organizer_id` | organizador |
| `tournament_players` | `(tournament_id, user_id)` | `name`, `deck_id`, **`deck` (JSON `DeckList` congelado)**, `seed`, `dropped` | inscrição, início, drop |
| `supporter_payments` | `id` (`apoiase:<conta>:<mês>` ou transação do Ko-fi) | `email`, `kind`, `tier`, `amount`, `currency`, `paid_at`, `user_id` | consulta à Apoia.se, webhook do Ko-fi |
| `tournament_quota` | `tournament_id` | `organizer_id`, `created_at`: torneios criados pela cota de apoiador | criação de torneio |
| `sponsors` | `id` (`sp-` + 8 hex) | `name`, `url`, `offer`, `placements`, `starts_at`, `ends_at`, `sort`, `logo` (BLOB), `logo_type` | admin |
| `tournament_matches` | `id` autoincrement | `round`, `stage` (`swiss`/`elim`), `table_no`, `p1`, `p2` (null = bye), `best_of`, `wins1`, `wins2`, `result`, `next_first`, `room_id`, `match_id`, `reported_by` | avanço de rodada, fim de jogo online, organizador |
| `api_tokens` | `id` (`tk-` + 12 hex) | `token_hash` (sha256, único), `user_id`, `client_id` (null = pessoal), `kind` (`personal/access/refresh`), `name`, `scopes`, `parent_id` (access → refresh), `expires_at`, `last_used_at`, `revoked_at`. Índice por conta. | `/api/tokens`, `/api/oauth/token`, revogações |
| `oauth_clients` | `id` (`sweetapp`) | `name`, `secret_hash`, `redirect_uris` (JSON, igualdade exata), `scopes`, `webhook_url`, `webhook_secret` (em claro: assina os avisos) | `oauth-client-cli.ts` |
| `oauth_codes` | `code_hash` | `client_id`, `user_id`, `scopes`, `redirect_uri`, `code_challenge` (S256), `expires_at` (5 min), `used_at`, `token_id` (refresh emitido; revogado se o code for reusado) | consentimento, `/api/oauth/token` |
| `sqlite_sequence` | — | interna (autoincrement) | — |

Diagrama das relações principais:

```
users 1──n sessions            users 1──n tournaments (organizer_id)
users 1──n api_tokens ──(client_id)──> oauth_clients 1──n oauth_codes
users 1──n tournament_players n──1 tournaments 1──n tournament_matches ──(match_id)──> matches
players (owner_hash = user:<id> | sha256(navegador))
matches 1──2 match_seats ──n match_cards
match_seats ──(deck_hash)──> deck_lists
match_seats ──(player_id)──> players
decks (owner_hash → players.owner_hash, por convenção, sem FK)
cards (sem FK; decks e partidas referenciam por id textual)
```

### Tamanho em disco (medido)

| Item | Tamanho |
|---|---|
| Uma carta (`cards.data`) | ~450 B de JSON (735 cartas provisórias = 331 KB); com `raw` da API, ~2× |
| Uma partida completa (`matches.replay` + 2 `match_seats` + ~32 `match_cards`) | **~10 KB** (replay ≈ 6,7 KB médio, 9 KB máx.) |
| Uma sala online em andamento (`live_matches.data`) | 4–5,5 KB (cresce ~40 B por ação) |
| Banco de teste com 735 cartas, 36 decks e 70 partidas | 1,8 MB + WAL |

Estimativa: **100 mil partidas ≈ 1 GB**. O disco de 50 GB da VPS não é um limite realista no horizonte do produto; o
limite relevante é o tempo das consultas de estatísticas (seção 15).

---

## 8. Cartas: aquisição e armazenamento

### Onde cada informação fica

| Informação | Onde | Formato |
|---|---|---|
| Dados da carta (id, nome, categoria, cores, custo, Vida, poder, counter, atributos, tipos, texto, trigger, coleção, raridade, URL da imagem, notas, aliases, marca de spoiler) | `cards.data` | JSON `CardData` (`packages/engine/src/types.ts:14-41`) |
| Resposta original da API (para remapear sem baixar de novo) | `cards.raw` | JSON bruto da optcgapi |
| Origem e status | `cards.source` (`api:optcgapi.com`, `api:cardkaizoku.com`, `api:arquivo`, `fixture:<arquivo>.json`, `spoiler:<arquivo>.json`, `spoiler:feed:optcgleaks.com`, `spoiler:feed:cardkaizoku.com`), `cards.provisional` | texto / 0-1 |
| Tradução revisada | `card_translations` (`lang = 'pt'`) | texto |
| Tradução automática | **não é gravada**: calculada por `translateCardPt` a cada resposta, com cache em memória (até 20.000 entradas) | — |
| Efeito automatizado (DSL) | **não é gravado**: `buildCardDef` calcula a partir do texto (parser) ou de `CARD_SCRIPTS` em tempo de execução | — |
| Erratas e correções de fonte | código (`errata.ts`, `source-fixes.ts`), aplicadas ao ler e ao gravar (`fixCard`) | — |
| Imagem | **não é armazenada**: só a URL em `data.imageUrl`; o navegador baixa do site de origem | URL |
| Artes alternativas | `data.arts` (`CardArt[]`: `id` = nome do arquivo da imagem, `imageUrl`, `label`); a importação parcial junta às já gravadas (`keepArts`) | JSON |
| Arte escolhida no deck | `decks.arts` (número da carta -> `CardArt.id`), fora de `decks.cards` (não muda o `deckHash`) | JSON |
| Cartas provisórias (antes da primeira importação) | `data/cards/*.json` (750 cartas escritas de memória, `provisional: true`) | JSON `{set, title, provisional, note, cards: CardData[]}` |
| Tipos conhecidos | `data/card-types.json` (172) | JSON |

O que o navegador recebe (`ApiCard`, `present.ts`): `CardData` + `provisional` + `i18n.pt = {text, trigger, source}`;
com `CARD_IMAGES=off`, `imageUrl` e `arts` são removidos antes de sair.

### Cartas oficiais (optcgapi.com)

Fonte: `https://optcgapi.com/api` (`CARD_API_BASE`). Endpoints usados:

| Uso | URL |
|---|---|
| Starter deck | `/decks/ST-xx/` |
| Booster / extra / premium | `/sets/OP-xx/` (`EB-xx`, `PRB-xx`) |
| `--all` | `/allSetCards/`, `/allSTCards/`, `/allPromos/` |
| Sync de spoilers | `/allSets/`, `/allDecks/`, `/sets/<id>/`, `/decks/<id>/`, `/sets/card/<id>/` |

Fluxo do `npm run cards:import -- [coleções | --all | --file x.json] [--dry-run]` (`import-cards.ts`):

0. Monta a cadeia de `CARD_SOURCES` (padrão `optcgapi`; com `--file`, só a optcgapi) e busca cada fonte em sequência.
   Uma fonte que falha é pulada (com aviso); sem nenhuma, a importação aborta. Os passos 1 a 4 são os da optcgapi
   (`card-sources/optcgapi.ts` + `optcgapi.ts`); o Cardkaizoku (`card-sources/cardkaizoku.ts`) lê
   `https://cdn.cardkaizoku.com/manifest.json` → `cardData.current` (um JSON com todas as cartas).
1. Uma requisição por endpoint, **em sequência**, `fetch` nativo com `user-agent: gumgumfight-importer`. Sem retry nem
   atraso.
2. Monta o vocabulário de tipos (`data/card-types.json` + tipos citados nos textos).
3. `mapApiResponse` sobre **todas** as linhas de uma vez: agrupa por id (versões alternativas, reimpressões em starter
   deck), escolhe a linha primária (`card_image_id === id`), decide `power/cost/counter/life/colors/attributes` por
   maioria entre as linhas, escolhe o texto que o parser entende melhor, limpa nome (`(Parallel)`, `(025)`, `[Winner]`…),
   separa notas de errata (`notes`), `[Trigger]` (`trigger`), aliases ("Also treat this card's name as…"),
   divide tipos pelo maior tipo conhecido.
4. Ignora: DON!!, categorias desconhecidas, promos reimpressas de coleção (`set_name` com "promotion") e líderes só de
   evento (P-700/800/900). Sufixos `_r1`/`_p1` viram o número base.
5. `resolveChain` (`card-sources/chain.ts`) junta as fontes carta a carta: vence a primeira que tem a carta; campo vazio
   vem da seguinte; campos fracos da fonte (Cardkaizoku: custo, poder, contador, Vida, cores) vêm da seguinte quando ela
   tem a carta; o texto da vencedora só fica se `parseCard` não deixar mais habilidades sem entender que o da seguinte;
   imagem e artes da primeira fonte com imagem. Fonte que mistura spoilers (Cardkaizoku) só traz coleções confirmadas
   por outra fonte oficial ou pelo banco, e promos que outra fonte tem ou que estão à venda (`products` não vazio).
   Relatório (fonte por coleção, campos completados, divergências) no console e em `card-source-diff.json` ao lado do banco.
6. `upsertCards(provisional: false, source: 'api:<fonte vencedora>', raw)` numa transação. Cartas oficiais **substituem**
   provisórias e spoilers; o inverso nunca acontece.

Em produção a importação roda na VPS: manualmente (`node release/server/import-cards.mjs` com o `DB_PATH`
compartilhado) ou pelo input `import_sets` do workflow (`remote-deploy.sh` chama o importador depois do deploy).

### Cartas não oficiais

**Provisórias** (`data/cards`): copiadas de memória antes de a coleção ser importada; entram a cada início
(`seed`) com `provisional = 1` e são puladas quando a carta já veio da API.

**Spoilers** (coleções ainda não lançadas; hoje EB05 e OP18, `data/spoilers/<set>.json`):

- Arquivo: `{set, title, release, feed: true, source, url, cards: []}` (`feed: "optcgleaks"` dos arquivos antigos também liga). `cards` aceita cartas escritas à mão
  (mesmo `CardData`), com prioridade sobre o feed; cartas sem id válido (`/^[A-Z]+\d*-\d+$/`), nome ou categoria são
  ignoradas e logadas.
- Feed: `https://images.optcgleaks.com/<set>/<set>.json`. Só o array `cards` é usado (`sp_cards` e `unknown_id_cards`
  ficam de fora). Mapeamento em `spoiler-feed.ts`: entidades HTML, `<br>`, `NOTE:` → `notes`, `<Blocker>` → `[Blocker]`,
  imagem `https://images.optcgleaks.com/<set>/images/<image.id>.webp`, `spoiler: {source: 'optcgleaks.com', url}`.
- `refreshSpoilerFeeds`: busca a coleção em cada fonte de `SPOILER_SOURCES` (404 = a fonte não tem) e junta com
  `resolveChain`; pula a coleção se já há cartas oficiais dela (menos `P`, que sai carta a carta); resposta vazia ou
  qualquer fonte com erro não apaga nada; grava com `provisional = 1`, `source = 'spoiler:feed:<fonte vencedora>'` e
  `spoiler.source` da vencedora; `pruneSpoilers` (`spoiler:feed:%`) remove as que saíram de todas as fontes.
- `syncSpoilers`: pega as coleções com spoilers pendentes, procura em `/allSets/` e `/allDecks/`; se não listada, tenta
  `/sets/card/<primeiro id>/` e, achando, busca as demais uma a uma; promos pendentes buscam `/allPromos/`. 404 = "ainda
  não publicada". O que vier passa pela cadeia de `CARD_SOURCES` (as outras fontes só nas coleções que a API publicou)
  e é importado como oficial (`provisional = 0`); a etiqueta SPOILER some sem mexer nos decks (o número não muda).
- Agendamento: dentro do processo da API, 15 s após subir e depois a cada `SPOILER_SYNC` horas (padrão 6, `off`
  desliga). Tráfego: ~2 requisições ao optcgleaks + 2 à optcgapi por rodada (mais uma por carta pendente quando a
  coleção aparece). Também executável à mão: `npm run cards:import -- --spoilers`.

### Conferência contra a lista oficial da Bandai

`npm run cards:check-official` faz scraping de `https://en.onepiece-cardgame.com/cardlist/` (uma requisição por série)
e compara nomes e tipos com a optcgapi; imprime entradas prontas para `SOURCE_FIXES`. `npm run translations:check`
traduz a base inteira e lista traduções parciais/suspeitas. Nenhum dos dois grava no banco.

---

## 9. Partidas: o que é gravado, onde e em que formato

### Três tipos de partida

| Tipo | Motor roda em | Gravação | `matches.mode` | `queue` |
|---|---|---|---|---|
| Contra o bot (navegador) | navegador | o navegador envia o replay em `POST /api/matches`; o servidor **refaz** com o motor e só grava o que confere (422 se não confere) | `bot` (ou `demo`) | sempre `casual` |
| Treino contra o bot transmitido | servidor | o próprio servidor grava ao terminar | `bot` | `casual` |
| Online (privada, casual, ranqueada, torneio) | servidor | o próprio servidor grava ao terminar (`finishMatch`, `online/routes.ts`) — **única origem da ranqueada e do torneio** | `online` | `casual`, `ranked`, `tournament` |

Nunca se grava `timeout` vindo do navegador (400), nem partidas que não chegaram a `gameover`, nem com mais de 5.000 ações.

### `matches` — a partida e o replay

```jsonc
// matches.replay (JSON), exemplo real (partida online/treino)
{
  "seed": 0,                                   // 32 bits (partidas locais) — 0 quando há seed128
  "seed128": [-1069289030, 968621512, 122305885, -1961103912],   // partidas online (sfc32)
  "chooseFirst": true,                         // o vencedor do dado escolheu quem começa
  "firstPlayer": 0,                            // quando não houve escolha (jogo 2+ de torneio, replays antigos)
  "legacySetup": true,                         // só partidas começadas antes do REPLAY_VERSION 9
  "decks": [ { "id": "st01-luffy", "name": "...", "leader": "ST01-001", "cards": [ { "id": "ST01-002", "count": 4 }, ... ] },
             { "id": "st02-kid",  ... } ],
  "actions": [ { "type": "mulligan", "player": 0, "redraw": false }, { "type": "playCard", "player": 0, "uid": "c7" }, ... ],
  "winner": 0, "reasonKey": "log.winNoLife"   // resultado, para quem lê o arquivo sem rodar o motor (partidas novas)
}
```

Colunas: `seed`, `mode`, `deck0`/`deck1` (id do deck salvo ou, se não houver, o hash da lista), `winner` (0/1/null),
`turns`, `reason` (texto, ex. "O líder de B recebeu dano sem cartas de Vida."), `format`, `queue`, `first_player`,
`created_at`. Com `replay` + `cards` dá para **recalcular qualquer estatística** do zero.

### `match_seats` — fatos para as estatísticas (uma linha por lado)

Exemplo real: `{match_id: 1, seat: 0, controller: 'human', player_id: 'p-f13af83f10ff', deck_id: 'st01-luffy',
deck_hash: '516c98a7693dc589', leader: 'ST01-001', opp_leader: 'ST02-001', opp_controller: 'bot', tier: 'east-blue',
bounty_before: 0, bounty_after: 0, went_first: 1, won: 1, mulligan: 0, format: 'egb', queue: 'casual',
played_at: '2026-10-08 14:57:55'}`. Todos os filtros da tela de estatísticas (formato, fila, oponente, tier, Líder,
matchup, ordem do turno, período, "só minhas") resolvem só nesta tabela, sem join.

### `match_cards` — desempenho por carta

Uma linha por carta do deck (menos o Líder): `copies` (no deck), `opening` (na mão mantida após o mulligan), `drawn`
(passou pela mão depois do mulligan), `played` (jogada da mão, inclui Counter, descontando `cancel`). Tudo é derivado
pelo servidor ao refazer o replay (`stats/derive.ts`), nunca informado pelo navegador.

### `deck_lists` — a lista exata

`hash = sha256("LEADER|4xOP01-016|…")[0:16]`. Guarda a lista no momento da partida, porque o deck salvo pode mudar
depois. `GET /api/stats/cards?deck=<hash>` usa essa chave.

### `players` — perfil e recompensa

Criado na primeira partida ou consulta. `bounty` só muda na ranqueada entre duas contas distintas:
`esperado = 1 / (1 + 10^((deles − meu) / 20000))`, `delta = round(2000 × (resultado − esperado))`, nunca abaixo de 0.
Tiers (`stats/catalog.ts`): East Blue 0–5.000, Paradise até 20.000, Novo Mundo até 50.000, Supernova até 100.000,
Shichibukai até 250.000, Yonkou acima. `tier` gravado em `match_seats` é o da hora da partida.

### `live_matches` — partidas online em andamento

`data` é o `RoomData` da sala (`online/room.ts`): `id`, `code`, `queue`, `format`, `createdAt`, `seats[]` (dono,
conta, nome, bounty, tier, deck congelado, **token do assento**, `bot`), `seed128`, `chooseFirst`, `aliasSalt`,
`actions[]`, `remaining[2]` (relógios em ms), `result`, `rematch`, `tournament`, `firstPlayer`, `replayVersion`.
É regravada a cada ação (`INSERT … ON CONFLICT DO UPDATE`) e apagada quando a sala é fechada pelo varredor. Ao
reiniciar, o processo novo lê a tabela, refaz cada partida com o motor e os navegadores reconectam; o tempo fora do ar
não conta para nenhum relógio. Salas que não puderem ser refeitas (motor mudou) são descartadas com log.

---

## 10. Contas, perfis e sessões

- **Login**: só Google Identity Services. O navegador recebe um ID token (JWT RS256) e envia em
  `POST /api/auth/google {credential}`. O servidor busca as chaves públicas em
  `https://www.googleapis.com/oauth2/v3/certs` (cache em memória pelo `max-age`, refetch no máximo 1×/60 s para `kid`
  desconhecido) e confere assinatura, `iss`, `aud = GOOGLE_CLIENT_ID`, `exp`/`iat` (tolerância 60 s), `sub`.
- **Sessão**: cookie `gg_session` (`HttpOnly; SameSite=Lax; Path=/; Secure` em HTTPS), 60 dias; no banco só
  `sha256(token)`. Login apaga a sessão anterior e as expiradas.
- **Perfis** (`users.role`): `player`, `streamer` (vê mãos ao assistir, com atraso, e usa o modo transmissão), `organizer` (cria/gerencia torneios), `admin`
  (gerencia tudo, muda perfis), `dev` (admin + telas de desenvolvimento). `ADMIN_EMAILS` promove a admin no login com
  e-mail verificado. **Judge** não é perfil da conta: é um papel por torneio (`tournament_judges`, seção 12).
- **Migração do navegador para a conta** (`claimBrowserData`): no primeiro login, decks `user` do `owner_hash` do
  navegador passam para `user:<id>`; o perfil de estatísticas é fundido (partidas reapontadas, perfil do navegador
  apagado se a conta já tinha um).
- **Privacidade**: o nome da conta Google nunca aparece para outros; o nome público é o de `players.name`.
- **Plano de apoio** (`users.supporter_tier`, `supporter_until`, `supporter_source`, `supporter_public`): Grumete,
  Tripulante, Capitão ou Almirante (`apps/server/src/support/tiers.ts`). Vem da Apoia.se (`support/apoiase.ts`): o
  servidor consulta `GET https://api.apoia.se/backers/charges/<e-mail>` no login, em `POST /api/support/apoiase/sync`
  e a cada 6 h para quem tem plano de lá; o plano sai do valor pago no mês e vale até o dia 10 do mês seguinte. Também
  pode vir do webhook do Ko-fi (opcional, `POST /api/support/kofi`) ou ser dado à mão pelo admin.
  O que cada plano libera: Tripulante,
  Estatísticas Pro (`/api/stats*` restringe a `queue=casual` sem o plano, salvo `mine=1`) e homologação
  (`ACCESS=supporters`, `support/access.ts`); Capitão e Almirante, 5 torneios por mês de até 64 jogadores
  (`tournament_quota`); Almirante, inscrição antecipada de 48 h nos torneios do time (`tournaments.priority_until`).
  Admins têm todos os benefícios. Sem nenhuma variável `SUPPORT_*`, nada disso é exigido (estatísticas abertas).
- **Lojas parceiras** (`sponsors`, logo em BLOB validado pelos bytes, só PNG/JPEG/WebP): `GET /api/sponsors`,
  cadastro em `/api/admin/sponsors`. O torneio do time (`tournaments.official`, `prize`, `sponsor_id`) é marcado só
  por admin. Partidas de torneio só entram nas estatísticas de todos depois que o torneio termina.

### API para parceiros (`partners/`)

Um app parceiro age em nome do usuário com um **token de acesso** em `Authorization: Bearer` (a terceira identidade,
ao lado do cookie e do `x-deck-owner`). Visão de usuário, rotas e scopes estão no `README.md` ("API para parceiros");
aqui, o desenho:

- **Tokens** (`store.ts`): prefixo legível + 32 bytes aleatórios em base64url (`ggf_pat_` pessoal, `ggf_at_` access,
  `ggf_rt_` refresh, `ggf_cs_` client_secret, `ggf_whs_` webhook_secret); no banco só `sha256`. Pessoal: sem validade,
  até 10 ativos por conta. OAuth: access 1 h (`parent_id` = o refresh), refresh 90 dias renovado a cada uso.
- **Middleware** (`tokens.ts`, hook `onRequest` global, só em `/api/*` com esquema `Bearer`; `/api/internal/*` tem o
  próprio Bearer): acha o token pelo hash; 401 `invalid_token` se não existe, revogado, expirado, é refresh ou a conta
  sumiu; **allowlist** pelo `config.scope` da rota (sem ele, 403 `token_not_allowed`; faltando o scope, 403
  `insufficient_scope`); janela deslizante de 120 req/min por token em memória (429 + `Retry-After`); preenche
  `req.apiAuth` (`{ token, user (role forçado a player), scopes }`), que `registerAuth().viewer` consulta antes do
  cookie; `last_used_at` é gravado no máximo 1×/min por token. O logger do Fastify tem `redact` em
  `req.headers.authorization`.
- **Rotas liberadas** (`config: { scope }`): `profile` → `/api/auth/me` (resposta reduzida), `/api/players/me`;
  `decks:read` → `GET /api/decks` (`mine=1` filtra por dono), `GET /api/decks/:id` (os próprios e os prontos);
  `decks:write` → `POST/PUT/DELETE /api/decks` (o `PUT` aceita `expectedUpdatedAt`/`If-Unmodified-Since` e responde
  409 `deck_conflict` com a versão atual; o resumo dos decks ganhou `deckHash`); `matches:read` →
  `GET /api/players/me/matches` (`matches.ts`: `match_seats` por `player_id`, `since`, `cursor` = `match_id`, até 100),
  `GET /api/matches/:id` (resumo com `seats[].cards` de `match_cards`; o lado do oponente vem `null` fora de torneio
  encerrado), `GET /api/matches/:id/replay`, `POST /api/matches/:id/replay-link`; `stats:read` → `/api/stats*`.
- **Tela "Apps conectados"** (`/api/tokens`, só com cookie): lista tokens pessoais e apps autorizados (um por
  `client_id` com refresh ativo), cria (`{ name, scopes }`) e revoga (um app = todos os tokens dele para a conta).
- **OAuth** (`oauth.ts`): `GET /oauth/authorize` confere `client_id` e `redirect_uri` (igualdade exata; erro = página
  HTML sem redirecionar), `state`, `S256` e os scopes (erro = volta com `?error=`), e responde o `index.html` com
  `X-Frame-Options: DENY`; o `App.tsx` abre a tela `OAuthConsent` nesse caminho, que usa `GET/POST
  /api/oauth/consent` (cookie). `POST /api/oauth/token` (form ou JSON; cliente no corpo ou em Basic; 10/min por
  cliente): `authorization_code` confere code (hash, 5 min, uso único, mesmo cliente e `redirect_uri`,
  `sha256(code_verifier)` em base64url = `code_challenge`) e emite o par; reuso do code revoga o refresh gravado em
  `oauth_codes.token_id`; `refresh_token` revoga o antigo (e os access dele) e emite outro; refresh já revogado
  derruba toda a cadeia do cliente naquela conta. `POST /api/oauth/revoke` sempre 200.
  Cadastro de clientes: `npm run oauth:client -- add|list|secret|webhook|remove` (`oauth-client-cli.ts`, também no
  pacote de produção).
- **Webhook** (`webhook.ts`, `WebhookDispatcher`): chamado com o `matchId` depois de `recordMatch` (`finishMatch` em
  `online/routes.ts` e `POST /api/matches`). Para cada lado humano com conta, os clientes com `webhook_url` que a
  conta autorizou com `matches:read` recebem `POST` com o evento (`match.finished`, `id` `evt-…`, `userId`, `matchId`,
  `queue`, `format`, `won`), `X-GGF-Timestamp` e `X-GGF-Signature` (`sha256=` + HMAC-SHA256 do segredo sobre
  `<timestamp>.<corpo>`). Depois da resposta, timeout 5 s, `redirect: 'manual'`, só https em produção; sem 2xx, tenta
  de novo após 1 e 10 min (em memória) e desiste com log. `app.webhooks.idle()` espera as entregas (testes).
- **Replay embutido** (`replay-link.ts`): `POST /api/matches/:id/replay-link` usa a mesma regra de
  `GET /api/matches/:id/replay` (`replayDenied` em `reports/routes.ts`) e devolve `/replay/<id>?t=<token>&embed=1`
  (+ `lang`, `layout`). Token `<exp base 36>.<HMAC-SHA256 base64url de "replay:<id>:<exp>">`, 1 h, segredo em
  `REPLAY_LINK_SECRET` ou `server_keys` (`replay_link`, gerado na primeira vez); conferido com `timingSafeEqual`.
  `GET /api/replay/:id?t=` (sem `config.scope`: Bearer recebe 403; aberto no `ACCESS=supporters`) confere o token,
  fecha torneio em andamento (403 `replayTournamentRunning` mesmo com link válido) e responde
  `{ replay, cards, origins }` com só as cartas usadas. `GET /replay/:id` entrega o `index.html` com
  `frame-ancestors 'self' <REPLAY_EMBED_ORIGINS>` e `Referrer-Policy: no-referrer`; um hook `onSend` em `app.ts` põe
  `frame-ancestors 'none'` + `X-Frame-Options: DENY` em toda resposta que não definiu a própria CSP. No web,
  `embed.ts` lê o endereço e os comandos, `main.tsx` pula o service worker e aplica o `lang` do link, o `AccessGate`
  não bloqueia o caminho, `ReplayEmbed.tsx` monta a partida (`setupFromReplay` com as cartas recebidas) e a
  `GameScreen` recebe `embed` (`bare` esconde menu, sair e baixar; `layout` liga a visão do Streamer em pé ou lateral;
  `useEmbedBridge` faz o postMessage `seek/play/pause` ↔ `ready/pos/ended`, conferindo `e.source === parent` e a origem).
- **Nginx**: `PARTNER_IPS` no `deploy.env` tira os IPs dos parceiros do limite por IP (`geo`/`map` nos scripts de
  deploy); o limite real passa a ser o por token.
- Testes: `apps/server/test/partners.test.ts` (tokens, allowlist, conflito, log, rate limit, partidas, OAuth completo,
  webhook, link do replay embutido e CSP), `apps/web/test/deeplink.test.ts` (o `?deck=` do construtor,
  `apps/web/src/deeplink.ts`) e `apps/web/test/embed.test.ts` (endereço `/replay/<id>` e comandos postMessage).

---

## 11. Multiplayer online e transmissão ao vivo (espectador)

### Arquitetura

```
 navegador (jogador A)        navegador (jogador B)        navegadores (espectadores, até 100 por sala)
   │ POST /action {t,seq}       │ POST /action                 │
   │ SSE /events?t=tokenA       │ SSE /events?t=tokenB         │ SSE /watch[?hands=1]
   ▼                            ▼                              ▼
 ┌──────────────────────────── Nginx (TLS, proxy_buffering off, read_timeout 90 s) ─────────────────────────┐
 │                                                                                                          │
 │   processo Node (Fastify)                                                                                 │
 │   ┌──────────── Lobby (memória) ────────────┐    ┌────────── Room (memória, 1 por partida) ───────────┐  │
 │   │ rooms: Map<id, Room>                    │    │ data: RoomData (seats, seed128, actions, relógios) │  │
 │   │ codes: Map<código, id>  (salas privadas)│    │ state: GameState completo (autoridade)             │  │
 │   │ queue: Entry[]  (casual/ranked)         │───▶│ aliases (uid real ⇄ apelido aleatório)             │  │
 │   │ presence: Map<ownerHash, lastSeen>      │    │ conns: Set<Connection> (jogadores + espectadores)  │  │
 │   │ sweeper a cada 30 s                     │    │ timer do relógio, timer do bot                      │  │
 │   └─────────────────────────────────────────┘    └──────────────────┬─────────────────────────────────┘  │
 │                                                                     │ save() a cada ação                 │
 │                                                            SQLite `live_matches` (sobrevive a reinício)  │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Não há WebSocket: o transporte é **SSE** (`text/event-stream`) do servidor para o navegador e **POST** para as
ações. Isso atravessa Nginx e Nginx Proxy Manager sem configuração especial (`X-Accel-Buffering: no`, `ping` a cada
20 s abaixo do `proxy_read_timeout`). Cada partida é uma instância de `Room`; não há threads nem workers.

### Tipos de sala (`RoomQueue`)

| Fila | Como nasce | Observações |
|---|---|---|
| `private` | `POST /api/online/rooms` gera código de 6 letras (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) e link `/?sala=CÓDIGO`; o segundo entra com `/rooms/join` | Revanche (os dois pedem → sala nova, assentos trocados); espera no máximo 30 min |
| `casual` / `ranked` | `POST /api/online/queue` devolve um `ticket`; o navegador consulta `GET /queue/:ticket` a cada 1,5 s; quem para de consultar por 2 min sai da fila (o celular pausa a página em segundo plano; fechar a página sai na hora, pelo `pagehide`). O par formado se repete nas consultas por 2 min (resposta perdida na rede); falha de rede não interrompe a busca, e quem saiu da fila volta para ela sozinho | Pareamento por ordem de chegada, mesmo formato. Casual: quem escolhe um Líder (`leader` no POST; lista em `GET /api/online/leaders?format=`) só forma par com ele no primeiro minuto e tem prioridade sobre ele; a escolha vale para os dois lados. Ranqueada: só conta Google, deck sem ⚙, diferença de bounty ≤ 2.000 + 400/s de espera |
| `bot` | `POST /api/online/bot` (**só com login**, 401 sem conta) | Treino transmitido. O servidor joga o assento do bot a partir da **visão do bot** (sem espiar), com 700 ms de pausa e 800–2.000 ms aleatórios nas decisões escondidas. `first` (0 = jogador, 1 = bot) vira `firstPlayer`; sem ele, sorteio com escolha. `ONLINE_BOT_ROOMS=off` desliga |
| `tournament` | `POST /api/tournaments/:id/matches/:m/play` | Uma sala por jogo da série; `firstPlayer` definido (quem perdeu o anterior) |

### Ciclo de uma partida

1. **Início** (`Room.start`): `seed128` de 4 inteiros do `crypto`, `createGame`, apelidos HMAC. Grava em `live_matches`.
2. **Snapshot inicial**: ao conectar, a conexão recebe `state` com `room` (resumo), `view` (`viewFor`), `defs`
   (definições das cartas que ela ainda não recebeu), `log` (linhas novas), `lastAction`.
3. **Ação**: `POST /rooms/:id/action {t, seq, action}`. O servidor confere token → assento, `action.player === seat`,
   `seq === state.actionCount` (409 "A mesa mudou" se desatualizado; `concede` não precisa), rate limit (60/10 s),
   traduz apelidos (`actionFromView`), aplica (`applyAction`), empilha em `data.actions`, regrava `live_matches`,
   **faz broadcast** (um `state` por conexão, cada um com a própria visão).
4. **Relógio**: 17:30 por jogador, corre só para `actingPlayer`. Um `setTimeout` por sala agenda o próximo vencimento
   (tempo ou abandono: 2 min sem conexão do jogador da vez). Vencimento aplica a ação `timeout`.
5. **Fim**: `phase === 'gameover'` → `finishMatch` refaz o replay (`deriveMatch`), grava em `matches`/`match_seats`/
   `match_cards`/`deck_lists`, atualiza bounty na ranqueada, avisa o torneio (`reportFromGame`). A sala fica 15 min para
   tela de resultado, replay (`GET /replay`, só depois do fim) e revanche; depois o varredor apaga sala e linha.
6. **Reinício do servidor**: `lobby.restore` lê `live_matches`, refaz cada sala (`createGame` + replay das ações),
   relógios recomeçam do valor salvo; navegadores reconectam (o `EventSource` reconecta sozinho em 2 s, `retry: 2000`).
7. **Notificações** (`RoomDeps.onEvent` → `roomNotice` em `online/routes.ts` → `Notifier`): `start` avisa quem esperava
   na sala (nunca quem acabou de entrar: `start(by)`) e `turn` avisa quando `actingPlayer` passa para um jogador
   humano, no máximo uma vez a cada 30 s por assento (`TURN_NOTICE_MS`). Só recebe quem está longe do app: sem
   conexão com a sala ou com o app fora da tela, informado pelo navegador em `POST /rooms/:id/focus {t, visible}` a cada
   `visibilitychange` e a cada conexão do SSE (o estado fica só em memória).

### Eventos SSE (servidor → navegador)

| Evento | Payload | Quando |
|---|---|---|
| `state` | `{room, view, defs, log: {from, entries}, lastAction}` | ao conectar e a cada ação (**todas** as conexões da sala) |
| `presence` | `{connected: [bool, bool], spectators}` | alguém conecta/desconecta |
| `emote` | `{seat, emote}` | emote de um jogador (lista fixa de 8) |
| `chat` | `{seat, text}` | mensagem do chat já censurada (todas as conexões, espectadores também) |
| `dice` | `{seat, vx, vy}` | lançamento do dado do sorteio (só animação) |
| `rematch` | `{roomId, token?}` | revanche aceita (espectador recebe só o `roomId`) |
| `closed` | `{}` | sala cancelada/expirada (não reconectar) |
| `ping` | `{}` | a cada 20 s (keep-alive) |

`room` inclui: id, código, fila, formato, torneio (nome, fase, jogo, placar), `status`, `you`, jogadores (nome, bounty,
tier, Líder, conectado, bot), espectadores, `clock {remaining[2], running, total, awaySince}`, `result`, `rematch`.

### Espectador ("transmissão")

- `GET /api/online/live` lista as salas `playing` das filas casual, ranqueada, torneio e bot (privadas só pelo código,
  `GET /api/online/watch/:code`), com Líderes, Vida, cartas na mão, turno, espectadores. A tela "Assistir" consulta a
  cada 5 s.
- `GET /api/online/rooms/:id/watch` abre o SSE do espectador com `viewFor(state, null)`: campo, lixo, Vida virada para
  cima, cartas reveladas e log público. Mãos, decks e Vida virada chegam como `?`.
- `?judge=1` (**Judge do torneio**, organizador ou admin, via `actsAsJudge`): entra em qualquer sala do torneio (até em
  espera) vendo as duas mãos **ao vivo**, sem atraso (`Connection.judge`, `lateDelay` = 0), com o log inteiro desde o
  começo (toda conexão nova recebe o log do 0). Fora de sala de torneio, `judge` é ignorado. Cada entrada vai para o log do servidor.
- `?hands=1` (**Streamer**, **Admin** e **Dev**, via `seesHands`, **só onde `Room.handsAllowed`**: partida de torneio
  ou sala privada com `RoomData.showHands`, marcado por quem criou em `POST /api/online/rooms {showHands}` e mantido na
  revanche): `extra` = as duas mãos + a carta da Vida sendo olhada. Recusado (403) fora disso (`handsTournamentOnly`) e
  para quem joga a própria partida. A `Room` também garante a regra: sem `handsAllowed`, `hands` é ignorado ao
  conectar e nunca entra no `extra`. `room.handsAllowed` (e `handsAllowed` na lista) avisa jogadores e espectadores. Decks e Vida virada continuam escondidos. O atraso é o `delay_s` da conta (padrão 3 min),
  nunca abaixo de `Room.minHandsDelay` (1 min; 0 em torneio com `live_hands`, ver abaixo).
- **Mesa atrasada** (`Connection.delay`, ms; `lateDelay` aplica as regras: jogadores sempre ao vivo, quem vê as duas
  mãos nunca abaixo de `MIN_HANDS_DELAY_MS` = 1 min, teto `MAX_DELAY_MS` = 10 min): a partida pode estar numa live, e
  o oponente não pode ver a mão do outro pela transmissão. **Mãos ao vivo** (`tournaments.live_hands`, opção do
  organizador no formulário do torneio, copiada para `RoomTournament.liveHands` ao abrir cada sala; `Room.handsLive`
  e `handsLive` no `room` e na lista): nessas partidas o mínimo cai a 0 (`Room.minHandsDelay`), vale o atraso
  escolhido pelo streamer e, sem atraso, as duas mãos saem da mesa ao vivo (`snapshot`). Só em torneio: a sala
  privada liberada mantém o mínimo. `RoomData.timeline` guarda, para cada ação, o instante e o
  tempo dos dois jogadores logo depois dela (e `startedAt`, o começo). A sala mantém **uma mesa por atraso em uso**
  (`lates`: estado + quantas ações aplicadas + fila de eventos + timer), criada quando chega o primeiro espectador com
  aquele atraso (`createGame` + as ações com instante ≤ agora − atraso) e descartada quando sai o último. Um
  `setTimeout` aplica cada ação quando ela completa o atraso, e cada uma vira um `state` (as animações acompanham).
  Emotes, chat, dados do sorteio e o aviso de revanche ficam em `recentEvents` (últimos 10 min, só em memória) e na
  fila de cada mesa, e saem com o mesmo atraso, depois das ações que vieram antes deles. No `room` dessa conexão,
  `status`, `result`, `rematch` e o relógio (`lateClock`, refeito da `timeline`) são os daquele momento, e `delay` é
  o atraso (0 ao vivo). As mãos dos dois só saem da mesa atrasada. Sala gravada sem `timeline` (de antes do campo, ou
  com as ações refeitas por uma versão nova do motor): as ações contam como feitas na hora em que a sala foi refeita,
  então a mesa atrasada nunca mostra o presente antes da hora.
- **Visão do streamer que joga** (`Connection.as`): a conexão de espectador recebe `viewFor` do assento dele (a mão
  dele, nunca a do oponente) e `room.pov` = esse assento, para a mesa pôr a mão dele embaixo.
- **Modo transmissão** (`online/broadcast.ts`, tabela `broadcasts`): `POST /api/broadcast/key` gera a chave
  (24 bytes, base64url); `PUT /api/broadcast/room` escolhe a partida (a lista "Assistir" e o menu da partida);
  `PUT /api/broadcast/settings` grava as opções. A tela `/?transmissao=<chave>` (componente `Broadcast`) consulta
  `GET /api/broadcast/:key` a cada 3 s e abre o canal com `k=<chave>`; o servidor decide o que a conexão vê
  (`broadcastView`): partida de outros com `handsAllowed` → as duas mãos (`handsPlayers`, atraso ≥ 1 min, ou o
  escolhido, até 0, em torneio com `handsLive`) ou a pública; outras partidas de outros → sempre a pública; partida dele →
  `as` (`handsOwn`, o atraso escolhido, até 0) ou a pública; sem mãos, ao vivo, exceto torneio com
  `delayTournaments`. A tela só reconecta quando `rev` muda (outra partida ou outra opção), então segue a revanche no
  ritmo da mesa atrasada sem voltar para a sala velha. O perfil do dono é conferido a cada pedido. A mesa em modo
  transmissão (`Table` com `broadcast`) esconde menus, botões e avisos de erro, esconde o chat se `chat` estiver
  desligado e mostra `PlayHighlight`: a carta de `playCard`, `counter` ou `activate`, grande, por 2,8 s.
- **Espectador no app**: amplia cartas à vista, abre o descarte e o histórico; o botão **Chat** da faixa do espectador
  silencia o chat dos jogadores só para ele (`localStorage.gumgum.watchChatOff`).
- Limite **100 espectadores por sala** (429 acima). Espectadores não se identificam: entram só como número.
- Na revanche de sala privada, os espectadores seguem para a sala nova automaticamente.
- Cada espectador recebe o **mesmo volume** de dados que um jogador (um `state` completo por ação, ~9,5 KB). Não há
  fan-out compartilhado: `viewFor` e `JSON.stringify` rodam uma vez por conexão por ação (o resultado é o mesmo para
  todos os espectadores sem mãos, mas hoje não é reaproveitado — ver seção 15).

### Segurança da partida

- Token do assento: 24 bytes aleatórios (base64url), só no navegador do jogador; vai na query do SSE e no corpo das ações.
- O navegador nunca recebe seed, RNG, mão do oponente ou ordem do deck. Ids das cartas são apelidos por sala.
- Decisões que dependem de informação escondida sempre abrem para o dono, mesmo com uma só resposta, para o tempo
  de resposta não vazar informação; o bot responde com atraso aleatório.
- Ações `manual`/`timeout`/`judge` vindas do cliente são recusadas (a `judge` só sai da rota do Judge, seção 12);
  `MAX_ACTIONS = 5000` por partida.

---

## 12. Torneios

### Modelo

- **`tournaments`**: `format` (`standard`/`egb`/`free`), `spoilers` (aceita cartas de spoiler; sempre 1 no `free`), `structure` (`swiss` | `single`), `rounds` (1–15 ou null =
  ⌈log₂ n⌉ no início), `swiss_best_of` (1 | 3), `top_cut` (2…64 | null), `bo3_from`/`bo5_from` (tamanho da fase a
  partir da qual a série é melhor de 3/5: 8 = quartas, 2 = final), `max_players` (2–256), `starts_at` (com
  `check_in`, hora do início automático), `check_in` (check-in, início automático e W.O. por ausência), `tolerance_min` (minutos para entrar na sala, 1–60), `status`
  (`registration → running → finished`), `round`, `round_at` (quando a rodada atual foi gerada), `round_wo` (a
  varredura de ausentes da rodada já foi feita), `round_started_at` (quando o organizador **iniciou** a rodada atual:
  as salas abrem e a tolerância conta daqui; null = pareamentos gerados, à espera do início), `auto_start` (com
  `check_in`: começa sozinho na hora marcada; opção para quando o organizador não está), `max_warnings` (warnings por
  jogador até o organizador ter de decidir a eliminação; null = sem regra), `checkin_notice` (`starts_at` cujo aviso de check-in já saiu por
  notificação), `late_entry` (inscrição atrasada liberada: `*` = qualquer um, ou o id da conta; null = fechada),
  `organizer_id`.
- **`tournament_players`**: `deck` é o `DeckList` **congelado** na inscrição (validado com `playableDeck` no formato),
  `seed` = ordem sorteada no início, `dropped`, `checked_in_at`, `warnings_reviewed_at` (o organizador decidiu manter o
  jogador depois do limite de warnings).
- **`tournament_judges`** (`tournament_id`, `user_id`, `added_by`, `added_at`): os Judges do torneio. **`tournament_calls`**:
  chamados de Judge (`match_id`, `room_id`, `game`, `opened_by`, `opened_at`, `resolved_by`/`resolved_at`, `note` = o
  relato do Judge ao organizador). **`tournament_warnings`**: `user_id`, `given_by`, `given_at`, `round`, `match_id`,
  `call_id` (o chamado de origem, se houver), `reason`, `revoked_at`/`revoked_by` (anulado pelo organizador).
  **`tournament_interventions`**: a auditoria do modo manual (`match_id`, `room_id`, `game`, `user_id`, `role` =
  `admin | dev | organizer | judge` no momento, `kind` = `manual_on | manual_off | undo | judge_action`, `payload` JSON
  (a ação `judge`/a resposta no lugar do jogador, ou `{ to }` no desfazer), `removed` JSON (as ações desfeitas), `note`, `at`).
- **`tournament_matches`**: uma linha por série (`best_of`, `wins1`, `wins2`, `result` ∈ `p1 | p2 | bye | none | loss`
  (`none` = derrota dupla: W.O. duplo ou lançada pelo organizador, os dois perdem; `loss` = derrota sem oponente da
  inscrição atrasada, o espelho do bye), nunca empate), `next_first` (quem perdeu começa o próximo jogo), `room_id`
  (sala do jogo atual), `match_id` (última partida em `matches`), `reported_by` (`game`, `bye`, `drop`, `noshow`,
  `late` ou id do organizador), `p1_in`/`p2_in` (quando cada jogador entrou na sala da série), `p1_ready`/`p2_ready`
  ("Estou pronto" de cada um, sinal para o organizador iniciar a rodada).

### Judge, chamados e warnings

- **Judge** (`PUT /api/tournaments/:id/judges {player}` pelo apelido, `DELETE …/judges/:userId`; só quem gerencia): papel
  **só daquele torneio**. Um inscrito não vira Judge (`judgeIsPlayer`) e um Judge não se inscreve (`judgeCannotRegister`).
  `actsAsJudge` (`tournaments/store.ts`) = Judges da lista, o organizador (sem Judge escolhido, ele é o Judge) e admin/dev;
  nas rotas, `judged()` faz as vezes de `managed()` para o que o Judge pode fazer. O detalhe traz `isJudge` e `judges`.
- **Chamar o Judge** (`POST …/matches/:m/call {reason?, details?, logIndex?}`, por um dos jogadores, pelo Judge ou pelo
  organizador, com a sala em jogo). O jogador conta o que aconteceu com um toque (`reason` ∈ `CALL_REASONS`: `effect`,
  `choice`, `misclick`, `stuck`, `rules`, `conduct`, `other`), um texto opcional e a jogada do problema, tocando numa
  linha do próprio histórico (`logIndex`: o log da visão tem as mesmas linhas, na mesma ordem); `Room.playAtLine` acha a
  jogada que gerou a linha e o chamado guarda `play`/`play_turn` e `play_text` (a jogada e as 3 seguintes em texto,
  porque o Judge pode desfazê-las). Tudo opcional (cliente antigo chama sem nada).
  `Room.pause(by)` congela a sala (`RoomData.pause`, gravado em `live_matches`: sobrevive a reinício): o relógio de quem
  jogava para (`settle` não desconta, `schedule` não agenda), o abandono não conta, toda jogada é recusada (409
  `roomPaused`); **chat e emotes continuam**. `tournament_calls` ganha o chamado e os Judges + o organizador recebem a
  notificação (`judgeCallBody`, abre `?torneio=…&lobby=1`). `GET …/matches/:m/call` (Judge/organizador): o chamado
  aberto (`byName`, `byPlayer`, `reason`, `details`, `play`, `playTurn`) e o que o Judge já fez desde então (`undone`,
  `fixes`, das intervenções). `POST …/matches/:m/resume {outcome?, note?}` (só Judge/organizador): `Room.resume()` volta
  o relógio de onde parou, dá 2 min novos de abandono e fecha o chamado com o desfecho (`outcome` ∈ `CALL_OUTCOMES`:
  `no_issue`, `misclick`, `app_fixed`, `app_unfixed`, `rules`, `conduct`, `other`; `other` pede a `note`) e a nota.
  **Chamado de ajuste da plataforma**: com erro do app (`APP_OUTCOMES`; também quando a correção do Judge termina a
  partida, como `app_fixed`), `fixTicket` (`tournaments/calls.ts`) monta o texto (desfecho, relato do jogador, a jogada
  apontada com a pergunta, as opções e o histórico, as seguintes, o que o Judge voltou e corrigiu, a nota) e a carta
  suspeita, guardados em `tournament_calls.fix`. Como `match_reports` precisa da partida gravada (o replay),
  `fileFixReports` cria o relato (`source = 'judge'`, `play`, `reporter_id` = o Judge; um por Judge e partida, um segundo
  chamado soma o texto) assim que o jogo da sala do chamado está em `tournament_games` (ao fechar o chamado e em
  `reportFromGame`) e grava `report_id`. O relato aparece em Administração → Relatos de partidas e na aba Relatos do
  torneio, com "⚖ Chamado de ajuste (Judge)", "Jogada #N" e "📜 Jogadas" (aberta na jogada).
  Web: "Chamar o Judge" abre `CallJudgeSheet` (`Judge.tsx`); o painel do Judge mostra o chamado (`CallBox`, com
  "📜 Ver a jogada", que abre a lista de jogadas destacando a apontada) e o desfecho em botões, com o sugerido marcado
  (`suggestedOutcome`: depois de voltar jogadas ou corrigir, `app_fixed`, ou `misclick` se o jogador disse que clicou
  errado e só houve desfazer). O lobby mostra o motivo; as Ocorrências, o motivo, a jogada, o desfecho e o relato aberto. Resultado
  lançado, derrota dupla ou desistência numa partida com sala pausada (`releaseRoom`) retoma a sala e fecha o chamado.
  A mesa atrasada desconta as pausas no relógio (`RoomData.pauses`, `lateClock`).
- **Warnings** (`POST …/players/:userId/warnings {reason, matchId?}`, Judge ou organizador; motivo obrigatório; nunca a
  si mesmo): valem o torneio inteiro; o jogador é avisado (`warningBody`). A contagem é pública; os motivos, só para
  Judge, organizador e o próprio jogador. `warningStatus`: com `max_warnings`, ao atingir o limite o jogador fica com
  decisão **pendente** (`warningsPending` no detalhe) e **`next` recusa (409 `warningsPending`)** até o organizador
  **manter** (`POST …/players/:userId/warnings/keep` → `warnings_reviewed_at`; um warning novo pede decisão de novo),
  **anular** um warning (`DELETE …/warnings/:id`) ou **eliminar** (`drop`). Só o organizador elimina; o Judge relata.
- **Modo manual** (enquanto nem toda carta faz exatamente o que deveria): quem responde pela partida desfaz jogadas e
  corrige a mesa, para o jogador não perder por falta de automação. **Quem**: Admin e Dev em qualquer torneio, o
  organizador no dele e os Judges da lista só no torneio deles (`judged()`), sempre com o torneio em `running` e a
  partida da rodada atual em jogo (`liveMatch`): a permissão do Judge acaba sozinha quando o torneio termina ou quando ele
  sai da lista. Só em partidas de torneio (`Room.enterManual` recusa as outras filas, `manualTournamentOnly`), e **os
  jogadores não confirmam nada**: a decisão é de quem está no modo manual.
  - `POST …/matches/:m/manual {on, note?}`: `Room.enterManual` pausa a sala se ainda não estava (com um chamado aberto
    pelo Judge) e grava `RoomData.manual = {by, name, at}` (sobrevive a reinício; `room.manual` vai para todos, a faixa
    "X está corrigindo a mesa"). `on: false` (`leaveManual`) sai, e a partida continua pausada; `resume` também sai.
  - `GET …/matches/:m/plays` (**não** precisa do modo manual nem pausa a mesa; os jogadores recebem 403): `Room.plays()`
    devolve **todas** as jogadas, para conferir o que cada jogador fez e escolheu e, no modo manual, até onde voltar:
    `plays[]` = `{count, turn, player, action, pending, lines, by?}` (`action` com os uids reais; `pending` = a pergunta
    aberta antes dela, completa: as opções que havia, as cartas vistas, a carta da Vida; `lines` = as linhas do log que
    ela gerou, com as secretas; `by` = o Judge que respondeu no lugar do jogador, de `RoomData.answeredBy`), o `pending`
    de agora, `names` e `cards`/`defs` (uid → número e o texto só das cartas citadas). **Nunca vai a seed** (com ela daria
    para prever o deck). As jogadas são registradas pela própria mesa, enquanto ela anda (`rebuild` e `commit`), e não
    refeitas depois: refazer a partida com as cartas como estão no banco naquele momento podia dar outra mesa (uma carta
    corrigida no meio do jogo) e o motor recusava uma jogada gravada ("Aguardando o outro jogador.").
  - `POST …/matches/:m/undo {seq, to, note}`: `Room.judgeUndo` corta `actions`/`timeline` nas primeiras `to` e chama
    `rebuild()` (mesmos apelidos, mesma seed: refazer a jogada dá o mesmo resultado, inclusive compras e embaralhamentos).
    O relógio fica como está. Os clientes recebem o estado com `actionCount` menor e o log encolhe sozinho
    (`log.from` = o tamanho novo); as mesas atrasadas que passaram do novo fim são refeitas.
  - `POST …/matches/:m/judge-action {seq, player, op | action, note}`: `Room.judgeAct` aplica `{type:'judge', player, op, by}`
    ou, no lugar do jogador, a resposta à pergunta aberta (`JUDGE_ANSWERS`): `choose {uids}` (alvos, bloqueador),
    `answer {yes}` (sim/não, carta da Vida), `option {index}`, `pass` (Counter), `manualDone` ou `endTurn`. As cartas vêm
    pelo apelido da visão do Judge, pela posição de uma carta virada (`~0:life:2`) ou pelo uid de `plays` (as opções de
    uma escolha podem estar no deck). A resposta fica marcada em `RoomData.answeredBy` (posição → nome; o desfazer tira
    as marcas que passaram do novo fim). Se a correção terminar a partida, a sala sai da pausa e o chamado fecha.
  - `seq` é a versão da mesa que o Judge viu (409 `boardChanged` se mudou); `note` é obrigatória (≥ 3 caracteres,
    `manualNoteRequired`) no desfazer e nas correções. Tudo vai para `tournament_interventions`.
  - Web: painel do Judge (`Judge.tsx`) com "📜 Jogadas e escolhas" sempre à mão (`JudgePlays.tsx`, `PlaysSheet`: da mais
    recente para a mais antiga, por turno, com a pergunta, as opções com ✔ no que foi escolhido, as cartas vistas, as
    linhas do log e o aviso quando uma escolha não gerou linha nenhuma; filtro por carta/jogador e "só escolhas"; o texto
    de cada jogada é o `describeReplayAction` dos replays, sobre o pedaço do estado que veio em `plays`), o guia
    "O que posso fazer como Judge?" e o "🛠 Modo manual" (`ManualTools`): um motivo só para tudo, "Escolher a jogada
    para voltar" (a mesma lista, com "Voltar para antes desta" em cada jogada), "No lugar de" (`OnBehalf`, conforme o
    `pending` de `plays`) e as ferramentas por lado (comprar, embaralhar, DON!!) e por carta (mover, K.O., virar,
    ±1000, dar DON!!). Quem é Judge/organizador e abriu a mesa como espectador comum (lista "Ao vivo") vê
    "⚖ Entrar como Judge" na faixa do espectador. Na página do torneio, cada jogo gravado tem "📜 Jogadas" para o Judge
    e o organizador (o replay gravado refeito no navegador, `playsFromSetup`).
- **Ocorrências** (`GET …/incidents`, Judge/organizador): chamados (com nota), warnings e intervenções do modo manual
  (`interventions`: quem, com que papel, o quê, `removedCount`, nota), com nomes.

### Início das rodadas e lobby

- **Duas etapas**: `start`/`next` **geram** a rodada (pareamentos à vista, `round_started_at = null`; jogadores marcam
  "Estou pronto" em `PUT …/matches/:m/ready {ready}`); `POST …/rounds/begin` **inicia** (todas as salas abrem ao mesmo
  tempo: `play` recusa antes, 409 `roundNotStarted`; a tolerância do W.O. conta daqui). `{begin: true}` em `start`/`next`
  faz as duas de uma vez. Notificações: na geração, oponente da rodada (`roundBody`); no início, "a rodada começou"
  (`roundStartBody`/`roundStartDeadlineBody`). O detalhe traz `roundStartedAt`, `tables` e `readyTables`.
- **Lobby** (`GET /api/tournaments/:id/lobby`, sem cache, leve): as mesas da rodada em cartões (jogadores, placar,
  `result`/`winner`, `room`, `paused`, `ready`, `present`) e, antes do início, os inscritos com `checkedIn`. **Só para
  Judge/organizador** (`viewer.judge`): `remaining`/`running` (relógio de cada jogador, de `Room.clock()`), `connected`,
  quem abriu o chamado (`call.byName`), `calls` (salas pedindo presença) e `warningsPending`. Jogadores recebem `null`
  nesses campos: nunca veem o relógio dos outros.

### Check-in e relógio (`tournaments/clock.ts`)

Torneio com `check_in = 1` (exige `starts_at`): `tournamentTick` roda a cada 5 s no servidor (`registerTournamentRoutes`;
com relógio injetado nos testes não roda sozinho e é chamado por `app.tournamentTick()`).

- **Check-in** (`POST /api/tournaments/:id/checkin`): aberto de `starts_at − 30 min` até o início, só para inscritos.
- **Início automático** (só com `auto_start`; sem ele, **o organizador dá o start mesmo com a hora atingida**): em
  `starts_at` (até 1 h depois, se o servidor estava fora do ar; passado isso, o organizador começa à mão), com ≥ 2
  inscritos, `beginTournament` sorteia e grava a rodada 1 entre **todos** os inscritos e `startRound` já a inicia.
- **W.O. por ausência**: `round_started_at + tolerance_min` depois de cada rodada **iniciada**, cada partida pendente com placar 0 x 0 é
  conferida: presença = entrou na sala (`p1_in`/`p2_in`, gravado em `play`) ou, na rodada 1, fez check-in. O ausente
  perde (`reported_by = noshow`) e sai (`dropped`); os dois ausentes = `result = none` e os dois saem. A sala em espera
  é fechada (`lobby.closeIfWaiting`). A varredura roda uma vez por rodada (`round_wo`), então o organizador pode
  zerar/corrigir depois sem que o W.O. volte. Na chave, `singleNextRound` dá bye a quem avançaria contra uma mesa sem
  vencedor; sem ninguém para avançar, `next` encerra.
- **Notificações** (para quem ligou os avisos de torneios): check-in aberto (uma vez por `starts_at`, só para quem não
  confirmou), rodada nova em `start`, `next` e no início automático (oponente e prazo de tolerância, ou bye) e, em
  `play`, "oponente esperando na sala" para o outro jogador quando a sala do jogo é criada.
- **Atalho da tela inicial**: `GET /api/tournaments/me` (a cada 10 s, só logado) devolve os torneios em que a conta está
  em jogo agora (check-in aberto ou `running`), com a partida da rodada, o oponente, a situação da sala e o prazo.

### Auditoria: jogos gravados e relatos (`reports/`)

- **`tournament_games`**: uma linha por jogo disputado numa sala de torneio (`match_id` = série, `game`,
  `stats_match_id` = partida em `matches` com o replay, `winner`, `counted` = entrou no placar; um jogo de uma sala
  que já não era a atual fica gravado com `counted = 0`). Gravada em `reportFromGame`. O replay em `matches.replay`
  passou a guardar `version`, `names` e `deckIds` (os antigos usam a versão 8 se `legacySetup`, senão a atual).
- **`match_reports`**: relato de bug de um jogador sobre uma partida (`match_id`, `tournament_id` quando é de torneio,
  `reporter_id`, o formulário — `card` (a carta), `text` (a interação que deu problema), `expected` (o que deveria ter
  acontecido), `notify` (quer ser avisado da correção) —, `resolved_at`/`resolved_by`/`note` e `notified_at`; um por
  jogador e partida — relatar de novo troca o formulário e reabre).
- **Rotas**: `GET /api/matches/:id/replay` (arquivo de replay para a mesa: quem jogou, o organizador do torneio ou
  admin/dev), `GET /api/matches/:id` (resumo), `POST /api/matches/:id/report` (um dos jogadores, logado, em qualquer partida
  gravada: `{text, card?, expected?, notify?}`), `GET /api/reports?tournament=&status=open|resolved|all` (admin/dev: todos; organizador: dos torneios
  dele), `PUT /api/reports/:id` (`{resolved, note}`; admin/dev ou o organizador do torneio). Resolver um relato com
  `notify` manda uma notificação (Web Push, `reportFixed*` em `push/messages.ts`) para os aparelhos da conta de quem
  relatou, uma vez só (`notified_at`), mesmo com os avisos de partidas e torneios desligados (categoria `null`).
- **Interface**: a tela de resultado de toda partida gravada (contra o bot, online, ranqueada, de torneio) tem
  **Relatar um bug** abaixo de "Baixar replay" (`ReportModal`: carta — com as cartas da partida como sugestão —,
  interação, o que deveria ter acontecido e o aviso da correção, que liga as notificações do aparelho se preciso); cada partida do torneio lista os **Jogos gravados** com "Assistir replay"
  (`setupFromReplay`, em `game/setup.ts`, monta a mesa em modo replay a partir do JSON); o organizador tem a aba
  **Relatos** no torneio e Admin/Dev a aba **Relatos de partidas** em Administração (`ReportsPanel`, em
  `components/Reports.tsx`).

### Algoritmos (`tournaments/pairing.ts`)

- **Suíço**: vitória = 3 pontos; bye conta como vitória e vai para o último colocado que ainda não teve (só
  `result = bye` conta como bye: a derrota `loss` da inscrição atrasada também não tem oponente, mas não é bye; ela
  conta como jogada e perdida, sem entrar no OMW de ninguém). Classificação:
  pontos → OMW (média da taxa de vitória dos oponentes, mínimo 1/3 cada) → OOMW → seed sorteado. Pareamento pela
  classificação com backtracking (orçamento 50.000) para não repetir confrontos; se impossível, aceita repetição.
- **Eliminação simples / top cut**: chave de tamanho 2^⌈log₂ n⌉, ordem `1, n, n/2+1, n/2, …` (1º e 2º só na final);
  vagas vazias = bye para os cabeças. Top cut re-semeia pela classificação do suíço (desistentes fora).
- **Série**: `winsNeeded = ⌊bestOf/2⌋ + 1`. `elimBestOf(tamanhoDaFase)` escolhe 5, 3 ou 1.

### Integração com as salas online

`POST /api/tournaments/:id/matches/:matchId/play` confere que quem pede é p1/p2, torneio `running`, rodada atual, série
sem resultado, jogador não desistiu; chama `lobby.tournamentRoom(seat, format, {id, name, round, label, matchId,
game, bestOf, wins, firstUserId})`. O primeiro a entrar abre a sala (`waiting`), o segundo a inicia. No fim do jogo,
`reportFromGame` (ligado em `app.ts` como `onTournamentGame`) soma a vitória se a sala for a atual da série, define
`next_first`, zera `room_id`, grava `match_id`, e fecha a série quando alguém atinge `winsNeeded`. Cada jogo entra nas
estatísticas com `queue = 'tournament'`.

### Organização

Criar: `organizer`, `admin`, `dev`. Gerenciar: o organizador que criou, ou admin/dev. O organizador lança/corrige
placares (`{wins: [a, b]}` ou `{result}`; rodadas passadas exigem vencedor; corrigir vencedor na chave troca o jogador
da partida seguinte se ela ainda não começou; resultados do suíço travam depois do top cut), tira jogadores
(`drop`: partida pendente vai para o oponente), avança (`next`: próxima rodada do suíço, top cut, próxima fase, ou
encerramento) e encerra antes (`finish`). A página do torneio consulta `GET /api/tournaments/:id` a cada 5 s enquanto
`running`; listas completas só para organizador/próprio jogador até o fim.

Ferramentas de mesa (só quem gerencia; cada ação vai para o log do servidor):

- **Derrota dupla** (`PUT …/matches/:m/result` com `{result: 'double', dropBoth?}`): `result = none`, 0 x 0,
  `reported_by` = quem lançou; os dois seguem no torneio (`dropBoth`: saem, como no `drop`). Suíço: qualquer rodada,
  até o top cut começar. Chave: na rodada atual os dois saem da chave (a mesa seguinte fica com bye); em rodada
  passada, só se a partida seguinte ainda não começou: o vencedor antigo sai dela e o oponente fica de bye
  (`vacateInMatch`).
- **Desfazer desistência** (`POST …/players/:userId/reinstate` com `{restoreMatch?}`): `dropped = 0`, pareado a partir
  da próxima rodada. Se a saída decidiu a partida da rodada atual (`drop`/`noshow`, com ele perdendo), ela pode voltar
  a ficar pendente (`restoreMatch`). Suíço: enquanto o suíço não acabou. Chave: só quem ainda está na fase atual e não
  perdeu nela jogando (se perdeu pela saída, volta obrigatoriamente devolvendo a partida). O detalhe do torneio diz
  para quem gerencia, em cada inscrito que saiu, `reinstate` = `no | optional | required` (null = não pode voltar).
  Notificação "Você voltou ao torneio".
- **Inscrição atrasada** (`PUT …/late` com `{open, player?}` = apelido): só no suíço com ≥ 2 rodadas, enquanto a
  rodada 1 está em andamento (gerar a rodada 2 fecha a janela). Liberada, a conta se inscreve pelo `POST …/register`
  normal (deck validado e congelado, `max_players` vale): `lateRegister` grava o inscrito com `seed` = último + 1 e uma
  partida da rodada 1 sem oponente com `result = loss`, `reported_by = late`. A liberação para um jogador específico é
  usada uma vez.

### Kit de divulgação

Com o torneio `finished`, quem gerencia abre "Kit de divulgação" e baixa as peças para redes sociais, em
1080×1350 (feed/carrossel) ou 1080×1920 (stories): campeão, campanha do campeão (uma linha por rodada, com play/draw
por jogo), decklists do top 4 (arte das cartas, líder primeiro, depois por custo, quantidade em selo e código), pizza
dos líderes do top 8 (só com mais de 8 inscritos) e de todos os inscritos (fatias com a arte do líder). Cada peça sai
em PNG; "Baixar tudo" gera um ZIP numerado na ordem do carrossel e "Baixar PDF", um A4 com uma peça por página.

- **Dados:** `GET /api/tournaments/:id/recap` (`tournaments/recap.ts`; só quem gerencia, 409 antes do fim). Play/draw
  vem de `tournament_games.stats_match_id` → `match_seats.went_first` da conta; jogos lançados pelo organizador ou por
  W.O. não têm o dado e aparecem como "Resultado lançado"/"W.O.". Encerrado por `finish` → `earlyFinish` (aviso na peça).
- **Desenho:** no navegador de quem organiza, em canvas (`apps/web/src/recap/draw.ts`), sem custo na VPS. O
  componente (`TournamentRecap.tsx`), o desenho e os geradores de ZIP e PDF (`recap/export.ts`, sem dependências:
  ZIP sem compressão e PDF com JPEG embutido) ficam num chunk carregado só quando o kit é aberto.
- **Imagens das cartas:** o canvas só exporta com imagens da mesma origem, então o recap devolve as URLs reescritas
  para `/card-img/<origem>/<caminho>` (`card-images.ts`; origens aceitas: optcgapi e optcgleaks). Em produção o Nginx
  atende esse caminho com `proxy_pass` + `proxy_cache` em disco (`deploy/bootstrap-hostinger.sh`); sem o Nginx (ou
  antes de rodar o bootstrap de novo), o próprio app busca na origem. Com `CARD_IMAGES=off`, o kit sai sem arte
  (nome e código). A reescrita (`proxiedImageUrl`) e a tabela de origens ficam no motor (`art.ts`), porque o
  navegador também reescreve (decklist do oponente, abaixo); `card-images.ts` só registra a rota.

### Decklist do oponente no fim da partida

No resumo do fim de qualquer partida (`GameResult.tsx`), o botão "Decklist do oponente" (quem assiste vê um botão
por jogador) abre `MatchDeck.tsx`: a lista completa do deck como imagem, a mesma peça das decklists do kit (grade com o
Líder primeiro, quantidade em selo e código; `drawMatchDeck` em `recap/draw.ts`, 1080×1350, com o nome do jogador,
"vs. oponente" e a data), para baixar em PNG, e em texto no formato do construtor (`1xST01-001`, `4x…`) para copiar
(`navigator.clipboard`; sem ele, a lista fica num `<textarea>` para selecionar).

- **Dados:** nada vem do servidor. `deckOfPlayer` (motor, `deck.ts`) refaz a lista a partir de `state.cards` (as cartas
  do jogador, menos o Líder); `viewFor` só entrega todas as cartas do oponente com `phase = 'gameover'` (antes, alguma
  está escondida e a função devolve null, e o botão nem aparece). `recap/matchDeck.ts` ordena por custo e número, usa a
  arte alternativa da instância (`cardImage`) reescrita por `proxiedImageUrl` e monta o texto com `formatDeckList`.
- **Partidas de torneio (listas fechadas até o fim):** as listas de um torneio só se abrem quando ele termina, então
  o fim de um jogo de torneio não pode entregá-las. `viewFor`/`visibleCards`/`aliasRefs` aceitam `{ revealEnd: false }`
  (`ViewOptions`): o fim não revela nada a mais, cada um segue vendo o que via em jogo (a própria mão; a mão e o deck do
  oponente continuam `?`). A sala passa isso quando é de torneio (`Room.sealed`, `queue = 'tournament'`), e aí
  `deckOfPlayer` devolve null e o botão não aparece. Pelo mesmo motivo, `Room.replay()` devolve null nessas salas e
  `GET /api/online/rooms/:id/replay` responde 403 (`replayTournament`); o resumo não mostra "Baixar replay" e avisa
  (`online.decksSealed`). Os replays gravados (`GET /api/matches/:id/replay` e `statsMatchId` na página do torneio)
  saem para o organizador, os Judges e admins sempre, e para os dois jogadores só com `status = 'finished'`
  (`replayTournamentRunning` até lá).
- **Imagens desligadas** (servidor ou preferência do jogador): a peça sai com nome e código, como no kit.
- O componente, o desenho e os carregadores de imagens, fontes e logo (`recap/assets.ts`, compartilhados com o kit)
  ficam no chunk do kit, carregado só ao abrir.

---

## 13. Infraestrutura: build, CI/CD, VPS

### Pacote de produção (`scripts/build-release.sh`)

```
release/
├── server/index.mjs        2,5 MB  (servidor + motor empacotados pelo esbuild, ESM, sem módulos nativos)
├── server/import-cards.mjs 366 KB
├── server/seed-cli.mjs     159 KB
├── web/                    1,5 MB  (index.html, assets/ com hash, manifest, ícones)
├── data/                   708 KB  (cards, decks, spoilers, translations, card-types)
├── deploy/                 remote-deploy.sh, ecosystem.config.cjs
└── VERSION                 hash do commit
```

Total 5,1 MB. Roda com `node release/server/index.mjs` em qualquer máquina com Node ≥ 22.13 (x64 ou ARM), sem
`npm install`.

### Pipeline (`.github/workflows/ci-deploy.yml`)

```
push/PR em qualquer branch ──▶ job "test": npm ci → typecheck → npm test → build:release → smoke test
                                           (sobe o pacote, /api/health, /api/decks, index.html, import --dry-run)
                                           → artefato gumgumfight-<sha>.tgz (7 dias)
push na main ────────────────▶ job "deploy" (environment production,  https://gumgumfight.app)
push na hmg ─────────────────▶ job "deploy" (environment homologacao, https://gumgumfight.duckdns.org)
"Run workflow" em outro branch ▶ deploy na homologação (input import_sets opcional)
```

Deploy: `scp` do `.tgz` para `~/apps/gumgumfight/releases/<sha>`, `remote-deploy.sh`: grava `GOOGLE_CLIENT_ID`/
`ADMIN_EMAILS` em `shared/deploy.env`, troca o symlink `current` (atomicamente, `mv -T`), `pm2 startOrReload`,
espera `/api/health` até 30 s; **se falhar volta o symlink e recarrega a versão anterior**; mantém 5 releases;
importa `IMPORT_SETS` se pedido; o workflow então confere `https://<site>/api/health`. Secrets por environment:
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`. Variables: `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`.

### Produção (VPS Hostinger)

| Item | Valor |
|---|---|
| Plano | **KVM 1** (segundo o catálogo da Hostinger: 1 vCPU, 4 GB RAM, 50 GB NVMe, 4 TB de tráfego/mês — conferir no hPanel). O script de bootstrap assume 4 GB de RAM e cria 2 GB de swap (`vm.swappiness=10`) |
| SO | Ubuntu, `apt upgrade` no bootstrap |
| Domínios | `gumgumfight.app` (principal, HSTS obrigatório no TLD `.app`); `www`, `gumgumfight.cloud`, `www.gumgumfight.cloud` → 301 |
| Processo | pm2, app `gumgumfight`, usuário `gumgum` (sem sudo), `fork`, 1 instância, `autorestart`, **`max_memory_restart: 1500M`** (`PM2_MAX_MEMORY` em `deploy.env`), `--disable-warning=ExperimentalWarning`, `HOST=127.0.0.1`, `PORT=3310` |
| Nginx | `proxy_pass http://127.0.0.1:3310`, HTTP/1.1, `proxy_buffering off`, `proxy_read_timeout 90s`, `client_max_body_size 2m`, `gzip_types text/css application/javascript application/json image/svg+xml` (**SSE não é comprimido**), HTTP/2 quando disponível, ACME webroot. Em `location /api/`: `limit_req` 30 r/s por IP (rajada 100) e `limit_conn` 64 por IP (`/etc/nginx/conf.d/gumgumfight-limits.conf`) |
| TLS | Let's Encrypt via certbot (`certbot.timer` renova; hook recarrega o Nginx) |
| Firewall | ufw: 22, 80, 443. fail2ban no SSH. Opção `HARDEN_SSH=1` desliga senha do root |
| Banco | `~gumgum/apps/gumgumfight/shared/gumgum.db`; backup diário 04:15 (7 cópias) |
| Logs | `pm2 logs gumgumfight` (Fastify com logger JSON em produção) |

### Homologação

Servidor que já roda outros apps (`deploy/setup-vm.sh`): detecta Nginx no host ou Nginx Proxy Manager em Docker,
instala Node 22 via nvm sem trocar o padrão, cria site separado, `proxy_read_timeout 60s`. Mesmo layout de pastas e
`deploy.env`. Banco próprio (dados de homologação não vão para produção).

### Dependências externas em tempo de execução

| Serviço | Quando | Impacto se cair |
|---|---|---|
| `optcgapi.com` | imagens das cartas (navegador); importação e sync de spoilers (servidor, a cada 6 h) | cartas aparecem desenhadas em HTML (fallback automático); importação falha com log |
| `images.optcgleaks.com` / `optcgleaks.com` | imagens e feed dos spoilers | spoilers param de atualizar; nada é apagado |
| `accounts.google.com`, `www.googleapis.com` | botão de login e chaves públicas | login indisponível; quem já tem cookie continua logado (chaves ficam em cache até expirar) |
| `fonts.googleapis.com` | fontes da interface | fallback para fontes do sistema |

---

## 14. Capacidade: memória, CPU e banda (medições)

### Como foi medido

Pacote de produção (`release/server/index.mjs`, `NODE_ENV=production`, banco novo com as 735 cartas provisórias e os
36 decks), rodando na mesma máquina de um cliente de carga em Node que: cria N salas de treino contra o bot do servidor
(`POST /api/online/bot`), joga o assento humano a partir da visão recebida pelo SSE (exatamente o que o navegador
faz: `chooseBotAction(view)` → `POST /action`), abre K espectadores por sala (`/watch`) e conta os bytes recebidos
em cada canal, os eventos, o RSS (`/proc/<pid>/status`) e o tempo de CPU do processo (`/proc/<pid>/stat`).
Os bots jogam em ~55 s o que duas pessoas jogam em 15–20 min; o custo por ação e por conexão é o mesmo, só a
distribuição no tempo muda. Decks ST01 x ST02 (os de teste); decks com mais efeitos geram mais eventos de decisão.

### Resultados

**Processo ocioso**

| Medida | Valor |
|---|---|
| RSS logo após subir (735 cartas, sem conexões) | **78 MB** |
| RSS após alguns minutos (cache de traduções, GC) | 82 MB |
| Heap do bundle + Fastify + motor | incluso acima; com a base completa (~3.000–4.000 cartas) espere +20–40 MB |

**Uma partida online (130 ações em média, ST01 x ST02)**

| Medida | Jogador | Espectador |
|---|---|---|
| Bytes recebidos pelo canal SSE na partida inteira (sem compressão: SSE não passa pelo gzip do Nginx) | **1,24 MB** | **1,23 MB** |
| Eventos `state` | 130 | 130 |
| Tamanho médio de um `state` | **9,5 KB** | 9,5 KB |
| Maior `state` observado | 21–24 KB | 23 KB |
| Primeiro snapshot (inclui `defs` das cartas visíveis) | 13,4 KB | 10,3 KB |
| `ping` | 21 B a cada 20 s | idem |
| Bytes enviados pelo jogador (`POST /action`, ~65 por partida, ~300 B cada com headers) | ~20 KB | 0 |
| Em uma partida de 20 min, média por conexão | **~1 KB/s (8 kbit/s)**, em rajadas de 10–24 KB por ação | idem |

**CPU do servidor por ação** (inclui `applyAction`, bot do servidor, `viewFor` + `JSON.stringify` por conexão,
regravação da sala em `live_matches`)

| Cenário | CPU por ação | Derivado |
|---|---|---|
| 50 salas, 1 conexão cada (6.400 ações) | **1,9 ms** | custo fixo ≈ 1,6 ms |
| 20 salas, 4 conexões cada (2.580 ações) | **3,0 ms** | ≈ **0,35 ms por conexão** servida |
| Só o motor (`POST /api/matches`, 162 ações, sem visões) | 0,34 ms/ação (55 ms por upload; 46 ms de resposta) | verificação de replay é barata |
| Por partida inteira (130 ações, 2 jogadores + S espectadores) | ≈ 0,3 s + 0,05 s × S | |

**Memória por sala**

| Cenário | RSS | Derivado |
|---|---|---|
| +20 salas ativas com 4 conexões cada | 82 → 143 MB | **≈ 3 MB por sala** (medida bruta, inclui heap ainda não coletado) |
| +50 salas com 1 conexão, logo depois (heap reaproveitado) | 143 → 152 MB | o custo "líquido" por sala é bem menor que 3 MB |
| Número de planejamento | — | **2 MB por sala ativa + 0,1 MB por conexão SSE** |

Salas terminadas ficam 15 min na memória (resultado/revanche); salas privadas à espera, 30 min. Presença do menu:
até 20.000 navegadores lembrados (~2 MB).

**Outras rotas (base pequena, 120 partidas — não representa uma base grande)**

| Rota | Tempo no servidor | Tamanho da resposta |
|---|---|---|
| `GET /api/cards` (735 cartas) | 10,7 ms | 481 KB bruto / **52 KB gzip**. Com a base completa: ~2,5 MB / ~280 KB gzip, **baixado a cada abertura do construtor** |
| `GET /api/stats?days=30` | 1,5 ms | 213 B |
| `GET /api/stats/cards?leader=…` | 2,4 ms | poucos KB |
| `GET /api/online/stats` | <1 ms | 182 B (+ ~450 B de headers por sentido) |
| `GET /api/decks` (36 decks) | ~2 ms | 22 KB bruto |
| Carga inicial da interface | — | 203 KB JS gzip + 26 KB CSS gzip + 64 KB de imagens locais + fontes do Google (cache de 1 ano em `/assets`) |
| Imagens das cartas | **0 (vêm da optcgapi/optcgleaks)** | ~50–100 KB cada, no navegador |

### Modelo de consumo por usuário

| Perfil de uso | Banda (ida + volta) | CPU |
|---|---|---|
| Navegador parado no menu (aba visível) | ~0,11 KB/s (`/api/online/stats` 10 s) + ~0,1 KB/s (`/live` 15 s, cresce ~1 KB por sala listada) | ~0,1 ms por requisição |
| Tela "Assistir partidas" aberta | (0,5 KB + 1 KB × salas listadas) / 5 s | idem |
| Jogador numa partida | ~1 KB/s médio | 1,6 ms + 0,35 ms × conexões, por ação |
| Espectador | ~1 KB/s médio | 0,35 ms por ação da partida |
| Página de torneio em andamento | ~0,1 KB/s (304 sem corpo); ~(0,3 KB × jogadores + 0,1 KB × partidas) gzip só quando algo muda | consulta servida do cache; o SQL roda uma vez por mudança |
| Partida contra o bot no navegador | 0 durante o jogo; ~9 KB no fim (`POST /api/matches`) | 55 ms no fim |

### Cenários de carga simultânea

Premissas: partida de 20 min com 130 ações; espectadores distribuídos; todos os navegadores do menu com a aba visível.

| Cenário | Partidas | Espectadores | Menu/lista | Torneio ativo | Banda total | Por hora | CPU (1 vCPU) | RSS estimado |
|---|---|---|---|---|---|---|---|---|
| **A — hoje/pequeno** | 10 | 20 | 50 | — | ~50 KB/s (0,4 Mbit/s) | 0,2 GB | < 1 % | ~110 MB |
| **B — médio** | 50 | 100 | 300 | 32 jogadores | ~290 KB/s (2,3 Mbit/s) | 1,0 GB | ~3 % | ~200 MB |
| **C — grande** | 200 | 500 | 1.000 | 128 jogadores | ~1,1 MB/s (9 Mbit/s) | 4 GB | ~10 % | **~570 MB** |
| **D — muito grande** | 500 | 1.500 | 3.000 | 256 jogadores | ~2,9 MB/s (23 Mbit/s) | 10 GB | ~25–30 % (partidas + GC; estimativa) | **~1,3 GB** |

Leitura: a **banda não é o gargalo** da VPS (link de centenas de Mbit/s; 4 TB/mês comportam o cenário C durante
8 h/dia o mês inteiro, ~1 TB). A **CPU** de um core só começa a pesar no cenário D, por causa das partidas e das
pausas de GC (o polling da página do torneio era o maior custo, e passou a ser servido do cache). O primeiro limite
real é a **memória do processo**: o pm2 reinicia o app ao passar de `max_memory_restart` (hoje **1500 MB**; era 400 MB),
o que derruba todos os canais SSE por alguns segundos (as salas voltam do banco e os navegadores reconectam, mas é
uma interrupção visível). Com o número de planejamento de 2 MB/sala, isso aconteceria perto de 600 partidas
simultâneas; antes disso o teto de **400 salas ativas** (`ONLINE_MAX_ROOMS`) responde 503 a salas novas, protegendo
as partidas em andamento.

**Treino contra o bot transmitido (teto de 100 salas, `ONLINE_MAX_BOT_ROOMS`).** Cada sala custa o mesmo que uma
partida online (o bot do servidor já entra no 1,9 ms por ação medido acima). Com as 100 salas cheias em ritmo de gente
(~20–30 ações/s no total) e alguns espectadores: ~200–250 MB a mais de RSS, ~5–10 % de 1 vCPU e ~0,3–0,5 MB/s. Essas
salas contam dentro das 400 do teto geral. As medições não foram feitas na KVM 1: depois de subir o teto, acompanhar
`playing.bot` em `/api/online/stats` com os sinais da seção 15.

---

## 15. Quando e como escalar a VPS

### Sinais para agir (monitorar com `pm2 monit`, `pm2 logs`, `htop`, `GET /api/online/stats`)

| Sinal | Limiar sugerido | Ação |
|---|---|---|
| RSS do processo `gumgumfight` | > 300 MB sustentado, ou reinícios por memória no `pm2 logs` | passo 1 abaixo (imediato) |
| Partidas simultâneas (`playing` em `/api/online/stats`) | > 100 | passos 1 e 2 |
| CPU do processo Node | > 60 % sustentado em um core | passo 2 (fan-out, cache de stats) antes de hardware |
| Atraso do event loop (medir: `perf_hooks.monitorEventLoopDelay` ou latência de `/api/health` sob carga) | p99 > 100 ms | consultas SQL longas → passo 2 (cache/worker) |
| Tráfego mensal (hPanel) | > 3 TB | passo 2 (deltas no SSE) |
| `GET /api/cards` dominando o tráfego (muitos construtores abertos) | — | ETag/Cache-Control na rota |
| Tamanho de `match_seats` | > 1–2 milhões de linhas (≈ 500 mil–1 milhão de partidas) | cache das consultas de stats; avaliar Postgres |

### Passos, do mais barato ao mais caro

1. **Configuração, sem código (1 h).** Já feito: `max_memory_restart` em `1500M` (`PM2_MAX_MEMORY` em `deploy.env`)
   e teto de 400 salas (`ONLINE_MAX_ROOMS`). Para ir além, subir os dois juntos (2 MB por sala como regra) e, se preciso,
   `node_args: '--max-old-space-size=…'`. Manter a swap de 2 GB como rede de segurança.
2. **Otimizações no código (dias), na ordem de retorno:**
   - **Fan-out compartilhado no espectador**: calcular `viewFor(state, null)` e o JSON uma vez por ação e enviar o
     mesmo buffer a todos os espectadores sem mãos (hoje é uma vez por conexão). Corta o custo por espectador de
     ~0,35 ms para quase zero; deixa 100 espectadores por sala custarem o mesmo que 1.
   - **Deltas no `state`**: mandar só o que mudou (ou o estado comprimido) em vez de ~9,5 KB por ação. Reduz a banda
     do SSE em ~80 %. Alternativa mais simples: ligar compressão no canal (`Content-Encoding: gzip` com flush por
     evento no próprio Node, já que o Nginx não comprime `text/event-stream` com `proxy_buffering off`).
   - **Cache com ETag em `GET /api/online/live`** (a lista "Assistir" consulta a cada 5 s). Estatísticas e torneio
     completo já ficam em cache com ETag (`cache.ts`).
   - **`GET /api/cards` com `ETag`/`Last-Modified`** (máximo de `cards.updated_at`) e `Cache-Control`. Evita ~280 KB
     por abertura do construtor.
   - **Consultas pesadas de estatísticas num `worker_thread`** com a própria conexão `DatabaseSync` (SQLite em WAL
     permite leitores concorrentes). Tira o bloqueio do event loop das partidas.
3. **Escala vertical (horas).** Hostinger KVM 2 (2 vCPU, 8 GB) ou superior: resolve memória e deixa um core para
   Nginx, SO e backup. **Não dobra a capacidade de CPU do app**, que é um processo Node single-thread; só os passos 2
   ou 4 fazem isso.
4. **Escala horizontal (semanas, refatoração).** Hoje é impossível subir duas instâncias: salas, filas e presença
   vivem na memória de um processo, e o SQLite é um arquivo local com um escritor por vez. Dois caminhos:
   - **Particionar por sala**: N processos (pm2 `cluster` não serve, porque o estado não é compartilhado; seriam apps
     separados em portas diferentes), Nginx roteando `/api/online/rooms/:id/*` pelo hash do id para o processo dono
     da sala e as filas num único processo "lobby". O SQLite continua compartilhado (WAL, escritas curtas).
   - **Externalizar estado**: Redis (salas, filas, presença, pub/sub para o fan-out) + Postgres (toda a SQL está em 4
     arquivos: `db.ts`, `stats/store.ts`, `auth/store.ts`, `tournaments/store.ts`). É o caminho para múltiplas VPS
     e para um balanceador.

   Antes disso, uma única VPS bem configurada com os passos 1–3 cobre, pelas medições, algumas centenas de
   partidas simultâneas com milhares de espectadores.

---

## 16. Riscos e limites conhecidos

| Risco | Onde | Mitigação hoje | Sugestão |
|---|---|---|---|
| **Ponto único de falha**: um processo, uma máquina, um arquivo | tudo | pm2 `autorestart`, salas persistidas em `live_matches`, backup diário | monitoramento externo de `/api/health`; passo 4 da seção 15 a longo prazo |
| **SQLite síncrono bloqueia o event loop** | `node:sqlite` | consultas hoje levam ms; índices em `match_seats`/`match_cards` | cache de stats; worker thread |
| **Reinício por memória** (1500 MB) | `ecosystem.config.cjs` | salas voltam do banco; o teto de 400 salas segura antes | subir os dois juntos ao escalar (seção 15) |
| **SSE sem compressão e sem deltas** | `online/room.ts` `snapshot` | — | deltas / gzip no Node |
| **Polling de 5 s na página do torneio** por jogador | `Tournaments.tsx` | cache no servidor + ETag/304 (`cache.ts`) | SSE do torneio, se o volume crescer |
| **Hotlink das imagens** em `optcgapi.com` / `optcgleaks.com` (podem bloquear, mudar URL ou sair do ar) | `imageUrl` | fallback para a carta desenhada; `CARD_IMAGES=off` | cache/proxy próprio de imagens (custaria ~50–100 KB × cartas de banda e disco) |
| **Abrir salas não exige login** (o código do navegador é gerado à vontade; o treino transmitido exige) | `online/routes.ts` | tetos de salas por servidor e por IP (`lobby.admit`), `limit_req`/`limit_conn` no Nginx | acompanhar os 429/503 nos logs e ajustar `DEFAULT_LIMITS` |
| **Token do assento no `live_matches`** em texto | `RoomData.seats[].token` | arquivo só legível pelo usuário `gumgum` | guardar hash |
| **Importador sem retry/backoff** | `card-import.ts` | roda poucas vezes | retry com espera |
| **Cartas ⚙ (efeito não automatizado)** | `parser.ts` coverage | `/api/coverage`, proibidas na ranqueada | continuar ampliando parser/scripts |
| Correções apontadas na revisão do código dos torneios | `tournaments/store.ts` | — | `reportFromGame` sobrescreve `match_id` mesmo com placar manual; `UPDATE` filtra só por `id`; `hadBye` conta byes da eliminatória no suíço; `PUT result` aceita torneio `finished` |

---

## 17. Apêndices

### A. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` / `HOST` | `3001` / `0.0.0.0` (produção `3310` / `127.0.0.1`) | escuta HTTP |
| `DB_PATH` | `apps/server/var/gumgum.db` | arquivo SQLite |
| `WEB_DIST` / `DATA_DIR` | `apps/web/dist` / `data` | interface compilada / dados do pacote |
| `CARD_IMAGES` | `on` | `off` remove as URLs de imagem das respostas |
| `CARD_API_BASE` | `https://optcgapi.com/api` | importador e sync |
| `SPOILER_SYNC` | `6` (horas) | `off` desliga; nunca roda em testes |
| `GOOGLE_CLIENT_ID` | vazio (login desligado) | OAuth Web client |
| `ADMIN_EMAILS` | vazio | contas que viram Admin ao entrar |
| `ONLINE_BOT_ROOMS` | `on` | transmitir o treino contra o bot (servidor joga pelo bot; exige login) |
| `ONLINE_MAX_ROOMS` / `ONLINE_MAX_BOT_ROOMS` | `400` / `100` | tetos de salas ativas (todas / treino contra o bot transmitido) |
| `PM2_MAX_MEMORY` | `1500M` | só em `shared/deploy.env` da VM: memória em que o pm2 reinicia o app |
| `PARTNER_IPS` | vazio | só em `shared/deploy.env` da VM: IPs dos servidores de apps parceiros, fora do limite por IP do Nginx |
| `NODE_ENV` | — | `production` desliga a leitura do `.env`; `test` desliga o sync |

### B. Rotas da API

Quem chama, na coluna da direita:

- **Pública**: sem login nem token.
- **Navegador**: o header `x-deck-owner` (código do navegador) ou a sessão; sem ele, 400 `noOwner`.
- **Dono**: o deck ou perfil pertence a quem pede (navegador ou conta `user:<id>`).
- **Sessão**: login com Google (cookie `gg_session`); 401 sem ele.
- **Assento**: o token `t` do assento da sala (`{ roomId, token }` devolvido ao criar/entrar).
- **Jogou**: uma das contas da partida (replay de torneio só depois que ele termina).
- **Organizador**: organizador do torneio (perfil Organizador ou cota de apoiador) ou Admin.
- **Judge**: Judge do torneio, o organizador ou Admin.
- **Streamer**: perfil Streamer ou Admin.
- **Admin**: perfis Admin e Dev.
- **Token (scope)**: também aceita um token de parceiro com o scope; as outras rotas respondem 403 `token_not_allowed` a tokens.
- **Cliente OAuth**: `client_id` + `client_secret` de um app cadastrado.
- **Link assinado**: o `t` gerado por `POST /api/matches/:id/replay-link` (1 h, só aquela partida).

| Método | Rota | Descrição | Quem chama |
|--------|------|-----------|------------|
| GET | `/api/health` | Verificação de saúde | Pública |
| GET | `/api/config` | Configurações públicas (imagens, Client ID do Google, chave das notificações, apoio, acesso) | Pública |
| GET | `/api/access` | Acesso ao site na homologação só para apoiadores (`{ allowed, reason }`) | Pública |
| GET | `/api/cards?set=` · `/api/cards/:id` | Cartas (por coleção) e uma carta | Pública |
| GET | `/api/coverage` | Cobertura dos efeitos automatizados por coleção | Pública |
| GET | `/api/translations/pending` | Cartas com tradução automática parcial | Pública |
| GET | `/api/dev/card-gaps` | Lacunas do leitor: cartas ⚙ por coleção e por parte do leitor, ranking das frases que faltam (até 300) e o número de novas | Dev |
| GET | `/api/dev/card-gaps/cards?set=` · `?ids=a,b` · `?new=1` | Cartas ⚙ com o diagnóstico linha por linha (`LineDiagnosis`) | Dev |
| GET | `/api/dev/card-gaps/new-count` | Número de cartas novas com ⚙ (selo do menu) | Dev |
| POST | `/api/dev/card-gaps/reviewed` | Marca as novas como vistas (`{ ids? }`; sem `ids`, todas) | Dev |
| GET | `/api/dev/engine-texts` | Textos para o motor gravados (situação oficial → com o texto, `stale`, autor) | Dev |
| GET | `/api/dev/engine-texts/:id` | Uma carta: texto oficial, texto para o motor, leitura de cada um (linhas e tradução), `stale`, histórico | Dev |
| POST | `/api/dev/engine-texts/preview` | `{ cardId, text, trigger }`: o que o leitor faria, sem gravar | Dev |
| PUT · DELETE | `/api/dev/engine-texts/:id` | Grava (`{ text, trigger }`) / apaga o texto para o motor (recusa carta com script e texto igual ao oficial) | Dev |
| GET | `/card-img/:origin/*` | Imagens das cartas pelo mesmo domínio (em produção o Nginx atende antes) | Pública |
| PUT · DELETE | `/api/push/subscription` | Liga (`{ subscription, locale, matches, tournaments }`) / desliga (`{ endpoint }`) as notificações do navegador | Navegador |
| GET | `/api/auth/me` | Usuário logado (`{ user }` com `role`; `null` sem sessão). Com token: só `{ id, role: 'player' }` e o perfil público | Pública; Token (`profile`) |
| POST | `/api/auth/google` | Login: `{ credential }` (ID token do Google); abre a sessão em cookie | Pública |
| POST | `/api/auth/logout` | Sai (apaga a sessão) | Sessão |
| PUT · DELETE | `/api/auth/me/picture` | Troca a foto da conta (`{ image }` data URL) / volta para a do Google | Sessão |
| GET | `/api/users/:id/picture` | Foto enviada por um usuário | Dono ou Admin |
| GET | `/api/admin/users?q=` | Contas e perfis | Admin |
| PUT | `/api/admin/users/:id/role` | Muda o perfil (`{ role }`; a si mesmo, só para `dev`) | Admin |
| PUT | `/api/admin/users/:id/supporter` | Plano de apoio dado à mão (`{ tier, until }`) | Admin |
| GET | `/api/admin/tutorial?days=` | Funil anônimo das lições do tutorial | Admin |
| GET · POST · PUT · DELETE | `/api/admin/sponsors`, `/api/admin/sponsors/:id`, `/api/admin/sponsors/:id/logo` | Lojas parceiras | Admin |
| GET | `/api/admin/support/payments` | Pagamentos recebidos (Apoia.se, Ko-fi) | Admin |
| GET | `/api/decks?mine=1` | Lista decks com validação; `mine=1`: só os de quem pede | Pública; Token (`decks:read`) |
| GET | `/api/decks/:id` | Deck + definições das cartas usadas (com token: só os próprios e os prontos) | Pública; Token (`decks:read`) |
| POST | `/api/decks` | Cria um deck (`{ name, leader, cards, arts? }`) | Navegador; Token (`decks:write`) |
| PUT | `/api/decks/:id` | Atualiza um deck (`expectedUpdatedAt` ou `If-Unmodified-Since`: 409 `deck_conflict` se mudou depois) | Dono; Token (`decks:write`) |
| PUT | `/api/decks/:id/name` | Só o nome | Dono ou Admin |
| DELETE | `/api/decks/:id` | Apaga um deck | Dono; Token (`decks:write`) |
| GET · POST | `/api/tokens` | Apps conectados: lista; cria (`{ name, scopes }` → `{ id, token }`, uma vez só) | Sessão |
| DELETE | `/api/tokens/:id` | Revoga um token pessoal ou todos os tokens de um app | Sessão |
| GET | `/oauth/authorize?…` | Início do fluxo OAuth: confere o pedido e responde a tela de consentimento | Pública |
| GET · POST | `/api/oauth/consent` | O que a tela mostra / a decisão (`decision: allow \| deny` → `{ redirect }`) | Pública (GET); Sessão (POST) |
| POST | `/api/oauth/token` | Troca `authorization_code` (+ `code_verifier`) ou `refresh_token` por tokens (10/min por cliente) | Cliente OAuth |
| POST | `/api/oauth/revoke` | Revoga um token do app (`{ token }`); 200 sempre | Cliente OAuth |
| POST | `/api/matches` | Envia o replay de uma partida contra o bot (o servidor refaz a partida antes de gravar) | Navegador |
| GET | `/api/matches` | Últimas 20 partidas (resumo sem jogadores) | Pública |
| GET | `/api/matches/:id` | Resumo de uma partida com as cartas de cada lado (`seats`; o oponente vem `null` fora de torneio encerrado) | Jogou, Judge, Admin; Token (`matches:read`) |
| GET | `/api/matches/:id/replay` | Arquivo de replay para a mesa | Jogou, Judge, Admin; Token (`matches:read`) |
| POST | `/api/matches/:id/replay-link` | Link assinado do replay embutido (`{ lang?, layout?, embed? }` → `{ url, token, expiresAt }`) | Jogou, Judge, Admin; Token (`matches:read`) |
| GET | `/api/replay/:id?t=` | Replay embutido: arquivo, cartas usadas e origens dos parceiros | Link assinado |
| GET | `/replay/:id?t=` | Página do replay embutido (pode ir para um iframe nas origens de `REPLAY_EMBED_ORIGINS`) | Link assinado |
| POST | `/api/matches/:id/report` | Relata um problema (`{ text, card?, expected?, notify? }`) | Jogou |
| GET | `/api/reports?tournament=&status=` | Relatos abertos/resolvidos | Admin; Organizador (dos seus torneios) |
| PUT | `/api/reports/:id` | Resolve ou reabre (`{ resolved, note? }`) | Admin; Organizador |
| GET | `/api/players/me` | Perfil de jogador (nome, recompensa, tier, `apprentice`) | Navegador; Token (`profile`) |
| PUT | `/api/players/me` | Troca o nome público (`{ name }`) | Navegador |
| GET | `/api/players/me/matches?since=&limit=&cursor=` | Partidas do jogador, mais novas primeiro, paginadas | Sessão; Token (`matches:read`) |
| GET | `/api/tutorial/progress` · PUT | Progresso do tutorial (`{ done, dismissed, completed, reset? }`) | Navegador |
| POST | `/api/tutorial/events` | Evento anônimo de lição (`{ lesson, step?, event }`) | Pública |
| GET | `/api/stats/meta` | Opções dos filtros: formatos, filas, tiers, Líderes e o perfil de quem pede | Pública; Token (`stats:read`) |
| GET | `/api/stats` · `/api/stats/trend?weeks=` · `/api/stats/cards?leader=\|deck=` | Totais, Líderes e matchups; tendência semanal; cartas de um Líder. Ranqueada e torneios só com o plano (salvo `mine=1`) | Pública; Token (`stats:read`) |
| GET | `/api/stats/teaser?format=` | Amostra das Estatísticas Pro para quem não tem o plano | Pública |
| GET | `/api/online/config` · `/api/online/stats` · `/api/online/leaders?format=` | Configuração do online, contadores do menu e Líderes na fila casual | Pública |
| GET | `/api/online/active` | Partidas em andamento de quem pede (com o token do assento) | Navegador |
| POST | `/api/online/rooms` · `/api/online/rooms/join` · `/api/online/queue` | Cria uma sala privada; entra numa; entra na fila (`{ deckId, format, queue }`; ranqueada exige login) | Navegador |
| GET · DELETE | `/api/online/queue/:ticket` | Consulta a fila / sai dela | Quem tem o ticket |
| POST | `/api/online/bot` | Treino contra o bot transmitido (`{ deckId, botDeckId \| random, format, first? }`) | Sessão |
| GET | `/api/online/rooms/:id/events?t=` | Canal SSE do jogador | Assento |
| POST | `/api/online/rooms/:id/{action,dice,emote,chat,focus,rematch,leave}` | Ação, dado, emote, chat (censurado), presença, revanche, sair | Assento |
| GET | `/api/online/rooms/:id/replay` | Replay completo da sala (depois do fim; nunca de torneio) | Pública |
| GET | `/api/online/live` · `/api/online/watch/:code` · `/api/online/rooms/:id` | Partidas para assistir; sala privada pelo código; resumo de uma sala | Pública |
| GET | `/api/online/rooms/:id/watch?hands=1` · `?k=` · `?judge=1` | Canal SSE do espectador (`hands`: mesa atrasada com as mãos; `k`: tela de transmissão; `judge`: o Judge vê as mãos ao vivo) | Pública; `hands`: Streamer; `k`: chave; `judge`: Judge |
| GET | `/api/online/rooms/:id/decks` | Decks dos jogadores de uma sala (painel de quem transmite) | Streamer |
| GET · POST · PUT | `/api/broadcast`, `/api/broadcast/key`, `/api/broadcast/room`, `/api/broadcast/settings` | Modo transmissão: link do OBS, partida escolhida e opções | Streamer |
| GET | `/api/broadcast/:key` | O que a tela de transmissão mostra (a chave faz as vezes do login) | Chave |
| GET | `/api/tournaments` · `/api/tournaments/:id` · `/api/tournaments/:id/lobby` | Torneios, detalhe e lobby (o que quem pede pode fazer vem na resposta) | Pública |
| GET | `/api/tournaments/me` | Torneios em que a conta está em jogo agora | Sessão |
| POST | `/api/tournaments` | Cria (`{ name, format, structure, rounds, swissBestOf, topCut, bo3From, bo5From, maxPlayers, startsAt, checkIn, … }`) | Organizador ou apoiador Capitão/Almirante (cota) |
| PUT · DELETE | `/api/tournaments/:id` | Edita (só com inscrições abertas) / apaga | Organizador |
| POST · DELETE | `/api/tournaments/:id/register` · POST `/checkin` | Inscreve ou troca o deck (`{ deckId }`); cancela ou desiste; check-in | Sessão |
| PUT | `/api/tournaments/:id/matches/:m/ready` · POST `/play` | "Estou pronto"; abre ou entra na sala do jogo atual | Sessão (jogador da mesa) |
| POST | `/api/tournaments/:id/matches/:m/call` | Chama o Judge (pausa a sala), com o motivo, o texto e a linha do histórico da jogada (`{ reason?, details?, logIndex? }`) | Sessão (jogador da mesa) ou Judge |
| POST | `/api/tournaments/:id/{start,next,finish}` · `/rounds/begin` | Começa, avança, encerra; inicia a rodada atual | Organizador |
| PUT · DELETE | `/api/tournaments/:id/judges` · `/judges/:userId` | Escolhe / remove Judges | Organizador |
| POST | `/api/tournaments/:id/matches/:m/resume` · `/players/:userId/warnings` | Retoma a partida pausada com o desfecho (`{ outcome?, note? }`; erro do app abre o chamado de ajuste); dá um warning | Judge |
| GET | `/api/tournaments/:id/incidents` | Chamados, warnings e intervenções do modo manual | Judge |
| GET | `/api/tournaments/:id/matches/:m/call` | O chamado aberto (motivo, texto, jogada apontada, o que o Judge já fez) | Judge |
| POST | `/api/tournaments/:id/matches/:m/manual` | Entra/sai do modo manual (`{ on, note? }`) | Judge (torneio em andamento) |
| GET | `/api/tournaments/:id/matches/:m/plays` | Todas as jogadas da partida em andamento, com a pergunta aberta e o que foi escolhido (sem a seed) | Judge (torneio em andamento) |
| POST | `/api/tournaments/:id/matches/:m/undo` · `/judge-action` | Desfaz jogadas (`{ seq, to, note }`); corrige a mesa ou responde no lugar do jogador (`{ seq, player, op \| action, note }`) | Judge (torneio em andamento) |
| DELETE | `/api/tournaments/:id/warnings/:w` · POST `/players/:userId/warnings/keep` | Anula um warning; mantém o jogador no limite | Organizador |
| PUT | `/api/tournaments/:id/matches/:m/result` | Placar da série (`{ wins }` ou `{ result }`) | Organizador |
| POST | `/api/tournaments/:id/players/:userId/{drop,reinstate}` · PUT `/late` | Tira / devolve um jogador; libera a inscrição atrasada | Organizador |
| GET | `/api/tournaments/:id/recap` | Kit de divulgação (torneio encerrado) | Organizador |
| GET | `/api/sponsors?placement=` · `/api/sponsors/:id/logo` | Lojas parceiras e o logo | Pública |
| GET | `/api/support` · `/api/support/supporters` | Apoio ao projeto e lista pública de apoiadores | Pública |
| PUT | `/api/support/me` | Aparecer na lista de apoiadores (`{ public }`) | Sessão |
| POST | `/api/support/apoiase/sync` | Consulta agora o apoio na Apoia.se | Sessão |
| POST | `/api/support/kofi` | Webhook do Ko-fi (token de verificação no corpo) | Ko-fi (`KOFI_WEBHOOK_TOKEN`) |
| GET | `/api/internal/supporter?email=` | Plano de uma conta, consultado pela homologação | `INTERNAL_TOKEN` em `Authorization: Bearer` |

Corpos, filtros, erros e o fluxo OAuth dos parceiros estão descritos no `README.md` (seções "API" e "API para parceiros").

### C. Comandos

```bash
npm install && npm run dev                 # API em :3001 e Vite em :5173
npm run typecheck && npm test              # tipos; testes do motor (com 200 partidas bot x bot) e do servidor
npm run cards:import -- ST-01 OP-01        # importar coleções da optcgapi
npm run cards:import -- --all              # tudo
npm run cards:import -- --spoilers         # buscar spoilers e trocar por oficiais
npm run db:seed                            # reaplicar decks prontos / cartas provisórias / traduções
npm run oauth:client -- add sweetapp "sweetapp" --redirect https://… [--scopes "…"] [--webhook https://…]  # cliente OAuth (parceiros)
npm run translations:check -w @gumgum/server
npm run cards:check-official -w @gumgum/server
npm run simulate -w @gumgum/engine -- 500  # N partidas bot x bot (bot heurístico)
npm run compare-bots -w @gumgum/engine -- 100 hard easy  # dois níveis do bot frente a frente: vitórias e tempo por decisão
npm run build:release                      # pacote em release/
DB_PATH=/caminho/gumgum.db WEB_DIST=$PWD/release/web DATA_DIR=$PWD/release/data PORT=3310 node release/server/index.mjs
# na VPS
pm2 logs gumgumfight; pm2 restart gumgumfight; pm2 monit
sqlite3 ~/apps/gumgumfight/shared/gumgum.db "select count(*) from matches"
```

### D. Reproduzindo as medições

1. `npm ci && npm run build:release`.
2. Subir o pacote: `DB_PATH=/tmp/bench.db WEB_DIST=$PWD/release/web DATA_DIR=$PWD/release/data PORT=3998 HOST=127.0.0.1 NODE_ENV=production SPOILER_SYNC=off node release/server/index.mjs`.
3. Um cliente Node que cria N salas com `POST /api/online/bot` (`{deckId:'st01-luffy', botDeckId:'st02-kid', format:'egb'}`,
   header `x-deck-owner` único por sala e um cookie `gg_session` de uma conta, já que a rota exige login), lê o SSE `/rooms/:id/events?t=<token>` com `fetch`, joga o assento humano
   com `chooseBotAction` do `@gumgum/engine` sobre a visão recebida (`POST /action {t, seq: view.actionCount, action}`)
   e abre K leitores de `/rooms/:id/watch` por sala; soma `byteLength` dos chunks e lê `VmRSS` de `/proc/<pid>/status`
   e `utime+stime` de `/proc/<pid>/stat` antes e depois.
4. Para o custo do upload de replay, gerar uma partida bot x bot local com `createGame`/`applyAction` e enviar em
   `POST /api/matches`.
