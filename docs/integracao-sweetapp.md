# Integração SweetApp (SA) ↔ GumGum Fight (GGF)

> Status: **arquitetura definida e primeira entrega implementada** (30/10/2026). O que já existe e o que falta
> está na seção 6. O que vale para o uso do dia a dia está no README ("API para parceiros", "Cadeia de fontes",
> "CDN própria") e na documentação técnica; este arquivo é o desenho e as decisões.

## 1. O que as duas plataformas querem

| Pedido | Resposta curta |
|---|---|
| O SA já tem rotas para o GGF consultar as cartas | Entram como **mais uma fonte** da importação do GGF (`CARD_SOURCES`/`SPOILER_SOURCES`), não como consulta em tempo real. Adaptador: `apps/server/src/card-sources/sweetapp.ts`. |
| Mostrar os torneios do GGF na tela do SA | **Feed público** `GET /api/partners/tournaments` (lista) e `/api/partners/tournaments/:id` (detalhe), com CORS, ETag e link para a inscrição no site. Código: `apps/server/src/partners/tournaments.ts`. |
| Um lugar só para as cartas, sem depender de API externa | O importador do GGF já é o "scraper que unifica" (cadeia de fontes com correções). O resultado agora é **publicado no Cloudflare R2** (`cards/v1/manifest.json` + um arquivo por coleção), ao lado das imagens que já estavam lá. As duas plataformas leem dali. Código: `apps/server/src/card-cdn/data.ts`. |

O que já existia e continua valendo: tokens pessoais e OAuth para apps agirem em nome do usuário (decks, partidas,
estatísticas), webhook "partida terminada", replay embutido em iframe e a CDN das imagens com `index.json`
(README, "API para parceiros" e "CDN própria das imagens").

## 2. Desenho

```
   optcgapi.com      optcgleaks.com     cardkaizoku.com     API do SweetApp
   (oficial)         (spoilers)         (as duas)           (cartas do SA)
        │                 │                  │                    │
        └────────┬────────┴──────────────────┴────────────────────┘
                 ▼
     Importador do GGF (card-sources/chain.ts)
     · uma fonte por prioridade (CARD_SOURCES / SPOILER_SOURCES)
     · campo vazio completado pela fonte seguinte; campos "fracos" de uma fonte vêm da seguinte
     · texto só muda se o leitor de efeitos entende pelo menos tanto quanto
     · erratas e correções (fixCard), tradução PT (manual ou automática)
     · relatório de divergências (card-source-diff.json)
                 │
                 ▼
     SQLite do GGF (cards)  ──────────────► Cloudflare R2 (CARD_CDN_URL)
                 │                           · <coleção>/<idioma>/<arte>.png   imagens (já existia)
                 │                           · index.json                       número -> imagens (já existia)
                 │                           · cards/v1/manifest.json           coleções, hash, ?v=
                 │                           · cards/v1/sets/<coleção>.json     cartas unificadas (PartnerCard)
                 ▼                                      │
     GGF (jogo, construtor, torneios)                   ▼
                 │                           SweetApp (lê a CDN; sem token, sem limite por token,
                 ▼                           cache do Cloudflare na frente)
     GET /api/partners/tournaments  ───────► SweetApp (mostra os torneios, linka a inscrição)
```

Decisões:

1. **O GGF é o unificador, o R2 é o ponto único de leitura.** A cadeia de fontes já resolve "usar a melhor
   informação de cada lugar" (por carta e por campo, com relatório de divergências). Não vale criar um segundo
   unificador no SA nem um Worker no Cloudflare: o custo seria duplicar regras que já existem (erratas,
   separação de tipos, `[Trigger]`, aliases, imagens oficiais da Bandai). O Cloudflare entra como **armazenamento
   + cache** (R2 com domínio próprio), não como código.
2. **O SA entra como fonte, não como dependência de tempo de execução.** Se a API do SA cair, a importação pula
   a fonte com aviso e segue com as outras (comportamento já existente para qualquer fonte). Em tempo de jogo o
   GGF só usa o próprio banco; o SA só usa o R2.
3. **Arquivos estáticos em vez de API para as cartas.** Cartas mudam poucas vezes por dia (importação, rodada de
   spoilers a cada `SPOILER_SYNC` horas). Um JSON por coleção com hash no manifesto deixa o SA baixar só o que
   mudou, com cache de 5 min no Cloudflare e sem bater na VPS. Nada de rate limit, token ou CORS para resolver.
4. **Torneios por API, não por arquivo.** Inscrições e rodadas mudam a cada minuto; a lista tem cache de 30 s e o
   detalhe de 10 s no servidor (invalidado a cada gravação), com ETag para o SA revalidar barato. É público (os
   mesmos dados da página do torneio) e tem CORS aberto: o SA pode chamar do navegador ou do backend.
