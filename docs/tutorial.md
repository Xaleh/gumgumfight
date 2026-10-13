# Tutorial "Aprender a jogar"

Seção para quem não conhece One Piece Card Game: 14 lições curtas em 4 capítulos, jogadas na mesa de verdade.
Abre pelo item **Aprender** do menu, pelo convite da home ("Primeira vez aqui?") e pelo atalho no card **Contra o bot**.
Não precisa de login: o progresso fica no `localStorage` do navegador (`gumgum.tutorial`) e é copiado para o servidor,
por conta (logado) ou por navegador, para não se perder ao trocar de aparelho ou limpar o navegador.

| Capítulo | Lições |
|---|---|
| 1 · East Blue — Fundamentos | O objetivo do jogo · Anatomia da carta · A mesa e suas áreas · Preparação e mulligan |
| 2 · Grand Line — O turno | As fases do turno · DON!! e custo · Personagens, Eventos e Stage |
| 3 · Novo Mundo — Combate | Atacar · Dar DON!! (+1000) · Defender: Blocker e Counter · Dano, Vida e Trigger |
| 4 · Rumo ao Yonkou — Domínio | Palavras-chave e efeitos · Montar seu primeiro deck · Batalha final contra o bot |

Os decks são os iniciais ST01 (Luffy, para quem aprende) e ST03 (Crocodile, para o bot).

## Onde fica cada parte

| Arquivo | O que faz |
|---|---|
| `packages/engine/src/scenario.ts` | `createScenario(config, spec)`: monta uma partida já em andamento a partir de uma descrição de cada lado (mão, Personagens, Stage, Vida, topo do deck, trash, DON!! ativos/virados/dados). `passiveAction`: o oponente que não reage. |
| `apps/web/src/game/tutorial/lessons.ts` | As lições como dados: cenário, plano do oponente e passos. Também o glossário e as dicas da batalha final. |
| `apps/web/src/game/tutorial/runner.ts` | Regras do andamento sem interface: que jogadas o passo permite e o que o oponente roteirizado faz. |
| `apps/web/src/game/tutorial/useLesson.ts` | O hook da tela: estado da mesa, passo atual, trava de jogadas, oponente automático, "tentar de novo". |
| `apps/web/src/game/tutorial/progress.ts` | Progresso salvo no navegador e sincronizado com `/api/tutorial/progress` (união das lições feitas). |
| `apps/web/src/game/tutorial/coachTips.ts` | As dicas do treinador nas partidas contra o bot (`coachTip(estado, jogador)`). |
| `apps/web/src/game/tutorial/terms.ts` | Acha as palavras-chave (`[Ao Jogar]`, `[Blocker]`, `DON!! −1`...) no texto das cartas e liga cada uma ao glossário. |
| `apps/web/src/components/TutorialFunnel.tsx` | Aba **Tutorial** da Administração: o funil das lições. |
| `apps/server/src/tutorial/` | Progresso no servidor, título, eventos anônimos e o funil (`store.ts`, `routes.ts`). |
| `apps/web/src/components/Learn.tsx` | Hub: progresso, capítulos, lições, insígnias e glossário. |
| `apps/web/src/components/Lesson.tsx` | Tela da lição: a mesa (`LessonTable` do `GameScreen`) ou o painel das lições sem mesa (carta, anatomia, curva). |
| `apps/web/src/components/Coach.tsx` | O treinador (texto, quiz, botões) e os destaques (`Spotlight`, anéis em volta das áreas). |
| `apps/web/src/i18n/tutorial/*.ts` | Os textos, nos 6 idiomas. |
| `apps/web/test/tutorial.test.ts` | Resolve cada lição de ponta a ponta sem navegador e confere que todos os textos existem. |
| `apps/web/test/{coachTips,terms}.test.ts` | As dicas do treinador e os termos clicáveis. |
| `apps/server/test/tutorial.test.ts` | Progresso, título, eventos, funil e limite de envios. |

A mesa da lição é a mesma das partidas (`Table` em `GameScreen.tsx`) com a opção `tutorial`: o treinador fica no painel
lateral (desktop) ou flutuando em cima/embaixo (celular), as perguntas do motor ficam escondidas nos passos de leitura e
somem os controles que não fazem sentido numa lição (Auto, desfazer, velocidade, replay, desistir, tela de resultado).

## Tipos de passo

