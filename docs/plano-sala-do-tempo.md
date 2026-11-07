# Plano: Sala do Tempo (torneio simulado do Time)

> Status: **implementado** (07/11/2026), fase 0 e fase 1 (top cut, kit de divulgação e recorte da classificação). O que
> ficou para depois: o editor de presets na Administração e a importação da distribuição do meta global do TCG Matchmaking
> (hoje o preset é um arquivo JSON em `data/chamber/`, editado à mão). O README ("Sala do Tempo") e a documentação técnica
> (seção 12) descrevem o que existe; este arquivo é o desenho.

## 1. O que é

Uma "sala do tempo" (o treinamento do Dragon Ball) para o Time: um **torneio simulado** com o tamanho de um evento real
(um Regional de 700 jogadores, por exemplo), em que o jogador enfrenta, rodada a rodada, os decks que enfrentaria lá,
na proporção em que eles aparecem. O único jogo que roda de fato é o do humano; o resto do evento é estatística.

A decisão de arquitetura que simplificou tudo: a Sala do Tempo **é um torneio do módulo de torneios**, com uma marca
(`tournaments.chamber`), cujas vagas que os humanos não ocupam são preenchidas por **jogadores virtuais**. Inscrição com
deck congelado, lobby, "Estou pronto", início de rodada pelo organizador, salas, resultado pelo fim do jogo, classificação,
top cut e kit de divulgação vêm de graça. Nada de módulo paralelo.

| Pergunta | Resposta |
|---|---|
| Quem abre? | Quem é do Time (`users.team`, ou admin). Quem abriu gerencia (`canManage`), sem precisar do perfil Organizador. |
| Quem joga? | Só o Time se inscreve. Basta um humano para começar; os virtuais completam o evento. |
| Como o jogador cai contra cada deck? | Não é um sorteio direto na distribuição: os virtuais recebem um Líder pela distribuição do evento e **o suíço pareia todos juntos**. Quem está X-0 na rodada 6 cai contra os decks que chegaram X-0, como num evento de verdade. |
| O que é jogado de fato? | Humano x humano: sala de torneio online normal. Humano x virtual: sala do **Bot do Time** com o deck do meta do Líder do virtual, ligada à série (o fim do jogo entra no placar). Virtual x virtual: um passo estatístico, sem jogo. |
| Quem controla o ritmo? | Quem abriu a sala gera e inicia cada rodada (`next`, `rounds/begin`); a rodada fecha quando as mesas com humano têm resultado. Sem check-in, sem relógio, sem W.O. automático: um humano que some leva W.O. à mão, como no torneio comum. |

## 2. Preset do evento (`data/chamber/<id>.json`)

Nome, descrição, formato (com ou sem spoilers), jogadores, rodadas e top cut sugeridos, a **distribuição dos Líderes**
(`leaders[]`: `leader`, `share`, `deck` opcional) e, opcional, a **matriz de confrontos** (`matchups`). A soma dos `share`
pode ficar abaixo de 1: o resto é "outros". O arquivo é relido a cada consulta (`ChamberPresets`, `tournaments/chamber.ts`);
o README da pasta explica cada campo. Os presets são conferidos por `parsePreset` (um arquivo inválido é ignorado).

**Qual deck o bot joga por cada Líder** (`chamberDecks`): o `deck` do preset; senão o primeiro deck de `data/decks/meta/`
com o Líder (o que tem guia e perfil); senão qualquer deck pronto com o Líder. Só decks válidos no formato do torneio
(`deckIssue`). Líder sem deck válido vira "outros", e a tela avisa. Os "outros" sorteiam entre todos os decks prontos
válidos. Conforme os guias dos decks do meta forem escritos, a cobertura sobe sem mexer no código.

## 3. Modelo

- **`tournaments.chamber`** (id do preset; null = torneio comum) e **`chamber_size`** (jogadores do evento).
- **`tournament_virtuals`** (`tournament_id`, `id` = `v:17`, `name`, `leader`, `deck_id`, `skill`, `seed`): os virtuais
  sorteados no início (`spawnVirtuals`): `share × n` por Líder com deck (maior resto), o resto em "outros", a força
  (`skill`) numa normal padrão, a ordem embaralhada. Os ids entram em `tournament_matches.p1/p2` como os de um inscrito
  (a tabela de partidas não tem chave estrangeira para `users`; a de inscritos tem, por isso os virtuais ficam à parte).
- **Inscritos + virtuais** (`entrants`): a lista que vai para o pareamento, a classificação, o próximo passo, o lobby, os
  nomes das mesas e o kit. `listPlayers` continua só com os humanos (inscrição, notificações, warnings, decks).
