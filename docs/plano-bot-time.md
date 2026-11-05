# Plano: Bot do Time (bot de alto nível, exclusivo para um grupo)

> Status: **implementado** (01/11/2026), fases 0 a 3; a fase 4 (promover deck a deck para o `hard` público) é um
> processo, não código. O que saiu diferente do plano: o guia e o perfil editados pela tela ficam no **banco**
> (`meta_profiles`), por cima dos arquivos de `data/decks/meta` (a semente e o que vai para o repositório), porque o
> deploy troca a pasta `data/`; a explicação das jogadas sai dos **termos da avaliação** (`evaluateTerms`), sem o
> agente ao vivo; e as cartas reveladas da mão ficam lembradas (`GameState.knownHand`) pelo próprio motor. O README
> ("Bot do Time"), a documentação técnica e a seção 12 do [`bot-tempo.md`](bot-tempo.md) descrevem o que existe. O texto
> abaixo é o plano original.

## 1. O que é

Um quarto nível do bot, **"Time"**, que só aparece para contas com o perfil **Time** (dado à mão pelo admin, como o
plano de apoiador). O objetivo é um bot que jogue os **decks do meta global** do jeito que os guias e os bons
jogadores jogam, e que o grupo use para treinar e para **corrigir o bot** jogada a jogada. O que o Time aprova
vira, mais tarde, o `hard` de todo mundo.

Duas decisões de arquitetura, respondendo às perguntas do card:

| Pergunta | Resposta | Por quê |
|---|---|---|
| Usar um agente (LLM) para decidir as jogadas na partida? | **Não.** As decisões continuam na busca + avaliação do motor. | Uma decisão do bot tem teto de 250 ms e a partida tem ~150; um modelo de linguagem leva segundos e custa por chamada, não é determinístico (os testes de posição e o `duel.ts` precisam repetir) e erra conta de ataque fatal e de Counter, que é justamente o que a busca acerta. A seção 9 do `bot-tempo.md` já mostrou que o gargalo não é "pensar mais", é **saber mais**. |
| Ações com pesos definidos e refinamento das jogadas? | **Sim, mas pesos na avaliação, não regras "se X faça Y".** A novidade é um **perfil de deck** (conhecimento por deck e por Líder adversário) que entra como termos e prioridades da avaliação, e um **ciclo de refinamento** alimentado pelo Time. | É a arquitetura que funciona hoje (seção 7d: planos de deck como gabarito) e que generaliza: uma regra escrita para o Shanks quebra no Xebec; um termo "efeito que congela vale X" serve para os dois. |

Onde o agente **entra**: fora da partida, como compilador de conhecimento. Ele transforma o guia em prosa num perfil
de deck estruturado (que o Time revisa), lê os traços das partidas do bot contra o guia e aponta as jogadas que fogem
do plano, e redige a explicação das jogadas para o painel do treinador. Tudo assíncrono, barato e revisável.

## 2. Perfil "Time"

- **Banco**: coluna `users.team INTEGER NOT NULL DEFAULT 0` (`db.ts`, migração por `ALTER TABLE` como as de
  `supporter_*`). É uma **marca à parte**, não um `role` nem um `supporter_tier`: um membro do Time pode ser streamer
  ou organizador e pode ter (ou não) plano pago. A sincronização da Apoia.se sobrescreve o tier; não pode apagar o Time.
- **Servidor**: `isTeam(u) = u.team || isAdmin(u.role)` em `auth/store.ts`; `PUT /api/admin/users/:id/team {team: boolean}`
  (só admin, como `/role` e `/supporter`); `team: true` no `GET /api/auth/me` e na lista do admin. A sala de treino
  (`POST /api/online/bot`) aceita `level: 'team'` só de quem é do Time (403 `teamOnly` para os outros).
- **Interface**: na aba **Perfis** do Admin, um interruptor "Time" ao lado do editor de apoiador (`SupporterEditor`),
  com a ajuda "Joga contra o Bot do Time e envia correções". Na barra de conta, um selo "Time". Chaves novas nos
  seis dicionários (`labels.team`, `admin.teamHelp`, `menu.botTeam`, `errors.teamOnly`...).

## 3. Telas

### 3.1 Menu "Contra o bot" (Menu.tsx)

- O seletor de nível ganha o quarto botão **Time**, visível só para quem é do Time (ou admin). Quem não é não vê nada.
- Ao escolher Time, o escolhedor do deck do bot mostra um grupo **"Decks do meta"** (os decks de `data/decks/meta/`,
  com selo do Líder e um ícone de guia quando o perfil do deck existe), além dos decks prontos de sempre.
