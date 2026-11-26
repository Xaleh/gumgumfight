# Plano: dividir o `engine.ts` e o `GameScreen.tsx` (roadmap A3)

Os dois maiores arquivos do projeto viram vários menores, para dar para trabalhar em mais de uma branch ao mesmo tempo
sem conflito e para achar as coisas pelo nome do arquivo. **Nada muda no jogo nem na tela.**

| Arquivo | Antes | Maior pedaço |
|---|---|---|
| `packages/engine/src/engine.ts` | 7.035 linhas | `execStep`, uma função de 2.560 linhas (um `switch` com 135 tipos de passo) |
| `apps/web/src/components/GameScreen.tsx` | 3.860 linhas | `Table`, um componente de 1.845 linhas |

**Regras que não mudam em nenhuma fase:**

- **Sem mudar comportamento.** Cada fase só move código. O corpo das funções fica como está; quando uma mudança for
  inevitável (uma variável do módulo que outro arquivo passava a escrever), ela é citada na fase.
- **Nenhum teste é alterado.** `npm run typecheck`, `npm test` e `npm run e2e` passam com os testes como estão.
- **A API pública não muda.** Quem importa `@gumgum/engine`, `../src/engine` ou `./components/GameScreen` continua
  importando do mesmo lugar e recebendo exatamente os mesmos nomes.
- **Motor: prova de equivalência.** Além dos testes, as mesmas partidas (sementes fixas, bot contra bot, com ações
  aleatórias no meio, mesa de 2 e de 4) são jogadas no motor de antes e no de depois, e o estado final de cada uma tem
  que sair idêntico, byte a byte. É o `npm run fingerprint -w @gumgum/engine` (`packages/engine/scripts/fingerprint.ts`):
  rode na `main` e na branch e compare os hashes.
- **Os módulos se importam entre si** (o motor é recursivo: um efeito causa um K.O., que dispara outro efeito). Isso só
  funciona se nenhum módulo rodar, na carga, código que dependa de outro: no topo de cada arquivo ficam só declarações
  (funções, tipos e constantes literais).
- O item só ganha `[x]` no roadmap quando nenhum arquivo do motor nem o `GameScreen.tsx` passar de ~1.500 linhas.

## Fases

### Fase 1 — `engine.ts` vira a pasta `engine/` ✅

O arquivo some e as declarações dele vão, inteiras e com os comentários, para `packages/engine/src/engine/`:

| Módulo | O que tem | Linhas |
|---|---|---|
| `index.ts` | o mapa da pasta e a reexportação da API (os mesmos 65 nomes que o `engine.ts` exportava) | 90 |
| `setup.ts` | `createGame` e a preparação: quem começa, mãos, mulligans, largada, Vida | 252 |
| `apply.ts` | `applyAction`, `cloneState`, a ação da Fase Principal e a resposta a uma pergunta | 506 |
| `cancel.ts` | cancelar a ação em andamento (checkpoint) | 118 |
| `turn.ts` | começo e fim do turno, Renovação, durações dos efeitos | 186 |
| `stack.ts` | a pilha de resolução (`run`) e a entrada de uma carta em campo | 122 |
| `triggers.ts` | efeitos disparados (CR 8-6) e os eventos ("When …") | 275 |
| `battle.ts` | batalha (bloqueio, Counter, comparação) e dano na Vida | 212 |
| `effects.ts` | um passo de efeito por vez: "cada oponente", alvos, perguntas | 410 |
| `exec-step.ts` | `execStep`: o que cada passo de efeito faz (dividido na fase 2) | 2.622 |
| `costs.ts` | custos de habilidade: dá para pagar, a pergunta, o pagamento, o texto | 272 |
| `removal.ts` | K.O., remoção, proteções e efeitos de substituição | 349 |
| `zones.ts` | onde a carta está, virar, comprar, DON!!, Vida | 251 |
| `defeat.ts` | derrota, eliminação (mesa de 4) e fim de jogo | 181 |
| `manual.ts` | ferramentas manuais (efeitos ainda não automatizados) | 198 |
| `queries.ts` | consultas: definição, dono, custo, poder, palavras-chave, filtros, auras | 371 |
| `conditions.ts` | condições das habilidades e o motivo quando não valem | 332 |
| `options.ts` | o que dá para fazer agora: atacar, jogar, ativar, bloquear, Counter, alvos | 345 |
| `table.ts` | os jogadores da mesa e quem é "o oponente" (2 e mais de 2) | 141 |
| `messages.ts` | perguntas ao jogador e linhas do histórico | 75 |
| `constants.ts` | tamanhos, limites e os tipos dos frames | 20 |

Como foi feito: um script leu o `engine.ts` pelo AST do TypeScript, levou cada declaração de topo para o módulo dela,
gerou os imports entre os módulos e pôs `export` no que passou a ser usado por outro arquivo. Conferido que o
resultado é o mesmo texto reordenado: toda linha do arquivo antigo está em algum módulo, fora os imports e os títulos
de seção (que viraram o cabeçalho de cada arquivo).

