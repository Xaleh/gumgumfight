# Plano: meta global do TCG Matchmaking nas Estatísticas

> Status: **plano**, nada implementado ainda. Escrito em 26/10/2026 a partir da conversa com o Matheus
> (criador da API) e do código atual. A API (`https://optcg-api.vercel.app/docs`) não pôde ser aberta do
> ambiente onde este plano foi escrito, então a seção 2 lista o que ainda precisa ser confirmado nela.

## 1. O que é e por que vale a pena

O **TCG Matchmaking** é a fila ranqueada por Discord usada pelo OPTCGSim: hoje é a maior fonte de partidas
online do jogo no mundo (é o "ranked sim data" que sites como onepiece.gg e Shonen TCG citam nos tier lists).
O Matheus mantém uma API (`optcg-api.vercel.app`) que publica as estatísticas dessas filas e liberou uma chave
para o GumGum Fight.

Para nós, isso resolve o maior limite das nossas estatísticas: **amostra**. Um Líder novo leva semanas para ter
partidas suficientes aqui; no TCG Matchmaking já tem centenas no primeiro fim de semana. A ideia não é trocar
as nossas estatísticas pelas deles (as nossas têm coisas que eles não têm: cartas, mão inicial, replays), e sim
colocar as duas lado a lado:

- **Meta global** como uma visão a mais na tela 📈 Estatísticas (ao lado de "Geral" e "Pro").
- **Comparar**: o mesmo Líder aqui e lá (participação e taxa de vitória), para mostrar onde o nosso meta diverge
  do mundial, o que é um conteúdo que ninguém mais tem.
- **Tendência global** calculada por nós, guardando um instantâneo por dia do JSON deles (a API entrega só a
  foto atual).

O que o Matheus descreveu:

> são basicamente 2 rotas: uma mostra a lista de filas disponíveis, e outra retorna uma URL do JSON com os
> stats daquela fila.

Ou seja: **lista de filas → URL do JSON → JSON com as estatísticas** (dois saltos, e o JSON provavelmente mora
num storage, como Vercel Blob/S3, e talvez nem exija a chave).

## 2. O que confirmar na API antes de codar

Abrir `https://optcg-api.vercel.app/docs` (Swagger) e anotar:

| Item | Por quê | Palpite até confirmar |
|---|---|---|
| Caminhos exatos das 2 rotas e o método | montar o cliente | `GET /queues` e `GET /queues/{id}/stats` |
| Como a chave vai: header (`x-api-key`? `Authorization: Bearer`?) ou query | sem isso não autentica | header `x-api-key` |
| A URL do JSON é assinada/temporária (expira?) e exige a chave? | define se guardamos a URL ou só o conteúdo | pública e temporária: baixar na hora, nunca guardar a URL |
| Formato do JSON da fila: campos por Líder (id? nome? jogos, vitórias, 1º/2º?), matchups?, período coberto?, `updatedAt`? | define o adaptador e quais abas fazem sentido | por Líder: id OPTCGSim ou nome + jogos + vitórias |
| Como o Líder é identificado (ex.: `OP05-060`, `Luffy (OP05)`, id interno do OPTCGSim) | precisamos mapear para o id de carta do nosso banco | id de carta |
| O que é uma "fila": formato (Standard/EGB), região (EN/JP), faixa de elo? | mapear fila → nosso formato para a aba Comparar | uma fila por formato e região |
| Com que frequência o JSON muda e se há limite de chamadas | escolher o intervalo do sync | muda a cada poucas horas; limite baixo |
| Texto de crédito que ele quer na tela | cortesia | "Dados do TCG Matchmaking, via API do Matheus" |

Enquanto isso não vem, o adaptador (seção 4) é escrito tolerante a nomes de campo, como já fazemos com a
optcgapi (`pick(raw, 'card_name', 'name', …)` em `apps/server/src/optcgapi.ts`).

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
2. **Filtros do Global:** só **Fila** (lista vinda da API, lembrada em `localStorage` como os outros
   filtros) e **Mínimo de partidas** (o mesmo `min` de hoje).