- Caixa **"Explicar as jogadas"** (ligada por padrão no nível Time): abre o painel do treinador na mesa.
- O treino no nível Time **roda no servidor** (sala `bot`), para o perfil do deck e os pesos ficarem no servidor,
  as decisões serem registradas e o relógio do bot ser maior. Se a transmissão estiver lotada (503), cai para o
  navegador no mesmo nível, como hoje (o motor é o mesmo nos dois lados).

### 3.2 Mesa (GameScreen.tsx): painel "Treinador do bot"

Um painel lateral recolhível (reaproveita o visual do `Coach.tsx` do tutorial), só no nível Time:

- **A jogada e o motivo**: a cada decisão do bot, a linha escolhida e os três termos da avaliação que mais pesaram
  ("fechar a partida +14 600", "Blocker em pé +1 550", "Counter esperado −3 200"). Já existe o gancho
  `onDecision` no planejador; falta expor pela sala (evento SSE `botDecision`, só para o Time).
- **Marcar esta jogada** (botão em cada entrada do painel e no `ReplayBar` depois da partida): abre uma folha com
  "o que ele deveria ter feito?" (escolha entre as ações legais daquela posição, com as mesmas palavras do replay, mais
  um comentário livre). Envia `POST /api/bot/feedback {matchId, actionIndex, expected, comment}`. O servidor guarda a
  **visão exata** da posição (refaz o replay, como o extrator faz): é a matéria-prima do teste de posição.

### 3.3 Fim da partida (GameResult.tsx)

- Nota de 1 a 5 para o bot ("jogou como um jogador de…") e campo de comentário; junto com as marcações, vai para o
  mesmo `bot_feedback`.
- Link para o replay com as marcações já em cima.

> Atualização (04/11/2026): a marcação ficou de um toque por passo da jogada (com "o certo era" e "por quê"
> opcionais), as marcações viram um relatório em texto, e a caixa de correções (estado e resposta) deu lugar à lista
> de relatórios com o **pacote para o Claude** (relatório + guia + perfil + replay), que substitui o agente sem a API.

### 3.4 Tela "Bot do Time" (aba nova no Admin; o Time vê em modo leitura)

- **Decks do meta**: um card por deck com Líder, se o guia foi enviado, se o perfil foi gerado e revisado, quantos
  testes de posição o cobrem, vitórias contra o `hard` atual (do `duel.ts`), concordância com os 4 primeiros dos
  torneios naquele Líder (do extrator), e partidas do Time com a nota média.
- **Enviar guia** (markdown, por deck) e **Gerar perfil** (chama o agente; o resultado aparece num editor JSON para
  revisão antes de salvar).
- **Caixa de correções**: as marcações do Time, com link do replay na posição, estado (aberta, virou teste, corrigida,
  descartada) e o motivo. É a fila de trabalho do bot.

## 4. Como o bot funciona no nível Time

O nível `team` em `planner.ts` usa a mesma busca do `hard` com mais relógio (600 ms no servidor) e, o que importa,
uma avaliação que **lê o perfil do deck**.

### 4.1 Perfil de deck (`data/decks/meta/<id>.profile.json`)

Gerado do guia pelo agente, revisado pelo Time, versionado no repositório:

```
archetype: aggro | midrange | control | combo
plan: [{ turn: 1..N, don: 2..10, play: ["OP17-040"], note: "..." }]   // a curva do deck
mulligan: { keep: ["OP17-040", ...], minCheap: 2 }                      // o que segura a mão inicial
roles: { "OP17-045": "finisher", "ST32-002": "engine", "OP17-048": "defense", ... }
hold: { "OP17-045": { untilDon: 10 } }                                  // guardar até o turno certo
weights: { lifeOpp: [...], exposed: 300, handCounter: 1400 }            // sobrescreve DEFAULT_WEIGHTS
matchups: { "OP10-099": { counterCard: 0.3, note: "quase sem Counter" } }  // o que esperar do adversário
```

### 4.2 Como o perfil entra na decisão (tudo como valor, nada como regra)

1. **Pesos por arquétipo** (`weights`): um deck aggro vale mais os dois últimos pontos de Vida do oponente e menos a
   exposição; um deck de controle vale mais a própria mão. Mesma função de avaliação, pesos diferentes.
2. **Valor da carta na mão pelo papel** (`roles`, `hold`): o `finisher` guardado até o DON!! certo vale mais na mão do que
   em campo cedo (termo novo `handRole`, somado em `handCardValue`); a carta de `defense` tem o `handCounter` do deck
   (como já se fez para os Eventos [Counter] do Xebec); a `engine` entra na ordem das candidatas antes das outras.
3. **Curva do próximo turno** (`plan`): termo `nextTurn` no fim do turno: ter na mão e no DON!! a jogada prevista para o
   turno seguinte vale um bônus. É o que falta para "desenvolver ou pressionar" (seção 8) e para não jogar a mão fora
   antes do turno do Shanks de 10.