A única mudança de código: `stepEffect` escrevia em `probeStep`, uma variável do diagnóstico da simulação de Yonko
(`setOpponentProbe`). Um módulo não escreve em variável de outro, então a escrita virou a função `markProbeStep`, em
`table.ts`, com a mesma conta.

Conferência: 929 testes do motor, 510 do servidor, 184 do web e os 10 de ponta a ponta, sem alteração; 640 partidas
simuladas (92 mil ações) e 6 partidas com o bot com busca (relógio e sorteio fixos) com o mesmo hash no motor de antes
e no de depois (`npm run fingerprint`, que entrou nesta fase para as próximas usarem).

### Fase 2 — `execStep` por família de efeito ✅

O `switch` de 135 casos sai de `exec-step.ts` e vai para `packages/engine/src/engine/steps/`, um executor por família,
cada um com o `switch` dele:

| Módulo | Passos | Exemplos | Linhas |
|---|---|---|---|
| `exec-step.ts` | — | o começo de todo passo (o "If X, …" e o "Then" que depende dele) e o despacho para a família | 198 |
| `steps/power.ts` | 29 | poder, custo, palavras-chave e o que a carta pode fazer: `power`, `basePower`, `gainKeyword`, `cannotBeKO`, `restrict`, `redirectAttack` | 417 |
| `steps/field.ts` | 23 | cartas em campo e substituição: `ko`, `rest`, `returnToHand`, `trashTarget`, `ownToBottom`, `replaceRemoval` | 405 |
| `steps/don.ts` | 13 | DON!!: `giveRestedDon`, `returnDon`, `addDonFromDeck`, `restDonOrCharacter`, `moveGivenDon` | 462 |
| `steps/hand.ts` | 18 | mão: `draw`, `trashFromHand`, `opponentDiscards`, `revealFromHand`, `handToDeck` | 340 |
| `steps/deck.ts` | 15 | deck e trash: `search`, `tutor`, `revealTop`, `arrangeTop`, `millDeck`, `fromTrashToHand` | 341 |
| `steps/life.ts` | 16 | Vida e dano: `lifeFace`, `lifeToHand`, `handToLife`, `peekLife`, `trashLife`, `takeDamage` | 358 |
| `steps/play.ts` | 14 | jogar e usar efeitos: `playFrom`, `playRevealed`, `activateEventFromHand`, `useMainEffect`, `delayed` | 259 |
| `steps/choice.ts` | 7 | decisões: `payCost`, `payEither`, `chooseOne`, `opponentMay`, `select`, `manual` | 144 |

Como ficou:

- O começo do `execStep` continua em `exec-step.ts` e roda uma vez, antes da família. As duas variáveis que os casos
  dividiam (`ps`, o jogador que controla o efeito, e `srcName`, o nome da carta) são calculadas ali, no mesmo ponto de
  antes, e passam prontas para o executor. Nenhum caso usava variável de outro caso.
- Os casos que caem um no outro (`restOwn` → `returnOwn`, `koOwn` → `trashOwn`, `trashSelf` → `returnSelfToHand`,
  `activateEventFromTrash` → `activateEventFromHand`, `canAttackActive` → `cannotAttack`) ficaram juntos; o script
  recusa separar.
- O TypeScript continua exigindo todos os casos, agora dos dois lados: cada família recebe o tipo dos passos dela
  (`Extract<EffectStep, { do: … }>`). Um passo novo em `types.ts` sem `case` no despacho não compila; um `case` no
  despacho que a família não conhece também não.
- Para criar um passo novo: o tipo em `types.ts`, o nome no tipo da família e o `case` no arquivo dela, e o `case` no
  despacho de `exec-step.ts`.

Feito pelo mesmo caminho da fase 1 (script pelo AST; cada `case` foi inteiro, com o comentário dele) e com a mesma
conferência: o texto é o mesmo reordenado, nenhum teste alterado, e o `npm run fingerprint` dá os mesmos hashes do
motor de antes da fase 1. O maior arquivo do motor agora é o `apply.ts`, com 506 linhas.

### Fase 3 — `GameScreen.tsx`: o que fica em volta da mesa ✅

Os componentes que já eram funções separadas dentro do arquivo saíram para `apps/web/src/components/table/`:

| Arquivo | O que tem | Linhas |
|---|---|---|
| `GameScreen.tsx` | as telas de entrada (`GameScreen`, `OnlineGameScreen`, `WatchGameScreen`, `LessonTable`), os tipos da mesa (`TableGame`, `TableEmbed`…) e o `Table` (dividido na fase 4) | 2.319 |
| `table/Prompt.tsx` | a janela da pergunta do motor (`Prompt`, `PromptPill`, `SourceLine`, `useSkipGuard`) | 430 |
| `table/CenterBand.tsx` | a faixa central: `CenterBand`, `BattleInfo`, `DonBar`, `CoachTipPill`, `AttackArrow` | 342 |
| `table/CardZoom.tsx` | a carta ampliada e as folhas: `CardZoom`, `CardDetail`, `HoverTip`, `SheetFrame`, `RevealedCards` | 302 |
| `table/decisions.tsx` | as decisões na faixa central: `DecisionButton`, `TargetRequest`, `CancelButton`, `UndoPill`, `targetsOnTable` | 275 |
| `table/LogPanel.tsx` | o histórico: `LogPanel`, `LogText` | 189 |
| `table/shared.ts` | tipos e ajudantes divididos com o `Table`: `Mode`, `Drag`, `Sheet`, `Panel`, `promptText`, `orderText`, `useMediaQuery` | 77 |

