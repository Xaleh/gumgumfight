# Yonko (Four Emperors): regras do formato e como o motor as aplica

> Fonte: o manual do formato, "Four Emperors Play Sheet" (PDF de 11 páginas, da comunidade). É o manual de regras
> do modo Yonko do GumGum Fight. Este arquivo resume cada regra do manual, diz como o motor
> (`packages/engine`) a aplica e marca o que é interpretação nossa, onde o manual não chega.
> O plano de implementação do modo está em [`plano-modos-de-jogo.md`](plano-modos-de-jogo.md), seção 4.

O formato: quatro capitães, todos contra todos, deck de 60 cartas sem repetição.

## 1. O básico (deck e Vida)

| Regra do manual | No motor |
|---|---|
| Deck de **60 cartas**. | `validateYonkoDeck` (`deck.ts`); `YONKO_DECK_SIZE`. `createGame` aceita 60 nas mesas com mais de dois. No construtor, "Montar para o Yonko". Um deck de 50 vira deck de teste na mesa (`yonkoTableDeck`): é uma facilidade nossa, fora do manual, e a sala avisa a todos. |
| **Singleton**: 1 cópia de cada carta. A carta é o **número** dela (o código no canto), não o nome: dois Roronoa Zoro de números diferentes cabem juntos; duas artes do mesmo número, não. | `validateYonkoDeck` conta por número (a lista do deck já junta as artes num número só). |
| Só cartas da(s) **cor(es) do Líder**. | A regra de sempre (`isColorCompatible`). |
| Vida = a impressa no Líder **+2**. | `TableRules.extraLife` (2 em `YONKO_TABLE`). |

## 2. Como se joga

| Regra do manual | No motor |
|---|---|
| Sorteio de quem começa; a mesa segue no sentido horário. | Sem `firstPlayer`, o RNG escolhe um lugar; a ordem segue os lugares e pula quem saiu. |
| Antes dos mulligans, cada jogador, na ordem dos turnos, escolhe a **largada** do próprio primeiro turno: curva ímpar e comprar 1 carta (1, 3, 5, 7, 9, 10 DON!!), ou curva par sem comprar (2, 4, 6, 8, 10). | `TableRules.curveChoice`: escolha `option` com `curve`, antes das mãos; fica em `GameState.curve`. Vale para todos, inclusive quem começa. |
| Depois da escolha, cada um compra a mão inicial; mulligan normal; então a Vida (impressa +2). | `continueSetup`: largadas, mãos, mulligans na ordem dos turnos, Vida, primeiro turno. |
| "Daqui em diante o jogo segue normal", com mais opções de quem atacar. | O ataque escolhe o Líder ou um Personagem virado de qualquer oponente. Ninguém ataca no próprio primeiro turno (regra do jogo normal). |

## 3. Mudanças mecânicas