4. **Mulligan pelo guia** (`mulligan`): hoje o mulligan é heurístico; passa a seguir o perfil.
5. **Modelo do adversário por Líder** (`matchups` + meta global): a chance de Counter escondido (`counterCard`,
   `counterBig`) e a vontade de defender passam a depender do Líder do oponente, lido do perfil (quando houver) ou de
   um perfil padrão por Líder derivado da composição dos decks de `data/decks/meta/` e dos decks mais jogados nas
   estatísticas. Um humano sabe que o Xebec quase não tem Counter; o bot passa a saber.
6. **Memória das cartas reveladas**: o que o oponente revelou da mão fica lembrado até sair (seção 8). Termo genérico,
   serve a todo deck.

Sem perfil (deck sem guia), tudo cai para `DEFAULT_WEIGHTS` e o comportamento do `hard`.

## 5. Ciclo de refinamento (o "treinamento")

```
guia do Time ──agente──▶ perfil JSON ──revisão do Time──▶ data/decks/meta/*.profile.json
                                                                │
   marcações do Time (bot_feedback) ──▶ teste de posição ◀──────┤   (cada marcação vira um caso em
                                              │                 │    bot-positions.test.ts, com a visão gravada)
   traço das partidas ──agente──▶ "fugiu do plano no turno 3" ──┘
                                              │
                               correção: termo na avaliação ou valor no perfil
                                              │
                    medir: duel.ts (x hard atual), vs-human.ts, decisions:tune (concordância com os
                    4 primeiros dos torneios, agora também na fase principal e por deck), nota do Time
                                              │
                               promover: Time → hard de todos (por deck, quando os números fecham)
```

- **O extrator** (`decisions/extract.ts`) ganha `--leader` e a concordância por deck, e o `tune.ts` ganha os pesos do
  perfil como parâmetros: o SPSA por imitação passa a ajustar `weights` do perfil contra as decisões dos melhores com
  aquele Líder, não só a defesa.
- **A regra de ouro continua**: uma correção só entra com teste de posição e medida; "dentro do ruído" no auto-jogo é
  aceitável quando a nota do Time sobe (é o que a rodada 4 mostrou: o que muda é o que a pessoa vê).

## 6. O agente (fora da partida)

Três usos, todos por um comando no servidor (`npm run bot:agent -w @gumgum/server -- <tarefa>`), com a chave num
`BOT_AGENT_API_KEY` só no `deploy.env`; sem a chave, a tela esconde os botões e o fluxo segue à mão:

1. **Guia → perfil**: entrada o markdown do guia, a lista do deck e o esquema do perfil; saída o JSON, com uma
   justificativa por campo para o revisor.
2. **Traço → discrepâncias**: entrada o perfil e um traço de partida (`trace-game.ts` com as linhas escolhidas); saída
   a lista "turno N: o bot fez X, o guia pede Y, conceito provável que falta". O dev transforma em termo ou em teste.
3. **Explicação das jogadas**: entrada os termos da avaliação da jogada; saída uma frase em português para o painel do
   treinador (pode ser gerada depois da partida e gravada no replay, não precisa ser ao vivo).

## 7. Fases

| Fase | Entrega | Para que |
|---|---|---|
| 0 (1 semana) | Perfil Time, botão Time no menu (ainda jogando como o `hard`), decks do meta em `data/decks/meta/`, marcação de jogadas e nota no fim | O Time começa a jogar e a gerar correções antes de o bot mudar |
| 1 | Perfil de deck (pesos, papéis, mulligan, matchups), tela "Bot do Time", painel do treinador | Primeiro bot que joga diferente por deck |
| 2 | Curva do próximo turno, memória das reveladas, extrator por deck e `tune` dos pesos do perfil | Os termos que mais aparecem nas marcações |
| 3 | Agente: guia → perfil, traço → discrepâncias, explicações | Tirar o trabalho manual do ciclo |
| 4 | Promoção deck a deck para o `hard` público | O que o Time aprovou vira o bot de todos |

## 8. Riscos e limites

- **"Nível de jogador de alto nível"** não tem medida direta. As medidas que temos são relativas: vitórias contra o
  `hard` atual, concordância com os 4 primeiros dos torneios, nota do Time. A meta de cada fase deve ser escrita nesses
  números.
- **Decks de combo** e leitura de vários turnos continuam fora do alcance da busca de um turno; o termo `nextTurn` é
  uma aproximação, não um planejamento de dois turnos.
- **CPU do servidor**: o nível Time com 600 ms por decisão cabe para um grupo pequeno; não é para a fila pública sem
  medir (seção 14 da documentação técnica).
- **Efeitos manuais (⚙)** continuam só confirmados; decks que dependem deles não vão jogar bem até o motor cobri-los.