3. **Abas do Global** (reaproveitando os componentes de hoje):
   - **Líderes**: `LeadersTable` recebe um `StatsOverview`; basta converter o JSON deles para esse formato
     (`lists` e `firstGames` ficam 0 quando a API não tem).
   - **Matchups**: `Matchups`, só se o JSON tiver a matriz. Se não tiver, a aba não aparece.
   - **Tendência**: `Trend` sobre os nossos instantâneos diários (só faz sentido depois de ~2 semanas de
     coleta; antes mostra "ainda coletando").
   - **Comparar** (nova): tabela Líder · participação aqui · participação global · taxa aqui · taxa global ·
     Δ em pp, para a fila escolhida e o formato correspondente. "Aqui" usa o escopo que a pessoa pode ver
     (Geral, ou Pro se tiver o plano).
4. **Rodapé de crédito** na tela: "Dados do TCG Matchmaking (fila X), atualizados em DD/MM HH:MM. API:
   Matheus." Com link se ele quiser.
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
API do Matheus ──(sync a cada N h, com a chave)──▶ servidor ──▶ tabela global_stats_snapshots
                                                                      │
   navegador ◀──(GET /api/stats/global, cache + ETag)─────────────────┘
```

### Servidor (`apps/server/src/stats/global.ts` + rotas em `stats/routes.ts`)

- **Config** (`config.ts`, `README.md`, `deploy/ecosystem.config.cjs`):
  - `GLOBAL_STATS_API_KEY`: chave; vazia = recurso desligado (some o escopo na interface).
  - `GLOBAL_STATS_API_URL`: padrão `https://optcg-api.vercel.app`.
  - `GLOBAL_STATS_SYNC`: horas entre buscas (padrão 6, como `SPOILER_SYNC`; `off` desliga o sync).
- **Cliente** (`fetchQueues`, `fetchQueueStats`): `fetch` com `AbortSignal.timeout(10_000)` e `fetchImpl`
  injetável para os testes (como `support/apoiase.ts`). Segue os dois saltos (lista → URL → JSON). Falha
  vira log, nunca derruba o servidor.
- **Adaptador** (`normalizeQueueStats(raw) → GlobalQueueStats`): tolerante a nomes de campo; cada Líder
  vira `{ leader, label, games, wins, firstGames?, firstWins? }`, com matchups se existirem. Guarda também
  `unmapped: string[]` (Líderes que não conseguimos mapear) para aparecer no log.
- **Mapeamento de Líder → id de carta**:
  1. se o texto já é um id (`/^[A-Z]+\d*-\d{3}$/`), usa direto, normalizando com `normalizeSetId`;
  2. senão, procura por nome entre os Líderes do banco (`listCards` filtrando `category = 'leader'`,
     comparando nome e `aliases` sem acento/caixa) e desempata pela coleção se o texto trouxer uma;
  3. sem mapeamento: a linha fica com o rótulo bruto, sem arte, e entra em `unmapped`.
