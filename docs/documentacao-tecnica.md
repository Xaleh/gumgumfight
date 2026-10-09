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
| **Frontend** | React + Vite. Menu, construtor de decks, mesa de jogo, espectador, estatísticas, torneios, administração. | Navegador (SPA, sem service worker). |
| **Importador de cartas** | Busca as cartas oficiais na optcgapi.com e os spoilers na optcgleaks.com; normaliza e grava no SQLite. | CLI no servidor + sincronização periódica dentro do próprio processo da API. |
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

Não há roteador (react-router), gerenciador de estado, service worker nem biblioteca de componentes. O PWA se limita
ao `manifest.webmanifest` (ícones, `display: standalone`).

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
│   ├── src/bot/simple.ts        bot heurístico
│   ├── scripts/simulate*.ts     simulações bot x bot na linha de comando
│   └── test/                    46 arquivos de teste + fixtures
├── apps/server/                 API Fastify
│   ├── src/index.ts             entrypoint: abre o banco, seed, agenda sync de spoilers, listen
│   ├── src/app.ts               buildApp: rotas de cartas, decks, coverage, static; registra os módulos
│   ├── src/db.ts                schema SQLite (migrações idempotentes) e acesso a cards/decks/live_matches
│   ├── src/config.ts, env.ts, paths.ts   variáveis de ambiente e caminhos
│   ├── src/optcgapi.ts          mapeamento da optcgapi → CardData
│   ├── src/card-import.ts, import-cards.ts   CLI de importação
│   ├── src/spoiler-feed.ts, spoiler-sync.ts  optcgleaks + troca por cartas oficiais
│   ├── src/official-cards.ts, check-official.ts, check-translations.ts  scripts de conferência
│   ├── src/seed.ts, seed-cli.ts  decks prontos, cartas provisórias, traduções
│   ├── src/present.ts           ApiCard: i18n e remoção de imagens
│   ├── src/auth/                google.ts (JWKS/RS256), store.ts (users, sessions, roles), routes.ts
│   ├── src/online/              room.ts (uma partida + relógio), lobby.ts (salas, filas, presença), routes.ts (HTTP + SSE)
│   ├── src/stats/               catalog.ts (tiers, Elo), derive.ts (refaz replay), store.ts (SQL), routes.ts
│   ├── src/tournaments/         pairing.ts (suíço, chave), store.ts (SQL), routes.ts
│   └── test/                    9 arquivos de teste + fixtures da optcgapi/optcgleaks
├── apps/web/                    React + Vite
│   ├── src/App.tsx              seleção de tela (useState<Screen>, sem roteador)
│   ├── src/api.ts               todos os fetches, header x-deck-owner, URLs de SSE
│   ├── src/auth.tsx, settings.tsx   contexts
│   ├── src/game/useGame.ts      partida local (motor + bot no navegador, undo, replay)
│   ├── src/game/useOnlineGame.ts   canal SSE, reconexão, fila de ações
│   ├── src/components/          Menu, DeckBuilder, GameScreen (2.319 linhas), Board, Watch, Tournaments, Stats, Admin…
│   └── public/                  manifest, ícones, marca
├── data/
│   ├── cards/*.json             34 arquivos de cartas provisórias (750 cartas; ST01–ST36 parciais, OP01, OP02)
│   ├── decks/*.json             36 decks prontos (um por starter deck)
│   ├── spoilers/eb05.json, op18.json   coleções futuras (feed optcgleaks)
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
- **Ações** (17 tipos): `mulligan`, `playCard`, `attachDon`, `detachDon`, `cancel`, `activate`, `attack`, `endTurn`,
  `choose`, `answer`, `counter`, `pass`, `option`, `concede`, `timeout` (só o servidor), `manual`/`manualDone`
  (só testes; recusadas online).
- **Determinismo**: o RNG vive dentro do estado. `mulberry32` (32 bits) nas partidas locais; `sfc32` (128 bits,
  seed do `crypto`) nas online, porque 32 bits poderiam ser descobertos por força bruta a partir da mão inicial.
- **Replays**: `REPLAY_VERSION = 10`; `upgradeReplayActions` insere respostas implícitas de versões antigas. Não há
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

### Visão por jogador (`view.ts`)

`viewFor(state, viewer, aliases, extra?)` devolve um `GameState` com: cartas fora de vista como `?`/`~` (com handle
de posição `~dono:zona:índice`), `defs` só das cartas visíveis, `seed`/`rng` zerados, `rng128` e `checkpoint`
removidos, passos de efeito do oponente esvaziados, `pending` do oponente sem opções, `log.secret` só para o dono.
`viewer = null` é o espectador (nada de mão). Os uids reais (`c1, c2…`) seguem a ordem do deck, por isso o servidor
troca cada um por um apelido aleatório (`createAliases`, HMAC-SHA256 com salt da sala). `actionFromView` traduz de
volta a ação feita sobre a visão.

### Formatos (`formats.ts`)

`standard` e `egb`. Banidas (6 cartas, uma com `since: 2026-10-12`), 3 pares proibidos, rotação do bloco ① em
Standard (`/^(OP0[1-4]|ST0[1-9])-/`, exceto 14 ids). `validateDeck` confere 50 cartas, 4 cópias, cor do Líder e
regras especiais do Líder.

### Tradução

`translateCardPt` monta o português a partir da DSL; o que o parser não entendeu passa por `translateToPt` (regras de
frase). Resultado `complete: boolean` → o servidor marca `i18n.pt.source = manual | auto | partial`.

### Bot (`bot/simple.ts`)

Heurístico (valor = custo × 1000 + poder): joga a carta mais cara, anexa DON!! até superar o Líder inimigo, ataca
para K.O. de custo ≥ 3 ou o Líder, bloqueia/conta só quando vale a pena. Objetivo: partidas plausíveis para testes,
não jogar bem. É o mesmo bot usado no navegador (contra o bot) e no servidor (treino online, `queue: 'bot'`).

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

`app.ts` registra, nesta ordem: health/config, cartas, coverage, traduções pendentes, decks, `registerAuth`,
`registerStatsRoutes`, `registerOnlineRoutes` (devolve o `Lobby`), `registerTournamentRoutes` (recebe o `Lobby`),
`/api/matches`, e por fim o static + fallback para `index.html`. A tabela completa de rotas está no
[Apêndice B](#b-rotas-da-api).

### Identidade do cliente

- **Sem login**: o navegador gera `gumgum.owner` (24 bytes aleatórios em hex) e manda em **todo** fetch no header
  `x-deck-owner`. O servidor guarda só `sha256(token)` (`owner_hash`).
- **Com login**: o cookie `gg_session` identifica a conta; o dono passa a ser `user:<id>`.
- Rate limit nas ações das salas (60 ações / 10 s por assento) e nos emotes (1 / 3 s).
- **Tetos de salas** (`online/lobby.ts`, `DEFAULT_LIMITS`, conferidos em `lobby.admit` antes de criar sala, entrar numa,
  entrar na fila ou abrir treino contra o bot): 400 salas ativas no servidor (`ONLINE_MAX_ROOMS`, 503 acima), 10 salas de
  bot (`ONLINE_MAX_BOT_ROOMS`, 503), 16 salas ou lugares na fila por IP ao mesmo tempo (429) e 60 criações por IP a cada
  10 min (429). Os IPs ficam só em memória (nunca no banco). Partidas de torneio só passam pelo teto global.
- **Rate limit por IP no Nginx** (scripts de deploy): `/api/` com 30 req/s por IP, rajada de 100, e 64 conexões
  simultâneas por IP (os canais SSE contam). Acima disso, 429 antes de chegar ao app.

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
`sessionStorage.gumgum.openMatch` para sobreviver a recarga. O único parâmetro de URL é `?sala=CÓDIGO` (convite de sala
privada), lido uma vez e removido com `history.replaceState`.

### Dados no navegador

| Chave | Conteúdo |
|---|---|
| `localStorage.gumgum.owner` | token do dono dos decks/perfil (sem login) |
| `localStorage.gumgum.settings` | `{lang, images, quickCounter, animations, theme}` |
| `localStorage.gumgum.lastDecks`, `gumgum.format` | últimos decks e formato escolhidos |
| `localStorage.gumgum.watchHands`, `gumgum.statsFilters`, `gumgum.statsMin` | preferências de espectador e estatísticas |
| `sessionStorage.gumgum.openMatch` | partida/transmissão aberta |

Nada de cache de cartas: o construtor baixa `GET /api/cards` inteiro toda vez que abre.

### Partida contra o bot

Roda **inteira no navegador** (`useGame.ts`): `createGame`, `applyAction`, `chooseBotAction` com atrasos de 500–2000 ms
para parecer humano, undo com até 400 estados, replay `.json`. No fim, `POST /api/matches` envia `{mode, format,
seed, firstPlayer, chooseFirst, deckIds, decks, actions}`; o servidor refaz e grava (seção 9).

**Assistir replay** (`ReplayLoader.tsx` + modo `replay` do `useGame`): o `.json` vira um `GameSetup` com o roteiro já
convertido; com `decks` no arquivo (online e, desde o card 73, também os baixados no navegador) os decks não precisam
existir. O `useGame` usa um `ReplayCursor`; a `ReplayBar` (abaixo da mesa) avança, volta e pula. Pulos e a velocidade 8×
mudam a mesa sem animação. Nada é gravado em `matches`.

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

`<img src={def.imageUrl} loading="lazy" referrerPolicy="no-referrer">`; se falhar, a carta é desenhada em HTML/CSS.
As URLs apontam para `https://optcgapi.com/media/static/Card_Images/<ID>.jpg` (oficiais) e
`https://images.optcgleaks.com/<set>/images/<id>.webp` (spoilers). **Esse tráfego não passa pela VPS.**

### Build

`vite build` → `apps/web/dist`: `index.html` + `assets/index-<hash>.js` (715 KB, **203 KB gzip**) +
`assets/index-<hash>.css` (116 KB, 26 KB gzip) + imagens locais (verso da carta 26 KB, DON!! 38 KB) + `public/`.

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

### Tabelas (15)

| Tabela | Chave | Conteúdo | Quem escreve |
|---|---|---|---|
| `cards` | `id` (ex. `OP01-001`) | `set_code`, `name`, `category`, **`data` (JSON `CardData`)**, `provisional` (0/1), `source`, `raw` (JSON da API), `updated_at`. Índice `cards_set`. | importador, seed, sync de spoilers |
| `card_translations` | `(card_id, lang)` | `text`, `trigger` revisados à mão | seed (de `data/translations`) |
| `decks` | `id` (`st01-luffy`, `u-xxxxxxxx`) | `name`, `leader`, **`cards` (JSON `[{id,count}]`)**, `kind` (`builtin`/`user`), `owner_hash`, `updated_at` | seed (builtin), `POST/PUT /api/decks` |
| `users` | `id` (`u-` + 12 hex) | `google_sub` (único), `email`, `name`, `picture`, `role` (`player/streamer/organizer/admin/dev`), `created_at`, `last_login_at` | login Google, admin |
| `sessions` | `token_hash` | `user_id`, `created_at`, `expires_at` (60 dias) | login/logout |
| `players` | `id` (`p-` + 12 hex) | `owner_hash` (único: `sha256(navegador)` ou `user:<id>`), `name` (público, "Pirata XXXX"), `bounty` (Beries), `ranked_games` | primeira partida/consulta, ranqueada, `PUT /api/players/me` |
| `deck_lists` | `hash` (16 hex) | `leader`, `cards` (JSON) — lista **exata** e imutável usada numa partida | gravação de partida |
| `matches` | `id` autoincrement | `seed`, `mode`, `deck0`, `deck1`, `winner`, `turns`, `reason`, `format`, `queue`, `first_player`, **`replay` (JSON)**, `created_at` | gravação de partida |
| `match_seats` | `(match_id, seat)` | tabela de **fatos** das estatísticas (uma linha por lado): `controller`, `player_id`, `deck_id`, `deck_hash`, `leader`, `opp_leader`, `opp_controller`, `tier`, `bounty_before/after`, `went_first`, `won`, `mulligan`, `format`, `queue`, `played_at`. Índices `seats_dims`, `seats_matchup`, `seats_player`. | gravação de partida |
| `match_cards` | `(match_id, seat, card_id)` `WITHOUT ROWID` | `copies`, `opening`, `drawn`, `played` por carta do deck. Índice `match_cards_card`. | gravação de partida |
| `live_matches` | `id` (sala) | **`data` (JSON `RoomData`)**: tudo para refazer uma sala online após reinício | lobby (a cada ação) |
| `tournaments` | `id` (`t-` + 10 hex) | configuração, `status`, `round`, `organizer_id` | organizador |
| `tournament_players` | `(tournament_id, user_id)` | `name`, `deck_id`, **`deck` (JSON `DeckList` congelado)**, `seed`, `dropped` | inscrição, início, drop |
| `tournament_matches` | `id` autoincrement | `round`, `stage` (`swiss`/`elim`), `table_no`, `p1`, `p2` (null = bye), `best_of`, `wins1`, `wins2`, `result`, `next_first`, `room_id`, `match_id`, `reported_by` | avanço de rodada, fim de jogo online, organizador |
| `sqlite_sequence` | — | interna (autoincrement) | — |

Diagrama das relações principais:

```
users 1──n sessions            users 1──n tournaments (organizer_id)
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
| Origem e status | `cards.source` (`api:optcgapi.com`, `api:arquivo`, `fixture:<arquivo>.json`, `spoiler:<arquivo>.json`, `spoiler:feed:optcgleaks.com`), `cards.provisional` | texto / 0-1 |
| Tradução revisada | `card_translations` (`lang = 'pt'`) | texto |
| Tradução automática | **não é gravada**: calculada por `translateCardPt` a cada resposta, com cache em memória (até 20.000 entradas) | — |
| Efeito automatizado (DSL) | **não é gravado**: `buildCardDef` calcula a partir do texto (parser) ou de `CARD_SCRIPTS` em tempo de execução | — |
| Erratas e correções de fonte | código (`errata.ts`, `source-fixes.ts`), aplicadas ao ler e ao gravar (`fixCard`) | — |
| Imagem | **não é armazenada**: só a URL em `data.imageUrl`; o navegador baixa do site de origem | URL |
| Cartas provisórias (antes da primeira importação) | `data/cards/*.json` (750 cartas escritas de memória, `provisional: true`) | JSON `{set, title, provisional, note, cards: CardData[]}` |
| Tipos conhecidos | `data/card-types.json` (172) | JSON |

O que o navegador recebe (`ApiCard`, `present.ts`): `CardData` + `provisional` + `i18n.pt = {text, trigger, source}`;
com `CARD_IMAGES=off`, `imageUrl` é removido antes de sair.

### Cartas oficiais (optcgapi.com)

Fonte: `https://optcgapi.com/api` (`CARD_API_BASE`). Endpoints usados:

| Uso | URL |
|---|---|
| Starter deck | `/decks/ST-xx/` |
| Booster / extra / premium | `/sets/OP-xx/` (`EB-xx`, `PRB-xx`) |
| `--all` | `/allSetCards/`, `/allSTCards/`, `/allPromos/` |
| Sync de spoilers | `/allSets/`, `/allDecks/`, `/sets/<id>/`, `/decks/<id>/`, `/sets/card/<id>/` |

Fluxo do `npm run cards:import -- [coleções | --all | --file x.json] [--dry-run]` (`import-cards.ts`):

1. Uma requisição por fonte, **em sequência**, `fetch` nativo com `user-agent: gumgumfight-importer`. Sem retry nem
   atraso; erro HTTP aborta.
2. Monta o vocabulário de tipos (`data/card-types.json` + tipos citados nos textos).
3. `mapApiResponse` sobre **todas** as linhas de uma vez: agrupa por id (versões alternativas, reimpressões em starter
   deck), escolhe a linha primária (`card_image_id === id`), decide `power/cost/counter/life/colors/attributes` por
   maioria entre as linhas, escolhe o texto que o parser entende melhor, limpa nome (`(Parallel)`, `(025)`, `[Winner]`…),
   separa notas de errata (`notes`), `[Trigger]` (`trigger`), aliases ("Also treat this card's name as…"),
   divide tipos pelo maior tipo conhecido.
4. Ignora: DON!!, categorias desconhecidas, promos reimpressas de coleção (`set_name` com "promotion") e líderes só de
   evento (P-700/800/900). Sufixos `_r1`/`_p1` viram o número base.
5. `upsertCards(provisional: false, source: 'api:optcgapi.com', raw)` numa transação. Cartas da API **substituem**
   provisórias e spoilers; o inverso nunca acontece.

Em produção a importação roda na VPS: manualmente (`node release/server/import-cards.mjs` com o `DB_PATH`
compartilhado) ou pelo input `import_sets` do workflow (`remote-deploy.sh` chama o importador depois do deploy).

### Cartas não oficiais

**Provisórias** (`data/cards`): copiadas de memória antes de a coleção ser importada; entram a cada início
(`seed`) com `provisional = 1` e são puladas quando a carta já veio da API.

**Spoilers** (coleções ainda não lançadas; hoje EB05 e OP18, `data/spoilers/<set>.json`):

- Arquivo: `{set, title, release, feed: "optcgleaks", source, url, cards: []}`. `cards` aceita cartas escritas à mão
  (mesmo `CardData`), com prioridade sobre o feed; cartas sem id válido (`/^[A-Z]+\d*-\d+$/`), nome ou categoria são
  ignoradas e logadas.
- Feed: `https://images.optcgleaks.com/<set>/<set>.json`. Só o array `cards` é usado (`sp_cards` e `unknown_id_cards`
  ficam de fora). Mapeamento em `spoiler-feed.ts`: entidades HTML, `<br>`, `NOTE:` → `notes`, `<Blocker>` → `[Blocker]`,
  imagem `https://images.optcgleaks.com/<set>/images/<image.id>.webp`, `spoiler: {source: 'optcgleaks.com', url}`.
- `refreshSpoilerFeeds`: pula a coleção se já há cartas oficiais dela; resposta vazia/erro não apaga nada; grava com
  `provisional = 1`, `source = 'spoiler:feed:optcgleaks.com'`; `pruneSpoilers` remove as que saíram do site.
- `syncSpoilers`: pega as coleções com spoilers pendentes, procura em `/allSets/` e `/allDecks/`; se não listada, tenta
  `/sets/card/<primeiro id>/` e, achando, busca as demais uma a uma. 404 = "ainda não publicada". O que vier é
  importado como oficial (`provisional = 0`), e a etiqueta SPOILER some sem mexer nos decks (o número não muda).
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
| Treino contra o bot do servidor | servidor | o próprio servidor grava ao terminar | `bot` | `casual` |
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
  "actions": [ { "type": "mulligan", "player": 0, "redraw": false }, { "type": "playCard", "player": 0, "uid": "c7" }, ... ]
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
- **Perfis** (`users.role`): `player`, `streamer` (vê mãos ao assistir), `organizer` (cria/gerencia torneios), `admin`
  (gerencia tudo, muda perfis), `dev` (admin + telas de desenvolvimento). `ADMIN_EMAILS` promove a admin no login com
  e-mail verificado.
- **Migração do navegador para a conta** (`claimBrowserData`): no primeiro login, decks `user` do `owner_hash` do
  navegador passam para `user:<id>`; o perfil de estatísticas é fundido (partidas reapontadas, perfil do navegador
  apagado se a conta já tinha um).
- **Privacidade**: o nome da conta Google nunca aparece para outros; o nome público é o de `players.name`.

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
| `casual` / `ranked` | `POST /api/online/queue` devolve um `ticket`; o navegador consulta `GET /queue/:ticket` a cada 1,5 s; quem para de consultar por 30 s sai da fila | Pareamento por ordem de chegada, mesmo formato. Ranqueada: só conta Google, deck sem ⚙, diferença de bounty ≤ 2.000 + 400/s de espera |
| `bot` | `POST /api/online/bot` | O servidor joga o assento do bot a partir da **visão do bot** (sem espiar), com 700 ms de pausa e 800–2.000 ms aleatórios nas decisões escondidas. `ONLINE_BOT_ROOMS=off` desliga |
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

### Eventos SSE (servidor → navegador)

| Evento | Payload | Quando |
|---|---|---|
| `state` | `{room, view, defs, log: {from, entries}, lastAction}` | ao conectar e a cada ação (**todas** as conexões da sala) |
| `presence` | `{connected: [bool, bool], spectators}` | alguém conecta/desconecta |
| `emote` | `{seat, emote}` | emote de um jogador (lista fixa de 8) |
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
- `?hands=1` (**Streamer**, **Admin** e **Dev**, via `seesHands`): `extra` = as duas mãos + a carta da Vida sendo olhada. Recusado (403) para quem
  joga a própria partida. Decks e Vida virada continuam escondidos.
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
- Ações `manual`/`timeout` vindas do cliente são recusadas; `MAX_ACTIONS = 5000` por partida.

---

## 12. Torneios

### Modelo

- **`tournaments`**: `format` (`standard`/`egb`), `structure` (`swiss` | `single`), `rounds` (1–15 ou null =
  ⌈log₂ n⌉ no início), `swiss_best_of` (1 | 3), `top_cut` (2…64 | null), `bo3_from`/`bo5_from` (tamanho da fase a
  partir da qual a série é melhor de 3/5: 8 = quartas, 2 = final), `max_players` (2–256), `starts_at` (só
  informativo), `status` (`registration → running → finished`), `round`, `organizer_id`.
- **`tournament_players`**: `deck` é o `DeckList` **congelado** na inscrição (validado com `playableDeck` no formato),
  `seed` = ordem sorteada no início, `dropped`.
- **`tournament_matches`**: uma linha por série (`best_of`, `wins1`, `wins2`, `result` ∈ `p1 | p2 | bye`, nunca empate),
  `next_first` (quem perdeu começa o próximo jogo), `room_id` (sala do jogo atual), `match_id` (última partida em
  `matches`), `reported_by` (`game`, `bye`, `drop` ou id do organizador).

### Algoritmos (`tournaments/pairing.ts`)

- **Suíço**: vitória = 3 pontos; bye conta como vitória e vai para o último colocado que ainda não teve. Classificação:
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
| **Abrir salas não exige login** (o código do navegador é gerado à vontade) | `online/routes.ts` | tetos de salas por servidor e por IP (`lobby.admit`), `limit_req`/`limit_conn` no Nginx | acompanhar os 429/503 nos logs e ajustar `DEFAULT_LIMITS` |
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
| `ONLINE_BOT_ROOMS` | `on` | treino online contra o bot do servidor |
| `ONLINE_MAX_ROOMS` / `ONLINE_MAX_BOT_ROOMS` | `400` / `10` | tetos de salas ativas (todas / treino contra o bot) |
| `PM2_MAX_MEMORY` | `1500M` | só em `shared/deploy.env` da VM: memória em que o pm2 reinicia o app |
| `NODE_ENV` | — | `production` desliga a leitura do `.env`; `test` desliga o sync |

### B. Rotas da API

| Área | Rotas |
|---|---|
| Saúde/config | `GET /api/health`, `GET /api/config` |
| Conta | `GET /api/auth/me`, `POST /api/auth/google`, `POST /api/auth/logout`, `GET /api/admin/users?q=`, `PUT /api/admin/users/:id/role` |
| Cartas | `GET /api/cards?set=`, `GET /api/cards/:id`, `GET /api/coverage`, `GET /api/translations/pending` |
| Decks | `GET /api/decks`, `GET/PUT/DELETE /api/decks/:id`, `POST /api/decks` |
| Partidas/estatísticas | `POST /api/matches`, `GET /api/matches`, `GET/PUT /api/players/me`, `GET /api/stats/meta`, `GET /api/stats`, `GET /api/stats/trend?weeks=`, `GET /api/stats/cards?leader=|deck=` |
| Online | `GET /api/online/config`, `GET /api/online/stats`, `GET /api/online/active`, `POST /api/online/rooms`, `POST /api/online/rooms/join`, `POST /api/online/queue`, `GET/DELETE /api/online/queue/:ticket`, `POST /api/online/bot`, `GET /api/online/rooms/:id/events?t=` (SSE), `POST /api/online/rooms/:id/{action,dice,emote,rematch,leave}`, `GET /api/online/rooms/:id/replay` |
| Espectador | `GET /api/online/live`, `GET /api/online/watch/:code`, `GET /api/online/rooms/:id`, `GET /api/online/rooms/:id/watch?hands=1` (SSE) |
| Torneios | `GET /api/tournaments`, `GET /api/tournaments/:id`, `POST /api/tournaments`, `PUT/DELETE /api/tournaments/:id`, `POST/DELETE /api/tournaments/:id/register`, `POST /api/tournaments/:id/{start,next,finish}`, `PUT /api/tournaments/:id/matches/:m/result`, `POST /api/tournaments/:id/players/:userId/drop`, `POST /api/tournaments/:id/matches/:m/play` |

Corpos, filtros e códigos de erro estão descritos no `README.md` (seção "API").

### C. Comandos

```bash
npm install && npm run dev                 # API em :3001 e Vite em :5173
npm run typecheck && npm test              # tipos; testes do motor (com 200 partidas bot x bot) e do servidor
npm run cards:import -- ST-01 OP-01        # importar coleções da optcgapi
npm run cards:import -- --all              # tudo
npm run cards:import -- --spoilers         # buscar spoilers e trocar por oficiais
npm run db:seed                            # reaplicar decks prontos / cartas provisórias / traduções
npm run translations:check -w @gumgum/server
npm run cards:check-official -w @gumgum/server
npm run simulate -w @gumgum/engine -- 500  # N partidas bot x bot
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
   header `x-deck-owner` único por sala), lê o SSE `/rooms/:id/events?t=<token>` com `fetch`, joga o assento humano
   com `chooseBotAction` do `@gumgum/engine` sobre a visão recebida (`POST /action {t, seq: view.actionCount, action}`)
   e abre K leitores de `/rooms/:id/watch` por sala; soma `byteLength` dos chunks e lê `VmRSS` de `/proc/<pid>/status`
   e `utime+stime` de `/proc/<pid>/stat` antes e depois.
4. Para o custo do upload de replay, gerar uma partida bot x bot local com `createGame`/`applyAction` e enviar em
   `POST /api/matches`.