- **Mesa estatística** (`resolveVirtualTables`): depois de gerar cada rodada (`beginChamber`, `advanceChamber`), as mesas
  com dois virtuais recebem o placar na hora (`reported_by = 'sim'`): chance de vitória por jogo =
  sigmoide(logit(matchup) + 0,6 × (força A − força B)), jogos até a maioria na melhor de N. As mesas com humano ficam
  pendentes. Com isso `roundComplete` e `nextStep` funcionam sem mudança.
- **Mesa humano x virtual**: `POST …/matches/:m/play` com oponente `v:` abre `lobby.createBotRoom(…, 'team', tournament)`
  com o deck do virtual; a sala é `queue = 'bot'` (a partida entra nas estatísticas como partida contra o bot, não como
  jogo de torneio) e leva `RoomTournament.virtualId`: no fim do jogo, `finishMatch` reporta o virtual como vencedor ou
  perdedor e `reportFromGame` soma na série como sempre (quem perdeu começa o próximo jogo; o virtual começa quando
  `next_first` é ele). Voltar à mesa devolve o mesmo assento.
- **Apresentação enxuta**: com centenas de virtuais, o detalhe do torneio manda só as mesas com humano em cada rodada
  (`tables` e `virtualTables` na rodada dizem o total), a classificação com os 32 primeiros, os humanos, seus oponentes e
  vizinhos (`standingsTotal` é o total), os inscritos humanos e, em `chamber`, a distribuição com o deck de cada Líder e
  quantos virtuais há com cada um. O lobby mostra só as mesas com humano.
- **Fora do meta**: `listFinished` e `listOpen` ignoram a Sala do Tempo (o painel do meta e o extrator de decisões não a
  veem). A lista de torneios mostra a sala só para quem é do Time; a página continua pública pelo link.

## 4. Telas

- **Torneios**: botão "⏳ Sala do Tempo" (só Time, com o treino contra o bot do servidor ligado) ao lado de "Criar
  torneio"; os cards das salas levam o selo e "N do Time + M virtuais = total".
- **Nova Sala do Tempo** (`Chamber.tsx`): o evento (preset), nome opcional, jogadores do evento, rodadas, top cut e
  melhor de 3/5, e a distribuição dos Líderes com a fatia, a barra, o deck que o bot joga (selo "deck do meta" / "deck
  pronto") e a contagem prevista; "Outros" com o resto.
- **Página do torneio**: selo no título; painel "⏳ Sala do Tempo" com o evento, a distribuição (depois do início, com
  quantos virtuais há de cada Líder e os "outros" sorteados) e os avisos (preset sumiu, treino do bot desligado); o
  botão Começar pede só um humano e confirma "N do Time e M virtuais"; sem "Editar" (a sala segue o evento) e sem
  premiação. Nas rodadas, a linha "N mesas só de virtuais decididas no sorteio" e, nas mesas, o nome do virtual
  ("Piloto 381", traduzido pelo id), o selo "virtual" e o Líder de cada lado. Na classificação, a coluna Líder, os
  virtuais marcados e a nota do recorte. Em "Sua partida", "Mesa 112: contra Piloto 381, um virtual com Xebec" com a
  campanha dele ("3-0 no evento") e o botão "Jogar contra o Bot do Time".
- **Mesa**: a GameScreen de sempre (sala do bot, nível Time, painel do treinador disponível); o cabeçalho e "Assistir"
  mostram o nome da sala e a rodada, como num torneio.

## 5. Limites e próximos passos

- A estatística governa **qual deck** o jogador enfrenta e como o resto do evento se desenrola; **como ele é pilotado**
  é o Bot do Time com o perfil do deck. Deck sem perfil joga como o `hard`; Líder sem deck pronto joga starter.
- A distribuição do preset `regional-op17-eb05` é provisória: trocar pelos números do Regional de Sydney.
- Fase 2 (não feita): editor de presets na aba Bot do Time da Administração; "importar do TCG Matchmaking" (participação
  por Líder e matriz de matchups da fila escolhida, `stats/global.ts`); estatísticas acumuladas do jogador por Líder
  nas salas do tempo (a matéria-prima já fica em `matches`/`match_seats`, modo `bot`, e nas partidas do torneio).
- CPU: cada mesa humano x virtual é uma sala do Bot do Time (600 ms por decisão); vale o mesmo teto do treino do Time
  (`ONLINE_MAX_BOT_ROOMS`). Com o treino do bot desligado (`ONLINE_BOT_ROOMS=off`) a sala não abre.