Como ficou:

- O `GameScreen.tsx` exporta os mesmos nomes de antes; quem importa dele (`App.tsx`, `Lesson.tsx`, `DailyChallenge.tsx`,
  `DailyEditor.tsx`, `Broadcast.tsx`, `ReplayEmbed.tsx`) não mudou. O `downloadReplay` ficou nele: quem o usa são as
  telas de entrada.
- Os arquivos de `table/` só pegam **tipos** do `GameScreen.tsx`; valores vão sempre do `table/` para o `GameScreen`.
  Assim não há ciclo de carga entre eles (o script recusa o contrário).
- Feito pelo mesmo caminho do motor (script pelo AST, cada declaração inteira com o comentário dela). O texto é o
  mesmo reordenado: fora os imports e o cabeçalho de cada arquivo novo, nenhuma linha mudou.
- Conferido com `npm run typecheck`, os testes do web e os de ponta a ponta, sem alterar nenhum.

### Fase 4 — o `Table` em hooks e zonas ✅

A única fase que não é só mover código: o `Table` (1.840 linhas, um componente só) foi para um arquivo próprio e
perdeu um terço do tamanho para hooks e componentes.

| Arquivo | O que tem | Linhas |
|---|---|---|
| `GameScreen.tsx` | as telas de entrada (`GameScreen`, `OnlineGameScreen`, `WatchGameScreen`, `LessonTable`) e os tipos da mesa | 377 |
| `table/Table.tsx` | o `Table`: o estado da mesa, o que dá para fazer com cada carta (`highlight`, `onCard`, `dropValid`, `onDrop`) e o desenho | 1.284 |
| `table/useTableGestures.ts` | toque longo e arrastar (carta da mão, atacante, DON!!) | 220 |
| `table/TableSidePanels.tsx` | os painéis ao lado da mesa: lição, transmissão, Streamer e quem joga | 200 |
| `table/TableMenu.tsx` | o menu da partida | 191 |
| `table/useTableShortcuts.ts` | o que cada atalho de teclado faz (`onShortcut`) | 167 |
| `table/useTableNotices.ts` | o aviso da mesa e as cartas reveladas pelo oponente | 114 |
| `table/useBotCoach.ts` | as marcações e o relatório do treino contra o Bot do Time | 90 |
| `table/useOpenHands.ts` | visão do Streamer: as mãos que abrem em leque | 48 |
| `table/useHandOrder.ts` | a ordem da mão escolhida pelo jogador | 36 |

Como foi feito:

1. **Testes antes.** Arrastar, toque longo e atalhos não tinham teste. O `e2e/table.spec.ts` (5 testes) entrou
   primeiro e passou no código de antes da divisão; depois, sem mudar uma linha dele, no de depois.
2. **Mover o `Table`** para `table/Table.tsx`, inteiro, pelo script das outras fases.
3. **Recortar os blocos** do `Table` por faixa de linhas (o texto de cada bloco foi literal para o hook ou componente
   novo) e escrever à mão só as assinaturas e as chamadas. Cada hook é chamado no lugar onde o bloco estava.

O que mudou de verdade (o resto é o mesmo texto):

- Cada hook e cada componente recebe por parâmetro o que antes lia direto das variáveis do `Table`. Os efeitos têm as
  mesmas dependências.
- `useTableNotices` lê a opção de animações com o próprio `useSettings()` (o `Table` a lia mais abaixo).
- A ordem de alguns `useState`/`useRef`/`useMemo` entre si mudou (os de um mesmo assunto ficaram juntos no hook). Um
  efeito mudou de posição: o que fecha os leques do Streamer quando "Ver mãos" desliga roda agora antes do que marca o
  histórico como visto. Os dois não se falam.
- `TableMenu` e `TableSidePanels` chamam `useT()` e `useSettings()` por conta própria. O HTML é o mesmo: os painéis
  saem num fragmento, no mesmo lugar.

Conferência:

- `npm run typecheck`, os 184 testes do web e os 15 de ponta a ponta (os 10 de antes, sem alteração, e os 5 novos).
- O HTML da mesa das 8 primeiras lições do tutorial com mesa (situações fixas), no desktop e no iPhone emulado, é
  idêntico byte a byte antes e depois (16 snapshots; no desktop com o painel da lição, no celular com o treinador
  flutuante).

O que não tem conferência automática e vale olhar à mão: o arrasto com o dedo num celular de verdade (deslizar pela
mão ergue a carta; puxar para cima joga), a visão do Streamer (os leques das mãos e o painel de partidas e decklist),
a tela de transmissão e o painel do treinador do Bot do Time.

Ficou de fora, por não precisar para o limite de linhas: o bloco do fim de jogo (`GameResult`, a decklist e o relato)
e os botões do canto e ao lado do deck continuam no `Table`.