5. **Contratos versionados.** `schemaVersion: 1` nos arquivos de cartas e no feed de torneios. Campo novo entra sem
   mudar a versão; campo que muda de nome ou tipo vira `v2` (outro caminho, `cards/v2/`), com o `v1` mantido por um
   tempo combinado.

## 3. Cartas na CDN (contrato v1)

Endereços (base `CARD_CDN_URL`, hoje `https://cards.gumgumfight.cloud`):

| Arquivo | Conteúdo | Cache |
|---|---|---|
| `cards/v1/manifest.json` | `{ schemaVersion, generatedAt, images, cards, sets: { <coleção>: { url, cards, spoiler, hash, updatedAt } } }` | 5 min |
| `cards/v1/sets/<coleção>.json` | `{ schemaVersion, set, cards: PartnerCard[] }` (ex.: `OP01`, `ST01`, `EB05`, `P`) | 5 min (o `?v=<hash>` do manifesto muda quando o arquivo muda) |
| `index.json` | número da carta → imagens já na CDN (já existia, `schemaVersion: 1`) | 5 min |

`PartnerCard` (`apps/server/src/card-cdn/data.ts`):

```
id            "OP01-016"               number único (sem sufixo de arte)
name          "Nami"
category      leader | character | event | stage
colors        ["blue"]                 red, green, blue, purple, black, yellow
cost / life / power / counter          números; só os que a categoria tem
attributes    ["Special"]              Strike, Slash, Ranged, Special, Wisdom
types         ["Straw Hat Crew"]       já separados (o importador divide "Heart Pirates Supernovas")
text          texto do efeito em inglês (o oficial, com erratas aplicadas)
trigger       texto do [Trigger], sem a etiqueta (ausente = sem trigger)
set           "OP01"
rarity        "C"
image         URL da imagem principal (na CDN quando já copiada; senão, na fonte)
imageLang     "jp" quando a imagem não é a inglesa
arts          [{ id: "OP01-016_p1", image, label: "Parallel" }]
notes         observações da fonte (errata, reimpressão)
aliases       "Also treat this card's name as [X]"
i18n.pt       { text, trigger?, source: manual | auto | partial }
status        official | spoiler | provisional
source        fonte vencedora ("api:optcgapi.com", "api:sweetapp.com.br", "spoiler:feed:optcgleaks.com")
spoiler       { source, url } quando status = spoiler
updatedAt     última gravação no banco (ISO 8601, UTC)
```

Como o SA consome:

1. Baixa o `manifest.json` (de hora em hora basta; 5 min é o mínimo útil).
2. Para cada coleção cujo `hash` mudou desde a última vez, baixa `sets[<coleção>].url` (já vem com `?v=`).
3. Para as imagens, usa `image`/`arts[].image` direto (a CDN tem CORS para as origens do SA; ver README, "CDN
   própria", passo 3). Carta sem `image` (promo japonesa só no Cardkaizoku, por exemplo) o SA desenha em HTML, como
   o GGF faz.

Quando é publicado: no fim de toda rodada da CDN, isto é, em cada `npm run cards:import` (inclusive `--images`),
em cada rodada da sincronização dos spoilers e em `cards:import -- --spoilers`. Só os arquivos cujo conteúdo mudou
são reenviados (tabela `cdn_published`); o `generatedAt` fica fora do hash.

## 4. SA como fonte de cartas

`SWEETAPP_CARDS_URL` liga o adaptador; `CARD_SOURCES`/`SPOILER_SOURCES` dizem a posição dele na cadeia. Exemplo
para "SA corrige o que a optcgapi erra, mas a optcgapi decide o que já foi lançado":

```bash
SWEETAPP_CARDS_URL=https://api.sweetapp.com.br/optcg/cards?set={set}   # ou um endereço que devolva tudo
SWEETAPP_API_KEY=…                                                      # opcional (header x-api-key)
CARD_SOURCES=sweetapp,optcgapi
SPOILER_SOURCES=sweetapp,optcgleaks
```

O adaptador aceita lista pura ou `{ cards | data | items | results: [...] }`, paginação por `next`/`nextPage`/
`links.next`, e os campos com nomes em inglês ou português (tabela `FIELDS` em `sweetapp.ts`). Como fonte oficial,
ele é tratado como fonte que **mistura lançadas e anunciadas** (igual ao Cardkaizoku): só entram as coleções que
outra fonte oficial ou o banco confirmam e as promos marcadas `released`; o resto vai pela cadeia de spoilers.

Antes de ligar em produção: `CARD_SOURCES=sweetapp,optcgapi npm run cards:import -- --dry-run OP-01` e ler o
relatório (cartas por fonte vencedora, campos completados, divergências; detalhe em `card-source-diff.json`). Se o
SA errar algum campo com frequência, ele ganha `weakFields` como o Cardkaizoku, sem mexer no resto.

**O que falta combinar com o SA** (o adaptador foi escrito para o contrato acima; qualquer uma destas respostas
pode exigir um ajuste pequeno no mapeamento, nunca na arquitetura):

- Endereço exato, forma de autenticar (header e nome) e se há limite de requisições.
- Uma carta de exemplo de cada categoria em JSON (Líder, Personagem, Evento, Stage) e uma promo.
- **Idioma do texto do efeito.** O motor do GGF lê o texto **em inglês**; se o SA só tiver português, o texto dele
  não entra como `text` (ficaria como fonte só dos outros campos). Nesse caso a oportunidade é outra: o texto PT
  do SA virar **tradução revisada** (`card_translations`, `source: manual`), que hoje é feita à mão no GGF. É uma
  segunda etapa (ver seção 6).
- Se a API traz coleções anunciadas (spoilers) e como marca o que já foi lançado.
- Imagens: se as URLs são públicas e permitem hotlink; senão, ficam de fora (como as do Cardkaizoku) e a carta usa
  a imagem da fonte seguinte ou a oficial da Bandai.

## 5. Torneios no SA (contrato v1)

`GET https://gumgumfight.app/api/partners/tournaments?status=registration,running&format=standard&limit=50`

```
{ schemaVersion: 1, generatedAt, site: "https://gumgumfight.app",
  tournaments: [{
    id, name, description, url,                 url = página do torneio no site (inscrição, lobby, resultado)
    format (standard | egb | free), spoilers, spoilerSet,
    structure (swiss | single), swissBestOf, topCut,
    status (registration | running | finished), round, totalRounds (null nas inscrições),
    players, maxPlayers, startsAt, checkIn, checkInOpensAt,
    organizer: { name }, official, prize, sponsor: { id, name, url, offer } | null, priorityUntil,
    createdAt, startedAt, finishedAt,
    champion: { name, leader: { id, name, colors, image } } | null   (só encerrados)
  }] }
```

`GET /api/partners/tournaments/:id` devolve o mesmo resumo mais `standings[]` (`rank, name, points, wins, losses,
byes, omw, dropped, leader`) e `rounds[]` (`round, stage, label, bestOf, matches[] { table, p1 { name }, p2 { name } |
null, result, wins }`). Nas inscrições, `standings` e `rounds` vêm vazios e nenhum Líder aparece (a regra do site:
o Líder de cada um aparece quando o torneio começa; as listas de deck nunca saem por aqui).

Regras: público, sem token (um `Authorization: Bearer` recebe 403, como nas outras rotas sem `config.scope`),
`Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=30` (lista) / `10` (detalhe), ETag e 304. `status`
aceita vários separados por vírgula; `limit` até 200. Erros no formato de sempre (`{ error, errorCode }`), também
com CORS. Sugestão para o SA: consultar a lista a cada 60 s com `If-None-Match` e abrir o detalhe só na tela do
torneio.

## 6. Etapas

| # | Etapa | Situação |
|---|---|---|
| 1 | Feed de torneios para parceiros (`/api/partners/tournaments`) | **feito** (com testes: `apps/server/test/partner-tournaments.test.ts`) |
| 2 | Dados das cartas no R2 (`cards/v1/`) publicados em toda rodada da CDN | **feito** (`card-cdn/data.ts`; testes em `card-cdn.test.ts`) |
| 3 | Adaptador do SA na cadeia de fontes (`sweetapp`) | **feito** no contrato tolerante acima; **falta** ligar com o endereço real e validar com `--dry-run` |
| 4 | SA passa a ler as cartas do R2 (manifest + coleções) | SA: trocar a origem; GGF: liberar a origem do SA no CORS do bucket (README, passo 3) |
| 5 | Texto PT do SA como tradução revisada do GGF (`card_translations`) | depois de confirmar o idioma da API (seção 4) |
| 6 | Webhook de torneio (`tournament.created/started/finished`) para o SA não precisar consultar | só se o polling de 60 s não bastar; reaproveita `partners/webhook.ts` |
| 7 | Primeira carga da CDN em produção (`cards:import -- --images`) já publica o `cards/v1/` | operação: "Run workflow" com `--images` |

Riscos e limites:

- **Termos de uso.** O Cardkaizoku pede autorização por escrito para reproduzir o conteúdo; cartas cuja fonte
  vencedora é ele saem no `cards/v1/` com `source: api:cardkaizoku.com`. Antes de o SA consumir, ou se pede a
  autorização, ou a cadeia em produção fica sem ele (hoje já é o padrão: `optcgapi` e `optcgleaks`).
- **Tamanho.** ~5 mil cartas ≈ 6 MB no total, ~300 KB por coleção grande; o R2 cobra por operação, não por
  banda de saída, e os arquivos só são reenviados quando mudam.
- **Nomes dos jogadores** no feed de torneios são os apelidos públicos (os mesmos da página do torneio e do
  "Assistir"); nunca e-mail, foto do Google ou id de conta.
