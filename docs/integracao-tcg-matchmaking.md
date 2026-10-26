# Plano: meta global do TCG Matchmaking nas Estatísticas

> Status: **plano**, nada implementado ainda. Escrito em 26/10/2026 a partir da conversa com o Matheus
> (criador da API), da documentação dela (`https://optcg-api.vercel.app/docs`, OpenAPI 3.0.3, "OPTCG Logpose
> API") e do código atual. A seção 2 lista o que ainda falta confirmar.

## 1. O que é e por que vale a pena

O **TCG Matchmaking** é a fila ranqueada por Discord usada pelo OPTCGSim: hoje é a maior fonte de partidas
online do jogo no mundo (é o "ranked sim data" que sites como onepiece.gg e Shonen TCG citam nos tier lists).
O Matheus mantém a **OPTCG Logpose API** (`optcg-api.vercel.app`), que publica as estatísticas de Líderes dessas
filas, e liberou uma chave para o GumGum Fight.

Para nós, isso resolve o maior limite das nossas estatísticas: **amostra**. Um Líder novo leva semanas para ter
partidas suficientes aqui; no TCG Matchmaking já tem centenas no primeiro fim de semana. A ideia não é trocar
as nossas estatísticas pelas deles (as nossas têm coisas que eles não têm: cartas, mão inicial, replays), e sim
colocar as duas lado a lado:

- **Meta global** como uma visão a mais na tela 📈 Estatísticas (ao lado de "Geral" e "Pro"), com Líderes e
  matchups (inclusive por quem começou, que o JSON deles traz).
- **Comparar**: o mesmo Líder aqui e lá (participação e taxa de vitória), para mostrar onde o nosso meta diverge
  do mundial, o que é um conteúdo que ninguém mais tem.
- **Tendência global** calculada por nós, guardando um instantâneo por dia do JSON deles (a API entrega só a
  foto atual).

## 2. A API (confirmado na documentação)

Autenticação: **dois headers obrigatórios em toda rota**, `x-client-name` (nome do cliente que o Matheus
cadastrou) e `x-api-key`. Sem eles: `401 {"error":"Unauthorized"}`.

| Rota | Resposta |
|---|---|
| `GET /health` | `{ status: "ok" }` (serve para conferir a chave ao subir) |
| `GET /stats` | `{ queues: [{ key, name }] }` |
| `GET /stats/{queue}` | `{ queue, url, urlExpiresAt, lastModified }`: **URL assinada, válida por 1 hora**, do JSON no Cloudinary. `400` fila inválida, `503` Cloudinary fora |

O JSON da fila é uma **lista de `LeaderStat`**:

```
leader              string   identificador do Líder (ver "falta confirmar")
leaderName          string   nome para exibir
wins                int
number_of_matches   int      partidas do Líder
total_matches       int      partidas da fila inteira
raw_win_rate        number   wins / number_of_matches
play_rate           number   number_of_matches / total_matches
weighted_win_rate   number   taxa ponderada (critério deles)
first_win_rate      number   taxa quando começou
second_win_rate     number   taxa quando foi segundo
matchups[]          { opponent, wins, total_games, matchup_win_rate,
                      first_wins, first_games, first_win_rate,
                      second_wins, second_games, second_win_rate }
```

As 7 filas de hoje (o `enum` está fixo na documentação, então novas filas exigem redeploy dele; o nosso lado
lê a lista em tempo de execução e aceita qualquer `key`):

| `key` | `name` | Leitura | Formato nosso (aba Comparar) |
|---|---|---|---|
| `lw` | LW Standard | temporada atual, todo mundo | Standard |
| `lw_eastern` | LW Extra Regulation | temporada atual, Extra Regulation (= nosso EGB) | EGB |
| `LWS1BillionBounty` | LW Standard 1Billion | Standard, só jogadores com recompensa ≥ 1 bilhão | Standard (nota: "jogadores acima de 1 bi") |
| `LWS2BillionBounty` | LW Standard 2Billion | idem, ≥ 2 bilhões | Standard (nota) |
| `Special_Queue` | Special Queue | fila especial (evento?) | nenhum |
| `OP17` | OP17 | temporada anterior? | Standard (histórico) |
| `OP17-1BillionBounty` | OP17 1Billion | idem, ≥ 1 bilhão | Standard (histórico) |

A fila tem papel parecido com os nossos **tiers** (faixa de recompensa): as filas "Billion" são o meta dos
jogadores mais fortes, que é o que a Pro mostra com o filtro por faixa.

**Falta confirmar** (com a chave em mãos, basta um `curl` em `/stats/lw` e abrir a URL):

1. O que vem em `leader`: id de carta (`OP05-060`), id interno do OPTCGSim ou um nome. `leaderName` existe
   separado, então `leader` deve ser um id. O mapeamento (seção 4) tenta id primeiro e nome depois, mas saber
   o formato evita surpresas com os mais de dez Luffys.
2. O `x-client-name` que o Matheus cadastrou para a nossa chave (provavelmente `gumgumfight`).
3. O que significa "LW" (temporada atual?) e o que é a Special Queue, para os rótulos e para saber quais filas
   mostrar por padrão.
4. Com que frequência o JSON muda (`lastModified` responde isso sozinho depois de alguns dias) e se 6 h entre
   buscas está bom para ele.
5. Texto de crédito que ele quer na tela (sugestão: "Dados do TCG Matchmaking, via OPTCG Logpose API").

**A chave:** está num PrivateBin (senha `gumgum`). Não abrir pelo agente nem colar no repositório: o paste pode
ser "queimar depois de ler", e a chave é segredo. Ela vai para `shared/deploy.env` na VPS (como
`APOIASE_API_SECRET`) e para o `.env` local, que já está no `.gitignore`.

## 3. Onde entra na interface

A tela 📈 Estatísticas (`apps/web/src/components/Stats.tsx`) já tem um seletor de escopo **Geral | Pro**
(`stats-scope`, só aparece quando o apoio está configurado) e, abaixo, as abas **Líderes | Matchups |
Tendência | Cartas**. Proposta:

1. **Terceiro escopo: 🌍 Global** ("TCG Matchmaking"). O seletor passa a aparecer sempre que o servidor
   informar que o global está ligado (`StatsMeta.global`), mesmo sem o apoio configurado. Escolhi escopo, e
   não uma quinta aba, porque os filtros mudam: no Global não existem oponente bot, faixa, "só as minhas"
   nem período (a API entrega uma foto); existe a **fila**.
2. **Filtros do Global:** só **Fila** (lista vinda da API, com os `name` deles; lembrada em `localStorage`
   como os outros filtros, padrão `lw`) e **Mínimo de partidas** (o mesmo `min` de hoje).
3. **Abas do Global** (reaproveitando os componentes de hoje):
   - **Líderes**: `LeadersTable` recebe um `StatsOverview`; basta converter a lista deles para esse formato.
     `firstGames`/`firstWins` por Líder saem da soma dos matchups (`first_games`/`first_wins`). `lists` fica 0.
     A `weighted_win_rate` deles pode ir num tooltip ("ponderada: 52,1%").
   - **Matchups**: `Matchups`, com a matriz e a taxa de quem começou, direto de `matchups[]`.
   - **Tendência**: `Trend` sobre os nossos instantâneos diários (só faz sentido depois de ~2 semanas de
     coleta; antes mostra "ainda coletando").
   - **Comparar** (nova): tabela Líder · participação aqui · participação global · taxa aqui · taxa global ·
     Δ em pp, para a fila escolhida e o formato da tabela da seção 2. "Aqui" usa o escopo que a pessoa pode
     ver (Geral, ou Pro se tiver o plano). Fila sem formato (Special Queue) não tem a aba.
4. **Rodapé de crédito** na tela: "Dados do TCG Matchmaking (LW Standard), atualizados em DD/MM HH:MM
   (`lastModified`). API: OPTCG Logpose, do Matheus." Com link se ele quiser.
5. **Cartas** não existe no Global (os dados deles são por Líder).

Fora da tela de Estatísticas, nada muda nesta primeira versão. Ideias para depois: uma linha "no mundo"
no bloco Meta da tela inicial (`HomeBlocks.tsx`, `MetaBlock`) e o meta global como referência no Coach.

**Pro ou aberto?** Sugiro **aberto** (não exige plano): é dado público de outra comunidade e atrai gente; o
que é nosso e caro de produzir (ranqueada, torneios, cartas) continua Pro. Fácil de mudar depois: é um
`scope` a mais no `proGate`.

## 4. Arquitetura

O navegador **nunca** fala com a API do Matheus: a chave ficaria exposta, teria CORS e cada visitante
gastaria o limite dele. O servidor busca, guarda e serve, no mesmo padrão do sync de spoilers
(`spoiler-sync.ts`) e do cache de respostas (`cache.ts`).

```
Logpose API ──(sync a cada N h: /stats, /stats/{fila}, URL assinada)──▶ servidor ──▶ global_stats_snapshots
                                                                                            │
   navegador ◀──(GET /api/stats/global, cache + ETag)───────────────────────────────────────┘
```

### Servidor (`apps/server/src/stats/global.ts` + rotas em `stats/routes.ts`)

- **Config** (`config.ts`, `README.md`, `deploy/ecosystem.config.cjs`):
  - `GLOBAL_STATS_API_KEY`: chave; vazia = recurso desligado (some o escopo na interface).
  - `GLOBAL_STATS_CLIENT`: o `x-client-name` cadastrado (padrão `gumgumfight`).
  - `GLOBAL_STATS_API_URL`: padrão `https://optcg-api.vercel.app`.
  - `GLOBAL_STATS_SYNC`: horas entre buscas (padrão 6, como `SPOILER_SYNC`; `off` desliga o sync).
- **Cliente** (`fetchQueues`, `fetchQueueStats`): `fetch` com os dois headers, `AbortSignal.timeout(10_000)`
  e `fetchImpl` injetável para os testes (como `support/apoiase.ts`). Faz os dois saltos (`/stats/{fila}` →
  baixa a URL assinada na hora; a URL **nunca é guardada**, vence em 1 h). `401` vira log "chave inválida"
  uma vez por sync, sem repetir a cada fila. Falha nunca derruba o servidor.
- **Adaptador** (`normalizeQueueStats(list) → GlobalQueueStats`): converte `LeaderStat[]` para o formato
  das nossas tabelas: por Líder `{ leader, label, games, wins, firstGames, firstWins, weightedRate }` e
  matchups `{ leader, oppLeader, games, wins, firstGames, firstWins }`. Tolerante a campo faltando (vira 0).
  Guarda `unmapped: string[]` (Líderes que não conseguimos mapear) para o log.
- **Mapeamento `leader`/`opponent` → id de carta**:
  1. se o texto já é um id (`/^[A-Z]+\d*-\d{3}$/`), usa direto, normalizando com `normalizeSetId`;
  2. senão, procura `leaderName` entre os Líderes do banco (`listCards` filtrando `category = 'leader'`,
     comparando nome e `aliases` sem acento/caixa) e desempata pela coleção se o texto trouxer uma;
  3. sem mapeamento: a linha fica com `leaderName` como rótulo, sem arte, e entra em `unmapped`.
- **Persistência**: tabela nova `global_stats_snapshots (queue TEXT, day TEXT, fetched_at TEXT,
  last_modified TEXT, body TEXT, PRIMARY KEY (queue, day))`: um instantâneo por fila e por dia (o sync do
  mesmo dia sobrescreve). Se `lastModified` não mudou desde o último instantâneo, o sync **não baixa o JSON**
  de novo (só regrava a data). Serve a três coisas: sobreviver a reinício e a queda da API (mostra o último
  com aviso "dados de DD/MM"), calcular a **Tendência** nossa, e não depender da URL temporária.
- **Rotas** (públicas, `scope: 'stats:read'`, servidas por `ResponseCache` com ETag como as outras):
  - `GET /api/stats/meta` ganha `global: { queues: [{ key, name, format }], updatedAt } | null`.
  - `GET /api/stats/global?queue=`: `{ queue, lastModified, stale, summary, leaders, matchups, cards }`,
    no formato de `StatsOverview` para reaproveitar as tabelas.
  - `GET /api/stats/global/trend?queue=&weeks=`: mesmo formato de `TrendResponse`, a partir dos
    instantâneos (participação semanal = média dos dias da semana).
  - `GET /api/stats/global/compare?queue=&format=`: junta `leaderStats` (nosso, com o filtro do viewer) e
    o instantâneo, por Líder.
- **Sync**: `scheduleGlobalStatsSync(db, opts)` em `index.ts`, 20 s depois de subir e a cada
  `GLOBAL_STATS_SYNC` horas: `/health` (loga se a chave falhou), `/stats` (filas), e para cada fila
  `/stats/{fila}` + download. Depois de gravar chama `dataVersion.bump()` para invalidar o cache.
- **Nenhuma chamada à API no caminho de uma requisição**: as rotas só leem o banco. Se ainda não houve
  sync, respondem `{ stale: true, leaders: [] }` e a tela mostra "coletando".

### Interface (`apps/web`)

- `api.ts`: tipos `GlobalStats`, `GlobalCompareRow`; funções `api.globalStats(queue)`,
  `api.globalTrend(queue, weeks)`, `api.globalCompare(queue, format)`; `StatsMeta.global`.
- `Stats.tsx`: `Scope = 'general' | 'pro' | 'global'`; estado `queue`; quando `scope === 'global'`, o bloco
  de filtros mostra só Fila e Mínimo, as abas são Líderes / Matchups / Tendência / Comparar (esta só com
  formato), e o rodapé de crédito. `LeadersTable`, `Matchups` e `Trend` são reutilizados sem mudança;
  `CompareTable` é novo (ordenável, com `SortableTable` que já existe).
- i18n: chaves `stats.scopeGlobal`, `stats.scopeGlobalSub`, `stats.filterQueueGlobal`, `stats.tabCompare`,
  `stats.globalCredit`, `stats.globalStale`, `stats.globalCollecting`, `stats.weightedRate`,
  `stats.compare*` nos 6 idiomas (`pt-BR.ts` é a fonte das chaves; os outros têm as mesmas chaves). Os nomes
  das filas ficam como a API manda (em inglês).
- CSS: nada novo além de uma classe para a coluna Δ (verde/vermelho), reaproveitando `.stat-table`.

### Testes

- `apps/server/test/global-stats.test.ts`: cliente com `fetchImpl` falso (`/stats` → `/stats/lw` → URL →
  JSON), 401 sem derrubar o sync, adaptador com um `LeaderStat` completo e um sem matchups, mapeamento por
  id e por nome (com um nome desconhecido), `lastModified` igual pulando o download, snapshot do mesmo dia
  sobrescrevendo, trend a partir de 3 dias, rotas com e sem chave, resposta `stale` quando a busca falha
  depois de um sync bom.
- `apps/web`: a conversão para `StatsOverview` e a montagem da tabela Comparar (funções puras).

### Documentação

- `README.md`: seção Estatísticas (parágrafo "Meta global"), tabela de variáveis, tabela de rotas públicas.
- `docs/documentacao-tecnica.md`: módulo em "Módulos e rotas", tabela nova (27 → 28 tabelas), linha em
  "Dependências externas em tempo de execução" (`optcg-api.vercel.app` e o Cloudinary: meta global; se cair,
  a aba mostra o último instantâneo com aviso) e Apêndice B.

## 5. Riscos e decisões

- **Identificação dos Líderes**: com `leader` e `leaderName` separados o risco caiu, mas até ver um JSON real
  não dá para garantir que `leader` é id de carta. O mapeamento por nome é o plano B, e os não mapeados vão
  para o log.
- **Enum fixo de filas** na API: fila nova exige redeploy do lado dele; o nosso lado não quebra (lê a lista e
  aceita qualquer `key`; fila sem formato conhecido só perde a aba Comparar).
- **Filas "Billion"** comparadas com o nosso Geral misturam públicos diferentes; a aba Comparar mostra uma
  nota quando a fila é restrita por recompensa. Com o plano, comparar com a Pro filtrada por faixa fica mais
  honesto.
- **Dependência de terceiro**: tudo é opcional e desligado sem a chave; com a API fora, a tela continua
  com o último instantâneo e um aviso. Nenhuma outra parte do site depende disso.
- **Crédito e combinado**: confirmar com o Matheus o texto do crédito, o intervalo de busca (6 h) e se a
  chave pode ficar na homologação também (senão, só produção).

## 6. Ordem de implementação

1. Com a chave: `curl` em `/health`, `/stats` e `/stats/lw`, abrir a URL e guardar o JSON como fixture de
   teste (`apps/server/test/fixtures/logpose-lw.json`, cortado a uns 5 Líderes). Fecha os itens 1 e 2 da
   seção 2.
2. Servidor: config + cliente + adaptador + tabela + sync + `GET /api/stats/global` (+ `meta.global`),
   com testes. Dá para validar com `curl` antes de mexer na interface.
3. Interface: escopo Global com fila, Líderes e Matchups, crédito e estado "coletando/desatualizado".
4. Tendência (rota + aba) e Comparar (rota + aba).
5. README, documentação técnica, chave no `deploy.env` da produção e um sync manual para conferir.

Passos 2 e 3 são a primeira versão útil; 4 pode entrar numa segunda leva depois que houver alguns dias
de instantâneos.