- **Persistência**: tabela nova `global_stats_snapshots (queue TEXT, day TEXT, fetched_at TEXT, body
  TEXT, PRIMARY KEY (queue, day))`: um instantâneo por fila e por dia (o sync do mesmo dia sobrescreve).
  Serve a três coisas: sobreviver a reinício e a queda da API (mostra o último com aviso "dados de
  DD/MM"), calcular a **Tendência** nossa, e não depender da URL temporária do JSON.
- **Rotas** (públicas, `scope: 'stats:read'`, servidas por `ResponseCache` com ETag como as outras):
  - `GET /api/stats/meta` ganha `global: { enabled, queues: [{id,label}], updatedAt } | null`.
  - `GET /api/stats/global?queue=`: `{ queue, fetchedAt, stale, summary, leaders, matchups?, cards }`,
    no formato de `StatsOverview` para reaproveitar as tabelas.
  - `GET /api/stats/global/trend?queue=&weeks=`: mesmo formato de `TrendResponse`, a partir dos
    instantâneos (participação semanal = média dos dias da semana).
  - `GET /api/stats/global/compare?queue=&format=`: junta `leaderStats` (nosso, com o filtro do viewer) e
    o instantâneo, por Líder.
- **Sync**: `scheduleGlobalStatsSync(db, opts)` em `index.ts`, 20 s depois de subir e a cada
  `GLOBAL_STATS_SYNC` horas; depois de gravar chama `dataVersion.bump()` para invalidar o cache.
- **Nenhuma chamada à API no caminho de uma requisição**: as rotas só leem o banco. Se ainda não houve
  sync, respondem `{ stale: true, leaders: [] }` e a tela mostra "coletando".

### Interface (`apps/web`)

- `api.ts`: tipos `GlobalStats`, `GlobalCompareRow`; funções `api.globalStats(queue)`,
  `api.globalTrend(queue, weeks)`, `api.globalCompare(queue, format)`; `StatsMeta.global`.
- `Stats.tsx`: `Scope = 'general' | 'pro' | 'global'`; estado `queue`; quando `scope === 'global'`, o bloco
  de filtros mostra só Fila e Mínimo, as abas são Líderes / Matchups (se houver) / Tendência / Comparar, e
  o rodapé de crédito. `LeadersTable`, `Matchups` e `Trend` são reutilizados sem mudança; `CompareTable` é
  novo (ordenável, com `SortableTable` que já existe).
- i18n: chaves `stats.scopeGlobal`, `stats.scopeGlobalSub`, `stats.filterQueueGlobal`, `stats.tabCompare`,
  `stats.globalCredit`, `stats.globalStale`, `stats.globalCollecting`, `stats.compare*` nos 6 idiomas
  (`pt-BR.ts` é a fonte das chaves; os outros arquivos têm as mesmas chaves).
- CSS: nada novo além de uma classe para a coluna Δ (verde/vermelho), reaproveitando `.stat-table`.

### Testes

- `apps/server/test/global-stats.test.ts`: cliente com `fetchImpl` falso (lista → URL → JSON), adaptador
  com dois formatos de campo, mapeamento por id e por nome (com um nome desconhecido), snapshot do mesmo
  dia sobrescrevendo, trend a partir de 3 dias, rotas com e sem chave, resposta `stale` quando a busca
  falha depois de um sync bom.
- `apps/web`: a conversão JSON → `StatsOverview` e a montagem da tabela Comparar (funções puras).

### Documentação

- `README.md`: seção Estatísticas (parágrafo "Meta global"), tabela de variáveis, tabela de rotas públicas.
- `docs/documentacao-tecnica.md`: módulo em "Módulos e rotas", tabela nova (27 → 28 tabelas), linha em
  "Dependências externas em tempo de execução" (`optcg-api.vercel.app`: meta global; se cair, a aba
  mostra o último instantâneo com aviso) e Apêndice B.

## 5. Riscos e decisões

- **Identificação dos Líderes** é o maior risco técnico: se a API usa nomes livres do OPTCGSim, o
  mapeamento por nome vai ter casos ambíguos (Luffy tem mais de dez Líderes). Mitigação: pedir ao Matheus
  o id de carta no JSON; enquanto não vem, mapear por nome + coleção e logar os não mapeados.
- **Filas vs formatos**: a aba Comparar só existe quando a fila casa com um formato nosso (Standard/EGB).
  Fila sem correspondência mostra só Líderes/Matchups/Tendência.
- **Dependência de terceiro**: tudo é opcional e desligado sem a chave; com a API fora, a tela continua
  com o último instantâneo e um aviso. Nenhuma outra parte do site depende disso.
- **Crédito e combinado**: confirmar com o Matheus o texto do crédito, o intervalo de busca que ele
  prefere (6 h parece seguro) e se a chave pode ficar na homologação também (senão, só produção).

## 6. Ordem de implementação

1. Confirmar a seção 2 na documentação da API (meia hora, com a chave em mãos) e ajustar os palpites.
2. Servidor: config + cliente + adaptador + tabela + sync + `GET /api/stats/global` (+ `meta.global`),
   com testes. Dá para validar com `curl` antes de mexer na interface.
3. Interface: escopo Global com fila, Líderes e Matchups, crédito e estado "coletando/desatualizado".
4. Tendência (rota + aba) e Comparar (rota + aba).
5. README, documentação técnica, chave no `deploy.env` da produção e um sync manual para conferir.

Passos 2 e 3 são a primeira versão útil; 4 pode entrar numa segunda leva depois que houver alguns dias
de instantâneos.