| # | Regra do manual | No motor |
|---|---|---|
| 1 | Efeito que mira Personagens/Stages "do oponente" pode mirar **qualquer alvo legal de qualquer oponente**. | `targetCandidates`: `side: 'opponent'` junta as cartas de todos os oponentes. "Up to 2" pode pegar alvos de oponentes diferentes. Vale também na batalha. |
| 2 | Efeito que dura "até o fim do turno do seu oponente" passa a durar **até o começo do seu turno**. | `setExpiry`: a duração `nextOpponentTurn` acaba quando o turno de quem usou o efeito recomeça. |
| 3 | Não se pode descartar carta para dar Counter à defesa de outro, nem bloquear ataque que não é contra você. **Mas** quem está de fora pode jogar Evento [Counter] para usar a parte que afeta Personagens de oponentes (exemplo do Punk Gibson). | O valor de Counter e o [Blocker] são só do defensor. Na etapa de Counter, os outros oponentes do atacante podem usar Eventos [Counter] (`counter` com `bystander`), antes do defensor. |
| 4 | Cartas que reagem ao **ataque ou ao bloqueio de um oponente** disparam mesmo que você não seja o atacante nem o defensor (exemplo do Luffy da ST10). | [On Your Opponent's Attack] dispara para todos os oponentes do atacante; "When your opponent activates a [Blocker]" já valia para qualquer oponente. |
| 5 | Efeito sobre "os Personagens do oponente" (Foxy de custo 7, Shanks da OP09) vale para **todos os Personagens de todos os oponentes**. | As auras `side: 'opponent'` e os alvos com `all` alcançam todos os oponentes. |
| 6 | Efeito que mexe na **mão ou na Vida** do oponente vale para os oponentes que são alvo legal. Exemplos: Linlin de custo 10 tira 1 Vida de cada um; Linlin de custo 7 pergunta a cada um; Law de custo 4 só descarta de quem tem 7 ou mais cartas; Pudding faz todos devolverem a mão e comprarem 5. | `eachOpponent`: o passo roda uma vez contra cada oponente, na ordem dos turnos, e a condição do passo é conferida contra cada um. |
| 7 | "[Once Per Turn]" de turno do oponente (Líder Enel) se renova no começo do turno de **cada** oponente. | Os usos do turno (`usedThisTurn`) zeram no fim de cada turno. |
| 8 | Efeito que faz um oponente **perder** o jogo só elimina aquele oponente. | Não há carta automatizada com esse efeito hoje; a eliminação (`eliminate`) já é por jogador. |
| 9 | Efeito que faz um jogador **vencer** o jogo encerra a partida com ele vencedor. | `winGame` e a regra de Líder "you win the game instead of losing" encerram na hora. |
| 10 | Efeito com **patamar** ("if your opponent has…", exemplos da Reiju e do Sanji) só precisa de **um** oponente que o cumpra. | `conditionHolds` vale se algum oponente cumpre (`anyOpponent`). |

## 4. Onde o manual não chega (interpretação nossa)

Decisões tomadas para o motor funcionar. Todas fáceis de mudar; as três primeiras merecem a sua confirmação.

1. **DON!! do oponente conta como "mão ou Vida" (regra 6).** O manual só cita mão e Vida. O motor trata do mesmo
   jeito tudo o que não é alvo em campo: DON!! ("your opponent returns 1 DON!!", "rest up to 1 of your opponent's
   DON!! cards"), deck e descarte do oponente valem para **cada** oponente. Isso deixa cartas como o Magellan
   (OP02-085) três vezes mais fortes numa mesa de 4. A alternativa seria quem usa o efeito escolher um oponente.
2. **Counter de quem está de fora: ordem e aviso.** O manual não diz a ordem. No motor, os de fora respondem
   primeiro (na ordem dos turnos) e o defensor decide por último, sabendo o que os outros fizeram. E a vez de quem
   está de fora **só abre se ele tem um Evento [Counter] que pode pagar**: senão cada ataque esperaria três
   jogadores. O custo é que a pausa revela à mesa que ele tem um Evento desses na mão.
3. **Eliminação.** O manual não descreve. No motor: dano no Líder sem Vida, deck vazio, desistência ou tempo
   esgotado tiram o jogador da mesa; as cartas dele saem do jogo, os efeitos dele acabam e a mesa segue; o último
   de pé vence. **Sem recompensa por eliminação** (o manual não tem); `TableRules.eliminationDraw` existe como
   regra da casa, desligada.
4. **"Until the end of your opponent's next turn" usado no turno de um oponente** (num Counter, por exemplo)
   também acaba no começo do seu turno, pela letra da regra 2. No jogo de dois, esse efeito duraria um turno a mais.
5. **Condição e efeito sobre o oponente no mesmo passo** ("If your opponent has 7 or more cards…, trash 2 cards
   from your opponent's hand"): a condição é conferida oponente a oponente, como no exemplo do Law. Condição sobre
   o oponente com efeito só para quem usa (Reiju, Sanji): basta um oponente.
6. **"If they do not, …"** ("Your opponent may trash 1 card…; if they do not, …"): cada oponente decide, e o
   "senão" acontece uma vez para cada um que recusar, mirando só esse oponente.
7. **Cartas "you may have any number of this card in your deck":** no Yonko também é 1 cópia (a regra do formato
   vence a da carta).
8. **Lista de banidas:** o manual não tem. Nenhuma lista é aplicada por `validateYonkoDeck`.
9. **Ataque redirecionado por quem está de fora.** Pela regra 4, um [On Your Opponent's Attack] de um terceiro que
   troca o alvo do ataque para um Personagem dele (ST36-005) deve fazer dele o defensor daquela batalha: o motor
   tira o defensor do alvo atual do ataque. Ainda não há um teste dedicado a esse caso.
10. **Mesa de 3.** O manual fala em 4 capitães; o motor aceita de 3 a 4 com as mesmas regras.
11. **Relógio e ausência (mesa online).** O manual não tem relógio. Na mesa online cada um tem 25 minutos para a
    partida inteira, correndo só nas próprias decisões; sem tempo, ou 2 minutos desconectado na própria decisão, o
    jogador sai da mesa como quem desiste.

## 5. O que mudou em relação à primeira versão da fase 1

A primeira versão do motor de mesa (antes de o manual chegar) seguia três regras propostas no plano. O manual
manda diferente em quatro pontos, e o motor foi ajustado:

| Antes (proposta do plano) | Agora (manual) |
|---|---|
| Fora de batalha, quem usa o efeito **escolhia um oponente**, e todo "seu oponente" apontava para ele. | Não há escolha de oponente: alvo é de qualquer oponente (regra 1) e mão/Vida valem para cada um (regra 6). |
| Em batalha, "seu oponente" era só o outro jogador da batalha. | Na batalha vale o mesmo que fora dela. |
| Só o defensor reagia ao ataque. | Quem está de fora usa Evento [Counter] (regra 3) e dispara [On Your Opponent's Attack] (regra 4). |
| O 3º e o 4º escolhiam +1 carta ou +1 DON!!; o 1º não comprava. | Todos escolhem a largada: 1 DON!! e a compra, ou 2 DON!! sem comprar. |
| Deck construído normal de 50 cartas. | 60 cartas, uma cópia de cada. |
| Quem dava o golpe final comprava 1 carta. | Sem recompensa (fica como regra da casa, desligada). |