Cada passo tem um `id`; os textos são `tutorial.<lição>.<passo>.title` e `.body`.

- **Leitura**: sem `do` nem `quiz`. Botão "Próximo". A mesa fica parada e qualquer jogada mostra o aviso do treinador.
- **Ação** (`do`): o jogador faz uma jogada.
  - `allow(ação, estado)`: jogadas permitidas na Main Phase (as outras são recusadas com o aviso "Essa jogada fica para depois").
  - `respond(ação, estado)`: respostas permitidas às escolhas pendentes do jogador (padrão: todas).
  - `done(estado, início)`: o passo foi cumprido. A mesa congela (o oponente espera) e o treinador avança sozinho.
  - `fail(estado, início)`: deu errado. O treinador mostra `.fail` e o botão "Tentar de novo" volta a mesa para o começo do passo.
  - O oponente só joga durante passos de ação.
- **Quiz** (`quiz: { options, correct }`): alternativas `.o1`, `.o2`..., explicação `.why`; `correct` começa em 1.
  O "Próximo" só libera com a resposta certa.
- `spot`: áreas destacadas (`my-leader`, `my-characters`, `my-stage`, `my-life`, `my-cost`, `my-don-deck`, `my-deck`,
  `my-trash`, `my-hand`, os `opp-*` correspondentes, `end-turn`, `decision`, `card:<número>` e `opp-card:<número>`).
- `card` (lições sem mesa): a carta mostrada ao lado do texto. `extra`: ilustração própria (`curve`, `deck-rules`).

O oponente de cada lição (`board.opponent`) pode ser `'passive'` (não bloqueia, não usa Counter, não ativa Trigger e
encerra o turno), uma lista de ataques (`{ attacks: [{ attacker: 'leader' | número, target: 'leader' | número }] }`,
feitos na ordem enquanto forem possíveis) ou `'bot'` (o bot fácil, na batalha final).

## Como escrever uma lição nova

1. Monte o cenário com `createScenario` em `lessons.ts` (as cartas citadas precisam existir nos decks do tutorial).
2. Escreva os passos e as condições `done`/`fail` olhando o estado do motor (`uidsOf`, `cardIdOf` e as ajudas do arquivo).
3. Ponha os textos em `i18n/tutorial/pt-BR.ts` e nos outros 5 idiomas (o typecheck exige as mesmas chaves).
4. Em `apps/web/test/tutorial.test.ts`, adicione em `SOLUTIONS` as jogadas que resolvem cada passo de ação.
   `npm test -w @gumgum/web` confere que a lição termina e que nenhum texto falta.

## Fora das lições

- **Progresso no servidor.** `GET`/`PUT /api/tutorial/progress` (tabela `tutorial_progress`, chave = conta `user:<id>`
  ou o hash do navegador). O `PUT` soma as lições feitas (`done`) às que já estavam lá; `reset: true` troca a lista
  (botão "Recomeçar o tutorial"). `dismissed` (o convite da home foi fechado) e o título nunca voltam atrás.
- **Título "Aprendiz da Grand Line".** Quem conclui as 14 lições ganha o título, mostrado só no hub do tutorial. O
  servidor ainda manda `apprentice` em `/api/players/me` e nos jogadores da sala, mas o menu e a partida online não o exibem.
- **Dicas do treinador** (Configurações → "Dicas do treinador", ou o botão no fim da batalha final). Desligadas por
  padrão. Nas partidas contra o bot, um balão curto sugere o que olhar agora: manter ou trocar a mão, bloquear ou não,
  quanto Counter falta, Trigger, gastar DON!!, atacar. Textos: `coach.tip.<chave>`. O balão some ao fechar até a
  situação mudar.
- **Termos clicáveis.** No detalhe da carta, as palavras-chave do texto viram links: o toque mostra a definição do
  glossário e a lição que ensina o termo.
- **Funil anônimo.** As lições mandam `POST /api/tutorial/events` (`start`, `step`, `fail`, `exit`, `complete`), sem
  identificar ninguém: só um contador por dia, lição, passo e evento (tabela `tutorial_events`), com limite de 60 envios
  por minuto por IP. `GET /api/admin/tutorial?days=30` (só admin) devolve, por lição, quantos começaram, concluíram,
  saíram e falharam, e por passo quantos chegaram, saíram e falharam. A aba **Tutorial** da Administração mostra isso e
  aponta o passo onde mais gente desiste.
