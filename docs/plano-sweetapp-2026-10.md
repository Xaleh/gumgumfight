# Plano: SweetApp, fontes de cartas, escala das salas e replay embeddável (outubro de 2026)

Plano feito em 19/10/2026 a partir da conversa com o dono do SweetApp. Cada tema virou um ou mais cards na coluna
**Planejamento** do Trello (board "GumGum Fight"); este arquivo é o resumo e o lugar das decisões que não cabem num
card. Tudo o que está aqui foi conferido no código e em [`documentacao-tecnica.md`](documentacao-tecnica.md)
(seções 8, 9, 10, 11, 14, 15 e 16).

## Cards criados

| Tema | Card | Etiquetas |
|---|---|---|
| Cadeia de fontes das cartas (SweetApp → Cardkaizoku → optcgapi) | [93](https://trello.com/c/azwtkLZm) | Infra, Feature |
| Auditoria cruzada de todas as cartas contra a base do SweetApp | [94](https://trello.com/c/p6qNHa7h) | Bugs, Infra |
| Escala (épico, atualizado com drawbacks e custos) | [80](https://trello.com/c/RkXFIAHR) | Infra, Performance |
| Escala 1: fan-out compartilhado e ETag em `/api/online/live` | [95](https://trello.com/c/BHNtFN3n) | Infra, Performance |
| Escala 2: compressão ou deltas no canal SSE | [96](https://trello.com/c/ByUGEXKj) | Infra, Performance |
| Escala 3: salas frias, tetos e pm2 juntos, plano de hardware (KVM 2) | [97](https://trello.com/c/9aluEAj9) | Infra, Performance |
| Replay embeddável no SweetApp | [98](https://trello.com/c/peFO9ZPR) | Feature, Infra |
| Integração SweetApp ↔ GGF: divisão de papéis e roadmap (épico) | [99](https://trello.com/c/PRue66nS) | Feature, Community |
| Integração: decks com origem no SweetApp | [100](https://trello.com/c/BXcQgyh4) | Feature |
| Integração: webhooks, rotas e deep links novos | [101](https://trello.com/c/tlAL0jQp) | Feature, Infra |

O card [6 "API Integração SweetApp"](https://trello.com/c/yUFU9ybx) (em execução) continua sendo o da API própria
de cartas; recebeu um comentário apontando para os cards acima.

## 1. Fontes das cartas: SweetApp → Cardkaizoku → optcgapi

**Hoje.** Oficiais só da optcgapi (`apps/server/src/optcgapi.ts`, `card-import.ts`); spoilers só do optcgleaks
(`spoiler-feed.ts`), trocados pelas oficiais em `spoiler-sync.ts`. O Cardkaizoku foi descartado por erros em
counter, cor e poder (README, "Spoilers"). Correções de fonte em `packages/engine/src/source-fixes.ts` e erratas em
`errata.ts`.

**Proposta.** Uma interface `CardSource` com um adaptador por fonte e duas cadeias configuráveis por variável de
ambiente (`CARD_SOURCES` para oficiais, `SPOILER_SOURCES` para spoilers). Para cada carta vale a primeira fonte da
cadeia que a tem; só campos **vazios** são completados pela fonte seguinte, valores diferentes nunca se misturam. A
importação passa a gravar um relatório de divergências entre fontes, que alimenta a auditoria (tema 2).

**Ponto a decidir com o dono do SweetApp.** As cartas dele estão em disco local. Três formas de o GGF ler:
(a) endpoint HTTP no SweetApp com token (recomendado: o `SPOILER_SYNC` percorre a cadeia sozinho);
(b) arquivo JSON exportado e importado com `cards:import --file` (já existe; contingência);
(c) o SweetApp faz push para um `/api/internal/cards` do GGF. Também: se há texto em português revisado (vira
`card_translations` e substitui a tradução automática) e a licença das imagens.

**Risco principal.** Texto fora do padrão impresso quebra a automação do leitor (`cards/parser.ts`): medir
`GET /api/coverage` antes e depois de trocar a fonte de cada coleção.

## 2. Auditoria cruzada com a base do SweetApp

`cards:check-official` só confere nome e tipos com a lista da Bandai. O card 94 cria `cards:check-source`, que
compara campo a campo com o SweetApp e separa as diferenças em cinco grupos (texto; números, cores e atributos;
tipos e nomes; carta só de um lado; erratas). Para cada diferença de texto, o leitor roda nos dois textos e mostra se
a automação muda. Números divergentes só são aceitos conferindo a imagem da carta. O resultado vai para
`SOURCE_FIXES`/`SOURCE_TEXT_FIXES`/`errata.ts` com testes, itens DV-xx em `docs/rules/divergencias.md` quando a
leitura muda, e um relatório para o dono do SweetApp com os erros do lado dele.

## 3. Salas simultâneas: drawbacks da compressão e custos

Números medidos (seção 14): **~2 MB por sala ativa + 0,1 MB por conexão SSE**, 1,9 ms de CPU por ação mais 0,35 ms
por conexão servida, ~9,5 KB por `state` por conexão por ação. Teto atual de 400 salas (`ONLINE_MAX_ROOMS`), pm2
reinicia em 1500 MB, VPS KVM 1 (1 vCPU, 4 GB).

### O que "comprimir as salas" pode significar, e o que cada opção custa

| Opção | Ganho | Drawbacks |
|---|---|---|
| **Gzip no canal SSE** (por conexão, flush por evento) | ~70–80 % de banda | Cada compressor zlib guarda ~256 KB no padrão (100 espectadores = +25 MB); com `windowBits` 12 e `memLevel` 5, ~40–60 KB. +0,1–0,3 ms de CPU por evento por conexão. Proxy que bufferize gzip quebra o SSE. Não reduz memória por sala. |
| **Deltas do `state`** | ~80 % de banda, sem compressor | Cliente passa a depender da ordem: evento perdido exige `resync` completo (hoje cada `state` é autossuficiente). Mais código em `view.ts`, `useOnlineGame.ts`, mesa atrasada e transmissão. |
| **Salas frias** (terminadas e à espera saem da memória) | ~2 MB por sala fria | Reconectar refaz a partida com o motor (~50 ms); motor que mudou entre deploy e reconexão descarta a sala. Mais estados no sweeper. |
| **Fan-out compartilhado** (um JSON para todos os espectadores sem mãos) | 100 espectadores custam o mesmo que 1 | Nenhum funcional; não serve para quem vê mãos ou mesa atrasada. |

Ordem sugerida: fan-out e ETag (card 95), salas frias e tetos (97), compressão só quando a banda apertar (96).

### Custos novos

- Cards 95, 96 e 97: **nenhum custo de infra**, só desenvolvimento.
- Subir os tetos sem código: só até ~600 salas na KVM 1 (2 MB × salas abaixo dos 1500 MB do pm2).
- **KVM 2** (2 vCPU, 8 GB): cerca de 2× a mensalidade atual (conferir no hPanel da Hostinger). Resolve memória, não
  dobra a CPU do app (um processo Node). A meta `SUPPORT_GOAL_BRL` do "Apoiar o projeto" sobe junto.
- **Horizontal** (N processos por hash da sala, ou Redis + Postgres): semanas de refatoração e serviços novos; só
  depois do cenário D (500 partidas simultâneas).
- Banda: os 4 TB/mês da KVM 1 cobrem o cenário C (200 partidas, 500 espectadores, ~1 TB/mês).

Sinais para começar (seção 15): RSS > 300 MB sustentado, `playing` > 100 em `/api/online/stats`, CPU do Node
> 60 %, tráfego > 3 TB/mês.

## 4. Replay embeddável no SweetApp

**É possível.** O replay é um JSON refeito pelo motor (`@gumgum/engine`, sem DOM) e a mesa já tem modo sem menus
(tela de transmissão) e modo replay com a `ReplayBar`. O parceiro já baixa o replay por `GET /api/matches/:id/replay`.

**Caminho recomendado (card 98): iframe.** Rota `/replay/<matchId>?t=<token>&lang=pt-BR&embed=1` abrindo direto
no `GameScreen` em modo replay; `Content-Security-Policy: frame-ancestors` com o domínio do SweetApp só nessa rota;
o SweetApp obtém o token assinado de curta duração em `POST /api/matches/:id/replay-link` (scope `matches:read`);
`postMessage` nos dois sentidos para seek, play/pause e posição. Partidas de torneio continuam fechadas até o fim.

**Alternativa (estudo):** pacote `@gumgum/replay-player` (Web Component com motor + React + CSS). Mais integrado,
mas ~250–300 KB gzip no site deles, Shadow DOM, CORS das imagens, `CardData` e i18n empacotados.

## 5. Integração SweetApp ↔ GGF

**Já existe** (README, "API para parceiros"): OAuth 2 + PKCE, tokens pessoais, scopes `profile`, `decks:read/write`,
`matches:read`, `stats:read`; webhook `match.finished` assinado; `PUT /api/decks/:id` com `expectedUpdatedAt` (409
`deck_conflict`); partidas com `opening/drawn/played` por carta; deep link `/?deck=…`.

**Divisão proposta**

| Função | Dono | Como o outro participa |
|---|---|---|
| Jogar (bot, casual, ranqueada, privada) | GGF | SweetApp abre a partida com o deck (deep link ou deck sincronizado) |
| Torneios | GGF | SweetApp lista, inscreve (deep link) e mostra resultado e kit |
| Construção de decks | SweetApp | GGF mantém só importar lista e edição rápida |
| Estatísticas pessoais e de meta | SweetApp | GGF manda `match.finished` e os dados por carta; tela de stats do GGF vira resumo + link |
| Cartas (dados, spoilers, pt-BR) | SweetApp como fonte primária | temas 1 e 2 |
| Replay | GGF (player) | embed no SweetApp (tema 4) |
| Coleção do jogador | SweetApp | GGF mostra "você não tem X" no deck (API no sentido inverso) |

**Ideias, em ordem**

1. Deck sincronizado com origem (`origin`, `externalId`, `editUrl`): "Editar no SweetApp" no GGF, edição local
   controlada por conflito (card 100).
2. "Jogar no GGF" direto para a mesa: `/?deck=…&play=bot|casual|ranked` e `/?torneio=<id>&deck=…` (card 101).
3. Eventos novos no webhook: `tournament.registered`, `tournament.round_started`, `tournament.finished`,
   `rank.changed`, `deck.changed`; fila de entregas durável em SQLite (card 101).
4. Rotas com scope `tournaments:read` (`/api/players/me/tournaments`, `/api/tournaments…`) e `GET /api/cards` com
   ETag para o SweetApp espelhar.
5. Links cruzados configuráveis (`PARTNER_LINKS`): menu do GGF aponta para decks e estatísticas no SweetApp; o
   SweetApp aponta para "Jogar no GumGum Fight"; perfil vinculado nos dois lados.
6. Estatísticas: o GGF publica os agregados públicos com ETag e o SweetApp monta a página de meta. Partidas
   ranqueadas continuam só no GGF (só o servidor grava).
7. Coleção (SweetApp → GGF): endpoint no SweetApp com a coleção do usuário vinculado; o construtor marca o que falta.
8. Login único: os dois usam Google; o vínculo OAuth já casa as contas.
9. Spoilers: decks com spoiler do SweetApp jogam no formato "Todas as cartas + spoilers".
10. Homologação compartilhada (`gumgumfight.duckdns.org`) e contrato OpenAPI versionado.

**Regras.** Nunca dependência mútua em tempo de partida (o GGF só precisa do SweetApp na importação e nos webhooks,
assíncronos). Uma fonte da verdade por deck, com conflito 409 em vez de "último que gravou vence". O GGF continua
sem entregar e-mail ou nome do Google por token.
